/**
 * Слой данных страницы «Конфиг проекта» (VL-165).
 *
 * Ходит в REST API Vibelog (src/web/api.ts):
 * - GET /api/config — backlog/config.yml как есть;
 * - PUT /api/config — патч с серверной валидацией (зеркало CLI config set:
 *   whitelist ключей defaultConfig, строгие типы, default_status ∈ statuses).
 */

/** Конфиг проекта: ключи defaultConfig (snake_case, формат Backlog.md). */
export interface ConfigData {
  project_name?: string;
  task_prefix?: string;
  default_status?: string;
  statuses?: string[];
  labels?: string[];
  priorities?: string[];
  types?: string[];
  definition_of_done?: string[];
  date_format?: string;
  default_editor?: string;
  auto_open_browser?: boolean;
  default_port?: number;
  remote_operations?: boolean;
  auto_commit?: boolean;
  bypass_git_hooks?: boolean;
  check_active_branches?: boolean;
  active_branch_days?: number;
  max_column_width?: number;
}

/** Патч — подмножество ключей конфига (все опциональны). */
export type ConfigPatch = Partial<ConfigData>;

/** Текущий конфиг. Бросает при ошибке — вызывающий показывает сообщение. */
export async function fetchConfig(): Promise<ConfigData> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`GET /api/config: ${res.status}`);
  return (await res.json()) as ConfigData;
}

/** Патч конфига. Бросает с текстом ошибки сервера (400 от валидации). */
export async function putConfig(patch: ConfigPatch): Promise<ConfigData> {
  const res = await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `PUT /api/config: ${res.status}`);
  }
  return (await res.json()) as ConfigData;
}
