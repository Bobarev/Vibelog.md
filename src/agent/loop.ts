/**
 * Tool-calling loop агента (VL-83, компоненты 8 и 9 эпика VL-75).
 *
 * Цикл: messages → LLM → если есть tool_calls, выполняем инструменты,
 * дописываем tool-результаты в messages → повтор; иначе финальный текст =
 * результат фазы. Loop detection (3 одинаковые подряд сигнатуры) и лимиты
 * --max-tool-calls / --max-wall-time проверяются на каждой итерации.
 *
 * Контракт выхода — по образцу QwenResult (src/web/qwen-result.ts), чтобы
 * CLI (VL-85) мог привести его к формату parseQwenResult. Ошибки loop НЕ
 * кидает наружу: is_error=true + текст в result (decision-4, п.1 —
 * partial-результат накапливается и дописывается к тексту ошибки).
 */

import {
  addUsage,
  zeroUsage,
  isHighRiskBody,
  isValidToolCall,
  sanitizeWireMessages,
  shrinkMessages,
  MAX_PAYLOAD_BYTES,
  PAYLOAD_WARN_RATIO,
  PAYLOAD_COMPACT_TOOL_CHARS,
  PAYLOAD_COMPACT_TOOL_CHARS_ESCALATED,
  type ChatMessage,
  type LlmClient,
  type LlmUsage,
  type ToolDef,
} from './llm.js';
import type { ToolSpec } from './tools.js';
import { truncateToolOutput } from './tools.js';
// VL-314: компакшн wire-истории вынесен в общий модуль (нужен и веб-чату);
// реэкспорт ниже сохраняет публичный API loop.ts (тесты импортируют отсюда).
import { compactWireMessages } from './compact.js';
// VL-306: классификатор read/write — общий с веб-слоем (src/core/tool-classify.ts)
// VL-351: в loop.ts больше не используется (страховка VL-306 удалена), но
// классификатор остаётся нужен веб-слою и инвариант-тестам контракта ack.
import {
  INTENT_LOOP_REPEAT_DEFAULT,
  MAX_APPLIED_REPEATS_PER_RUN,
  MAX_BLOCKED_CALLS_PER_RUN,
  MAX_ERROR_REPEATS_PER_RUN,
  MAX_NOOP_REPEATS_PER_RUN,
  NEXT_STEP_HINT,
  PHANTOM_CALL_LIMIT_DEFAULT,
  REPEAT_BLOCK_MAX_PER_RUN,
  REPEAT_READ_LIMIT_DEFAULT,
  REPEAT_SEARCH_LIMIT_DEFAULT,
  REPEAT_SHELL_LIMIT_DEFAULT,
  REPEAT_WARN_MAX_PER_RUN,
  REPEAT_WRITE_LIMIT_DEFAULT,
  analyzeToolRepeats,
  appliedNoopDirective,
  createRepeatGuard,
  loopDetectionDirective,
  noopRepeatDirective,
  parsedErrorText,
  repeatBlockDirective,
  repeatKey,
  toolRepeatKind,
  type RepeatGuard,
  type RepeatStats,
} from './repeat-tracker.js';

/**
 * VL-357: пороги повторов и тексты директив — единый источник в
 * `src/agent/repeat-tracker.ts`. Реэкспорт сохраняет публичный API loop.ts
 * (тесты и разборы сессий импортируют `MAX_ERROR_REPEATS_PER_RUN` отсюда).
 */
export {
  MAX_APPLIED_REPEATS_PER_RUN,
  MAX_BLOCKED_CALLS_PER_RUN,
  MAX_ERROR_REPEATS_PER_RUN,
  MAX_NOOP_REPEATS_PER_RUN,
  NEXT_STEP_HINT,
  REPEAT_LIMITS,
  REPEAT_WARN_MAX_PER_RUN,
  appliedNoopDirective,
  clipErrorText,
  loopDetectionDirective,
  noopRepeatDirective,
  parsedErrorText,
  retryDirective,
} from './repeat-tracker.js';
import { buildRunProgress, type RunProgress, type RunProgressReason } from './run-progress.js';
import { createIdleGuard } from './idle-guard.js';

/** Лимиты цикла; дефолты — 100 tool-calls и 900 секунд wall-time. */
export interface LoopLimits {
  /** Максимум tool-calls фазы (дефолт 100, --max-tool-calls). */
  maxToolCalls?: number;
  /**
   * Кумулятивный лимит tool-calls СЕССИИ через resume-раны (VL-223,
   * --tool-calls-per-session). Без значения — лимит не проверяется
   * (поведение прежнее, AC#2). Превышение → fail до выполнения вызова.
   */
  maxToolCallsPerSession?: number;
  /**
   * Предзаполненный счётчик tool-calls прошлых ранов сессии (VL-223):
   * countToolCallsInMessages(resumedMessages) при resume, 0 для нового
   * запуска. База фиксируется один раз до запуска loop — двойного счёта
   * с toolCallsTotal нет.
   */
  toolCallsUsedThisSession?: number;
  /** Максимальное время фазы в миллисекундах (дефолт 900000, --max-wall-time). */
  maxWallTimeMs?: number;
  /**
   * VL-274: окно простоя в миллисекундах (--idle-timeout) — максимум тишины
   * (нет новых токенов стрима, нет завершённых tool-вызовов) до прерывания
   * фазы. Без значения — `IDLE_TIMEOUT_MS_DEFAULT` (600000 = 600 с); `0` —
   * проверка выключена (аналог `HERMES_CRON_TIMEOUT=0`, ref-10). Wall-time при
   * этом остаётся жёстким потолком безопасности и не заменяется.
   */
  idleTimeoutMs?: number;
  /**
   * Максимум LLM-запросов фазы (ходов модели, numTurns) — лимит запросов,
   * не tool-calls (VL-104). Без значения — без лимита.
   */
  maxRequests?: number;
  /** Сколько одинаковых подряд вызовов считать зацикливанием (дефолт 3). */
  loopDetectionRepeat?: number;
  /**
   * VL-251: сигнатуры `name|JSON(args)`, отклонённые loop detection в
   * ПРОШЛЫХ ранах сессии (из меты сессии, `blocked_signatures`). Такой вызов
   * не исполняется — модели уходит tool-результат «заблокирован», иначе
   * после resume (кнопка «Продолжить») луп повторялся с нуля (инцидент VL-234).
   */
  blockedSignatures?: string[];
  /** Сколько ходов подряд с одним и тем же промежуточным текстом считать зацикливанием намерений (VL-119, дефолт 4). */
  intentLoopRepeat?: number;
  /**
   * VL-229: порог повторов поиска — N-й `grep_search`/`glob` с тем же pattern
   * даёт модели предупреждение (дефолт 3, REPEAT_SEARCH_LIMIT_DEFAULT).
   */
  repeatSearchLimit?: number;
  /**
   * VL-229: порог повторов чтения — N-е чтение того же файла даёт модели
   * предупреждение (дефолт 5, REPEAT_READ_LIMIT_DEFAULT).
   */
  repeatReadLimit?: number;
  /**
   * VL-254: порог повторов shell-скелета — N-й `run_shell_command` с тем же
   * скелетом команды даёт модели предупреждение (дефолт 3,
   * REPEAT_SHELL_LIMIT_DEFAULT).
   */
  repeatShellLimit?: number;
  /**
   * VL-284: порог повторов правки одного файла — N-й `edit`/`write_file` по
   * тому же пути даёт модели предупреждение (дефолт 6,
   * REPEAT_WRITE_LIMIT_DEFAULT). `0` — выключить порог для write.
   */
  repeatWriteLimit?: number;
  /**
   * VL-284: множитель порога блокировки для search/read/shell (дефолт 2):
   * после `repeatBlockMultiplier × порог` вызов не выполняется, модели
   * уходит tool-результат с директивой «Повтор заблокирован». У write свой
   * явный порог (REPEAT_WRITE_BLOCK_DEFAULT = 8).
   */
  repeatBlockMultiplier?: number;
  /**
   * VL-229: выключить guard повторов (метрика repeat_stats при этом
   * считается: отчёты не страдают).
   */
  repeatGuardDisabled?: boolean;
  /**
   * Компакшн истории (VL-122): сколько последних сообщений оставить в
   * LLM-запросе помимо system и первого user (дефолт 50).
   */
  compactTailMessages?: number;
  /**
   * Компакшн истории (VL-122): порог срабатывания по usage-токенам последнего
   * ответа (input_tokens + cache_read_input_tokens; дефолт 850000 = 85% окна
   * MiMo-V2.5 1M — auto-порог doc-13 §4.0).
   */
  compactAtTokens?: number;
  /**
   * Выключить компакшн истории (VL-122): по умолчанию компакшн включён;
   * true → payload запроса всегда полный (--no-compact).
   * Байтовый автокомпакт VL-230 НЕ выключается этим флагом — это защита
   * от отказа провайдера на размерном лимите, а не оптимизация контекста.
   */
  compactDisabled?: boolean;
  /**
   * VL-230: override жёсткого байтового лимита провайдера (для тестов;
   * дефолт MAX_PAYLOAD_BYTES = 900_000).
   */
  maxPayloadBytes?: number;
  /**
   * VL-230: override порога предупреждения/автокомпакта в байтах (для
   * тестов; дефолт PAYLOAD_WARN_BYTES = 70% от maxPayloadBytes).
   */
  payloadWarnBytes?: number;
  /**
   * VL-254: доли бюджета wall-time, на которых модели инжектируется
   * предупреждение с остатком времени и текущим payload (дефолт [0.7, 0.9]).
   */
  wallTimeWarnRatios?: number[];
}

/** Результат фазы (совместим по полям с QwenResult CLI). */
export interface LoopResult {
  result: string;
  is_error: boolean;
  num_turns: number;
  /**
   * Tool-calls текущего рана (VL-221): счётчик выполненных вызовов
   * инструментов ЗА РАН (сбрасывается при resume) — выводится рядом с
   * num_turns/requests, чтобы лимит --max-tool-calls не путали с LLM-запросами.
   */
  tool_calls_total: number;
  duration_ms: number;
  usage: LlmUsage;
  /**
   * Полный диалог на момент завершения (VL-95): хранилище сессии
   * vibelog-agent. На fail-путях — накопленная история (частичный
   * диалог), чтобы resume не начинал беседу с чистого листа.
   */
  messages: ChatMessage[];
  /**
   * Байты wire-body последнего LLM-запроса фазы (VL-203): диагностика
   * для logTail оркестратора — отличаем content-based отказ от размерного.
   * undefined, если ответы пришли от мока без payloadBytes.
   */
  last_payload_bytes?: number;
  /** Максимум payload по всем ходам фазы (VL-203) — пик запроса. */
  max_payload_bytes?: number;
  /**
   * Метрика повторов обращений (VL-229, AC1): считается по ВСЕМУ транскрипту
   * диалога (`messages`, включая прошлые раны resume) — доля повторов
   * корректна для сессии, а не только для текущего рана.
   */
  repeat_stats: RepeatStats;
  /**
   * VL-284: сколько вызовов guard повторов заблокировал за ран (эскалация
   * после `repeatBlockMultiplier × порог`; кап REPEAT_BLOCK_MAX_PER_RUN).
   * Диагностика для stderr/logTail — видно, что фаза упиралась в зацикливание,
   * а не просто долго шла.
   */
  repeat_blocked?: number;
  /**
   * VL-251: новые сигнатуры, заблокированные loop detection в этом ране
   * (подмножество уже отброшенных + добавленные сейчас). CLI дописывает их
   * в мету сессии — следующий resume блокирует повторы без исполнения.
   */
  blocked_signatures?: string[];
  /**
   * VL-254: блок «что сделано / что осталось» — заполняется только при
   * обрыве по wall-time/max-requests. CLI пишет его в мету сессии
   * (`run_progress`), коммитит WIP-изменения фазы code и добавляет
   * комментарий в задачу.
   */
  progress?: RunProgress;
}

/** Опции запуска loop. */
export interface RunLoopOptions {
  /** LLM-клиент; loop зависит только от streamChat (мокается в тестах). */
  llm: Pick<LlmClient, 'streamChat'>;
  /** Начальные сообщения диалога (system/user). */
  messages: ChatMessage[];
  /** Инструменты, доступные модели (локальные, MCP-прокси и др.). */
  tools: ToolSpec[];
  /**
   * Внешние инструменты (VL-84): MCP-инструменты Vibelog, подмешиваемые
   * к локальным перед стартом цикла. Конфликт имён с локальными — throw.
   */
  externalTools?: ToolSpec[];
  limits?: LoopLimits;
  /** Стриминг финального/промежуточного текста (TUI/CLI). */
  onToken?: (token: string) => void;
  /** Хуки карточек tool calls (TUI): старт и завершение выполнения. */
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  /**
   * Завершение tool call (TUI, VL-86): output + флаг ошибки — карточка
   * получает статус ok/error; для неизвестного инструмента isError=true.
   */
  onToolEnd?: (name: string, output: string, isError?: boolean) => void;
  /**
   * Накопленный usage и номер хода после каждого ответа модели (TUI VL-86):
   * счётчики обновляются по мере выполнения фазы.
   */
  onUsage?: (usage: LlmUsage, turn: number) => void;
  /**
   * Ошибка фазы (лимиты, loop detection, LLM API) — блок ошибок TUI (VL-86).
   * Вызывается в fail() до возврата; текст — русский, как в LoopResult.result.
   */
  onError?: (text: string) => void;
  /**
   * Хук инкрементальной записи сессии (VL-103): вызывается сразу после
   * КАЖДОГО добавления сообщения в messages (assistant с tool_calls,
   * tool-результат, финальный/ошибочный assistant). Headless/cli использует
   * его для append в jsonl сессии — при обрыве процесса транскрипт сохранён
   * до последнего сообщения. Начальные сообщения (system/history/user) сюда
   * не попадают — их вызывающий дописывает сам перед запуском loop.
   * Если onMessage возвращает промесс (append в jsonl) — loop ждёт его
   * завершения: запись гарантированно завершается до следующего шага цикла
   * (AC#3 VL-103: файл сессии содержит сообщения до завершения фазы).
   */
  onMessage?: (m: ChatMessage) => void | Promise<void>;
  /** Отмена фазы: прокидывается в LLM-запросы и handler'ы инструментов. */
  signal?: AbortSignal;
  /**
   * VL-254: источник текущего времени (только для тестов). Дефолт `Date.now`.
   * Позволяет проверять мягкий wall-time guard и обрыв по лимиту без sleep:
   * тест двигает виртуальные часы между ходами мока LLM.
   */
  now?: () => number;
}

const MAX_TOOL_CALLS_DEFAULT = 100;
const MAX_WALL_TIME_MS_DEFAULT = 900_000;
/**
 * VL-274: дефолт idle-таймаута — 600 с (как в hermes-agent, ref-10
 * `cron/AGENTS.md`: «default 600s idle»). Заведомо больше любой легитимной
 * паузы стрима (reasoning модели, ретрай-паузы LLM) — при отсутствии настройки
 * поведение фаз не меняется (AC5).
 */
const IDLE_TIMEOUT_MS_DEFAULT = 600_000;
const LOOP_DETECTION_REPEAT_DEFAULT = 3;

/**
 * VL-310: инструменты, которыми модель «доотчитывается» за фазу.
 *
 * Признак нужен терминальному выходу на повторе уже применённого вызова:
 * если успешный вызов одного из них уже был в этом ране, отчёт записан и
 * повтор можно закрыть штатно (is_error:false). Без отчёта такой выход
 * обрывал фазу на середине работы (сессия agent-1793637056809, Code VL-124).
 */
const REPORT_WRITING_TOOLS = new Set([
  "backlog_finish_phase",
  // комментарий @agent — фактическая запись отчёта в задачу (в т.ч. авто-отчёт
  // через MCP-путь); одна смена статуса отчётом не считается.
  "backlog_add_comment",
]);

function isReportWritingTool(name: string): boolean {
  return REPORT_WRITING_TOOLS.has(name);
}

/**
 * VL-357 (шаг 5): вызовы, чей УСПЕШНЫЙ результат — фактический след работы.
 *
 * Правка файла, запись файла, коммит. Только они превращают исчерпанный кап
 * повторов из «работа не завершена → fail()» в «работа сделана → штатное
 * завершение». Ответ инструмента проверяется отдельно (`runHasProgress`):
 * имя + успешный ответ, а не одно имя.
 */
const WORK_EVIDENCE_TOOLS = new Set(['edit', 'write_file', 'git_commit']);

// VL-357: пороги повторов живут в ОДНОМ месте — `REPEAT_LIMITS`
// (`src/agent/repeat-tracker.ts`). Раньше `loop.ts` держал свой набор
// `MAX_*_REPEATS_PER_RUN`, `repeat-tracker.ts` — свои `REPEAT_*`, а веб-чат —
// `MAX_NOOP_REPEATS_PER_TURN`: инцидент попадал в тот детектор, что сработал
// первым, и получал директиву из его словаря. Локальные константы оставлены
// только как реэкспорт (их импортируют тесты).
// VL-359: `PHANTOM_CALL_LIMIT_DEFAULT` (VL-215) и `INTENT_LOOP_REPEAT_DEFAULT`
// (VL-119) тоже переехали в `REPEAT_LIMITS` (`phantom`/`intent`) — это пороги
// детекторов повторов, и AC3 VL-357 требовал единственного источника.
// Импортируются из repeat-tracker.js выше.

// Компакшн истории (VL-122, wire-усечение по doc-13 §4.1): хвост 50 сообщений —
// tool-вывод ≤8KB (лимит VL-110, tools.ts) → ≤400KB ≈ ≤130K токенов ≈ 13% окна
// MiMo-V2.5 (1M) — попадает в рекомендованный doc-13 диапазон хвоста 10–15%.
// Триггер 850K = 85% окна (auto-порог doc-13 §4.0): редкое срабатывание почти
// не бьёт по prefix-caching (cache read MiMo дешёвый).
const COMPACT_TAIL_DEFAULT = 50;
const COMPACT_AT_TOKENS_DEFAULT = 850_000;



/**
 * Текст прерывания фазы по простою (VL-274).
 *
 * Маркер «idle-таймаут» обязателен: по нему отличают idle-обрыв от wall-time
 * и max-requests и в отчёте фазы, и в авто-разборе (AC1/AC8 VL-274).
 */
export function idleTimeoutText(timeoutMs: number): string {
  return `Превышен idle-таймаут (${Math.round(timeoutMs / 1000)} секунд без активности) — фаза прервана.`;
}

/**
 * Текст мягкого предупреждения о бюджете времени фазы (VL-254).
 *
 * Жёсткая проверка wall-time просто убивает фазу — модель узнаёт о лимите
 * постфактум, уже потеряв работу рана (VL-235: старт полного `pnpm test` на
 * 1500 с за три минуты до конца). Предупреждение приходит заранее, на 70% и
 * 90% бюджета, и содержит два числа, которых модели не хватало: остаток
 * времени и текущий размер payload (VL-230 компактит историю, но агенту об
 * этом никто не сообщал).
 */
export function wallTimeWarnText(
  remainingMs: number,
  totalMs: number,
  payloadBytes: number,
  warnBytes: number,
): string {
  const remainingSec = Math.max(0, Math.round(remainingMs / 1000));
  const totalSec = Math.round(totalMs / 1000);
  const usedPct = totalMs > 0 ? Math.round(((totalMs - remainingMs) / totalMs) * 100) : 0;
  return (
    `Осталось ${remainingSec} с из ${totalSec} (израсходовано ${usedPct}% бюджета времени фазы). ` +
    `Payload последнего запроса: ${payloadBytes} байт, порог компакта истории: ${warnBytes} байт. ` +
    `Не запускай команды дольше остатка: сократи проверку до затронутых файлов ` +
    `(например, один тест-файл вместо полного прогона). При нехватке времени — заверши фазу ` +
    `честным отчётом «что сделано / что осталось» и зафиксируй прогресс в задаче.`
  );
}

/**
 * Реэкспорт компакшна wire-истории (VL-314): реализация переехала в
 * `src/agent/compact.ts` — та же функция нужна веб-чату (/trim, /compact).
 * Публичный API loop.ts не меняется: тесты и агент импортируют отсюда.
 */
export { compactWireMessages };

/**
 * Выполняет tool-calling loop до финального текста модели, лимита или
 * loop detection. Все отказы превращаются в is_error=true с русским текстом —
 * CLI оборачивает результат в JSON и не зависает (AC#2 VL-75).
 */
export async function runLoop(options: RunLoopOptions): Promise<LoopResult> {
  // VL-254: тест-хук времени — дефолт системные часы
  const now = options.now ?? Date.now;
  const startedAt = now();
  const maxToolCalls = options.limits?.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT;
  // Кумулятивный per-session лимит (VL-223): без maxToolCallsPerSession
  // проверка пропускается — поведение без --tool-calls-per-session прежнее
  const maxToolCallsPerSession = options.limits?.maxToolCallsPerSession;
  const toolCallsSessionBase = options.limits?.toolCallsUsedThisSession ?? 0;
  const maxWallTimeMs = options.limits?.maxWallTimeMs ?? MAX_WALL_TIME_MS_DEFAULT;
  // VL-274: idle-таймаут фазы (максимум тишины). 0 — проверка выключена.
  const idleTimeoutMs = options.limits?.idleTimeoutMs ?? IDLE_TIMEOUT_MS_DEFAULT;
  // Лимит LLM-запросов (VL-104): без значения — без лимита (поведение прежнее)
  const maxRequests = options.limits?.maxRequests;
  const repeatLimit = options.limits?.loopDetectionRepeat ?? LOOP_DETECTION_REPEAT_DEFAULT;
  // VL-251: сигнатуры, заблокированные loop detection (прошлые раны = из меты
  // сессии + добавленные в этом ране). Такой вызов НЕ исполняется: модели
  // уходит tool-результат с директивой «следующий шаг», а не нейтральный
  // текст роли assistant (AC4), и повтор после resume не проходит (AC5).
  const blocked = new Set<string>(options.limits?.blockedSignatures ?? []);
  const blockedInitial = [...blocked];
  // Серия подряд идущих заблокированных вызовов: 2-й подряд — фазовый отказ
  // (модель проигнорировала директиву в tool-результате).
  let blockedStreak = 0;
  // VL-253: счётчики блоков по сигнатуре и суммарно за ран — повторная
  // блокировка ТОЙ ЖЕ сигнатуры означает, что директива не сработала, и
  // фазу надо завершать сразу, а не ждать второго круга повторов.
  const blockCounts = new Map<string, number>();
  let blockedTotal = 0;
  // VL-303: сигнатуры, чей вызов УСПЕШНО выполнен и вернул JSON с ok:true.
  // Повтор такой сигнатуры фазу не прерывает: эффект уже достигнут, модели
  // уходит директива «уже применён, переходи к отчёту».
  const appliedSignatures = new Set<string>();
  // VL-309: сигнатуры, чей вызов вернул noop (ok:false + reason:'noop').
  // Noop — это «изменений нет», а НЕ «работа сделана» (VL-304 ошибочно
  // складывал noop в appliedSignatures): повтор такого вызова не должен
  // завершать ран. Вместо finishAppliedRepeat модели уходит директива
  // «изменений нет — переходи к следующему шагу», и цикл продолжается.
  // Инцидент: сессия agent-1793647788155 (Close VL-307) — повтор
  // lesson_update (noop) оборвал ран, документация не была написана, а
  // задача получила Done через авто-отчёт.
  const noopSignatures = new Set<string>();
  // VL-309: сколько раз за ран модели напоминали «изменений нет». Страховка
  // от вечного круга «директива → повтор»: при превышении — честный fail()
  // (is_error:true → оркестратор откатит статус и запустит авто-resume), а не
  // ложный «успех» с невыполненной работой.
  let noopRepeatCount = 0;
  // VL-310: серия подряд повторов УЖЕ ПРИМЕНЁННОГО вызова (appliedSignatures).
  // Считается серия, а не сумма за ран: повтор, перемежающийся с реальной
  // работой (модель вернулась к прежнему шагу после новых вызовов), не должен
  // убивать фазу — убивать её должен дословный цикл. Исчерпание серии —
  // честный fail() (is_error:true → оркестратор откатит статус).
  let appliedRepeatCount = 0;
  let appliedRepeatSig: string | null = null;
  // VL-310: то же для noop-повторов (см. noopSignatures).
  let noopRepeatSig: string | null = null;
  // VL-323: сигнатуры, чей последний ответ был отказом (`ok:false`). Отдельный
  // набор от applied/noop: отказ значит «вызов не исполнен и НЕ будет исполнен
  // в текущем виде» — повтор с теми же аргументами гарантированно бесполезен,
  // поэтому модели нужна не блокировка-запрет, а готовое исправление.
  const errorSignatures = new Set<string>();
  // Текст последнего отказа по сигнатуре — попадает в директиву блокировки.
  // VL-351: храним и признак «текст из hint» — такой текст не обрезается.
  // VL-353: плюс машиночитаемое исправление `retryWith` — из него директива
  // собирает готовый вызов.
  const lastErrorBySignature = new Map<
    string,
    { text: string; fromHint: boolean; retryWith?: Record<string, unknown> }
  >();
  // VL-323: серия подряд повторов вызова, вернувшего ackError. Порог фазового
  // прерывания — MAX_ERROR_REPEATS_PER_RUN (5), не 3: модели нужно время
  // применить подсказку из текста ошибки (инцидент Close VL-320).
  let errorRepeatCount = 0;
  let errorRepeatSig: string | null = null;
  // VL-310: отчёт этой сессии уже записан вызывающим инструментом
  // (backlog_finish_phase/backlog_add_comment с успешным ack). Только в этом
  // случае повтор уже применённого вызова завершает ран штатно: терять
  // нечего, отчёт на месте (guard по образцу src/agent/auto-report.ts).
  let reportWritten = false;
  // Лимит guard'а зацикливания намерений (VL-119): N ходов подряд с одним
  // промежуточным текстом → fail штатным путём (контракт resume VL-103).
  const intentRepeatLimit = options.limits?.intentLoopRepeat ?? INTENT_LOOP_REPEAT_DEFAULT;
  // VL-229: guard повторов обращений (AC2). Стейт — на ран (resume сбрасывает,
  // риск 3 плана): прошлый ран уже отдал модели свои результаты. Отключается
  // repeatGuardDisabled — метрика repeat_stats считается всегда.
  const repeatGuard: RepeatGuard | null =
    options.limits?.repeatGuardDisabled === true
      ? null
      : createRepeatGuard({
          searchLimit: options.limits?.repeatSearchLimit ?? REPEAT_SEARCH_LIMIT_DEFAULT,
          readLimit: options.limits?.repeatReadLimit ?? REPEAT_READ_LIMIT_DEFAULT,
          // VL-254: shell-скелеты — самый частый вид зацикливания (VL-235: 65%)
          shellLimit: options.limits?.repeatShellLimit ?? REPEAT_SHELL_LIMIT_DEFAULT,
          // VL-284: write-повторы больше не «только в метрике» (инцидент close
          // VL-280: цикл `edit tools.ts` + `pnpm build` при payload 508 КБ)
          writeLimit: options.limits?.repeatWriteLimit ?? REPEAT_WRITE_LIMIT_DEFAULT,
          ...(options.limits?.repeatBlockMultiplier !== undefined
            ? { blockMultiplier: options.limits.repeatBlockMultiplier }
            : {}),
        });
  // VL-284: счётчик заблокированных вызовов за ран — кап блокировок, чтобы
  // сами директивы не раздували контекст (по образцу REPEAT_WARN_MAX_PER_RUN)
  let repeatBlockCount = 0;
  // Предупреждения, выданные в текущем ране (кап — REPEAT_WARN_MAX_PER_RUN)
  let repeatWarnCount = 0;
  // Компакшн истории (VL-122): хвост и порог; выключить можно --no-compact
  // (по умолчанию включён — комментарий Pavel к задаче).
  const compactEnabled = options.limits?.compactDisabled !== true;
  const compactTail = options.limits?.compactTailMessages ?? COMPACT_TAIL_DEFAULT;
  const compactAtTokens = options.limits?.compactAtTokens ?? COMPACT_AT_TOKENS_DEFAULT;
  // VL-254: байтовые пороги нужны и мягкому wall-time guard'у (сообщение
  // содержит payload и порог компакта), поэтому вычисляются до цикла, а не
  // внутри try на каждом ходе.
  const maxPayloadLimit = options.limits?.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  const payloadWarn =
    options.limits?.payloadWarnBytes ?? Math.floor(maxPayloadLimit * PAYLOAD_WARN_RATIO);
  // VL-254: доли бюджета времени, на которых модели уходит предупреждение
  const wallTimeWarnRatios = options.limits?.wallTimeWarnRatios ?? [0.7, 0.9];
  const warnedRatios = new Set<number>();

  const messages: ChatMessage[] = [...options.messages];
  /**
   * Дописывает сообщение в диалог и сразу уведомляет хук onMessage (VL-103):
   * headless/cli пишет jsonl сессии инкрементально — каждое сообщение цикла
   * уходит в файл сразу, а не по завершении фазы (обрыв процесса не теряет
   * последний доступный результат). Начальные сообщения в хук не попадают.
   */
  const pushMessage = (m: ChatMessage): Promise<void> => {
    messages.push(m);
    return Promise.resolve(options.onMessage?.(m));
  };
  // Внешние инструменты (VL-84) подмешиваются к локальным; конфликт имён —
  // отказ при старте: модель не должна получать два handler'а на одно имя.
  const externalTools = options.externalTools ?? [];
  for (const ext of externalTools) {
    if (options.tools.some((t) => t.name === ext.name)) {
      throw new Error(`Конфликт имён инструментов: ${ext.name} есть и локально, и в MCP`);
    }
  }
  const allTools = [...options.tools, ...externalTools];
  const byName = new Map<string, ToolSpec>(allTools.map((t) => [t.name, t]));
  // Сортировка по имени (VL-96): стабильный порядок tools между итерациями
  // и сессиями — одинаковый префикс запроса повышает шанс prefix-caching
  // у провайдера (гипотеза №3 плана VL-96)
  const sortedTools = [...allTools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const toolDefs: ToolDef[] = sortedTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const usage = zeroUsage();
  let numTurns = 0;
  let toolCallsTotal = 0;
  // Накопленный текст фазы: при ошибке уходит partial-результат (decision-4, п.1).
  let partialText = '';
  let prevSignature: string | null = null;
  let streak = 0;
  // Стейт guard'а фантомных tool_calls (VL-215): счётчик ходов ПОДРЯД,
  // содержащих tool_call с пустым name/id; 0 — чистый ход сбрасывает.
  let phantomStreak = 0;
  // Стейт guard'а пустого финала (VL-217): false — пустой финал ещё не
  // повторялся, true — повтор исчерпан (следующая пустота → fail с
  // диагностикой). Сброс не нужен: непустой текст финализирует цикл сходу,
  // флаг живёт в пределах одной фазы.
  let emptyFinalRetried = false;
  // Стейт guard'а зацикливания намерений (VL-119): предыдущий нормализованный
  // промежуточный текст и длина серии одинаковых. Пустой текст streak не
  // сбрасывает — молчаливые tool-ходы легитимны (решение плана VL-119).
  let prevIntent: string | null = null;
  let intentStreak = 0;
  // Стейт компакшна истории (VL-122): липкий якорь отсечения (индекс в
  // messages; null — не срабатывал) и usage-токены последнего ответа.
  // messages/jsonl при этом не мутируются — усекается только wire-payload.
  let compactFrom: number | null = null;
  let lastPromptTokens = 0;
  // VL-203: учёт wire-payload по ходам. Объявлены ДО fail() — иначе
  // возвраты ошибок не содержат диагностику (fail определяется раньше цикла).
  let lastPayload: number | undefined;
  let maxPayload: number | undefined;

  const duration = (): number => now() - startedAt;

  // VL-274: idle-watchdog фазы. Активность (токен стрима / завершённый
  // tool-вызов) переводит таймер заново; тишина дольше окна абортит сигнал —
  // тот же AbortSignal-путь, что у отмены фазы, поэтому висящего HTTP-запроса
  // не остаётся (AC6). Сигнал комбинированный: внешний options.signal (отмена)
  // ИЛИ idle-abort.
  const idleGuard = createIdleGuard({
    timeoutMs: idleTimeoutMs,
    now,
    ...(options.signal ? { externalSignal: options.signal } : {}),
  });
  const signal = idleGuard.signal;

  /**
   * Ошибка фазы: partial-текст + текст ошибки, без исключений наружу.
   *
   * Транскрипт всегда заканчивается assistant-сообщением (VL-103): текст
   * ошибки/результата дописывается в диалог — иначе jsonl сессии обрывается
   * на tool-сообщении, а --resume после ошибки сломан (LLM API отклонит
   * историю, оканчивающуюся tool-сообщением — см. комментарий VL-95).
   */
  const fail = (errorText: string): LoopResult => {
    // VL-274: снимаем idle-таймер на всех fail-путях — иначе он держит процесс/тесты
    idleGuard.dispose();
    // TUI-блок ошибок (VL-86): событие до возврата — headless его игнорирует
    options.onError?.(errorText);
    const resultText = partialText ? `${partialText}\n\n${errorText}` : errorText;
    pushMessage({ role: 'assistant', content: resultText });
    return {
      result: resultText,
      is_error: true,
      num_turns: numTurns,
      tool_calls_total: toolCallsTotal,
      duration_ms: duration(),
      usage,
      messages,
      last_payload_bytes: lastPayload,
      max_payload_bytes: maxPayload,
      repeat_stats: analyzeToolRepeats(messages),
      ...(repeatBlockCount > 0 ? { repeat_blocked: repeatBlockCount } : {}),
      // VL-251: новые сигнатуры блока — CLI дописывает их в мету сессии,
      // следующий resume блокирует повторы без исполнения (AC5)
      ...(blocked.size > blockedInitial.length
        ? { blocked_signatures: [...blocked].filter((s) => !blockedInitial.includes(s)) }
        : {}),
    };
  };

  /**
   * Штатное завершение рана на повторе уже применённого вызова (VL-304, VL-310).
   *
   * В VL-310 терминальный выход оставлен ТОЛЬКО для случая «отчёт уже
   * записан»: если модель повторила уже применённый вызов и в задаче есть
   * комментарий `@agent` за текущий ран, терять больше нечего. Если отчёта
   * нет — ран продолжается (см. `appliedNoopDirective` и
   * `MAX_APPLIED_REPEATS_PER_RUN`): терминальный выход на первом повторе
   * обрывал фазу на середине работы (сессия agent-1793637056809, Code VL-124).
   *
   * `is_error: false` — принципиально: оркестратор по нему решает, откатывать
   * ли статус (finalizePhaseStatus) и запускать ли авто-resume.
   *
   * Транскрипт обязан заканчиваться assistant-сообщением (VL-95/VL-103):
   * иначе resume получит историю, оканчивающуюся tool-сообщением, и LLM API
   * её отклонит.
   */
  const finishAppliedRepeat = (name: string): LoopResult => {
    idleGuard.dispose();
    const text =
      `Изменения применены, модель зациклилась на уже применённом вызове ${name} — ` +
      'ран завершён штатно, отчёт уже записан.';
    pushMessage({ role: 'assistant', content: text });
    return buildResult(text, false);
  };

  /**
   * Собирает LoopResult без побочных эффектов на диалог.
   *
   * Нужен обеим формам завершения (успех/ошибка с дописанным assistant-
   * сообщением): поля повторяются байт-в-байт, дублировать их в каждой ветке
   * значит разъехаться при следующем изменении (lesson-37).
   */
  const buildResult = (resultText: string, isError: boolean): LoopResult => ({
    result: resultText,
    is_error: isError,
    num_turns: numTurns,
    tool_calls_total: toolCallsTotal,
    duration_ms: duration(),
    usage,
    messages,
    last_payload_bytes: lastPayload,
    max_payload_bytes: maxPayload,
    repeat_stats: analyzeToolRepeats(messages),
    ...(repeatBlockCount > 0 ? { repeat_blocked: repeatBlockCount } : {}),
    ...(blocked.size > blockedInitial.length
      ? { blocked_signatures: [...blocked].filter((s) => !blockedInitial.includes(s)) }
      : {}),
  });

  /**
   * Обрыв фазы с блоком прогресса (VL-254).
   *
   * Отличие от fail() — только в поле `progress`: жёсткая проверка лимита
   * убивала фазу текстом «превышен лимит», и вся работа рана терялась (нет
   * коммита, нет отчёта — VL-235). Блок строится по фактическим следам работы
   * (правки-пути, последняя реплика модели) и уходит в мету сессии и
   * комментарий задачи через CLI.
   */
  const failWithProgress = (errorText: string, reason: RunProgressReason): LoopResult => {
    const base = fail(errorText);
    const progress = buildRunProgress({
      messages: base.messages,
      reason,
      durationMs: base.duration_ms,
      ...(maxPayload !== undefined ? { payloadBytes: maxPayload } : {}),
    });
    return { ...base, progress };
  };

  /**
   * VL-357 (шаг 5): есть ли у рана фактический след ВЫПОЛНЕННОЙ работы.
   *
   * Признаки взяты проверяемые, а не из самоотчёта модели: правка файла
   * (`edit`/`write_file`), коммит (`git_commit`), записанный отчёт фазы.
   * Именно они означают, что цель фазы достигнута и кап повторов — это
   * «модель зациклилась на уже сделанном», а не «работа не сделана».
   *
   * Ответ инструмента в расчёт НЕ берётся: заглушка, вернувшая `ok:true`, это
   * не работа (иначе регресс VL-124 — «ран завершён штатно» при недоработанной
   * задаче).
   */
  const runHasProgress = (): boolean => {
    if (reportWritten) return true;
    // Карта tool_call_id → содержимое ответа: имя вызова само по себе ничего
    // не доказывает (инцидент-ловушка: заглушка `git_commit`, ответившая
    // отказом, выдавала бы себя за выполненный коммит).
    const responses = new Map<string, string>();
    for (const m of messages) {
      if (m.role === 'tool' && m.tool_call_id !== undefined) {
        responses.set(m.tool_call_id, String(m.content ?? ''));
      }
    }
    /**
     * Ответ означает «вызов НЕ удался»: JSON с `ok:false` (ackError/ackDenied/
     * noop) либо текст-исключение. Плоский текст успешного локального
     * инструмента («файл записан») сюда не попадает.
     */
    const isFailureResponse = (content: string): boolean => {
      try {
        const parsed = JSON.parse(content) as { ok?: unknown; outcome?: unknown } | null;
        if (parsed === null || typeof parsed !== 'object') return false;
        if (parsed.ok === false) return true;
        return parsed.outcome === 'rejected' || parsed.outcome === 'noop';
      } catch {
        // Директива блокировки тоже лежит в tool-результате: вызов НЕ
        // исполнялся, и считать его работой нельзя (иначе кап повторов
        // «находит прогресс» ровно там, где его нет).
        if (content.startsWith('Loop detection') || content.startsWith('Вызов ')) return true;
        return /^Ошибка выполнения инструмента/.test(content);
      }
    };
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      for (const tc of m.tool_calls ?? []) {
        if (!isValidToolCall(tc)) continue;
        if (!WORK_EVIDENCE_TOOLS.has(tc.name)) continue;
        const content = responses.get(tc.id);
        if (content === undefined) continue; // вызов не дошёл до исполнения
        if (isFailureResponse(content)) continue;
        return true;
      }
    }
    return false;
  };

  /**
   * VL-357 (шаг 5): исчерпан кап повторов — решаем по прогрессу.
   *
   * До VL-357 любое исчерпание капа (`MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN`)
   * убивало ран кодом 1, даже когда работа была сделана: merge прошёл, 3455
   * тестов зелёные, а фаза падала на повторе `lesson_update` (регресс VL-349).
   * Теперь при наличии следа работы ран завершается ШТАТНО с блоком прогресса
   * (`buildRunProgress`), а `fail()` остаётся для недостигнутой цели.
   */
  const failOnRepeatCap = (errorText: string): LoopResult => {
    if (!runHasProgress()) return fail(errorText);
    idleGuard.dispose();
    const progress = buildRunProgress({
      messages,
      reason: 'other',
      durationMs: duration(),
      ...(maxPayload !== undefined ? { payloadBytes: maxPayload } : {}),
    });
    const text =
      `Кап повторов исчерпан: ${errorText}\n\nРабота в ране выполнена (правки/коммит/отчёт есть) — ` +
      'ран завершён штатно, отчёт пишется по фактическому результату.\n\n' +
      progress.text;
    pushMessage({ role: 'assistant', content: text });
    return { ...buildResult(text, false), progress };
  };

  for (;;) {
    // VL-274: idle-watchdog — первый по приоритету (AC9): если фаза зависла,
    // причина — простой, даже когда к этому моменту истёк и wall-time
    // (зависшая сессия не должна выглядеть как «сработал общий лимит»).
    // Проверка по своей отметке активности (токены стрима / завершённые
    // tool-вызовы); при idleTimeoutMs <= 0 выключена. Живая фаза отметку
    // обновляет и сюда не попадает — wall-time остаётся жёстким потолком.
    if (idleTimeoutMs > 0 && (idleGuard.timedOut() || idleGuard.idleMs() > idleTimeoutMs)) {
      return failWithProgress(idleTimeoutText(idleTimeoutMs), 'idle');
    }
    // Лимит wall-time — на каждой итерации, включая первую (0 мс — ок).
    if (duration() > maxWallTimeMs) {
      return failWithProgress(
        `Превышен лимит --max-wall-time (${Math.round(maxWallTimeMs / 1000)} секунд) — фаза прервана.`,
        'wall-time',
      );
    }
    // Лимит LLM-запросов (VL-104): проверяем ДО streamChat — не отправляем
    // запрос, который заведомо превысит лимит ходов (numTurns ещё не вырос).
    if (maxRequests !== undefined && numTurns + 1 > maxRequests) {
      return failWithProgress(`Превышен лимит --max-requests (${maxRequests}) — фаза прервана.`, 'max-requests');
    }
    // VL-254: мягкий guard бюджета времени. Пороги 70%/90% — по одному
    // сообщению на порог за ран (Set), каждое ≤400 символов: даже при
    // длинном ране это ≤800 байт контекста. Инъекция на границе хода (после
    // всех tool-результатов прошлого хода) не ломает паринг assistant↔tool
    // (lesson-91).
    if (maxWallTimeMs > 0) {
      const elapsed = duration();
      for (const ratio of wallTimeWarnRatios) {
        if (warnedRatios.has(ratio) || elapsed < maxWallTimeMs * ratio) continue;
        warnedRatios.add(ratio);
        await pushMessage({
          role: 'user',
          content: wallTimeWarnText(maxWallTimeMs - elapsed, maxWallTimeMs, lastPayload ?? 0, payloadWarn),
        });
      }
    }

    let response;
    try {
      // Компакшн истории (VL-122): триггер — usage-токены последнего ответа
      // (input + cache_read, обновляется после addUsage ниже). Якорь
      // вычисляется/сдвигается ПЕРЕД запросом — assistant(tool_calls) и
      // tool-результаты предыдущего хода уже в messages, хвост ровно N.
      // Re-anchor при повторном превышении порога (сессия снова раздулась).
      if (compactEnabled && lastPromptTokens >= compactAtTokens) {
        compactFrom = Math.max(messages.length - compactTail, 0);
      }
      // Если якорь установлен — в streamChat уходит wire-копия (system +
      // первый user со заметкой + хвост с якоря); messages остаются полными
      // (jsonl/resume/onMessage — без изменений). Липкий якорь: между
      // запросами префикс append-only — prefix-caching стабилен.
      // VL-216: санация отравленных пар (пустой id/tool_call_id) на payload-точке —
      // фантомная пара проходит орфан-гард compactWireMessages (хвост начинается
      // с assistant, а не tool); messages/jsonl остаются полными, чистится wire
      const payload = sanitizeWireMessages(
        compactFrom !== null ? compactWireMessages(messages, compactFrom) : messages,
      );
      // VL-230: байтовая оценка wire-копии ДО запроса (lesson-64 — одна точка
      // сериализации до fetch; здесь — оценка для триггера, точные байты
      // считает llm-клиент). Если >= порога (70% от лимита провайдера) —
      // предупреждение в stderr (→ logTail, lesson-77) и автокомпакт:
      // tool-выводы схлопываются до 2048 символов (эскалация до 1024).
      // НЕ мутирует messages/jsonl — трогаются только role='tool', AC/план
      // текущей задачи (system/user/assistant-тексты) не затрагиваются.
      // Работает и при --no-compact (compactDisabled): защита от отказа
      // провайдера, а не оптимизация контекста (VL-230).
      let wire = payload;
      const wireBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      // VL-254: лимит и порог посчитаны до цикла (нужны и мягкому guard'у).
      // Порог по умолчанию — 70% от действующего лимита (при override лимита
      // в тестах порог пересчитывается, а не остаётся от дефолтных 900 КБ).
      if (wireBytes >= payloadWarn) {
        console.error(
          `[vibelog-agent] предупреждение payload: ${wireBytes} байт >= порог ${payloadWarn} ` +
            `(70% от лимита ${maxPayloadLimit}) — история компактизируется перед запросом`,
        );
        wire = shrinkMessages(wire, PAYLOAD_COMPACT_TOOL_CHARS);
        const shrunkBytes = Buffer.byteLength(JSON.stringify(wire), 'utf8');
        // Эскалация: если после уровня 2048 байты всё ещё у жёсткого
        // лимита — дополнительно схлопываем до 1024 (уровень L2 VL-178).
        if (shrunkBytes >= maxPayloadLimit) {
          wire = shrinkMessages(wire, PAYLOAD_COMPACT_TOOL_CHARS_ESCALATED);
        }
      }
      response = await options.llm.streamChat(wire, toolDefs, {
        // VL-274: каждый токен стрима — активность для idle-watchdog (пауза
        // между токенами при долгом reasoning не считается зависанием).
        onToken: (t: string) => {
          idleGuard.noteActivity();
          options.onToken?.(t);
        },
        signal,
      });
    } catch (err) {
      // VL-274: аборт по простою — не ошибка API, а idle-обрыв: свой reason
      if (idleGuard.timedOut()) return failWithProgress(idleTimeoutText(idleTimeoutMs), 'idle');
      return fail(`Ошибка LLM-запроса: ${err instanceof Error ? err.message : String(err)}`);
    }
    addUsage(usage, response.usage);
    numTurns++;
    // VL-203: wire-payload этого хода — для JSONL (payload_bytes в
    // assistant-сообщении) и итоговой диагностики LoopResult
    if (response.payloadBytes !== undefined) {
      lastPayload = response.payloadBytes;
      maxPayload = Math.max(maxPayload ?? 0, response.payloadBytes);
    }
    // Порог компакшна запоминается после ответа — триггер сработает на
    // следующей итерации, когда в messages уже дописаны assistant/tool
    lastPromptTokens = response.usage.input_tokens + response.usage.cache_read_input_tokens;
    // Счётчики TUI (VL-86): кумулятивный usage + номер хода
    options.onUsage?.(usage, numTurns);

    // Нет tool_calls — финальный текст модели есть результат фазы.
    if (response.toolCalls.length === 0) {
      // Guard пустого финала (VL-110, инцидент VL-98): пустой ответ модели
      // (деградация на переполненном контексте) завершал фазу с exit 0 и
      // пустым result — оркестратор «успешно» закрывал фазу без отчёта и
      // смены статуса. Ошибка идёт штатным fail-путём: is_error=true,
      // assistant-сообщение дописывается в диалог (контракт resume VL-103).
      if (!response.text || response.text.trim() === '') {
        // VL-217: диагностика пустого финала в точке детекта — payload,
        // число сообщений, признак отравленных пар в истории и usage
        // уходят в stderr → logTail оркестратора (по образцу логов
        // VL-199 в llm.ts). Гипотеза VL-197: content-based отказы
        // наблюдались при payload >~140 КБ — фиксируем признак сразу.
        const diagPayload = response.payloadBytes ?? lastPayload;
        const hasEmptyToolCalls = messages.some(
          (m) =>
            (m.role === 'assistant' && !!m.tool_calls?.some((tc) => !isValidToolCall(tc))) ||
            (m.role === 'tool' && !(typeof m.tool_call_id === 'string' && m.tool_call_id.trim())),
        );
        const diag =
          `payload=${diagPayload ?? 'н/д'} байт ` +
          `(>140КБ=${diagPayload === undefined ? 'н/д' : diagPayload > 140 * 1024 ? 'да' : 'нет'}), ` +
          `сообщений=${messages.length}, ` +
          `есть-пустые-tool_calls=${hasEmptyToolCalls ? 'да' : 'нет'}, ` +
          `usage=${JSON.stringify(response.usage)}`;
        const attempt = emptyFinalRetried ? 2 : 1;
        console.error(`[vibelog-agent] пустой финал (попытка ${attempt}): ${diag}`);
        if (!emptyFinalRetried) {
          // Один повтор запроса (VL-217): payload пересобирается на верху
          // итерации — компакшн + sanitizeWireMessages (VL-216) санирует
          // отравленные пары, после чего уходит провайдеру повторно.
          // В messages ничего не дописывается — транскрипт чист.
          emptyFinalRetried = true;
          continue;
        }
        // Повтор тоже пуст: вероятна отравленная история (пары с пустым
        // id, вырезаемые на wire-границе) либо content-based отказ
        // провайдера. Маркер «Пустой ответ модели» обязателен — его
        // матчат guard'ы и тесты VL-110.
        return fail(
          `Пустой ответ модели: повтор после санации истории (VL-216/217) тоже пуст — ` +
            `вероятна отравленная история (пары с пустым id) либо отказ провайдера; ` +
            `${diag}. Фаза прервана как ошибка (VL-110).`,
        );
      }
      // VL-199: отказ провайдера может прийти валидным финальным текстом при
      // HTTP 200 (инцидент VL-197) — без этого guard'а фаза завершается
      // ложным успехом (is_error=false, exit 0) и авто-resume (VL-178,
      // требует is_error===true) не срабатывает. Маркер «high risk» обязателен
      // в тексте ошибки: guard оркестратора матчит его по result.result+logTail.
      if (isHighRiskBody(response.text)) {
        return fail(
          `Отказ провайдера «high risk»: ${response.text.slice(0, 300)} — фаза прервана как ошибка (VL-199).`,
        );
      }
      // Финальный ответ дописывается в диалог (VL-95): транскрипт сессии
      // должен заканчиваться assistant-сообщением — иначе при resume
      // история обрывается на tool-сообщении и LLM API её отклонит
      await pushMessage({
        role: 'assistant',
        content: response.text,
        usage: { ...response.usage },
        // VL-203: wire-диагностика в JSONL-транскрипт (плоские поля,
        // optional — мок-ответы без payloadBytes их не несут)
        ...(response.payloadBytes !== undefined ? { payload_bytes: response.payloadBytes } : {}),
        ...(response.shrinkLevel !== undefined ? { shrink_level: response.shrinkLevel } : {}),
      });
      // VL-274: успешный финал — снимаем idle-таймер (не держит процесс/тесты)
      idleGuard.dispose();
      return {
        result: response.text,
        is_error: false,
        num_turns: numTurns,
        tool_calls_total: toolCallsTotal,
        duration_ms: duration(),
        usage,
        messages,
        last_payload_bytes: lastPayload,
        max_payload_bytes: maxPayload,
        // VL-229 (AC1): метрика по всему транскрипту — включая прошлые раны
        repeat_stats: analyzeToolRepeats(messages),
      ...(repeatBlockCount > 0 ? { repeat_blocked: repeatBlockCount } : {}),
        // VL-251: блокировки, накопленные в этом ране (успешный финал)
        ...(blocked.size > blockedInitial.length
          ? { blocked_signatures: [...blocked].filter((s) => !blockedInitial.includes(s)) }
          : {}),
      };
    }
    // Guard зацикливания намерений (VL-119, инцидент VL-98): N ходов подряд
    // с идентичным промежуточным текстом (намерением) при РАЗНЫХ вызовах
    // инструментов сигнатурный детектор VL-83 пропускает. Сравнивается только
    // текст хода до tool_calls, после trim + схлопывания пробелов/переносов;
    // пустой текст не участвует (молчаливые tool-ходы легитимны) и streak
    // не сбрасывает. Fail идёт штатным fail()-путём (контракт resume VL-103)
    // ДО pushMessage текущего assistant(tool_calls): несработавший ход не
    // попадает в диалог и не выполняется — экономит wall-time.
    const intent = (response.text ?? '').trim().replace(/\s+/g, ' ');
    if (intent) {
      if (intent === prevIntent) {
        intentStreak++;
      } else {
        intentStreak = 1;
        prevIntent = intent;
      }
      if (intentStreak >= intentRepeatLimit) {
        return fail(
          `Зацикливание: ${intentStreak} ходов подряд с одним и тем же намерением — смени подход, проверь git status или уточни задачу.`,
        );
      }
    }
    // VL-215: фантомные tool_calls (пустые name/id) отфильтровываются ДО
    // записи assistant-сообщения — иначе в диалог попадает отравленная пара
    // assistant(tool_calls id="") + tool(tool_call_id="") и LLM API отклоняет
    // следующий ход (инцидент VL-214: mimo-v2.6-flash вернул {id:"",name:""}).
    const validCalls = response.toolCalls.filter(isValidToolCall);
    const phantomCount = response.toolCalls.length - validCalls.length;
    if (phantomCount > 0) {
      phantomStreak++;
      // Guard вечного повтора (по образцу loop detection VL-83): без него
      // модель, отдающая фантомы, крутилась бы до maxRequests/wall-time.
      if (phantomStreak >= PHANTOM_CALL_LIMIT_DEFAULT) {
        return fail(
          `Модель ${phantomStreak} раза подряд возвращала tool_call с пустым name/id — фаза прервана (VL-215).`,
        );
      }
    } else {
      phantomStreak = 0;
    }
    if (validCalls.length === 0) {
      // Только фантомы: assistant(tool_calls) НЕ пишется — пара с пустым
      // ключом не создаётся ни в диалоге, ни в jsonl (onMessage не зовётся).
      // Текст-ошибку отдаём модели отдельным user-сообщением: это не
      // tool(tool_call_id), провайдер его принимает. Ход повторяется —
      // модель может перезапустить вызов корректно либо завершить текстом.
      if (response.text) partialText += (partialText ? '\n' : '') + response.text;
      await pushMessage({
        role: 'user',
        content:
          'Ошибка ответа модели: tool_call с пустым name/id проигнорирован (VL-215). Повтори вызов с корректными name и id либо заверши финальным текстом.',
      });
      continue;
    }
    if (response.text) partialText += (partialText ? '\n' : '') + response.text;

    await pushMessage({
      role: 'assistant',
      content: response.text || null,
      tool_calls: validCalls,
      // usage ответа в транскрипт (VL-198): jsonl становится источником для
      // sumUsageFromMessages/fallback finish_phase; копия — аккумулятор
      // `usage` мутируется addUsage, привязывать ссылку нельзя
      usage: { ...response.usage },
      // VL-203: размер тела запроса и уровень компакшна tool-выводов —
      // AC3: JSONL фиксирует по ходам; провайдеру поля не уходят
      ...(response.payloadBytes !== undefined ? { payload_bytes: response.payloadBytes } : {}),
      ...(response.shrinkLevel !== undefined ? { shrink_level: response.shrinkLevel } : {}),
    });

    // VL-229: предупреждения о повторах собираются за ход и уходят модели
    // ОДНИМ user-сообщением ПОСЛЕ всех tool-результатов. Инъекция между
    // tool-результатами сломала бы паринг assistant↔tool (риск 1 плана).
    const repeatWarnings: string[] = [];
    for (const call of validCalls) {
      // Loop detection: сигнатура = имя + JSON аргументов; N подряд — вызов
      // блокируется (VL-251: раньше фаза падала сразу, а текст ошибки уходил
      // роли assistant — модель читала его как свой текст и после resume
      // повторяла тот же вызов; инцидент VL-234).
      const signature = `${call.name}|${JSON.stringify(call.arguments ?? {})}`;
      // Фатальный отказ нужен, если модель игнорирует директиву в tool-результате:
      // 2 заблокированных вызова ПОДРЯД — фаза прерывается штатным fail().
      // VL-253: плюс per-signature счётчик и общий кап рана — иначе при
      // чередовании сигнатур серия «подряд» сбрасывалась и луп шёл кругами.
      const blockAndPush = async (): Promise<void> => {
        // VL-309: noop — «изменений нет», а не «работа сделана». Ран НЕ
        // завершается: модели уходит директива «переходи к следующему шагу»,
        // фатальные счётчики не растут. Кап повторов — против вечного круга.
        if (noopSignatures.has(signature)) {
          // VL-310: считаем СЕРИЮ подряд (как у appliedSignatures): повтор,
          // перемежающийся с реальной работой, — не вечный цикл.
          if (noopRepeatSig === signature) {
            noopRepeatCount++;
          } else {
            noopRepeatSig = signature;
            noopRepeatCount = 1;
          }
          await pushMessage({
            role: 'tool',
            tool_call_id: call.id,
            content: noopRepeatDirective(call.name),
          });
          console.error(`[vibelog-agent] повтор noop-вызова: ${call.name}`);
          return;
        }
        // VL-303/VL-304/VL-310: вызов уже применён (ответ ok) — фатальные
        // счётчики НЕ растут, ран НЕ завершается: модели уходит директива
        // «переходи к отчёту», цикл продолжается. Терминальный выход остаётся
        // только для случая «отчёт уже записан» (reportWritten), иначе ран
        // обрывался на середине работы (сессия agent-1793637056809, VL-124).
        if (appliedSignatures.has(signature)) {
          if (appliedRepeatSig === signature) {
            appliedRepeatCount++;
          } else {
            appliedRepeatSig = signature;
            appliedRepeatCount = 1;
          }
          await pushMessage({
            role: 'tool',
            tool_call_id: call.id,
            content: appliedNoopDirective(call.name),
          });
          console.error(`[vibelog-agent] повтор применённого вызова: ${call.name}`);
          return;
        }
        // VL-323: вызов, вернувший отказ (ackError), — не луп «по сделанной
        // работе», а недопонимание причины отказа. Серия считается отдельно,
        // фатальные счётчики blockedStreak/blockedTotal не растут, а директива
        // несёт ТЕКСТ ошибки и требование исправить аргументы.
        if (errorSignatures.has(signature)) {
          noteErrorRepeat(signature);
          const last = lastErrorBySignature.get(signature);
          await pushMessage({
            role: 'tool',
            tool_call_id: call.id,
            content: loopDetectionDirective(
              call.name,
              repeatLimit,
              last?.text,
              last?.fromHint ?? false,
              last?.retryWith,
              call.arguments,
            ),
          });
          console.error(`[vibelog-agent] повтор вызова с отказом: ${call.name}`);
          return;
        }
        blockedStreak++;
        blocked.add(signature);
        blockCounts.set(signature, (blockCounts.get(signature) ?? 0) + 1);
        blockedTotal++;
        // Директива — tool-результатом (AC4): привязка tool_call_id
        // сохраняет паринг assistant↔tool, провайдер payload принимает.
        {
          const last = lastErrorBySignature.get(signature);
          await pushMessage({
            role: 'tool',
            tool_call_id: call.id,
            content: loopDetectionDirective(
              call.name,
              repeatLimit,
              last?.text,
              last?.fromHint ?? false,
              last?.retryWith,
              call.arguments,
            ),
          });
        }
        // Диагностика в точке срабатывания → logTail оркестратора (lesson-77)
        console.error(`[vibelog-agent] loop detection: ${call.name} заблокирован`);
      };

      /**
       * Исход повтора уже применённого вызова (VL-310).
       *
       * null — ран продолжается (модели уже ушла директива): обычный случай.
       * LoopResult — ран завершается: либо штатно (отчёт этой сессии уже
       * записан — терять нечего), либо честным fail() при исчерпании серии
       * (is_error:true → оркестратор откатит статус и запустит авто-resume).
       */
      /**
       * Сбрасывает серии повторов (VL-310).
       *
       * Вызывается на РЕАЛЬНО исполненном (не заблокированном) вызове: модель
       * попробовала что-то новое — это не вечный цикл. Без сброса ран падал
       * по капу, хотя между повторами шла нормальная работа (сессия
       * agent-1793637056809: document_update перемежался чтениями задачи).
       */
      const resetRepeatSeries = (signature?: string): void => {
        appliedRepeatCount = 0;
        appliedRepeatSig = null;
        noopRepeatCount = 0;
        noopRepeatSig = null;
        // VL-323: серию отказов рвёт только работа с ДРУГИМИ аргументами.
        // Повтор отказа исполняется (VL-318), поэтому reset вызывается и на
        // нём — сбрасывать тут серию нельзя, иначе защита от вечного круга
        // никогда не сработает. Набор errorSignatures не чистим: он про факт
        // отказа по этим аргументам.
        if (signature === undefined || !errorSignatures.has(signature)) {
          errorRepeatCount = 0;
          errorRepeatSig = null;
        }
      };

      /**
       * Исход повтора вызова, вернувшего ackError (VL-323).
       *
       * null — ран продолжается: модели ушла директива с текстом ошибки, она
       * может исправить аргументы. LoopResult — серия исчерпана
       * (MAX_ERROR_REPEATS_PER_RUN): честный fail() с последним текстом ошибки,
       * чтобы оркестратор откатил статус (защита от вечного круга).
       */
      /**
       * Учитывает очередное обращение к сигнатуре, вернувшей отказ (VL-323).
       *
       * Считаем и ИСПОЛНЕННЫЕ отказы, и заблокированные повторы: после порога
       * streak повторы блокируются и до handler не доходят, поэтому без учёта
       * блокировок счётчик застыл бы и вечный круг стал бы возможен.
       */
      const noteErrorRepeat = (signature: string): void => {
        if (errorRepeatSig === signature) {
          errorRepeatCount++;
        } else {
          errorRepeatSig = signature;
          errorRepeatCount = 1;
        }
      };

      const errorRepeatOutcome = (name: string, signature: string): LoopResult | null => {
        // Порог — «больше MAX»: модель получает до 5 обращений к отказавшему
        // вызову (из них ≥3 — директивы с текстом ошибки) прежде, чем ран
        // прерывается. Строгое < , а не <=: на 5-м обращении ещё даём шанс.
        if (errorRepeatCount <= MAX_ERROR_REPEATS_PER_RUN) return null;
        const detail = lastErrorBySignature.get(signature)?.text ?? '';
        // VL-357: кап отказавшего вызова — тоже с проверкой прогресса: если
        // работа рана уже сделана, падать из-за неисправимого повтора незачем.
        return failOnRepeatCap(
          `Loop detection: модель ${errorRepeatCount} раз подряд повторила вызов ${name} с одними и теми же аргументами, хотя он отклонялся с ошибкой${detail === '' ? '' : `: ${detail}`}.`,
        );
      };

      const appliedRepeatOutcome = (name: string): LoopResult | null => {
        if (reportWritten) return finishAppliedRepeat(name);
        if (appliedRepeatCount > MAX_APPLIED_REPEATS_PER_RUN) {
          return failOnRepeatCap(
            `Модель ${appliedRepeatCount} раз подряд повторила уже применённый вызов ${name} — повтор не исполнялся.`,
          );
        }
        return null;
      };

      // VL-309: повтор noop-вызова («изменений нет») — вызов НЕ исполняется,
      // но и ран НЕ завершается: модели уходит директива «переходи к
      // следующему шагу», цикл продолжается. Кап повторов — против вечного
      // круга; после исчерпания — честный fail() (работа не завершена),
      // чтобы оркестратор откатил статус и запустил авто-resume.
      if (noopSignatures.has(signature)) {
        await blockAndPush();
        if (noopRepeatCount > MAX_NOOP_REPEATS_PER_RUN) {
          return failOnRepeatCap(
            `Модель ${noopRepeatCount} раз повторила вызов ${call.name}, вернувший «изменений нет», — вызов не исполнялся.`,
          );
        }
        continue;
      }

      if (blocked.has(signature)) {
        // AC5: сигнатура отклонена в прошлом ране (resume) — не исполняем.
        // VL-253: первая такая блокировка в ране отдаёт директиву (модель
        // может сменить подход — тест VL-251 AC5), повторная — фазовый отказ.
        const repeatsBefore = blockCounts.get(signature) ?? 0;
        await blockAndPush();
        // VL-310: применённый вызов — не луп. Ран продолжается (директива уже
        // отправлена); терминально — только если отчёт этой сессии записан
        // либо исчерпана серия повторов.
        if (appliedSignatures.has(signature)) {
          const outcome = appliedRepeatOutcome(call.name);
          if (outcome !== null) return outcome;
          continue;
        }
        // VL-323: сигнатура отклонялась с ошибкой (ackError) — повторная
        // блокировка не фатальна: серия считается отдельно и ограничена
        // MAX_ERROR_REPEATS_PER_RUN, директива несёт текст ошибки.
        if (errorSignatures.has(signature)) {
          const outcome = errorRepeatOutcome(call.name, signature);
          if (outcome !== null) return outcome;
          continue;
        }
        if (repeatsBefore >= 1 || blockedTotal >= 2) {
          return fail(
            `Loop detection: инструмент ${call.name} вызван ${repeatLimit} раза подряд с одинаковыми аргументами — вызов повторно заблокирован (та же сигнатура уже отклонялась в этой сессии), фаза прервана. ${NEXT_STEP_HINT}`,
          );
        }
        continue;
      }

      // VL-303/VL-304/VL-310: сигнатура уже успешно применена (ответ ok) —
      // повтор НЕ исполняется: модели уходит директива «изменения применены,
      // переходи к отчёту», цикл продолжается. Фатальные счётчики не растут:
      // фаза не должна падать из-за повтора уже сделанной работы (AC2/AC3).
      if (appliedSignatures.has(signature)) {
        await blockAndPush();
        const outcome = appliedRepeatOutcome(call.name);
        if (outcome !== null) return outcome;
        continue;
      }

      if (signature === prevSignature) {
        streak++;
      } else {
        streak = 1;
        prevSignature = signature;
        // Серия прервалась: другой вызов — сбрасываем счётчик подряд идущих блоков
        // (per-signature счётчики и общий кап VL-253 при этом НЕ сбрасываются)
        blockedStreak = 0;
      }
      if (streak >= repeatLimit) {
        await blockAndPush();
        // VL-323: вызов отклонялся с ошибкой (ackError) — это не «модель
        // крутится на сделанной работе», а непонимание причины отказа. На
        // 3-м повторе фаза НЕ прерывается: модели ушла директива с текстом
        // ошибки и требованием исправить аргументы, серия ограничена
        // MAX_ERROR_REPEATS_PER_RUN (инцидент Close VL-320).
        if (errorSignatures.has(signature)) {
          const outcome = errorRepeatOutcome(call.name, signature);
          if (outcome !== null) return outcome;
          continue;
        }
        // VL-310: применённый вызов — не луп: ран продолжается (директива
        // уже отправлена), терминально — по общему правилу.
        if (appliedSignatures.has(signature)) {
          const outcome = appliedRepeatOutcome(call.name);
          if (outcome !== null) return outcome;
          continue;
        }
        // VL-253: повторная блокировка той же сигнатуры — немедленный fail,
        // без второго-третьего круга повторов (модель проигнорировала директиву)
        if (blockedStreak >= 2 || (blockCounts.get(signature) ?? 0) >= 2) {
          return fail(
            `Loop detection: инструмент ${call.name} вызван ${repeatLimit} раза подряд с одинаковыми аргументами — вызов заблокирован, фаза прервана (модель повторила заблокированный вызов). ${NEXT_STEP_HINT}`,
          );
        }
        if (blockedTotal >= MAX_BLOCKED_CALLS_PER_RUN) {
          return fail(
            `Loop detection: превышен кап заблокированных вызовов за ран (${MAX_BLOCKED_CALLS_PER_RUN}) — фаза прервана, модель не реагирует на директивы. ${NEXT_STEP_HINT}`,
          );
        }
        continue;
      }

      // Лимит tool-calls: проверяем ДО выполнения, чтобы не выполнять лишний вызов.
      if (toolCallsTotal + 1 > maxToolCalls) {
        // VL-221: явное разграничение счётчиков — лимит считает tool-calls
        // ТЕКУЩЕГО РАНА (сбрасывается при resume), requests в usage — это
        // LLM-запросы (ходы модели); прежнее сообщение без текущего значения
        // выглядело ложным при 51 запросе vs лимите 100 (VL-220).
        return fail(
          `Превышен лимит --max-tool-calls (${maxToolCalls}) tool-calls текущего рана: ${toolCallsTotal}/${maxToolCalls} — фаза прервана. Лимит считает tool-calls за ран (счётчик сбрасывается при resume); requests в usage — это LLM-запросы (ходы модели), а не tool-calls.`,
        );
      }
      // Кумулятивный per-session лимит (VL-223): база прошлых ранов +
      // вызовы этого. Проверяется ВТОРОЙ — при превышении обоих модель
      // видит более специфичный per-session текст. Выражение `+1` — это
      // «следующий вызов»: если он выходит за лимит, fail ДО выполнения.
      if (
        maxToolCallsPerSession !== undefined &&
        toolCallsSessionBase + toolCallsTotal + 1 > maxToolCallsPerSession
      ) {
        return fail(
          `Превышен кумулятивный лимит tool-calls сессии --tool-calls-per-session (${maxToolCallsPerSession}) — использовано ${toolCallsSessionBase + toolCallsTotal} из ${maxToolCallsPerSession} (включая прошлые раны), фаза прервана. Следующий (${toolCallsSessionBase + toolCallsTotal + 1}-й) вызов не выполнен.`,
        );
      }
      toolCallsTotal++;

      // VL-229: учёт повтора — ДО выполнения (счётчик фиксирует намерение;
      // провал handler'а тоже был обращением к тому же объекту). Кап
      // REPEAT_WARN_MAX_PER_RUN: без него зацикленный ране раздувал бы
      // контекст самими предупреждениями (риск 4 плана).
      // VL-284: здесь же — эскалация: после порога блокировки вызов НЕ
      // выполняется, модели уходит tool-результат с директивой. Порядок
      // важен: note() инкрементирует счётчик, shouldBlock() его читает.
      const callArgs = (call.arguments ?? {}) as Record<string, unknown>;
      let blockDirective: string | null = null;
      if (repeatGuard) {
        const warning = repeatGuard.note(call.name, callArgs);
        if (warning) {
          if (repeatWarnCount < REPEAT_WARN_MAX_PER_RUN) {
            repeatWarnCount++;
            repeatWarnings.push(warning);
          }
          // Диагностика в точке срабатывания → logTail оркестратора (lesson-77)
          console.error(`[vibelog-agent] повтор обращения: ${warning}`);
        }
        // VL-284: кап REPEAT_BLOCK_MAX_PER_RUN — зацикленный ран не должен
        // раздувать контекст самими директивами (симметрично капу warning'ов)
        if (repeatBlockCount < REPEAT_BLOCK_MAX_PER_RUN && repeatGuard.shouldBlock(call.name, callArgs)) {
          repeatBlockCount++;
          repeatGuard.noteBlocked();
          const blockKey = repeatKey(call.name, callArgs);
          const blockKind = toolRepeatKind(call.name);
          if (blockKey !== null && blockKind !== null) {
            blockDirective = repeatBlockDirective(
              blockKey,
              repeatGuard.countOf(call.name, callArgs),
              blockKind,
            );
            console.error(`[vibelog-agent] повтор заблокирован: ${blockKey}`);
          }
        }
      }

      const spec = byName.get(call.name);
      let output: string;
      let toolError = false;
      // VL-274: на время инструмента idle-таймер снимается — долгий
      // легитимный tool (`pnpm test` 20+ мин без вывода) не зависание;
      // зависший инструмент ловят его собственные таймауты и wall-time фазы.
      idleGuard.pause();
      if (blockDirective !== null) {
        // VL-284: блокировка — это tool-результат, а НЕ пропуск вызова:
        // парность assistant(tool_calls)↔tool обязательна, иначе провайдер
        // отклонит payload (риск 1 плана).
        output = blockDirective;
      } else if (!spec) {
        toolError = true;
        output = `Неизвестный инструмент: ${call.name}`;
      } else {
        options.onToolStart?.(call.name, call.arguments ?? {});
        try {
          output = await spec.handler(call.arguments ?? {}, {
            signal,
            // VL-254: остаток бюджета — run_shell_command усекает timeout_ms,
            // чтобы shell-таймаут не наложился на wall-time фазы
            remainingWallTimeMs: () => Math.max(maxWallTimeMs - duration(), 0),
          });
        } catch (err) {
          // Ошибка handler не фатальна: текст уходит модели как tool-результат.
          toolError = true;
          output = `Ошибка выполнения инструмента ${call.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      // VL-310: реально исполненный (не заблокированный) вызов рвёт серию
      // повторов — дальше кап считает заново.
      if (blockDirective === null && spec) resetRepeatSeries(signature);
      // VL-274: tool завершён — активность; окно простоя отсчитывается заново
      // (resume делает и noteActivity: длительность инструмента не «съедает» бюджет)
      idleGuard.resume();
      // VL-303/VL-304/VL-309: классифицируем ответ write-вызова:
      // ok:true → appliedSignatures (повтор завершает ран штатно),
      // noop:true → noopSignatures (повтор НЕ завершает ран, см. VL-309).
      // Парсинг в try/catch: текстовые ответы внешних MCP-инструментов не
      // должны ломать цикл.
      if (!toolError) {
        let applied = false;
        let noop = false;
        // VL-318: третий исход — JSON-отказ (ok:false, ackError/ackDenied).
        // Такой ответ НЕ применён: сигнатура не пополняет appliedSignatures,
        // повтор исполняется заново и модель получает свежий текст ошибки.
        let failed = false;
        try {
          const parsed = JSON.parse(output) as { ok?: unknown; noop?: unknown; read?: unknown } | null;
          if (parsed && typeof parsed === 'object' && parsed.noop === true) {
            noop = true;
          } else if (parsed && typeof parsed === 'object' && parsed.read === true) {
            // VL-351: чтение внутри write-инструмента (backlog_manage_*
            // action:list). Эффекта не было — сигнатура не пополняет ни
            // appliedSignatures, ни noopSignatures: повтор исполняется заново
            // и отдаёт свежее состояние, без ложной директивы «уже применён
            // ранее» (сессия agent-1794047067509, Close VL-349).
            applied = false;
          } else if (parsed && typeof parsed === 'object' && parsed.ok === true) {
            applied = true;
          } else if (parsed && typeof parsed === 'object' && parsed.ok === false) {
            // VL-318: ackError/ackDenied — отказ, а не «применено». Инцидент
            // agent-1793705489953 (Close VL-316): git_commit вернул
            // {"ok":false,"error":"… передай allowForeign: true"}, страховка
            // VL-306 сочла его применённым, и модель 4 раза получила ложное
            // «уже применено» вместо подсказки, как починить вызов → кап
            // MAX_APPLIED_REPEATS_PER_RUN → fail.
            failed = true;
          }
        } catch {
          // не JSON — исход неизвестен: ни applied, ни noop, ни failed.
          // VL-351: страховка VL-306 («не-JSON ответ write-инструмента =
          // применено») удалена. Она существовала, пока write-инструменты
          // отвечали плоским текстом, и превращала ЛЮБОЙ не-JSON ответ в
          // «применено» — в том числе чтение `backlog_manage_dod {action:list}`
          // (сессия agent-1794047067509: повтор чтения получал ложную
          // директиву «уже применён ранее»). Теперь все write-инструменты
          // отвечают JSON-ack (инвариант закреплён
          // src/mcp/write-ack-contract.test.mjs), поэтому не-JSON ответ —
          // неизвестный исход: повтор исполняется заново, а вечный круг
          // ограничивает обычный loop detection.
        }
        if (applied) {
          appliedSignatures.add(signature);
          // VL-310: отчёт этой сессии записан инструментом — теперь повтор
          // уже применённого вызова может завершать ран штатно (терять
          // нечего, отчёт на месте). Признак — успешный ack инструмента,
          // который пишет отчёт/комментарий фазы.
          if (isReportWritingTool(call.name)) reportWritten = true;
        }
        if (noop) noopSignatures.add(signature);
        // VL-323: отказ (ackError) — запоминаем факт и ТЕКСТ ошибки. Директива
        // блокировки для этой сигнатуры возьмёт текст отсюда и назовёт готовое
        // исправление (инцидент Close VL-320: подсказка «передай
        // allowForeign: true» была только в tool-результате и терялась).
        if (failed) {
          errorSignatures.add(signature);
          noteErrorRepeat(signature);
          const errorText = parsedErrorText(output);
          if (errorText !== null) lastErrorBySignature.set(signature, errorText);
        }
      }
      // VL-178: единый ingestion-cap ВСЕХ tool-выводов, включая внешние MCP
      // (chrome_devtools__take_snapshot приносил 624 КБ целиком — VL-110-cap
      // работал только для встроенных инструментов, MCP шёл мимо). Обрезка
      // ДО onToolEnd/pushMessage: в jsonl сессии и модели уходит ≤8KB + маркер.
      output = truncateToolOutput(output);
      // Хук завершения — и для неизвестного инструмента: TUI (VL-86) показывает
      // карточку со статусом error, а не теряет вызов модели
      options.onToolEnd?.(call.name, output, toolError);
      await pushMessage({ role: 'tool', tool_call_id: call.id, content: output });
    }
    // VL-229 (AC2): предупреждения о повторах — после всех tool-результатов
    // хода, одним user-сообщением. Стейт guard'а обновлён выше, в момент
    // выполнения вызова (там же — диагностика в stderr, lesson-77).
    if (repeatWarnings.length > 0) {
      await pushMessage({ role: 'user', content: repeatWarnings.join('\n') });
    }
    // VL-215: пометка в диалоге, что часть вызовов отброшена (модель увидит
    // результаты только валидных, ей нужно знать про игнорированные; в jsonl
    // тоже видно). console-лог не используем — сломал бы рендер TUI.
    if (phantomCount > 0) {
      await pushMessage({
        role: 'user',
        content: `Замечание: проигнорировано ${phantomCount} tool_call(ов) с пустым name/id (VL-215).`,
      });
    }
  }
}
