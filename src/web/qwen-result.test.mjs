/**
 * Тесты VL-64 — парсер JSON-результата qwen (parseQwenResult).
 *
 * Контракт: последний результат type=result из лога → QwenResult; шум,
 * битые строки и отсутствие результата не ломают парсер (null). Поддерживаются
 * оба реального формата stdout: NDJSON-поток и строка-массив [{…}]
 * (json-адаптер qwen 0.24.x — фикс Фазы Comment на VL-63).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseQwenResult, explainQwenParse } from '../../dist/web/qwen-result.js';

/** Точный пример JSON-результата из VL-63. */
const RESULT_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 42411,
  duration_api_ms: 42369,
  num_turns: 1,
  result: 'понг',
  usage: {
    input_tokens: 10956,
    output_tokens: 19,
    cache_read_input_tokens: 10944,
    total_tokens: 10975,
  },
  session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
});

const NOISE = [
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    model: 'xiaomi/mimo-v2.5',
  }),
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking: 'pong' }] },
  }),
  'не-JSON шум между строками',
];

describe('parseQwenResult (VL-64)', () => {
  it('разбирает точный пример JSON из VL-63', () => {
    const res = parseQwenResult(RESULT_LINE);
    assert.ok(res);
    assert.equal(res.result, 'понг');
    assert.equal(res.is_error, false);
    assert.equal(res.num_turns, 1);
    assert.equal(res.duration_ms, 42411);
    assert.equal(res.duration_api_ms, 42369);
    assert.equal(res.session_id, 'a470c7dd-2ca8-4510-9d81-b184f932af76');
    assert.deepEqual(res.usage, {
      input_tokens: 10956,
      output_tokens: 19,
      cache_read_input_tokens: 10944,
      total_tokens: 10975,
    });
  });

  it('шум до/после (init, assistant) — result всё равно находится', () => {
    const log = [...NOISE, RESULT_LINE, 'мусор после'].join('\n');
    const res = parseQwenResult(log);
    assert.ok(res);
    assert.equal(res.result, 'понг');
  });

  it('битые JSON-строки пропускаются', () => {
    const log = [
      '{"type":"result", обрыв',
      '{"type":"assistant","message":{}}',
      RESULT_LINE,
    ].join('\n');
    const res = parseQwenResult(log);
    assert.ok(res);
    assert.equal(res.result, 'понг');
  });

  it('несколько result-строк — берётся последняя', () => {
    const first = JSON.stringify({ type: 'result', result: 'первый', session_id: 'old' });
    const log = [first, '{"type":"assistant"}', RESULT_LINE].join('\n');
    const res = parseQwenResult(log);
    assert.ok(res);
    assert.equal(res.result, 'понг');
    assert.equal(res.session_id, 'a470c7dd-2ca8-4510-9d81-b184f932af76');
  });

  it('is_error: true флагируется', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'что-то пошло не так',
    });
    const res = parseQwenResult(line);
    assert.ok(res);
    assert.equal(res.is_error, true);
    assert.equal(res.result, 'что-то пошло не так');
  });

  it('пустой лог и лог без result → null', () => {
    assert.equal(parseQwenResult(''), null);
    assert.equal(parseQwenResult('   \n  \n'), null);
    assert.equal(parseQwenResult('{"type":"init"}\nпросто текст'), null);
  });

  it('отсутствующие поля usage → дефолты 0', () => {
    const line = JSON.stringify({ type: 'result', result: 'ок' });
    const res = parseQwenResult(line);
    assert.ok(res);
    assert.equal(res.result, 'ок');
    assert.equal(res.is_error, false);
    assert.equal(res.num_turns, 0);
    assert.equal(res.duration_ms, 0);
    assert.equal(res.duration_api_ms, 0);
    assert.equal(res.session_id, '');
    assert.deepEqual(res.usage, {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      total_tokens: 0,
    });
  });
});

describe('parseQwenResult: формат-массив qwen 0.24.x (фикс VL-63)', () => {
  /** Массив всех сообщений сессии — реальный stdout json-адаптера qwen. */
  const frame = JSON.stringify([
    { type: 'system', subtype: 'init', session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'понг' }] } },
    JSON.parse(RESULT_LINE),
  ]);

  it('строка-массив [{init}, {assistant}, {result}] → result разобран', () => {
    const res = parseQwenResult(frame);
    assert.ok(res, 'result найден внутри массива');
    assert.equal(res.result, 'понг');
    assert.equal(res.session_id, 'a470c7dd-2ca8-4510-9d81-b184f932af76');
    assert.equal(res.usage.total_tokens, 10975);
  });

  it('массив с шумом до (Warning) и пустой строкой после', () => {
    const log = 'Warning: running headless with --yolo\n' + frame + '\n';
    const res = parseQwenResult(log);
    assert.ok(res);
    assert.equal(res.result, 'понг');
  });

  it('массив без элемента result → null', () => {
    const noResult = JSON.stringify([{ type: 'system' }, { type: 'assistant' }]);
    assert.equal(parseQwenResult(noResult), null);
  });

  it('is_error: текст ошибки берётся из error.message', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      error: { message: 'loop detected' },
    });
    const res = parseQwenResult(line);
    assert.ok(res);
    assert.equal(res.is_error, true);
    assert.equal(res.result, 'loop detected');
  });

  it('explainQwenParse: сводка для NDJSON-лога', () => {
    const log = [NOISE[0], RESULT_LINE].join('\n');
    const info = explainQwenParse(log);
    assert.match(info, /result: найден/);
    assert.match(info, /JSON-строк: 2/);
  });

  it('explainQwenParse: сводка для массива и «НЕ найден» без result', () => {
    const infoArr = explainQwenParse('Warning\n' + frame);
    assert.match(infoArr, /строк-массивов: 1/);
    assert.match(infoArr, /result: найден/);
    const infoNone = explainQwenParse('{"type":"init"}\nпросто текст');
    assert.match(infoNone, /result: НЕ найден/);
  });
});
