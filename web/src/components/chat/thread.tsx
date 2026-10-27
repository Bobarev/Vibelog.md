/**
 * Страница и Thread-UI чата (VL-204, реворк VL-207): тред из примитивов
 * assistant-ui (паттерн ref-22: perplexity.tsx / chatgpt.tsx — пустое
 * состояние с композером по центру, action bar на ховере, BranchPicker,
 * EditComposer, отмена стрима) на наших shadcn-компонентах.
 *
 * Восстановление треда (VL-207, hash-route только):
 * - `#/chat/<id>` — история подгружается с сервера (GET /api/chat/threads/:id)
 *   и уходит в initialMessages рантайма; новый тред НЕ создаётся;
 * - `#/chat` (без id) — подтягиваем последний тред списка (AC1: возврат на
 *   страницу чата) и уводим hash на него; пустой список → чистый тред;
 * - `#/chat/new` — явно новый пустой тред (кнопка «Новый» в сайдбаре);
 * - сервер создал тред (thread-событие) → hash переводится на #/chat/<id>
 *   без пересоздания рантайма (сравнение с loadedRef).
 *
 * Рендер частей (MessagePrimitive.Parts, children API):
 * - text → MarkdownView (списки/код в ответах LLM);
 * - tool-call backlog_create_task → карточка «Создать задачу» с
 *   Allow/Deny (approval-gate: part.respondToApproval, local-runtime.mdx
 *   §Approval gates) до решения, статус «Создана/Отклонена» после;
 * - tool-call search/view → компактная строка с результатом.
 */

import * as React from "react"

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type EnrichedPartState,
  type ThreadMessageLike,
} from "@assistant-ui/react"
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ListChecks,
  MessageSquare,
  Pencil,
  PlusCircle,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react"

import { MarkdownView } from "@/lib/markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { historyToMessages } from "@/lib/chat-threads"
import { useChatThreadId } from "@/lib/use-hash-route"
import { ChatRuntimeProvider } from "./chat-runtime"
import { ThreadSidebar, type ThreadSummary } from "./thread-sidebar"

/** Утилита: тип tool-call part из children-рендера. */
type ToolPart = Extract<EnrichedPartState, { type: "tool-call" }>

/** Ответ GET /api/chat/threads/:id. */
interface ThreadHistoryResponse {
  threadId: string
  messages: Parameters<typeof historyToMessages>[0]
}

/** Название инструмента для карточки (для незнакомых — само имя). */
const TOOL_LABELS: Record<string, string> = {
  backlog_create_task: "Создание задачи",
  backlog_search: "Поиск",
  backlog_view_task: "Просмотр задачи",
}

const TOOL_ICONS: Record<string, typeof Search> = {
  backlog_create_task: PlusCircle,
  backlog_search: Search,
  backlog_view_task: MessageSquare,
}

/** Карточка tool-call: approval-gate для create, статус для остальных. */
function ToolCallCard({ part }: { part: ToolPart }) {
  const Icon = TOOL_ICONS[part.toolName] ?? ListChecks
  const label = TOOL_LABELS[part.toolName] ?? part.toolName
  const args = part.args as Record<string, unknown>
  const pending = part.approval !== undefined && part.approval.approved === undefined

  // Основная строка: title/query задачи или инструмента
  const detail =
    typeof args.title === "string"
      ? args.title
      : typeof args.query === "string"
        ? args.query
        : typeof args.id === "string"
          ? args.id
          : ""

  // Результат: созданная задача (JSON с id), отказ, вывод поиска/просмотра
  let statusLine: string | null = null
  if (part.result !== undefined) {
    if (part.isError) {
      statusLine = typeof part.result === "object" && part.result && "error" in part.result
        ? String((part.result as { error: unknown }).error)
        : "Ошибка"
    } else if (part.toolName === "backlog_create_task") {
      const id =
        typeof part.result === "object" && part.result && "id" in part.result
          ? String((part.result as { id: unknown }).id)
          : null
      statusLine = id ? `Задача создана: ${id}` : "Задача создана"
    } else if (typeof part.result === "string") {
      statusLine = part.result
    } else {
      statusLine = JSON.stringify(part.result, null, 2)
    }
  }

  return (
    <div className="my-1.5 rounded-md border bg-muted/40 text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
        {!pending && part.result === undefined && part.approval?.approved === undefined && (
          <span className="ml-auto text-xs text-muted-foreground">выполняется…</span>
        )}
        {part.approval?.approved === true && part.result === undefined && (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600">
            <Check className="size-3.5" /> подтверждено
          </span>
        )}
        {part.approval?.approved === false && (
          <span className="ml-auto flex items-center gap-1 text-xs text-destructive">
            <X className="size-3.5" /> отклонено
          </span>
        )}
      </div>

      {/* Human-in-the-loop: Allow/Deny до решения (AC VL-204) */}
      {pending && (
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {typeof args.description === "string" && args.description
              ? args.description.slice(0, 160)
              : "Создать задачу?"}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void part.respondToApproval({ approved: false, reason: "Отклонено в чате" })}
            >
              <X className="size-3.5" /> Отклонить
            </Button>
            <Button size="sm" onClick={() => void part.respondToApproval({ approved: true })}>
              <Check className="size-3.5" /> Разрешить
            </Button>
          </div>
        </div>
      )}

      {/* Результат после завершения */}
      {!pending && statusLine !== null && (
        <div className="border-t px-3 py-2">
          <pre
            className={cn(
              "max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs",
              part.isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {statusLine}
          </pre>
        </div>
      )}
    </div>
  )
}

/** Одна часть сообщения (children API MessagePrimitive.Parts). */
function PartView({ part }: { part: EnrichedPartState }) {
  if (part.type === "text") {
    // синтетический пустой text-part во время старта run не рендерим
    if (!part.text) return null
    return <MarkdownView>{part.text}</MarkdownView>
  }
  if (part.type === "tool-call") return <ToolCallCard part={part} />
  return null
}

/** Иконка маленькой кнопки action bar (ref-22: ховер-появление). */
const ACTION_CLASS =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

/** Кнопка копирования текста сообщения. */
function CopyAction() {
  const [copied, setCopied] = React.useState(false)
  return (
    <ActionBarPrimitive.Copy asChild>
      <button
        type="button"
        className={ACTION_CLASS}
        aria-label="Копировать"
        // Copy сам пишет в буфер; локальное состояние — только для галочки
        onClick={() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </ActionBarPrimitive.Copy>
  )
}

/** Выбор ветки ответа (редактирование/повтор порождают ветки — ref-22). */
function BranchPicker() {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
    >
      <BranchPickerPrimitive.Previous className={ACTION_CLASS}>
        <ChevronLeft className="size-4" />
      </BranchPickerPrimitive.Previous>
      <span className="min-w-8 text-center">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next className={ACTION_CLASS}>
        <ChevronRight className="size-4" />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}

/** Inline-редактор сообщения (ref-22 chatgpt.tsx: composer в режиме edit). */
function EditComposer() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <ComposerPrimitive.Root className="w-full max-w-[85%] rounded-2xl border bg-background p-2 shadow-sm">
        <ComposerPrimitive.Input
          rows={2}
          className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
        />
        <div className="mt-1 flex justify-end gap-2">
          <ComposerPrimitive.Cancel asChild>
            <Button size="sm" variant="ghost">
              Отмена
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Сохранить</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

/** Пузырь пользовательского сообщения + Copy/Edit и ветка. */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        <div className="rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          <MessagePrimitive.Parts>
            {({ part }) => (part.type === "text" ? part.text : null)}
          </MessagePrimitive.Parts>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
          <ActionBarPrimitive.Root hideWhenRunning className="flex items-center gap-0.5">
            <CopyAction />
            <ActionBarPrimitive.Edit asChild>
              <button type="button" className={ACTION_CLASS} aria-label="Редактировать">
                <Pencil className="size-4" />
              </button>
            </ActionBarPrimitive.Edit>
          </ActionBarPrimitive.Root>
          <BranchPicker />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/** Сообщение ассистента: markdown + tool-карточки + Reload/Copy. */
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group/message flex justify-start">
      <div className="flex max-w-[92%] gap-2">
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="rounded-2xl bg-muted px-4 py-2.5 text-sm">
            <MessagePrimitive.Parts>{({ part }) => <PartView part={part} />}</MessagePrimitive.Parts>
          </div>
          <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
            <BranchPicker />
            <ActionBarPrimitive.Root hideWhenRunning className="flex items-center gap-0.5">
              <ActionBarPrimitive.Reload asChild>
                <button type="button" className={ACTION_CLASS} aria-label="Повторить ответ">
                  <RefreshCw className="size-4" />
                </button>
              </ActionBarPrimitive.Reload>
              <CopyAction />
            </ActionBarPrimitive.Root>
          </div>
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/** Композер: Send, либо Cancel во время стриминга (ref-22: ComposerPrimaryAction). */
function Composer({ placeholder }: { placeholder: string }) {
  return (
    <ComposerPrimitive.Root className="flex w-full items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:border-border/80">
      <ComposerPrimitive.Input
        rows={1}
        name="chat-message"
        placeholder={placeholder}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
      />
      <div className="relative size-8 shrink-0">
        {/* Стриминг: кнопка-квадрат отменяет текущий run */}
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel
            className="absolute inset-0 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            aria-label="Остановить"
          >
            <Square className="size-3.5 fill-current" />
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
        {/* Покой: отправка (disabled при пустом вводе — логика Send) */}
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button size="icon" className="size-8 rounded-full" aria-label="Отправить">
              <ArrowUp className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  )
}

/** Пустое состояние (ref-22 perplexity: заголовок + композер по центру). */
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[10vh]">
      <div className="w-full max-w-2xl">
        <p className="mb-6 text-center text-2xl leading-7">Чат с ассистентом проекта</p>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Спросите про задачи, планы и документы. Создание задачи ассистент подтвердит
          у вас перед записью в backlog.
        </p>
        <Composer placeholder="Спросите по проекту… (Enter — отправить)" />
      </div>
    </div>
  )
}

/** Тред: сообщения + композер. Высота — h-full (скролл внутри viewport). */
function ChatThread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.If empty>
        <EmptyState />
      </ThreadPrimitive.If>
      <ThreadPrimitive.If empty={false}>
        <ThreadPrimitive.Viewport
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          // автоскролл вниз при новом контенте и при восстановлении истории
          autoScroll
          scrollToBottomOnInitialize
        >
          <ThreadPrimitive.Messages>
            {({ message }) => {
              // режим редактирования (ref-22: composer вместо сообщения)
              if (message.composer.isEditing) return <EditComposer />
              if (message.role === "user") return <UserMessage />
              return <AssistantMessage />
            }}
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 pt-2">
            <div className="relative">
              <ThreadPrimitive.ScrollToBottom asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute -top-11 left-1/2 size-8 -translate-x-1/2 rounded-full shadow-md"
                  aria-label="Прокрутить вниз"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </ThreadPrimitive.ScrollToBottom>
              <Composer placeholder="Спросите по проекту… (Enter — отправить)" />
            </div>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.If>
    </ThreadPrimitive.Root>
  )
}

/** Спиннер загрузки истории треда. */
function LoadingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      <p className="text-sm">Загрузка треда…</p>
    </div>
  )
}

/** Ошибка загрузки: тред не найден / сеть. Кнопки — новый тред и повтор. */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-destructive">{message}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
        <Button size="sm" onClick={() => { window.location.hash = "#/chat/new" }}>
          Новый тред
        </Button>
      </div>
    </div>
  )
}

/** Состояние загрузки страницы чата. */
interface ChatLoadState {
  status: "loading" | "ready" | "error"
  /** Ошибка загрузки истории (status === 'error'). */
  error?: string
  /** initialMessages для рантайма (пусто — новый тред). */
  messages: ThreadMessageLike[]
  /**
   * id треда, загруженного в рантайм ('new'/null → undefined — сервер
   * создаст id при первом ходе). Хранится в state, а не в ref: значение
   * нужно в рендере (пропс провайдера), читать ref в рендере нельзя.
   */
  runtimeThreadId?: string
}

/**
 * Страница #/chat (VL-207): hash-роут треда, восстановление истории,
 * сайдбар тредов справа. Рантайм пересоздаётся (key) только при реальной
 * смене загруженного треда — thread-событие нового треда hash обновляет,
 * но рантайм не трогает (иначе оборвётся первый стрим).
 */
export function ChatPage() {
  const hashThreadId = useChatThreadId() // null | 'new' | id
  const [load, setLoad] = React.useState<ChatLoadState>({
    status: "loading",
    messages: [],
  })
  /** Ключ пересоздания рантайма: +1 при каждой реальной смене треда. */
  const [runtimeKey, setRuntimeKey] = React.useState(0)
  /** Для повтора загрузки (кнопка «Повторить»). */
  const [retry, setRetry] = React.useState(0)
  /**
   * id загруженного в рантайм треда ('new'/' — новый пустой). Синхронный
   * ref: onThreadCreated обновляет его ДО смены hash, чтобы эффект ниже
   * не принял «наш» hash-переход за внешнюю навигацию и не пересоздал
   * рантайм посреди стрима.
   */
  const loadedRef = React.useRef<string | null | undefined>(undefined)

  React.useEffect(() => {
    // Тред уже активен (в т.ч. только что созданный сервером) — не грузим
    if (hashThreadId === loadedRef.current) return
    let cancelled = false

    // Ошибка из async-веток ниже (fetch) — setState после await, не в
    // синхронном теле эффекта; подавление — паттерн documents-page load
    const failWith = (message: string) => {
      if (!cancelled) {
        setLoad({ status: "error", error: message, messages: [], runtimeThreadId: undefined })
      }
    }

    // Явно новый пустой тред
    if (hashThreadId === "new") {
      loadedRef.current = "new"
      // Реакция на смену hash-входа: сброс треда до следующего рендера
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoad({ status: "ready", messages: [], runtimeThreadId: undefined })
      setRuntimeKey(k => k + 1)
      return
    }

    // #/chat без id: подтянуть последний тред (AC1) или открыть чисто
    if (hashThreadId === null) {
      void (async () => {
        try {
          const res = await fetch("/api/chat/threads")
          if (!res.ok) throw new Error(`сервер ответил ${res.status}`)
          const list = (await res.json()) as ThreadSummary[]
          if (cancelled) return
          if (list.length > 0) {
            // редирект на последний тред — эффект перезапустится с его id
            window.location.hash = `#/chat/${list[0].threadId}`
            return
          }
          loadedRef.current = null
          setLoad({ status: "ready", messages: [], runtimeThreadId: undefined })
          setRuntimeKey(k => k + 1)
        } catch (err) {
          failWith(`Не удалось подобрать последний тред: ${err instanceof Error ? err.message : String(err)}`)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    // Существующий тред: подгрузить историю (AC1/AC4)
    const id = hashThreadId
    setLoad(prev => ({ status: "loading", messages: [], runtimeThreadId: prev.runtimeThreadId }))
    void (async () => {
      try {
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`)
        if (res.status === 404) {
          if (!cancelled) {
            loadedRef.current = undefined
            setLoad({ status: "error", error: "Тред не найден (возможно, удалён)", messages: [], runtimeThreadId: undefined })
          }
          return
        }
        if (!res.ok) throw new Error(`сервер ответил ${res.status}`)
        const data = (await res.json()) as ThreadHistoryResponse
        if (cancelled) return
        loadedRef.current = id
        setLoad({ status: "ready", messages: historyToMessages(data.messages), runtimeThreadId: id })
        setRuntimeKey(k => k + 1)
      } catch (err) {
        failWith(`Не удалось загрузить тред: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hashThreadId, retry])

  /**
   * Сервер создал новый тред → hash на #/chat/<id> без пересоздания
   * рантайма: loadedRef синхронно (guard эффекта), state — для пропса.
   */
  const handleThreadCreated = React.useCallback((id: string) => {
    loadedRef.current = id
    setLoad(prev => ({ ...prev, runtimeThreadId: id }))
    const target = `#/chat/${id}`
    if (window.location.hash !== target) window.location.hash = target
  }, [])

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        {load.status === "loading" && <LoadingState />}
        {load.status === "error" && (
          <ErrorState
            message={load.error ?? "Ошибка загрузки треда"}
            onRetry={() => setRetry(r => r + 1)}
          />
        )}
        {load.status === "ready" && (
          <ChatRuntimeProvider
            key={runtimeKey}
            threadId={load.runtimeThreadId}
            initialMessages={load.messages}
            onThreadCreated={handleThreadCreated}
          >
            <ChatThread />
          </ChatRuntimeProvider>
        )}
      </div>
      {/* Справа — список тредов (решение из комментария VL-207) */}
      <ThreadSidebar
        activeThreadId={typeof hashThreadId === "string" && hashThreadId !== "new" ? hashThreadId : load.runtimeThreadId ?? null}
        onNewThread={() => {
          window.location.hash = "#/chat/new"
        }}
      />
    </div>
  )
}
