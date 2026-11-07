/**
 * VL-357 — фазовый прогресс вместо капа повторов (шаг 5).
 *
 * До VL-357 любое исчерпание капа повторов убивало ран кодом 1, даже когда
 * работа была сделана (регресс VL-349: merge прошёл, 3455 тестов зелёные, а
 * фаза падала на повторе `lesson_update`). Теперь `fail()` по капу срабатывает
 * только при НЕдостигнутой цели фазы: след выполненной работы (правка файла,
 * коммит, отчёт) делает завершение штатным.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { runLoop } from '../../dist/agent/loop.js';

const USER_MSG = [{ role: 'user', content: 'задача' }];

function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat() {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      return { text: step.text ?? '', toolCalls: step.toolCalls ?? [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  };
  return { llm, state };
}

function noopSpec() {
  return {
    name: 'backlog_update_task',
    description: 'write-заглушка',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async () => JSON.stringify({ ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [] }),
  };
}

function editSpec(state) {
  return {
    name: 'edit',
    description: 'правка файла',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    handler: async () => {
      state.edits++;
      return 'файл записан';
    },
  };
}

describe('VL-357 — кап повторов при недостигнутой цели по-прежнему fail()', () => {
  it('вечный noop-повтор без правок → is_error:true', async () => {
    const scripts = Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
    }));
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [noopSpec()] });
    assert.equal(res.is_error, true, 'работа не сделана — честный fail');
    assert.match(res.result, /повторила вызов/, res.result.slice(0, 200));
  });
});

describe('VL-357 — кап повторов при ВЫПОЛНЕННОЙ работе завершает ран штатно', () => {
  it('есть правка файла (edit) → кап noop-повторов не убивает ран', async () => {
    const state = { edits: 0 };
    // Сначала модель реально правит файл, затем зацикливается на noop-вызове.
    const scripts = [
      { text: '', toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'src/a.ts' } }] },
      { text: '', toolCalls: [{ id: 'e2', name: 'edit', arguments: { path: 'src/b.ts' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [editSpec(state), noopSpec()] });
    assert.equal(res.is_error, false, `работа сделана — ран завершается штатно: ${res.result.slice(0, 300)}`);
    assert.equal(state.edits, 2, 'правки выполнены');
    assert.match(res.result, /Кап повторов исчерпан/, 'в тексте названа причина завершения');
    assert.match(res.result, /Работа в ране выполнена/, 'прогресс зафиксирован');
    assert.ok(res.progress, 'блок прогресса приложен к результату');
  });

  it('есть коммит (git_commit) → кап применённых повторов не убивает ран', async () => {
    const commitSpec = {
      name: 'git_commit',
      description: 'коммит',
      inputSchema: { type: 'object', properties: { paths: { type: 'array' } } },
      handler: async () => JSON.stringify({ ok: true, message: 'закоммичено', applied: {} }),
    };
    const appliedSpec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => JSON.stringify({ ok: true, message: 'обновлено' }),
    };
    const same = { id: 'VL-1', type: 'feature' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['a.ts'] } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [commitSpec, appliedSpec] });
    assert.equal(res.is_error, false, `коммит есть — ран не падает: ${res.result.slice(0, 300)}`);
    assert.match(res.result, /Работа в ране выполнена/);
  });
});
