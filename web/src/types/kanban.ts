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

/** Элемент чеклиста AC/DoD (строки хранятся как «- [ ] #N …»). */
export interface ChecklistItem {
  text: string;
  checked: boolean;
}

/** Комментарий задачи (формат Backlog.md). */
export interface TaskComment {
  author: string;
  created: string;
  text: string;
}

/**
 * Полная задача из GET /api/tasks/:id — секции тела для табов
 * модалки просмотра (VL-172): KanbanTask не содержит plan/DoD/comments[].
 */
export interface TaskDetail extends KanbanTask {
  reporter: string;
  created_date: string;
  updated_date: string;
  type: string;
  milestone: string;
  dependencies: string[];
  references: string[];
  modified_files: string[];
  lessons: string[];
  acceptanceCriteria: (ChecklistItem | string)[];
  definitionOfDone: (ChecklistItem | string)[];
  implementationPlan: string;
  implementationNotes: string;
  finalSummary: string;
  comments: TaskComment[];
}
