/**
 * Трассировка «задача класса → именованный тест» (VL-359, AC6 VL-357).
 *
 * AC6 VL-357 («регрессы всех 14 задач класса») остался неотмеченным, хотя
 * покрытие было: тесты существовали, но поимённой связи «задача → тест» не
 * было ни в документации, ни в коде. Проверить утверждение «класс закрыт»
 * можно было только вручную, перечитывая четыре тест-файла.
 *
 * Здесь матрица зафиксирована механически: для каждой задачи класса указан
 * файл и подстрока имени `it(...)`. Тест падает, если тест переименовали или
 * удалили — тогда строку матрицы надо обновить осознанно, а не потерять
 * регресс молча. Ссылки — по ИМЕНИ теста, а не по номеру строки: номера
 * протухают при любой правке файла (план VL-359 это и отмечал).
 *
 * Почему тест, а не таблица в doc-27 §9: фаза Code не правит backlog/docs
 * (регламент), а AC6 допускает оба варианта — «таблица в doc-27 §9 или
 * тест-матрица». Тест-матрица строже: она не протухает.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Матрица класса: задача → [файл теста, подстрока имени `it(...)`].
 *
 * Подстрока — начало имени теста (без кавычек и `async`), достаточное для
 * однозначного поиска. Одна задача может иметь несколько тестов.
 */
const TRACE = {
  'VL-303': [
    ['src/mcp/write-ack.test.mjs', 'AC1: повтор с уже применёнными полями → {ok:true, noop:true}'],
  ],
  'VL-304': [
    ['src/agent/mcp-client.test.mjs', 'VL-304: noop-ack приходит с isError, но БЕЗ префикса'],
    ['src/mcp/server.test.mjs', 'VL-304: noop write-вызов → isError:true с JSON-снимком'],
  ],
  'VL-306': [
    ['src/agent/loop.test.mjs', 'AC3: плоский текст → НЕ applied, повтор исполняется заново'],
  ],
  'VL-310': [
    ['src/agent/loop.test.mjs', 'VL-310 (AC4): повтор применённого (ok:true) вызова не терминален'],
    ['src/agent/loop.test.mjs', 'VL-310 (AC4): исчерпание капа повторов применённого вызова → честный fail'],
  ],
  'VL-318': [
    ['src/agent/loop.test.mjs', 'AC1/AC2/AC3: регресс сессии agent-1793705489953'],
  ],
  'VL-319': [
    ['src/agent/loop.test.mjs', 'VL-319 (AC7): регресс agent-1793712738536'],
    ['src/agent/loop.test.mjs', 'VL-319 (AC7): кап noop-повторов по-прежнему срабатывает на 4-й серии'],
    ['src/mcp/write-ack.test.mjs', 'AC1: lesson_update без content на уроке с пустым телом → ok:false + error'],
  ],
  'VL-323': [
    ['src/agent/loop.test.mjs', 'AC1/AC3: регресс agent-1793720932286'],
  ],
  'VL-326': [
    ['src/web/chat.test.mjs', 'VL-326 регресс VL-324: 5× backlog_update_task с разными idempotencyKey'],
    ['src/web/chat.test.mjs', 'VL-326: обход дедупа разными наборами полей упирается в кап noop-серии'],
    ['src/web/tool-dedup.test.mjs', 'VL-326: разные idempotencyKey при одинаковых args → одинаковая сигнатура'],
    ['src/web/tool-dedup.test.mjs', 'VL-326: noopRepeatCallResult — ok:false, noop_repeat:true'],
  ],
  'VL-349': [
    ['src/agent/loop.test.mjs', 'VL-349 (AC6): регресс agent-1794045441657'],
    ['src/mcp/write-ack.test.mjs', 'AC2: lesson_update без content и без других изменений на теле-скелете'],
  ],
  'VL-351': [
    ['src/agent/loop.test.mjs', 'AC3: плоский текст → НЕ applied, повтор исполняется заново'],
  ],
  'VL-353': [
    ['src/agent/loop.test.mjs', 'AC3/AC4/AC7: регресс agent-1794050949211'],
  ],
  'VL-355': [
    ['src/agent/loop.test.mjs', 'VL-355 (AC5): регресс agent-1794053090709'],
    ['src/mcp/write-ack.test.mjs', 'AC1/AC4: регресс agent-1794053090709 — linkedTasks применяется'],
  ],
  'VL-356': [
    ['src/agent/loop.test.mjs', 'VL-356 (AC5): регресс agent-1794054631174'],
    ['src/mcp/lesson-tools.test.mjs', 'VL-356: create без content через MCP → ok:true со скелетом'],
    ['src/mcp/lesson-tools.test.mjs', 'VL-356: create с content → ok:true без missing'],
  ],
};

/** Корень проекта: тесты запускаются из него (vitest root). */
const ROOT = process.cwd();

describe('VL-359 — трассировка класса «модель крутится на повторах» (AC6 VL-357)', () => {
  it('каждая задача класса имеет именованный тест в указанном файле', () => {
    const missing = [];
    for (const [task, entries] of Object.entries(TRACE)) {
      for (const [file, needle] of entries) {
        let source;
        try {
          source = readFileSync(join(ROOT, file), 'utf8');
        } catch {
          missing.push(`${task}: файл ${file} не читается`);
          continue;
        }
        if (!source.includes(needle)) {
          missing.push(`${task}: в ${file} нет теста «${needle}»`);
        }
      }
    }
    assert.deepEqual(
      missing,
      [],
      `регресс класса потерян: ${missing.join('; ')}. Обнови матрицу TRACE или верни тест.`,
    );
  });

  it('в матрице 13 задач класса (VL-357 — эпик, его покрытие — эти же тесты)', () => {
    assert.equal(Object.keys(TRACE).length, 13);
  });
});
