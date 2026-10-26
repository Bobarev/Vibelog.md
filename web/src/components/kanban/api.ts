/**
 * Слой данных Kanban-доски VL-27.
 *
 * Ходит в существующий REST API Vibelog (src/web/api.ts):
 * - GET  /api/tasks       — список задач (Task[] из src/core)
 * - GET  /api/tasks/:id   — полная задача (секции для табов, VL-172)
 * - GET  /api/config      — конфиг проекта, включая statuses[]
 * - PATCH /api/tasks/:id  — частичное обновление (в т.ч. status)
 * - POST /api/tasks/:id/trigger — запуск фазы (+ comment, VL-172)
 * - POST /api/tasks/:id/reject  — отклонение задачи (VL-144)
 *
 * Ошибки сети не логируются в console (lesson-16): текст уходит в error-
 * состояние вызывающего компонента, консоль браузера остаётся чистой.
 */

import type { KanbanTask, TaskDetail } from '../../types/kanban';

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
  comments: Array<{ author?: string; text?: string }>;
  // Поля для таблицы #/tasks (VL-175): API отдаёт полный Task[] (src/core),
  // маппинг раньше их терял. Опциональны в старых задачах — нормализация в toKanbanTask.
  type?: string;
  milestone?: string;
  updated_date?: string;
  // VL-188: поля workflow (server enrich)
  availablePhases?: string[];
  startTo?: string | null;
}

/** Дефолтные статусы — на случай, если конфиг не отдал statuses[]. */
const FALLBACK_STATUSES = ['To Do', 'In Progress', 'Review', 'Done'];

/** Задачи API → задачи доски (comments → lastComment/commentsCount). */
function toKanbanTask(raw: ApiTask): KanbanTask {
  const comments = Array.isArray(raw.comments) ? raw.comments : [];
  const last = comments.at(-1);
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    priority: raw.priority,
    due_date: raw.due_date ?? '',
    labels: raw.labels ?? [],
    assignee: raw.assignee ?? [],
    description: raw.description ?? '',
    commentsCount: comments.length,
    lastComment: last?.text ? { author: last.author ?? '@agent', text: last.text } : null,
    // Нормализация || '' — иначе сортировка таблицы падает на undefined (VL-175)
    type: raw.type || '',
    milestone: raw.milestone || '',
    updated_date: raw.updated_date || '',
    availablePhases: raw.availablePhases ?? [],
    startTo: raw.startTo ?? null,
  };
}

/** Поля задачи, редактируемые через модалку (VL-163). */
export interface TaskFormPayload {
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  labels: string[];
  assignee: string[];
}

/** Список задач доски. */
export async function fetchTasks(): Promise<KanbanTask[]> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`GET /api/tasks: ${res.status}`);
  const data = (await res.json()) as ApiTask[];
  return data.map(toKanbanTask);
}

/**
 * Полная задача по ID — секции тела (plan/DoD/comments) для табов
 * модалки просмотра (VL-172). Бросает при ошибке — вызывающий показывает
 * fallback на данных KanbanTask.
 */
export async function fetchTask(id: string): Promise<TaskDetail> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `GET /api/tasks/${id}: ${res.status}`);
  }
  return (await res.json()) as TaskDetail;
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

/**
 * Смена статуса задачи (drag-and-drop, VL-188).
 *
 * Возвращает triggerPhase — фазу, производящую новый статус (канбан запускает
 * её после успешного переноса; null — ручной переход без фазы). Бросает
 * Error с текстом сервера (400 «Переход … недоступен по workflow») —
 * вызывающий откатывает доску.
 */
export async function patchTaskStatus(
  id: string,
  status: string
): Promise<{ triggerPhase?: string | null }> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `PATCH /api/tasks/${id}: ${res.status}`);
  }
  const body = (await res.json().catch(() => ({}))) as { triggerPhase?: string | null };
  return { triggerPhase: body.triggerPhase ?? null };
}

/** Создание задачи (модалка VL-163). Бросает при ошибке — текст показывает модалка. */
export async function createTask(input: TaskFormPayload): Promise<KanbanTask> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `POST /api/tasks: ${res.status}`);
  }
  return toKanbanTask((await res.json()) as ApiTask);
}

/** Частичное обновление задачи (модалка VL-163). */
export async function patchTask(id: string, patch: Partial<TaskFormPayload>): Promise<KanbanTask> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `PATCH /api/tasks/${id}: ${res.status}`);
  }
  return toKanbanTask((await res.json()) as ApiTask);
}

/** Архивирование задачи (кнопка «Архивировать» в edit-режиме модалки, VL-163). */
export async function archiveTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/tasks/${id}: ${res.status}`);
}

/**
 * Запуск фазы оркестратора (VL-28).
 *
 * opts.comment (VL-172): непустой комментарий сервер сначала пишет в задачу
 * (addComment), затем запускает фазу с {{comment}} промпта — как commitComment
 * в боте. Бросает при ошибке (в т.ч. 409 «Запуск уже выполняется» — комментарий
 * уже сохранён, не откатывается).
 */
export async function triggerPhase(
  id: string,
  phase: string,
  opts?: { comment?: string }
): Promise<void> {
  const comment = opts?.comment?.trim();
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(comment ? { phase, comment } : { phase }),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `POST trigger: ${res.status}`);
  }
}

/** Отклонение задачи (кнопка ✖ Reject в To Do, VL-144/VL-172). */
export async function rejectTask(id: string, comment?: string): Promise<void> {
  const trimmed = comment?.trim();
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trimmed ? { comment: trimmed } : {}),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `POST reject: ${res.status}`);
  }
}

/** Состояние запуска фазы задачи (поллинг завершения, VL-28). */
export async function getTriggerStatus(id: string): Promise<{ running: boolean }> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/trigger`);
  if (!res.ok) throw new Error(`GET trigger: ${res.status}`);
  return (await res.json()) as { running: boolean };
}
