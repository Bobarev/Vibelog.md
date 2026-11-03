/**
 * Панель расхода треда (VL-313): токены по типам, рубли и процент контекста.
 *
 * Плейсмент (решение по VL-313, doc-24): статично сверху ленты, полупрозрачная
 * (`bg-background/70` + `backdrop-blur-sm` + нижняя граница) — так панель видна
 * и при прокрутке, но не отъедает ощутимую высоту у диалога. Изначально
 * рассматривался ring у кнопки Send (как в примерах assistant-ui) — отклонён.
 *
 * Источник данных — `src/web/chat-usage.ts`: сервер считает суммы, пик
 * контекста, рубли по тарифу модели треда и процент; клиент только рисует
 * (AC3/AC4/AC6). Поповер — элемент assistant-ui Elements `ContextDisplay.Bar`
 * (VL-313 ставит его исходником), в него добавлена строка стоимости (AC9).
 *
 * Панель показывается ТОЛЬКО для непустого треда: пустой тред не имеет
 * учёта (`usage === null` → null, AC7).
 */

import * as React from "react"
import { ArrowDownToLine, ArrowUpFromLine, Coins, Database } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatRubles, type ThreadUsageView } from "@/lib/chat-usage"
import { ContextDisplay } from "@/components/assistant-ui/elements/context-display"
import { formatTokenCount } from "@/components/assistant-ui/utils/tokens"
import { getActiveUsage, subscribeActiveUsage } from "./chat-runtime"

/** Иконка + число: «небольшие иконки по типам токенов» (AC8). */
function Metric({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  className?: string
}) {
  return (
    <span
      className={cn("flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground", className)}
      title={label}
    >
      <Icon className="size-3" aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {value}
    </span>
  )
}

/**
 * Подписка на расход треда (VL-313): событие `usage` приходит в адаптере
 * рантайма, панель живёт в шапке — module-state с подпиской связывает их
 * без перезагрузки страницы (AC1).
 */
function useThreadUsage(): ThreadUsageView | null {
  return React.useSyncExternalStore(
    subscribeActiveUsage,
    getActiveUsage,
    // SSR нет (Vite SPA), но сигнатура требует третий аргумент
    getActiveUsage,
  )
}

/**
 * Панель токенов/стоимости/контекста.
 *
 * `threadId` нужен как resetKey элемента: при переходе на другой тред
 * «залипшее» значение предыдущего не должно попадать в новый.
 */
export function UsageBar({ threadId }: { threadId?: string }) {
  const usage = useThreadUsage()
  // Пустой тред (учёта ещё нет) — панели нет (AC7)
  if (!usage) return null

  const contextUsage = {
    // Пик занятого контекста — сумма input+cache по последнему запросу (AC3):
    // сервер уже посчитал его с учётом того, что кэш — подмножество input.
    totalTokens: usage.peakContext,
    inputTokens: usage.input,
    cachedInputTokens: usage.cache,
    outputTokens: usage.output,
    reasoningTokens: usage.reasoning,
  }

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-3 border-b bg-background/70 px-3 text-xs backdrop-blur-sm"
      aria-label="Расход треда"
    >
      <Metric icon={ArrowDownToLine} label="Входящие токены" value={formatTokenCount(usage.input)} />
      <Metric icon={ArrowUpFromLine} label="Исходящие токены" value={formatTokenCount(usage.output)} />
      {usage.cache > 0 ? (
        <Metric icon={Database} label="Кэш-токены" value={formatTokenCount(usage.cache)} />
      ) : null}
      <Metric
        icon={Coins}
        label="Стоимость треда"
        value={formatRubles(usage.cost.total)}
        className="text-foreground/80"
      />
      <div className="ml-auto flex items-center">
        {/* Элемент Elements (VL-313): полоса + поповер с разбивкой и
            стоимостью (AC9). modelContextWindow не передан — процент не
            рисуется вовсе (AC6), это осознанное поведение элемента. */}
        <ContextDisplay.Bar
          modelContextWindow={usage.contextWindow}
          usage={contextUsage}
          resetKey={threadId}
          side="bottom"
          costLabel={usage.cost.total > 0 ? formatRubles(usage.cost.total) : undefined}
        />
      </div>
    </div>
  )
}
