/**
 * ai-phase runner экспериментов (VL-299, doc-21 §11–§14).
 *
 * Автоматический прогон фазы агентом: для каждой строки датасета × каждого
 * варианта запускается headless-ран `vibelog-agent` с промптом варианта, а
 * результат (score/usage/tool_calls/cost) пишется строкой в `results.jsonl`.
 *
 * Главный риск фичи — изоляция (doc-21 §13). Решения:
 * - **отдельный git worktree на прогон** (`ensureExperimentWorktree`): вариант
 *   пишет файлы и коммитит в ветку `exp/<id>-run-<N>`, основной репозиторий
 *   не трогается;
 * - **откат после каждой задачи** (`reset --hard` + `clean -fd`) в
 *   `try/finally` — вариант B получает то же начальное состояние, что и A,
 *   даже если ран упал/был убит таймаутом;
 * - **billing не пишется**: env-маркер `VIBELOG_EXPERIMENT` переключает
 *   учёт usage в `<run-dir>/usage.json` (см. `billingSuppressed`);
 * - **параллельные прогоны одного эксперимента запрещены**: lock по pid в
 *   `meta.json` последнего рана (второй `run` при живом pid — отказ, не очередь).
 *
 * Источник `tool_calls` (doc-21 §12, проверено по коду): stdout-результат рана
 * `type=result`.`tool_calls_total`; fallback — `countToolCallsInMessages` по
 * jsonl сессии рана. `run-progress` этой метрики не содержит — не используется.
 *
 * Стоимость (doc-21 §11) считается по модели ВАРИАНТА
 * (`models.available[<variant.model>].pricing` → `getModelPricingById` →
 * `calculateCost`); нет тарифа → `cost: null` (+`pricing_missing` в meta),
 * НЕ 0: ноль означал бы «вариант бесплатен» и выигрывал бы сравнение по цене.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getExperiment, createRunDir, writeMetaJson, readMetaJson, latestRunNumber,
  runDirFor, syncExperimentStatus, detectStaleRun, listRunNumbers,
} from './experiment.js';
import type { Experiment, RunMeta, VariantConfig } from './experiment.js';
import { readDatasetFile, resolveDataset } from './dataset.js';
import type { DatasetRow } from './dataset.js';
import { resolveVariantPrompts } from './prompts.js';
import type { ResolvedPrompt } from './prompts.js';
import {
  readResultsFile, upsertResult, rewriteResultsJsonl, resultsPath, normalizeResultRow,
} from './results.js';
import type { ResultRow, ResultUsage } from './results.js';
import { calculateCost, getModelPricingById } from './analytics.js';
import type { TokenUsage } from './analytics.js';
import { parseQwenResult } from '../web/qwen-result.js';
import { agentSessionsDir, countToolCallsInMessages } from '../agent/session.js';
import type { ChatMessage } from '../agent/llm.js';
import {
  ensureExperimentWorktree, resetExperimentWorktree, removeExperimentWorktree,
} from './worktree.js';
import { EXPERIMENT_ENV } from './billing.js';

/** Дефолтный таймаут одной задачи (doc-21 §19 п.1: 600 с). */
export const DEFAULT_TASK_TIMEOUT_SEC = 600;

/** Дефолтный лимит tool-calls рана (как у агента, VL-83). */
export const DEFAULT_MAX_TOOL_CALLS = 100;

/** Таймаут health-check внешней команды (сек): дольше — считаем «не ответил». */
export const EXTERNAL_HEALTH_CHECK_TIMEOUT_SEC = 30;

/** Итог одного спавна рана (тестовый шов подменяет реализацию). */
export interface SpawnRunResult {
  /** Код выхода (null — процесс убит сигналом). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Ран убит по таймауту задачи. */
  timedOut: boolean;
  /** Ран убит внешним сигналом (SIGINT/SIGTERM). */
  interrupted: boolean;
}

/** Параметры спавна рана. */
export interface SpawnRunParams {
  /** Путь к бинарю агента. */
  bin: string;
  /** Аргументы (промпт + флаги). */
  args: string[];
  /** Рабочий каталог рана (worktree прогона). */
  cwd: string;
  /** Окружение рана (включая VIBELOG_EXPERIMENT). */
  env: NodeJS.ProcessEnv;
  /** Таймаут задачи (мс). */
  timeoutMs: number;
  /** Сигнал прерывания прогона (SIGINT). */
  signal?: AbortSignal;
}

/** Функция спавна рана (по умолчанию — child_process.spawn). */
export type SpawnRunFn = (params: SpawnRunParams) => Promise<SpawnRunResult>;

/** Опции прогона ai-phase. */
export interface AiPhaseRunOptions {
  /** Корень проекта (там .vibelog и backlog). */
  cwd: string;
  /** Корень backlog-а. */
  backlogDir: string;
  /** id эксперимента. */
  expId: string;
  /** Фильтр вариантов (пусто — все из карточки). */
  variants?: string[];
  /** Таймаут задачи в секундах (флаг --timeout; иначе timeout_sec; иначе 600). */
  timeoutSec?: number;
  /** Лимит tool-calls рана (--max-tool-calls). */
  maxToolCalls?: number;
  /** Только матрица + оценка стоимости, без создания рана. */
  dryRun?: boolean;
  /** Ран, перезапуском которого является этот (`--rerun N`, VL-300). */
  rerunOf?: number | null;
  /** Тестовый шов: подмена спавна. */
  spawnRun?: SpawnRunFn;
  /** Канал прогресса (CLI печатает в stdout). */
  onProgress?: (line: string) => void;
}

/** Итог прогона. */
export interface AiPhaseRunResult {
  /** Номер прогона (null при --dry-run). */
  run: number | null;
  /** Каталог прогона (null при --dry-run). */
  runDir: string | null;
  /** Статус прогона. */
  status: 'running' | 'completed' | 'failed' | 'dry-run';
  /** Записанные строки результатов. */
  rows: ResultRow[];
  /** Сумма стоимостей; null — тарифов нет ни у одного варианта. */
  costTotal: number | null;
  /** Хотя бы у одного варианта не было pricing. */
  pricingMissing: boolean;
  /** Причина failed (SIGINT/ошибка). */
  reason: string | null;
}

/** Ошибка прогона с понятным текстом (CLI печатает её как есть). */
export class ExperimentRunError extends Error {}

/** Разрешает бинарь агента: VIBELOG_AGENT_BIN → <cwd>/bin/vibelog-agent.mjs. */
export function resolveAgentBin(cwd: string): string {
  const fromEnv = process.env.VIBELOG_AGENT_BIN;
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  return join(cwd, 'bin', 'vibelog-agent.mjs');
}

/**
 * Спавн рана по умолчанию: child_process.spawn + таймаут + прерывание.
 *
 * Таймаут реализован здесь, а не только флагом `--max-wall-time` агента:
 * зависший процесс (сеть, MCP) обязан быть убит, иначе прогон встанет
 * навсегда. По истечении — SIGTERM, через 5 с — SIGKILL.
 */
const defaultSpawnRun: SpawnRunFn = ({ bin, args, cwd, env, timeoutMs, signal }) =>
  new Promise<SpawnRunResult>((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let interrupted = false;
    let settled = false;

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut, interrupted });
    };

    const kill = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // процесс уже вышел — не ошибка
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // см. выше
        }
      }, 5000);
    };

    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    const onAbort = (): void => {
      interrupted = true;
      kill();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });

/** usage из результата рана в формат TokenUsage (requests = num_turns). */
function usageFromResult(result: ReturnType<typeof parseQwenResult>): TokenUsage | undefined {
  if (!result) return undefined;
  const u = result.usage;
  const usage: TokenUsage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cache: u.cache_read_input_tokens,
    total: u.total_tokens,
    requests: result.num_turns,
  };
  if (u.reasoning_tokens) usage.reasoning = u.reasoning_tokens;
  return usage;
}

/** usage строки результата в формат TokenUsage (для оценки стоимости). */
function usageFromRow(row: ResultRow): TokenUsage | undefined {
  if (!row.usage) return undefined;
  return {
    input: row.usage.input ?? 0,
    output: row.usage.output ?? 0,
    cache: row.usage.cache ?? 0,
    total: row.usage.total ?? 0,
    requests: row.usage.requests ?? 0,
  };
}

/**
 * tool_calls по jsonl сессии рана (fallback, doc-21 §12).
 *
 * Читается файл `.vibelog/agent-sessions/<sessionId>.jsonl` главного репо
 * (VIBELOG_CWD рана указывает туда). Битые строки пропускаются: fallback не
 * должен ронять прогон. Нет файла/сессии → undefined («нет данных», не 0).
 */
export function toolCallsFromSession(cwd: string, sessionId: string): number | undefined {
  if (!sessionId) return undefined;
  const path = join(agentSessionsDir(cwd), `${sessionId}.jsonl`);
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
  const messages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
    } catch {
      // битая строка jsonl — пропускаем (паттерн sumUsageFromJsonlSync)
    }
  }
  return countToolCallsInMessages(messages);
}

/**
 * Проверяет lock прогона: живой pid последнего рана → отказ (doc-21 §19 п.2).
 *
 * Очередь отклонена намеренно: два прогона одного эксперимента пишут в один
 * `results.jsonl` и делят worktree-каталоги — «подождать и запустить» дало бы
 * перемешанные данные вместо понятной ошибки.
 *
 * @throws ExperimentRunError, если прогон уже идёт
 */
export function assertNoActiveRun(backlogDir: string, expId: string): void {
  const last = latestRunNumber(backlogDir, expId);
  if (last === null) return;
  const meta = readMetaJson(runDirFor(backlogDir, expId, last));
  if (!meta) return;
  const stale = detectStaleRun(meta);
  if (meta.status === 'running' && !stale.stale) {
    throw new ExperimentRunError(
      `Прогон ${expId}/run-${last} уже идёт (pid ${meta.pid ?? '—'}). `
      + 'Параллельные прогоны одного эксперимента запрещены: дождитесь завершения '
      + `или восстановите зависший ран: vibelog experiment run ${expId} --recover`
    );
  }
}

/** Оценка стоимости по прошлым ранам (средний usage × тариф варианта). */
export interface CostEstimate {
  /** Средний usage одной строки по прошлым ранам; null — данных нет. */
  avgUsage: TokenUsage | null;
  /** Оценка стоимости на один прогон варианта; null — нет данных/тарифа. */
  perVariant: Record<string, number | null>;
  /** Число прошлых строк, по которым считалось среднее. */
  sampleRows: number;
}

/**
 * Оценивает стоимость прогона по среднему usage прошлых ранов (doc-21 §10).
 *
 * Данных нет — `avgUsage: null` и «оценки нет» в CLI: выдуманная цифра хуже
 * честного «неизвестно» (дорогой прогон запускают именно по оценке).
 */
export function estimateCost(
  backlogDir: string,
  exp: Experiment,
  variants: string[],
  rowsCount: number
): CostEstimate {
  const runsDir = join(backlogDir, 'experiments', exp.id);
  const numbers = (() => {
    try {
      return readdirRuns(runsDir);
    } catch {
      return [];
    }
  })();
  let sum: TokenUsage = { input: 0, output: 0, cache: 0, total: 0, requests: 0 };
  let sample = 0;
  for (const n of numbers) {
    const parsed = readResultsFile(resultsPath(runDirFor(backlogDir, exp.id, n)));
    for (const row of parsed.rows) {
      const usage = usageFromRow(row);
      if (!usage) continue;
      sum = {
        input: sum.input + usage.input,
        output: sum.output + usage.output,
        cache: sum.cache + usage.cache,
        total: sum.total + usage.total,
        requests: sum.requests + usage.requests,
      };
      sample += 1;
    }
  }
  const avgUsage: TokenUsage | null = sample > 0
    ? {
      input: sum.input / sample,
      output: sum.output / sample,
      cache: sum.cache / sample,
      total: sum.total / sample,
      requests: sum.requests / sample,
    }
    : null;
  const perVariant: Record<string, number | null> = {};
  for (const key of variants) {
    const model = exp.variants[key]?.model;
    if (!avgUsage || !model) {
      perVariant[key] = null;
      continue;
    }
    const pricing = getModelPricingById(join(backlogDir, '..'), model);
    perVariant[key] = pricing ? calculateCost(avgUsage, pricing).total * rowsCount : null;
  }
  return { avgUsage, perVariant, sampleRows: sample };
}

/** Номера ранов каталога эксперимента (по возрастанию). */
function readdirRuns(runsDir: string): number[] {
  return listRunNumbers(runsDir);
}

/** Собирает аргументы рана: промпт варианта + лимиты. */
function buildRunArgs(promptText: string, maxToolCalls: number, timeoutSec: number): string[] {
  return [
    promptText,
    '--max-tool-calls', String(maxToolCalls),
    '--max-wall-time', String(timeoutSec),
    '--no-tui',
  ];
}

/** Окружение рана: маркер эксперимента + учёт (billing подавлен). */
function buildRunEnv(
  base: NodeJS.ProcessEnv,
  expId: string,
  runN: number,
  taskId: string,
  variant: string,
  mainCwd: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    [EXPERIMENT_ENV]: `${expId}/run-${runN}`,
    VIBELOG_EXPERIMENT_TASK_ID: taskId,
    VIBELOG_EXPERIMENT_VARIANT: variant,
    // usage.json рана живёт в ГЛАВНОМ репозитории: worktree — временная копия,
    // её backlog исчезнет вместе с worktree (doc-21 §13)
    VIBELOG_CWD: mainCwd,
  };
  // Фазовый env родителя не должен подменять фазу рана эксперимента
  delete env.VIBELOG_PHASE_TASK_ID;
  delete env.VIBELOG_PHASE_NAME;
  delete env.VIBELOG_RUN_PHASE;
  delete env.VIBELOG_SESSION_ID;
  return env;
}

/**
 * Прогоняет эксперимент ai-phase runner'ом (doc-21 §13–§14).
 *
 * Порядок: lock → датасет/варианты → (dry-run | создание рана) → worktree →
 * цикл «строка × вариант» с откатом в `try/finally` → закрытие рана.
 *
 * @throws ExperimentRunError при понятных пользователю проблемах (lock,
 *   датасет, промпты, worktree)
 */
export async function runAiPhaseExperiment(opts: AiPhaseRunOptions): Promise<AiPhaseRunResult> {
  const { cwd, backlogDir, expId } = opts;
  const progress = opts.onProgress ?? (() => {});
  const entry = getExperiment(backlogDir, expId);
  if (!entry) throw new ExperimentRunError(`Эксперимент не найден: ${expId}`);
  const exp = entry.experiment;

  if (!exp.dataset) {
    throw new ExperimentRunError(`У эксперимента ${exp.id} не указан dataset — задайте его при create (--dataset)`);
  }
  const dataset = resolveDataset(backlogDir, exp.id, exp.dataset, {});
  const parsed = readDatasetFile(dataset.absolutePath);
  if (parsed.rows.length === 0) {
    throw new ExperimentRunError(`Датасет ${dataset.relativePath} не содержит валидных строк`);
  }

  const allVariants = Object.keys(exp.variants);
  const variants = opts.variants && opts.variants.length > 0
    ? opts.variants.map(v => v.toUpperCase())
    : allVariants;
  const unknown = variants.filter(v => !allVariants.includes(v));
  if (unknown.length > 0) {
    throw new ExperimentRunError(`В карточке нет вариантов: ${unknown.join(', ')} (есть: ${allVariants.join(', ')})`);
  }
  if (variants.length === 0) {
    throw new ExperimentRunError(`У эксперимента ${exp.id} нет вариантов — создайте карточку с --variant A:builtin:spec`);
  }

  const resolved = resolveVariantPrompts(backlogDir, exp.id, exp.variants, { cwd });
  const promptErrors = Object.entries(resolved)
    .filter(([key, r]) => variants.includes(key) && r.error)
    .map(([key, r]) => `${key}: ${r.error}`);
  if (promptErrors.length > 0) {
    throw new ExperimentRunError(`Промпты вариантов не резолвятся:\n  ${promptErrors.join('\n  ')}`);
  }

  const timeoutSec = opts.timeoutSec ?? exp.timeout_sec ?? DEFAULT_TASK_TIMEOUT_SEC;
  const maxToolCalls = opts.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

  // ── --dry-run: матрица + оценка стоимости, ран не создаётся ──
  if (opts.dryRun) {
    const estimate = estimateCost(backlogDir, exp, variants, parsed.rows.length);
    progress(`  эксперимент: ${exp.id} — ${exp.title}`);
    progress(`  датасет: ${dataset.relativePath} (${dataset.resolution.chosen}); строк: ${parsed.rows.length}`);
    progress(`  вариантов: ${variants.length}; прогонов (строк × вариантов): ${parsed.rows.length * variants.length}`);
    progress(`  таймаут задачи: ${timeoutSec} с; лимит tool-calls: ${maxToolCalls}`);
    progress('');
    for (const key of variants) {
      const r = resolved[key].resolved as ResolvedPrompt;
      const model = exp.variants[key].model ?? '(активная модель)';
      const est = estimate.perVariant[key];
      const estText = est === null
        ? 'оценки нет'
        : `≈ ${est.toFixed(4)} (по ${estimate.sampleRows} прошлым строкам)`;
      progress(`  вариант ${key}: prompt=${exp.variants[key].prompt} → ${r.resolution.path}; модель: ${model}; стоимость: ${estText}`);
    }
    progress('');
    progress('--dry-run: ран не создан');
    return {
      run: null,
      runDir: null,
      status: 'dry-run',
      rows: [],
      costTotal: null,
      pricingMissing: false,
      reason: null,
    };
  }

  // ── Lock: второй прогон того же эксперимента при живом pid — отказ ──
  assertNoActiveRun(backlogDir, exp.id);

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
    // pid — lock прогона (doc-21 §19 п.2): второй run при живом pid отказывает
    pid: process.pid,
    resolution: { dataset: dataset.resolution, prompts: promptsResolution },
    results_ignored: false,
    n: 0,
    dropped: 0,
    cost_total: null,
    pricing_missing: false,
    rerun_of: null,
    reason: null,
  };
  writeMetaJson(runDir, meta);
  syncExperimentStatus(backlogDir, exp.id);

  const spawnRun = opts.spawnRun ?? defaultSpawnRun;
  const bin = resolveAgentBin(cwd);
  const resultsFile = resultsPath(runDir);
  const rows: ResultRow[] = [];
  let costTotal = 0;
  let costKnown = false;
  let pricingMissing = false;
  let reason: string | null = null;
  let status: 'completed' | 'failed' = 'completed';

  // SIGINT/SIGTERM → прогон failed с частичными results (doc-21 §14)
  const ac = new AbortController();
  const onSignal = (): void => {
    reason = 'прогон прерван сигналом (SIGINT/SIGTERM)';
    ac.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let worktree: string | null = null;
  try {
    worktree = ensureExperimentWorktree(cwd, exp.id, run);
    progress(`  worktree прогона: ${worktree}`);

    for (const row of parsed.rows) {
      for (const key of variants) {
        if (ac.signal.aborted) break;
        const variant = exp.variants[key];
        const prompt = resolved[key].resolved as ResolvedPrompt;
        const startedAt = Date.now();
        let result: SpawnRunResult;
        try {
          result = await spawnRun({
            bin,
            args: buildRunArgs(prompt.text, maxToolCalls, timeoutSec),
            cwd: worktree,
            env: buildRunEnv(process.env, exp.id, run, row.task_id, key, cwd),
            timeoutMs: timeoutSec * 1000,
            signal: ac.signal,
          });
        } finally {
          // Откат ОБЯЗАТЕЛЕН и при падении рана: вариант B должен стартовать
          // с того же состояния, что и A (doc-21 §13)
          const resetError = resetExperimentWorktree(worktree);
          if (resetError) progress(`  предупреждение: откат worktree не выполнен — ${resetError}`);
        }

        const durationMs = Date.now() - startedAt;
        const parsedResult = parseQwenResult(result.stdout);
        const usage = usageFromResult(parsedResult);
        const toolCalls = parsedResult?.tool_calls_total
          ?? toolCallsFromSession(cwd, parsedResult?.session_id ?? '');

        // cost по модели ВАРИАНТА; нет тарифа → null (не 0, doc-21 §11)
        let cost: number | null = null;
        if (variant.model && usage) {
          const pricing = getModelPricingById(cwd, variant.model);
          if (pricing) {
            cost = calculateCost(usage, pricing).total;
            costTotal += cost;
            costKnown = true;
          } else {
            pricingMissing = true;
          }
        } else if (variant.model) {
          pricingMissing = true;
        }

        const errorKind = result.timedOut
          ? 'timeout'
          : result.interrupted
            ? 'interrupted'
            : result.code !== 0
              ? 'runner'
              : undefined;

        const resultRow: ResultRow = {
          task_id: row.task_id,
          variant: key,
          // score ставит judge (VL-298) или человек; раннер его не выдумывает
          score: null,
          ...(parsedResult?.result ? { output: parsedResult.result.slice(0, 4000) } : {}),
          ...(errorKind
            ? {
              error: result.timedOut
                ? `таймаут задачи (${timeoutSec} с)`
                : result.interrupted
                  ? 'ран прерван сигналом'
                  : `ран завершился с кодом ${result.code ?? 'signal'}`,
              error_kind: errorKind,
            }
            : {}),
          ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
          ...(usage ? { usage: usage as ResultUsage } : {}),
          cost,
          duration_ms: durationMs,
        };
        rows.push(resultRow);
        // upsert + атомарная перезапись: SIGINT не оставит половину строки
        const existing = readResultsFile(resultsFile);
        rewriteResultsJsonl(resultsFile, upsertResult(existing.rows, resultRow));
        progress(
          `  ${row.task_id} × ${key}: ${errorKind ? `ошибка (${errorKind})` : 'ok'}`
          + `${toolCalls !== undefined ? `, tool_calls=${toolCalls}` : ''}`
          + `${cost !== null ? `, cost=${cost}` : ', cost=null'}`
        );
      }
      if (ac.signal.aborted) break;
    }
  } catch (err) {
    status = 'failed';
    reason = (err as Error).message;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (ac.signal.aborted) {
      status = 'failed';
      reason = reason ?? 'прогон прерван сигналом (SIGINT/SIGTERM)';
    }
    // Уборка worktree: прогон закончен (успех или провал) — дерево не нужно
    if (worktree) {
      const removeError = removeExperimentWorktree(cwd, exp.id, run);
      if (removeError) progress(`  предупреждение: worktree не удалён — ${removeError}`);
    }
    const finalMeta: RunMeta = {
      ...meta,
      status,
      finished_at: new Date().toISOString(),
      n: rows.filter(r => !r.error).length,
      dropped: rows.filter(r => r.error).length,
      cost_total: costKnown ? Math.round(costTotal * 1e6) / 1e6 : null,
      pricing_missing: pricingMissing,
      reason,
    };
    writeMetaJson(runDir, finalMeta);
    syncExperimentStatus(backlogDir, exp.id);
  }

  return {
    run,
    runDir,
    status,
    rows,
    costTotal: costKnown ? Math.round(costTotal * 1e6) / 1e6 : null,
    pricingMissing,
    reason,
  };
}

/** Экспорт для тестов: сборка аргументов рана. */
export { buildRunArgs, buildRunEnv };

// ── External runner (VL-300, doc-21 §13) ──

/**
 * Параметры одного вызова внешней команды раннера.
 *
 * Команда получает на stdin **одну JSON-строку** (`{task_id, variant, ...}`),
 * а на stdout обязана вернуть **одну JSON-строку** результата (doc-21 §7).
 * Такой контракт позволяет подключить любой язык/скрипт без SDK: обмен идёт
 * построчно через stdin/stdout, как в JSONL-формате.
 */
export interface SpawnExternalParams {
  /** Shell-команда (исполняется через `/bin/sh -c`). */
  cmd: string;
  /** Рабочий каталог команды (корень проекта, не worktree: команда своя). */
  cwd: string;
  /** JSON-строка входа (датасет + вариант). */
  stdin: string;
  /** Окружение (без фазового env агентской сессии). */
  env: NodeJS.ProcessEnv;
  /** Таймаут задачи (мс). */
  timeoutMs: number;
}

/** Итог вызова внешней команды. */
export interface SpawnExternalResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Функция спавна внешней команды (по умолчанию — `/bin/sh -c`). */
export type SpawnExternalFn = (params: SpawnExternalParams) => Promise<SpawnExternalResult>;

/**
 * Спавн внешней команды по умолчанию: `/bin/sh -c` + stdin/stdout + таймаут.
 *
 * Почему shell, а не массив argv: пользователь передаёт `--runner-cmd` одной
 * строкой (`'node scripts/run.mjs --model x'`), разбирать её на слова вручную
 * значило бы изобретать парсер кавычек. `/bin/sh` есть на целевой macOS.
 * Таймаут обязателен: зависшая команда иначе остановит прогон навсегда
 * (SIGTERM, через 5 с — SIGKILL, как в ai-phase раннере).
 */
const defaultSpawnExternal: SpawnExternalFn = ({ cmd, cwd, stdin, env, timeoutMs }) =>
  new Promise<SpawnExternalResult>((resolve) => {
    const child = spawn('/bin/sh', ['-c', cmd], { cwd, env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code, stdout, stderr, timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // процесс уже вышел — не ошибка
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // см. выше
        }
      }, 5000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));

    // stdin закрываем всегда: команда, читающая до EOF, иначе будет ждать
    child.stdin?.on('error', () => { /* EPIPE при раннем выходе команды — не ошибка */ });
    child.stdin?.end(`${stdin}\n`);
  });

/**
 * Health-check команды раннера: проверяется только **синтаксис** shell-строки.
 *
 * Выполнять пользовательскую команду «пробным» запуском нельзя: это
 * произвольный код (может писать файлы, тратить деньги), а `--runner-cmd`
 * запускается только по явной воле человека — лишний скрытый запуск нарушал бы
 * это правило. `sh -n` ловит типичную ошибку (незакрытая кавычка/скобка) до
 * первого прогона, а не после N дорогих задач.
 *
 * @throws ExperimentRunError при пустой или синтаксически битой команде
 */
export function assertExternalRunnerHealthy(cmd: string): void {
  const value = String(cmd || '').trim();
  if (!value) {
    throw new ExperimentRunError(
      'Пустая команда раннера: укажите --runner-cmd \'<shell-команда>\' '
      + '(команда получает JSON-строку датасета на stdin и печатает results-строку на stdout)'
    );
  }
  const probe = spawnSync('/bin/sh', ['-n', '-c', value], { encoding: 'utf-8' });
  if (probe.status !== 0) {
    const detail = (probe.stderr || '').trim() || `код ${probe.status ?? 'signal'}`;
    throw new ExperimentRunError(`--runner-cmd: shell не разбирает команду — ${detail}`);
  }
}

/** Вход внешней команды: строка датасета + вариант (doc-21 §5, §7). */
function externalStdinPayload(row: DatasetRow, variant: string, exp: Experiment): string {
  const cfg = exp.variants[variant] ?? {};
  return JSON.stringify({
    task_id: row.task_id,
    variant,
    variant_label: cfg.label ?? null,
    model: cfg.model ?? null,
    params: cfg.params ?? {},
    ...(row.expected_ac !== undefined ? { expected_ac: row.expected_ac } : {}),
    ...(row.input !== undefined ? { input: row.input } : {}),
    ...(row.payload !== undefined ? { payload: row.payload } : {}),
  });
}

/** Окружение внешней команды: маркер эксперимента, без фазового env родителя. */
function buildExternalEnv(
  base: NodeJS.ProcessEnv,
  expId: string,
  runN: number,
  taskId: string,
  variant: string
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    [EXPERIMENT_ENV]: `${expId}/run-${runN}`,
    VIBELOG_EXPERIMENT_TASK_ID: taskId,
    VIBELOG_EXPERIMENT_VARIANT: variant,
  };
  delete env.VIBELOG_PHASE_TASK_ID;
  delete env.VIBELOG_PHASE_NAME;
  delete env.VIBELOG_RUN_PHASE;
  delete env.VIBELOG_SESSION_ID;
  return env;
}

/**
 * Разбирает stdout внешней команды в строку результата.
 *
 * Команде разрешено печатать лишнее в stderr, но в stdout должна быть ровно
 * одна JSON-строка: берётся ПЕРВАЯ непустая строка, которая парсится как
 * JSON-объект (логи команды перед результатом не ломают прогон).
 * `task_id`/`variant` при отсутствии подставляются из входа — иначе каждая
 * команда была бы обязана их дублировать, что не добавляет информации.
 *
 * @returns строку результата либо текст ошибки (kind + message)
 */
export function parseExternalResult(
  stdout: string,
  row: DatasetRow,
  variant: string
): { row: ResultRow } | { error: { kind: string; message: string } } {
  const lines = String(stdout ?? '').split(/\r?\n/);
  let found: Record<string, unknown> | null = null;
  for (const line of lines) {
    const value = line.trim();
    if (!value.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        found = parsed as Record<string, unknown>;
        break;
      }
    } catch {
      // не JSON — пропускаем строку (это может быть лог команды)
    }
  }
  if (!found) {
    const preview = String(stdout ?? '').trim().slice(0, 200);
    return {
      error: {
        kind: 'runner',
        message: `команда не вернула JSON-строку результата на stdout${preview ? ` (получено: ${preview})` : ' (stdout пуст)'}`,
      },
    };
  }
  return normalizeResultRow({
    ...found,
    task_id: found.task_id ?? row.task_id,
    variant: found.variant ?? variant,
  });
}

/** Опции прогона external runner'ом. */
export interface ExternalRunOptions {
  /** Корень проекта (cwd команды и место .vibelog). */
  cwd: string;
  /** Корень backlog-а. */
  backlogDir: string;
  /** id эксперимента. */
  expId: string;
  /** Shell-команда раннера (`--runner-cmd`). */
  runnerCmd: string;
  /** Фильтр вариантов (пусто — все из карточки). */
  variants?: string[];
  /** Таймаут задачи в секундах. */
  timeoutSec?: number;
  /** Только матрица, без создания рана. */
  dryRun?: boolean;
  /** Ран, перезапуском которого является этот (`--rerun N`). */
  rerunOf?: number | null;
  /** Тестовый шов: подмена спавна команды. */
  spawnExternal?: SpawnExternalFn;
  /** Канал прогресса. */
  onProgress?: (line: string) => void;
}

/**
 * Прогоняет эксперимент внешней командой (doc-21 §13, v2).
 *
 * Контракт: для каждой пары (строка датасета × вариант) команда вызывается
 * один раз; на stdin — JSON-строка входа, из stdout читается results-строка
 * (upsert по `(task_id, variant)`, как в manual-профиле).
 *
 * Решения:
 * - **изоляция не нужна**: команда своя, worktree не создаётся — проект не
 *   трогаем сами, ответит ли команда мусором в файлах, решает пользователь;
 * - **ошибка команды ≠ падение прогона**: строка пишется с `error_kind:
 *   'runner'` (код ≠ 0 / нет JSON) или `'timeout'` (истёк таймаут), прогон
 *   идёт дальше — одна сломанная задача не убивает сравнение;
 * - **здоровье команды проверяется до рана** (`assertExternalRunnerHealthy`);
 * - **cost всегда `null`**: внешняя команда может не ходить в LLM вовсе, и
 *   выдуманная цена испортила бы сравнение по стоимости.
 *
 * @throws ExperimentRunError при понятных пользователю проблемах
 */
export async function runExternalExperiment(opts: ExternalRunOptions): Promise<AiPhaseRunResult> {
  const { cwd, backlogDir, expId, runnerCmd } = opts;
  const progress = opts.onProgress ?? (() => {});
  const entry = getExperiment(backlogDir, expId);
  if (!entry) throw new ExperimentRunError(`Эксперимент не найден: ${expId}`);
  const exp = entry.experiment;

  assertExternalRunnerHealthy(runnerCmd);

  if (!exp.dataset) {
    throw new ExperimentRunError(`У эксперимента ${exp.id} не указан dataset — задайте его при create (--dataset)`);
  }
  const dataset = resolveDataset(backlogDir, exp.id, exp.dataset, {});
  const parsed = readDatasetFile(dataset.absolutePath);
  if (parsed.rows.length === 0) {
    throw new ExperimentRunError(`Датасет ${dataset.relativePath} не содержит валидных строк`);
  }

  const allVariants = Object.keys(exp.variants);
  const variants = opts.variants && opts.variants.length > 0
    ? opts.variants.map(v => v.toUpperCase())
    : allVariants;
  const unknown = variants.filter(v => !allVariants.includes(v));
  if (unknown.length > 0) {
    throw new ExperimentRunError(`В карточке нет вариантов: ${unknown.join(', ')} (есть: ${allVariants.join(', ')})`);
  }
  if (variants.length === 0) {
    throw new ExperimentRunError(`У эксперимента ${exp.id} нет вариантов — создайте карточку с --variant A:builtin:spec`);
  }

  const timeoutSec = opts.timeoutSec ?? exp.timeout_sec ?? DEFAULT_TASK_TIMEOUT_SEC;

  if (opts.dryRun) {
    progress(`  эксперимент: ${exp.id} — ${exp.title}`);
    progress(`  раннер: external (${runnerCmd})`);
    progress(`  датасет: ${dataset.relativePath} (${dataset.resolution.chosen}); строк: ${parsed.rows.length}`);
    progress(`  вариантов: ${variants.length}; вызовов (строк × вариантов): ${parsed.rows.length * variants.length}`);
    progress(`  таймаут задачи: ${timeoutSec} с`);
    progress('');
    progress('--dry-run: ран не создан');
    return {
      run: null, runDir: null, status: 'dry-run', rows: [],
      costTotal: null, pricingMissing: false, reason: null,
    };
  }

  assertNoActiveRun(backlogDir, exp.id);

  const { run, runDir } = createRunDir(backlogDir, exp.id);
  const meta: RunMeta = {
    schema_version: 1,
    exp_id: exp.id,
    run,
    status: 'running',
    runner: 'external',
    started_at: new Date().toISOString(),
    finished_at: null,
    pid: process.pid,
    resolution: {
      dataset: dataset.resolution,
      runner_cmd: runnerCmd,
      prompts: {},
    } as Record<string, unknown>,
    results_ignored: false,
    n: 0,
    dropped: 0,
    cost_total: null,
    pricing_missing: false,
    rerun_of: opts.rerunOf ?? null,
    reason: null,
  };
  writeMetaJson(runDir, meta);
  syncExperimentStatus(backlogDir, exp.id);

  const spawnExternal = opts.spawnExternal ?? defaultSpawnExternal;
  const resultsFile = resultsPath(runDir);
  const rows: ResultRow[] = [];
  let reason: string | null = null;
  let status: 'completed' | 'failed' = 'completed';

  const ac = new AbortController();
  const onSignal = (): void => {
    reason = 'прогон прерван сигналом (SIGINT/SIGTERM)';
    ac.abort();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    for (const row of parsed.rows) {
      for (const variant of variants) {
        if (ac.signal.aborted) break;
        const startedAt = Date.now();
        let result: SpawnExternalResult;
        try {
          result = await spawnExternal({
            cmd: runnerCmd,
            cwd,
            stdin: externalStdinPayload(row, variant, exp),
            env: buildExternalEnv(process.env, exp.id, run, row.task_id, variant),
            timeoutMs: timeoutSec * 1000,
          });
        } catch (err) {
          result = { code: null, stdout: '', stderr: (err as Error).message, timedOut: false };
        }
        const durationMs = Date.now() - startedAt;

        let resultRow: ResultRow;
        if (result.timedOut) {
          resultRow = {
            task_id: row.task_id,
            variant,
            score: null,
            error: `таймаут команды раннера (${timeoutSec} с)`,
            error_kind: 'timeout',
            cost: null,
            duration_ms: durationMs,
          };
        } else if (result.code !== 0) {
          const detail = (result.stderr || '').trim().split('\n')[0] ?? '';
          resultRow = {
            task_id: row.task_id,
            variant,
            score: null,
            error: `команда раннера завершилась с кодом ${result.code ?? 'signal'}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
            error_kind: 'runner',
            cost: null,
            duration_ms: durationMs,
          };
        } else {
          const parsedRow = parseExternalResult(result.stdout, row, variant);
          if ('error' in parsedRow) {
            resultRow = {
              task_id: row.task_id,
              variant,
              score: null,
              error: parsedRow.error.message,
              error_kind: 'runner',
              cost: null,
              duration_ms: durationMs,
            };
          } else {
            resultRow = { ...parsedRow.row, cost: null, duration_ms: durationMs };
          }
        }

        rows.push(resultRow);
        const existing = readResultsFile(resultsFile);
        rewriteResultsJsonl(resultsFile, upsertResult(existing.rows, resultRow));
        progress(
          `  ${row.task_id} × ${variant}: ${resultRow.error_kind ? `ошибка (${resultRow.error_kind})` : 'ok'}`
          + `, ${durationMs} мс`
        );
      }
      if (ac.signal.aborted) break;
    }
  } catch (err) {
    status = 'failed';
    reason = (err as Error).message;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (ac.signal.aborted) {
      status = 'failed';
      reason = reason ?? 'прогон прерван сигналом (SIGINT/SIGTERM)';
    }
    const finalMeta: RunMeta = {
      ...meta,
      status,
      finished_at: new Date().toISOString(),
      n: rows.filter(r => !r.error).length,
      dropped: rows.filter(r => r.error).length,
      cost_total: null,
      reason,
    };
    writeMetaJson(runDir, finalMeta);
    syncExperimentStatus(backlogDir, exp.id);
  }

  return {
    run,
    runDir,
    status,
    rows,
    costTotal: null,
    pricingMissing: false,
    reason,
  };
}


