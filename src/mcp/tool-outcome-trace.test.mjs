/**
 * Трассировка «задача класса → свойство класса» (VL-359, переработано в VL-371).
 *
 * История. AC6 VL-357 («регрессы всех 13 задач класса») был закрыт матрицей
 * «задача → файл + подстрока имени `it(...)`». Идея верная (защита от
 * молчаливой потери регресса), но матрица закрепляла ИМЕНА тестов: при
 * рефакторинге приходилось править ~30 строк вручную, а переименование теста
 * роняло сборку при неизменном поведении.
 *
 * VL-371: матрица привязана к СВОЙСТВАМ (`src/agent/loop-properties.mjs`).
 * Переименование теста внутри свойства матрицу не ломает; потеря свойства —
 * ломает. Проверяются два утверждения:
 *   1. для каждого свойства класса есть тест (имя `it(...)` начинается с `P<N>:`);
 *   2. каждая задача класса привязана к существующему свойству, и каждое
 *      свойство покрывает хотя бы одну задачу.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROPERTIES } from '../agent/loop-properties.mjs';

/**
 * Матрица класса: задача → свойства, которые её покрывают.
 *
 * Свойства (см. `src/agent/loop-properties.mjs`):
 *   P1 — вызов с корректными аргументами на неполной сущности не даёт отказа
 *   P2 — серия повторов не роняет ран, если работа в ране выполнена
 *   P3 — отказ всегда несёт готовый следующий шаг
 *   P4 — необязательный шаг фазы (уроки) не роняет фазу
 *   P5 — директива не растёт по числу повторов и ограничена DIRECTIVE_MAX_BYTES
 */
const TRACE = {
  'VL-303': ['P1'],
  'VL-304': ['P1', 'P3'],
  'VL-306': ['P1', 'P3'],
  'VL-310': ['P2', 'P5'],
  'VL-318': ['P2', 'P3'],
  'VL-319': ['P1', 'P4'],
  'VL-323': ['P3'],
  'VL-326': ['P2'],
  'VL-349': ['P1', 'P4'],
  'VL-351': ['P1'],
  'VL-353': ['P3', 'P5'],
  'VL-355': ['P1', 'P4'],
  'VL-356': ['P1', 'P4'],
  'VL-411': ['P6'],
};

/** Корень проекта: тесты запускаются из него (vitest root). */
const ROOT = process.cwd();

describe('VL-371 — трассировка класса «модель крутится на повторах» по свойствам', () => {
  it('каждое свойство класса имеет тест в объявленном файле', () => {
    const missing = [];
    for (const [id, property] of Object.entries(PROPERTIES)) {
      let source;
      try {
        source = readFileSync(join(ROOT, property.file), 'utf8');
      } catch {
        missing.push(`${id}: файл ${property.file} не читается`);
        continue;
      }
      if (!new RegExp(`it\\(['\`]${id}:`).test(source)) {
        missing.push(`${id}: в ${property.file} нет теста, имя которого начинается с «${id}:»`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `свойство класса потеряно: ${missing.join('; ')}. Верни тест или обнови реестр PROPERTIES.`,
    );
  });

  it('каждая задача класса привязана к существующему свойству', () => {
    const unknown = [];
    for (const [task, ids] of Object.entries(TRACE)) {
      for (const id of ids) {
        if (!(id in PROPERTIES)) unknown.push(`${task} → ${id}`);
      }
    }
    assert.deepEqual(unknown, [], `задача ссылается на несуществующее свойство: ${unknown.join('; ')}`);
  });

  it('каждое свойство покрывает хотя бы одну задачу класса', () => {
    const covered = new Set(Object.values(TRACE).flat());
    const orphans = Object.keys(PROPERTIES).filter((id) => !covered.has(id));
    assert.deepEqual(orphans, [], `свойство без задачи-источника: ${orphans.join(', ')}`);
  });

  it('в матрице 14 задач класса (VL-357 — эпик, его покрытие — эти же свойства)', () => {
    assert.equal(Object.keys(TRACE).length, 14);
  });
});
