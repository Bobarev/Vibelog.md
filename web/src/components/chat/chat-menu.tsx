/**
 * Меню чата (VL-408): пункт «Скопировать команду для бота».
 *
 * Зачем: диалог, начатый в веб-интерфейсе, нужно уметь продолжить в
 * Telegram-боте командой `/chat <chat-id>`. Набирать id вручную неудобно и
 * чревато опечатками — пункт меню копирует готовую строку в буфер обмена.
 *
 * Место — нижняя строка композера рядом с пикерами (VL-265): она видна и на
 * десктопе, и на мобильном, а отдельная шапка треда потребовала бы менять
 * каркас высот (lesson-112).
 *
 * Копирование: `navigator.clipboard` доступен только в secure context
 * (localhost — да). Если API нет или браузер отказал — показываем текст
 * команды в самом пункте, чтобы её можно было выделить руками: библиотеки
 * тостов в проекте нет, а молчаливый сбой хуже неудобства.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal } from "lucide-react"

/** Команда бота для продолжения треда в Telegram. */
export function botChatCommand(threadId: string): string {
  return `/chat ${threadId}`
}

/**
 * Меню чата. Без `threadId` (новый тред, сервер ещё не создал id) не
 * рендерится: копировать нечего.
 */
export function ChatMenu({ threadId }: { threadId?: string }) {
  /** Текст пункта: после неудачного копирования показывает саму команду. */
  const [fallback, setFallback] = React.useState<string | null>(null)

  if (!threadId) return null
  const command = botChatCommand(threadId)

  const copy = (): void => {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined
    if (!clipboard?.writeText) {
      setFallback(command)
      return
    }
    clipboard.writeText(command).then(
      () => setFallback(null),
      () => setFallback(command),
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label="Меню чата"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem onClick={copy} className="flex flex-col items-start gap-0.5">
          <span>{fallback ? "Скопируйте команду вручную" : "Скопировать команду для бота"}</span>
          <span className="truncate text-xs text-muted-foreground">{fallback ?? command}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
