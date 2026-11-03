/**
 * Карточка дрейфа цены вендора (VL-317, AC5/AC7).
 *
 * Когда цена вендора в каталоге разошлась с тарифом в `settings.json` больше
 * чем на `pricing_guard.threshold_percent`, сервер НЕ начинает ход и присылает
 * событие `pricing` с `kind: 'ask'`. Карточка показывает, что было и что стало
 * (текст формирует сервер — там же живёт расчёт процентов), и предлагает:
 *
 * - «Продолжить» — согласие с расхождением: решение запоминается для треда
 *   (`<threadId>.pricing.json`), следующие ходы не спрашивают то же самое;
 * - «Перейти на <вендор>» — переезд на альтернативный апстрим (он приходит в
 *   событии, если каталог его знает). Вендор уходит в wire-запрос
 *   `provider.order` (VL-315), формат запроса не меняется.
 *
 * `kind: 'warn'` (режим `on_drift='warn'` или снижение цены) — та же плашка,
 * но без кнопок: работа уже идёт, предупреждение остаётся в ленте (AC7).
 * `kind: 'auto'` — вендор переключён автоматически, плашка фиксирует это в
 * ленте (AC6: переключение не должно быть молчаливым).
 *
 * Решение передаётся серверу через module-state рантайма
 * (`setPricingDecision`): следующий POST хода уходит с `pricingAck`/
 * `pricingVendor`, а run перезапускается тем же механизмом, что «Продолжить»
 * после лимита (VL-269).
 */

import * as React from "react"
import { ArrowRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { setPricingDecision } from "./chat-runtime"
import { field, ghostButton, inkButton, mono, paper } from "./surfaces"

export function PricingDriftCard({
  kind,
  message,
  vendor,
  alternative,
  maxDeltaPercent,
  onContinue,
}: {
  /** ask — вопрос с кнопками; warn/auto — только плашка. */
  kind: "ask" | "warn" | "auto"
  /** Готовый текст от сервера: было → стало, проценты, альтернатива. */
  message: string
  /** Текущий вендор (для подзаголовка). */
  vendor?: string | undefined
  /** Альтернативный вендор для кнопки «Перейти на …». */
  alternative?: string | undefined
  /** Максимальное отклонение, проценты (знак — направление). */
  maxDeltaPercent?: number | undefined
  /** Перезапуск хода (по умолчанию — Reload рантайма, см. thread.tsx). */
  onContinue?: (() => void) | undefined
}) {
  const [busy, setBusy] = React.useState<"continue" | "switch" | null>(null)
  const [done, setDone] = React.useState<string | null>(null)

  const increased = (maxDeltaPercent ?? 0) >= 0
  const Icon = increased ? TrendingUpIcon : TrendingDownIcon

  /** Отправляет решение и перезапускает ход. */
  const decide = (ack: boolean, nextVendor?: string) => {
    setBusy(nextVendor !== undefined ? "switch" : "continue")
    setPricingDecision(ack, nextVendor)
    setDone(nextVendor !== undefined ? `Переход на ${nextVendor}` : "Продолжаем по новой цене")
    // Перезапуск хода: тот же путь, что «Продолжить» после лимита (VL-269)
    onContinue?.()
  }

  return (
    <div
      data-slot="pricing-drift-card"
      role={kind === "ask" ? "group" : "status"}
      className={cn(paper, "flex w-full max-w-sm flex-col gap-3 rounded-[20px] p-4")}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            field,
            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
            increased ? "text-destructive" : "text-emerald-600",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">
            {kind === "auto"
              ? "Вендор переключён автоматически"
              : increased
                ? "Цена вендора выросла"
                : "Цена вендора снизилась"}
          </span>
          {vendor !== undefined ? (
            <span className={cn(mono, "text-xs text-muted-foreground")}>{vendor}</span>
          ) : null}
        </div>
      </div>

      <p className="text-sm text-foreground/85">{message}</p>

      {kind === "ask" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => decide(true)}
            className={cn(inkButton, "h-8 px-3 text-xs")}
          >
            Продолжить
          </button>
          {alternative !== undefined ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide(true, alternative)}
              className={cn(ghostButton, "h-8 gap-1 px-3 text-xs")}
            >
              Перейти на {alternative}
              <ArrowRightIcon className="size-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      {done !== null ? (
        <span role="status" className={cn(mono, "text-xs text-muted-foreground")}>
          {done}
        </span>
      ) : null}
    </div>
  )
}
