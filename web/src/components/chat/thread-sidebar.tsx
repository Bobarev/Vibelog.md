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
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { fetchModels, type ModelsData } from "@/components/settings/api"
import { setActiveModelId } from "./chat-runtime"
import { Plus } from "lucide-react"

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
 * Переключатель модели чата (VL-209): список из GET /api/models, выбор
 * пишется в module-state адаптера (setActiveModelId) — следующий POST
 * /api/chat уходит с model. Записи в settings.json НЕТ: это разовое
 * переопределение для чата (default в #/settings не меняется).
 * Секции models нет/сервер недоступен → селект не рендерится.
 */
function ModelSwitcher() {
  const [data, setData] = React.useState<ModelsData | null>(null)
  React.useEffect(() => {
    let cancelled = false
    fetchModels()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {
        // переключатель — не критично: прячем при недоступности
        if (!cancelled) setData({ default: null, available: [], providers: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data || data.available.length === 0) return null
  return (
    <div className="border-b px-3 py-2">
      <Select
        value={data.default ?? ""}
        onValueChange={(v) => {
          setActiveModelId(v)
          setData((prev) => (prev ? { ...prev, default: v } : prev))
        }}
      >
        <SelectTrigger className="h-8 w-full text-xs" aria-label="Модель чата">
          <SelectValue placeholder="Модель" />
        </SelectTrigger>
        <SelectContent>
          {data.available.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

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

  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 flex-col border-l bg-muted/30 md:flex",
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">Чаты</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onNewThread}
        >
          <Plus className="size-3.5" /> Новый
        </Button>
      </div>

      <ModelSwitcher />

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Треды чата">
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
    </aside>
  )
}
