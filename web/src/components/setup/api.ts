/**
 * Слой данных веб-мастера настройки проекта (VL-210, расширен VL-328).
 *
 * Ходит в REST API Vibelog (src/web/setup-api.ts):
 * - GET  /api/setup           — состояние проекта (режим, дефолты, агенты,
 *   шлюзы/модели) БЕЗ значений секретов;
 * - POST /api/setup           — применить ответы формы;
 * - POST /api/setup/ping      — ping LLM (модель, задержка, usage);
 * - POST /api/setup/check-bot — getMe Telegram.
 *
 * VL-328: каталог моделей и вендоров берём из /api/catalog/* (VL-316) —
 * мастер показывает те же цены и варианты, что CLI-wizard после VL-324/327.
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

/** Пресет шлюза LLM из ядра (VL-328) — один и тот же у CLI-wizard-а и веба. */
export interface GatewayPreset {
  /** id пресета (= id шлюза, кроме custom). */
  id: string;
  label: string;
  /** base_url пресета; null — свой ввод (OpenAI-совместимый). */
  base_url: string | null;
  /** Дефолтное имя env-переменной с ключом ('' — выводится из id). */
  api_key_env: string;
  /** true — шлюз умеет каталог моделей. */
  catalog: boolean;
  /** true — модель/вендор вводит пользователь. */
  manualModel: boolean;
  /** true — «свой base_url», id шлюза выводится из домена. */
  custom: boolean;
}

/** Предлагаемая локация секретов (VL-328: только system и env). */
export interface SecretsLocationOption {
  id: "system" | "env";
  label: string;
}

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
  secrets: { envFile: boolean; envKeys: string[] };
  bot: { configured: boolean; chats: number[]; proxySet: boolean };
  /** VL-328: перечень шлюзов из ядра (core/llm-presets.ts). */
  gatewayPresets: GatewayPreset[];
  /** VL-328/329: предлагаемые локации секретов (system|env). */
  secretsLocations: SecretsLocationOption[];
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
  /** VL-329: секреты пишутся только в .env (env) или не пишутся (system). */
  secretsLocation: "system" | "env";
  bot?: { token?: string; chats: number[]; proxy?: string };
  gateway?: {
    id: string;
    /** VL-328: пресет шлюза — сервер валидирует по нему base_url. */
    preset?: string;
    base_url: string;
    api_key_env?: string;
    apiKey?: string;
  };
  model?: {
    id: string;
    label?: string;
    gateway: string;
    vendor?: string;
    model: string;
    api_mode?: "chat" | "responses";
  };
  /** VL-328: подтверждение перезаписи уже существующих секретов (AC7). */
  secretsOverwrite?: boolean;
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

/** Тариф модели в каталоге: рубли за 1M токенов (VL-316). */
export interface CatalogPricing {
  input_per_1m: number;
  output_per_1m: number;
  cache_per_1m: number;
}

/** Модель каталога шлюза (ответ /api/catalog/models). */
export interface CatalogModel {
  id: string;
  name: string;
  pricing: CatalogPricing;
  contextWindow?: number;
}

/** Вендор (апстрим) модели — ответ /api/catalog/vendors. */
export interface CatalogVendor {
  id: string;
  name: string;
  pricing: CatalogPricing;
  contextWindow?: number;
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

/**
 * Каталог моделей шлюза (VL-328, AC3).
 *
 * `query` — поиск на стороне сервера; пустой запрос отдаёт каталог целиком,
 * но `listCatalogModels` режет выдачу по CATALOG_SEARCH_LIMIT только когда
 * запрос непустой. Для двухступенчатого выбора мастер просит конкретного
 * автора (`<author>/`) — так обрезка не срабатывает.
 */
export async function fetchCatalogModels(
  gateway: string,
  query = "",
): Promise<{ models: CatalogModel[]; stale: boolean }> {
  const params = new URLSearchParams({ gateway });
  if (query !== "") params.set("query", query);
  const res = await fetch(`/api/catalog/models?${params.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    models?: CatalogModel[];
    stale?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `GET /api/catalog/models: ${res.status}`);
  return { models: data.models ?? [], stale: data.stale === true };
}

/** Вендоры (апстримы) модели с ценами (VL-328, AC3). */
export async function fetchCatalogVendors(
  gateway: string,
  model: string,
): Promise<{ vendors: CatalogVendor[]; stale: boolean }> {
  const params = new URLSearchParams({ gateway, model });
  const res = await fetch(`/api/catalog/vendors?${params.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    vendors?: CatalogVendor[];
    stale?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `GET /api/catalog/vendors: ${res.status}`);
  return { vendors: data.vendors ?? [], stale: data.stale === true };
}