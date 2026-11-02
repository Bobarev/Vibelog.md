/**
 * Подкоманда `experiment report` (VL-297, doc-21 §8–§9).
 *
 * Вынесена из `experiment.ts` по той же причине, что и `experiment-run.ts`:
 * файл-каркас не должен разрастаться. Здесь жизненный цикл отчёта:
 * чтение `results.jsonl`, построение агрегатов (`core/report.ts`), запись
 * `report.md` в каталог прогона, `--compare` с другим прогоном и **завершение
 * прогона** (перевод в `completed` при полной матрице).
 *
 * Почему завершает `report`, а не `record` (doc-21 §8): manual-прогон не имеет
 * процесса, который «сам завершится», а `completed` на половине данных опаснее
 * явного `running`. `record` вообще не читает датасет и не знает, что матрица
 * закрыта.
 */

import { writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getFlag, hasFlag } from './../args.js';
import type { FlagValues } from './../args.js';
import { printSuccess, printError, printInfo } from './../ui.js';
import {
  getExperiment, runDirFor, readMetaJson, writeMetaJson, latestRunNumber,
  listRunNumbers, syncExperimentStatus,
} from '../../core/experiment.js';
import type { RunMeta } from '../../core/experiment.js';
import { resultsPath, readResultsFile } from '../../core/results.js';
import { readDatasetFile, resolveDataset } from '../../core/dataset.js';
import {
  buildReport, formatReportMarkdown, compareRuns, formatCompareMarkdown,
  RESULTS_SIZE_LIMIT_BYTES,
} from '../../core/report.js';
import type { Report } from '../../core/report.js';

/** Путь для печати относительно корня проекта (не абсолютный). */
function displayPath(backlogDir: string, path: string): string {
  const rel = relative(join(backlogDir, '..'), path);
  return rel.startsWith('..') ? path : rel;
}

/** Текущий момент в ISO — для `finished_at`. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Читает `task_id` датасета эксперимента.
 *
 * Датасет — единственный источник истины о полноте матрицы. Если файл не
 * найден (его удалили после прогона), возвращается `null`: полноту проверить
 * нельзя, и `report` не имеет права закрывать прогон по догадке.
 */
function datasetTaskIds(backlogDir: string, expId: string, datasetName: string): string[] | null {
  if (!datasetName) return null;
  try {
    const dataset = resolveDataset(backlogDir, expId, datasetName, { silent: true });
    const parsed = readDatasetFile(dataset.absolutePath);
    return parsed.rows.map(r => r.task_id);
  } catch {
    return null;
  }
}

/**
 * `experiment report <exp-id> [--run N] [--compare run-M] [--json]`.
 *
 * Пишет `report.md` в каталог прогона (единственный производный файл рана —
 * `results.jsonl` не меняется) и печатает отчёт в stdout. При полной матрице
 * «строки датасета × варианты» переводит прогон в `completed` и пересчитывает
 * статус эксперимента.
 */
export function experimentReport(positional: string[], flags: FlagValues, backlogDir: string): void {
  const expId = (positional[0] || '').trim();
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment report <exp-id> [--run N] [--compare run-M] [--json]');
    process.exitCode = 1;
    return;
  }
  try {
    const entry = getExperiment(backlogDir, expId);
    if (!entry) {
      printError(`Эксперимент не найден: ${expId}`);
      process.exitCode = 1;
      return;
    }
    const exp = entry.experiment;
    const runs = listRunNumbers(join(backlogDir, 'experiments', exp.id));

    // ── Целевой прогон ──
    const runFlag = getFlag(flags, 'run', '');
    let run: number;
    if (runFlag) {
      run = Number.parseInt(runFlag, 10);
      if (!Number.isFinite(run) || run <= 0) {
        printError(`Неверное значение --run: "${runFlag}". Ожидается номер прогона`);
        process.exitCode = 1;
        return;
      }
      if (!runs.includes(run)) {
        printError(`Прогон run-${run} не найден (есть: ${runs.length ? runs.join(', ') : 'нет'})`);
        process.exitCode = 1;
        return;
      }
    } else {
      const last = latestRunNumber(backlogDir, exp.id);
      if (last === null) {
        printError(`У эксперимента ${exp.id} нет прогонов — создайте: experiment run ${exp.id}`);
        process.exitCode = 1;
        return;
      }
      run = last;
    }

    const runDir = runDirFor(backlogDir, exp.id, run);
    let meta = readMetaJson(runDir);
    if (!meta) {
      printError(`meta.json прогона run-${run} не найден или битый: ${displayPath(backlogDir, runDir)}`);
      printInfo(`Восстановите прогон: experiment run ${exp.id} --recover --run ${run}`);
      process.exitCode = 1;
      return;
    }

    const path = resultsPath(runDir);

    // ── Правило > 10 MB (doc-21 §15): файл читается локально, но помечается ──
    // Смысл не в экономии памяти, а в git: такой файл не должен попасть в
    // историю, а report.md с посчитанными цифрами — должен.
    let size = 0;
    if (existsSync(path)) {
      try {
        size = statSync(path).size;
      } catch {
        size = 0;
      }
    }
    if (size > RESULTS_SIZE_LIMIT_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      console.error(
        `Предупреждение: results.jsonl прогона run-${run} занимает ${mb} MB (> 10 MB) — `
        + 'файл не предназначен для git; отчёт считается по локальной копии, meta помечена results_ignored'
      );
      meta = { ...meta, results_ignored: true };
      writeMetaJson(runDir, meta);
    }

    const parsedResults = readResultsFile(path);
    const taskIds = datasetTaskIds(backlogDir, exp.id, exp.dataset);
    if (taskIds === null) {
      console.error(
        `Предупреждение: датасет эксперимента ${exp.id} не найден ("${exp.dataset || '—'}") — `
        + 'полнота прогона не проверяется, статус рана не меняется'
      );
    }

    const report = buildReport(parsedResults.rows, meta, exp, {
      taskIds: taskIds === null ? undefined : taskIds,
    });
    report.results_errors = parsedResults.errors;

    // ── report.md — производный файл: перегенерация разрешена (doc-21 §9) ──
    const markdown = formatReportMarkdown(report);
    const reportPath = join(runDir, 'report.md');
    writeFileSync(reportPath, markdown, 'utf-8');

    // ── Завершение прогона: только при полной матрице ──
    const canClose = taskIds !== null && report.complete && meta.status !== 'failed';
    if (canClose) {
      const closedAt = meta.finished_at || nowIso();
      const updated: RunMeta = {
        ...meta,
        status: 'completed',
        finished_at: closedAt,
        n: report.n,
        dropped: report.dropped,
        cost_total: report.cost_total,
        results_ignored: meta.results_ignored,
        summary: { n: report.n, dropped: report.dropped, cost_total: report.cost_total },
      };
      if (meta.status !== 'completed' || meta.n !== report.n || meta.dropped !== report.dropped) {
        writeMetaJson(runDir, updated);
      }
      const status = syncExperimentStatus(backlogDir, exp.id);
      report.run_status = 'completed';
      if (!hasFlag(flags, 'json')) {
        printSuccess(`Прогон run-${run} завершён: completed (n=${report.n}, dropped=${report.dropped})`);
        if (status) printInfo(`Статус эксперимента ${exp.id}: ${status}`);
      }
    } else if (taskIds !== null && meta.status === 'failed') {
      console.error(
        `Примечание: прогон run-${run} помечен failed — данные полны, но статус не меняется `
        + `(частичный прогон). Пересоздайте прогон, если данные нужно считать финальными`
      );
    }

    // ── Сравнение с другим прогоном ──
    const compareFlag = getFlag(flags, 'compare', '');
    let compareMarkdown = '';
    let compareJson: unknown = null;
    if (compareFlag) {
      const other = Number.parseInt(compareFlag.replace(/^run-/, ''), 10);
      if (!Number.isFinite(other)) {
        printError(`Неверное значение --compare: "${compareFlag}". Ожидается run-M`);
        process.exitCode = 1;
        return;
      }
      if (!runs.includes(other)) {
        printError(`Прогон run-${other} не найден (есть: ${runs.length ? runs.join(', ') : 'нет'})`);
        process.exitCode = 1;
        return;
      }
      const otherDir = runDirFor(backlogDir, exp.id, other);
      const otherMeta = readMetaJson(otherDir);
      if (!otherMeta) {
        printError(`meta.json прогона run-${other} не найден или битый`);
        process.exitCode = 1;
        return;
      }
      const otherParsed = readResultsFile(resultsPath(otherDir));
      const otherReport = buildReport(otherParsed.rows, otherMeta, exp, {
        taskIds: taskIds === null ? undefined : taskIds,
      });
      const compare = compareRuns(report, otherReport);
      compareMarkdown = formatCompareMarkdown(compare);
      compareJson = compare;
      // Таблица дельт дописывается в report.md — иначе сравнение живёт только
      // в терминале и теряется при следующем запуске без --compare
      writeFileSync(reportPath, `${markdown}\n${compareMarkdown}`, 'utf-8');
    }

    // ── Вывод ──
    if (hasFlag(flags, 'json')) {
      const payload = compareJson
        ? { report, compare: compareJson }
        : report;
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log('');
    console.log(formatReportMarkdown(report));
    if (compareMarkdown) {
      console.log(compareMarkdown);
    }
    printInfo(`Отчёт записан: ${displayPath(backlogDir, reportPath)}`);
    if (parsedResults.errors.length > 0) {
      console.error(`Предупреждение: в results.jsonl ${parsedResults.errors.length} битых строк — см. отчёт`);
    }
    if (report.missing.length > 0) {
      console.error(
        `Прогон run-${run} НЕ завершён: не хватает пар ${report.missing.length}. `
        + `Дозапишите их командой record, затем повторите report`
      );
      printInfo('Статус прогона не изменён');
    }
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/** Путь к report.md прогона (для CLI/тестов). */
export function runReportPath(backlogDir: string, expId: string, run: number): string {
  return join(runDirFor(backlogDir, expId, run), 'report.md');
}

/** Пустой отчёт недоступен — экспорт оставлен ради типизации повторного чтения. */
export type { Report };
