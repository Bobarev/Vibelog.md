/**
 * Каталог моделей шлюза (VL-316): что шлюз реально предлагает, с ценами и
 * размерами контекста.
 *
 * Зачем: добавление модели раньше было ручным редактированием
 * `.vibelog/settings.json` — пользователь ходил на сайт RouterAI, смотрел
 * вендоров, переписывал цены от руки. Данные при этом доступны программно и
 * БЕЗ аутентификации (ref-18):
 *
 * - `GET <base_url>/models` — список моделей с `pricing`, `pricing_units`,
 *   `context_length`;
 * - `GET <base_url>/models/{author}/{model}/endpoints` — вендоры (апстримы)
 *   конкретной модели со своими ценами.
 *
 * Адаптер — per-шлюз (решение из плана): интерфейс `CatalogAdapter` не знает
 * про RouterAI, поэтому второй шлюз подключается записью в реестр
 * `CATALOG_ADAPTERS` без правки веб-интерфейса. Дефолтная реализация —
 * OpenAI-совместимый каталог (так работает RouterAI, и так же устроены
 * практически все агрегаторы): путь каталога выводится из `base_url` шлюза,
 * отдельного поля `catalog_url` в settings нет (AC17).
 *
 * Цены нормализуются в `ModelPricing` — рубли за 1M токенов (AC2). Это
 * главный риск фичи (R1 плана): если спутать «за токен» и «за 1M», стоимость
 * в аналитике уезжает в ×1e6. Поэтому правило нормализации живёт одной
 * функцией `normalizePricing`, и для неё есть отдельный тест: единицы
 * `token` умножаются на 1e6, единицы `1m`/`million` — как есть, всё
 * не-токенное (`image`, `second`, `request`, `search_unit`) в тариф НЕ
 * попадает и лишь помечается в `unsupportedUnits`.
 *
 * Сеть: fetch инжектируется через `CatalogDeps` — юнит-тесты работают без
 * реальной сети (guard VL-132 в src/test-setup.mjs отклоняет не-loopback).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSettings } from './settings.js';
import { loadGateways } from './models.js';
import type { GatewayConfig } from './models.js';
import type { ModelPricing } from './analytics.js';

/** Дефолтный TTL кэша каталога, минуты (AC4). */
export const DEFAULT_CATALOG_TTL_MINUTES = 60;

/** Таймаут одного запроса к каталогу, мс. */
export const CATALOG_TIMEOUT_MS = 10_000;

/** Максимальное число моделей в ответе поиска (защита от 582 записей в UI). */
export const CATALOG_SEARCH_LIMIT = 50;

/**
 * Множители «цена за единицу → цена за 1M токенов».
 *
 * `token` — цена за один токен, поэтому ×1e6 (риск R1: пропущенный множитель
 * занижает стоимость в миллион раз, лишний — завышает).
 * `1m`/`million` — цена уже за миллион, множитель 1.
 */
const TOKEN_UNIT_FACTORS: Record<string, number> = {
  token: 1e6,
  tokens: 1e6,
  '1m': 1,
  '1mtokens': 1,
  '1mtoken': 1,
  million: 1,
  'milliontokens': 1,
  'per1m': 1,
};

/** Приводит строку единицы к ключу TOKEN_UNIT_FACTORS (пробелы/регистр/дефисы). */
function unitKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Нормализует `pricing` каталога в `ModelPricing` (рубли за 1M токенов, AC2).
 *
 * Вход — как отдаёт RouterAI: `pricing: { prompt, completion, input_cache_read }`
 * и параллельный `pricing_units: { prompt: 'token', … }`.
 *
 * Правила:
 * - `prompt` → `input_per_1m`, `completion` → `output_per_1m`,
 *   `input_cache_read` → `cache_per_1m`;
 * - единица `token` умножается на 1e6, `1m`-подобные — как есть;
 * - не-токенная единица (`image`, `second`, `request`, `search_unit`) в
 *   тариф НЕ попадает: цена 0 + ключ в `unsupportedUnits` (billing Vibelog
 *   считает только токены, придумывать перевод «картинки в токены» нельзя);
 * - отсутствующая единица трактуется как `token` — это документированный
 *   формат каталога RouterAI (все записи имеют `pricing_units`, проверено
 *   живым запросом: 582 модели, 0 без `pricing_units`), а цена «за токен» —
 *   единственная осмысленная трактовка числа вида 0.0000157.
 *
 * @returns нормализованный тариф и список компонент с неподдерживаемой единицей
 */
export function normalizePricing(
  pricing: unknown,
  units?: unknown,
): { pricing: ModelPricing; unsupportedUnits: string[] } {
  const p = (typeof pricing === 'object' && pricing !== null && !Array.isArray(pricing)
    ? pricing
    : {}) as Record<string, unknown>;
  const u = (typeof units === 'object' && units !== null && !Array.isArray(units)
    ? units
    : {}) as Record<string, unknown>;
  const unsupportedUnits: string[] = [];

  // Не-токенные компоненты ищем по ВСЕМ ключам pricing, а не только по трём
  // интересным billing-у: UI должен показать, что тариф неполный (например,
  // модель берёт деньги за картинки или поиск).
  for (const key of Object.keys(p)) {
    const unit = unitKey(u[key] ?? 'token');
    if (TOKEN_UNIT_FACTORS[unit] === undefined) unsupportedUnits.push(key);
  }

  /** Цена одной компоненты: number → рубли за 1M, иначе 0. */
  const component = (key: string): number => {
    const raw = p[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
    // Единица не задана → token (см. правило выше)
    const factor = TOKEN_UNIT_FACTORS[unitKey(u[key] ?? 'token')];
    if (factor === undefined) return 0;
    // Округление до 12 значащих цифр: снимает хвост float
    // (0.0000336849344 * 1e6 = 33.684934399999996), не теряя саму цену.
    // Округлять до 6 знаков нельзя — обрезало бы разряды реального тарифа.
    return Number((raw * factor).toPrecision(12));
  };

  return {
    pricing: {
      input_per_1m: component('prompt'),
      output_per_1m: component('completion'),
      cache_per_1m: component('input_cache_read'),
    },
    unsupportedUnits,
  };
}

/** Вендор (апстрим) модели в каталоге шлюза. */
export interface CatalogVendor {
  /**
   * id вендора — то, что пишется в `ModelConfig.vendor` и уходит в
   * wire-запрос как `provider.order` (ref-18). У RouterAI это `tag`
   * («baidu», «upstage»), у некоторых записей он пуст — тогда fallback на
   * `provider_name` в нижнем регистре.
   */
  id: string;
  /** Человекочитаемое имя вендора для выбора в мастере. */
  name: string;
  /** Размер контекста у ЭТОГО вендора (бывает больше, чем у модели в целом). */
  contextWindow?: number;
  pricing: ModelPricing;
  /** Компоненты цены с единицей, которую нельзя перевести в токены. */
  unsupportedUnits: string[];
}

/** Модель в каталоге шлюза. */
export interface CatalogModel {
  /** id модели у шлюза (author/model) — уходит в `ModelConfig.model`. */
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  pricing: ModelPricing;
  unsupportedUnits: string[];
}

/** Адаптер каталога одного шлюза (интерфейс из плана: listModels/listVendors). */
export interface CatalogAdapter {
  /** Модели шлюза; `query` фильтруется адаптером (подстрока по id/имени). */
  listModels(query?: string): Promise<CatalogModel[]>;
  /** Вендоры конкретной модели. */
  listVendors(modelId: string): Promise<CatalogVendor[]>;
}

/** Зависимости для тестов: подменяемые fetch/таймаут/часы. */
export interface CatalogDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** Текущее время, мс (для детерминированных тестов TTL). */
  now?: () => number;
}

/** Результат чтения каталога: данные + признак «из кэша, апстрим недоступен». */
export interface CatalogResult<T> {
  gateway: string;
  /** Данные отданы из кэша, потому что апстрим недоступен/закэшированы. */
  stale: boolean;
  /** Момент получения данных от апстрима (ISO). */
  fetchedAt: string;
  items: T;
}

// ── HTTP-слой адаптера ──

/** Базовый URL каталога: `<base_url шлюза>` без хвостовых слэшей (AC17). */
export function catalogBaseUrl(gateway: GatewayConfig): string {
  return gateway.base_url.replace(/\/+$/, '');
}

/**
 * GET JSON с каталога шлюза.
 *
 * @throws Error с русским текстом — вызывающий решает, отдать кэш или ошибку
 */
async function fetchJson(url: string, deps: CatalogDeps): Promise<unknown> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchFn(url, {
      signal: AbortSignal.timeout(deps.timeoutMs ?? CATALOG_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    // Сеть/таймаут/DNS — самая частая деградация (риск R2 плана)
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`каталог недоступен (${url}): ${msg}`);
  }
  if (!res.ok) throw new Error(`каталог ответил HTTP ${res.status} (${url})`);
  try {
    return await res.json();
  } catch {
    throw new Error(`каталог вернул не-JSON (${url})`);
  }
}

/** Собирает id вендора: `tag` приоритетнее, иначе `provider_name` в нижнем регистре. */
function vendorIdFrom(raw: Record<string, unknown>): string {
  const tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
  if (tag !== '') return tag;
  const name = typeof raw.provider_name === 'string' ? raw.provider_name.trim() : '';
  return name.toLowerCase().replace(/\s+/g, '-');
}

/** Разбирает одну запись модели из `/models` (или общий блок `/endpoints`). */
function parseCatalogModel(raw: unknown): CatalogModel | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  const { pricing, unsupportedUnits } = normalizePricing(r.pricing, r.pricing_units);
  const out: CatalogModel = {
    id: r.id,
    name: typeof r.name === 'string' && r.name !== '' ? r.name : r.id,
    pricing,
    unsupportedUnits,
  };
  if (typeof r.description === 'string' && r.description !== '') out.description = r.description;
  if (typeof r.context_length === 'number' && Number.isFinite(r.context_length) && r.context_length > 0) {
    out.contextWindow = r.context_length;
  }
  return out;
}

/** Разбирает одну запись вендора из массива `endpoints`. */
function parseCatalogVendor(raw: unknown): CatalogVendor | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = vendorIdFrom(r);
  if (id === '') return null;
  const { pricing, unsupportedUnits } = normalizePricing(r.pricing, r.pricing_units);
  const name =
    typeof r.provider_name === 'string' && r.provider_name !== ''
      ? r.provider_name
      : typeof r.name === 'string' && r.name !== ''
        ? r.name
        : id;
  const out: CatalogVendor = { id, name, pricing, unsupportedUnits };
  if (typeof r.context_length === 'number' && Number.isFinite(r.context_length) && r.context_length > 0) {
    out.contextWindow = r.context_length;
  }
  return out;
}

/** Совпадение модели с поисковой строкой (регистр не важен). */
function matchesQuery(model: CatalogModel, query: string): boolean {
  if (query === '') return true;
  const q = query.toLowerCase();
  return model.id.toLowerCase().includes(q) || model.name.toLowerCase().includes(q);
}

/**
 * OpenAI-совместимый адаптер каталога: `<base_url>/models` и
 * `<base_url>/models/{id}/endpoints`.
 *
 * RouterAI реализует РОВНО этот протокол (ref-18), поэтому отдельная
 * «routerai»-реализация не нужна и не должна существовать: per-шлюз различие
 * задаётся реестром `CATALOG_ADAPTERS`, а не дублированием кода.
 */
export function createOpenAiCompatibleCatalog(
  gateway: GatewayConfig,
  deps: CatalogDeps = {},
): CatalogAdapter {
  const base = `${catalogBaseUrl(gateway)}/models`;
  return {
    async listModels(query?: string): Promise<CatalogModel[]> {
      const body = await fetchJson(base, deps);
      const data = (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(data)) throw new Error('каталог: в ответе нет массива data');
      const out: CatalogModel[] = [];
      const q = (query ?? '').trim();
      for (const raw of data) {
        const model = parseCatalogModel(raw);
        if (model === null || !matchesQuery(model, q)) continue;
        out.push(model);
      }
      return out;
    },

    async listVendors(modelId: string): Promise<CatalogVendor[]> {
      // id модели уходит в путь как есть (author/model); сегменты кодируем,
      // чтобы «/» внутри второй половины id не ломал URL
      const path = modelId
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const body = await fetchJson(`${base}/${path}/endpoints`, deps);
      const endpoints = (body as { data?: { endpoints?: unknown } } | null)?.data?.endpoints;
      if (!Array.isArray(endpoints)) {
        throw new Error(`каталог: у модели «${modelId}» нет списка endpoints`);
      }
      const out: CatalogVendor[] = [];
      for (const raw of endpoints) {
        const vendor = parseCatalogVendor(raw);
        if (vendor !== null) out.push(vendor);
      }
      return out;
    },
  };
}

/**
 * Реестр адаптеров по id шлюза (per-шлюз адаптация, решение из плана).
 *
 * Пустой по умолчанию: все известные шлюзы (routerai и любой
 * OpenAI-совместимый) обслуживает дефолтный адаптер. Новый шлюз со своей
 * схемой каталога добавляется здесь одной записью — UI и API не меняются.
 */
export const CATALOG_ADAPTERS: Record<
  string,
  (gateway: GatewayConfig, deps: CatalogDeps) => CatalogAdapter
> = {};

/** Адаптер каталога шлюза: из реестра либо дефолтный OpenAI-совместимый. */
export function getCatalogAdapter(
  gatewayId: string,
  gateway: GatewayConfig,
  deps: CatalogDeps = {},
): CatalogAdapter {
  const factory = CATALOG_ADAPTERS[gatewayId] ?? createOpenAiCompatibleCatalog;
  return factory(gateway, deps);
}

// ── Кэш каталога (AC4) ──

/** Запись кэша каталога: данные + момент получения от апстрима. */
interface CacheEntry {
  fetchedAt: string;
  models: CatalogModel[];
  /** Вендоры по id модели (заполняется по мере запросов). */
  vendors: Record<string, CatalogVendor[]>;
}

/** Формат файла кэша. */
interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/** Путь к файлу кэша каталога: `.vibelog/cache/provider-catalog.json`. */
export function catalogCachePath(cwd: string): string {
  return join(cwd, '.vibelog', 'cache', 'provider-catalog.json');
}

/** Ключ записи кэша: шлюз + тип запроса (модели/вендоры модели). */
function cacheKey(gatewayId: string, kind: 'models' | 'vendors', modelId?: string): string {
  return kind === 'models' ? `${gatewayId}:models` : `${gatewayId}:vendors:${modelId ?? ''}`;
}

/**
 * Читает файл кэша; отсутствие/битый JSON/чужая версия → пустой кэш.
 * Кэш — ускоритель, а не источник правды: мусор не должен ронять страницу.
 */
function readCache(cwd: string): CacheFile {
  const path = catalogCachePath(cwd);
  if (!existsSync(path)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CacheFile>;
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== 1) {
      return { version: 1, entries: {} };
    }
    const entries =
      typeof parsed.entries === 'object' && parsed.entries !== null ? parsed.entries : {};
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: {} };
  }
}

/** Пишет кэш; сбой записи не критичен (кэш — оптимизация). */
function writeCache(cwd: string, file: CacheFile): void {
  try {
    const path = catalogCachePath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  } catch {
    // Нет прав/диска — каталог продолжит работать без кэша
  }
}

/** TTL кэша из настроек: `catalog.ttl_minutes`, дефолт 60 (AC4). */
export function catalogTtlMinutes(cwd: string): number {
  const raw = loadSettings(cwd).catalog;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_CATALOG_TTL_MINUTES;
  }
  const value = (raw as Record<string, unknown>).ttl_minutes;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CATALOG_TTL_MINUTES;
  }
  return value;
}

/** Возраст записи в мс. */
function ageMs(entry: CacheEntry, now: number): number {
  const at = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return now - at;
}

/** Отдаёт список моделей с деградацией: свежий кэш → апстрим → протухший кэш. */
export async function listCatalogModels(
  cwd: string,
  gatewayId: string,
  opts: { query?: string; force?: boolean } & CatalogDeps = {},
): Promise<CatalogResult<CatalogModel[]>> {
  const gateways = loadGateways(cwd);
  const gateway = gateways[gatewayId];
  if (!gateway) throw new Error(`Неизвестный шлюз: ${gatewayId}`);
  const deps: CatalogDeps = { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs, now: opts.now };
  const now = (opts.now ?? Date.now)();
  const ttlMs = catalogTtlMinutes(cwd) * 60_000;
  const cache = readCache(cwd);
  const key = cacheKey(gatewayId, 'models');
  const cached = cache.entries[key];

  if (!opts.force && cached && ageMs(cached, now) < ttlMs) {
    return {
      gateway: gatewayId,
      stale: false,
      fetchedAt: cached.fetchedAt,
      items: filterAndLimit(cached.models, opts.query),
    };
  }

  try {
    const models = await getCatalogAdapter(gatewayId, gateway, deps).listModels();
    const fetchedAt = new Date(now).toISOString();
    cache.entries[key] = { ...(cached ?? { vendors: {} }), fetchedAt, models };
    writeCache(cwd, cache);
    return { gateway: gatewayId, stale: false, fetchedAt, items: filterAndLimit(models, opts.query) };
  } catch (err) {
    // Риск R2: каталог без аутентификации ≠ гарантия доступности.
    // Протухший кэш лучше ошибки — цены могли измениться, но работать можно.
    if (cached) {
      return {
        gateway: gatewayId,
        stale: true,
        fetchedAt: cached.fetchedAt,
        items: filterAndLimit(cached.models, opts.query),
      };
    }
    throw err;
  }
}

/** Фильтр по запросу + лимит выдачи (каталог RouterAI — 582 модели). */
function filterAndLimit(models: CatalogModel[], query?: string): CatalogModel[] {
  const q = (query ?? '').trim();
  const filtered = q === '' ? models : models.filter((m) => matchesQuery(m, q));
  return filtered.slice(0, CATALOG_SEARCH_LIMIT);
}

// ── Сверка цен: settings.json vs каталог (AC15) ──

/** Состояние одной компоненты тарифа. */
export type PriceStatus = 'same' | 'increased' | 'decreased' | 'unknown';

/** Отклонение одной компоненты тарифа. */
export interface PriceComponentDelta {
  /** Текущая цена в settings.json (undefined — тариф не задан). */
  current?: number;
  /** Цена из каталога (undefined — каталог цену не дал). */
  catalog?: number;
  /** Отклонение в процентах (положительное — цена выросла). */
  percent?: number;
  status: PriceStatus;
}

/** Сверка тарифа модели с каталогом. */
export interface PriceComparison {
  /** Общий статус: худший из компонент (increased важнее decreased). */
  status: PriceStatus;
  input: PriceComponentDelta;
  output: PriceComponentDelta;
  cache: PriceComponentDelta;
}

/**
 * Сравнивает тариф модели с каталожным (AC15).
 *
 * Сравнение по компонентам, а не по сумме: у модели может подорожать только
 * вывод — сумма это смажет. «Совпадает» — расхождение меньше 0.5%: каталог
 * отдаёт цены с плавающей точкой, точное равенство после нормализации
 * недостижимо (0.000015789813 * 1e6 = 15.789813, в settings могло попасть
 * 15.79 при ручном вводе).
 *
 * @param current — тариф из settings.json (undefined — не задан)
 * @param catalog — тариф из каталога (undefined — каталог не ответил)
 */
export function comparePricing(
  current: ModelPricing | undefined,
  catalog: ModelPricing | undefined,
): PriceComparison {
  /** Порог «это та же цена» в процентах. */
  const EPSILON_PERCENT = 0.5;

  const component = (cur?: number, cat?: number): PriceComponentDelta => {
    if (cur === undefined || cat === undefined) return { current: cur, catalog: cat, status: 'unknown' };
    if (cur === 0 && cat === 0) return { current: 0, catalog: 0, percent: 0, status: 'same' };
    // База — цена каталога: «выросла» значит «в settings дешевле, чем реально»
    const percent = cat === 0 ? (cur === 0 ? 0 : 100) : Math.round(((cur - cat) / cat) * 1000) / 10;
    let status: PriceStatus;
    if (Math.abs(percent) < EPSILON_PERCENT) status = 'same';
    else status = percent > 0 ? 'increased' : 'decreased';
    return { current: cur, catalog: cat, percent, status };
  };

  const input = component(current?.input_per_1m, catalog?.input_per_1m);
  const output = component(current?.output_per_1m, catalog?.output_per_1m);
  const cache = component(current?.cache_per_1m, catalog?.cache_per_1m);

  // Общий статус: сначала изменения (расхождение важнее совпадения),
  // из изменений приоритет — рост цены (деньги тратятся больше ожидаемого)
  const statuses = [input.status, output.status, cache.status];
  const status: PriceStatus = statuses.includes('increased')
    ? 'increased'
    : statuses.includes('decreased')
      ? 'decreased'
      : statuses.includes('same')
        ? 'same'
        : 'unknown';

  return { status, input, output, cache };
}

/**
 * Вендоры модели из кэша каталога БЕЗ сетевого запроса (VL-317).
 *
 * Нужна синхронным точкам (старт фазы в оркестраторе): там нельзя ждать сеть,
 * но и молча игнорировать дрейф нельзя. `null` — в кэше нет записи (сверка
 * невозможна, вызывающий решает по `pricing_guard.offline`).
 */
export function readCachedVendors(
  cwd: string,
  gatewayId: string,
  modelId: string,
): { vendors: CatalogVendor[]; fetchedAt: string } | null {
  const cached = readCache(cwd).entries[cacheKey(gatewayId, 'vendors', modelId)];
  const vendors = cached?.vendors[modelId];
  if (!cached || !vendors) return null;
  return { vendors, fetchedAt: cached.fetchedAt };
}

/** Отдаёт вендоров модели с той же деградацией, что и список моделей. */
export async function listCatalogVendors(
  cwd: string,
  gatewayId: string,
  modelId: string,
  opts: { force?: boolean } & CatalogDeps = {},
): Promise<CatalogResult<CatalogVendor[]>> {
  const gateways = loadGateways(cwd);
  const gateway = gateways[gatewayId];
  if (!gateway) throw new Error(`Неизвестный шлюз: ${gatewayId}`);
  if (modelId.trim() === '') throw new Error('Пустое имя модели');
  const deps: CatalogDeps = { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs, now: opts.now };
  const now = (opts.now ?? Date.now)();
  const ttlMs = catalogTtlMinutes(cwd) * 60_000;
  const cache = readCache(cwd);
  const key = cacheKey(gatewayId, 'vendors', modelId);
  const cached = cache.entries[key];

  if (!opts.force && cached && ageMs(cached, now) < ttlMs) {
    return { gateway: gatewayId, stale: false, fetchedAt: cached.fetchedAt, items: cached.vendors[modelId] ?? [] };
  }

  try {
    const vendors = await getCatalogAdapter(gatewayId, gateway, deps).listVendors(modelId);
    const fetchedAt = new Date(now).toISOString();
    cache.entries[key] = { fetchedAt, models: [], vendors: { [modelId]: vendors } };
    writeCache(cwd, cache);
    return { gateway: gatewayId, stale: false, fetchedAt, items: vendors };
  } catch (err) {
    const staleVendors = cached?.vendors[modelId];
    if (staleVendors) {
      return { gateway: gatewayId, stale: true, fetchedAt: cached.fetchedAt, items: staleVendors };
    }
    throw err;
  }
}
