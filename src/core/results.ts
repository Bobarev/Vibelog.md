/**
 * Results JSONL прогона эксперимента (VL-296, doc-21 §7).
 *
 * Строка результата — один вариант, применённый к одной строке датасета.
 * Ключ строки — пара `(task_id, variant)`: она делает запись **upsert**, а не
 * append. Причина в спецификации (§7): человек исправляет оценку, раннер
 * перезапускает одну задачу — append оставил бы два противоречащих числа,
 * и отчёт зависел бы от порядка строк в файле.
 *
 * Ключевые решения:
 * - **Перезапись файла атомарна** (temp-файл в том же каталоге + `rename`):
 *   SIGINT/падение процесса посреди записи не оставит половину JSON-строки,
 *   из-за которой следующий `record` не сможет прочитать файл. `rename`
 *   в пределах одного каталога атомарен и не пересекает границы ФС.
 * - **Ошибки чтения строк не бросают.** Битый JSON — запись в `errors[]`
 *   (как в датасете): частично испорченный файл полезнее исключения, а
 *   пользователь видит, что строка отброшена.
 * - **`score` может быть `null`** — это законное «оценка не получена»
 *   (нет judge, нет данных), а не отсутствие поля.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Допустимые виды ошибки (`error_kind`, doc-21 §7). */
export const RESULT_ERROR_KINDS = ['timeout', 'api', 'runner', 'judge', 'interrupted'] as const;
export type ResultErrorKind = (typeof RESULT_ERROR_KINDS)[number];

/** usage прогона (как в billing: input/output/cache/total/requests). */
export interface ResultUsage {
  input?: number;
  output?: number;
  cache?: number;
  total?: number;
  requests?: number;
}

/** Одна строка results.jsonl (doc-21 §7). */
export interface ResultRow {
  /** Ссылка на строку датасета. */
  task_id: string;
  /** Ключ варианта из `variants` карточки (A/B/C…). */
  variant: string;
  /** Основная метрика; `null` — оценка не получена. */
  score: number | null;
  /** Результат варианта (текст, ссылка, отчёт). */
  output?: string;
  /** Текст ошибки. */
  error?: string;
  /** Вид ошибки: timeout | api | runner | judge | interrupted. */
  error_kind?: string;
  /** Число tool-вызовов рана (AI-профиль). */
  tool_calls?: number;
  /** usage прогона. */
  usage?: ResultUsage;
  /** Стоимость варианта; `null` — тарифа нет. */
  cost?: number | null;
  /** Время выполнения задачи. */
  duration_ms?: number;
  /** Доп. метрики строки. */
  custom?: Record<string, unknown>;
}

/** Проблема одной строки results.jsonl (не исключение). */
export interface ResultError {
  /** Номер строки файла, 1-based. */
  line: number;
  /** Тип: json | task_id-missing | variant-missing | score-type. */
  kind: string;
  /** Сообщение на русском для пользователя. */
  message: string;
  /** Исходный текст строки (обрезан) — для диагностики. */
  raw?: string;
}

/** Результат разбора results.jsonl. */
export interface ParsedResults {
  rows: ResultRow[];
  errors: ResultError[];
}

/** Ключ upsert: пара (task_id, variant). */
export function resultKey(row: { task_id: string; variant: string }): string {
  return `${row.task_id}\u0000${row.variant}`;
}

/** Простой объект (не массив, не null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Нормализует строку результата из произвольного JSON-объекта.
 *
 * Экспортируется для CLI (`record --from-json`, отдельные флаги): валидация
 * строки должна быть одна, иначе ручной `record` и пачка строк разойдутся
 * в трактовке `score: null` и лишних полей.
 *
 * @returns строку или текст ошибки (kind + message)
 */
export function normalizeResultRow(raw: Record<string, unknown>):
  | { row: ResultRow }
  | { error: { kind: string; message: string } } {
  const taskIdRaw = raw.task_id;
  if (taskIdRaw === undefined || taskIdRaw === null || String(taskIdRaw).trim() === '') {
    return { error: { kind: 'task_id-missing', message: 'отсутствует обязательное поле task_id' } };
  }
  const variantRaw = raw.variant;
  if (variantRaw === undefined || variantRaw === null || String(variantRaw).trim() === '') {
    return { error: { kind: 'variant-missing', message: 'отсутствует обязательное поле variant' } };
  }
  // score отсутствует → null (doc-21 §7: «оценка не получена»)
  let score: number | null = null;
  if (raw.score !== undefined && raw.score !== null && raw.score !== '') {
    const num = Number(raw.score);
    if (!Number.isFinite(num)) {
      return { error: { kind: 'score-type', message: `score должен быть числом или null, получено "${String(raw.score)}"` } };
    }
    score = num;
  }
  const row: ResultRow = {
    task_id: String(taskIdRaw).trim(),
    variant: String(variantRaw).trim(),
    score,
    ...(raw.output !== undefined && raw.output !== null ? { output: String(raw.output) } : {}),
    ...(raw.error !== undefined && raw.error !== null ? { error: String(raw.error) } : {}),
    ...(raw.error_kind !== undefined && raw.error_kind !== null ? { error_kind: String(raw.error_kind) } : {}),
    ...(raw.tool_calls !== undefined && raw.tool_calls !== null && Number.isFinite(Number(raw.tool_calls))
      ? { tool_calls: Number(raw.tool_calls) }
      : {}),
    ...(isPlainObject(raw.usage) ? { usage: raw.usage as ResultUsage } : {}),
    ...(raw.cost === null
      ? { cost: null }
      : (raw.cost !== undefined && raw.cost !== '' && Number.isFinite(Number(raw.cost))
        ? { cost: Number(raw.cost) }
        : {})),
    ...(raw.duration_ms !== undefined && raw.duration_ms !== null && Number.isFinite(Number(raw.duration_ms))
      ? { duration_ms: Number(raw.duration_ms) }
      : {}),
    ...(isPlainObject(raw.custom) ? { custom: { ...raw.custom } } : {}),
  };
  return { row };
}

/**
 * Разбирает текст results.jsonl.
 *
 * Пустые строки пропускаются молча; номера строк в `errors` — 1-based по файлу.
 * Дубликаты ключа `(task_id, variant)` последней выигрывают: файл мог быть
 * испорчен ручной правкой (append), и «победа последней» совпадает с
 * семантикой upsert.
 */
export function parseResultsJsonl(text: string): ParsedResults {
  const rows: ResultRow[] = [];
  const errors: ResultError[] = [];
  const index = new Map<string, number>();

  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (raw.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push({
        line: lineNo,
        kind: 'json',
        message: `Строка ${lineNo}: битый JSON — ${(err as Error).message}`,
        raw: raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
      });
      continue;
    }
    if (!isPlainObject(parsed)) {
      errors.push({
        line: lineNo,
        kind: 'json',
        message: `Строка ${lineNo}: ожидался JSON-объект, получено ${Array.isArray(parsed) ? 'массив' : typeof parsed}`,
        raw: raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
      });
      continue;
    }
    const normalized = normalizeResultRow(parsed);
    if ('error' in normalized) {
      errors.push({ line: lineNo, kind: normalized.error.kind, message: `Строка ${lineNo}: ${normalized.error.message}` });
      continue;
    }
    const key = resultKey(normalized.row);
    const existing = index.get(key);
    if (existing !== undefined) {
      // Дубликат пары — побеждает последняя строка (семантика upsert)
      rows[existing] = normalized.row;
      continue;
    }
    index.set(key, rows.length);
    rows.push(normalized.row);
  }

  return { rows, errors };
}

/** Читает файл results.jsonl; отсутствующий файл — пустой набор (не ошибка). */
export function readResultsFile(path: string): ParsedResults {
  if (!existsSync(path)) return { rows: [], errors: [] };
  return parseResultsJsonl(readFileSync(path, 'utf-8'));
}

/**
 * Upsert строки по ключу `(task_id, variant)`.
 *
 * Позиция существующей строки сохраняется — файл не «прыгает» при правке
 * одной оценки, диффы в git остаются точечными. Новая строка добавляется в конец.
 *
 * @returns новый массив (входной не мутируется)
 */
export function upsertResult(rows: ResultRow[], row: ResultRow): ResultRow[] {
  const key = resultKey(row);
  const out = rows.slice();
  const idx = out.findIndex(r => resultKey(r) === key);
  if (idx >= 0) out[idx] = row;
  else out.push(row);
  return out;
}

/** Сериализует строки в JSONL (перевод строки в конце — если строки есть). */
export function serializeResultsJsonl(rows: ResultRow[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

/**
 * Атомарно перезаписывает файл results.jsonl.
 *
 * temp-файл создаётся в ТОМ ЖЕ каталоге: `rename` атомарен только в пределах
 * одной файловой системы, а `/tmp` может быть другим разделом. При ошибке
 * temp-файл удаляется, исходный остаётся нетронутым.
 */
export function rewriteResultsJsonl(path: string, rows: ResultRow[]): void {
  const dir = dirname(path);
  const tmp = join(dir, `.${process.pid}.${Date.now()}.results.tmp`);
  try {
    writeFileSync(tmp, serializeResultsJsonl(rows), 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Не заслоняем исходную ошибку записи сбоем уборки temp-файла
    }
    throw err;
  }
}

/**
 * Дописывает одну строку в results.jsonl.
 *
 * Одна строка — один `writeFileSync` с флагом `a`: ядро пишет её целиком,
 * поэтому половина строки не появится. Для перезаписи существующей пары
 * используйте `upsertResult` + `rewriteResultsJsonl`.
 */
export function appendResultsJsonl(path: string, row: ResultRow): void {
  writeFileSync(path, `${JSON.stringify(row)}\n`, { encoding: 'utf-8', flag: 'a' });
}

/** Путь к results.jsonl внутри каталога прогона. */
export function resultsPath(runDir: string): string {
  return join(runDir, 'results.jsonl');
}
