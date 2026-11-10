/**
 * Карточка консультации другой роли (VL-409) — режим `subagents.display: widget`.
 *
 * Зачем два режима: `inline` (дефолт) переиспользует обычный tool-call с
 * раскрытием Request/Result — дёшево и привычно; `widget` показывает
 * консультацию заметной карточкой (заголовок «Консультация: <роль>», вопрос,
 * ответ), как карточка создания задачи. Пользователь выбирает в
 * `.vibelog/settings.json` → `subagents.display`.
 *
 * Данные приходят data-частью `chat-subagent` (событие `subagent` сервера),
 * поэтому карточка переживает F5: восстановление истории синтезирует ту же
 * часть из jsonl (см. `web/src/lib/chat-threads.ts`).
 */

import * as React from "react"
import { ChevronRightIcon, MessagesSquareIcon } from "lucide-react"

import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { CollapseContent, field, mono, paper } from "./surfaces"

/** Данные data-части `chat-subagent` (зеркало события `subagent` сервера). */
export interface SubagentPartData {
  personaId?: unknown
  personaLabel?: unknown
  question?: unknown
  answer?: unknown
  tokens?: unknown
  /** VL-415: ответ обрезан по `subagents.max_answer_chars`. */
  truncated?: unknown
  /** VL-415: длина полного ответа до обрезки. */
  answerChars?: unknown
}

/** Токены консультации (для подписи «N токенов»). */
function tokensTotal(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const total = (value as { total?: unknown }).total
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : undefined
}

export function SubagentCard({ data }: { data: SubagentPartData | undefined }) {
  const label = typeof data?.personaLabel === "string" ? data.personaLabel : ""
  const question = typeof data?.question === "string" ? data.question : ""
  const answer = typeof data?.answer === "string" ? data.answer : ""
  const total = tokensTotal(data?.tokens)
  // VL-415: пометка об обрезке — в карточке, а не только в тексте для модели.
  const truncated = data?.truncated === true
  const answerChars = typeof data?.answerChars === "number" ? data.answerChars : undefined
  const [open, setOpen] = React.useState(false)

  if (answer === "" && question === "") return null

  return (
    <Collapsible
      data-slot="subagent-card"
      open={open}
      onOpenChange={setOpen}
      className={cn(paper, "w-full max-w-sm rounded-[20px] p-3.5")}
    >
      <CollapsibleTrigger className="group/trigger flex w-full items-start gap-2.5 text-start outline-none">
        <span
          aria-hidden
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-muted-foreground"
        >
          <MessagesSquareIcon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] break-words">
            <span className="text-muted-foreground">Консультация: </span>
            {label !== "" ? label : "роль"}
          </span>
          <span className={cn(mono, "text-muted-foreground")}>
            {total !== undefined ? `консультант · ${total} токенов` : "консультант"}
          </span>
        </span>
        <ChevronRightIcon className="ms-auto mt-1 size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapseContent className="outline-none">
        <div className={cn(field, "mt-2 overflow-hidden rounded-2xl text-xs")}>
          <div className="px-3.5 pt-2.5 pb-2">
            <p className={cn(mono, "mb-1 text-muted-foreground")}>Вопрос</p>
            <p className="break-words text-muted-foreground">{question !== "" ? question : "—"}</p>
          </div>
          <div className="mx-3.5 h-px bg-foreground/[0.06]" />
          <div className="px-3.5 pt-2 pb-2.5">
            <p className={cn(mono, "mb-1 text-muted-foreground")}>Ответ</p>
            <p className="break-words text-foreground/90">{answer !== "" ? answer : "—"}</p>
            {truncated && (
              <p className={cn(mono, "mt-1.5 text-muted-foreground")}>
                {answerChars !== undefined
                  ? `ответ обрезан по лимиту subagents.max_answer_chars (полный — ${answerChars} символов)`
                  : "ответ обрезан по лимиту subagents.max_answer_chars"}
              </p>
            )}
          </div>
        </div>
      </CollapseContent>
    </Collapsible>
  )
}
