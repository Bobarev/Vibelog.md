/**
 * Реестр LLM-провайдеров и моделей в .vibelog/settings.json (VL-209).
 *
 * Раньше модель задавалась одной строкой VIBELOG_LLM_MODEL (env) или
 * settings.api_mode — переключение требовало правки .env. Теперь в
 * settings.json живут две секции:
 *
 * - `providers`: id → { base_url, api_key_env | api_key } — URL провайдера
 *   и ИМЯ переменной окружения с ключом (не сам ключ!): ключ читается из
 *   env → .env → env-секции settings.json (приоритет VL-143 — сюда он
 *   попадает через loadProjectEnv ДО вызова resolveActiveModel);
 * - `models`: { default, available: { <id>: { label, provider, model,
 *   api_mode, pricing } } } — id строки вида provider/model (как в
 *   OpenCode/Mastra), provider — ссылка на providers[<id>].
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

/** Провайдер LLM: URL и способ получить API-ключ. */
export interface ProviderConfig {
  /** Базовый URL провайдера (без хвостовых слэшей — их срезает createLlmClient). */
  base_url: string;
  /** Имя переменной окружения с ключом (приоритетный источник, VL-143). */
  api_key_env?: string;
  /** Прямой ключ — fallback для не-секретных случаев (не рекомендуется). */
  api_key?: string;
}

/** Одна модель в available. */
export interface ModelConfig {
  /** Человекочитаемая подпись для CLI/бота/веба. */
  label?: string;
  /**
   * Короткое описание модели для пикеров веб-чата (VL-265): вторая строка
   * в дропдауне выбора модели. Необязательно — пикер рендерит только label.
   */
  description?: string;
  /** Ссылка на providers[<id>]. */
  provider: string;
  /** Имя модели у провайдера (после base_url, напр. "xiaomi/mimo-v2.6-pro"). */
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
  /** id из available (внешний идентификатор, "provider/model"). */
  id: string;
  /** label или id, если label не задан (в лог фазы и списки). */
  label: string;
  /** id провайдера в providers. */
  providerId: string;
  /** Имя модели у провайдера (что уходит в поле model wire-запроса). */
  model: string;
  /** Режим API модели. */
  apiMode: ApiMode;
  /** Тарифы модели (для billing; undefined — тариф не задан). */
  pricing?: ModelPricing;
  /** Базовый URL провайдера. */
  baseUrl: string;
  /** API-ключ: env[api_key_env] → provider.api_key → ''. */
  apiKey: string;
  /** Имя env-переменной ключа (для текстов ошибок валидации). */
  apiKeyEnv?: string;
}

/**
 * Читает секцию providers.
 *
 * Битые значения (не строковый base_url, не объект) отбрасываются по
 * ключу — мусор в одном провайдере не должен ломать остальные.
 */
export function loadProviders(cwd: string): Record<string, ProviderConfig> {
  const raw = loadSettings(cwd).providers;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ProviderConfig> = {};
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    if (typeof v.base_url !== 'string' || v.base_url === '') continue;
    const conf: ProviderConfig = { base_url: v.base_url };
    if (typeof v.api_key_env === 'string' && v.api_key_env !== '') conf.api_key_env = v.api_key_env;
    if (typeof v.api_key === 'string' && v.api_key !== '') conf.api_key = v.api_key;
    out[id] = conf;
  }
  return out;
}

/**
 * Читает секцию models (default + available).
 *
 * Нет секции/пустой available → { available: {} } (resolveActiveModel
 * решит, что models не настроен и уйдёт в env-fallback).
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
      // provider и model — обязательные ссылки/имена; без них запись мертва
      if (typeof mm.provider !== 'string' || mm.provider === '') continue;
      if (typeof mm.model !== 'string' || mm.model === '') continue;
      const conf: ModelConfig = { provider: mm.provider, model: mm.model };
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
 * Резолвит модель по явному id (VL-209: переопределение в веб-чате).
 *
 * @returns null, если id отсутствует в available либо провайдер не найден;
 *   apiKey — env[api_key_env] → provider.api_key → '' (как в resolveActiveModel)
 */
export function resolveModelById(cwd: string, id: string): ActiveModel | null {
  const models = loadModels(cwd);
  const conf = models.available[id];
  if (!conf) return null;
  const provider = loadProviders(cwd)[conf.provider];
  if (!provider) return null;
  const apiKey =
    (provider.api_key_env && process.env[provider.api_key_env]) || provider.api_key || '';
  return {
    id,
    label: conf.label ?? id,
    providerId: conf.provider,
    model: conf.model,
    apiMode: conf.api_mode ?? 'chat',
    pricing: conf.pricing,
    baseUrl: provider.base_url,
    apiKey,
    apiKeyEnv: provider.api_key_env,
  };
}

/**
 * Резолвит активную модель: models.default → available[id] → provider.
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
 * Валидация секций models/providers перед стартом фазы (AC VL-209).
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
  const providers = loadProviders(cwd);
  const provider = providers[conf.provider];
  if (!provider) {
    errors.push(
      `settings.json: провайдер "${conf.provider}" модели "${models.default}" отсутствует в providers`
    );
    return errors;
  }
  // base_url обязателен у провайдера (loadProviders отбрасывает провайдеры
  // без него, поэтому здесь — отдельная формулировка вместо «нет провайдера»)
  if (settings.providers !== undefined && !provider.base_url) {
    errors.push(
      `settings.json: у провайдера "${conf.provider}" не задан base_url`
    );
  }
  if (provider.api_key_env && !process.env[provider.api_key_env] && !provider.api_key) {
    errors.push(
      `Переменная ${provider.api_key_env} не задана (env / .env / env-секция settings.json) — ключ провайдера "${conf.provider}" недоступен`
    );
  }
  return errors;
}
