/**
 * Слой данных страницы настроек (VL-156).
 *
 * Ходит в REST API Vibelog (src/web/api.ts):
 * - GET /api/settings — валидированные настройки БЕЗ env-секции (секреты
 *   не отдаются в браузер);
 * - PUT /api/settings — патч с серверной валидацией (зеркало /set).
 */

/** Настройки, редактируемые на странице (те же поля, что команда /set в боте). */
export interface SettingsData {
  default_agent?: "qwen" | "vb";
  max_wall_time?: number;
  max_requests?: number;
  branch_mode?: boolean;
  /** undefined = включён (VL-122): ключ пишется только для explicit off. */
  compact?: boolean;
  code_same_session?: boolean;
}

/** Числовые лимиты: undefined — не заданы (сброс, дефолт агента). */
export type SettingsPatch = {
  [K in "default_agent" | "branch_mode" | "compact" | "code_same_session"]?: SettingsData[K];
} & {
  max_wall_time?: number | null;
  max_requests?: number | null;
};

/** Текущие настройки. Бросает при ошибке — вызывающий показывает сообщение. */
export async function fetchSettings(): Promise<SettingsData> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error(`GET /api/settings: ${res.status}`);
  const data = (await res.json()) as { settings: SettingsData };
  return data.settings ?? {};
}

/** Патч настроек. Бросает с текстом ошибки сервера (400 от валидации). */
export async function putSettings(patch: SettingsPatch): Promise<SettingsData> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `PUT /api/settings: ${res.status}`);
  }
  const data = (await res.json()) as { settings: SettingsData };
  return data.settings ?? {};
}

// ── VL-209: реестр LLM-моделей/провайдеров ──

/** Одна модель из models.available. */
export interface ModelInfo {
  id: string;
  label: string;
  /** Короткое описание для второй строки пикера (VL-265), необязательно. */
  description?: string;
  provider: string;
  api_mode: "chat" | "responses";
}

/** Провайдер: БЕЗ значений ключей — только факт их наличия. */
export interface ProviderInfo {
  id: string;
  base_url: string;
  keySet: boolean;
}

/** Ответ GET /api/models. */
export interface ModelsData {
  default: string | null;
  available: ModelInfo[];
  providers: ProviderInfo[];
}

/** Список моделей/провайдеров. Бросает при ошибке — вызывающий показывает сообщение. */
export async function fetchModels(): Promise<ModelsData> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(`GET /api/models: ${res.status}`);
  return (await res.json()) as ModelsData;
}

/** Смена models.default. Бросает с текстом ошибки сервера (400 от валидации). */
export async function putModelDefault(id: string): Promise<void> {
  const res = await fetch("/api/models", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ default: id }),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `PUT /api/models: ${res.status}`);
  }
}

// ── VL-265: роли ассистента (chat_personas) ──

/** Роль для пикера: БЕЗ текста промпта (его собирает сервер). */
export interface PersonaInfo {
  id: string;
  label: string;
  description?: string;
}

/** Ответ GET /api/personas. errors — проблемы секции chat_personas. */
export interface PersonasData {
  personas: PersonaInfo[];
  default: string;
  errors?: string[];
}

/** Реестр ролей. Бросает при ошибке — вызывающий показывает сообщение. */
export async function fetchPersonas(): Promise<PersonasData> {
  const res = await fetch("/api/personas");
  if (!res.ok) throw new Error(`GET /api/personas: ${res.status}`);
  return (await res.json()) as PersonasData;
}
