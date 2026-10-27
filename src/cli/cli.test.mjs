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
import { mkdirSync, rmSync, existsSync, readFileSync, mkdtempSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
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
import { runBot } from '../../dist/cli/commands/bot.js';
import { runBrowser } from '../../dist/cli/commands/browser.js';
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
    assert.ok(out.includes('vibelog agent'), 'справка упоминает vibelog agent (VL-158)');
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

  // ── VL-144: vibelog task reject ──

  it('task reject — механика: Rejected + completed/ + комментарий (VL-144)', async () => {
    // clt-3 в To Do (никогда не была в Code) → синхронный механический путь
    await capture(() => runCmd(['task', 'create', 'Отклоняемая'], runTask));
    const out = await capture(() => runCmd(['task', 'reject', 'clt-3', 'причина', 'отказа'], runTask));
    assert.ok(out.includes('отклонена'), `вывод reject: ${out}`);
    assert.ok(out.includes('Rejected'), `статус в выводе: ${out}`);
    // Файл ушёл в completed/
    assert.ok(!existsSync(join(testDir, 'backlog', 'tasks', 'clt-3 - Отклоняемая.md')), 'файл должен уйти из tasks/');
    const completed = readdirSync(join(testDir, 'backlog', 'completed')).filter(f => f.startsWith('clt-3'));
    assert.equal(completed.length, 1, 'файл в completed/');
    const content = readFileSync(join(testDir, 'backlog', 'completed', completed[0]), 'utf-8');
    assert.ok(content.includes('Rejected'), 'статус Rejected в файле');
    assert.ok(content.includes('причина отказа'), 'комментарий в файле');
  });

  it('task reject без ID — ошибка с подсказкой (VL-144)', async () => {
    // printError пишет через console.error (src/cli/ui.ts), а capture
    // перехватывает только console.log — spy'им error отдельно.
    // ВАЖНО: mockRestore() в vitest очищает mock.calls — читаем ДО restore
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let out = '';
    try {
      await runCmd(['task', 'reject'], runTask);
      out = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    } finally {
      spy.mockRestore();
    }
    assert.ok(out.includes('Укажите ID задачи'), `вывод: ${out}`);
  });

  it('help task — содержит reject <id> (VL-144)', async () => {
    const out = await capture(() => route(['task', '--help']));
    assert.ok(out.includes('reject <id>'), `help task: ${out}`);
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

  it('пустой запуск без аргументов (не-TTY) — справка, exit 0 (VL-158; ранее VL-102)', () => {
    // Контракт САМОГО ПРОЦЕССА CLI — остаётся spawnSync: stdio pipe →
    // stdin/stdout не-TTY; VL-158: справка ВСЕГДА, TUI-чат переехал в vibelog agent
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
    assert.ok(out.includes('vibelog agent'), 'справка подсказывает vibelog agent (VL-158)');
  });

  it('пустой запуск в TTY (подменён isTTY) — справка, а не TUI (VL-158)', async () => {
    // VL-102 запускал TUI при isTTY; VL-158: даже в TTY пустой запуск = справка.
    // Подменяем isTTY у stdin/stdout — route([]) обязан печатать справку (TUI не рисуется)
    const stdout = process.stdout;
    const stdin = process.stdin;
    const outStdout = stdout.isTTY;
    const outStdin = stdin.isTTY;
    stdout.isTTY = true;
    stdin.isTTY = true;
    try {
      const out = await capture(() => route([]));
      assert.ok(out.includes('Vibelog.md'), `нет справки: ${out.slice(0, 300)}`);
      assert.ok(out.includes('Алиас'), 'справка упоминает алиас vb');
    } finally {
      stdout.isTTY = outStdout;
      stdin.isTTY = outStdin;
    }
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

  it('VL-206: browser --help — уведомление о новой версии в stderr сразу при запуске', () => {
    // Интеграция процесса: фейковый npm в PATH отдаёт "9.9.9" (нет сети),
    // TMPDIR изолирован → кэш проверки обновления свой на каждый прогон
    const wrapDir = mkdtempSync(join(tmpdir(), 'vl206-npm-'));
    const cacheDir = mkdtempSync(join(tmpdir(), 'vl206-cache-'));
    const fakeNpm = join(wrapDir, 'npm');
    writeFileSync(fakeNpm, '#!/usr/bin/env node\nconsole.log(\'"9.9.9"\');\n', 'utf-8');
    chmodSync(fakeNpm, 0o755);
    const baseEnv = {
      ...process.env,
      PATH: `${wrapDir}:${process.env.PATH ?? ''}`,
      TMPDIR: cacheDir,
      VIBELOG_SKIP_UPDATE_CHECK: '', // пусто — НЕ отключает проверку
    };
    try {
      // 1) Первый запуск: устаревшего кэша нет → проверка → уведомление в stderr
      const first = spawnSync('node', [cliPath, 'browser', '--help'], {
        cwd: testDir, encoding: 'utf-8', timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'], env: baseEnv,
      });
      assert.equal(first.status, 0, `exit=${first.status}; stderr=${first.stderr}`);
      assert.ok(first.stderr.includes('Доступна новая версия'), `нет уведомления в stderr: ${first.stderr}`);
      assert.ok(first.stderr.includes('npm install -g vibelog.md'), first.stderr);
      // stdout — справка, без уведомления (контракт stdout не сломан, AC2)
      assert.ok(first.stdout.includes('browser'), `нет справки: ${first.stdout.slice(0, 200)}`);
      assert.ok(!first.stdout.includes('Доступна новая версия'), 'уведомление протекло в stdout');

      // 2) Повторный запуск с тем же TMPDIR → кэш свежий (TTL 24 ч) → тихо
      const second = spawnSync('node', [cliPath, 'browser', '--help'], {
        cwd: testDir, encoding: 'utf-8', timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'], env: baseEnv,
      });
      assert.equal(second.status, 0, `exit=${second.status}`);
      assert.ok(!second.stderr.includes('Доступна новая версия'), `повторный показ: ${second.stderr}`);

      // 3) VIBELOG_SKIP_UPDATE_CHECK=true и свежий TMPDIR → проверки нет вовсе
      const guarded = spawnSync('node', [cliPath, 'browser', '--help'], {
        cwd: testDir, encoding: 'utf-8', timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...baseEnv, TMPDIR: mkdtempSync(join(tmpdir(), 'vl206-guard-')), VIBELOG_SKIP_UPDATE_CHECK: 'true' },
      });
      assert.equal(guarded.status, 0, `exit=${guarded.status}`);
      assert.ok(!guarded.stderr.includes('Доступна новая версия'), `env-гард не сработал: ${guarded.stderr}`);
    } finally {
      rmSync(wrapDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
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

  it('agent — неизвестная подкоманда → ошибка (VL-141, текст VL-158)', async () => {
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('deploy', ['x'], {}, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /Неизвестная подкоманда agent/);
    assert.match(errText, /analyze/);
    assert.match(errText, /task-id/, 'текст перечисляет <task-id> (VL-158)');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  // ── VL-158: vibelog agent [task-id] — интерактивный чат ──

  it('agent без подкоманды и <task-id> в не-TTY → ошибка про терминал (VL-158)', async () => {
    // vitest — не-TTY: chat-ветка обязана отклониться ДО getTask/TUI.
    // clt-1 существует в testDir (task create выше) — падение на getTask недопустимо
    for (const sub of ['', 'clt-1', 'clt-999']) {
      let errText = '';
      const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
      try {
        await runAgent(sub, [], {}, testDir);
      } finally {
        errSpy.mockRestore();
      }
      assert.match(errText, /нужен терминал \(TTY\)/, `sub='${sub}': ${errText}`);
      assert.equal(process.exitCode, 1, `sub='${sub}'`);
      process.exitCode = 0;
    }
  });

  // ── VL-171: vibelog agent --resume — возобновление TUI-чата ──

  it('agent --resume без значения (boolean) → явная ошибка до TTY-check (VL-171)', async () => {
    // args.ts превращает «--resume» без значения в boolean true —
    // runAgent обязан отклонить такой флаг, а не молча стартовать новую сессию
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('', [], { resume: true }, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /--resume требует session-ref/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('agent <task-id> --resume без значения → та же ошибка (VL-171)', async () => {
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('clt-1', [], { resume: true }, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /--resume требует session-ref/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('agent --resume со строковым значением в не-TTY → ошибка про терминал (VL-171)', async () => {
    // Валидация значения прошла → дальше штатный TTY-check чат-ветки
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('', [], { resume: 'vb:agent-123' }, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /нужен терминал \(TTY\)/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('agent analyze --resume → ошибка «только в интерактивном чате» (VL-171)', async () => {
    let errText = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...c) => { errText += c.join(' ') + '\n'; });
    try {
      await runAgent('analyze', ['vb:agent-123'], { resume: 'vb:agent-123' }, testDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.match(errText, /--resume поддерживается только в интерактивном чате/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });
});

// ── VL-189: env проекта при запуске бота и браузера ──
// Оба режима используют общий loadProjectEnv — раньше бот грузил .env,
// а браузер нет (spawn фаз без VIBELOG_LLM_* → «не задан VIBELOG_LLM_API_KEY»)
describe('VL-189: loadProjectEnv в точках входа бота и браузера', () => {
  const envKeys = ['TELEGRAM_BOT_TOKEN', 'VIBELOG_LLM_API_KEY', 'VIBELOG_LLM_MODEL'];
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  let projDir;

  beforeAll(() => {
    projDir = mkdtempSync(join(tmpdir(), 'vibelog-vl189-env-'));
    writeFileSync(
      join(projDir, '.env'),
      'VIBELOG_LLM_API_KEY=from-file\nVIBELOG_LLM_MODEL=vl189-model\n',
      'utf-8'
    );
  });

  afterAll(() => {
    // Save/restore обязателен (fileParallelism, isolate:false) — утечка
    // удалённых ключей сломала бы соседние тесты того же воркера
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(projDir, { recursive: true, force: true });
  });

  it('runBot: .env читается при старте (токена нет → ранний возврат, без сети)', async () => {
    // Чистая env: только .env projDir должен дать LLM-ключи; без токена
    // runBot возвращается после loadProjectEnv, не доходя до Telegram API
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.VIBELOG_LLM_API_KEY;
    delete process.env.VIBELOG_LLM_MODEL;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runBot([], {}, projDir);
    } finally {
      errSpy.mockRestore();
    }
    assert.equal(process.env.VIBELOG_LLM_API_KEY, 'from-file', 'runBot грузит .env (VL-189)');
    assert.equal(process.env.VIBELOG_LLM_MODEL, 'vl189-model');
  });

  it('runBrowser: .env читается при старте, возвращается Server для закрытия', async () => {
    delete process.env.VIBELOG_LLM_API_KEY;
    delete process.env.VIBELOG_LLM_MODEL;
    // console.log перехватываем — startWebServer печатает URL в лог теста
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let server;
    try {
      server = await runBrowser([], { port: '0', 'no-open': true }, projDir);
      assert.equal(process.env.VIBELOG_LLM_API_KEY, 'from-file', 'runBrowser грузит .env (VL-189)');
      assert.equal(process.env.VIBELOG_LLM_MODEL, 'vl189-model');
      assert.ok(server && typeof server.close === 'function', 'runBrowser возвращает Server');
    } finally {
      logSpy.mockRestore();
      server?.close();
    }
  });
});
