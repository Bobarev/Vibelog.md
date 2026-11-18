/**
 * Тесты VL-335 — HTTP-клиент реестра компонентов (doc-25 §4.3 шаги 3–4, §5.1).
 *
 * Сети нет: фикстура — локальный `node:http`-сервер на порту 0, база
 * подставляется параметром `baseUrl` или через `VIBELOG_REGISTRY_BASE_URL`.
 * Особенности GitVerse, проверенные спайком (§10), воспроизводятся явно:
 * отсутствующий файл = 400, успешный ответ = `text/plain`, HEAD = 403.
 *
 * Паузы ретраев и таймаут инъектируются: 0.5 + 1.5 с ожидания и 30 с
 * таймаута в тестах неприемлемы.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONTENTS_MAX_BODY_BYTES,
  DEFAULT_API_BASE,
  DEFAULT_REGISTRY_BASE,
  MAX_BODY_BYTES,
  REGISTRY_BASE_ENV,
  REGISTRY_BASE_ENV_ALIAS,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  RegistryFetchError,
  buildContentsUrl,
  buildRawUrl,
  buildRegistryItemUrl,
  decodeContentsPayload,
  extractErrorMessage,
  fetchRegistryFile,
  fetchRegistryItem,
  resolveRegistryApiBase,
  resolveRegistryBase,
  resolveRegistryTransport,
  validateRegistryItem,
} from '../../dist/core/registry-fetch.js';

/** Быстрые паузы ретраев: те же три попытки, но без 2 секунд ожидания. */
const FAST_RETRIES = [1, 1];

/** Валидный элемент реестра по doc-25 §3.3. */
function validItem(overrides = {}) {
  return {
    name: 'button',
    type: 'registry:ui',
    version: '1.0.0',
    dependencies: ['clsx', 'tailwind-merge'],
    registryDependencies: ['vibelog.md/ui/base'],
    files: [
      {
        path: 'src/lib/components/ui/button.svelte',
        target: 'button.svelte',
        type: 'registry:ui',
      },
    ],
    ...overrides,
  };
}

let server;
let port = 0;
let handler;
/** Сколько запросов пришло на сервер (считает ретраи). */
let hits = 0;
/** Методы всех пришедших запросов. */
let methods = [];
/** Пути всех пришедших запросов. */
let paths = [];
/** Временные каталоги тестов (mkdtemp, VL-241). */
const tmpDirs = [];

beforeEach(async () => {
  hits = 0;
  methods = [];
  paths = [];
  handler = (_req, res) => {
    res.writeHead(500);
    res.end('no handler');
  };
  server = createServer((req, res) => {
    hits += 1;
    methods.push(req.method ?? '');
    paths.push(req.url ?? '');
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
});

afterEach(async () => {
  delete process.env[REGISTRY_BASE_ENV];
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

afterAll(() => {
  delete process.env[REGISTRY_BASE_ENV];
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** База фикстуры. */
function base() {
  return `http://127.0.0.1:${port}`;
}

/** Ответ 200 с JSON, как отдаёт GitVerse (text/plain!). */
function ok() {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(JSON.stringify(validItem()));
  };
}

/**
 * Загрузка элемента через фикстуру.
 *
 * По умолчанию — raw без токена (VL-382: именно этот режим работает
 * анонимно). Тесты contents передают `token` явно.
 */
async function fetchItem(extra = {}) {
  return fetchRegistryItem({
    baseUrl: base(),
    owner: 'Vibelog-md',
    repo: 'ui',
    branch: 'master',
    name: 'button',
    token: '',
    retryDelaysMs: FAST_RETRIES,
    timeoutMs: 2000,
    ...extra,
  });
}

/** Ответ Contents API: конверт с base64-содержимым (VL-382, ref-32). */
function contentsOk(text, extra = {}) {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/vnd.gitverse.object+json;version=1' });
    res.end(
      JSON.stringify({
        type: 'file',
        encoding: 'base64',
        size: Buffer.byteLength(text, 'utf8'),
        name: 'button.json',
        path: 'public/r/button.json',
        content: Buffer.from(text, 'utf8').toString('base64'),
        ...extra,
      }),
    );
  };
}

/** Проверяет, что промис падает RegistryFetchError нужного вида. */
async function expectFetchError(promise, kind) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  assert.ok(
    err instanceof RegistryFetchError,
    `ожидалась RegistryFetchError, получено ${String(err)}`,
  );
  assert.equal(err.kind, kind, `ожидался kind=${kind}, получено ${err.kind}: ${err.message}`);
  assert.equal(err.code, 3);
  return err;
}

describe('VL-335: resolveRegistryBase', () => {
  it('по умолчанию — gitverse.ru', () => {
    assert.equal(resolveRegistryBase({}), DEFAULT_REGISTRY_BASE);
    assert.equal(DEFAULT_REGISTRY_BASE, 'https://gitverse.ru');
  });

  it('переменная окружения подменяет базу целиком и снимает трейлинг слэш', () => {
    assert.equal(
      resolveRegistryBase({ [REGISTRY_BASE_ENV]: 'http://127.0.0.1:9999/' }),
      'http://127.0.0.1:9999',
    );
  });

  it('пустое значение игнорируется', () => {
    assert.equal(resolveRegistryBase({ [REGISTRY_BASE_ENV]: '   ' }), DEFAULT_REGISTRY_BASE);
  });

  it('невалидное значение — явная ошибка, а не тихий поход не туда', () => {
    assert.throws(
      () => resolveRegistryBase({ [REGISTRY_BASE_ENV]: 'gitverse.ru' }),
      (err) => err instanceof RegistryFetchError && err.kind === 'network',
    );
    assert.throws(
      () => resolveRegistryBase({ [REGISTRY_BASE_ENV]: 'ftp://example.com' }),
      (err) => err instanceof RegistryFetchError,
    );
  });

  it('базовый URL берётся из env, если baseUrl не передан', async () => {
    process.env[REGISTRY_BASE_ENV] = base();
    handler = ok();
    const item = await fetchRegistryItem({
      owner: 'Vibelog-md',
      repo: 'ui',
      branch: 'master',
      name: 'button',
      retryDelaysMs: FAST_RETRIES,
      timeoutMs: 2000,
    });
    assert.equal(item.name, 'button');
    assert.equal(hits, 1);
  });
});

describe('VL-335: buildRawUrl', () => {
  it('собирает raw-URL GitVerse', () => {
    assert.equal(
      buildRawUrl('https://gitverse.ru', 'Vibelog-md', 'ui', 'master', 'public/r/button.json'),
      'https://gitverse.ru/api/repos/Vibelog-md/ui/raw/branch/master/public/r/button.json',
    );
  });

  it('кодирует owner/repo/branch и сохраняет слэши в path', () => {
    const url = buildRawUrl(
      'https://gitverse.ru/',
      'Иван Петров',
      'ui lib',
      'release/1.0',
      'public/r/button.json',
    );
    assert.equal(
      url,
      `https://gitverse.ru/api/repos/${encodeURIComponent('Иван Петров')}/${encodeURIComponent('ui lib')}/raw/branch/${encodeURIComponent('release/1.0')}/public/r/button.json`,
    );
    assert.ok(url.includes('/public/r/button.json'));
  });

  it('кодирует спецсимволы в сегментах пути, не ломая разделители', () => {
    const url = buildRawUrl('http://127.0.0.1:1', 'o', 'r', 'b', 'dir/a b/c#d.json');
    assert.ok(url.endsWith('/dir/a%20b/c%23d.json'));
  });

  it('buildRegistryItemUrl указывает на public/r/<name>.json', () => {
    assert.equal(
      buildRegistryItemUrl('https://gitverse.ru', 'Vibelog-md', 'ui', 'master', 'button'),
      'https://gitverse.ru/api/repos/Vibelog-md/ui/raw/branch/master/public/r/button.json',
    );
  });

  it('константы соответствуют спецификации', () => {
    assert.equal(REQUEST_TIMEOUT_MS, 30_000);
    assert.equal(MAX_BODY_BYTES, 5 * 1024 * 1024);
    assert.deepEqual([...RETRY_DELAYS_MS], [500, 1500]);
  });
});

describe('VL-335: fetchRegistryItem', () => {
  it('успех: 200 с text/plain и валидным JSON → объект (content-type игнорируется)', async () => {
    handler = ok();
    const item = await fetchItem();
    assert.equal(item.name, 'button');
    assert.equal(item.type, 'registry:ui');
    assert.equal(item.version, '1.0.0');
    assert.deepEqual(item.files, [
      {
        path: 'src/lib/components/ui/button.svelte',
        target: 'button.svelte',
        type: 'registry:ui',
      },
    ]);
    assert.equal(hits, 1);
    // Только GET: HEAD на GitVerse отдаёт 403 (спайк, doc-25 §10).
    assert.deepEqual(methods, ['GET']);
    assert.equal(paths[0], '/api/repos/Vibelog-md/ui/raw/branch/master/public/r/button.json');
  });

  it('400 от GitVerse → not_found с message из тела ответа', async () => {
    handler = (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ code: 4305, message: 'File: public/r/button.json not found' }));
    };
    const err = await expectFetchError(fetchItem(), 'not_found');
    assert.match(err.message, /не найден/);
    assert.match(err.message, /File: public\/r\/button\.json not found/);
    assert.equal(err.status, 400);
    assert.equal(hits, 1, 'на 400 ретраев быть не должно');
  });

  it('404 → not_found (другие хосты отвечают привычно)', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    };
    const err = await expectFetchError(fetchItem(), 'not_found');
    assert.equal(err.status, 404);
    assert.equal(hits, 1);
  });

  it('500 дважды, затем 200 → успех после двух ретраев (3 обращения)', async () => {
    let call = 0;
    handler = (req, res) => {
      call += 1;
      if (call < 3) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      }
      ok()(req, res);
    };
    const item = await fetchItem();
    assert.equal(item.name, 'button');
    assert.equal(hits, 3);
  });

  it('500 трижды → server с числом попыток в тексте', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
    };
    const err = await expectFetchError(fetchItem(), 'server');
    assert.equal(err.status, 500);
    assert.equal(err.attempts, 3);
    assert.match(err.message, /попыток: 3/);
    assert.equal(hits, 3);
  });

  it('400 → ровно одно обращение (нет ретраев)', async () => {
    handler = (_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 4305, message: 'not found' }));
    };
    await expectFetchError(fetchItem(), 'not_found');
    assert.equal(hits, 1);
  });

  it('прочие 4xx (403) → отдельный вид forbidden без ретраев (VL-380, AC9)', async () => {
    handler = (_req, res) => {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html>forbidden</html>');
    };
    const err = await expectFetchError(fetchItem(), 'forbidden');
    assert.match(err.message, /GITVERSE_TOKEN/);
    assert.equal(hits, 1);
  });

  it('таймаут: сервер не отвечает → kind timeout, без ретраев', async () => {
    handler = () => {
      /* молчим: ответа не будет */
    };
    const err = await expectFetchError(
      fetchItem({ timeoutMs: 60, retryDelaysMs: FAST_RETRIES }),
      'timeout',
    );
    assert.match(err.message, /не ответил/);
    assert.equal(hits, 1);
  });

  it('таймаут не оставляет таймер (процесс завершается, vitest не виснет)', async () => {
    // После таймаута event loop не должен держаться таймером на 30 с —
    // иначе этот тест упёрся бы в timeout самого vitest.
    handler = () => {
      /* молчим */
    };
    await expectFetchError(fetchItem({ timeoutMs: 30 }), 'timeout');
  });

  it('тело больше лимита → too_large без полной загрузки', async () => {
    const big = 'x'.repeat(20_000);
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem({ padding: big })));
    };
    const err = await expectFetchError(fetchItem({ maxBodyBytes: 1024 }), 'too_large');
    assert.match(err.message, /больше лимита/);
    assert.equal(hits, 1);
  });

  it('лимит 5 МБ по умолчанию — реальное ограничение', async () => {
    assert.equal(MAX_BODY_BYTES, 5 * 1024 * 1024);
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('y'.repeat(MAX_BODY_BYTES + 1));
    };
    const err = await expectFetchError(fetchItem({ timeoutMs: 20_000 }), 'too_large');
    assert.match(err.message, /5242880/);
  });

  it('невалидный JSON → invalid_json', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('<html>не json</html>');
    };
    await expectFetchError(fetchItem(), 'invalid_json');
  });

  it('JSON без files → invalid_schema с указанием поля', async () => {
    const item = validItem();
    delete item.files;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(item));
    };
    const err = await expectFetchError(fetchItem(), 'invalid_schema');
    assert.match(err.message, /files/);
    assert.equal(
      err.url,
      `${base()}/api/repos/Vibelog-md/ui/raw/branch/master/public/r/button.json`,
    );
  });

  it('name не совпадает с запрошенным → invalid_schema', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem({ name: 'input' })));
    };
    const err = await expectFetchError(fetchItem(), 'invalid_schema');
    assert.match(err.message, /не совпадает/);
  });

  it('сетевая ошибка (порт закрыт) → network после ретраев', async () => {
    const closedPort = port;
    await new Promise((resolve) => server.close(() => resolve()));
    server = createServer(); // чтобы afterEach было что закрывать
    const err = await expectFetchError(
      fetchRegistryItem({
        baseUrl: `http://127.0.0.1:${closedPort}`,
        owner: 'Vibelog-md',
        repo: 'ui',
        branch: 'master',
        name: 'button',
        retryDelaysMs: FAST_RETRIES,
        timeoutMs: 2000,
      }),
      'network',
    );
    assert.match(err.message, /попыток: 3/);
  });
});

describe('VL-382: raw-транспорт АНОНИМНЫЙ (регрессия дефекта VL-380)', () => {
  it('в raw-запросе нет заголовка authorization даже при наличии токена', async () => {
    // Замеры 2026-11-09: raw + Authorization: Bearer → 429 ВСЕГДА. Поэтому
    // токен в raw не уходит ни при каком его наличии — ни из опций, ни из .env.
    let authHeader = 'sentinel';
    handler = (req, res) => {
      authHeader = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem()));
    };
    await fetchItem({ token: 'gv_registry_token_123456', transport: 'raw' });
    assert.equal(authHeader, undefined, 'raw не должен отправлять Authorization');

    const dir = mkdtempSync(join(tmpdir(), 'vibelog-registry-raw-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, '.env'), 'GITVERSE_TOKEN=gv_from_env_file\n', 'utf-8');
    const savedToken = process.env.GITVERSE_TOKEN;
    delete process.env.GITVERSE_TOKEN;
    authHeader = 'sentinel';
    try {
      await fetchItem({ cwd: dir, transport: 'raw' });
    } finally {
      if (savedToken !== undefined) process.env.GITVERSE_TOKEN = savedToken;
    }
    assert.equal(authHeader, undefined, 'токен из .env тоже не должен попасть в raw');
  });

  it('raw-запрос идёт на веб-хост с обычным accept', async () => {
    let acceptHeader;
    handler = (req, res) => {
      acceptHeader = req.headers.accept;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem()));
    };
    await fetchItem();
    assert.match(String(acceptHeader), /application\/json/);
    assert.equal(paths[0], '/api/repos/Vibelog-md/ui/raw/branch/master/public/r/button.json');
  });
});

describe('VL-380: rate-limit в реестре (общая политика)', () => {

  it('429 + Retry-After: 2 → ретрай через 2 с (инъекция пауз, AC11)', async () => {
    const pauses = [];
    let call = 0;
    handler = (req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'content-type': 'text/html', 'retry-after': '2' });
        res.end('<html><body>Unauthenticated requests rate-limit exceeded</body></html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem()));
    };
    const item = await fetchItem({
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.equal(item.name, 'button');
    assert.deepEqual(pauses, [2000]);
    assert.equal(hits, 2);
  });

  it('429 без Retry-After → дефолтная пауза rate-limit (инъекция, AC11)', async () => {
    const pauses = [];
    let call = 0;
    handler = (req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'content-type': 'text/plain' });
        res.end('slow down');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(JSON.stringify(validItem()));
    };
    await fetchItem({
      rateLimitDelaysMs: [60_000],
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.deepEqual(pauses, [60_000]);
  });

  it('исчерпание попыток на 429 → kind rate_limited с подсказкой про токен (AC7/AC8)', async () => {
    handler = (_req, res) => {
      res.writeHead(429, { 'content-type': 'text/html' });
      res.end('<html><body>Unauthenticated requests rate-limit exceeded</body></html>');
    };
    const err = await expectFetchError(
      fetchItem({
        rateLimitDelaysMs: [1, 1],
        sleepFn: async () => undefined,
      }),
      'rate_limited',
    );
    assert.equal(err.status, 429);
    assert.equal(err.attempts, 3, 'для 429 попыток больше, чем для 5xx (3)');
    assert.match(err.message, /попыток: 3/);
    assert.match(err.message, /GITVERSE_TOKEN/);
    assert.match(err.message, /следующая попытка через/);
    // HTML не обрезается тегами: пользователь видит причину, а не <!DOCTYPE…>
    assert.match(err.message, /Unauthenticated requests rate-limit exceeded/);
    assert.doesNotMatch(err.message, /<html>/);
  });

  it('токен не попадает в текст ошибки (AC6)', async () => {
    const token = 'gv_secret_token_abcdef';
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 401, message: `bad token ${token}` }));
    };
    const err = await (async () => {
      try {
        await fetchItem({ token });
        return null;
      } catch (e) {
        return e;
      }
    })();
    assert.ok(err);
    assert.equal(err.kind, 'unauthorized');
    assert.ok(!err.message.includes(token), `токен утёк: ${err.message}`);
    assert.match(err.message, /GITVERSE_TOKEN/);
    assert.equal(hits, 1, '401 не ретраится');
  });
});

describe('VL-382: выбор схемы доступа', () => {
  it('токена нет → raw', () => {
    const t = resolveRegistryTransport({ token: '', env: {} });
    assert.equal(t.kind, 'raw');
    assert.equal(t.token, '');
    assert.equal(t.baseUrl, DEFAULT_REGISTRY_BASE);
  });

  it('токен задан → contents, база — Публичный API', () => {
    const t = resolveRegistryTransport({ token: 'gv_tok', env: {} });
    assert.equal(t.kind, 'contents');
    assert.equal(t.token, 'gv_tok');
    assert.equal(t.baseUrl, DEFAULT_API_BASE);
    assert.equal(DEFAULT_API_BASE, 'https://api.gitverse.ru');
  });

  it('токен читается из .env каталога проекта', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-registry-transport-'));
    tmpDirs.push(dir);
    writeFileSync(join(dir, '.env'), 'GITVERSE_TOKEN=from_file\n', 'utf-8');
    const savedToken = process.env.GITVERSE_TOKEN;
    delete process.env.GITVERSE_TOKEN;
    try {
      const t = resolveRegistryTransport({ cwd: dir, env: {} });
      assert.equal(t.kind, 'contents');
      assert.equal(t.token, 'from_file');
    } finally {
      if (savedToken !== undefined) process.env.GITVERSE_TOKEN = savedToken;
      // .env мог быть прочитан из кеша — путь уникален, кеша нет
    }
  });

  it('явный transport переопределяет выбор по токену', () => {
    assert.equal(resolveRegistryTransport({ token: 'gv', transport: 'raw', env: {} }).kind, 'raw');
    assert.equal(
      resolveRegistryTransport({ token: '', transport: 'contents', env: {} }).kind,
      'contents',
    );
  });

  it('явный baseUrl переопределяет базу выбранной схемы', () => {
    const t = resolveRegistryTransport({ token: 'gv', baseUrl: 'http://127.0.0.1:9', env: {} });
    assert.equal(t.baseUrl, 'http://127.0.0.1:9');
  });

  it('GITVERSE_REGISTRY_BASE_URL подменяет обе базы, старое имя — только raw', () => {
    const env = { [REGISTRY_BASE_ENV_ALIAS]: 'http://127.0.0.1:7777/' };
    assert.equal(resolveRegistryBase(env), 'http://127.0.0.1:7777');
    assert.equal(resolveRegistryApiBase(env), 'http://127.0.0.1:7777');
    assert.equal(
      resolveRegistryApiBase({ [REGISTRY_BASE_ENV]: 'http://127.0.0.1:8888' }),
      DEFAULT_API_BASE,
    );
  });
});

describe('VL-382: buildContentsUrl', () => {
  it('собирает URL Публичного API с ref и scope=full', () => {
    assert.equal(
      buildContentsUrl('https://api.gitverse.ru', 'Vibelog-md', 'ui', 'master', 'public/r/button.json'),
      'https://api.gitverse.ru/repos/Vibelog-md/ui/contents/public/r/button.json?ref=master&scope=full',
    );
  });

  it('кодирует сегменты пути по одному, сохраняя слэши', () => {
    const url = buildContentsUrl('https://api.gitverse.ru/', 'o', 'r', 'release/1.0', 'dir/a b/c#d.json');
    assert.ok(url.endsWith('/contents/dir/a%20b/c%23d.json?ref=release%2F1.0&scope=full'));
  });
});

describe('VL-382: contents-транспорт', () => {
  it('200 с base64 → элемент распарсен; Bearer и кастомный Accept', async () => {
    let authHeader;
    let acceptHeader;
    handler = (req, res) => {
      authHeader = req.headers.authorization;
      acceptHeader = req.headers.accept;
      contentsOk(JSON.stringify(validItem()))(req, res);
    };
    const item = await fetchItem({ token: 'gv_contents_token' });
    assert.equal(item.name, 'button');
    assert.equal(authHeader, 'Bearer gv_contents_token');
    assert.equal(acceptHeader, 'application/vnd.gitverse.object+json;version=1');
    assert.equal(
      paths[0],
      '/repos/Vibelog-md/ui/contents/public/r/button.json?ref=master&scope=full',
    );
  });

  it('кириллица в содержимом декодируется в UTF-8', async () => {
    const cyrillic = JSON.stringify(validItem({ name: 'кнопка', comment: 'описание «кнопки»' }));
    handler = contentsOk(cyrillic);
    const text = await fetchRegistryFile({
      baseUrl: base(),
      owner: 'Vibelog-md',
      repo: 'ui',
      branch: 'master',
      path: 'src/lib/components/ui/button.svelte',
      token: 'gv_tok',
      retryDelaysMs: FAST_RETRIES,
      timeoutMs: 2000,
    });
    assert.equal(text, cyrillic);
    assert.match(text, /описание «кнопки»/);
  });

  it('415 без правильного Accept → bad_accept с подсказкой про заголовок', async () => {
    handler = (_req, res) => {
      res.writeHead(415, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'bad accept' } }));
    };
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'bad_accept');
    assert.match(err.message, /application\/vnd\.gitverse\.object\+json/);
    assert.equal(hits, 1, '415 не ретраится');
  });

  it('401 → unauthorized с подсказкой проверить токен и права «Чтение»', async () => {
    handler = (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'bad token', status: 401 } }));
    };
    const err = await expectFetchError(fetchItem({ token: 'gv_bad' }), 'unauthorized');
    assert.match(err.message, /GITVERSE_TOKEN/);
    assert.match(err.message, /Чтение/);
    assert.equal(hits, 1);
  });

  it('404 → not_found (нет файла или ветки)', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no file', status: 404 } }));
    };
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'not_found');
    assert.match(err.message, /нет файла или ветки/);
  });

  it('429 с Retry-After в contents ретраится', async () => {
    const pauses = [];
    let call = 0;
    handler = (req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
        res.end(JSON.stringify({ error: { code: 'RATE_LIMIT', message: 'slow down' } }));
        return;
      }
      contentsOk(JSON.stringify(validItem()))(req, res);
    };
    const item = await fetchItem({
      token: 'gv_tok',
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.equal(item.name, 'button');
    assert.deepEqual(pauses, [3000]);
    assert.equal(hits, 2);
  });

  it('encoding не base64 → invalid_schema с указанием пути', async () => {
    handler = contentsOk(JSON.stringify(validItem()), { encoding: 'utf-8' });
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'invalid_schema');
    assert.match(err.message, /base64/);
    assert.match(err.message, /public\/r\/button\.json/);
  });

  it('битый base64 → invalid_schema', async () => {
    handler = contentsOk(JSON.stringify(validItem()), { content: '%%%%не-base64%%%%' });
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'invalid_schema');
    assert.match(err.message, /base64/);
  });

  it('пустой content → invalid_schema', async () => {
    handler = contentsOk(JSON.stringify(validItem()), { content: '' });
    await expectFetchError(fetchItem({ token: 'gv_tok' }), 'invalid_schema');
  });

  it('type: dir → понятная ошибка «ожидался файл»', async () => {
    handler = contentsOk('x', { type: 'dir', content: null });
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'invalid_schema');
    assert.match(err.message, /ожидался файл/);
  });

  it('ответ-массив (директория) → ошибка про директорию', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/vnd.gitverse.object+json;version=1' });
      res.end(JSON.stringify([{ type: 'file', name: 'a' }]));
    };
    const err = await expectFetchError(fetchItem({ token: 'gv_tok' }), 'invalid_schema');
    assert.match(err.message, /директория/);
  });

  it('лимит тела для contents выше (base64 удваивает размер)', () => {
    assert.ok(CONTENTS_MAX_BODY_BYTES > MAX_BODY_BYTES);
  });

  it('decodeContentsPayload чистая функция: конверт → текст', () => {
    const text = 'привет, мир';
    const wrapped = JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: Buffer.from(text, 'utf8').toString('base64'),
    });
    assert.equal(decodeContentsPayload(wrapped, 'http://x/y', 'файл'), text);
  });
});

describe('VL-382: fetchRegistryFile в обоих режимах', () => {
  it('raw и contents дают одинаковый текст', async () => {
    const content = 'export const button = 1; // кнопка\n';
    handler = (req, res) => {
      if (req.url.includes('/contents/')) {
        contentsOk(content)(req, res);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(content);
    };
    const common = {
      baseUrl: base(),
      owner: 'Vibelog-md',
      repo: 'ui',
      branch: 'master',
      path: 'src/lib/components/ui/button.svelte',
      retryDelaysMs: FAST_RETRIES,
      timeoutMs: 2000,
    };
    const viaRaw = await fetchRegistryFile({ ...common, token: '' });
    const viaContents = await fetchRegistryFile({ ...common, token: 'gv_tok' });
    assert.equal(viaRaw, content);
    assert.equal(viaContents, content);
    assert.equal(viaRaw, viaContents);
    assert.ok(paths[0].includes('/raw/branch/'));
    assert.ok(paths[1].includes('/contents/'));
  });
});

describe('VL-335: validateRegistryItem', () => {
  it('принимает валидный элемент', () => {
    const item = validateRegistryItem(validItem(), 'button');
    assert.equal(item.name, 'button');
    assert.equal(item.registryDependencies.length, 1);
  });

  it('принимает пустые dependencies и registryDependencies', () => {
    const item = validateRegistryItem(
      validItem({ dependencies: [], registryDependencies: [] }),
      'button',
    );
    assert.deepEqual(item.dependencies, []);
  });

  it('VL-426: принимает registry:block (тип официальной схемы shadcn)', () => {
    const item = validateRegistryItem(validItem({ type: 'registry:block' }), 'button');
    assert.equal(item.type, 'registry:block');
  });

  it('VL-426: отклоняет неподдерживаемый type (registry:page вне белого списка)', () => {
    assert.throws(
      () => validateRegistryItem(validItem({ type: 'registry:page' }), 'button'),
      (err) => err instanceof RegistryFetchError && err.kind === 'invalid_schema',
    );
  });

  it('отклоняет version не в формате X.Y.Z', () => {
    assert.throws(
      () => validateRegistryItem(validItem({ version: 'v1' }), 'button'),
      (err) => err instanceof RegistryFetchError && /version/.test(err.message),
    );
  });

  it('VL-383: target с «..» больше не отклоняется формой (семантику проверяет resolveAliasPath)', () => {
    const item = validateRegistryItem(
      validItem({
        name: 'base',
        type: 'registry:lib',
        files: [
          { path: 'src/lib/utils.ts', target: '../utils.ts', type: 'registry:lib' },
          { path: 'src/lib/theme.css', target: '../theme.css', type: 'registry:lib' },
        ],
      }),
      'base',
    );
    assert.equal(item.files[0].target, '../utils.ts');
    assert.equal(item.files[1].target, '../theme.css');
  });

  it('VL-383: абсолютный target, «~» и пустой target по-прежнему отклоняются', () => {
    for (const target of ['/etc/x', 'C:\\x', '~/x', '']) {
      assert.throws(
        () =>
          validateRegistryItem(
            validItem({ files: [{ path: 'p', target, type: 'registry:ui' }] }),
            'button',
          ),
        (err) => err instanceof RegistryFetchError && err.kind === 'invalid_schema',
        `target «${target}» должен быть отклонён`,
      );
    }
  });

  it('отклоняет registryDependencies не в формате alias/repo/name', () => {
    assert.throws(
      () => validateRegistryItem(validItem({ registryDependencies: ['base'] }), 'button'),
      (err) =>
        err instanceof RegistryFetchError && /registryDependencies/.test(err.message),
    );
  });

  it('перечисляет все непрошедшие поля', () => {
    const err = (() => {
      try {
        validateRegistryItem({ name: 'button' }, 'button');
        return null;
      } catch (e) {
        return e;
      }
    })();
    assert.ok(err instanceof RegistryFetchError);
    for (const field of ['type', 'version', 'dependencies', 'registryDependencies', 'files']) {
      assert.match(err.message, new RegExp(field));
    }
  });
});

describe('VL-335: extractErrorMessage', () => {
  it('берёт message из JSON-тела ошибки GitVerse', () => {
    assert.equal(
      extractErrorMessage('{"code":4305,"message":"File: x.json not found"}'),
      'File: x.json not found',
    );
  });

  it('обрезает сырой текст до 200 символов и склеивает в одну строку', () => {
    const text = `line1\nline2 ${'z'.repeat(500)}`;
    const result = extractErrorMessage(text);
    assert.ok(result.length <= 201);
    assert.ok(!result.includes('\n'));
  });
});

describe('VL-335: исходник модуля', () => {
  const source = readFileSync(new URL('./registry-fetch.ts', import.meta.url), 'utf8');

  it('не содержит HEAD-запросов (спайк: GitVerse отдаёт на них 403)', () => {
    expect(source).not.toMatch(/method:\s*['"]HEAD/);
    expect(source).not.toMatch(/['"]HEAD['"]/);
  });

  it('домен gitverse.ru захардкожен ровно один раз — в дефолте базы', () => {
    // Комментарии не считаем: важно, чтобы домен не встречался в коде
    // (URL-сборка и запрос получают базу параметром).
    const codeLines = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    const matches = codeLines.match(/gitverse\.ru/g) ?? [];
    assert.equal(matches.length, 1);
  });
});
