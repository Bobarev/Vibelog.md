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

import { addUsage, zeroUsage, type ChatMessage, type LlmClient, type LlmUsage, type ToolDef } from './llm.js';
import type { ToolSpec } from './tools.js';

/** Лимиты цикла; дефолты — 100 tool-calls и 900 секунд wall-time. */
export interface LoopLimits {
  /** Максимум tool-calls фазы (дефолт 100, --max-tool-calls). */
  maxToolCalls?: number;
  /** Максимальное время фазы в миллисекундах (дефолт 900000, --max-wall-time). */
  maxWallTimeMs?: number;
  /**
   * Максимум LLM-запросов фазы (ходов модели, numTurns) — лимит запросов,
   * не tool-calls (VL-104). Без значения — без лимита.
   */
  maxRequests?: number;
  /** Сколько одинаковых подряд вызовов считать зацикливанием (дефолт 3). */
  loopDetectionRepeat?: number;
  /** Сколько ходов подряд с одним и тем же промежуточным текстом считать зацикливанием намерений (VL-119, дефолт 4). */
  intentLoopRepeat?: number;
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
   */
  compactDisabled?: boolean;
}

/** Результат фазы (совместим по полям с QwenResult CLI). */
export interface LoopResult {
  result: string;
  is_error: boolean;
  num_turns: number;
  duration_ms: number;
  usage: LlmUsage;
  /**
   * Полный диалог на момент завершения (VL-95): хранилище сессии
   * vibelog-agent. На fail-путях — накопленная история (частичный
   * диалог), чтобы resume не начинал беседу с чистого листа.
   */
  messages: ChatMessage[];
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
}

const MAX_TOOL_CALLS_DEFAULT = 100;
const MAX_WALL_TIME_MS_DEFAULT = 900_000;
const LOOP_DETECTION_REPEAT_DEFAULT = 3;
// Дефолт guard'а зацикливания намерений (VL-119): 4 хода подряд с одним
// промежуточным текстом. Порог 4, а не 3 — снизить ложные срабатывания:
// одинаковый короткий текст («Ок.») на паре ходов ещё не зацикливание.
const INTENT_LOOP_REPEAT_DEFAULT = 4;
// Компакшн истории (VL-122, wire-усечение по doc-13 §4.1): хвост 50 сообщений —
// tool-вывод ≤8KB (лимит VL-110, tools.ts) → ≤400KB ≈ ≤130K токенов ≈ 13% окна
// MiMo-V2.5 (1M) — попадает в рекомендованный doc-13 диапазон хвоста 10–15%.
// Триггер 850K = 85% окна (auto-порог doc-13 §4.0): редкое срабатывание почти
// не бьёт по prefix-caching (cache read MiMo дешёвый).
const COMPACT_TAIL_DEFAULT = 50;
const COMPACT_AT_TOKENS_DEFAULT = 850_000;

/**
 * Строит wire-копию истории для LLM-запроса (VL-122): system-сообщения +
 * первое user-сообщение (постановка) + сообщения с липкого якоря `from`.
 *
 * `messages` и jsonl-транскрипт НЕ мутируются — возвращается новый массив,
 * усекается только payload, уходящий в провайдер. Первый user в копии
 * получает дописанную служебную заметку об усечении; число опущенных
 * вычисляется детерминированно из якоря и не меняется между запросами
 * (append-only префикс — prefix-caching провайдера стабилен; маркер ломает
 * префикс ровно один раз — в момент сдвига якоря).
 *
 * Орфан-гард: хвост не должен начинаться с `role: 'tool'` без парного
 * assistant(tool_calls) — провайдер отклонит payload; начало хвоста
 * сдвигается вперёд, пока `messages[start].role === 'tool'`.
 *
 * Если отсекать нечего (якорь не за первым user / хвост пуст после
 * орфан-гарда) — возвращается исходный массив без маркера.
 */
export function compactWireMessages(messages: ChatMessage[], from: number): ChatMessage[] {
  // Отсекать нечего: якорь за пределами диапазона
  if (from <= 0 || from >= messages.length) return messages;
  // Первый user — «постановка задачи», сохраняем дословно (с заметкой)
  const firstUserIdx = messages.findIndex((m) => m.role === 'user');
  if (firstUserIdx === -1 || from <= firstUserIdx + 1) return messages;
  // Орфан-гард: хвост не начинается с tool-сообщения без парного assistant
  let start = from;
  while (start < messages.length && messages[start].role === 'tool') start++;
  // Хвост целиком состоит из tool-сообщений — компакшн пропускается
  if (start >= messages.length) return messages;
  const omitted = start - firstUserIdx - 1;
  const note = `[История усечена: опущено ${omitted} сообщений. Полный транскрипт — в сессии.]`;
  const head = messages.slice(0, firstUserIdx + 1);
  head[firstUserIdx] = { role: 'user', content: `${messages[firstUserIdx].content}\n\n${note}` };
  return [...head, ...messages.slice(start)];
}

/**
 * Выполняет tool-calling loop до финального текста модели, лимита или
 * loop detection. Все отказы превращаются в is_error=true с русским текстом —
 * CLI оборачивает результат в JSON и не зависает (AC#2 VL-75).
 */
export async function runLoop(options: RunLoopOptions): Promise<LoopResult> {
  const startedAt = Date.now();
  const maxToolCalls = options.limits?.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT;
  const maxWallTimeMs = options.limits?.maxWallTimeMs ?? MAX_WALL_TIME_MS_DEFAULT;
  // Лимит LLM-запросов (VL-104): без значения — без лимита (поведение прежнее)
  const maxRequests = options.limits?.maxRequests;
  const repeatLimit = options.limits?.loopDetectionRepeat ?? LOOP_DETECTION_REPEAT_DEFAULT;
  // Лимит guard'а зацикливания намерений (VL-119): N ходов подряд с одним
  // промежуточным текстом → fail штатным путём (контракт resume VL-103).
  const intentRepeatLimit = options.limits?.intentLoopRepeat ?? INTENT_LOOP_REPEAT_DEFAULT;
  // Компакшн истории (VL-122): хвост и порог; выключить можно --no-compact
  // (по умолчанию включён — комментарий Pavel к задаче).
  const compactEnabled = options.limits?.compactDisabled !== true;
  const compactTail = options.limits?.compactTailMessages ?? COMPACT_TAIL_DEFAULT;
  const compactAtTokens = options.limits?.compactAtTokens ?? COMPACT_AT_TOKENS_DEFAULT;

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

  const duration = (): number => Date.now() - startedAt;

  /**
   * Ошибка фазы: partial-текст + текст ошибки, без исключений наружу.
   *
   * Транскрипт всегда заканчивается assistant-сообщением (VL-103): текст
   * ошибки/результата дописывается в диалог — иначе jsonl сессии обрывается
   * на tool-сообщении, а --resume после ошибки сломан (LLM API отклонит
   * историю, оканчивающуюся tool-сообщением — см. комментарий VL-95).
   */
  const fail = (errorText: string): LoopResult => {
    // TUI-блок ошибок (VL-86): событие до возврата — headless его игнорирует
    options.onError?.(errorText);
    const resultText = partialText ? `${partialText}\n\n${errorText}` : errorText;
    pushMessage({ role: 'assistant', content: resultText });
    return {
      result: resultText,
      is_error: true,
      num_turns: numTurns,
      duration_ms: duration(),
      usage,
      messages,
    };
  };

  for (;;) {
    // Лимит wall-time — на каждой итерации, включая первую (0 мс — ок).
    if (duration() > maxWallTimeMs) {
      return fail(
        `Превышен лимит --max-wall-time (${Math.round(maxWallTimeMs / 1000)} секунд) — фаза прервана.`,
      );
    }
    // Лимит LLM-запросов (VL-104): проверяем ДО streamChat — не отправляем
    // запрос, который заведомо превысит лимит ходов (numTurns ещё не вырос).
    if (maxRequests !== undefined && numTurns + 1 > maxRequests) {
      return fail(`Превышен лимит --max-requests (${maxRequests}) — фаза прервана.`);
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
      const payload =
        compactFrom !== null ? compactWireMessages(messages, compactFrom) : messages;
      response = await options.llm.streamChat(payload, toolDefs, {
        onToken: options.onToken,
        signal: options.signal,
      });
    } catch (err) {
      return fail(`Ошибка LLM-запроса: ${err instanceof Error ? err.message : String(err)}`);
    }
    addUsage(usage, response.usage);
    numTurns++;
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
        return fail(
          'Пустой ответ модели: финальный текст без tool_calls пуст — фаза прервана как ошибка (VL-110).',
        );
      }
      // Финальный ответ дописывается в диалог (VL-95): транскрипт сессии
      // должен заканчиваться assistant-сообщением — иначе при resume
      // история обрывается на tool-сообщении и LLM API её отклонит
      await pushMessage({ role: 'assistant', content: response.text });
      return {
        result: response.text,
        is_error: false,
        num_turns: numTurns,
        duration_ms: duration(),
        usage,
        messages,
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
    if (response.text) partialText += (partialText ? '\n' : '') + response.text;

    await pushMessage({
      role: 'assistant',
      content: response.text || null,
      tool_calls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      // Loop detection: сигнатура = имя + JSON аргументов; N подряд — выход.
      const signature = `${call.name}|${JSON.stringify(call.arguments ?? {})}`;
      if (signature === prevSignature) {
        streak++;
      } else {
        streak = 1;
        prevSignature = signature;
      }
      if (streak >= repeatLimit) {
        return fail(
          `Loop detection: инструмент ${call.name} вызван ${repeatLimit} раза подряд с одинаковыми аргументами — фаза прервана. Проверь, не зациклился ли агент.`,
        );
      }

      // Лимит tool-calls: проверяем ДО выполнения, чтобы не выполнять лишний вызов.
      if (toolCallsTotal + 1 > maxToolCalls) {
        return fail(
          `Превышен лимит --max-tool-calls (${maxToolCalls}) — фаза прервана.`,
        );
      }
      toolCallsTotal++;

      const spec = byName.get(call.name);
      let output: string;
      let toolError = false;
      if (!spec) {
        toolError = true;
        output = `Неизвестный инструмент: ${call.name}`;
      } else {
        options.onToolStart?.(call.name, call.arguments ?? {});
        try {
          output = await spec.handler(call.arguments ?? {}, { signal: options.signal });
        } catch (err) {
          // Ошибка handler не фатальна: текст уходит модели как tool-результат.
          toolError = true;
          output = `Ошибка выполнения инструмента ${call.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      // Хук завершения — и для неизвестного инструмента: TUI (VL-86) показывает
      // карточку со статусом error, а не теряет вызов модели
      options.onToolEnd?.(call.name, output, toolError);
      await pushMessage({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
}
