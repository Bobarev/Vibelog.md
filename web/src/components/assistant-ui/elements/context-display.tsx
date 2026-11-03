"use client"

/**
 * Элемент «Расход контекста» (VL-313) — ручная установка из registry
 * assistant-ui Elements (ref-23: `@assistant-ui/context-display`, стиль
 * radix-nova). Почему исходником, а не npm-пакетом: `@assistant-ui/react`
 * 0.15.31 элемент не экспортирует, а `pnpm dlx shadcn add` требует registry
 * (прокси/VPN) — файлы разложены вручную из
 * `https://r.assistant-ui.com/styles/radix-nova/context-display.json`.
 *
 * Отличия от оригинала (AC6 и AC9 VL-313):
 * - `modelContextWindow` необязателен: модель без `context_window` в
 *   settings.json → панель показывает токены, но БЕЗ процента (никакого 0%);
 * - в поповер добавлена строка «Стоимость, ₽» (в оригинале только
 *   Input / Cached input / Output / Reasoning) — считается сервером по
 *   тарифу модели треда и приходит готовой;
 * - подписи на русском, как весь интерфейс проекта.
 *
 * Зависимости элемента: `ui/tooltip` (наш shadcn-примитив на radix-ui),
 * `utils/context-usage`, `utils/context-display-state`, `utils/tokens`.
 */

import { type FC, type ReactNode } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  getBarColor,
  getContextSegments,
  getPercentColor,
  getStrokeColor,
  type TokenUsage,
} from "../utils/context-usage"
import {
  ContextDisplayContext,
  useContextDisplay,
  useContextDisplayState,
} from "../utils/context-display-state"
import { formatTokenCount } from "../utils/tokens"

export type { TokenUsage } from "../utils/context-usage"

export type PresetProps = {
  /** Размер контекстного окна модели; undefined — процент не показываем. */
  modelContextWindow?: number | undefined
  className?: string
  side?: "top" | "bottom" | "left" | "right"
  usage?: TokenUsage | undefined
  /** Ключ сброса (у нас threadId): смена треда начинает счёт заново. */
  resetKey?: string | undefined
  /** Стоимость запросов треда в рублях (AC9); undefined — строку не рисуем. */
  costLabel?: string | undefined
}

export type ContextDisplayRootProps = {
  modelContextWindow?: number | undefined
  children: ReactNode
  usage?: TokenUsage | undefined
  resetKey?: string | undefined
}

function ContextDisplayRoot({
  modelContextWindow,
  children,
  usage,
  resetKey,
}: ContextDisplayRootProps) {
  const { contextValue, hasUsage } = useContextDisplayState(
    usage,
    resetKey,
    modelContextWindow,
  )

  if (!hasUsage) return null

  return (
    <ContextDisplayContext.Provider value={contextValue}>
      <TooltipProvider>
        <Tooltip>{children}</Tooltip>
      </TooltipProvider>
    </ContextDisplayContext.Provider>
  )
}

function ContextDisplayTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <TooltipTrigger asChild>
      <button
        type="button"
        data-slot="context-display-trigger"
        className={cn(
          "inline-flex items-center rounded-md transition-colors",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </TooltipTrigger>
  )
}

function ContextDisplayContent({
  side = "bottom",
  className,
  costLabel,
}: {
  side?: "top" | "bottom" | "left" | "right" | undefined
  className?: string
  /** Стоимость в рублях (VL-313, AC9); undefined — строка не показывается. */
  costLabel?: string | undefined
}) {
  const { usage, totalTokens, percent, modelContextWindow } =
    useContextDisplay()
  const segments = getContextSegments(usage)
  // Окно неизвестно — процента нет (AC6): показываем только абсолютные числа
  const hasWindow = percent !== null && !!modelContextWindow

  return (
    <TooltipContent
      side={side}
      sideOffset={8}
      data-slot="context-display-popover"
      className={cn(
        "bg-popover text-popover-foreground block w-60 border p-3 text-left [&_[data-slot=tooltip-arrow]]:hidden",
        className,
      )}
    >
      <div className="text-xs">
        <div className="flex items-baseline justify-between gap-6 whitespace-nowrap">
          {hasWindow ? (
            <span className={getPercentColor(percent)}>
              {Math.round(percent)}% контекста
            </span>
          ) : (
            <span className="text-muted-foreground">Контекст</span>
          )}
          <span className="font-mono tabular-nums">
            {hasWindow
              ? `${formatTokenCount(Math.min(totalTokens, modelContextWindow))} / ${formatTokenCount(modelContextWindow)}`
              : formatTokenCount(totalTokens)}
          </span>
        </div>
        {hasWindow ? (
          <div
            data-slot="context-display-track"
            className="bg-muted inset-ring-border mt-2.5 h-1 overflow-hidden rounded-full inset-ring forced-colors:border"
          >
            <div
              className={cn(
                "h-full w-(--usage-width) rounded-full transition-[width] duration-300 forced-color-adjust-none",
                totalTokens > 0 && "min-w-1",
                getBarColor(percent),
              )}
              style={{ "--usage-width": `${percent}%` } as React.CSSProperties}
            />
          </div>
        ) : null}
        {segments.length > 0 && (
          <div className="mt-3 grid gap-1.5">
            {segments.map((segment) => (
              <div
                key={segment.label}
                className="flex items-baseline justify-between gap-6"
              >
                <span className="text-muted-foreground">{segment.label}</span>
                <span className="font-mono tabular-nums">
                  {formatTokenCount(segment.tokens)}
                </span>
              </div>
            ))}
          </div>
        )}
        {costLabel ? (
          <div
            data-slot="context-display-cost"
            className="mt-2 flex items-baseline justify-between gap-6 border-t border-border/60 pt-2"
          >
            <span className="text-muted-foreground">Стоимость</span>
            <span className="font-mono tabular-nums">{costLabel}</span>
          </div>
        ) : null}
      </div>
    </TooltipContent>
  )
}

const RING_SIZE = 18
const RING_STROKE = 2.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function RingVisual() {
  const { percent } = useContextDisplay()

  return (
    <svg
      aria-hidden="true"
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="-rotate-90"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        className="stroke-border"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={
          RING_CIRCUMFERENCE - ((percent ?? 0) / 100) * RING_CIRCUMFERENCE
        }
        className={cn(
          "transition-[stroke-dashoffset,stroke] duration-300",
          getStrokeColor(percent ?? 0),
        )}
      />
    </svg>
  )
}

function RingPercentLabel() {
  const { percent } = useContextDisplay()
  // Окно неизвестно — вместо «0%» эквивалент «занятость неизвестна» (AC6)
  if (percent === null) return <span className="text-muted-foreground">контекст</span>
  return <span className="font-mono tabular-nums">{Math.round(percent)}%</span>
}

const ContextDisplayRing: FC<PresetProps> = ({
  modelContextWindow,
  className,
  side,
  usage,
  resetKey,
  costLabel,
}) => (
  <ContextDisplayRoot
    modelContextWindow={modelContextWindow}
    usage={usage}
    resetKey={resetKey}
  >
    <ContextDisplayTrigger
      className={cn(
        "text-muted-foreground hover:text-foreground gap-1.5 px-1.5 py-1 text-xs",
        className,
      )}
      aria-label="Расход контекста"
    >
      <RingVisual />
      <RingPercentLabel />
    </ContextDisplayTrigger>
    <ContextDisplayContent side={side} costLabel={costLabel} />
  </ContextDisplayRoot>
)

function BarVisual() {
  const { percent, totalTokens } = useContextDisplay()

  return (
    <div className="flex items-center gap-2">
      {percent !== null ? (
        <div
          data-slot="context-display-track"
          className="bg-muted inset-ring-border h-1.5 w-16 overflow-hidden rounded-full inset-ring forced-colors:border"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300 forced-color-adjust-none",
              getBarColor(percent),
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <span className="text-muted-foreground text-[10px] tabular-nums">
        {formatTokenCount(totalTokens)}
        {percent !== null ? ` (${Math.round(percent)}%)` : ""}
      </span>
    </div>
  )
}

const ContextDisplayBar: FC<PresetProps> = ({
  modelContextWindow,
  className,
  side,
  usage,
  resetKey,
  costLabel,
}) => (
  <ContextDisplayRoot
    modelContextWindow={modelContextWindow}
    usage={usage}
    resetKey={resetKey}
  >
    <ContextDisplayTrigger
      className={cn("px-2 py-1", className)}
      aria-label="Расход контекста"
    >
      <BarVisual />
    </ContextDisplayTrigger>
    <ContextDisplayContent side={side} costLabel={costLabel} />
  </ContextDisplayRoot>
)

function TextVisual() {
  const { totalTokens, modelContextWindow } = useContextDisplay()

  if (!modelContextWindow) return <>{formatTokenCount(totalTokens)}</>
  return (
    <>
      {formatTokenCount(totalTokens)} / {formatTokenCount(modelContextWindow)}
    </>
  )
}

const ContextDisplayText: FC<PresetProps> = ({
  modelContextWindow,
  className,
  side,
  usage,
  resetKey,
  costLabel,
}) => (
  <ContextDisplayRoot
    modelContextWindow={modelContextWindow}
    usage={usage}
    resetKey={resetKey}
  >
    <ContextDisplayTrigger
      aria-label="Расход контекста"
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground px-2 py-1 font-mono text-xs tabular-nums",
        className,
      )}
    >
      <TextVisual />
    </ContextDisplayTrigger>
    <ContextDisplayContent side={side} costLabel={costLabel} />
  </ContextDisplayRoot>
)

const ContextDisplay = {} as {
  Root: typeof ContextDisplayRoot
  Trigger: typeof ContextDisplayTrigger
  Content: typeof ContextDisplayContent
  Ring: typeof ContextDisplayRing
  Bar: typeof ContextDisplayBar
  Text: typeof ContextDisplayText
}

ContextDisplay.Root = ContextDisplayRoot
ContextDisplay.Trigger = ContextDisplayTrigger
ContextDisplay.Content = ContextDisplayContent
ContextDisplay.Ring = ContextDisplayRing
ContextDisplay.Bar = ContextDisplayBar
ContextDisplay.Text = ContextDisplayText

export {
  ContextDisplay,
  ContextDisplayRoot,
  ContextDisplayTrigger,
  ContextDisplayContent,
  ContextDisplayRing,
  ContextDisplayBar,
  ContextDisplayText,
}
