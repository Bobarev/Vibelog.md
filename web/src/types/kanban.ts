/**
 * Типы Kanban-доски VL-27.
 *
 * KanbanTask — подмножество нашего Task (src/core/task.ts), нужное карточке.
 * Колонки динамические: BoardState = Record<статус, задачи>, потому что
 * статусы приходят из backlog.config.yml, а не захардкожены (в отличие
 * от шаблона arhamkhnz, где колонки ideas/planned/building/... статичны).
 */

/** Задача в форме, необходимой для отображения на доске. */
export interface KanbanTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  labels: string[];
  assignee: string[];
  description: string;
  /** Длина массива comments из Task — insights-счётчик на карточке. */
  commentsCount: number;
  /** Последний комментарий (отчёт фазы) — показывается на карточке (VL-28). */
  lastComment: { author: string; text: string } | null;
}

/** Доска: статус → задачи этого статуса. */
export type BoardState = Record<string, KanbanTask[]>;
