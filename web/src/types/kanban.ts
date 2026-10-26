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
  /** Тип задачи (bug/feature/...), нужен таблице #/tasks (VL-175). */
  type: string;
  /** Веха задачи (milestone), нужна таблице #/tasks (VL-175). */
  milestone: string;
  /** Дата последнего обновления (ISO), сортировка колонки Updated (VL-175). */
  updated_date: string;
  /** Фазы workflow, доступные из статуса (VL-188) — кнопки модалки. */
  availablePhases?: string[];
  /** Целевой статус «Взять в работу» (Backlog → initial), null — не нужна. */
  startTo?: string | null;
  /** Подписи кнопок фаз из настроек проекта (VL-195), fallback — phaseButtonLabel. */
  phaseLabels?: Record<string, string>;
  /** Эмодзи кнопок фаз из настроек проекта (VL-195), fallback — phaseButtonLabel. */
  phaseEmojis?: Record<string, string>;
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
 * Агрегат токенов задачи из frontmatter token_usage (VL-198).
 * Дубликат src/core/analytics.ts TokenUsage — web-типы живут без импорта
 * core (паттерн файла: чистый TS для Vite).
 */
export interface TokenUsageView {
  input: number;
  output: number;
  cache: number;
  total: number;
  requests: number;
  reasoning?: number;
  /** Суммарная длительность ранов (мс). */
  duration_ms?: number;
  /** Вклад по фазам (spec/plan/code/…). */
  by_phase?: Record<string, { input: number; output: number; cache: number; requests: number }>;
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
  /** Агрегат токенов (VL-198); undefined — фазы не запускались/нет данных. */
  token_usage?: TokenUsageView;
  // availablePhases/startTo унаследованы от KanbanTask (VL-188, GET /api/tasks/:id)
}
