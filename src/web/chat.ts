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

import { mkdirSync, appendFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

/** SSE-событие чата (data-строка — JSON с полем type). */
export type ChatEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; id: string; result: string; isError?: boolean }
  | { type: 'approval'; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Тело запроса: новый ход ЛИБО решение по approval (resume). */
export interface ChatRequestBody {
  message?: unknown;
  sessionId?: unknown;
  threadId?: unknown;
  /** Переопределение модели чата (id из models.available, VL-209). */
  model?: unknown;
  approval?: { toolCallId?: unknown; approved?: unknown; reason?: unknown };
}

/** Зависимости для тестов: подменный LLM-клиент (паттерн runLoopOptions.llm). */
export interface ChatDeps {
  llm?: Pick<LlmClient, 'streamChat'>;
}

/** Лимиты LLM-цикла на один запрос (консервативно: чат — не фаза агента). */
const MAX_LLM_ITERATIONS = 8;
const MAX_WALL_TIME_MS = 120_000;

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
 * fail-closed) + динамический контекст globalSearch по последнему сообщению
 * (поверх шаблона — контекст рантаймовый, в шаблон не выносится).
 */
function buildSystemPrompt(cwd: string, lastUser: string): string {
  const parts: string[] = [loadChatSystemTemplate(cwd)];
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

  if (!hasMessage && !hasApproval) {
    yield { type: 'error', message: 'Пустой запрос: ожидается поле message или approval' };
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
   */
  const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const local = localHandlers.get(name);
    const raw = local ? await local.handler(args) : await handleToolCall(name, args, cwd, { defaultStatus: 'Spec' });
    return truncateToolOutput(raw);
  };
  const started = Date.now();

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
    // VL-256: решение получено — фиксируем в логе (requested без decided = потеря)
    recordApprovalLog(cwd, threadId, {
      event: 'decided',
      toolCallId: target.id,
      tool: target.name,
      turn: currentTurn(),
      approved,
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
    const next = await advanceToNextApproval(history, cwd, threadId, queue, target.id);
    if (next !== null) {
      recordApprovalLog(cwd, threadId, {
        event: 'requested',
        toolCallId: next.id,
        tool: next.name,
      turn: currentTurn(),
      });
      queue.push({ type: 'approval', toolCallId: next.id, name: next.name, args: next.arguments });
      return; // ход снова на паузе: ждём решение по следующему вызову
    }
  } else {
    // Новое сообщение: закрываем висящие approval-хвосты ДО user-сообщения.
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
    if (++iterations > MAX_LLM_ITERATIONS) {
      // VL-256: хвост write-вызовов без результата сделал бы payload невалидным
      // для провайдера — закрываем явным not_confirmed (машиночитаемо, с логом)
      closeUnconfirmedTail(history, cwd, threadId, queue, currentTurn());
      queue.push({
        type: 'error',
        message: `Превышен лимит итераций инструментов (${MAX_LLM_ITERATIONS}) — диалог остановлен`,
      });
      return;
    }
    if (Date.now() - started > MAX_WALL_TIME_MS) {
      closeUnconfirmedTail(history, cwd, threadId, queue, currentTurn());
      queue.push({
        type: 'error',
        message: `Превышено время ответа (${Math.round(MAX_WALL_TIME_MS / 1000)} с) — диалог остановлен`,
      });
      return;
    }

    const system: ChatMessage = {
      role: 'system',
      content: buildSystemPrompt(cwd, lastUserText(history)),
    };

    let resp;
    try {
      resp = await llm.streamChat([system, ...history], tools, {
        onToken: token => queue.push({ type: 'text', delta: token }),
      });
    } catch (err) {
      queue.push({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }

    if (resp.toolCalls.length === 0) {
      // Финальный текст: сохраняем и завершаем ход.
      const assistant: ChatMessage = { role: 'assistant', content: resp.text };
      history.push(assistant);
      appendChatMessages(cwd, threadId, [assistant]);
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
    // операции, VL-219: не по списку имён — isWriteOperation).
    for (const tc of resp.toolCalls) {
      if (isWriteOperation(tc.name)) {
        recordApprovalLog(cwd, threadId, {
          event: 'requested',
          toolCallId: tc.id,
          tool: tc.name,
      turn: currentTurn(),
        });
        queue.push({ type: 'approval', toolCallId: tc.id, name: tc.name, args: tc.arguments });
        return; // состояние уже в jsonl; ждём resume с решением
      }
      queue.push({ type: 'tool_start', id: tc.id, name: tc.name, args: tc.arguments });
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
 * VL-256: продвижение к следующему гейту после решения по одному вызову.
 *
 * Read-only вызовы хвоста хода (search/view/read_file) исполняются сразу —
 * они не требуют подтверждения. Первый встреченный write НЕ закрывается и
 * НЕ исполняется, а возвращается вызывающему: сервер покажет для него
 * отдельный Allow/Deny (последовательные гейты, ref-22 local-runtime.mdx
 * §Approval gates: adapter вызывается заново на каждое решение).
 *
 * @param skipId — id только что обработанного вызова (его результат уже в истории)
 * @returns следующий write-вызов, ожидающий подтверждения, либо null
 */
async function advanceToNextApproval(
  history: ChatMessage[],
  cwd: string,
  threadId: string,
  queue: EventQueue,
  skipId: string,
): Promise<ToolCall | null> {
  for (const tc of pendingToolCalls(history)) {
    if (tc.id === skipId) continue;
    if (isWriteOperation(tc.name)) return tc;
    queue.push({ type: 'tool_start', id: tc.id, name: tc.name, args: tc.arguments });
    let result: string;
    let isError = false;
    try {
      result = truncateToolOutput(await handleToolCall(tc.name, tc.arguments, cwd, { defaultStatus: 'Spec' }));
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
