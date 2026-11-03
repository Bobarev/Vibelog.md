/**
 * Реестр LLM-шлюзов и моделей в .vibelog/settings.json (VL-209, VL-315).
 *
 * Терминология (VL-315):
 * - `gateway` — шлюз (routerai и подобные): base_url + ключ;
 * - `vendor` — апстрим ВНУТРИ шлюза (baidu / makora / morph / xiaomi / gmicloud);
 * - `model` — имя модели у шлюза.
 *
 * Секции settings.json:
 *
 * - `gateways`: id → { base_url, api_key_env | api_key } — URL шлюза и ИМЯ
 *   переменной окружения с ключом (не сам ключ!): ключ читается из
 *   env → .env → env-секции settings.json (приоритет VL-143 — сюда он
 *   попадает через loadProjectEnv ДО вызова resolveActiveModel).
 *   Старый ключ `providers` читается как deprecated-алиас (VL-315, AC3):
 *   `gateways` приоритетнее по совпадающим id, запись — только `gateways`.
 * - `models`: { default, available: { <id>: { label, gateway, vendor?,
 *   model, api_mode, pricing } } } — id строки вида gateway/model (как в
 *   OpenCode/Mastra), gateway — ссылка на gateways[<id>].
 *
 * Выбор апстрима (VL-315): раньше он был зашит В СТРОКУ имени модели
 * `@`-хвостом (`deepseek/deepseek-v4.1-flash@provider=baidu&allow_fallbacks=false`),
 * потому что клиент не умел задавать его структурно. Теперь апстрим — поле
 * `vendor`, а `@`-хвост РАЗБИРАЕТСЯ при чтении (parseVendorSuffix) и в
 * settings больше не пишется. Правило разбора живёт в одной функции, чтобы
 * чтение и запись не разъезжались (риск R3 плана).
 *
 * Fallback-контракт: нет секции models (или пустой default/available) →
 * resolveActiveModel возвращает null и все вызывающие переходят на
 * СТАРОЕ поведение (env VIBELOG_LLM_*) — пользователи на env-only
 * ломаться не должны (риск из плана VL-209).
 *
 * Все читатели — терпимы к битым значениям (паттерн loadSettings):
 * настройки не должны ронять процесс, битые поля отбрасываются.
 */

import { loadSettings } from './settings.js';
import type { ApiMode } from '../agent/llm.js';
import type { ModelPricing } from './analytics.js';

/** Шлюз LLM: URL и способ получить API-ключ. */
export interface GatewayConfig {
  /** Базовый URL шлюза (без хвостовых слэшей — их срезает createLlmClient). */
  base_url: string;
  /** Имя переменной окружения с ключом (приоритетный источник, VL-143). */
  api_key_env?: string;
  /** Прямой ключ — fallback для не-секретных случаев (не рекомендуется). */
  api_key?: string;
}

/**
 * @deprecated VL-315: переименовано в GatewayConfig. Оставлено как алиас
 * типа, чтобы не ломать импортёров одним махом.
 */
export type ProviderConfig = GatewayConfig;

/** Одна модель в available. */
export interface ModelConfig {
  /** Человекочитаемая подпись для CLI/бота/веба. */
  label?: string;
  /**
   * Короткое описание модели для пикеров веб-чата (VL-265): вторая строка
   * в дропдауне выбора модели. Необязательно — пикер рендерит только label.
   */
  description?: string;
  /** Ссылка на gateways[<id>] (VL-315; старое имя поля — provider). */
  gateway: string;
  /**
   * Апстрим внутри шлюза (VL-315): id вендора, напр. "baidu". Пока ровно
   * один — у RouterAI разные апстримы одной модели имеют разные цены, это
   * разные записи available. Отсутствие vendor = поведение как раньше
   * (шлюз сам выбирает апстрим).
   */
  vendor?: string;
  /** Имя модели у шлюза БЕЗ `@`-хвоста (напр. "xiaomi/mimo-v2.6-pro"). */
  model: string;
  /** Режим API (VL-205); дефолт 'chat'. */
  api_mode?: ApiMode;
  /** Тарифы для billing (VL-198) — теперь внутри модели. */
  pricing?: ModelPricing;
}

/** Секция models settings.json. */
export interface ModelsConfig {
  default?: string;
  available: Record<string, ModelConfig>;
}

/** Полный резолв активной модели: всё, что нужно createLlmClient. */
export interface ActiveModel {
  /** id из available (внешний идентификатор, "gateway/model"). */
  id: string;
  /** label или id, если label не задан (в лог фазы и списки). */
  label: string;
  /** id шлюза в gateways (VL-315; раньше providerId). */
  gatewayId: string;
  /** Апстрим внутри шлюза (VL-315); undefined — шлюз выбирает сам. */
  vendor?: string;
  /** Имя модели у шлюза (что уходит в поле model wire-запроса). */
  model: string;
  /** Режим API модели. */
  apiMode: ApiMode;
  /** Тарифы модели (для billing; undefined — тариф не задан). */
  pricing?: ModelPricing;
  /** Базовый URL шлюза. */
  baseUrl: string;
  /** API-ключ: env[api_key_env] → gateway.api_key → ''. */
  apiKey: string;
  /** Имя env-переменной ключа (для текстов ошибок валидации). */
  apiKeyEnv?: string;
}

/** Разобранный `@`-хвост имени модели (VL-315). */
export interface VendorSuffix {
  /** Имя модели без хвоста. */
  model: string;
  /** Апстрим из `@provider=<id>`; undefined — хвоста нет/он не распознан. */
  vendor?: string;
  /** `allow_fallbacks` из хвоста; undefined — параметр не задан. */
  allowFallbacks?: boolean;
}

/**
 * Разбирает `@`-хвост имени модели (VL-315, AC4).
 *
 * Формат (совместимость с RouterAI, ref-18): `<model>@provider=<vendor>`
 * либо `<model>@provider=<vendor>&allow_fallbacks=<true|false>`.
 *
 * Правило живёт ОДНОЙ функцией (риск R3 плана): и чтение settings.json, и
 * сборка wire-запроса используют её — иначе правила разъедутся.
 *
 * Мусор в хвосте (`@`, `@foo`, `@provider=`, `@a=b` без provider) — НЕ хвост:
 * имя модели возвращается как есть, vendor не выставляется. Так модель с
 * легитимным `@` в имени не превращается в мусорную запись.
 */
export function parseVendorSuffix(raw: string): VendorSuffix {
  const at = raw.lastIndexOf('@');
  // at <= 0: хвоста нет либо имя начинается с @ (не наш формат)
  if (at <= 0) return { model: raw };
  const base = raw.slice(0, at);
  const tail = raw.slice(at + 1);
  const params = new Map<string, string>();
  for (const part of tail.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return { model: raw }; // мусор — считаем, что хвоста нет
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === '') return { model: raw };
    params.set(key, value);
  }
  const vendor = params.get('provider');
  if (vendor === undefined || vendor === '') return { model: raw };
  const out: VendorSuffix = { model: base, vendor };
  const af = params.get('allow_fallbacks');
  if (af === 'true' || af === 'false') out.allowFallbacks = af === 'true';
  return out;
}

/**
 * Собирает имя модели с `@`-хвостом (VL-315) — обратная операция к
 * parseVendorSuffix. Нужна только для диагностики/совместимости: в
 * settings.json и в wire-запросе апстрим задаётся структурно.
 */
export function buildVendorSuffix(model: string, vendor: string, allowFallbacks?: boolean): string {
  const tail =
    allowFallbacks === undefined
      ? `provider=${vendor}`
      : `provider=${vendor}&allow_fallbacks=${allowFallbacks ? 'true' : 'false'}`;
  return `${model}@${tail}`;
}

/**
 * Читает секцию gateways (VL-315; старое имя — providers).
 *
 * Оба ключа читаются, `gateways` приоритетнее по совпадающим id (AC3):
 * пользователь, начавший переезд, не теряет ещё не перенесённые записи.
 *
 * Битые значения (не строковый base_url, не объект) отбрасываются по
 * ключу — мусор в одном шлюзе не должен ломать остальные.
 */
export function loadGateways(cwd: string): Record<string, GatewayConfig> {
  const settings = loadSettings(cwd);
  const out: Record<string, GatewayConfig> = {};
  // Порядок важен: сначала legacy providers, затем gateways поверх
  for (const section of [settings.providers, settings.gateways]) {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) continue;
    for (const [id, val] of Object.entries(section as Record<string, unknown>)) {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
      const v = val as Record<string, unknown>;
      if (typeof v.base_url !== 'string' || v.base_url === '') continue;
      const conf: GatewayConfig = { base_url: v.base_url };
      if (typeof v.api_key_env === 'string' && v.api_key_env !== '') conf.api_key_env = v.api_key_env;
      if (typeof v.api_key === 'string' && v.api_key !== '') conf.api_key = v.api_key;
      out[id] = conf;
    }
  }
  return out;
}

/**
 * @deprecated VL-315: переименовано в loadGateways. Алиас на переходный
 * период, чтобы не ломать импортёров сразу.
 */
export function loadProviders(cwd: string): Record<string, GatewayConfig> {
  return loadGateways(cwd);
}

/**
 * Читает секцию models (default + available).
 *
 * Нет секции/пустой available → { available: {} } (resolveActiveModel
 * решит, что models не настроен и уйдёт в env-fallback).
 *
 * VL-315: поле `gateway` читается с deprecated-алиасом `provider`, а
 * `@`-хвост имени модели разбирается в vendor + чистое имя (AC4).
 */
export function loadModels(cwd: string): ModelsConfig {
  const raw = loadSettings(cwd).models;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { available: {} };
  }
  const v = raw as Record<string, unknown>;
  const available: Record<string, ModelConfig> = {};
  const rawAvail = v.available;
  if (typeof rawAvail === 'object' && rawAvail !== null && !Array.isArray(rawAvail)) {
    for (const [id, m] of Object.entries(rawAvail as Record<string, unknown>)) {
      if (typeof m !== 'object' || m === null || Array.isArray(m)) continue;
      const mm = m as Record<string, unknown>;
      // gateway (новое имя) приоритетнее provider (deprecated, VL-315)
      const gateway =
        typeof mm.gateway === 'string' && mm.gateway !== ''
          ? mm.gateway
          : typeof mm.provider === 'string' && mm.provider !== ''
            ? mm.provider
            : '';
      if (gateway === '') continue;
      if (typeof mm.model !== 'string' || mm.model === '') continue;
      // Структурный vendor приоритетнее `@`-хвоста; хвост всё равно срезаем,
      // чтобы имя модели в wire-запросе было чистым (AC4/AC7)
      const parsed = parseVendorSuffix(mm.model);
      const explicitVendor =
        typeof mm.vendor === 'string' && mm.vendor !== '' ? mm.vendor : undefined;
      const conf: ModelConfig = { gateway, model: parsed.model };
      const vendor = explicitVendor ?? parsed.vendor;
      if (vendor !== undefined) conf.vendor = vendor;
      if (typeof mm.label === 'string' && mm.label !== '') conf.label = mm.label;
      if (typeof mm.description === 'string' && mm.description !== '') {
        conf.description = mm.description;
      }
      if (mm.api_mode === 'chat' || mm.api_mode === 'responses') conf.api_mode = mm.api_mode;
      if (typeof mm.pricing === 'object' && mm.pricing !== null && !Array.isArray(mm.pricing)) {
        const p = mm.pricing as Record<string, unknown>;
        const num = (x: unknown): number =>
          typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
        conf.pricing = {
          input_per_1m: num(p.input_per_1m),
          output_per_1m: num(p.output_per_1m),
          cache_per_1m: num(p.cache_per_1m),
        };
      }
      available[id] = conf;
    }
  }
  return {
    default: typeof v.default === 'string' && v.default !== '' ? v.default : undefined,
    available,
  };
}

/**
 * Собирает полный ActiveModel из записи available (VL-239: общий билдер).
 *
 * Вынесено из resolveModelById, чтобы резолв по паре gateway+wire-имя
 * (findModelByGatewayName) давал ровно тот же объект — расхождение билдеров
 * давало бы разные baseUrl/apiKey у «той же» модели.
 *
 * @returns null, если шлюз записи не найден в gateways
 */
function buildActiveModel(cwd: string, id: string, conf: ModelConfig): ActiveModel | null {
  const gateway = loadGateways(cwd)[conf.gateway];
  if (!gateway) return null;
  const apiKey =
    (gateway.api_key_env && process.env[gateway.api_key_env]) || gateway.api_key || '';
  return {
    id,
    label: conf.label ?? id,
    gatewayId: conf.gateway,
    ...(conf.vendor !== undefined ? { vendor: conf.vendor } : {}),
    model: conf.model,
    apiMode: conf.api_mode ?? 'chat',
    pricing: conf.pricing,
    baseUrl: gateway.base_url,
    apiKey,
    apiKeyEnv: gateway.api_key_env,
  };
}

/**
 * Резолвит модель по явному id (VL-209: переопределение в веб-чате).
 *
 * @returns null, если id отсутствует в available либо шлюз не найден;
 *   apiKey — env[api_key_env] → gateway.api_key → '' (как в resolveActiveModel)
 */
export function resolveModelById(cwd: string, id: string): ActiveModel | null {
  const models = loadModels(cwd);
  const conf = models.available[id];
  if (!conf) return null;
  return buildActiveModel(cwd, id, conf);
}

/**
 * Находит модель по паре gateway + wire-имя (VL-239, переименовано VL-315).
 *
 * Идентичность модели в мете сессии — именно пара gateway+model: id из
 * available пользователь может переименовать, а wire-имя у шлюза и ссылка
 * на шлюз остаются те же. Vendor в идентичность НЕ входит (риск R4 плана):
 * смена апстрима не должна ломать resume. Поэтому resume-ран сначала
 * пробует model_id, а при промахе — эту функцию.
 *
 * @param gatewayId — id шлюза в gateways (meta.model_gateway)
 * @param wireName — имя модели у шлюза (meta.model_name, поле `model`)
 * @returns ActiveModel (id — ключ available, найденный первым по порядку
 *   секции) либо null, если пары нет или шлюз удалён
 */
export function findModelByGatewayName(
  cwd: string,
  gatewayId: string,
  wireName: string,
): ActiveModel | null {
  if (!gatewayId || !wireName) return null;
  const models = loadModels(cwd);
  for (const [id, conf] of Object.entries(models.available)) {
    if (conf.gateway !== gatewayId || conf.model !== wireName) continue;
    const resolved = buildActiveModel(cwd, id, conf);
    if (resolved !== null) return resolved;
  }
  return null;
}

/**
 * @deprecated VL-315: переименовано в findModelByGatewayName. Алиас на
 * переходный период (старые импортёры и тесты).
 */
export function findModelByProviderName(
  cwd: string,
  providerId: string,
  wireName: string,
): ActiveModel | null {
  return findModelByGatewayName(cwd, providerId, wireName);
}

/**
 * Резолвит активную модель: models.default → available[id] → gateway.
 *
 * @param cwd — директория проекта (в branch-mode вызывающий передаёт
 *   VIBELOG_CWD ?? cwd — settings.json в главном репо, не в worktree)
 * @returns null, если models не настроен (fallback на env VIBELOG_LLM_*);
 *   иначе полный ActiveModel (даже с пустым apiKey — отсутствие ключа
 *   проверяет ensureLlmEnv с понятным текстом, здесь не валидируем)
 */
export function resolveActiveModel(cwd: string): ActiveModel | null {
  const models = loadModels(cwd);
  if (!models.default) return null;
  return resolveModelById(cwd, models.default);
}

/**
 * Валидация секций models/gateways перед стартом фазы (AC VL-209, VL-315).
 *
 * Тексты ошибок называют gateway/vendor (AC10). Битый vendor (неизвестный
 * апстрим) загрузку НЕ ломает: списка известных вендоров у нас нет, а
 * неверный апстрим отдаст понятную ошибку сам шлюз (проверено живым
 * запросом VL-315: 404 «No endpoints found matching your provider
 * preferences»). Поэтому vendor здесь не валидируется вовсе.
 *
 * @returns [] если models не настроен (валидировать нечего — env-fallback)
 *   либо конфиг валиден; иначе список понятных ошибок на русском
 */
export function validateModelsConfig(cwd: string): string[] {
  const settings = loadSettings(cwd);
  // Явно заданная, но пустая секция — тоже ошибка: пользователь хотел models
  const rawModels = settings.models;
  if (rawModels === undefined) return [];
  const models = loadModels(cwd);
  const errors: string[] = [];
  if (!models.default) {
    errors.push('settings.json: секция models задана, но models.default отсутствует');
    return errors;
  }
  const conf = models.available[models.default];
  if (!conf) {
    errors.push(
      `settings.json: модель default "${models.default}" отсутствует в models.available`
    );
    return errors;
  }
  const gateways = loadGateways(cwd);
  const gateway = gateways[conf.gateway];
  if (!gateway) {
    errors.push(
      `settings.json: шлюз "${conf.gateway}" модели "${models.default}" отсутствует в gateways`
    );
    return errors;
  }
  // base_url обязателен у шлюза (loadGateways отбрасывает шлюзы без него,
  // поэтому здесь — отдельная формулировка вместо «нет шлюза»)
  if ((settings.gateways !== undefined || settings.providers !== undefined) && !gateway.base_url) {
    errors.push(`settings.json: у шлюза "${conf.gateway}" не задан base_url`);
  }
  if (gateway.api_key_env && !process.env[gateway.api_key_env] && !gateway.api_key) {
    errors.push(
      `Переменная ${gateway.api_key_env} не задана (env / .env / env-секция settings.json) — ключ шлюза "${conf.gateway}" недоступен`
    );
  }
  return errors;
}
