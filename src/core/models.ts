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

import { loadSettings, saveSettingsPatch } from './settings.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  /**
   * Размер контекстного окна модели в токенах (VL-313, VL-316): знаменатель
   * для процента занятого контекста в панели веб-чата; приходит из каталога
   * шлюза и становится ручным полем только для моделей, добавленных руками.
   * Необязателен — у модели без поля панель показывает токены и рубли, но
   * БЕЗ процента (0% вводил бы в заблуждение: «контекст свободен» при
   * неизвестном окне).
   */
  context_window?: number;
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
  /** Размер контекстного окна (VL-313); undefined — неизвестен. */
  contextWindow?: number;
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
      // context_window (VL-313): терпимый парсинг, как у pricing — только
      // положительное конечное число; «1e6»-строка и мусор отбрасываются.
      if (
        typeof mm.context_window === 'number' &&
        Number.isFinite(mm.context_window) &&
        mm.context_window > 0
      ) {
        conf.context_window = Math.round(mm.context_window);
      }
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
    ...(conf.context_window !== undefined ? { contextWindow: conf.context_window } : {}),
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

/**
 * Вход записи модели из веб-интерфейса (VL-316): что приходит в
 * POST/PUT /api/models.
 *
 * Отдельный тип нужен, потому что запись в settings.json — структурная
 * (`gateway` + чистый `model` + `vendor`), а UI присылает ровно эти поля;
 * `id` вычисляется сервером (`<gateway>/<model>[/<vendor>]`).
 */
export interface ModelInput {
  /** Явный id (при редактировании — текущий ключ); undefined — вычислить. */
  id?: string;
  label?: string;
  description?: string;
  gateway: string;
  model: string;
  vendor?: string;
  api_mode?: ApiMode;
  pricing?: ModelPricing;
  context_window?: number;
}

/** Нормализует имя модели: срезает `@`-хвост, лишние слэши и пробелы. */
function cleanModelName(model: string): string {
  return parseVendorSuffix(model.trim()).model.replace(/^\/+|\/+$/g, '');
}

/**
 * Вычисляет id записи модели: `<gateway>/<model>` + `/@<vendor>` при наличии
 * вендора.
 *
 * Вендор входит в id, потому что у RouterAI разные вендоры одной модели —
 * это РАЗНЫЕ записи available (цены разные). Без вендора в id вторая запись
 * той же модели молча перезаписала бы первую.
 */
export function buildModelId(input: { gateway: string; model: string; vendor?: string }): string {
  const base = `${input.gateway}/${cleanModelName(input.model)}`;
  return input.vendor ? `${base}/@${input.vendor}` : base;
}

/**
 * Приводит запись модели к СТРУКТУРНОМУ виду для записи в settings.json
 * (AC11, ленивая миграция VL-315).
 *
 * Старый формат (`provider` + `@`-хвост в `model`) читается нормально, но
 * при первом сохранении из UI запись переписывается новой формой: `gateway`,
 * чистый `model`, отдельный `vendor`. Ключи с пустыми значениями не пишутся —
 * чтобы файл не заполнялся `""`.
 *
 * @returns объект для models.available[id]; порядок ключей фиксирован (label,
 *   description, gateway, vendor, model, api_mode, context_window, pricing)
 */
export function toStoredModel(input: ModelInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.label !== undefined && input.label !== '') out.label = input.label;
  if (input.description !== undefined && input.description !== '') out.description = input.description;
  out.gateway = input.gateway;
  if (input.vendor !== undefined && input.vendor !== '') out.vendor = input.vendor;
  out.model = cleanModelName(input.model);
  if (input.api_mode !== undefined) out.api_mode = input.api_mode;
  if (
    input.context_window !== undefined &&
    Number.isFinite(input.context_window) &&
    input.context_window > 0
  ) {
    out.context_window = Math.floor(input.context_window);
  }
  if (input.pricing !== undefined) {
    out.pricing = {
      input_per_1m: input.pricing.input_per_1m,
      output_per_1m: input.pricing.output_per_1m,
      cache_per_1m: input.pricing.cache_per_1m,
    };
  }
  return out;
}

/**
 * Валидирует запись модели ДО записи в файл (AC12; риск R4 плана —
 * дублирования правил: здесь только то, чего не может проверить
 * `validateModelsConfig`: она валидирует толькo активную модель).
 *
 * @param models — текущая секция (для проверки дубля id)
 * @param gateways — известные шлюзы
 * @param input — приходящая запись
 * @param opts.excludeId — id, который разрешено «занять» (редактирование себя)
 * @param opts.keepId — не пересчитывать id из полей (обновление тарифа:
 *   id модели менять нельзя, на него ссылаются models.default и меты сессий)
 * @returns { id } с вычисленным id либо { error } с понятным текстом (400)
 */
export function validateModelInput(
  models: ModelsConfig,
  gateways: Record<string, GatewayConfig>,
  input: ModelInput,
  opts: { excludeId?: string; keepId?: boolean } = {},
): { id: string } | { error: string } {
  if (typeof input.gateway !== 'string' || input.gateway === '') {
    return { error: 'gateway: ожидается id шлюза из секции gateways' };
  }
  if (!gateways[input.gateway]) {
    return { error: `Неизвестный шлюз: ${input.gateway} — отсутствует в settings.gateways` };
  }
  const model = cleanModelName(typeof input.model === 'string' ? input.model : '');
  if (model === '') return { error: 'model: имя модели не может быть пустым' };
  // Структурная запись не знает `@`-хвоста (VL-315): если он остался после
  // разбора, значит в поле ввели мусор — лучше 400, чем запись с хвостом
  if (model.includes('@')) {
    return { error: 'model: имя модели не должно содержать «@» — вендор задаётся полем vendor' };
  }
  if (input.vendor !== undefined && typeof input.vendor !== 'string') {
    return { error: 'vendor: ожидается строка id вендора' };
  }
  if (input.api_mode !== undefined && input.api_mode !== 'chat' && input.api_mode !== 'responses') {
    return { error: 'api_mode: допустимые значения — chat или responses' };
  }
  if (input.pricing !== undefined) {
    for (const key of ['input_per_1m', 'output_per_1m', 'cache_per_1m'] as const) {
      const value = input.pricing[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return { error: `pricing.${key}: ожидается неотрицательное число` };
      }
    }
  }
  if (
    input.context_window !== undefined &&
    (typeof input.context_window !== 'number' ||
      !Number.isFinite(input.context_window) ||
      input.context_window <= 0)
  ) {
    return { error: 'context_window: ожидается положительное число токенов' };
  }
  // id ВСЕГДА вычисляется из gateway/model/vendor: при редактировании смена
  // вендора меняет и id (разные вендоры — разные записи available), поэтому
  // брать id из тела нельзя — запись осталась бы под старым ключом.
  // Исключение — keepId (обновление тарифа, AC16): id не должен меняться,
  // иначе models.default и меты сессий (VL-239) указывали бы в пустоту.
  const id = opts.keepId && input.id !== undefined && input.id !== ''
    ? input.id
    : buildModelId({ gateway: input.gateway, model, vendor: input.vendor });
  if (id.trim() === '') return { error: 'id: пустой идентификатор модели' };
  if (id !== opts.excludeId && models.available[id]) {
    return { error: `Модель "${id}" уже есть в models.available — выберите другой id или отредактируйте её` };
  }
  return { id };
}

/**
 * Проверяет, можно ли удалить модель (AC10; риск R3 плана).
 *
 * Модель фиксируется в мете сессий агента (`model_id`/`model_gateway` +
 * `model_name`, VL-239) и может быть выбрана по умолчанию; удаление такой
 * записи ломает резюм активной работы — поэтому проверка ДО удаления, а не
 * после.
 *
 * @param cwd — директория проекта
 * @param id — удаляемый id модели
 * @param opts.sessionMetaReader — инжекция читателя мет (тесты)
 * @returns null, если удалять можно; иначе текст причины (400)
 */
export function checkModelRemovable(
  cwd: string,
  id: string,
  opts: { sessionMetaReader?: (cwd: string) => SessionModelRef[] } = {},
): string | null {
  const models = loadModels(cwd);
  if (!models.available[id]) return `Модель "${id}" отсутствует в models.available`;
  if (models.default === id) {
    return `Модель "${id}" — models.default: сначала выберите другую модель по умолчанию`;
  }
  const reader = opts.sessionMetaReader ?? readSessionModelRefs;
  for (const ref of reader(cwd)) {
    if (ref.modelId === id) {
      return `Модель "${id}" закреплена за сессией агента ${ref.sessionId} (${ref.taskId ?? 'без задачи'}): удаление сломает resume. Дождитесь завершения задачи или создайте новую сессию`;
    }
  }
  const conf = models.available[id];
  // Смена id при редактировании — тот же риск: сессия ищет модель по паре
  // gateway+wire-имя, если id переименован. Удаление пары задевает её.
  for (const ref of reader(cwd)) {
    if (ref.gateway === conf.gateway && ref.modelName === conf.model) {
      return `Модель "${id}" (${conf.gateway}/${conf.model}) закреплена за сессией агента ${ref.sessionId} (${ref.taskId ?? 'без задачи'}): удаление сломает resume`;
    }
  }
  return null;
}

/** Ссылка меты сессии агента на модель (VL-239) — для проверки удаления. */
export interface SessionModelRef {
  sessionId: string;
  taskId?: string;
  modelId?: string;
  gateway?: string;
  modelName?: string;
}

/**
 * Читает меты сессий агента и собирает ссылки на модели.
 *
 * Читает `<cwd>/.vibelog/agent-sessions/*.meta.json`; битые меты и записи
 * без ссылки на модель пропускаются (паттерн loadSettings — диагностические
 * данные не должны ронять страницу).
 */
export function readSessionModelRefs(cwd: string): SessionModelRef[] {
  const dir = join(cwd, '.vibelog', 'agent-sessions');
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SessionModelRef[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const sessionId = entry.slice(0, -'.meta.json'.length);
    let meta: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, entry), 'utf-8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      meta = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const ref: SessionModelRef = { sessionId };
    if (typeof meta.taskId === 'string' && meta.taskId !== '') ref.taskId = meta.taskId;
    if (typeof meta.model_id === 'string' && meta.model_id !== '') ref.modelId = meta.model_id;
    const gateway = typeof meta.model_gateway === 'string' ? meta.model_gateway : meta.model_provider;
    if (typeof gateway === 'string' && gateway !== '') ref.gateway = gateway;
    if (typeof meta.model_name === 'string' && meta.model_name !== '') ref.modelName = meta.model_name;
    // Запись без идентичности модели (старые/интерактивные сессии) не интересна
    if (ref.modelId === undefined && ref.gateway === undefined) continue;
    out.push(ref);
  }
  return out;
}

/**
 * Read-modify-write секции models: добавляет/заменяет одну запись.
 *
 * Пишет ТОЛЬКО новый ключ `gateways`-эпохи (структурный `gateway`/`vendor`),
 * остальные ключи settings.json сохраняются как есть. Старые записи
 * available при этом остаются в файле как есть до собственного сохранения
 * (ленивая миграция: трогаем только то, что пользователь отредактировал).
 */
export function upsertModel(cwd: string, id: string, input: ModelInput): void {
  const settings = loadSettings(cwd);
  const rawModels =
    typeof settings.models === 'object' && settings.models !== null && !Array.isArray(settings.models)
      ? (settings.models as Record<string, unknown>)
      : {};
  const rawAvailable =
    typeof rawModels.available === 'object' && rawModels.available !== null && !Array.isArray(rawModels.available)
      ? (rawModels.available as Record<string, unknown>)
      : {};
  const nextAvailable: Record<string, unknown> = { ...rawAvailable, [id]: toStoredModel(input) };
  const nextModels: Record<string, unknown> = { ...rawModels, available: nextAvailable };
  if (typeof rawModels.default === 'string' && rawModels.default !== '') {
    // Смена id при редактировании: default должен продолжать указывать на модель
    if (input.id !== undefined && input.id !== id && rawModels.default === input.id) {
      nextModels.default = id;
    }
  }
  saveSettingsPatch(cwd, { models: nextModels });
}

/**
 * Удаляет запись модели из models.available (проверку делает вызывающий —
 * checkModelRemovable: здесь только механика read-modify-write).
 */
export function removeModel(cwd: string, id: string): void {
  const settings = loadSettings(cwd);
  const rawModels =
    typeof settings.models === 'object' && settings.models !== null && !Array.isArray(settings.models)
      ? (settings.models as Record<string, unknown>)
      : {};
  const rawAvailable =
    typeof rawModels.available === 'object' && rawModels.available !== null && !Array.isArray(rawModels.available)
      ? (rawModels.available as Record<string, unknown>)
      : {};
  const nextAvailable = { ...rawAvailable };
  delete nextAvailable[id];
  saveSettingsPatch(cwd, { models: { ...rawModels, available: nextAvailable } });
}
