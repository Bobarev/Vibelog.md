/**
 * Тесты VL-207 — клиентская логика восстановления треда чата:
 * - parseChatThreadId: hash-роут #/chat/<id> (hash-route только, без localStorage);
 * - historyToMessages: конвертация jsonl-истории (ChatMessage) в
 *   initialMessages assistant-ui, включая висящий approval-gate.
 *
 * Импортируются веб-исходники напрямую (vitest трансформирует TS);
 * модуль чистый — без React и алиасов.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseChatThreadId, historyToMessages } from '../../web/src/lib/chat-threads.ts';

describe('parseChatThreadId — hash-роут треда', () => {
  it('id треда из #/chat/<id>', () => {
    assert.equal(parseChatThreadId('#/chat/chat-abc-123'), 'chat-abc-123');
  });

  it('кодированный id декодируется', () => {
    assert.equal(parseChatThreadId('#/chat/a%2Fb'), 'a/b');
  });

  it('#/chat без id, другие маршруты и мусор → null', () => {
    assert.equal(parseChatThreadId('#/chat'), null);
    assert.equal(parseChatThreadId('#/chat/'), null);
    assert.equal(parseChatThreadId('#/'), null);
    assert.equal(parseChatThreadId('#/tasks'), null);
    assert.equal(parseChatThreadId(''), null);
    assert.equal(parseChatThreadId('#/chat/a/b'), null);
  });
});

describe('historyToMessages — восстановление истории треда', () => {
  it('user/assistant/text → соответствующие сообщения рантайма', () => {
    const out = historyToMessages([
      { role: 'user', content: 'Привет' },
      { role: 'assistant', content: 'Ответ' },
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { role: 'user', content: 'Привет' });
    assert.equal(out[1].role, 'assistant');
    assert.deepEqual(out[1].content, [{ type: 'text', text: 'Ответ' }]);
    assert.deepEqual(out[1].status, { type: 'complete', reason: 'unknown' });
  });

  it('system пропускается, tool-сообщения вливаются в tool-call part', () => {
    const out = historyToMessages([
      { role: 'system', content: 'промпт' },
      { role: 'user', content: 'найди' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc1', name: 'backlog_search', arguments: { query: 'x' } }],
      },
      { role: 'tool', tool_call_id: 'tc1', content: '{"tasks":[]}' },
      { role: 'assistant', content: 'Нашёл' },
    ]);
    assert.equal(out.length, 3);
    const toolMsg = out[1];
    assert.equal(toolMsg.role, 'assistant');
    const part = toolMsg.content[0];
    assert.equal(part.type, 'tool-call');
    assert.equal(part.toolCallId, 'tc1');
    assert.equal(part.toolName, 'backlog_search');
    assert.deepEqual(part.args, { query: 'x' });
    assert.deepEqual(part.result, { tasks: [] });
    assert.ok(!('isError' in part));
  });

  it('висящий approval (create без результата) → approval-part + requires-action', () => {
    const out = historyToMessages([
      { role: 'user', content: 'создай задачу' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc9', name: 'backlog_create_task', arguments: { title: 'X' } }],
      },
    ]);
    assert.equal(out.length, 2);
    const toolMsg = out[1];
    assert.deepEqual(toolMsg.status, { type: 'requires-action', reason: 'tool-calls' });
    const part = toolMsg.content[0];
    assert.deepEqual(part.approval, { id: 'tc9' });
    assert.ok(!('result' in part));
  });

  it('отказ в jsonl ({"ok":false,"denied":true}) → isError, чтобы карточка не врала', () => {
    const out = historyToMessages([
      { role: 'user', content: 'создай' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc2', name: 'backlog_create_task', arguments: { title: 'Y' } }],
      },
      // VL-262: отказ подтверждения — JSON-контракт {ok:false, denied:true, reason, …}
      { role: 'tool', tool_call_id: 'tc2', content: '{"ok":false,"denied":true,"reason":"denied","message":"Пользователь отклонил операцию"}' },
    ]);
    const part = out[1].content[0];
    assert.equal(part.isError, true);
    assert.equal(part.result.denied, true);
    assert.equal(part.result.reason, 'denied');
    // результат есть → approval не pending, статус завершён
    assert.ok(!('approval' in part));
    assert.deepEqual(out[1].status, { type: 'complete', reason: 'unknown' });
  });

  it('старый формат отказа ({"error": ...}) по-прежнему isError — обратная совместимость', () => {
    const out = historyToMessages([
      { role: 'user', content: 'создай' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc2', name: 'backlog_create_task', arguments: { title: 'Y' } }],
      },
      { role: 'tool', tool_call_id: 'tc2', content: '{"error":"Пользователь отклонил"}' },
    ]);
    const part = out[1].content[0];
    assert.equal(part.isError, true);
    assert.deepEqual(part.result, { error: 'Пользователь отклонил' });
  });

  it('обрыв до результата не-create инструмента → «Прервано» вместо вечного «выполняется»', () => {
    const out = historyToMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc3', name: 'backlog_view_task', arguments: { id: 'VL-1' } }],
      },
    ]);
    const part = out[0].content[0];
    assert.equal(part.isError, true);
    assert.deepEqual(part.result, { error: 'Прервано' });
  });

  it('не-JSON результат инструмента остаётся строкой', () => {
    const out = historyToMessages([
      {
        role: 'assistant',
        content: 'хм',
        tool_calls: [{ id: 'tc4', name: 'backlog_search', arguments: {} }],
      },
      { role: 'tool', tool_call_id: 'tc4', content: 'не json' },
    ]);
    const part = out[0].content.find(p => p.type === 'tool-call');
    assert.equal(part.result, 'не json');
    assert.equal(part.isError, undefined);
  });

  it('пустой text у assistant не создаёт пустых частей; пустая история → []', () => {
    assert.deepEqual(historyToMessages([]), []);
    const out = historyToMessages([{ role: 'assistant', content: '', tool_calls: [] }]);
    assert.equal(out.length, 0);
  });
});
