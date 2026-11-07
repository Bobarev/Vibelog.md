/**
 * Слой данных ленты активности #/activity (VL-347).
 *
 * Один эндпоинт GET /api/activity с фильтрами и пагинацией. Ошибки не
 * бросаются в консоль: страница показывает их в state (lesson-16 — консоль
 * браузера без ошибок).
 */

/** Тип события ленты — зеркало ActivityType из src/core/activity.ts. */
export type ActivityType =
  | "phase_started"
  | "phase_finished"
  | "phase_failed"
  | "task_created"
  | "task_status_changed"
  | "task_closed"
  | "comment"
  | "queue_started"
  | "queue_stopped"
  | "queue_failed"
  | "grant_started"
  | "grant_revoked";

/** Источник запуска; unknown — старые записи без поля. */
export type ActivitySource = "bot" | "web" | "cli" | "queue" | "supervisor" | "unknown";

/** Ссылка на сущность для перехода из ленты. */
export interface ActivityLink {
  kind: "task" | "reference" | "document" | "lesson";
  id: string;
}

/** Одно событие ленты. */
export interface ActivityEvent {
  at: string;
  type: ActivityType;
  taskId?: string;
  phase?: string;
  source?: ActivitySource;
  summary: string;
  details?: Record<string, unknown>;
  links?: ActivityLink[];
}

/** Ответ GET /api/activity. */
export interface ActivityResponse {
  events: ActivityEvent[];
  total: number;
  hasMore: boolean;
}

/** Параметры запроса ленты. */
export interface ActivityParams {
  since?: string;
  until?: string;
  types?: ActivityType[];
  taskId?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

/** Подписи типов событий для фильтра и бейджей. */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  phase_started: "Фаза запущена",
  phase_finished: "Фаза завершена",
  phase_failed: "Фаза упала",
  task_created: "Задача создана",
  task_status_changed: "Смена статуса",
  task_closed: "Задача закрыта",
  comment: "Комментарий",
  queue_started: "Очередь запущена",
  queue_stopped: "Очередь остановлена",
  queue_failed: "Провал в очереди",
  grant_started: "Прогон супервизора",
  grant_revoked: "Прогон остановлен",
};

/** Все типы в порядке отображения фильтра. */
export const ACTIVITY_TYPES: ActivityType[] = [
  "phase_started",
  "phase_finished",
  "phase_failed",
  "task_created",
  "task_status_changed",
  "task_closed",
  "comment",
  "queue_started",
  "queue_stopped",
  "queue_failed",
  "grant_started",
  "grant_revoked",
];

/** Подписи источников запуска. */
export const ACTIVITY_SOURCE_LABELS: Record<ActivitySource, string> = {
  bot: "бот",
  web: "веб",
  cli: "CLI",
  queue: "очередь",
  supervisor: "супервизор",
  unknown: "неизвестно",
};

/** Собирает query string из параметров (пустые значения не попадают). */
function buildQuery(params: ActivityParams): string {
  const search = new URLSearchParams();
  if (params.since) search.set("since", params.since);
  if (params.until) search.set("until", params.until);
  if (params.types && params.types.length > 0) search.set("type", params.types.join(","));
  if (params.taskId) search.set("taskId", params.taskId);
  if (params.source) search.set("source", params.source);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Загружает страницу ленты.
 *
 * @throws Error с текстом от сервера (400-валидация приходит как {error})
 */
export async function fetchActivity(params: ActivityParams = {}): Promise<ActivityResponse> {
  const res = await fetch(`/api/activity${buildQuery(params)}`);
  const body = (await res.json()) as ActivityResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return {
    events: Array.isArray(body.events) ? body.events : [],
    total: typeof body.total === "number" ? body.total : 0,
    hasMore: body.hasMore === true,
  };
}
