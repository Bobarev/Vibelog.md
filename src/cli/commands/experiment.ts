/**
 * Команда `vibelog experiment` — эксперименты (A/B) проекта (VL-294).
 *
 * MVP-шаг 1 (VL-294): каркас — `create` и `list`.
 * MVP-шаг 2 (VL-295): датасеты — `dataset create|list|view` и
 * `experiment dataset <exp-id>` (показ резолва «частный → общий»).
 * MVP-шаг 3 (VL-296): прогоны — `run` (manual, `--dry-run`, `--recover`)
 * и `record` (upsert по (task_id, variant), `--run`, `--from-json`).
 * MVP-шаг 4 (VL-297): отчёт — `report` (метрики, `--compare`, `--json`).
 * MVP-шаг 5 (VL-298): LLM-judge — `judge` (upsert `score` в существующие
 * строки, `judge_usage`/`cost_judge` в meta отдельно от cost варианта).
 * v2 (VL-301): git-политика — `gc` (кандидаты на `.gitignore` по размеру
 * `results.jsonl`; правка файла только по явному `--apply`).
 *
 * Подкоманды:
 * - create <title> [--dataset D] [--runner manual] [--status draft]
 *                  [--variant A:builtin:spec ...] [--notes ТЕКСТ]
 * - list [--status S]
 * - dataset create <name> [--from-completed] [--limit N] [--force]
 * - dataset list [--exp <exp-id>]
 * - dataset view <name> [--exp <exp-id>] [--dataset-path <p>]
 * - dataset <exp-id> [--dataset-path <p>]   (резолв для эксперимента)
 * - run <exp-id> [--dry-run] [--recover] [--variant A,B]
 *                  [--timeout <сек>] [--max-tool-calls <N>]
 *                  [--runner-cmd '<shell>'] [--rerun N --yes]
 *                  [--variant-a-prompt-path <p>] [--variant-b-prompt-path <p>]
 * - record <exp-id> --variant A --task <id> [--score n] [--output t] [--error t]
 *                  [--error-kind k] [--tool-calls N] [--duration ms] [--cost n]
 *                  [--custom '<json>'] [--run N] [--from-json <file>]
 * - report <exp-id> [--run N] [--compare run-M] [--json]
 * - judge <exp-id> [--run N]
 * - gc <exp-id> [--apply]
 *
 * Файлы: backlog/experiments/exp-<id>.md (YAML-фронтматтер + описание),
 *        backlog/experiments/datasets/<name>.jsonl (общие датасеты),
 *        backlog/experiments/exp-<id>/run-<N>/{meta.json,results.jsonl}.
 */

import { getFlag, getFlagArray, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { findBacklogDir } from '../../core/paths.js';
import {
  listExperiments, writeExperiment, EXPERIMENT_STATUSES,
} from '../../core/experiment.js';
import type { VariantConfig } from '../../core/experiment.js';
import {
  readDatasetFile, resolveDataset, datasetFromCompleted,
  listDatasets, writeSharedDataset, DATASET_ROW_TEMPLATE, DEFAULT_COMPLETED_LIMIT,
} from '../../core/dataset.js';
import type { ParsedDataset, DatasetRow } from '../../core/dataset.js';
import { experimentRun, experimentRecord } from './experiment-run.js';
import { experimentReport } from './experiment-report.js';
import { experimentJudge } from './experiment-judge.js';
import { experimentGc } from './experiment-gc.js';
import { join, relative } from 'node:path';

/**
 * Разбирает значение `--variant`.
 *
 * Формат: `<KEY>:<prompt>[:label]`, где KEY — A/B/C, prompt — имя файла
 * в prompts/ или `builtin:<phase>` (двоеточие внутри builtin: сохраняется,
 * поэтому split идёт только по первому и последнему разделителю).
 *
 * @returns пара [ключ варианта, конфиг] или null, если формат не распознан
 */
function parseVariantArg(raw: string): [string, Partial<VariantConfig>] | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const firstColon = value.indexOf(':');
  if (firstColon <= 0) return null;
  const key = value.slice(0, firstColon).trim().toUpperCase();
  const rest = value.slice(firstColon + 1).trim();
  if (!key || !rest) return null;
  // label — после последнего двоеточия. Для builtin:<phase>:<label> разделитель
  // ищется ПОСЛЕ префикса: иначе 'builtin:spec' был бы разрезан неверно, а
  // 'builtin:spec:текущий' терял бы label в самом prompt (VL-296).
  if (rest.startsWith('builtin:')) {
    const afterPrefix = rest.indexOf(':', 'builtin:'.length);
    if (afterPrefix > 0) {
      const prompt = rest.slice(0, afterPrefix).trim();
      const label = rest.slice(afterPrefix + 1).trim();
      if (prompt) return [key, { prompt, ...(label ? { label } : {}) }];
    }
    return [key, { prompt: rest }];
  }
  const lastColon = rest.lastIndexOf(':');
  if (lastColon > 0) {
    const prompt = rest.slice(0, lastColon).trim();
    const label = rest.slice(lastColon + 1).trim();
    if (prompt) return [key, { prompt, ...(label ? { label } : {}) }];
  }
  return [key, { prompt: rest }];
}

/**
 * Выполняет команду experiment.
 *
 * @param subcommand — подкоманда (create/list)
 * @param positional — позиционные аргументы
 * @param flags — флаги CLI
 * @param cwd — рабочая директория (backlog ищется сам)
 */
export async function runExperiment(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'create':
      return experimentCreate(positional, flags, backlogDir);
    case 'list':
      return experimentList(flags, backlogDir);
    case 'dataset':
      return experimentDataset(positional, flags, backlogDir);
    case 'run':
      // VL-299: ai-phase runner асинхронен (спавн ранов) — возвращаем промис
      return experimentRun(positional, flags, backlogDir);
    case 'record':
      return experimentRecord(positional, flags, backlogDir);
    case 'report':
      return experimentReport(positional, flags, backlogDir);
    case 'judge':
      // VL-298: judge — асинхронный (LLM-вызовы), остальные подкоманды синхронные
      return experimentJudge(positional, flags, backlogDir, cwd);
    case 'gc':
      // VL-301: git-политика — только печать кандидатов или явный --apply
      return experimentGc(positional, flags, backlogDir);
    default:
      // `experiment dataset <exp-id>`: router отдаёт exp-id в subcommand (VL-295)
      if (/^exp-/i.test(subcommand)) {
        return experimentDatasetResolve([subcommand, ...positional], flags, backlogDir);
      }
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: create, list, dataset, run, record, report, judge, gc');
  }
}

/**
 * Маршрутизирует `experiment dataset ...` (VL-295).
 *
 * Третье слово после `dataset` — либо глагол (create/list/view), либо id
 * эксперимента: doc-21 §10 фиксирует форму `experiment dataset <exp-id>`
 * для показа резолва, поэтому её нельзя терять.
 */
function experimentDataset(positional: string[], flags: FlagValues, backlogDir: string): void {
  const [first, ...rest] = positional;
  if (!first) {
    printError('Укажите действие: vibelog experiment dataset create|list|view <name> | <exp-id>');
    process.exitCode = 1;
    return;
  }
  switch (first) {
    case 'create':
      return datasetCreate(rest, flags, backlogDir);
    case 'list':
      return datasetList(flags, backlogDir);
    case 'view':
      return datasetView(rest, flags, backlogDir);
    default:
      // Всё остальное считаем id эксперимента (doc-21 §10)
      return experimentDatasetResolve([first, ...rest], flags, backlogDir);
  }
}

function experimentCreate(positional: string[], flags: FlagValues, backlogDir: string): void {
  const title = positional.join(' ').trim();
  if (!title) {
    printError('Укажите заголовок: vibelog experiment create <title> [--dataset D] [--runner manual] [--variant A:builtin:spec] [-d описание]');
    return;
  }
  try {
    // Варианты по умолчанию (A/B) — MVP-сценарий сравнения двух вариантов:
    // эксперемент без вариантов невозможно запустить, а схема готова к C/D
    const variants: Record<string, Partial<VariantConfig>> = {};
    for (const raw of getFlagArray(flags, 'variant')) {
      const parsed = parseVariantArg(raw);
      if (!parsed) {
        printError(`Неверный формат --variant: "${raw}". Ожидается <KEY>:<prompt>[:label]`);
        process.exitCode = 1;
        return;
      }
      variants[parsed[0]] = parsed[1];
    }
    if (Object.keys(variants).length === 0) {
      variants.A = { prompt: 'A', label: 'вариант A' };
      variants.B = { prompt: 'B', label: 'вариант B' };
    }
    const exp = writeExperiment(backlogDir, {
      title,
      status: getFlag(flags, 'status', 'draft'),
      dataset: getFlag(flags, 'dataset', ''),
      runner: getFlag(flags, 'runner', 'manual'),
      variants,
      notes: getFlag(flags, 'notes', ''),
      content: getFlag(flags, 'description', '') ? `${getFlag(flags, 'description', '')}\n` : '',
    });
    printSuccess(`Эксперимент ${exp.id} создан: ${exp.title} (варианты: ${Object.keys(exp.variants).join('/')})`);
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

function experimentList(flags: FlagValues, backlogDir: string): void {
  let entries = listExperiments(backlogDir);
  const statusFilter = getFlag(flags, 'status', '').toLowerCase();
  if (statusFilter) {
    entries = entries.filter(e => e.experiment.status === statusFilter);
  }
  if (entries.length === 0) {
    printInfo('Экспериментов нет.');
    return;
  }
  console.log('');
  for (const e of entries) {
    const x = e.experiment;
    const variantKeys = Object.keys(x.variants).join('/');
    const dataset = x.dataset ? `, ${x.dataset}` : '';
    console.log(`  ${x.id}  ${x.title}  (${x.status}, ${x.runner}${dataset}; варианты: ${variantKeys || '—'})`);
  }
  console.log(`\n  экспериментов: ${entries.length}`);
  printInfo(`Статусы: ${EXPERIMENT_STATUSES.join(' | ')}`);
}

// ── Dataset (VL-295) ──

/**
 * Создаёт общий датасет `backlog/experiments/datasets/<name>.jsonl`.
 *
 * Без `--from-completed` создаётся пустой файл и печатается шаблон строки:
 * manual runner-у нужен вход, который человек заполнит руками. С
 * `--from-completed` строки собираются из завершённых задач проекта,
 * `--limit N` ограничивает выборку (по умолчанию 20).
 */
function datasetCreate(positional: string[], flags: FlagValues, backlogDir: string): void {
  const name = positional.join(' ').trim();
  if (!name) {
    printError('Укажите имя датасета: vibelog experiment dataset create <name> [--from-completed] [--limit N]');
    process.exitCode = 1;
    return;
  }
  try {
    let rows: DatasetRow[] = [];
    if (hasFlag(flags, 'from-completed')) {
      const limitRaw = getFlag(flags, 'limit', String(DEFAULT_COMPLETED_LIMIT));
      const limit = Number.parseInt(limitRaw, 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        printError(`Неверное значение --limit: "${limitRaw}". Ожидается положительное число`);
        process.exitCode = 1;
        return;
      }
      const collected = datasetFromCompleted(backlogDir, { limit });
      rows = collected.rows;
      if (rows.length === 0) {
        printError('Завершённых задач (status: Done) не найдено — нечего собрать в датасет');
        process.exitCode = 1;
        return;
      }
      printInfo(`Собрано строк из завершённых задач: ${rows.length} из ${collected.total} (--limit ${limit})`);
    }
    const written = writeSharedDataset(backlogDir, name, rows, { force: hasFlag(flags, 'force') });
    printSuccess(`Датасет создан: ${relative(join(backlogDir, '..'), written.path)} (строк: ${rows.length})`);
    if (!hasFlag(flags, 'from-completed')) {
      printInfo('Шаблон строки (JSONL, по одной на задачу):');
      console.log(`  ${DATASET_ROW_TEMPLATE}`);
      printInfo('Обязательное поле — task_id; expected_ac/input/payload/custom/meta опциональны');
    }
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/** Печатает список общих и частных датасетов с пометкой происхождения. */
function datasetList(flags: FlagValues, backlogDir: string): void {
  const expFilter = getFlag(flags, 'exp', '');
  const items = listDatasets(backlogDir, expFilter || undefined);
  if (items.length === 0) {
    printInfo('Датасетов нет. Создайте: vibelog experiment dataset create <name> [--from-completed]');
    return;
  }
  console.log('');
  for (const item of items) {
    const origin = item.origin === 'shared' ? 'общий' : `частный ${item.expId}`;
    const counts = item.rows === null
      ? 'не читается'
      : `строк: ${item.rows}${item.errors > 0 ? `, ошибок: ${item.errors}` : ''}`;
    console.log(`  ${item.name}  [${origin}]  ${counts}  ${item.relativePath}`);
  }
  const shared = items.filter(i => i.origin === 'shared').length;
  console.log(`\n  датасетов: ${items.length} (общих: ${shared}, частных: ${items.length - shared})`);
}

/**
 * Ищет файл датасета для просмотра: при `--exp` — по правилу резолва,
 * без него — общий файл, иначе единственный частный с таким именем.
 */
function findDatasetForView(backlogDir: string, name: string, flags: FlagValues): string {
  const explicit = getFlag(flags, 'dataset-path', '');
  if (explicit) {
    const resolved = resolveDataset(backlogDir, getFlag(flags, 'exp', 'exp-none'), name, { explicitPath: explicit });
    return resolved.absolutePath;
  }
  const expId = getFlag(flags, 'exp', '');
  if (expId) {
    return resolveDataset(backlogDir, expId, name).absolutePath;
  }
  const items = listDatasets(backlogDir).filter(i => i.name === name);
  if (items.length === 0) {
    throw new Error(`Датасет "${name}" не найден ни в общих, ни в частных`);
  }
  const shared = items.find(i => i.origin === 'shared');
  if (shared) return join(backlogDir, shared.relativePath);
  if (items.length > 1) {
    throw new Error(`Датасет "${name}" есть у нескольких экспериментов (${items.map(i => i.expId).join(', ')}) — укажите --exp`);
  }
  return join(backlogDir, items[0].relativePath);
}

/** Печатает результат разбора датасета: строки, ошибки, предупреждения. */
function printParsedDataset(parsed: ParsedDataset, label: string): void {
  console.log(`  ${label}: валидных строк ${parsed.rows.length}, ошибок ${parsed.errors.length}`);
  if (parsed.rows.length > 0) {
    printInfo(`task_id: ${parsed.rows.map(r => r.task_id).join(', ')}`);
  }
  for (const e of parsed.errors) console.error(`  ошибка: ${e.message}`);
  for (const w of parsed.warnings) console.error(`  предупреждение: ${w.message}`);
}

/** Показывает содержимое датасета с валидацией (число валидных/битых строк, task_id). */
function datasetView(positional: string[], flags: FlagValues, backlogDir: string): void {
  const name = positional.join(' ').trim();
  if (!name) {
    printError('Укажите имя датасета: vibelog experiment dataset view <name> [--exp <exp-id>]');
    process.exitCode = 1;
    return;
  }
  try {
    const path = findDatasetForView(backlogDir, name, flags);
    const parsed = readDatasetFile(path);
    printInfo(`Датасет: ${relative(join(backlogDir, '..'), path)}`);
    printParsedDataset(parsed, 'разбор');
    if (parsed.errors.length > 0) process.exitCode = 1;
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/**
 * Показывает резолв датасета для эксперимента (doc-21 §10: `dataset <exp-id>`).
 *
 * Порядок: `--dataset-path` → известный `--dataset` эксперимента из карточки →
 * имя из аргумента. Warning о затенённом общем файле уходит в stderr:
 * молчаливый резолв скрывает причину расхождения прогонов.
 */
function experimentDatasetResolve(positional: string[], flags: FlagValues, backlogDir: string): void {
  const expId = positional[0];
  const explicitName = positional[1] || '';
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment dataset <exp-id> [--dataset-path <p>]');
    process.exitCode = 1;
    return;
  }
  const explicitPath = getFlag(flags, 'dataset-path', '');
  try {
    // Имя датасета берём из карточки эксперимента, если оно там записано
    let name = explicitName;
    if (!name) {
      const entry = listExperiments(backlogDir).find(e => e.experiment.id === expId);
      if (!entry) {
        printError(`Эксперимент не найден: ${expId}`);
        process.exitCode = 1;
        return;
      }
      name = entry.experiment.dataset;
      if (!name) {
        printError(`У эксперимента ${expId} не указан dataset — создайте с --dataset или передайте имя: experiment dataset ${expId} <name>`);
        process.exitCode = 1;
        return;
      }
    }
    const resolved = resolveDataset(backlogDir, expId, name, { explicitPath });
    console.log('');
    console.log(`  эксперимент: ${expId}`);
    console.log(`  датасет: ${name}`);
    console.log(`  выбран: ${resolved.resolution.chosen} — ${resolved.resolution.path}`);
    if (resolved.resolution.shadowed) {
      console.log(`  затенён: ${resolved.resolution.shadowed}`);
    }
    const parsed = readDatasetFile(resolved.absolutePath);
    printParsedDataset(parsed, 'разбор');
    // Структура резолва — то, что побежит в meta.json рана (VL-296)
    printInfo(`resolution: ${JSON.stringify({ dataset: resolved.resolution })}`);
    if (parsed.errors.length > 0) process.exitCode = 1;
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}
