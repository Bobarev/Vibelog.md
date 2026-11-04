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
import { readFileSync } from 'node:fs';

import {
  DEFAULT_REGISTRY_BASE,
  MAX_BODY_BYTES,
  REGISTRY_BASE_ENV,
  REQUEST_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  RegistryFetchError,
  buildRawUrl,
  buildRegistryItemUrl,
  extractErrorMessage,
  fetchRegistryItem,
  resolveRegistryBase,
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

/** Загрузка элемента через фикстуру. */
async function fetchItem(extra = {}) {
  return fetchRegistryItem({
    baseUrl: base(),
    owner: 'Vibelog-md',
    repo: 'ui',
    branch: 'master',
    name: 'button',
    retryDelaysMs: FAST_RETRIES,
    timeoutMs: 2000,
    ...extra,
  });
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

  it('прочие 4xx (403) → ошибка без ретраев', async () => {
    handler = (_req, res) => {
      res.writeHead(403, { 'content-type': 'text/html' });
      res.end('<html>forbidden</html>');
    };
    await expectFetchError(fetchItem(), 'server');
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

  it('отклоняет неизвестный type', () => {
    assert.throws(
      () => validateRegistryItem(validItem({ type: 'registry:block' }), 'button'),
      (err) => err instanceof RegistryFetchError && err.kind === 'invalid_schema',
    );
  });

  it('отклоняет version не в формате X.Y.Z', () => {
    assert.throws(
      () => validateRegistryItem(validItem({ version: 'v1' }), 'button'),
      (err) => err instanceof RegistryFetchError && /version/.test(err.message),
    );
  });

  it('отклоняет абсолютный target и target с «..»', () => {
    for (const target of ['/etc/passwd', '../../outside.svelte', 'a/../../b.svelte']) {
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
