/**
 * Тесты VL-297 — отчёт прогона эксперимента (doc-21 §8–§9) и `--compare`.
 *
 * Модуль чистый (вход — разобранные строки results.jsonl, meta и карточка),
 * поэтому файловая система не нужна: фикстуры — литералы. CLI-часть и перевод
 * прогона в `completed` проверяются на mkdtemp (VL-241/lesson-89).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildReport, formatReportMarkdown, compareRuns, formatCompareMarkdown,
} from '../../dist/core/report.js';
import { createExperiment } from '../../dist/core/experiment.js';

/** Карточка с дефолтными метриками (baseline A, higher_is_better true). */
function makeExp(overrides = {}) {
  return createExperiment({
    id: 'exp-1',
    title: 'Тест',
    dataset: 'ds-1',
    variants: { A: { prompt: 'builtin:spec' }, B: { prompt: 'builtin:plan' } },
    ...overrides,
  });
}

/** meta.json прогона в статусе running. */
function makeMeta(overrides = {}) {
  return {
    schema_version: 1,
    exp_id: 'exp-1',
    run: 1,
    status: 'running',
    runner: 'manual',
    started_at: '2026-11-02T10:00:00.000Z',
    finished_at: null,
    pid: null,
    resolution: {},
    results_ignored: false,
    n: 0,
    dropped: 0,
    cost_total: null,
    pricing_missing: true,
    rerun_of: null,
    reason: null,
    ...overrides,
  };
}

describe('VL-297 — mean/median/n/dropped', () => {
  it('mean и median считаются по валидным строкам', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 2 },
      { task_id: 't2', variant: 'A', score: 4 },
      { task_id: 't3', variant: 'A', score: 9 },
    ];
    const report = buildReport(rows, makeMeta(), makeExp());
    const a = report.variants.find(v => v.variant === 'A');
    assert.equal(a.n, 3);
    assert.equal(a.dropped, 0);
    assert.equal(a.mean, 5);
    assert.equal(a.median, 4);
  });

  it('чётное число значений — медиана как среднее двух центральных', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 1 },
      { task_id: 't2', variant: 'A', score: 2 },
      { task_id: 't3', variant: 'A', score: 10 },
      { task_id: 't4', variant: 'A', score: 20 },
    ];
    const a = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'A');
    assert.equal(a.median, 6);
  });

  it('score: null исключается из средних и считается в dropped', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't2', variant: 'A', score: null },
      { task_id: 't3', variant: 'A', score: null, error: 'timeout', error_kind: 'timeout' },
    ];
    const a = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'A');
    assert.equal(a.n, 1, 'только конечный score — валидная строка');
    assert.equal(a.dropped, 2);
    assert.equal(a.mean, 4);
    assert.equal(a.error_total, 1, 'ошибки считаются отдельно от dropped');
  });

  it('пустой набор: n=0, метрики null, в markdown — «—», не NaN', () => {
    const report = buildReport([], makeMeta(), makeExp());
    for (const v of report.variants) {
      assert.equal(v.n, 0);
      assert.equal(v.mean, null);
      assert.equal(v.median, null);
      assert.equal(v.delta, null);
      assert.equal(v.win_rate, null);
    }
    const md = formatReportMarkdown(report);
    assert.doesNotMatch(md, /NaN/);
    assert.match(md, /\| A \(baseline\) \| 0 \| 0 \| — \| — \|/);
  });

  it('отчёт по варианту без строк в results.jsonl всё равно попадает в таблицу', () => {
    const report = buildReport([{ task_id: 't1', variant: 'A', score: 5 }], makeMeta(), makeExp());
    assert.deepEqual(report.variants.map(v => v.variant), ['A', 'B']);
    assert.equal(report.variants[1].n, 0);
  });
});

describe('VL-297 — дельта и win-rate', () => {
  it('дельта считается к baseline A (higher_is_better true)', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't1', variant: 'B', score: 6 },
      { task_id: 't2', variant: 'A', score: 6 },
      { task_id: 't2', variant: 'B', score: 8 },
    ];
    const report = buildReport(rows, makeMeta(), makeExp());
    const b = report.variants.find(v => v.variant === 'B');
    assert.equal(b.mean, 7);
    assert.equal(b.delta, 2, 'mean(B) - mean(A) = 7 - 5');
    assert.equal(b.delta_pct, 40);
    assert.equal(b.win_rate, 1, 'B строго лучше A в обеих парах');
    assert.equal(b.pairs, 2);
    const a = report.variants.find(v => v.variant === 'A');
    assert.equal(a.is_baseline, true);
    assert.equal(a.delta, null, 'у baseline дельты нет');
  });

  it('win-rate с higher_is_better false считает меньшие значения победой', () => {
    const exp = makeExp({ metrics: { higher_is_better: false } });
    const rows = [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't1', variant: 'B', score: 3 },
      { task_id: 't2', variant: 'A', score: 5 },
      { task_id: 't2', variant: 'B', score: 8 },
    ];
    const b = buildReport(rows, makeMeta(), exp).variants.find(v => v.variant === 'B');
    assert.equal(b.win_rate, 0.5, 'одна победа из двух пар');
    assert.equal(b.wins, 1);
    assert.equal(b.pairs, 2);
  });

  it('пары со score: null не участвуют в win-rate', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't1', variant: 'B', score: 9 },
      { task_id: 't2', variant: 'A', score: 5 },
      { task_id: 't2', variant: 'B', score: null },
    ];
    const b = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'B');
    assert.equal(b.pairs, 1);
    assert.equal(b.win_rate, 1);
  });

  it('равные оценки — не победа (строго лучше)', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't1', variant: 'B', score: 5 },
    ];
    const b = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'B');
    assert.equal(b.wins, 0);
    assert.equal(b.pairs, 1);
    assert.equal(b.win_rate, 0);
  });

  it('custom baseline меняется через metrics.baseline', () => {
    const exp = makeExp({ metrics: { baseline: 'B' } });
    const rows = [
      { task_id: 't1', variant: 'A', score: 8 },
      { task_id: 't1', variant: 'B', score: 4 },
    ];
    const report = buildReport(rows, makeMeta(), exp);
    const a = report.variants.find(v => v.variant === 'A');
    assert.equal(a.delta, 4);
    assert.equal(a.win_rate, 1);
    assert.equal(report.variants.find(v => v.variant === 'B').is_baseline, true);
  });
});

describe('VL-297 — custom-метрики и ошибки по kind', () => {
  it('custom-средние берутся только по metrics.custom', () => {
    const exp = makeExp({ metrics: { custom: ['tokens'] } });
    const rows = [
      { task_id: 't1', variant: 'A', score: 1, custom: { tokens: 100, ignored: 5 } },
      { task_id: 't2', variant: 'A', score: 2, custom: { tokens: 300, ignored: 7 } },
    ];
    const a = buildReport(rows, makeMeta(), exp).variants.find(v => v.variant === 'A');
    assert.deepEqual(Object.keys(a.custom), ['tokens']);
    assert.equal(a.custom.tokens, 200);
  });

  it('ошибки считаются по error_kind', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: null, error: 'таймаут', error_kind: 'timeout' },
      { task_id: 't2', variant: 'A', score: null, error: 'таймаут', error_kind: 'timeout' },
      { task_id: 't3', variant: 'A', score: null, error: '500', error_kind: 'api' },
      { task_id: 't4', variant: 'A', score: 5 },
    ];
    const a = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'A');
    assert.deepEqual(a.errors, { timeout: 2, api: 1 });
    assert.equal(a.error_total, 3);
    assert.equal(a.dropped, 3);
    assert.equal(a.n, 1);
  });

  it('cost_total суммируется, null-тарифы не превращаются в 0', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 1, cost: 0.5 },
      { task_id: 't2', variant: 'A', score: 2, cost: null },
      { task_id: 't3', variant: 'A', score: 3 },
    ];
    const a = buildReport(rows, makeMeta(), makeExp()).variants.find(v => v.variant === 'A');
    assert.equal(a.cost_total, 0.5);
  });
});

describe('VL-297 — полнота матрицы и завершение прогона', () => {
  const exp = makeExp();

  it('полная матрица: complete=true, missing пуст', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't1', variant: 'B', score: 6 },
      { task_id: 't2', variant: 'A', score: null, error: 'timeout', error_kind: 'timeout' },
      { task_id: 't2', variant: 'B', score: 8 },
    ];
    const report = buildReport(rows, makeMeta(), exp, { taskIds: ['t1', 't2'] });
    assert.equal(report.complete, true);
    assert.deepEqual(report.missing, []);
    assert.equal(report.expected_pairs, 4);
  });

  it('неполная матрица: перечислены недостающие пары (task_id, variant)', () => {
    const rows = [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't2', variant: 'B', score: null },
    ];
    const report = buildReport(rows, makeMeta(), exp, { taskIds: ['t1', 't2'] });
    assert.equal(report.complete, false);
    const missing = report.missing.map(p => `${p.task_id}×${p.variant}`).sort();
    // t1/B нет вовсе; t2/A нет вовсе; t2/B есть, но score:null без error — не закрыта
    assert.deepEqual(missing, ['t1×B', 't2×A', 't2×B']);
  });

  it('без taskIds полнота не проверяется (complete=true, missing пуст)', () => {
    const report = buildReport([], makeMeta(), exp);
    assert.equal(report.complete, true);
    assert.equal(report.expected_pairs, null);
  });

  it('markdown печатает список недостающих пар', () => {
    const rows = [{ task_id: 't1', variant: 'A', score: 5 }];
    const report = buildReport(rows, makeMeta(), exp, { taskIds: ['t1', 't2'] });
    const md = formatReportMarkdown(report);
    assert.match(md, /Недостающие пары/);
    assert.match(md, /`t2` × A/);
  });
});

describe('VL-297 — compareRuns', () => {
  it('дельты между двумя прогонами', () => {
    const exp = makeExp();
    const a = buildReport([
      { task_id: 't1', variant: 'A', score: 6 },
      { task_id: 't2', variant: 'A', score: 8 },
    ], makeMeta({ run: 2 }), exp);
    const b = buildReport([
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't2', variant: 'A', score: 4 },
    ], makeMeta({ run: 1 }), exp);
    const cmp = compareRuns(a, b);
    assert.equal(cmp.run_a, 2);
    assert.equal(cmp.run_b, 1);
    const va = cmp.variants.find(v => v.variant === 'A');
    assert.equal(va.mean_a, 7);
    assert.equal(va.mean_b, 4);
    assert.equal(va.delta, 3);
    assert.equal(va.delta_pct, 75);
  });

  it('вариант только в одном прогоне попадает в only_a / only_b', () => {
    const expA = makeExp({ variants: { A: { prompt: 'builtin:spec' } } });
    const expB = makeExp({ variants: { B: { prompt: 'builtin:plan' } } });
    const a = buildReport([{ task_id: 't1', variant: 'A', score: 1 }], makeMeta({ run: 2 }), expA);
    const b = buildReport([{ task_id: 't1', variant: 'B', score: 1 }], makeMeta({ run: 1 }), expB);
    const cmp = compareRuns(a, b);
    assert.deepEqual(cmp.only_a, ['A']);
    assert.deepEqual(cmp.only_b, ['B']);
    assert.equal(cmp.variants.length, 0);
  });

  it('markdown-таблица сравнения содержит оба прогона и дельту', () => {
    const exp = makeExp();
    const a = buildReport([{ task_id: 't1', variant: 'A', score: 6 }], makeMeta({ run: 2 }), exp);
    const b = buildReport([{ task_id: 't1', variant: 'A', score: 3 }], makeMeta({ run: 1 }), exp);
    const md = formatCompareMarkdown(compareRuns(a, b));
    assert.match(md, /run-2 vs run-1/);
    assert.match(md, /\+3\.00/);
  });
});

// ── CLI: report пишет report.md и завершает прогон ──

const cliTestRoot = mkdtempSync(join(tmpdir(), 'vibelog-report-cli-'));

afterAll(() => {
  rmSync(cliTestRoot, { recursive: true, force: true });
});

describe('VL-297 — CLI report (файлы прогона)', () => {
  let experimentReport;
  let expDir;
  let backlogDir;

  beforeAll(async () => {
    ({ experimentReport } = await import('../../dist/cli/commands/experiment-report.js'));
    backlogDir = cliTestRoot;
    // Карточка эксперимента
    mkdirSync(join(backlogDir, 'experiments', 'datasets'), { recursive: true });
    const { experimentToMarkdown } = await import('../../dist/core/experiment.js');
    const exp = createExperiment({
      id: 'exp-1',
      title: 'Отчёт',
      dataset: 'ds-1',
      variants: { A: { prompt: 'builtin:spec' }, B: { prompt: 'builtin:plan' } },
    });
    writeFileSync(join(backlogDir, 'experiments', 'exp-1.md'), experimentToMarkdown(exp, ''), 'utf-8');
    // Общий датасет из двух строк
    writeFileSync(join(backlogDir, 'experiments', 'datasets', 'ds-1.jsonl'), [
      '{"task_id":"t1"}',
      '{"task_id":"t2"}',
      '',
    ].join('\n'), 'utf-8');
    expDir = join(backlogDir, 'experiments', 'exp-1');
  });

  /** Создаёт ран с meta и строками results.jsonl. */
  function makeRun(run, meta, rows) {
    const dir = join(expDir, `run-${run}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(makeMeta({ run, ...meta }), null, 2), 'utf-8');
    writeFileSync(join(dir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8');
    return dir;
  }

  /** Захватывает stdout/stderr на время вызова. */
  function capture(fn) {
    const out = [];
    const err = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => out.push(args.join(' '));
    console.error = (...args) => err.push(args.join(' '));
    try {
      fn();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    return { stdout: out.join('\n'), stderr: err.join('\n') };
  }

  it('пишет report.md в каталог рана и печатает отчёт', () => {
    const dir = makeRun(1, {}, [
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't1', variant: 'B', score: 6 },
      { task_id: 't2', variant: 'A', score: 6 },
      { task_id: 't2', variant: 'B', score: 8 },
    ]);
    const res = capture(() => experimentReport(['exp-1'], {}, backlogDir));
    assert.equal(process.exitCode ?? 0, 0, res.stderr);
    const path = join(dir, 'report.md');
    assert.ok(existsSync(path), 'report.md создан');
    const md = readFileSync(path, 'utf-8');
    assert.match(md, /\| B \| 2 \| 0 \| 7\.00 \| 7\.00 \| \+2\.00 \(\+40\.00%\) \| 100\.00% \(2\/2\)/);
    assert.match(res.stdout, /n\): 4/);
  });

  it('полная матрица переводит ран в completed и заполняет meta.summary', () => {
    const dir = makeRun(2, { status: 'running' }, [
      { task_id: 't1', variant: 'A', score: 4, cost: 0.1 },
      { task_id: 't1', variant: 'B', score: 6 },
      { task_id: 't2', variant: 'A', score: null, error: 'timeout', error_kind: 'timeout' },
      { task_id: 't2', variant: 'B', score: 8, cost: 0.2 },
    ]);
    capture(() => experimentReport(['exp-1', '--run', '2'], { run: '2' }, backlogDir));
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    assert.equal(meta.status, 'completed');
    assert.ok(meta.finished_at, 'finished_at заполнен');
    assert.equal(meta.n, 3, 'валидных строк: A/t1 + B/t1 + B/t2');
    assert.equal(meta.dropped, 1);
    assert.equal(meta.cost_total, 0.3);
    assert.deepEqual(meta.summary, { n: 3, dropped: 1, cost_total: 0.3 });
    // Статус эксперимента пересчитан из последнего рана
    const card = readFileSync(join(expDir, '..', 'exp-1.md'), 'utf-8');
    assert.match(card, /^status: completed$/m);
  });

  it('неполная матрица: список недостающих в выводе, статус НЕ меняется', () => {
    const dir = makeRun(3, { status: 'running' }, [
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't1', variant: 'B', score: 6 },
    ]);
    const res = capture(() => experimentReport(['exp-1', '--run', '3'], { run: '3' }, backlogDir));
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    assert.equal(meta.status, 'running', 'completed на половине данных запрещён');
    assert.equal(meta.finished_at, null);
    assert.match(res.stderr, /НЕ завершён/);
    assert.match(res.stdout, /`t2` × A/);
    assert.match(res.stdout, /`t2` × B/);
  });

  it('--json печатает структуру отчёта', () => {
    const res = capture(() => experimentReport(['exp-1', '--run', '2', '--json'], { run: '2', json: true }, backlogDir));
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.exp_id, 'exp-1');
    assert.equal(parsed.run, 2);
    assert.ok(Array.isArray(parsed.variants));
    assert.equal(parsed.variants.length, 2);
    assert.equal(parsed.n, 3);
  });

  it('--compare добавляет таблицу дельт в stdout и report.md, report.md перегенерируется', () => {
    const dir = join(expDir, 'run-2');
    const res = capture(() => experimentReport(
      ['exp-1', '--run', '2', '--compare', 'run-1'],
      { run: '2', compare: 'run-1' },
      backlogDir
    ));
    assert.match(res.stdout, /Сравнение прогонов: run-2 vs run-1/);
    const md = readFileSync(join(dir, 'report.md'), 'utf-8');
    assert.match(md, /Сравнение прогонов: run-2 vs run-1/);
    // results.jsonl не тронут — report производный файл
    const results = readFileSync(join(dir, 'results.jsonl'), 'utf-8');
    assert.equal(results.trim().split('\n').length, 4);
  });

  it('нет прогонов — понятная ошибка, не исключение', async () => {
    const { writeExperiment } = await import('../../dist/core/experiment.js');
    writeExperiment(backlogDir, { title: 'Пустой', dataset: 'ds-1', variants: { A: { prompt: 'builtin:spec' } } });
    const res = capture(() => experimentReport(['exp-2'], {}, backlogDir));
    assert.match(res.stderr, /нет прогонов/);
  });

  it('report.md с пустым набором не содержит NaN', () => {
    const dir = makeRun(4, { status: 'running' }, []);
    capture(() => experimentReport(['exp-1', '--run', '4'], { run: '4' }, backlogDir));
    const md = readFileSync(join(dir, 'report.md'), 'utf-8');
    assert.doesNotMatch(md, /NaN/);
    assert.match(md, /\| A \(baseline\) \| 0 \| 0 \| — \| — \|/);
  });
});
