/**
 * Слой данных страниц documents (VL-181).
 *
 * Ходит в REST API Vibelog (src/web/api.ts):
 * - GET /api/documents — список метаданных БЕЗ тел (title/type/tags/
 *   created_date); тело грузится только на детальной странице;
 * - GET /api/documents/:id — полная запись (метаданные + body + path);
 * - POST /api/documents — создание (201, id doc-N);
 * - PATCH /api/documents/:id — обновление title/type/tags/content.
 */

/** Метаданные документа (зеркало src/core/document.ts Document). */
export interface DocumentMeta {
  id: string;
  title: string;
  type: string;
  created_date: string;
  tags: string[];
}

/** Элемент списка: метаданные + путь к файлу (без body). */
export interface DocumentListItem {
  document: DocumentMeta;
  path: string;
}

/** Полная запись: метаданные + тело + путь (детальная страница). */
export interface DocumentDetailData {
  document: DocumentMeta;
  body: string;
  path: string;
}

/** Патч документа: только редактируемые по AC поля (created_date read-only). */
export interface DocumentPatch {
  title?: string;
  type?: string;
  tags?: string[];
  content?: string;
}

/** Вход создания документа (title обязателен — валидирует сервер). */
export interface DocumentCreate {
  title: string;
  type?: string;
  tags?: string[];
  content?: string;
}

/**
 * Типы документов — зеркало DOCUMENT_TYPES из src/core/document.ts.
 * Веб сознательно не импортирует node-core (браузерный бандл); рассинхрон
 * низкорисковый (список стабилен с v1.4) и покрыт серверным тестом.
 */
export const DOCUMENT_TYPES = ['readme', 'guide', 'specification', 'other'];

/**
 * Извлекает текст ошибки из ответа сервера ({error} или HTTP-статус).
 * Общий helper — бросает Error с текстом для вывода в UI (state, не console).
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const errBody = (await res.json().catch(() => ({}))) as { error?: string };
  return errBody.error || `${fallback}: ${res.status}`;
}

/** Список документов (метаданные без тел). Бросает с текстом сервера. */
export async function fetchDocuments(): Promise<DocumentListItem[]> {
  const res = await fetch("/api/documents");
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/documents"));
  return (await res.json()) as DocumentListItem[];
}

/** Детали документа. Бросает с текстом сервера (404 — «Документ не найден»). */
export async function fetchDocument(id: string): Promise<DocumentDetailData> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await errorMessage(res, "GET /api/documents/:id"));
  return (await res.json()) as DocumentDetailData;
}

/** Создание документа (201). Бросает с текстом сервера (400 — валидация). */
export async function createDocument(payload: DocumentCreate): Promise<DocumentMeta> {
  const res = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "POST /api/documents"));
  return (await res.json()) as DocumentMeta;
}

/** Патч документа (title/type/tags/content). Бросает с текстом ошибки (400/404). */
export async function patchDocument(id: string, patch: DocumentPatch): Promise<DocumentDetailData> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "PATCH /api/documents/:id"));
  return (await res.json()) as DocumentDetailData;
}
