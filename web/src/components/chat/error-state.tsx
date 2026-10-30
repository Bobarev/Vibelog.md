/**
 * Единый inline error-state чата (VL-264, AC9) — порт подхода
 * `elements/surfaces.tsx` (paper/field/mono) из ref-22.
 *
 * Зачем отдельный компонент: до VL-264 ошибка стрима дописывалась текстом
 * «Ошибка чата: …» в середину ответа, а ошибка инструмента — в `<pre>` под
 * карточкой. Теперь оба случая идут одной плашкой: иконка, заголовок, текст,
 * опциональная кнопка «Повторить».
 *
 * Кнопка «Повторить» осмысленна только для ошибки стрима (рантайм умеет
 * перезапустить run) — для ошибки инструмента её не показываем.
 */

import { TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { field, ghostButton, paper } from "./surfaces"

export function ChatErrorState({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry?: (() => void) | undefined
  className?: string
}) {
  return (
    <div
      role="alert"
      data-slot="chat-error"
      className={cn(paper, "flex w-full max-w-sm flex-col gap-2.5 rounded-[20px] p-4", className)}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-600/10 text-red-600 dark:bg-red-400/10 dark:text-red-400"
        >
          <TriangleAlertIcon className="size-4" />
        </span>
        <p className="text-[13.5px] font-medium">Ошибка</p>
      </div>
      <p className={cn(field, "rounded-xl px-3.5 py-2.5 text-[13px] break-words text-foreground/70")}>{message}</p>
      {onRetry && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            className={cn(ghostButton, "h-8 px-3.5 text-xs font-medium whitespace-nowrap")}
          >
            Повторить
          </button>
        </div>
      )}
    </div>
  )
}
