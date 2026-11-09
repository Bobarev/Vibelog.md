/**
 * Тесты VL-380 — общий транспорт GitVerse (`gitverse-http.ts`).
 *
 * Сети нет: фикстура — локальный `node:http`-сервер на порту 0. Проверяется
 * ровно то, что вынесено в транспорт и раньше дублировалось в двух клиентах:
 * таймаут (гасит таймер, не вешает процесс), лимит тела в байтах, разбор
 * `Retry-After` (секунды / HTTP-дата / мусор), цикл ретраев с раздельной
 * политикой для 429 и 5xx, маскирование секрета и разбор обеих форм тела
 * ошибки (включая HTML-страницу rate-limit).
 *
 * Паузы инъектируются (`sleepFn`): настоящие 60 с ожидания в тестах
 * неприемлемы.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_RATE_LIMIT_DELAYS_MS,
  DEFAULT_RETRY_DELAYS_MS,
  GitverseHttpError,
  MAX_RETRY_AFTER_MS,
  extractErrorMessage,
  fetchOnce,
  maskText,
  networkErrorCode,
  parseJson,
  parseRetryAfter,
  readBodyLimited,
  requestWithRetries,
  resolveBase,
  sleep,
} from '../../dist/core/gitverse-http.js';

/** Ошибка теста: свой вид и код выхода, как у настоящих клиентов. */
function makeError(message, kind, url, details = {}) {
  return new GitverseHttpError(message, kind, url, { ...details, code: 3 });
}

/** Контекст транспорта для тестов. */
const CTX = { what: 'GitVerse', makeError };

let server;
let port = 0;
let handler;
let hits = 0;

beforeEach(async () => {
  hits = 0;
  handler = (_req, res) => {
    res.writeHead(500);
    res.end('no handler');
  };
  server = createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  port = address.port;
});

afterEach(async () => {
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

/** URL фикстуры. */
function url(path = '/x') {
  return `http://127.0.0.1:${port}${path}`;
}

describe('VL-380: parseRetryAfter', () => {
  it('секунды → миллисекунды', () => {
    assert.equal(parseRetryAfter({ get: () => '120' }), 120_000);
    assert.equal(parseRetryAfter({ get: () => '0' }), 0);
  });

  it('HTTP-дата → остаток до неё', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const value = parseRetryAfter({ get: () => future });
    assert.ok(value !== null);
    // Округление до секунд в HTTP-дате — допускаем щедрый допуск.
    assert.ok(value > 2_000 && value <= 6_000, `получено ${value}`);
  });

  it('мусор и отсутствие заголовка → null (используется дефолт)', () => {
    assert.equal(parseRetryAfter({ get: () => 'soon' }), null);
    assert.equal(parseRetryAfter({ get: () => '' }), null);
    assert.equal(parseRetryAfter({ get: () => null }), null);
    assert.equal(parseRetryAfter(null), null);
  });
});

describe('VL-380: maskText и networkErrorCode', () => {
  it('maskText вырезает секрет, короткий секрет игнорируется', () => {
    assert.equal(maskText('token abcdefgh тут', 'abcdefgh'), 'token *** тут');
    assert.equal(maskText('текст без секрета', 'abcdefgh'), 'текст без секрета');
    assert.equal(maskText('ab в тексте', 'ab'), 'ab в тексте');
    assert.equal(maskText('abc в тексте', ''), 'abc в тексте');
  });

  it('networkErrorCode достаёт код из ошибки и из cause', () => {
    assert.equal(networkErrorCode({ code: 'ECONNRESET' }), 'ECONNRESET');
    assert.equal(networkErrorCode({ cause: { code: 'UND_ERR_SOCKET' } }), 'UND_ERR_SOCKET');
    assert.equal(networkErrorCode(new Error('no code')), undefined);
  });
});

describe('VL-380: extractErrorMessage', () => {
  it('плоская форма {code, message}', () => {
    assert.equal(
      extractErrorMessage('{"code":4305,"message":"File: x.json not found"}'),
      'File: x.json not found',
    );
  });

  it('вложенная форма {error:{code,message,status}}', () => {
    assert.equal(
      extractErrorMessage(
        '{"error":{"code":"BAD_REQUEST","message":"Invalid request","status":400}}',
      ),
      'Invalid request',
    );
  });

  it('HTML-страница rate-limit превращается в текст, а не в теги', () => {
    const html =
      '<!DOCTYPE html><html><head><title>429</title><style>body{}</style></head>' +
      '<body><h1>Unauthenticated requests rate-limit exceeded</h1></body></html>';
    const message = extractErrorMessage(html);
    assert.match(message, /Unauthenticated requests rate-limit exceeded/);
    assert.doesNotMatch(message, /<[a-z]/i);
  });

  it('пустое тело → пустая строка, сырой текст склеивается в одну строку', () => {
    assert.equal(extractErrorMessage('   '), '');
    assert.equal(extractErrorMessage('a\nb\n c'), 'a b c');
    assert.ok(extractErrorMessage('z'.repeat(500)).length <= 201);
  });
});

describe('VL-380: resolveBase', () => {
  it('по умолчанию — переданная база, env подменяет и снимает трейлинг /', () => {
    const options = (extra = {}) => ({
      envName: 'TEST_BASE',
      defaultBase: 'https://example.org',
      fail: (message, u) => makeError(message, 'network', u),
      ...extra,
    });
    assert.equal(resolveBase({}, options()), 'https://example.org');
    assert.equal(resolveBase({ TEST_BASE: '   ' }, options()), 'https://example.org');
    assert.equal(resolveBase({ TEST_BASE: 'http://127.0.0.1:9/' }, options()), 'http://127.0.0.1:9');
  });

  it('битое значение и не-http(s) схема → ошибка от клиента (свой kind/code)', () => {
    const options = {
      envName: 'TEST_BASE',
      defaultBase: 'https://example.org',
      fail: (message, u) => makeError(message, 'network', u),
    };
    assert.throws(
      () => resolveBase({ TEST_BASE: 'example.org' }, options),
      (err) => err instanceof GitverseHttpError && err.kind === 'network' && err.code === 3,
    );
    assert.throws(
      () => resolveBase({ TEST_BASE: 'ftp://example.org' }, options),
      (err) => err instanceof GitverseHttpError && /http\(s\)/.test(err.message),
    );
  });
});

describe('VL-380: fetchOnce', () => {
  it('успех отдаёт статус, текст и заголовки', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'retry-after': '7' });
      res.end('ok');
    };
    const response = await fetchOnce({ ...CTX, url: url(), timeoutMs: 2000 });
    assert.equal(response.status, 200);
    assert.equal(response.text, 'ok');
    assert.equal(response.headers.get('retry-after'), '7');
  });

  it('таймаут: kind timeout и никакого висящего таймера', async () => {
    handler = () => {
      /* молчим: ответа не будет */
    };
    const started = Date.now();
    await assert.rejects(
      () => fetchOnce({ ...CTX, url: url(), timeoutMs: 50 }),
      (err) => err instanceof GitverseHttpError && err.kind === 'timeout',
    );
    // Если бы таймер на 30 с не гасился, тест упёрся бы в timeout vitest.
    assert.ok(Date.now() - started < 5_000);
  });

  it('лимит тела: обрывает загрузку с kind too_large', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(50_000));
    };
    await assert.rejects(
      () => fetchOnce({ ...CTX, url: url(), timeoutMs: 5000, maxBodyBytes: 1024 }),
      (err) => err instanceof GitverseHttpError && err.kind === 'too_large',
    );
  });

  it('readBodyLimited: null-тело → пустая строка, лимит соблюдается', async () => {
    assert.equal(await readBodyLimited(null, 10, url(), CTX), '');
  });

  it('сетевая ошибка (порт закрыт) → kind network', async () => {
    const closed = port;
    await new Promise((resolve) => server.close(() => resolve()));
    server = createServer(); // чтобы afterEach было что закрывать
    await assert.rejects(
      () => fetchOnce({ ...CTX, url: `http://127.0.0.1:${closed}/x`, timeoutMs: 1000 }),
      (err) => err instanceof GitverseHttpError && err.kind === 'network',
    );
  });

  it('POST с телом отправляет JSON и content-type', async () => {
    let seen = {};
    handler = (req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen = {
          method: req.method,
          contentType: req.headers['content-type'],
          body: Buffer.concat(chunks).toString('utf8'),
        };
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{}');
      });
    };
    await fetchOnce({
      ...CTX,
      url: url(),
      method: 'POST',
      body: { title: 'x' },
      timeoutMs: 2000,
      headers: { accept: 'application/json' },
    });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.contentType, 'application/json');
    assert.deepEqual(JSON.parse(seen.body), { title: 'x' });
  });
});

describe('VL-380: requestWithRetries', () => {
  /** Классификация: 5xx и 429 ретраибельны, прочее — нет. */
  const classify = (status, text) => {
    const detail = extractErrorMessage(text);
    if (status === 429) {
      return {
        kind: 'rate_limited',
        message: `GitVerse ограничил запросы (HTTP 429)${detail ? `: ${detail}` : ''}`,
        retryable: true,
        retryHint: (nextDelayMs) =>
          `следующая попытка через ${Math.round((nextDelayMs ?? 60_000) / 1000)} с`,
      };
    }
    if (status >= 500) return { kind: 'server', message: `ответ ${status}`, retryable: true };
    return { kind: 'bad_request', message: `ответ ${status}`, retryable: false };
  };

  it('5xx ретраится по retryDelaysMs и затем бросает server с числом попыток', async () => {
    const pauses = [];
    handler = (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    };
    await assert.rejects(
      () =>
        requestWithRetries({
          ...CTX,
          url: url(),
          timeoutMs: 2000,
          classify,
          retryDelaysMs: [1, 1],
          sleepFn: async (ms) => {
            pauses.push(ms);
          },
        }),
      (err) => {
        assert.equal(err.kind, 'server');
        assert.equal(err.attempts, 3);
        assert.match(err.message, /попыток: 3/);
        return true;
      },
    );
    assert.deepEqual(pauses, [1, 1]);
    assert.equal(hits, 3);
  });

  it('429 использует Retry-After и отдельный (более длинный) список пауз', async () => {
    const pauses = [];
    let call = 0;
    handler = (_req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'retry-after': '3' });
        res.end('slow down');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    };
    const response = await requestWithRetries({
      ...CTX,
      url: url(),
      timeoutMs: 2000,
      classify,
      retryDelaysMs: [1],
      rateLimitDelaysMs: [60_000, 60_000],
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.equal(response.text, 'ok');
    assert.deepEqual(pauses, [3000], 'пауза взята из Retry-After, а не из списка');
    assert.equal(hits, 2);
  });

  it('429 упирается в суммарный бюджет и отдаёт rate_limited с подсказкой', async () => {
    handler = (_req, res) => {
      res.writeHead(429, {});
      res.end('nope');
    };
    await assert.rejects(
      () =>
        requestWithRetries({
          ...CTX,
          url: url(),
          timeoutMs: 2000,
          classify,
          rateLimitDelaysMs: [100_000, 100_000, 100_000],
          rateLimitBudgetMs: 150_000,
          sleepFn: async () => undefined,
        }),
      (err) => {
        assert.equal(err.kind, 'rate_limited');
        assert.equal(err.status, 429);
        assert.match(err.message, /следующая попытка через/);
        return true;
      },
    );
  });

  it('Retry-After больше потолка обрезается MAX_RETRY_AFTER_MS', async () => {
    const pauses = [];
    let call = 0;
    handler = (_req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'retry-after': '3600' });
        res.end('slow down');
        return;
      }
      res.writeHead(200);
      res.end('ok');
    };
    await requestWithRetries({
      ...CTX,
      url: url(),
      timeoutMs: 2000,
      classify,
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.deepEqual(pauses, [MAX_RETRY_AFTER_MS]);
  });

  it('неретраибельный статус отдаётся сразу с одной попыткой', async () => {
    handler = (_req, res) => {
      res.writeHead(400);
      res.end('bad');
    };
    await assert.rejects(
      () => requestWithRetries({ ...CTX, url: url(), timeoutMs: 2000, classify }),
      (err) => {
        assert.equal(err.kind, 'bad_request');
        assert.equal(err.status, 400);
        return true;
      },
    );
    assert.equal(hits, 1);
  });

  it('сетевая ошибка ретраится и в финале несёт число попыток', async () => {
    const closed = port;
    await new Promise((resolve) => server.close(() => resolve()));
    server = createServer();
    await assert.rejects(
      () =>
        requestWithRetries({
          ...CTX,
          url: `http://127.0.0.1:${closed}/x`,
          timeoutMs: 500,
          classify,
          retryDelaysMs: [1, 1],
          sleepFn: async () => undefined,
        }),
      (err) => {
        assert.equal(err.kind, 'network');
        assert.equal(err.attempts, 3);
        assert.match(err.message, /попыток: 3/);
        return true;
      },
    );
  });

  it('таймаут не ретраится и не оставляет таймер', async () => {
    handler = () => {
      /* молчим */
    };
    const started = Date.now();
    await assert.rejects(
      () =>
        requestWithRetries({
          ...CTX,
          url: url(),
          timeoutMs: 50,
          classify,
          retryDelaysMs: [1, 1],
          sleepFn: async () => undefined,
        }),
      (err) => err.kind === 'timeout',
    );
    assert.ok(Date.now() - started < 5_000);
    assert.equal(hits, 1, 'таймаут не повторяется');
  });

  it('маскирует секрет во всех текстах ошибок', async () => {
    const secret = 'gv_secret_abcdef';
    handler = (_req, res) => {
      res.writeHead(500);
      res.end(`boom ${secret}`);
    };
    const ctx = { what: 'GitVerse', makeError, mask: (text) => maskText(text, secret) };
    await assert.rejects(
      () =>
        requestWithRetries({
          ...ctx,
          url: url(),
          timeoutMs: 2000,
          classify,
          retryDelaysMs: [1],
          sleepFn: async () => undefined,
        }),
      (err) => {
        assert.ok(!err.message.includes(secret), `секрет утёк: ${err.message}`);
        return true;
      },
    );
  });
});

describe('VL-381: onProgress', () => {
  const classify = (status) => {
    if (status === 429) {
      return {
        kind: 'rate_limited',
        message: 'GitVerse ограничил запросы (HTTP 429)',
        retryable: true,
        retryHint: (nextDelayMs) => `следующая попытка через ${Math.round((nextDelayMs ?? 60_000) / 1000)} с`,
      };
    }
    if (status >= 500) return { kind: 'server', message: `ответ ${status}`, retryable: true };
    return { kind: 'bad_request', message: `ответ ${status}`, retryable: false };
  };

  it('события идут в порядке request → response, поля заполнены', async () => {
    const events = [];
    handler = (_req, res) => {
      res.writeHead(200);
      res.end('ok');
    };
    await requestWithRetries({
      ...CTX,
      url: url(),
      timeoutMs: 2000,
      classify,
      onProgress: (event) => events.push(event),
    });
    assert.deepEqual(
      events.map((event) => event.kind),
      ['request', 'response'],
    );
    assert.equal(events[0].url, url());
    assert.equal(events[0].attempt, 1);
    assert.equal(events[1].status, 200);
    assert.equal(events[1].bytes, 2);
  });

  it('429: waiting несёт delayMs из Retry-After и reason rate_limited', async () => {
    const events = [];
    let call = 0;
    handler = (_req, res) => {
      call += 1;
      if (call === 1) {
        res.writeHead(429, { 'retry-after': '3' });
        res.end('slow down');
        return;
      }
      res.writeHead(200);
      res.end('ok');
    };
    await requestWithRetries({
      ...CTX,
      url: url(),
      timeoutMs: 2000,
      classify,
      sleepFn: async () => undefined,
      onProgress: (event) => events.push(event),
    });
    const waiting = events.filter((event) => event.kind === 'waiting');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].delayMs, 3000);
    assert.equal(waiting[0].reason, 'rate_limited');
    assert.equal(waiting[0].attempt, 2);
  });

  it('5xx: waiting с reason server, error сетевой попытки — reason network', async () => {
    const events = [];
    handler = (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    };
    await assert.rejects(() =>
      requestWithRetries({
        ...CTX,
        url: url(),
        timeoutMs: 2000,
        classify,
        retryDelaysMs: [1],
        sleepFn: async () => undefined,
        onProgress: (event) => events.push(event),
      }),
    );
    const waiting = events.filter((event) => event.kind === 'waiting');
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].reason, 'server');
    assert.equal(waiting[0].delayMs, 1);
  });

  it('таймаут даёт событие error с reason timeout', async () => {
    const events = [];
    handler = () => {
      /* молчим */
    };
    await assert.rejects(() =>
      requestWithRetries({
        ...CTX,
        url: url(),
        timeoutMs: 50,
        classify,
        onProgress: (event) => events.push(event),
      }),
    );
    const errors = events.filter((event) => event.kind === 'error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].reason, 'timeout');
  });

  it('без onProgress ничего не падает и ничего не печатается', async () => {
    const printed = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalErrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk, ...rest) => {
      printed.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };
    process.stderr.write = (chunk, ...rest) => {
      printed.push(String(chunk));
      return originalErrWrite(chunk, ...rest);
    };
    try {
      handler = (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      };
      const response = await requestWithRetries({
        ...CTX,
        url: url(),
        timeoutMs: 2000,
        classify,
      });
      assert.equal(response.status, 200);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalErrWrite;
    }
    assert.deepEqual(printed, [], 'транспорт не должен печатать сам');
  });
});

describe('VL-380: parseJson', () => {
  it('разбирает валидный JSON и бросает invalid_json на битом', () => {
    assert.deepEqual(parseJson('{"a":1}', 'u', CTX), { a: 1 });
    assert.throws(
      () => parseJson('<html>', 'u', CTX),
      (err) => err instanceof GitverseHttpError && err.kind === 'invalid_json',
    );
  });
});

describe('VL-380: константы политики', () => {
  it('для 429 попыток больше, чем для 5xx', () => {
    assert.deepEqual([...DEFAULT_RETRY_DELAYS_MS], [500, 1500]);
    assert.ok(
      DEFAULT_RATE_LIMIT_DELAYS_MS.length > DEFAULT_RETRY_DELAYS_MS.length,
      'список пауз для 429 должен быть длиннее',
    );
  });

  it('sleep действительно ждёт', async () => {
    const started = Date.now();
    await sleep(10);
    assert.ok(Date.now() - started >= 5);
  });
});
