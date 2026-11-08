/**
 * Слой данных страниц references (VL-174, sync — VL-358).
 *
 * Ходит в REST API Vibelog (src/web/api.ts, src/web/references-sync-api.ts):
 * - GET /api/references — список метаданных БЕЗ тел (type/url/path/tags/
 *   linked_tasks); тело грузится только на детальной странице;
 * - GET /api/references/:id — полная запись (метаданные + body + path);
 * - PATCH /api/references/:id — обновление title/tags/url/content;
 * - POST /api/references/sync — общий sync: клоны отсутствующих репо
 *   И обновление markdown-кэша url/doc-референсов (VL-358);
 * - POST /api/references/:id/sync — поштучный sync одного reference.
 */

/** Метаданные reference (зеркало src/core/reference.ts Reference). */
export interface ReferenceMeta {
  id: string;
  title: string;
  type: string;
  url?: string;
  path?: string;
  tags: string[];
  created_date: string;
  linked_tasks: string[];
  /** Поля кэша (VL-194): появляются после кэширования url/doc-референса. */
  cached_path?: string;
  cached_at?: string;
  source_hash?: string;
}

/** Элемент списка: метаданные + путь к файлу (без body). */
export interface ReferenceListItem {
  reference: ReferenceMeta;
  path: string;
}

/** Полная запись: метаданные + тело + путь (детальная страница). */
export interface ReferenceDetailData {
  reference: ReferenceMeta;
  body: string;
  path: string;
}

/** Итог по markdown-кэшу (зеркало CacheSyncResult из core/reference-cache.ts). */
export interface CacheSyncResult {
  updated: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/**
 * Итоги POST /api/references/sync (SyncResult из core + добавленное VL-358
 * поле cache). cloned/skipped/failed остались в корне — additive-совместимость.
 */
export interface SyncResult {
  cloned: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
  cache?: CacheSyncResult;
}

/** Итог поштучного sync одного reference (POST /api/references/:id/sync). */
export interface ReferenceSyncResult {
  reference: ReferenceMeta;
  /** Для type=repo: результат клонирования. */
  cloned?: { ok: boolean; message: string };
  /** Для url/doc/spec: результат обновления кэша. */
  cache?: { status: string; updated: boolean; message: string };
}

/** Патч reference: только редактируемые по AC поля (body wire-имя — content). */
export interface ReferencePatch {
  title?: string;
  tags?: string[];
  url?: string;
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

/** Список references (метаданные без тел). Бросает с текстом сервера. */
export async function fetchReferences(): Promise<ReferenceListItem[]> {
  const res = await fetch("/api/references");
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/references"));
  return (await res.json()) as ReferenceListItem[];
}

/** Детали reference. Бросает с текстом сервера (404 — «Reference не найден»). */
export async function fetchReference(id: string): Promise<ReferenceDetailData> {
  const res = await fetch(`/api/references/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/references/:id"));
  return (await res.json()) as ReferenceDetailData;
}

/** Патч reference (title/tags/url/content). Бросает с текстом ошибки (400/404). */
export async function patchReference(id: string, patch: ReferencePatch): Promise<ReferenceDetailData> {
  const res = await fetch(`/api/references/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "PATCH /api/references/:id"));
  return (await res.json()) as ReferenceDetailData;
}

/**
 * Общий sync: клонировать отсутствующие репо И обновить markdown-кэш
 * url/doc-референсов (VL-358). Бросает с текстом сервера.
 */
export async function syncReferences(): Promise<SyncResult> {
  const res = await fetch("/api/references/sync", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "POST /api/references/sync"));
  return (await res.json()) as SyncResult;
}

/**
 * Поштучный sync одного reference (VL-358): repo — клон, url/doc — кэш.
 * Бросает с текстом сервера (404 — «Reference не найден»).
 */
export async function syncReference(id: string): Promise<ReferenceSyncResult> {
  const res = await fetch(`/api/references/${encodeURIComponent(id)}/sync`, { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "POST /api/references/:id/sync"));
  return (await res.json()) as ReferenceSyncResult;
}
