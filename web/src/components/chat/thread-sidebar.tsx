/**
 * Сайдбар тредов чата (VL-207) — СПРАВА от треда (решение из комментария:
 * слева занят основной app-sidebar, не конфликтовать).
 *
 * За образец ref-22 (perplexity.tsx / clone-thread-shell.tsx): список
 * «Chats», кнопка нового треда сверху, активный тред подсвечен, ховеры.
 * Данные — GET /api/chat/threads (метаданные без тел); клик ведёт на
 * hash-роут #/chat/<id> — смена треда без перезагрузки страницы.
 *
 * Список перечитывается при смене активного треда (после создания нового
 * файла на сервере) и по hashchange — дебаунсом, чтобы поймать момент,
 * когда runChat дописал user-сообщение в jsonl нового треда.
 *
 * VL-282: на мобильном (ширина < md = 768px) `aside` скрыт, тот же список
 * показывается в выезжающей панели — `ThreadSidebarSheet` на примитиве
 * `ui/sheet.tsx` (Radix Dialog: оверлей, Esc, focus-trap, кнопка закрытия).
 * Механизм `ui/sidebar` НЕ переиспользуется: SidebarProvider/useSidebar
 * держат одно глобальное состояние ЛЕВОГО app-sidebar (openMobile, cookie,
 * хоткей Ctrl/Cmd+B) — второй экземпляр подменил бы раскладку (lesson-72/73).
 * Свёрнутый вид (w-12) к мобильной панели неприменим: она всегда развёрнута.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { usePreferences } from "@/components/preferences"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PanelLeftIcon, Plus } from "lucide-react"

/** Метаданные треда (зеркало ChatSummary из src/web/api.ts). */
export interface ThreadSummary {
  threadId: string
  title: string
  updatedAt: string
  messageCount: number
}

/** Человекочитаемая дата треда: время для сегодняшних, иначе дата. */
function formatThreadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
}

/**
 * Данные списка тредов (VL-282): вынесены из разметки, потому что список
 * нужен двум представлениям — десктопному `aside` и мобильной панели.
 */
function useThreadList(activeThreadId: string | null) {
  const [threads, setThreads] = React.useState<ThreadSummary[]>([])
  const [failed, setFailed] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/chat/threads")
      if (!res.ok) throw new Error(String(res.status))
      setThreads((await res.json()) as ThreadSummary[])
      setFailed(false)
    } catch {
      // список — не критично для чтения треда: показываем пустоту с пометкой
      setFailed(true)
    }
  }, [])

  React.useEffect(() => {
    // Загрузка списка сразу при маунте/смене треда: setState уходят
    // в async-продолжение refresh (паттерн lessons-page VL-174)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    // Смена треда: jsonl нового треда может дописываться — повторяем через
    // паузу, чтобы подхватить файл, созданный в момент первого хода
    const t = window.setTimeout(() => void refresh(), 600)
    return () => window.clearTimeout(t)
  }, [refresh, activeThreadId])

  return { threads, failed }
}

/**
 * Список тредов (общий для `aside` и мобильной панели).
 *
 * `collapsed` есть только у десктопного сайдбара: свёрнутый `nav` гасится
 * через opacity + inert, чтобы ссылки не ловили фокус клавиатурой.
 * `onSelect` вызывается после клика по треду — мобильная панель по нему
 * закрывается (hash меняется самой ссылкой, AC3).
 */
function ThreadListNav({
  threads,
  failed,
  activeThreadId,
  collapsed = false,
  onSelect,
}: {
  threads: ThreadSummary[]
  failed: boolean
  activeThreadId: string | null
  collapsed?: boolean
  onSelect?: () => void
}) {
  return (
    <nav
      className={cn(
        "min-h-0 flex-1 overflow-y-auto p-2 transition-opacity duration-150",
        collapsed && "pointer-events-none opacity-0",
      )}
      aria-label="Треды чата"
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      {failed && (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          Не удалось загрузить список тредов
        </p>
      )}
      {!failed && threads.length === 0 && (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          Тредов пока нет — задайте первый вопрос
        </p>
      )}
      {threads.map(t => {
        const active = t.threadId === activeThreadId
        return (
          <a
            key={t.threadId}
            href={`#/chat/${t.threadId}`}
            className={cn(
              "mb-1 block rounded-md px-2.5 py-2 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            // подсветка активного треда читается из aria-current
            aria-current={active ? "true" : undefined}
            onClick={onSelect}
          >
            <span className="block truncate">{t.title}</span>
            <span className="mt-0.5 block text-xs opacity-70">
              {formatThreadDate(t.updatedAt)}
              {t.messageCount > 0 && ` · ${t.messageCount} сообщ.`}
            </span>
          </a>
        )
      })}
    </nav>
  )
}

/** Кнопка «Новый тред» (в свёрнутом виде — иконка, в развёрнутом — с текстом). */
function NewThreadButton({
  collapsed,
  onNewThread,
}: {
  collapsed: boolean
  onNewThread: () => void
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn(
        "h-7 gap-1 overflow-hidden px-2 text-xs transition-opacity duration-200",
        collapsed && "hidden",
      )}
      aria-label="Новый тред"
      onClick={onNewThread}
    >
      <Plus className="size-3.5 shrink-0" />
      <span>Новый</span>
    </Button>
  )
}

/** Десктопный сайдбар тредов (ширина ≥ md), поведение VL-263 сохранено. */
export function ThreadSidebar({
  activeThreadId,
  onNewThread,
  className,
}: {
  /** id треда из hash — для подсветки активного пункта. */
  activeThreadId: string | null
  /** Клик «Новый тред» → hash #/chat/new. */
  onNewThread: () => void
  className?: string
}) {
  // Свёрнутость живёт в preferences (VL-263): компонент размонтируется при
  // уходе с #/chat, локальный state потерялся бы при переходах
  const { values, setPreference } = usePreferences()
  const collapsed = values.chat_threads_collapsed
  const { threads, failed } = useThreadList(activeThreadId)

  return (
    <aside
      className={cn(
        // Статичный сайдбар (VL-263): высота от каркаса, скролл — только в nav
        "hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-l bg-muted/30 transition-[width] duration-200 md:flex",
        collapsed ? "w-12" : "w-64",
        className,
      )}
      data-state={collapsed ? "collapsed" : "expanded"}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b px-2">
        <div className="flex min-w-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label={collapsed ? "Развернуть список чатов" : "Свернуть список чатов"}
                onClick={() => setPreference("chat_threads_collapsed", !collapsed)}
              >
                <PanelLeftIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {collapsed ? "Развернуть список чатов" : "Свернуть список чатов"}
            </TooltipContent>
          </Tooltip>
          <span
            className={cn(
              "overflow-hidden text-sm font-medium transition-[max-width,opacity] duration-200",
              collapsed ? "max-w-0 opacity-0" : "max-w-24 opacity-100",
            )}
          >
            Чаты
          </span>
        </div>
        <NewThreadButton collapsed={collapsed} onNewThread={onNewThread} />
      </div>

      {/* Свёрнутый вид: широкие контролы не влезают в w-12 — «+» отдельной
          строкой под шапкой (паттерн ref-22: newThread живёт вне шапки) */}
      {collapsed && (
        <div className="flex shrink-0 justify-center border-b py-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Новый тред"
            onClick={onNewThread}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      )}

      <ThreadListNav
        threads={threads}
        failed={failed}
        activeThreadId={activeThreadId}
        collapsed={collapsed}
      />
    </aside>
  )
}

/**
 * Мобильный список тредов (VL-282): выезжающая панель справа на `< md`.
 *
 * Тело вынесено отдельным компонентом: Radix монтирует `SheetContent`
 * только при `open`, поэтому `useThreadList` внутри перезагружает список
 * при каждом открытии — панель показывает свежие треды.
 * Кнопки сворачивания здесь нет: свёрнутый w-12 в панели бессмыслен (AC4).
 */
function ThreadSheetBody({
  activeThreadId,
  onNewThread,
  onClose,
}: {
  activeThreadId: string | null
  onNewThread: () => void
  onClose: () => void
}) {
  const { threads, failed } = useThreadList(activeThreadId)

  return (
    <>
      {/* pr-12 — место под штатную крестик-кнопку SheetContent (top-3 right-3),
          чтобы она не наезжала на «Новый» */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b px-2 pr-12">
        <span className="pl-2 text-sm font-medium">Чаты</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          aria-label="Новый тред"
          onClick={() => {
            // Порядок важен: сначала закрываем панель, затем уводим hash —
            // иначе Sheet остался бы открытым поверх нового треда (AC3)
            onClose()
            onNewThread()
          }}
        >
          <Plus className="size-3.5 shrink-0" />
          <span>Новый</span>
        </Button>
      </div>
      <ThreadListNav
        threads={threads}
        failed={failed}
        activeThreadId={activeThreadId}
        onSelect={onClose}
      />
    </>
  )
}

/**
 * Выезжающая панель тредов для мобильного (VL-282).
 *
 * Доступность — целиком средствами Radix Dialog/Sheet: закрытие по Esc и
 * клику по оверлею, focus-trap, возврат фокуса на кнопку открытия (AC5).
 * `SheetTitle`/`SheetDescription` обязательны (иначе Radix ругается в
 * консоль и accessible name пустой), поэтому они sr-only.
 */
export function ThreadSidebarSheet({
  open,
  onOpenChange,
  activeThreadId,
  onNewThread,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeThreadId: string | null
  onNewThread: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* md:hidden — страховка: на десктопе панель не должна появляться вовсе */}
      <SheetContent side="right" className="w-72 max-w-[85vw] gap-0 p-0 md:hidden">
        <SheetTitle className="sr-only">Треды чата</SheetTitle>
        <SheetDescription className="sr-only">
          Список тредов чата. Выбор треда закрывает панель.
        </SheetDescription>
        <ThreadSheetBody
          activeThreadId={activeThreadId}
          onNewThread={onNewThread}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
