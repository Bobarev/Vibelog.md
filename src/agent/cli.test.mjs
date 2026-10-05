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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQwenResult } from '../../dist/web/qwen-result.js';
import { parseArgs } from '../../dist/agent/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'dist', 'agent', 'cli.js');

let testDir;
let mock;
/** Тела запросов к мок-LM (для проверки собранного промпта). */
const llmRequests = [];

/** Мок-LM: SSE-ответ с фиксированным текстом и usage. */
function startMockLlm(finalText) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { llmRequests.push(JSON.parse(body)); } catch { /* не-JSON — не важно */ }
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
  return {
    ...process.env,
    VIBELOG_LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
    VIBELOG_LLM_API_KEY: 'test-key',
    VIBELOG_LLM_MODEL: 'test-model',
  };
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
  before(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'vibelog-agent-cli-'));
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Agent Test\n', 'utf-8');
    mock = await startMockLlm('Готово');
  });

  after(async () => {
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
    assert.equal(lines.length, 2, 'user + финальный assistant');
    assert.equal(JSON.parse(lines[0]).content, 'Запомни: синий кот');
    assert.equal(JSON.parse(lines[1]).role, 'assistant');
    assert.equal(JSON.parse(lines[1]).content, 'Готово');
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
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].content, 'Запомни: синий кот');
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[2].content, 'А теперь продолжи');
    // Файл сессии перезаписан: 2 старых + user + финальный assistant = 4
    const lines = readFileSync(join(testDir, '.vibelog', 'agent-sessions', `${sessionId}.jsonl`), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    assert.equal(lines.length, 4);
    assert.equal(JSON.parse(lines[2]).content, 'А теперь продолжи');
    assert.equal(JSON.parse(lines[3]).role, 'assistant');
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
    // Последняя сессия — перезаписанная resume-тестом (4 сообщения) + новый промпт
    assert.equal(msgs.length, 5);
    assert.equal(msgs.at(-1).content, 'И ещё раз');
  });

  it('--resume в режиме фазы: exit 1, подсказка (VL-95)', async () => {
    const { code, stderr } = await runCli(
      ['comment', 'VL-1', '--resume', 'agent-1', '--no-mcp'],
      llmEnv()
    );
    assert.equal(code, 1);
    assert.match(stderr, /только с готовым промптом/);
  });
});
