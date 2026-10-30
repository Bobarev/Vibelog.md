/**
 * Обзор JSONL-транскрипта сессии агента (VL-258).
 *
 * Мотивация (VL-235, VL-250, VL-254): `.vibelog/agent-sessions/<id>.jsonl`
 * хранит по одной гигантской строке на сообщение — до 22–23 КБ, потому что
 * промпт фазы с блоком задачи повторяется в каждом resume. При лимите
 * tool-вывода 8 КБ за одно чтение видно 1–2 строки из 238, и вопросы «какая
 * фаза была активна», «сколько было ранов», «где строка с 22 КБ» требуют
 * десятков вызовов `read_file`.
 *
 * Обзор отвечает на них одним вызовом: по строке — индекс, роль, размер в
 * байтах, число и имена tool_calls, сниппет первых 80 символов, плюс
 * отдельная секция «Раны» (маркеры промптов фаз/«Продолжи» → строка).
 *
 * Модуль чистый (без fs, как session-summary.ts): на вход уже разобранные
 * сообщения и (опционально) байты исходных строк; чтение файлов — в
 * обёртках (`src/agent/tools.ts` — инструмент агента, `src/cli/commands/session.ts`
 * — CLI). Маркеры фаз переиспользуются из session-summary.ts, второй парсер
 * не создаём (lesson-37).
 */

import { isValidToolCall, type ChatMessage } from './llm.js';
import { isPhasePromptMarker, phaseFromPromptText } from './session-summary.js';

/** Сколько символов содержимого показывать в строке обзора. */
export const OUTLINE_SNIPPET_CHARS = 80;

/**
 * Бюджет вывода обзора: тот же лимит, что у tool-вывода агента
 * (TOOL_OUTPUT_MAX_CHARS в tools.ts). Своя константа, чтобы модуль не
 * зависел от модуля инструментов (иначе цикл импортов).
 */
export const OUTLINE_ENTRY_BUDGET_CHARS = 8 * 1024;

/**
 * Резерв бюджета под шапку/секцию «Раны»/маркер усечения: таблица строк
 * должна укладываться в общий лимит вместе с ними, иначе форматтер вылезает
 * за 8 КБ и ответ режется посреди строки (VL-258: 300 строк × ~110 симв.= 33 КБ).
 */
const OUTLINE_HEADER_RESERVE_CHARS = 768;

/** Максимальный размер jsonl, который обзор читает целиком (защита памяти). */
export const OUTLINE_MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Роль сообщения в обзоре (совпадает с ChatRole). */
export type OutlineRole = 'system' | 'user' | 'assistant' | 'tool';

/** Одна строка обзора = одно сообщение транскрипта. */
export interface SessionOutlineEntry {
  /** Номер строки jsonl (1-based). */
  line: number;
  role: OutlineRole;
  /** Размер исходной строки jsonl в байтах (или пересчёт по сообщению). */
  bytes: number;
  /** Число валидных tool_calls (фантомы VL-215 не считаются). */
  toolCalls: number;
  /** Уникальные имена инструментов в порядке первого появления. */
  toolNames: string[];
  /** Фаза рана: маркер промпта фазы либо 'resume' для «Продолжи…». */
  phase?: string;
  /** Номер рана (с 1); проставлен у строки-маркера рана. */
  runIndex?: number;
  /** Первые OUTLINE_SNIPPET_CHARS символов содержимого в одну строку. */
  snippet: string;
}

/** Маркер рана в секции «Раны». */
export interface SessionOutlineRun {
  index: number;
  line: number;
  phase: string | null;
}

/** Готовая схема обзора (используется в CLI --json и в тестах). */
export interface SessionOutline {
  kind: 'session-outline';
  sessionId: string;
  path: string;
  /** Всего строк транскрипта (сообщений). */
  lines: number;
  runs: SessionOutlineRun[];
  /** Размер самой большой строки в байтах (индикатор дублей промпта). */
  maxBytes: number;
  /** Строка с максимальным размером (1-based) — куда смотреть для экономии. */
  maxBytesLine: number;
  entries: SessionOutlineEntry[];
  truncated: boolean;
  /** 0-based индекс строки, с которой продолжать (null — показано всё). */
  nextOffset: number | null;
  warnings: string[];
}

/** Вход обзора: сообщения + метаданные файла и окно вывода. */
export interface SessionOutlineInput {
  messages: ChatMessage[];
  sessionId: string;
  path: string;
  /** Байты строк jsonl (по индексу сообщения); нет — пересчёт по сообщению. */
  lineBytes?: number[];
  /** 0-based номер строки начала окна. */
  offset?: number;
  /** Максимум строк в окне (до применения бюджета). */
  limit?: number;
  /** Бюджет символов форматированного вывода. */
  budget?: number;
}

/** Размер в байтах компактно: `312 B`, `1.2 KB`, `1.5 MB`. */export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Содержимое сообщения строкой: null/undefined → ''. */
function contentOf(m: ChatMessage): string {
  const c = (m as { content?: unknown }).content;
  return typeof c === 'string' ? c : '';
}

/** Сниппет в одну строку: переводы строк/табы → пробел, пробелы схлопнуты. */
function snippetOf(text: string, fallback: string): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat === '') return fallback;
  return flat.length > OUTLINE_SNIPPET_CHARS
    ? `${flat.slice(0, OUTLINE_SNIPPET_CHARS - 1)}…`
    : flat;
}

/** Валидные tool_calls сообщения (фантомы VL-215 отбрасываются). */
function toolCallsOf(m: ChatMessage): { count: number; names: string[] } {
  const calls = (m as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return { count: 0, names: [] };
  const names: string[] = [];
  let count = 0;
  for (const tc of calls) {
    if (!isValidToolCall(tc as { id: string; name: string; arguments: Record<string, unknown> })) continue;
    count += 1;
    const name = (tc as { name: string }).name;
    if (!names.includes(name)) names.push(name);
  }
  return { count, names };
}

/**
 * Собирает обзор транскрипта: маркеры ранов + компактные строки по сообщениям.
 *
 * Окно (`offset`/`limit`) применяется ДО бюджета, бюджет режет окно по
 * фактической длине форматированных строк — иначе 300 строк по ~110 символов
 * дают 33 КБ и обзор не влезает в один tool-вывод.
 *
 * @returns схема обзора; входные данные не мутируются
 */
export function buildSessionOutline(input: SessionOutlineInput): SessionOutline {
  const { messages, sessionId, path } = input;
  const warnings: string[] = [];
  const budget = input.budget ?? OUTLINE_ENTRY_BUDGET_CHARS;
  const offset = typeof input.offset === 'number' && input.offset > 0 ? Math.floor(input.offset) : 0;
  const limit =
    typeof input.limit === 'number' && input.limit > 0 ? Math.floor(input.limit) : messages.length;

  if (input.lineBytes !== undefined && input.lineBytes.length !== messages.length) {
    // Старый/обрезанный транскрипт: байты не совпадают с числом сообщений —
    // обзор остаётся работоспособным, размеры пересчитываются по сообщению.
    warnings.push(
      `размеры строк (${input.lineBytes.length}) не совпадают с числом сообщений (${messages.length}) — размеры пересчитаны`,
    );
  }

  const bytesAt = (i: number): number => {
    const fromFile = input.lineBytes?.[i];
    if (typeof fromFile === 'number' && Number.isFinite(fromFile) && fromFile >= 0) return fromFile;
    try {
      return Buffer.byteLength(JSON.stringify(messages[i]), 'utf8');
    } catch {
      return 0;
    }
  };

  // Полный проход по всем сообщениям: раны и максимум нужны независимо от окна.
  const runs: SessionOutlineRun[] = [];
  const allEntries: SessionOutlineEntry[] = [];
  let maxBytes = 0;
  let maxBytesLine = 0;
  let runIndex = 0;

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const role = m.role as OutlineRole;
    const text = contentOf(m);
    const bytes = bytesAt(i);
    if (bytes > maxBytes) {
      maxBytes = bytes;
      maxBytesLine = i + 1;
    }
    const entry: SessionOutlineEntry = {
      line: i + 1,
      role,
      bytes,
      toolCalls: 0,
      toolNames: [],
      snippet: '',
    };

    if (role === 'assistant') {
      const tools = toolCallsOf(m);
      entry.toolCalls = tools.count;
      entry.toolNames = tools.names;
      entry.snippet = snippetOf(text, tools.count > 0 ? '(tool_calls)' : '(пусто)');
    } else if (role === 'user') {
      const isMark = isPhasePromptMarker(text) || /^Продолжи/.test(text.trimStart());
      if (isMark) {
        runIndex += 1;
        const phase = isPhasePromptMarker(text) ? phaseFromPromptText(text) : 'resume';
        entry.phase = phase ?? 'unknown';
        entry.runIndex = runIndex;
        runs.push({ index: runIndex, line: i + 1, phase: phase ?? null });
      }
      entry.snippet = snippetOf(text, '(пусто)');
    } else {
      entry.snippet = snippetOf(text, role === 'tool' ? '(пусто)' : '(пусто)');
    }
    allEntries.push(entry);
  }

  // Окно и бюджет: считаем длину форматированной строки таблицы. Резерв
  // оставляем под шапку, секции «Раны»/предупреждения и маркер усечения.
  const window = allEntries.slice(offset, offset + limit);
  const entries: SessionOutlineEntry[] = [];
  let used = 0;
  const tableBudget = Math.max(OUTLINE_SNIPPET_CHARS + 64, budget - OUTLINE_HEADER_RESERVE_CHARS);
  for (let i = 0; i < window.length; i += 1) {
    const lineLen = formatEntryLine(window[i]).length + 1;
    if (entries.length > 0 && used + lineLen > tableBudget) break;
    entries.push(window[i]);
    used += lineLen;
  }
  const truncated = entries.length < window.length;
  const nextOffset = truncated ? offset + entries.length : null;

  return {
    kind: 'session-outline',
    sessionId,
    path,
    lines: messages.length,
    runs,
    maxBytes,
    maxBytesLine,
    entries,
    truncated,
    nextOffset,
    warnings,
  };
}

/** Колонки таблицы обзора (ширины подобраны под 200–300-строчные сессии). */
const COL_LINE = 5;
const COL_ROLE = 10;
const COL_BYTES = 9;

/** Маркер рана/инструментов для строки обзора. */
function entryMarker(e: SessionOutlineEntry): string {
  const parts: string[] = [];
  if (e.runIndex !== undefined) parts.push(`ран ${e.runIndex} → ${e.phase ?? '?'}`);
  if (e.toolCalls > 0) {
    parts.push(`${e.toolCalls} tools (${e.toolNames.join(', ')})`);
  }
  return parts.join('; ');
}

/** Одна строка таблицы обзора: `12  user  1.2 KB  ран 2 → plan  Ты — …`. */
function formatEntryLine(e: SessionOutlineEntry): string {
  const line = String(e.line).padStart(COL_LINE);
  const role = e.role.padEnd(COL_ROLE);
  const bytes = formatBytes(e.bytes).padStart(COL_BYTES);
  const marker = entryMarker(e);
  const head = `${line}  ${role}${bytes}${marker === '' ? '' : `  ${marker}`}`;
  return e.snippet === '' ? head : `${head}  ${e.snippet}`;
}

/**
 * Форматирует обзор для человека/модели: шапка → секция «Раны» → таблица
 * строк. «Раны» печатаются отдельно, чтобы фаза и её строка читались без
 * просмотра всего списка (главный вопрос при разборе сессии).
 */
export function formatSessionOutline(outline: SessionOutline): string {
  const parts: string[] = [];
  parts.push(
    `Сессия ${outline.sessionId}: ${outline.lines} строк, ${outline.runs.length} ранов, ` +
      `макс. строка ${formatBytes(outline.maxBytes)} (строка ${outline.maxBytesLine})`,
  );
  if (outline.warnings.length > 0) {
    for (const w of outline.warnings) parts.push(`⚠️ ${w}`);
  }
  if (outline.runs.length > 0) {
    const runsText = outline.runs
      .map((r) => `${r.index} → стр. ${r.line}${r.phase ? ` (${r.phase})` : ''}`)
      .join(', ');
    parts.push(`Раны: ${runsText}`);
  }
  if (outline.entries.length === 0) {
    parts.push('(строк в выбранном окне нет)');
  } else {
    parts.push(`Строки ${outline.entries[0].line}–${outline.entries[outline.entries.length - 1].line}:`);
    for (const e of outline.entries) parts.push(formatEntryLine(e));
  }
  if (outline.truncated && outline.nextOffset !== null) {
    parts.push(
      `…[обзор усечён: показаны строки ${outline.entries[0]?.line ?? '—'}–` +
        `${outline.entries[outline.entries.length - 1]?.line ?? '—'} из ${outline.lines}; ` +
        `продолжение — offset=${outline.nextOffset}]`,
    );
  }
  return parts.join('\n');
}
