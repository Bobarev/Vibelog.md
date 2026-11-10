/**
 * VL-357 — протокол исхода инструмента (tool outcome protocol v2).
 * VL-413 — исход `noop` удалён: неизменяющая запись — успех с `unchanged`.
 *
 * Проверяет то, чего не было до задачи: исход ОДИН (`outcome`), а совместимые
 * флаги (`ok`/`denied`/`read`) вычисляются из него. Это делает невозможной
 * комбинацию «применили, но ответ выглядит как отказ» (VL-355) и «создали, но
 * ответ выглядит как ошибка» (VL-356).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  ackOk,
  ackOkDetailed,
  ackRead,
  ackError,
  ackErrorDetailed,
  ackDenied,
  isUnchangedAck,
  serializeAck,
} from '../../dist/mcp/tool-result.js';

describe('VL-357 — outcome как единственный источник правды', () => {
  it('ackOk → outcome:applied, ok:true', () => {
    const ack = JSON.parse(ackOk('Задача VL-1 обновлена', { title: 'X' }));
    assert.equal(ack.outcome, 'applied');
    assert.equal(ack.ok, true);
    assert.ok(!('read' in ack), 'у applied нет флага read');
  });

  it('ackOkDetailed с missing → outcome:partial, ok:true (запись состоялась)', () => {
    const ack = JSON.parse(ackOkDetailed('Lesson lesson-1 создан', { id: 'lesson-1' }, [], {
      missing: [{ field: 'content', reason: 'тело пустое' }],
    }));
    assert.equal(ack.outcome, 'partial');
    assert.equal(ack.ok, true, 'partial — не ошибка: запись состоялась');
    assert.equal(ack.missing[0].field, 'content');
  });

  it('ackOkDetailed без missing → outcome:applied', () => {
    const ack = JSON.parse(ackOkDetailed('ок', { id: 1 }));
    assert.equal(ack.outcome, 'applied');
    assert.ok(!('missing' in ack));
  });

  it('VL-413: ackOk с unchanged → outcome:applied, ok:true, applied пуст', () => {
    const ack = JSON.parse(ackOk('Изменений нет: type уже имеет эти значения.', {}, [], false, {
      unchanged: ['type'],
    }));
    assert.equal(ack.outcome, 'applied', 'неизменяющая запись — успех, а не событие');
    assert.equal(ack.ok, true);
    assert.deepEqual(ack.unchanged, ['type']);
    assert.deepEqual(ack.applied, {});
    assert.ok(!('noop' in ack), 'исхода noop больше нет');
    assert.ok(!('hint' in ack), 'hint как канал следующего шага удалён');
  });

  it('VL-413: ackOk с phase → блок данных в ответе', () => {
    const ack = JSON.parse(ackOk('ок', { id: 1 }, [], false, {
      phase: { name: 'spec', complete: false, missing: ['acceptanceCriteria'], next: 'backlog_finish_phase' },
    }));
    assert.deepEqual(ack.phase, {
      name: 'spec',
      complete: false,
      missing: ['acceptanceCriteria'],
      next: 'backlog_finish_phase',
    });
  });

  it('VL-413: пустой unchanged не печатается (payload не раздувается)', () => {
    const ack = JSON.parse(ackOk('ок', { id: 1 }, [], false, { unchanged: [] }));
    assert.ok(!('unchanged' in ack));
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

  it('ackErrorDetailed → outcome:rejected, продолжение в next (missing/retryWith) + hint', () => {
    const ack = JSON.parse(ackErrorDetailed('нет content', {
      missing: [{ field: 'content', reason: 'тело пустое' }],
      hint: 'Добавь content',
      retryWith: { allowForeign: true },
    }));
    assert.equal(ack.outcome, 'rejected');
    assert.equal(ack.ok, false);
    assert.equal(ack.missing[0].field, 'content');
    assert.equal(ack.hint, 'Добавь content', 'hint отказа — инструкция исправления');
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
    assert.ok(!('read' in ack) && !('denied' in ack));
  });

  it('VL-413: isUnchangedAck распознаёт неизменяющую запись', () => {
    assert.equal(isUnchangedAck(ackOk('Изменений нет', {}, [], false, { unchanged: ['type'] })), true);
    assert.equal(isUnchangedAck(ackOk('применено', { title: 'X' })), false);
    assert.equal(isUnchangedAck(JSON.stringify({ outcome: 'applied', unchanged: [] })), false);
    assert.equal(isUnchangedAck('плоский текст'), false);
  });
});
