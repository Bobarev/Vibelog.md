/**
 * Плашка прерванного прогона (VL-264, AC8) — порт
 * `packages/ui/src/components/react/assistant-ui/elements/stopped-run.tsx`
 * из ref-22.
 *
 * Когда run оборван (Stop, срабатывание лимита итераций/времени на сервере)
 * голого текста ошибки быть не должно: пользователь видит причину
 * (mono-чип) и может продолжить диалог одной кнопкой. Кнопка продолжения
 * приходит снаружи (`retry`) — она оборачивает ActionBarPrimitive.Reload,
 * повторяющий прогон; свой обработчик здесь не нужен и не дублируется.
 *
 * «Скрыть» убирает плашку локально: продолжающийся тред не должен держать
 * уведомление о старом обрыве.
 */

import * as React from "react"
import { SquareIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { field, mono } from "./surfaces"

export function StoppedRun({
  reason,
  retry,
  className,
}: {
  /** Причина остановки («Остановлено», «Превышен лимит итераций» и т.п.). */
  reason: string
  /** Кнопка продолжения (обычно ActionBarPrimitive.Reload asChild). */
  retry?: React.ReactNode
  className?: string
}) {
  const [hidden, setHidden] = React.useState(false)
  if (hidden) return null

  return (
    <div data-slot="stopped-run" className={cn("flex w-full max-w-sm flex-col gap-2", className)} role="status">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            field,
            mono,
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-muted-foreground",
          )}
        >
          <SquareIcon className="size-2.5 fill-current" />
          {reason}
        </span>

        <div className="ms-auto flex items-center gap-1">
          {retry}
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="flex h-7 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.96]"
          >
            Скрыть
          </button>
        </div>
      </div>
    </div>
  )
}
