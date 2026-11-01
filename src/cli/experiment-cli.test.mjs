/**
 * Тесты VL-294 — CLI `vibelog experiment` (create / list).
 *
 * Спавнят реальный CLI (bin/vibelog.mjs) в mkdtemp-каталоге с backlog/;
 * env собирается через testSpawnEnv (VL-286), иначе наследуется
 * VIBELOG_CWD агентской сессии и CLI уходит на главный репозиторий.
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
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-cli-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
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
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-294 — CLI experiment', () => {
  it('create: файл backlog/experiments/exp-1.md появляется с frontmatter', () => {
    const res = runCli(['experiment', 'create', 'Варианты промпта фазы', '--dataset', 'prompts-baseline']);
    assert.equal(res.status, 0, res.stderr);
    const path = join(backlogDir, 'experiments', 'exp-1.md');
    assert.ok(existsSync(path), 'файл эксперимента создан');
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.includes('id: exp-1'));
    assert.ok(content.includes('status: draft'));
    assert.ok(content.includes('schema_version: 1'));
    assert.ok(content.includes('dataset: prompts-baseline'));
    assert.ok(content.includes('runner: manual'));
    // без --variant создаются A/B-заготовки
    assert.ok(content.includes('A:'));
    assert.ok(content.includes('B:'));
    assert.match(res.stdout, /exp-1/);
  });

  it('create с --variant: формат builtin:<phase> сохраняется целиком', () => {
    const res = runCli([
      'experiment', 'create', 'С вариантами',
      '--variant', 'A:builtin:spec:текущий',
      '--variant', 'B:phase-plan',
    ]);
    assert.equal(res.status, 0, res.stderr);
    const content = readFileSync(join(backlogDir, 'experiments', 'exp-2.md'), 'utf-8');
    assert.ok(content.includes('builtin:spec'), 'builtin:<phase> не разрезан по двоеточию');
    assert.ok(content.includes('текущий'));
    assert.ok(content.includes('phase-plan'));
  });

  it('create с невалидным статусом: ошибка, exitCode 1, файл не создан', () => {
    const res = runCli(['experiment', 'create', 'Кривой статус', '--status', 'banana']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Недопустимый статус эксперимента/);
    assert.ok(!existsSync(join(backlogDir, 'experiments', 'exp-3.md')));
  });

  it('list: выводит созданные эксперименты', () => {
    const res = runCli(['experiment', 'list']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /exp-1/);
    assert.match(res.stdout, /exp-2/);
    assert.match(res.stdout, /экспериментов: 2/);
  });

  it('list --status: фильтрует по статусу', () => {
    const filtered = runCli(['experiment', 'list', '--status', 'completed']);
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.match(filtered.stdout, /Экспериментов нет/);
  });

  it('неизвестная подкоманда: понятная ошибка со списком', () => {
    const res = runCli(['experiment', 'run']);
    assert.equal(res.status, 0);
    assert.match(res.stderr, /Неизвестная подкоманда: run/);
    // printInfo пишет в stdout
    assert.match(res.stdout, /create, list/);
  });
});
