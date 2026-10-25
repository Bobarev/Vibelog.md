/**
 * Флаг «открыт запрос просмотра задачи» из deep-link (VL-182).
 *
 * На страницах lessons source_tasks/linked_tasks — ссылками на задачи:
 * клик вызывает requestOpenTask, который ставит модульный pendingTaskId и
 * диспатчит CustomEvent. Kanban (единственный владелец модалки просмотра)
 * потребляет флаг при монтировании (переживает remount: hash '#/' меняется
 * ПОСЛЕ dispatch — как в quick-create) и слушает событие, когда уже
 * смонтирован.
 *
 * lesson-19: boolean-флаг не срабатывает повторно (второй клик по той же
 * задаче гаснет) — в detail события идёт монотонный счётчик seq; модульный
 * pendingTaskId — строка|null, гасится consume-вызовом.
 */

/** Имя события открытия задачи (диспатчит requestOpenTask, слушает Kanban). */
export const OPEN_TASK_EVENT = 'vibelog:open-task'

/** Монотонный счётчик событий — гарантирует повторное срабатывание. */
let seq = 0

// Модульный флаг (не React-state): переживает переключение маршрута
let pendingTaskId: string | null = null

/**
 * Запросить открытие задачи в модалке Kanban: флаг + событие + переход на доску.
 *
 * @param id — id задачи (VL-N); пустой игнорируется
 */
export function requestOpenTask(id: string): void {
  if (!id) return
  pendingTaskId = id
  seq += 1
  window.dispatchEvent(
    new CustomEvent(OPEN_TASK_EVENT, { detail: { id, seq } }),
  )
  // Доска — единственный экран с модалкой; если hash уже '#/' (редкий
  // случай), событие отработает у смонтированного Kanban
  if (window.location.hash !== '#/' && window.location.hash !== '') {
    window.location.hash = '#/'
  }
}

/**
 * Потребовать отложенный id: true один раз после requestOpenTask
 * (вызывает Kanban при монтировании до/после dispatch события).
 */
export function consumePendingTaskId(): string | null {
  const value = pendingTaskId
  pendingTaskId = null
  return value
}
