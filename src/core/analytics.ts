/**
 * Аналитика токенов (VL-198): расчёт стоимости по тарифам и хелперы
 * агрегации Usage.
 *
 * Три уровня хранения учёта токенов (VL-198):
 * 1. `<sessionId>.meta.json` — мета сессии (usage/model/agent);
 * 2. frontmatter задачи `token_usage` — агрегат по фазам;
 * 3. `.vibelog/billing/<taskId>.json` — append-only источник правды.
 *
 * Деньги НЕ хранятся в задаче (тариф меняется — см. описание VL-198):
 * стоимость считается на лету calculateCost(usage, pricing), тарифы —
 * pricing активной модели из секции `models.available` .vibelog/settings.json
 * (VL-209, см. getActiveModelPricing); fallback — legacy-секция `pricing`:
 * `{ "model-name": { input_per_1m, output_per_1m, cache_per_1m } }`.
 */

import { loadSettings } from './settings.js';
import { resolveActiveModel, resolveModelById } from './models.js';

/**
 * Агрегат использования токенов (формат frontmatter/billing/meta, VL-198).
 *
 * Отличается от LlmUsage агента (input_tokens/…): здесь человекочитаемые
 * имена из описания задачи — они живут в YAML/JSON долгожителей.
 * `reasoning` — отдельно (из completion_tokens_details.reasoning_tokens,
 * ref-19): для аналитики, НЕ для вычитания из output.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cache: number;
  total: number;
  requests: number;
  /** Reasoning-токены (отдельное поле, не вычитаются из output). */
  reasoning?: number;
}

/** Тариф модели: цена за 1M токенов (секция pricing settings.json). */
export interface ModelPricing {
  input_per_1m: number;
  output_per_1m: number;
  cache_per_1m: number;
}

/** Секция pricing settings.json: модель → тариф. */
export type PricingMap = Record<string, ModelPricing>;

/** Стоимость по тарифам (для аналитики; в задачу не пишется). */
export interface CostBreakdown {
  input: number;
  output: number;
  cache: number;
  total: number;
}

/** Нулевой usage (все счётчики — 0). */
export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cache: 0, total: 0, requests: 0 };
}

/** Сумма usage двух записей (мутирует target — паттерн addUsage из llm.ts). */
export function addUsage(target: TokenUsage, add: Partial<TokenUsage>): void {
  target.input += add.input ?? 0;
  target.output += add.output ?? 0;
  target.cache += add.cache ?? 0;
  target.total += add.total ?? 0;
  target.requests += add.requests ?? 0;
  if (add.reasoning !== undefined) {
    target.reasoning = (target.reasoning ?? 0) + add.reasoning;
  }
}

/**
 * Постэлементная дельта `current − base` с ограничением снизу нулём:
 * записи в разных источниках могут временно расходиться (дельта никогда
 * не «уводит» агрегат в минус — иначе повторный вызов finish_phase
 * вместо дозаписи вычтёт уже записанные токены).
 */
export function usageDelta(base: Partial<TokenUsage>, current: TokenUsage): TokenUsage {
  const d: TokenUsage = {
    input: Math.max(0, current.input - (base.input ?? 0)),
    output: Math.max(0, current.output - (base.output ?? 0)),
    cache: Math.max(0, current.cache - (base.cache ?? 0)),
    total: Math.max(0, current.total - (base.total ?? 0)),
    requests: Math.max(0, current.requests - (base.requests ?? 0)),
  };
  if (current.reasoning !== undefined || base.reasoning !== undefined) {
    d.reasoning = Math.max(0, (current.reasoning ?? 0) - (base.reasoning ?? 0));
  }
  return d;
}

/** Дельта ненулевая — есть что дозаписывать в frontmatter. */
export function hasUsageDelta(d: Partial<TokenUsage>): boolean {
  return (
    (d.input ?? 0) > 0 || (d.output ?? 0) > 0 || (d.cache ?? 0) > 0 ||
    (d.total ?? 0) > 0 || (d.requests ?? 0) > 0
  );
}

/**
 * Стоимость использования по тарифу модели.
 *
 * Токены переводятся в миллионы (тариф задан как *_per_1m); модель без
 * тарифа в pricing → нулевая стоимость (не ошибка: тариф может отсутствовать).
 * Кэш считается отдельной ставкой (cache_per_1m).
 *
 * @param usage — агрегат токенов
 * @param pricing — тарифы модели (undefined → нули)
 */
export function calculateCost(usage: Partial<TokenUsage>, pricing?: ModelPricing): CostBreakdown {
  if (!pricing) return { input: 0, output: 0, cache: 0, total: 0 };
  const input = (usage.input ?? 0) / 1e6 * pricing.input_per_1m;
  const output = (usage.output ?? 0) / 1e6 * pricing.output_per_1m;
  const cache = (usage.cache ?? 0) / 1e6 * pricing.cache_per_1m;
  const round = (n: number): number => Math.round(n * 1e6) / 1e6;
  const rInput = round(input);
  const rOutput = round(output);
  const rCache = round(cache);
  return { input: rInput, output: rOutput, cache: rCache, total: round(rInput + rOutput + rCache) };
}

/**
 * Тарифы из settings.json (секция `pricing`).
 *
 * Невалидные значения (не объект, не числа) отбрасываются по модели —
 * битый тариф не должен ронять аналитику (паттерн loadSettings).
 */
export function getPricing(cwd: string): PricingMap {
  const raw = loadSettings(cwd).pricing;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: PricingMap = {};
  for (const [model, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
    out[model] = {
      input_per_1m: num(v.input_per_1m),
      output_per_1m: num(v.output_per_1m),
      cache_per_1m: num(v.cache_per_1m),
    };
  }
  return out;
}

/**
 * Тарифы активной LLM-модели (VL-209: pricing теперь внутри модели).
 *
 * Источники по приоритету:
 * 1. models.available[models.default].pricing (.vibelog/settings.json);
 * 2. legacy-секция `pricing` (модель → тариф) по имени активной модели —
 *    конфиги, созданные до VL-209, продолжают работать;
 * 3. undefined — тариф не найден (calculateCost вернёт нули, не ошибка).
 *
 * @param cwd — директория проекта settings.json
 */
export function getActiveModelPricing(cwd: string): ModelPricing | undefined {
  const active = resolveActiveModel(cwd);
  if (active !== null && active.pricing) return active.pricing;
  // Активная модель неизвестна (env-fallback) либо у неё нет pricing —
  // ищем в legacy-секции по wire-имени модели
  const modelName = active?.model ?? process.env.VIBELOG_LLM_MODEL;
  if (!modelName) return undefined;
  return getPricing(cwd)[modelName];
}

/**
 * Тариф КОНКРЕТНОЙ модели по её id из `models.available` (VL-313).
 *
 * Панель токенов веб-чата считает деньги по тарифу той модели, которой
 * реально шёл тред: после смены модели в пикере прошлые ходы не должны
 * посчитаться по чужому тарифу (getActiveModelPricing смотрит на
 * `models.default`). Fallback — legacy-секция `pricing` по wire-имени.
 *
 * @param cwd — директория проекта settings.json
 * @param modelId — id из models.available; undefined/null — активная модель
 * @returns undefined, если ни модель, ни её тариф не найдены (расчёт даст 0)
 */
export function pricingForModelId(cwd: string, modelId?: string | null): ModelPricing | undefined {
  if (!modelId) return getActiveModelPricing(cwd);
  const active = resolveModelById(cwd, modelId);
  if (active === null) return undefined;
  if (active.pricing) return active.pricing;
  // Тариф в записи модели не задан — legacy-секция по wire-имени (паттерн
  // getActiveModelPricing: конфиги до VL-209 продолжают работать).
  return getPricing(cwd)[active.model];
}

/**
 * Тариф модели по её id из `models.available` (VL-299, doc-21 §11).
 *
 * Нужен экспериментам: стоимость считается по модели ВАРИАНТА, а не по
 * активной модели проекта (`getActiveModelPricing` резолвит только активную).
 * Отличие от {@link pricingForModelId}: id обязателен — пустой id не должен
 * молча превращаться в «активную модель» (вариант без `model` не имеет
 * тарифа, и cost у него `null`, а не стоимость чужой модели).
 *
 * @param cwd — директория проекта settings.json
 * @param modelId — id из models.available
 * @returns тариф либо undefined (модель не найдена / тарифа нет) — вызывающий
 *   обязан записать `cost: null`, а не 0 (doc-21 §11: ноль = «бесплатно»)
 */
export function getModelPricingById(cwd: string, modelId: string): ModelPricing | undefined {
  const id = String(modelId ?? '').trim();
  if (!id) return undefined;
  return pricingForModelId(cwd, id);
}

/**
 * Строки секции «Токены» для карточки задачи (общий билдер для бота и CLI,
 * lesson-37: дублирующийся рендер бота и веба выносим в общий модуль).
 *
 * Возвращает [] при пустом/отсутствующем usage — вызывающий не показывает
 * секцию вовсе. Формат чисел — без локалей (детерминированные тесты).
 *
 * @param usage — агрегат token_usage задачи
 * @param durationMs — суммарная длительность (мс) для строки duration
 */
export function formatTokenUsageLines(usage?: Partial<TokenUsage>, durationMs?: number): string[] {
  if (!usage) return [];
  const total = usage.total ?? 0;
  if (
    total === 0 &&
    (usage.input ?? 0) === 0 &&
    (usage.output ?? 0) === 0 &&
    (usage.requests ?? 0) === 0
  ) {
    return [];
  }
  const lines = [
    `input=${usage.input ?? 0} output=${usage.output ?? 0} cache=${usage.cache ?? 0} total=${total} requests=${usage.requests ?? 0}`,
  ];
  if (durationMs !== undefined && durationMs > 0) {
    lines.push(`duration=${Math.round(durationMs / 1000)}с`);
  }
  return lines;
}
