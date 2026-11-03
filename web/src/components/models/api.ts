/**
 * Слой данных страницы «Модели» (VL-316).
 *
 * Ходит в REST API Vibelog:
 * - GET    /api/models                  — реестр моделей и шлюзов (VL-209/315/316);
 * - POST   /api/models                  — добавить модель;
 * - PUT    /api/models/:id              — изменить модель;
 * - DELETE /api/models/:id              — удалить модель (с защитой на сервере);
 * - GET    /api/catalog/models          — поиск по каталогу шлюза (AC5);
 * - GET    /api/catalog/vendors         — вендоры модели с ценами (AC3);
 * - POST   /api/catalog/resolve         — готовая запись модели (AC6);
 * - GET    /api/catalog/prices          — сверка тарифов с каталогом (AC15);
 * - POST   /api/catalog/refresh-pricing — обновить тариф из каталога (AC16).
 *
 * Все функции бросают Error с текстом сервера: страница показывает его в
 * баннере ошибки (паттерн settings/api.ts, lesson-16 — консоль без ошибок).
 */

/** Тариф модели: рубли за 1M токенов (совпадает с ModelPricing на сервере). */
export interface Pricing {
  input_per_1m: number;
  output_per_1m: number;
  cache_per_1m: number;
}

/** Одна модель из models.available. */
export interface ModelInfo {
  id: string;
  label: string;
  description?: string;
  /** id шлюза (VL-315). */
  gateway: string;
  /** Апстрим внутри шлюза (VL-315). */
  vendor?: string;
  /** Имя модели у шлюза без `@`-хвоста (VL-316). */
  model: string;
  api_mode: "chat" | "responses";
  /** Тариф из settings.json (VL-316). */
  pricing?: Pricing;
  /** Размер контекста в токенах (VL-316). */
  context_window?: number;
}

/** Шлюз: БЕЗ значений ключей — только факт их наличия. */
export interface GatewayInfo {
  id: string;
  base_url: string;
  keySet: boolean;
}

/** Ответ GET /api/models. */
export interface ModelsData {
  default: string | null;
  available: ModelInfo[];
  gateways: GatewayInfo[];
}

/** Тело записи модели (POST/PUT). */
export interface ModelPayload {
  label?: string;
  description?: string;
  gateway: string;
  model: string;
  vendor?: string;
  api_mode?: "chat" | "responses";
  pricing?: Pricing;
  context_window?: number;
}

/** Модель в каталоге шлюза. */
export interface CatalogModel {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  pricing: Pricing;
  /** Компоненты цены с не-токенной единицей (image/second/request). */
  unsupportedUnits: string[];
}

/** Вендор (апстрим) модели в каталоге. */
export interface CatalogVendor {
  id: string;
  name: string;
  contextWindow?: number;
  pricing: Pricing;
  unsupportedUnits: string[];
}

/** Ответ GET /api/catalog/models. stale — данные из кэша (апстрим недоступен). */
export interface CatalogModelsData {
  gateway: string;
  stale: boolean;
  fetchedAt: string;
  models: CatalogModel[];
}

/** Ответ GET /api/catalog/vendors. */
export interface CatalogVendorsData {
  gateway: string;
  model: string;
  stale: boolean;
  fetchedAt: string;
  vendors: CatalogVendor[];
}

/** Ответ POST /api/catalog/resolve — предпросмотр итоговой записи (AC8). */
export interface ResolveData {
  id: string;
  record: ModelPayload;
  pricingSource: "manual" | "vendor" | "catalog" | "none";
  unsupportedUnits: string[];
  /** Каталог недоступен: цены надо ввести вручную (риск R2). */
  warning?: string;
}

/** Состояние одной компоненты тарифа при сверке (AC15). */
export type PriceStatus = "same" | "increased" | "decreased" | "unknown";

/** Отклонение одной компоненты тарифа. */
export interface PriceComponentDelta {
  current?: number;
  catalog?: number;
  percent?: number;
  status: PriceStatus;
}

/** Сверка тарифа модели с каталогом. */
export interface PriceComparison {
  status: PriceStatus;
  input: PriceComponentDelta;
  output: PriceComponentDelta;
  cache: PriceComponentDelta;
  catalogPricing?: Pricing;
}

/** Ответ GET /api/catalog/prices. */
export interface PricesData {
  gateway: string;
  stale: boolean;
  prices: Record<string, PriceComparison>;
  warning?: string;
}

/** Разбирает тело ошибки сервера в текст (400/404/409/503). */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error || `${fallback}: ${res.status}`);
}

/** Реестр моделей и шлюзов. */
export async function fetchModels(): Promise<ModelsData> {
  const res = await fetch("/api/models");
  if (!res.ok) throw await errorFrom(res, "GET /api/models");
  return (await res.json()) as ModelsData;
}

/** Добавить модель. Возвращает свежий реестр (страница не делает второй запрос). */
export async function createModel(payload: ModelPayload): Promise<ModelsData> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "POST /api/models");
  const data = (await res.json()) as { models: ModelsData };
  return data.models;
}

/** Изменить модель (id — текущий ключ; смена вендора меняет id). */
export async function updateModel(id: string, payload: ModelPayload): Promise<ModelsData> {
  const res = await fetch(`/api/models/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "PUT /api/models");
  const data = (await res.json()) as { models: ModelsData };
  return data.models;
}

/** Удалить модель. Сервер сам отказывает для default и занятых сессиями. */
export async function deleteModel(id: string): Promise<ModelsData> {
  const res = await fetch(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res, "DELETE /api/models");
  const data = (await res.json()) as { models: ModelsData };
  return data.models;
}

/** Поиск по каталогу шлюза. */
export async function fetchCatalogModels(
  gateway: string,
  query: string,
): Promise<CatalogModelsData> {
  const params = new URLSearchParams({ gateway });
  if (query.trim() !== "") params.set("query", query.trim());
  const res = await fetch(`/api/catalog/models?${params.toString()}`);
  if (!res.ok) throw await errorFrom(res, "GET /api/catalog/models");
  return (await res.json()) as CatalogModelsData;
}

/** Вендоры модели с их ценами. */
export async function fetchCatalogVendors(
  gateway: string,
  model: string,
): Promise<CatalogVendorsData> {
  const params = new URLSearchParams({ gateway, model });
  const res = await fetch(`/api/catalog/vendors?${params.toString()}`);
  if (!res.ok) throw await errorFrom(res, "GET /api/catalog/vendors");
  return (await res.json()) as CatalogVendorsData;
}

/** Готовая запись модели для предпросмотра в мастере. */
export async function resolveModel(payload: {
  gateway: string;
  model: string;
  vendor?: string;
  pricing?: Pricing;
}): Promise<ResolveData> {
  const res = await fetch("/api/catalog/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, "POST /api/catalog/resolve");
  return (await res.json()) as ResolveData;
}

/** Сверка тарифов всех моделей шлюза с каталогом. */
export async function fetchPrices(gateway: string): Promise<PricesData> {
  const params = new URLSearchParams({ gateway });
  const res = await fetch(`/api/catalog/prices?${params.toString()}`);
  if (!res.ok) throw await errorFrom(res, "GET /api/catalog/prices");
  return (await res.json()) as PricesData;
}

/** Обновить тариф модели из каталога (AC16). */
export async function refreshPricing(id: string): Promise<{ id: string; pricing: Pricing }> {
  const res = await fetch("/api/catalog/refresh-pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw await errorFrom(res, "POST /api/catalog/refresh-pricing");
  return (await res.json()) as { id: string; pricing: Pricing };
}
