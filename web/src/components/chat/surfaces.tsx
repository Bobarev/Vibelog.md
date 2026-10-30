/**
 * Визуальные примитивы чата (VL-264) — порт
 * `packages/ui/src/components/react/assistant-ui/elements/surfaces.tsx`
 * из ref-22 (assistant-ui), переложенный на наши shadcn-токены.
 *
 * Зачем отдельный файл: `tool-call.tsx`, `approval-card.tsx`, `stopped-run.tsx`
 * и `error-state.tsx` делят один набор классов (плашка, mono-подписи,
 * ghost-кнопки, анимация раскрытия). Дублировать строки классов по файлам —
 * гарантированное расхождение стилей при следующей правке.
 *
 * Отличия от референса (осознанные):
 * - hex-палитра perplexity (`#fcfbf8`, `#7a7268`) заменена токенами
 *   (`bg-foreground/[0.04]`, `text-muted-foreground`): у нас тема shadcn и
 *   dark mode из коробки;
 * - `useIsomorphicLayoutEffect` из их utils заменён на `React.useLayoutEffect`
 *   (у нас нет SSR — Vite-сборка SPA);
 * - анимация раскрытия висит на `--radix-collapsible-content-height`
 *   (Radix Collapsible отдаёт именно её; см. риск R4 плана).
 */

import * as React from "react"

import { cn } from "@/lib/utils"

/** Карточка на «бумаге»: approval-карточка, error-state (ref: paper). */
export const paper = "bg-background border border-border/60 dark:bg-popover"

/** Внутренняя плашка-поле: блок Result, details, mono-чипы (ref: field). */
export const field = "bg-foreground/[0.04] forced-colors:border dark:bg-foreground/[0.06]"

/** Призрачная кнопка-кружок в футере карточек (ref: ghostButton). */
export const ghostButton =
  "flex items-center justify-center rounded-full text-muted-foreground outline-hidden transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-foreground/20 motion-reduce:transition-none dark:hover:bg-foreground/[0.09]"

/** Основная («чернильная») кнопка: Allow once (ref: inkButton). */
export const inkButton =
  "bg-foreground text-background transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:opacity-90 active:scale-[0.96] motion-reduce:transition-none forced-colors:border"

/** Mono-подпись мелких секций (Request / Result / label в details). */
export const mono = "font-mono text-[11px] tracking-tight"

/**
 * Анимация раскрытия Collapsible. Radix пишет высоту в
 * `--radix-collapsible-content-height`, поэтому анимируем её (R4 плана:
 * `--collapsible-panel-height` из референса у нас не существует).
 */
export const collapsePanel =
  "h-(--radix-collapsible-content-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:h-0 motion-reduce:transition-none"

/** Слой подписи в SwapLabel (ref: labelSwap / labelSwapIn / labelSwapOut). */
const labelSwap =
  "col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none transition-[opacity,filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
const labelSwapIn = "opacity-100 blur-none"
const labelSwapOut = "pointer-events-none select-none opacity-0 blur-[2px]"

/** Подпись с бегущим бликом — состояние «инструмент выполняется». */
export function ShimmerLabel({
  active = true,
  className,
  ...props
}: React.ComponentProps<"span"> & { active?: boolean }) {
  return <span className={cn(active && "shimmer motion-reduce:animate-none", className)} {...props} />
}

/**
 * Кроссфейд двух подписей с плавной сменой ширины (ref: SwapLabel).
 *
 * Ширина измеряется у активного слоя и переносится на контейнер, чтобы соседние
 * элементы (чип аргумента) не прыгали при смене «Читаю файл» → «Прочитал файл».
 * `active` — индекс слоя; children — ровно два слоя.
 *
 * R7 плана: эффект зависит от `active` и от размера слоя, а не от каждой дельты
 * текста, — ResizeObserver срабатывает только на реальное изменение ширины.
 */
export function SwapLabel({
  active,
  children,
  className,
}: {
  active: 0 | 1
  children: [React.ReactNode, React.ReactNode]
  className?: string
}) {
  // Отдельные ref'ы вместо массива: массив пересоздавался бы каждым рендером
  // и заставлял включать себя в зависимости эффекта измерения ширины.
  const firstRef = React.useRef<HTMLSpanElement>(null)
  const secondRef = React.useRef<HTMLSpanElement>(null)
  const [width, setWidth] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const target = (active === 0 ? firstRef : secondRef).current
    if (!target) return undefined
    const measure = () => setWidth(Math.ceil(target.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [active])

  return (
    <span
      style={width === null ? undefined : { width }}
      className={cn(
        "grid overflow-x-clip transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        className,
      )}
    >
      {children.map((layer, index) => (
        <span
          key={index}
          ref={index === 0 ? firstRef : secondRef}
          aria-hidden={active !== index}
          className={cn(labelSwap, active === index ? labelSwapIn : labelSwapOut)}
        >
          {layer}
        </span>
      ))}
    </span>
  )
}
