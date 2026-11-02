/**
 * Веб-чат с LLM через SSE (VL-204).
 *
 * POST /api/chat (server.ts) стримит события ChatEvent в формате SSE
 * (`data: {json}\n\n`): text-дельты, tool_start/tool_end, approval-gate
 * (human-in-the-loop Allow/Deny для backlog_create_task), done/error.
 *
 * Фронт (web/src/components/chat/chat-runtime.tsx) парсит поток в
 * ChatModelAdapter assistant-ui (useLocalRuntime): при approval возвращает
 * tool-call part с `approval: { id }` и статусом requires-action — рантайм
 * ставит run на паузу; после Allow/Deny вызывает adapter повторно, тот шлёт
 * resume-запрос с решением.
 *
 * История диалога — `<cwd>/.vibelog/chat-sessions/<threadId>.jsonl`
 * (по строке на ChatMessage, паттерн VL-103: append сразу после каждого
 * сообщения — обрыв не теряет хвост). System-сообщение НЕ сохраняется:
 * оно пересобирается на каждый LLM-вызов (контекст из globalSearch
 * зависит от текущего сообщения; на resume берётся последний user).
 *
 * LLM-цикл серверный: до 8 итераций / 120 с на один запрос. Инструменты —
 * ровно три (backlog_search, backlog_view_task — выполняются сразу;
 * backlog_create_task — НЕ выполняется без подтверждения: цикл сохраняет
 * assistant(tool_calls) в jsonl и отдаёт событие approval, дожидаясь
 * resume-запроса).
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, LlmClient, ToolCall } from '../agent/llm.js';
import { createLlmClient } from '../agent/llm.js';
import { loadApiMode } from '../agent/llm-env.js';
import { loadModels, resolveModelById, validateModelsConfig } from '../core/models.js';
import { globalSearch } from '../core/search.js';
import { truncateToolOutput } from '../agent/tools.js';
import { handleToolCall } from '../mcp/tools.js';
import { ackDenied } from '../mcp/tool-result.js';
import { chatToolDefs, isWriteOperation, loadChatSystemTemplate } from './tool-policy.js';
import type { ChatLocalTool } from './tool-policy.js';
import { createCallGuard, formatChatLimitsErrors, resolveChatLimits } from './chat-limits.js';
import { recordThreadUsage, describeThreadUsage, type ThreadUsageView } from './chat-usage.js';
import {
  createTurnToolGuard,
  duplicateCallResult,
  limitCallResult,
  resolveChatMaxToolCalls,
  type ToolGuardStats,
} from './tool-dedup.js';
import { analyzeToolRepeats, type RepeatStats } from '../agent/repeat-tracker.js';
import {
  DEFAULT_PERSONA_ID,
  loadPersonaPrompt,
  resolveDefaultStatus,
  resolvePersona,
} from './personas.js';
import type { PersonaConfig } from './personas.js';
import { checkSupervisorGrant } from './supervisor-grant.js';
import { resolveSupervisorRuntime } from '../core/supervisor-config.js';
import type { SupervisorGrantPreview } from './supervisor.js';
import { supervisorGrantPreview } from '../mcp/supervisor.js';

/** SSE-событие чата (data-строка — JSON с полем type). */
export type ChatEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown>; auto?: boolean }
  | { type: 'tool_end'; id: string; result: string; isError?: boolean }
  | { type: 'approval'; toolCallId: string; name: string; args: Record<string, unknown>; grant?: SupervisorGrantPreview }
  | { type: 'done' }
  | { type: 'error'; message: string }
  /**
   * VL-313: расход токенов треда после очередного вызова модели. Клиент
   * обновляет панель без перезагрузки страницы; view — уже посчитанные
   * суммы, рубли и процент контекста (см. `ThreadUsageView`).
   */
  | { type: 'usage'; usage: ThreadUsageView }
  /**
   * VL-269: ход остановлен лимитом, но история сохранена — клиент сам
   * продолжает ход (`continue: true`), пользователю не нужно писать «Продолжи».
   */
  | {
      type: 'truncated';
      reason: 'iterations' | 'wall_time';
      /** Номер шага (итерации), на котором сработал лимит. */
      step: number;
      /** Действующие лимиты хода (для текста статуса и диагностики). */
      limits: { maxIterations: number; maxWallTimeSec: number; maxAutoContinue: number; callTimeoutSec: number };
      /** История jsonl к этому моменту сохранена (все assistant/tool дописаны). */
      saved: boolean;
    };

/** Тело запроса: новый ход ЛИБО решение по approval (resume). */
export interface ChatRequestBody {
  message?: unknown;
  sessionId?: unknown;
  threadId?: unknown;
  /** Переопределение модели чата (id из models.available, VL-209). */
  model?: unknown;
  /**
   * Роль ассистента (id из реестра chat_personas, VL-265): задаёт блок
   * системного промпта и дефолтный статус создаваемой задачи. Применяется
   * только к ПЕРВОМУ ходу треда — сервер фиксирует её в
   * `<threadId>.persona.json` (VL-283), дальше роль берётся из этого файла.
   * Отсутствие поля — роль helper; неизвестный id на первом ходе —
   * error-событие без начала хода.
   */
  persona?: unknown;
  /**
   * Решение по approval-gate. `always` (VL-264) — «Always allow»: инструмент
   * добавляется в allow-list треда, последующие вызовы идут без паузы.
   */
  approval?: { toolCallId?: unknown; approved?: unknown; reason?: unknown; always?: unknown };
  /**
   * VL-269: продолжить ход без нового user-сообщения — так клиент реагирует
   * на событие `truncated`. История jsonl не меняется (пустой строки в
   * треде не появляется), LLM-цикл стартует по уже накопленным сообщениям.
   */
  continue?: unknown;
}

/** Зависимости для тестов: подменный LLM-клиент (паттерн runLoopOptions.llm). */
export interface ChatDeps {
  llm?: Pick<LlmClient, 'streamChat'>;
}

/**
 * Лимиты LLM-цикла на один ход читаются из `.vibelog/settings.json`
 * (секция `chat`, VL-269) — см. `resolveChatLimits` в `chat-limits.ts`.
 * Дефолты без секции: 8 итераций / 120 с — прежнее поведение.
 */

/** threadId попадает в имя файла — защита от path-traversal. */
const THREAD_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Каталог сессий чата: `<cwd>/.vibelog/chat-sessions`. */
export function chatSessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'chat-sessions');
}

/** Файл истории треда. Вызывается только с валидным threadId. */
function sessionFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.jsonl`);
}

/** Загрузка истории треда; битые строки пропускаем (паттерн сессий агента). */
export function loadChatHistory(cwd: string, threadId: string): ChatMessage[] {
  const file = sessionFile(cwd, threadId);
  if (!existsSync(file)) return [];
  const out: ChatMessage[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ChatMessage);
    } catch {
      // мусорная строка не должна ронять весь тред
    }
  }
  return out;
}

/** Append сообщений в jsonl треда (создаёт каталог при первом входе). */
function appendChatMessages(cwd: string, threadId: string, messages: ChatMessage[]): void {
  const dir = chatSessionsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const lines = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
  appendFileSync(sessionFile(cwd, threadId), lines, 'utf8');
}

/**
 * Запись события подтверждения (VL-256): диагностика потерь allowance-гейтов.
 *
 * Формат — JSONL рядом с историей треда (`<threadId>.approvals.jsonl`,
 * `.vibelog/` gitignored). Имя файла содержит точку, поэтому `listChatThreads`
 * (фильтр `.jsonl` + THREAD_ID_RE) его не видит — треды не задваиваются.
 *
 * События: `requested` — диалог Allow/Deny показан модели-пользователю,
 * `decided` — решение получено, `not_confirmed` — вызов закрыт без решения
 * (предохранитель лимитов/отмена хода). Пара requested/decided на вызов
 * позволяет считать потери: requested без decided = подтверждение потерялось.
 *
 * @param turn — номер хода (число user-сообщений в истории) для группировки
 */
export function recordApprovalLog(
  cwd: string,
  threadId: string,
  entry: {
    event: 'requested' | 'decided' | 'not_confirmed';
    toolCallId: string;
    tool: string;
    turn: number;
    approved?: boolean;
    /** VL-264: решение «Always allow» — инструмент добавлен в allow-list треда. */
    always?: boolean;
  },
): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    const dir = chatSessionsDir(cwd);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    appendFileSync(join(dir, `${threadId}.approvals.jsonl`), line, 'utf8');
  } catch {
    // Сбой диагностического лога не должен рвать диалог (данные треда важнее).
  }
}

/** Событие лога подтверждений (для тестов/диагностики). */
export interface ApprovalLogEntry {
  ts: string;
  event: 'requested' | 'decided' | 'not_confirmed';
  toolCallId: string;
  tool: string;
  turn: number;
  approved?: boolean;
  /** VL-264: «Always allow» — разрешение сохранено в allow-list треда. */
  always?: boolean;
}

/** Чтение лога подтверждений треда; битые строки пропускаем (паттерн истории). */
export function loadApprovalLog(cwd: string, threadId: string): ApprovalLogEntry[] {
  if (!THREAD_ID_RE.test(threadId)) return [];
  const file = join(chatSessionsDir(cwd), `${threadId}.approvals.jsonl`);
  if (!existsSync(file)) return [];
  const out: ApprovalLogEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ApprovalLogEntry);
    } catch {
      // мусорная строка не должна ронять диагностику
    }
  }
  return out;
}

/** Диагностика хода веб-чата (VL-255): метрика повторов + счётчики guard'а. */
export interface ChatToolStats {
  /** Момент записи (ISO) — перезапись на каждый ход. */
  ts: string;
  /** Номер хода (число user-сообщений в истории треда на момент завершения). */
  turn: number;
  /**
   * Метрика повторов в формате агент-петли (VL-229, `analyzeToolRepeats`):
   * tool_calls_total / repeat_calls / repeat_share / top — диагностика общая
   * с `vibelog-agent`, отчёты читают одинаковые поля.
   */
  repeat_stats: RepeatStats;
  /** Сколько вызовов реально исполнено (после дедупа и лимита). */
  executed: number;
  /** Сколько дословных дублей заблокировано. */
  deduped: number;
  /** Сколько вызовов заблокировано лимитом на ответ. */
  limit_hits: number;
}

/** Файл диагностики хода: `<threadId>.repeat.json` (не `.jsonl` — не тред). */
function toolStatsFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.repeat.json`);
}

/**
 * Записать диагностику хода веб-чата (VL-255, AC5).
 *
 * Файл `<threadId>.repeat.json` лежит рядом с историей, но имеет расширение
 * `.json` — `listChatThreads` (фильтр `.jsonl`) его не видит, треды не
 * задваиваются. Сбой записи диагностики НЕ должен рвать диалог (паттерн
 * recordApprovalLog): ловим любые ошибки fs молча.
 */
export function recordChatToolStats(
  cwd: string,
  threadId: string,
  stats: Omit<ChatToolStats, 'ts'>,
): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    const dir = chatSessionsDir(cwd);
    mkdirSync(dir, { recursive: true });
    const payload: ChatToolStats = { ts: new Date().toISOString(), ...stats };
    writeFileSync(toolStatsFile(cwd, threadId), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch {
    // Сбой диагностики не должен рвать диалог (данные треда важнее).
  }
}

/** Чтение диагностики хода; нет файла / битый JSON / чужой threadId → null. */
export function loadChatToolStats(cwd: string, threadId: string): ChatToolStats | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const file = toolStatsFile(cwd, threadId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ChatToolStats;
  } catch {
    return null; // битый файл диагностики — просто нет данных
  }
}

/**
 * Allow-list треда (VL-264, кнопка «Always allow» в approval-карточке).
 * Разрешение «этот инструмент в этом треде больше не спрашивать» хранится
 * рядом с историей — `.vibelog/chat-sessions/<threadId>.allow.json`
 * (JSON-массив имён инструментов). Имя содержит точку, поэтому
 * `listChatThreads` (фильтр `.jsonl`) файл не видит — треды не задваиваются.
 *
 * Область действия — ТОЛЬКО тред: разрешение не переносится на другие треды
 * (защита от «разрешил один раз — открыл запись везде»). Отзыв — DELETE
 * /api/chat/threads/:id/allow?tool=<name> (кнопка в карточке).
 *
 * Все операции тихие при ошибках файловой системы: сбой allow-list не
 * должен рвать диалог (паттерн recordApprovalLog).
 */

/** Файл allow-list треда (вызывается только с валидным threadId). */
function allowListFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.allow.json`);
}

/**
 * Список разрешённых в треде инструментов. Невалидный threadId или битый
 * JSON → пустой массив (fail-closed: без разрешения гейт спрашивает).
 */
export function loadThreadAllowList(cwd: string, threadId: string): string[] {
  if (!THREAD_ID_RE.test(threadId)) return [];
  const file = allowListFile(cwd, threadId);
  if (!existsSync(file)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
  } catch {
    // битый файл — разрешений нет (лучше переспросить, чем записать молча)
    return [];
  }
}

/** Запись allow-list целиком (идемпотентно: массив без дублей, сортировка). */
function saveThreadAllowList(cwd: string, threadId: string, tools: readonly string[]): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    const dir = chatSessionsDir(cwd);
    mkdirSync(dir, { recursive: true });
    const unique = [...new Set(tools)].sort();
    writeFileSync(allowListFile(cwd, threadId), JSON.stringify(unique, null, 2) + '\n', 'utf8');
  } catch {
    // сбой записи разрешения не должен рвать текущий ход
  }
}

/** Добавить инструмент в allow-list треда; возвращает итоговый список. */
export function addThreadAllow(cwd: string, threadId: string, tool: string): string[] {
  const current = loadThreadAllowList(cwd, threadId);
  if (current.includes(tool)) return current;
  const next = [...current, tool];
  saveThreadAllowList(cwd, threadId, next);
  return [...new Set(next)].sort();
}

/** Убрать инструмент из allow-list треда; возвращает итоговый список. */
export function removeThreadAllow(cwd: string, threadId: string, tool: string): string[] {
  const next = loadThreadAllowList(cwd, threadId).filter(t => t !== tool);
  saveThreadAllowList(cwd, threadId, next);
  return next;
}

/** Разрешён ли инструмент в треде заранее (без паузы на approval). */
export function isToolAllowed(cwd: string, threadId: string, tool: string): boolean {
  return loadThreadAllowList(cwd, threadId).includes(tool);
}

/**
 * Роль, зафиксированная за тредом (VL-283).
 *
 * Пользователь выбрал роль при создании треда — дальше она НЕ меняется
 * (переключатель в начатом чате бессмысленен: system-промпт сменился бы
 * «на ходу»). Роль хранится рядом с историей —
 * `.vibelog/chat-sessions/<threadId>.persona.json` (паттерн `.allow.json`
 * VL-264: имя с точкой, `listChatThreads` его не видит, формат jsonl не
 * ломается). Содержимое: `{ persona: "<id>", fixedAt: "<ISO>" }`.
 */
function personaFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.persona.json`);
}

/**
 * id роли, зафиксированной за тредом. Невалидный threadId, отсутствующий
 * файл или битый JSON → null (роль ещё не зафиксирована).
 */
export function readThreadPersona(cwd: string, threadId: string): string | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const file = personaFile(cwd, threadId);
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const id = (raw as { persona?: unknown } | null)?.persona;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    // битый файл — считаем роль незафиксированной (тред продолжит работать)
    return null;
  }
}

/**
 * Зафиксировать роль за тредом; возвращает фактическую роль треда.
 *
 * Идемпотентно: если sidecar уже есть, сохранённый id возвращается, а файл
 * НЕ перезаписывается — гонка двух параллельных ходов не перетрёт первый
 * выбор (и удалённая из реестра роль не превратится в helper навсегда).
 * Сбой файловой системы не рвёт диалог (паттерн saveThreadAllowList).
 */
export function fixThreadPersona(cwd: string, threadId: string, personaId: string): string {
  const stored = readThreadPersona(cwd, threadId);
  if (stored !== null) return stored;
  if (!THREAD_ID_RE.test(threadId)) return personaId;
  try {
    mkdirSync(chatSessionsDir(cwd), { recursive: true });
    writeFileSync(
      personaFile(cwd, threadId),
      JSON.stringify({ persona: personaId, fixedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    );
  } catch {
    // сбой записи роли не должен рвать текущий ход
  }
  return personaId;
}

/**
 * Роль треда для отображения (GET /api/chat/threads/:id).
 *
 * sidecar есть → его id. sidecar нет, но в треде уже есть ходы → `helper`
 * (старые треды до VL-283 фактически работали помощником: это был дефолт
 * module-state, поведение не меняется). Совсем новый тред (нет ни sidecar,
 * ни user-сообщений) → null: клиент покажет пикер выбора роли.
 */
export function effectiveThreadPersona(cwd: string, threadId: string): string | null {
  const stored = readThreadPersona(cwd, threadId);
  if (stored !== null) return stored;
  if (!THREAD_ID_RE.test(threadId)) return null;
  if (!existsSync(sessionFile(cwd, threadId))) return null;
  const started = loadChatHistory(cwd, threadId).some(m => m.role === 'user');
  return started ? DEFAULT_PERSONA_ID : null;
}

/** Элемент списка тредов для сайдбара (VL-207): метаданные без тел сообщений. */
export interface ChatThreadSummary {
  threadId: string;
  /** Заголовок — первая строка первого user-сообщения (обрезка 80 символов). */
  title: string;
  /** mtime файла истории (ISO) — для сортировки «недавние сверху». */
  updatedAt: string;
  /** Число сообщений в jsonl (для индикации «пустой тред»). */
  messageCount: number;
}

/**
 * Список тредов чата, отсортированный по времени изменения (свежие сверху).
 * Каталог отсутствует (не было чата) — пустой массив, не ошибка.
 */
export function listChatThreads(cwd: string): ChatThreadSummary[] {
  const dir = chatSessionsDir(cwd);
  if (!existsSync(dir)) return [];
  const out: ChatThreadSummary[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const threadId = name.slice(0, -'.jsonl'.length);
    // Имя файла — тот же валидатор, что и в runChat (защита от мусора в каталоге)
    if (!THREAD_ID_RE.test(threadId)) continue;
    const history = loadChatHistory(cwd, threadId);
    const firstUser = history.find(m => m.role === 'user');
    const rawTitle =
      firstUser && firstUser.role === 'user' ? firstUser.content.trim().split('\n')[0] ?? '' : '';
    out.push({
      threadId,
      title: (rawTitle || 'Пустой тред').slice(0, 80),
      updatedAt: statSync(sessionFile(cwd, threadId)).mtime.toISOString(),
      messageCount: history.length,
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * История треда для восстановления на клиенте (VL-207, GET /api/chat/threads/:id).
 * Невалидный id или отсутствующий файл — null (404 на уровне API).
 */
export function getChatThread(cwd: string, threadId: string): ChatMessage[] | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  if (!existsSync(sessionFile(cwd, threadId))) return null;
  return loadChatHistory(cwd, threadId);
}

/** Новый threadId: валидный по THREAD_ID_RE, машиночитаемый префикс. */
function createThreadIds(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `chat-${Date.now().toString(36)}-${rand}`;
}

/**
 * Закрытие «висящих» tool_calls хвоста истории: пользователь прислал новое
 * сообщение вместо ответа на approval — вставляем синтетический tool-result
 * «Отменено пользователем» для каждого неотвеченного вызова. Без этого
 * провайдер отклонит payload (assistant с tool_calls без результатов).
 * Работает только для хвоста (пауза approval всегда в хвосте jsonl).
 *
 * @returns количество вставленных синтетических результатов
 */
function closePendingToolCalls(history: ChatMessage[]): number {
  // последний не-tool (assistant/user/system) в хвосте
  let i = history.length - 1;
  while (i >= 0 && history[i]!.role === 'tool') i--;
  if (i < 0) return 0;
  const last = history[i]!;
  if (last.role !== 'assistant' || !last.tool_calls?.length) return 0;
  const answered = new Set(
    history.slice(i + 1).filter(m => m.role === 'tool').map(m => m.tool_call_id),
  );
  let inserted = 0;
  for (const tc of last.tool_calls) {
    if (answered.has(tc.id)) continue;
    history.push({
      role: 'tool',
      tool_call_id: tc.id,
      // VL-262: машиночитаемая причина отказа (denied) + перечень неприменённых полей.
      // Прежняя подстрока «Отменено пользователем» живёт в message (тесты/промпты).
      content: ackDenied('denied', { tool: tc.name, fields: Object.keys(tc.arguments ?? {}) }),
    });
    inserted++;
  }
  return inserted;
}

/** Tool-вызовы последнего assistant-сообщения, ещё не имеющие результата. */
function pendingToolCalls(history: ChatMessage[]): ToolCall[] {
  let i = history.length - 1;
  while (i >= 0 && history[i]!.role === 'tool') i--;
  if (i < 0) return [];
  const last = history[i]!;
  if (last.role !== 'assistant' || !last.tool_calls?.length) return [];
  const answered = new Set(
    history.slice(i + 1).filter(m => m.role === 'tool').map(m => m.tool_call_id),
  );
  return last.tool_calls.filter(tc => !answered.has(tc.id));
}

/** Последний user-текст из истории (для контекста поиска и system-промпта). */
function lastUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === 'user') return m.content;
  }
  return '';
}

/**
 * System-сообщение: статическая часть из шаблона (VL-219: переопределение
 * .vibelog/prompts/chat-system.md → templates/prompts/chat-system.md,
 * fail-closed) + блок роли (VL-265: общая часть не дублируется в файлах
 * ролей, роль идёт отдельным блоком) + динамический контекст globalSearch
 * по последнему сообщению (всегда последним — он рантаймовый).
 */
function buildSystemPrompt(cwd: string, lastUser: string, persona: PersonaConfig): string {
  const parts: string[] = [
    loadChatSystemTemplate(cwd),
    `## Текущая роль: ${persona.label}\n\n${loadPersonaPrompt(cwd, persona)}`,
  ];
  if (lastUser.trim()) {
    const hits = globalSearch(cwd, lastUser.trim());
    const context = {
      tasks: hits.tasks.slice(0, 5),
      lessons: hits.lessons.slice(0, 3),
      references: hits.references.slice(0, 3),
      documents: hits.documents.slice(0, 3),
    };
    const hasContext =
      context.tasks.length || context.lessons.length || context.references.length || context.documents.length;
    if (hasContext) {
      parts.push(
        'Контекст проекта по текущему сообщению (результаты поиска, не выдумывай данные сверх них):\n' +
          truncateToolOutput(JSON.stringify(context, null, 2)),
      );
    }
  }
  return parts.join('\n\n');
}

/** Мини-очередь: produce() пушит события, генератор дренирует их вживую. */
class EventQueue {
  private items: ChatEvent[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;

  push(ev: ChatEvent): void {
    if (this.closed) return;
    this.items.push(ev);
    this.waiter?.();
  }

  close(): void {
    this.closed = true;
    this.waiter?.();
  }

  /** Следующее событие либо null, когда очередь закрыта и пуста. */
  async next(): Promise<ChatEvent | null> {
    for (;;) {
      if (this.items.length) return this.items.shift()!;
      if (this.closed) return null;
      await new Promise<void>(resolve => {
        this.waiter = () => {
          this.waiter = null;
          resolve();
        };
      });
    }
  }
}

/**
 * Главный вход: генератор SSE-событий чата.
 *
 * @param body — тело POST /api/chat (message | approval)
 * @param cwd — рабочая директория проекта (backlog/, .vibelog/)
 * @param deps — injectable LLM для тестов; без него — createLlmClient() из env
 */
export async function* runChat(
  body: ChatRequestBody,
  cwd: string,
  deps: ChatDeps = {},
): AsyncGenerator<ChatEvent> {
  // --- валидация входа и threadId -----------------------------------------
  const rawThreadId = body.threadId;
  let threadId: string;
  if (rawThreadId === undefined || rawThreadId === null || rawThreadId === '') {
    threadId = createThreadIds();
  } else if (typeof rawThreadId === 'string' && THREAD_ID_RE.test(rawThreadId)) {
    threadId = rawThreadId;
  } else {
    yield { type: 'error', message: 'Некорректный threadId: допустимы [a-zA-Z0-9_-] до 64 символов' };
    return;
  }

  const rawMessage = body.message;
  const hasMessage = typeof rawMessage === 'string' && rawMessage.trim().length > 0;
  const approval = body.approval;
  const hasApproval =
    !!approval &&
    typeof approval.toolCallId === 'string' &&
    typeof approval.approved === 'boolean';

  if (!hasMessage && !hasApproval && body.continue !== true) {
    yield { type: 'error', message: 'Пустой запрос: ожидается поле message, approval или continue' };
    return;
  }

  yield { type: 'thread', threadId };

  const queue = new EventQueue();
  const task = produce(body, cwd, threadId, deps, queue)
    .catch(err => {
      queue.push({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => queue.close());

  try {
    for (;;) {
      const ev = await queue.next();
      if (ev === null) break;
      yield ev;
    }
  } finally {
    // Потребитель (сервер) перестал читать — дожидаемся продюсера,
    // чтобы не оставить LLM-вызов висеть без обработки ошибок.
    await task;
  }
}

/** Продюсер: вся логика хода в живой очереди событий. */
async function produce(
  body: ChatRequestBody,
  cwd: string,
  threadId: string,
  deps: ChatDeps,
  queue: EventQueue,
): Promise<void> {
  // --- роль (VL-283: фиксируется за тредом) ---------------------------------
  // Роль — свойство ТРЕДА, а не хода: первый ход фиксирует её в
  // <threadId>.persona.json, а последующие ходы body.persona игнорируют —
  // иначе system-промпт менялся бы «на ходу» и поведение ассистента
  // переключалось посреди диалога.
  // Валидация по-прежнему ДО чтения истории: неизвестный id на ПЕРВОМ ходе —
  // ход не начинается, sidecar не пишется (ошибка не портит тред).
  // Роль НЕ влияет на модель: body.model и body.persona разбираются независимо.
  const sidecarPersonaId = readThreadPersona(cwd, threadId);
  // sidecar нет у старых тредов (до VL-283): там роль фактически была helper
  const storedPersonaId = sidecarPersonaId ?? effectiveThreadPersona(cwd, threadId);
  let pickedPersona: PersonaConfig | null;
  if (storedPersonaId !== null) {
    // Роль уже за тредом: чужой body.persona не применяем (только лог)
    if (sidecarPersonaId === null) {
      console.warn(
        `[chat] тред ${threadId} создан до фиксации роли — зафиксирована роль ${storedPersonaId}`,
      );
    } else if (
      typeof body.persona === 'string' &&
      body.persona !== '' &&
      body.persona !== storedPersonaId
    ) {
      console.warn(
        `[chat] роль треда ${threadId} уже зафиксирована: ${storedPersonaId}, ` +
          `body.persona=${body.persona} игнорируется`,
      );
    }
    pickedPersona = resolvePersona(cwd, storedPersonaId);
    if (pickedPersona === null) {
      // Роль удалена из реестра (VL-273) — тред не должен стать неработающим.
      // Откат на helper без перезаписи sidecar: вернётся id в реестр — вернётся
      // и роль треда.
      console.warn(
        `[chat] роль треда ${threadId} "${storedPersonaId}" отсутствует в реестре — ` +
          `ход выполняется как ${DEFAULT_PERSONA_ID}`,
      );
      pickedPersona = resolvePersona(cwd, DEFAULT_PERSONA_ID);
    }
  } else if (body.persona === undefined || body.persona === null || body.persona === '') {
    pickedPersona = resolvePersona(cwd, DEFAULT_PERSONA_ID);
  } else if (typeof body.persona !== 'string') {
    queue.push({
      type: 'error',
      message: 'Некорректная роль: ожидается строка id из chat_personas settings.json',
    });
    return;
  } else {
    pickedPersona = resolvePersona(cwd, body.persona);
    if (pickedPersona === null) {
      queue.push({ type: 'error', message: `Неизвестная роль: ${body.persona}` });
      return;
    }
  }
  if (pickedPersona === null) {
    // Нет даже встроенного helper — шаблон пакета собран без ролей
    queue.push({
      type: 'error',
      message: `Роль по умолчанию "${DEFAULT_PERSONA_ID}" отсутствует в реестре chat_personas`,
    });
    return;
  }
  // const — чтобы сужение типа жило в замыканиях executeTool и LLM-цикла
  const activePersona: PersonaConfig = pickedPersona;
  // Фиксация — строго ПОСЛЕ валидации и ДО LLM-цикла (VL-283): роль треда
  // известна даже если ход потом упадёт. Идемпотентно — не перетирает sidecar.
  if (sidecarPersonaId === null) fixThreadPersona(cwd, threadId, activePersona.id);

  // --- лимиты хода (VL-269) -------------------------------------------------
  // Читаются на КАЖДЫЙ ход, а не на старте процесса: правка settings.json
  // применяется к следующему ходу без перезапуска веб-сервера (AC2).
  // Мусорные значения уже откатаны к дефолтам — здесь только предупреждение
  // в лог сервера, ход продолжается (AC3).
  const { limits, errors: limitsErrors } = resolveChatLimits(cwd);
  if (limitsErrors.length > 0) console.error(formatChatLimitsErrors(limitsErrors));

  // VL-270 (doc-19 §7, AC15): у роли supervisor СВОИ лимиты — 30 итераций и
  // 600 с вместо 8/120 у остальных ролей. Остальным ролям значения не меняем:
  // override применяется ТОЛЬКО к активной персоне supervisor, иначе длинный
  // ход «перетёк» бы в обычный чат против воли пользователя.
  if (activePersona.id === 'supervisor') {
    const supervisorRuntime = resolveSupervisorRuntime(cwd);
    if (supervisorRuntime.errors.length > 0) {
      console.error(`[supervisor] конфигурация: ${supervisorRuntime.errors.join('; ')}`);
    }
    limits.maxIterations = supervisorRuntime.limits.chatMaxIterations;
    limits.maxWallTimeMs = supervisorRuntime.limits.chatMaxWallTimeMs;
  }
  /** Компактный снимок лимитов для события truncated (секунды — как в конфиге). */
  const limitsView = {
    maxIterations: limits.maxIterations,
    maxWallTimeSec: Math.round(limits.maxWallTimeMs / 1000),
    maxAutoContinue: limits.maxAutoContinue,
    callTimeoutSec: Math.round(limits.callTimeoutMs / 1000),
  };

  const history = loadChatHistory(cwd, threadId);
  // VL-256: номер хода для лога подтверждений. Считается по истории В МОМЕНТ
  // записи события: resume не добавляет user-сообщение, поэтому все гейты
  // одного хода получают одинаковый номер.
  const currentTurn = (): number => history.filter(m => m.role === 'user').length;

  // --- LLM-клиент -----------------------------------------------------------
  let llm: Pick<LlmClient, 'streamChat'> | undefined = deps.llm;
  if (!llm) {
    // VL-209: переопределение модели из body (id из models.available) —
    // валидация до создания клиента; строка обязательна
    let bodyModel: string | undefined;
    if (body.model !== undefined) {
      if (typeof body.model !== 'string' || body.model === '') {
        queue.push({ type: 'error', message: 'Некорректная модель: ожидается строка id из models.available' });
        return;
      }
      bodyModel = body.model;
      if (resolveModelById(cwd, bodyModel) === null) {
        queue.push({ type: 'error', message: `Неизвестная модель: ${bodyModel} — отсутствует в models.available settings.json` });
        return;
      }
    }
    // Models-путь (VL-209): секции настроены — валидируем их; fallback
    // (нет секции models) — СТАРОЕ поведение и старые тексты дословно
    // (их матчат chat.test.mjs)
    const hasModelsSection = Object.keys(loadModels(cwd).available).length > 0;
    if (!hasModelsSection && !process.env.VIBELOG_LLM_API_KEY) {
      queue.push({
        type: 'error',
        message:
          'Ошибка: не задан VIBELOG_LLM_API_KEY — чату нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)',
      });
      return;
    }
    if (!hasModelsSection && !process.env.VIBELOG_LLM_MODEL) {
      queue.push({
        type: 'error',
        message: 'Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна',
      });
      return;
    }
    if (hasModelsSection) {
      const errors = validateModelsConfig(cwd);
      if (errors.length > 0) {
        for (const err of errors) queue.push({ type: 'error', message: `Ошибка: ${err}` });
        return;
      }
    }
    try {
      // apiMode (VL-205): из модели/фолбэка settings; model (VL-209):
      // переопределение из body приоритетнее default (createLlmClient
      // резолвит id → wire-имя через resolveActiveModel/resolveModelById
      // не может — id передаём как options.model ТОЛЬКО для default-пути,
      // поэтому переопределение резолвим здесь заранее)
      const override = bodyModel !== undefined ? resolveModelById(cwd, bodyModel) : null;
      llm = createLlmClient({
        cwd,
        sessionId: threadId,
        apiMode: loadApiMode(cwd),
        ...(override
          ? { model: override.model, baseUrl: override.baseUrl, apiKey: override.apiKey, apiMode: override.apiMode }
          : {}),
      });
    } catch (err) {
      queue.push({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
  }

  const tools = chatToolDefs(cwd);
  // Локальные инструменты (read_file/write_file) имеют handler в chat-tool
  // (их нет в MCP-реестре) — карта для маршрутизации ниже (VL-219)
  const localHandlers = new Map<string, ChatLocalTool>(
    tools.filter((t): t is ChatLocalTool => 'handler' in t).map(t => [t.name, t]),
  );
  /**
   * Исполняет инструмент: локальный (read_file/write_file) — его handler,
   * остальные — MCP-реестр handleToolCall. Единая точка капа вывода
   * (lesson-30): truncateToolOutput после handler'а для обоих путей.
   *
   * VL-262: write-инструменты отвечают JSON-контрактом (ackOk: applied/skipped),
   * отказы подтверждения — ackDenied('denied' | 'not_confirmed'). Модель видит
   * снимок фактически применённого и причину отказа в машиночитаемом виде.
   *
   * VL-255: ПЕРЕД исполнением — guard хода. Дословный дубль уже исполненного
   * вызова не исполняется (модель получает {ok:false,duplicate:true} с
   * указанием использовать прежний результат), сверхлимитные вызовы ответа —
   * {ok:false,limit:true} с указанием завершить ход. Единая точка ⇒ защита
   * действует в обычном цикле, в resume-пути и в advanceToNextApproval.
   */
  const toolGuard = createTurnToolGuard({ maxPerResponse: resolveChatMaxToolCalls(cwd) });
  const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const verdict = toolGuard.check(name, args);
    if (verdict === 'duplicate') return duplicateCallResult();
    if (verdict === 'limit') return limitCallResult(toolGuard.maxPerResponse());
    // VL-268: grant прогона проверяется на КАЖДОМ вызове. Задача вне taskIds —
    // отказ без исполнения; инструмент вне allowedTools сюда не доходит
    // (гейт вызовов уже отправил его в Allow/Deny).
    const grant = checkGrant(cwd, name, args);
    if (grant.kind === 'error') return grantDeniedResult(grant.error, name);
    const local = localHandlers.get(name);
    const raw = local ? await local.handler(args) : await handleToolCall(name, args, cwd, { defaultStatus: resolveDefaultStatus(activePersona) });
    // Фиксируем исполнение ДО капа вывода: write инкрементит epoch ресурса,
    // поэтому последующее чтение того же файла не считается дублем.
    toolGuard.noteExecuted(name, args);
    return truncateToolOutput(raw);
  };
  /** Записать диагностику хода (VL-255): метрика повторов + счётчики guard'а. */
  const finishStats = (): void => {
    recordChatToolStats(cwd, threadId, {
      turn: currentTurn(),
      repeat_stats: analyzeToolRepeats(history),
      ...(toolGuard.stats() as ToolGuardStats),
    });
  };
  const started = Date.now();

  /**
   * Модель, которой идут запросы треда (VL-313): переопределение из body
   * (валидировано выше) либо models.default. Нужна для тарифа и окна
   * контекста в панели; undefined — env-fallback (тариф/окно неизвестны,
   * панель покажет только токены).
   */
  const usageModelId: string | undefined =
    typeof body.model === 'string' && body.model !== '' ? body.model : loadModels(cwd).default;

  // --- подготовка истории ---------------------------------------------------
  if (hasApprovalOf(body)) {
    // Resume: отвечаем на первый неотвеченный create, остальные закрываем ниже.
    const pending = pendingToolCalls(history);
    const target = pending.find(tc => tc.id === (body.approval!.toolCallId as string));
    if (!target) {
      queue.push({ type: 'error', message: 'Согласование не найдено: тред уже закрыт или устарел' });
      return;
    }
    const approved = body.approval!.approved as boolean;
    // VL-264 «Always allow»: разрешение сохраняется в allow-list треда —
    // последующие вызовы этого инструмента в треде идут без паузы.
    const always = approved && body.approval!.always === true;
    if (always) addThreadAllow(cwd, threadId, target.name);
    // VL-256: решение получено — фиксируем в логе (requested без decided = потеря)
    recordApprovalLog(cwd, threadId, {
      event: 'decided',
      toolCallId: target.id,
      tool: target.name,
      turn: currentTurn(),
      approved,
      ...(always ? { always: true } : {}),
    });
    let content: string;
    if (approved) {
      try {
        content = await executeTool(target.name, target.arguments);
      } catch (err) {
        content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      // VL-262: причина отказа кодируется (denied) — applied пуст, skipped
      // перечисляет переданные поля, чтобы модель знала, что именно НЕ записалось
      content = ackDenied('denied', {
        tool: target.name,
        fields: Object.keys(target.arguments ?? {}),
        // Пользовательский текст причины (если UI его прислал) сохраняем
        ...(typeof body.approval!.reason === 'string' && body.approval!.reason.trim()
          ? { message: body.approval!.reason }
          : {}),
      });
    }
    history.push({ role: 'tool', tool_call_id: target.id, content });
    appendChatMessages(cwd, threadId, [
      { role: 'tool', tool_call_id: target.id, content },
    ]);
    // VL-256: остальные неотвеченные вызовы хода. Read-only исполняем сразу,
    // а следующий write НЕ отменяем молча — показываем для него свой
    // Allow/Deny (последовательные гейты вместо синтетического not_confirmed).
    const next = await advanceToNextApproval(history, cwd, threadId, queue, target.id, executeTool);
    if (next !== null) {
      recordApprovalLog(cwd, threadId, {
        event: 'requested',
        toolCallId: next.id,
        tool: next.name,
      turn: currentTurn(),
      });
      queue.push({ type: 'approval', toolCallId: next.id, name: next.name, args: next.arguments, ...(grantPreviewOf(cwd, next.name, next.arguments) ? { grant: grantPreviewOf(cwd, next.name, next.arguments) } : {}) });
      return; // ход снова на паузе: ждём решение по следующему вызову
    }
  } else if (body.continue === true) {
    // VL-269: авто-продолжение после truncated — нового user-сообщения НЕТ,
    // пустая строка в тред не попадает (AC8). Ход стартует по уже
    // накопленной истории; закрывать approval-хвосты не нужно: truncated
    // отдаётся только после closeUnconfirmedTail (парность tool_calls↔tool
    // к этому моменту восстановлена).
    if (history.length === 0) {
      queue.push({ type: 'error', message: 'Нечего продолжать: история треда пуста' });
      return;
    }
  } else {
    const closedCount = closePendingToolCalls(history);
    if (closedCount > 0) {
      appendChatMessages(cwd, threadId, history.slice(-closedCount));
    }
    const message = (body.message as string).trim();
    history.push({ role: 'user', content: message });
    appendChatMessages(cwd, threadId, [{ role: 'user', content: message }]);
  }

  // --- LLM-цикл -------------------------------------------------------------
  let iterations = 0;
  for (;;) {
    if (++iterations > limits.maxIterations) {
      // VL-256: хвост write-вызовов без результата сделал бы payload невалидным
      // для провайдера — закрываем явным not_confirmed (машиночитаемо, с логом)
      closeUnconfirmedTail(history, cwd, threadId, queue, currentTurn());
      finishStats(); // VL-255: диагностика хода пишется и на путях ошибок
      // VL-269 (AC6): лимит итераций — не обрыв хода с ошибкой, а truncated:
      // история в jsonl цела (append после каждого сообщения), клиент сам
      // повторит ход с continue: true.
      queue.push({
        type: 'truncated',
        reason: 'iterations',
        step: limits.maxIterations,
        limits: limitsView,
        saved: true,
      });
      return;
    }
    if (Date.now() - started > limits.maxWallTimeMs) {
      closeUnconfirmedTail(history, cwd, threadId, queue, currentTurn());
      finishStats(); // VL-255
      // VL-269 (AC7): то же для бюджета времени — truncated, не error.
      queue.push({
        type: 'truncated',
        reason: 'wall_time',
        step: iterations,
        limits: limitsView,
        saved: true,
      });
      return;
    }

    const system: ChatMessage = {
      role: 'system',
      content: buildSystemPrompt(cwd, lastUserText(history), activePersona),
    };

    let resp;
    // VL-269 (AC12): per-call таймаут — окно неактивности одного вызова модели,
    // а не бюджет хода. Живой стрим перевзводит таймер на каждом токене.
    const callGuard = createCallGuard(limits.callTimeoutMs);
    try {
      // VL-255: новый ответ модели — счётчик вызовов ответа начинается с нуля
      // (карта исполненных сигнатур сохраняется: дедуп действует на весь ход).
      toolGuard.beginTurn();
      resp = await llm.streamChat([system, ...history], tools, {
        onToken: token => {
          callGuard.noteActivity();
          queue.push({ type: 'text', delta: token });
        },
        signal: callGuard.signal,
      });
    } catch (err) {
      // Таймаут одного вызова — тоже truncated: ход продолжится клиентом
      // или кнопкой «Продолжить», история цела. Прочие ошибки — как раньше.
      if (callGuard.timedOut()) {
        finishStats();
        queue.push({
          type: 'truncated',
          reason: 'wall_time',
          step: iterations,
          limits: limitsView,
          saved: true,
        });
        return;
      }
      finishStats(); // VL-255: ошибка LLM — диагностика хода тоже нужна
      queue.push({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    } finally {
      callGuard.dispose();
    }

    // --- учёт расхода токенов треда (VL-313) -------------------------------
    // Каждый вызов модели уже включает в input весь промпт, поэтому пик
    // контекста считается по запросам, а суммы — кумулятивно (см. chat-usage).
    // Модель треда: переопределение из body, иначе models.default. Деньги
    // считаются по тарифу ИМЕННО этой модели — прошлые ходы не пересчитаются
    // по чужому тарифу после смены модели в пикере.
    if (resp.usage) {
      const recorded = recordThreadUsage(cwd, threadId, {
        ...(usageModelId ? { modelId: usageModelId } : {}),
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
        cache: resp.usage.cache_read_input_tokens,
        reasoning: resp.usage.reasoning_tokens,
      });
      const view = describeThreadUsage(cwd, recorded);
      if (view !== null) queue.push({ type: 'usage', usage: view });
    }

    if (resp.toolCalls.length === 0) {
      // Финальный текст: сохраняем и завершаем ход.
      const assistant: ChatMessage = { role: 'assistant', content: resp.text };
      history.push(assistant);
      appendChatMessages(cwd, threadId, [assistant]);
      finishStats(); // VL-255: диагностика хода (repeat_stats + deduped/limit_hits)
      queue.push({ type: 'done' });
      return;
    }

    // Есть tool_calls: сохраняем assistant целиком ДО исполнения (crash-safe).
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: resp.text || null,
      tool_calls: resp.toolCalls,
    };
    history.push(assistantMsg);
    appendChatMessages(cwd, threadId, [assistantMsg]);

    // Исполняем по порядку; первый write — пауза (approval-gate по природе
    // операции, VL-219: не по списку имён — isWriteOperation). VL-264:
    // инструмент из allow-list треда проходит без паузы (auto: true —
    // клиент помечает вызов как разрешённый заранее).
    for (const tc of resp.toolCalls) {
      // VL-268: grant прогона развязывает инструменты супервизора в пределах
      // задачи/набора; остальные инструменты политика обрабатывает как раньше
      const grantGate = checkGrant(cwd, tc.name, tc.arguments);
      if (grantGate.kind === 'error') {
        // Задача вне прогона: отказ без паузы и без исполнения (AC8)
        const content = grantDeniedResult(grantGate.error, tc.name);
        history.push({ role: 'tool', tool_call_id: tc.id, content });
        appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
        queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
        continue;
      }
      const grantAllowed = grantGate.kind === 'granted';
      const autoAllowed =
        grantAllowed || (isWriteOperation(tc.name) && isToolAllowed(cwd, threadId, tc.name));
      if (isWriteOperation(tc.name) && !autoAllowed) {
        recordApprovalLog(cwd, threadId, {
          event: 'requested',
          toolCallId: tc.id,
          tool: tc.name,
      turn: currentTurn(),
        });
        const preview = grantPreviewOf(cwd, tc.name, tc.arguments);
        queue.push({
          type: 'approval',
          toolCallId: tc.id,
          name: tc.name,
          args: tc.arguments,
          ...(preview ? { grant: preview } : {}),
        });
        return; // состояние уже в jsonl; ждём resume с решением
      }
      queue.push({
        type: 'tool_start',
        id: tc.id,
        name: tc.name,
        args: tc.arguments,
        ...(autoAllowed ? { auto: true } : {}),
      });
      let result: string;
      let isError = false;
      try {
        result = await executeTool(tc.name, tc.arguments);
      } catch (err) {
        result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        isError = true;
      }
      const toolMsg: ChatMessage = { role: 'tool', tool_call_id: tc.id, content: result };
      history.push(toolMsg);
      appendChatMessages(cwd, threadId, [toolMsg]);
      queue.push({
        type: 'tool_end',
        id: tc.id,
        result,
        ...(isError ? { isError: true } : {}),
      });
    }
    // Все вызовы исполнены — следующая итерация LLM.
  }
}

/** Тело содержит корректный approval-объект. */
function hasApprovalOf(body: ChatRequestBody): boolean {
  const a = body.approval;
  return !!a && typeof a.toolCallId === 'string' && typeof a.approved === 'boolean';
}

/**
 * Инструменты, которыми управляет grant прогона (VL-268, AC8).
 *
 * Только они проверяются grant-путём: для остальных инструментов поведение
 * прежнее (read — сразу, write — Allow/Deny).
 */
const SUPERVISOR_TOOLS: ReadonlySet<string> = new Set([
  'backlog_trigger_phase',
  'backlog_phase_status',
  'backlog_auto_queue',
  'backlog_supervisor',
  'backlog_create_task',
]);

/** Вердикт grant-гейта: исполнять без паузы / обычный Allow/Deny / отказ. */
type GrantGate =
  | { kind: 'n/a' }
  | { kind: 'granted'; runId: string }
  | { kind: 'approval'; expired?: boolean }
  | { kind: 'error'; error: string };

/**
 * Проверка grant ПЕРЕД каждым вызовом инструмента супервизора (AC8).
 *
 * Вызывается в трёх точках approval-гейта (цикл хода, resume, продвижение к
 * следующему гейту), а не один раз при старте хода: отзыв grant'а (stop или
 * завершение прогона) должен действовать немедленно, даже посреди хода.
 */
function checkGrant(cwd: string, name: string, args: Record<string, unknown>): GrantGate {
  if (!SUPERVISOR_TOOLS.has(name)) return { kind: 'n/a' };
  const verdict = checkSupervisorGrant(cwd, name, args);
  if ('granted' in verdict && verdict.granted) return { kind: 'granted', runId: verdict.runId };
  if ('error' in verdict) return { kind: 'error', error: verdict.error };
  return { kind: 'approval', ...(verdict.expired ? { expired: true } : {}) };
}

/** Данные карточки grant для approval-события (AC10); ошибки не рвут ход. */
function grantPreviewOf(cwd: string, name: string, args: Record<string, unknown>): SupervisorGrantPreview | undefined {
  if (name !== 'backlog_supervisor') return undefined;
  if (typeof args.action !== 'string' || args.action !== 'start') return undefined;
  try {
    return supervisorGrantPreview(cwd, args);
  } catch {
    return undefined; // предпросмотр — украшение карточки, не повод падать
  }
}

/** Машиночитаемый отказ по grant'у (без исполнения инструмента). */
function grantDeniedResult(error: string, tool: string): string {
  return JSON.stringify(
    {
      ok: false,
      error,
      tool,
      hint: 'Задача вне набора прогона: предложи пользователю расширить прогон (backlog_supervisor start с новым набором ids) и подтвердить заново.',
    },
    null,
    2,
  );
}

/**
 * VL-256: продвижение к следующему гейту после решения по одному вызову.
 *
 * Read-only вызовы хвоста хода (search/view/read_file) исполняются сразу —
 * они не требуют подтверждения. Первый встреченный write НЕ закрывается и
 * НЕ исполняется, а возвращается вызывающему: сервер покажет для него
 * отдельный Allow/Deny (последовательные гейты, ref-22 local-runtime.mdx
 * §Approval gates: adapter вызывается заново на каждое решение).
 *
 * VL-264: write-инструмент, уже разрешённый в треде (allow-list, «Always
 * allow»), проходит здесь без паузы — иначе повторный вызов того же
 * инструмента снова показал бы диалог.
 *
 * @param skipId — id только что обработанного вызова (его результат уже в истории)
 * @param execute — исполнитель инструмента (учитывает локальные handler'ы:
 *   read_file/write_file не живут в MCP-реестре)
 * @returns следующий write-вызов, ожидающий подтверждения, либо null
 */
async function advanceToNextApproval(
  history: ChatMessage[],
  cwd: string,
  threadId: string,
  queue: EventQueue,
  skipId: string,
  execute: (name: string, args: Record<string, unknown>) => Promise<string>,
): Promise<ToolCall | null> {
  for (const tc of pendingToolCalls(history)) {
    if (tc.id === skipId) continue;
    // VL-268: grant прогона действует и на хвосте хода (проверка на каждый вызов)
    const grantGate = checkGrant(cwd, tc.name, tc.arguments);
    if (grantGate.kind === 'error') {
      const content = grantDeniedResult(grantGate.error, tc.name);
      history.push({ role: 'tool', tool_call_id: tc.id, content });
      appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
      queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
      continue;
    }
    const grantAllowed = grantGate.kind === 'granted';
    const autoAllowed =
      grantAllowed || (isWriteOperation(tc.name) && isToolAllowed(cwd, threadId, tc.name));
    if (isWriteOperation(tc.name) && !autoAllowed) return tc;
    queue.push({
      type: 'tool_start',
      id: tc.id,
      name: tc.name,
      args: tc.arguments,
      ...(autoAllowed ? { auto: true } : {}),
    });
    let result: string;
    let isError = false;
    try {
      result = await execute(tc.name, tc.arguments);
    } catch (err) {
      result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      isError = true;
    }
    history.push({ role: 'tool', tool_call_id: tc.id, content: result });
    appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content: result }]);
    queue.push({ type: 'tool_end', id: tc.id, result, ...(isError ? { isError: true } : {}) });
  }
  return null;
}

/**
 * VL-256: предохранитель лимитов — висящие write-вызовы закрываются
 * машиночитаемым `not_confirmed` (а не остаются без результата: провайдер
 * отклонил бы payload «assistant с tool_calls без результатов»). Событие
 * пишется в лог подтверждений — потеря решения видна в диагностике.
 */
function closeUnconfirmedTail(
  history: ChatMessage[],
  cwd: string,
  threadId: string,
  queue: EventQueue,
  turn: number,
): void {
  for (const tc of pendingToolCalls(history)) {
    const content = ackDenied('not_confirmed', {
      tool: tc.name,
      fields: Object.keys(tc.arguments ?? {}),
    });
    history.push({ role: 'tool', tool_call_id: tc.id, content });
    appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
    recordApprovalLog(cwd, threadId, {
      event: 'not_confirmed',
      toolCallId: tc.id,
      tool: tc.name,
      turn,
    });
    queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
  }
}
