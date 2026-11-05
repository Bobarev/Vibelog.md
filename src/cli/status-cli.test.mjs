/**
 * Тесты VL-341 — CLI-команда `vibelog status`.
 *
 * Спавнит реальный CLI (как src/cli/diagnostics.test.mjs): человекочитаемый
 * вывод содержит секции «Фазы»/«Git», `--json` парсится и имеет стабильные
 * ключи, `--short` — по строке на пункт, без backlog/ — код 1.
 *
 * env спавна — только через testSpawnEnv() (VL-286): иначе тест наследует
 * VIBELOG_CWD агентской сессии и уезжает на главный репозиторий.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { testSpawnEnv } from '../test-env.mjs';
import { stringifyYaml } from '../../dist/core/yaml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-status-cli-'));

/** Запуск CLI; возвращает {out, code}. */
function runCli(args, cwd) {
  try {
    const out = execFileSync('node', [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: testSpawnEnv(),
    });
    return { out, code: 0 };
  } catch (err) {
    return { out: (err.stdout || '') + (err.stderr || ''), code: err.status ?? 1 };
  }
}

/** Проект с backlog/ и config.yml. */
function newProj(name) {
  const dir = join(testRoot, name);
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Status CLI',
      task_prefix: 'VL',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'Review', 'Done', 'Rejected'],
      definition_of_done: [],
    }),
    'utf-8'
  );
  return dir;
}

describe('vibelog status (VL-341)', () => {
  const proj = newProj('proj');
  const empty = join(testRoot, 'empty');

  beforeAll(() => {
    mkdirSync(empty, { recursive: true });
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('человекочитаемый вывод содержит секции Фазы и Git, код 0', () => {
    const { out, code } = runCli(['status'], proj);
    assert.equal(code, 0);
    assert.ok(out.includes('Vibelog.md'), 'заголовок с версией');
    assert.ok(out.includes('Проект:'), 'секция проекта');
    assert.ok(out.includes('Задачи:'), 'секция задач');
    assert.ok(out.includes('Фазы:'), 'секция фаз');
    assert.ok(out.includes('Очередь:'), 'секция очереди');
    assert.ok(out.includes('Прогон:'), 'секция прогона');
    assert.ok(out.includes('Git:'), 'секция git');
    assert.ok(out.includes('Status CLI'), 'имя проекта из config.yml');
  });

  it('--json парсится и имеет стабильные ключи', () => {
    const { out, code } = runCli(['status', '--json'], proj);
    assert.equal(code, 0);
    const json = JSON.parse(out);
    for (const key of ['version', 'project', 'tasks', 'runs', 'queue', 'grant', 'git']) {
      assert.ok(key in json, `ключ ${key} должен быть`);
    }
    assert.equal(json.project.name, 'Status CLI');
    assert.equal(json.project.taskPrefix, 'VL');
    assert.ok(Array.isArray(json.runs));
    assert.equal(typeof json.queue.running, 'boolean');
    assert.ok(Array.isArray(json.queue.pending));
  });

  it('--short: одна строка на пункт, без заголовков', () => {
    const { out, code } = runCli(['status', '--short'], proj);
    assert.equal(code, 0);
    assert.ok(out.includes('version:'), 'строка версии');
    assert.ok(out.includes('project:'), 'строка проекта');
    assert.ok(out.includes('git:'), 'строка git');
    assert.ok(!out.includes('Фазы:'), 'без заголовков блоков');
  });

  it('--no-git: git-секция не собирается', () => {
    const { out } = runCli(['status', '--json', '--no-git'], proj);
    const json = JSON.parse(out);
    assert.equal(json.git, null);
  });

  it('без backlog/: код 1 и подсказка vibelog init', () => {
    const { out, code } = runCli(['status'], empty);
    assert.equal(code, 1);
    assert.ok(out.includes('vibelog init'), 'подсказка init');
  });
});
