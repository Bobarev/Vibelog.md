/**
 * Тесты VL-83 — LLM-клиент Cloud.ru (src/agent/llm.ts).
 *
 * Все кейсы на мок-fetch без сети: SSE-стрим (сборка текста, tool_calls по
 * индексам, usage), non-200, фолбэк non-stream, ретраи на сетевые ошибки.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLlmClient, messagesToInput, parseNonStreamResponses, sanitizeWireMessages } from '../../dist/agent/llm.js';

/** Фейковый Response со SSE-телом: строки data: {...} / data: [DONE]. */
function sseResponse(events, { status = 200, statusText = 'OK', bodyText = '' } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    body,
    // VL-178: тело не-ok ответа читается клиентом для детекта «high risk»
    text: async () => bodyText,
  };
}

/** Фейковый Response с JSON-телом (non-stream фолбэк). */
function jsonResponse(obj, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    json: async () => obj,
    // VL-178: text() для детекта маркера в не-ok ответах (json() при throw не вызывается)
    text: async () => JSON.stringify(obj),
  };
}

/** Обёртка fetchImpl со счётчиком вызовов, телами запросов и очередью ответов/ошибок. */
function fakeFetch(script) {
  const state = { calls: 0, bodies: [], headers: [], urls: [] };
  const impl = async (_url, init) => {
    state.urls.push(_url);
    state.bodies.push(typeof init?.body === 'string' ? init.body : '');
    state.headers.push(init?.headers ?? {});
    const step = script[state.calls] ?? script[script.length - 1];
    state.calls++;
    if (step instanceof Error) throw step;
    return step;
  };
  return { impl, state };
}

/**
 * Базовые опции клиента для всех тестов файла. apiMode задан явно (VL-240):
 * createLlmClient без него резолвит активную модель через
 * resolveActiveModel(process.cwd()) и подхватывает models.default из локального
 * (gitignored) .vibelog/settings.json — при api_mode: responses адрес уезжает
 * на /responses и 24 теста падают на машине разработчика (lesson-78/84).
 */
const CLIENT_OPTS = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', retryDelayMs: 1, apiMode: 'chat' };

describe('createLlmClient / streamChat (VL-83)', () => {
  it('собирает текст по onToken из SSE-потока', async () => {
    const { impl, state } = fakeFetch([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'Привет' } }] }),
        JSON.stringify({ choices: [{ delta: { content: ', мир!' } }] }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const tokens = [];
    const res = await client.streamChat([{ role: 'user', content: 'x' }], undefined, {
      onToken: (t) => tokens.push(t),
    });
    assert.equal(res.text, 'Привет, мир!');
    assert.deepEqual(tokens, ['Привет', ', мир!']);
    assert.deepEqual(res.toolCalls, []);
    assert.equal(state.calls, 1);
  });

  it('склеивает фрагменты tool_calls по индексам и парсит аргументы', async () => {
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 1, id: 'call_2', function: { name: 'glob', arguments: '{"pattern":"*.ts"}' } },
                ],
              },
            },
          ],
        }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.toolCalls.length, 2);
    assert.deepEqual(res.toolCalls[0], {
      id: 'call_1',
      name: 'read_file',
      arguments: { path: 'a.ts' },
    });
    assert.deepEqual(res.toolCalls[1], {
      id: 'call_2',
      name: 'glob',
      arguments: { pattern: '*.ts' },
    });
  });

  it('маппит usage из последнего чанка (prompt/completion → input/output)', async () => {
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.deepEqual(res.usage, {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      total_tokens: 15,
      // VL-198: reasoning_tokens читается mapUsage, 0 без completion_tokens_details
      reasoning_tokens: 0,
    });
  });

  it('VL-96: кэш из prompt_tokens_details.cached_tokens (OpenAI-стиль Cloud.ru)', async () => {
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 80 } },
        }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.usage.cache_read_input_tokens, 80);
  });

  it('VL-96: кэш из prompt_cache_hit_tokens (DeepSeek-стиль)', async () => {
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: 'ok' } }],
          usage: { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53, prompt_cache_hit_tokens: 40 },
        }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.usage.cache_read_input_tokens, 40);
  });

  it('VL-96: прямое cache_read важнее вложенного prompt_tokens_details', async () => {
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, cache_read_input_tokens: 60, prompt_tokens_details: { cached_tokens: 1 } },
        }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.usage.cache_read_input_tokens, 60);
  });

  it('VL-96: VIBELOG_LLM_DEBUG_USAGE=1 печатает сырой usage в stderr', async () => {
    const prev = process.env.VIBELOG_LLM_DEBUG_USAGE;
    const origError = console.error;
    const captured = [];
    process.env.VIBELOG_LLM_DEBUG_USAGE = '1';
    console.error = (...args) => captured.push(args.join(' '));
    try {
      const { impl } = fakeFetch([
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: 'ok' } }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }),
        ]),
      ]);
      const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
      await client.streamChat([{ role: 'user', content: 'x' }], []);
    } finally {
      console.error = origError;
      if (prev === undefined) delete process.env.VIBELOG_LLM_DEBUG_USAGE;
      else process.env.VIBELOG_LLM_DEBUG_USAGE = prev;
    }
    assert.ok(captured.some((l) => l.includes('usage raw:') && l.includes('prompt_tokens')), 'debug-дамп usage в stderr');
  });

  it('не-retryable 4xx: стрим 400 + фолбэк non-stream 400 → ошибка со статусом', async () => {
    const { impl, state } = fakeFetch([
      sseResponse([], { status: 400, statusText: 'Bad Request' }),
      jsonResponse({ error: 'bad' }, { status: 400, statusText: 'Bad Request' }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await assert.rejects(
      () => client.streamChat([{ role: 'user', content: 'x' }], []),
      (err) => {
        assert.match(err.message, /Ошибка API Cloud.ru/);
        assert.match(err.message, /400/);
        return true;
      },
    );
    assert.equal(state.calls, 2);
  });

  it('стрим 500 (ретраи исчерпаны) → фолбэк non-stream успешен', async () => {
    const serverError = () => sseResponse([], { status: 500, statusText: 'Server Error' });
    const { impl, state } = fakeFetch([
      serverError(),
      serverError(),
      serverError(),
      serverError(),
      jsonResponse({
        choices: [{ message: { content: 'из фолбэка' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const tokens = [];
    const res = await client.streamChat([{ role: 'user', content: 'x' }], undefined, {
      onToken: (t) => tokens.push(t),
    });
    assert.equal(res.text, 'из фолбэка');
    assert.equal(tokens.join(''), 'из фолбэка'); // non-stream текст нарезается по словам
    assert.equal(res.usage.input_tokens, 1);
    // 4 стрим-попытки (1 + 3 ретрая) + 1 non-stream
    assert.equal(state.calls, 5);
  });

  it('сетевые ошибки: падает дважды → успех на 3-й попытке', async () => {
    const { impl, state } = fakeFetch([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.text, 'ok');
    assert.equal(state.calls, 3);
  });

  it('сетевые ошибки: 4+ раза подряд → ошибка с русским текстом', async () => {
    const { impl, state } = fakeFetch([new TypeError('fetch failed')]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, maxRetries: 3 });
    await assert.rejects(
      () => client.streamChat([{ role: 'user', content: 'x' }], []),
      (err) => {
        assert.match(err.message, /Сетевая ошибка при запросе к LLM/);
        return true;
      },
    );
    // Множение попыток (VL-103): внутренние ретраи requestWithRetry (4 fetch
    // на стрим-попытку) × внешний цикл стрим-попыток (4) + non-stream фолбэк
    // (4) = 20 fetch-вызовов до финальной ошибки (комментарий риска VL-103).
    assert.equal(state.calls, 20);
  });

  it('битый JSON в non-stream ответе → ошибка', async () => {
    const serverError = () => sseResponse([], { status: 500, statusText: 'Server Error' });
    const { impl } = fakeFetch([
      serverError(),
      serverError(),
      serverError(),
      serverError(),
      {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => {
          throw new SyntaxError('bad json');
        },
      },
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await assert.rejects(
      () => client.streamChat([{ role: 'user', content: 'x' }], []),
      /Сетевая ошибка|невалидный JSON/,
    );
  });

  it('без модели (нет env) — createLlmClient кидает понятную ошибку', () => {
    const prev = process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_MODEL;
    // VL-240: cwd — пустой временный каталог, иначе resolveActiveModel
    // подхватит models.default из локального .vibelog/settings.json и ошибки не будет
    const emptyDir = mkdtempSync(join(tmpdir(), 'vb-llm-nomodel-'));
    try {
      assert.throws(
        () => createLlmClient({ baseUrl: 'https://x/v1', cwd: emptyDir, fetchImpl: async () => jsonResponse({}) }),
        /VIBELOG_LLM_MODEL/,
      );
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      if (prev !== undefined) process.env.VIBELOG_LLM_MODEL = prev;
    }
  });

  it('abort-сигнал прерывает ожидание ретрая', async () => {
    const controller = new AbortController();
    const { impl } = fakeFetch([new TypeError('fetch failed'), sseResponse([])]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, retryDelayMs: 5000 });
    const promise = client.streamChat([{ role: 'user', content: 'x' }], [], { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(promise, /прервана/);
  });
});

/**
 * SSE-ответ, чьё тело бросает ошибку при чтении (обрыв mid-body, VL-103):
 * undici кидает TypeError terminated, когда сервер закрывает соединение
 * до конца ответа — именно так падала фаза VL-100 в логе постановки.
 */
function sseResponseThatThrows(error) {
  const body = new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  });
  return { ok: true, status: 200, statusText: 'OK', headers: new Headers(), body };
}

describe('createLlmClient: ретраи обрыва стрима (VL-103)', () => {
  it('обрыв тела на первой попытке → ретрай стрима, успех на второй', async () => {
    const { impl, state } = fakeFetch([
      sseResponseThatThrows(new TypeError('terminated')),
      sseResponse([JSON.stringify({ choices: [{ delta: { content: 'вторая попытка' } }] })]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.text, 'вторая попытка');
    assert.ok(state.calls >= 2, 'fetch должен быть вызван минимум дважды');
  });

  it('все стрим-попытки обрываются → результат из non-stream фолбэка', async () => {
    const terminated = () => sseResponseThatThrows(new TypeError('terminated'));
    const { impl, state } = fakeFetch([
      terminated(), terminated(), terminated(), terminated(),
      jsonResponse({
        choices: [{ message: { content: 'из non-stream' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.text, 'из non-stream');
    assert.equal(res.usage.input_tokens, 1);
  });

  it('обрыв и стрима, и фолбэка → русская ошибка с числом попыток и terminated', async () => {
    const { impl, state } = fakeFetch([new TypeError('terminated')]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, maxRetries: 3 });
    await assert.rejects(
      () => client.streamChat([{ role: 'user', content: 'x' }], []),
      (err) => {
        assert.match(err.message, /Сетевая ошибка LLM/);
        assert.match(err.message, /после 4 попыток и non-stream фолбэка/);
        assert.match(err.message, /terminated/);
        assert.match(err.message, /Диагностика/);
        return true;
      },
    );
    // Множение попыток (VL-103): 4 стрим-попытки × 4 fetch внутри
    // requestWithRetry + 4 non-stream = 20 вызовов fetch
    assert.equal(state.calls, 20);
  });

  it('abort во время паузы между ретраями стрима → «Операция прервана», без ретраев', async () => {
    const controller = new AbortController();
    const { impl, state } = fakeFetch([sseResponseThatThrows(new TypeError('terminated'))]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, retryDelayMs: 5000 });
    const promise = client.streamChat([{ role: 'user', content: 'x' }], [], { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(promise, /прервана/);
    assert.equal(state.calls, 1, 'вторая попытка не должна стартовать');
  });
});

// ── VL-178: отказ провайдера «high risk» → повтор с усечённым payload ──

describe('отказ «high risk» → shrink-повтор (VL-178)', () => {
  const HIGH_RISK_BODY =
    '{"error":{"message":"The request was rejected because it was considered high risk"}}';

  /** Диалог с гигантским tool-выводом (как снапшот 624 КБ). */
  const bigToolMessages = () => [
    { role: 'user', content: 'сделай' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', name: 'chrome_devtools__take_snapshot', arguments: {} }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'с'.repeat(624 * 1024) },
  ];

  const okStream = () =>
    sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ок' } }] })]);

  it('стрим 400 + фолбэк 400 с маркером → повтор с tool ≤4096 → успех', async () => {
    const { impl, state } = fakeFetch([
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: HIGH_RISK_BODY }),
      jsonResponse({ error: HIGH_RISK_BODY }, { status: 400, statusText: 'Bad Request' }),
      okStream(),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat(bigToolMessages(), []);
    assert.equal(res.text, 'ок');
    // 2 вызова на полном payload (стрим + фолбэк) + 1 стрим-повтор с L1-усечением
    assert.equal(state.calls, 3);
    // В L1-повторе tool-сообщение ≤ 4096 + маркер (wire-cap 8KB уже оставил 8KB,
    // shrink идёт по messages, а не по wire — проверяем маркер усечения)
    const l1Body = JSON.parse(state.bodies[2]);
    const toolMsg = l1Body.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg.content.length <= 4096 + 200, `L1-длина ${toolMsg.content.length}`);
    assert.match(toolMsg.content, /усечён до 4096/);
  });

  it('оба shrink-уровня отвергнуты → throw с текстом провайдера, вызовов = 6', async () => {
    const reject400 = () =>
      jsonResponse({ error: HIGH_RISK_BODY }, { status: 400, statusText: 'Bad Request' });
    const rejectStream = () =>
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: HIGH_RISK_BODY });
    const { impl, state } = fakeFetch([rejectStream(), reject400()]); // повторяется для всех вызовов
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await assert.rejects(
      () => client.streamChat(bigToolMessages(), []),
      (err) => {
        assert.match(err.message, /high risk/i);
        assert.match(err.message, /400/);
        return true;
      },
    );
    // full (2: стрим+фолбэк) + L1 (2) + L2 (2) = 6; HIGH_RISK_MAX_SHRINKS=2 исчерпан
    assert.equal(state.calls, 6);
    // Последний payload — уровень L2 (≤1024)
    const l2Body = JSON.parse(state.bodies.at(-1));
    const toolMsg = l2Body.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg.content.length <= 1024 + 200, `L2-длина ${toolMsg.content.length}`);
  });

  it('VL-199: high-risk в тексте при HTTP 200 → диагностический лог payload/usage, ответ возвращается', async () => {
    const HR = 'The request was rejected because it was considered high risk';
    const { impl } = fakeFetch([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: HR } }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }),
      ]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const origError = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    let res;
    try {
      res = await client.streamChat(bigToolMessages(), []);
    } finally {
      console.error = origError;
    }
    // Детект текста — работа loop.ts; клиент только логирует и возвращает ответ
    assert.equal(res.text, HR, 'ответ возвращается как есть');
    const line = captured.find((l) => l.includes('high-risk в тексте при HTTP 200'));
    assert.ok(line, `нет диагностического лога, captured: ${JSON.stringify(captured)}`);
    assert.match(line, /payload=\d+ байт/, 'размер wire-payload');
    assert.ok(Number(line.match(/payload=(\d+)/)[1]) > 0, 'payload > 0');
    assert.match(line, /usage=\{/, 'данные usage');
    assert.match(line, /input_tokens/, 'usage-токены в логе');
  });

  it('VL-199: high-risk-отказ HTTP (не-ok) → диагностический лог payload и shrink-уровня', async () => {
    const { impl } = fakeFetch([
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: HIGH_RISK_BODY }),
      jsonResponse({ error: HIGH_RISK_BODY }, { status: 400, statusText: 'Bad Request' }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const origError = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    try {
      await assert.rejects(() => client.streamChat(bigToolMessages(), []), /high risk/i);
    } finally {
      console.error = origError;
    }
    const lines = captured.filter((l) => l.includes('high-risk-отказ HTTP'));
    assert.ok(lines.length > 0, `нет диагностического лога, captured: ${JSON.stringify(captured)}`);
    assert.match(lines[0], /payload=\d+ байт/, 'размер wire-payload');
    assert.match(lines[0], /shrink-уровень=0/, 'уровень до повтора');
    assert.match(lines[0], /usage=н\/д/, 'без предыдущих успешных запросов usage=н/д');
  });

  // ── VL-203: wire-payload и usage в диагностике ──

  it('VL-203: успешный ответ несёт payloadBytes и shrinkLevel', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat(bigToolMessages(), []);
    assert.equal(typeof res.payloadBytes, 'number');
    assert.ok(res.payloadBytes > 0, 'payloadBytes > 0');
    // Байты считаны от фактического wire-body (JSON, ушедший в fetch)
    assert.equal(res.payloadBytes, Buffer.byteLength(state.bodies[0], 'utf8'));
    assert.equal(res.shrinkLevel, 0, 'без повторов — уровень full');
  });

  it('VL-203: повтор после high-risk → shrinkLevel=1 у успешного ответа', async () => {
    const { impl } = fakeFetch([
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: HIGH_RISK_BODY }),
      jsonResponse({ error: HIGH_RISK_BODY }, { status: 400, statusText: 'Bad Request' }),
      okStream(),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const res = await client.streamChat(bigToolMessages(), []);
    assert.equal(res.text, 'ок');
    assert.equal(res.shrinkLevel, 1, 'один shrink-повтор применён');
    assert.ok(res.payloadBytes > 0);
  });

  it('VL-203 (AC2): отказ после успешного запроса → в логе usage предыдущего ответа', async () => {
    const { impl } = fakeFetch([
      // 1-й вызов streamChat: успех с usage
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: 'ок' } }],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        }),
      ]),
      // 2-й вызов: high-risk отказ (стрим + фолбэк)
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: HIGH_RISK_BODY }),
      jsonResponse({ error: HIGH_RISK_BODY }, { status: 400, statusText: 'Bad Request' }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    const origError = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    try {
      await client.streamChat([{ role: 'user', content: 'x' }], []);
      await assert.rejects(() => client.streamChat(bigToolMessages(), []), /high risk/i);
    } finally {
      console.error = origError;
    }
    const line = captured.find((l) => l.includes('high-risk-отказ HTTP'));
    assert.ok(line, `нет лога отказа, captured: ${JSON.stringify(captured)}`);
    assert.match(line, /payload=\d+ байт/, 'байты payload отказа');
    // AC2: usage предыдущего успешного запроса, а не «н/д»
    assert.ok(!line.includes('usage=н/д'), 'usage должен быть известен');
    assert.match(line, /input_tokens.:42/, 'usage предыдущего успешного запроса в логе');
    assert.match(line, /предыдущего успешного запроса/, 'подпись источника usage');
  });

  it('обычный 400 без маркера → без shrink-повторов (регрессия VL-83)', async () => {
    const { impl, state } = fakeFetch([
      sseResponse([], { status: 400, statusText: 'Bad Request', bodyText: '{"error":"bad"}' }),
      jsonResponse({ error: 'bad' }, { status: 400, statusText: 'Bad Request' }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await assert.rejects(
      () => client.streamChat(bigToolMessages(), []),
      /Ошибка API Cloud.ru/,
    );
    assert.equal(state.calls, 2, 'shrink-повторов быть не должно');
  });

  it('wire-cap: tool-сообщение >8KB усечено в теле запроса (resume старых jsonl)', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(bigToolMessages(), []);
    const body = JSON.parse(state.bodies[0]);
    const toolMsg = body.messages.find((m) => m.role === 'tool');
    assert.ok(
      toolMsg.content.length <= 8 * 1024 + 200,
      `длина ${toolMsg.content.length} — wire-cap 8KB не применился`,
    );
    assert.match(toolMsg.content, /вывод обрезан/);
    // Структура цела: tool_call_id не изменился (парность tool_calls ↔ tool)
    assert.equal(toolMsg.tool_call_id, 'c1');
  });

  it('VL-198: usage из assistant-сообщения НЕ уходит провайдеру в wire', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(
      [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: 'ответ',
          usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 12, reasoning_tokens: 0 },
        },
      ],
      [],
    );
    const body = JSON.parse(state.bodies[0]);
    const assistant = body.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant.content, 'ответ');
    assert.equal('usage' in assistant, false, 'usage — наше поле, провайдеру не уходить');
  });

  it('VL-203: payload_bytes/shrink_level из assistant-сообщения НЕ уходят провайдеру в wire', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(
      [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: 'ответ',
          usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 12, reasoning_tokens: 0 },
          payload_bytes: 140_000,
          shrink_level: 1,
        },
      ],
      [],
    );
    const body = JSON.parse(state.bodies[0]);
    const assistant = body.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant.content, 'ответ');
    assert.equal('payload_bytes' in assistant, false, 'payload_bytes — диагностика, провайдеру не уходить');
    assert.equal('shrink_level' in assistant, false, 'shrink_level — диагностика, провайдеру не уходить');
  });

  it('VL-198: X-Session-Id уходит только при заданном sessionId', async () => {
    const { impl, state } = fakeFetch([okStream(), okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, sessionId: 'agent-123' });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(state.headers[0]['X-Session-Id'], 'agent-123');
    // без sessionId заголовка нет
    const plain = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await plain.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal('X-Session-Id' in state.headers[1], false);
  });
});

// ── VL-315: апстрим (vendor) — структурно в теле, имя модели без @-хвоста ──

describe('vendor в wire-body (VL-315)', () => {
  /** Пустой успешный SSE-ответ (текста нет — нам нужен только wire-body). */
  const okStream = () => sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })]);

  it('chat: provider.order + allow_fallbacks=false, имя модели без @-хвоста', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({
      ...CLIENT_OPTS,
      model: 'deepseek/deepseek-v4.1-flash@provider=baidu&allow_fallbacks=false',
      fetchImpl: impl,
    });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    const body = JSON.parse(state.bodies[0]);
    assert.equal(body.model, 'deepseek/deepseek-v4.1-flash', 'имя без @-хвоста');
    assert.deepEqual(body.provider, { order: ['baidu'], allow_fallbacks: false });
  });

  it('responses: provider тоже уходит в тело (проверено живым запросом)', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({
      ...CLIENT_OPTS,
      apiMode: 'responses',
      vendor: 'makora',
      fetchImpl: impl,
    });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    const body = JSON.parse(state.bodies[0]);
    assert.equal(body.model, 'm');
    assert.deepEqual(body.provider, { order: ['makora'], allow_fallbacks: false });
  });

  it('без vendor поля provider в теле нет (поведение как раньше)', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    const body = JSON.parse(state.bodies[0]);
    assert.equal('provider' in body, false);
  });

  it('явная опция vendor приоритетнее @-хвоста', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({
      ...CLIENT_OPTS,
      model: 'm@provider=baidu',
      vendor: 'morph',
      fetchImpl: impl,
    });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    const body = JSON.parse(state.bodies[0]);
    assert.equal(body.model, 'm');
    assert.deepEqual(body.provider, { order: ['morph'], allow_fallbacks: false });
  });
});

// ── VL-205: Responses API — переключатель api_mode ──

describe('messagesToInput (VL-205)', () => {
  it('system/user → message-итемы, assistant → message + function_call, tool → function_call_output', () => {
    const input = messagesToInput([
      { role: 'system', content: 'ты — ассистент' },
      { role: 'user', content: 'привет' },
      {
        role: 'assistant',
        content: 'сейчас посмотрю',
        tool_calls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'a.ts' } }],
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7, reasoning_tokens: 0 },
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'содержимое файла' },
    ]);
    assert.deepEqual(input, [
      { type: 'message', role: 'system', content: 'ты — ассистент' },
      { type: 'message', role: 'user', content: 'привет' },
      { type: 'message', role: 'assistant', content: 'сейчас посмотрю' },
      { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.ts"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'содержимое файла' },
    ]);
    // usage (VL-198) не утекает провайдеру
    assert.equal(JSON.stringify(input).includes('usage'), false);
  });

  it('assistant content=null с tool_calls → message-итем пропускается, остаются function_call', () => {
    const input = messagesToInput([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 'glob', arguments: {} }] },
    ]);
    assert.deepEqual(input, [
      { type: 'function_call', call_id: 'c1', name: 'glob', arguments: '{}' },
    ]);
  });

  it('tool-вывод усекается через truncateTool (wire-cap VL-178)', () => {
    // VL-216: вход приведён к валидной паре (assistant объявляет c1) —
    // одиночный tool без объявления санация вырезает как осиротевший
    const input = messagesToInput(
      [
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 'read_file', arguments: {} }] },
        { role: 'tool', tool_call_id: 'c1', content: 'x'.repeat(100) },
      ],
      (s) => s.slice(0, 10) + '…[усечён]',
    );
    assert.equal(input[1].output, 'xxxxxxxxxx…[усечён]');
  });
});

describe('Responses API non-stream parsing (VL-205)', () => {
  it('output[] → текст из message/output_text + tool_calls из function_call + usage из details', () => {
    const res = parseNonStreamResponses({
      id: 'resp_1',
      output: [
        { type: 'reasoning', content: [], summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Ответ ' },
            { type: 'output_text', text: 'модели' },
          ],
        },
        { type: 'function_call', call_id: 'fc_1', name: 'read_file', arguments: '{"path":"a.ts"}' },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 40,
        total_tokens: 140,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens_details: { reasoning_tokens: 12 },
      },
    });
    assert.equal(res.text, 'Ответ модели');
    assert.equal(res.toolCalls.length, 1);
    assert.deepEqual(res.toolCalls[0], {
      id: 'fc_1',
      name: 'read_file',
      arguments: { path: 'a.ts' },
    });
    assert.equal(res.usage.input_tokens, 100);
    assert.equal(res.usage.output_tokens, 40);
    assert.equal(res.usage.cache_read_input_tokens, 30);
    assert.equal(res.usage.reasoning_tokens, 12);
    assert.equal(res.usage.total_tokens, 140);
  });

  it('битое тело (нет output[]) → пустой ответ, без throw', () => {
    const res = parseNonStreamResponses({ id: 'resp_2' });
    assert.equal(res.text, '');
    assert.deepEqual(res.toolCalls, []);
    assert.equal(res.usage.input_tokens, 0);
  });
});

describe('Responses API streaming + переключатель api_mode (VL-205)', () => {
  it('typed-события: output_text.delta → текст, function_call → tool_calls, completed → usage', async () => {
    const events = [
      JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }),
      JSON.stringify({ type: 'response.output_text.delta', delta: 'Привет' }),
      JSON.stringify({ type: 'response.output_text.delta', delta: ', мир!' }),
      JSON.stringify({
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'fc_9', name: 'glob', arguments: '' },
      }),
      JSON.stringify({
        type: 'response.function_call_arguments.delta',
        output_index: 1,
        delta: '{"pattern":',
      }),
      JSON.stringify({
        type: 'response.function_call_arguments.delta',
        output_index: 1,
        delta: '"*.ts"}',
      }),
      JSON.stringify({
        type: 'response.function_call_arguments.done',
        output_index: 1,
        arguments: '{"pattern":"*.ts"}',
      }),
      JSON.stringify({
        type: 'response.completed',
        response: { usage: { input_tokens: 10, output_tokens: 4, output_tokens_details: { reasoning_tokens: 2 } } },
      }),
    ];
    const { impl, state } = fakeFetch([sseResponse(events)]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'responses' });
    const tokens = [];
    const res = await client.streamChat([{ role: 'user', content: 'x' }], undefined, {
      onToken: (t) => tokens.push(t),
    });
    assert.equal(res.text, 'Привет, мир!');
    assert.deepEqual(tokens, ['Привет', ', мир!']);
    assert.equal(res.toolCalls.length, 1);
    assert.deepEqual(res.toolCalls[0], { id: 'fc_9', name: 'glob', arguments: { pattern: '*.ts' } });
    assert.equal(res.usage.input_tokens, 10);
    assert.equal(res.usage.output_tokens, 4);
    assert.equal(res.usage.reasoning_tokens, 2);
    // URL и тело: /responses, input[] (не messages), stream без stream_options
    assert.equal(state.urls[0], 'https://llm.test/v1/responses');
    const body = JSON.parse(state.bodies[0]);
    assert.ok(Array.isArray(body.input), 'input[] вместо messages');
    assert.equal('messages' in body, false);
    assert.equal(body.stream, true);
    assert.equal('stream_options' in body, false, 'stream_options — chat-специфика');
  });

  it('error-событие → throw с текстом провайдера', async () => {
    const { impl } = fakeFetch([
      sseResponse([JSON.stringify({ type: 'error', message: 'модель недоступна' })]),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'responses', maxRetries: 0 });
    await assert.rejects(
      () => client.streamChat([{ role: 'user', content: 'x' }], []),
      /Ошибка API \(Responses\): модель недоступна/,
    );
  });

  it('session_id в теле запроса (ref-18: приоритет тела), tools — плоский формат', async () => {
    const { impl, state } = fakeFetch([sseResponse([])]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'responses', sessionId: 'agent-77' });
    await client.streamChat(
      [{ role: 'user', content: 'x' }],
      [{ name: 'read_file', description: 'чтение', inputSchema: { type: 'object' } }],
    );
    const body = JSON.parse(state.bodies[0]);
    assert.equal(body.session_id, 'agent-77');
    assert.deepEqual(body.tools, [
      { type: 'function', name: 'read_file', description: 'чтение', parameters: { type: 'object' } },
    ]);
    // X-Session-Id дублируется заголовком (оба поддержаны, ref-18)
    assert.equal(state.headers[0]['X-Session-Id'], 'agent-77');
  });

  it('stateless (MVP): previous_response_id не передаётся, input несёт всю историю', async () => {
    const history = [
      { role: 'user', content: 'задача' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 'glob', arguments: {} }] },
      { role: 'tool', tool_call_id: 'c1', content: 'найдено' },
      { role: 'user', content: 'продолжай' },
    ];
    const { impl, state } = fakeFetch([sseResponse([])]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'responses' });
    await client.streamChat(history, []);
    const raw = state.bodies[0];
    assert.equal(raw.includes('previous_response_id'), false, 'ref-20: MiMo не поддерживает, stateless');
    assert.equal(raw.includes('"store"'), false);
    const body = JSON.parse(raw);
    assert.equal(body.input.length, 4, 'вся история уходит каждый ход');
    // assistant-вызов → function_call, tool → function_call_output (связка по call_id)
    assert.deepEqual(body.input[1], {
      type: 'function_call',
      call_id: 'c1',
      name: 'glob',
      arguments: '{}',
    });
    assert.deepEqual(body.input[2], { type: 'function_call_output', call_id: 'c1', output: 'найдено' });
  });

  it('переключатель: дефолт chat → /chat/completions + messages (регрессия)', async () => {
    const { impl, state } = fakeFetch([sseResponse([])]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(state.urls[0], 'https://llm.test/v1/chat/completions');
    const body = JSON.parse(state.bodies[0]);
    assert.ok(Array.isArray(body.messages));
    assert.equal('input' in body, false);
    assert.equal(body.stream_options.include_usage, true, 'chat: usage в стриме через stream_options');
  });

  it('apiMode chat явно → тот же /chat/completions (эквивалент дефолта)', async () => {
    const { impl, state } = fakeFetch([sseResponse([])]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'chat' });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(state.urls[0], 'https://llm.test/v1/chat/completions');
  });

  it('responses non-stream фолбэк → parseNonStreamResponses (обрыв стрима)', async () => {
    const { impl, state } = fakeFetch([
      new Error('terminated'), // стрим упал сетевой ошибкой
      jsonResponse({
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'из фолбэка' }] }],
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    ]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'responses', maxRetries: 0 });
    const res = await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(res.text, 'из фолбэка');
    assert.equal(res.usage.input_tokens, 3);
    assert.equal(state.calls, 2);
  });
});

describe('createLlmClient: секции settings.json (VL-209)', () => {
  /** Temp-каталог с .vibelog/settings.json; ключ — env-переменная. */
  function fixture(settings) {
    const dir = mkdtempSync(join(tmpdir(), 'vb-llm-'));
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(settings));
    return dir;
  }

  const settingsFull = (extra = {}) => ({
    providers: { routerai: { base_url: 'https://routerai.test/api/v1', api_key_env: 'VL209_TEST_KEY' } },
    models: {
      default: 'routerai/Wire/Model',
      available: {
        'routerai/Wire/Model': { label: 'Wire', provider: 'routerai', model: 'Wire/Model', api_mode: 'chat', ...(extra.pricing ? { pricing: extra.pricing } : {}) },
      },
      ...extra.modelsExtra,
    },
    ...extra.top,
  });

  const saved = { key: process.env.VL209_TEST_KEY, model: process.env.VIBELOG_LLM_MODEL, base: process.env.VIBELOG_LLM_BASE_URL, api: process.env.VIBELOG_LLM_API_KEY };
  const restore = () => {
    for (const [k, v] of Object.entries({ VL209_TEST_KEY: saved.key, VIBELOG_LLM_MODEL: saved.model, VIBELOG_LLM_BASE_URL: saved.base, VIBELOG_LLM_API_KEY: saved.api })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  it('берёт model/base_url/api_key из секций settings.json', async () => {
    const dir = fixture(settingsFull());
    process.env.VL209_TEST_KEY = 'env-key';
    // защита от протечки env других тестов
    delete process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_BASE_URL;
    delete process.env.VIBELOG_LLM_API_KEY;
    try {
      const { impl, state } = fakeFetch([sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ок' } }] })])]);
      const client = createLlmClient({ cwd: dir, fetchImpl: impl, retryDelayMs: 1 });
      assert.equal(client.model, 'Wire/Model'); // wire-имя, не id
      await client.streamChat([{ role: 'user', content: 'x' }], undefined);
      assert.equal(state.urls[0], 'https://routerai.test/api/v1/chat/completions');
      assert.equal(state.headers[0].Authorization, 'Bearer env-key');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * VL-240: приоритет явной опции над settings.json. Тест держит фикстуру с
   * models.default → api_mode: responses и проверяет, что явный apiMode: 'chat'
   * всё равно даёт /chat/completions — инвариант, на котором стоит CLIENT_OPTS.
   */
  it('явный apiMode: chat перекрывает api_mode=responses из settings.json (VL-240, регресс)', async () => {
    const dir = fixture({
      providers: { routerai: { base_url: 'https://routerai.test/api/v1', api_key_env: 'VL209_TEST_KEY' } },
      models: {
        default: 'routerai/Resp',
        available: { 'routerai/Resp': { label: 'Resp', provider: 'routerai', model: 'Resp', api_mode: 'responses' } },
      },
    });
    process.env.VL209_TEST_KEY = 'env-key';
    delete process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_BASE_URL;
    delete process.env.VIBELOG_LLM_API_KEY;
    try {
      // Контроль: без явного apiMode фикстура уводит на /responses — settings реально влияет
      const implicit = fakeFetch([sseResponse([])]);
      const fromSettings = createLlmClient({ cwd: dir, fetchImpl: implicit.impl, retryDelayMs: 1 });
      await fromSettings.streamChat([{ role: 'user', content: 'x' }], []);
      assert.equal(implicit.state.urls[0], 'https://routerai.test/api/v1/responses');

      // Явный apiMode приоритетнее settings: URL и тело — chat-режима
      const explicit = fakeFetch([sseResponse([])]);
      const client = createLlmClient({ cwd: dir, fetchImpl: explicit.impl, retryDelayMs: 1, apiMode: 'chat' });
      await client.streamChat([{ role: 'user', content: 'x' }], []);
      assert.equal(
        explicit.state.urls[0],
        'https://routerai.test/api/v1/chat/completions',
        'явный apiMode перекрывает api_mode из settings.json',
      );
      assert.ok(Array.isArray(JSON.parse(explicit.state.bodies[0]).messages), 'chat-тело: messages');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('без секции models — fallback на env (старое поведение)', () => {
    const dir = fixture({ providers: { x: { base_url: 'https://x/v1' } } });
    process.env.VIBELOG_LLM_MODEL = 'env-model';
    process.env.VIBELOG_LLM_BASE_URL = 'https://env.test/v1';
    process.env.VIBELOG_LLM_API_KEY = 'env-k';
    try {
      const client = createLlmClient({ cwd: dir, fetchImpl: async () => jsonResponse({}), retryDelayMs: 1 });
      assert.equal(client.model, 'env-model');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('options.model приоритетнее settings (разовое переопределение)', () => {
    const dir = fixture(settingsFull());
    process.env.VL209_TEST_KEY = 'env-key';
    try {
      const client = createLlmClient({ cwd: dir, model: 'explicit', fetchImpl: async () => jsonResponse({}), retryDelayMs: 1 });
      assert.equal(client.model, 'explicit');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('нет модели нигде → прежняя ошибка про VIBELOG_LLM_MODEL', () => {
    const dir = fixture(settingsFull());
    delete process.env.VIBELOG_LLM_MODEL;
    delete process.env.VIBELOG_LLM_BASE_URL;
    delete process.env.VIBELOG_LLM_API_KEY;
    try {
      // default есть, но провайдер удалён → resolveActiveModel null → env-fallback пуст
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({ models: { default: 'ghost/m', available: {} } }));
      assert.throws(() => createLlmClient({ cwd: dir, fetchImpl: async () => jsonResponse({}) }), /VIBELOG_LLM_MODEL/);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Санация отравленных пар tool_calls/tool (VL-216)', () => {
  /** Успешный SSE-ответ одной строкой content. */
  const okStream = () =>
    sseResponse([JSON.stringify({ choices: [{ delta: { content: 'ок' } }] })]);

  /** Отравленная история: фантом рядом с валидным + оба tool-результата. */
  const poisonedHistory = () => [
    { role: 'user', content: 'сделай' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: '', name: '', arguments: {} },
        { id: 'c1', name: 'echo_tool', arguments: { x: 1 } },
      ],
    },
    { role: 'tool', tool_call_id: '', content: 'фантомный результат' },
    { role: 'tool', tool_call_id: 'c1', content: 'валидный результат' },
  ];

  it('wire-chat: пустые id/tool_call_id вырезаны, валидная пара c1 цела', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(poisonedHistory(), []);
    const body = JSON.parse(state.bodies[0]);
    // Пара c1 сохранена: assistant объявляет только c1, tool(c1) присутствует
    const assistant = body.messages.find((m) => m.role === 'assistant');
    assert.deepEqual(assistant.tool_calls, [
      { id: 'c1', type: 'function', function: { name: 'echo_tool', arguments: '{"x":1}' } },
    ]);
    const tools = body.messages.filter((m) => m.role === 'tool');
    assert.equal(tools.length, 1);
    assert.equal(tools[0].tool_call_id, 'c1');
    // Пустых ключей в wire нет
    assert.ok(!JSON.stringify(body.messages).includes('"tool_call_id":""'),
      'tool с пустым tool_call_id не должен уходить провайдеру');
  });

  it('только фантомы + текстовый content → assistant переписан текстом', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(
      [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: 'текст до фантома',
          tool_calls: [{ id: '', name: '', arguments: {} }],
        },
        { role: 'tool', tool_call_id: '', content: 'мусор' },
      ],
      [],
    );
    const body = JSON.parse(state.bodies[0]);
    const assistant = body.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant.content, 'текст до фантома');
    assert.equal('tool_calls' in assistant, false, 'tool_calls с одним фантомом должны уйти в текст');
    assert.equal(body.messages.filter((m) => m.role === 'tool').length, 0);
  });

  it('только фантомы + content=null → сообщение вырезано из wire целиком', async () => {
    const { impl, state } = fakeFetch([okStream()]);
    const client = createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl });
    await client.streamChat(
      [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: '', name: '', arguments: {} }],
        },
        { role: 'tool', tool_call_id: '', content: 'мусор' },
      ],
      [],
    );
    const body = JSON.parse(state.bodies[0]);
    // user-сообщение осталось, отравленной пары нет
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
  });

  it('messagesToInput (Responses): нет пустых call_id, валидная пара сохранена', () => {
    const input = messagesToInput(poisonedHistory());
    const calls = input.filter((i) => i.type === 'function_call');
    const outputs = input.filter((i) => i.type === 'function_call_output');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].call_id, 'c1');
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].call_id, 'c1');
    assert.ok(!JSON.stringify(input).includes('call_id":""'),
      'function_call/function_call_output с пустым call_id не должны попадать в wire');
    // system/user-итемы и текст assistant не пострадали
    assert.equal(input[0].type, 'message');
    assert.equal(input[0].content, 'сделай');
  });

  it('идемпотентность: повторный проход не меняет результат', () => {
    const once = sanitizeWireMessages(poisonedHistory());
    assert.deepEqual(sanitizeWireMessages(once), once);
    // И на заведомо чистой истории — без изменений
    const clean = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 't', arguments: {} }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    assert.deepEqual(sanitizeWireMessages(clean), clean);
  });

  it('tool без объявленного assistant-вызова (осиротевший) вырезан, объявленный — цел', () => {
    const out = sanitizeWireMessages([
      { role: 'user', content: 'x' },
      { role: 'tool', tool_call_id: 'ghost', content: 'нигде не объявлен' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 't', arguments: {} }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ]);
    assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'tool']);
    assert.equal(out[2].tool_call_id, 'c1');
  });
});
