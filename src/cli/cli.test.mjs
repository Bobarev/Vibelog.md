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
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
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
import { runAgent } from '../../dist/cli/commands/agent.js';
import { setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';

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

  // ── VL-141: vibelog agent analyze — CLI-паритет /analyze бота ──

  /** Перехват console.error (printError печатает туда) + console.log. */
  async function captureBoth(fn) {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await fn();
      return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  }

  it('agent analyze — запускается стаб-бином, печатает PID и результат (VL-141)', async () => {
    // Стаб бинаря агента: пишет JSON type=result (контракт parseQwenResult)
    const stubBin = join(testDir, 'analyze-stub.cjs');
    writeFileSync(stubBin, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "fs.writeSync(1, 'stub analyze\\n');",
      "fs.writeSync(1, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 2, result: 'анализ-готов', usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 5 }, session_id: 'cli-an-1' }) + '\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stubBin, 0o755);
    // Тестовый шов VL-140: явный env со стаб-бином вместо process.env
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'VIBELOG_QWEN_BIN' || k === 'VIBELOG_AGENT_BIN') continue;
      env[k] = v;
    }
    env.VIBELOG_QWEN_BIN = stubBin;
    setSpawnEnvBaseForTests(env);
    try {
      // Сессия vibelog-agent в testDir (+ meta)
      const sessDir = join(testDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      writeFileSync(join(sessDir, 'agent-123.jsonl'), JSON.stringify({ role: 'user', content: 'привет' }) + '\n', 'utf-8');
      writeFileSync(join(sessDir, 'agent-123.meta.json'), JSON.stringify({ taskId: '', phase: 'code', cwd: testDir }), 'utf-8');
      const out = await captureBoth(() => runAgent('analyze', ['vb:agent-123'], {}, testDir));
      assert.ok(out.includes('PID'), `нет PID в выводе: ${out}`);
      assert.ok(out.includes('анализ-готов'), `нет результата в выводе: ${out}`);
    } finally {
      setSpawnEnvBaseForTests(null);
      process.exitCode = 0;
    }
  });

  it('agent analyze — нет аргумента и несуществующая сессия → ошибка (VL-141)', async () => {
    // Нет аргумента: printError в console.error + exitCode 1
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('analyze', [], {}, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /Синтаксис: vibelog agent analyze/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    // Несуществующая сессия: session-ref валиден, jsonl нет
    errText = '';
    const errSpy2 = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('analyze', ['vb:agent-404'], {}, testDir);
    } finally {
      errSpy2.mockRestore();
    }
    assert.match(errText, /Сессия не найдена/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('agent — неизвестная подкоманда → ошибка (VL-141)', async () => {
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('deploy', ['x'], {}, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /Неизвестная подкоманда agent/);
    assert.match(errText, /analyze/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });
});
