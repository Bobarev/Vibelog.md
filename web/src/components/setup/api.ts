/**
 * Слой данных веб-мастера настройки проекта (VL-210).
 *
 * Ходит в REST API Vibelog (src/web/setup-api.ts):
 * - GET  /api/setup           — состояние проекта (режим, дефолты, агенты,
 *   провайдеры/модели) БЕЗ значений секретов;
 * - POST /api/setup           — применить ответы формы;
 * - POST /api/setup/ping      — ping LLM (модель, задержка, usage);
 * - POST /api/setup/check-bot — getMe Telegram.
 */

/** Агент в списке wizard-а. */
export interface SetupAgent {
  id: "vb" | "qwen" | "opencode" | "claude";
  available: boolean;
  enabled: boolean;
  /** Причина недоступности («Скоро» — adapter не реализован). */
  reason?: string;
}

/** Шлюз: БЕЗ значений ключей — только факт наличия. */
export interface SetupGateway {
  id: string;
  base_url: string;
  api_key_env: string | null;
  keySet: boolean;
}

/** @deprecated VL-315: переименовано в SetupGateway. */
export type SetupProvider = SetupGateway;

/** Модель из models.available. */
export interface SetupModel {
  id: string;
  label: string;
  /** VL-315: id шлюза (раньше provider). */
  gateway: string;
  /** VL-315: апстрим внутри шлюза. */
  vendor?: string;
  model: string;
  api_mode: "chat" | "responses";
}

/** Ответ GET /api/setup. */
export interface SetupStateData {
  mode: "fresh" | "upgrade";
  projectName: string;
  prefix: string;
  configError: string | null;
  agents: SetupAgent[];
  defaultAgent: string | null;
  secrets: { envFile: boolean; envKeys: string[]; settingsEnvKeys: string[] };
  bot: { configured: boolean; chats: number[] };
  gateways: SetupGateway[];
  models: { default: string | null; available: SetupModel[] };
  mcp: { qwen: boolean; opencode: boolean };
  envFileExists: boolean;
}

/** Ответы формы, отправляемые в POST /api/setup. */
export interface SetupAnswersPayload {
  mode: "fresh" | "upgrade";
  projectName: string;
  prefix: string;
  agents: string[];
  defaultAgent?: string;
  secretsLocation: "env" | "settings" | "both";
  bot?: { token?: string; chats: number[] };
  gateway?: { id: string; base_url: string; api_key_env?: string; apiKey?: string };
  model?: {
    id: string;
    label?: string;
    gateway: string;
    vendor?: string;
    model: string;
    api_mode?: "chat" | "responses";
  };
  mcp: boolean;
  force?: boolean;
}

/** Результат применения: что записано/пропущено. */
export interface SetupApplyResult {
  ok: boolean;
  written: string[];
  skipped: string[];
  warnings: string[];
}

/** Результат ping-а LLM. */
export interface LlmPingResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  usage?: { input: number; output: number; total: number };
  status?: number;
  error?: string;
  bodySnippet?: string;
}

/** Результат проверки токена бота. */
export interface BotCheckResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/** Состояние проекта. Бросает при ошибке — вызывающий показывает сообщение. */
export async function fetchSetupState(): Promise<SetupStateData> {
  const res = await fetch("/api/setup");
  if (!res.ok) throw new Error(`GET /api/setup: ${res.status}`);
  return (await res.json()) as SetupStateData;
}

/** Применяет ответы. Бросает с текстом ошибки сервера (400 от валидации). */
export async function postSetup(answers: SetupAnswersPayload): Promise<SetupApplyResult> {
  const res = await fetch("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(answers),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `POST /api/setup: ${res.status}`);
  }
  return (await res.json()) as SetupApplyResult;
}

/** Ping LLM (кнопка «Проверить»). */
export async function pingLlm(model?: string): Promise<LlmPingResult> {
  const res = await fetch("/api/setup/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { model } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as LlmPingResult & { error?: string };
  if (!res.ok) {
    return { ok: false, model: model ?? "", latencyMs: 0, error: data.error ?? `HTTP ${res.status}` };
  }
  return data;
}

/** Проверка токена Telegram (кнопка «Проверить»). */
export async function checkBot(token?: string): Promise<BotCheckResult> {
  const res = await fetch("/api/setup/check-bot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(token ? { token } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as BotCheckResult;
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  return data;
}
