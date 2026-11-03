/**
 * Сверка цены вендора с каталогом и поведение при дрейфе (VL-317, шаг 3/3).
 *
 * Зачем: шлюз отдаёт одну модель через разных вендоров, и цены у вендоров
 * меняются в течение дня. Тарифы в `.vibelog/settings.json` вписаны руками в
 * какой-то момент времени — если вендор поднял цену, узнаём об этом по счёту.
 * Каталог (`provider-catalog.ts`, VL-316) уже умеет отдавать цены каждого
 * вендора по паре `(gateway, model, vendor)`; здесь — сверка и РЕШЕНИЕ, что
 * делать при расхождении.
 *
 * Ключевые решения (согласованы с Pavel):
 * - сверка идёт по ПАРЕ `(gateway, model, vendor)`, а не по «цене модели
 *   вообще» (риск R1 плана: у одной модели цены у makora и Xiaomi разные —
 *   сверка по модели давала бы ложные срабатывания);
 * - `on_drift` по умолчанию `'ask'`: молчаливое продолжение по выросшей цене
 *   недопустимо;
 * - `'auto'` без альтернативного вендора ДЕГРАДИРУЕТ в `'ask'` по той же
 *   причине;
 * - снижение цены — информационное предупреждение, не остановка (AC13);
 * - нулевой тариф не делит на ноль (риск R5): «оба нуля → дрейфа нет»,
 *   «было 0 → стало >0» — отдельный случай (бесконечный рост).
 *
 * Модуль намеренно чистый (без чата, LLM и HTTP): вызывающие — `web/chat.ts`
 * (перед ходом), `web/orchestrator.ts` (перед фазой) и `web/api.ts`
 * (эндпоинты диагностики/принятия). Чтение секции — терпимое, паттерн
 * `resolveChatLimits` (lesson-117): битое значение → дефолт + сообщение,
 * но никогда падение.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSettings, saveSettingsPatch } from './settings.js';
import { resolveActiveModel, resolveModelById } from './models.js';
import { listCatalogVendors, readCachedVendors } from './provider-catalog.js';
import type { ModelPricing } from './analytics.js';

/** Поведение при дрейфе цены (AC1). */
export type DriftPolicy = 'ask' | 'auto' | 'warn';

/** Поведение при недоступном каталоге (AC10). */
export type OfflinePolicy = 'allow' | 'block';

/** Разрешённая конфигурация сверки. */
export interface PricingGuardConfig {
  /** Сверка включена (дефолт true). */
  enabled: boolean;
  /** Порог дрейфа в процентах (дефолт 10). */
  thresholdPercent: number;
  /** Что делать при дрейфе (дефолт 'ask'). */
  onDrift: DriftPolicy;
  /** Свой TTL сверки, минуты (дефолт 15) — защита от сети на каждом ходу. */
  catalogTtlMinutes: number;
  /** Недоступный каталог: 'allow' — работаем без сверки, 'block' — отказ. */
  offline: OfflinePolicy;
}

/**
 * Дефолты (AC1). TTL 15 минут — не меньше нижней границы из риска R3 плана:
 * иначе сверка превратилась бы в лишний сетевой запрос перед каждым
 * сообщением чата.
 */
export const PRICING_GUARD_DEFAULT: PricingGuardConfig = {
  enabled: true,
  thresholdPercent: 10,
  onDrift: 'ask',
  catalogTtlMinutes: 15,
  offline: 'allow',
};

/** Потолки значений: битый/ошибочный конфиг не должен ломать сверку. */
export const PRICING_GUARD_CEILING = {
  /** Порог: 0 — «любое расхождение», 1000 — «никогда» на практике. */
  thresholdPercent: 1000,
  /** TTL: сутки — верхняя граница осмысленного кэша цен. */
  catalogTtlMinutes: 1440,
} as const;

/** Ключи секции `pricing_guard` (единый список для чтения/записи/валидации). */
export const PRICING_GUARD_KEYS = [
  'enabled',
  'threshold_percent',
  'on_drift',
  'catalog_ttl_minutes',
  'offline',
] as const;

/** Результат чтения секции: значения + понятные проблемы конфига. */
export interface PricingGuardResolution {
  config: PricingGuardConfig;
  /** Сообщения о мусорных значениях (откат к дефолту уже сделан). */
  errors: string[];
}

/** Число в диапазоне min..max либо null (мусор — вызывающий берёт дефолт). */
function readNumber(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return raw >= min && raw <= max ? raw : null;
}

/**
 * Конфигурация сверки из `.vibelog/settings.json` (секция `pricing_guard`).
 *
 * Отсутствие секции/ключа — дефолт БЕЗ ошибки (нормальная конфигурация).
 * Присутствующий, но невалидный ключ — дефолт + запись в `errors` (AC2).
 *
 * @param cwd — каталог проекта (там же, где backlog/ и .vibelog/)
 */
export function resolvePricingGuard(cwd: string): PricingGuardResolution {
  const errors: string[] = [];
  const config: PricingGuardConfig = { ...PRICING_GUARD_DEFAULT };
  const raw = loadSettings(cwd).pricing_guard;
  if (raw === undefined || raw === null) return { config, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(
      `pricing_guard: ожидается объект с ключами ${PRICING_GUARD_KEYS.join(', ')} — взяты дефолты`,
    );
    return { config, errors };
  }
  const section = raw as Record<string, unknown>;

  if (section.enabled !== undefined) {
    if (typeof section.enabled === 'boolean') config.enabled = section.enabled;
    else {
      errors.push(
        `pricing_guard.enabled: ожидается boolean, получено ${JSON.stringify(section.enabled)} — взято ${PRICING_GUARD_DEFAULT.enabled}`,
      );
    }
  }

  const threshold = readNumber(section.threshold_percent, 0, PRICING_GUARD_CEILING.thresholdPercent);
  if (threshold !== null) config.thresholdPercent = threshold;
  else if (section.threshold_percent !== undefined) {
    errors.push(
      `pricing_guard.threshold_percent: ожидается число 0..${PRICING_GUARD_CEILING.thresholdPercent}, получено ${JSON.stringify(section.threshold_percent)} — взято ${PRICING_GUARD_DEFAULT.thresholdPercent}`,
    );
  }

  if (section.on_drift !== undefined) {
    if (section.on_drift === 'ask' || section.on_drift === 'auto' || section.on_drift === 'warn') {
      config.onDrift = section.on_drift;
    } else {
      errors.push(
        `pricing_guard.on_drift: ожидается 'ask' | 'auto' | 'warn', получено ${JSON.stringify(section.on_drift)} — взято '${PRICING_GUARD_DEFAULT.onDrift}'`,
      );
    }
  }

  const ttl = readNumber(section.catalog_ttl_minutes, 0, PRICING_GUARD_CEILING.catalogTtlMinutes);
  if (ttl !== null) config.catalogTtlMinutes = ttl;
  else if (section.catalog_ttl_minutes !== undefined) {
    errors.push(
      `pricing_guard.catalog_ttl_minutes: ожидается число 0..${PRICING_GUARD_CEILING.catalogTtlMinutes}, получено ${JSON.stringify(section.catalog_ttl_minutes)} — взято ${PRICING_GUARD_DEFAULT.catalogTtlMinutes}`,
    );
  }

  if (section.offline !== undefined) {
    if (section.offline === 'allow' || section.offline === 'block') config.offline = section.offline;
    else {
      errors.push(
        `pricing_guard.offline: ожидается 'allow' | 'block', получено ${JSON.stringify(section.offline)} — взято '${PRICING_GUARD_DEFAULT.offline}'`,
      );
    }
  }

  return { config, errors };
}

/** Одна строка предупреждения о мусорной секции (для лога сервера/фазы). */
export function formatPricingGuardErrors(errors: readonly string[]): string {
  if (errors.length === 0) return '';
  return `[vibelog-pricing] некорректная секция pricing_guard в .vibelog/settings.json (взяты дефолты): ${errors.join('; ')}`;
}

/** Компонента тарифа в результате сверки: было (settings) → стало (каталог). */
export interface DriftComponent {
  /** Имя компоненты: input / output / cache (AC4). */
  name: 'input' | 'output' | 'cache';
  /** Цена в settings.json, ₽/1M. */
  was: number;
  /** Цена в каталоге у того же вендора, ₽/1M. */
  now: number;
  /**
   * Отклонение в процентах: положительное — подорожало. `Infinity` — было 0,
   * стало >0 (деления на ноль нет, риск R5).
   */
  deltaPercent: number;
}

/** Состояние сверки. */
export type DriftState = 'ok' | 'drift' | 'unknown';

/** Альтернативный вендор — кандидат на переезд (AC5/AC6). */
export interface DriftAlternative {
  vendor: string;
  pricing: ModelPricing;
  /** Максимальное |отклонение| от текущего тарифа, проценты. */
  maxDeltaPercent: number;
}

/** Результат сверки цены. */
export interface PricingDriftResult {
  state: DriftState;
  /** id модели из models.available. */
  modelId?: string;
  gateway?: string;
  vendor?: string;
  components: DriftComponent[];
  /** Максимальное |отклонение| по компонентам (0 — дрейфа нет). */
  maxDeltaPercent: number;
  /** Направление дрейфа (по компоненте с максимальным отклонением). */
  direction?: 'increased' | 'decreased';
  /** Альтернативный вендор (только при дрейфе и наличии кандидата). */
  alternative?: DriftAlternative;
  /** Причина состояния unknown (нет тарифа, каталог недоступен и т.п.). */
  reason?: string;
  /** Каталог ответил из кэша VL-316 (данные могут быть протухшими). */
  stale?: boolean;
  /** Каталог недоступен: вызывающий смотрит на config.offline (AC10). */
  offline?: boolean;
  /** Сверка не выполнялась: выключена или уже принята пользователем. */
  skipped?: 'disabled' | 'accepted';
  /** Момент сверки (ISO). */
  checkedAt: string;
}

/**
 * Отклонение цены в процентах: `(now - was) / was * 100`.
 *
 * Нулевой тариф — отдельный случай (риск R5, AC14):
 * - оба нуля → 0 (бесплатный кэш у обоих — это НЕ дрейф);
 * - было 0, стало >0 → `Infinity` (рост с нуля бесконечен, но делить нельзя);
 * - было 0, стало <0 — невозможно (цены неотрицательны), возвращаем 0.
 */
export function driftPercent(was: number, now: number): number {
  if (was === 0) return now === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((now - was) / was) * 100;
}

/** Округление процента до десятых (стабильные тексты и пороги). */
function roundTenths(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 10) / 10;
}

/** Сравнивает тариф settings с тарифом конкретного вендора по компонентам. */
function compareComponents(
  was: ModelPricing,
  now: ModelPricing,
): { components: DriftComponent[]; maxDeltaPercent: number; direction?: 'increased' | 'decreased' } {
  const pairs: Array<[DriftComponent['name'], number, number]> = [
    ['input', was.input_per_1m, now.input_per_1m],
    ['output', was.output_per_1m, now.output_per_1m],
    ['cache', was.cache_per_1m, now.cache_per_1m],
  ];
  const components: DriftComponent[] = [];
  let maxDeltaPercent = 0;
  for (const [name, wasValue, nowValue] of pairs) {
    const deltaPercent = roundTenths(driftPercent(wasValue, nowValue));
    components.push({ name, was: wasValue, now: nowValue, deltaPercent });
    // Сравниваем по модулю: снижение цены тоже отклонение (AC13)
    const magnitude = Math.abs(deltaPercent);
    if (magnitude > Math.abs(maxDeltaPercent)) maxDeltaPercent = deltaPercent;
  }
  const direction =
    maxDeltaPercent > 0 ? 'increased' : maxDeltaPercent < 0 ? 'decreased' : undefined;
  return { components, maxDeltaPercent, ...(direction !== undefined ? { direction } : {}) };
}

/** Суммарная цена компонент, которые реально оплачиваются (input + output). */
function totalPricing(pricing: ModelPricing): number {
  return pricing.input_per_1m + pricing.output_per_1m;
}

/**
 * Выбирает лучшего альтернативного вендора (AC6).
 *
 * Приоритет: сначала вендор, чья цена совпадает с текущим тарифом в пределах
 * порога (переезд на него не меняет ожидаемую стоимость), из них — самый
 * дешёвый по input+output. Нет таких — самый дешёвый из остальных, но
 * maxDeltaPercent у него будет больше порога, и вызывающий это увидит.
 *
 * Зачем не «просто самый дешёвый»: самый дешёвый может быть дешевлеsettings
 * тоже (мы не знаем качества его апстрима) — совпадение с ожиданиями
 * пользователя честнее.
 */
function pickAlternative(
  was: ModelPricing,
  currentVendor: string,
  vendors: Array<{ id: string; pricing: ModelPricing }>,
  thresholdPercent: number,
): DriftAlternative | undefined {
  const candidates: DriftAlternative[] = [];
  for (const vendor of vendors) {
    if (vendor.id === currentVendor) continue;
    const compared = compareComponents(was, vendor.pricing);
    candidates.push({
      vendor: vendor.id,
      pricing: vendor.pricing,
      maxDeltaPercent: compared.maxDeltaPercent,
    });
  }
  if (candidates.length === 0) return undefined;
  const within = candidates.filter((c) => Math.abs(c.maxDeltaPercent) <= thresholdPercent);
  const pool = within.length > 0 ? within : candidates;
  return pool.sort(
    (a, b) => totalPricing(a.pricing) - totalPricing(b.pricing) || a.vendor.localeCompare(b.vendor),
  )[0];
}

// ── Кэш сверки (риск R3: без кэша — сеть на каждый ход) ──

/** Запись кэша сверки: результат + момент проверки. */
interface GuardCacheEntry {
  at: number;
  result: PricingDriftResult;
}

/**
 * Кэш в памяти процесса, ключ — `cwd|modelId|ttl`: TTL является частью ключа,
 * чтобы правка настройки применялась сразу, а не после протухания.
 * Сеть при этом не трогается вообще (каталог VL-316 тоже кэширует, но его
 * TTL настраивается отдельно и по умолчанию длиннее).
 */
const guardCache = new Map<string, GuardCacheEntry>();

/** Сброс кэша сверки (тесты; ручной refresh). */
export function clearPricingGuardCache(): void {
  guardCache.clear();
}

/** Зависимости сверки: подменяемые fetch/часы (тесты без сети). */
export interface PricingGuardDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Обойти кэш сверки (ручное «обновить» из UI/API). */
  force?: boolean;
  /** Обойти кэш каталога VL-316 (тот же force по смыслу). */
  forceCatalog?: boolean;
}

/**
 * Сверяет тариф модели из settings с ценой ЕЁ ЖЕ вендора в каталоге.
 *
 * @param cwd — каталог проекта
 * @param modelId — id из models.available; undefined — активная/default модель
 * @param deps — fetch/часы (тесты), force — обойти кэш сверки
 */
export async function checkPricingDrift(
  cwd: string,
  modelId?: string,
  deps: PricingGuardDeps = {},
): Promise<PricingDriftResult> {
  const now = (deps.now ?? Date.now)();
  const checkedAt = new Date(now).toISOString();
  const { config, errors: configErrors } = resolvePricingGuard(cwd);
  if (configErrors.length > 0) console.error(formatPricingGuardErrors(configErrors));

  const unknown = (reason: string, extra: Partial<PricingDriftResult> = {}): PricingDriftResult => ({
    state: 'unknown',
    components: [],
    maxDeltaPercent: 0,
    reason,
    checkedAt,
    ...(modelId !== undefined ? { modelId } : {}),
    ...extra,
  });

  if (!config.enabled) {
    return { ...unknown('сверка цен выключена (pricing_guard.enabled=false)'), state: 'ok', skipped: 'disabled' };
  }

  // Активная модель: явный id приоритетнее default (модель треда/фазы)
  const active =
    modelId !== undefined && modelId !== ''
      ? resolveModelById(cwd, modelId)
      : resolveActiveModel(cwd);
  if (active === null) {
    return unknown(
      modelId !== undefined && modelId !== ''
        ? `Модель "${modelId}" отсутствует в models.available`
        : 'LLM не настроен через models.available (env-фолбэк) — сверять нечего',
    );
  }
  const resolvedId = active.id;
  if (active.pricing === undefined) {
    return unknown('У модели не задан тариф (pricing) в models.available', {
      modelId: resolvedId,
      gateway: active.gatewayId,
      ...(active.vendor !== undefined ? { vendor: active.vendor } : {}),
    });
  }
  // Риск R1: пара обязательна — без вендора неизвестно, с чьей ценой сверять
  if (active.vendor === undefined || active.vendor === '') {
    return unknown(
      'У модели не задан вендор — сверка возможна только по паре (gateway, model, vendor)',
      { modelId: resolvedId, gateway: active.gatewayId },
    );
  }

  const cacheKey = `${cwd}|${resolvedId}|${config.catalogTtlMinutes}`;
  const ttlMs = config.catalogTtlMinutes * 60_000;
  const cached = guardCache.get(cacheKey);
  if (!deps.force && cached && ttlMs > 0 && now - cached.at < ttlMs) {
    return { ...cached.result, checkedAt };
  }

  let vendors: Awaited<ReturnType<typeof listCatalogVendors>>;
  try {
    vendors = await listCatalogVendors(cwd, active.gatewayId, active.model, {
      ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      // force (ручное «обновить») означает «получить свежие данные вообще»:
      // иначе кэш каталога VL-316 (TTL до часа) отдал бы те же цены, и
      // обновление тарифа выглядело бы «ничего не изменилось»
      ...(deps.force === true || deps.forceCatalog === true ? { force: true } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const result = unknown(`Каталог недоступен: ${msg}`, {
      modelId: resolvedId,
      gateway: active.gatewayId,
      vendor: active.vendor,
      offline: true,
    });
    if (ttlMs > 0) guardCache.set(cacheKey, { at: now, result });
    return result;
  }

  const vendor = vendors.items.find((v) => v.id === active.vendor);
  if (vendor === undefined) {
    return unknown(
      `Вендор "${active.vendor}" не обслуживает модель ${active.model} в каталоге`,
      { modelId: resolvedId, gateway: active.gatewayId, vendor: active.vendor, stale: vendors.stale },
    );
  }

  const was = active.pricing;
  const compared = compareComponents(was, vendor.pricing);
  const isDrift = Math.abs(compared.maxDeltaPercent) > config.thresholdPercent;
  const result: PricingDriftResult = {
    state: isDrift ? 'drift' : 'ok',
    modelId: resolvedId,
    gateway: active.gatewayId,
    vendor: vendor.id,
    components: compared.components,
    maxDeltaPercent: compared.maxDeltaPercent,
    ...(compared.direction !== undefined ? { direction: compared.direction } : {}),
    ...(vendors.stale ? { stale: true } : {}),
    checkedAt,
  };
  if (isDrift) {
    const alternative = pickAlternative(was, vendor.id, vendors.items, config.thresholdPercent);
    if (alternative !== undefined) result.alternative = alternative;
  }
  if (ttlMs > 0) guardCache.set(cacheKey, { at: now, result });
  return result;
}

/** Процент для текста: целое при Infinity («бесконечно»), иначе со знаком. */
function percentText(value: number): string {
  if (!Number.isFinite(value)) return 'бесконечно (+∞%)';
  return `${value > 0 ? '+' : ''}${value}%`;
}

/** Цена в тексте: до двух знаков, без хвоста нулей. */
function priceText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Подпись компоненты по-русски. */
const COMPONENT_LABEL: Record<DriftComponent['name'], string> = {
  input: 'ввод',
  output: 'вывод',
  cache: 'кэш',
};

/**
 * Текст сообщения о дрейфе: «Цена вендора X изменилась: ввод 33.68 → 41.2
 * (+22.3%) …». Показываются только изменившиеся компоненты (AC4: «в результате
 * видно было/стало»).
 */
export function formatDriftMessage(result: PricingDriftResult): string {
  if (result.state === 'unknown') {
    return result.reason ?? 'Сверка цены недоступна';
  }
  if (result.state === 'ok') {
    return `Цена вендора соответствует каталогу${result.vendor !== undefined ? ` (${result.vendor})` : ''}`;
  }
  const changed = result.components.filter((c) => c.deltaPercent !== 0);
  const parts = (changed.length > 0 ? changed : result.components).map(
    (c) => `${COMPONENT_LABEL[c.name]} ${priceText(c.was)} → ${priceText(c.now)} (${percentText(c.deltaPercent)})`,
  );
  const head = result.direction === 'decreased' ? 'Цена вендора снизилась' : 'Цена вендора выросла';
  const vendorPart = result.vendor !== undefined ? ` у ${result.vendor}` : '';
  const alternativePart =
    result.alternative !== undefined
      ? `. Альтернатива: ${result.alternative.vendor} (${percentText(result.alternative.maxDeltaPercent)} к текущему тарифу)`
      : '';
  return `${head}${vendorPart} (${result.modelId ?? 'модель'}): ${parts.join(', ')}${alternativePart}`;
}

// ── Принятие дрейфа тредом (чтобы 'ask' не спрашивал на каждом ходу) ──

/** Принятое тредом расхождение: пока цена не выросла сильнее — не спрашиваем. */
export interface AcceptedDrift {
  model: string;
  acceptedDeltaPercent: number;
  at: string;
}

/** Путь sidecar-файла принятого дрейфа треда. */
function acceptedDriftPath(cwd: string, threadId: string): string {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.pricing.json`);
}

/** Читает принятое тредом расхождение; битый файл — «не принято». */
export function readAcceptedDrift(cwd: string, threadId: string): AcceptedDrift | null {
  const path = acceptedDriftPath(cwd, threadId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AcceptedDrift>;
    if (typeof parsed.model !== 'string' || typeof parsed.acceptedDeltaPercent !== 'number') {
      return null;
    }
    return {
      model: parsed.model,
      acceptedDeltaPercent: parsed.acceptedDeltaPercent,
      at: typeof parsed.at === 'string' ? parsed.at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Фиксирует, что пользователь согласился с расхождением (кнопка «Продолжить»
 * в карточке дрейфа). Дальше ходы треда идут без вопроса, пока цена не уйдёт
 * выше принятого порога.
 *
 * Сбой записи не критичен: худшее — спросим ещё раз на следующем ходу.
 */
export function acceptDrift(
  cwd: string,
  threadId: string,
  model: string,
  acceptedDeltaPercent: number,
): AcceptedDrift {
  const record: AcceptedDrift = {
    model,
    acceptedDeltaPercent,
    at: new Date().toISOString(),
  };
  try {
    const path = acceptedDriftPath(cwd, threadId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  } catch {
    // Нет прав/диска — карточка просто появится снова
  }
  return record;
}

/**
 * Проверяет, принято ли уже это расхождение тредом.
 *
 * Снижение цены приёмки не требует вовсе; рост считается принятым, если он не
 * больше зафиксированного значения (для той же модели).
 */
export function isDriftAccepted(
  accepted: AcceptedDrift | null,
  result: PricingDriftResult,
): boolean {
  if (accepted === null || result.modelId === undefined) return false;
  if (accepted.model !== result.modelId) return false;
  if (result.direction !== 'increased') return false;
  return result.maxDeltaPercent <= accepted.acceptedDeltaPercent + 0.001;
}

// ── Синхронная сверка по кэшу каталога (точка «перед фазой») ──

/**
 * Сверка БЕЗ сети: вендоры берутся из кэша каталога VL-316.
 *
 * Точка «перед стартом фазы» (`orchestrator.startPhase`) синхронная и не
 * может ждать сеть, но и молча игнорировать дрейф нельзя. Нет кэша — сверка
 * невозможна, состояние `unknown` с `offline: true` (вызывающий решает по
 * `pricing_guard.offline`, AC10).
 */
export function checkPricingDriftCached(cwd: string, modelId?: string): PricingDriftResult {
  const checkedAt = new Date().toISOString();
  const { config } = resolvePricingGuard(cwd);
  if (!config.enabled) {
    return {
      state: 'ok',
      components: [],
      maxDeltaPercent: 0,
      checkedAt,
      skipped: 'disabled',
    };
  }
  const active =
    modelId !== undefined && modelId !== ''
      ? resolveModelById(cwd, modelId)
      : resolveActiveModel(cwd);
  const base: Partial<PricingDriftResult> =
    active !== null
      ? {
          modelId: active.id,
          gateway: active.gatewayId,
          ...(active.vendor !== undefined ? { vendor: active.vendor } : {}),
        }
      : {};
  if (active === null || active.pricing === undefined || active.vendor === undefined || active.vendor === '') {
    return {
      state: 'unknown',
      components: [],
      maxDeltaPercent: 0,
      reason: active === null
        ? 'LLM не настроен через models.available — сверять нечего'
        : 'Сверка возможна только по паре (gateway, model, vendor) с заданным тарифом',
      checkedAt,
      ...base,
    };
  }
  const cached = readCachedVendors(cwd, active.gatewayId, active.model);
  if (cached === null) {
    return {
      state: 'unknown',
      components: [],
      maxDeltaPercent: 0,
      reason: 'Каталог ещё не читался — цены вендоров неизвестны (нет кэша)',
      checkedAt,
      offline: true,
      ...base,
    };
  }
  const vendor = cached.vendors.find((v) => v.id === active.vendor);
  if (vendor === undefined) {
    return {
      state: 'unknown',
      components: [],
      maxDeltaPercent: 0,
      reason: `Вендор "${active.vendor}" не обслуживает модель ${active.model} в каталоге`,
      checkedAt,
      ...base,
    };
  }
  const compared = compareComponents(active.pricing, vendor.pricing);
  const isDrift = Math.abs(compared.maxDeltaPercent) > config.thresholdPercent;
  const result: PricingDriftResult = {
    state: isDrift ? 'drift' : 'ok',
    components: compared.components,
    maxDeltaPercent: compared.maxDeltaPercent,
    ...(compared.direction !== undefined ? { direction: compared.direction } : {}),
    checkedAt,
    ...base,
  } as PricingDriftResult;
  if (isDrift) {
    const alternative = pickAlternative(active.pricing, vendor.id, cached.vendors, config.thresholdPercent);
    if (alternative !== undefined) result.alternative = alternative;
  }
  return result;
}

// ── Решение по режиму on_drift ──

/** Что делать вызывающему по итогам сверки. */
export type DriftAction =
  /** Продолжаем работу; `warning` (если задан) пишется в ленту/лог. */
  | { kind: 'proceed'; warning?: string }
  /** Нужен ответ пользователя: карточка в чате / запись причины в задачу. */
  | { kind: 'ask'; message: string; result: PricingDriftResult }
  /** Автоматический переезд на другого вендора (AC6). */
  | { kind: 'auto'; vendor: string; message: string }
  /** Отказ (offline = 'block' при недоступном каталоге, AC10). */
  | { kind: 'block'; message: string };

/**
 * Применяет политику `on_drift`/`offline` к результату сверки (AC5-AC8, AC10, AC13).
 *
 * Правила:
 * - сверка выключена/принята/ok → `proceed`;
 * - снижение цены → `proceed` с информационным предупреждением (AC13:
 *   снижение не блокирует);
 * - недоступный каталог: `offline: 'block'` → отказ, `'allow'` → `proceed`
 *   с предупреждением и причиной в логе (AC10);
 * - рост цены выше порога: `'warn'` → `proceed` с предупреждением;
 *   `'ask'` → `ask`; `'auto'` с альтернативой → `auto`, без альтернативы →
 *   `ask` (AC8: молчаливое продолжение по выросшей цене недопустимо).
 *
 * @param accepted — принятое тредом расхождение (для чата); null — не принято
 */
export function decideDriftPolicy(
  config: PricingGuardConfig,
  result: PricingDriftResult,
  accepted: AcceptedDrift | null = null,
): DriftAction {
  if (result.skipped !== undefined) return { kind: 'proceed' };

  if (result.state === 'unknown') {
    if (result.offline === true) {
      const message = `Сверка цен невозможна: ${result.reason ?? 'каталог недоступен'}`;
      return config.offline === 'block' ? { kind: 'block', message } : { kind: 'proceed', warning: message };
    }
    // Нечего сверять (нет вендора/тарифа/кэша) — это не дрейф и не повод
    // останавливать работу, но причина должна быть в логе
    return { kind: 'proceed', warning: `Сверка цен не выполнена: ${result.reason ?? 'причина неизвестна'}` };
  }

  const message = formatDriftMessage(result);
  if (result.state === 'ok') return { kind: 'proceed' };

  if (result.direction === 'decreased') {
    // AC13: снижение цены — приятная новость, а не повод спрашивать
    return { kind: 'proceed', warning: message };
  }
  if (accepted !== null && isDriftAccepted(accepted, result)) return { kind: 'proceed' };
  if (config.onDrift === 'warn') return { kind: 'proceed', warning: message };
  if (config.onDrift === 'auto' && result.alternative !== undefined) {
    return {
      kind: 'auto',
      vendor: result.alternative.vendor,
      message: `${message}. Переключение на вендора ${result.alternative.vendor}`,
    };
  }
  return { kind: 'ask', message, result };
}

/** Результат обновления тарифа. */
export interface PricingRefreshResult {
  modelId: string;
  /** Прежний тариф (null — не был задан). */
  previous: ModelPricing | null;
  /** Новый тариф из каталога. */
  pricing: ModelPricing;
  vendor?: string;
}

/**
 * Перезаписывает тариф модели в settings.json ценой её вендора из каталога.
 *
 * Валидация ДО записи: каталог обязан отдать тариф именно для пары
 * `(gateway, model, vendor)` — иначе файл не меняется (риск R1: записать
 * «цену модели вообще» значит потерять разницу вендоров). Запись — через
 * `saveSettingsPatch` (read-modify-write: env/gateways/прочие ключи целы).
 *
 * @throws Error с русским текстом — вызывающий отдаёт 4xx/503
 */
export async function refreshModelPricing(
  cwd: string,
  modelId: string,
  deps: PricingGuardDeps = {},
): Promise<PricingRefreshResult> {
  const active = resolveModelById(cwd, modelId);
  if (active === null) {
    throw new Error(`Модель "${modelId}" отсутствует в models.available`);
  }
  if (active.vendor === undefined || active.vendor === '') {
    throw new Error(
      `У модели "${modelId}" не задан вендор — обновлять тариф можно только по паре (gateway, model, vendor)`,
    );
  }
  const listed = await listCatalogVendors(cwd, active.gatewayId, active.model, {
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    force: true,
  });
  const vendor = listed.items.find((v) => v.id === active.vendor);
  if (vendor === undefined) {
    throw new Error(
      `Каталог не отдал тариф для ${active.gatewayId}/${active.model} у вендора "${active.vendor}"`,
    );
  }
  const settings = loadSettings(cwd);
  const models = (settings.models ?? {}) as Record<string, unknown>;
  const available = (models.available ?? {}) as Record<string, Record<string, unknown>>;
  const record = available[modelId];
  if (record === undefined) {
    throw new Error(`Модель "${modelId}" отсутствует в models.available`);
  }
  saveSettingsPatch(cwd, {
    models: {
      ...models,
      available: {
        ...available,
        [modelId]: {
          ...record,
          pricing: {
            input_per_1m: vendor.pricing.input_per_1m,
            output_per_1m: vendor.pricing.output_per_1m,
            cache_per_1m: vendor.pricing.cache_per_1m,
          },
        },
      },
    },
  });
  // Кэш сверки устарел: следующий checkPricingDrift должен увидеть новый тариф
  clearPricingGuardCache();
  return {
    modelId,
    previous: active.pricing ?? null,
    pricing: vendor.pricing,
    vendor: vendor.id,
  };
}
