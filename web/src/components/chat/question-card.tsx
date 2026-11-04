/**
 * Интерактивный вопрос `ask_user` в ленте чата (VL-330) — карточка вопроса с
 * готовыми вариантами и свободным вводом.
 *
 * Порт структуры `elements/question-flow` / `elements/option-list` из ref-22
 * (assistant-ui), переложенный на наши примитивы (`surfaces.tsx`): бумажная
 * карточка, иконка в плашке, вопрос заголовком, список вариантов, «свой
 * ответ» с текстовым полем, receipt-строка после решения.
 *
 * Состояние берётся из part'а, а не из локального useState: ответ живёт в
 * jsonl треда (синтетический tool-результат), поэтому после F5 карточка
 * восстанавливается уже отвеченной, а не «ждёт» ответ, который дан.
 *
 * Возобновление хода: кнопка ответа обёрнута в `ActionBarPrimitive.Reload` —
 * клик сначала кладёт ответ в module-state рантайма (`setPendingAnswer`),
 * затем Reload перезапускает run, и адаптер отправляет POST с полем `answer`
 * (тот же механизм, что «Продолжить» после лимита, VL-269).
 *
 * Доступность (AC7): `role="radiogroup"` + `role="radio"` с `aria-checked`,
 * стрелки вверх/вниз двигают фокус, Enter выбирает; receipt — `role="status"`
 * с `aria-live="polite"` и переводом фокуса (`useReceiptFocus` из
 * approval-card — переиспользуем, не копируем).
 */

import * as React from "react"
import { ActionBarPrimitive } from "@assistant-ui/react"
import { CheckIcon, HelpCircleIcon, Loader2Icon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { setPendingAnswer } from "./chat-runtime"
import { useReceiptFocus } from "./approval-card"
import { field, ghostButton, inkButton, mono, paper } from "./surfaces"
import type { ToolPart } from "./tool-call"

/** Один вариант ответа (зеркало AskUserOption на сервере). */
interface QuestionOption {
  id: string
  label: string
  description?: string
}

/** Разобранные аргументы вызова `ask_user` из part'а. */
interface QuestionArgs {
  question: string
  options: QuestionOption[]
  allowCustom: boolean
}

/** Ответ, уже записанный в jsonl (синтетический tool-результат). */
type AnswerResult =
  | { answer: { id: string; label: string } }
  | { answer: { custom: string } }
  | { answer: null; cancelled?: boolean; reason?: string; message?: string }

/** Разбор аргументов part'а: битые/чужие аргументы → null (карточку не рисуем). */
function questionArgsOf(part: ToolPart): QuestionArgs | null {
  const args = part.args as Record<string, unknown> | undefined
  if (!args || typeof args.question !== "string") return null
  const rawOptions = Array.isArray(args.options) ? args.options : []
  const options: QuestionOption[] = []
  for (const item of rawOptions) {
    if (typeof item !== "object" || item === null) continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== "string" || typeof o.label !== "string") continue
    options.push({
      id: o.id,
      label: o.label,
      ...(typeof o.description === "string" ? { description: o.description } : {}),
    })
  }
  if (options.length === 0) return null
  return {
    question: args.question,
    options,
    // allow_custom по умолчанию true (как на сервере)
    allowCustom: args.allow_custom !== false,
  }
}

/** Ответ из part.result (undefined — ответа ещё нет). */
function answerOf(part: ToolPart): AnswerResult | null {
  const result = part.result
  if (result === undefined || result === null) return null
  if (typeof result === "object" && "answer" in (result as Record<string, unknown>)) {
    return result as AnswerResult
  }
  return null
}

/** Текст receipt-строки по ответу. */
function receiptText(answer: AnswerResult): string {
  if (answer.answer === null) {
    return answer.reason === "expired" ? "Вопрос снят по таймауту" : "Вопрос снят"
  }
  if ("custom" in answer.answer) return `Ответ: ${answer.answer.custom}`
  return `Ответ: ${answer.answer.label}`
}

export function QuestionCard({ part }: { part: ToolPart }) {
  const args = questionArgsOf(part)
  const answer = answerOf(part)
  const { receiptRef, focusHandlers } = useReceiptFocus<HTMLDivElement>()
  const [custom, setCustom] = React.useState("")
  const [customOpen, setCustomOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  if (args === null) {
    // Аргументы не разобрались (битый jsonl) — показываем строку ошибки,
    // а не пустую карточку без вариантов.
    return (
      <div data-slot="question-card" role="group" className={cn(paper, "flex w-full max-w-sm flex-col gap-2 rounded-[20px] p-4")}>
        <p className="text-[13px] text-destructive">Вопрос повреждён: нет вариантов ответа</p>
      </div>
    )
  }

  const answered = answer !== null
  const cancelled = answer !== null && answer.answer === null

  /** Отправка ответа: module-state рантайма + Reload (перезапуск хода). */
  const submit = (payload: { optionId?: string; custom?: string }) => {
    setBusy(true)
    setPendingAnswer({ toolCallId: part.toolCallId, ...payload })
  }

  /** Стрелки вверх/вниз двигают фокус по вариантам (AC7). */
  const onOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const delta = event.key === "ArrowDown" ? 1 : -1
    const next = (index + delta + args.options.length) % args.options.length
    optionRefs.current[next]?.focus()
  }

  return (
    <div
      {...focusHandlers}
      role="group"
      data-slot="question-card"
      className={cn(paper, "flex w-full max-w-sm flex-col gap-3.5 rounded-[20px] p-4")}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground"
        >
          <HelpCircleIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-[13.5px] font-medium break-words">{args.question}</p>
          <p className="text-xs text-muted-foreground">
            {answered ? "Ответ получен" : "Нужен ваш ответ, чтобы продолжить"}
          </p>
        </div>
      </div>

      {!answered && (
        <>
          <div role="radiogroup" aria-label={args.question} className="flex flex-col gap-1.5">
            {args.options.map((option, index) => (
              <ActionBarPrimitive.Reload asChild key={option.id}>
                <button
                  type="button"
                  ref={el => {
                    optionRefs.current[index] = el
                  }}
                  role="radio"
                  aria-checked={false}
                  data-slot="question-card-option"
                  disabled={busy}
                  onClick={() => submit({ optionId: option.id })}
                  onKeyDown={event => onOptionKeyDown(event, index)}
                  className={cn(
                    field,
                    "flex w-full flex-col items-start gap-0.5 rounded-xl px-3.5 py-2.5 text-start outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-1 focus-visible:ring-foreground/20 disabled:opacity-50",
                  )}
                >
                  <span className="text-[13px] font-medium">{option.label}</span>
                  {option.description !== undefined && (
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  )}
                </button>
              </ActionBarPrimitive.Reload>
            ))}
          </div>

          {args.allowCustom && (
            <div className="flex flex-col gap-2">
              {customOpen ? (
                <>
                  <textarea
                    data-slot="question-card-custom"
                    value={custom}
                    onChange={event => setCustom(event.target.value)}
                    onKeyDown={event => {
                      // Enter отправляет, Shift+Enter — перенос строки (AC7)
                      if (event.key !== "Enter" || event.shiftKey) return
                      if ((event.nativeEvent as { isComposing?: boolean }).isComposing === true) return
                      event.preventDefault()
                      if (custom.trim() === "") return
                      submit({ custom: custom.trim() })
                    }}
                    rows={2}
                    placeholder="Свой ответ…"
                    className={cn(
                      field,
                      "w-full resize-none rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-foreground/20",
                    )}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCustomOpen(false)}
                      className={cn(ghostButton, "h-8 px-3.5 text-xs font-medium whitespace-nowrap")}
                    >
                      Отмена
                    </button>
                    <ActionBarPrimitive.Reload asChild>
                      <button
                        type="button"
                        data-slot="question-card-custom-send"
                        disabled={busy || custom.trim() === ""}
                        onClick={() => submit({ custom: custom.trim() })}
                        className={cn(
                          inkButton,
                          "flex h-8 items-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap",
                          (busy || custom.trim() === "") && "opacity-50",
                        )}
                      >
                        {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : "Отправить"}
                      </button>
                    </ActionBarPrimitive.Reload>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  data-slot="question-card-custom-toggle"
                  disabled={busy}
                  onClick={() => setCustomOpen(true)}
                  className={cn(ghostButton, "h-8 self-start px-3.5 text-xs font-medium whitespace-nowrap")}
                >
                  Свой ответ
                </button>
              )}
            </div>
          )}
        </>
      )}

      {answered && (
        <div
          key={receiptText(answer)}
          ref={receiptRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="flex animate-in items-center gap-2 text-xs text-muted-foreground fade-in duration-300 motion-reduce:animate-none"
        >
          {cancelled ? (
            <>
              <XIcon className="size-3.5 text-muted-foreground" />
              {receiptText(answer)}
            </>
          ) : (
            <>
              <CheckIcon className="size-3.5 text-emerald-500" />
              {receiptText(answer)}
            </>
          )}
        </div>
      )}

      {!answered && busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
          Отправляю ответ…
        </div>
      )}

      {!answered && !busy && (
        <p className={cn(mono, "text-muted-foreground")}>Стрелки — выбор, Enter — ответ</p>
      )}
    </div>
  )
}
