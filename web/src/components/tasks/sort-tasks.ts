/**
 * Чистая функция сортировки задач таблицы #/tasks (VL-175).
 *
 * Вынесена отдельно (без React): используется и в VL-177 (переключатель видов),
 * и в tests. Правила:
 * - status/priority — по индексу в массиве конфига (порядок из config.yml,
 *   а не лексикографически: «In Progress» < «To Do» по буквам — бессмыслица);
 * - updated_date — по Date.parse (валидные ISO из Task; невалидные → NaN → 0);
 * - labels — по содержимому (join(', '), иначе сравнивались бы массивы);
 * - id/title/type/milestone — localeCompare (русская локаль, числа корректно);
 * - пустые значения ('') всегда в конец, независимо от dir — «без вехи»
 *   не должно всплывать наверх при desc.
 */

import type { KanbanTask } from '../../types/kanban';
import type { TasksConfig } from './api';

/** Колонки, по которым возможна сортировка. */
export type SortKey =
  | 'id'
  | 'title'
  | 'status'
  | 'priority'
  | 'type'
  | 'labels'
  | 'milestone'
  | 'updated_date';

/** Состояние сортировки: null — сброс (порядок загрузки), иначе ключ + направление. */
export type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;

/** Индекс элемента в конфиге; не найден — в конец (стабильно, без random). */
function configIndex(value: string, list: string[]): number {
  const idx = list.indexOf(value);
  return idx === -1 ? list.length : idx;
}

/** Числовой ключ: Date.parse для дат, невалидное — 0 (конец диапазона). */
function timeValue(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Возвращает новый отсортированный массив (входной не мутирует).
 * Пустые значения — в конец независимо от dir.
 */
export function sortTasks(tasks: KanbanTask[], sort: SortState, config: TasksConfig): KanbanTask[] {
  if (!sort) return [...tasks];
  const { key, dir } = sort;
  const sign = dir === 'asc' ? 1 : -1;

  /** Значение колонки как строка (для пустых/localeCompare). */
  const strValue = (t: KanbanTask): string => {
    switch (key) {
      case 'labels':
        return t.labels.join(', ');
      case 'id':
        return t.id;
      case 'title':
        return t.title;
      case 'type':
        return t.type;
      case 'milestone':
        return t.milestone;
      case 'status':
        return t.status;
      case 'priority':
        return t.priority;
      case 'updated_date':
        return t.updated_date;
    }
  };

  return [...tasks].sort((a, b) => {
    // Пустые — всегда в конец (и при asc, и при desc)
    const ea = strValue(a) === '';
    const eb = strValue(b) === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;

    let cmp: number;
    switch (key) {
      case 'status':
        cmp = configIndex(a.status, config.statuses) - configIndex(b.status, config.statuses);
        break;
      case 'priority':
        cmp = configIndex(a.priority, config.priorities) - configIndex(b.priority, config.priorities);
        break;
      case 'updated_date':
        cmp = timeValue(a.updated_date) - timeValue(b.updated_date);
        break;
      case 'labels':
      case 'id':
      case 'title':
      case 'type':
      case 'milestone':
        cmp = strValue(a).localeCompare(strValue(b), 'ru');
        break;
    }
    return cmp * sign;
  });
}
