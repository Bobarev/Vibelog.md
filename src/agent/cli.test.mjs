/**
 * Тесты VL-85 — CLI vibelog-agent (src/agent/cli.ts).
 *
 * Мок-LM: node:http сервер на эфемерном порту (env VIBELOG_LLM_BASE_URL),
 * SSE-ответ chat/completions. Фаза comment в /tmp-проекте (изоляция —
 * память cli-test-isolation). Контракт: stdout — одна строка JSON
 * type=result, парсится parseQwenResult; stderr (логи) парсинг не ломает.
 * Плюс qwen-совместимость (позиционный промпт + --approval-mode yolo
 * --output-format json) и ошибки валидации.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQwenResult } from '../../dist/web/qwen-result.js';
import { parseArgs } from '../../dist/agent/cli.js';
import { loadApiMode } from '../../dist/agent/llm-env.js';
import { createTaskFile } from '../../dist/core/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'dist', 'agent', 'cli.js');

let testDir;
let mock;
/** Тела запросов к мок-LM (для проверки собранного промпта). */
const llmRequests = [];
/** Переопределяемый обработчик запроса мок-LM (VL-103): (body, res) => void. */
let llmHandler = null;

/** Мок-LM: SSE-ответ с фиксированным текстом и usage. */
function startMockLlm(finalText) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsedBody = null;
        try { parsedBody = JSON.parse(body); llmRequests.push(parsedBody); } catch { /* не-JSON — не важно */ }
        // Гибкий сценарий (VL-103): тесты переопределяют поведение мока
        // (tool_calls, обрыв сокета) — дефолт остаётся фиксированным текстом
        if (llmHandler) { llmHandler(parsedBody, res); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: finalText } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_input_tokens: 2, total_tokens: 17 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Полный env дочернего процесса: process.env + мок-LM на эфемерном порту. */
function llmEnv() {
  const env = {
    ...process.env,
    VIBELOG_LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
    VIBELOG_LLM_API_KEY: 'test-key',
    VIBELOG_LLM_MODEL: 'test-model',
    // VL-132: единообразный env-гард от реальной сети для всех spawn CLI
    VIBELOG_SKIP_UPDATE_CHECK: 'true',
  };
  // VL-116: env фазы оркестратора (branch-mode) не должен утекать в дочерние
  // CLI-процессы — иначе сессии/мета пишутся в реальный репозиторий, а не
  // в /tmp-проект теста (инцидент загрязнения backlog 2026-10-12)
  delete env.VIBELOG_CWD;
  delete env.VIBELOG_PHASE_TASK_ID;
  delete env.VIBELOG_PHASE_NAME;
  return env;
}

/** Запуск CLI как дочернего процесса; возвращает {code, stdout, stderr}. */
function runCli(args, env, cwd = testDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('vibelog-agent CLI (VL-85)', () => {
  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-cli-'));
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Agent Test\n', 'utf-8');
    // VL-137: фаза CLI не запускается без читаемой задачи (подстановка полей
    // в промпт) — фазовые тесты работают с реальной задачей VL-1
    createTaskFile(testDir, { id: 'VL-1', title: 'Задача CLI-тестов' });
    mock = await startMockLlm('Готово');
  });

  afterAll(async () => {
    await mock.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('фаза comment: stdout — одна строка JSON type=result, парсится parseQwenResult', async () => {
    llmRequests.length = 0;
    const { code, stdout, stderr } = await runCli(
      ['comment', 'VL-1', '--no-mcp', '--comment', 'привет из теста'],
      llmEnv()
    );
    assert.equal(code, 0);
    // Контракт VL-63: stdout — ровно одна строка
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1, 'stdout должен содержать одну строку: ' + JSON.stringify(stdout.slice(0, 200)));
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.type, 'result');
    assert.equal(parsed.result, 'Готово');
    assert.equal(parsed.is_error, false);
    assert.equal(parsed.num_turns, 1);
    assert.equal(parsed.usage.input_tokens, 10);
    assert.equal(parsed.usage.output_tokens, 5);
    assert.equal(parsed.usage.cache_read_input_tokens, 2);
    assert.equal(parsed.usage.total_tokens, 17);
    assert.match(parsed.session_id, /^agent-/);
    // parseQwenResult (контракт оркестратора) парсит stdout без изменений
    const qr = parseQwenResult(stdout);
    assert.equal(qr?.result, 'Готово');
    // stderr непуст (логи агента) и не ломает парсинг stdout
    assert.notEqual(stderr.trim(), '');
    // Промпт собран из шаблона: taskId и {{comment}} подставлены
    assert.ok(llmRequests.length >= 1, 'LLM должен был получить запрос');
    // Системный промпт (VL-96): первое сообщение к LLM — role=system
    assert.equal(llmRequests[0].messages[0]?.role, 'system');
    assert.match(llmRequests[0].messages[0]?.content ?? '', /Vibelog-agent/);
    const userMsg = llmRequests[0].messages?.find((m) => m.role === 'user');
    assert.ok(userMsg, 'в запросе к LLM должно быть user-сообщение');
    assert.match(userMsg.content, /VL-1/);
    assert.match(userMsg.content, /привет из теста/);
  });

  it('qwen-совместимость: позиционный промпт + --approval-mode yolo --output-format json', async () => {
    llmRequests.length = 0;
    const { code, stdout } = await runCli(
      ['Скажи ровно: Готово', '--approval-mode', 'yolo', '--output-format', 'json', '--no-mcp'],
      llmEnv()
    );
    assert.equal(code, 0);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.type, 'result');
    assert.equal(parsed.result, 'Готово');
    assert.equal(parseQwenResult(stdout)?.result, 'Готово');
    // Позиционный промпт дошёл до LLM как есть
    const userMsg = llmRequests[0].messages?.find((m) => m.role === 'user');
    assert.match(userMsg?.content ?? '', /Скажи ровно/);
  });

  it('без VIBELOG_LLM_API_KEY: exit 1, stderr с ошибкой, stdout пустой', async () => {
    const env = llmEnv();
    delete env.VIBELOG_LLM_API_KEY;
    const { code, stdout, stderr } = await runCli(['comment', 'VL-1', '--no-mcp'], env);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /VIBELOG_LLM_API_KEY/);
  });

  it('без VIBELOG_LLM_MODEL: exit 1, stderr с ошибкой о модели (VL-189)', async () => {
    // Общая ensureLlmEnv (VL-189): проверка модели переезжала из cli.ts
    // в llm-env.ts — регрессия на дословный текст ошибки в stderr
    const env = llmEnv();
    delete env.VIBELOG_LLM_MODEL;
    const { code, stdout, stderr } = await runCli(['comment', 'VL-1', '--no-mcp'], env);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /VIBELOG_LLM_MODEL/);
    assert.match(stderr, /модель LLM неизвестна/);
  });

  it('неизвестная фаза: exit 1, stderr с русской ошибкой', async () => {
    const { code, stdout, stderr } = await runCli(['deploy', 'VL-1', '--no-mcp'], llmEnv());
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /Неизвестная фаза/);
  });

  it('слишком много позиционных аргументов: exit 1', async () => {
    const { code, stderr } = await runCli(['a', 'b', 'c', '--no-mcp'], llmEnv());
    assert.equal(code, 1);
    assert.match(stderr, /Слишком много позиционных/);
  });

  it('--no-tui принимается: JSON-контракт не меняется (VL-86)', async () => {
    const { code, stdout } = await runCli(
      ['comment', 'VL-1', '--no-mcp', '--no-tui'],
      llmEnv()
    );
    assert.equal(code, 0);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).result, 'Готово');
  });

  // ── VL-95: parseArgs --resume/--continue ──

  it('parseArgs: --resume со значением, префикс vb: снимается', () => {
    const opts = parseArgs(['продолжи', '--resume', 'vb:agent-123']);
    assert.equal(opts.resume, 'agent-123');
  });

  it('parseArgs: --resume без префикса — как есть', () => {
    const opts = parseArgs(['продолжи', '--resume', 'agent-9']);
    assert.equal(opts.resume, 'agent-9');
  });

  it('parseArgs: --continue — флаг', () => {
    assert.equal(parseArgs(['продолжи', '--continue']).continue, true);
  });

  it('parseArgs: --resume и --continue вместе — throw', () => {
    assert.throws(() => parseArgs(['x', '--resume', 'agent-1', '--continue']), /несовместимы/);
  });

  it('parseArgs: --resume без значения — throw', () => {
    assert.throws(() => parseArgs(['x', '--resume']), /требует значение/);
  });

  // ── VL-104: parseArgs --max-requests ──

  it('parseArgs: --max-requests 42 → maxRequests=42', () => {
    assert.equal(parseArgs(['фаза', 'VL-1', '--max-requests', '42']).maxRequests, 42);
  });

  it('parseArgs: --max-requests 0 / abc / без значения — throw', () => {
    assert.throws(() => parseArgs(['x', '--max-requests', '0']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--max-requests', 'abc']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--max-requests']), /требует значение/);
  });

  it('--tool-calls-per-session (VL-223): парсинг и валидация', () => {
    assert.equal(
      parseArgs(['фаза', 'VL-1', '--tool-calls-per-session', '500']).toolCallsPerSession,
      500,
    );
    assert.equal(parseArgs(['x']).toolCallsPerSession, undefined, 'без флага — undefined');
    assert.throws(() => parseArgs(['x', '--tool-calls-per-session', 'abc']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--tool-calls-per-session', '0']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--tool-calls-per-session']), /требует значение/);
  });

  it('resume с --tool-calls-per-session: счётчик восстановлен из jsonl, лимит срабатывает (VL-223)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl223-'));
    try {
      // jsonl прошлых ранов: 2 валидных tool-calls + 1 фантом (не ест бюджет)
      const sessDir = join(projDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      const transcript = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'постановка' },
        { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', name: 'glob', arguments: {} },
          { id: 'c2', name: 'read_file', arguments: {} },
          { id: '', name: '', arguments: {} }, // фантом VL-215 — не считается
        ] },
        { role: 'tool', tool_call_id: 'c1', content: 'ok' },
        { role: 'tool', tool_call_id: 'c2', content: 'ok' },
        { role: 'assistant', content: 'готово прошлый ран' },
      ];
      writeFileSync(
        join(sessDir, 'agent-vl223-resume.jsonl'),
        transcript.map((m) => JSON.stringify(m)).join('\n') + '\n',
        'utf-8'
      );
      // Мок-LM отвечает tool_calls → первый вызов должен упереться в лимит 2/2
      llmHandler = (body, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'x1', function: { name: 'run_shell_command', arguments: '{"command":"echo hi"}' } }] } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      };
      llmRequests.length = 0;
      const { code, stdout, stderr } = await runCli(
        ['Продолжи', '--resume', 'agent-vl223-resume', '--no-mcp', '--tool-calls-per-session', '2'],
        llmEnv(),
        projDir
      );
      llmHandler = null;
      // fail loop → exit 1 (контракт cli.ts: is_error → process.exitCode = 1)
      assert.equal(code, 1, stdout);
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.is_error, true, 'лимит должен прервать фазу: ' + stdout.slice(0, 300));
      assert.match(parsed.result, /--tool-calls-per-session \(2\)/);
      assert.match(parsed.result, /использовано 2 из 2/);
      // stderr: база восстановлена из jsonl прошлых ранов
      assert.match(stderr, /Кумулятивный лимит tool-calls: 2 из 2 \(прошлые раны\)/);
      // Инструмент НЕ выполнялся: stderr без лога вызова инструмента
      assert.doesNotMatch(stderr, /\[vibelog-agent\] инструмент: run_shell_command/);
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  // ── VL-122: parseArgs --compact-tail / --compact-at-tokens / --no-compact ──

  it('parseArgs: --compact-tail 5 / --compact-at-tokens 1000 → opts (VL-122)', () => {
    const opts = parseArgs(['фаза', 'VL-1', '--compact-tail', '5', '--compact-at-tokens', '1000']);
    assert.equal(opts.compactTail, 5);
    assert.equal(opts.compactAtTokens, 1000);
  });

  it('parseArgs: --no-compact → noCompact=true (VL-122)', () => {
    assert.equal(parseArgs(['x', '--no-compact']).noCompact, true);
    assert.equal(parseArgs(['x']).noCompact, undefined);
  });

  it('parseArgs: невалидные значения компакшна — throw (VL-122)', () => {
    assert.throws(() => parseArgs(['x', '--compact-tail', '0']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--compact-tail', 'abc']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--compact-tail']), /требует значение/);
    assert.throws(() => parseArgs(['x', '--compact-at-tokens', '-5']), /положительное целое/);
    assert.throws(() => parseArgs(['x', '--compact-at-tokens']), /требует значение/);
  });

  // ── VL-205: parseArgs --api-mode и loadApiMode ──

  it('parseArgs: --api-mode responses/chat → opts.apiMode (VL-205)', () => {
    assert.equal(parseArgs(['фаза', 'VL-1', '--api-mode', 'responses']).apiMode, 'responses');
    assert.equal(parseArgs(['фаза', 'VL-1', '--api-mode', 'chat']).apiMode, 'chat');
    assert.equal(parseArgs(['x']).apiMode, undefined, 'без флага — читается settings.json');
  });

  it('parseArgs: --api-mode foo / без значения — throw (VL-205)', () => {
    assert.throws(() => parseArgs(['x', '--api-mode', 'foo']), /chat\|responses/);
    assert.throws(() => parseArgs(['x', '--api-mode']), /требует значение/);
  });

  it('loadApiMode: settings.json api_mode → режим, дефолт/мусор → chat (VL-205)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-apimode-'));
    try {
      // нет файла → chat (текущее поведение)
      assert.equal(loadApiMode(dir), 'chat');
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({ api_mode: 'responses' }));
      assert.equal(loadApiMode(dir), 'responses');
      // битое значение → chat: конфиг не должен ронять агента
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({ api_mode: 'xxx' }));
      assert.equal(loadApiMode(dir), 'chat');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── VL-95: интеграция — хранение и resume сессий ──

  // Переменная между it: id свежей сессии из предыдущего теста
  let freshSessionId;

  it('готовый промпт: создаётся JSONL-сессия, session_id реальный (VL-95)', async () => {
    llmRequests.length = 0;
    const { code, stdout } = await runCli(['Запомни: синий кот', '--no-mcp'], llmEnv());
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.match(parsed.session_id, /^agent-\d+$/);
    freshSessionId = parsed.session_id;
    // Файл сессии создан в .vibelog/agent-sessions/<sessionId>.jsonl
    const file = join(testDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.jsonl`);
    const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim());
    // system (VL-96) + user + финальный assistant
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).role, 'system');
    assert.equal(JSON.parse(lines[1]).content, 'Запомни: синий кот');
    assert.equal(JSON.parse(lines[2]).role, 'assistant');
    assert.equal(JSON.parse(lines[2]).content, 'Готово');
  });

  it('--resume vb:<id> продолжает сессию: история уходит в LLM (VL-95)', async () => {
    const sessionId = freshSessionId;
    assert.ok(sessionId, 'сессия из предыдущего теста должна существовать');
    llmRequests.length = 0;
    const { code, stdout } = await runCli(
      ['А теперь продолжи', '--resume', `vb:${sessionId}`, '--no-mcp'],
      llmEnv()
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim());
    assert.equal(parsed.session_id, sessionId);
    // Мок-LM получил историю первой сессии + новый промпт
    assert.ok(llmRequests.length >= 1);
    const msgs = llmRequests[0].messages;
    // system (VL-96, свежий при resume) + user + assistant + новый промпт
    assert.equal(msgs.length, 4);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[1].content, 'Запомни: синий кот');
    assert.equal(msgs[2].role, 'assistant');
    assert.equal(msgs[3].content, 'А теперь продолжи');
    // Файл сессии перезаписан: system + user + assistant + user + финальный assistant = 5
    const lines = readFileSync(join(testDir, '.vibelog', 'agent-sessions', `${sessionId}.jsonl`), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    assert.equal(lines.length, 5);
    assert.equal(JSON.parse(lines[3]).content, 'А теперь продолжи');
    assert.equal(JSON.parse(lines[4]).role, 'assistant');
  });

  it('--continue без файлов сессий: exit 1, stderr «Нет сохранённых сессий» (VL-95)', async () => {
    // Свежий пустой cwd — сессий нет ни в одном каталоге выше
    const emptyDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-empty-'));
    try {
      const { code, stdout, stderr } = await runCli(
        ['продолжи', '--continue', '--no-mcp'],
        llmEnv(),
        emptyDir
      );
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(stderr, /Нет сохранённых сессий/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('--continue берёт последнюю сессию cwd (VL-95)', async () => {
    llmRequests.length = 0;
    const { code } = await runCli(['И ещё раз', '--continue', '--no-mcp'], llmEnv());
    assert.equal(code, 0);
    const msgs = llmRequests[0].messages;
    // Последняя сессия — перезаписанная resume-тестом (5 сообщений) → history 4 + system + промпт
    assert.equal(msgs.length, 6);
    assert.equal(msgs.at(-1).content, 'И ещё раз');
  });

  it('VIBELOG_CWD: сессия пишется в главный репо, resume находит её оттуда (VL-107 fix)', async () => {
    // Симуляция branch-mode: cwd процесса — «worktree» (папка без .vibelog),
    // VIBELOG_CWD — «главный репо». Оркестратор задаёт env при запуске фазы
    // в git-worktree; resume reply бота идёт из главного cwd — сессия должна
    // лежать там же (инцидент agent-1791322227147).
    const mainDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-main-'));
    const wtDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-wt-'));
    try {
      const env = { ...llmEnv(), VIBELOG_CWD: mainDir };
      llmRequests.length = 0;
      const { code, stdout } = await runCli(['Запомни: worktree-сессия', '--no-mcp'], env, wtDir);
      assert.equal(code, 0);
      const parsed = JSON.parse(stdout.trim());
      // Файл сессии — в VIBELOG_CWD (главный репо), не в cwd процесса
      const mainFile = join(mainDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.jsonl`);
      assert.ok(existsSync(mainFile), `сессия должна быть в ${mainFile}`);
      assert.ok(
        !existsSync(join(wtDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.jsonl`)),
        'сессия не должна попадать в worktree-cwd'
      );
      // Resume из «главного cwd» (как reply бота) находит сессию
      llmRequests.length = 0;
      const resumed = await runCli(['Продолжи', '--resume', parsed.session_id, '--no-mcp'], llmEnv(), mainDir);
      assert.equal(resumed.code, 0);
      const rParsed = JSON.parse(resumed.stdout.trim());
      assert.equal(rParsed.session_id, parsed.session_id);
      // История дошла до LLM (system + user + assistant + новый промпт)
      assert.equal(llmRequests[0].messages.length, 4);
    } finally {
      rmSync(mainDir, { recursive: true, force: true });
      rmSync(wtDir, { recursive: true, force: true });
    }
  });

  it('--resume в режиме фазы: exit 1, подсказка (VL-95)', async () => {
    const { code, stderr } = await runCli(
      ['comment', 'VL-1', '--resume', 'agent-1', '--no-mcp'],
      llmEnv()
    );
    assert.equal(code, 1);
    assert.match(stderr, /только с готовым промптом/);
  });

  // ── VL-258: неизменный блок задачи в resume-промпте не дублируется ──

  /** Промпт с блоком задачи (форма templates/phases/*.md). */
  const phaseLikePrompt = (description) =>
    [
      'Ты — автоматический исполнитель Vibelog (Фаза 3: Code) для задачи VL-1.',
      '',
      'Задача (подставлена автоматически):',
      'ID: VL-1; тип: task; статус: Planned',
      `Описание: ${description}`,
      '',
      '## Шаги',
      '',
      '1. Реализуй план.',
    ].join('\n');

  it('resume: неизменный блок задачи заменён ссылкой (VL-258)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl258-'));
    try {
      const sessDir = join(projDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      const description = `длинное описание ${'данных '.repeat(200)}`;
      const transcript = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: phaseLikePrompt(description) },
        { role: 'assistant', content: 'Продолжаю' },
      ];
      const sessionId = 'agent-vl258-dedup';
      writeFileSync(
        join(sessDir, `${sessionId}.jsonl`),
        transcript.map((m) => JSON.stringify(m)).join('\n') + '\n',
        'utf-8'
      );
      writeFileSync(
        join(sessDir, `${sessionId}.meta.json`),
        JSON.stringify({ sessionId, phase: 'prompt', cwd: projDir }),
        'utf-8'
      );
      llmRequests.length = 0;
      const { code, stderr } = await runCli(
        [phaseLikePrompt(description), '--resume', sessionId, '--no-mcp'],
        llmEnv(),
        projDir
      );
      assert.equal(code, 0, stderr);
      assert.match(stderr, /блок задачи без изменений \(хэш [0-9a-f]{8}, строка 2\)/);
      const last = llmRequests[0].messages[llmRequests[0].messages.length - 1];
      assert.equal(last.role, 'user');
      assert.match(last.content, /Задача \(подставлена автоматически\): без изменений с рана 1/);
      assert.ok(!last.content.includes('данных данных данных'), 'тело блока не продублировано');
      assert.match(last.content, /## Шаги/, 'остальной промпт сохранён');
      // В jsonl дописана именно сокращённая строка (транскрипт читаем)
      const lines = readFileSync(join(sessDir, `${sessionId}.jsonl`), 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
      const appended = JSON.parse(lines[lines.length - 1]);
      assert.ok(!appended.content.includes('данных данных данных'));
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('resume: изменённый блок задачи остаётся полным (VL-258)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl258b-'));
    try {
      const sessDir = join(projDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      const sessionId = 'agent-vl258-full';
      writeFileSync(
        join(sessDir, `${sessionId}.jsonl`),
        [
          { role: 'system', content: 'sys' },
          { role: 'user', content: phaseLikePrompt('старое описание') },
          { role: 'assistant', content: 'Продолжаю' },
        ]
          .map((m) => JSON.stringify(m))
          .join('\n') + '\n',
        'utf-8'
      );
      writeFileSync(
        join(sessDir, `${sessionId}.meta.json`),
        JSON.stringify({ sessionId, phase: 'prompt', cwd: projDir }),
        'utf-8'
      );
      llmRequests.length = 0;
      const { code, stderr } = await runCli(
        [phaseLikePrompt('новое описание после plan'), '--resume', sessionId, '--no-mcp'],
        llmEnv(),
        projDir
      );
      assert.equal(code, 0, stderr);
      assert.match(stderr, /блок задачи изменён/);
      const last = llmRequests[0].messages[llmRequests[0].messages.length - 1];
      assert.match(last.content, /Описание: новое описание после plan/);
      assert.ok(!last.content.includes('без изменений с рана'));
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  // ── VL-96: системный промпт и AGENTS.md ──

  it('первое сообщение к LLM — role=system с базовым промптом (VL-96)', async () => {
    llmRequests.length = 0;
    const { code } = await runCli(['Проверь системный промпт'], llmEnv());
    assert.equal(code, 0);
    const first = llmRequests[0].messages?.[0];
    assert.equal(first?.role, 'system');
    assert.match(first?.content ?? '', /Vibelog-agent/);
  });

  it('AGENTS.md проекта подключается к системному промпту (VL-96)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-agentsmd-'));
    try {
      writeFileSync(join(projDir, 'AGENTS.md'), '# Правила проекта\nНе ломай сборку.', 'utf-8');
      llmRequests.length = 0;
      const { code } = await runCli(['Проверь AGENTS.md'], llmEnv(), projDir);
      assert.equal(code, 0);
      const first = llmRequests[0].messages?.[0];
      assert.equal(first?.role, 'system');
      assert.match(first?.content ?? '', /Не ломай сборку/);
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('лог stderr содержит «Системный промпт: N символов» (VL-96)', async () => {
    const { code, stderr } = await runCli(['Скажи ок'], llmEnv());
    assert.equal(code, 0);
    assert.match(stderr, /Системный промпт: \d+ символов \(AGENTS.md: (да|нет)\)/);
  });

  it('VL-209: лог старта фазы «Модель: <label> (<id>), api_mode: …» из settings.json', async () => {
    // Секции models/providers в testDir; env VIBELOG_LLM_MODEL убран —
    // источник модели ТОЛЬКО settings.json (models-путь)
    const env = llmEnv();
    delete env.VIBELOG_LLM_MODEL;
    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(testDir, '.vibelog', 'settings.json'),
      JSON.stringify({
        providers: { mockp: { base_url: `http://127.0.0.1:${mock.port}/v1`, api_key: 'test-key' } },
        models: {
          default: 'mockp/Test/Model',
          available: {
            'mockp/Test/Model': { label: 'Test Model', provider: 'mockp', model: 'test-model', api_mode: 'chat' },
          },
        },
      }),
      'utf-8'
    );
    try {
      const { code, stderr } = await runCli(['comment', 'VL-1', '--no-mcp', '--comment', 'лог модели'], env);
      assert.equal(code, 0);
      assert.match(stderr, /Модель: Test Model \(mockp\/Test\/Model\), api_mode: chat/);
    } finally {
      // иначе последующие тесты файла подхватят models-путь
      rmSync(join(testDir, '.vibelog', 'settings.json'), { force: true });
    }
  });

  // ── VL-103: инкрементальная запись jsonl и обрыв LLM-запроса ──

  it('jsonl дописывается инкрементально: на 2-м LLM-запросе файл уже содержит сообщения (VL-103)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl103-inc-'));
    try {
      let requestCount = 0;
      let capturedOnSecond = null;
      llmHandler = (body, res) => {
        requestCount++;
        if (requestCount === 2) {
          // Момент истины AC#3: на ВТОРОМ LLM-запросе jsonl уже существует
          // и содержит дописанные сообщения (не пустой файл по завершении фазы)
          const dir = join(projDir, '.vibelog', 'agent-sessions');
          try {
            const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
            capturedOnSecond = files.length > 0 ? readFileSync(join(dir, files[0]), 'utf-8') : null;
          } catch { capturedOnSecond = null; }
        }
        if (requestCount === 1) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: 'echo vl103-incremental' }) } }] } }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'второй ответ готов' } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      };
      const { code, stdout } = await runCli(['Сделай echo', '--no-mcp'], llmEnv(), projDir);
      assert.equal(code, 0, stdout);
      assert.equal(requestCount, 2, 'должны быть 2 LLM-запроса (tool_calls + финал)');
      assert.ok(capturedOnSecond, 'на 2-м запросе jsonl должен существовать');
      const capturedRoles = capturedOnSecond.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).role);
      // Доказательство инкрементальности: system, user, assistant(tool_calls)
      // и tool дописаны ДО завершения фазы — файл читался мок-LM во время
      // 2-го запроса (стартовая запись + onMessage, VL-103)
      assert.deepEqual(capturedRoles, ['system', 'user', 'assistant', 'tool']);
      // Финальный файл завершён: + финальный assistant = 5
      const finalFile = join(projDir, '.vibelog', 'agent-sessions', `${JSON.parse(stdout.trim()).session_id}.jsonl`);
      const finalLines = readFileSync(finalFile, 'utf-8').split('\n').filter((l) => l.trim());
      assert.equal(finalLines.length, 5);
      assert.equal(JSON.parse(finalLines.at(-1)).role, 'assistant');
    } finally {
      llmHandler = null;
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('обрыв стрима mid-body (terminated): non-stream фолбэк, jsonl завершён (VL-103)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl103-sock-'));
    try {
      let streamCount = 0;
      llmHandler = (body, res) => {
        if (body && body.stream) {
          streamCount++;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'частичный' } }] })}\n\n`);
          // Обрыв mid-body: сервер рвёт соединение до конца SSE — клиент
          // получит terminated/ECONNRESET при чтении тела (кейс VL-103)
          res.socket?.destroy();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { content: 'из non-stream фолбэка' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }));
      };
      const { code, stdout } = await runCli(['Запомни обрыв', '--no-mcp'], llmEnv(), projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.is_error, false);
      assert.equal(parsed.result, 'из non-stream фолбэка');
      assert.ok(streamCount >= 1, 'стрим-попытки должны были состояться');
      // jsonl завершён: system + user + финальный assistant (VL-103)
      const file = join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.jsonl`);
      const lines = readFileSync(file, 'utf-8').split('\n').filter((l) => l.trim());
      assert.equal(lines.length, 3);
      assert.equal(JSON.parse(lines[2]).role, 'assistant');
      assert.equal(JSON.parse(lines[2]).content, 'из non-stream фолбэка');
    } finally {
      llmHandler = null;
      rmSync(projDir, { recursive: true, force: true });
    }
  });
  // ── VL-122: интеграция — компакшн истории при --resume ──

  it('--resume длинной сессии: запрос усечён, jsonl полный, финал корректен (VL-122)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl122-'));
    try {
      // «Длинная» сессия: system + постановка + две пары assistant/user
      const sessDir = join(projDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      const transcript = [
        { role: 'system', content: 'sys-промпт' },
        { role: 'user', content: 'постановка задачи' },
        { role: 'assistant', content: 'ответ 1' },
        { role: 'user', content: 'вопрос 2' },
        { role: 'assistant', content: 'ответ 2' },
        { role: 'user', content: 'вопрос 3' },
      ];
      writeFileSync(
        join(sessDir, 'agent-vl122.jsonl'),
        transcript.map((m) => JSON.stringify(m)).join('\n') + '\n',
        'utf-8'
      );
      llmRequests.length = 0;
      let requestCount = 0;
      llmHandler = (body, res) => {
        requestCount++;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (requestCount === 1) {
          // Первый ответ: usage ≥ порога 100 + tool_calls → якорь компакшна
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: 'echo vl122' }) } }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 5, cache_read_input_tokens: 0, total_tokens: 905 } })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Готово' } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_input_tokens: 0, total_tokens: 15 } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      };
      const { code, stdout } = await runCli(
        ['Продолжи', '--resume', 'agent-vl122', '--no-mcp', '--compact-tail', '2', '--compact-at-tokens', '100'],
        llmEnv(),
        projDir
      );
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.is_error, false);
      assert.equal(parsed.result, 'Готово');
      // parseQwenResult (контракт оркестратора) парсит stdout
      assert.equal(parseQwenResult(stdout)?.result, 'Готово');
      // 1-й запрос — полная история (компакшн ещё не сработал):
      // system + 5 истории + новый промпт = 7
      assert.equal(llmRequests[0].messages.length, 7);
      // 2-й запрос — усечённая wire-копия с служебной заметкой
      const wire = llmRequests[1].messages;
      assert.equal(wire[0].role, 'system');
      assert.equal(wire[1].role, 'user');
      assert.match(wire[1].content, /постановка задачи/);
      assert.match(wire[1].content, /История усечена/);
      // Середина отсутствует, хвост (assistant(tool_calls) + tool) на месте
      assert.ok(!wire.some((m) => (m.content ?? '').includes('ответ 1')));
      assert.ok(!wire.some((m) => (m.content ?? '').includes('вопрос 2')));
      assert.equal(wire.at(-1).role, 'tool');
      // jsonl сессии — ПОЛНАЯ история и оканчивается assistant (VL-103/110)
      const lines = readFileSync(join(sessDir, 'agent-vl122.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
      // saveSession перезаписывает полным: 7 стартовых + assistant(tool_calls)
      // + tool + финальный assistant = 10
      assert.equal(lines.length, 10);
      assert.ok(lines.some((l) => l.includes('ответ 1')), 'полная история в jsonl');
      assert.equal(JSON.parse(lines.at(-1)).role, 'assistant');
      assert.equal(JSON.parse(lines.at(-1)).content, 'Готово');
    } finally {
      llmHandler = null;
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  // ── VL-110: метаданные сессии задачной фазы ──

  it('фаза пишет метаданные <id>.meta.json (taskId/phase/cwd) (VL-110)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-meta-'));
    try {
      // VL-137: фаза CLI не запускается без читаемой задачи — создаём VL-77
      mkdirSync(join(projDir, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(projDir, 'backlog', 'config.yml'), 'project_name: Meta Test\n', 'utf-8');
      createTaskFile(projDir, { id: 'VL-77', title: 'Задача меты сессии' });
      const { code, stdout } = await runCli(['comment', 'VL-77', '--no-mcp'], llmEnv(), projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.meta.json`), 'utf-8')
      );
      assert.equal(meta.taskId, 'VL-77');
      assert.equal(meta.phase, 'comment');
      // realpathSync: macOS /var — симлинк на /private/var, process.cwd() физический
      assert.equal(meta.cwd, realpathSync(projDir));
      // VL-253: исход рана в мете — finish_phase не доверяет явному tokenUsage,
      // если предыдущий ран упал. Успешный ран → is_error=false.
      assert.equal(meta.last_run?.is_error, false, 'last_run.is_error записывается в мету');
      assert.equal(typeof meta.last_run?.finishedAt, 'string', 'last_run.finishedAt записывается');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('VL-203 (AC1): stderr фазы содержит байты payload и usage; мета — last_payload_bytes', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-wirediag-'));
    try {
      mkdirSync(join(projDir, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(projDir, 'backlog', 'config.yml'), 'project_name: WireDiag Test\n', 'utf-8');
      createTaskFile(projDir, { id: 'VL-90', title: 'Задача wire-диагностики' });
      const { code, stdout, stderr } = await runCli(
        ['comment', 'VL-90', '--no-mcp', '--comment', 'диагностика'],
        llmEnv(),
        projDir,
      );
      assert.equal(code, 0, stdout);
      // AC1: итоговая строка диагностики в stderr → logTail оркестратора
      assert.match(stderr, /payload последнего запроса=\d+ байт/, 'байты payload последнего запроса');
      assert.match(stderr, /usage=\{.*input_tokens.*\}/, 'usage по фазе в строке диагностики');
      // AC1 VL-221: обе метрики рядом — requests (LLM-ходы) и tool-calls рана
      assert.match(stderr, /фаза: запросов=\d+/, 'число LLM-запросов фазы');
      assert.match(stderr, /tool-calls=\d+ \(лимит \d+, счётчик рана/, 'tool-calls рана с лимитом');
      // AC3: JSONL-мета фиксирует размер тела запроса
      const parsed = JSON.parse(stdout.trim());
      // AC1 VL-221: в JSON-результате поле tool_calls_total (рядом с num_turns)
      assert.equal(typeof parsed.tool_calls_total, 'number', 'tool_calls_total в JSON-результате');
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.meta.json`), 'utf-8'),
      );
      assert.equal(typeof meta.last_payload_bytes, 'number', 'last_payload_bytes в метe');
      assert.ok(meta.last_payload_bytes > 0, 'payload > 0');
      assert.equal(typeof meta.max_payload_bytes, 'number', 'max_payload_bytes в метe');
      assert.ok(meta.max_payload_bytes >= meta.last_payload_bytes, 'max >= last');
      // AC3: JSONL-транскрипт — usage по ходам + payload_bytes/shrink_level
      const lines = readFileSync(
        join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.jsonl`), 'utf-8',
      ).trim().split('\n');
      const assistant = lines.map((l) => JSON.parse(l)).find((m) => m.role === 'assistant' && m.usage);
      assert.ok(assistant, 'assistant с usage в jsonl');
      assert.equal(typeof assistant.payload_bytes, 'number', 'payload_bytes по ходу');
      assert.equal(assistant.shrink_level, 0, 'уровень компакшна tool-выводов');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('VL-217 (AC1): пустой финал дважды → stderr-строка «пустой финал» с payload/usage, is_error', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl217-'));
    try {
      mkdirSync(join(projDir, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(projDir, 'backlog', 'config.yml'), 'project_name: VL217 Test\n', 'utf-8');
      createTaskFile(projDir, { id: 'VL-91', title: 'Задача пустого финала' });
      // Мок-LM отвечает пустым content на КАЖДЫЙ запрос: первый пустой финал
      // → один повтор (VL-217), второй пустой → fail с диагностикой
      let requestCount = 0;
      llmHandler = (_body, res) => {
        requestCount++;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      };
      const { code, stdout, stderr } = await runCli(
        ['comment', 'VL-91', '--no-mcp', '--comment', 'диагностика пустоты'],
        llmEnv(),
        projDir,
      );
      // AC2: повторная пустота → fail (exit 1, is_error), ровно 2 запроса
      assert.equal(code, 1, stdout);
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.is_error, true);
      assert.equal(requestCount, 2, 'ровно один повтор запроса');
      assert.match(parsed.result, /Пустой ответ модели/);
      // AC1: обе попытки зафиксированы в stderr → logTail оркестратора
      // (по образцу строки VL-203: payload + usage в stderr фазы)
      assert.match(stderr, /пустой финал \(попытка 1\)/, stderr);
      assert.match(stderr, /пустой финал \(попытка 2\)/, stderr);
      assert.match(stderr, /payload=.*байт/, 'payload в диагностике');
      assert.match(stderr, /usage=\{/, 'usage в диагностике');
      assert.match(stderr, /сообщений=\d+/, 'число сообщений в диагностике');
    } finally {
      llmHandler = null;
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('готовый промпт (без фазы) мету не создаёт (VL-110)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-meta0-'));
    try {
      const { code, stdout } = await runCli(['Просто запрос', '--no-mcp'], llmEnv(), projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      const dir = join(projDir, '.vibelog', 'agent-sessions');
      assert.ok(existsSync(join(dir, `${parsed.session_id}.jsonl`)), 'jsonl создаётся');
      assert.ok(!existsSync(join(dir, `${parsed.session_id}.meta.json`)), 'мета не создаётся');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });
  // ── VL-114: мета по env оркестратора (боевой путь спавна) ──

  it('env-путь: готовый промпт + VIBELOG_PHASE_TASK_ID → мета пишется (VL-114)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-metaenv-'));
    try {
      const env = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'vl-88', VIBELOG_PHASE_NAME: 'code' };
      const { code, stdout } = await runCli(['Просто запрос', '--no-mcp'], env, projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.meta.json`), 'utf-8')
      );
      assert.equal(meta.taskId, 'VL-88', 'taskId нормализован в верхний регистр');
      assert.equal(meta.phase, 'code');
      // realpathSync: macOS /var — симлинк на /private/var, process.cwd() физический
      assert.equal(meta.cwd, realpathSync(projDir));
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('env-путь: resume не перезаписывает мету (VL-114)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-metares-'));
    try {
      const env = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'vl-88', VIBELOG_PHASE_NAME: 'code' };
      const first = await runCli(['Просто запрос', '--no-mcp'], env, projDir);
      assert.equal(first.code, 0, first.stdout);
      const sid = JSON.parse(first.stdout.trim()).session_id;
      const metaPath = join(projDir, '.vibelog', 'agent-sessions', `${sid}.meta.json`);
      // Ставим маркер — resume обязан оставить мету как есть
      writeFileSync(metaPath, JSON.stringify({ taskId: 'VL-OLD', phase: 'x', cwd: 'old' }), 'utf-8');
      const second = await runCli(['Продолжи', '--resume', sid, '--no-mcp'], env, projDir);
      assert.equal(second.code, 0, second.stdout);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(meta.taskId, 'VL-OLD', 'мета resume-сессии не перезаписана');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });
  // ── VL-118: префикс env-пути — из конфига проекта ──

  it('env-путь: префикс конфига проекта (ot) пишет мету (VL-118)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-otprefix-'));
    try {
      mkdirSync(join(projDir, 'backlog'), { recursive: true });
      writeFileSync(
        join(projDir, 'backlog', 'config.yml'),
        'project_name: OT Env\ntask_prefix: ot\n',
        'utf-8'
      );
      const env = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'ot-7', VIBELOG_PHASE_NAME: 'code' };
      const { code, stdout } = await runCli(['Просто запрос', '--no-mcp'], env, projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.meta.json`), 'utf-8')
      );
      assert.equal(meta.taskId, 'OT-7', 'мета пишется по префиксу конфига проекта');
      assert.equal(meta.phase, 'code');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('env-путь: без конфига проекта чужой id не пишет мету (VL-118)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-noprefix-'));
    try {
      // projDir без backlog — дефолтный префикс VL, weird-7 отфильтрован
      const env = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'weird-7', VIBELOG_PHASE_NAME: 'code' };
      const { code, stdout } = await runCli(['Просто запрос', '--no-mcp'], env, projDir);
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      const metaPath = join(projDir, '.vibelog', 'agent-sessions', `${parsed.session_id}.meta.json`);
      assert.ok(!existsSync(metaPath), 'без конфига фильтр VL отсекает чужие id');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  // ── VL-243: billing пишет фазу РАНА; close учитывается как любая фаза ──

  it('env-путь close: мета phase=close и запись billing с phase=close (VL-243)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-billclose-'));
    try {
      mkdirSync(join(projDir, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(projDir, 'backlog', 'config.yml'), 'project_name: Bill Close\n', 'utf-8');
      createTaskFile(projDir, { id: 'VL-88', title: 'Задача billing close' });
      const env = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'VL-88', VIBELOG_PHASE_NAME: 'close' };
      const { code, stdout } = await runCli(['Просто запрос', '--no-mcp'], env, projDir);
      assert.equal(code, 0, stdout);
      const sid = JSON.parse(stdout.trim()).session_id;
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${sid}.meta.json`), 'utf-8')
      );
      assert.equal(meta.taskId, 'VL-88');
      assert.equal(meta.phase, 'close', 'close-сессия получает мету (раньше её не было вовсе)');
      // инвариант задачи: ран close оставляет запись billing
      const bill = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'billing', 'VL-88.json'), 'utf-8')
      );
      assert.equal(bill.sessions.length, 1);
      assert.equal(bill.sessions[0].phase, 'close', 'фаза рана = close');
      assert.equal(bill.sessions[0].sessionId, sid);
      assert.equal(bill.sessions[0].fallback, undefined, 'CLI-запись не fallback');
      assert.equal(meta.billing_recorded?.sessionId, sid, 'маркер записи в billing');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('resume-ран: billing пишет фазу рана + sessionPhase, мета не перезаписана (VL-243/lesson-40)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-billres-'));
    try {
      mkdirSync(join(projDir, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(projDir, 'backlog', 'config.yml'), 'project_name: Bill Resume\n', 'utf-8');
      createTaskFile(projDir, { id: 'VL-88', title: 'Задача billing resume' });
      // Первый ран — фаза plan в env-пути
      const planEnv = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'VL-88', VIBELOG_PHASE_NAME: 'plan' };
      const first = await runCli(['Просто запрос', '--no-mcp'], planEnv, projDir);
      assert.equal(first.code, 0, first.stdout);
      const sid = JSON.parse(first.stdout.trim()).session_id;
      // Resume тем же env, но фазой code (аналог code_same_session)
      const codeEnv = { ...llmEnv(), VIBELOG_PHASE_TASK_ID: 'VL-88', VIBELOG_PHASE_NAME: 'code' };
      const second = await runCli(['Продолжи', '--resume', sid, '--no-mcp'], codeEnv, projDir);
      assert.equal(second.code, 0, second.stdout);
      const meta = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'agent-sessions', `${sid}.meta.json`), 'utf-8')
      );
      assert.equal(meta.phase, 'plan', 'фаза сессии не перезаписана resume-раном (lesson-40)');
      const bill = JSON.parse(
        readFileSync(join(projDir, '.vibelog', 'billing', 'VL-88.json'), 'utf-8')
      );
      assert.equal(bill.sessions.length, 2, 'два рана — две записи');
      assert.equal(bill.sessions[0].phase, 'plan');
      assert.equal(bill.sessions[0].sessionPhase, undefined, 'у первого рана фаза = фаза сессии');
      // Ключевое: code-ран больше не «маскируется» под plan
      assert.equal(bill.sessions[1].phase, 'code', 'фаза рана = code');
      assert.equal(bill.sessions[1].sessionPhase, 'plan', 'фаза сессии — в sessionPhase');
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });

  it('--resume отравленного jsonl: wire уходит валидным, фаза выполняется (VL-216)', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-vl216-'));
    try {
      // Отравленная сессия старых jsonl (VL-214): пара assistant(tool_calls
      // id:"" name:"") + tool(tool_call_id:"") — до VL-216 тело уходило
      // провайдеру отравленным
      const sessDir = join(projDir, '.vibelog', 'agent-sessions');
      mkdirSync(sessDir, { recursive: true });
      const transcript = [
        { role: 'system', content: 'sys-промпт' },
        { role: 'user', content: 'постановка' },
        { role: 'assistant', content: null, tool_calls: [{ id: '', name: '', arguments: {} }] },
        { role: 'tool', tool_call_id: '', content: 'фантомный результат' },
        { role: 'user', content: 'вопрос после отравления' },
      ];
      writeFileSync(
        join(sessDir, 'agent-vl216-poison.jsonl'),
        transcript.map((m) => JSON.stringify(m)).join('\n') + '\n',
        'utf-8'
      );
      llmRequests.length = 0;
      const { code, stdout } = await runCli(
        ['Продолжи', '--resume', 'agent-vl216-poison', '--no-mcp'],
        llmEnv(),
        projDir
      );
      assert.equal(code, 0, stdout);
      const parsed = JSON.parse(stdout.trim());
      // Фаза выполняется дальше: успех, а НЕ guard VL-110/ошибка провайдера
      assert.equal(parsed.is_error, false, `фаза должна пройти: ${stdout.slice(0, 300)}`);
      assert.equal(parsed.result, 'Готово');
      // Тело первого wire-запроса валидно: пустых ключей нет
      assert.ok(llmRequests.length >= 1, 'запрос к мок-LM должен уйти');
      const wire = JSON.stringify(llmRequests[0].messages);
      assert.ok(!wire.includes('"tool_call_id":""'),
        'tool с пустым tool_call_id ушёл провайдеру: ' + wire.slice(0, 400));
      assert.ok(!wire.includes('"id":""'),
        'tool_call с пустым id ушёл провайдеру: ' + wire.slice(0, 400));
      // Отравленная пара не попала в wire вообще (content=null → вырезка)
      assert.ok(!llmRequests[0].messages.some((m) => m.role === 'assistant' && m.tool_calls),
        'assistant(tool_calls) из отравленной пары не должен попадать в wire');
      // Новый промпт и валидная user-история сохранены (санация не вырезает user)
      assert.ok(llmRequests[0].messages.some((m) => m.content === 'постановка'));
      assert.ok(llmRequests[0].messages.some((m) => m.content === 'вопрос после отравления'));
    } finally {
      rmSync(projDir, { recursive: true, force: true });
    }
  });
});
