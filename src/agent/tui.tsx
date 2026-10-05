/**
 * TUI агента на Ink (VL-86): стриминг токенов, карточки tool calls,
 * счётчики и блок ошибок.
 *
 * Контракт вывода: TUI рендерится ТОЛЬКО в интерактивном режиме (cli.ts:
 * stdout.isTTY, без --headless/--output-format json/--no-tui) и живёт на
 * stderr в альтернативном буфере терминала — stdout остаётся под единственную
 * JSON-строку результата (контракт оркестратора VL-63 не меняется).
 *
 * Обновление — на событиях loop (VL-83): onToken/onToolStart/onToolEnd/
 * onUsage/onError. Состояние — внешний стор + useSyncExternalStore:
 * колбэки loop вызываются вне React-контекста и не трогают setState напрямую.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { Box, Text, render } from 'ink';
import type { LlmUsage } from './llm.js';
import {
  formatCounters,
  formatErrorBlock,
  formatToolCard,
  type ToolCallView,
} from './tui-format.js';

/** Хвост стриминга: сколько последних строк текста показывать (автопрокрутка). */
const STREAM_TAIL_LINES = 10;

/** Сколько последних карточек tool calls показывать. */
const TOOL_CARDS_VISIBLE = 8;

/** Сколько последних ошибок показывать. */
const ERRORS_VISIBLE = 5;

/** Внутренняя карточка: ToolCallView + служебные поля рендера. */
interface ToolCardState extends ToolCallView {
  /** React-key: стабильный id карточки (счётчик стора). */
  id: number;
  /** Момент onToolStart — для live-длительности pending-карточки. */
  startedAt?: number;
}

/** Состояние TUI; обновляется только через TuiStore (иммутабельно). */
interface TuiState {
  /** Завершённые куски текста модели (промежуточный текст до tool calls). */
  chunks: string[];
  /** Стриминг текущего хода (onToken, накапливается). */
  stream: string;
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
}

/** Мини-внешний стор: колбэки loop обновляют состояние, React слушает. */
function createStore() {
  let state: TuiState = {
    chunks: [],
    stream: '',
    tools: [],
    usage: null,
    turn: 0,
    startedAt: Date.now(),
    errors: [],
  };
  const listeners = new Set<() => void>();
  return {
    get: (): TuiState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch: Partial<TuiState>): void => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

type Store = ReturnType<typeof createStore>;

/** Стриминговый текст: хвост завершённых кусков + текущий поток. */
function StreamText({ chunks, stream }: { chunks: string[]; stream: string }): ReactElement {
  const all = [...chunks, stream].filter((s) => s.length > 0).join('\n');
  const tail = all.split('\n').slice(-STREAM_TAIL_LINES);
  return (
    <Box flexDirection="column">
      {tail.map((line, i) => (
        <Text key={i} color="cyan">
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** Карточка tool call: иконка статуса, имя, аргументы, длительность. */
function ToolCard({ card, now }: { card: ToolCardState; now: number }): ReactElement {
  const view: ToolCallView = {
    name: card.name,
    args: card.args,
    status: card.status,
    // У pending длительность тикает «на лету» по мере выполнения вызова
    durationMs:
      card.status === 'pending' && card.startedAt !== undefined
        ? now - card.startedAt
        : card.durationMs,
  };
  const color = card.status === 'pending' ? 'yellow' : card.status === 'ok' ? 'green' : 'red';
  return <Text color={color}>{formatToolCard(view)}</Text>;
}

/** Счётчики: ход, токены in/out/cache, время фазы. */
function Counters({
  turn,
  usage,
  startedAt,
  now,
}: {
  turn: number;
  usage: LlmUsage | null;
  startedAt: number;
  now: number;
}): ReactElement {
  return (
    <Text color="magenta">
      {formatCounters({
        turn,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheTokens: usage?.cache_read_input_tokens ?? 0,
        elapsedMs: now - startedAt,
      })}
    </Text>
  );
}

/** Блок ошибок фазы: русские тексты ошибок с префиксом ✖. */
function ErrorBlock({ errors }: { errors: string[] }): ReactElement | null {
  if (errors.length === 0) return null;
  return (
    <Box flexDirection="column">
      {formatErrorBlock(errors.slice(-ERRORS_VISIBLE)).map((line, i) => (
        <Text key={i} color="red">
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** Корневое приложение TUI: раскладка блоков + тик времени раз в секунду. */
function AgentApp({ store }: { store: Store }): ReactElement {
  const state = useSyncExternalStore(store.subscribe, store.get);
  // Тик раз в секунду: время фазы и pending-длительности обновляются live
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const now = Date.now();
  return (
    <Box flexDirection="column">
      <Counters turn={state.turn} usage={state.usage} startedAt={state.startedAt} now={now} />
      <StreamText chunks={state.chunks} stream={state.stream} />
      <Box flexDirection="column">
        {state.tools.slice(-TOOL_CARDS_VISIBLE).map((card) => (
          <ToolCard key={card.id} card={card} now={now} />
        ))}
      </Box>
      <ErrorBlock errors={state.errors} />
    </Box>
  );
}

/** Публичный handle TUI: колбэки loop (VL-83) + завершение. */
export interface TuiHandle {
  onToken(token: string): void;
  onToolStart(name: string, args: Record<string, unknown>): void;
  onToolEnd(name: string, output: string, isError?: boolean): void;
  onUsage(usage: LlmUsage, turn: number): void;
  onError(text: string): void;
  /** Размонтировать Ink и вернуть основной буфер терминала. */
  unmount(): void;
}

/**
 * Запускает TUI на stderr (альтернативный буфер) и возвращает колбэки loop.
 * Вызывается cli.ts только в интерактивном режиме; в headless не грузится
 * (динамический импорт) — ink/react не участвуют в контракте оркестратора.
 */
export function renderTui(): TuiHandle {
  const store = createStore();
  // Ввод TUI не нужен: Ctrl+C обрабатывает cli (SIGINT → abort loop).
  // Альтернативный буфер: скролл основного буфера не засоряется кадрами TUI.
  const out = process.stderr;
  const useAltBuffer = Boolean(out.isTTY);
  if (useAltBuffer) out.write('\u001b[?1049h\u001b[2J\u001b[H');
  const ink = render(<AgentApp store={store} />, { stdout: out, patchConsole: false });
  /** Имя → момент onToolStart (последний вызов имени — задержки редки). */
  const started = new Map<string, number>();
  /** Счётчик id карточек — стабильные React-ключи. */
  let cardSeq = 0;
  return {
    onToken(token: string): void {
      store.update({ stream: store.get().stream + token });
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
    unmount(): void {
      ink.unmount();
      if (useAltBuffer) out.write('\u001b[?1049l');
    },
  };
}
