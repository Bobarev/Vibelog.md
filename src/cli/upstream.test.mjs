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
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // GITVERSE_TOKEN из shell-окружения снимается: тесты проверяют приоритет
    // `.env` и кейс «нет токена», а локальный токен разработчика (или
    // агентской сессии) иначе подменял бы ожидаемый код выхода 4 на 3 —
    // CLI читает shell env раньше `.env`, и тест должен видеть только тот
    // токен, который сам положил в `.env` (VL-367).
    const env = testSpawnEnv({ VIBELOG_GITVERSE_API_BASE: `http://127.0.0.1:${port}` });
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
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report');
    assert.equal(code, 1);
    assert.match(out, /--title/);
  });

  it('неизвестный флаг → код 1', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
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
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Баг');
    assert.equal(code, 4);
    assert.match(out, /GITVERSE_TOKEN/);
  });

  it('успешный репорт → код 0 и номер issue', async () => {
    const dir = makeProject(
      { upstream: { mode: 'api', repo: 'bobarev/Vibelog.md', labels: ['upstream'], type: 'bug' } },
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

  it('VL-375 AC5: mode api без токена → код 4', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Баг');
    assert.equal(code, 4, out);
    assert.match(out, /GITVERSE_TOKEN/);
  });

  it('VL-375 AC5: неизвестная подкоманда → код 1', async () => {
    const dir = makeProject({});
    const { code, out } = await runCli(dir, 'upstream', 'nope');
    assert.equal(code, 1, out);
    assert.match(out, /report, pull, ack/);
  });

  it('VL-375 AC5: pull без настроенного upstream → код 2', async () => {
    const dir = makeProject({});
    const { code, out } = await runCli(dir, 'upstream', 'pull');
    assert.equal(code, 2, out);
    assert.match(out, /settings\.json/);
  });

  it('VL-375 AC5: ack без --as → код 1', async () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: 'nowhere.git' } });
    const { code, out } = await runCli(dir, 'upstream', 'ack', 'abc');
    assert.equal(code, 1, out);
    assert.match(out, /--as/);
  });
});

// ============================================================
// VL-375 — git-транспорт через CLI (локальный bare-инбокс)
// ============================================================

/** Проект с git-инбоксом: bare-репозиторий + seed-коммит. */
function makeGitProject() {
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
  return { dir, remote };
}

describe('VL-375 — vibelog upstream (git-транспорт)', () => {
  it('AC5: report пишет отчёт, pull его видит, ack подтверждает', async () => {
    const { dir } = makeGitProject();

    const report = await runCli(
      dir, 'upstream', 'report',
      '--title', 'Кнопка не работает', '--target', 'vl', '--source-task', 'UI-7', '--body', 'описание', '--json',
    );
    assert.equal(report.code, 0, report.out);
    const ack = JSON.parse(report.out.slice(report.out.indexOf('{')));
    assert.equal(ack.ok, true);
    assert.match(ack.applied.path, /^reports\/ui\//);
    assert.equal(ack.applied.created, true);
    const inboxFile = join(dir, '.vibelog', 'upstream-inbox', ack.applied.path);
    assert.match(readFileSync(inboxFile, 'utf8'), /target: vl/);

    // отчёт адресован vl, у проекта префикс ui — во входящих его быть не должно
    const own = await runCli(dir, 'upstream', 'pull', '--json', '--no-fetch');
    assert.equal(own.code, 0, own.out);
    assert.equal(JSON.parse(own.out.slice(own.out.indexOf('{'))).applied.count, 0);

    // адресуем себе — появляется во входящих
    const self = await runCli(dir, 'upstream', 'report', '--title', 'Себе', '--target', 'ui', '--source-task', 'UI-8', '--json');
    assert.equal(self.code, 0, self.out);
    const pull = await runCli(dir, 'upstream', 'pull', '--json', '--no-fetch');
    assert.equal(pull.code, 0, pull.out);
    const incoming = JSON.parse(pull.out.slice(pull.out.indexOf('{')));
    assert.equal(incoming.applied.count, 1);
    const id = incoming.applied.reports[0].report_id;

    const acked = await runCli(dir, 'upstream', 'ack', id, '--as', 'VL-999', '--json', '--no-fetch');
    assert.equal(acked.code, 0, acked.out);
    const ackOut = JSON.parse(acked.out.slice(acked.out.indexOf('{')));
    assert.equal(ackOut.applied.status, 'accepted');
    assert.equal(ackOut.applied.accepted_as, 'VL-999');

    // после ack отчёт уходит из входящих (status !== open)
    const after = await runCli(dir, 'upstream', 'pull', '--json', '--no-fetch');
    assert.equal(JSON.parse(after.out.slice(after.out.indexOf('{'))).applied.count, 0);
  });

  it('AC5: report без --target в mode git → код 2 с подсказкой', async () => {
    const { dir } = makeGitProject();
    const { code, out } = await runCli(dir, 'upstream', 'report', '--title', 'Без адресата');
    assert.equal(code, 2, out);
    assert.match(out, /target/);
  });

  /** Пишет отчёт «себе» и возвращает его полный report_id. */
  async function reportToSelf(dir, title) {
    const res = await runCli(
      dir, 'upstream', 'report', '--title', title, '--target', 'ui', '--source-task', 'UI-9', '--json',
    );
    assert.equal(res.code, 0, res.out);
    const pull = await runCli(dir, 'upstream', 'pull', '--json', '--no-fetch');
    assert.equal(pull.code, 0, pull.out);
    const reports = JSON.parse(pull.out.slice(pull.out.indexOf('{'))).applied.reports;
    return reports.find((r) => r.title === title).report_id;
  }

  it('VL-388 AC1: ack принимает 8 символов report_id, которые печатает pull', async () => {
    const { dir } = makeGitProject();
    const fullId = await reportToSelf(dir, 'Префикс из pull');
    const shortId = fullId.slice(0, 8);
    const acked = await runCli(dir, 'upstream', 'ack', shortId, '--as', 'VL-388', '--json', '--no-fetch');
    assert.equal(acked.code, 0, acked.out);
    const ackOut = JSON.parse(acked.out.slice(acked.out.indexOf('{')));
    assert.equal(ackOut.applied.status, 'accepted');
    assert.equal(ackOut.applied.accepted_as, 'VL-388');
  });

  it('VL-388 AC5: неверный формат --as → код 1 с примером корректного значения', async () => {
    const { dir } = makeGitProject();
    const fullId = await reportToSelf(dir, 'Неверный --as');
    const bad = await runCli(dir, 'upstream', 'ack', fullId, '--as', 'VL_388', '--no-fetch');
    assert.equal(bad.code, 1, bad.out);
    assert.match(bad.out, /VL-367/);
  });

  it('VL-388 AC5: пустой --as → код 1', async () => {
    const { dir } = makeGitProject();
    const fullId = await reportToSelf(dir, 'Пустой --as');
    const empty = await runCli(dir, 'upstream', 'ack', fullId, '--as', '', '--no-fetch');
    assert.equal(empty.code, 1, empty.out);
    assert.match(empty.out, /--as/);
  });

  it('VL-388 AC6: чужой префикс в --as допустим (backlog получателя недоступен)', async () => {
    const { dir } = makeGitProject();
    const fullId = await reportToSelf(dir, 'Чужой префикс');
    const acked = await runCli(dir, 'upstream', 'ack', fullId, '--as', 'UI-444', '--json', '--no-fetch');
    assert.equal(acked.code, 0, acked.out);
    assert.equal(JSON.parse(acked.out.slice(acked.out.indexOf('{'))).applied.accepted_as, 'UI-444');
  });

  it('VL-388 AC7: подсказка pull говорит, что годится префикс', async () => {
    const { dir } = makeGitProject();
    await reportToSelf(dir, 'Подсказка pull');
    const pull = await runCli(dir, 'upstream', 'pull', '--no-fetch');
    assert.equal(pull.code, 0, pull.out);
    assert.match(pull.out, /--as <PREFIX-N>/);
    assert.match(pull.out, /первые 8 символов/);
  });
});
