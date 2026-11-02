/**
 * Тесты VL-83 — tool-calling loop (src/agent/loop.ts).
 *
 * Фейковый llm (очередь ответов/ошибок), без сети: happy path, loop
 * detection, оба лимита, ошибка handler (loop продолжает), ошибка llm.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { runLoop, compactWireMessages } from '../../dist/agent/loop.js';
import { zeroUsage, MAX_PAYLOAD_BYTES, PAYLOAD_WARN_BYTES, PAYLOAD_COMPACT_TOOL_CHARS } from '../../dist/agent/llm.js';
import { TOOL_OUTPUT_MAX_CHARS } from '../../dist/agent/tools.js';
import { REPEAT_BLOCK_MAX_PER_RUN } from '../../dist/agent/repeat-tracker.js';

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
    // VL-221: без tool_calls счётчик рана = 0
    assert.equal(res.tool_calls_total, 0);
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
    // VL-221: tool-calls рана считается отдельно от LLM-запросов
    assert.equal(res.tool_calls_total, 1);
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

// ── VL-230: байтовое предупреждение и автокомпакт истории ──

describe('runLoop байтовый автокомпакт (VL-230)', () => {
  /** Перехват stderr-предупреждений payload (console.error перехватывается). */
  function captureStderr() {
    const lines = [];
    const orig = console.error;
    console.error = (...args) => {
      lines.push(args.join(' '));
    };
    return {
      lines,
      restore() {
        console.error = orig;
      },
    };
  }

  it('AC4/AC3: фикстура ~900 КБ → предупреждение, компакт < лимита, фаза успешна', async () => {
    const { spec } = countingTool();
    // 45 tool-сообщений по ~20 КБ ≈ 900 КБ истории
    const bigHistory = [{ role: 'user', content: 'сделай' }];
    for (let i = 0; i < 45; i++) {
      bigHistory.push(
        { role: 'assistant', content: null, tool_calls: [{ id: `t${i}`, name: 'echo_tool', arguments: { x: i } }] },
        { role: 'tool', tool_call_id: `t${i}`, content: `данные ${i}: ${'x'.repeat(20_000)}` },
      );
    }
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }], payloadBytes: 950_000 },
      { text: 'готово', payloadBytes: 300_000 },
    ]);
    const cap = captureStderr();
    let res;
    try {
      res = await runLoop({ llm, messages: bigHistory, tools: [spec] });
    } finally {
      cap.restore();
    }
    // AC3: фаза не упала и не откатилась
    assert.equal(res.is_error, false, 'фаза завершилась успешно после компакта');
    // AC1: предупреждение с текущими байтами и порогом в stderr
    const warn = cap.lines.find((l) => l.includes('предупреждение payload'));
    assert.ok(warn, 'предупреждение payload в stderr');
    assert.match(warn, /байт >= порог \d+/, 'текущие байты и порог в предупреждении');
    // AC4: исходная фикстура > лимита, а wire после компакта < лимита
    const origBytes = Buffer.byteLength(JSON.stringify(bigHistory), 'utf8');
    assert.ok(origBytes > MAX_PAYLOAD_BYTES, `исходная история ${origBytes} > лимита ${MAX_PAYLOAD_BYTES}`);
    const wireBytes = Buffer.byteLength(JSON.stringify(state.messages[0]), 'utf8');
    assert.ok(wireBytes < MAX_PAYLOAD_BYTES, `payload после компакта ${wireBytes} < лимита ${MAX_PAYLOAD_BYTES}`);
  });

  it('AC1: payload < порога → предупреждения нет', async () => {
    const { llm } = fakeLlm([{ text: 'ок', payloadBytes: 100_000 }]);
    const cap = captureStderr();
    let res;
    try {
      res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    } finally {
      cap.restore();
    }
    assert.equal(res.is_error, false);
    assert.equal(
      cap.lines.filter((l) => l.includes('предупреждение payload')).length,
      0,
      'нет предупреждения при маленьком payload',
    );
  });

  it('AC2: wire компактизируется (tool → 2048), не-tool сообщения не тронуты, messages исходны', async () => {
    const { spec } = countingTool();
    const bigHistory = [{ role: 'system', content: 'инструкция' }, { role: 'user', content: 'сделай' }];
    for (let i = 0; i < 45; i++) {
      bigHistory.push(
        { role: 'assistant', content: `план ${i}`, tool_calls: [{ id: `t${i}`, name: 'echo_tool', arguments: { x: i } }] },
        { role: 'tool', tool_call_id: `t${i}`, content: `данные ${i}: ${'y'.repeat(20_000)}` },
      );
    }
    const { llm, state } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'echo_tool', arguments: { x: 1 } }], payloadBytes: 950_000 },
      { text: 'готово', payloadBytes: 200_000 },
    ]);
    const cap = captureStderr();
    let res;
    try {
      res = await runLoop({ llm, messages: bigHistory, tools: [spec] });
    } finally {
      cap.restore();
    }
    assert.equal(res.is_error, false);
    // AC2 (первая часть): исходная история > порога, значит компакт сработал
    // на первом же запросе — wire уже усечён, байты wire < порога.
    const wire = state.messages[0];
    const wireBytes = Buffer.byteLength(JSON.stringify(wire), 'utf8');
    assert.ok(wireBytes < PAYLOAD_WARN_BYTES, `wire после компакта ${wireBytes} < порога ${PAYLOAD_WARN_BYTES}`);
    // tool-выводы усечены до PAYLOAD_COMPACT_TOOL_CHARS (+ маркер усечения)
    const wireTools = wire.filter((m) => m.role === 'tool');
    assert.equal(wireTools.length, 45, 'tool-сообщения не выброшены (парность tool_calls ↔ tool)');
    for (const t of wireTools) {
      assert.ok(
        t.content.length <= PAYLOAD_COMPACT_TOOL_CHARS + 200,
        `tool-вывод усечён: ${t.content.length} символов`,
      );
      assert.match(t.content, /вывод усечён до/, 'маркер усечения в tool-выводе');
    }
    // Не-tool сообщения (system/user/assistant-тексты — AC/план) побайтово целы
    const wireNonTool = wire.filter((m) => m.role !== 'tool');
    const origNonTool = bigHistory.filter((m) => m.role !== 'tool');
    assert.equal(JSON.stringify(wireNonTool), JSON.stringify(origNonTool), 'не-tool сообщения не тронуты');
    // jsonl-источник (messages) не мутирован: исходные tool-выводы (t0..t44)
    // по-прежнему полные 20 КБ (в messages новый tool-вывод фазы короче).
    const origTools = res.messages.filter((m) => m.role === 'tool' && /^t\d+$/.test(m.tool_call_id));
    assert.equal(origTools.length, 45, 'все 45 исходных tool-выводов в messages');
    assert.ok(
      origTools.every((m) => m.content.length > 10_000),
      'исходные tool-выводы в messages целы (не мутированы)',
    );
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

  it('VL-251: директива уходит tool-результатом (не assistant) и содержит следующий шаг', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 1 } }] },
      { text: 'остановился' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(toolState.calls, 2, 'третий вызов не выполняется');
    const directive = res.messages.find(
      (m) => m.role === 'tool' && m.tool_call_id === 'c3',
    );
    assert.ok(directive, 'директива должна прийти tool-результатом заблокированного вызова');
    assert.match(String(directive.content), /Loop detection/);
    assert.match(String(directive.content), /Следующий шаг/);
    assert.equal(res.is_error, false, 'модель сменила поведение — фаза продолжается');
    assert.deepEqual(res.blocked_signatures, ['t|{"x":1}'], 'сигнатура блока записывается в результат');
  });

  it('VL-251: 2-й заблокированный вызов подряд → fail (директива проигнорирована)', async () => {
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
    assert.match(res.result, /Следующий шаг/);
    assert.equal(toolState.calls, 2, 'заблокированные вызовы не выполняются');
  });

  it('VL-251 (AC5): сигнатура из blockedSignatures блокируется без исполнения', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: 'сменил подход' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      limits: { blockedSignatures: ['t|{"x":1}'] },
    });
    assert.equal(toolState.calls, 0, 'заблокированный после resume вызов не должен исполняться');
    const directive = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c1');
    assert.ok(directive, 'модель получает tool-результат о блокировке');
    assert.match(String(directive.content), /Loop detection/);
    assert.equal(res.is_error, false);
    // Сигнатура уже была в мете — повторно её не возвращаем (идемпотентность записи)
    assert.equal(res.blocked_signatures, undefined);
  });

  it('VL-253 (AC4): повторная блокировка той же сигнатуры → fail сразу', async () => {
    const { spec, state: toolState } = countingTool('t');
    // Ходы: 1-2 исполняются, 3-й блокируется директивой, 4-й — та же сигнатура
    // (повторная блокировка) → немедленный fail без исполнения.
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 1 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true, 'повторная блокировка обязана прерывать фазу');
    assert.match(res.result, /Loop detection/);
    assert.equal(toolState.calls, 2, 'заблокированные вызовы не выполняются');
  });

  it('VL-253 (AC4): сигнатура из blockedSignatures, повторённая дважды → fail', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 1 } }] },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      limits: { blockedSignatures: ['t|{"x":1}'] },
    });
    assert.equal(toolState.calls, 0, 'заблокированная сигнатура не исполняется');
    assert.equal(res.is_error, true, 'второй повтор блокированной сигнатуры → fail');
    assert.match(res.result, /Loop detection/);
  });

  it('VL-253 (AC4): кап заблокированных вызовов за ран', async () => {
    // 18 ходов: 6 групп по 3 одинаковых вызова разных аргументов. В каждой
    // группе третий вызов блокируется → 6 разных блоков, серия «подряд»
    // сбрасывается, но общий кап (5) обязан прервать ран.
    const script = [];
    for (let g = 0; g < 6; g++) {
      for (let k = 0; k < 3; k++) {
        script.push({ text: '', toolCalls: [{ id: `c${g}${k}`, name: 't', arguments: { g } }] });
      }
    }
    const { spec } = countingTool('t');
    const { llm } = fakeLlm(script);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true, 'кап блоков обязан прерывать ран');
    assert.match(res.result, /Loop detection/);
  });

  it('VL-309 (AC1): повтор noop-вызова не обрывает ран — директива «Изменений нет», цикл продолжается (сессия agent-1793647788155)', async () => {
    // Регресс на реальную сессию Close VL-307: модель повторяла
    // lesson_update с теми же аргументами, ответ был noop («изменений нет»),
    // а VL-304 складывал noop в appliedSignatures → первый же повтор
    // завершал ран «штатно» и Close не доходил до документации, хотя задача
    // получила Done через авто-отчёт. Теперь повтор noop-вызова НЕ
    // исполняется, ран продолжается и модель работает дальше.
    const state = { calls: 0 };
    const spec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => {
        state.calls++;
        // VL-304: noop — ошибка, а не успех (ok:false + reason:'noop')
        return JSON.stringify({ ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [] });
      },
    };
    const same = { id: 'VL-302', type: 'feature' };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_update_task', arguments: { id: 'VL-302', title: 'T' } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_update_task', arguments: same }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'backlog_update_task', arguments: same }] },
      { text: 'перехожу к документации' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false, `ран не должен падать: ${res.result}`);
    assert.equal(res.result, 'перехожу к документации', 'ран продолжается до финального текста модели');
    assert.equal(state.calls, 2, 'исполнены c1 и первый c2; повтор c3 с noop-сигнатурой — нет');
    const directive = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c3');
    assert.ok(directive, 'модель получает директиву на повтор noop-вызова');
    assert.match(String(directive.content), /Изменений нет/);
    assert.match(String(directive.content), /Следующий шаг/);
    assert.equal(res.messages[res.messages.length - 1].role, 'assistant');
  });

  it('VL-309 (AC1): вечный повтор noop-вызова → честный fail, а не «успех»', async () => {
    // Кап MAX_NOOP_REPEATS_PER_RUN: если модель игнорирует директиву и
    // повторяет noop-вызов бесконечно, ран завершается is_error:true —
    // оркестратор откатит статус и запустит авто-resume, вместо ложного
    // «ран завершён штатно» при невыполненной работе.
    const state = { calls: 0 };
    const spec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => {
        state.calls++;
        return JSON.stringify({ ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [] });
      },
    };
    const same = { id: 'VL-302', type: 'feature' };
    const repeated = Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i + 1}`, name: 'backlog_update_task', arguments: same }],
    }));
    const { llm } = fakeLlm(repeated);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true, 'вечный повтор noop-вызова должен честно прерывать фазу');
    assert.match(res.result, /повторила вызов backlog_update_task/);
    assert.equal(state.calls, 1, 'вызов исполнялся только один раз');
    assert.equal(res.messages[res.messages.length - 1].role, 'assistant');
  });

  it('VL-304 (AC2): повтор применённого (ok:true) вызова по-прежнему завершает ран штатно', async () => {
    // VL-309 не откатывает VL-304: для РЕАЛЬНО применённого вызова
    // (ok:true) штатный выход остаётся — работа сделана, терять нечего.
    const state = { calls: 0 };
    const spec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => {
        state.calls++;
        return JSON.stringify({ ok: true, message: 'обновлено' });
      },
    };
    const same = { id: 'VL-302', type: 'feature' };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_update_task', arguments: same }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_update_task', arguments: same }] },
      { text: 'не должно дойти' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false);
    assert.match(res.result, /зациклилась на уже применённом вызове/);
    assert.equal(state.calls, 1, 'повтор применённого вызова не исполняется');
    assert.equal(res.messages[res.messages.length - 1].role, 'assistant');
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
    // VL-221: маркер флага с лимитом + явное разграничение счётчиков
    assert.match(res.result, /--max-tool-calls \(2\)/);
    assert.match(res.result, /tool-calls текущего рана: 2\/2/);
    assert.match(res.result, /LLM-запросы/);
    assert.equal(toolState.calls, 2);
    assert.equal(res.tool_calls_total, 2, 'tool_calls_total = число вызовов рана');
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

  it('частичный текст сохраняется в partial-результате при лимите', async () => {    const { llm } = fakeLlm([
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

describe('кумулятивный per-session лимит tool-calls (VL-223)', () => {
  it('base=3, лимит=3: первый вызов модели → fail «--tool-calls-per-session», инструмент не вызван', async () => {
    const { spec, state: toolState } = countingTool('t');
    const starts = [];
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      // база уже исчерпала лимит (3 из 3) — любой новый вызов выходит за него
      limits: { maxToolCallsPerSession: 3, toolCallsUsedThisSession: 3 },
      onToolStart: (name) => starts.push(name),
    });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--tool-calls-per-session \(3\)/);
    // счётчик в сообщении — base (3), toolCallsTotal ещё не инкрементирован
    assert.match(res.result, /использовано 3 из 3/);
    assert.match(res.result, /прошлые раны/);
    assert.equal(toolState.calls, 0, 'инструмент не должен был выполниться');
    assert.equal(starts.length, 0, 'onToolStart не вызывается при превышении');
  });

  it('base=0, лимит=3: три вызова проходят, четвёртый → fail', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
      { text: '', toolCalls: [{ id: 'c4', name: 't', arguments: { x: 4 } }] },
      { text: '', toolCalls: [{ id: 'c5', name: 't', arguments: { x: 5 } }] },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      limits: { maxToolCallsPerSession: 3, toolCallsUsedThisSession: 0 },
    });
    assert.equal(res.is_error, true);
    // base 0 + 3 выполненных = 3; 4-й вызов упирается в лимит → fail ДО выполнения
    assert.match(res.result, /--tool-calls-per-session \(3\)/);
    assert.match(res.result, /использовано 3 из 3/);
    assert.equal(toolState.calls, 3, 'ровно 3 вызова до fail');
  });

  it('per-run и per-session одновременно: per-session срабатывает при base>0, пока per-run не превышен', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 't', arguments: { x: 3 } }] },
    ]);
    // per-run лимит 100 (не превышен), per-session: base 98 + лимит 100 →
    // первый вызов проходит (98+1=99 ≤ 100), второй упирается в лимит
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      limits: { maxToolCalls: 100, maxToolCallsPerSession: 100, toolCallsUsedThisSession: 98 },
    });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--tool-calls-per-session \(100\)/, 'должен сработать per-session, а не per-run');
    // fail наступает, когда base (98) + toolCallsTotal (2, включая этот вызов)
    // + 1 > 100 — счётчик в сообщении отражает уже выполненные: 98+2=100
    assert.match(res.result, /использовано 100 из 100/);
    assert.doesNotMatch(res.result, /--max-tool-calls/);
    assert.equal(toolState.calls, 2, 'два вызова прошли (99 и 100), третий — fail');
  });

  it('без maxToolCallsPerSession поведение прежнее (регресс per-run, AC#2)', async () => {
    const { spec, state: toolState } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: 'готово' },
    ]);
    // toolCallsUsedThisSession без maxToolCallsPerSession — лимит не активен
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [spec],
      limits: { toolCallsUsedThisSession: 500 },
    });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'готово');
    assert.equal(toolState.calls, 1);
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

describe('Пустой финал: диагностика и один повтор (VL-217)', () => {
  /** Перехват console.error по образцу llm.test.mjs (VL-199): строки + restore. */
  const captureErrors = () => {
    const orig = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    return { captured, restore: () => { console.error = orig; } };
  };

  it('две пустоты подряд: один повтор, затем is_error с диагностикой (AC2/AC3)', async () => {
    const { llm, state } = fakeLlm([{ text: '' }, { text: '' }]);
    const { captured, restore } = captureErrors();
    let res;
    try {
      res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    } finally {
      restore();
    }
    assert.equal(res.is_error, true);
    assert.equal(state.calls, 2, 'ровно один повтор');
    assert.match(res.result, /Пустой ответ модели/);
    assert.match(res.result, /отравленн|отказ провайдера/);
    const line = captured.find((l) => l.includes('пустой финал'));
    assert.ok(line, 'лог пустого финала в stderr: ' + captured.join('\n'));
    assert.match(line, /payload=/);
    assert.match(line, /usage=\{/);
    const line2 = captured.find((l) => l.includes('попытка 2'));
    assert.ok(line2, 'вторая попытка зафиксирована в логе');
  });

  it('повтор успешен: вторая попытка непустая → успех (AC2)', async () => {
    const { llm, state } = fakeLlm([{ text: '' }, { text: 'Готово!' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'Готово!');
    assert.equal(state.calls, 2, 'один повтор');
    assert.equal(res.num_turns, 2);
  });

  it('payload и гипотеза VL-197 (>140КБ) в диагностике', async () => {
    const { llm } = fakeLlm([{ text: '', payloadBytes: 150000 }, { text: '' }]);
    const { captured, restore } = captureErrors();
    try {
      await runLoop({ llm, messages: USER_MSG, tools: [] });
    } finally {
      restore();
    }
    const line = captured.find((l) => l.includes('пустой финал'));
    assert.ok(line, 'лог пустого финала есть');
    assert.match(line, /payload=150000 байт/);
    assert.match(line, />140КБ=да/);
  });

  it('без payloadBytes → н/д в диагностике', async () => {
    const { llm } = fakeLlm([{ text: '' }, { text: '' }]);
    const { captured, restore } = captureErrors();
    try {
      await runLoop({ llm, messages: USER_MSG, tools: [] });
    } finally {
      restore();
    }
    const line = captured.find((l) => l.includes('пустой финал'));
    assert.ok(line, 'лог пустого финала есть');
    assert.match(line, /payload=н\/д байт/);
    assert.match(line, />140КБ=н\/д/);
  });

  it('отравленная пара в истории → есть-пустые-tool_calls=да', async () => {
    const poisoned = [
      ...USER_MSG,
      { role: 'assistant', content: null, tool_calls: [{ id: '', name: '', arguments: {} }] },
      { role: 'tool', tool_call_id: '', content: 'фантомный результат' },
    ];
    const { llm } = fakeLlm([{ text: '' }, { text: '' }]);
    const { captured, restore } = captureErrors();
    try {
      await runLoop({ llm, messages: poisoned, tools: [] });
    } finally {
      restore();
    }
    const line = captured.find((l) => l.includes('пустой финал'));
    assert.ok(line, 'лог пустого финала есть');
    assert.match(line, /есть-пустые-tool_calls=да/);
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

describe('runLoop guard повторов обращений (VL-229)', () => {
  /** Инструмент с эхом аргументов: имитирует grep_search/read_file без fs. */
  function argTool(name, keyName) {
    return {
      name,
      description: 'тестовый инструмент с аргументами',
      inputSchema: { type: 'object', properties: { [keyName]: { type: 'string' } } },
      handler: async (args) => `ok:${name}:${JSON.stringify(args)}`,
    };
  }
  const hasWarn = (m) => m.role === 'user' && `${m.content}`.includes('используй ранее полученный результат');

  it('AC2: 3-й grep с тем же pattern → user-сообщение с предупреждением после tool-результатов', async () => {
    // Повторы в реальных сессиях НЕ подряд (подряд их ловит loop detection,
    // порог 3 одинаковых подряд) — поэтому вызовы перемежаются другими
    // инструментами: guard ловит именно «зацикливание с отвлечением».
    const g = (id) => ({ id, name: 'grep_search', arguments: { pattern: 'baseUrl' } });
    const r = (id) => ({ id, name: 'read_file', arguments: { path: `${id}.ts` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [g('c1'), r('r1')] },
      { text: '', toolCalls: [g('c2'), r('r2')] },
      { text: '', toolCalls: [g('c3')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [argTool('grep_search', 'pattern'), argTool('read_file', 'path')],
    });
    assert.equal(res.is_error, false);
    const warnings = res.messages.filter(hasWarn);
    assert.equal(warnings.length, 1, 'ровно одно предупреждение — на 3-м обращении к pattern');
    assert.match(warnings[0].content, /grep_search\|baseUrl 3 раз/);
    // Риск 1 плана: паринг assistant↔tool не нарушен — между assistant(tool_calls)
    // и его tool-результатом нет посторонних сообщений (предупреждение ПОСЛЕ хода).
    for (let i = 0; i < res.messages.length; i++) {
      const m = res.messages[i];
      if (m.role !== 'assistant' || !m.tool_calls) continue;
      for (const tc of m.tool_calls) {
        const toolAt = res.messages.findIndex((x) => x.role === 'tool' && x.tool_call_id === tc.id);
        assert.ok(toolAt > i, 'tool-результат после своего assistant');
        const between = res.messages.slice(i + 1, toolAt).filter((x) => x.role !== 'tool');
        assert.equal(between.length, 0, 'между assistant(tool_calls) и tool — только tool-сообщения');
      }
    }
  });

  it('разные pattern — предупреждения нет (нет ложных срабатываний)', async () => {
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'grep_search', arguments: { pattern: 'a' } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'grep_search', arguments: { pattern: 'b' } }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'grep_search', arguments: { pattern: 'c' } }] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [argTool('grep_search', 'pattern')] });
    assert.equal(res.messages.filter(hasWarn).length, 0);
  });

  it('repeatGuardDisabled → предупреждений нет, но repeat_stats считается', async () => {
    // Перемежение разными pattern: 3 одинаковых ПОДРЯД сработали бы loop detection,
    // а нам нужен именно guard — поэтому одинаковые чтения идут через другие вызовы.
    const same = (id) => ({ id, name: 'read_file', arguments: { path: 'src/agent/loop.ts' } });
    const other = (id) => ({ id, name: 'read_file', arguments: { path: `${id}.ts` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [same('a'), other('o1')] },
      { text: '', toolCalls: [same('b'), other('o2')] },
      { text: '', toolCalls: [same('c'), other('o3')] },
      { text: '', toolCalls: [same('d'), other('o4')] },
      { text: '', toolCalls: [same('e')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [argTool('read_file', 'path')],
      limits: { repeatGuardDisabled: true },
    });
    assert.equal(res.messages.filter(hasWarn).length, 0);
    assert.equal(res.repeat_stats.repeat_calls, 4, '5 обращений к одному path → 4 повторных');
  });

  it('AC1: LoopResult.repeat_stats — повторы, доля и топ по ключу', async () => {
    const call = (id, pattern) => ({ id, name: 'grep_search', arguments: { pattern } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [call('c1', 'foo'), call('c2', 'bar')] },
      { text: '', toolCalls: [call('c3', 'foo'), call('c4', 'foo')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [argTool('grep_search', 'pattern')] });
    assert.equal(res.repeat_stats.tool_calls_total, 4);
    assert.equal(res.repeat_stats.repeat_calls, 2);
    assert.equal(res.repeat_stats.repeat_share, 0.5);
    assert.deepEqual(res.repeat_stats.top[0], { key: 'grep_search|foo', count: 3 });
  });

  it('fail-путь тоже несёт repeat_stats (не падает на ошибке лимита)', async () => {
    const call = (id) => ({ id, name: 'read_file', arguments: { path: 'a.ts' } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [call('c1')] },
      { text: '', toolCalls: [call('c2')] },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [argTool('read_file', 'path')],
      limits: { maxToolCalls: 1 },
    });
    assert.equal(res.is_error, true);
    // Метрика транскриптная (как и /analyze): assistant-ход, который упёрся
    // в лимит, уже записан в messages с tool_calls — его вызов тоже виден.
    assert.equal(res.repeat_stats.tool_calls_total, 2);
    assert.equal(res.repeat_stats.repeat_calls, 1);
  });

  it('порог read=5: предупреждение на 5-м чтении, 4-е — молчание', async () => {
    const same = (id) => ({ id, name: 'read_file', arguments: { path: 'src/agent/cli.ts' } });
    const other = (id) => ({ id, name: 'grep_search', arguments: { pattern: `p-${id}` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [same('a'), other('o1')] },
      { text: '', toolCalls: [same('b'), other('o2')] },
      { text: '', toolCalls: [same('c'), other('o3')] },
      { text: '', toolCalls: [same('d')] },
      { text: '', toolCalls: [same('e')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [argTool('read_file', 'path'), argTool('grep_search', 'pattern')],
    });
    const warnings = res.messages.filter(hasWarn);
    assert.equal(warnings.length, 1, 'только на 5-м чтении (4-е — молчание)');
    assert.match(warnings[0].content, /5 раз/);
  });

  it('VL-284: 8-я правка того же файла НЕ выполняется — tool-результат с директивой, паринг цел', async () => {
    // Стаб-handler считает реальные исполнения: 7 первых правок проходят,
    // 8-я блокируется guard'ом (порог REPEAT_WRITE_BLOCK_DEFAULT = 8).
    let executed = 0;
    const editTool = {
      name: 'edit',
      description: 'правка файла',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async () => {
        executed++;
        return 'ok:edit';
      },
    };
    const same = (id) => ({ id, name: 'edit', arguments: { path: 'src/a.ts' } });
    // Перемежение «другими» правками, чтобы loop detection (3 одинаковых подряд)
    // не сработал раньше guard'а — нам нужна именно эскалация по счётчику.
    const other = (id) => ({ id, name: 'edit', arguments: { path: `src/${id}.ts` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [same('a'), other('o1')] },
      { text: '', toolCalls: [same('b'), other('o2')] },
      { text: '', toolCalls: [same('c'), other('o3')] },
      { text: '', toolCalls: [same('d'), other('o4')] },
      { text: '', toolCalls: [same('e'), other('o5')] },
      { text: '', toolCalls: [same('f'), other('o6')] },
      { text: '', toolCalls: [same('g')] },
      { text: '', toolCalls: [same('h')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [editTool] });
    assert.equal(res.is_error, false);
    // 7 правок src/a.ts (a..g) + 6 «других» правок исполнены; 8-я (h) заблокирована
    assert.equal(executed, 13, '7 правок src/a.ts + 6 посторонних, 8-я заблокирована');
    const blocked = res.messages.filter((m) => m.role === 'tool' && `${m.content}`.includes('Повтор заблокирован'));
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].content, /edit\|src\/a\.ts — 8 обращений/);
    assert.equal(res.repeat_blocked, 1);
    // Риск 1 плана: блокировка — это tool-результат, паринг assistant↔tool цел
    for (let i = 0; i < res.messages.length; i++) {
      const m = res.messages[i];
      if (m.role !== 'assistant' || !m.tool_calls) continue;
      for (const tc of m.tool_calls) {
        const toolAt = res.messages.findIndex((x) => x.role === 'tool' && x.tool_call_id === tc.id);
        assert.ok(toolAt > i, `tool-результат для ${tc.id} после своего assistant`);
      }
    }
  });

  it('VL-284: repeatGuardDisabled → правки не блокируются (fail-open)', async () => {
    let executed = 0;
    const editTool = {
      name: 'edit',
      description: 'правка файла',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async () => {
        executed++;
        return 'ok:edit';
      },
    };
    const same = (id) => ({ id, name: 'edit', arguments: { path: 'src/a.ts' } });
    const other = (id) => ({ id, name: 'edit', arguments: { path: `src/${id}.ts` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [same('a'), other('o1')] },
      { text: '', toolCalls: [same('b'), other('o2')] },
      { text: '', toolCalls: [same('c'), other('o3')] },
      { text: '', toolCalls: [same('d'), other('o4')] },
      { text: '', toolCalls: [same('e'), other('o5')] },
      { text: '', toolCalls: [same('f'), other('o6')] },
      { text: '', toolCalls: [same('g')] },
      { text: '', toolCalls: [same('h')] },
      { text: 'Готово!' },
    ]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [editTool],
      limits: { repeatGuardDisabled: true },
    });
    assert.equal(executed, 14, 'все 8 правок src/a.ts + 6 посторонних исполнены');
    assert.equal(res.messages.filter((m) => m.role === 'tool' && `${m.content}`.includes('Повтор заблокирован')).length, 0);
    assert.equal(res.repeat_blocked ?? 0, 0);
  });

  it('VL-284: кап REPEAT_BLOCK_MAX_PER_RUN (5) — блокировок не больше 5 за ран', async () => {
    const other = (id) => ({ id, name: 'edit', arguments: { path: `src/${id}.ts` } });
    const same = (id) => ({ id, name: 'edit', arguments: { path: 'src/a.ts' } });
    // 12 правок src/a.ts вперемешку: первые 7 идут, дальше 5 блокируются (кап)
    const turns = [];
    for (let i = 0; i < 12; i++) {
      turns.push({ text: '', toolCalls: [same(`s${i}`), other(`o${i}`)] });
    }
    turns.push({ text: 'Готово!' });
    const { llm } = fakeLlm(turns);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [{
        name: 'edit',
        description: 'правка файла',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        handler: async () => 'ok:edit',
      }],
    });
    assert.equal(res.is_error, false);
    assert.equal(res.repeat_blocked, REPEAT_BLOCK_MAX_PER_RUN, 'кап блокировок — 5');
  });
});

describe('VL-254: бюджет wall-time и прогресс до обрыва (AC2/AC4)', () => {
  /** Управляемые часы: тест двигает время между ходами без sleep. */
  function clock(start = 1_000_000) {
    const state = { value: start };
    return { now: () => state.value, state };
  }

  /** Инструмент с произвольным набором аргументов (lint требует свойства). */
  function anyTool(name) {
    return {
      name,
      description: 'тестовый инструмент',
      inputSchema: { type: 'object', properties: {} },
      handler: async (args) => `ok:${name}:${JSON.stringify(args)}`,
    };
  }

  it('AC2: на 70% и 90% бюджета (10 с) инжектируются предупреждения, фаза продолжается', async () => {
    const { spec } = countingTool('t');
    const c = clock();
    let turn = 0;
    const { llm } = fakeLlm([
      () => ({
        text: '',
        toolCalls: [{ id: `a${++turn}`, name: 't', arguments: { x: turn } }],
        usage: zeroUsage(),
      }),
      () => ({
        text: '',
        toolCalls: [{ id: `b${++turn}`, name: 't', arguments: { x: turn } }],
        usage: zeroUsage(),
      }),
      { text: 'Готово!' },
    ]);
    // Часы двигаются ДО запроса: 1-й ход → 7000 мс (70%), 2-й → 9500 мс (90%).
    // Продвижение привязано к вызову now() — иначе guard не увидит прогресс.
    c.state.value = 0;
    const now = () => c.state.value;
    const llmWithClock = {
      async streamChat(messages, tools, opts) {
        const before = turn;
        const res = await llm.streamChat(messages, tools, opts);
        // после ответа сдвигаем часы на нужную долю бюджета
        if (before === 0) c.state.value = 7_000;
        else if (before === 1) c.state.value = 9_500;
        return res;
      },
    };
    const res = await runLoop({
      llm: llmWithClock,
      messages: USER_MSG,
      tools: [spec],
      limits: { maxWallTimeMs: 10_000 },
      now,
    });
    assert.equal(res.is_error, false, 'предупреждения не прерывают фазу');
    const warns = res.messages.filter(
      (m) => m.role === 'user' && `${m.content}`.includes('Осталось') && `${m.content}`.includes('Payload'),
    );
    assert.equal(warns.length, 2, 'ровно два предупреждения (70% и 90%)');
    assert.match(warns[0].content, /Осталось 3 с из 10/);
    assert.match(warns[1].content, /Осталось 1 с из 10/);
    assert.match(warns[0].content, /порог компакта/);
  });

  it('AC4: обрыв по wall-time → progress.reason=wall-time, блок «Сделано/Осталось»', async () => {
    const editTool = {
      name: 'edit',
      description: 'правка',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async (args) => `ok:${args.path}`,
    };
    const c = clock();
    c.state.value = 0;
    const { llm } = fakeLlm([
      { text: 'правлю файл', toolCalls: [{ id: 'c1', name: 'edit', arguments: { path: 'src/a.ts' } }] },
      { text: 'ещё правка', toolCalls: [{ id: 'c2', name: 'edit', arguments: { path: 'src/b.ts' } }] },
    ]);
    // Часы уходят за бюджет после первого хода — обрыв на следующей итерации
    const res = await runLoop({
      llm: {
        async streamChat(messages, tools, opts) {
          const out = await llm.streamChat(messages, tools, opts);
          c.state.value = 99_999;
          return out;
        },
      },
      messages: USER_MSG,
      tools: [editTool],
      limits: { maxWallTimeMs: 10_000 },
      now: c.now,
    });
    assert.equal(res.is_error, true);
    assert.match(res.result, /--max-wall-time/);
    assert.ok(res.progress, 'блок прогресса заполнен');
    assert.equal(res.progress.reason, 'wall-time');
    assert.match(res.progress.text, /Сделано/);
    assert.match(res.progress.text, /Осталось/);
    assert.ok(res.progress.done.includes('src/a.ts'), 'пути правок попали в «Сделано»');
  });

  it('AC4: обрыв по max-requests → progress.reason=max-requests', async () => {
    const { spec } = countingTool('t');
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 't', arguments: { x: 2 } }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], limits: { maxRequests: 1 } });
    assert.equal(res.progress?.reason, 'max-requests');
  });

  it('успешная фаза progress не содержит', async () => {
    const { llm } = fakeLlm([{ text: 'Готово!' }]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [] });
    assert.equal(res.progress, undefined);
  });

  it('idleTimeoutMs=0: проверка выключена — ран жив и завершается нормально', async () => {
    const c = clock();
    c.state.value = 10_000_000; // огромный простой по часам
    const { llm } = fakeLlm([{ text: 'Готово!' }]);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [],
      limits: { idleTimeoutMs: 0 },
      now: c.now,
    });
    assert.equal(res.is_error, false);
    assert.equal(res.result, 'Готово!');
  });

  it('приоритет idle над wall-time: зависшая фаза → reason=idle, а не wall-time', async () => {
    const c = clock();
    c.state.value = 0;
    // Фантомный tool_call (пустые name/id) не исполняется и не даёт активности:
    // часы уходят за оба порога (idle 10 с, wall-time 50 с) при полной тишине.
    const res = await runLoop({
      llm: {
        async streamChat() {
          c.state.value = 200_000;
          return {
            text: '',
            toolCalls: [{ id: '', name: '', arguments: {} }],
            usage: zeroUsage(),
          };
        },
      },
      messages: USER_MSG,
      tools: [],
      limits: { idleTimeoutMs: 10_000, maxWallTimeMs: 50_000 },
      now: c.now,
    });
    assert.equal(res.is_error, true);
    assert.match(res.result, /idle-таймаут/, 'зависание важнее истёкшего потолка');
    assert.equal(res.progress.reason, 'idle', 'зависание не спутано с wall-time');
  });

  it('AC7 (VL-254): 30 минут виртуального времени с активностью каждые 5 минут — успешное завершение', async () => {
    const c = clock();
    c.state.value = 0;
    // wall-time 40 мин (как в проекте: 2400 с), idle 10 мин. Каждый ход
    // «работает» 5 минут и отдаёт токены стрима; суммарно 35 минут. Старая
    // проблема VL-254 — фаза сгорала на wall-time, хотя работала.
    let turn = 0;
    const { spec } = countingTool('t');
    const res = await runLoop({
      llm: {
        async streamChat(_messages, _tools, opts) {
          // Каждый ход «работает» 5 минут и отдаёт токены стрима (активность)
          if (turn >= 7) return { text: 'Готово!', toolCalls: [], usage: zeroUsage() };
          opts.onToken?.('работаю');
          c.state.value += 300_000;
          return {
            text: `шаг ${turn + 1}`,
            toolCalls: [{ id: `c${++turn}`, name: 't', arguments: { x: turn } }],
            usage: zeroUsage(),
          };
        },
      },
      messages: USER_MSG,
      tools: [spec],
      limits: { idleTimeoutMs: 600_000, maxWallTimeMs: 2_400_000 },
      now: c.now,
    });
    assert.equal(res.is_error, false, 'живая фаза 35 минут не обрывается ни idle, ни wall-time');
    assert.equal(res.result, 'Готово!');
    assert.equal(c.state.value, 7 * 300_000, 'виртуальное время — 35 минут');
  });

  it('AC2: редкие, но регулярные токены сбрасывают idle — долгая фаза не обрывается', async () => {
    const c = clock();
    c.state.value = 0;
    const { spec } = countingTool('t');
    let turn = 0;
    const res = await runLoop({
      llm: {
        async streamChat(_messages, _tools, opts) {
          // Стрим отдаёт токены редко (раз в 9 с при окне 10 с) — окно ни разу
          // не истекает, и ран продолжается
          c.state.value += 9_000;
          opts.onToken?.('думаю');
          c.state.value += 9_000;
          if (turn >= 3) return { text: 'Готово!', toolCalls: [], usage: zeroUsage() };
          return {
            text: '',
            toolCalls: [{ id: `c${++turn}`, name: 't', arguments: { x: turn } }],
            usage: zeroUsage(),
          };
        },
      },
      messages: USER_MSG,
      tools: [spec],
      limits: { idleTimeoutMs: 10_000 },
      now: c.now,
    });
    assert.equal(res.is_error, false, 'регулярная активность не даёт сработать watchdog');
    assert.equal(res.result, 'Готово!');
  });

  it('долгий tool (pause) не считается простоем: > idle, но ран жив', async () => {
    const c = clock();
    c.state.value = 0;
    let turn = 0;
    const slowTool = {
      name: 'slow',
      description: 'долгий инструмент',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        // Инструмент работает 5 минут «по часам» — вчетверо дольше idle (60 с)
        c.state.value += 300_000;
        return 'ok';
      },
    };
    const res = await runLoop({
      llm: {
        async streamChat() {
          if (turn >= 2) return { text: 'Готово!', toolCalls: [], usage: zeroUsage() };
          return {
            text: '',
            toolCalls: [{ id: `c${++turn}`, name: 'slow', arguments: {} }],
            usage: zeroUsage(),
          };
        },
      },
      messages: USER_MSG,
      tools: [slowTool],
      limits: { idleTimeoutMs: 60_000 },
      now: c.now,
    });
    assert.equal(res.is_error, false, 'долгий tool не ловится idle-watchdog');
    assert.equal(res.result, 'Готово!');
  });

  it('AC1: стрим молчит дольше idle → обрыв с reason=idle и is_error=true', async () => {
    const c = clock();
    c.state.value = 0;
    const { spec } = countingTool('t');
    let calls = 0;
    const res = await runLoop({
      llm: {
        async streamChat() {
          calls++;
          if (calls === 1) {
            // Первый ход: инструмент отработал — активность была
            return {
              text: '',
              toolCalls: [{ id: 'c1', name: 't', arguments: { x: 1 } }],
              usage: zeroUsage(),
            };
          }
          // Дальше модель «зависла»: тишина дольше окна (30 с при idle 10 с)
          c.state.value += 30_000;
          return { text: '', toolCalls: [{ id: '', name: '', arguments: {} }], usage: zeroUsage() };
        },
      },
      messages: USER_MSG,
      tools: [spec],
      limits: { idleTimeoutMs: 10_000 },
      now: c.now,
    });
    assert.equal(res.is_error, true);
    assert.match(res.result, /Превышен idle-таймаут \(10 секунд без активности\) — фаза прервана\./);
    assert.equal(res.progress?.reason, 'idle', 'отдельный reason — не путается с wall-time');
  });

  it('AC6: реальный idle-таймер абортит стрим через AbortSignal (не остаётся запроса)', async () => {
    const seen = { abortedDuringStream: false };
    const res = await runLoop({
      llm: {
        async streamChat(_messages, _tools, opts) {
          // Модель молчит: ждём дольше окна; abort приходит сигналом loop'а
          await new Promise((r) => setTimeout(r, 120));
          seen.abortedDuringStream = opts.signal?.aborted === true;
          if (seen.abortedDuringStream) throw new Error('Операция прервана пользователем');
          return { text: 'Готово!', toolCalls: [], usage: zeroUsage() };
        },
      },
      messages: USER_MSG,
      tools: [],
      limits: { idleTimeoutMs: 40 },
    });
    assert.equal(seen.abortedDuringStream, true, 'сигнал абортится по простою — висящего запроса нет');
    assert.equal(res.is_error, true);
    assert.match(res.result, /idle-таймаут/, 'аборт по простою — не «Ошибка LLM-запроса»');
    assert.equal(res.progress?.reason, 'idle');
  });

  it('AC1: три shell-вызова с одним скелетом → предупреждение guard’а + shell_* в метрике', async () => {
    const shell = {
      description: 'shell',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      handler: async (args) => `ok:${args.command}`,
    };
    const cmd = 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\')"';
    const other = (id) => ({ id, name: 'read_file', arguments: { path: `${id}.ts` } });
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: cmd } }, other('o1')] },
      { text: '', toolCalls: [{ id: 's2', name: 'run_shell_command', arguments: { command: cmd } }, other('o2')] },
      { text: '', toolCalls: [{ id: 's3', name: 'run_shell_command', arguments: { command: cmd } }, other('o3')] },
      { text: 'Готово!' },
    ]);
    const readTool = {
      name: 'read_file',
      description: 'чтение',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async (args) => `ok:${args.path}`,
    };
    const res = await runLoop({ llm, messages: USER_MSG, tools: [shell, readTool] });
    const warns = res.messages.filter(
      (m) => m.role === 'user' && `${m.content}`.includes('используй ранее полученный результат'),
    );
    assert.equal(warns.length, 1, 'предупреждение на 3-м shell-скелете');
    assert.match(warns[0].content, /3 раз/);
    assert.equal(res.repeat_stats.shell_tool_calls, 3);
    assert.equal(res.repeat_stats.shell_repeat_calls, 2);
  });

  it('shell-скелет в ctx: remainingWallTimeMs доходит до handler', async () => {
    let seen = null;
    const shell = {
      name: 'run_shell_command',
      description: 'shell',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      handler: async (args, ctx) => {
        seen = ctx?.remainingWallTimeMs?.();
        return 'ok';
      },
    };
    const c = clock();
    c.state.value = 0;
    const { llm } = fakeLlm([
      () => ({
        text: '',
        toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: 'ls' } }],
        usage: zeroUsage(),
      }),
      { text: 'Готово!' },
    ]);
    await runLoop({
      llm: {
        async streamChat(messages, tools, opts) {
          const res = await llm.streamChat(messages, tools, opts);
          // после первого хода прошло 4 с из 10 — handler увидит остаток 6 с
          if (res.toolCalls.length > 0) c.state.value = 4_000;
          return res;
        },
      },
      messages: USER_MSG,
      tools: [shell],
      limits: { maxWallTimeMs: 10_000 },
      now: c.now,
    });
    assert.equal(seen, 6_000, 'остаток бюджета передан в handler (10 с − 4 с)');
  });
});

describe('VL-306 — страховка appliedSignatures для не-JSON ответов write-инструментов', () => {
  it('AC3/AC4: регресс сессии agent-1793634687751 — 14× lesson_update с текстовым ответом завершают ран штатно', async () => {
    // Реальная сессия Close VL-304: 4 разных вызова lesson_update + 10
    // дословных повторов. Инструмент отвечал ПЛОСКИМ ТЕКСТОМ, appliedSignatures
    // не пополнялся, срабатывал обычный loop detection → fail, код 1.
    const state = { calls: 0 };
    const spec = {
      name: 'lesson_update',
      description: 'write-заглушка с текстовым ответом',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => {
        state.calls++;
        return 'Lesson lesson-174 обновлён: verified_by (updated_date: 2026-11-02)';
      },
    };
    const a = { id: 'lesson-174', tags: ['x'], title: 'T', verifiedBy: 'agent' };
    const b = { id: 'lesson-174', sourceTasks: ['VL-304'], supersedes: 'lesson-173', tags: ['x'], title: 'T', verifiedBy: 'agent' };
    const c = { id: 'lesson-174', sourceTasks: ['VL-304'], supersedes: 'lesson-173', verifiedBy: 'agent' };
    const d = { id: 'lesson-174', title: 'T', verifiedBy: 'agent' };
    const script = [];
    let n = 0;
    for (const args of [a, b, c, c, c, d, d, d, d, d, d, d, d, d]) {
      script.push({ text: '', toolCalls: [{ id: `c${++n}`, name: 'lesson_update', arguments: args }] });
    }
    const { llm } = fakeLlm(script);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false, `фаза не должна падать: ${res.result}`);
    assert.match(res.result, /зациклилась на уже применённом вызове/);
    // Первый повтор уже применённой сигнатуры завершает ран штатно (VL-304):
    // исполнены a, b, c — второй c" — это повтор, он не исполняется.
    assert.equal(state.calls, 3, 'исполнены только 3 разных вызова, повторы не исполняются');
    assert.equal(res.blocked_signatures, undefined, 'сигнатуры не попали в блок-лист');
  });

  it('AC3: текст-ошибка не считается применённой — обычный loop detection', async () => {
    const spec = {
      name: 'lesson_update',
      description: 'write-заглушка с ошибкой',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => 'Ошибка: Lesson lesson-999 не найден.',
    };
    const same = { id: 'lesson-999', verifiedBy: 'agent' };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'lesson_update', arguments: same }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'lesson_update', arguments: same }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'lesson_update', arguments: same }] },
      { text: '', toolCalls: [{ id: 'c4', name: 'lesson_update', arguments: same }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true, 'текст-ошибка не должна закрывать фазу как успешную');
    assert.match(res.result, /Loop detection/);
  });

  it('AC3: read-инструмент с текстовым ответом не пополняет appliedSignatures', async () => {
    const spec = {
      name: 'backlog_list_tasks',
      description: 'read-заглушка',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => '[]',
    };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_list_tasks', arguments: {} }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_list_tasks', arguments: {} }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'backlog_list_tasks', arguments: {} }] },
      { text: '', toolCalls: [{ id: 'c4', name: 'backlog_list_tasks', arguments: {} }] },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, true, 'read-инструмент не должен закрывать ран по повтору');
    assert.match(res.result, /Loop detection/);
  });
});
