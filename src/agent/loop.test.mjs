/**
 * Тесты VL-83 — tool-calling loop (src/agent/loop.ts).
 *
 * Фейковый llm (очередь ответов/ошибок), без сети: happy path, loop
 * detection, оба лимита, ошибка handler (loop продолжает), ошибка llm.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runLoop } from '../../dist/agent/loop.js';
import { zeroUsage } from '../../dist/agent/llm.js';

/**
 * Фейковый LLM: очередь элементов.
 * Объект {text, toolCalls?, usage?, delayMs?} — ответ; Error — исключение;
 * Функция (messages) => ответ — гибкий ответ по истории.
 */
function fakeLlm(script) {
  const state = { calls: 0, messages: [] };
  const llm = {
    async streamChat(messages, _tools, opts) {
      state.messages.push(structuredClone(messages));
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return step(messages);
      if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
      if (step.text && opts?.onToken) {
        for (const word of step.text.split(/(?<=\s)/)) opts.onToken(word);
      }
      return {
        text: step.text ?? '',
        toolCalls: step.toolCalls ?? [],
        // Частичный usage из сценария дополняется нулями — NaN в sum не попадает.
        usage: step.usage ? { ...zeroUsage(), ...step.usage } : zeroUsage(),
      };
    },
  };
  return { llm, state };
}

/** Инструмент-заглушка со счётчиком вызовов. */
function countingTool(name = 'echo_tool') {
  const state = { calls: 0, lastArgs: null };
  const spec = {
    name,
    description: 'тестовый инструмент',
    inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
    handler: async (args) => {
      state.calls++;
      state.lastArgs = args;
      return `ok:${name}`;
    },
  };
  return { spec, state };
}

const USER_MSG = [{ role: 'user', content: 'сделай' }];

describe('runLoop happy path (VL-83)', () => {
  it('финальный текст без tool_calls = результат фазы', async () => {
    const { llm, state } = fakeLlm([{ text: 'Готово!', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }]);
    const tokens = [];
    const res = await runLoop({ llm, messages: USER_MSG, tools: [], onToken: (t) => tokens.push(t) });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'Готово!');
    assert.equal(res.num_turns, 1);
    assert.ok(res.duration_ms >= 0);
    assert.deepEqual(res.usage, { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 12 });
    assert.equal(state.calls, 1);
    assert.equal(tokens.join(''), 'Готово!');
  });

  it('tool_calls выполняются, tool-результаты дописываются в messages', async () => {
    const { spec, state: toolState } = countingTool();
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }] },
      { text: 'итог' },
    ]);
    const starts = [];
    const ends = [];
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      onToolStart: (name, args) => starts.push([name, args]),
      onToolEnd: (name, out) => ends.push([name, out]),
    });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    assert.equal(res.num_turns, 2);
    assert.equal(toolState.calls, 1);
    assert.deepEqual(toolState.lastArgs, { x: 1 });
    assert.deepEqual(starts, [['echo_tool', { x: 1 }]]);
    assert.deepEqual(ends, [['echo_tool', 'ok:echo_tool']]);
    // История последнего llm-запроса: user → assistant(tool_calls) → tool
    // (финальный assistant дописывается после выхода loop — здесь его ещё нет).
    const finalHistory = state.messages[state.messages.length - 1];
    assert.equal(finalHistory.at(-1).role, 'tool');
    assert.equal(finalHistory.at(-1).tool_call_id, 'c1');
    assert.equal(finalHistory.at(-1).content, 'ok:echo_tool');
    assert.equal(finalHistory.at(-2).role, 'assistant');
    assert.deepEqual(finalHistory.at(-2).tool_calls[0].arguments, { x: 1 });
  });

  it('неизвестный инструмент → tool-результат с ошибкой, loop продолжает', async () => {
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }] },
      { text: 'всё равно готово' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'всё равно готово');
  });

  it('usage суммируется по всем ответам', async () => {
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      { text: 'финал', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.deepEqual(res.usage, {
      input_tokens: 11,
      output_tokens: 6,
      cache_read_input_tokens: 0,
      total_tokens: 17,
    });
  });
});

describe('runLoop loop detection (VL-83)', () => {
  it('3 одинаковых подряд вызова → is_error и русский текст, 3-й не выполняется', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 1 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Loop detection/);
    assert.match(res.result, /инструмент t вызван 3 раза подряд/);
    assert.equal(toolState.calls, 2, '3-й вызов не должен выполняться');
  });

  it('разные аргументы — не loop detection', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: 'нормально' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'нормально');
    assert.equal(toolState.calls, 3);
  });
});

describe('runLoop лимиты (VL-83)', () => {
  it('maxToolCalls=2: третий вызов → is_error «--max-tool-calls»', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], limits: { maxToolCalls: 2 } });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--max-tool-calls \(2\)/);
    assert.equal(toolState.calls, 2);
  });

  it('maxWallTimeMs=1: медленный llm → is_error «--max-wall-time»', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], delayMs: 10 },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }], delayMs: 10 },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], limits: { maxWallTimeMs: 1 } });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--max-wall-time/);
    assert.equal(toolState.calls, 1, 'вторая итерация не должна стартовать');
  });

  it('частичный текст сохраняется в partial-результате при лимите', async () => {
    const { llm } = fakeLlm([
      { text: 'промежуточный текст', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'nope', arguments: { y: 1 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'nope', arguments: { y: 2 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [], limits: { maxToolCalls: 2 } });
    assert.equal(res.is_error, true);
    assert.match(res.result, /^промежуточный текст\n\n/);
    assert.match(res.result, /--max-tool-calls/);
  });
});

describe('runLoop ошибки (VL-83)', () => {
  it('ошибка handler → текст tool-результата, loop продолжает', async () => {
    const failing = {
      name: 'boom',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('взрыв');
      },
    };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'boom', arguments: {} }] },
      { text: 'всё починил' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [failing] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'всё починил');
  });

  it('ошибка llm → is_error без исключения наружу', async () => {
    const { llm } = fakeLlm([new Error('HTTP 500 от провайдера')]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Ошибка LLM-запроса: HTTP 500 от провайдера/);
    assert.equal(res.num_turns, 0);
  });

  it('валидация аргументов: невалидные аргументы — текст модели, loop продолжает', async () => {
    const strict = {
      name: 'strict',
      description: '',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
      handler: async (args) => {
        if (args.x === undefined) throw new Error('нет x');
        return 'ok';
      },
    };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'strict', arguments: {} }] },
      { text: 'конец' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [strict] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'конец');
  });
});

describe('runLoop externalTools (VL-84)', () => {
  it('внешние инструменты подмешиваются к локальным и вызываются', async () => {
    const local = countingTool('local_tool');
    const external = countingTool('mcp_tool');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'mcp_tool', arguments: { x: 5 } }] },
      { text: 'внешний вызван' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [local.spec],
      externalTools: [external.spec],
    });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'внешний вызван');
    assert.equal(external.state.calls, 1, 'внешний инструмент должен выполниться');
    assert.deepEqual(external.state.lastArgs, { x: 5 });
    assert.equal(local.state.calls, 0, 'локальный не вызывался');
  });

  it('конфликт имён локального и внешнего → throw с русским текстом', async () => {
    const local = countingTool('dup_tool');
    const external = countingTool('dup_tool');
    const { llm } = fakeLlm([{ text: 'не должен дойти' }]);
    await assert.rejects(
      runLoop({ llm, messages: USER_MSG, tools: [local.spec], externalTools: [external.spec] }),
      (err) => {
        assert.match(err.message, /Конфликт имён инструментов: dup_tool есть и локально, и в MCP/);
        return true;
      },
    );
  });

  it('без externalTools поведение не меняется (регресс VL-83)', async () => {
    const { spec, state: toolState } = countingTool('echo_tool');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: {} }] },
      { text: 'ок' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(toolState.calls, 1);
  });
});

describe('runLoop LoopResult.messages (VL-95)', () => {
  it('полный диалог: user → assistant(tool_calls) → tool → assistant(финал)', async () => {
    const { spec } = countingTool();
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }] },
      { text: 'итог' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    // Финальный assistant дописан в диалог — транскрипт валиден для resume
    assert.deepEqual(res.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
    assert.equal(res.messages[1].tool_calls[0].id, 'c1');
    assert.equal(res.messages[2].tool_call_id, 'c1');
    assert.equal(res.messages[3].content, 'итог');
  });

  it('fail-путь (loop detection): messages содержат накопленную историю', async () => {
    const { spec } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 1 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true);
    assert.ok(res.messages.length >= 4, 'история должна накапливаться до fail');
    assert.deepEqual(res.messages[0], USER_MSG[0]);
    assert.ok(res.messages.some((m) => m.role === 'tool'));
  });

  it('fail-путь (ошибка llm): messages — исходные без ответа', async () => {
    const { llm } = fakeLlm([new Error('HTTP 500')]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.deepEqual(res.messages, USER_MSG);
  });
});
