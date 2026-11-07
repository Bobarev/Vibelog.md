/**
 * Тесты VL-363 — CLI `vibelog upstream report`.
 *
 * Проверяет коды выхода (AC8): 1 — использование, 2 — конфиг не настроен,
 * 4 — нет токена, 0 — успех (на локальном `node:http`-фикстуре).
 * CLI идёт тем же кодом ядра, что MCP-инструмент (`reportBug`), поэтому
 * проверяется именно маршрутизация и коды, а не формат тела issue.
 *
 * Тестовый каталог — mkdtempSync (VL-241); env для spawn — testSpawnEnv (VL-286).
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

let server;
let port = 0;
let handler;
const tmpDirs = [];

/** Временный проект с backlog/config.yml и (опционально) секцией upstream. */
function makeProject(settings, env) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-upstream-cli-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    'project_name: Upstream CLI Test\ntask_prefix: ui\ndefault_status: To Do\nstatuses:\n  - To Do\n  - Done\n',
    'utf-8',
  );
  if (settings !== undefined) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  }
  if (env !== undefined) writeFileSync(join(dir, '.env'), env, 'utf-8');
  return dir;
}

/**
 * Запуск CLI в каталоге проекта; возвращает {code, out}.
 *
 * Асинхронный spawn, а не spawnSync: HTTP-фикстура живёт в ЭТОМ же процессе,
 * и синхронный вызов заблокировал бы event loop — сервер не ответил бы,
 * процесс повис бы до таймаута.
 */
function runCli(cwd, ...args) {
  return new Promise((resolve) => {
    const env = testSpawnEnv({ VIBELOG_GITVERSE_API_BASE: `http://127.0.0.1:${port}` });
    // GITVERSE_TOKEN из окружения агентской сессии ломает тест «нет токена»:
    // CLI читает shell env раньше .env, и вместо кода 4 приходит 3. Тест
    // должен видеть только тот токен, который сам положил в .env (VL-367).
    delete env.GITVERSE_TOKEN;
    const child = spawn('node', [cliPath, ...args], { cwd, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
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
  handler = (_req, res) => {
    res.writeHead(500);
    res.end('no handler');
  };
});

afterEach(() => {
  // ничего: env передаётся в spawn явно
});

describe('VL-363 — vibelog upstream report', () => {
  it('без --title → код 1 (использование)', async () => {
    const dir = makeProject({ upstream: { repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report');
    assert.equal(code, 1);
    assert.match(out, /--title/);
  });

  it('неизвестный флаг → код 1', async () => {
    const dir = makeProject({ upstream: { repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'x', '--nope', 'y');
    assert.equal(code, 1);
    assert.match(out, /неизвестный флаг/);
  });

  it('нет секции upstream → код 2 (конфиг)', async () => {
    const dir = makeProject({});
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Баг');
    assert.equal(code, 2);
    assert.match(out, /upstream/);
  });

  it('нет токена → код 4', async () => {
    const dir = makeProject({ upstream: { repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Баг');
    assert.equal(code, 4);
    assert.match(out, /GITVERSE_TOKEN/);
  });

  it('успешный репорт → код 0 и номер issue', async () => {
    const dir = makeProject(
      { upstream: { repo: 'bobarev/Vibelog.md', labels: ['upstream'], type: 'bug' } },
      'GITVERSE_TOKEN=gv_cli_token_abcdef\n',
    );
    handler = (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ name: 'upstream' }]));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ number: 44, id: 44, html_url: 'https://gitverse.ru/bobarev/Vibelog.md/issues/44' }));
    };
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Баг из ui', '--body', 'описание', '--json');
    assert.equal(code, 0, out);
    const ack = JSON.parse(out.slice(out.indexOf('{')));
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.number, 44);
    assert.ok(!out.includes('gv_cli_token_abcdef'), 'токен не должен попадать в вывод');
  });

  it('справка команды доступна через --help', async () => {
    const dir = makeProject({});
    const { code, out } = await runCli(dir, 'upstream', '--help');
    assert.equal(code, 0);
    assert.match(out, /upstream report/);
    assert.match(out, /GITVERSE_TOKEN/);
  });
});
