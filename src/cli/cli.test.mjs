/**
 * Интеграционные тесты CLI Vibelog.md.
 *
 * Запускают vibelog.mjs как subprocess и проверяют вывод.
 * Используют временную директорию для изоляции.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
// Вне проекта — чтобы findBacklogDir не поднялся вверх к backlog/ проекта
const testDir = '/tmp/vibelog-cli-test';

function run(args, opts = {}) {
  try {
    return execFileSync('node', [cliPath, ...args], {
      cwd: opts.cwd || testDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // dyld SIGABRT на Catalina — не считаем ошибкой, возвращаем что есть
    if (err.status === null && err.signal === 'SIGABRT') {
      return (err.stdout || '') + (err.stderr || '');
    }
    // Для других ошибок — возвращаем комбинацию stdout + stderr
    return (err.stdout || '') + (err.stderr || '');
  }
}

describe('CLI — интеграционные тесты', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync('git', ['init'], { cwd: testDir, stdio: 'pipe' });
  });
  after(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('help — выводит справку', () => {
    const out = run(['help']);
    assert.ok(out.includes('Vibelog.md'));
    assert.ok(out.includes('init'));
    assert.ok(out.includes('task'));
    assert.ok(out.includes('board'));
  });

  it('init — создаёт backlog/', () => {
    const out = run(['init', 'CLI Test', '--prefix', 'clt']);
    assert.ok(out.includes('Создана директория'));
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')));
    assert.ok(existsSync(join(testDir, 'backlog', 'tasks')));
  });

  it('task create — создаёт задачу', () => {
    const out = run(['task', 'create', 'Тест CLI', '-d', 'Описание', '--ac', 'Критерий']);
    assert.ok(out.includes('clt-1'));
    assert.ok(existsSync(join(testDir, 'backlog', 'tasks', 'clt-1 - Тест-CLI.md')));
  });

  it('task list — список задач', () => {
    const out = run(['task', 'list']);
    assert.ok(out.includes('clt-1'));
    assert.ok(out.includes('Тест CLI'));
  });

  it('task view — просмотр задачи', () => {
    const out = run(['task', 'view', 'clt-1']);
    assert.ok(out.includes('clt-1'));
    assert.ok(out.includes('Тест CLI'));
    assert.ok(out.includes('Описание'));
  });

  it('task edit — обновление статуса', () => {
    const out = run(['task', 'edit', 'clt-1', '--status', 'In Progress']);
    assert.ok(out.includes('обновлена'));
    const view = run(['task', 'view', 'clt-1']);
    assert.ok(view.includes('In Progress'));
  });

  it('task edit --check-ac — отметка AC', () => {
    run(['task', 'edit', 'clt-1', '--check-ac', '1']);
    const view = run(['task', 'view', 'clt-1']);
    assert.ok(view.includes('✓'));
  });

  it('task create с labels и priority', () => {
    run(['task', 'create', 'Вторая задача', '--labels', 'bug,urgent', '--priority', 'High']);
    const out = run(['task', 'list']);
    assert.ok(out.includes('clt-2'));
  });

  it('search — поиск задач', () => {
    const out = run(['search', 'CLI']);
    assert.ok(out.includes('clt-1'));
  });

  it('board — ANSI-доска', () => {
    const out = run(['board']);
    assert.ok(out.includes('In Progress'));
    assert.ok(out.includes('To Do'));
    assert.ok(out.includes('Done'));
  });

  it('instructions — инструкции для агентов', () => {
    const out = run(['instructions', 'overview']);
    assert.ok(out.includes('Vibelog.md'));
    assert.ok(out.includes('vibelog task create'));
  });

  it('init — повторная инициализация запрещена', () => {
    try {
      const out = run(['init', 'Another']);
      assert.ok(out.includes('уже инициализирован') || out.includes('Backlog уже'));
    } catch (err) {
      // Может завершиться с non-zero кодом
      const output = (err.stdout || '') + (err.stderr || '');
      assert.ok(output.includes('уже инициализирован') || output.includes('Backlog уже'), `Output: ${output}`);
    }
  });
});
