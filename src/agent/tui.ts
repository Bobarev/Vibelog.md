/**
 * TUI агента на чистом Node.js (VL-155): стриминг токенов, карточки tool
 * calls, счётчики и блок ошибок. Zero deps — без Ink/React: только ANSI-коды
 * и записи в stderr (Ink 7 требует Node >=22 и ломал установку на Node 20).
 *
 * Контракт вывода (унаследован от Ink-версии VL-86): TUI рендерится ТОЛЬКО
 * в интерактивном режиме (cli.ts: stdout.isTTY, без --headless/--output-format
 * json/--no-tui) и живёт на stderr в альтернативном буфере терминала — stdout
 * остаётся под единственную JSON-строку результата (контракт оркестратора
 * VL-63 не меняется).
 *
 * Обновление — на событиях loop (VL-83): onToken/onToolStart/onToolEnd/
 * onUsage/onError. Состояние — простые переменные в store; колбэки loop
 * вызываются вне какого-либо рантайма и напрямую меняют состояние + вызывают
 * redraw(). Стриминг токенов дописывается в stderr напрямую (без полной
 * перерисовки); карточки/счётчики/ошибки — полная перерисовка кадра.
 */
import type { LlmUsage } from './llm.js';
import {
  assembleAssistantText,
  formatCounters,
  formatErrorBlock,
  formatToolCard,
  formatUserMessage,
  type ToolCallView,
} from './tui-format.js';

/** Хвост стриминга: сколько последних строк текста показывать (автопрокрутка). */
const STREAM_TAIL_LINES = 10;

/** Сколько последних записей ленты чата показывать (VL-113). */
const CHAT_VISIBLE = 30;

/** Сколько последних карточек tool calls показывать. */
const TOOL_CARDS_VISIBLE = 8;

/** Сколько последних ошибок показывать. */
const ERRORS_VISIBLE = 5;

/** Максимум символов в строке ввода (защита от случайной вставки гигантского текста). */
const INPUT_MAX_CHARS = 500;

// ANSI-цвета — замена <Text color=...> из Ink. Применяются только когда
// stderr.isTTY; в pipe/файле — голый текст (управпоследовательности в
// не-терминале — мусор).
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const BLUE_BOLD = '\x1b[1;34m';
const RESET = '\x1b[0m';

/** Обернуть текст ANSI-цветом (вне TTY — вернуть как есть). */
function paint(color: string, text: string, useColor: boolean): string {
  return useColor ? color + text + RESET : text;
}

/** Внутренняя карточка: ToolCallView + служебные поля рендера. */
interface ToolCardState extends ToolCallView {
  /** Стабильный id карточки (счётчик store) — различает повторные вызовы имени. */
  id: number;
  /** Момент onToolStart — для live-длительности pending-карточки. */
  startedAt?: number;
}

/**
 * Запись ленты чата (VL-113): завершённая реплика пользователя или
 * ассистента. Лента переживает ходы — реплика пользователя не стирается,
 * ответы не склеиваются между ходами.
 */
interface ChatEntry {
  /** Стабильный id записи (счётчик msgSeq store). */
  id: number;
  /** Кто говорил. */
  role: 'user' | 'assistant';
  /** Текст реплики; переносы строк сохраняются. */
  text: string;
}

/** Состояние TUI; обновляется только через store (иммутабельно). */
interface TuiState {
  /** Завершённые куски текста модели (промежуточный текст до tool calls). */
  chunks: string[];
  /** Стриминг текущего хода (onToken, накапливается). */
  stream: string;
  /** Лента завершённых реплик чата (VL-113): user/assistant, сквозь ходы. */
  messages: ChatEntry[];
  /** Счётчик id записей ленты — стабильные идентификаторы записей. */
  msgSeq: number;
  /** Карточки tool calls (последние вызовы). */
  tools: ToolCardState[];
  /** Накопленный usage модели (onUsage). */
  usage: LlmUsage | null;
  /** Номер текущего хода. */
  turn: number;
  /** Момент старта TUI — для счётчика времени фазы. */
  startedAt: number;
  /** Тексты ошибок фазы (лимиты, LLM API) — блок ошибок. */
  errors: string[];
  /** Строка ввода интерактивного TUI (VL-102); пустая в оркестраторном режиме. */
  input: string;
  /** Идёт ли ход чата: строка ввода блокируется (VL-102). */
  busy: boolean;
}

/**
 * Мини-store: колбэки loop пишут состояние через update(); колбэк redraw
 * назначается при сборке TUI. Режим silent — для стриминга: состояние
 * меняется без полной перерисовки (токен и так дописан в stderr напрямую).
 */
function createStore(): {
  get: () => TuiState;
  setRedraw: (fn: () => void) => void;
  update: (patch: Partial<TuiState>, options?: { silent?: boolean }) => void;
} {
  let state: TuiState = {
    chunks: [],
    stream: '',
    messages: [],
    msgSeq: 0,
    tools: [],
    usage: null,
    turn: 0,
    startedAt: Date.now(),
    errors: [],
    input: '',
    busy: false,
  };
  /** Полная перерисовка кадра; назначается в buildTui (до первого update). */
  let redraw: () => void = () => {};
  return {
    get: () => state,
    setRedraw: (fn) => {
      redraw = fn;
    },
    update: (patch, options) => {
      state = { ...state, ...patch };
      // silent — стриминг: токен уже дописан в stderr, полный redraw не нужен
      if (options?.silent !== true) redraw();
    },
  };
}

type Store = ReturnType<typeof createStore>;

/**
 * Отрисовка кадра целиком из состояния: очистка экрана + запись блоков.
 * Порядок блоков — как в Ink-версии AgentApp: header, лента чата, счётчики,
 * стрим (хвост), карточки, ошибки, строка ввода.
 */
function createRedraw(options: {
  store: Store;
  out: NodeJS.WriteStream;
  /** Заголовок шапки (интерактивный чат); в оркестраторном режиме — undefined */
  header?: string;
  /** Рисовать ли строку ввода (интерактивный чат, VL-102) */
  interactive: boolean;
  /** ANSI-цвета включены (stderr.isTTY) */
  useColor: boolean;
}): () => void {
  const { store, out, header, interactive, useColor } = options;
  return () => {
    // \x1b[2J — очистить экран, \x1b[H — курсор в начало; пишем всё заново
    out.write('\x1b[2J\x1b[H');
    const state = store.get();
    const now = Date.now();
    const lines: string[] = [];
    if (header !== undefined) lines.push(paint(BLUE_BOLD, header, useColor));
    // Лента чата: реплики пользователя cyan с префиксом '> ' (акцентная
    // раскраска qwen code), ответы ассистента без цвета; пустые пропускаются
    for (const m of state.messages.slice(-CHAT_VISIBLE)) {
      if (m.text.length === 0) continue;
      lines.push(m.role === 'user' ? paint(CYAN, formatUserMessage(m.text), useColor) : m.text);
    }
    // Счётчики: ход, токены in/out/cache, время фазы
    lines.push(
      paint(
        MAGENTA,
        formatCounters({
          turn: state.turn,
          inputTokens: state.usage?.input_tokens ?? 0,
          outputTokens: state.usage?.output_tokens ?? 0,
          cacheTokens: state.usage?.cache_read_input_tokens ?? 0,
          elapsedMs: now - state.startedAt,
        }),
        useColor,
      ),
    );
    // Стрим текущего хода: хвост завершённых кусков + текущий поток (cyan)
    const all = [...state.chunks, state.stream].filter((s) => s.length > 0).join('\n');
    const tail = all.split('\n').slice(-STREAM_TAIL_LINES);
    for (const line of tail) lines.push(paint(CYAN, line, useColor));
    // Карточки tool calls: иконка статуса, имя, аргументы, длительность.
    // У pending длительность тикает «на лету» по мере выполнения вызова
    for (const card of state.tools.slice(-TOOL_CARDS_VISIBLE)) {
      const view: ToolCallView = {
        name: card.name,
        args: card.args,
        status: card.status,
        durationMs:
          card.status === 'pending' && card.startedAt !== undefined
            ? now - card.startedAt
            : card.durationMs,
      };
      const color = card.status === 'pending' ? YELLOW : card.status === 'ok' ? GREEN : RED;
      lines.push(paint(color, formatToolCard(view), useColor));
    }
    // Блок ошибок фазы: русские тексты с префиксом ✖
    for (const line of formatErrorBlock(state.errors.slice(-ERRORS_VISIBLE))) {
      lines.push(paint(RED, line, useColor));
    }
    if (interactive) {
      lines.push(
        state.busy
          ? paint(YELLOW, '⏳ выполняется… Ctrl+C — выход', useColor)
          : paint(GREEN, `> ${state.input}_`, useColor),
      );
    }
    out.write(lines.join('\n') + '\n');
  };
}

/**
 * Публичный handle TUI: колбэки loop (VL-83) + завершение.
 * Сигнатуры не менялись относительно Ink-версии — cli.ts/interactive.ts
 * не переписывались.
 */
export interface TuiHandle {
  onToken(token: string): void;
  onToolStart(name: string, args: Record<string, unknown>): void;
  onToolEnd(name: string, output: string, isError?: boolean): void;
  onUsage(usage: LlmUsage, turn: number): void;
  onError(text: string): void;
  /**
   * Завершить ход чата (VL-113): перенести собранный стрим в ленту
   * сообщений ассистента и сбросить stream/chunks/tools — ответы ходов
   * не склеиваются. No-op при пустом стриме (повторный вызов безопасен).
   */
  finishTurn(): void;
  /** Размонтировать TUI: остановить тик, выйти из альтернативного буфера. */
  unmount(): void;
}

/**
 * Сборка TUI: альтернативный буфер, стор, redraw, тик раз в секунду и handle
 * колбэков loop. Общий каркас для renderTui/renderInteractiveTui — логика
 * карточек идентична, отличия только в раскладке/вводе.
 */
function buildTui(options: {
  /** Заголовок шапки; задаётся только интерактивным чатом (VL-102) */
  header?: string;
  /** Рисовать строку ввода (интерактивный чат, VL-102) */
  interactive: boolean;
}): { store: Store; handle: TuiHandle } {
  const store = createStore();
  const out = process.stderr;
  const useColor = Boolean(out.isTTY);
  // Альтернативный буфер: скролл основного буфера не засоряется кадрами TUI;
  // \x1b[2J\x1b[H — очистка + курсор в начало для первого кадра
  const useAltBuffer = useColor;
  if (useAltBuffer) out.write('\u001b[?1049h\u001b[2J\u001b[H');
  const redraw = createRedraw({
    store,
    out,
    header: options.header,
    interactive: options.interactive,
    useColor,
  });
  store.setRedraw(redraw);
  // Тик раз в секунду: время фазы и pending-длительности обновляются live
  const timer = setInterval(() => redraw(), 1000);
  /** Имя → момент onToolStart (последний вызов имени — задержки редки). */
  const started = new Map<string, number>();
  /** Счётчик id карточек — стабильные идентификаторы карточек. */
  let cardSeq = 0;
  const handle: TuiHandle = {
    onToken(token: string): void {
      // Стриминг: токен дописывается напрямую в stderr без перерисовки кадра;
      // состояние молча обновляется, чтобы redraw восстановил стрим из state
      store.update({ stream: store.get().stream + token }, { silent: true });
      out.write(paint(CYAN, token, useColor));
    },
    onToolStart(name: string, args: Record<string, unknown>): void {
      const state = store.get();
      cardSeq++;
      const startedAt = Date.now();
      started.set(name, startedAt);
      store.update({
        // Текущий стрим — промежуточный текст модели до tool call, уходит в хвост
        chunks: state.stream ? [...state.chunks, state.stream] : state.chunks,
        stream: '',
        tools: [...state.tools, { id: cardSeq, name, args, status: 'pending', startedAt }],
      });
    },
    onToolEnd(name: string, _output: string, isError?: boolean): void {
      const state = store.get();
      const startAt = started.get(name);
      started.delete(name);
      const durationMs = startAt !== undefined ? Date.now() - startAt : undefined;
      // Карточка ищется с конца: повторные вызовы имени обновляют последний
      const tools = [...state.tools];
      let updated = false;
      for (let i = tools.length - 1; i >= 0; i--) {
        if (tools[i].name === name && tools[i].status === 'pending') {
          tools[i] = { ...tools[i], status: isError ? 'error' : 'ok', durationMs };
          updated = true;
          break;
        }
      }
      if (!updated) {
        // Неизвестный инструмент: loop шлёт onToolEnd без onToolStart —
        // карточка создаётся на лету, чтобы вызов модели не потерялся
        cardSeq++;
        tools.push({ id: cardSeq, name, status: isError ? 'error' : 'ok', durationMs });
      }
      store.update({ tools });
    },
    onUsage(usage: LlmUsage, turn: number): void {
      store.update({ usage, turn });
    },
    onError(text: string): void {
      store.update({ errors: [...store.get().errors, text] });
    },
    finishTurn(): void {
      const state = store.get();
      // Собрать завершённый ответ: хвост chunks + текущий стрим; пустые
      // куски отбрасываются, переносы строк сохраняются (VL-113)
      const text = assembleAssistantText(state.chunks, state.stream);
      const hasText = text.length > 0;
      store.update({
        // Пустой ход (ошибка до первого токена) — no-op по тексту,
        // но служебное состояние всё равно сбрасываем
        messages: hasText
          ? [...state.messages, { id: state.msgSeq + 1, role: 'assistant' as const, text }]
          : state.messages,
        msgSeq: hasText ? state.msgSeq + 1 : state.msgSeq,
        chunks: [],
        stream: '',
        // Карточки tool calls предыдущего хода не должны копиться между ходами
        tools: [],
      });
    },
    unmount(): void {
      clearInterval(timer);
      if (useAltBuffer) out.write('\u001b[?1049l');
    },
  };
  // Первый кадр — сразу при сборке (в Ink это делал render())
  redraw();
  return { store, handle };
}

/**
 * Запускает TUI на stderr (альтернативный буфер) и возвращает колбэки loop.
 * Вызывается cli.ts только в интерактивном режиме; в headless не грузится
 * (динамический импорт) — TUI не участвует в контракте оркестратора.
 */
export function renderTui(): TuiHandle {
  // Ввод TUI не нужен: Ctrl+C обрабатывает cli (SIGINT → abort loop).
  return buildTui({ interactive: false }).handle;
}

/** Handle интерактивного TUI (VL-102): колбэки loop + управление строкой ввода. */
export interface InteractiveTuiHandle extends TuiHandle {
  /** Идёт ли ход чата: строка ввода блокируется, показывается «⏳ выполняется…». */
  setBusy(busy: boolean): void;
}

/**
 * Интерактивный TUI чата (VL-102): шапка с sessionId, строка ввода внизу.
 * Отличия от renderTui — только раскладка и ввод; колбэки loop те же.
 *
 * Ввод — process.stdin в raw mode (без readline: нужен посимвольный разбор
 * управляющих клавиш вне потока строк). Ctrl+C (\u0003)/Ctrl+D (\u0004) —
 * onExit: чат корректно закрывает MCP и завершает процесс. При busy ввод
 * игнорируется (кроме Ctrl+C/Ctrl+D) — второй запрос сломал бы историю.
 */
export function renderInteractiveTui(options: {
  /** Отправить текст пользователя в чат (Enter). */
  onSubmit: (text: string) => void;
  /** Выйти из чата (Ctrl+C/Ctrl+D). */
  onExit: () => void;
  /** Идентификатор сессии — в шапке TUI. */
  sessionId: string;
}): InteractiveTuiHandle {
  const { store, handle } = buildTui({
    header: `vibelog-agent · сессия ${options.sessionId}`,
    interactive: true,
  });
  const out = process.stderr;
  const stdin = process.stdin;
  // Вне TTY (pipe/файл) raw mode недоступен — ввод просто не подключаем
  const useStdin = Boolean(stdin.isTTY);
  const useColor = Boolean(out.isTTY);
  /** Перерисовать только нижнюю строку ввода — отзывчивый ввод без полного redraw. */
  const redrawInputLine = (): void => {
    const state = store.get();
    const line = state.busy
      ? paint(YELLOW, '⏳ выполняется… Ctrl+C — выход', useColor)
      : paint(GREEN, `> ${state.input}_`, useColor);
    // \r — в начало строки, \x1b[2K — очистить её
    out.write('\r\x1b[2K' + line);
  };
  /** Разбор ввода посимвольно: буфер может содержать несколько клавиш (вставка). */
  const onStdinData = (data: Buffer): void => {
    for (const ch of data.toString('utf8')) {
      // Выход работает всегда — не зависит от busy
      if (ch === '\u0003' || ch === '\u0004') {
        options.onExit();
        return;
      }
      const state = store.get();
      if (state.busy) return;
      if (ch === '\r' || ch === '\n') {
        const text = state.input.trim();
        if (text.length > 0) {
          // Реплика пользователя навсегда остаётся в ленте чата (VL-113):
          // id растёт через msgSeq store — стабильные идентификаторы
          store.update({
            input: '',
            msgSeq: state.msgSeq + 1,
            messages: [...state.messages, { id: state.msgSeq + 1, role: 'user', text }],
          });
          options.onSubmit(text);
        } else {
          store.update({ input: '' });
        }
        return;
      }
      if (ch === '\u007f' || ch === '\u0008') {
        // По символам, а не по байлам: slice(0,-1) сломал бы суррогатные пары (эмодзи)
        store.update({ input: Array.from(state.input).slice(0, -1).join('') }, { silent: true });
        redrawInputLine();
        return;
      }
      // Печатаемые символы (вставка приходит одной строкой); управляющие пропускаем
      const printable = ch.replace(/[\u0000-\u001f\u007f]/g, '');
      if (printable.length > 0) {
        store.update(
          { input: (state.input + printable).slice(0, INPUT_MAX_CHARS) },
          { silent: true },
        );
        redrawInputLine();
      }
    }
  };
  if (useStdin) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onStdinData);
  }
  // unmount: снять обработчик ввода и вернуть нормальный режим stdin
  const baseUnmount = handle.unmount;
  handle.unmount = (): void => {
    if (useStdin) {
      stdin.off('data', onStdinData);
      stdin.setRawMode(false);
      stdin.pause();
    }
    baseUnmount();
  };
  return {
    ...handle,
    setBusy(busy: boolean): void {
      store.update({ busy });
    },
  };
}
