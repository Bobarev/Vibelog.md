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
