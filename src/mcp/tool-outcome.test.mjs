/**
 * VL-357 — протокол исхода инструмента (tool outcome protocol v2).
 *
 * Проверяет то, чего не было до задачи: исход ОДИН (`outcome`), а совместимые
 * флаги (`ok`/`noop`/`denied`/`read`) вычисляются из него. Это делает
 * невозможной комбинацию «применили, но ответ выглядит как отказ» (VL-355) и
 * «создали, но ответ выглядит как ошибка» (VL-356).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  ackOk,
  ackOkDetailed,
  ackNoopDetailed,
  ackRead,
  ackError,
  ackErrorDetailed,
  ackDenied,
  isNoopAck,
  serializeAck,
} from '../../dist/mcp/tool-result.js';

describe('VL-357 — outcome как единственный источник правды', () => {
  it('ackOk → outcome:applied, ok:true', () => {
    const ack = JSON.parse(ackOk('Задача VL-1 обновлена', { title: 'X' }));
    assert.equal(ack.outcome, 'applied');
    assert.equal(ack.ok, true);
    assert.ok(!('noop' in ack), 'у applied нет флага noop');
    assert.ok(!('read' in ack), 'у applied нет флага read');
  });

  it('ackOkDetailed с missing → outcome:partial, ok:true (запись состоялась)', () => {
    const ack = JSON.parse(ackOkDetailed('Lesson lesson-1 создан', { id: 'lesson-1' }, [], {
      missing: [{ field: 'content', reason: 'тело пустое' }],
      hint: 'Допиши content',
    }));
    assert.equal(ack.outcome, 'partial');
    assert.equal(ack.ok, true, 'partial — не ошибка: запись состоялась');
    assert.equal(ack.missing[0].field, 'content');
    assert.equal(ack.hint, 'Допиши content');
  });

  it('ackOkDetailed без missing → outcome:applied', () => {
    const ack = JSON.parse(ackOkDetailed('ок', { id: 1 }));
    assert.equal(ack.outcome, 'applied');
    assert.ok(!('missing' in ack));
  });

  it('ackNoopDetailed → outcome:noop + ok:false + reason:noop + hint', () => {
    const ack = JSON.parse(ackNoopDetailed('Изменений нет', { type: 'feature' }));
    assert.equal(ack.outcome, 'noop');
    assert.equal(ack.ok, false, 'noop — ошибка, а не успех (lesson-92)');
    assert.equal(ack.reason, 'noop');
    assert.equal(typeof ack.hint, 'string', 'hint есть всегда (VL-326)');
  });

  it('ackRead → outcome:read + ok:true + read:true (эффекта не было)', () => {
    const ack = JSON.parse(ackRead('Чеклист: 1. ○ A', { items: [{ index: 1 }] }));
    assert.equal(ack.outcome, 'read');
    assert.equal(ack.ok, true);
    assert.equal(ack.read, true);
  });

  it('ackError → outcome:rejected + ok:false + error', () => {
    const ack = JSON.parse(ackError('Задача не найдена'));
    assert.equal(ack.outcome, 'rejected');
    assert.equal(ack.ok, false);
    assert.equal(ack.error, 'Задача не найдена');
  });

  it('ackErrorDetailed → outcome:rejected, продолжение в next (missing/hint/retryWith)', () => {
    const ack = JSON.parse(ackErrorDetailed('нет content', {
      missing: [{ field: 'content', reason: 'тело пустое' }],
      hint: 'Добавь content',
      retryWith: { allowForeign: true },
    }));
    assert.equal(ack.outcome, 'rejected');
    assert.equal(ack.ok, false);
    assert.equal(ack.missing[0].field, 'content');
    assert.equal(ack.hint, 'Добавь content');
    assert.deepEqual(ack.retryWith, { allowForeign: true });
  });

  it('ackDenied → outcome:rejected + denied:true + reason', () => {
    const ack = JSON.parse(ackDenied('denied', { tool: 'backlog_update_task', fields: ['title'] }));
    assert.equal(ack.outcome, 'rejected');
    assert.equal(ack.ok, false);
    assert.equal(ack.denied, true);
    assert.equal(ack.reason, 'denied');
    assert.equal(ack.tool, 'backlog_update_task');
  });

  it('serializeAck: unknown → ok:false без прочих флагов', () => {
    const ack = JSON.parse(serializeAck({ outcome: 'unknown', message: 'непонятно' }));
    assert.equal(ack.outcome, 'unknown');
    assert.equal(ack.ok, false);
    assert.ok(!('noop' in ack) && !('read' in ack) && !('denied' in ack));
  });

  it('isNoopAck читает исход, а не только вычисляемый флаг', () => {
    assert.equal(isNoopAck(ackNoopDetailed('Изменений нет')), true);
    assert.equal(isNoopAck(JSON.stringify({ outcome: 'noop' })), true);
    assert.equal(isNoopAck(ackOk('применено')), false);
    assert.equal(isNoopAck('плоский текст'), false);
  });
});
