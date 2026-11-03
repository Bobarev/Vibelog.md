/**
 * Тесты VL-296 — CLI `vibelog experiment run` / `record` (doc-21 §7–§8, §10).
 *
 * Спавнят реальный CLI (bin/vibelog.mjs) в mkdtemp-каталоге с backlog/;
 * env собирается через testSpawnEnv (VL-286), иначе наследуется VIBELOG_CWD
 * агентской сессии и CLI уходит на главный репозиторий.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-run-cli-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Читает results.jsonl прогона как массив строк. */
function readResults(expId, run) {
  const path = join(backlogDir, 'experiments', expId, `run-${run}`, 'results.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => JSON.parse(l));
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
  // Общий датасет из двух строк
  mkdirSync(join(backlogDir, 'experiments', 'datasets'), { recursive: true });
  writeFileSync(join(backlogDir, 'experiments', 'datasets', 'ds-1.jsonl'), [
    '{"task_id":"t1","expected_ac":"первый"}',
    '{"task_id":"t2","expected_ac":"второй"}',
    '',
  ].join('\n'), 'utf-8');
  // Общий промпт варианта B
  mkdirSync(join(backlogDir, 'experiments', 'prompts'), { recursive: true });
  writeFileSync(join(backlogDir, 'experiments', 'prompts', 'variant-b.md'), '# общий B\n', 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-296 — CLI experiment run', () => {
  it('создаёт эксперимент с датасетом и A/B-вариантами', () => {
    const res = runCli([
      'experiment', 'create', 'Прогон A/B',
      '--dataset', 'ds-1',
      '--variant', 'A:builtin:spec:текущий',
      '--variant', 'B:variant-b:новый',
    ]);
    assert.equal(res.status, 0, res.stderr);
  });

  it('--dry-run печатает матрицу «строки × варианты» и файлы промптов, ран не создаёт', () => {
    const res = runCli(['experiment', 'run', 'exp-1', '--dry-run']);
    assert.equal(res.status, 0, res.stderr);
    // Матрица: каждый task_id датасета и обе колонки вариантов
    assert.match(res.stdout, /task_id\s+A\s+B/);
    assert.match(res.stdout, /t1/);
    assert.match(res.stdout, /t2/);
    // Резолв промптов с пометкой происхождения
    assert.match(res.stdout, /вариант A: prompt="builtin:spec" → builtin:spec \(встроенный шаблон/);
    assert.match(res.stdout, /вариант B: prompt="variant-b" → общий experiments\/prompts\/variant-b\.md/);
    assert.match(res.stdout, /Пар \(task_id × variant\): 4/);
    // Ран не создан
    assert.ok(!existsSync(join(backlogDir, 'experiments', 'exp-1', 'run-1')));
  });

  it('run создаёт run-1 с meta.json (status running, pid, started_at)', () => {
    const res = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    const metaPath = join(backlogDir, 'experiments', 'exp-1', 'run-1', 'meta.json');
    assert.ok(existsSync(metaPath), 'meta.json создан');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    assert.equal(meta.status, 'running');
    assert.equal(meta.run, 1);
    assert.equal(meta.exp_id, 'exp-1');
    assert.ok(meta.started_at, 'started_at записан');
    assert.equal(meta.finished_at, null);
    assert.deepEqual(meta.resolution.dataset.chosen, 'shared');
    assert.equal(meta.resolution.prompts.A.chosen, 'builtin');
    assert.equal(meta.resolution.prompts.B.chosen, 'shared');
    // Инструкция и список задач
    assert.match(res.stdout, /record exp-1 --run 1/);
    assert.match(res.stdout, /t1/);
  });

  it('run --recover на manual-ране (pid null) — ошибка «не завис»', () => {
    const res = runCli(['experiment', 'run', 'exp-1', '--recover']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /не завис|не в статусе running|восстанавливать нечего/);
  });

  it('run без --dry-run создаёт следующий номер, а не переписывает run-1', () => {
    const res = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(join(backlogDir, 'experiments', 'exp-1', 'run-2', 'meta.json')));
  });
});

describe('VL-296 — CLI experiment record', () => {
  it('record пишет строку в results.jsonl (по умолчанию — последний ран)', () => {
    const res = runCli(['experiment', 'record', 'exp-1', '--variant', 'A', '--task', 't1', '--score', '7']);
    assert.equal(res.status, 0, res.stderr);
    // Ранов два и --run не задан → предупреждение в stderr
    assert.match(res.stderr, /несколько прогонов/);
    const rows = readResults('exp-1', 2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task_id, 't1');
    assert.equal(rows[0].variant, 'A');
    assert.equal(rows[0].score, 7);
  });

  it('повторный record по той же паре перезаписывает строку, не дублирует', () => {
    const res = runCli([
      'experiment', 'record', 'exp-1', '--variant', 'A', '--task', 't1',
      '--score', '9', '--output', 'новый вывод', '--run', '2',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /перезаписано: 1/);
    const rows = readResults('exp-1', 2);
    assert.equal(rows.length, 1, 'upsert по (task_id, variant)');
    assert.equal(rows[0].score, 9);
    assert.equal(rows[0].output, 'новый вывод');
    assert.doesNotMatch(res.stderr, /несколько прогонов/, 'при явном --run предупреждения нет');
  });

  it('--run N пишет в указанный ран, не задевая последний', () => {
    const res = runCli([
      'experiment', 'record', 'exp-1', '--variant', 'B', '--task', 't1',
      '--score', '3', '--run', '1',
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readResults('exp-1', 1).length, 1);
    assert.equal(readResults('exp-1', 2).length, 1);
  });

  it('--from-json пишет пачку строк upsert-ом', () => {
    const file = join(testRoot, 'batch.json');
    writeFileSync(file, JSON.stringify([
      { task_id: 't1', variant: 'B', score: 4, custom: { tokens: 100 } },
      { task_id: 't2', variant: 'A', score: null, error: 'timeout 120s', error_kind: 'timeout' },
      { task_id: 't2', variant: 'B', score: 8, tool_calls: 12, duration_ms: 4100 },
    ]), 'utf-8');
    const res = runCli(['experiment', 'record', 'exp-1', '--run', '2', '--from-json', file]);
    assert.equal(res.status, 0, res.stderr);
    const rows = readResults('exp-1', 2);
    assert.equal(rows.length, 4, 't1/A + t1/B + t2/A + t2/B');
    const t1b = rows.find(r => r.task_id === 't1' && r.variant === 'B');
    assert.equal(t1b.score, 4);
    assert.deepEqual(t1b.custom, { tokens: 100 });
    const t2a = rows.find(r => r.task_id === 't2' && r.variant === 'A');
    assert.equal(t2a.score, null);
    assert.equal(t2a.error_kind, 'timeout');
  });

  it('--custom JSON и --error-kind сохраняются; неизвестный error-kind — ошибка', () => {
    const ok = runCli([
      'experiment', 'record', 'exp-1', '--run', '1', '--variant', 'A', '--task', 't2',
      '--error', 'api 500', '--error-kind', 'api', '--custom', '{"tokens":5}',
    ]);
    assert.equal(ok.status, 0, ok.stderr);
    const row = readResults('exp-1', 1).find(r => r.task_id === 't2' && r.variant === 'A');
    assert.equal(row.error_kind, 'api');
    assert.deepEqual(row.custom, { tokens: 5 });

    const bad = runCli([
      'experiment', 'record', 'exp-1', '--run', '1', '--variant', 'A', '--task', 't2',
      '--error-kind', 'banana',
    ]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Неверный --error-kind/);
  });

  it('несуществующий ран и вариант — понятные ошибки', () => {
    const badRun = runCli(['experiment', 'record', 'exp-1', '--variant', 'A', '--task', 't1', '--run', '99']);
    assert.equal(badRun.status, 1);
    assert.match(badRun.stderr, /Прогон run-99 не найден/);

    const badVariant = runCli(['experiment', 'record', 'exp-1', '--variant', 'Z', '--task', 't1']);
    assert.equal(badVariant.status, 1);
    assert.match(badVariant.stderr, /нет варианта "Z"/);
  });
});

describe('VL-300 — CLI experiment run --rerun / external runner', () => {
  it('--rerun без --yes отказывает с подсказкой и не создаёт ран', () => {
    const before = readdirSync(join(backlogDir, 'experiments', 'exp-1')).filter(n => n.startsWith('run-'));
    const res = runCli(['experiment', 'run', 'exp-1', '--rerun', '1']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--rerun 1 --yes/);
    assert.match(res.stderr, /rerun_of: run-1/);
    const after = readdirSync(join(backlogDir, 'experiments', 'exp-1')).filter(n => n.startsWith('run-'));
    assert.deepEqual(after, before, 'ран не создан');
  });

  it('--rerun N --yes создаёт run-(max+1) с rerun_of: run-N, старый ран не тронут', () => {
    const runsBefore = readdirSync(join(backlogDir, 'experiments', 'exp-1'))
      .filter(n => /^run-\d+$/.test(n))
      .map(n => Number(n.slice(4)))
      .sort((a, b) => a - b);
    const maxBefore = runsBefore[runsBefore.length - 1];
    const oldMeta = JSON.parse(readFileSync(
      join(backlogDir, 'experiments', 'exp-1', 'run-1', 'meta.json'), 'utf-8'
    ));

    const res = runCli(['experiment', 'run', 'exp-1', '--rerun', '1', '--yes']);
    assert.equal(res.status, 0, res.stderr);

    const newRun = maxBefore + 1;
    const metaPath = join(backlogDir, 'experiments', 'exp-1', `run-${newRun}`, 'meta.json');
    assert.ok(existsSync(metaPath), `создан run-${newRun}`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    assert.equal(meta.rerun_of, 1);
    assert.equal(meta.run, newRun);
    // старый ран не перезаписан (run неизменяем, doc-21 §17 п.6)
    const oldAfter = JSON.parse(readFileSync(
      join(backlogDir, 'experiments', 'exp-1', 'run-1', 'meta.json'), 'utf-8'
    ));
    assert.deepEqual(oldAfter, oldMeta);
  });

  it('--rerun несуществующего рана — ошибка', () => {
    const res = runCli(['experiment', 'run', 'exp-1', '--rerun', '99', '--yes']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /run-99 не найден/);
  });

  it('--yes без --rerun — ошибка (подтверждать нечего)', () => {
    const res = runCli(['experiment', 'run', 'exp-1', '--yes']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /только вместе с --rerun/);
  });

  it('runner: external без --runner-cmd — ошибка с подсказкой', () => {
    const create = runCli([
      'experiment', 'create', 'Внешний раннер', '--dataset', 'ds-1', '--runner', 'external',
    ]);
    assert.equal(create.status, 0, create.stderr);
    const res = runCli(['experiment', 'run', 'exp-2']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--runner-cmd/);
  });

  it('runner: external с --runner-cmd прогоняет матрицу и пишет results', () => {
    const script = join(testRoot, 'ext-runner.mjs');
    writeFileSync(script, `
      let raw = '';
      process.stdin.on('data', (c) => { raw += c; });
      process.stdin.on('end', () => {
        const input = JSON.parse(raw);
        process.stdout.write(JSON.stringify({ score: input.variant === 'A' ? 3 : 6 }) + '\\n');
      });
    `, 'utf-8');
    const cmd = `"${process.execPath}" "${script}"`;
    const res = runCli(['experiment', 'run', 'exp-2', '--runner-cmd', cmd]);
    assert.equal(res.status, 0, res.stderr);
    const meta = JSON.parse(readFileSync(
      join(backlogDir, 'experiments', 'exp-2', 'run-1', 'meta.json'), 'utf-8'
    ));
    assert.equal(meta.runner, 'external');
    assert.equal(meta.status, 'completed');
    assert.equal(meta.n, 4);
    const rows = readResults('exp-2', 1);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter(r => r.variant === 'A').every(r => r.score === 3), true);
    assert.equal(rows.filter(r => r.variant === 'B').every(r => r.score === 6), true);
  });
});
