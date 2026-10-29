/**
 * Тесты VL-83 — tool-calling loop (src/agent/loop.ts).
 *
 * Фейковый llm (очередь ответов/ошибок), без сети: happy path, loop
 * detection, оба лимита, ошибка handler (loop продолжает), ошибка llm.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { runLoop, compactWireMessages } from '../../dist/agent/loop.js';
import { zeroUsage } from '../../dist/agent/llm.js';
import { TOOL_OUTPUT_MAX_CHARS } from '../../dist/agent/tools.js';

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
        // VL-203: wire-диагностика (optional) — пробрасывается из сценария
        ...(step.payloadBytes !== undefined ? { payloadBytes: step.payloadBytes } : {}),
        ...(step.shrinkLevel !== undefined ? { shrinkLevel: step.shrinkLevel } : {}),
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
    assert.deepEqual(res.usage, { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 12, reasoning_tokens: 0 });
    assert.equal(state.calls, 1);
    assert.equal(tokens.join(''), 'Готово!');
    // VL-198: usage последнего ответа дописан в assistant-сообщение
    // (источник для sumUsageFromMessages / fallback finish_phase)
    const assistant = res.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant.usage.total_tokens, 12);
    assert.equal(assistant.usage.reasoning_tokens, 0);
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
      reasoning_tokens: 0,
    });
  });
});

// ── VL-203: wire-payload и уровень компакшна в JSONL/LoopResult ──

describe('runLoop wire-диагностика (VL-203)', () => {
  it('payload_bytes/shrink_level дописываются в assistant-сообщения и LoopResult', async () => {
    const { spec } = countingTool();
    const { llm } = fakeLlm([
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }],
        usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        payloadBytes: 140_000,
        shrinkLevel: 0,
      },
      { text: 'готово', usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 }, payloadBytes: 155_000, shrinkLevel: 1 },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    // LoopResult: последний и пиковый payload
    assert.equal(res.last_payload_bytes, 155_000);
    assert.equal(res.max_payload_bytes, 155_000);
    // JSONL-транскрипт: оба assistant-сообщения несут wire-диагностику
    const assistants = res.messages.filter((m) => m.role === 'assistant');
    assert.equal(assistants.length, 2);
    assert.equal(assistants[0].payload_bytes, 140_000);
    assert.equal(assistants[0].shrink_level, 0);
    assert.equal(assistants[0].usage.total_tokens, 6, 'usage по ходам (VL-198) на месте');
    assert.equal(assistants[1].payload_bytes, 155_000);
    assert.equal(assistants[1].shrink_level, 1);
    assert.equal(assistants[1].usage.total_tokens, 9);
  });

  it('ответы без payloadBytes (мок старого образца) → поля undefined, без NaN', async () => {
    const { llm } = fakeLlm([{ text: 'просто текст' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.last_payload_bytes, undefined);
    assert.equal(res.max_payload_bytes, undefined);
    const assistant = res.messages.find((m) => m.role === 'assistant');
    assert.equal('payload_bytes' in assistant, false, 'нет поля — не undefined-ключ');
    assert.equal('shrink_level' in assistant, false);
  });

  it('fail-путь тоже несёт накопленную wire-диагностику', async () => {
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }], payloadBytes: 50_000, shrinkLevel: 0 },
      new Error('Ошибка LLM: network down'),
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.equal(res.last_payload_bytes, 50_000, 'последний успешный payload сохранён при ошибке');
    assert.equal(res.max_payload_bytes, 50_000);
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

  it('maxRequests=1: llm с tool_calls → is_error «--max-requests»', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], limits: { maxRequests: 1 } });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--max-requests \(1\)/);
    assert.equal(toolState.calls, 1, 'второй LLM-ход не должен стартовать');
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

  it('fail-путь (ошибка llm): транскрипт заканчивается assistant с текстом ошибки (VL-103)', async () => {
    const { llm } = fakeLlm([new Error('HTTP 500')]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    // Контракт VL-103: fail() дописывает финальный assistant — jsonl сессии
    // завершён, а --resume после ошибки не получит историю с tool-хвостом
    assert.equal(res.messages.length, USER_MSG.length + 1);
    assert.deepEqual(res.messages[0], USER_MSG[0]);
    assert.equal(res.messages.at(-1).role, 'assistant');
    assert.match(res.messages.at(-1).content, /Ошибка LLM-запроса: HTTP 500/);
  });

  it('VL-96: tools сортируются по имени перед отправкой в LLM', async () => {
    let receivedTools;
    const llm = {
      async streamChat(_messages, tools) {
        receivedTools = tools;
        return { text: 'ок', toolCalls: [], usage: zeroUsage() };
      },
    };
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [countingTool('zebra').spec, countingTool('alpha').spec],
    });
    assert.equal(res.is_error, false);
    assert.deepEqual(receivedTools.map((t) => t.name), ['alpha', 'zebra']);
  });
});

describe('runLoop onMessage и транскрипт ошибок (VL-103)', () => {
  it('onMessage вызывается по одному разу на каждое сообщение в порядке добавления', async () => {
    const { spec } = countingTool();
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }] },
      { text: 'итог' },
    ]);
    const seen = [];
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      onMessage: (m) => seen.push(m),
    });
    assert.equal(res.is_error, false);
    // Хук видит только сообщения, появившиеся ВНУТРИ loop: assistant(tool_calls)
    // → tool → финальный assistant (system/history/user не дублируются)
    assert.deepEqual(seen.map((m) => m.role), ['assistant', 'tool', 'assistant']);
    assert.equal(seen[0].tool_calls[0].id, 'c1');
    assert.equal(seen[1].tool_call_id, 'c1');
    assert.equal(seen[2].content, 'итог');
  });

  it('при ошибке LLM onMessage последним получает assistant с текстом ошибки', async () => {
    const { llm } = fakeLlm([new Error('HTTP 500 от провайдера')]);
    const seen = [];
    const res = await runLoop({ llm, messages: USER_MSG, tools: [], onMessage: (m) => seen.push(m) });
    assert.equal(res.is_error, true);
    assert.equal(seen.length, 1, 'первое и единственное сообщение цикла — fail-assistant');
    assert.equal(seen[0].role, 'assistant');
    assert.match(seen[0].content, /Ошибка LLM-запроса: HTTP 500 от провайдера/);
    // Хук получил ровно то, что легло в res.messages
    assert.deepEqual(seen, res.messages.slice(USER_MSG.length));
  });

  it('fail-путь (лимит): assistant с текстом ошибки дописывается в messages', async () => {
    const { llm } = fakeLlm([{ text: 'частичный текст', toolCalls: [{ id: 'c1', name: 'nope', arguments: {} }] }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [], limits: { maxToolCalls: 1 } });
    assert.equal(res.is_error, true);
    assert.equal(res.messages.at(-1).role, 'assistant');
    assert.match(res.messages.at(-1).content, /--max-tool-calls/);
  });
});

describe('runLoop guard пустого финального ответа (VL-110)', () => {
  it('пустой финал без tool_calls → is_error «Пустой ответ модели»', async () => {
    const { llm } = fakeLlm([{ text: '' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Пустой ответ модели/);
  });

  it('финал из пробелов и переносов → тоже ошибка', async () => {
    const { llm } = fakeLlm([{ text: '  \n\t ' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Пустой ответ модели/);
  });

  it('непустой финал — результат без изменений (регрессия VL-83)', async () => {
    const { llm } = fakeLlm([{ text: 'Готово!' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'Готово!');
  });

  it('транскрипт заканчивается assistant с текстом ошибки (контракт resume VL-103)', async () => {
    const { llm } = fakeLlm([{ text: '' }]);
    const seen = [];
    const res = await runLoop({ llm, messages: USER_MSG, tools: [], onMessage: (m) => seen.push(m) });
    assert.equal(res.is_error, true);
    assert.equal(seen.length, 1, 'fail-assistant — единственное сообщение цикла');
    assert.equal(seen[0].role, 'assistant');
    assert.match(seen[0].content, /Пустой ответ модели/);
    assert.equal(res.messages.at(-1).role, 'assistant');
  });
});

describe('runLoop guard high-risk-финала при HTTP 200 (VL-199)', () => {
  const HR_TEXT = 'The request was rejected because it was considered high risk';

  it('финальный текст с маркером high risk → is_error, русское пояснение, маркер в result', async () => {
    const { llm } = fakeLlm([{ text: HR_TEXT }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true, 'отказ провайдера — не успех');
    assert.match(res.result, /Отказ провайдера «high risk»/, 'русское пояснение');
    assert.match(res.result, /VL-199/);
    assert.ok(res.result.includes(HR_TEXT), 'оригинальный текст сохранён для guard авто-resume');
    assert.equal(res.num_turns, 1);
    // Контракт resume VL-103: транскрипт заканчивается assistant-сообщением
    assert.equal(res.messages.at(-1).role, 'assistant');
    assert.match(res.messages.at(-1).content, /high risk/);
  });

  it('обычный финальный текст без маркера → is_error=false (регрессия VL-83)', async () => {
    const { llm } = fakeLlm([{ text: 'Готово, фаза завершена.' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'Готово, фаза завершена.');
  });
});

describe('runLoop guard по намерению (VL-119)', () => {
  const INTENT = 'Приступаю к реализации… уточню якоря.';

  it('4 хода с одним текстом и РАЗНЫМИ tool-вызовами → fail «Зацикливание», 4-й не выполняется', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: INTENT, toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: INTENT, toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: INTENT, toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: INTENT, toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Зацикливание/);
    assert.match(res.result, /4 ходов подряд/);
    assert.match(res.result, /намерением/);
    // Сигнатурный детектор VL-83 молчит (аргументы разные) — сработал
    // только guard намерений; 4-й ход не выполнен (guard ДО tool-вызовов).
    assert.equal(toolState.calls, 3);
  });

  it('меняющийся текст — нет срабатывания, финал достигнут', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: 'шаг 1: уточню якоря', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: 'шаг 2: прочитаю файлы', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: 'шаг 3: внесу правки', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: 'шаг 4: соберу проект', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
      { text: 'шаг 5: прогоню тесты', toolCalls: [{ id: 'c5', name: 't', arguments: { x: 5 } }] },
      { text: 'итог' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    assert.equal(toolState.calls, 5);
  });

  it('порог: 3 хода с одинаковым текстом + финал → без fail (ниже порога 4)', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: INTENT, toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: INTENT, toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: INTENT, toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: 'итог' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    assert.equal(toolState.calls, 3);
  });

  it('регресс VL-83/103: пустой промежуточный текст не триггерит guard', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: '', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
      { text: '', toolCalls: [{ id: 'c5', name: 't', arguments: { x: 5 } }] },
      { text: 'итог' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    assert.equal(toolState.calls, 5);
  });

  it('нормализация: тексты, отличающиеся только пробелами/переносами → fail', async () => {
    const { spec } = countingTool('t');
    const { llm } = fakeLlm([
      { text: 'Приступаю.\nУточню якоря.', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '  Приступаю.  Уточню   якоря. ', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: 'Приступаю. Уточню якоря.', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: 'Приступаю.\tУточню якоря.', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Зацикливание/);
    assert.match(res.result, /намерением/);
  });

  it('контракт resume VL-103: onMessage видит fail-assistant, транскрипт им заканчивается', async () => {
    const { spec } = countingTool('t');
    const { llm } = fakeLlm([
      { text: INTENT, toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: INTENT, toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: INTENT, toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: INTENT, toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
    ]);
    const seen = [];
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], onMessage: (m) => seen.push(m) });
    assert.equal(res.is_error, true);
    // Последнее сообщение цикла — assistant с текстом ошибки (контракт VL-103)
    assert.equal(res.messages.at(-1).role, 'assistant');
    assert.match(res.messages.at(-1).content, /Зацикливание/);
    // onMessage увидел это сообщение (транскрипт завершён штатно)
    assert.equal(seen.at(-1).role, 'assistant');
    assert.match(seen.at(-1).content, /Зацикливание/);
  });
});

// ── VL-122: компакшн истории (wire-усечение LLM-запроса) ──

describe('компакшн истории (VL-122)', () => {
  /** Диалог с «прошлой» историей: system + постановка + две пары assistant/user. */
  const history = () => [
    { role: 'system', content: 'sys-промпт' },
    { role: 'user', content: 'постановка задачи' },
    { role: 'assistant', content: 'старый ответ 1' },
    { role: 'user', content: 'старый вопрос 1' },
    { role: 'assistant', content: 'старый ответ 2' },
    { role: 'user', content: 'старый вопрос 2' },
  ];

  it('длинная история усекается: system + первый user со заметкой + хвост; середина отсутствует', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    const res = await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactTailMessages: 3 },
    });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    // Первый запрос — полная история (компакшн ещё не сработал)
    assert.equal(state.messages[0].length, 6);
    assert.ok(!state.messages[0].some((m) => (m.content ?? '').includes('История усечена')));
    // Второй запрос — усечённая wire-копия: system + первый user со заметкой + хвост
    const wire = state.messages[1];
    assert.equal(wire[0].role, 'system');
    assert.equal(wire[1].role, 'user');
    assert.match(wire[1].content, /постановка задачи/);
    assert.match(wire[1].content, /История усечена: опущено 3 сообщений/);
    assert.match(wire[1].content, /Полный транскрипт — в сессии/);
    // Середина отсутствует, хвост на месте
    assert.ok(!wire.some((m) => (m.content ?? '') === 'старый ответ 1'));
    assert.ok(!wire.some((m) => (m.content ?? '') === 'старый вопрос 1'));
    assert.ok(!wire.some((m) => (m.content ?? '') === 'старый ответ 2'));
    assert.equal(wire.at(-1).role, 'tool');
    assert.equal(wire.at(-2).role, 'assistant');
  });

  it('LoopResult.messages и onMessage — ПОЛНАЯ история; финал — assistant (контракт resume VL-103)', async () => {
    const { spec } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    const seen = [];
    const res = await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactTailMessages: 3 },
      onMessage: (m) => seen.push(structuredClone(m)),
    });
    // Полная история: 6 исходных + assistant(tool_calls) + tool + финальный assistant
    assert.equal(res.messages.length, 9);
    assert.equal(res.messages.at(-1).role, 'assistant');
    assert.equal(res.messages.at(-1).content, 'итог');
    // Ни в messages, ни в onMessage усечения нет — jsonl сессии полон
    assert.ok(!res.messages.some((m) => (m.content ?? '').includes('История усечена')));
    assert.equal(seen.length, 3);
    assert.equal(seen[0].role, 'assistant');
    assert.equal(seen[1].role, 'tool');
    assert.equal(seen[2].role, 'assistant');
  });

  it('порог не превышен → payload идентичен messages (без заметки)', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 10 } },
      { text: 'итог' },
    ]);
    await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactTailMessages: 3 },
    });
    // Второй запрос — полная история (6 + assistant(tool_calls) + tool = 8)
    assert.equal(state.messages[1].length, 8);
    assert.ok(!state.messages[1].some((m) => (m.content ?? '').includes('История усечена')));
  });

  it('орфан-гард: якорь на tool-сообщении сдвигается вперёд — хвост не начинается с tool', async () => {
    const { spec } = countingTool('t');
    // История с tool-сообщением на позиции 5 — якорь (len 10 − tail 5) попадает на него
    const messages = [
      { role: 'system', content: 'sys-промпт' },
      { role: 'user', content: 'постановка задачи' },
      { role: 'assistant', content: 'ответ А' },
      { role: 'user', content: 'вопрос Б' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'p1', name: 't', arguments: { x: 0 } }] },
      { role: 'tool', tool_call_id: 'p1', content: 'осиротевший tool' },
      { role: 'assistant', content: 'ответ В' },
      { role: 'user', content: 'вопрос Г' },
    ];
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    await runLoop({ llm, messages, tools: [spec], limits: { compactTailMessages: 5 } });
    const wire = state.messages[1];
    // Хвост сдвинут past tool: первый хвостовой элемент — assistant «ответ В»
    assert.equal(wire[2].role, 'assistant');
    assert.equal(wire[2].content, 'ответ В');
    // Осиротевший tool (tool_call_id p1 без парного assistant в wire) вырезан
    assert.ok(!wire.some((m) => m.tool_call_id === 'p1'));
  });

  it('липкий якорь: 3-й запрос append-only расширяется от того же якоря (префикс стабилен)', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }], usage: { input_tokens: 10 } },
      { text: 'итог' },
    ]);
    await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactTailMessages: 3 },
    });
    const wire2 = state.messages[1];
    const wire3 = state.messages[2];
    // Префикс (system + первый user со заметкой) идентичен — маркер не меняется
    assert.deepEqual(wire3.slice(0, 2), wire2.slice(0, 2));
    // Второй wire — append-only префикс третьего (якорь не сдвинулся)
    assert.deepEqual(wire3.slice(0, wire2.length), wire2);
    assert.ok(wire3.length > wire2.length);
  });

  it('re-anchor: повторное превышение порога сдвигает якорь вперёд', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactTailMessages: 3 },
    });
    const wire2 = state.messages[1];
    const wire3 = state.messages[2];
    // Якорь сдвинулся: 3-й wire короче первого усечённого или начинает хвост позже
    // (после 2-го ответа len=10, новый якорь 7 → хвост из 3 последних)
    assert.notDeepEqual(wire3.slice(0, 2), wire2.slice(0, 2));
    // Но система и постановка со свежей заметкой сохранены
    assert.equal(wire3[0].role, 'system');
    assert.match(wire3[1].content, /История усечена/);
  });

  it('compactDisabled (--no-compact): порог превышен, но payload полный', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    await runLoop({
      llm,
      messages: history(),
      tools: [spec],
      limits: { compactDisabled: true },
    });
    assert.equal(state.messages[1].length, 8);
    assert.ok(!state.messages[1].some((m) => (m.content ?? '').includes('История усечена')));
  });
});

describe('compactWireMessages (VL-122)', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'постановка' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u1' },
  ];

  it('якорь ≤ первого user+1 → исходный массив без маркера', () => {
    assert.equal(compactWireMessages(msgs, 0), msgs);
    assert.equal(compactWireMessages(msgs, 1), msgs);
    assert.equal(compactWireMessages(msgs, 2), msgs);
  });

  it('якорь за пределами массива → исходный массив', () => {
    assert.equal(compactWireMessages(msgs, 4), msgs);
    assert.equal(compactWireMessages(msgs, 10), msgs);
  });

  it('хвост целиком из tool-сообщений → fallback: исходный payload', () => {
    const orphanTail = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'постановка' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 't', arguments: {} }] },
      { role: 'tool', tool_call_id: 'c1', content: 't1' },
      { role: 'tool', tool_call_id: 'c2', content: 't2' },
    ];
    // Якорь 3: хвост [tool, tool] целиком tool → компакшн пропускается
    assert.equal(compactWireMessages(orphanTail, 3), orphanTail);
  });

  it('обычное усечение: копия с маркером, исходный массив не мутирован', () => {
    const wire = compactWireMessages(msgs, 3);
    assert.notEqual(wire, msgs);
    assert.equal(wire.length, 3);
    assert.match(wire[1].content, /постановка\n\n\[История усечена: опущено 1 сообщений/);
    // Исходный массив без изменений (транскрипт/jsonl не тронуты)
    assert.equal(msgs[1].content, 'постановка');
  });
});

// ── VL-178: усечение MCP-выводов + компакшн на гигантских снапшотах ──

describe('ingestion-cap tool-выводов, включая MCP (VL-178)', () => {
  it('MCP-подобный spec с выводом 624 КБ → в истории tool-сообщение ≤ 8KB + маркер', async () => {
    // Внешние MCP-инструменты (chrome_devtools__take_snapshot) шли мимо
    // VL-110-cap: handler возвращал 624 КБ целиком. Теперь единый cap в loop.
    const mcpSpec = {
      name: 'chrome_devtools__take_snapshot',
      description: 'снапшот страницы',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => 'х'.repeat(624 * 1024),
    };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'chrome_devtools__take_snapshot', arguments: {} }] },
      { text: 'готово' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [mcpSpec] });
    assert.equal(res.is_error, false);
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'tool-сообщение должно быть в истории');
    assert.ok(
      toolMsg.content.length <= TOOL_OUTPUT_MAX_CHARS + 200,
      `длина ${toolMsg.content.length} не должна превышать лимит + маркер`,
    );
    assert.match(toolMsg.content, /вывод обрезан/);
    // Финальный ответ модели не пострадал
    assert.equal(res.result, 'готово');
  });

  it('короткий вывод не трогается (регрессия VL-110)', async () => {
    const { spec } = countingTool('echo_tool');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: {} }] },
      { text: 'ок' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    const toolMsg = res.messages.find((m) => m.role === 'tool');
    assert.equal(toolMsg.content, 'ok:echo_tool');
  });
});

describe('компакшн на гигантских MCP-выводах (VL-178 / VL-122)', () => {
  it('giant tool-вывод ВНЕ хвоста не попадает в wire-payload после компакшна', async () => {
    // История: system + постановка + старый парный вывод 624 КБ (вне хвоста)
    const giant = 'с'.repeat(624 * 1024);
    const history = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'постановка' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old1', name: 't', arguments: {} }] },
      { role: 'tool', tool_call_id: 'old1', content: giant },
      { role: 'assistant', content: 'старый финал' },
    ];
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      // Ответ 1: usage выше порога → якорь компакшна сдвигается перед запросом 2
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    const res = await runLoop({
      llm,
      messages: history,
      tools: [spec],
      limits: { compactTailMessages: 3 },
    });
    assert.equal(res.is_error, false);
    // Wire-запрос 2: giant-вывод вне хвоста (якорь ≥ позиции giant) → отсутствует
    const wire = state.messages[1];
    const giantInWire = wire.some((m) => typeof m.content === 'string' && m.content.length > 100_000);
    assert.ok(!giantInWire, 'гигантский tool-вывод не должен переживать компакшн в wire');
    assert.match(wire[1].content, /История усечена/);
    // Полная история доступна в LoopResult.messages (jsonl/resume не страдают)
    const full = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'old1');
    assert.equal(full.content, giant);
  });

  it('giant tool-вывод В хвосте обрезан на ingestion → wire ограничен', async () => {
    const { spec } = countingTool('t');
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }], usage: { input_tokens: 900_000 } },
      { text: 'итог' },
    ]);
    const res = await runLoop({
      llm,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'постановка' },
        { role: 'assistant', content: 'старый ответ' },
      ],
      tools: [spec],
      limits: { compactTailMessages: 10 },
    });
    assert.equal(res.is_error, false);
    // Второй wire: хвост целиком (tail 10), но tool-вывод ≤ 8KB — cap на ingestion
    const toolMsg = state.messages[1].find((m) => m.role === 'tool');
    assert.ok(toolMsg.content.length <= TOOL_OUTPUT_MAX_CHARS + 200);
    // Общий размер wire ограничен (50 × 8KB ≈ 400KB — инвариант VL-122)
    const total = state.messages[1].reduce(
      (n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
    assert.ok(total < 50_000, `wire-payload ${total} б — не должен раздуваться`);
  });
});

describe('фантомные tool_calls с пустыми name/id (VL-215)', () => {
  /** Общая проверка чистоты истории: нет пар с пустым ключом и «Неизвестный инструмент: » с пустым именем. */
  function assertHistoryClean(messages) {
    for (const m of messages) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          assert.ok(tc.id.trim() !== '' && tc.name.trim() !== '',
            `фантом попал в assistant.tool_calls: id=${JSON.stringify(tc.id)} name=${JSON.stringify(tc.name)}`);
        }
      }
      if (m.role === 'tool') {
        assert.ok(m.tool_call_id.trim() !== '',
          `tool-сообщение с пустым tool_call_id: ${JSON.stringify(m.content)}`);
      }
      if (typeof m.content === 'string') {
        assert.ok(!m.content.startsWith('Неизвестный инструмент: ') ||
          m.content !== 'Неизвестный инструмент: ',
          'сообщение «Неизвестный инструмент: » с пустым именем не должно существовать');
      }
    }
  }

  it('AC1/AC2: только фантомы → без отравленной пары, user-ошибка, следующий ход валиден', async () => {
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: '', name: '', arguments: {} }] },
      { text: 'восстановился' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'восстановился');
    assert.equal(res.num_turns, 2);
    // (а) ни одного assistant(tool_calls) — фантом не записан, pair нет
    assert.ok(!res.messages.some((m) => m.role === 'assistant' && m.tool_calls),
      'assistant с tool_calls не должен появиться при одних фантомах');
    // (б) нет tool-сообщений и «Неизвестный инструмент: » с пустым именем
    assertHistoryClean(res.messages);
    // Пометка модели — отдельным user-сообщением (не tool, без пустого ключа)
    const err = res.messages.find((m) => m.role === 'user' && m.content.includes('пустым name/id'));
    assert.ok(err, 'должно быть user-сообщение с текстом-ошибкой про фантом');
    // (в) payload второго запроса валиден: tool-сообщения только с парой
    const secondPayload = state.messages[1];
    const answered = new Set();
    for (const m of secondPayload) {
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          assert.ok(tc.id.trim() !== '' && tc.name.trim() !== '', 'фантом в wire-payload');
          answered.add(tc.id);
        }
      }
      if (m.role === 'tool') {
        assert.ok(m.tool_call_id.trim() !== '' && answered.has(m.tool_call_id),
          'tool в wire-payload без парного assistant(tool_calls)');
      }
    }
    assert.equal(secondPayload.at(-1).role, 'user');
  });

  it('AC1: фантом рядом с валидным → выполняется только валидный, user-заметка о проигнорированных', async () => {
    const { spec, state: toolState } = countingTool('echo_tool');
    const { llm } = fakeLlm([
      {
        text: '',
        toolCalls: [
          { id: '', name: '', arguments: {} },
          { id: 'c1', name: 'echo_tool', arguments: { x: 2 } },
        ],
      },
      { text: 'итог' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    // Выполнен только валидный вызов; фантом не создал tool-результат
    assert.equal(toolState.calls, 1);
    assert.deepEqual(toolState.lastArgs, { x: 2 });
    const assistants = res.messages.filter((m) => m.role === 'assistant' && m.tool_calls);
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].tool_calls.length, 1);
    assert.equal(assistants[0].tool_calls[0].id, 'c1');
    const toolMsgs = res.messages.filter((m) => m.role === 'tool');
    assert.equal(toolMsgs.length, 1);
    assert.equal(toolMsgs[0].tool_call_id, 'c1');
    assertHistoryClean(res.messages);
    // Пометка в диалоге: сколько вызовов проигнорировано
    const note = res.messages.find((m) => m.role === 'user' && m.content.includes('проигнорировано'));
    assert.ok(note, 'должна быть user-заметка о проигнорированных фантомах');
    assert.match(note.content, /проигнорировано 1 tool_call/);
    // Валидные вызовы без регрессий: перед финальным ходом в истории
    // user → assistant(valid) → tool → user(заметка)
    assert.equal(res.messages.at(-1).role, 'assistant');
  });

  it('AC2: 3 фантома подряд → fail, транскрипт заканчивается assistant без tool_calls (VL-103)', async () => {
    const phantom = { text: '', toolCalls: [{ id: '', name: '', arguments: {} }] };
    const { llm, state } = fakeLlm([phantom, phantom, phantom]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, true);
    assert.match(res.result, /пустым name\/id/);
    assert.equal(state.calls, 3, 'guard срабатывает на 3-м фантомном ходе');
    // Контракт resume VL-103: последнее сообщение — assistant БЕЗ tool_calls
    const last = res.messages.at(-1);
    assert.equal(last.role, 'assistant');
    assert.equal(last.tool_calls, undefined);
    assertHistoryClean(res.messages);
    assert.ok(!res.messages.some((m) => m.role === 'tool'), 'tool-сообщений быть не должно');
  });
});

describe('Санация отравленной начальной истории в wire-payload (VL-216)', () => {
  it('resume-подобная история с отравленной парой → payload в streamChat чист, валидные пары целы', async () => {
    // Отравленная история старых jsonl (VL-214): фантом рядом с валидным
    // вызовом; оба tool-результата записаны (включая пустой ключ)
    const poisoned = [
      { role: 'user', content: 'постановка' },
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
      { role: 'user', content: 'продолжай' },
    ];
    const snapshot = structuredClone(poisoned);
    const { llm, state } = fakeLlm([{ text: 'итог' }]);
    const res = await runLoop({ llm, messages: poisoned, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    // Payload первого запроса: пустых ключей нет, пара c1 цела
    const payload = state.messages[0];
    const assistants = payload.filter((m) => m.role === 'assistant' && m.tool_calls);
    assert.equal(assistants.length, 1, 'ровно один assistant с tool_calls в wire');
    assert.deepEqual(
      assistants[0].tool_calls.map((tc) => tc.id),
      ['c1'],
      'фантом из середины вырезан, валидный вызов сохранён',
    );
    const tools = payload.filter((m) => m.role === 'tool');
    assert.deepEqual(tools.map((t) => t.tool_call_id), ['c1'], 'tool с пустым ключом вырезан');
    assert.ok(!JSON.stringify(payload).includes('"tool_call_id":""'),
      'wire-payload не должен содержать пустых tool_call_id');
    // Исходная история НЕ мутирована (jsonl-контракт VL-103 — источник правды)
    assert.deepEqual(poisoned, snapshot, 'sanitize не мутирует входную историю');
  });

  it('только отравленная пара (content=null) → вырезана из payload, фаза завершается', async () => {
    const poisoned = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: '', name: '', arguments: {} }],
      },
      { role: 'tool', tool_call_id: '', content: 'мусор' },
    ];
    const { llm, state } = fakeLlm([{ text: 'итог' }]);
    const res = await runLoop({ llm, messages: poisoned, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'итог');
    // Payload: только user + финальный… нет, финальный assistant дописывается ПОСЛЕ
    // первого запроса — в payload только очищенная начальная история
    assert.deepEqual(
      state.messages[0].map((m) => m.role),
      ['user'],
      'отравленная пара целиком вырезана из wire',
    );
    assert.ok(!state.messages[0].some((m) => m.role === 'assistant'),
      'assistant(content=null без валидных вызовов) вырезан, а не отправлен как есть');
  });
});
