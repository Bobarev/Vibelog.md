/**
 * Тесты VL-363/VL-375 — MCP-инструмент `upstream_report_bug`.
 *
 * Проверяет: инструмент зарегистрирован в `listTools()`, объявлен как `write`
 * в `TOOL_KINDS` (иначе падает паритет `tool-classify.test.mjs`), успешный
 * вызов возвращает JSON-ack, ошибка конфига — `ok:false` с подсказкой.
 * VL-375: условная видимость в `tools/list` (живой MCP-сервер) и ветвление
 * по `upstream.mode` (git-инбокс / GitVerse Issues).
 *
 * Сети нет: локальный `node:http`-сервер на порту 0 (mode api), git-фикстура
 * во временном каталоге (mode git). Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { API_BASE_ENV, GITVERSE_TOKEN_ENV } from '../../dist/core/gitverse-issues.js';
import { INBOX_DIR } from '../../dist/core/upstream-git.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

const TOKEN = 'gv_mcp_token_abcdef123456';

let server;
let port = 0;
let handler;
let hits = 0;
const tmpDirs = [];

/** Временный проект с backlog/config.yml и (опционально) секцией upstream. */
function makeProject(settings, env) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-upstream-tool-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    'project_name: Upstream Tool Test\ntask_prefix: ui\ndefault_status: To Do\nstatuses:\n  - To Do\n  - Done\n',
    'utf-8',
  );
  if (settings !== undefined) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  }
  if (env !== undefined) writeFileSync(join(dir, '.env'), env, 'utf-8');
  return dir;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    hits += 1;
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => handler(req, res));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
});

afterAll(async () => {
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  hits = 0;
  handler = (_req, res) => {
    res.writeHead(500);
    res.end('no handler');
  };
  process.env[API_BASE_ENV] = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  delete process.env[API_BASE_ENV];
  delete process.env[GITVERSE_TOKEN_ENV];
});

describe('VL-363 — регистрация upstream_report_bug', () => {
  it('инструмент есть в listTools() и требует title', () => {
    const tool = listTools().find((t) => t.name === 'upstream_report_bug');
    assert.ok(tool, 'upstream_report_bug не зарегистрирован в реестре MCP');
    assert.deepEqual(tool.inputSchema.required, ['title']);
    for (const field of ['title', 'target', 'body', 'severity', 'area', 'source_task', 'labels']) {
      assert.ok(field in tool.inputSchema.properties, `поле ${field} отсутствует в схеме`);
    }
  });

  it('объявлен как write в TOOL_KINDS (паритет tool-classify)', () => {
    assert.equal(TOOL_KINDS.upstream_report_bug, 'write');
    assert.equal(isWriteOperation('upstream_report_bug'), true);
  });
});

// ============================================================
// VL-375 — условная видимость в tools/list (живой MCP-сервер)
// ============================================================

/**
 * Запускает MCP-сервер в каталоге проекта и возвращает имена instruments
 * из `tools/list` (или весь ответ, если сервер упал).
 *
 * Отдельный процесс на кейс: видимость зависит от cwd сервера (наличие
 * валидной секции upstream в .vibelog/settings.json).
 */
function toolsListNames(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, 'mcp', 'start'], {
      cwd,
      env: testSpawnEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP: нет ответа tools/list за 10 с'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2 && Array.isArray(msg.result?.tools)) {
          clearTimeout(timer);
          const names = msg.result.tools.map((t) => t.name);
          child.stdin.end();
          child.kill();
          resolve(names);
          return;
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  });
}

describe('VL-375 — видимость upstream_report_bug в tools/list', () => {
  it('AC7: без секции upstream инструмента в списке нет', async () => {
    const dir = makeProject({});
    const names = await toolsListNames(dir);
    assert.ok(names.includes('backlog_create_task'), 'остальные инструменты на месте');
    assert.ok(!names.includes('upstream_report_bug'), 'ненастроенный инструмент скрыт');
  });

  it('AC7: с валидной секцией (mode git + inbox) инструмент есть', async () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: '/tmp/nowhere.git', prefix: 'ui' } });
    const names = await toolsListNames(dir);
    assert.ok(names.includes('upstream_report_bug'), 'настроенный инструмент виден');
  });

  it('AC7: mode api + repo тоже даёт видимость', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const names = await toolsListNames(dir);
    assert.ok(names.includes('upstream_report_bug'));
  });

  it('AC7/AC8: невалидная секция (mode git без inbox) → инструмента нет', async () => {
    const dir = makeProject({ upstream: { mode: 'git', prefix: 'ui' } });
    const names = await toolsListNames(dir);
    assert.ok(!names.includes('upstream_report_bug'), 'fail-closed: нет inbox — нет инструмента');
  });

  it('AC8: битый settings.json → инструмента нет', async () => {
    const dir = makeProject(undefined);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), '{ битый', 'utf-8');
    const names = await toolsListNames(dir);
    assert.ok(!names.includes('upstream_report_bug'));
  });
});

describe('VL-363 — вызов upstream_report_bug', () => {
  it('успешный вызов возвращает ok:true с номером issue', async () => {
    const dir = makeProject(
      { upstream: { mode: 'api', repo: 'bobarev/Vibelog.md', labels: ['upstream', 'from-ui'], type: 'bug' } },
      `${GITVERSE_TOKEN_ENV}=${TOKEN}\n`,
    );
    handler = (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ name: 'upstream' }, { name: 'from-ui' }]));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ number: 33, id: 33, html_url: 'https://gitverse.ru/bobarev/Vibelog.md/issues/33' }));
    };

    const out = await handleToolCall(
      'upstream_report_bug',
      { title: 'Кнопка не работает', body: 'при клике ничего', severity: 'high', area: 'web', source_task: 'UI-7' },
      dir,
    );
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.number, 33);
    assert.equal(ack.applied.url, 'https://gitverse.ru/bobarev/Vibelog.md/issues/33');
    assert.deepEqual(ack.applied.labels, ['upstream', 'from-ui']);
    assert.match(ack.message, /Issue #33/);
    assert.ok(!out.includes(TOKEN), 'токен не должен попадать в ack');
  });

  it('нет секции upstream → ok:false с подсказкой про settings.json (AC8)', async () => {
    const dir = makeProject({}, `${GITVERSE_TOKEN_ENV}=${TOKEN}\n`);
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: 'Баг', target: 'vl' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /upstream/);
    assert.match(ack.hint ?? '', /\.vibelog\/settings\.json/, 'подсказка куда добавить секцию');
    assert.ok(!/Неизвестный инструмент/.test(ack.error), 'не «неизвестный инструмент»');
    assert.equal(hits, 0, 'сетевых запросов быть не должно');
  });

  it('VL-375 AC6: mode git — отчёт уходит в git-инбокс, не в сеть', async () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: '', prefix: 'ui' } });
    // битый конфиг: inbox пуст — понятная ошибка конфига
    const bad = JSON.parse(await handleToolCall('upstream_report_bug', { title: 'Баг', target: 'vl' }, dir));
    assert.equal(bad.ok, false);
    // fail-closed: секция без inbox не считается настроенной — подсказка ведёт к полю inbox
    assert.match(bad.error, /upstream/);
    assert.match(bad.hint ?? '', /inbox/);
    assert.equal(hits, 0);
  });

  it('VL-375 AC6: mode git с валидным inbox пишет отчёт (локальный bare-репозиторий)', async () => {
    const dir = makeProject(undefined);
    const remote = join(dir, 'inbox.git');
    execFileSync('/usr/bin/git', ['init', '-q', '--bare', remote]);
    const seed = join(dir, 'seed');
    mkdirSync(seed, { recursive: true });
    execFileSync('/usr/bin/git', ['init', '-q'], { cwd: seed });
    execFileSync('/usr/bin/git', ['config', 'user.email', 't@e.com'], { cwd: seed });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'T'], { cwd: seed });
    writeFileSync(join(seed, 'README.md'), '# Inbox\n', 'utf8');
    execFileSync('/usr/bin/git', ['add', 'README.md'], { cwd: seed });
    execFileSync('/usr/bin/git', ['commit', '-q', '-m', 'init'], { cwd: seed });
    execFileSync('/usr/bin/git', ['remote', 'add', 'origin', remote], { cwd: seed });
    execFileSync('/usr/bin/git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: seed });
    execFileSync('/usr/bin/git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(dir, '.vibelog', 'settings.json'),
      JSON.stringify({ upstream: { mode: 'git', inbox: remote, prefix: 'ui' } }, null, 2),
      'utf8',
    );

    const out = await handleToolCall(
      'upstream_report_bug',
      { title: 'Кнопка не работает', target: 'vl', source_task: 'UI-7', body: 'при клике ничего' },
      dir,
    );
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true, out);
    assert.match(ack.applied.path, /^reports\/ui\//);
    assert.equal(ack.applied.created, true);
    assert.equal(ack.applied.target, 'vl');
    const file = readFileSync(join(dir, INBOX_DIR, ack.applied.path), 'utf8');
    assert.match(file, /target: vl/);
    assert.match(file, /status: open/);
    assert.equal(hits, 0, 'git-транспорт не ходит в API');
  });

  it('нет токена → ok:false с подсказкой про .env', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: 'Баг' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /GITVERSE_TOKEN/);
    assert.match(ack.hint ?? '', /GITVERSE_TOKEN/);
  });

  it('пустой title → ok:false без сетевого запроса', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } }, `${GITVERSE_TOKEN_ENV}=${TOKEN}\n`);
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: '  ' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /title/);
    assert.equal(hits, 0);
  });
});
