/**
 * Флаг «открыт запрос Quick Create» для модалки задачи (VL-163).
 *
 * App dispatch'ит событие QUICK_CREATE_EVENT и поднимает флаг: если Kanban
 * уже смонтирован — он подписан и откроет модалку по событию; если нет
 * (пользователь был на странице настроек) — Kanban проверит флаг при
 * монтировании и откроет модалку, очистив флаг.
 */

/** Имя кастомного события Quick Create (диспатчит App, слушает Kanban). */
export const QUICK_CREATE_EVENT = 'vibelog:quick-create'

// Модульный флаг (не React-state): переживает переключение маршрута
let pending = false

/** Поднять флаг запроса создания (вызывает App при клике Quick Create). */
export function setQuickCreatePending(): void {
  pending = true
}

/** Потребовать флаг: true один раз после setQuickCreatePending (вызывает Kanban). */
export function consumeQuickCreatePending(): boolean {
  const value = pending
  pending = false
  return value
}
