/**
 * Тесты VL-301 — CLI `vibelog experiment gc` (doc-21 §15).
 *
 * Спавнят реальный CLI (bin/vibelog.mjs) в mkdtemp-каталоге с backlog/;
 * env — только через testSpawnEnv (VL-286), иначе наследуется VIBELOG_CWD
 * агентской сессии и CLI уходит на главный репозиторий.
 *
 * Проверяется главное свойство git-политики: без `--apply` `.gitignore` не
 * меняется НИКОГДА, с `--apply` — дописывается один раз (повтор идемпотентен).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-gc-cli-'));
const backlogDir = join(testRoot, 'backlog');
const gitignorePath = join(testRoot, '.gitignore');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Создаёт `results.jsonl` рана указанного размера. */
function writeResults(expId, run, sizeBytes) {
  const dir = join(backlogDir, 'experiments', expId, `run-${run}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.jsonl'), 'x'.repeat(sizeBytes), 'utf-8');
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
  writeFileSync(gitignorePath, 'node_modules\ndist\n', 'utf-8');
  // Датасет нужен рану: без него `experiment run` отказывается стартовать
  mkdirSync(join(backlogDir, 'experiments', 'datasets'), { recursive: true });
  writeFileSync(
    join(backlogDir, 'experiments', 'datasets', 'ds-1.jsonl'),
    '{"task_id":"t1","expected_ac":"первый"}\n{"task_id":"t2","expected_ac":"второй"}\n',
    'utf-8'
  );
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-301 — CLI experiment gc', () => {
  it('создаёт эксперимент и раны (run как в VL-296)', () => {
    const created = runCli([
      'experiment', 'create', 'Git-политика', '--dataset', 'ds-1',
      '--variant', 'A:builtin:spec', '--variant', 'B:builtin:plan',
    ]);
    assert.equal(created.status, 0, created.stderr);
    const run = runCli(['experiment', 'run', 'exp-1']);
    assert.equal(run.status, 0, run.stderr);
    // run-1 — маленький, run-2 — больше порога (создаём вручную: CLI не пишет 10 MB)
    writeResults('exp-1', 2, 10 * 1024 * 1024 + 100);
  });

  it('без --apply печатает кандидатов и НЕ меняет .gitignore (AC1)', () => {
    const before = readFileSync(gitignorePath, 'utf-8');
    const res = runCli(['experiment', 'gc', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /run-2/, 'кандидат run-2 должен быть в выводе');
    assert.match(res.stdout, /кандидатов: 1/);
    assert.match(res.stdout, /Ничего не изменено/);
    assert.equal(readFileSync(gitignorePath, 'utf-8'), before, '.gitignore не должен меняться без --apply');
  });

  it('--apply дописывает секцию в .gitignore (AC2)', () => {
    const res = runCli(['experiment', 'gc', 'exp-1', '--apply']);
    assert.equal(res.status, 0, res.stderr);
    const text = readFileSync(gitignorePath, 'utf-8');
    assert.match(text, /# vibelog experiment exp-1: results\.jsonl > 10 MB/);
    assert.match(text, /backlog\/experiments\/exp-1\/run-2\//);
    assert.match(text, /# \/vibelog experiment exp-1/);
    // Посторонние правила проекта сохранены
    assert.match(text, /^node_modules$/m);
    assert.match(text, /^dist$/m);
  });

  it('повторный --apply не дублирует строки (идемпотентность, AC2)', () => {
    const first = readFileSync(gitignorePath, 'utf-8');
    const res = runCli(['experiment', 'gc', 'exp-1', '--apply']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /уже актуален/);
    const second = readFileSync(gitignorePath, 'utf-8');
    assert.equal(second, first, 'повторный запуск не должен менять файл');
    assert.equal(second.match(/run-2\//g).length, 1, 'строка не должна дублироваться');
  });

  it('эксперимент без кандидатов и неизвестный id — понятные сообщения', () => {
    let res = runCli(['experiment', 'create', 'Пустой эксперимент']);
    assert.equal(res.status, 0, res.stderr);
    res = runCli(['experiment', 'gc', 'exp-2']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Кандидатов на \.gitignore нет/);

    res = runCli(['experiment', 'gc', 'exp-99']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /не найден/);

    res = runCli(['experiment', 'gc']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Укажите id эксперимента/);
  });

  it('gc не удаляет файлы результатов — правится только .gitignore', () => {
    assert.ok(existsSync(join(backlogDir, 'experiments', 'exp-1', 'run-2', 'results.jsonl')));
  });
});
