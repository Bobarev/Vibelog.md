/**
 * Сводка сессии агента по jsonl-транскрипту (VL-261).
 *
 * Разбор сессий (VL-235, VL-242, VL-254, VL-243) каждый раз начинался с
 * ручного чтения килобайтов JSONL: «сколько было `run_shell_command`»,
 * «сколько `edit`», «какие раны», «какой payload по ранам». Цифры считались
 * заново руками и с ошибками (в VL-254 из-за ручного счёта в описание попала
 * неверная фаза и неверные границы ранов).
 *
 * Модуль — чистый (без fs и MCP, как repeat-tracker.ts): на вход массив
 * сообщений `ChatMessage[]` + мета сессии + записи billing, на выход — готовая
 * сводка. Чтение файлов — в CLI-обёртке (src/cli/commands/session.ts), поэтому
 * логика тестируется на фикстурах и переиспользуется будущим `/analyze`.
 *
 * Границы рана — user-сообщения-маркеры (промпт фазы начинается с «Ты — »
 * во всех templates/phases/*.md; resume-ран — «Продолжи…» от кнопки
 * «▶ Продолжить»/авто-повтора VL-178). Внутренние user-сообщения рана
 * (предупреждения repeat-guard VL-229, «Ошибка ответа модели» VL-215,
 * «Замечание: проигнорировано … tool_call» VL-215) границей НЕ являются.
 */

import { isValidToolCall, type ChatMessage } from './llm.js';
import { analyzeToolRepeats, toolRepeatTarget } from './repeat-tracker.js';
import type { RepeatStats } from './repeat-tracker.js';
import type { SessionMeta } from './session.js';
import type { BillingSession } from '../core/billing.js';

/**
 * Версия схемы `--json`: поднимается при любом несовместимом изменении
 * полей (потребители — /analyze и тесты).
 */
export const SESSION_SUMMARY_SCHEMA_VERSION = 1;

/** Сколько путей/скелетов показывать в топах по умолчанию. */
export const SUMMARY_TOP_LIMIT = 5;

/** Счётчик «путь/ключ → число обращений». */
export interface SummaryCount {
  key: string;
  count: number;
}

/** Скелет shell-команды и число повторов. */
export interface SummaryShellEntry {
  skeleton: string;
  count: number;
}

/** Агрегаты одного рана сессии. */
export interface SummaryRun {
  /** Номер рана, с 1. */
  index: number;
  /** Фаза рана: из billing → маркера промпта → meta.phase (null — не определена). */
  phase: string | null;
  /** Строка jsonl (1-based) первого сообщения рана. */
  startLine: number;
  /** Строка jsonl (1-based) последнего сообщения рана (включительно). */
  endLine: number;
  /** Начало рана (ISO): billing → meta.startedAt (только у первого рана). */
  startedAt: string | null;
  /** Конец рана (ISO): billing → meta.finishedAt (только у последнего рана). */
  finishedAt: string | null;
  /** Длительность рана (мс): billing → meta.durationMs (только у последнего рана). */
  durationMs: number | null;
  /** Число LLM-запросов (assistant-сообщений с usage, семантика sumUsageFromMessages). */
  requests: number;
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  total: number;
  /** Пик wire-payload запросов рана (VL-203); null — полей нет (старый jsonl). */
  maxPayloadBytes: number | null;
  /** Валидные tool-вызовы рана (фантомы VL-215 не считаются). */
  toolCalls: number;
  /** `инструмент → число вызовов` в ране. */
  tools: Record<string, number>;
  /** `путь → число правок` в ране (edit/write_file вместе). */
  editedFiles: Record<string, number>;
  /** Топ повторяющихся скелетов `run_shell_command` в ране. */
  shellTop: SummaryShellEntry[];
}

/** Сводка использования токенов по всей сессии. */
export interface SummaryTotals {
  lines: number;
  runs: number;
  requests: number;
  toolCalls: number;
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  total: number;
  /** `инструмент → число вызовов` по всему транскрипту. */
  tools: Record<string, number>;
  /** Топ повторяющихся скелетов shell по всей сессии. */
  shellTop: SummaryShellEntry[];
  /** Топ путей, которые читались (read_file). */
  topReadPaths: SummaryCount[];
  /** Топ путей, которые правились (edit + write_file). */
  editedFiles: SummaryCount[];
  /** Разбивка правок: только `edit` (VL-261: цифры AC4 требуются раздельно). */
  edits: SummaryCount[];
  /** Разбивка правок: только `write_file`. */
  writes: SummaryCount[];
  /** Метрика повторов repeat-tracker по всему транскрипту (VL-229). */
  repeatStats: RepeatStats;
}

/** Метаданные сессии в сводке (подмножество SessionMeta, безопасное для JSON). */
export interface SummaryMeta {
  phase: string | null;
  cwd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  model: string | null;
  agent: string | null;
}

/** Стабильная схема `--json` (AC2). */
export interface SessionSummary {
  schemaVersion: number;
  kind: 'session-summary';
  sessionId: string;
  path: string;
  taskId: string | null;
  meta: SummaryMeta;
  lines: number;
  runs: SummaryRun[];
  totals: SummaryTotals;
  /** Предупреждения данных (например, расхождение billing и числа ранов). */
  warnings: string[];
}

/** Вход сводки: сообщения транскрипта + мета + записи billing. */
export interface SessionSummaryInput {
  messages: ChatMessage[];
  sessionId: string;
  /** Путь к jsonl (для вывода); не читается — только отображается. */
  path: string;
  meta?: SessionMeta | null;
  /** Записи billing, уже отфильтрованные по sessionId (порядок — по finishedAt). */
  billingSessions?: BillingSession[];
  /** Размер топов (по умолчанию SUMMARY_TOP_LIMIT). */
  topLimit?: number;
}

/** Маркер начала рана: промпт фазы («Ты — автоматический исполнитель …»). */
const PHASE_PROMPT_MARKER = /^Ты — /;

/** Маркер resume-рана: «Продолжи…» (кнопка «▶ Продолжить», авто-повтор VL-178). */
const RESUME_MARKER = /^Продолжи/;

/**
 * Текст промпта фазы в шаблоне? По нему режется новый ран.
 *
 * @returns true, если сообщение — стартовый промпт фазы
 */
export function isPhasePromptMarker(text: string): boolean {
  return PHASE_PROMPT_MARKER.test(text.trimStart());
}

/**
 * Фаза по тексту промпта (первая строка шаблона templates/phases/*.md).
 *
 * @returns имя фазы либо null, если текст — не промпт фазы
 */
export function phaseFromPromptText(text: string): string | null {
  const head = text.slice(0, 400);
  const patterns: Array<[RegExp, string]> = [
    [/Фаза 1: Spec/, 'spec'],
    [/Фаза 2: Plan/, 'plan'],
    [/Фаза 3: Code/, 'code'],
    [/Фаза Do/, 'do'],
    [/Фаза Close/, 'close'],
    [/Фаза Comment/, 'comment'],
    [/Фаза Reject/, 'reject'],
    [/Фаза Analyze/, 'analyze'],
    [/Фаза Investigate/, 'investigate'],
    [/Фаза Materialize/, 'materialize'],
    [/команда prompt/, 'prompt'],
    [/команда analyze/, 'analyze'],
  ];
  for (const [re, phase] of patterns) {
    if (re.test(head)) return phase;
  }
  return null;
}

/**
 * Скелет shell-команды для топов повторов (AC3).
 *
 * Идея: разные вызовы одной операции («git status», «git status --porcelain»,
 * «git status -s») должны попадать в один ключ. Берём первый сегмент до
 * `&&`/`||`/`;`/`|`, оставляем первые два токена, остальные сворачиваем в
 * `<arg>`. Аргументы, похожие на числа/хэши/пути, тоже → `<arg>` (иначе
 * каждый `read_file`-путь давал бы свой «скелет»).
 *
 * @returns скелет (пустая строка для пустой команды)
 */
export function shellCommandSkeleton(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  // Первый сегмент составной команды: `git status && npm test` → `git status`
  const first = trimmed.split(/&&|\|\||;|\|/)[0].trim();
  const tokens = first.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  // Скелет = команда + второй токен; если второй токен — флаг (`grep -rn x`),
  // продолжаем собирать флаги, пока не встретим не-флаг (иначе терялись -rn/-e).
  // Не-флаговые аргументы после второго токена отбрасываются: иначе каждая
  // команда с путём/файлом была бы уникальной (`git status --porcelain` и
  // `git status -s` должны попасть в один ключ `git status`).
  const parts: string[] = [tokens[0]];
  let i = 1;
  if (tokens[i] !== undefined) {
    parts.push(tokens[i]);
    const secondIsFlag = tokens[i].startsWith('-');
    i += 1;
    if (secondIsFlag) {
      while (i < tokens.length && tokens[i].startsWith('-')) {
        parts.push(tokens[i]);
        i += 1;
      }
    }
  }
  // Кавычки/числа/хэши в позиции аргумента — не информативны, сворачиваем
  const mapped = parts.map((t, idx) =>
    idx === 0 || /^[-–]/.test(t) || /^[a-zA-Z_.\/-]+$/.test(t) && !/^\d+$/.test(t) ? t : '<arg>',
  );
  const skeleton = mapped.join(' ');
  return skeleton.length > 60 ? skeleton.slice(0, 60) : skeleton;
}

/** Копия счётчика в парах `{key, count}`, отсортированная по убыванию. */
function topFromMap(map: Map<string, number>, limit: number): SummaryCount[] {
  return [...map.entries()]
    // count 0 появляется в разбивке edits (edit+write_file минус write_file):
    // путь, правившийся только write_file, не должен попадать в edit-топ
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

/** Скелеты shell из счётчика. */
function shellTopFromMap(map: Map<string, number>, limit: number): SummaryShellEntry[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([skeleton, count]) => ({ skeleton, count }));
}

/** Аргумент-строка вызова инструмента (или null). */
function argString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Инструменты, которые считаются правкой файла (VL-261: edits vs writes). */
const EDIT_TOOLS = new Set(['edit', 'write_file']);
/** Инструменты чтения файла. */
const READ_TOOLS = new Set(['read_file']);

/** Внутренний аккумулятор рана — мутируется при одном forward-pass. */
interface RunAcc {
  startLine: number;
  endLine: number;
  marker: string | null;
  requests: number;
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  total: number;
  maxPayloadBytes: number | null;
  toolCalls: number;
  tools: Map<string, number>;
  editedFiles: Map<string, number>;
  shell: Map<string, number>;
}

function emptyRunAcc(startLine: number, marker: string | null): RunAcc {
  return {
    startLine,
    endLine: startLine,
    marker,
    requests: 0,
    input: 0,
    output: 0,
    cache: 0,
    reasoning: 0,
    total: 0,
    maxPayloadBytes: null,
    toolCalls: 0,
    tools: new Map(),
    editedFiles: new Map(),
    shell: new Map(),
  };
}

/**
 * Собирает сводку сессии (AC1–AC3) одним forward-pass по транскрипту.
 *
 * Семантика счётчиков совпадает с уже существующими функциями:
 * requests/токены — как sumUsageFromMessages (assistant + usage),
 * tool-calls — как countToolCallsInMessages (валидные, фантомы VL-215 не
 * считаются), repeatStats — готовый analyzeToolRepeats.
 */
export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  const { messages, sessionId, path } = input;
  const meta = input.meta ?? null;
  const topLimit = input.topLimit ?? SUMMARY_TOP_LIMIT;
  const billing = input.billingSessions ?? [];
  const warnings: string[] = [];

  // Строки jsonl = число сообщений (строка на сообщение); lines в AC1 — это
  // ровно количество сообщений транскрипта.
  const lines = messages.length;

  // Раны: собираем индексы user-сообщений-маркеров
  const runs: RunAcc[] = [];
  const toolsTotal = new Map<string, number>();
  const shellTotal = new Map<string, number>();
  const readsTotal = new Map<string, number>();
  const editsTotal = new Map<string, number>();
  const writesTotal = new Map<string, number>();
  let current: RunAcc | null = null;
  // Последняя строка с «содержательным» сообщением (assistant/tool) — по ней
  // закрывается ран: внутренние user-сообщения (guard/замечания) не должны
  // растягивать endLine за пределы фактических данных рана.
  let lastCountable = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const lineNo = i + 1;

    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : '';
      const isMarker = isPhasePromptMarker(text) || RESUME_MARKER.test(text.trimStart());
      if (isMarker) {
        // Новый ран: закрываем предыдущий на его последнем содержательном сообщении
        if (current) {
          current.endLine = Math.max(current.startLine, lastCountable);
          runs.push(current);
        }
        current = emptyRunAcc(lineNo, text);
        lastCountable = lineNo;
      }
      // Внутренние user-сообщения рана (guard/замечания) — не граница
      continue;
    }

    // system-сообщения не создают ран: system + промпт фазы = один ран, и
    // «пустой» ран из одного system исказил бы статистику (3 рана вместо 2)
    if (m.role === 'system') continue;

    // Сообщение вне рана (транскрипт без промпта — старый/обрезанный jsonl):
    // заводим «безымянный» ран с этой строки, чтобы данные не терялись
    if (!current) current = emptyRunAcc(lineNo, null);
    lastCountable = lineNo;

    if (m.role === 'assistant') {
      if (m.usage) {
        current.requests += 1;
        current.input += m.usage.input_tokens ?? 0;
        current.output += m.usage.output_tokens ?? 0;
        current.cache += m.usage.cache_read_input_tokens ?? 0;
        current.reasoning += m.usage.reasoning_tokens ?? 0;
        current.total += m.usage.total_tokens ?? 0;
      }
      if (typeof m.payload_bytes === 'number') {
        current.maxPayloadBytes = Math.max(current.maxPayloadBytes ?? 0, m.payload_bytes);
      }
      const calls = m.tool_calls ?? [];
      for (const tc of calls) {
        if (!isValidToolCall(tc)) continue; // фантомы VL-215
        current.toolCalls += 1;
        const name = tc.name;
        current.tools.set(name, (current.tools.get(name) ?? 0) + 1);
        toolsTotal.set(name, (toolsTotal.get(name) ?? 0) + 1);
        const args = (tc.arguments ?? {}) as Record<string, unknown>;
        if (name === 'run_shell_command') {
          const cmd = argString(args, 'command');
          if (cmd) {
            const sk = shellCommandSkeleton(cmd);
            if (sk) {
              current.shell.set(sk, (current.shell.get(sk) ?? 0) + 1);
              shellTotal.set(sk, (shellTotal.get(sk) ?? 0) + 1);
            }
          }
        }
        // Путь правки/чтения: через toolRepeatTarget (общая семантика ключей)
        const target = toolRepeatTarget(name, args) ?? argString(args, 'path');
        if (target) {
          if (EDIT_TOOLS.has(name)) {
            current.editedFiles.set(target, (current.editedFiles.get(target) ?? 0) + 1);
            editsTotal.set(target, (editsTotal.get(target) ?? 0) + 1);
            if (name === 'write_file') writesTotal.set(target, (writesTotal.get(target) ?? 0) + 1);
          } else if (READ_TOOLS.has(name)) {
            readsTotal.set(target, (readsTotal.get(target) ?? 0) + 1);
          }
        }
      }
    }
  }
  if (current) {
    current.endLine = Math.max(current.startLine, lastCountable);
    runs.push(current);
  }

  // Расхождение billing и ранов — не ошибка (billing пишется только для
  // задачных ранов), но молчать нельзя: фазы в отчёте брались бы «из воздуха»
  if (billing.length > 0 && billing.length !== runs.length) {
    warnings.push(`billing: ${billing.length} записей на ${runs.length} ранов`);
  }

  const metaPhase = meta?.phase ?? null;
  const summaryRuns: SummaryRun[] = runs.map((r, idx) => {
    const bill = billing[idx] ?? null;
    const markerPhase = r.marker ? phaseFromPromptText(r.marker) : null;
    const phase = bill?.phase ?? bill?.sessionPhase ?? markerPhase ?? metaPhase ?? null;
    const isFirst = idx === 0;
    const isLast = idx === runs.length - 1;
    return {
      index: idx + 1,
      phase,
      startLine: r.startLine,
      endLine: r.endLine,
      // startedAt осмысленно только у первого рана (в мете — начало сессии),
      // finishedAt/durationMs — только у последнего (мета хранит последний ран)
      startedAt: bill?.startedAt ?? (isFirst ? meta?.startedAt ?? null : null),
      finishedAt: bill?.finishedAt ?? (isLast ? meta?.finishedAt ?? null : null),
      durationMs: bill?.durationMs ?? (isLast ? meta?.durationMs ?? null : null),
      requests: r.requests,
      input: r.input,
      output: r.output,
      cache: r.cache,
      reasoning: r.reasoning,
      total: r.total,
      maxPayloadBytes: r.maxPayloadBytes,
      toolCalls: r.toolCalls,
      tools: Object.fromEntries([...r.tools.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
      editedFiles: Object.fromEntries(
        [...r.editedFiles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      ),
      shellTop: shellTopFromMap(r.shell, topLimit),
    };
  });

  const totals: SummaryTotals = {
    lines,
    runs: summaryRuns.length,
    requests: summaryRuns.reduce((s, r) => s + r.requests, 0),
    toolCalls: summaryRuns.reduce((s, r) => s + r.toolCalls, 0),
    input: summaryRuns.reduce((s, r) => s + r.input, 0),
    output: summaryRuns.reduce((s, r) => s + r.output, 0),
    cache: summaryRuns.reduce((s, r) => s + r.cache, 0),
    reasoning: summaryRuns.reduce((s, r) => s + r.reasoning, 0),
    total: summaryRuns.reduce((s, r) => s + r.total, 0),
    tools: Object.fromEntries(
      [...toolsTotal.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    shellTop: shellTopFromMap(shellTotal, topLimit),
    topReadPaths: topFromMap(readsTotal, topLimit),
    editedFiles: topFromMap(editsTotal, topLimit),
    edits: topFromMap(
      // edits — только инструмент `edit`: отдельный счётчик нужен, чтобы
      // цифры «18 edit / 5 write_file» из разбора воспроизводились буквально
      new Map([...editsTotal.entries()].map(([k, v]) => [k, v - (writesTotal.get(k) ?? 0)])),
      topLimit,
    ),
    writes: topFromMap(writesTotal, topLimit),
    repeatStats: analyzeToolRepeats(messages),
  };

  return {
    schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
    kind: 'session-summary',
    sessionId,
    path,
    taskId: meta?.taskId ?? null,
    meta: {
      phase: metaPhase,
      cwd: meta?.cwd ?? null,
      startedAt: meta?.startedAt ?? null,
      finishedAt: meta?.finishedAt ?? null,
      durationMs: meta?.durationMs ?? null,
      model: meta?.model ?? null,
      agent: meta?.agent ?? null,
    },
    lines,
    runs: summaryRuns,
    totals,
    warnings,
  };
}

/** Форматирует длительность в человекочитаемый вид (мс → «1м 20с»). */
function humanDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return 'н/д';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}м ${sec}с` : `${sec}с`;
}

/** Строка «`имя: 5, …`» из счётчика (пустой — «нет»). */
function pairsText(pairs: SummaryCount[], limit = 8): string {
  if (pairs.length === 0) return 'нет';
  return pairs.slice(0, limit).map((p) => `${p.key}×${p.count}`).join(', ');
}

/** Строка «`инструмент: 5`» из Record (пустой — «нет»). */
function recordText(rec: Record<string, number>, limit = 12): string {
  const entries = Object.entries(rec);
  if (entries.length === 0) return 'нет';
  return entries.slice(0, limit).map(([k, v]) => `${k}:${v}`).join(', ');
}

/**
 * Человекочитаемый вывод сводки (AC1/AC3) — без ANSI: тесты матчат подстроки.
 *
 * Печатаются только агрегаты (никаких тел сообщений) — инвариант экономии
 * контекста VL-178: транскрипты бывают по тысячи строк.
 */
export function formatSessionSummary(summary: SessionSummary): string {
  const out: string[] = [];
  const head = `Сводка сессии ${summary.sessionId}`;
  out.push(head);
  const metaBits: string[] = [];
  if (summary.taskId) metaBits.push(`задача ${summary.taskId}`);
  if (summary.meta.phase) metaBits.push(`фаза сессии ${summary.meta.phase}`);
  if (summary.meta.cwd) metaBits.push(`cwd ${summary.meta.cwd}`);
  if (summary.meta.model) metaBits.push(`модель ${summary.meta.model}`);
  if (metaBits.length > 0) out.push(`  ${metaBits.join(' | ')}`);
  out.push(`  файл: ${summary.path}`);
  out.push(
    `  строк: ${summary.lines}, ранов: ${summary.totals.runs}, ` +
      `LLM-запросов: ${summary.totals.requests}, tool-calls: ${summary.totals.toolCalls}`,
  );
  out.push(
    `  токены: input=${summary.totals.input}, output=${summary.totals.output}, ` +
      `cache=${summary.totals.cache}, reasoning=${summary.totals.reasoning}, total=${summary.totals.total}`,
  );
  for (const w of summary.warnings) out.push(`  ⚠️ ${w}`);

  out.push('');
  out.push('Раны:');
  if (summary.runs.length === 0) {
    out.push('  (нет)');
  }
  for (const run of summary.runs) {
    out.push(
      `  #${run.index} ${run.phase ?? '?'}: строки ${run.startLine}–${run.endLine}, ` +
        `запросов ${run.requests}, tool-calls ${run.toolCalls}, ${humanDuration(run.durationMs)}`,
    );
    const timing: string[] = [];
    if (run.startedAt) timing.push(`начало ${run.startedAt}`);
    if (run.finishedAt) timing.push(`конец ${run.finishedAt}`);
    if (timing.length > 0) out.push(`     ${timing.join(', ')}`);
    out.push(
      `     токены: input=${run.input}, output=${run.output}, cache=${run.cache}, ` +
        `reasoning=${run.reasoning}, total=${run.total}`,
    );
    out.push(`     max payload: ${run.maxPayloadBytes ?? 'н/д'} байт`);
    out.push(`     инструменты: ${recordText(run.tools)}`);
    if (Object.keys(run.editedFiles).length > 0) {
      out.push(
        `     правки: ${Object.entries(run.editedFiles).map(([k, v]) => `${k}×${v}`).join(', ')}`,
      );
    }
    if (run.shellTop.length > 0) {
      out.push(`     shell: ${run.shellTop.map((s) => `${s.skeleton}×${s.count}`).join(', ')}`);
    }
  }

  out.push('');
  out.push('Агрегаты по всей сессии:');
  out.push(`  инструменты: ${recordText(summary.totals.tools)}`);
  out.push(
    `  shell (скелеты): ${summary.totals.shellTop.map((s) => `${s.skeleton}×${s.count}`).join(', ') || 'нет'}`,
  );
  out.push(`  топ чтений: ${pairsText(summary.totals.topReadPaths)}`);
  out.push(`  правки (edit+write_file): ${pairsText(summary.totals.editedFiles)}`);
  out.push(`  edit: ${pairsText(summary.totals.edits)}`);
  out.push(`  write_file: ${pairsText(summary.totals.writes)}`);
  const rep = summary.totals.repeatStats;
  out.push(
    `  повторов: ${rep.repeat_calls}/${rep.tool_calls_total} ` +
      `(${Math.round(rep.repeat_share * 100)}%), топ: ${pairsText(rep.top.map((t) => ({ key: t.key, count: t.count })), 5)}`,
  );
  return out.join('\n');
}
