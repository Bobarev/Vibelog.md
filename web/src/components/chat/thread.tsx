/**
 * Страница и Thread-UI чата (VL-204): минимальный тред из примитивов
 * assistant-ui (паттерн ref-22: apps/docs/content/docs/primitives/thread.mdx)
 * на наших shadcn-компонентах.
 *
 * Рендер частей (MessagePrimitive.Parts, children API):
 * - text → MarkdownView (списки/код в ответах LLM);
 * - tool-call backlog_create_task → карточка «Создать задачу» с
 *   Allow/Deny (approval-gate: part.respondToApproval, local-runtime.mdx
 *   §Approval gates) до решения, статус «Создана/Отклонена» после;
 * - tool-call search/view → компактная строка с результатом.
 */

import { ArrowUp, Bot, Check, ListChecks, MessageSquare, PlusCircle, Search, X } from "lucide-react"

import { MarkdownView } from "@/lib/markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type EnrichedPartState,
} from "@assistant-ui/react"
import { ChatRuntimeProvider } from "./chat-runtime"

/** Утилита: тип tool-call part из children-рендера. */
type ToolPart = Extract<EnrichedPartState, { type: "tool-call" }>

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

/** Пузырь пользовательского сообщения. */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === "text" ? part.text : null)}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  )
}

/** Сообщение ассистента: markdown + tool-карточки. */
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="flex max-w-[85%] gap-2">
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 rounded-2xl bg-muted px-4 py-2.5 text-sm">
          <MessagePrimitive.Parts>{({ part }) => <PartView part={part} />}</MessagePrimitive.Parts>
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/** Тред: сообщения + композер. Высота — h-full (скролл внутри viewport). */
function ChatThread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <ThreadPrimitive.Empty>
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <MessageSquare className="size-8" />
            <p className="text-sm font-medium">Чат с ассистентом проекта</p>
            <p className="max-w-md text-xs">
              Спросите про задачи, планы и документы. Создание задачи ассистент подтвердит у вас
              перед записью в backlog.
            </p>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages>
          {({ message }) =>
            message.role === "user" ? <UserMessage /> : <AssistantMessage />
          }
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 pt-2">
          <ComposerPrimitive.Root className="flex w-full items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm">
            <ComposerPrimitive.Input
              rows={1}
              name="chat-message"
              placeholder="Спросите по проекту… (Enter — отправить)"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
            />
            <ComposerPrimitive.Send asChild>
              <Button size="icon" className="size-8 shrink-0 rounded-full">
                <ArrowUp className="size-4" />
              </Button>
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}

/** Страница #/chat: runtime-провайдер + тред. */
export function ChatPage() {
  return (
    <ChatRuntimeProvider>
      <div className="h-full">
        <ChatThread />
      </div>
    </ChatRuntimeProvider>
  )
}
