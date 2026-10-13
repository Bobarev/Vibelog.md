/**
 * Тесты CLI Vibelog.md (VL-140: разгрузка spawn'ов).
 *
 * Контракты самого процесса CLI (exit-коды, не-TTY-поведение, повторный init)
 * проверяются spawnSync'ом бинаря. Чистая логика команд (help, init, task,
 * search, board, instructions) — прямым импортом dist-модулей с перехватом
 * console.log: минус десятки spawn'ов по 300-500 мс. Флаги собираются тем же
 * parseArgs, что и в роутере — семантика CLI-аргументов сохраняется.
 */

import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { route } from '../../dist/cli/router.js';
import { parseArgs } from '../../dist/cli/args.js';
import { runInit } from '../../dist/cli/commands/init.js';
import { runTask } from '../../dist/cli/commands/task.js';
import { runBoard } from '../../dist/cli/commands/board.js';
import { runSearch } from '../../dist/cli/commands/search.js';
import { runInstructions } from '../../dist/cli/commands/instructions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
// Вне проекта — чтобы findBacklogDir не поднялся вверх к backlog/ проекта
// VL-140: уникальный tmp-каталог на прогон — параллелизм файлов безопасен
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-cli-test-'));

/**
 * Перехватывает console.log команды и возвращает склеенный вывод.
 * CLI печатает исключительно через console.log (src/cli/ui.ts).
 */
async function capture(fn) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

/** Запуск команды dist напрямую: parseArgs → run* с cwd=testDir. */
function runCmd(args, runFn) {
  const parsed = parseArgs(args);
  return runFn(parsed.subcommand, parsed.positional, parsed.flags, testDir);
}

describe('CLI — интеграционные тесты', () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    execFileSync('git', ['init'], { cwd: testDir, stdio: 'pipe' });
  });
  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('help — выводит справку (route + прямой импорт)', async () => {
    const out = await capture(() => route(['help']));
    assert.ok(out.includes('Vibelog.md'));
    assert.ok(out.includes('init'));
    assert.ok(out.includes('task'));
    assert.ok(out.includes('board'));
  });

  it('init — создаёт backlog/', async () => {
    const out = await capture(() => runInit(['CLI Test', '--prefix', 'clt'], parseArgs(['init', '--prefix', 'clt']).flags, testDir));
    assert.ok(out.includes('Создана директория'));
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')));
    assert.ok(existsSync(join(testDir, 'backlog', 'tasks')));
  });

  it('task create — создаёт задачу', async () => {
    const out = await capture(() => runCmd(['task', 'create', 'Тест CLI', '-d', 'Описание', '--ac', 'Критерий'], runTask));
    assert.ok(out.includes('clt-1'));
    assert.ok(existsSync(join(testDir, 'backlog', 'tasks', 'clt-1 - Тест-CLI.md')));
  });

  it('task list — список задач', async () => {
    const out = await capture(() => runCmd(['task', 'list'], runTask));
    assert.ok(out.includes('clt-1'));
    assert.ok(out.includes('Тест CLI'));
  });

  it('task view — просмотр задачи', async () => {
    const out = await capture(() => runCmd(['task', 'view', 'clt-1'], runTask));
    assert.ok(out.includes('clt-1'));
    assert.ok(out.includes('Тест CLI'));
    assert.ok(out.includes('Описание'));
  });

  it('task edit — обновление статуса', async () => {
    const out = await capture(() => runCmd(['task', 'edit', 'clt-1', '--status', 'In Progress'], runTask));
    assert.ok(out.includes('обновлена'));
    const view = await capture(() => runCmd(['task', 'view', 'clt-1'], runTask));
    assert.ok(view.includes('In Progress'));
  });

  it('task edit --check-ac — отметка AC', async () => {
    await capture(() => runCmd(['task', 'edit', 'clt-1', '--check-ac', '1'], runTask));
    const view = await capture(() => runCmd(['task', 'view', 'clt-1'], runTask));
    assert.ok(view.includes('✓'));
  });

  it('task create с labels и priority', async () => {
    await capture(() => runCmd(['task', 'create', 'Вторая задача', '--labels', 'bug,urgent', '--priority', 'High'], runTask));
    const out = await capture(() => runCmd(['task', 'list'], runTask));
    assert.ok(out.includes('clt-2'));
  });

  it('search — поиск задач', async () => {
    const out = await capture(() => runSearch(['CLI'], {}, testDir));
    assert.ok(out.includes('clt-1'));
  });

  it('board — ANSI-доска', async () => {
    const out = await capture(() => runBoard([], {}, testDir));
    assert.ok(out.includes('In Progress'));
    assert.ok(out.includes('To Do'));
    assert.ok(out.includes('Done'));
  });

  it('instructions — инструкции для агентов', async () => {
    const out = await capture(() => runInstructions(['overview'], {}, testDir));
    assert.ok(out.includes('Vibelog.md'));
    assert.ok(out.includes('vibelog task create'));
  });

  it('package.json — алиас vb указывает на bin/vibelog.mjs (VL-102)', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    assert.equal(pkg.bin.vb, './bin/vibelog.mjs');
  });

  it('пустой запуск без аргументов (не-TTY) — справка, exit 0 (VL-102)', () => {
    // Контракт САМОГО ПРОЦЕССА CLI — остаётся spawnSync: stdio pipe →
    // stdin/stdout не-TTY → TUI не запускается, показывается справка
    const res = spawnSync('node', [cliPath], {
      cwd: testDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' },
    });
    assert.equal(res.status, 0, `exit=${res.status} signal=${res.signal ?? '-'}`);
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.ok(out.includes('Vibelog.md'), out.slice(0, 300));
    assert.ok(out.includes('Алиас'), 'справка упоминает алиас vb');
  });

  it('init — повторная инициализация запрещена (контракт процесса)', () => {
    // Контракт самого процесса CLI: exit-код 1 + сообщение — spawnSync
    const res = spawnSync('node', [cliPath, 'init', 'Another'], {
      cwd: testDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' },
    });
    const output = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 1, `exit=${res.status}; output=${output}`);
    assert.ok(output.includes('уже инициализирован') || output.includes('Backlog уже'), `Output: ${output}`);
  });
});
