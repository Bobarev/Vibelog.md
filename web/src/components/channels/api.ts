/**
 * Слой данных страницы «Каналы» (VL-438).
 *
 * Ходит в REST API Vibelog:
 * - GET    /api/comms/channels       — список каналов + default/секреты;
 * - POST   /api/comms/channels       — создать канал;
 * - GET    /api/comms/channels/:id   — канал + эффективные лимиты;
 * - PUT    /api/comms/channels/:id   — правка полей/limits;
 * - DELETE /api/comms/channels/:id   — удалить (?force=1 для default-канала);
 * - GET    /api/comms/settings       — глобальные параметры и лимиты;
 * - PUT    /api/comms/settings       — sync_timeout_sec/default_channel/limits;
 * - GET    /api/comms/prompts        — тексты шаблонов промптов;
 * - PUT    /api/comms/prompts        — запись проектного шаблона / reset.
 *
 * Секреты (bot_token/proxy) в ответах ТОЛЬКО булевыми признаками — сервер
 * значений не отдаёт, редактирование из UI недоступно (подсказка: править
 * .vibelog/comms.yaml руками).
 *
 * Все fetch — в try/catch на стороне страниц: ошибки сервера уходят в баннер
 * state (паттерн models/api.ts, lesson-16).
 */

/** Секции лимитов (ключи как в comms.yaml). */
export interface ChannelLimits {
  dedup_ttl_sec?: number;
  bot_rate_per_min?: number;
  human_rate_per_min?: number;
  global_runs_per_hour?: number;
  max_depth?: number;
  gate_timeout_sec?: number;
}

/** Сводка канала (GET/PUT /api/comms/channels). */
export interface ChannelInfo {
  id: string;
  label: string;
  transport: string;
  group_id: number;
  addressing: "mention" | "all";
  approval: "auto" | "admin";
  admin_chat: number | null;
  limits?: ChannelLimits;
}

/** Признаки секретов: значения сервер никогда не отдаёт. */
export interface SecretsFlags {
  bot_token: boolean;
  proxy: boolean;
}

/** Ответ GET /api/comms/channels. */
export interface ChannelsData {
  channels: ChannelInfo[];
  default_channel: string | null;
  secrets: SecretsFlags;
  sync_timeout_sec: number;
  interbot_limits: ChannelLimits;
}

/** Ответ GET /api/comms/channels/:id. */
export interface ChannelDetailData {
  channel: ChannelInfo;
  is_default: boolean;
  secrets: SecretsFlags;
  effective_limits: {
    dedupTtlMs: number;
    botRatePerMin: number;
    humanRatePerMin: number;
    globalRunsPerHour: number;
    maxDepth: number;
  };
}

/** Ответ GET /api/comms/settings. */
export interface CommsSettingsData {
  sync_timeout_sec: number;
  default_channel: string | null;
  interbot_limits: ChannelLimits;
  secrets: SecretsFlags;
  effective: Record<string, number>;
  channels: string[];
  prompt_paths?: Record<string, string>;
}

/** Сводка промпта (GET/PUT /api/comms/prompts). */
export interface PromptInfo {
  name: string;
  path: string;
  source: "project" | "default";
  text: string;
}

/** Ответ GET /api/comms/prompts. */
export interface PromptsData {
  incoming: PromptInfo;
  gate: PromptInfo;
}

/** Тело POST /api/comms/channels. */
export interface CreateChannelPayload {
  id: string;
  label?: string;
  group_id: number;
  addressing?: "mention" | "all";
  approval?: "auto" | "admin";
  admin_chat?: number | null;
}

/** Тело PUT /api/comms/channels/:id (все поля опциональны). */
export interface UpdateChannelPayload {
  label?: string;
  group_id?: number;
  addressing?: "mention" | "all";
  approval?: "auto" | "admin";
  admin_chat?: number | null;
  limits?: ChannelLimits | null;
}

/** Разобрать тело ошибки сервера в текст (400/404/409). */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error || `${fallback}: ${res.status}`);
}

/** Список каналов + глобальные параметры. */
export async function fetchChannels(): Promise<ChannelsData> {
  const res = await fetch("/api/comms/channels");
  if (!res.ok) throw await errorFrom(res, "GET /api/comms/channels");
  return (await res.json()) as ChannelsData;
}

/** Создать канал. Возвращает свежий канал. */
export async function createChannel(
  payload: CreateChannelPayload,
): Promise<{ channel: ChannelInfo }> {
  const res = await fetch("/api/comms/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "POST /api/comms/channels");
  return (await res.json()) as { channel: ChannelInfo };
}

/** Канал + эффективные лимиты (детальная страница). */
export async function fetchChannel(id: string): Promise<ChannelDetailData> {
  const res = await fetch(`/api/comms/channels/${encodeURIComponent(id)}`);
  if (!res.ok) throw await errorFrom(res, "GET /api/comms/channels/:id");
  return (await res.json()) as ChannelDetailData;
}

/** Правка канала. */
export async function updateChannel(
  id: string,
  payload: UpdateChannelPayload,
): Promise<{ channel: ChannelInfo }> {
  const res = await fetch(`/api/comms/channels/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/comms/channels/:id");
  return (await res.json()) as { channel: ChannelInfo };
}

/**
 * Удалить канал. force — обход guard default_channel (после предупреждения
 * и явного подтверждения пользователя).
 */
export async function deleteChannel(
  id: string,
  force = false,
): Promise<{ deleted: string; default_channel_cleared: boolean; warning?: string }> {
  const res = await fetch(
    `/api/comms/channels/${encodeURIComponent(id)}${force ? "?force=1" : ""}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await errorFrom(res, "DELETE /api/comms/channels/:id");
  return (await res.json()) as {
    deleted: string;
    default_channel_cleared: boolean;
    warning?: string;
  };
}

/** Глобальные настройки comms. */
export async function fetchSettings(): Promise<CommsSettingsData> {
  const res = await fetch("/api/comms/settings");
  if (!res.ok) throw await errorFrom(res, "GET /api/comms/settings");
  return (await res.json()) as CommsSettingsData;
}

/** Правка глобальных настроек (лимиты/таймауты/default_channel). */
export async function updateSettings(payload: {
  sync_timeout_sec?: number;
  default_channel?: string | null;
  interbot_limits?: ChannelLimits | null;
}): Promise<CommsSettingsData> {
  const res = await fetch("/api/comms/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/comms/settings");
  return (await res.json()) as CommsSettingsData;
}

/** Тексты шаблонов промптов (incoming/gate). */
export async function fetchPrompts(): Promise<PromptsData> {
  const res = await fetch("/api/comms/prompts");
  if (!res.ok) throw await errorFrom(res, "GET /api/comms/prompts");
  return (await res.json()) as PromptsData;
}

/** Записать проектный шаблон промпта. */
export async function savePrompt(name: "incoming" | "gate", text: string): Promise<PromptInfo> {
  const res = await fetch("/api/comms/prompts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/comms/prompts");
  return (await res.json()) as PromptInfo;
}

/** Сброс промпта на дефолт пакета (удаление проектного файла). */
export async function resetPrompt(name: "incoming" | "gate"): Promise<PromptInfo> {
  const res = await fetch("/api/comms/prompts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, reset: true }),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/comms/prompts (reset)");
  return (await res.json()) as PromptInfo;
}
