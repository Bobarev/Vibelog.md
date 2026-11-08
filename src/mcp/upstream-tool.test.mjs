/**
 * Тесты VL-363 — MCP-инструмент `upstream_report_bug`.
 *
 * Проверяет: инструмент зарегистрирован в `listTools()`, объявлен как `write`
 * в `TOOL_KINDS` (иначе падает паритет `tool-classify.test.mjs`), успешный
 * вызов возвращает JSON-ack `ok:true` с номером issue, ошибка конфига —
 * `ok:false` с подсказкой.
 *
 * Сети нет: локальный `node:http`-сервер на порту 0, база подставляется через
 * `VIBELOG_GITVERSE_API_BASE`. Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { API_BASE_ENV, GITVERSE_TOKEN_ENV } from '../../dist/core/gitverse-issues.js';
import { clearPhaseEnv } from '../test-env.mjs';

const TOKEN = 'gv_mcp_token_abcdef123456';

let server;
let port = 0;
let handler;
let hits = 0;
const tmpDirs = [];

/** Фазовый env агентской сессии на время файла (VL-374, in-process handleToolCall). */
let restorePhaseEnv;

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
  // VL-374: фазовый env агентской сессии снимается на время файла —
  // in-process handleToolCall иначе наследует фазу рана.
  restorePhaseEnv = clearPhaseEnv();
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
  restorePhaseEnv();
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
    for (const field of ['title', 'body', 'severity', 'area', 'source_task', 'labels']) {
      assert.ok(field in tool.inputSchema.properties, `поле ${field} отсутствует в схеме`);
    }
  });

  it('объявлен как write в TOOL_KINDS (паритет tool-classify)', () => {
    assert.equal(TOOL_KINDS.upstream_report_bug, 'write');
    assert.equal(isWriteOperation('upstream_report_bug'), true);
  });
});

describe('VL-363 — вызов upstream_report_bug', () => {
  it('успешный вызов возвращает ok:true с номером issue', async () => {
    const dir = makeProject(
      { upstream: { repo: 'bobarev/Vibelog.md', labels: ['upstream', 'from-ui'], type: 'bug' } },
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

  it('нет секции upstream → ok:false с подсказкой', async () => {
    const dir = makeProject({}, `${GITVERSE_TOKEN_ENV}=${TOKEN}\n`);
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: 'Баг' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /upstream/);
    assert.equal(hits, 0, 'сетевых запросов быть не должно');
  });

  it('нет токена → ok:false с подсказкой про .env', async () => {
    const dir = makeProject({ upstream: { repo: 'a/b' } });
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: 'Баг' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /GITVERSE_TOKEN/);
    assert.match(ack.hint ?? '', /GITVERSE_TOKEN/);
  });

  it('пустой title → ok:false без сетевого запроса', async () => {
    const dir = makeProject({ upstream: { repo: 'a/b' } }, `${GITVERSE_TOKEN_ENV}=${TOKEN}\n`);
    const ack = JSON.parse(await handleToolCall('upstream_report_bug', { title: '  ' }, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.error, /title/);
    assert.equal(hits, 0);
  });
});
