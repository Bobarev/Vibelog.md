/**
 * Write-инструмент в чате — карточка подтверждения (VL-264, AC5/AC6) — порт
 * `packages/ui/src/components/react/assistant-ui/elements/approval-card.tsx`
 * из ref-22.
 *
 * Структура как в референсе: бумажная карточка, иконка в плашке, title/subtitle,
 * description, mono-команда (для write_file — путь), блок details
 * (label/value из аргументов), футер:
 * - state="request" → Deny / Always allow / Allow once;
 * - после решения — receipt-строка (`role="status"`, fade-in): Approved, running
 *   (спиннер) / Finished (галочка) / Denied (крестик), с фокусом на 결과 —
 *   `useReceiptFocus` (ref: elements/receipt-focus.ts): кнопки исчезают, фокус
 *   теряется, и без перевода фокуса скринридер не узнал бы об успехе.
 *
 * «Always allow» (VL-264): разрешение сохраняется на СЕРВЕРЕ для треда
 * (POST /api/chat/threads/:id/allow), затем решение уходит обычным
 * `respondToApproval({approved:true})` — своего поля у этого API нет, поэтому
 * `always` передаётся отдельным запросом до resume. Пока POST не завершился,
 * кнопки заблокированы (иначе решение уйдёт без сохранённого разрешения).
 * Отзыв — кнопка в receipt-строке (DELETE с тем же tool), доступна и после
 * перезагрузки треда.
 *
 * Fallback-классификация read/write не нужна: карточку рендерит только
 * write-вызов (у него есть `part.approval` либо он разрешён allow-list'ом).
 */

import * as React from "react"
import { CheckIcon, Loader2Icon, TerminalIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { addAlwaysAllowed, getActiveThreadId, isToolAlwaysAllowed, removeAlwaysAllowed } from "./chat-runtime"
import { field, ghostButton, inkButton, mono, paper } from "./surfaces"
import { primaryArg, requestDetails, toolLabel } from "./tool-meta"
import type { ToolPart } from "./tool-call"

/** Состояние карточки (ref: ApprovalState). */
type ApprovalState = "request" | "running" | "done" | "denied"

/** Текст receipt-строки по состоянию (русский вариант ref-текстов). */
const RECEIPT_TEXT: Record<Exclude<ApprovalState, "request">, string> = {
  running: "Разрешено, выполняется",
  done: "Выполнено",
  denied: "Отклонено",
}

/**
 * Фокус на receipt-строке после решения (ref: elements/receipt-focus.ts).
 *
 * Когда кнопки решения исчезают, DOM-фокус улетает в body — скринридер не
 * сообщит о результате. Запоминаем, был ли фокус внутри карточки, и переводим
 * его на receipt (`preventScroll`, чтобы лента не дёргалась).
 */
function useReceiptFocus<T extends HTMLElement>() {
  const focusedRef = React.useRef<HTMLElement | null>(null)
  const receiptRef = React.useRef<T | null>(null)

  React.useLayoutEffect(() => {
    const focused = focusedRef.current
    if (!focused || focused.isConnected) return
    focusedRef.current = null
    const doc = focused.ownerDocument
    if (doc.activeElement === doc.body) receiptRef.current?.focus({ preventScroll: true })
  })

  const focusHandlers = {
    onFocusCapture: (event: React.FocusEvent) => {
      focusedRef.current = event.target as HTMLElement
    },
    onBlurCapture: (event: React.FocusEvent) => {
      const target = event.target as HTMLElement
      const next = (event.relatedTarget as HTMLElement | null) ?? event.currentTarget.ownerDocument.activeElement
      if (target.isConnected && !event.currentTarget.contains(next)) focusedRef.current = null
    },
  }
  return { receiptRef, focusHandlers }
}

/** Состояние карточки из tool-call part'а. */
function approvalStateOf(part: ToolPart): ApprovalState {
  const approved = part.approval?.approved
  if (approved === false) return "denied"
  if (approved === true) return part.result === undefined ? "running" : "done"
  if (part.approval?.resolution !== undefined) return "denied"
  // Part без approval (allow-list «Always allow» или старый jsonl): решение
  // уже принято заранее — показываем исполнение/результат.
  if (part.result === undefined) return part.approval === undefined ? "running" : "request"
  return part.isError ? "denied" : "done"
}

export function ApprovalCard({
  part,
  auto = false,
  onError,
}: {
  part: ToolPart
  /** Вызов разрешён заранее (allow-list треда) — пометка в подзаголовке. */
  auto?: boolean
  /** Ошибка сохранения разрешения (UI показывает текст под карточкой). */
  onError?: ((message: string) => void) | undefined
}) {
  const state = approvalStateOf(part)
  const { receiptRef, focusHandlers } = useReceiptFocus<HTMLDivElement>()
  const [busy, setBusy] = React.useState<"allow" | "deny" | "always" | "revoke" | null>(null)
  const [allowed, setAllowed] = React.useState(() => isToolAlwaysAllowed(part.toolName))
  const [error, setError] = React.useState<string | null>(null)

  const args = part.args as Record<string, unknown>
  const details = requestDetails(part.toolName, part.args)
  const description = typeof args.description === "string" ? args.description : undefined
  const command = part.toolName === "write_file" && typeof args.path === "string" ? args.path : undefined
  const subtitleParts = [primaryArg(part.args), allowed || auto ? "разрешено заранее" : ""].filter(Boolean)

  /** Решение по вызову: отправляем в рантайм (resume → сервер продолжает ход). */
  const decide = async (approved: boolean, mode: "allow" | "deny") => {
    setBusy(mode)
    setError(null)
    try {
      await part.respondToApproval(
        approved ? { approved: true } : { approved: false, reason: "Отклонено в чате" },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      onError?.(message)
    } finally {
      setBusy(null)
    }
  }

  /** «Always allow»: сначала серверное разрешение, затем обычный Allow. */
  const allowAlways = async () => {
    const threadId = getActiveThreadId()
    setBusy("always")
    setError(null)
    try {
      if (threadId) {
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}/allow`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: part.toolName }),
        })
        if (!res.ok) throw new Error(`сервер ответил ${res.status}`)
      }
      // Локальная пометка: карточки этого инструмента в треде больше не спрашивают
      addAlwaysAllowed(part.toolName)
      setAllowed(true)
      await part.respondToApproval({ approved: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`Не удалось сохранить разрешение: ${message}`)
      onError?.(message)
    } finally {
      setBusy(null)
    }
  }

  /** Отзыв разрешения: снимаем с сервера и локально. */
  const revoke = async () => {
    const threadId = getActiveThreadId()
    setBusy("revoke")
    setError(null)
    try {
      if (threadId) {
        const res = await fetch(
          `/api/chat/threads/${encodeURIComponent(threadId)}/allow?tool=${encodeURIComponent(part.toolName)}`,
          { method: "DELETE" },
        )
        if (!res.ok) throw new Error(`сервер ответил ${res.status}`)
      }
      removeAlwaysAllowed(part.toolName)
      setAllowed(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`Не удалось отозвать разрешение: ${message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      {...focusHandlers}
      role="group"
      data-slot="approval-card"
      className={cn(paper, "flex w-full max-w-sm flex-col gap-3.5 rounded-[20px] p-4")}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground"
        >
          <TerminalIcon className="size-4" />
        </span>
        <div className="flex flex-col">
          <p className="text-[13.5px] font-medium">{toolLabel(part.toolName)}</p>
          <p className="text-xs text-muted-foreground">
            {subtitleParts.length > 0 ? subtitleParts.join(" · ") : part.toolName}
          </p>
        </div>
      </div>

      {description && <p className="text-[13px] text-foreground/60">{description}</p>}

      {command && (
        <div className={cn(field, "rounded-xl px-3.5 py-2.5 font-mono text-xs text-foreground/70")}>{command}</div>
      )}

      {details.length > 0 && (
        <dl className={cn(field, "flex flex-col gap-2 rounded-xl px-3.5 py-2.5")}>
          {details.map((detail, index) => (
            <div key={`${detail.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 text-xs">
              <dt className={cn(mono, "text-muted-foreground")}>{detail.label}</dt>
              <dd className="break-words text-foreground/80">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
        {state === "request" ? (
          <>
            <button
              type="button"
              data-slot="approval-card-deny"
              disabled={busy !== null}
              onClick={() => void decide(false, "deny")}
              className={cn(ghostButton, "h-8 px-3.5 text-xs font-medium whitespace-nowrap", busy && "opacity-50")}
            >
              {busy === "deny" ? <Loader2Icon className="size-3.5 animate-spin" /> : "Отклонить"}
            </button>
            <button
              type="button"
              data-slot="approval-card-always-allow"
              disabled={busy !== null}
              onClick={() => void allowAlways()}
              className={cn(ghostButton, "h-8 px-3.5 text-xs font-medium whitespace-nowrap", busy && "opacity-50")}
            >
              {busy === "always" ? <Loader2Icon className="size-3.5 animate-spin" /> : "Разрешать всегда"}
            </button>
            <button
              type="button"
              data-slot="approval-card-allow-once"
              disabled={busy !== null}
              onClick={() => void decide(true, "allow")}
              className={cn(
                inkButton,
                "flex h-8 items-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap",
                busy && "opacity-50",
              )}
            >
              {busy === "allow" ? <Loader2Icon className="size-3.5 animate-spin" /> : "Разрешить"}
            </button>
          </>
        ) : (
          <div className="flex w-full items-center gap-2">
            <div
              key={state}
              ref={receiptRef}
              tabIndex={-1}
              role="status"
              className="flex animate-in items-center gap-2 text-xs text-muted-foreground fade-in duration-300 motion-reduce:animate-none"
            >
              {state === "running" ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />
                  {RECEIPT_TEXT.running}
                </>
              ) : state === "denied" ? (
                <>
                  <XIcon className="size-3.5 text-muted-foreground" />
                  {RECEIPT_TEXT.denied}
                </>
              ) : (
                <>
                  <CheckIcon className="size-3.5 text-emerald-500" />
                  {RECEIPT_TEXT.done}
                </>
              )}
            </div>
            {(allowed || auto) && state !== "denied" && (
              <button
                type="button"
                data-slot="approval-card-revoke"
                disabled={busy !== null}
                onClick={() => void revoke()}
                className={cn(ghostButton, "ms-auto h-7 px-2.5 text-[11px] whitespace-nowrap")}
              >
                {busy === "revoke" ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  <>Разрешено всегда · отозвать</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
