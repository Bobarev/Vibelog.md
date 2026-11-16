/**
 * Строка «Запомнил: …» в ленте чата (VL-402) — видимость записи памяти персоны.
 *
 * Зачем это вообще нужно: инструмент `memory_remember` пишет в память роли
 * СРАЗУ, без карточки Allow/Deny (иначе разговор превратился бы в тыканье).
 * Контроль пользователя обеспечивается именно этой строкой: он видит, что
 * модель запомнила, и может убрать запись одной кнопкой. Без неё память была
 * бы «неконтролируемой» — ровно та претензия, из-за которой задача появилась.
 *
 * Состояние отмены живёт в двух местах:
 * - sidecar треда `<threadId>.memory.json` (сервер) — после F5 кнопка должна
 *   быть неактивна, если запись уже удалена;
 * - локальный useState — мгновенная реакция на нажатие без перезагрузки.
 *
 * Удаление идёт по ТЕКСТУ, а не по номеру: номера записей сдвигаются после
 * удаления соседней, и «Убрать» на второй карточке снесла бы не ту запись.
 */

import * as React from "react"
import { CheckIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  getActivePersonaId,
  getActiveThreadId,
  isMemoryRemoved,
  markMemoryRemoved,
} from "./chat-runtime"
import { field, ghostButton, mono, paper } from "./surfaces"

/** Данные data-части `chat-memory` (зеркало события `memory` сервера). */
export interface MemoryPartData {
  index?: unknown
  text?: unknown
  date?: unknown
  personaId?: unknown
  /** VL-419: метка роли — у записей консультанта она есть всегда. */
  personaLabel?: unknown
}

export function MemoryCard({ data }: { data: MemoryPartData | undefined }) {
  const text = typeof data?.text === "string" ? data.text : ""
  const date = typeof data?.date === "string" ? data.date : ""
  const personaId = typeof data?.personaId === "string" ? data.personaId : ""
  const personaLabel = typeof data?.personaLabel === "string" ? data.personaLabel : ""
  // VL-419: запись чужой роли (консультанта) — «<Роль> запомнил: …»: карточка
  // может жить в треде другой роли, и подпись «Запомнил» приписала бы
  // наблюдение Психолога Помощнику.
  const foreign = personaId !== "" && personaId !== getActivePersonaId()
  const who = foreign ? `${personaLabel !== "" ? personaLabel : personaId} запомнил` : "Запомнил"
  // Начальное состояние — из sidecar треда (после F5 запись уже могла быть убрана)
  const [removed, setRemoved] = React.useState(() => (text !== "" ? isMemoryRemoved(text) : false))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (text === "") return null

  const remove = async () => {
    const threadId = getActiveThreadId()
    if (!threadId) {
      setError("Не удалось определить тред — обновите страницу")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/chat/threads/${encodeURIComponent(threadId)}/memory/remove`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // VL-419: personaId уходит на сервер — «Убрать» удаляет запись из
          // ФАЙЛА ЭТОЙ роли (консультанта), а не роли треда. Без personaId
          // сервер по-прежнему берёт роль из треда (записи «Помощника»).
          body: JSON.stringify(personaId !== "" ? { text, personaId } : { text }),
        },
      )
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: unknown } | null
        throw new Error(
          typeof payload?.error === "string" ? payload.error : `сервер ответил ${res.status}`,
        )
      }
      markMemoryRemoved(text)
      setRemoved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-slot="memory-card"
      role="group"
      className={cn(paper, "flex w-full max-w-sm flex-col gap-2 rounded-[20px] p-3.5")}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] text-muted-foreground"
        >
          <CheckIcon className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13px] break-words">
            <span className="text-muted-foreground">{who}: </span>
            {text}
          </p>
          <p className={cn(mono, "text-muted-foreground")}>
            {removed ? "запись убрана из памяти" : date !== "" ? `память персоны · ${date}` : "память персоны"}
          </p>
        </div>
      </div>

      {!removed && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className={cn(
              field,
              "flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.07] hover:text-foreground/95 disabled:opacity-50",
            )}
          >
            <XIcon className="size-3" />
            Убрать
          </button>
        </div>
      )}

      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** Кнопка-призрак (для совместимости с общим стилем карточек). */
export const memoryGhostButton = ghostButton
