/**
 * REST API каталога моделей шлюза (VL-316) — то, что наполняет страницу
 * «Модели» (#/models).
 *
 * Эндпоинты:
 * - GET  /api/catalog/models?gateway=<id>&query=<строка> — поиск моделей в
 *   каталоге шлюза (AC5): цены и context_window из API, кэш с TTL;
 * - GET  /api/catalog/vendors?gateway=<id>&model=<id> — вендоры (апстримы)
 *   конкретной модели с их ценами (AC3);
 * - POST /api/catalog/resolve — готовая запись модели для мастера (AC6).
 *
 * Почему отдельный модуль, а не handleApi: каталог ходит в сеть, а handleApi
 * синхронный. Async-ветки сервера живут рядом с роутингом (прецедент —
 * /api/setup/ping и /api/chat, VL-210/VL-204): server.ts пробует этот
 * обработчик ДО синхронного handleApi, `null` означает «URL не наш».
 *
 * Сеть инжектируется (`deps.fetchFn`) — юнит-тесты работают без реальной
 * сети (guard VL-132 в src/test-setup.mjs отклоняет не-loopback).
 */

import {
  loadGateways,
  buildModelId,
  toStoredModel,
  loadModels,
  validateModelInput,
  upsertModel,
  removeModel,
} from '../core/models.js';
import type { ModelInput } from '../core/models.js';
import { loadSettings } from '../core/settings.js';
import {
  listCatalogModels,
  listCatalogVendors,
  normalizePricing,
  comparePricing,
} from '../core/provider-catalog.js';
import type {
  CatalogDeps,
  CatalogVendor,
  CatalogModel,
  PriceComparison,
} from '../core/provider-catalog.js';
import type { ModelPricing } from '../core/analytics.js';
import type { ApiResponse } from './api.js';

/** Разбирает query string в объект (декодирование + первое значение ключа). */
function parseQuery(queryString: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of queryString.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    if (key === '' || key in out) continue;
    try {
      out[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // Битая процентная последовательность — значение как есть
      out[key] = rawValue;
    }
  }
  return out;
}

/**
 * Валидирует id шлюза (AC5): неизвестный шлюз — понятная 400, а не поход в
 * сеть по пустому base_url.
 */
function resolveGateway(
  cwd: string,
  gatewayId: string,
): { id: string; baseUrl: string } | { error: string } {
  if (gatewayId.trim() === '') {
    return { error: 'gateway: обязательный параметр — id шлюза из settings.gateways' };
  }
  const gateways = loadGateways(cwd);
  const gateway = gateways[gatewayId];
  if (!gateway) {
    const known = Object.keys(gateways);
    return {
      error:
        known.length === 0
          ? `Неизвестный шлюз: ${gatewayId} — секция gateways в settings.json пуста`
          : `Неизвестный шлюз: ${gatewayId}. Доступные: ${known.join(', ')}`,
    };
  }
  return { id: gatewayId, baseUrl: gateway.base_url };
}

/**
 * Обрабатывает async-эндпоинты каталога.
 *
 * @param deps — инжекция fetch/таймаута (тесты; в бою — globalThis.fetch)
 * @returns ApiResponse либо null, если URL не из каталога
 */
export async function handleCatalogApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
  queryString: string = '',
  deps: CatalogDeps = {},
): Promise<ApiResponse | null> {
  if (!url.startsWith('/api/catalog/')) return null;
  const query = parseQuery(queryString);

  // GET /api/catalog/models — поиск по каталогу шлюза (AC5).
  // Терпимость к таймауту апстрима: каталог отдаёт кэш, а без кэша —
  // понятную ошибку 503 (чат и фазы от каталога не зависят).
  if (method === 'GET' && url === '/api/catalog/models') {
    const gw = resolveGateway(cwd, query.gateway ?? '');
    if ('error' in gw) return { status: 400, body: { error: gw.error } };
    try {
      const result = await listCatalogModels(cwd, gw.id, {
        query: query.query,
        force: query.force === '1' || query.force === 'true',
        ...deps,
      });
      return {
        status: 200,
        body: {
          gateway: result.gateway,
          stale: result.stale,
          fetchedAt: result.fetchedAt,
          models: result.items,
        },
      };
    } catch (err) {
      return { status: 503, body: { error: errorText(err, gw.id) } };
    }
  }

  // GET /api/catalog/vendors — вендоры модели с их ценами (AC3).
  if (method === 'GET' && url === '/api/catalog/vendors') {
    const gw = resolveGateway(cwd, query.gateway ?? '');
    if ('error' in gw) return { status: 400, body: { error: gw.error } };
    const modelId = (query.model ?? '').trim();
    if (modelId === '') {
      return { status: 400, body: { error: 'model: обязательный параметр — id модели в каталоге' } };
    }
    try {
      const result = await listCatalogVendors(cwd, gw.id, modelId, {
        force: query.force === '1' || query.force === 'true',
        ...deps,
      });
      return {
        status: 200,
        body: {
          gateway: result.gateway,
          model: modelId,
          stale: result.stale,
          fetchedAt: result.fetchedAt,
          vendors: result.items,
        },
      };
    } catch (err) {
      return { status: 503, body: { error: errorText(err, gw.id) } };
    }
  }

  // POST /api/catalog/resolve — готовая запись модели (AC6): pricing +
  // context_window + api_mode по умолчанию. Цену можно переопределить
  // вручную (риск R2: поля формы остаются редактируемыми и при недоступном
  // каталоге), тогда в ответе manualPricing: true.
  if (method === 'POST' && url === '/api/catalog/resolve') {
    const gatewayId = typeof body?.gateway === 'string' ? body.gateway : '';
    const gw = resolveGateway(cwd, gatewayId);
    if ('error' in gw) return { status: 400, body: { error: gw.error } };
    const modelId = typeof body?.model === 'string' ? body.model.trim() : '';
    if (modelId === '') {
      return { status: 400, body: { error: 'model: обязательное поле — id модели в каталоге' } };
    }
    const vendorId = typeof body?.vendor === 'string' ? body.vendor.trim() : '';
    const manual = body?.pricing;

    let vendors: CatalogVendor[] = [];
    let catalogError: string | undefined;
    try {
      const listed = await listCatalogVendors(cwd, gw.id, modelId, deps);
      vendors = listed.items;
    } catch (err) {
      // Каталог недоступен и кэша нет — отдаём модель в ручной режим, но с
      // честным предупреждением: мастер обязан показать его пользователю
      catalogError = errorText(err, gw.id);
    }

    const vendor = vendorId === '' ? undefined : vendors.find((v) => v.id === vendorId);
    if (vendorId !== '' && vendor === undefined && catalogError === undefined) {
      return {
        status: 404,
        body: {
          error: `Вендор "${vendorId}" не обслуживает модель ${modelId}. Доступные: ${
            vendors.map((v) => v.id).join(', ') || '(нет)'
          }`,
        },
      };
    }

    // Приоритет цены: ручной ввод → цена вендора → цена модели из каталога
    let pricing = vendor?.pricing;
    let pricingSource: 'manual' | 'vendor' | 'catalog' | 'none' = pricing ? 'vendor' : 'none';
    if (manual !== undefined && manual !== null) {
      // Ручной ввод приходит в формате ModelPricing (input_per_1m/…), а не
      // в формате каталога (prompt/completion/units) — нормализуем только
      // «каталожный» вид.
      const m = manual as Record<string, unknown>;
      if (typeof m.input_per_1m === 'number') {
        pricing = {
          input_per_1m: m.input_per_1m,
          output_per_1m: typeof m.output_per_1m === 'number' ? m.output_per_1m : 0,
          cache_per_1m: typeof m.cache_per_1m === 'number' ? m.cache_per_1m : 0,
        };
      } else {
        pricing = normalizePricing(manual).pricing;
      }
      pricingSource = 'manual';
    }
    if (pricing === undefined) {
      try {
        const models = await listCatalogModels(cwd, gw.id, { query: modelId, ...deps });
        const found = models.items.find((m) => m.id === modelId);
        if (found) {
          pricing = found.pricing;
          pricingSource = 'catalog';
        }
      } catch {
        // Уже зафиксировали catalogError выше — цены просто не будет
      }
    }

    const contextWindow = vendor?.contextWindow;
    const input: ModelInput = {
      gateway: gw.id,
      model: modelId,
      ...(vendorId !== '' ? { vendor: vendorId } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(contextWindow !== undefined ? { context_window: contextWindow } : {}),
      api_mode: 'chat',
    };

    return {
      status: 200,
      body: {
        id: buildModelId(input),
        record: toStoredModel(input),
        pricingSource,
        unsupportedUnits: vendor?.unsupportedUnits ?? [],
        ...(catalogError !== undefined ? { warning: catalogError } : {}),
      },
    };
  }

  // GET /api/catalog/prices — сверка тарифов всех моделей шлюза с каталогом
  // (AC15). Один запрос на страницу: каталог моделей берётся из кэша, цены
  // вендоров — по каждой модели (тоже кэшируются).
  if (method === 'GET' && url === '/api/catalog/prices') {
    const gw = resolveGateway(cwd, query.gateway ?? '');
    if ('error' in gw) return { status: 400, body: { error: gw.error } };
    const models = loadModels(cwd);
    const own = Object.entries(models.available).filter(([, m]) => m.gateway === gw.id);
    if (own.length === 0) {
      return { status: 200, body: { gateway: gw.id, stale: false, prices: {} } };
    }
    let catalogModels: CatalogModel[] = [];
    let stale = false;
    let warning: string | undefined;
    try {
      const listed = await listCatalogModels(cwd, gw.id, deps);
      catalogModels = listed.items;
      stale = listed.stale;
    } catch (err) {
      // Каталог недоступен и кэша нет: сверка невозможна, но страница
      // моделей должна остаться рабочей (риск R2) — отдаём warning
      warning = errorText(err, gw.id);
    }

    const prices: Record<string, PriceComparison & { catalogPricing?: ModelPricing }> = {};
    for (const [id, conf] of own) {
      const catalogModel = catalogModels.find((m) => m.id === conf.model);
      let catalogPricing = catalogModel?.pricing;
      // Цена вендора точнее цены модели: у разных апстримов она разная
      if (conf.vendor !== undefined) {
        try {
          const vendors = await listCatalogVendors(cwd, gw.id, conf.model, deps);
          const vendor = vendors.items.find((v) => v.id === conf.vendor);
          if (vendor) catalogPricing = vendor.pricing;
        } catch {
          // Вендоров не получили — сверяем по цене модели (если она есть)
        }
      }
      const comparison = comparePricing(conf.pricing, catalogPricing);
      prices[id] = { ...comparison, ...(catalogPricing ? { catalogPricing } : {}) };
    }

    return {
      status: 200,
      body: { gateway: gw.id, stale, prices, ...(warning !== undefined ? { warning } : {}) },
    };
  }

  // POST /api/catalog/refresh-pricing — обновить тариф одной модели из
  // каталога (AC16). Валидация ПЕРЕД записью: тариф из каталога проходит
  // validateModelInput (те же правила, что у ручного сохранения — риск R4),
  // файл не меняется, если каталог не дал валидной цены.
  if (method === 'POST' && url === '/api/catalog/refresh-pricing') {
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (id === '') return { status: 400, body: { error: 'id: обязательное поле — id модели из models.available' } };
    const models = loadModels(cwd);
    const conf = models.available[id];
    if (!conf) return { status: 404, body: { error: `Модель "${id}" отсутствует в models.available` } };
    const gateways = loadGateways(cwd);
    if (!gateways[conf.gateway]) {
      return { status: 400, body: { error: `Шлюз "${conf.gateway}" отсутствует в settings.gateways` } };
    }

    let catalogPricing: ModelPricing | undefined;
    try {
      const vendors = await listCatalogVendors(cwd, conf.gateway, conf.model, deps);
      const vendor = conf.vendor === undefined ? undefined : vendors.items.find((v) => v.id === conf.vendor);
      catalogPricing = vendor?.pricing;
      if (catalogPricing === undefined) {
        const listed = await listCatalogModels(cwd, conf.gateway, { query: conf.model, ...deps });
        catalogPricing = listed.items.find((m) => m.id === conf.model)?.pricing;
      }
    } catch (err) {
      return { status: 503, body: { error: errorText(err, conf.gateway) } };
    }
    if (catalogPricing === undefined) {
      return {
        status: 404,
        body: { error: `Каталог не отдал тариф для ${conf.gateway}/${conf.model}` },
      };
    }

    const input: ModelInput = {
      id,
      label: conf.label,
      description: conf.description,
      gateway: conf.gateway,
      model: conf.model,
      vendor: conf.vendor,
      api_mode: conf.api_mode,
      context_window: conf.context_window,
      pricing: catalogPricing,
    };
    const validated = validateModelInput(models, gateways, input, { excludeId: id, keepId: true });
    if ('error' in validated) return { status: 400, body: { error: validated.error } };
    upsertModel(cwd, validated.id, input);
    // keepId сохраняет id, поэтому удалять старый ключ не нужно — но запись
    // могла быть в старом формате (ключ с @-хвостом): upsertModel заменит
    // ровно этот ключ, остальные записи не затрагиваются
    return {
      status: 200,
      body: {
        id: validated.id,
        pricing: catalogPricing,
        previous: conf.pricing ?? null,
      },
    };
  }

  // Прочие /api/catalog/* — не наш маршрут, пусть решает handleApi (404)
  return null;
}

/**
 * Текст ошибки каталога на русском.
 *
 * Риск R2 плана: недоступность каталога не должна выглядеть как поломка
 * Vibelog — сообщение говорит, что именно недоступно и что делать.
 */
function errorText(err: unknown, gatewayId: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Каталог шлюза "${gatewayId}" недоступен и кэша нет: ${msg}. Цены можно ввести вручную — работа чата и фаз от каталога не зависит`;
}

/** Секция настроек `catalog` (TTL кэша) — отдаётся в GET /api/catalog/settings. */
export function catalogSettings(cwd: string): Record<string, unknown> {
  const raw = loadSettings(cwd).catalog;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}
