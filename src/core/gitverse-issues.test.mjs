/**
 * Тесты VL-363 — HTTP-клиент GitVerse Issues (репорт бага в upstream).
 *
 * Сети нет: фикстура — локальный `node:http`-сервер на порту 0, база
 * подставляется параметром `apiBase` (или через `VIBELOG_GITVERSE_API_BASE`).
 * Приём взят из `registry-fetch.test.mjs` (VL-335): паузы ретраев и таймаут
 * инъектируются — 0.5 + 1.5 с ожидания и 30 с таймаута в тестах неприемлемы.
 *
 * Тестовый каталог — mkdtempSync (VL-241): фиксированные пути при
 * параллельных прогонах в разных worktree затирают друг друга.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACCEPT,
  API_BASE_ENV,
  DEFAULT_API_BASE,
  GITVERSE_TOKEN_ENV,
  GitverseError,
  buildIssueBody,
  createIssue,
  ensureLabels,
  isUpstreamConfigured,
  listIssues,
  listLabels,
  maskToken,
  parseGitverseError,
  parseNextLink,
  readToken,
  reportBug,
  resolveApiBase,
  resolveUpstreamConfig,
  saveUpstreamConfig,
  tokenHint,
} from '../../dist/core/gitverse-issues.js';
import { loadSettings } from '../../dist/core/settings.js';

/** Быстрые паузы ретраев: те же три попытки, но без 2 секунд ожидания. */
const FAST_RETRIES = [1, 1];

const TOKEN = 'gv_test_token_abcdef123456';

let server;
let port = 0;
let handler;
/** Сколько запросов пришло на сервер (считает ретраи). */
let hits = 0;
/** Методы и пути всех пришедших запросов. */
let methods = [];
let paths = [];
/** Тела POST-запросов (JSON-строки). */
let bodies = [];
/** Заголовки последнего запроса. */
let lastHeaders = {};

const tmpDirs = [];

/** Временный проект с backlog/config.yml и .vibelog/settings.json. */
function makeProject(settings, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-gitverse-'));
  tmpDirs.push(dir);
  mkdirSync(join(dir, 'backlog'), { recursive: true });
  writeFileSync(
    join(dir, 'backlog', 'config.yml'),
    'project_name: Upstream Test\ntask_prefix: ui\ndefault_status: To Do\nstatuses:\n  - To Do\n  - Done\n',
    'utf-8',
  );
  if (settings !== undefined) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
  }
  if (opts.env !== undefined) {
    writeFileSync(join(dir, '.env'), opts.env, 'utf-8');
  }
  return dir;
}

beforeEach(async () => {
  hits = 0;
  methods = [];
  paths = [];
  bodies = [];
  lastHeaders = {};
  handler = (_req, res) => {
    res.writeHead(500);
    res.end('no handler');
  };
  server = createServer((req, res) => {
    hits += 1;
    methods.push(req.method ?? '');
    paths.push(req.url ?? '');
    lastHeaders = req.headers;
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      // Фикстура ведёт себя как реальный GitVerse: неизвестный query-параметр
      // к /labels или /issues → 400 VALIDATION_ERROR (VL-367).
      if (rejectUnknownQuery(req, res)) return;
      handler(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
});

afterEach(async () => {
  delete process.env[API_BASE_ENV];
  delete process.env[GITVERSE_TOKEN_ENV];
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

afterAll(() => {
  delete process.env[API_BASE_ENV];
  delete process.env[GITVERSE_TOKEN_ENV];
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** База фикстуры. */
function base() {
  return `http://127.0.0.1:${port}`;
}

/** Конфиг для фикстуры (без чтения settings.json). */
function cfg(extra = {}) {
  return {
    repo: 'bobarev/Vibelog.md',
    owner: 'bobarev',
    name: 'Vibelog.md',
    token: TOKEN,
    labels: ['upstream', 'from-ui'],
    type: 'bug',
    apiBase: base(),
    ...extra,
  };
}

/** Ответ с JSON. */
function json(status, payload, headers = {}) {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(payload));
  };
}

/**
 * Допустимые query-параметры по эндпоинту — как в реальном GitVerse (ref-27).
 *
 * У `/labels` параметр называется `limit`, у `/issues` — `per_page`; на
 * неизвестный параметр GitVerse отвечает 400 VALIDATION_ERROR (VL-367).
 * Список НЕ расширять «чтобы тест прошёл»: расхождение — это баг клиента.
 */
const ALLOWED_QUERY = {
  labels: ['page', 'limit', 'sort'],
  issues: [
    'state', 'q', 'labels', 'milestones', 'created_by', 'assigned_by',
    'mentioned_by', 'type', 'sort', 'direction', 'since', 'before',
    'per_page', 'page',
  ],
};

/**
 * Отвечает 400 VALIDATION_ERROR, если query-параметр не из белого списка.
 * Возвращает true, если ответ уже отправлен (handler вызывать не нужно).
 */
function rejectUnknownQuery(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const kind = url.pathname.endsWith('/labels')
    ? 'labels'
    : url.pathname.endsWith('/issues')
      ? 'issues'
      : null;
  if (kind === null) return false;
  const allowed = ALLOWED_QUERY[kind];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', status: 400 },
      }));
      return true;
    }
  }
  return false;
}

/** Опции запроса для фикстуры. */
function opts(extra = {}) {
  return { timeoutMs: 2000, retryDelaysMs: FAST_RETRIES, ...extra };
}

// ============================================================
// Константы и база
// ============================================================

describe('VL-363 — база API и заголовки', () => {
  it('база по умолчанию — api.gitverse.ru, Accept — кастомный MIME', () => {
    assert.equal(DEFAULT_API_BASE, 'https://api.gitverse.ru');
    assert.equal(ACCEPT, 'application/vnd.gitverse.object+json;version=1');
    assert.equal(GITVERSE_TOKEN_ENV, 'GITVERSE_TOKEN');
  });

  it('VIBELOG_GITVERSE_API_BASE подменяет базу, трейлинг / снимается', () => {
    assert.equal(resolveApiBase({}), DEFAULT_API_BASE);
    assert.equal(resolveApiBase({ [API_BASE_ENV]: 'http://127.0.0.1:1234/' }), 'http://127.0.0.1:1234');
  });

  it('некорректный URL в VIBELOG_GITVERSE_API_BASE → config', () => {
    assert.throws(
      () => resolveApiBase({ [API_BASE_ENV]: 'ftp://x' }),
      (err) => err instanceof GitverseError && err.kind === 'config' && err.code === 2,
    );
  });

  it('createIssue отправляет Authorization/Accept/Content-Type', async () => {
    handler = json(201, { number: 7, id: 100, html_url: 'https://gitverse.ru/x/issues/7' });
    await createIssue(cfg(), { title: 'Баг', body: 'текст' }, opts());
    assert.equal(lastHeaders.authorization, `Bearer ${TOKEN}`);
    assert.equal(lastHeaders.accept, ACCEPT);
    assert.equal(lastHeaders['content-type'], 'application/json');
    assert.equal(methods[0], 'POST');
    assert.equal(paths[0], '/repos/bobarev/Vibelog.md/issues');
  });
});

// ============================================================
// Создание issue
// ============================================================

describe('VL-363 — createIssue', () => {
  it('успешное создание возвращает {number, id, html_url}', async () => {
    handler = json(201, { number: 12, id: 555, html_url: 'https://gitverse.ru/bobarev/Vibelog.md/issues/12' });
    const issue = await createIssue(cfg(), { title: 'Кнопка не работает', body: 'шаги' }, opts());
    assert.equal(issue.number, 12);
    assert.equal(issue.id, 555);
    assert.equal(issue.html_url, 'https://gitverse.ru/bobarev/Vibelog.md/issues/12');
    const sent = JSON.parse(bodies[0]);
    assert.equal(sent.title, 'Кнопка не работает');
    assert.equal(sent.type, 'bug');
    assert.deepEqual(sent.labels, ['upstream', 'from-ui']);
  });

  it('пустой title → bad_request без сетевого запроса', async () => {
    await assert.rejects(
      () => createIssue(cfg(), { title: '   ' }, opts()),
      (err) => err instanceof GitverseError && err.kind === 'bad_request',
    );
    assert.equal(hits, 0);
  });

  it('ответ без number → invalid_json', async () => {
    handler = json(201, { id: 1 });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => err instanceof GitverseError && err.kind === 'invalid_json',
    );
  });
});

// ============================================================
// Метки
// ============================================================

describe('VL-363 — метки', () => {
  it('listLabels возвращает имена', async () => {
    handler = json(200, [{ name: 'upstream' }, { name: 'from-ui' }]);
    assert.deepEqual(await listLabels(cfg(), opts()), ['upstream', 'from-ui']);
  });

  it('listLabels шлёт limit, а не per_page (VL-367)', async () => {
    handler = json(200, [{ name: 'upstream' }]);
    await listLabels(cfg(), opts());
    assert.match(paths[0], /[?&]limit=100/);
    assert.doesNotMatch(paths[0], /per_page/);
  });

  it('фикстура отвергает per_page у /labels как реальный GitVerse (VL-367)', async () => {
    // Проверяем сам контракт фикстуры: ручной запрос с per_page → 400.
    const res = await fetch(`${base()}/repos/bobarev/Vibelog.md/labels?per_page=100`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
    const payload = await res.json();
    assert.equal(payload.error.code, 'VALIDATION_ERROR');
  });

  it('ensureLabels создаёт отсутствующую метку', async () => {
    handler = (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ name: 'upstream' }]));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'from-ui' }));
    };
    const result = await ensureLabels(cfg(), ['upstream', 'from-ui'], opts());
    assert.deepEqual(result.existing, ['upstream']);
    assert.deepEqual(result.created, ['from-ui']);
    assert.equal(hits, 2, 'один GET + один POST');
    assert.equal(JSON.parse(bodies[1]).name, 'from-ui');
  });

  it('ensureLabels идемпотентен: существующие метки не создаются повторно', async () => {
    handler = json(200, [{ name: 'upstream' }, { name: 'from-ui' }]);
    const result = await ensureLabels(cfg(), ['upstream', 'from-ui'], opts());
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.existing, ['upstream', 'from-ui']);
    assert.equal(hits, 1, 'только GET, ни одного POST');
  });

  it('ensureLabels: имя длиннее 20 символов → bad_request', async () => {
    await assert.rejects(
      () => ensureLabels(cfg(), ['a'.repeat(21)], opts()),
      (err) => err instanceof GitverseError && err.kind === 'bad_request',
    );
  });
});

// ============================================================
// Ошибки и ретраи
// ============================================================

describe('VL-363 — ошибки и ретраи', () => {
  it('401 → unauthorized без ретраев', async () => {
    handler = json(401, { error: { code: 'UNAUTHORIZED', message: 'bad token', status: 401 } });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => {
        assert.ok(err instanceof GitverseError);
        assert.equal(err.kind, 'unauthorized');
        assert.equal(err.status, 401);
        assert.equal(err.code, 3);
        assert.equal(err.attempts, 1);
        return true;
      },
    );
    assert.equal(hits, 1, '4xx не ретраится');
  });

  it('403 → forbidden, 404 → not_found', async () => {
    handler = json(403, { message: 'no rights' });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => err.kind === 'forbidden',
    );
    handler = json(404, { message: 'not found' });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => err.kind === 'not_found',
    );
  });

  it('500 дважды, затем 200 — три обращения, успех', async () => {
    let call = 0;
    handler = (req, res) => {
      call += 1;
      if (call < 3) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'boom', status: 500 } }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ number: 3, id: 3, html_url: 'u' }));
    };
    const issue = await createIssue(cfg(), { title: 'x' }, opts());
    assert.equal(issue.number, 3);
    assert.equal(hits, 3);
  });

  it('500 трижды → server с числом попыток', async () => {
    handler = json(500, { error: { code: 'INTERNAL', message: 'boom', status: 500 } });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => {
        assert.equal(err.kind, 'server');
        assert.equal(err.attempts, 3);
        assert.match(err.message, /попыток: 3/);
        return true;
      },
    );
    assert.equal(hits, 3);
  });

  it('таймаут → timeout без ретраев', async () => {
    handler = () => {
      // не отвечаем вовсе
    };
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, { timeoutMs: 60, retryDelaysMs: FAST_RETRIES }),
      (err) => err instanceof GitverseError && err.kind === 'timeout',
    );
  });

  it('обе формы тела ошибки разбираются', () => {
    const nested = parseGitverseError(400, JSON.stringify({
      error: { code: 'BAD_REQUEST', message: 'The request format is invalid', status: 400 },
    }));
    assert.equal(nested.code, 'BAD_REQUEST');
    assert.equal(nested.message, 'The request format is invalid');

    const flat = parseGitverseError(404, JSON.stringify({
      message: 'Проект не найден',
      documentation_url: 'https://gitverse.ru/docs',
    }));
    assert.equal(flat.message, 'Проект не найден');
    assert.equal(flat.documentationUrl, 'https://gitverse.ru/docs');

    const raw = parseGitverseError(502, '<html>bad gateway</html>');
    assert.match(raw.message, /bad gateway/);
  });

  it('не-JSON успешный ответ → invalid_json', async () => {
    handler = (_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end('not json');
    };
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => err instanceof GitverseError && err.kind === 'invalid_json',
    );
  });
});

// ============================================================
// Токен
// ============================================================

describe('VL-363 — токен и маскирование', () => {
  it('maskToken вырезает токен из текста', () => {
    const text = `запрос с токеном ${TOKEN} провалился`;
    const masked = maskToken(text, TOKEN);
    assert.ok(!masked.includes(TOKEN), 'токен не должен остаться в тексте');
    assert.match(masked, /\*\*\*/);
  });

  it('токен не попадает в текст ошибки сервера', async () => {
    handler = json(401, { error: { code: 'UNAUTHORIZED', message: `bad token ${TOKEN}`, status: 401 } });
    await assert.rejects(
      () => createIssue(cfg(), { title: 'x' }, opts()),
      (err) => {
        assert.ok(!err.message.includes(TOKEN), `токен утёк в сообщение: ${err.message}`);
        return true;
      },
    );
  });

  it('readToken: shell env приоритетнее .env', () => {
    const dir = makeProject(undefined, { env: `${GITVERSE_TOKEN_ENV}=from_file\n` });
    assert.equal(readToken(dir), 'from_file');
    process.env[GITVERSE_TOKEN_ENV] = 'from_shell';
    assert.equal(readToken(dir), 'from_shell');
  });

  it('нет токена → no_token с подсказкой (код 4)', () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } });
    assert.throws(
      () => resolveUpstreamConfig(dir),
      (err) => {
        assert.ok(err instanceof GitverseError);
        assert.equal(err.kind, 'no_token');
        assert.equal(err.code, 4);
        assert.match(err.message, /GITVERSE_TOKEN/);
        assert.match(err.message, /gitverse\.ru\/settings\/tokens/);
        return true;
      },
    );
    assert.match(tokenHint(), /GITVERSE_TOKEN=<токен> в \.env/);
  });

  it('token_env переопределяет имя переменной', () => {
    const dir = makeProject(
      { upstream: { mode: 'api', repo: 'a/b', token_env: 'MY_GITVERSE_TOKEN' } },
      { env: 'MY_GITVERSE_TOKEN=custom\n' },
    );
    const resolved = resolveUpstreamConfig(dir);
    assert.equal(resolved.token, 'custom');
  });
});

// ============================================================
// Конфиг
// ============================================================

describe('VL-363 — секция upstream', () => {
  it('нет секции → config с подсказкой (код 2)', () => {
    const dir = makeProject({});
    assert.throws(
      () => resolveUpstreamConfig(dir),
      (err) => {
        assert.equal(err.kind, 'config');
        assert.equal(err.code, 2);
        assert.match(err.message, /upstream/);
        return true;
      },
    );
  });

  it('repo без «/» → config', () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'nope' } }, { env: `${GITVERSE_TOKEN_ENV}=t\n` });
    assert.throws(() => resolveUpstreamConfig(dir), (err) => err.kind === 'config');
  });

  it('дефолтные метки — upstream + from-<prefix>', () => {
    const dir = makeProject({ upstream: { mode: 'api', repo: 'a/b' } }, { env: `${GITVERSE_TOKEN_ENV}=t\n` });
    const resolved = resolveUpstreamConfig(dir);
    assert.deepEqual(resolved.labels, ['upstream', 'from-ui']);
    assert.equal(resolved.type, 'bug');
    assert.equal(resolved.owner, 'a');
    assert.equal(resolved.name, 'b');
  });

  it('project_id/done_column читаются и валидируются', () => {
    const dir = makeProject(
      { upstream: { mode: 'api', repo: 'a/b', project_id: 42, done_column: 'Done' } },
      { env: `${GITVERSE_TOKEN_ENV}=t\n` },
    );
    const resolved = resolveUpstreamConfig(dir);
    assert.equal(resolved.projectId, 42);
    assert.equal(resolved.doneColumn, 'Done');

    const bad = makeProject(
      { upstream: { mode: 'api', repo: 'a/b', project_id: 'x' } },
      { env: `${GITVERSE_TOKEN_ENV}=t\n` },
    );
    assert.throws(() => resolveUpstreamConfig(bad), (err) => err.kind === 'config');
  });

  it('saveUpstreamConfig не трогает чужие секции (read-modify-write)', () => {
    const dir = makeProject({
      chats: [1, 2],
      models: { default: 'qwen' },
      providers: { p: { base_url: 'u' } },
      components: { schemaVersion: 1 },
    });
    saveUpstreamConfig(dir, { repo: 'a/b', labels: ['upstream'], type: 'bug' });
    const settings = loadSettings(dir);
    assert.deepEqual(settings.chats, [1, 2]);
    assert.deepEqual(settings.models, { default: 'qwen' });
    assert.deepEqual(settings.providers, { p: { base_url: 'u' } });
    assert.deepEqual(settings.components, { schemaVersion: 1 });
    assert.deepEqual(settings.upstream, { repo: 'a/b', labels: ['upstream'], type: 'bug' });
  });
});

// ============================================================
// VL-375 — discriminated union по mode и isUpstreamConfigured
// ============================================================

describe('VL-375 — режимы транспорта upstream', () => {
  it('AC4: mode отсутствует → git, требует inbox', () => {
    const dir = makeProject({ upstream: { prefix: 'ui' } });
    assert.throws(
      () => resolveUpstreamConfig(dir),
      (err) => err.kind === 'config' && /upstream\.inbox/.test(err.message),
    );
    assert.equal(isUpstreamConfigured(dir), false);
  });

  it('AC4: mode git + inbox → {mode:git, inbox, prefix}', () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: 'git@example.com:a/inbox.git', prefix: 'tpl' } });
    const cfg = resolveUpstreamConfig(dir);
    assert.equal(cfg.mode, 'git');
    assert.equal(cfg.inbox, 'git@example.com:a/inbox.git');
    assert.equal(cfg.prefix, 'tpl');
    assert.equal(isUpstreamConfigured(dir), true);
  });

  it('AC4: mode git без prefix — дефолт из task_prefix проекта', () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: 'x.git' } });
    assert.equal(resolveUpstreamConfig(dir).prefix, 'ui');
  });

  it('AC4: невалидный mode → config с перечислением допустимых', () => {
    const dir = makeProject({ upstream: { mode: 'smoke', inbox: 'x.git' } });
    assert.throws(
      () => resolveUpstreamConfig(dir),
      (err) => err.kind === 'config' && /«git» или «api»/.test(err.message),
    );
    assert.equal(isUpstreamConfigured(dir), false);
  });

  it('AC4/AC8: mode api без repo → config, isUpstreamConfigured false', () => {
    const dir = makeProject({ upstream: { mode: 'api', labels: ['upstream'] } });
    assert.throws(() => resolveUpstreamConfig(dir), (err) => err.kind === 'config');
    assert.equal(isUpstreamConfigured(dir), false);
  });

  it('AC8: isUpstreamConfigured fail-closed на битом JSON и отсутствии секции', () => {
    const empty = makeProject({});
    assert.equal(isUpstreamConfigured(empty), false);
    const broken = makeProject(undefined);
    mkdirSync(join(broken, '.vibelog'), { recursive: true });
    writeFileSync(join(broken, '.vibelog', 'settings.json'), '{ битый', 'utf-8');
    assert.equal(isUpstreamConfigured(broken), false);
    assert.equal(isUpstreamConfigured(join(broken, 'нет-такого-каталога')), false);
  });

  it('AC6: reportBug в mode git пишет отчёт в инбокс и не ходит в API', async () => {
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

    const hitsBefore = hits;
    const result = await reportBug(dir, { title: 'Отчёт', target: 'vl', sourceTask: 'UI-5' }, opts());
    assert.equal(result.mode, 'git');
    assert.equal(result.created, true);
    assert.match(result.path, /^reports\/ui\//);
    assert.equal(hits, hitsBefore, 'HTTP-запросов в mode git быть не должно');
  });

  it('AC4/AC5: mode git без target → config (получатель обязателен)', async () => {
    const dir = makeProject({ upstream: { mode: 'git', inbox: 'x.git', prefix: 'ui' } });
    await assert.rejects(
      () => reportBug(dir, { title: 'Без адресата' }, opts()),
      (err) => err instanceof GitverseError && err.kind === 'config' && err.code === 2,
    );
  });
});

// ============================================================
// listIssues и пагинация
// ============================================================

describe('VL-363 — listIssues', () => {
  it('возвращает задачи и hasMore по заголовку Link', async () => {
    handler = json(
      200,
      [{ number: 1, title: 'A', state: 'open', labels: [{ name: 'upstream' }], html_url: 'u1' }],
      { link: '<https://api.gitverse.ru/repos/a/b/issues?page=2>; rel="next", <https://api.gitverse.ru/repos/a/b/issues?page=1>; rel="first"' },
    );
    const result = await listIssues(cfg(), { state: 'open', labels: ['upstream'] }, opts());
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].number, 1);
    assert.deepEqual(result.issues[0].labels, ['upstream']);
    assert.equal(result.hasMore, true);
    assert.match(result.nextUrl, /page=2/);
    assert.match(paths[0], /state=open/);
    assert.match(paths[0], /labels=upstream/);
  });

  it('без Link — hasMore false', async () => {
    handler = json(200, []);
    const result = await listIssues(cfg(), {}, opts());
    assert.equal(result.hasMore, false);
    assert.equal(result.nextUrl, undefined);
  });

  it('listIssues шлёт per_page, а не limit (VL-367)', async () => {
    handler = json(200, []);
    await listIssues(cfg(), { perPage: 50 }, opts());
    assert.match(paths[0], /[?&]per_page=50/);
    assert.doesNotMatch(paths[0], /[?&]limit=/);
  });

  it('parseNextLink разбирает rel="next"', () => {
    assert.equal(
      parseNextLink('<https://x/issues?page=2>; rel="next"'),
      'https://x/issues?page=2',
    );
    assert.equal(parseNextLink('<https://x/issues?page=1>; rel="first"'), undefined);
    assert.equal(parseNextLink(null), undefined);
  });
});

// ============================================================
// Тело issue и полный путь репорта
// ============================================================

describe('VL-363 — тело issue и reportBug', () => {
  it('buildIssueBody содержит фиксированные секции', () => {
    const body = buildIssueBody({
      title: 'Кнопка не работает',
      body: 'При клике ничего не происходит',
      severity: 'high',
      area: 'web',
      sourceTask: 'UI-12',
      project: 'Vibelog UI',
      version: '1.12.0',
    });
    for (const section of ['## Что произошло', '## Воспроизведение', '## Окружение', '## Источник']) {
      assert.ok(body.includes(section), `секция ${section} отсутствует`);
    }
    assert.match(body, /severity: high/);
    assert.match(body, /area: web/);
    assert.match(body, /задача: UI-12/);
    assert.match(body, /проект: Vibelog UI/);
  });

  it('reportBug: конфиг → метки → issue, ack с номером', async () => {
    const dir = makeProject(
      { upstream: { mode: 'api', repo: 'bobarev/Vibelog.md', labels: ['upstream', 'from-ui'], type: 'bug' } },
      { env: `${GITVERSE_TOKEN_ENV}=${TOKEN}\n` },
    );
    process.env[API_BASE_ENV] = base();
    handler = (req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ name: 'upstream' }]));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ number: 21, id: 21, html_url: 'https://gitverse.ru/bobarev/Vibelog.md/issues/21' }));
    };
    const result = await reportBug(dir, { title: 'Баг из ui', body: 'описание' }, opts());
    assert.equal(result.number, 21);
    assert.equal(result.url, 'https://gitverse.ru/bobarev/Vibelog.md/issues/21');
    assert.deepEqual(result.createdLabels, ['from-ui']);
    assert.deepEqual(result.labels, ['upstream', 'from-ui']);
    // Тело issue собрано детерминированно
    const sent = JSON.parse(bodies[bodies.length - 1]);
    assert.match(sent.body, /## Что произошло/);
    assert.equal(sent.type, 'bug');
  });

  it('reportBug без секции upstream → config (код 2)', async () => {
    const dir = makeProject({});
    await assert.rejects(
      () => reportBug(dir, { title: 'x' }, opts()),
      (err) => err instanceof GitverseError && err.kind === 'config' && err.code === 2,
    );
  });
});
