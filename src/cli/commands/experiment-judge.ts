/**
 * Подкоманда `experiment judge` (VL-298, doc-21 §4, §10, §11).
 *
 * Вынесена из `experiment.ts` по той же причине, что `experiment-run.ts` и
 * `experiment-report.ts`: каркас не должен разрастаться, а judge — это отдельный
 * сценарий с LLM-вызовами.
 *
 * Семантика:
 * - читает `results.jsonl` выбранного прогона и **upsert-ит `score`** в
 *   существующие строки (ключ `(task_id, variant)` — тот же, что у `record`);
 * - строки без `output` не оцениваются (оценивать нечего), `score` остаётся
 *   прежним — путь `score: null` продолжает работать;
 * - `expected_ac` берётся из датасета прогона: он и есть «ожидаемый результат»;
 * - **стоимость судьи отдельно** (§11): `judge_usage` + `cost_judge` в
 *   `meta.json`, `cost` строк варианта не трогается.
 */

import { join } from 'node:path';
import { getFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { experimentsDir } from '../../core/paths.js';
import {
  getExperiment, listRunNumbers, runDirFor, readMetaJson, writeMetaJson,
} from '../../core/experiment.js';
import type { RunMeta } from '../../core/experiment.js';
import { resultsPath, readResultsFile, rewriteResultsJsonl, upsertResult } from '../../core/results.js';
import { resolveDataset, readDatasetFile } from '../../core/dataset.js';
import type { DatasetRow } from '../../core/dataset.js';
import { validateJudgeConfig, scoreRows } from '../../core/judge.js';

/**
 * `experiment judge <exp-id> [--run N]`.
 *
 * @param positional — первым идёт id эксперимента
 * @param flags — `--run N`
 * @param backlogDir — корень backlog-а
 * @param cwd — корень проекта (settings.json с models/providers)
 */
export async function experimentJudge(
  positional: string[],
  flags: FlagValues,
  backlogDir: string,
  cwd: string,
): Promise<void> {
  const expId = (positional[0] || '').trim();
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment judge <exp-id> [--run N]');
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
    if (!exp.judge) {
      printError(
        `У эксперимента ${exp.id} нет секции judge в карточке — добавьте её в frontmatter `
        + '(judge: {enabled: true, scale: numeric, score_min: 1, score_max: 10})'
      );
      process.exitCode = 1;
      return;
    }
    const problems = validateJudgeConfig(exp.judge);
    const blocking = problems.filter(p => p.field !== 'enabled');
    if (blocking.length > 0) {
      for (const p of blocking) printError(`judge.${p.field}: ${p.message}`);
      process.exitCode = 1;
      return;
    }
    if (!exp.judge.enabled) {
      printError(`У эксперимента ${exp.id} judge.enabled=false — оценка судьёй выключена в карточке`);
      process.exitCode = 1;
      return;
    }

    // ── Целевой прогон ──
    const runs = listRunNumbers(join(experimentsDir(backlogDir), exp.id));
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
      if (runs.length === 0) {
        printError(`У эксперимента ${exp.id} нет прогонов — создайте: experiment run ${exp.id}`);
        process.exitCode = 1;
        return;
      }
      run = runs[runs.length - 1];
      if (runs.length > 1) {
        console.error(
          `Предупреждение: у эксперимента ${exp.id} несколько прогонов (${runs.join(', ')}), `
          + `--run не задан — оцениваю последний run-${run}. Укажите --run явно, чтобы не перепутать прогоны`
        );
      }
    }

    const runDir = runDirFor(backlogDir, exp.id, run);
    const meta = readMetaJson(runDir);
    if (!meta) {
      printError(`meta.json прогона run-${run} не найден или битый: ${join(exp.id, `run-${run}`)}`);
      printInfo(`Восстановите прогон: experiment run ${exp.id} --recover --run ${run}`);
      process.exitCode = 1;
      return;
    }

    const path = resultsPath(runDir);
    const parsedResults = readResultsFile(path);
    if (parsedResults.errors.length > 0) {
      for (const e of parsedResults.errors) {
        console.error(`Предупреждение: ${e.message} — строка будет потеряна при перезаписи файла`);
      }
    }
    if (parsedResults.rows.length === 0) {
      printError(`В прогоне run-${run} нет строк результатов — сначала запишите их: experiment record ${exp.id}`);
      process.exitCode = 1;
      return;
    }

    // ── expected_ac из датасета: единственный источник ожидаемого результата ──
    const datasetRows = new Map<string, DatasetRow>();
    if (exp.dataset) {
      try {
        const resolved = resolveDataset(backlogDir, exp.id, exp.dataset, { silent: true });
        for (const row of readDatasetFile(resolved.absolutePath).rows) {
          datasetRows.set(row.task_id, row);
        }
      } catch (err) {
        // Датасета нет — судья оценит по output без эталона (это законный режим)
        console.error(`Предупреждение: датасет эксперимента не найден ("${exp.dataset}") — ${(err as Error).message}`);
      }
    }

    const pairs = parsedResults.rows.map(result => ({
      result,
      dataset: datasetRows.get(result.task_id),
    }));

    const outcome = await scoreRows(pairs, exp.judge, { cwd });

    // ── Upsert по (task_id, variant): строки не добавляются, только правятся ──
    let merged = parsedResults.rows;
    for (const row of outcome.rows) {
      merged = upsertResult(merged, row);
    }
    rewriteResultsJsonl(path, merged);

    // ── Стоимость судьи — ОТДЕЛЬНО от cost варианта (doc-21 §11) ──
    const updated: RunMeta = {
      ...meta,
      judge_usage: outcome.usage,
      cost_judge: outcome.cost,
      judge_pricing_missing: outcome.pricingMissing,
      ...(outcome.model ? { judge_model: outcome.model } : {}),
    };
    writeMetaJson(runDir, updated);

    printSuccess(
      `Judge: оценено строк ${outcome.scored}, пропущено ${outcome.skipped} (всего в прогоне: ${merged.length})`
    );
    printInfo(`judge_usage: ${JSON.stringify(outcome.usage)}`);
    if (outcome.cost === null) {
      printInfo('cost_judge: null (у модели судьи нет pricing — стоимость не считается)');
    } else {
      printInfo(`cost_judge: ${outcome.cost} (в cost вариантов не примешивается)`);
    }
    printInfo('Статус прогона пересчитывает `experiment report` — judge его не меняет');
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}
