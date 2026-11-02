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
 * Рендер частей (MessagePrimitive.GroupedParts, VL-264 — как ref-22):
 * - text → MarkdownView (список/код в ответах LLM);
 * - tool-call write-операции (isWriteOperation: create/update/write_file/…)
 *   → ApprovalCard (порт elements/approval-card.tsx): Deny / Always allow /
 *   Allow once, затем receipt-статус (approval-gate: part.respondToApproval);
 * - tool-call read-операции → ToolCall (порт elements/tool-call.tsx):
 *   свёрнутая строка, разворот с Request/Result;
 * - подряд идущие tool-call части схлопываются в ToolGroup (аккордеон) —
 *   groupPartByType + MessagePrimitive.GroupedParts (AC7). Write-вызовы в
 *   группу не попадают: активная карточка подтверждения не должна прятаться.
 * - data-часть chat-error (ошибка стрима) → ChatErrorState (AC9).
 */

import * as React from "react"

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
  useAui,
  useAuiState,
  type EnrichedPartState,
  type ThreadMessageLike,
} from "@assistant-ui/react"
import {
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  PanelLeftIcon,
  Pencil,
  RefreshCw,
  Square,
} from "lucide-react"

import { MarkdownView } from "@/lib/markdown"
import { Button } from "@/components/ui/button"
import { historyToMessages } from "@/lib/chat-threads"
import type { ThreadUsageView } from "@/lib/chat-usage"
import { useChatThreadId } from "@/lib/use-hash-route"
import { useIsMobile } from "@/hooks/use-mobile"
import { ApprovalCard } from "./approval-card"
import { CHAT_ERROR_PART, CHAT_TRUNCATED_PART, ChatRuntimeProvider, getActivePersonaId } from "./chat-runtime"
import { ChatErrorState } from "./error-state"
import { ModelPicker, PersonaBadge, PersonaPicker } from "./pickers"
import { StoppedRun } from "./stopped-run"
import { ToolCall, ToolGroup, type ToolPart } from "./tool-call"
import { isWriteTool } from "./tool-meta"
import { ThreadSidebar, ThreadSidebarSheet, type ThreadSummary } from "./thread-sidebar"
import { UsageBar } from "./usage-bar"

/** Ответ GET /api/chat/threads/:id (VL-264: + allowList, VL-283: + persona). */
interface ThreadHistoryResponse {
  threadId: string
  messages: Parameters<typeof historyToMessages>[0]
  allowList?: string[]
  /** Роль, зафиксированная за тредом (null — тред ещё пуст). */
  persona?: string | null
  /** Расход токенов треда (VL-313, null — тред без ходов). */
  usage?: ThreadUsageView | null
}

/**
 * Флаг «вызов разрешён allow-list'ом треда» (VL-264).
 *
 * Поле `auto` не входит в ToolCallMessagePart, поэтому едет в
 * `providerMetadata.vibelog.auto` — свободный слот протокола: клиент
 * (chat-runtime при tool_start{auto}, historyToMessages при восстановлении)
 * помечает так разрешённые заранее вызовы.
 */
function isAutoAllowed(part: ToolPart): boolean {
  const meta = part.providerMetadata as { vibelog?: { auto?: unknown } } | undefined
  return meta?.vibelog?.auto === true
}

/**
 * Группировка tool-call частей (VL-264, AC7): подряд идущие read-вызовы
 * схлопываются в один аккордеон `group-tools` через
 * `MessagePrimitive.GroupedParts` + `groupPartByType`.
 *
 * Write-вызовы (approval-gate либо разрешённые allow-list'ом) остаются
 * отдельными карточками: прятать активное подтверждение в раскрытие —
 * прямой путь к потерянному решению (и AC5 требует видимую карточку).
 */
const baseGroupBy = groupPartByType({ "tool-call": ["group-tools"] })

const groupBy: Parameters<typeof MessagePrimitive.GroupedParts>[0]["groupBy"] = (part, context) => {
  if (part.type === "tool-call") {
    const meta = part.providerMetadata as { vibelog?: { auto?: unknown } } | undefined
    if (part.approval !== undefined || meta?.vibelog?.auto === true) return null
    if (isWriteTool(part.toolName)) return null
  }
  return baseGroupBy(part, context)
}

/**
 * Роутер одной части сообщения: text → markdown, tool-call → карточка
 * (write) или строка (read), data chat-error → плашка ошибки.
 *
 * Признак write берём у СЕРВЕРА (`part.approval` есть — значит гейт
 * запрашивался; `auto` — разрешено allow-list'ом). `isWriteTool` — только
 * fallback для старых jsonl без флага (риск R3 плана).
 */
/**
 * Часть, приходящая в children-рендер GroupedParts: реальная часть
 * сообщения, синтетический indicator (стриминг) или узел группы.
 * Ветки группы рендерит AssistantMessage, остальное — PartView.
 */
type GroupedPartLike =
  | EnrichedPartState
  | { readonly type: "indicator" }
  | { readonly type: `group-${string}`; readonly indices: readonly number[] }

function PartView({ part }: { part: GroupedPartLike }) {
  if (part.type === "text") {
    // синтетический пустой text-part во время старта run не рендерим
    if (!part.text) return null
    return <MarkdownView>{part.text}</MarkdownView>
  }
  if (part.type === "tool-call") {
    const auto = isAutoAllowed(part)
    const isWrite = part.approval !== undefined || auto || isWriteTool(part.toolName)
    return isWrite ? <ApprovalCard part={part} auto={auto} /> : <ToolCall part={part} auto={auto} />
  }
  // узел группы рендерит AssistantMessage (case "group-tools"), indicator — пусто
  if (part.type === "indicator" || part.type.startsWith("group-")) return null
  if (part.type === "data" && part.name === CHAT_ERROR_PART) {
    const payload = part.data as { message?: unknown; retryable?: unknown } | undefined
    return <ChatErrorState message={typeof payload?.message === "string" ? payload.message : "Неизвестная ошибка"} />
  }
  if (part.type === "data" && part.name === CHAT_TRUNCATED_PART) {
    // VL-269 (AC9/AC10): авто-продолжения исчерпаны — вместо них явная
    // кнопка «Продолжить»; каждое нажатие = один ход (Reload перезапускает run).
    const payload = part.data as { reason?: unknown; step?: unknown } | undefined
    const why = payload?.reason === "wall_time" ? "Превышен лимит времени хода" : "Превышен лимит итераций"
    return (
      <StoppedRun
        reason={why}
        retry={
          <ActionBarPrimitive.Reload asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-foreground/70 transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/95 active:scale-[0.96]"
            >
              Продолжить
              <ArrowRight className="size-3" />
            </button>
          </ActionBarPrimitive.Reload>
        }
      />
    )
  }
  return null
}

/**
 * Кнопка action bar сообщения (VL-264, ref perplexity.tsx
 * `messageActionClassName`): призрак `size-8 rounded-full`, приглушённый
 * цвет → `hover:bg-accent`. Появляется на hover сообщения (в контейнере).
 */
const ACTION_CLASS =
  "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

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

/**
 * Ctrl/Cmd+Enter вставляет перенос строки вместо отправки (VL-263).
 *
 * В @assistant-ui/react (0.15.31) нет нужного режима: `submitMode`
 * поддерживает "enter" (Ctrl+Enter отправляет), "ctrlEnter" (plain Enter
 * переносит) и "none". Поэтому перехватываем сочетание своим onKeyDown:
 * либа собирает обработчики через composeEventHandlers(onKeyDown, свой),
 * наш выполняется первым, а preventDefault гасит её requestSubmit.
 *
 * Текст композера контролируемый (value из s.composer.text), поэтому
 * вставляем перенос через aui.composer.setText, а каретку ставим после
 * перерендера в useLayoutEffect — иначе она уедет в конец строки.
 */
function useCtrlEnterNewline() {
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  const caretRef = React.useRef<number | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useLayoutEffect(() => {
    const caret = caretRef.current
    if (caret === null) return
    caretRef.current = null
    const el = textareaRef.current
    if (!el) return
    el.setSelectionRange(caret, caret)
  }, [text])

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Ctrl/Cmd+Enter — «steer» либы, не перехватываем;
      // IME-композиция — тоже не наш случай
      if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      if ((e.nativeEvent as { isComposing?: boolean }).isComposing === true) return

      const el = e.currentTarget
      e.preventDefault()

      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? start
      caretRef.current = start + 1
      aui.composer.setText(
        el.value.slice(0, start) + "\n" + el.value.slice(end),
        { origin: "user" },
      )
    },
    [aui],
  )

  return { textareaRef, onKeyDown }
}

/** Inline-редактор сообщения (ref-22 chatgpt.tsx: composer в режиме edit). */
function EditComposer() {
  const { textareaRef, onKeyDown } = useCtrlEnterNewline()
  return (
    <MessagePrimitive.Root className="mx-auto flex w-full max-w-(--thread-max-width) justify-end">
      {/* Пузырь редактора повторяет форму user-пузыря (VL-264: rounded-3xl) */}
      <ComposerPrimitive.Root className="w-full max-w-[85%] rounded-3xl rounded-tr-md border bg-background p-2 shadow-sm">
        <ComposerPrimitive.Input
          ref={textareaRef}
          onKeyDown={onKeyDown}
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

/**
 * Сообщение пользователя (VL-264, ref perplexity.tsx:296-325): пузырь
 * `rounded-3xl rounded-tr-md` с border (НЕ bg-primary), `max-w-[85%]`,
 * выравнивание вправо; action bar Copy/Edit — СЛЕВА от пузыря, появляется
 * на hover/focus сообщения; BranchPicker ниже.
 */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-2 py-2">
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-start gap-2">
          <ActionBarPrimitive.Root
            hideWhenRunning
            className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
          >
            <CopyAction />
            <ActionBarPrimitive.Edit asChild>
              <button type="button" className={ACTION_CLASS} aria-label="Редактировать">
                <Pencil className="size-4" />
              </button>
            </ActionBarPrimitive.Edit>
          </ActionBarPrimitive.Root>

          <div className="max-w-[85%] rounded-3xl rounded-tr-md border bg-[#fcfbf8] px-4 py-3 text-sm break-words dark:bg-[#23211f]">
            <MessagePrimitive.Parts>
              {({ part }) => (part.type === "text" ? part.text : null)}
            </MessagePrimitive.Parts>
          </div>
        </div>
        <div className="mr-3 flex items-center gap-0.5">
          <BranchPicker />
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

/**
 * Причина обрыва текущего сообщения (VL-264, AC8): статус incomplete от
 * рантайма → текст mono-чипа. null — сообщение не оборвано.
 */
function useStoppedReason(): string | null {
  return useAuiState(s => {
    const status = s.message.status
    if (status?.type !== "incomplete") return null
    switch (status.reason) {
      case "cancelled":
        return "Остановлено"
      case "length":
        return "Достигнут лимит длины"
      case "content-filter":
        return "Ответ отфильтрован"
      case "tool-calls":
        return "Ожидает инструмент"
      case "error":
        return "Прервано ошибкой"
      default:
        return "Прервано"
    }
  })
}

/**
 * Плашка прерванного прогона под ответом (AC8): вместо голого текста
 * ошибки — причина + кнопка «Продолжить» (Reload повторяет run).
 */
function StoppedRunForMessage() {
  const reason = useStoppedReason()
  if (reason === null) return null
  return (
    <StoppedRun
      reason={reason}
      retry={
        <ActionBarPrimitive.Reload asChild>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-foreground/70 transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/95 active:scale-[0.96]"
          >
            Продолжить
            <ArrowRight className="size-3" />
          </button>
        </ActionBarPrimitive.Reload>
      }
    />
  )
}

/**
 * Сообщение ассистента (VL-264, ref perplexity.tsx:327-352): без пузыря,
 * аватар-кружок `size-8` с border, текст прямо в ленте, ширина ограничена
 * `--thread-max-width` (40rem); action bar Reload/Copy + BranchPicker на hover.
 *
 * Части рендерит `MessagePrimitive.GroupedParts`: серии подряд идущих
 * tool-call частей схлопываются в один аккордеон ToolGroup (AC7).
 * Write-вызовы (approval или auto) в группу не собираем — активная карточка
 * подтверждения должна быть видна сразу, а не спрятана в раскрытии.
 */
function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group/message mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-2 py-2">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
          <Bot className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm leading-6 break-words">
            <MessagePrimitive.GroupedParts groupBy={groupBy}>
              {({ part, children }) => {
                if (part.type === "group-tools") {
                  return <ToolGroup count={part.indices.length}>{children}</ToolGroup>
                }
                return <PartView part={part} />
              }}
            </MessagePrimitive.GroupedParts>
          </div>

          <StoppedRunForMessage />

          <div className="mt-2 flex items-center gap-2">
            <BranchPicker />
            <ActionBarPrimitive.Root
              hideWhenRunning
              className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
            >
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
function Composer({
  placeholder,
  personaId,
}: {
  placeholder: string
  /** id роли, зафиксированной за тредом (VL-283); null/undefined — новый тред. */
  personaId?: string | null
}) {
  const { textareaRef, onKeyDown } = useCtrlEnterNewline()
  return (
    // VL-265: две строки — ввод сверху, нижняя строка с пикерами роли (слева)
    // и модели + Send (справа), как в ref-22 (perplexity.tsx). Высота каркаса
    // ограничена выше (lesson-112), поэтому доп. ряд не ломает скролл.
    <ComposerPrimitive.Root className="flex w-full flex-col gap-1 rounded-2xl border bg-background p-2 shadow-sm focus-within:border-border/80">
      <ComposerPrimitive.Input
        ref={textareaRef}
        onKeyDown={onKeyDown}
        rows={1}
        name="chat-message"
        placeholder={placeholder}
        className="max-h-40 min-h-9 w-full flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
      />
      <div className="flex items-center justify-between gap-1">
        {/* VL-283: роль фиксируется за тредом — в начатом чате вместо
            переключателя неинтерактивный бейдж, выбор доступен только для
            нового треда (пустое состояние) */}
        {personaId ? <PersonaBadge personaId={personaId} /> : <PersonaPicker />}
        <div className="flex items-center gap-1">
          <ModelPicker />
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
        </div>
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
        <Composer placeholder="Спросите по проекту… (Enter — отправить, Ctrl+Enter — перенос строки)" />
      </div>
    </div>
  )
}

/**
 * Тред: сообщения + композер. Высота — h-full (скролл внутри viewport).
 *
 * `--thread-max-width: 40rem` (VL-264, ref perplexity.tsx): ширина ленты, к
 * которой прижаты и сообщения, и композер — как в референсе.
 */
/**
 * VL-283: `threadPersona` — роль, зафиксированная за тредом (с сервера).
 * Для треда, начатого прямо сейчас (сервер уже создал id, но страница
 * историю не перезагружала), клиент показывает роль первого хода из
 * module-state — она и есть зафиксированная сервером.
 */
function ChatThread({
  threadPersona,
  threadId,
}: {
  threadPersona: string | null
  /** id треда — resetKey панели расхода (VL-313). */
  threadId?: string
}) {
  return (
    <ThreadPrimitive.Root
      className="flex h-full min-h-0 flex-col"
      style={{ ["--thread-max-width" as string]: "40rem" }}
    >
      <ThreadPrimitive.If empty>
        <EmptyState />
      </ThreadPrimitive.If>
      <ThreadPrimitive.If empty={false}>
        {/* VL-313: панель расхода — только для непустого треда (AC7) */}
        <UsageBar threadId={threadId} />
        <ThreadPrimitive.Viewport
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pt-6"
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
          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto w-full max-w-(--thread-max-width) self-center bg-linear-to-b from-transparent via-background/85 to-background pt-4 pb-4">
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
              <Composer
                placeholder="Спросите по проекту… (Enter — отправить, Ctrl+Enter — перенос строки)"
                personaId={threadPersona ?? getActivePersonaId()}
              />
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
  /** Allow-list треда (VL-264): инструменты, разрешённые «Always allow». */
  allowList?: string[]
  /** Роль, зафиксированная за тредом (VL-283), из `GET /api/chat/threads/:id`.
   * null — тред новый/пустой (клиент показывает пикер роли).
   */
  persona?: string | null
  /** Расход токенов треда (VL-313): панель восстанавливает цифры после reload. */
  usage?: ThreadUsageView | null
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
    setLoad(prev => ({
      status: "loading",
      messages: [],
      runtimeThreadId: prev.runtimeThreadId,
      persona: null,
    }))
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
        setLoad({
          status: "ready",
          messages: historyToMessages(data.messages, { allowList: data.allowList }),
          runtimeThreadId: id,
          allowList: data.allowList ?? [],
          // VL-283: роль, зафиксированная за тредом (null — тред без ходов)
          persona: data.persona ?? null,
          // VL-313: расход треда — панель восстановит те же цифры (AC2)
          usage: data.usage ?? null,
        })
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

  /**
   * Активный тред для подсветки: id из hash, иначе — загруженный в рантайм
   * (новый тред до первого хода id не имеет).
   */
  const activeThreadId =
    typeof hashThreadId === "string" && hashThreadId !== "new"
      ? hashThreadId
      : load.runtimeThreadId ?? null

  /** Открыта ли мобильная панель тредов (VL-282), только для < md. */
  const [threadsOpen, setThreadsOpen] = React.useState(false)
  const isMobile = useIsMobile()

  // Ресайз/поворот экрана за пределы мобильной ширины: «залипшая» панель
  // не должна оставаться открытой над десктопным сайдбаром
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isMobile) setThreadsOpen(false)
  }, [isMobile])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Мобильная шапка чата (VL-282): на десктопе скрыта, список тредов
          живёт в `aside` справа. h-12 shrink-0 — чтобы лента ниже получила
          остаток высоты и скроллилась сама (lesson-112) */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Открыть список чатов"
          aria-expanded={threadsOpen}
          onClick={() => setThreadsOpen(true)}
        >
          <PanelLeftIcon className="size-4" />
        </Button>
        <span className="min-w-0 truncate text-sm font-medium">
          {activeThreadId ? "Чат" : "Новый чат"}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
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
              allowList={load.allowList}
              initialUsage={load.usage}
              onThreadCreated={handleThreadCreated}
            >
              <ChatThread threadPersona={load.persona ?? null} threadId={load.runtimeThreadId} />
            </ChatRuntimeProvider>
          )}
        </div>
        {/* Справа — список тредов (решение из комментария VL-207) */}
        <ThreadSidebar
          activeThreadId={activeThreadId}
          onNewThread={() => {
            window.location.hash = "#/chat/new"
          }}
        />
      </div>
      {/* Тот же список на мобильном — выезжающей панелью (VL-282) */}
      <ThreadSidebarSheet
        open={threadsOpen}
        onOpenChange={setThreadsOpen}
        activeThreadId={activeThreadId}
        onNewThread={() => {
          window.location.hash = "#/chat/new"
        }}
      />
    </div>
  )
}
