/**
 * Единый контракт ответа write-инструментов MCP (VL-262).
 *
 * Проблема, которую модуль решает: раньше write-инструменты отвечали
 * строкой-текстом («Задача X обновлена: title, type»), состав применённого
 * вычислялся из ПЕРЕДАННЫХ полей, а не из фактически записанных. Агент после
 * отказа подтверждения не мог отличить «применилось всё» от «применилось
 * частично» и не знал, какие поля записались (инцидент VL-254/VL-256:
 * `title`/`type` изменились, `labels`/`priority` — нет).
 *
 * Контракт: JSON со снимком результата —
 *   { ok, message, applied: {field: value}, skipped: [{field, reason}] }
 * `message` СОХРАНЯЕТ прежние русские формулировки («Задача X создана: …»,
 * «Задача X обновлена: …»): на них завязаны существующие проверки в тестах и
 * в промптах фаз — формат ответа меняется, привычные подстроки остаются.
 *
 * Отказ подтверждения (веб-чат) кодируется машиночитаемо:
 *   { ok: false, denied: true, reason: 'denied' | 'not_confirmed', … }
 * Различие принципиально для агента: `denied` — пользователь явно отказал
 * (повтор без нового решения бессмыслен), `not_confirmed` — подтверждение
 * не получено (вызов не дошёл до диалога; повтор с тем же idempotencyKey
 * безопасен). До VL-262 оба случая выглядели как произвольный текст в {error}.
 */

/** Поле, переданное в вызове, но не применённое к задаче. */
export interface SkippedField {
  /** Имя переданного поля (как в аргументах вызова). */
  field: string;
  /** Почему не применено — текст для модели. */
  reason: string;
}

/** Причина отказа подтверждения: явный отказ пользователя vs отсутствие подтверждения. */
export type DenyReason = 'denied' | 'not_confirmed';

/** Снимок успешного применения write-вызова. */
export interface WriteAck {
  ok: true;
  /** Человекочитаемая строка (прежние формулировки инструментов сохранены). */
  message: string;
  /** Реально записанные поля: значение — из файла задачи после записи. */
  applied: Record<string, unknown>;
  /** Переданные, но не применённые поля (неизвестное имя, null и т.п.). */
  skipped: SkippedField[];
  /** true — ответ взят из кэша идемпотентности, повторного эффекта не было. */
  idempotentReplay?: true;
}

/**
 * Формирует ответ успешного write-вызова.
 *
 * @param message — прежняя текстовая формулировка инструмента («… создана: …»)
 * @param applied — фактически записанные поля со значениями из задачи
 * @param skipped — переданные, но не применённые поля
 * @param idempotentReplay — ответ восстановлен по idempotencyKey
 */
export function ackOk(
  message: string,
  applied: Record<string, unknown> = {},
  skipped: SkippedField[] = [],
  idempotentReplay = false,
): string {
  const ack: WriteAck = {
    ok: true,
    message,
    applied,
    skipped,
    ...(idempotentReplay ? { idempotentReplay: true as const } : {}),
  };
  return JSON.stringify(ack, null, 2);
}

/**
 * Формирует ответ отказа подтверждения.
 *
 * `applied` всегда пуст (отказ = ни одного изменения), `skipped` перечисляет
 * ВСЕ переданные поля — агент видит, что именно НЕ записалось, без повторного
 * чтения задачи.
 *
 * @param reason — 'denied' (пользователь отказал) или 'not_confirmed' (подтверждение не получено)
 * @param extra — имя инструмента и переданные поля (идут в skipped)
 */
export function ackDenied(
  reason: DenyReason,
  extra: { tool?: string; fields?: string[]; message?: string } = {},
): string {
  const fields = extra.fields ?? [];
  const denied = reason === 'denied';
  // Кастомный текст отказа (например, reason из UI) приоритетнее дефолтного,
  // но семантика в reason/hint сохраняется — контракт машиночитаем.
  const message = extra.message?.trim()
    ? extra.message.trim()
    : denied
      ? 'Пользователь отклонил операцию — изменения НЕ применены.'
      : 'Подтверждение не получено (вызов не дошёл до диалога) — изменения НЕ применены.';
  // hint — следующий шаг для модели: разная семантика отказа требует разных действий
  const hint = denied
    ? 'Повтор без нового решения пользователя бессмыслен: спроси, что именно изменить.'
    : 'Это не отказ пользователя: вызов можно безопасно повторить с тем же idempotencyKey.';
  return JSON.stringify(
    {
      ok: false,
      denied: true,
      reason,
      ...(extra.tool ? { tool: extra.tool } : {}),
      applied: {},
      skipped: fields.map(field => ({ field, reason: 'не применено: нет подтверждения' })),
      message,
      hint,
    },
    null,
    2,
  );
}

/**
 * Формирует ответ-ошибку в том же JSON-контракте.
 *
 * Единая форма для ошибок инструментов в веб-чате: модель видит `ok:false`
 * и текст, а не произвольную строку/сырое исключение.
 *
 * @param message — текст ошибки
 */
export function ackError(message: string): string {
  return JSON.stringify({ ok: false, error: message }, null, 2);
}

/**
 * Считает переданные ключи, которых нет в списке известных полей инструмента.
 *
 * Раньше такие ключи молча игнорировались — агент считал поле записанным
 * (источник «частичности» без единого отказа). Теперь они попадают в skipped.
 *
 * @param args — аргументы вызова
 * @param known — имена поддерживаемых полей (включая служебные вроде id/idempotencyKey)
 */
export function unknownFields(args: Record<string, unknown>, known: readonly string[]): SkippedField[] {
  const result: SkippedField[] = [];
  for (const key of Object.keys(args)) {
    if (!known.includes(key)) {
      result.push({ field: key, reason: 'неизвестное поле инструмента: не записано' });
    }
  }
  return result;
}
