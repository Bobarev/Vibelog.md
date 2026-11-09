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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { API_BASE_ENV, GITVERSE_TOKEN_ENV } from '../../dist/core/gitverse-issues.js';
import { INBOX_DIR } from '../../dist/core/upstream-git.js';
import { clearPhaseEnv, testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

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

// ============================================================
// VL-391 — приём входящих отчётов через MCP
// ============================================================

/** Проект с локальным bare-инбоксом: отчёт можно положить и принять. */
function makeInboxProject() {
  const dir = makeProject(undefined);
  const remote = join(dir, 'inbox.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', remote]);
  const seed = join(dir, 'seed');
  mkdirSync(seed, { recursive: true });
  const gitSeed = (...args) => execFileSync('/usr/bin/git', args, { cwd: seed, encoding: 'utf8' }).trim();
  execFileSync('/usr/bin/git', ['init', '-q'], { cwd: seed });
  gitSeed('config', 'user.email', 't@e.com');
  gitSeed('config', 'user.name', 'T');
  writeFileSync(join(seed, 'README.md'), '# Inbox\n', 'utf8');
  gitSeed('add', 'README.md');
  gitSeed('commit', '-q', '-m', 'init');
  gitSeed('remote', 'add', 'origin', remote);
  gitSeed('push', '-q', 'origin', 'HEAD:main');
  execFileSync('/usr/bin/git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(
    join(dir, '.vibelog', 'settings.json'),
    JSON.stringify({ upstream: { mode: 'git', inbox: remote, prefix: 'ui' } }, null, 2),
    'utf8',
  );
  // Клон создаём сразу: иначе seedIncomingReport подготовит каталог без .git,
  // и ensureInboxClone упадёт на «destination path already exists».
  execFileSync('/usr/bin/git', ['clone', '-q', remote, join(dir, INBOX_DIR)]);
  return dir;
}

/** Кладёт отчёт в клон инбокса напрямую (без push) — фикстура приёма. */
function seedIncomingReport(dir, { id, task = 'VL-390', title = 'Отчёт для приёма', status = 'open' }) {
  const inbox = join(dir, INBOX_DIR);
  const rel = `reports/tpl/2026-11-08-${task}-report.md`;
  mkdirSync(join(inbox, 'reports', 'tpl'), { recursive: true });
  writeFileSync(
    join(inbox, rel),
    [
      '---',
      `report_id: ${id}`,
      'source_project: Templates',
      'source_prefix: tpl',
      `source_task: ${task}`,
      `title: ${title}`,
      'target: ui',
      'severity: high',
      'area: install',
      'created: 2026-11-08',
      `status: ${status}`,
      'accepted_as: ""',
      '---',
      '',
      '## Что произошло',
      '',
      'Файл компонента не копируется.',
      '',
    ].join('\n'),
    'utf8',
  );
  return rel;
}

describe('VL-391 — регистрация и видимость инструментов приёма', () => {
  it('AC1/AC2: оба инструмента есть в реестре и объявлены в TOOL_KINDS', () => {
    const list = listTools();
    const listReports = list.find((t) => t.name === 'upstream_list_reports');
    const ackReports = list.find((t) => t.name === 'upstream_ack_report');
    assert.ok(listReports, 'upstream_list_reports не зарегистрирован');
    assert.ok(ackReports, 'upstream_ack_report не зарегистрирован');
    assert.deepEqual(ackReports.inputSchema.required, ['report_id', 'action']);
    assert.deepEqual(ackReports.inputSchema.properties.action.enum, ['accept', 'reject']);
    assert.equal(TOOL_KINDS.upstream_list_reports, 'read');
    assert.equal(TOOL_KINDS.upstream_ack_report, 'write');
    assert.equal(isWriteOperation('upstream_ack_report'), true);
    assert.equal(isWriteOperation('upstream_list_reports'), false);
  });

  it('AC8: без секции upstream оба скрыты в tools/list', async () => {
    const dir = makeProject({});
    const names = await toolsListNames(dir);
    assert.ok(!names.includes('upstream_list_reports'));
    assert.ok(!names.includes('upstream_ack_report'));
  });

  it('AC8: с валидной секцией оба видны', async () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: '/tmp/nowhere.git', prefix: 'ui' } });
    const names = await toolsListNames(dir);
    assert.ok(names.includes('upstream_list_reports'));
    assert.ok(names.includes('upstream_ack_report'));
  });

  it('AC8: невалидная секция (mode git без inbox) → инструментов нет', async () => {
    const dir = makeProject({ upstream: { mode: 'git', prefix: 'ui' } });
    const names = await toolsListNames(dir);
    assert.ok(!names.includes('upstream_list_reports'));
    assert.ok(!names.includes('upstream_ack_report'));
  });
});

describe('VL-391 — вызовы приёма отчётов', () => {
  it('AC2/AC12: mode api → оба инструмента отвечают понятной ошибкой', async () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    const listAck = JSON.parse(await handleToolCall('upstream_list_reports', {}, dir));
    assert.equal(listAck.ok, false);
    assert.match(listAck.error, /mode: "git"/);
    assert.equal(hits, 0, 'в API-режиме сеть не нужна');

    const ackAck = JSON.parse(
      await handleToolCall('upstream_ack_report', { report_id: 'abcdef12', action: 'accept', task_id: 'UI-1' }, dir),
    );
    assert.equal(ackAck.ok, false);
    assert.match(ackAck.error, /mode: "git"/);
  });

  it('AC8: без секции upstream прямой вызов даёт actionable-ошибку', async () => {
    const dir = makeProject({});
    const ack = JSON.parse(await handleToolCall('upstream_list_reports', {}, dir));
    assert.equal(ack.ok, false);
    assert.match(ack.hint ?? '', /\.vibelog\/settings\.json/);
    assert.ok(!/Неизвестный инструмент/.test(ack.error));
  });

  it('AC1/AC12: список отдаёт входящие, report_id — тело отчёта', async () => {
    const dir = makeInboxProject();
    const id = `a1b2c3d4${'0'.repeat(32)}`;
    seedIncomingReport(dir, { id });

    const list = JSON.parse(await handleToolCall('upstream_list_reports', {}, dir));
    assert.equal(list.ok, true, JSON.stringify(list));
    assert.equal(list.applied.count, 1);
    const [first] = list.applied.reports;
    for (const field of [
      'report_id', 'source_project', 'source_task', 'title', 'target', 'severity', 'area', 'created', 'status',
    ]) {
      assert.ok(field in first, `поле ${field} отсутствует в списке`);
    }
    assert.equal(first.status, 'open');

    const one = JSON.parse(await handleToolCall('upstream_list_reports', { report_id: id.slice(0, 8) }, dir));
    assert.equal(one.ok, true);
    assert.match(one.applied.report.body, /Файл компонента не копируется/);
  });

  it('AC3: accept с несуществующим task_id → rejected, файл не изменён', async () => {
    const dir = makeInboxProject();
    const id = `b2c3d4e5${'1'.repeat(32)}`;
    const rel = seedIncomingReport(dir, { id });
    const before = readFileSync(join(dir, INBOX_DIR, rel), 'utf8');

    const ack = JSON.parse(
      await handleToolCall('upstream_ack_report', { report_id: id, action: 'accept', task_id: 'VL-99999' }, dir),
    );
    assert.equal(ack.ok, false);
    assert.match(ack.error, /VL-99999/);
    assert.match(ack.hint ?? '', /backlog_create_task/);
    assert.equal(readFileSync(join(dir, INBOX_DIR, rel), 'utf8'), before, 'отчёт не изменён');
  });

  it('AC4/AC12: accept с существующей задачей → отчёт accepted + комментарий в задаче', async () => {
    const dir = makeInboxProject();
    const id = `c3d4e5f6${'2'.repeat(32)}`;
    const rel = seedIncomingReport(dir, { id });
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  const task = JSON.parse(await handleToolCall('backlog_create_task', { title: 'Принять отчёт' }, dir));
    const taskId = task.applied.id;

    const ack = JSON.parse(
      await handleToolCall('upstream_ack_report', { report_id: id, action: 'accept', task_id: taskId }, dir),
    );
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(ack.applied.status, 'accepted');
    // accepted_as нормализуется (префикс в верхний регистр): ui-1 → UI-1
    const normalizedId = taskId.toUpperCase();
    assert.equal(ack.applied.accepted_as, normalizedId);

    const text = readFileSync(join(dir, INBOX_DIR, rel), 'utf8');
    assert.match(text, /^status: accepted$/m);
    assert.match(text, new RegExp(`^accepted_as: ${normalizedId}$`, 'm'));

    // Комментарий ищем в markdown-файле задачи: accept обязан оставить
    // обратную ссылку отчёт → задача (иначе связь живёт только в инбоксе).
    const tasksDir = join(dir, 'backlog', 'tasks');
    const taskFile = readdirSync(tasksDir).find((name) => name.endsWith('.md'));
    assert.ok(taskFile, 'файл задачи не найден');
    const comments = readFileSync(join(tasksDir, taskFile), 'utf8');
    assert.match(comments, new RegExp(id.slice(0, 8)), 'комментарий ссылается на отчёт');
    assert.match(comments, /Templates/, 'комментарий называет проект-источник');
  });
  it('AC2/AC12: reject без reason → rejected, файл не изменён', async () => {
    const dir = makeInboxProject();
    const id = `d4e5f6a7${'3'.repeat(32)}`;
    const rel = seedIncomingReport(dir, { id });
    const before = readFileSync(join(dir, INBOX_DIR, rel), 'utf8');

    const ack = JSON.parse(
      await handleToolCall('upstream_ack_report', { report_id: id, action: 'reject' }, dir),
    );
    assert.equal(ack.ok, false);
    assert.match(ack.error, /reason/);
    assert.equal(readFileSync(join(dir, INBOX_DIR, rel), 'utf8'), before);
  });

  it('AC2: reject с причиной пишет rejected_reason', async () => {
    const dir = makeInboxProject();
    const id = `e5f6a7b8${'4'.repeat(32)}`;
    const rel = seedIncomingReport(dir, { id });

    const ack = JSON.parse(
      await handleToolCall(
        'upstream_ack_report',
        { report_id: id, action: 'reject', reason: 'не воспроизводится на 1.12.0' },
        dir,
      ),
    );
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(ack.applied.status, 'rejected');
    assert.equal(ack.applied.rejected_reason, 'не воспроизводится на 1.12.0');
    const text = readFileSync(join(dir, INBOX_DIR, rel), 'utf8');
    assert.match(text, /^status: rejected$/m);
    assert.match(text, /rejected_reason: не воспроизводится/);
  });
});
