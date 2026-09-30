/**
 * Тесты VL-10 — task create --plan/--notes.
 *
 * Проверяет:
 * - create --plan/--notes записывает секции Implementation Plan / Notes
 * - round-trip: секции видны в markdown-файле задачи
 * - create без флагов не создаёт пустых секций
 * - help: create показывает --plan, edit показывает --append-notes
 *
 * Паттерн search-cli.test.mjs: testDir в /tmp, spawnSync со слиянием
 * stdout/stderr, проверка содержимого не exit code.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-plan-notes-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const tasksDirPath = join(testDir, 'backlog', 'tasks');

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

/** Создаёт backlog и возвращает id новой задачи. */
function seed(createArgs) {
  fresh();
  runCli('init', 'Plan Notes', '--prefix', 'pn');
  const out = runCli('task', 'create', ...createArgs);
  const m = out.match(/(pn-\d+)/);
  assert.ok(m, `не удалось получить id задачи: ${out}`);
  return m[1];
}

describe('VL-10 — task create --plan/--notes', () => {
  after(() => cleanup());

  it('create --plan/--notes записывает секции', () => {
    const id = seed(['Задача с планом', '--plan', '1. Шаг один', '--notes', 'Заметка V1']);
    const view = runCli('task', 'view', id, '--json');
    assert.ok(view.includes('implementationPlan'), `view: ${view.slice(0, 200)}`);
    assert.ok(view.includes('1. Шаг один'), `plan: ${view.slice(0, 300)}`);
    assert.ok(view.includes('Заметка V1'), `notes: ${view.slice(0, 300)}`);
  });

  it('round-trip: секции видны в markdown-файле', () => {
    const id = seed(['RT задача', '--plan', 'План RT', '--notes', 'Заметка RT']);
    const file = readdirSync(tasksDirPath).find(f => f.includes(id));
    const content = readFileSync(join(tasksDirPath, file), 'utf-8');
    assert.ok(content.includes('## Implementation Plan'), content.slice(0, 200));
    assert.ok(content.includes('План RT'));
    assert.ok(content.includes('## Implementation Notes'));
    assert.ok(content.includes('Заметка RT'));
  });

  it('create без флагов — пустых секций нет', () => {
    const id = seed(['Обычная задача']);
    const file = readdirSync(tasksDirPath).find(f => f.includes(id));
    const content = readFileSync(join(tasksDirPath, file), 'utf-8');
    assert.ok(!content.includes('## Implementation Plan'), 'секция плана не должна появиться');
    assert.ok(!content.includes('## Implementation Notes'), 'секция заметок не должна появиться');
  });

  it('help: create показывает --plan, edit показывает --append-notes', () => {
    const helpCreate = runCli('task', '--help');
    assert.ok(helpCreate.includes('--plan') && helpCreate.includes('--notes'), `create help: ${helpCreate}`);
    const helpEdit = runCli('task', 'edit', '--help');
    assert.ok(helpEdit.includes('--plan') && helpEdit.includes('--append-notes'), `edit help: ${helpEdit}`);
  });
});
