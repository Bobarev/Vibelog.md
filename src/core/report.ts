/**
 * Отчёт прогона эксперимента (VL-297, doc-21 §9) и сравнение прогонов.
 *
 * Модуль чистый: на вход идут уже разобранные `results.jsonl` (см. `results.ts`),
 * `meta.json` прогона и карточка эксперимента; файловые операции (чтение рана,
 * запись `report.md`, перевод прогона в `completed`) делает CLI-слой.
 *
 * Ключевые решения:
 * - **`n` и `dropped` считаются всегда**, даже при пустом наборе; метрики в этом
 *   случае `null` (в markdown — `—`), а не `NaN`. Среднее по нулю строк —
 *   не ноль и не бесконечность, а «нет данных»: `NaN` в отчёте неотличим от
 *   ошибки расчёта и ломает `--json`.
 * - **`dropped` = строки, исключённые из средних** (`n = валидные`,
 *   `dropped = всего − n`), то есть ошибка и `score: null` считаются один раз.
 *   `score: null` — законное «оценка не получена», но в среднее оно не идёт:
 *   иначе вариант с половиной неоценённых задач выглядел бы лучше.
 * - **win-rate считается только по парам**, где оба варианта имеют валидную
 *   оценку: сравнение «7 против null» ничего не говорит о качестве.
 * - **custom-метрики — средние по строкам варианта с числовым значением**;
 *   берутся только имена из `metrics.custom` (остальное в `row.custom` —
 *   свободные данные, в отчёт не попадает).
 * - **Полнота прогона** (для перевода в `completed`) считается по матрице
 *   «строки датасета × варианты», а не по числу строк в файле: `record` мог
 *   записать лишнюю пару, не входящую в датасет, и она не должна выглядеть
 *   как закрытая работа.
 */

import type { Experiment } from './experiment.js';
import type { RunMeta, RunStatus } from './experiment.js';
import type { ResultRow, ResultError } from './results.js';

/** Предел размера `results.jsonl` для git (doc-21 §15) — 10 MB. */
export const RESULTS_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

/** Пара «строка датасета × вариант», по которой нет результата. */
export interface MissingPair {
  task_id: string;
  variant: string;
}

/** Агрегаты одного варианта в отчёте (doc-21 §9). */
export interface VariantReport {
  /** Ключ варианта (A/B/C…). */
  variant: string;
  /** Человекочитаемая метка из карточки (если задана). */
  label: string | null;
  /** true — это baseline-вариант (дельта и win-rate для него не считаются). */
  is_baseline: boolean;
  /** Число валидных строк: `score` — конечное число. */
  n: number;
  /** Число строк, исключённых из средних: ошибка или `score: null`. */
  dropped: number;
  /** Среднее по валидным; null — валидных строк нет. */
  mean: number | null;
  /** Медиана по валидным (устойчива к выбросам); null — валидных нет. */
  median: number | null;
  /** Разница среднего к baseline (в единицах метрики); null — нет данных. */
  delta: number | null;
  /** То же в процентах от среднего baseline; null — baseline нет или он 0. */
  delta_pct: number | null;
  /** Побед варианта в парах с baseline. */
  wins: number;
  /** Число пар, где у обоих есть валидная оценка. */
  pairs: number;
  /** Доля побед в парах (0..1); null — пар нет. */
  win_rate: number | null;
  /** Средние по custom-метрикам из `metrics.custom`; null — значений нет. */
  custom: Record<string, number | null>;
  /** Число строк с ошибкой, по `error_kind`. */
  errors: Record<string, number>;
  /** Всего строк с ошибкой (сумма по видам). */
  error_total: number;
  /** Сумма `cost` по строкам варианта; null — тарифов нет ни у одной строки. */
  cost_total: number | null;
}

/** Отчёт по прогону целиком. */
export interface Report {
  exp_id: string;
  run: number;
  /** Статус прогона на момент чтения meta.json (null — meta нет). */
  run_status: RunStatus | null;
  /** Имя поля оценки из карточки (`metrics.score_field`). */
  score_field: string;
  /** Эталонный вариант (`metrics.baseline`). */
  baseline: string;
  higher_is_better: boolean;
  /** true — файл результатов больше 10 MB и в git не пойдёт (doc-21 §15). */
  results_ignored: boolean;
  /** Ожидаемое число пар (строк датасета × вариантов); null — датасет неизвестен. */
  expected_pairs: number | null;
  /** Число записанных пар (строк results.jsonl). */
  recorded_pairs: number;
  /** true — по всем парам матрицы есть `score` или `error`. */
  complete: boolean;
  /** Недостающие пары (пусто, если прогон полон или датасет неизвестен). */
  missing: MissingPair[];
  /** Сумма валидных строк по всем вариантам. */
  n: number;
  /** Сумма отброшенных строк по всем вариантам. */
  dropped: number;
  /** Сумма стоимостей по всем вариантам; null — тарифов нет. */
  cost_total: number | null;
  /** Агрегаты по вариантам в порядке карточки. */
  variants: VariantReport[];
  /** Битые строки results.jsonl (не исключение, а запись отчёта). */
  results_errors: ResultError[];
}

/** Опции построения отчёта. */
export interface BuildReportOptions {
  /**
   * `task_id` строк датасета — для проверки полноты матрицы.
   * Не задано — полнота не проверяется (`complete` = true, `missing` = []).
   */
  taskIds?: string[];
}

/** Округление до 6 знаков — чтобы 0.1+0.2 не давало «0.30000000000000004» в JSON. */
function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Среднее; пустой список — null (не NaN: см. шапку модуля). */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Медиана; пустой список — null. Чётное число значений — среднее двух центральных. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round(sorted[mid]);
  return round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Валидная оценка: только конечное число (`score: null` и мусор отбрасываются). */
function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Числовое значение custom-метрики (строки-числа принимаются: JSONL правит человек). */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Проверяет полноту матрицы «строки датасета × варианты».
 *
 * Пара считается закрытой, если в `results.jsonl` есть строка с конечным
 * `score` ИЛИ с непустым `error` (doc-21 §8: «строка с score или error»).
 * Строка с `score: null` без ошибки — не результат, а заготовка: она попадает
 * в `dropped`, но полноту не закрывает.
 */
export function checkRunCompleteness(
  taskIds: string[],
  variants: string[],
  rows: ResultRow[]
): { complete: boolean; missing: MissingPair[]; expected: number; recorded: number } {
  const closed = new Set<string>();
  for (const row of rows) {
    if (isScore(row.score) || (row.error !== undefined && String(row.error).trim() !== '')) {
      closed.add(`${row.task_id}\u0000${row.variant}`);
    }
  }
  const missing: MissingPair[] = [];
  for (const taskId of taskIds) {
    for (const variant of variants) {
      if (!closed.has(`${taskId}\u0000${variant}`)) missing.push({ task_id: taskId, variant });
    }
  }
  return {
    complete: missing.length === 0,
    missing,
    expected: taskIds.length * variants.length,
    recorded: rows.length,
  };
}

/**
 * Строит отчёт по прогону.
 *
 * @param rows — строки results.jsonl прогона
 * @param meta — meta.json прогона (null, если файла нет или он битый)
 * @param exp — карточка эксперимента (метрики, baseline, варианты)
 * @param opts.taskIds — строки датасета для проверки полноты
 */
export function buildReport(
  rows: ResultRow[],
  meta: RunMeta | null,
  exp: Experiment,
  opts: BuildReportOptions = {}
): Report {
  const metrics = exp.metrics;
  const baselineKey = metrics.baseline || 'A';
  const higherIsBetter = metrics.higher_is_better !== false;
  const customNames = Array.isArray(metrics.custom) ? metrics.custom : [];

  // Порядок вариантов — как в карточке; отсутствующие в карточке ключи из
  // results.jsonl добавляются в конец: отчёт не должен терять данные из-за
  // карточки, поправленной после прогона.
  const variantKeys = Object.keys(exp.variants || {});
  for (const row of rows) {
    if (!variantKeys.includes(row.variant)) variantKeys.push(row.variant);
  }

  const byVariant = new Map<string, ResultRow[]>();
  for (const key of variantKeys) byVariant.set(key, []);
  for (const row of rows) {
    const bucket = byVariant.get(row.variant);
    if (bucket) bucket.push(row);
  }

  // ── Оценки по вариантам (сначала «сырые», потом дельты к baseline) ──
  const scores = new Map<string, Map<string, number>>();
  for (const key of variantKeys) {
    const map = new Map<string, number>();
    for (const row of byVariant.get(key) || []) {
      if (isScore(row.score)) map.set(row.task_id, row.score);
    }
    scores.set(key, map);
  }
  const baselineScores = scores.get(baselineKey) || new Map<string, number>();

  const variants: VariantReport[] = variantKeys.map((key) => {
    const bucket = byVariant.get(key) || [];
    const values = bucket.filter(r => isScore(r.score)).map(r => r.score as number);
    const valid = scores.get(key) || new Map<string, number>();
    const isBaseline = key === baselineKey;

    // win-rate: только пары, где валидны оба варианта
    let wins = 0;
    let pairs = 0;
    if (!isBaseline) {
      for (const [taskId, score] of valid) {
        const base = baselineScores.get(taskId);
        if (base === undefined || base === score) {
          // Равенство — не победа: «строго лучше» в §9 буквально
          if (base !== undefined) pairs += 1;
          continue;
        }
        pairs += 1;
        if (higherIsBetter ? score > base : score < base) wins += 1;
      }
    }

    const baseMean = mean(
      (byVariant.get(baselineKey) || []).filter(r => isScore(r.score)).map(r => r.score as number)
    );
    const variantMean = mean(values);
    let delta: number | null = null;
    let deltaPct: number | null = null;
    if (!isBaseline && variantMean !== null && baseMean !== null) {
      delta = round(variantMean - baseMean);
      deltaPct = baseMean === 0 ? null : round(((variantMean - baseMean) / Math.abs(baseMean)) * 100, 2);
    }

    const custom: Record<string, number | null> = {};
    for (const name of customNames) {
      const customValues: number[] = [];
      for (const row of bucket) {
        const value = toNumber(row.custom?.[name]);
        if (value !== null) customValues.push(value);
      }
      custom[name] = mean(customValues);
    }

    const errors: Record<string, number> = {};
    let errorTotal = 0;
    for (const row of bucket) {
      if (row.error === undefined || String(row.error).trim() === '') continue;
      const kind = String(row.error_kind || 'unknown');
      errors[kind] = (errors[kind] || 0) + 1;
      errorTotal += 1;
    }

    const costs = bucket.map(r => r.cost).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));

    return {
      variant: key,
      label: exp.variants?.[key]?.label ?? null,
      is_baseline: isBaseline,
      n: values.length,
      dropped: bucket.length - values.length,
      mean: variantMean,
      median: median(values),
      delta,
      delta_pct: deltaPct,
      wins,
      pairs,
      win_rate: pairs === 0 ? null : round(wins / pairs, 4),
      custom,
      errors,
      error_total: errorTotal,
      cost_total: costs.length === 0 ? null : round(costs.reduce((sum, c) => sum + c, 0)),
    };
  });

  // ── Полнота матрицы ──
  const completeness = opts.taskIds === undefined
    ? null
    : checkRunCompleteness(opts.taskIds, variantKeys, rows);

  const costsAll = rows.map(r => r.cost).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));

  return {
    exp_id: exp.id,
    run: meta?.run ?? 0,
    run_status: meta ? meta.status : null,
    score_field: metrics.score_field || 'score',
    baseline: baselineKey,
    higher_is_better: higherIsBetter,
    results_ignored: Boolean(meta?.results_ignored),
    expected_pairs: completeness ? completeness.expected : null,
    recorded_pairs: rows.length,
    complete: completeness ? completeness.complete : true,
    missing: completeness ? completeness.missing : [],
    n: variants.reduce((sum, v) => sum + v.n, 0),
    dropped: variants.reduce((sum, v) => sum + v.dropped, 0),
    cost_total: costsAll.length === 0 ? null : round(costsAll.reduce((sum, c) => sum + c, 0)),
    variants,
    results_errors: [],
  };
}

/** Число для markdown: null → «—», иначе фиксированное число знаков после точки. */
function fmt(value: number | null, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/** Процент в формате «12.34%»; null → «—». */
function fmtPct(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}%`;
}

/** Дельта со знаком: «+1.50 (+25.00%)» / «—». */
export function formatDelta(delta: number | null, deltaPct: number | null, digits = 2): string {
  if (delta === null || delta === undefined) return '—';
  const sign = delta > 0 ? '+' : '';
  const pct = deltaPct === null || deltaPct === undefined
    ? ''
    : ` (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`;
  return `${sign}${delta.toFixed(digits)}${pct}`;
}

/**
 * Сериализует отчёт в markdown (`report.md`, doc-21 §9).
 *
 * Таблица фиксированная: `n` и `dropped` идут сразу после варианта, чтобы
 * «среднее по двум строкам из сорока» нельзя было прочитать как результат.
 */
export function formatReportMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push(`# Отчёт: ${report.exp_id} / run-${report.run}`);
  lines.push('');
  lines.push(`- поле оценки: \`${report.score_field}\` (${report.higher_is_better ? 'больше — лучше' : 'меньше — лучше'})`);
  lines.push(`- baseline-вариант: ${report.baseline}`);
  if (report.run_status) lines.push(`- статус прогона: ${report.run_status}`);
  lines.push(`- валидных строк (n): ${report.n}; отброшено (dropped): ${report.dropped}`);
  lines.push(
    report.expected_pairs === null
      ? `- записано пар: ${report.recorded_pairs} (датасет не найден — полнота не проверена)`
      : `- полнота: ${report.expected_pairs - report.missing.length}/${report.expected_pairs} пар (task_id × variant)`
  );
  if (report.cost_total !== null) lines.push(`- стоимость: ${report.cost_total}`);
  if (report.results_ignored) {
    lines.push('- `results.jsonl` больше 10 MB — файл не предназначен для git (doc-21 §15)');
  }
  lines.push('');

  lines.push('| Вариант | n | dropped | mean | median | Δ к baseline | win-rate | errors | cost |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const v of report.variants) {
    const name = v.label ? `${v.variant} — ${v.label}` : v.variant;
    const title = v.is_baseline ? `${name} (baseline)` : name;
    const winRate = v.is_baseline ? '—' : `${fmtPct(v.win_rate === null ? null : v.win_rate * 100)} (${v.wins}/${v.pairs})`;
    const delta = v.is_baseline ? '—' : formatDelta(v.delta, v.delta_pct);
    const errors = v.error_total === 0 ? '0' : `${v.error_total} (${Object.entries(v.errors).map(([k, c]) => `${k}: ${c}`).join(', ')})`;
    lines.push(
      `| ${title} | ${v.n} | ${v.dropped} | ${fmt(v.mean)} | ${fmt(v.median)} | ${delta} | ${winRate} | ${errors} | ${v.cost_total === null ? '—' : String(v.cost_total)} |`
    );
  }
  lines.push('');

  // Custom-метрики — отдельной таблицей: их набор задаётся карточкой, в общую
  // строку он не влезает и ломал бы выравнивание
  const customNames = Object.keys(report.variants[0]?.custom || {});
  if (customNames.length > 0) {
    lines.push('## Custom-метрики (средние)');
    lines.push('');
    lines.push(`| Вариант | ${customNames.join(' | ')} |`);
    lines.push(`|---|${customNames.map(() => '---').join('|')}|`);
    for (const v of report.variants) {
      lines.push(`| ${v.variant} | ${customNames.map(name => fmt(v.custom[name])).join(' | ')} |`);
    }
    lines.push('');
  }

  if (report.missing.length > 0) {
    lines.push('## Недостающие пары');
    lines.push('');
    lines.push(`Прогон не завершён: не хватает ${report.missing.length} пар (task_id × variant).`);
    lines.push('');
    for (const pair of report.missing) {
      lines.push(`- \`${pair.task_id}\` × ${pair.variant}`);
    }
    lines.push('');
  }

  if (report.results_errors.length > 0) {
    lines.push('## Битые строки results.jsonl');
    lines.push('');
    for (const e of report.results_errors) lines.push(`- ${e.message}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Сравнение прогонов (--compare, doc-21 §9) ──

/** Дельта одного варианта между двумя прогонами. */
export interface CompareVariantDelta {
  variant: string;
  mean_a: number | null;
  mean_b: number | null;
  /** Разница средних (a − b); null — в одном из прогонов данных нет. */
  delta: number | null;
  /** Та же разница в процентах от среднего b. */
  delta_pct: number | null;
  n_a: number;
  n_b: number;
  dropped_a: number;
  dropped_b: number;
  win_rate_a: number | null;
  win_rate_b: number | null;
}

/** Результат сравнения двух отчётов. */
export interface CompareReport {
  run_a: number;
  run_b: number;
  exp_id: string;
  variants: CompareVariantDelta[];
  /** Варианты, которых нет в одном из прогонов (сравнивать нечего). */
  only_a: string[];
  only_b: string[];
}

/**
 * Считает дельты метрик между прогонами `a` (сравниваемый) и `b` (база сравнения).
 *
 * Направление — `a − b`, как в `report --run N --compare run-M`: отчёт
 * показывает, как изменился прогон M относительно более раннего/позднего.
 * Порядок вариантов — из отчёта `a`, недостающие добавляются из `b`.
 */
export function compareRuns(a: Report, b: Report): CompareReport {
  const mapA = new Map(a.variants.map(v => [v.variant, v]));
  const mapB = new Map(b.variants.map(v => [v.variant, v]));
  const order: string[] = [];
  for (const v of a.variants) if (!order.includes(v.variant)) order.push(v.variant);
  for (const v of b.variants) if (!order.includes(v.variant)) order.push(v.variant);

  const variants: CompareVariantDelta[] = [];
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const key of order) {
    const va = mapA.get(key);
    const vb = mapB.get(key);
    if (!va || !vb) {
      if (va) onlyA.push(key);
      if (vb) onlyB.push(key);
      continue;
    }
    const meanA = va.mean;
    const meanB = vb.mean;
    const delta = meanA === null || meanB === null ? null : round(meanA - meanB);
    const deltaPct = meanA === null || meanB === null || meanB === 0
      ? null
      : round(((meanA - meanB) / Math.abs(meanB)) * 100, 2);
    variants.push({
      variant: key,
      mean_a: va.mean,
      mean_b: vb.mean,
      delta,
      delta_pct: deltaPct,
      n_a: va.n,
      n_b: vb.n,
      dropped_a: va.dropped,
      dropped_b: vb.dropped,
      win_rate_a: va.win_rate,
      win_rate_b: vb.win_rate,
    });
  }

  return { run_a: a.run, run_b: b.run, exp_id: a.exp_id || b.exp_id, variants, only_a: onlyA, only_b: onlyB };
}

/** Markdown-таблица дельт между прогонами. */
export function formatCompareMarkdown(compare: CompareReport): string {
  const lines: string[] = [];
  lines.push(`## Сравнение прогонов: run-${compare.run_a} vs run-${compare.run_b}`);
  lines.push('');
  lines.push(`Дельта считается как run-${compare.run_a} − run-${compare.run_b}.`);
  lines.push('');
  lines.push('| Вариант | mean run-' + compare.run_a + ' | mean run-' + compare.run_b + ' | Δ mean | n (a/b) | dropped (a/b) | win-rate (a/b) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const v of compare.variants) {
    const winRate = `${fmtPct(v.win_rate_a === null ? null : v.win_rate_a * 100)} / ${fmtPct(v.win_rate_b === null ? null : v.win_rate_b * 100)}`;
    lines.push(
      `| ${v.variant} | ${fmt(v.mean_a)} | ${fmt(v.mean_b)} | ${formatDelta(v.delta, v.delta_pct)} | ${v.n_a}/${v.n_b} | ${v.dropped_a}/${v.dropped_b} | ${winRate} |`
    );
  }
  lines.push('');
  if (compare.only_a.length > 0) {
    lines.push(`Только в run-${compare.run_a}: ${compare.only_a.join(', ')}`);
    lines.push('');
  }
  if (compare.only_b.length > 0) {
    lines.push(`Только в run-${compare.run_b}: ${compare.only_b.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
