/**
 * Единый пайплайн обновления сущностей (VL-369).
 *
 * Проблема, которую модуль закрывает: четыре write-инструмента
 * (`backlog_update_task`, `lesson_update`, `document_update`,
 * `reference_update`) и `backlog_update_status` содержали по собственной копии
 * одной и той же логики: сверка «уже так», сборка `applied`, обработка
 * `skipped`, расчёт `missing`, тексты «следующий шаг». Каждый фикс правил
 * форму ответа ОДНОГО инструмента, следующий фикс отменял предыдущий; в
 * `toolLessonUpdate` выросло четыре ветки состояния, каждая компенсировала
 * предыдущую (~160 строк).
 *
 * Корневая ошибка была в том, что «модель застревает на повторах» пытались
 * лечить выбором ФОРМЫ ответа. Модель застревает не из-за формы, а из-за
 * отсутствия следующего шага. Поэтому ответ теперь сводится к таблице из двух
 * булевых: «записали ли что-нибудь» × «полная ли сущность».
 *
 *   | Записали | Полная | Исход    | Что в ответе                                  |
 *   |----------|--------|----------|-----------------------------------------------|
 *   | да       | да     | applied  | применённые поля                              |
 *   | да       | нет    | partial  | применённые поля + missing + готовый вызов     |
 *   | нет      | да     | noop     | фактическое состояние                         |
 *   | нет      | нет    | noop     | фактическое состояние + missing + вызов        |
 *   | испорчен аргумент | — | rejected | текст ошибки + готовый вызов            |
 *
 * Четвёртая строка принципиальна: «ничего не изменилось, и сущность неполная»
 * — это noop, а не отказ. Именно здесь раньше стоял отказ, и именно он давал
 * серию отказов, упирающуюся в ограничитель повторов (loop detection).
 * Отказ на повторе — механизм падения, а не защита от него.
 *
 * Инвариант: write-инструмент применяет то, что попросили, и сообщает
 * получившееся состояние. Он НИКОГДА не отказывает из-за того, что сущность
 * неполная. Отказ остаётся только для испорченного аргумента: пустое
 * обязательное значение, несуществующий идентификатор, значение неверного типа.
 */

import {
  ackOk, ackOkDetailed, ackNoopDetailed, ackErrorDetailed,
  unknownFields, sameFieldsUpToDate, BODY_FIELD,
} from './tool-result.js';
import type { SkippedField } from './tool-result.js';

/** Аргументы вызова инструмента (произвольный JSON со stdio). */
export type UpdateArgs = Record<string, unknown>;

/** Следующий шаг, который инструмент прикладывает к ответу. */
export interface UpdateNext {
  hint?: string;
  retryWith?: Record<string, unknown>;
}

/**
 * Описание сущности: декларация РАЗЛИЧИЙ между инструментами.
 *
 * Всё, что у сущностей одинаково (сверка «уже так», сборка `skipped`,
 * вычисление исхода, сериализация ответа), живёт в `runUpdate`. Сюда
 * выносится только то, что действительно разное: имена полей, где лежит тело,
 * как прочитать/записать, какой текст показать модели.
 */
export interface EntitySpec<E> {
  /** Имя сущности — в сообщение об ошибке и в диагностику. */
  name: string;
  /** Допустимые имена аргументов (для отлова неизвестных полей в `skipped`). */
  fields: readonly string[];
  /** Поля, сравниваемые как множества (порядок не значим). */
  setFields: readonly string[];
  /** Аргумент, который ложится в тело сущности (`content`, `description`). */
  bodyArg?: string;
  /**
   * Неидемпотентные операции: при их наличии noop-сверка отключается.
   * `append_notes` дописывает в конец — повтор ВСЕГДА меняет файл, поэтому
   * проверка «всё уже так» для него была бы ложью (см. `toolUpdateTask`).
   */
  nonIdempotent?: readonly string[];
  /** Имя аргумента с идентификатором (по умолчанию `id`). */
  idArg?: string;
  /** Текст ошибки при отсутствующем id (у сущностей он исторически разный). */
  missingIdMessage?: string;
  /** Текст ошибки при несуществующем id. */
  notFoundMessage?(id: string): string;

  /** Сборка полей записи. `current` нужен операциям вида `append_notes`. */
  build(args: UpdateArgs, cwd: string, current: E): Record<string, unknown>;
  /** Текущее состояние сущности (null — не найдена). */
  read(cwd: string, id: string): E | null;
  /** Запись. null — сущность исчезла между чтением и записью. */
  write(cwd: string, id: string, updates: Record<string, unknown>): E | null;
  /** Снимок для сверки «уже так» (тело — под ключом BODY_FIELD). */
  snapshot(entity: E): Record<string, unknown>;
  /** Спец-поля, которые сверяются не «как есть» (url/urls у reference). */
  comparable?(
    updates: Record<string, unknown>,
    current: E,
    base: Record<string, unknown>,
  ): Record<string, unknown>;
  /** Что попадает в `applied`: значения ИЗ СУЩНОСТИ после записи. */
  applied(entity: E, keys: string[], via: 'applied' | 'partial' | 'noop'): Record<string, unknown>;
  /** Чего не хватает в сущности (считается ОТ СОСТОЯНИЯ, а не от аргументов). */
  completeness?(entity: E): SkippedField[];
  /** Следующий шаг при неполноте (hint + готовый образец аргументов). */
  next?(entity: E, missing: SkippedField[]): UpdateNext;
  /** Подсказка для noop-ответа («какие поля ещё можно передать»). */
  noopHint?(entity: E, keys: string[], transferred: string[]): string;
  /** Человекочитаемая строка результата. */
  message(entity: E, keys: string[], via: 'applied' | 'partial' | 'noop'): string;
  /**
   * Хук настоящей специфики: проверка АРГУМЕНТА (а не состояния сущности).
   * Возвращает описание отказа либо null. Четыре ветки `toolLessonUpdate`
   * появились именно потому, что эту проверку смешивали с состоянием.
   */
  beforeWrite?(args: UpdateArgs, updates: Record<string, unknown>, current: E): RejectDetail | null;
}

/** Описание отказа, который вернёт `runUpdate` (исход rejected). */
export interface RejectDetail {
  message: string;
  missing?: SkippedField[];
  hint?: string;
  retryWith?: Record<string, unknown>;
  applied?: Record<string, unknown>;
}

/** Собирает `applied` из снимка сущности: значения полей + сворачивание списков. */
export function snapshotApplied(
  raw: Record<string, unknown>,
  keys: string[],
  collapse: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = raw[key];
    result[key] = collapse.includes(key) && Array.isArray(value) ? value.length : value;
  }
  return result;
}

/** Ключ для сверки: тело сущности сверяется под общим псевдонимом. */
function comparableKey(spec: EntitySpec<unknown>, key: string): string {
  return spec.bodyArg !== undefined && key === spec.bodyArg ? BODY_FIELD : key;
}

/**
 * Единственный исполнитель обновления: шесть шагов пайплайна.
 *
 * Порядок шагов важен: все проверки, способные бросить исключение
 * (испорченный аргумент, несуществующий id), выполняются ДО записи, поэтому
 * «полуприменённого» состояния не бывает.
 *
 * @param spec — описание сущности (все различия)
 * @param args — аргументы вызова
 * @param cwd — рабочая директория
 * @returns JSON-ack (см. `serializeAck`)
 */
export function runUpdate<E>(spec: EntitySpec<E>, args: UpdateArgs, cwd: string): string {
  // 1. Идентификатор: пустой/не строкой — испорченный аргумент (отказ).
  const idArg = spec.idArg ?? 'id';
  const idRaw = args[idArg];
  if (typeof idRaw !== 'string' || idRaw.trim() === '') {
    throw new Error(spec.missingIdMessage ?? `Не передан ${idArg} (параметр "${idArg}").`);
  }
  const id = idRaw;

  // 2. Текущее состояние: несуществующий идентификатор — испорченный аргумент.
  const current = spec.read(cwd, id);
  if (current === null || current === undefined) {
    throw new Error(spec.notFoundMessage ? spec.notFoundMessage(id) : `${spec.name} ${id} не найден.`);
  }

  // 3. Сборка полей. Всё, что здесь бросает, — тоже испорченный аргумент.
  const updates = spec.build(args, cwd, current);
  const keys = Object.keys(updates);

  // 4. Переданные, но не записанные поля: неизвестные имена и null.
  const skipped = collectSkipped(spec, args);

  // 5. Хук специфики: проверка аргумента, а не состояния сущности.
  const rejected = spec.beforeWrite?.(args, updates, current) ?? null;
  if (rejected !== null) {
    return ackErrorDetailed(rejected.message, {
      ...(rejected.missing !== undefined ? { missing: rejected.missing } : {}),
      ...(rejected.hint !== undefined ? { hint: rejected.hint } : {}),
      ...(rejected.retryWith !== undefined ? { retryWith: rejected.retryWith } : {}),
      ...(rejected.applied !== undefined ? { applied: rejected.applied } : {}),
    });
  }

  // 6. Сверка «уже так». Неидемпотентные операции (append_notes) её отключают:
  // повторное дописывание меняет файл даже при совпадающих значениях.
  const forced = spec.nonIdempotent?.some(key => args[key] !== undefined) ?? false;
  const base: Record<string, unknown> = {};
  for (const key of keys) base[comparableKey(spec, key)] = updates[key];
  const comparable = spec.comparable ? spec.comparable(updates, current, base) : base;
  const unchanged = !forced && sameFieldsUpToDate(spec.snapshot(current), comparable, spec.setFields);

  if (keys.length === 0 || unchanged) {
    // «Менять нечего» — noop, а не отказ: неполнота сообщается полем missing.
    const missing = spec.completeness?.(current) ?? [];
    const applied = spec.applied(current, keys, 'noop');
    const next = missing.length > 0 ? (spec.next?.(current, missing) ?? {}) : {};
    const hint = spec.noopHint?.(current, keys, Object.keys(args)) ?? next.hint;
    return ackNoopDetailed(
      `${noopPrefix(keys)}${spec.message(current, keys, 'noop')}`,
      applied,
      missing,
      hint,
      next.retryWith,
    );
  }

  // 7. Запись.
  const written = spec.write(cwd, id, updates);
  if (written === null || written === undefined) {
    throw new Error(spec.notFoundMessage ? spec.notFoundMessage(id) : `${spec.name} ${id} не найден.`);
  }

  // 8. Исход: записали × полная ли сущность ПОСЛЕ записи.
  const missing = spec.completeness?.(written) ?? [];
  const via = missing.length > 0 ? 'partial' : 'applied';
  const applied = spec.applied(written, keys, via);
  const message = spec.message(written, keys, via);
  if (missing.length === 0) {
    return ackOk(message, applied, skipped);
  }
  const next = spec.next?.(written, missing) ?? {};
  return ackOkDetailed(message, applied, skipped, {
    missing,
    ...(next.hint !== undefined ? { hint: next.hint } : {}),
    ...(next.retryWith !== undefined ? { retryWith: next.retryWith } : {}),
  });
}

/**
 * Префикс noop-сообщения. Маркер «Изменений нет» закреплён тестами и
 * разборами сессий (VL-303/VL-310), поэтому формулировка общая для всех
 * инструментов, а не своя в каждом.
 */
function noopPrefix(keys: string[]): string {
  return keys.length === 0
    ? 'Изменений нет: вызов не передал полей для изменения. '
    : `Изменений нет: ${keys.join(', ')} уже имеют эти значения. `;
}

/**
 * `skipped` — переданные, но не записанные поля (VL-262/VL-369).
 *
 * Обе категории обязательны для ВСЕХ сущностей: неизвестное имя поля (модель
 * думает, что записала) и переданный `null` (не «сброс», а отсутствие
 * значения — раньше молча игнорировался).
 */
function collectSkipped<E>(spec: EntitySpec<E>, args: UpdateArgs): SkippedField[] {
  const skipped = unknownFields(args, spec.fields);
  for (const key of Object.keys(args)) {
    if (args[key] === null && spec.fields.includes(key) && !skipped.some(s => s.field === key)) {
      skipped.push({ field: key, reason: 'значение null не применяется: поле не изменено' });
    }
  }
  return skipped;
}
