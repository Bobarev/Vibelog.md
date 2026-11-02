/**
 * Тесты проверок окружения wizard-а (VL-210).
 *
 * Сеть и spawn инъектируются: fetchImpl/spawnImpl — реальные запросы в
 * тестах запрещены (fetch-guard VL-132, spawn-guard VL-226).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { checkAgentBinary, checkTelegramToken, pingLlm } from '../../dist/core/setup-check.js';

/** Минимальный ActiveModel для ping-а. */
function active(over = {}) {
  return {
    id: 'p1/m1',
    label: 'M1',
    providerId: 'p1',
    model: 'm1',
    apiMode: 'chat',
    baseUrl: 'https://api.example/v1',
    apiKey: 'key',
    ...over,
  };
}

/** Фейковый fetch: запоминает URL/тело, отдаёт заданный ответ. */
function fakeFetch(response, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: async () => response.text ?? '{}',
    };
  };
}

describe('VL-210 — проверки окружения', () => {
  it('pingLlm (chat) идёт на /chat/completions и отдаёт usage', async () => {
    const calls = [];
    const res = await pingLlm(active(), {
      fetchImpl: fakeFetch(
        { text: JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }) },
        calls,
      ),
    });
    assert.equal(calls[0].url, 'https://api.example/v1/chat/completions');
    assert.equal(res.ok, true);
    assert.deepEqual(res.usage, { input: 3, output: 1, total: 4 });
    assert.ok(res.latencyMs >= 0);
  });

  it('pingLlm (responses) идёт на /responses и читает input/output_tokens', async () => {
    const calls = [];
    const res = await pingLlm(active({ apiMode: 'responses' }), {
      fetchImpl: fakeFetch(
        { text: JSON.stringify({ usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } }) },
        calls,
      ),
    });
    assert.equal(calls[0].url, 'https://api.example/v1/responses');
    assert.deepEqual(res.usage, { input: 5, output: 2, total: 7 });
  });

  it('pingLlm 401 → ok:false с bodySnippet', async () => {
    const res = await pingLlm(active(), {
      fetchImpl: fakeFetch({ ok: false, status: 401, text: '{"error":"unauthorized"}' }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.ok(res.error?.includes('401'), res.error);
    assert.ok(res.bodySnippet?.includes('unauthorized'), res.bodySnippet);
  });

  it('pingLlm обрезает длинное тело ответа', async () => {
    const res = await pingLlm(active(), {
      fetchImpl: fakeFetch({ ok: false, status: 500, text: 'x'.repeat(1000) }),
    });
    assert.ok((res.bodySnippet?.length ?? 0) <= 301, String(res.bodySnippet?.length));
  });

  it('pingLlm не бросает при сетевой ошибке', async () => {
    const res = await pingLlm(active(), {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('ECONNREFUSED'), res.error);
  });

  it('pingLlm не бросает при таймауте', async () => {
    const res = await pingLlm(active(), {
      timeoutMs: 1,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('не ответил'), res.error);
  });

  it('pingLlm не-JSON 200 → ok:false с подсказкой про base_url', async () => {
    const res = await pingLlm(active(), { fetchImpl: fakeFetch({ text: '<html>oops</html>' }) });
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('base_url'), res.error);
  });

  it('checkAgentBinary: бинарь не найден → found:false с подсказкой установки', () => {
    const res = checkAgentBinary('qwen', {
      spawnImpl: () => ({ status: 1, stdout: '', stderr: '', error: undefined }),
    });
    assert.equal(res.found, false);
    assert.ok(res.error?.includes('npm i -g @qwen-code/qwen-code'), res.error);
  });

  it('checkAgentBinary: найден, версия >= 0.24', () => {
    const res = checkAgentBinary('qwen', {
      spawnImpl: (cmd) =>
        cmd === 'which'
          ? { status: 0, stdout: '/usr/local/bin/qwen\n', stderr: '' }
          : { status: 0, stdout: '0.25.1\n', stderr: '' },
    });
    assert.equal(res.found, true);
    assert.equal(res.version, '0.25.1');
    assert.equal(res.error, undefined);
  });

  it('checkAgentBinary: устаревшая версия qwen → error', () => {
    const res = checkAgentBinary('qwen', {
      spawnImpl: (cmd) =>
        cmd === 'which'
          ? { status: 0, stdout: '/usr/local/bin/qwen\n', stderr: '' }
          : { status: 0, stdout: '0.20.0\n', stderr: '' },
    });
    assert.equal(res.found, true);
    assert.ok(res.error?.includes('0.24'), res.error);
  });

  it('checkTelegramToken: ok с username', async () => {
    const res = await checkTelegramToken('123:abc', {
      fetchImpl: fakeFetch({ text: JSON.stringify({ ok: true, result: { username: 'my_bot' } }) }),
    });
    assert.equal(res.ok, true);
    assert.equal(res.username, 'my_bot');
  });

  it('checkTelegramToken: невалидный токен → ok:false без токена в тексте', async () => {
    const res = await checkTelegramToken('123:secret-token', {
      fetchImpl: fakeFetch({ ok: false, status: 401, text: JSON.stringify({ ok: false, description: 'Unauthorized' }) }),
    });
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('Токен невалиден'), res.error);
    assert.ok(!res.error?.includes('secret-token'), 'токен не должен попадать в ошибку');
  });

  it('checkTelegramToken: пустой токен → ok:false', async () => {
    const res = await checkTelegramToken('');
    assert.equal(res.ok, false);
    assert.ok(res.error?.includes('Токен не задан'), res.error);
  });
});
