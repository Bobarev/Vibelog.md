/**
 * Dataset JSONL экспериментов (VL-295, doc-21 §5–§6).
 *
 * Строка датасета — задача (item) эксперимента: что подать в вариант и какой
 * результат считается правильным. Формат — JSONL, по строке на задачу.
 *
 * Ключевые решения:
 * - **Ошибки не бросают.** Датасет — пользовательские данные: битый JSON,
 *   отсутствие `task_id`, дубликат `task_id` дают запись в `errors[]`, а не
 *   исключение. Частичный прогон полезнее падения команды (doc-21 §5).
 * - **`expected` — только синоним для чтения.** Канон — `expected_ac`; при
 *   использовании синонима пишется warning, чтобы старые датасеты мигрировали.
 * - **`input` + `payload` одновременно — warning.** Выигрывает `payload`
 *   (структурированные данные не теряют информацию при сериализации).
 * - **Резолв частный → общий не молчит.** Если частный файл затенил общий,
 *   печатается warning в stderr, а структура резолва уходит в `meta.json`
 *   рана: молчаливый резолв — источник ложных выводов эксперимента (§6).
 *
 * Хелпер резолва (`resolveShadowing`) общий для datasets и prompts:
 * VL-296 использует его же для `variant.prompt`, поэтому одинаковое правило
 * «частный перекрывает общий» реализовано в одном месте.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, isAbsolute, relative, dirname, basename } from 'node:path';
import {
  experimentsDir, experimentsDatasetsDir, tasksDir, completedDir,
} from './paths.js';
import { markdownToTask } from './task.js';
import type { ChecklistItem } from './task.js';

/** Максимум строк датасета по умолчанию для `datasetFromCompleted`. */
export const DEFAULT_COMPLETED_LIMIT = 20;

/** Одна строка датасета (значения, которые реально поддерживает MVP). */
export interface DatasetRow {
  /** Ключ строки: уникален в датасете, используется в upsert `(task_id, variant)`. */
  task_id: string;
  /** «Ожидаемый результат»: критерий приёмки, эталонный ответ, ожидаемый вывод. */
  expected_ac?: string;
  /** Произвольный вход для manual runner (промпт, URL, входные данные). */
  input?: string;
  /** То же, что `input`, но структурировано; при конфликте выигрывает `payload`. */
  payload?: unknown;
  /** Доп. метрики строки — попадают в отчёт как custom-метрики. */
  custom?: Record<string, unknown>;
  /** Произвольные метаданные (не участвуют в расчётах). */
  meta?: Record<string, unknown>;
}

/** Проблема одной строки датасета (не исключение, а запись в отчёте). */
export interface DatasetError {
  /** Номер строки файла, 1-based (совпадает с номером в редакторе). */
  line: number;
  /** Тип проблемы: json | task_id-missing | task_id-duplicate | task_id-type. */
  kind: string;
  /** Сообщение на русском для пользователя. */
  message: string;
  /** Исходный текст строки (для диагностики, обрезан). */
  raw?: string;
}

/** Нежёсткая проблема строки: строка валидна, но данные стоит поправить. */
export interface DatasetWarning {
  /** Номер строки файла, 1-based. */
  line: number;
  /** Тип: expected-synonym | input-payload-conflict | … */
  kind: string;
  message: string;
}

/** Результат разбора JSONL-датасета. */
export interface ParsedDataset {
  /** Валидные строки в порядке файла. */
  rows: DatasetRow[];
  /** Отброшенные строки (битый JSON, нет task_id, дубликат). */
  errors: DatasetError[];
  /** Нежёсткие проблемы (синоним `expected`, конфликт input/payload). */
  warnings: DatasetWarning[];
}

/** Вид резолвимого файла: у датасетов JSONL, у промптов markdown. */
export type ResolveKind = 'dataset' | 'prompt';

/** Структура резолва для `meta.json` рана (doc-21 §6). */
export interface ResolutionInfo {
  /** 'private' — частный файл эксперимента, 'shared' — общий, 'explicit' — по пути. */
  chosen: 'private' | 'shared' | 'explicit';
  /** Путь относительно backlog-директории (не абсолютный: meta переносима). */
  path: string;
  /** Затенённый файл (есть только при коллизии частный/общий). */
  shadowed?: string;
}

/** Результат резолва файла эксперимента. */
export interface ResolvedFile {
  /** Абсолютный путь выбранного файла. */
  absolutePath: string;
  /** Путь относительно backlog-директории — то, что пишется в meta. */
  relativePath: string;
  resolution: ResolutionInfo;
  /** Тексты предупреждений (уже напечатаны в stderr, если не silent). */
  warnings: string[];
}

/** Опции резолва. */
export interface ResolveDatasetOptions {
  /** Escape hatch `--dataset-path`: перебивает резолв полностью (doc-21 §6). */
  explicitPath?: string;
  /** Не печатать warning в stderr (используется в тестах и при пакетном выводе). */
  silent?: boolean;
}

/** Расширение файла по виду артефакта. */
function extensionFor(kind: ResolveKind): string {
  return kind === 'dataset' ? '.jsonl' : '.md';
}

/**
 * Приводит `<name>` к имени файла нужного вида.
 *
 * Пользователь может передать `baseline` или `baseline.jsonl` — оба варианта
 * должны указывать на один файл, иначе резолв «не находит» то, что лежит рядом.
 */
function fileName(name: string, kind: ResolveKind): string {
  const ext = extensionFor(kind);
  const raw = String(name || '').trim();
  if (!raw) throw new Error('Не указано имя файла датасета/промпта');
  // Защита от выхода за каталог эксперимента: имя — это имя, а не путь
  const plain = basename(raw);
  if (plain !== raw) {
    throw new Error(`Имя не должно содержать путь: "${raw}". Укажите только имя файла`);
  }
  return plain.endsWith(ext) ? plain : `${plain}${ext}`;
}

/**
 * Ищет файл по правилу «частный → общий» (dataset или prompt).
 *
 * @param backlogDir — корень backlog-а
 * @param expId — id эксперимента (`exp-N`) для частного каталога
 * @param kind — вид артефакта ('dataset' | 'prompt')
 * @param name — имя файла без расширения (или с ним)
 * @returns структура резолва, `shadowed` заполнен только при коллизии
 */
export function resolveShadowing(
  backlogDir: string,
  expId: string,
  kind: ResolveKind,
  name: string
): { chosen: 'private' | 'shared'; absolutePath: string; relativePath: string; shadowed?: string; shadowedAbsolute?: string; checked: string[] } | null {
  const file = fileName(name, kind);
  const subdir = kind === 'dataset' ? 'datasets' : 'prompts';
  const privatePath = join(experimentsDir(backlogDir), expId, subdir, file);
  const sharedPath = join(experimentsDir(backlogDir), subdir, file);
  const checked = [privatePath, sharedPath];

  const hasPrivate = existsSync(privatePath);
  const hasShared = existsSync(sharedPath);
  const toRel = (p: string): string => relative(backlogDir, p).split('\\').join('/');

  if (hasPrivate) {
    return {
      chosen: 'private',
      absolutePath: privatePath,
      relativePath: toRel(privatePath),
      ...(hasShared ? { shadowed: toRel(sharedPath), shadowedAbsolute: sharedPath } : {}),
      checked,
    };
  }
  if (hasShared) {
    return {
      chosen: 'shared',
      absolutePath: sharedPath,
      relativePath: toRel(sharedPath),
      checked,
    };
  }
  return null;
}

/**
 * Резолвит датасет эксперимента: частный → общий, с escape hatch `--dataset-path`.
 *
 * Частный файл, затенивший общий, даёт warning в stderr (если не `silent`):
 * правило «не молча» из doc-21 §6 — иначе разница прогонов объясняется
 * забытым переопределением, а не вариантом.
 *
 * @throws если не найден ни один файл — с перечнем проверенных путей
 */
export function resolveDataset(
  backlogDir: string,
  expId: string,
  name: string,
  opts: ResolveDatasetOptions = {}
): ResolvedFile {
  const warnings: string[] = [];

  if (opts.explicitPath) {
    // --dataset-path трактуется относительно cwd (как путь в shell), а не backlog/
    const absolutePath = isAbsolute(opts.explicitPath)
      ? opts.explicitPath
      : join(process.cwd(), opts.explicitPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Файл датасета не найден: ${opts.explicitPath}`);
    }
    const rel = toRelative(backlogDir, absolutePath);
    const result: ResolvedFile = {
      absolutePath,
      relativePath: rel,
      resolution: { chosen: 'explicit', path: rel },
      warnings,
    };
    // При --dataset-path общий файл тоже может остаться в тени — сообщаем
    const sharedPath = join(experimentsDatasetsDir(backlogDir), fileName(name || basename(absolutePath), 'dataset'));
    if (name && existsSync(sharedPath)) {
      warnings.push(
        `--dataset-path перебивает резолв: общий датасет ${toRelative(backlogDir, sharedPath)} не используется`
      );
    }
    emitWarnings(warnings, opts.silent);
    return result;
  }

  const found = resolveShadowing(backlogDir, expId, 'dataset', name);
  if (!found) {
    const file = fileName(name, 'dataset');
    const checked = [
      toRelative(backlogDir, join(experimentsDir(backlogDir), expId, 'datasets', file)),
      toRelative(backlogDir, join(experimentsDir(backlogDir), 'datasets', file)),
    ];
    throw new Error(`Датасет "${name}" не найден. Проверены пути: ${checked.join(', ')}`);
  }
  if (found.shadowed) {
    warnings.push(
      `частный датасет ${found.relativePath} затеняет общий ${found.shadowed} — «для всех» правки в общем файле на этот эксперимент не действуют`
    );
  }
  emitWarnings(warnings, opts.silent);
  return {
    absolutePath: found.absolutePath,
    relativePath: found.relativePath,
    resolution: {
      chosen: found.chosen,
      path: found.relativePath,
      ...(found.shadowed ? { shadowed: found.shadowed } : {}),
    },
    warnings,
  };
}

/** Путь относительно backlog-а (для meta) либо абсолютный, если вне его. */
function toRelative(backlogDir: string, absolutePath: string): string {
  const rel = relative(backlogDir, absolutePath);
  return (rel.startsWith('..') ? absolutePath : rel).split('\\').join('/');
}

/** Печатает предупреждения в stderr (единственный канал, который видит CI/агент). */
function emitWarnings(warnings: string[], silent?: boolean): void {
  if (silent) return;
  for (const w of warnings) console.error(`Предупреждение: ${w}`);
}

/** Проверяет, что значение — простой объект (не массив, не null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Разбирает JSONL-датасет.
 *
 * Пустые строки пропускаются молча — файл, заканчивающийся переводом строки,
 * не должен давать «битую строку». Номера строк в `errors` 1-based по файлу.
 */
export function parseDatasetJsonl(text: string): ParsedDataset {
  const rows: DatasetRow[] = [];
  const errors: DatasetError[] = [];
  const warnings: DatasetWarning[] = [];
  const seen = new Set<string>();

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

    const rawId = parsed.task_id;
    if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
      errors.push({
        line: lineNo,
        kind: 'task_id-missing',
        message: `Строка ${lineNo}: отсутствует обязательное поле task_id`,
        raw: raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
      });
      continue;
    }
    if (typeof rawId !== 'string' && typeof rawId !== 'number') {
      errors.push({
        line: lineNo,
        kind: 'task_id-type',
        message: `Строка ${lineNo}: task_id должен быть строкой или числом`,
      });
      continue;
    }
    const taskId = String(rawId).trim();
    if (seen.has(taskId)) {
      // Дубликат рвёт upsert (task_id, variant): оставляем первую строку
      errors.push({
        line: lineNo,
        kind: 'task_id-duplicate',
        message: `Строка ${lineNo}: дубликат task_id "${taskId}" — строка пропущена (действует первая)`,
      });
      continue;
    }
    seen.add(taskId);

    const row: DatasetRow = { task_id: taskId };

    // expected_ac: канон; expected — синоним только для чтения
    let expectedAc: string | undefined;
    if (parsed.expected_ac !== undefined && parsed.expected_ac !== null) {
      expectedAc = String(parsed.expected_ac);
    }
    if (parsed.expected !== undefined && parsed.expected !== null) {
      const legacy = String(parsed.expected);
      warnings.push({
        line: lineNo,
        kind: 'expected-synonym',
        message: `Строка ${lineNo}: поле expected устарело, канон — expected_ac (значение прочитано)`,
      });
      if (expectedAc === undefined) expectedAc = legacy;
    }
    if (expectedAc !== undefined) row.expected_ac = expectedAc;

    const hasInput = parsed.input !== undefined && parsed.input !== null;
    const hasPayload = parsed.payload !== undefined && parsed.payload !== null;
    if (hasInput && hasPayload) {
      warnings.push({
        line: lineNo,
        kind: 'input-payload-conflict',
        message: `Строка ${lineNo}: заданы и input, и payload — выигрывает payload, input игнорируется`,
      });
    }
    if (hasPayload) {
      row.payload = parsed.payload;
    } else if (hasInput) {
      row.input = typeof parsed.input === 'string' ? parsed.input : JSON.stringify(parsed.input);
    }

    if (isPlainObject(parsed.custom)) row.custom = { ...parsed.custom };
    if (isPlainObject(parsed.meta)) row.meta = { ...parsed.meta };

    rows.push(row);
  }

  return { rows, errors, warnings };
}

/** Читает и разбирает файл датасета; ошибки чтения — исключение (это не данные). */
export function readDatasetFile(path: string): ParsedDataset {
  return parseDatasetJsonl(readFileSync(path, 'utf-8'));
}

/** Сериализует строки датасета в JSONL (без завершающего перевода — его добавит запись). */
export function serializeDatasetJsonl(rows: DatasetRow[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '');
}

/** Шаблон строки для `dataset create` без `--from-completed` (ручное заполнение). */
export const DATASET_ROW_TEMPLATE = '{"task_id": "t1", "expected_ac": "Ожидаемый результат", "custom": {"language": "ts"}}';

/** Опции сборки датасета из завершённых задач. */
export interface DatasetFromCompletedOptions {
  /** Максимум строк (по умолчанию DEFAULT_COMPLETED_LIMIT). */
  limit?: number;
  /** Фильтр статуса (по умолчанию 'done', регистр не важен). */
  status?: string;
}

/** Результат сборки датасета из задач. */
export interface DatasetFromCompletedResult {
  rows: DatasetRow[];
  /** Задачи, попавшие в выборку (по убыванию updated_date). */
  taskIds: string[];
  /** Сколько завершённых задач было всего до применения --limit. */
  total: number;
}

/** Текст чеклиста из acceptanceCriteria: строки и объекты ChecklistItem. */
function checklistText(item: ChecklistItem | string): string {
  if (typeof item === 'string') {
    // Формат хранения: `- [ ] #1 текст` — снимаем маркер, номер и галку
    return item.replace(/^-\s*\[[ xX]\]\s*/, '').replace(/^#\d+\s*/, '').trim();
  }
  return String(item.text ?? '').trim();
}

/**
 * Собирает датасет из завершённых задач проекта (doc-21 §5).
 *
 * Источник — `backlog/tasks/**` со `status: Done` плюс `backlog/completed/`
 * (архивные задачи никогда не имеют иного статуса — они завершены по факту
 * переноса). Маппинг: `task_id` = ID задачи, `title`+`description` → `input`,
 * `acceptanceCriteria[].text` → `expected_ac`, `type`/`priority` → `custom`.
 *
 * Сортировка — по `updated_date` убыв., затем по id: свежие завершённые задачи
 * полезнее как вход manual-раннера, а `--limit` отрезает именно хвост.
 *
 * @param backlogDir — корень backlog-а
 * @param opts — лимит и фильтр статуса
 */
export function datasetFromCompleted(
  backlogDir: string,
  opts: DatasetFromCompletedOptions = {}
): DatasetFromCompletedResult {
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : DEFAULT_COMPLETED_LIMIT;
  const wantedStatus = String(opts.status || 'done').toLowerCase();

  const collected: { row: DatasetRow; updated: string }[] = [];
  const sources: { dir: string; alwaysDone: boolean }[] = [
    { dir: tasksDir(backlogDir), alwaysDone: false },
    { dir: completedDir(backlogDir), alwaysDone: true },
  ];

  for (const source of sources) {
    if (!existsSync(source.dir)) continue;
    const files = readdirSync(source.dir).filter(f => f.endsWith('.md')).sort();
    for (const file of files) {
      let task;
      try {
        task = markdownToTask(readFileSync(join(source.dir, file), 'utf-8'));
      } catch {
        // Битый файл задачи — не повод падать при сборке датасета
        continue;
      }
      const status = String(task.status || '').toLowerCase();
      if (!source.alwaysDone && status !== wantedStatus) continue;
      if (source.alwaysDone && status !== '' && status !== wantedStatus && status !== 'done') {
        // Архив с не-Done статусом — мусор, пропускаем
        continue;
      }

      const acText = (task.acceptanceCriteria || [])
        .map(checklistText)
        .filter(t => t !== '');
      const parts = [String(task.title || '').trim(), String(task.description || '').trim()]
        .filter(p => p !== '');

      const row: DatasetRow = { task_id: task.id || basename(file, '.md') };
      if (acText.length > 0) row.expected_ac = acText.join('\n');
      if (parts.length > 0) row.input = parts.join('\n\n');

      const custom: Record<string, unknown> = {};
      if (task.type) custom.type = task.type;
      if (task.priority) custom.priority = task.priority;
      if (Object.keys(custom).length > 0) row.custom = custom;

      collected.push({ row, updated: String(task.updated_date || task.created_date || '') });
    }
  }

  collected.sort((a, b) => {
    if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
    return a.row.task_id < b.row.task_id ? -1 : 1;
  });

  const sliced = collected.slice(0, limit);
  return {
    rows: sliced.map(c => c.row),
    taskIds: sliced.map(c => c.row.task_id),
    total: collected.length,
  };
}

/** Список датасетов в каталоге: имена без расширения, отсортированы. */
export function listDatasetsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => basename(f, '.jsonl'))
    .sort();
}

/** Описание одного датасета для `dataset list`. */
export interface DatasetListItem {
  name: string;
  /** 'shared' — backlog/experiments/datasets, 'private' — exp-<id>/datasets. */
  origin: 'shared' | 'private';
  /** id эксперимента для частного датасета. */
  expId?: string;
  relativePath: string;
  /** Число валидных строк (null — файл не читается). */
  rows: number | null;
  errors: number;
}

/**
 * Собирает список общих и частных датасетов с пометкой происхождения.
 *
 * @param expId — ограничить частные датасеты одним экспериментом
 */
export function listDatasets(backlogDir: string, expId?: string): DatasetListItem[] {
  const items: DatasetListItem[] = [];
  const root = experimentsDir(backlogDir);
  const toRel = (p: string): string => relative(backlogDir, p).split('\\').join('/');

  const describe = (name: string, path: string, origin: 'shared' | 'private', id?: string): DatasetListItem => {
    let rows: number | null = null;
    let errors = 0;
    try {
      const parsed = readDatasetFile(path);
      rows = parsed.rows.length;
      errors = parsed.errors.length;
    } catch {
      rows = null;
    }
    return {
      name, origin, relativePath: toRel(path), rows, errors,
      ...(id ? { expId: id } : {}),
    };
  };

  const sharedDir = experimentsDatasetsDir(backlogDir);
  for (const name of listDatasetsIn(sharedDir)) {
    items.push(describe(name, join(sharedDir, `${name}.jsonl`), 'shared'));
  }

  if (!existsSync(root)) return items;
  const expDirs = readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^exp-/.test(e.name))
    .map(e => e.name)
    .filter(id => !expId || id === expId)
    .sort();
  for (const id of expDirs) {
    const dir = join(root, id, 'datasets');
    for (const name of listDatasetsIn(dir)) {
      items.push(describe(name, join(dir, `${name}.jsonl`), 'private', id));
    }
  }
  return items;
}

/**
 * Проверяет, что путь лежит внутри каталога (защита имени датасета от `../`).
 *
 * @throws если путь выходит за пределы каталога
 */
export function assertInsideDir(dir: string, path: string): void {
  const rel = relative(dir, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Путь выходит за пределы каталога ${dir}: ${path}`);
  }
}

/**
 * Записывает общий датасет `backlog/experiments/datasets/<name>.jsonl`.
 *
 * @throws если файл существует, а `force` не задан
 */
export function writeSharedDataset(
  backlogDir: string,
  name: string,
  rows: DatasetRow[],
  opts: { force?: boolean } = {}
): { path: string; created: boolean } {
  const dir = experimentsDatasetsDir(backlogDir);
  const file = fileName(name, 'dataset');
  const path = join(dir, file);
  assertInsideDir(dir, path);
  const existed = existsSync(path);
  if (existed && !opts.force) {
    throw new Error(`Датасет уже существует: ${toRelative(backlogDir, path)} (для перезаписи — --force)`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeDatasetJsonl(rows), 'utf-8');
  return { path, created: !existed };
}
