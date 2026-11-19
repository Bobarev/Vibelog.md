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
import { dirname, join } from 'node:path';
import type { ChatMessage, LlmClient, ToolCall } from '../agent/llm.js';
import { createLlmClient } from '../agent/llm.js';
import { loadApiMode } from '../agent/llm-env.js';
import { loadModels, resolveModelById, validateModelsConfig } from '../core/models.js';
import { globalSearch } from '../core/search.js';
import { formatLessonLine, readChatLessonSettings, readLessonSettings, selectLessonsForText } from '../core/lesson.js';
import { truncateToolOutput } from '../agent/tools.js';
import { handleToolCall } from '../mcp/tools.js';
import { ackDenied, ackError, isUnchangedAck } from '../mcp/tool-result.js';
import { chatToolDefs, isWriteOperation, isInteractiveTool, loadChatSystemTemplate } from './tool-policy.js';
import type { ChatLocalTool } from './tool-policy.js';
// VL-422: внешние MCP-серверы веб-чата — процессный кэш с refcount по тредам
import {
  connectExternalForChat,
  externalChatMcpStatus,
  getExternalSpecs,
  releaseExternalForChat,
  type ExternalChatConnectResult,
} from './external-chat-mcp.js';
// VL-422: конфиг mcpServers для /mcp status — тот же резолв, что у подключения
import { loadExternalMcpServers } from '../agent/external-mcp.js';
import {
  ASK_USER_TOOL,
  answerToolResult,
  cancelledQuestionResult,
  isQuestionExpired,
  parseAskUserArgs,
  questionAskedAt,
  recordQuestionLog,
  validateAnswer,
  type AskUserArgs,
} from './chat-question.js';
import { createCallGuard, formatChatLimitsErrors, resolveChatLimits } from './chat-limits.js';
// VL-402: запись памяти персоны — инструмент memory_remember и команда /memory
import { MEMORY_FORGET_TOOL, MEMORY_REMEMBER_TOOL, runMemoryCommand } from './chat-memory.js';
// VL-409: консультация другой роли — инструмент ask_persona
import { ASK_PERSONA_TOOL, makeAskPersonaTool } from './chat-subagent.js';
import { recordSubagentUsage } from './chat-subagent-usage.js';
import { readSubagentSettings } from '../core/subagents.js';
import {
  acceptDrift,
  checkPricingDrift,
  decideDriftPolicy,
  formatDriftMessage,
  readAcceptedDrift,
  resolvePricingGuard,
  formatPricingGuardErrors,
} from '../core/pricing-guard.js';
import { recordThreadUsage, describeThreadUsage, resolveContextWindow, type ThreadUsageView } from './chat-usage.js';
import {
  findCommand,
  helpText,
  parseCommand,
  unknownCommandText,
  type ParsedCommand,
} from './chat-commands.js';
import {
  buildWireMessages,
  estimateTokens,
  loadChatSummaryTemplate,
  loadCompaction,
  pickTrimIndex,
  resetCompaction,
  resolveChatCompaction,
  resolveTargetTokens,
  saveCompaction,
} from './chat-compaction.js';
import {
  createTurnToolGuard,
  duplicateCallResult,
  limitCallResult,
  unchangedRepeatCallResult,
  resolveChatMaxToolCalls,
  type ToolGuardStats,
} from './tool-dedup.js';
import { analyzeToolRepeats, type RepeatStats } from '../agent/repeat-tracker.js';
import {
  DEFAULT_PERSONA_ID,
  loadPersonaMemory,
  loadPersonaPrompt,
  resolveDefaultStatus,
  resolvePersona,
} from './personas.js';
import type { PersonaConfig } from './personas.js';
import { checkSupervisorGrant } from './supervisor-grant.js';
import { resolveSupervisorRuntime } from '../core/supervisor-config.js';
import type { SupervisorGrantPreview } from './supervisor.js';
import { supervisorGrantPreview } from '../mcp/supervisor.js';
import {
  createChatRun,
  finishChatRun,
  getChatRun,
  pushChatRunEvent,
  readTurnState,
  reapStaleChatRuns,
  resetOrphanedRuns,
  STALE_RUN_ERROR,
  STALE_RUN_IDLE_MS,
  subscribeChatRun,
  writeTurnState,
  type ChatRun,
  type TurnStatus,
} from './chat-runs.js';

/**
 * VL-332: «осиротевшие» ходы (сервер перезапустили посреди хода) — sidecar
 * остался `running`, живого прогона нет. Переводим в `interrupted`, чтобы UI
 * не показывал вечный индикатор. Вызывается при старте web-сервера.
 *
 * VL-406: тем же проходом лечим зависшие ходы, у которых давно не было
 * событий (продюсер умер, не записав финал) — иначе `running` висел бы вечно.
 */
export function resetOrphanedChatRuns(cwd: string): string[] {
  const fixed = resetOrphanedRuns(cwd);
  const reaped = reapStaleChatRuns(cwd);
  return [...new Set([...fixed, ...reaped])];
}

/**
 * VL-332: состояние хода треда для `GET /api/chat/threads/:id`.
 *
 * VL-406: чтение — ещё и ленивая проверка сторожа. Живой процесс не имеет
 * отдельного таймера, поэтому зависший `running` чинится именно здесь: клиент
 * опрашивает этот роут каждые 2 с, и на первом же опросе после порога
 * молчания получает `interrupted` с причиной «ход не отвечает» (AC4).
 */
export function chatTurnState(cwd: string, threadId: string): ReturnType<typeof readTurnState> {
  const state = readTurnState(cwd, threadId);
  if (state === null || state.status !== 'running') return state;
  const now = Date.now();
  const live = getChatRun(threadId);
  if (live !== null && !live.done) {
    // Прогон в реестре: свежесть берём из памяти (точнее, чем sidecar)
    if (now - live.lastEventAt < STALE_RUN_IDLE_MS) return state;
    finishChatRun(live, 'interrupted', STALE_RUN_ERROR);
    return readTurnState(cwd, threadId);
  }
  const lastAt = Date.parse(state.lastEventAt ?? state.startedAt);
  if (Number.isFinite(lastAt) && now - lastAt < STALE_RUN_IDLE_MS) return state;
  const fixed = {
    ...state,
    status: 'interrupted' as const,
    finishedAt: new Date(now).toISOString(),
    error: STALE_RUN_ERROR,
  };
  writeTurnState(cwd, threadId, fixed);
  return fixed;
}


/**
 * VL-317: дописывает строку в журнал решений по цене треда (AC6/AC7).
 *
 * Отдельный файл (`<threadId>.pricing.log`), а не jsonl истории: решения по
 * цене — диагностика для человека, они не должны попадать в контекст модели
 * (иначе каждый следующий ход «видел» бы старые предупреждения).
 */
export function appendDriftLog(cwd: string, threadId: string, text: string): void {
  try {
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${threadId}.pricing.log`), `${new Date().toISOString()} ${text}\n`, 'utf-8');
  } catch {
    // Нет прав/диска — журнал не критичен: предупреждение уже ушло в ленту
  }
}

/** SSE-событие чата (data-строка — JSON с полем type). */
export type ChatEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown>; auto?: boolean }
  | { type: 'tool_end'; id: string; result: string; isError?: boolean }
  | { type: 'approval'; toolCallId: string; name: string; args: Record<string, unknown>; grant?: SupervisorGrantPreview }
  /**
   * VL-330: интерактивный вопрос `ask_user` — ход на паузе до ответа
   * пользователя. Клиент рендерит карточку вопроса и возобновляет ход
   * запросом с полем `answer`.
   */
  | {
      type: 'question';
      toolCallId: string;
      question: string;
      options: { id: string; label: string; description?: string }[];
      allowCustom: boolean;
    }
  | { type: 'done' }
  | { type: 'error'; message: string }
  /**
   * VL-402: модель записала предпочтение пользователя в память роли.
   * Запись уже применена (Allow/Deny не спрашивали — она обратима), клиент
   * показывает в ленте строку «Запомнил: …» с кнопкой «Убрать».
   */
  | {
      type: 'memory';
      entry: { index: number; text: string; date: string };
      /** id роли, в чью память записали (AC6: только роль треда). */
      personaId: string;
      /** VL-419: метка роли для карточки (консультант не роль треда). */
      personaLabel?: string;
    }
  /**
   * VL-409: консультация другой роли (`ask_persona`) завершена. Клиент
   * рендерит её как обычный tool-call с раскрытием (display: inline) либо
   * карточкой (display: widget).
   */
  | {
      type: 'subagent';
      personaId: string;
      personaLabel: string;
      question: string;
      answer: string;
      tokens: { input: number; output: number; total: number };
      /** VL-409: как показывать в ленте (`inline` — раскрываемый вызов, `widget` — карточка). */
      display: 'inline' | 'widget';
      /** VL-415: ответ обрезан по `subagents.max_answer_chars`. */
      truncated?: boolean;
      /** VL-415: длина полного ответа до обрезки (символов). */
      answerChars?: number;
      /** VL-415: консультант исчерпал итерации — ответ частичный. */
      partial?: boolean;
      /** VL-415: инструменты, которые консультант успел вызвать. */
      usedTools?: string[];
      /** VL-419: записи в память КОНСУЛЬТАНТА (сервер из ЗАПОМНИТЬ: строк). */
      memory?: Array<{ index: number; text: string; date: string }>;
      /** VL-419: отказы записи (дубль/лимит) — консультация при этом успешна. */
      memorySkipped?: Array<{ text: string; reason: string }>;
    }
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
    }
  /**
   * VL-317: цена вендора разошлась с каталогом (или сверка невозможна).
   *
   * `kind: 'ask'` — ход НЕ начинается: карточка в ленте предлагает
   * «Продолжить» (расхождение принимается) или «Перейти на <вендор>».
   * `kind: 'warn'` — ход продолжается, в ленте остаётся предупреждение.
   * `kind: 'auto'` — вендор переключён автоматически (AC6), ход продолжается.
   */
  | {
      type: 'pricing';
      kind: 'ask' | 'warn' | 'auto';
      state: 'ok' | 'drift' | 'unknown';
      message: string;
      model?: string;
      vendor?: string;
      /** Альтернативный вендор для кнопки «Перейти на …» (AC5). */
      alternative?: string;
      /** Максимальное отклонение, проценты (для принятия расхождения). */
      maxDeltaPercent?: number;
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
   * VL-330: ответ на интерактивный вопрос `ask_user`. Ровно одно из
   * `optionId`/`custom`; `optionId` обязан быть среди предложенных, `custom`
   * допустим только при `allow_custom !== false`.
   */
  answer?: { toolCallId?: unknown; optionId?: unknown; custom?: unknown };
  /**
   * VL-269: продолжить ход без нового user-сообщения — так клиент реагирует
   * на событие `truncated`. История jsonl не меняется (пустой строки в
   * треде не появляется), LLM-цикл стартует по уже накопленным сообщениям.
   */
  continue?: unknown;
  /**
   * VL-406: повтор последнего хода без нового user-сообщения — кнопка
   * «Повторить» у плашки исхода (пустой ответ, ошибка, прерванный ход).
   * Семантика та же, что у `continue`: jsonl не получает дубль user-строки,
   * LLM-цикл стартует по уже накопленной истории.
   */
  retry?: unknown;
  /**
   * VL-317: ответ на карточку дрейфа цены. `pricingAck: true` — «Продолжить»
   * (расхождение принимается и запоминается для треда);
   * `pricingVendor` — «Перейти на <вендор>»: явный вендор для этого хода
   * (уходит в wire-запрос `provider.order`).
   */
  pricingAck?: unknown;
  pricingVendor?: unknown;
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
 * VL-431: серверная подстановка контекста треда в `interbot_ask` (AC1).
 *
 * Модель не участвует: `thread_id`/`tool_call_id` дописываются в args ПОСЛЕ
 * всех guard'ов (дедуп/grant/роль считают args модели как есть — их ключи не
 * меняются), схема инструмента не меняется. Без `thread_id` вызывающая
 * сторона получает прежние args — поведение MCP-пути не меняется (AC2).
 *
 * Чистая функция — юнит-тесты подстановки без запуска хода.
 *
 * @param toolCallId — id текущего tool_call хода (для записи в контекст тикета)
 */
export function interbotThreadArgs(
  name: string,
  args: Record<string, unknown>,
  threadId: string,
  toolCallId?: string,
): Record<string, unknown> {
  if (name !== 'interbot_ask' || threadId === '') return args;
  return {
    ...args,
    thread_id: threadId,
    ...(toolCallId !== undefined && toolCallId !== '' ? { tool_call_id: toolCallId } : {}),
  };
}

/**
 * VL-431: дописка в конец истории треда позднего interbot-ответа (AC3).
 *
 * Валидная у всех провайдеров структура — виртуальная пара
 * assistant(tool_calls: [{id: async-<ticketId>, name: interbot_ask}]) →
 * tool(tool_call_id, content): role 'tool' допустим только как ответ на
 * assistant с tool_calls, поэтому пара пишется ОДНОЙ записью appendChatMessages.
 * Старые закрытые tool_call_id не переиспользуются.
 *
 * Хвост с pending tool_calls (approval-пауза) закрывается синтетикой ДО
 * дописки — иначе провайдер отклонит payload (assistant→assistant без
 * tool-результата, lesson-74: валидация пары до записи).
 *
 * @returns true — пара дописана; false — тред не найден/id пуст (файл не тронут)
 */
export function appendLateInterbotPair(
  cwd: string,
  threadId: string,
  ticketId: string,
  content: string,
): boolean {
  if (ticketId.trim() === '') return false;
  const history = getChatThread(cwd, threadId);
  if (history === null) return false;
  // Закрыть висящие tool_calls хвоста синтетикой — иначе провайдер отклонит
  const closed = closePendingToolCalls(history);
  if (closed > 0) appendChatMessages(cwd, threadId, history.slice(-closed));
  const callId = `async-${ticketId}`;
  appendChatMessages(cwd, threadId, [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: callId, name: 'interbot_ask', arguments: {} }],
    },
    { role: 'tool', tool_call_id: callId, content },
  ]);
  return true;
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
  /**
   * VL-326: сколько исполненных вызовов вернули noop-ответ («изменений нет»).
   * Расширение аддитивное — старые читатели файла не ломаются.
   */
  noop?: number;
  /** VL-326: сколько вызовов заблокировано исчерпанием noop-серии. */
  noop_blocked?: number;
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
 * Флаг внешних MCP-серверов треда (VL-422): ключ `mcp` в ТОМ ЖЕ sidecar,
 * где живёт роль (`<threadId>.persona.json`). true — тред держит единицу
 * refcount кэша (external-chat-mcp) и видит внешние инструменты в
 * chatToolDefs. Пишется только командой `/mcp on|off`; по умолчанию false —
 * проект без mcpServers и треды до VL-422 ничего не платят.
 */
export function readThreadMcp(cwd: string, threadId: string): boolean {
  if (!THREAD_ID_RE.test(threadId)) return false;
  const file = personaFile(cwd, threadId);
  if (!existsSync(file)) return false;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return (raw as { mcp?: unknown } | null)?.mcp === true;
  } catch {
    // битый sidecar — флаг выключен (тред продолжит работать)
    return false;
  }
}

/**
 * Записать флаг внешних MCP-серверов треда, сохранив остальные ключи
 * sidecar (persona/fixedAt). Сбой чтения/записи не рвёт ход — тот же
 * паттерн, что у fixThreadPersona/saveThreadAllowList.
 */
export function setThreadMcp(cwd: string, threadId: string, value: boolean): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    const file = personaFile(cwd, threadId);
    let data: Record<string, unknown> = {};
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } else {
      mkdirSync(chatSessionsDir(cwd), { recursive: true });
    }
    if (value) data.mcp = true;
    else delete data.mcp;
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch {
    // сбой sidecar не должен рвать диалог
  }
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
      // VL-330: неотвеченный вопрос — не «отказ в записи», а отсутствие ответа:
      // модель должна задать вопрос заново, а не решить, что получила решение.
      content: isInteractiveTool(tc.name)
        ? cancelledQuestionResult('cancelled')
        : ackDenied('denied', { tool: tc.name, fields: Object.keys(tc.arguments ?? {}) }),
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

/** Предел текста разговора для recall уроков (VL-404): ~2000 символов. */
const CONVERSATION_TEXT_MAX_CHARS = 2000;

/**
 * Минимальный score урока для блока `## Уроки проекта` (VL-404).
 *
 * 3 = одно совпадение в title (вес title в `scoreLessonForTask`). Без порога
 * `scoreLessonForTask` без И-логики цепляет урок по одному общему слову
 * («файл», «тест») — на 270+ уроках это шум в каждом ходе чата.
 */
const CHAT_LESSON_MIN_SCORE = 3;

/**
 * Склеивает последние user-сообщения треда в текст-запрос для recall уроков
 * (VL-404).
 *
 * Берутся только сообщения пользователя: вопрос — сигнал о теме, ответ
 * модели — шум (в нём уже пересказаны найденные уроки, и recall начал бы
 * подкреплять сам себя). Порядок — от старых к новым, чтобы при обрезке по
 * длине осталось самое свежее.
 *
 * @param history — история треда
 * @param maxMessages — сколько последних user-сообщений брать
 */
export function recentConversationText(history: ChatMessage[], maxMessages: number): string {
  const limit = Math.max(0, Math.floor(maxMessages));
  if (limit === 0) return '';
  const picked: string[] = [];
  for (let i = history.length - 1; i >= 0 && picked.length < limit; i--) {
    const m = history[i]!;
    if (m.role !== 'user') continue;
    const text = String(m.content || '').trim();
    if (text) picked.push(text);
  }
  // Обрезка по длине: иначе токенов в запросе больше, чем в самом уроке.
  // Режем с начала (старое), сохраняя хвост — свежий вопрос важнее.
  const joined = picked.reverse().join(' ');
  return joined.length > CONVERSATION_TEXT_MAX_CHARS
    ? joined.slice(joined.length - CONVERSATION_TEXT_MAX_CHARS)
    : joined;
}

/**
 * Ссылка на AGENTS.md проекта для системного промпта веб-чата (VL-405).
 *
 * В TUI-агенте и headless-фазах AGENTS.md вставляется в промпт целиком
 * (`src/agent/system-prompt.ts`, кап `AGENTS_MD_MAX_CHARS` = 8000). В чате
 * так делать нельзя: ход интерактивный и повторяется, 8000 символов в каждом
 * запросе — дорого, а правила проекта нужны далеко не в каждом вопросе.
 * Поэтому здесь — только ссылка: модель сходит за файлом через `read_file`
 * (read-операция, подтверждения не требует), когда вопрос действительно про
 * правила. Формулировка императивная: без «прочитай» блок бесполезен —
 * модель не догадается, что за файлом надо идти.
 *
 * Отсутствие файла — норма (null, блока нет). Прочие ошибки чтения
 * (EACCES, EISDIR) — тоже null, но с предупреждением в stderr: чат не
 * роняем, паттерн `src/agent/system-prompt.ts`.
 *
 * @param cwd — рабочая директория проекта (корень, где лежит AGENTS.md)
 * @returns блок `## Правила проекта` либо null, если файла нет/не читается
 */
export function describeAgentsMd(cwd: string): string | null {
  const path = join(cwd, 'AGENTS.md');
  let chars: number;
  try {
    // statSync отделяет «файла нет» (норма) от «файл есть, но не читается»;
    // длину берём из прочитанного текста, а не из размера в байтах: для
    // русского AGENTS.md байты заметно больше символов, и «N символов»
    // вводило бы в заблуждение.
    statSync(path);
    chars = readFileSync(path, 'utf-8').length;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.error(
        `Предупреждение: AGENTS.md не прочитан (${code ?? (err as Error).message}) — чат-промпт без ссылки на правила проекта`,
      );
    }
    return null;
  }
  return (
    '## Правила проекта\n\n' +
    `В корне проекта есть AGENTS.md (${chars} символов) — соглашения по сборке, тестам и стилю кода.\n` +
    'Прочитай его через read_file, если вопрос касается правил проекта. В промпт он не вставлен.'
  );
}

/**
 * System-сообщение: статическая часть из шаблона (VL-219: переопределение
 * .vibelog/prompts/chat-system.md → templates/prompts/chat-system.md,
 * fail-closed) + блок роли (VL-265: общая часть не дублируется в файлах
 * ролей, роль идёт отдельным блоком) + память персоны (VL-401) + уроки
 * проекта по смыслу разговора (VL-404) + ссылка на AGENTS.md (VL-405) +
 * динамический контекст globalSearch по последнему сообщению (всегда
 * последним — он рантаймовый).
 *
 * VL-401: память читается ТОЛЬКО здесь, в чат-сборке. Headless-фазы и
 * TUI-агент собирают промпт через src/agent/system-prompt.ts и памяти не
 * видят (инвариант закреплён тестом от обратного, как VL-238/lesson-134).
 *
 * VL-404: блок `## Уроки проекта` — тоже только здесь. Уроки подбираются
 * `selectLessonsForText` по последним user-сообщениям треда (recall по
 * смыслу, VL-400), а не подстрочным поиском по одному сообщению: вопрос
 * «почему падает сборка фронта» находит урок про `pnpm install` в `web/`,
 * хотя слова «pnpm» в вопросе нет.
 *
 * VL-405: `## Правила проекта` — ссылка на AGENTS.md, а не его текст
 * (см. `describeAgentsMd`). Порядок блоков важен: контекст поиска всегда
 * последний, потому что он рантаймовый и меняется каждый ход.
 */
function buildSystemPrompt(cwd: string, history: ChatMessage[], persona: PersonaConfig): string {
  const parts: string[] = [
    loadChatSystemTemplate(cwd),
    `## Текущая роль: ${persona.label}\n\n${loadPersonaPrompt(cwd, persona)}`,
  ];
  // Пустая/отсутствующая память — блок не добавляется вовсе: «(пусто)» в
  // каждом ходе было бы лишним шумом. Ошибки чтения/лимита уже собраны
  // реестром ролей (GET /api/personas) — здесь они не нужны.
  const memory = loadPersonaMemory(cwd, persona);
  if (memory.text) {
    parts.push(`## Память персоны\n\n${memory.text}`);
  }
  // VL-404: уроки проекта по смыслу разговора. Пустой результат — блока нет
  // (как и у памяти): заголовок без строк только занимает промпт.
  const chatLessons = readChatLessonSettings(cwd);
  if (chatLessons.enabled) {
    const conversation = recentConversationText(history, chatLessons.maxMessages);
    if (conversation) {
      // AC2: кап — `lessons.prompt_limit` (общий бюджет подстановки уроков),
      // но не больше `chat_lessons.limit`: у чата свой, более узкий бюджет
      // промпта (память персоны + контекст поиска). Берём минимум из двух.
      const promptLimit = readLessonSettings(cwd).promptLimit;
      const lessons = selectLessonsForText(cwd, conversation, {
        limit: Math.min(chatLessons.limit, promptLimit),
        // Порог: одно общее слово («файл», «тест») не должно вытаскивать
        // нерелевантный урок — на 270+ уроках это шум в каждом ходе.
        minScore: CHAT_LESSON_MIN_SCORE,
      });
      if (lessons.length) {
        parts.push(`## Уроки проекта\n\n${lessons.map(formatLessonLine).join('\n')}`);
      }
    }
  }
  // VL-405: ссылка на AGENTS.md — после уроков и до контекста поиска.
  // Именно ссылка, не текст: вставка 8000 символов в каждый ход чата дорога
  // и почти всегда нерелевантна (см. describeAgentsMd).
  const agentsMd = describeAgentsMd(cwd);
  if (agentsMd) parts.push(agentsMd);
  const lastUser = lastUserText(history);
  if (lastUser.trim()) {
    const hits = globalSearch(cwd, lastUser.trim());
    // VL-404: уроки из globalSearch убраны намеренно — они уже пришли блоком
    // `## Уроки проекта` (recall по смыслу разговора). Оставлять оба
    // представления нельзя: модель получила бы один урок дважды, разными
    // формулировками, и не поняла бы, какому верить.
    const context = {
      tasks: hits.tasks.slice(0, 5),
      references: hits.references.slice(0, 3),
      documents: hits.documents.slice(0, 3),
      // VL-412: архитектурные решения — чтобы агент не предлагал отвергнутое
      decisions: hits.decisions.slice(0, 3),
    };
    const hasContext =
      context.tasks.length || context.references.length || context.documents.length ||
      context.decisions.length;
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
 * VL-332: ход больше не живёт внутри запроса — `runChat` лишь ПОДПИСЫВАЕТСЯ
 * на прогон из реестра (`chat-runs.ts`) и отдаёт его события. Обрыв потока
 * (пользователь переключил тред → fetch абортился) прогон не убивает:
 * `finally` только отписывается, продюсер дописывает jsonl и завершает
 * sidecar сам. Повторный запрос по тому же треду джойнится к идущему ходу.
 *
 * @param body — тело POST /api/chat (message | approval | answer | continue)
 * @param cwd — рабочая директория проекта (backlog/, .vibelog/)
 * @param deps — injectable LLM для тестов; без него — createLlmClient() из env
 * @param since — с какого абсолютного индекса событий начинать (переподключение)
 */
export async function* runChat(
  body: ChatRequestBody,
  cwd: string,
  deps: ChatDeps = {},
  since = 0,
): AsyncGenerator<ChatEvent> {
  const started = startChatRun(body, cwd, deps);
  if ('error' in started) {
    yield { type: 'error', message: started.error };
    return;
  }
  // VL-332: ход живёт в реестре прогонов — генератор лишь подписывается на
  // его события. Обрыв потребителя (переключение треда, F5) прогон не убивает.
  yield* runEvents(started.run, since);
}

/**
 * Дренаж событий прогона в генератор (VL-332): общая часть `runChat` и
 * `streamChatRun`. Флаг `notified` закрывает гонку «событие пришло между
 * проверкой буфера и установкой wake».
 */
async function* runEvents(run: ChatRun, since: number): AsyncGenerator<ChatEvent> {
  const pending: ChatEvent[] = [];
  let wake: (() => void) | null = null;
  let notified = false;
  const unsubscribe = subscribeChatRun(run, since, ev => {
    pending.push(ev);
    notified = true;
    wake?.();
  });
  try {
    for (;;) {
      while (pending.length) yield pending.shift()!;
      if (run.done) return;
      notified = false;
      await new Promise<void>(resolve => {
        wake = () => {
          wake = null;
          resolve();
        };
        if (notified) wake();
      });
    }
  } finally {
    // Потребитель ушёл — прогон продолжает работать (ключ к AC1/AC2)
    unsubscribe();
  }
}

/**
 * Переподключение к идущему ходу без старта нового (VL-332).
 *
 * Отличие от `runChat`: тело запроса не нужно, прогон НЕ создаётся. Если
 * живого прогона нет — пустой поток (роут отвечает 404/просто закрывает SSE).
 */
export async function* streamChatRun(
  threadId: string,
  since = 0,
): AsyncGenerator<ChatEvent> {
  const run = getChatRun(threadId);
  if (run === null) return;
  yield* runEvents(run, since);
}

/**
 * Запустить ход треда (или присоединиться к идущему) и отдать объект прогона.
 *
 * Джойн защищает от двух LLM-циклов в одном треде (две вкладки, повторный
 * POST после таймаута): второй запрос получает тот же прогон и дочитывает
 * его события с индекса `since` (AC5 — без дублей).
 */
export function startChatRun(
  body: ChatRequestBody,
  cwd: string,
  deps: ChatDeps = {},
): { run: ChatRun } | { error: string } {
  // --- валидация threadId ---------------------------------------------------
  const rawThreadId = body.threadId;
  let threadId: string;
  if (rawThreadId === undefined || rawThreadId === null || rawThreadId === '') {
    threadId = createThreadIds();
  } else if (typeof rawThreadId === 'string' && THREAD_ID_RE.test(rawThreadId)) {
    threadId = rawThreadId;
  } else {
    return { error: 'Некорректный threadId: допустимы [a-zA-Z0-9_-] до 64 символов' };
  }

  const rawMessage = body.message;
  const hasMessage = typeof rawMessage === 'string' && rawMessage.trim().length > 0;
  const approval = body.approval;
  const hasApproval =
    !!approval &&
    typeof approval.toolCallId === 'string' &&
    typeof approval.approved === 'boolean';
  // VL-330: ответ на вопрос — ещё одна форма resume (проверка содержимого
  // ответа живёт в produce: нужны история треда и предложенные варианты).
  const hasAnswer = !!body.answer && typeof body.answer.toolCallId === 'string';

  if (!hasMessage && !hasApproval && body.continue !== true && body.retry !== true && !hasAnswer) {
    return { error: 'Пустой запрос: ожидается поле message, approval, answer, continue или retry' };
  }

  // Идущий ход этого треда — присоединяемся, второй LLM-цикл не запускаем
  const existing = getChatRun(threadId);
  if (existing && !existing.done) return { run: existing };

  const run = createChatRun(threadId, cwd);
  const controller = new AbortController();
  run.cancel = () => controller.abort();
  void driveChat(body, cwd, threadId, deps, run, controller.signal);
  return { run };
}

/**
 * Драйвер прогона: продюсер `produce` → буфер событий реестра.
 *
 * Не зависит от потребителя (главное отличие от прежней реализации): даже
 * если SSE-клиент отвалился, цикл доходит до конца, а jsonl получает все
 * сообщения (AC1/AC2).
 */
async function driveChat(
  body: ChatRequestBody,
  cwd: string,
  threadId: string,
  deps: ChatDeps,
  run: ChatRun,
  signal: AbortSignal,
): Promise<void> {
  pushChatRunEvent(run, { type: 'thread', threadId });
  const queue = new EventQueue();
  const task = produce(body, cwd, threadId, deps, queue, signal)
    .catch(err => {
      queue.push({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => queue.close());

  let lastError: string | undefined;
  /**
   * VL-406: был ли в ходе хоть какой-то видимый результат. Пустой ответ
   * модели (ни текста, ни tool-вызовов) раньше завершался молчаливым `done`:
   * индикатор гас, в jsonl ничего не появлялось, ошибки не было — со стороны
   * это выглядело как «ничего не произошло». Теперь такой ход получает
   * явный статус `empty`, и клиент показывает плашку с кнопкой повтора.
   *
   * Пауза на подтверждении/вопросе — тоже результат (карточка в ленте),
   * поэтому `approval`/`question` считаются содержимым хода.
   */
  let hadContent = false;
  try {
    for (;;) {
      const ev = await queue.next();
      if (ev === null) break;
      if (ev.type === 'error') lastError = ev.message;
      if (
        (ev.type === 'text' && ev.delta.trim() !== '') ||
        ev.type === 'tool_start' ||
        ev.type === 'tool_end' ||
        ev.type === 'approval' ||
        ev.type === 'question' ||
        ev.type === 'truncated'
      ) {
        hadContent = true;
      }
      pushChatRunEvent(run, ev);
    }
  } finally {
    await task;
    // Отмена пользователем важнее error-события, которое она породила
    const status: TurnStatus = signal.aborted && run.status === 'running'
      ? 'cancelled'
      : lastError !== undefined
        ? 'error'
        : hadContent
          ? 'done'
          : 'empty';
    finishChatRun(
      run,
      status,
      status === 'cancelled'
        ? 'Ход остановлен пользователем'
        : status === 'empty'
          ? 'модель вернула пустой ответ'
          : lastError,
    );
  }
}

/** Продюсер: вся логика хода в живой очереди событий. */
async function produce(
  body: ChatRequestBody,
  cwd: string,
  threadId: string,
  deps: ChatDeps,
  queue: EventQueue,
  /** VL-332: сигнал отмены прогона (кнопка «Остановить», `cancel`-роут). */
  signal?: AbortSignal,
): Promise<void> {
  // VL-317: новый ход (не resume/continue) — точка сверки цены
  const hasMessage =
    typeof body.message === 'string' && (body.message as string).trim().length > 0;

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
  // VL-314: создание клиента вынесено в функцию — его использует и LLM-цикл,
  // и команда /compact (LLM-саммари). Ошибки конфигурации возвращаются
  // текстом: вызывающий сам решает, отдать их error-событием или ответом
  // команды (команда не должна ронять ход).
  let llm: Pick<LlmClient, 'streamChat'> | undefined = deps.llm;
  /**
   * VL-317: вендор, выбранный политикой `on_drift='auto'` (AC6). Передаётся
   * в createLlmClient как `vendor` — уходит в wire-запрос `provider.order`
   * (VL-315), формат запроса при этом не меняется (риск R4).
   */
  let vendorOverride: string | undefined;
  /** Принятое автоматически расхождение — фиксируется в sidecar треда. */
  let driftAcceptedPercent: number | undefined;
  const ensureLlm = (): { ok: true; client: Pick<LlmClient, 'streamChat'> } | { ok: false; error: string } => {
    if (llm) return { ok: true, client: llm };
    // VL-209: переопределение модели из body (id из models.available) —
    // валидация до создания клиента; строка обязательна
    let bodyModel: string | undefined;
    if (body.model !== undefined) {
      if (typeof body.model !== 'string' || body.model === '') {
        return { ok: false, error: 'Некорректная модель: ожидается строка id из models.available' };
      }
      bodyModel = body.model;
      if (resolveModelById(cwd, bodyModel) === null) {
        return { ok: false, error: `Неизвестная модель: ${bodyModel} — отсутствует в models.available settings.json` };
      }
    }
    // Models-путь (VL-209): секции настроены — валидируем их; fallback
    // (нет секции models) — СТАРОЕ поведение и старые тексты дословно
    // (их матчат chat.test.mjs)
    const hasModelsSection = Object.keys(loadModels(cwd).available).length > 0;
    if (!hasModelsSection && !process.env.VIBELOG_LLM_API_KEY) {
      return {
        ok: false,
        error:
          'Ошибка: не задан VIBELOG_LLM_API_KEY — чату нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)',
      };
    }
    if (!hasModelsSection && !process.env.VIBELOG_LLM_MODEL) {
      return { ok: false, error: 'Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна' };
    }
    if (hasModelsSection) {
      const errors = validateModelsConfig(cwd);
      if (errors.length > 0) {
        return { ok: false, error: errors.map(err => `Ошибка: ${err}`).join('\n') };
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
        // VL-317: вендор, выбранный политикой on_drift='auto' (AC6) —
        // приоритетнее vendor модели из settings (VL-315)
        ...(vendorOverride !== undefined ? { vendor: vendorOverride } : {}),
      });
      return { ok: true, client: llm };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  // --- слэш-команды (VL-314) ------------------------------------------------
  // Перехват ДО history.push({role:'user'}) и до LLM-цикла: текст команды
  // не попадает ни в jsonl, ни в модель. Ответ отдаётся обычными событиями
  // text + done — клиент рендерит его как сообщение ассистента.
  if (typeof body.message === 'string' && body.message.trim().length > 0) {
    const parsed = parseCommand(body.message);
    if (parsed !== null) {
      const refusal = commandRefusal(cwd, threadId, history);
      if (refusal !== null) {
        queue.push({ type: 'text', delta: refusal });
        queue.push({ type: 'done' });
        return;
      }
      const command = findCommand(parsed.name);
      if (command === null) {
        queue.push({ type: 'text', delta: unknownCommandText(parsed.name) });
        queue.push({ type: 'done' });
        return;
      }
      const result = await runChatCommand(parsed, {
        cwd,
        threadId,
        history,
        persona: activePersona,
        ensureLlm,
        usageModelId: typeof body.model === 'string' && body.model !== '' ? body.model : loadModels(cwd).default,
        queue,
      });
      queue.push({ type: 'text', delta: result.text });
      queue.push({ type: 'done' });
      return;
    }
  }

  const llmReady = ensureLlm();
  if (!llmReady.ok) {
    queue.push({ type: 'error', message: llmReady.error });
    return;
  }
  llm = llmReady.client;

  // --- сверка цены вендора с каталогом (VL-317) ----------------------------
  // Проверка идёт ПЕРЕД ходом и только для нового сообщения (не для resume
  // approval и не для авто-продолжения: там решение уже принято, а лишний
  // вопрос посреди работы — это ровно то, чего просили избежать).
  // Кэш сверки (pricing_guard.catalog_ttl_minutes) не даёт сети на каждый ход.
  if (hasMessage) {
    const guardConfig = resolvePricingGuard(cwd);
    if (guardConfig.errors.length > 0) console.error(formatPricingGuardErrors(guardConfig.errors));
    if (guardConfig.config.enabled) {
      const overrideId = typeof body.model === 'string' && body.model !== '' ? body.model : undefined;
      if (body.pricingAck === true) {
        // Ответ на карточку дрейфа: «Продолжить» (согласие с расхождением)
        // и/или «Перейти на <вендор>». Расхождение фиксируется в sidecar
        // треда, чтобы следующие ходы не спрашивали то же самое.
        const drift = await checkPricingDrift(cwd, overrideId);
        if (drift.state === 'drift' && drift.modelId !== undefined) {
          acceptDrift(cwd, threadId, drift.modelId, drift.maxDeltaPercent);
          appendDriftLog(cwd, threadId, `accepted: ${formatDriftMessage(drift)}`);
        }
        if (typeof body.pricingVendor === 'string' && body.pricingVendor !== '') {
          vendorOverride = body.pricingVendor;
          appendDriftLog(cwd, threadId, `switch: вендор ${body.pricingVendor}`);
        }
      } else {
        const drift = await checkPricingDrift(cwd, overrideId);
        const accepted = readAcceptedDrift(cwd, threadId);
        const action = decideDriftPolicy(guardConfig.config, drift, accepted);
        if (action.kind === 'block') {
          // AC10: offline='block' — отказ с понятным текстом, ход не начинается
          queue.push({ type: 'error', message: action.message });
          return;
        }
        if (action.kind === 'proceed') {
          if (action.warning !== undefined) {
            appendDriftLog(cwd, threadId, `warn: ${action.warning}`);
            queue.push({
              type: 'pricing',
              kind: 'warn',
              state: drift.state,
              message: action.warning,
              ...(drift.modelId !== undefined ? { model: drift.modelId } : {}),
              ...(drift.vendor !== undefined ? { vendor: drift.vendor } : {}),
              ...(drift.maxDeltaPercent !== 0 ? { maxDeltaPercent: drift.maxDeltaPercent } : {}),
            });
          }
        } else if (action.kind === 'auto') {
          // AC6: автопереезд на другого вендора в рамках того же хода —
          // переключение обязательно остаётся в журнале треда (риск R4)
          appendDriftLog(cwd, threadId, `auto: ${action.message}`);
          vendorOverride = action.vendor;
          driftAcceptedPercent = drift.maxDeltaPercent;
          if (drift.modelId !== undefined) {
            acceptDrift(cwd, threadId, drift.modelId, drift.maxDeltaPercent);
          }
          queue.push({
            type: 'pricing',
            kind: 'auto',
            state: drift.state,
            message: action.message,
            ...(drift.modelId !== undefined ? { model: drift.modelId } : {}),
            ...(drift.vendor !== undefined ? { vendor: drift.vendor } : {}),
            alternative: action.vendor,
            maxDeltaPercent: drift.maxDeltaPercent,
          });
        } else {
          // AC5: 'ask' (в т.ч. деградация auto→ask, AC8) — ход НЕ начинается,
          // карточка предлагает «Продолжить» или «Перейти на <вендор>»
          appendDriftLog(cwd, threadId, `ask: ${action.message}`);
          queue.push({
            type: 'pricing',
            kind: 'ask',
            state: drift.state,
            message: action.message,
            ...(drift.modelId !== undefined ? { model: drift.modelId } : {}),
            ...(drift.vendor !== undefined ? { vendor: drift.vendor } : {}),
            ...(drift.alternative !== undefined ? { alternative: drift.alternative.vendor } : {}),
            maxDeltaPercent: drift.maxDeltaPercent,
          });
          queue.push({ type: 'done' });
          return;
        }
      }
    }
  }
  // Вендор переключён политикой — клиент создаём заново с явным вендором
  if (vendorOverride !== undefined) {
    llm = undefined;
    const rebuilt = ensureLlm();
    if (!rebuilt.ok) {
      queue.push({ type: 'error', message: rebuilt.error });
      return;
    }
    llm = rebuilt.client;
  }
  void driftAcceptedPercent;

  // VL-422: внешние MCP-инструменты подключаются только по `/mcp on` — флаг
  // треда в sidecar; без него (и без соединения в кэше) список пуст,
  // поведение проекта без mcpServers не меняется.
  const externalTools = readThreadMcp(cwd, threadId) ? getExternalSpecs(cwd) : [];
  const tools = chatToolDefs(cwd, activePersona, externalTools);
  // VL-409: консультации другой роли. Счётчик живёт в пределах хода (лимит
  // `subagents.max_calls_per_turn`), настройки читаются один раз — битые
  // значения дают дефолты и сообщение в лог сервера, чат не падает (AC7).
  const subagentErrors: string[] = [];
  const subagentSettings = readSubagentSettings(cwd, subagentErrors);
  if (subagentErrors.length > 0) {
    console.error(`[subagents] конфигурация: ${subagentErrors.join('; ')}`);
  }
  const subagentCounter = { calls: 0 };
  // Локальные инструменты (read_file/write_file) имеют handler в chat-tool
  // (их нет в MCP-реестре) — карта для маршрутизации ниже (VL-219)
  const localHandlers = new Map<string, ChatLocalTool>(
    tools.filter((t): t is ChatLocalTool => 'handler' in t).map(t => [t.name, t]),
  );
  // VL-409: handler `ask_persona` собирается здесь, а не в chatToolDefs: ему
  // нужны LLM-клиент, счётчик хода и очередь событий. Объявление (ToolDef)
  // уже в списке — заменяем его на версию с handler'ом.
  if (tools.some(t => t.name === ASK_PERSONA_TOOL)) {
    const askPersona = makeAskPersonaTool({
      cwd,
      persona: activePersona,
      settings: subagentSettings,
      llm: llm!,
      counter: subagentCounter,
      onUsage: (personaId, usage) => {
        // AC10: токены консультации — в учёт треда с пометкой роли. Отдельная
        // запись `byModel` не годится (модель та же), поэтому пишем в
        // диагностику треда: сумма видна, но не смешивается с ходом.
        recordSubagentUsage(cwd, threadId, personaId, usage);
      },
      onEvent: event => {
        queue.push({ type: 'subagent', ...event, display: subagentSettings.display });
        // VL-419: записи консультанта — отдельными событиями `memory` с ЕГО
        // ролью: карточка в ленте пишет «<Роль> запомнил: …» и отменяет
        // запись из файла консультанта, а не роли треда (AC8).
        for (const entry of event.memory ?? []) {
          queue.push({
            type: 'memory',
            entry,
            personaId: event.personaId,
            personaLabel: event.personaLabel,
          });
        }
      },
    });
    localHandlers.set(ASK_PERSONA_TOOL, askPersona);
  }
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
   * вызова не исполняется (модель получает {ok:false,outcome:'rejected',
   * duplicate:true} с указанием использовать прежний результат), сверхлимитные
   * вызовы ответа — {ok:false,outcome:'rejected',limit:true} с указанием
   * завершить ход. Единая точка ⇒ защита действует в обычном цикле, в
   * resume-пути и в advanceToNextApproval.
   *
   * VL-326/VL-413: тот же guard считает серию ответов с `unchanged`
   * (неизменяющая запись). Исполненный вызов с таким ответом увеличивает
   * серию, исчерпание капа блокирует следующие вызовы вердиктом
   * `unchanged_repeat`. Причина: в веб-чате лимит вызовов на ответ
   * сбрасывался `beginTurn()` на каждом ответе модели, поэтому серия
   * «изменений нет» ничем не ограничивалась (инцидент VL-324).
   *
   * VL-359: guard-ответы сериализуются через `serializeAck` (протокол v2) —
   * модель видит ОДИН формат ответа и от инструментов, и от guard'а.
   */
  const toolGuard = createTurnToolGuard({ maxPerResponse: resolveChatMaxToolCalls(cwd) });
  const executeTool = async (name: string, args: Record<string, unknown>, toolCallId?: string): Promise<string> => {
    const verdict = toolGuard.check(name, args);
    if (verdict === 'duplicate') return duplicateCallResult();
    if (verdict === 'limit') return limitCallResult(toolGuard.maxPerResponse());
    if (verdict === 'unchanged_repeat') return unchangedRepeatCallResult(toolGuard.maxUnchangedRepeats());
    // VL-268: grant прогона проверяется на КАЖДОМ вызове. Задача вне taskIds —
    // отказ без исполнения; инструмент вне allowedTools сюда не доходит
    // (гейт вызовов уже отправил его в Allow/Deny).
    const grant = checkGrant(cwd, name, args);
    if (grant.kind === 'error') return grantDeniedResult(grant.error, name);
    // VL-407: ограничение роли — до исполнения (и до approval-гейта выше по
    // циклу: запрещённый write не должен даже спрашивать разрешения).
    const personaDenied = personaDeniedAck(activePersona, name);
    if (personaDenied !== null) return personaDenied;
    // VL-431: ПОСЛЕ всех guard'ов (дедуп/grant/роль считают args модели как
    // есть — инъекция не должна менять их ключи) подставляем контекст треда
    // в interbot_ask: серверно, модель и схема args не участвуют (AC1).
    const execArgs = interbotThreadArgs(name, args, threadId, toolCallId);
    const local = localHandlers.get(name);
    const raw = local ? await local.handler(execArgs) : await handleToolCall(name, execArgs, cwd, { defaultStatus: resolveDefaultStatus(activePersona) });
    // VL-402: успешная запись памяти — событие `memory` в ленту (AC2).
    // Публикуется здесь, а не в цикле хода: executeTool — единая точка
    // исполнения (обычный цикл, resume, advanceToNextApproval), иначе запись,
    // сделанная на resume-пути, осталась бы невидимой.
    if (name === MEMORY_REMEMBER_TOOL) {
      const entry = memoryEntryOf(raw);
      if (entry !== null) {
        queue.push({ type: 'memory', entry, personaId: activePersona.id, personaLabel: activePersona.label });
      }
    }
    // VL-326/VL-413: ответ с `unchanged` («изменений нет») — не прогресс, а
    // пустой круг: он наращивает серию и не сбрасывает её. Проверяется ДО
    // noteExecuted, иначе сброс серии затрёт только что посчитанный счётчик.
    if (isUnchangedAck(raw)) {
      toolGuard.noteUnchanged(name, args);
      return truncateToolOutput(raw);
    }
    // Фиксируем исполнение ДО капа вывода: write инкрементит epoch ресурса,
    // поэтому последующее чтение того же файла не считается дублем.
    toolGuard.noteExecuted(name, args);
    // VL-415: `ask_persona` возвращает готовый ответ эксперта, а не сырые
    // данные для модели. Общий кап 8 КБ (защита контекста от гигантских
    // файлов) делал консультацию бесполезной: обрезанный совет хуже его
    // отсутствия. Свой лимит (`subagents.max_answer_chars`) уже применён
    // внутри инструмента, с явной пометкой в ответе.
    if (name === ASK_PERSONA_TOOL) return raw;
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
  if (hasAnswerOf(body)) {
    // VL-330: resume по интерактивному вопросу. Валидация — до любых записей:
    // неизвестный toolCallId, чужой optionId, custom при allow_custom=false,
    // пустой ответ и истёкший TTL дают понятную ошибку в SSE, ход не падает.
    const answer = body.answer!;
    const answerId = answer.toolCallId as string;
    const pending = pendingToolCalls(history);
    const target = pending.find(tc => tc.id === answerId);
    if (!target || target.name !== ASK_USER_TOOL) {
      queue.push({
        type: 'error',
        message: 'Вопрос не найден: на него уже ответили, он снят или относится к другому треду',
      });
      return;
    }
    const parsed = parseAskUserArgs(target.arguments);
    if (!parsed.ok) {
      // Аргументы в jsonl битые (старая версия/ручная правка) — отвечать не на что
      queue.push({ type: 'error', message: `Вопрос повреждён: ${parsed.error}` });
      return;
    }
    const asked: AskUserArgs = parsed.value;
    const askedAt = questionAskedAt(cwd, threadId, answerId);
    if (isQuestionExpired(askedAt)) {
      // TTL 24 ч: ход не возобновляем, вопрос считается снятым (AC: TTL)
      recordQuestionLog(cwd, threadId, { event: 'expired', toolCallId: answerId });
      queue.push({
        type: 'error',
        message: 'Вопрос снят по таймауту (24 ч): задайте вопрос заново, если он ещё нужен',
      });
      return;
    }
    const validated = validateAnswer(answer, asked);
    if (!validated.ok) {
      queue.push({ type: 'error', message: validated.error });
      return;
    }
    const content = answerToolResult(asked, validated.value);
    history.push({ role: 'tool', tool_call_id: answerId, content });
    appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: answerId, content }]);
    recordQuestionLog(cwd, threadId, {
      event: 'answered',
      toolCallId: answerId,
      ...(validated.value.optionId !== undefined ? { optionId: validated.value.optionId } : {}),
      ...(validated.value.custom !== undefined ? { custom: validated.value.custom } : {}),
    });
    queue.push({ type: 'tool_end', id: answerId, result: content });
    // Остальные неотвеченные вызовы хода: read исполняем сразу, следующий
    // вопрос/approval — новая пауза (последовательные гейты, как у approval).
    const next = await advanceToNextApproval(history, cwd, threadId, queue, answerId, executeTool, activePersona);
    if (next !== null) {
      pauseOnToolCall(next, cwd, threadId, queue, currentTurn());
      return;
    }
  } else if (hasApprovalOf(body)) {
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
        content = await executeTool(target.name, target.arguments, target.id);
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
    const next = await advanceToNextApproval(history, cwd, threadId, queue, target.id, executeTool, activePersona);
    if (next !== null) {
      pauseOnToolCall(next, cwd, threadId, queue, currentTurn());
      return; // ход снова на паузе: ждём решение по следующему вызову
    }
  } else if (body.continue === true || body.retry === true) {
    // VL-269: авто-продолжение после truncated — нового user-сообщения НЕТ,
    // пустая строка в тред не попадает (AC8). Ход стартует по уже
    // накопленной истории; закрывать approval-хвосты не нужно: truncated
    // отдаётся только после closeUnconfirmedTail (парность tool_calls↔tool
    // к этому моменту восстановлена).
    //
    // VL-406: `retry: true` (кнопка «Повторить» у плашки исхода) — тот же
    // путь: повтор хода по накопленной истории, БЕЗ дубля user-сообщения в
    // jsonl. Отдельное поле, а не `continue`, чтобы в логах и тестах было
    // видно, что это повтор после пустого ответа/ошибки, а не авто-продолжение.
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
      content: buildSystemPrompt(cwd, history, activePersona),
    };

    let resp;
    // VL-269 (AC12): per-call таймаут — окно неактивности одного вызова модели,
    // а не бюджет хода. Живой стрим перевзводит таймер на каждом токене.
    const callGuard = createCallGuard(limits.callTimeoutMs, signal);
    try {
      // VL-255: новый ответ модели — счётчик вызовов ответа начинается с нуля
      // (карта исполненных сигнатур сохраняется: дедуп действует на весь ход).
      toolGuard.beginTurn();
      // VL-314: payload собирается с учётом точки сжатия (sidecar). История
      // треда (jsonl) и лента НЕ меняются — сжимается только то, что уходит
      // в модель. Орфан-гард tool_calls ↔ tool — внутри buildWireMessages.
      resp = await llm.streamChat([system, ...buildWireMessages(history, loadCompaction(cwd, threadId))], tools, {
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
      //
      // VL-406: пустой ответ модели в jsonl НЕ пишем. Раньше сюда попадала
      // строка `{role:'assistant', content:''}` — она ничего не добавляла в
      // ленту, но и не давала клиенту никакого признака исхода: ход выглядел
      // как «ничего не произошло». Теперь такой ход получает статус `empty`
      // (см. `driveChat`), а история остаётся чистой — повтор не натыкается
      // на пустое assistant-сообщение в контексте модели.
      if ((resp.text ?? '').trim() !== '') {
        const assistant: ChatMessage = { role: 'assistant', content: resp.text };
        history.push(assistant);
        appendChatMessages(cwd, threadId, [assistant]);
      }
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
      // VL-330: интерактивный инструмент (ask_user) — пауза хода, а не
      // исполнение. Ветки grant/allow-list к нему не применяются никогда:
      // вопрос нельзя «разрешить заранее» (Always allow на вопрос бессмыслен).
      // Аргументы проверяются ДО паузы: битый вопрос вернётся модели ошибкой,
      // а пользователь не получит карточку без вариантов.
      if (isInteractiveTool(tc.name)) {
        const parsed = parseAskUserArgs(tc.arguments);
        if (!parsed.ok) {
          const content = JSON.stringify({ error: parsed.error });
          history.push({ role: 'tool', tool_call_id: tc.id, content });
          appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
          queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
          continue;
        }
        pauseOnToolCall(tc, cwd, threadId, queue, currentTurn());
        return; // состояние уже в jsonl; ждём resume с ответом
      }
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
      // VL-407: инструмент вне allow_tools роли не должен даже спрашивать
      // разрешения — отказ сразу, машиночитаемым ack (модель видит причину).
      const personaDenied = personaDeniedAck(activePersona, tc.name);
      if (personaDenied !== null) {
        history.push({ role: 'tool', tool_call_id: tc.id, content: personaDenied });
        appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content: personaDenied }]);
        queue.push({ type: 'tool_end', id: tc.id, result: personaDenied, isError: true });
        continue;
      }
      // VL-357: аргументы передаются в классификатор — mixed-инструмент
      // (backlog_manage_*) читает при action:'list' и не требует Allow/Deny.
      const writeOp = isWriteOperation(tc.name, tc.arguments as Record<string, unknown> | undefined);
      const autoAllowed = grantAllowed || (writeOp && isToolAllowed(cwd, threadId, tc.name));
      if (writeOp && !autoAllowed) {
        pauseOnToolCall(tc, cwd, threadId, queue, currentTurn());
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
        result = await executeTool(tc.name, tc.arguments, tc.id);
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

/**
 * VL-402: разбор успешного ответа `memory_remember` в запись для события
 * `memory`. Отказ (`{ok:false}`) и мусор в ответе → null: событие не шлём,
 * модель уже получила причину tool-результатом.
 */
function memoryEntryOf(raw: string): { index: number; text: string; date: string } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { ok?: unknown; entry?: unknown };
    if (obj.ok !== true) return null;
    const entry = obj.entry as { index?: unknown; text?: unknown; date?: unknown } | undefined;
    if (!entry || typeof entry.text !== 'string') return null;
    return {
      index: typeof entry.index === 'number' ? entry.index : 0,
      text: entry.text,
      date: typeof entry.date === 'string' ? entry.date : '',
    };
  } catch {
    return null;
  }
}

/**
 * Отказ в исполнении команды (AC4): во время стриминга и в approval-паузе
 * команды недоступны.
 *
 * Стриминг сервер не видит напрямую (ход живёт в другом запросе), но
 * approval-пауза видна по истории: последний assistant с tool_calls без
 * парных tool-результатов. Возвращает текст отказа либо null.
 */
function commandRefusal(cwd: string, threadId: string, history: ChatMessage[]): string | null {
  if (pendingToolCalls(history).length > 0) {
    return (
      'Команда недоступна: диалог ждёт решения по подтверждению (Allow/Deny). ' +
      'Сначала ответьте на карточку подтверждения, затем повторите команду.'
    );
  }
  // Стриминг: параллельный ход по тому же треду. Признак — свежий (моложе
  // 30 с) файл истории, изменённый после последнего прочитанного сообщения.
  // Точного признака «ход идёт» в файловой системе нет, поэтому проверка
  // мягкая: она ловит именно гонку двух вкладок, а не обычную работу.
  try {
    const file = sessionFile(cwd, threadId);
    if (existsSync(file)) {
      const ageMs = Date.now() - statSync(file).mtimeMs;
      if (ageMs >= 0 && ageMs < 2_000 && history.length > 0) {
        const last = history[history.length - 1]!;
        // Ход в процессе: последнее сообщение — user (ответа ещё нет)
        if (last.role === 'user') {
          return (
            'Команда недоступна: идёт ответ ассистента. Дождитесь завершения хода ' +
            'и повторите команду.'
          );
        }
      }
    }
  } catch {
    // диагностика не должна мешать команде
  }
  return null;
}

/** Зависимости исполнения команды: LLM, учёт usage и очередь событий. */
interface CommandDeps {
  cwd: string;
  threadId: string;
  history: ChatMessage[];
  /**
   * VL-402: роль треда — нужна `/memory` (память пишется только в файл
   * текущей роли, AC6). null — роль не определена (команда откажет).
   */
  persona: PersonaConfig | null;
  ensureLlm: () => { ok: true; client: Pick<LlmClient, 'streamChat'> } | { ok: false; error: string };
  /** id модели треда (для тарифа/окна в панели, VL-313). */
  usageModelId: string | undefined;
  queue: EventQueue;
}

/**
 * Исполнить слэш-команду (VL-314).
 *
 * `/help` — справка из реестра. `/trim` — детерминированное усечение:
 * считаем точку по цели в токенах, пишем sidecar, отдаём отчёт. `/trim off`
 * — сброс. `/compact` — LLM-саммари: инкрементально (prior-summary + новые
 * сообщения), результат — новое саммари в sidecar; usage учитывается в
 * панели как обычный расход, но `requests` хода не увеличивает (AC12).
 * `/compact reset` — сброс.
 */
async function runChatCommand(
  parsed: ParsedCommand,
  deps: CommandDeps,
): Promise<{ text: string; isError?: boolean }> {
  const { cwd, threadId, history, queue } = deps;
  const arg = (parsed.args[0] ?? '').toLowerCase();

  if (parsed.name === 'help') return { text: helpText() };

  // VL-402: `/memory` — память роли треда. Обрабатывается ДО проверки
  // настроек сжатия: команда не имеет отношения к /trim и /compact, и
  // выключенное сжатие не должно её блокировать.
  if (parsed.name === 'memory') {
    if (deps.persona === null) {
      return {
        text: 'Память недоступна: роль треда не определена (тред пуст или роль удалена из реестра).',
        isError: true,
      };
    }
    return runMemoryCommand(parsed.args, cwd, deps.persona);
  }

  // VL-422: `/mcp` — внешние MCP-серверы этого треда. Обрабатывается ДО
  // настроек сжатия: команда не имеет отношения к /trim и /compact и не
  // должна блокироваться их выключенным состоянием.
  if (parsed.name === 'mcp') {
    return runMcpCommand(arg, deps);
  }

  const { settings, errors } = resolveChatCompaction(cwd);
  if (errors.length > 0) console.error(`[vibelog-chat] некорректные настройки сжатия: ${errors.join('; ')}`);
  if (!settings.enabled) {
    return {
      text: 'Сжатие контекста выключено в настройках (chat.compact_enabled = false). Включите его, чтобы пользоваться /trim и /compact.',
      isError: true,
    };
  }

  if (parsed.name === 'trim') {
    if (arg === 'off' || arg === 'reset') {
      const removed = resetCompaction(cwd, threadId);
      return {
        text: removed
          ? 'Сжатие сброшено: в модель снова уходит полная история треда.'
          : 'Сжатия не было — сбрасывать нечего.',
      };
    }
    return runTrim(deps, settings);
  }

  if (parsed.name === 'compact') {
    if (arg === 'reset' || arg === 'off') {
      const removed = resetCompaction(cwd, threadId);
      return {
        text: removed
          ? 'Сжатие сброшено: в модель снова уходит полная история треда.'
          : 'Сжатия не было — сбрасывать нечего.',
      };
    }
    return runCompact(deps, settings);
  }

  return { text: unknownCommandText(parsed.name), isError: true };
}

/**
 * `/mcp on|off|status` (VL-422): подключение сторонних MCP-серверов веб-чата.
 *
 * `on` — поднимает соединение (процессный кэш с refcount) и ставит флаг
 * треда: инструменты видны модели со СЛЕДУЮЩЕГО хода (команда в LLM-цикл
 * сама не уходит). Guard по «флаг И состояние в Map»: после перезапуска
 * сервера флаг живёт на диске, а соединения нет — повторный on поднимает
 * его заново. `off` — снимает ЕДИНИЦУ этого треда: при живых тредах-соседях
 * соединение не рвётся. `status` — настроенные (settings.json) + подключённые
 * (кэш процесса) + флаг треда.
 */
async function runMcpCommand(
  arg: string,
  deps: CommandDeps,
): Promise<{ text: string; isError?: boolean }> {
  const { cwd, threadId } = deps;

  if (arg === 'on') {
    const pre = externalChatMcpStatus(cwd);
    if (readThreadMcp(cwd, threadId) && pre !== null) {
      return {
        text: `Внешние MCP-серверы уже подключены в этом треде: серверов ${pre.connected}, инструментов ${pre.tools}.`,
      };
    }
    let result: ExternalChatConnectResult;
    try {
      result = await connectExternalForChat(cwd);
    } catch (err) {
      // connectExternalMcpServers fail-safe по серверам, но сбой чтения
      // конфига не должен ронять ход — ответ текстом команды
      return {
        text: `Подключение внешних MCP-серверов не удалось: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    if ('error' in result) {
      return { text: `Внешние MCP-серверы не подключены: ${result.error}.`, isError: true };
    }
    setThreadMcp(cwd, threadId, true);
    return {
      text:
        `Подключено серверов: ${result.connected}, инструментов: ${result.tools}. ` +
        'Инструменты будут видны модели со следующего хода; `/mcp off` — отключить.',
    };
  }

  if (arg === 'off') {
    if (!readThreadMcp(cwd, threadId)) {
      return { text: 'Внешние MCP-серверы в этом треде не подключались — отключать нечего.' };
    }
    await releaseExternalForChat(cwd);
    setThreadMcp(cwd, threadId, false);
    return {
      text: 'Внешние MCP-серверы отключены в этом треде: их инструменты исчезнут со следующего хода.',
    };
  }

  if (arg === 'status') {
    // Конфиг читается туда же, куда подключение (VL-167: VIBELOG_CWD ?? cwd)
    const servers = loadExternalMcpServers(process.env.VIBELOG_CWD ?? cwd);
    const lines: string[] = [];
    if (servers.length === 0) {
      lines.push('Настроенные серверы: не настроены (секция mcpServers в .vibelog/settings.json).');
    } else {
      lines.push(`Настроенные серверы (${servers.length}):`);
      for (const s of servers) {
        const cmd = [s.command, ...s.args].join(' ');
        lines.push(`- ${s.name}: ${cmd}${s.enabled === false ? ' [отключён]' : ''}`);
      }
    }
    const status = externalChatMcpStatus(cwd);
    lines.push(
      status === null
        ? 'Подключение: не подключено.'
        : `Подключение: подключено серверов ${status.connected}, инструментов ${status.tools} (владельцев refcount: ${status.refcount}).`,
    );
    lines.push(
      readThreadMcp(cwd, threadId)
        ? 'В этом треде: подключено (`/mcp off` — отключить).'
        : 'В этом треде: не подключено (`/mcp on` — подключить).',
    );
    return { text: lines.join('\n') };
  }

  return {
    text: 'Формат команды: `/mcp on|off|status` — подключить внешние MCP-серверы в этом треде, отключить или показать состояние.',
    isError: true,
  };
}

/** Цель сжатия в токенах для треда: процент окна либо fallback (AC8). */
function compactionTarget(cwd: string, usageModelId: string | undefined, settings: { targetPercent: number; targetTokens: number }): number {
  const window = resolveContextWindow(cwd, usageModelId ?? null);
  return resolveTargetTokens(window, settings.targetPercent, settings.targetTokens);
}

/** `/trim`: детерминированное усечение payload (0 ₽, AC5). */
function runTrim(
  deps: CommandDeps,
  settings: { targetPercent: number; targetTokens: number; keepTail: number },
): { text: string; isError?: boolean } {
  const { cwd, threadId, history } = deps;
  if (history.length === 0) return { text: 'Тред пуст — сжимать нечего.', isError: true };
  const target = compactionTarget(cwd, deps.usageModelId, settings);
  const tokensBefore = estimateTokens(history);
  // keep_tail — гарантированный хвост: цель не может быть меньше него
  const tailTokens = estimateTokens(history.slice(-settings.keepTail));
  const effectiveTarget = Math.max(target, tailTokens);
  const fromIndex = pickTrimIndex(history, effectiveTarget);
  if (fromIndex >= history.length) {
    return {
      text:
        `Сжимать нечего: история (~${tokensBefore} токенов) уже укладывается в цель ` +
        `~${effectiveTarget} токенов.`,
    };
  }
  const wire = buildWireMessages(history, {
    fromIndex,
    method: 'trim',
    compactedAt: new Date().toISOString(),
  });
  const tokensAfter = estimateTokens(wire);
  saveCompaction(cwd, threadId, {
    fromIndex,
    method: 'trim',
    tokensBefore,
    tokensAfter,
    compactedAt: new Date().toISOString(),
  });
  return {
    text:
      `Контекст сжат (детерминированно, 0 ₽): в модель уходит с ${fromIndex + 1}-го сообщения ` +
      `из ${history.length}. Оценка: ~${tokensBefore} → ~${tokensAfter} токенов. ` +
      'История в ленте не изменилась; сброс — `/trim off`.',
  };
}

/** `/compact`: LLM-саммари, инкрементально (AC6). */
async function runCompact(
  deps: CommandDeps,
  settings: { targetPercent: number; targetTokens: number; keepTail: number },
): Promise<{ text: string; isError?: boolean }> {
  const { cwd, threadId, history, queue } = deps;
  if (history.length === 0) return { text: 'Тред пуст — сжимать нечего.', isError: true };

  const target = compactionTarget(cwd, deps.usageModelId, settings);
  const tokensBefore = estimateTokens(history);
  const tailTokens = estimateTokens(history.slice(-settings.keepTail));
  const effectiveTarget = Math.max(target, tailTokens);
  const fromIndex = pickTrimIndex(history, effectiveTarget);
  if (fromIndex >= history.length) {
    return {
      text:
        `Сжимать нечего: история (~${tokensBefore} токенов) уже укладывается в цель ` +
        `~${effectiveTarget} токенов.`,
    };
  }

  // Шаблон саммари — файлом (AC7): проект → встроенный, иначе fail-closed.
  let template: string;
  try {
    template = loadChatSummaryTemplate(cwd);
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }

  const llmReady = deps.ensureLlm();
  if (!llmReady.ok) return { text: llmReady.error, isError: true };

  // Инкрементальность: предыдущее саммари (если было) + сообщения, которые
  // ещё не пересказаны. Саммари ПЕРЕПИСЫВАЕТСЯ, а не накапливается.
  const previous = loadCompaction(cwd, threadId);
  const priorSummary = previous?.method === 'summary' ? previous.summary : undefined;
  const toSummarize = history.slice(previous?.fromIndex ?? 0, fromIndex);
  const transcript = toSummarize
    .map(m => {
      if (m.role === 'tool') return `[tool ${m.tool_call_id}] ${m.content}`;
      if (m.role === 'assistant') {
        const calls = m.tool_calls?.length
          ? `\n(вызовы: ${m.tool_calls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments ?? {})})`).join(', ')})`
          : '';
        return `assistant: ${m.content ?? ''}${calls}`;
      }
      return `${m.role}: ${m.content}`;
    })
    .join('\n\n');

  const prompt = [
    template,
    priorSummary ? `Предыдущее саммари (перепиши его с учётом новых сообщений):\n\n${priorSummary}` : '',
    `Новые сообщения для сжатия:\n\n${transcript}`,
  ]
    .filter(p => p !== '')
    .join('\n\n---\n\n');

  let summary: string;
  try {
    const resp = await llmReady.client.streamChat(
      [{ role: 'user', content: prompt }],
      undefined,
      {},
    );
    summary = resp.text.trim();
    // AC12: расход саммари — обычный (токены и ₽ в панели), но requests хода
    // не увеличивает: это не запрос хода.
    if (resp.usage) {
      const recorded = recordThreadUsage(cwd, threadId, {
        ...(deps.usageModelId ? { modelId: deps.usageModelId } : {}),
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
        cache: resp.usage.cache_read_input_tokens,
        reasoning: resp.usage.reasoning_tokens,
        countRequest: false,
      });
      const view = describeThreadUsage(cwd, recorded);
      if (view !== null) queue.push({ type: 'usage', usage: view });
    }
  } catch (err) {
    return {
      text: `Не удалось получить саммари: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
  if (summary === '') {
    return { text: 'Модель вернула пустое саммари — сжатие не применено.', isError: true };
  }

  const state = {
    fromIndex,
    method: 'summary' as const,
    summary,
    tokensBefore,
    tokensAfter: estimateTokens(buildWireMessages(history, {
      fromIndex,
      method: 'summary',
      summary,
      compactedAt: new Date().toISOString(),
    })),
    compactedAt: new Date().toISOString(),
  };
  saveCompaction(cwd, threadId, state);
  return {
    text:
      `Контекст сжат (LLM-саммари): в модель уходит с ${fromIndex + 1}-го сообщения ` +
      `из ${history.length}. Оценка: ~${tokensBefore} → ~${state.tokensAfter} токенов. ` +
      'История в ленте не изменилась; сброс — `/compact reset`.\n\n' +
      `**Саммари**\n\n${summary}`,
  };
}

/** Тело содержит корректный approval-объект. */
function hasApprovalOf(body: ChatRequestBody): boolean {
  const a = body.approval;
  return !!a && typeof a.toolCallId === 'string' && typeof a.approved === 'boolean';
}

/** VL-330: тело содержит ответ на интерактивный вопрос. */
function hasAnswerOf(body: ChatRequestBody): boolean {
  const a = body.answer;
  return !!a && typeof a.toolCallId === 'string';
}

/**
 * VL-330: поставить ход на паузу перед вызовом инструмента.
 *
 * Единая точка для двух видов паузы: интерактивный вопрос (`ask_user` —
 * событие `question`, состояние уже в jsonl) и write-операция (событие
 * `approval` + запись в лог подтверждений). Вызывается из цикла хода, из
 * resume-ветки и из продвижения к следующему гейту — чтобы три места не
 * расходились в поведении (lesson-37: общий хелпер вместо копий).
 */
function pauseOnToolCall(
  tc: ToolCall,
  cwd: string,
  threadId: string,
  queue: EventQueue,
  turn: number,
): void {
  if (isInteractiveTool(tc.name)) {
    const parsed = parseAskUserArgs(tc.arguments);
    if (!parsed.ok) {
      // Аргументы уже проверялись до паузы; сюда попадаем только при битом
      // jsonl — закрываем вызов ошибкой, чтобы ход не завис навсегда.
      const content = JSON.stringify({ error: parsed.error });
      queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
      return;
    }
    recordQuestionLog(cwd, threadId, {
      event: 'asked',
      toolCallId: tc.id,
      question: parsed.value.question,
    });
    queue.push({
      type: 'question',
      toolCallId: tc.id,
      question: parsed.value.question,
      options: parsed.value.options,
      allowCustom: parsed.value.allowCustom,
    });
    return;
  }
  recordApprovalLog(cwd, threadId, {
    event: 'requested',
    toolCallId: tc.id,
    tool: tc.name,
    turn,
  });
  const preview = grantPreviewOf(cwd, tc.name, tc.arguments);
  queue.push({
    type: 'approval',
    toolCallId: tc.id,
    name: tc.name,
    args: tc.arguments,
    ...(preview ? { grant: preview } : {}),
  });
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
 * VL-407: отказ, если роль треда ограничила набор инструментов
 * (`allow_tools`), а вызванное имя в список не входит.
 *
 * Зачем проверка при ВЫЗОВЕ, если модель уже не видит запрещённые имена в
 * `tools` (фильтр в chatToolDefs): в истории треда может остаться старый
 * `tool_call` — тред начат под другой ролью или до фиксации роли (VL-283),
 * а также вызов может прийти из resume-пути. Молчаливое исполнение в этом
 * случае означало бы, что ограничение обходится.
 *
 * `memory_remember`/`memory_forget` разрешены всегда при наличии роли — это
 * механизм памяти самой роли, а не инструменты проекта (см. chatToolDefs).
 *
 * @returns текст отказа (JSON-ack) либо null — вызов разрешён
 */
function personaDeniedAck(persona: PersonaConfig, name: string): string | null {
  const allow = persona.allowTools;
  if (allow === undefined) return null;
  if (name === MEMORY_REMEMBER_TOOL || name === MEMORY_FORGET_TOOL) return null;
  if (allow.includes(name)) return null;
  return ackError(
    `Инструмент "${name}" не разрешён роли "${persona.label}" (allow_tools в .vibelog/settings.json)`,
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
 * @param persona — роль треда (VL-407): вызов вне её `allow_tools` закрывается
 *   отказом сразу, без карточки Allow/Deny — иначе пользователь подтверждал бы
 *   операцию, которую роль всё равно не имеет права выполнить
 * @returns следующий write-вызов, ожидающий подтверждения, либо null
 */
async function advanceToNextApproval(
  history: ChatMessage[],
  cwd: string,
  threadId: string,
  queue: EventQueue,
  skipId: string,
  execute: (name: string, args: Record<string, unknown>, toolCallId?: string) => Promise<string>,
  persona?: PersonaConfig | null,
): Promise<ToolCall | null> {
  for (const tc of pendingToolCalls(history)) {
    if (tc.id === skipId) continue;
    // VL-330: вопрос в хвосте хода — не исполняем и не закрываем: он тоже
    // требует ответа человека. Битые аргументы закрываем ошибкой (иначе ход
    // завис бы на карточке, которую нечем отрисовать).
    if (isInteractiveTool(tc.name)) {
      const parsed = parseAskUserArgs(tc.arguments);
      if (!parsed.ok) {
        const content = JSON.stringify({ error: parsed.error });
        history.push({ role: 'tool', tool_call_id: tc.id, content });
        appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
        queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
        continue;
      }
      return tc;
    }
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
    // VL-407: вызов вне allow_tools роли закрываем отказом, а не карточкой
    // Allow/Deny — подтверждать операцию, которую роль не имеет права
    // выполнить, бессмысленно.
    const personaDenied = persona ? personaDeniedAck(persona, tc.name) : null;
    if (personaDenied !== null) {
      history.push({ role: 'tool', tool_call_id: tc.id, content: personaDenied });
      appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content: personaDenied }]);
      queue.push({ type: 'tool_end', id: tc.id, result: personaDenied, isError: true });
      continue;
    }
    const writeOp = isWriteOperation(tc.name, tc.arguments as Record<string, unknown> | undefined);
    const autoAllowed = grantAllowed || (writeOp && isToolAllowed(cwd, threadId, tc.name));
    if (writeOp && !autoAllowed) return tc;
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
      result = await execute(tc.name, tc.arguments, tc.id);
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
    // VL-330: неотвеченный вопрос — не «отказ в записи», а отсутствие ответа:
    // модель должна задать вопрос заново, а не решить, что получила решение.
    if (isInteractiveTool(tc.name)) {
      const content = cancelledQuestionResult('limit');
      history.push({ role: 'tool', tool_call_id: tc.id, content });
      appendChatMessages(cwd, threadId, [{ role: 'tool', tool_call_id: tc.id, content }]);
      recordQuestionLog(cwd, threadId, { event: 'cancelled', toolCallId: tc.id });
      queue.push({ type: 'tool_end', id: tc.id, result: content, isError: true });
      continue;
    }
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
