/**
 * Read-инструмент в чате (VL-264) — порт
 * `packages/ui/src/components/react/assistant-ui/elements/tool-call.tsx`
 * из ref-22.
 *
 * Свёрнутая строка: chevron → подпись (label после завершения, activeLabel с
 * shimmer'ом во время выполнения) → mono-чип ключевого аргумента (query/path/id)
 * → галочка по завершении. Разворот — панель с секциями Request и Result
 * (mono-подписи, разделитель), как в референсе.
 *
 * Ошибка инструмента (isError) рендерится той же строкой, но строка сразу
 * раскрыта и плашка Result красная (AC9: единый вид ошибки, не текст в теле
 * ответа); для прерванного вызова (результата нет вовсе) подпись — «Прервано».
 */

import * as React from "react"
import type { EnrichedPartState } from "@assistant-ui/react"
import { CheckIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { collapsePanel, field, mono, ShimmerLabel, SwapLabel } from "./surfaces"
import { formatRequest, formatResult, primaryArg, toolActiveLabel, toolLabel } from "./tool-meta"

/** Tool-call part из children-рендера MessagePrimitive (GroupedParts/Parts). */
export type ToolPart = Extract<EnrichedPartState, { type: "tool-call" }>

/**
 * @param part — tool-call часть сообщения
 * @param auto — вызов прошёл по allow-list треда («Always allow»), пометка в строке
 */
export function ToolCall({ part, auto = false }: { part: ToolPart; auto?: boolean }) {
  const running = part.result === undefined && part.approval === undefined && !part.isError
  const query = primaryArg(part.args)
  // Ошибку показываем сразу — пользователь не должен искать причину в развороте
  const [open, setOpen] = React.useState(false)
  const errored = part.isError === true

  return (
    <Collapsible
      data-slot="tool-call"
      open={open || errored}
      onOpenChange={setOpen}
      className="w-full max-w-sm"
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2 rounded-md py-1 text-[13.5px] text-muted-foreground outline-none transition-colors hover:text-foreground/90">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none" />
        <SwapLabel active={running ? 0 : 1} className="shrink-0 text-start whitespace-nowrap">
          <ShimmerLabel active={running} className="relative inline-block leading-none">
            {toolActiveLabel(part.toolName)}
          </ShimmerLabel>
          <>{toolLabel(part.toolName)}</>
        </SwapLabel>
        {query && (
          <span
            className={cn(
              mono,
              "min-w-0 truncate rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-foreground/70",
            )}
          >
            {query}
          </span>
        )}
        {auto && (
          <span className={cn(mono, "shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-muted-foreground")}>
            авто
          </span>
        )}
        <span className="ms-auto flex w-4 shrink-0 items-center justify-end">
          {errored ? (
            <TriangleAlertIcon className="size-3.5 text-destructive" />
          ) : (
            !running && <CheckIcon className="size-3.5 animate-in text-emerald-500 fade-in zoom-in-90 duration-200" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className={cn(field, "mt-2 overflow-hidden rounded-2xl text-xs")}>
          <div className="px-3.5 pt-2.5 pb-2">
            <p className={cn(mono, "mb-1 text-muted-foreground")}>Request</p>
            <p className="break-words font-mono text-muted-foreground">{formatRequest(part.args)}</p>
          </div>
          <div className="mx-3.5 h-px bg-foreground/[0.06]" />
          <div className="px-3.5 pt-2 pb-2.5">
            <p className={cn(mono, "mb-1 text-muted-foreground")}>Result</p>
            <p className={cn("break-words", errored ? "text-destructive" : "text-foreground/90")}>
              {formatResult(part.result)}
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Аккордеон серии подряд идущих tool-вызовов (AC7).
 *
 * `MessagePrimitive.GroupedParts` группирует соседние tool-call части в один
 * узел; без обёртки серия из пяти вызовов занимала бы пол-экрана. Свёрнутая
 * строка: «N вызовов инструментов» + chevron; разворот показывает детей
 * (готовые `ToolCall` из GroupedParts).
 */
export function ToolGroup({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Collapsible data-slot="tool-group" open={open} onOpenChange={setOpen} className="w-full max-w-sm">
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2 rounded-md py-1 text-[13.5px] text-muted-foreground outline-none transition-colors hover:text-foreground/90">
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none" />
        <span className="shrink-0 whitespace-nowrap">{count} вызовов инструментов</span>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="mt-1 flex flex-col gap-0.5 border-l border-border/60 pl-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
