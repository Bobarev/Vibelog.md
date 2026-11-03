/**
 * Подкоманды `run` и `record` команды `vibelog experiment` (VL-296, doc-21 §7–§8).
 *
 * Вынесены из `experiment.ts`, чтобы файл каркаса не разрастался: здесь только
 * жизненный цикл прогона (создание рана, dry-run матрицы, upsert результатов,
 * восстановление зависшего рана) — логика карточки и датасетов остаётся там.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import { getFlag, hasFlag } from './../args.js';
import type { FlagValues } from './../args.js';
import { printSuccess, printError, printInfo } from './../ui.js';
import {
  getExperiment, createRunDir, writeMetaJson, readMetaJson, detectStaleRun,
  recoverRun, listRunNumbers, latestRunNumber, runDirFor, syncExperimentStatus,
} from '../../core/experiment.js';
import type { RunMeta } from '../../core/experiment.js';
import { experimentsDir } from '../../core/paths.js';
import { readDatasetFile, resolveDataset } from '../../core/dataset.js';
import type { ParsedDataset } from '../../core/dataset.js';
import { resolveVariantPrompts } from '../../core/prompts.js';
import type { ResolvedPrompt } from '../../core/prompts.js';
import { readResultsFile, upsertResult, rewriteResultsJsonl, resultsPath,
  normalizeResultRow, RESULT_ERROR_KINDS, resultKey,
} from '../../core/results.js';
import type { ResultRow } from '../../core/results.js';
import { runAiPhaseExperiment, runExternalExperiment } from '../../core/experiment-runner.js';

/** Путь относительно корня проекта для печати в CLI. */
function displayPath(backlogDir: string, path: string): string {
  const rel = relative(join(backlogDir, '..'), path);
  return rel.startsWith('..') ? path : rel;
}

/** Описание резолва промпта для печати: kind + файл/фаза. */
function describePrompt(p: ResolvedPrompt): string {
  switch (p.kind) {
    case 'builtin':
      return `builtin:${p.phase} (встроенный шаблон ${p.resolution.path})`;
    case 'private':
      return `частный ${p.relativePath}`;
    case 'shared':
      return `общий ${p.relativePath}`;
    case 'explicit':
      return `по пути ${p.relativePath}`;
    default:
      return p.relativePath || p.name;
  }
}

/**
 * Флаги escape hatch `--variant-a-prompt-path` / `--variant-b-prompt-path`.
 *
 * Ключи перебираются по факту наличия, а не хардкодятся A/B: схема вариантов —
 * map, и `--variant-c-prompt-path` должен работать без правки парсера.
 */
function variantPromptPaths(flags: FlagValues): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const key of Object.keys(flags)) {
    const m = /^variant-([a-zA-Z0-9])-prompt-path$/.exec(key);
    if (!m) continue;
    const value = getFlag(flags, key, '');
    if (value) paths[m[1].toUpperCase()] = value;
  }
  return paths;
}

/** Разбирает `--variant A,B` в список ключей (пусто — все варианты карточки). */
function filterVariants(variants: string[], flagValue: string): string[] {
  const wanted = flagValue
    ? flagValue.split(',').map(v => v.trim().toUpperCase()).filter(v => v !== '')
    : [];
  if (wanted.length === 0) return variants;
  const unknown = wanted.filter(v => !variants.includes(v));
  if (unknown.length > 0) {
    throw new Error(`В карточке нет вариантов: ${unknown.join(', ')} (есть: ${variants.join(', ')})`);
  }
  return wanted;
}

/** Разбирает `--custom '<json>'` в объект (пусто — undefined). */
function parseCustomFlag(raw: string): Record<string, unknown> | undefined {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new Error(`--custom должен быть JSON-объектом: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--custom должен быть JSON-объектом, например \'{"tokens": 120}\'');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Разбирает `--rerun N` / `--yes` (VL-300, doc-21 §17 п.6).
 *
 * Run неизменяем: `--rerun N` НЕ перезаписывает `run-N`, а создаёт новый
 * `run-(max+1)` с `rerun_of: run-N`. Требование `--yes` — защита от
 * случайного дубля дорогого прогона: одна опечатка в `--rerun` иначе стоила
 * бы полной стоимости эксперимента.
 *
 * @returns номер перезапускаемого рана (null — обычный прогон)
 * @throws Error с текстом для пользователя (CLI печатает как есть)
 */
function resolveRerun(flags: FlagValues, backlogDir: string, expId: string): number | null {
  const raw = getFlag(flags, 'rerun', '');
  if (raw === '') {
    if (hasFlag(flags, 'yes')) {
      throw new Error('--yes имеет смысл только вместе с --rerun N: подтверждать нечего');
    }
    return null;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--rerun: ожидается номер прогона (положительное целое), получено: "${raw}"`);
  }
  const existing = listRunNumbers(join(experimentsDir(backlogDir), expId));
  if (!existing.includes(n)) {
    throw new Error(
      `Прогон run-${n} не найден (есть: ${existing.length ? existing.join(', ') : 'нет'}) — `
      + `перезапускать нечего`
    );
  }
  if (!hasFlag(flags, 'yes')) {
    throw new Error(
      `--rerun ${n} создаст НОВЫЙ прогон run-${(existing[existing.length - 1] ?? 0) + 1} `
      + `(rerun_of: run-${n}) и потратит ресурсы повторно. `
      + `Подтвердите: vibelog experiment run ${expId} --rerun ${n} --yes`
    );
  }
  return n;
}

/**
 * `experiment run <exp-id>` — manual runner (doc-21 §3, §8).
 *
 * `--dry-run` печатает матрицу «строки датасета × варианты» и резолвнутые
 * промпты, ничего не создавая. Без `--dry-run` создаётся каталог `run-<N>`
 * с `meta.json` (status: running, pid, started_at) и печатается инструкция.
 * Manual-прогон **не завершается сам**: статус закрывает `report` (VL-297) —
 * `completed` на половине данных опаснее, чем явный `running`.
 */
export function experimentRun(positional: string[], flags: FlagValues, backlogDir: string): void | Promise<void> {
  const expId = (positional[0] || '').trim();
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment run <exp-id> [--dry-run] [--recover] [--rerun N --yes]');
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
    const runsDir = join(experimentsDir(backlogDir), exp.id);

    // ── --recover: перевести зависший ран в failed, сохранив частичные results ──
    if (hasFlag(flags, 'recover')) {
      const runFlag = getFlag(flags, 'run', '');
      const targetRun = runFlag ? Number.parseInt(runFlag, 10) : latestRunNumber(backlogDir, exp.id);
      if (!targetRun || !Number.isFinite(targetRun)) {
        printError(`У эксперимента ${exp.id} нет прогонов — восстанавливать нечего`);
        process.exitCode = 1;
        return;
      }
      const recovered = recoverRun(backlogDir, exp.id, targetRun, {
        reason: getFlag(flags, 'reason', '') || undefined,
      });
      syncExperimentStatus(backlogDir, exp.id);
      printSuccess(`Прогон run-${recovered.run} переведён в failed (причина: ${recovered.reason})`);
      printInfo('Частичные results.jsonl сохранены — их читает report');
      return;
    }

    // ── --rerun N --yes: новый ран с rerun_of (run неизменяем, doc-21 §17 п.6) ──
    const rerunOf = resolveRerun(flags, backlogDir, exp.id);

    if (exp.runner === 'ai-phase') {
      // VL-299: ai-phase runner — асинхронный (спавн ранов), поэтому
      // возвращаем промис: runExperiment объявлен async и дождётся его
      return runAiPhase(exp.id, flags, backlogDir, join(backlogDir, '..'), rerunOf);
    }

    if (exp.runner === 'external') {
      // VL-300: внешняя команда — тоже асинхронный спавн
      return runExternal(exp.id, flags, backlogDir, join(backlogDir, '..'), rerunOf);
    }

    if (exp.runner !== 'manual') {
      printError(`Раннер "${exp.runner}" не поддерживается в этой версии: доступны runner: manual, ai-phase и external`);
      process.exitCode = 1;
      return;
    }

    // ── Датасет: обязательный вход прогона ──
    if (!exp.dataset) {
      printError(`У эксперимента ${exp.id} не указан dataset — задайте его при create (--dataset)`);
      process.exitCode = 1;
      return;
    }
    const dataset = resolveDataset(backlogDir, exp.id, exp.dataset, {
      explicitPath: getFlag(flags, 'dataset-path', ''),
    });
    const parsed: ParsedDataset = readDatasetFile(dataset.absolutePath);
    if (parsed.rows.length === 0) {
      printError(`Датасет ${dataset.relativePath} не содержит валидных строк`);
      for (const e of parsed.errors) console.error(`  ошибка: ${e.message}`);
      process.exitCode = 1;
      return;
    }

    const variants = filterVariants(Object.keys(exp.variants), getFlag(flags, 'variant', ''));
    if (variants.length === 0) {
      printError(`У эксперимента ${exp.id} нет вариантов — создайте карточку с --variant A:builtin:spec`);
      process.exitCode = 1;
      return;
    }
    const resolved = resolveVariantPrompts(backlogDir, exp.id, exp.variants, {
      paths: variantPromptPaths(flags),
      cwd: join(backlogDir, '..'),
    });
    const promptErrors = Object.entries(resolved)
      .filter(([, r]) => r.error)
      .map(([key, r]) => `${key}: ${r.error}`);
    if (promptErrors.length > 0) {
      for (const msg of promptErrors) printError(msg);
      process.exitCode = 1;
      return;
    }

    // ── --dry-run: матрица + резолв, без создания рана ──
    if (hasFlag(flags, 'dry-run')) {
      console.log('');
      console.log(`  эксперимент: ${exp.id} — ${exp.title}`);
      console.log(`  датасет: ${dataset.relativePath} (${dataset.resolution.chosen}); строк: ${parsed.rows.length}`);
      console.log('');
      const width = Math.max(8, ...parsed.rows.map(r => r.task_id.length));
      const head = `${'task_id'.padEnd(width)}  ${variants.join('  ')}`;
      console.log(`  ${head}`);
      console.log(`  ${'-'.repeat(head.length)}`);
      for (const row of parsed.rows) {
        console.log(`  ${row.task_id.padEnd(width)}  ${variants.map(() => '·').join('  ')}`);
      }
      console.log('');
      for (const key of variants) {
        const r = resolved[key].resolved as ResolvedPrompt;
        console.log(`  вариант ${key}: prompt="${exp.variants[key].prompt}" → ${describePrompt(r)}`);
        for (const w of r.warnings) console.error(`  предупреждение: ${w}`);
      }
      console.log('');
      printInfo(`Пар (task_id × variant): ${parsed.rows.length * variants.length} — столько записей record и нужно`);
      printInfo('--dry-run: ран не создан');
      return;
    }

    // ── Создание рана ──
    const { run, runDir } = createRunDir(backlogDir, exp.id);
    const promptsResolution: Record<string, unknown> = {};
    for (const key of variants) {
      promptsResolution[key] = (resolved[key].resolved as ResolvedPrompt).resolution;
    }
    const meta: RunMeta = {
      schema_version: 1,
      exp_id: exp.id,
      run,
      status: 'running',
      runner: exp.runner,
      started_at: new Date().toISOString(),
      finished_at: null,
      // manual-ран не форкает процесс: записи делает человек, поэтому pid = null
      // (detectStaleRun такой ран зависшим не считает — закрывает report)
      pid: null,
      resolution: { dataset: dataset.resolution, prompts: promptsResolution },
      results_ignored: false,
      n: 0,
      dropped: 0,
      cost_total: null,
      pricing_missing: true,
      rerun_of: rerunOf,
      reason: null,
    };
    writeMetaJson(runDir, meta);
    syncExperimentStatus(backlogDir, exp.id);

    printSuccess(`Прогон создан: ${displayPath(backlogDir, runDir)} (status: running)`);
    printInfo(`Датасет: ${dataset.relativePath} (строк: ${parsed.rows.length})`);
    for (const key of variants) {
      const r = resolved[key].resolved as ResolvedPrompt;
      console.log(`  вариант ${key}: ${describePrompt(r)}`);
    }
    console.log('');
    printInfo('Manual-прогон: выполните вариант и запишите результат командой');
    console.log(`  vibelog experiment record ${exp.id} --run ${run} --variant ${variants[0]} --task <task_id> --score <n>`);
    printInfo('Задачи датасета:');
    for (const row of parsed.rows) {
      const expected = row.expected_ac ? ` — ожидается: ${row.expected_ac.split('\n')[0].slice(0, 60)}` : '';
      console.log(`  ${row.task_id}${expected}`);
    }
    printInfo('Прогон НЕ завершается сам: статус закрывает `experiment report`, когда все пары task_id × variant записаны');
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/**
 * `experiment run <exp-id>` для runner: ai-phase (VL-299, doc-21 §13–§14).
 *
 * Тонкая CLI-обёртка над `runAiPhaseExperiment`: разбор флагов (`--timeout`,
 * `--max-tool-calls`, `--variant`, `--dry-run`), печать прогресса и итога.
 * Вся логика изоляции/таймаутов/стоимости живёт в core-модуле — CLI не
 * должен содержать правил эксперимента (иначе MCP-поверхность их не получит).
 */
async function runAiPhase(
  expId: string,
  flags: FlagValues,
  backlogDir: string,
  cwd: string,
  rerunOf: number | null = null
): Promise<void> {
  const timeoutRaw = getFlag(flags, 'timeout', '');
  let timeoutSec: number | undefined;
  if (timeoutRaw !== '') {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n) || n <= 0) {
      printError(`--timeout: ожидается положительное число секунд, получено: "${timeoutRaw}"`);
      process.exitCode = 1;
      return;
    }
    timeoutSec = n;
  }
  const maxToolCallsRaw = getFlag(flags, 'max-tool-calls', '');
  let maxToolCalls: number | undefined;
  if (maxToolCallsRaw !== '') {
    const n = Number.parseInt(maxToolCallsRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      printError(`--max-tool-calls: ожидается положительное целое, получено: "${maxToolCallsRaw}"`);
      process.exitCode = 1;
      return;
    }
    maxToolCalls = n;
  }
  const variantFlag = getFlag(flags, 'variant', '');
  const variants = variantFlag
    ? variantFlag.split(',').map(v => v.trim().toUpperCase()).filter(v => v !== '')
    : undefined;

  try {
    const result = await runAiPhaseExperiment({
      cwd,
      backlogDir,
      expId,
      variants,
      timeoutSec,
      maxToolCalls,
      dryRun: hasFlag(flags, 'dry-run'),
      rerunOf,
      onProgress: (line) => console.log(line),
    });
    if (result.status === 'dry-run') return;
    const where = result.runDir ? displayPath(backlogDir, result.runDir) : '';
    if (result.status === 'failed') {
      printError(`Прогон run-${result.run} завершён со статусом failed: ${result.reason ?? 'причина неизвестна'}`);
      printInfo(`Частичные результаты сохранены: ${where}/results.jsonl (строк: ${result.rows.length})`);
      process.exitCode = 1;
      return;
    }
    printSuccess(`Прогон run-${result.run} завершён: строк ${result.rows.length} (${where})`);
    if (result.pricingMissing) {
      printInfo('У части вариантов нет pricing в models.available — cost: null (не 0)');
    }
    if (result.costTotal !== null) printInfo(`Стоимость прогона: ${result.costTotal}`);
    printInfo('Оценки ставит `experiment judge` (или человек через record); отчёт — `experiment report`');
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}


/**
 * `experiment run <exp-id>` для runner: external (VL-300, doc-21 §13).
 *
 * Тонкая CLI-обёртка над `runExternalExperiment`: флаг `--runner-cmd`
 * (обязателен), `--timeout`, `--variant`, `--dry-run`. Команда получает
 * JSON-строку входа на stdin и печатает results-строку на stdout.
 *
 * `--runner-cmd` — произвольный код пользователя, поэтому он **не** берётся
 * из карточки и не имеет дефолта: запуск возможен только явным флагом
 * (в карточке лежит только `runner: external` — факт согласия пользователя).
 */
async function runExternal(
  expId: string,
  flags: FlagValues,
  backlogDir: string,
  cwd: string,
  rerunOf: number | null = null
): Promise<void> {
  const runnerCmd = getFlag(flags, 'runner-cmd', '').trim();
  if (!runnerCmd) {
    printError(
      'Для runner: external обязателен --runner-cmd \'<shell-команда>\': '
      + 'команда получает JSON-строку датасета на stdin и печатает results-строку на stdout'
    );
    process.exitCode = 1;
    return;
  }
  const timeoutRaw = getFlag(flags, 'timeout', '');
  let timeoutSec: number | undefined;
  if (timeoutRaw !== '') {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n) || n <= 0) {
      printError(`--timeout: ожидается положительное число секунд, получено: "${timeoutRaw}"`);
      process.exitCode = 1;
      return;
    }
    timeoutSec = n;
  }
  const variantFlag = getFlag(flags, 'variant', '');
  const variants = variantFlag
    ? variantFlag.split(',').map(v => v.trim().toUpperCase()).filter(v => v !== '')
    : undefined;

  try {
    const result = await runExternalExperiment({
      cwd,
      backlogDir,
      expId,
      runnerCmd,
      variants,
      timeoutSec,
      dryRun: hasFlag(flags, 'dry-run'),
      rerunOf,
      onProgress: (line) => console.log(line),
    });
    if (result.status === 'dry-run') return;
    const where = result.runDir ? displayPath(backlogDir, result.runDir) : '';
    if (result.status === 'failed') {
      printError(`Прогон run-${result.run} завершён со статусом failed: ${result.reason ?? 'причина неизвестна'}`);
      printInfo(`Частичные результаты сохранены: ${where}/results.jsonl (строк: ${result.rows.length})`);
      process.exitCode = 1;
      return;
    }
    const failed = result.rows.filter(r => r.error).length;
    printSuccess(
      `Прогон run-${result.run} завершён: строк ${result.rows.length} (${where})`
      + (failed > 0 ? `, с ошибкой ${failed}` : '')
    );
    if (rerunOf !== null) printInfo(`Перезапуск прогона run-${rerunOf} (rerun_of)`);
    printInfo('Оценки ставит `experiment judge` (или человек через record); отчёт — `experiment report`');
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/**
 * `experiment record <exp-id>` — записать результат варианта (doc-21 §7).
 *
 * Семантика — **upsert по `(task_id, variant)`**: повторный record по той же
 * паре заменяет строку. Append оставил бы два противоречащих числа, и отчёт
 * зависел бы от порядка строк. Файл переписывается атомарно (temp + rename),
 * чтобы SIGINT не оставил половину JSON-строки.
 *
 * Целевой ран: `--run N`, иначе последний; если ранов больше одного и `--run`
 * не задан — предупреждение в stderr (молчаливая запись в «последний» при
 * нескольких прогонах — типичная ошибка при сравнении).
 */
export function experimentRecord(positional: string[], flags: FlagValues, backlogDir: string): void {
  const expId = (positional[0] || '').trim();
  if (!expId) {
    printError('Укажите id эксперимента: vibelog experiment record <exp-id> --variant A --task <id> [--score n]');
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

    // ── Целевой ран ──
    const runFlag = getFlag(flags, 'run', '');
    const existingRuns = listRunNumbers(join(experimentsDir(backlogDir), exp.id));
    let run: number;
    if (runFlag) {
      run = Number.parseInt(runFlag, 10);
      if (!Number.isFinite(run) || run <= 0) {
        printError(`Неверное значение --run: "${runFlag}". Ожидается номер прогона`);
        process.exitCode = 1;
        return;
      }
      if (!existingRuns.includes(run)) {
        printError(`Прогон run-${run} не найден (есть: ${existingRuns.length ? existingRuns.join(', ') : 'нет'}) — создайте: experiment run ${exp.id}`);
        process.exitCode = 1;
        return;
      }
    } else {
      if (existingRuns.length === 0) {
        printError(`У эксперимента ${exp.id} нет прогонов — создайте: experiment run ${exp.id}`);
        process.exitCode = 1;
        return;
      }
      run = existingRuns[existingRuns.length - 1];
      if (existingRuns.length > 1) {
        console.error(
          `Предупреждение: у эксперимента ${exp.id} несколько прогонов (${existingRuns.join(', ')}), `
          + `--run не задан — записываю в последний run-${run}. Укажите --run явно, чтобы не перепутать прогоны`
        );
      }
    }

    const runDir = runDirFor(backlogDir, exp.id, run);
    const meta = readMetaJson(runDir);
    if (meta) {
      const stale = detectStaleRun(meta);
      if (stale.stale) {
        console.error(`Предупреждение: ${stale.reason}. Восстановите прогон: experiment run ${exp.id} --recover`);
      }
      if (meta.status === 'completed') {
        console.error(`Предупреждение: прогон run-${run} уже completed — запись добавит данные в закрытый прогон`);
      }
    }

    // ── Строки результата: --from-json пачкой либо отдельными флагами ──
    const variantKeys = Object.keys(exp.variants);
    const rows: ResultRow[] = [];

    const fromJson = getFlag(flags, 'from-json', '');
    if (fromJson) {
      const path = isAbsolute(fromJson) ? fromJson : join(process.cwd(), fromJson);
      if (!existsSync(path)) {
        printError(`Файл --from-json не найден: ${fromJson}`);
        process.exitCode = 1;
        return;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(readFileSync(path, 'utf-8'));
      } catch (err) {
        printError(`--from-json: битый JSON — ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
      const list = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      for (const item of list) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          printError('--from-json: ожидался массив объектов results-строк');
          process.exitCode = 1;
          return;
        }
        const normalized = normalizeResultRow(item as Record<string, unknown>);
        if ('error' in normalized) {
          printError(`--from-json: ${normalized.error.message}`);
          process.exitCode = 1;
          return;
        }
        rows.push(normalized.row);
      }
    } else {
      const taskId = getFlag(flags, 'task', '');
      if (!taskId) {
        printError('Укажите задачу: --task <task_id> (или --from-json <file>)');
        process.exitCode = 1;
        return;
      }
      const variant = getFlag(flags, 'variant', '').trim().toUpperCase();
      if (!variant) {
        printError('Укажите вариант: --variant A');
        process.exitCode = 1;
        return;
      }
      if (variantKeys.length > 0 && !variantKeys.includes(variant)) {
        printError(`В карточке ${exp.id} нет варианта "${variant}" (есть: ${variantKeys.join(', ')})`);
        process.exitCode = 1;
        return;
      }
      const errorText = getFlag(flags, 'error', '');
      const errorKind = getFlag(flags, 'error-kind', '');
      if (errorKind && !(RESULT_ERROR_KINDS as readonly string[]).includes(errorKind)) {
        printError(`Неверный --error-kind: "${errorKind}". Допустимые: ${RESULT_ERROR_KINDS.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const scoreRaw = getFlag(flags, 'score', '');
      let score: number | null = null;
      if (scoreRaw !== '') {
        const num = Number(scoreRaw);
        if (!Number.isFinite(num)) {
          printError(`Неверное значение --score: "${scoreRaw}". Ожидается число`);
          process.exitCode = 1;
          return;
        }
        score = num;
      }
      const custom = parseCustomFlag(getFlag(flags, 'custom', ''));
      const toolCallsRaw = getFlag(flags, 'tool-calls', '');
      const durationRaw = getFlag(flags, 'duration', '');
      const costRaw = getFlag(flags, 'cost', '');
      const output = getFlag(flags, 'output', '');
      rows.push({
        task_id: taskId,
        variant,
        score,
        ...(output !== '' ? { output } : {}),
        ...(errorText !== '' ? { error: errorText } : {}),
        ...(errorKind !== '' ? { error_kind: errorKind } : {}),
        ...(toolCallsRaw !== '' && Number.isFinite(Number(toolCallsRaw)) ? { tool_calls: Number(toolCallsRaw) } : {}),
        ...(durationRaw !== '' && Number.isFinite(Number(durationRaw)) ? { duration_ms: Number(durationRaw) } : {}),
        ...(costRaw !== '' ? { cost: Number.isFinite(Number(costRaw)) ? Number(costRaw) : null } : {}),
        ...(custom ? { custom } : {}),
      });
    }

    // ── Upsert пачкой и атомарная перезапись файла ──
    const path = resultsPath(runDir);
    const existing = readResultsFile(path);
    if (existing.errors.length > 0) {
      for (const e of existing.errors) {
        console.error(`Предупреждение: ${e.message} — строка будет потеряна при перезаписи файла`);
      }
    }
    let merged = existing.rows;
    let replaced = 0;
    for (const row of rows) {
      if (merged.some(r => resultKey(r) === resultKey(row))) replaced += 1;
      merged = upsertResult(merged, row);
    }
    rewriteResultsJsonl(path, merged);

    printSuccess(
      `Записано в ${displayPath(backlogDir, path)}: строк ${rows.length} `
      + `(новых: ${rows.length - replaced}, перезаписано: ${replaced}); всего в прогоне: ${merged.length}`
    );
    printInfo('Статус прогона закрывает `experiment report` — record его не меняет');
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}
