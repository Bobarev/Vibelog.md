/**
 * Тесты VL-297 — CLI `vibelog experiment report` (doc-21 §8–§9, §10).
 *
 * Спавнят реальный CLI (bin/vibelog.mjs) в mkdtemp-каталоге с backlog/;
 * env собирается через testSpawnEnv (VL-286), иначе наследуется VIBELOG_CWD
 * агентской сессии и CLI уходит на главный репозиторий.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-report-cli-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Путь к файлу прогона. */
function runFile(run, name) {
  return join(backlogDir, 'experiments', 'exp-1', `run-${run}`, name);
}

/** Записывает results.jsonl прогона. */
function writeResults(run, rows) {
  mkdirSync(join(backlogDir, 'experiments', 'exp-1', `run-${run}`), { recursive: true });
  writeFileSync(runFile(run, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  mkdirSync(join(backlogDir, 'experiments', 'datasets'), { recursive: true });
  writeFileSync(join(backlogDir, 'experiments', 'datasets', 'ds-1.jsonl'), [
    '{"task_id":"t1","expected_ac":"первый"}',
    '{"task_id":"t2","expected_ac":"второй"}',
    '',
  ].join('\n'), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-297 — CLI experiment report', () => {
  it('эксперимент и два прогона создаются (run как в VL-296)', () => {
    let res = runCli([
      'experiment', 'create', 'Отчёт A/B', '--dataset', 'ds-1',
      '--variant', 'A:builtin:spec', '--variant', 'B:builtin:plan',
    ]);
    assert.equal(res.status, 0, res.stderr);
    res = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    res = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
  });

  it('неполный прогон: печатает недостающие пары, статус НЕ меняет', () => {
    writeResults(2, [
      { task_id: 't1', variant: 'A', score: 5 },
      { task_id: 't1', variant: 'B', score: 6 },
    ]);
    const res = runCli(['experiment', 'report', 'exp-1', '--run', '2']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /НЕ завершён/);
    assert.match(res.stdout, /`t2` × A/);
    assert.match(res.stdout, /`t2` × B/);
    const meta = JSON.parse(readFileSync(runFile(2, 'meta.json'), 'utf-8'));
    assert.equal(meta.status, 'running', 'completed на половине данных запрещён');
    assert.equal(meta.finished_at, null);
    // report.md всё равно записан (производный файл)
    assert.ok(existsSync(runFile(2, 'report.md')));
  });

  it('report --json печатает структуру и n/dropped/виды ошибок', () => {
    writeResults(2, [
      { task_id: 't1', variant: 'A', score: 5, cost: 0.1, custom: { tokens: 100 } },
      { task_id: 't1', variant: 'B', score: 7 },
      { task_id: 't2', variant: 'A', score: null, error: 'timeout 120s', error_kind: 'timeout' },
      { task_id: 't2', variant: 'B', score: null, error: 'оценка не получена', error_kind: 'judge' },
    ]);
    const res = runCli(['experiment', 'report', 'exp-1', '--run', '2', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const report = JSON.parse(res.stdout);
    // Валидные: t1/A, t1/B = 2 на прогон; отброшенные: t2/A (error), t2/B (null)
    assert.equal(report.n, 2);
    assert.equal(report.dropped, 2);
    const b = report.variants.find(v => v.variant === 'B');
    assert.equal(b.win_rate, 1);
    const a = report.variants.find(v => v.variant === 'A');
    assert.equal(a.errors.timeout, 1);
    assert.equal(a.dropped, 1, 'score:null без ошибки — тоже dropped');
    assert.equal(report.complete, true, 'по каждой паре есть score или error');
  });

  it('полный прогон переводит ран в completed и заполняет meta.summary', () => {
    const res = runCli(['experiment', 'report', 'exp-1', '--run', '2']);
    assert.equal(res.status, 0, res.stderr);
    const meta = JSON.parse(readFileSync(runFile(2, 'meta.json'), 'utf-8'));
    assert.equal(meta.status, 'completed');
    assert.ok(meta.finished_at);
    assert.deepEqual(meta.summary, { n: 2, dropped: 2, cost_total: 0.1 });
    // Статус эксперимента пересчитан из последнего рана
    const card = readFileSync(join(backlogDir, 'experiments', 'exp-1.md'), 'utf-8');
    assert.match(card, /^status: completed$/m);
  });

  it('--compare run-M добавляет таблицу дельт в stdout и report.md', () => {
    writeResults(1, [
      { task_id: 't1', variant: 'A', score: 4 },
      { task_id: 't1', variant: 'B', score: 5 },
      { task_id: 't2', variant: 'A', score: 4 },
      { task_id: 't2', variant: 'B', score: 5 },
    ]);
    const res = runCli(['experiment', 'report', 'exp-1', '--run', '2', '--compare', 'run-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Сравнение прогонов: run-2 vs run-1/);
    const md = readFileSync(runFile(2, 'report.md'), 'utf-8');
    assert.match(md, /Сравнение прогонов: run-2 vs run-1/);
    // results.jsonl неизменяем — report производный файл
    assert.equal(readFileSync(runFile(2, 'results.jsonl'), 'utf-8').trim().split('\n').length, 4);
  });

  it('report без ранов и без эксперимента — ошибки без исключений', () => {
    const res = runCli(['experiment', 'report', 'exp-99']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /не найден/);
  });

  it('results.jsonl > 10 MB: warning в stderr и results_ignored в meta (doc-21 §15)', () => {
    // run-3 создаётся CLI-ом, затем results раздувается до >10 MB
    const created = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(created.status, 0, created.stderr);
    const big = join(backlogDir, 'experiments', 'exp-1', 'run-3', 'results.jsonl');
    const row = JSON.stringify({ task_id: 't1', variant: 'A', score: 1, output: 'x'.repeat(1000) });
    const line = `${row}\n`;
    const times = Math.ceil((10 * 1024 * 1024 + 1024) / line.length);
    writeFileSync(big, line.repeat(times), 'utf-8');
    const res = runCli(['experiment', 'report', 'exp-1', '--run', '3']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /> 10 MB/);
    assert.match(res.stderr, /results_ignored/);
    const meta = JSON.parse(readFileSync(runFile(3, 'meta.json'), 'utf-8'));
    assert.equal(meta.results_ignored, true);
  });
});
