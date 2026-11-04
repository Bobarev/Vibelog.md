/**
 * Обновление тарифа из каталога + продолжение хода чата (VL-334).
 *
 * Зачем отдельный модуль: в карточке дрейфа цены (`pricing-drift-card.tsx`)
 * порядок операций важнее самих операций — сначала `POST /api/pricing/refresh`
 * (сервер валидирует каталог ДО записи в settings.json, VL-317), и только при
 * успехе фиксируется решение пользователя и перезапускается ход. Молчаливое
 * продолжение по старой цене после неудачного обновления недопустимо (AC4):
 * пользователь нажал «обновить тариф», а не «продолжить как есть» — иначе он
 * останется в уверенности, что тариф обновлён.
 *
 * Модуль чистый (без React и алиасов `@/`), чтобы его можно было покрыть
 * юнит-тестами: `fetchFn` инъектируется (в браузере — глобальный fetch,
 * относительный URL бьёт в тот же origin, что и страница чата).
 */

/** Итог обновления тарифа: успех либо текст ошибки для показа в карточке. */
export type RefreshResult = { ok: true } | { ok: false; error: string }

/**
 * Перезаписывает тариф модели из каталога (`POST /api/pricing/refresh`).
 *
 * Тело ошибки сервера (`{error}`) показывается пользователю как есть: сервер
 * уже формулирует причину по-русски («каталог не отдал тариф для пары …»,
 * «модель отсутствует в models.available»). Сетевой сбой отдельного текста не
 * требует — он означает, что обновление не состоялось.
 */
export async function refreshCatalogPricing(
  modelId: string,
  fetchFn: typeof fetch = fetch,
): Promise<RefreshResult> {
  let res: Response
  try {
    res = await fetchFn("/api/pricing/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: modelId }),
    })
  } catch (err) {
    // офлайн/обрыв: тариф не обновлён, продолжаться по старой цене нельзя
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Каталог недоступен: ${message}` }
  }
  if (!res.ok) {
    let detail = ""
    try {
      const payload = (await res.json()) as { error?: unknown } | undefined
      if (typeof payload?.error === "string") detail = payload.error
    } catch {
      // тело не JSON — обходимся статусом, ронять карточку из-за этого нельзя
    }
    return { ok: false, error: detail !== "" ? detail : `Сервер ответил ${res.status}` }
  }
  return { ok: true }
}

/**
 * «Продолжить и обновить тариф»: refresh → (при успехе) решение + перезапуск.
 *
 * Порядок жёсткий: при ошибке refresh не вызывается ни `decide`, ни
 * `continueRun` — ход остаётся стоять, карточка показывает ошибку, и
 * пользователь может выбрать обычное «Продолжить» (осознанно, по старой цене)
 * или повторить обновление.
 *
 * Если каталог отдал цену, которая всё ещё выше порога, тариф всё равно
 * обновлён — это действие пользователя; следующая сверка не задаст вопрос
 * повторно, т.к. `pricingAck` обрабатывается сервером до `decideDriftPolicy`.
 */
export async function refreshThenContinue({
  modelId,
  decide,
  continueRun,
  fetchFn,
}: {
  /** id модели из `models.available` (приходит в событии `pricing`). */
  modelId: string
  /** Фиксация решения «расхождение принято» (`setPricingDecision`). */
  decide: () => void
  /** Перезапуск хода (тот же путь, что «Продолжить» после лимита). */
  continueRun: () => void
  fetchFn?: typeof fetch
}): Promise<RefreshResult> {
  const refreshed = await refreshCatalogPricing(modelId, fetchFn ?? fetch)
  if (!refreshed.ok) return refreshed
  decide()
  continueRun()
  return { ok: true }
}
