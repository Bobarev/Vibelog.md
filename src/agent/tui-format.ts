/**
 * Чистые функции форматирования TUI (VL-86).
 *
 * Без React — тестируются на dist/ напрямую (node --test src/agent).
 * Компоненты tui.tsx собирают строки из этих функций; вся логика обрезки
 * и счётчиков живёт здесь, чтобы рендер был тонким, а поведение строк —
 * проверяемым юнитами без терминала и Ink.
 */

/** Статус tool call в карточке TUI. */
export type ToolCallStatus = 'pending' | 'ok' | 'error';

/** Данные одной карточки tool call для форматирования. */
export interface ToolCallView {
  name: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  /** Длительность выполнения в мс; undefined — ещё выполняется/неизвестна. */
  durationMs?: number;
}

/** Иконки статусов карточек. */
const STATUS_ICONS: Record<ToolCallStatus, string> = {
  pending: '⏳',
  ok: '✅',
  error: '❌',
};

/**
 * Аргументы tool call одной строкой: JSON с обрезкой до max символов.
 * Обрезка с '…' — карточка не должна разъезжать по ширине терминала.
 */
export function formatToolArgs(args: Record<string, unknown> | undefined, max = 120): string {
  if (!args) return '';
  let json: string;
  try {
    json = JSON.stringify(args) ?? '';
  } catch {
    // Циклические структуры: JSON.stringify кидает — карточка не должна падать
    return '[непредставимые аргументы]';
  }
  return json.length > max ? json.slice(0, max - 1) + '…' : json;
}

/**
 * Строка карточки tool call: иконка статуса, имя, аргументы, длительность.
 * Длительность показывается, только если известна (завершённый вызов).
 */
export function formatToolCard(call: ToolCallView): string {
  const args = formatToolArgs(call.args);
  const duration = call.durationMs !== undefined ? ` ${call.durationMs} мс` : '';
  return `${STATUS_ICONS[call.status]} ${call.name}${args ? ` ${args}` : ''}${duration}`;
}

/**
 * Длительность MM:SS (часы — H:MM:SS); миллисекунды округляются вниз.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Счётчики TUI одной строкой: ход, токены in/out/cache, время фазы. */
export function formatCounters(c: {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  elapsedMs: number;
}): string {
  return (
    `ход ${c.turn} | in: ${c.inputTokens} | out: ${c.outputTokens} | ` +
    `cache: ${c.cacheTokens} | время ${formatDuration(c.elapsedMs)}`
  );
}

/**
 * Блок ошибок: каждая строка с префиксом '  ✖ ' — визуально отделён от потока.
 */
export function formatErrorBlock(lines: string[]): string[] {
  return lines.map((line) => `  ✖ ${line}`);
}
