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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQwenResult } from '../../dist/web/qwen-result.js';

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
function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: testDir,
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
});
