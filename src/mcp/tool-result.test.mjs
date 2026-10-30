/**
 * Тесты контракта ответа write-инструментов (VL-262).
 *
 * Проверяют структуру ack: applied/skipped у успеха, машиночитаемая причина и
 * перечень неприменённых полей у отказа (denied vs not_confirmed), а также
 * детекцию неизвестных полей вызова.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ackOk, ackDenied, ackError, unknownFields } from '../../dist/mcp/tool-result.js';

describe('VL-262 — ackOk: снимок применённого', () => {
  it('возвращает валидный JSON с message/applied/skipped', () => {
    const out = ackOk('Задача VL-1 обновлена: title, labels', { title: 'Новый', labels: ['a'] }, [
      { field: 'definitionOfDone', reason: 'неизвестное поле инструмента: не записано' },
    ]);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.message, 'Задача VL-1 обновлена: title, labels');
    assert.deepEqual(parsed.applied, { title: 'Новый', labels: ['a'] });
    assert.equal(parsed.skipped.length, 1);
    assert.equal(parsed.skipped[0].field, 'definitionOfDone');
    // Повторного применения не было — пометки нет
    assert.ok(!('idempotentReplay' in parsed));
  });

  it('сохраняет прежние подстроки «создана»/«обновлена» в message', () => {
    assert.match(JSON.parse(ackOk('Задача VL-2 создана: Тест')).message, /создана/);
    assert.match(JSON.parse(ackOk('Задача VL-2 обновлена: title')).message, /обновлена/);
  });

  it('idempotentReplay:true ставится, когда ответ восстановлен из кэша', () => {
    const parsed = JSON.parse(ackOk('Задача VL-3 создана: Х', { id: 'VL-3' }, [], true));
    assert.equal(parsed.idempotentReplay, true);
  });

  it('skipped по умолчанию пустой массив (не undefined)', () => {
    assert.deepEqual(JSON.parse(ackOk('ок')).skipped, []);
    assert.deepEqual(JSON.parse(ackOk('ок')).applied, {});
  });
});

describe('VL-262 — ackDenied: причина отказа', () => {
  it("reason='denied' — пользователь отказал, applied пуст, skipped из fields", () => {
    const parsed = JSON.parse(ackDenied('denied', { tool: 'backlog_update_task', fields: ['title', 'labels'] }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.denied, true);
    assert.equal(parsed.reason, 'denied');
    assert.deepEqual(parsed.applied, {});
    assert.deepEqual(parsed.skipped.map((s) => s.field), ['title', 'labels']);
    assert.match(parsed.message, /отклонил/);
    assert.match(parsed.hint, /бессмыслен/);
    assert.equal(parsed.tool, 'backlog_update_task');
  });

  it("reason='not_confirmed' — не отказ пользователя, повтор безопасен", () => {
    const parsed = JSON.parse(ackDenied('not_confirmed', { tool: 'backlog_create_task', fields: ['title'] }));
    assert.equal(parsed.reason, 'not_confirmed');
    assert.equal(parsed.denied, true);
    assert.match(parsed.message, /Не|не подтверждени|Подтверждение не получено/);
    assert.match(parsed.hint, /не отказ пользователя/);
    assert.match(parsed.hint, /idempotencyKey/);
    assert.deepEqual(parsed.skipped.map((s) => s.field), ['title']);
  });

  it('кастомный текст причины сохраняется в message, семантика — в reason', () => {
    const parsed = JSON.parse(ackDenied('denied', { message: 'Отменено пользователем' }));
    assert.equal(parsed.message, 'Отменено пользователем');
    assert.equal(parsed.reason, 'denied');
  });
});

describe('VL-262 — ackError и unknownFields', () => {
  it('ackError — JSON с ok:false и текстом ошибки', () => {
    const parsed = JSON.parse(ackError('Задача VL-9 не найдена.'));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, 'Задача VL-9 не найдена.');
  });

  it('unknownFields находит только ключи вне известного набора', () => {
    const skipped = unknownFields({ id: 'VL-1', title: 'X', definitionOfDone: ['a'] }, ['id', 'title']);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].field, 'definitionOfDone');
    assert.match(skipped[0].reason, /неизвестное поле/);
  });
});
