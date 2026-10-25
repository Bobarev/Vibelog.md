/**
 * Слой данных страниц lessons (VL-182).
 *
 * Ходит в REST API Vibelog (src/web/api.ts):
 * - GET /api/lessons — список метаданных БЕЗ тел (id/title/status/tags/
 *   source_tasks/linked_tasks); тело грузится только на детальной странице;
 * - GET /api/lessons/:id — полная запись (метаданные + body + path);
 * - PATCH /api/lessons/:id — обновление title/tags/status/content.
 */

/** Допустимые статусы lesson (зеркало src/core/lesson.ts LESSON_STATUSES). */
export const LESSON_STATUSES = ['active', 'outdated', 'superseded'] as const;

/** Метаданные lesson (зеркало src/core/lesson.ts Lesson). */
export interface LessonMeta {
  id: string;
  title: string;
  status: string;
  tags: string[];
  source_tasks: string[];
  linked_tasks: string[];
  created_date: string;
  updated_date: string;
  /** id заменённого lesson ('' — не заменяет ничего). */
  supersedes: string;
}

/** Элемент списка: метаданные + путь к файлу (без body — экономия трафика). */
export interface LessonListItem {
  lesson: LessonMeta;
  path: string;
}

/** Полная запись: метаданные + тело + путь (детальная страница). */
export interface LessonDetailData {
  lesson: LessonMeta;
  body: string;
  path: string;
}

/** Патч lesson: только редактируемые по AC поля (body wire-имя — content). */
export interface LessonPatch {
  title?: string;
  tags?: string[];
  status?: string;
  content?: string;
}

/**
 * Извлекает текст ошибки из ответа сервера ({error} или HTTP-статус).
 * Общий helper — бросает Error с текстом для вывода в UI (state, не console).
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const errBody = (await res.json().catch(() => ({}))) as { error?: string };
  return errBody.error || `${fallback}: ${res.status}`;
}

/** Список lessons (метаданные без тел). Бросает с текстом сервера. */
export async function fetchLessons(): Promise<LessonListItem[]> {
  const res = await fetch("/api/lessons");
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/lessons"));
  return (await res.json()) as LessonListItem[];
}

/** Детали lesson. Бросает с текстом сервера (404 — «Lesson не найден»). */
export async function fetchLesson(id: string): Promise<LessonDetailData> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/lessons/:id"));
  return (await res.json()) as LessonDetailData;
}

/** Патч lesson (title/tags/status/content). Бросает с текстом ошибки (400/404). */
export async function patchLesson(id: string, patch: LessonPatch): Promise<LessonDetailData> {
  const res = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "PATCH /api/lessons/:id"));
  return (await res.json()) as LessonDetailData;
}
