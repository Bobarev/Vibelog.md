/**
 * Слой данных страницы «Персоны» (VL-403).
 *
 * Ходит в REST API Vibelog:
 * - GET    /api/personas      — реестр ролей со сводками памяти (VL-265/401);
 * - GET    /api/personas/:id  — полные данные роли: метаданные + ТЕКСТ
 *   промпта и ТЕКСТ памяти (в списке текстов нет — там личные заметки);
 * - POST   /api/personas      — создать проектную роль;
 * - PUT    /api/personas/:id  — правка роли (валидация на сервере);
 * - DELETE /api/personas/:id  — удалить проектную роль (встроенную нельзя).
 *
 * Все функции бросают Error с текстом сервера: страница показывает его в
 * баннере ошибки (паттерн models/api.ts, lesson-16 — консоль без ошибок).
 */

/** Состояние памяти роли в списке (без текста). */
export interface PersonaMemoryInfo {
  exists: boolean;
  chars: number;
  truncated: boolean;
}

/** Строка списка ролей (GET /api/personas). */
export interface PersonaSummary {
  id: string;
  label: string;
  description?: string;
  memory: PersonaMemoryInfo;
}

/** Ответ GET /api/personas. */
export interface PersonasData {
  personas: PersonaSummary[];
  default: string;
  errors: string[];
}

/** Метаданные роли на детальной странице. */
export interface PersonaMeta {
  id: string;
  label: string;
  description: string;
  prompt: string;
  defaultStatus: string;
  allowTools: string[];
  builtin: boolean;
}

/** Ответ GET /api/personas/:id. */
export interface PersonaDetailData {
  persona: PersonaMeta;
  promptText: string;
  /** Ошибка резолвера промпта (роль объявлена, а файла нет) — не 500. */
  promptError: string | null;
  memoryText: string;
  memory: { chars: number; limit: number; truncated: boolean };
  promptPath: string;
  memoryPath: string;
  /** Статусы проекта из backlog/config.yml — для Select default_status. */
  statuses: string[];
  /** Известные имена инструментов — для мультиселекта allow_tools. */
  tools: string[];
}

/** Тело POST /api/personas. */
export interface CreatePersonaPayload {
  id: string;
  label: string;
  description?: string;
  promptText: string;
  defaultStatus?: string;
}

/** Тело PUT /api/personas/:id (все поля необязательны). */
export interface UpdatePersonaPayload {
  label?: string;
  description?: string;
  defaultStatus?: string;
  allowTools?: string[];
  promptText?: string;
  memoryText?: string;
}

/** Ответ DELETE /api/personas/:id. */
export interface DeletePersonaResult {
  deleted: string;
  promptPath: string;
  memoryPath: string;
  note: string;
}

/** Разбирает тело ошибки сервера в текст (400/404). */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error || `${fallback}: ${res.status}`);
}

/** Реестр ролей со сводками памяти. */
export async function fetchPersonas(): Promise<PersonasData> {
  const res = await fetch("/api/personas");
  if (!res.ok) throw await errorFrom(res, "GET /api/personas");
  return (await res.json()) as PersonasData;
}

/** Полные данные роли (включая тексты промпта и памяти). */
export async function fetchPersona(id: string): Promise<PersonaDetailData> {
  const res = await fetch(`/api/personas/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorFrom(res, "GET /api/personas/:id");
  return (await res.json()) as PersonaDetailData;
}

/** Создать проектную роль. Возвращает полные данные созданной роли. */
export async function createPersona(payload: CreatePersonaPayload): Promise<PersonaDetailData> {
  const res = await fetch("/api/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "POST /api/personas");
  return (await res.json()) as PersonaDetailData;
}

/** Изменить роль. Возвращает свежие полные данные. */
export async function updatePersona(
  id: string,
  payload: UpdatePersonaPayload,
): Promise<PersonaDetailData> {
  const res = await fetch(`/api/personas/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/personas/:id");
  return (await res.json()) as PersonaDetailData;
}

/** Удалить проектную роль (файлы промпта/памяти остаются — пути в ответе). */
export async function deletePersona(id: string): Promise<DeletePersonaResult> {
  const res = await fetch(`/api/personas/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res, "DELETE /api/personas/:id");
  return (await res.json()) as DeletePersonaResult;
}
