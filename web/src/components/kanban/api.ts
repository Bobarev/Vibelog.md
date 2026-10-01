/**
 * Слой данных Kanban-доски VL-27.
 *
 * Ходит в существующий REST API Vibelog (src/web/api.ts):
 * - GET  /api/tasks       — список задач (Task[] из src/core)
 * - GET  /api/config      — конфиг проекта, включая statuses[]
 * - PATCH /api/tasks/:id  — частичное обновление (в т.ч. status)
 */

import type { KanbanTask } from '../../types/kanban';

/** Сырой Task, как его отдаёт API (массив комментариев, остальное — по мере надобности). */
interface ApiTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  labels: string[];
  assignee: string[];
  description: string;
  comments: unknown[];
}

/** Дефолтные статусы — на случай, если конфиг не отдал statuses[]. */
const FALLBACK_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];

/** Задачи API → задачи доски (comments → commentsCount). */
function toKanbanTask(raw: ApiTask): KanbanTask {
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    priority: raw.priority,
    due_date: raw.due_date ?? '',
    labels: raw.labels ?? [],
    assignee: raw.assignee ?? [],
    description: raw.description ?? '',
    commentsCount: Array.isArray(raw.comments) ? raw.comments.length : 0,
  };
}

/** Список задач доски. */
export async function fetchTasks(): Promise<KanbanTask[]> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`GET /api/tasks: ${res.status}`);
  const data = (await res.json()) as ApiTask[];
  return data.map(toKanbanTask);
}

/** Статусы колонок из конфига проекта. */
export async function fetchStatuses(): Promise<string[]> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`GET /api/config: ${res.status}`);
    const config = (await res.json()) as { statuses?: string[] };
    if (Array.isArray(config.statuses) && config.statuses.length > 0) {
      return config.statuses;
    }
  } catch {
    // Конфиг недоступен — используем дефолт, доска должна открываться
  }
  return FALLBACK_STATUSES;
}

/** Смена статуса задачи (drag-and-drop). Бросает при ошибке — вызывающий откатывает доску. */
export async function patchTaskStatus(id: string, status: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`PATCH /api/tasks/${id}: ${res.status}`);
}
