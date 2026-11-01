/**
 * Команда `vibelog experiment` — эксперименты (A/B) проекта (VL-294).
 *
 * MVP-шаг 1: только каркас — `create` и `list`. Логика прогонов
 * (record/report/judge) появится в VL-296…VL-298, поэтому команда
 * намеренно не принимает флаги раннера.
 *
 * Подкоманды:
 * - create <title> [--dataset D] [--runner manual] [--status draft]
 *                  [--variant A:builtin:spec ...] [--notes ТЕКСТ]
 * - list [--status S]
 *
 * Файлы: backlog/experiments/exp-<id>.md (YAML-фронтматтер + описание).
 */

import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { findBacklogDir } from '../../core/paths.js';
import {
  listExperiments, writeExperiment, EXPERIMENT_STATUSES,
} from '../../core/experiment.js';
import type { VariantConfig } from '../../core/experiment.js';

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
  // label — после последнего двоеточия, но только если остаток не сам
  // начинается с builtin: (иначе 'builtin:spec' был бы разрезан неверно)
  const lastColon = rest.lastIndexOf(':');
  if (lastColon > 0 && !rest.startsWith('builtin:')) {
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
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: create, list');
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
