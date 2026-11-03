/**
 * Подкоманда `experiment gc` (VL-301, doc-21 §15).
 *
 * Git-политика экспериментов: раны с `results.jsonl` > 10 MB не должны
 * уезжать в git. Автоматически `.gitignore` не правится никогда — только эта
 * явная команда. Без `--apply` команда только печатает кандидатов и ничего не
 * читает/не пишет, кроме `stat` файлов результатов.
 */

import { getFlag, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printError, printInfo, printSuccess, printWarning } from '../ui.js';
import { getExperiment } from '../../core/experiment.js';
import {
  findGcCandidates, buildGitignoreBlock, applyGitignoreBlock,
  gitignorePathFor, RESULTS_SIZE_LIMIT_BYTES,
} from '../../core/experiment-gc.js';

/** Размер в мегабайтах с одним знаком — для человекочитаемой печати. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Выполняет `vibelog experiment gc <exp-id> [--apply]`.
 *
 * @param positional — позиционные аргументы после `gc` (первый — id)
 * @param flags — флаги CLI (`--apply`)
 * @param backlogDir — каталог backlog (проект = его родитель)
 */
export function experimentGc(positional: string[], flags: FlagValues, backlogDir: string): void {
  const expId = (positional[0] || getFlag(flags, 'exp', '')).trim();
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment gc <exp-id> [--apply]');
    process.exitCode = 1;
    return;
  }
  const entry = getExperiment(backlogDir, expId);
  if (!entry) {
    printError(`Эксперимент не найден: ${expId}`);
    process.exitCode = 1;
    return;
  }
  const resolvedId = entry.experiment.id;
  const candidates = findGcCandidates(backlogDir, resolvedId);

  console.log('');
  if (candidates.length === 0) {
    printInfo(`Кандидатов на .gitignore нет (порог ${megabytes(RESULTS_SIZE_LIMIT_BYTES)} MB).`);
  } else {
    for (const c of candidates) {
      console.log(`  run-${c.run}  ${megabytes(c.sizeBytes)} MB  ${c.relativePath}`);
    }
    console.log(`\n  кандидатов: ${candidates.length} (порог ${megabytes(RESULTS_SIZE_LIMIT_BYTES)} MB)`);
  }

  if (!hasFlag(flags, 'apply')) {
    // Без --apply ничего не меняется: git-правила правит только человек (doc-21 §15)
    printInfo(`Ничего не изменено. Применить: vibelog experiment gc ${resolvedId} --apply`);
    return;
  }

  const gitignorePath = gitignorePathFor(backlogDir);
  printInfo(`Файл: ${gitignorePath}`);
  try {
    const result = applyGitignoreBlock(gitignorePath, resolvedId, candidates.map(c => c.entry));
    if (result.changed) {
      printSuccess(`.gitignore дополнен: ${candidates.length} строк (${resolvedId})`);
      // Печатаем блок — человек должен видеть, что именно попало под игнор
      console.log(buildGitignoreBlock(resolvedId, candidates.map(c => c.entry)));
    } else {
      printInfo(`.gitignore уже актуален — изменений нет${result.reason ? ` (${result.reason})` : ''}`);
    }
  } catch (err) {
    printError(`Не удалось обновить .gitignore: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (candidates.length > 0) {
    printWarning('Файлы остаются на диске: gc правит только .gitignore, не удаляет результаты.');
  }
}
