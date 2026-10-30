/**
 * Runtime-провайдер чата (VL-204): useLocalRuntime + кастомный
 * ChatModelAdapter, парсящий наш SSE (POST /api/chat).
 *
 * Семантика approval-gate (ref-22: local-runtime.mdx §Approval gates):
 * - первый run при событии approval добавляет tool-call part с
 *   `approval: { id }` и завершает генератор статусом requires-action —
 *   рантайм ставит run на паузу; Allow/Deny в thread.tsx вызывает
 *   `part.respondToApproval({ approved, reason? })`, рантайм записывает
 *   решение в part и вызывает adapter повторно;
 * - гейты ПОСЛЕДОВАТЕЛЬНЫЕ (VL-256): при нескольких write-вызовах в одном
 *   ходе сервер показывает подтверждение по одному — после решения по
 *   вызову N приходит `approval` для N+1 (отказ по одному не отменяет
 *   остальные), поэтому один run = одно решение;
 * - resume-run: решения читаем из unstable_getMessage().content
 *   (tool-call с approval.approved) и шлём POST { threadId, approval } —
 *   сервер продолжает LLM-цикл, новый текст докидывается в ту же нить
 *   (updateMessage = [...initialContent, ...yield.content]);
 * - обычный ход: POST { message, threadId }, события text/tool_start/
 *   tool_end/done/error маппятся в content-части.
 *
 * Стриминг: генератор run сам читает response.body — после каждого
 * SSE-события yield'ит накопленный content, UI обновляется дельтами.
 * Каждый yield несёт ПОЛНЫЙ content текущего run (пересборка сообщения
 * рантаймом затёр бы предыдущие части).
 *
 * threadId: module-level (MVP — один тред на страницу): событие thread
 * запоминает id, resume и следующие ходы продолжают тот же jsonl.
 */

import * as React from "react"
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ChatModelRunResult,
} from "@assistant-ui/react"

/** Тип content-части assistant-сообщения (из результата run). */
type Parts = NonNullable<ChatModelRunResult["content"]>
type Part = Parts[number]

/** События SSE-потока src/web/chat.ts (зеркально ChatEvent). */
type ChatEvent =
  | { type: "thread"; threadId: string }
  | { type: "text"; delta: string }
  /** auto (VL-264) — write-вызов прошёл по allow-list треда («Always allow»). */
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown>; auto?: boolean }
  | { type: "tool_end"; id: string; result: string; isError?: boolean }
  | { type: "approval"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string }

/**
 * Имя data-части ошибки стрима (VL-264, AC9). Раньше ошибка дописывалась
 * text-частью посреди ответа; теперь это отдельная data-часть, которую
 * thread.tsx рендерит единой плашкой ChatErrorState.
 */
export const CHAT_ERROR_PART = "chat-error"

/**
 * Текущий threadId (VL-207: id приходит из hash при восстановлении,
 * событие thread записывает id при первом ходе в новом треде). Resume и
 * следующие ходы продолжают тот же jsonl. Выставляется провайдером при
 * смене треда (useEffect — до первого действия пользователя).
 */
let activeThreadId: string | undefined

/**
 * Allow-list активного треда (VL-264): инструменты, разрешённые «Always
 * allow». Заполняется при восстановлении истории (data.allowList) и при
 * нажатии кнопки в карточке — карточки/строки помечаются «разрешено заранее»
 * без лишних запросов к серверу. Сбрасывается при смене треда.
 */
const alwaysAllowed = new Set<string>()

/** Активный threadId (для «Always allow»: разрешение пишется в его allow-list). */
export function getActiveThreadId(): string | undefined {
  return activeThreadId
}

/** Разрешён ли инструмент в активном треде заранее. */
export function isToolAlwaysAllowed(tool: string): boolean {
  return alwaysAllowed.has(tool)
}

/** Локальная пометка «разрешено всегда» (после успешного POST /allow). */
export function addAlwaysAllowed(tool: string): void {
  alwaysAllowed.add(tool)
}

/** Снятие локальной пометки (после DELETE /allow). */
export function removeAlwaysAllowed(tool: string): void {
  alwaysAllowed.delete(tool)
}

/** Замена allow-list при загрузке треда с сервера. */
export function setAlwaysAllowed(tools: readonly string[] | undefined): void {
  alwaysAllowed.clear()
  for (const tool of tools ?? []) alwaysAllowed.add(tool)
}

/**
 * Текущая модель чата (VL-209): id из models.available, выбранный пикером
 * модели у инпута (VL-265). undefined — default из settings.json (сервер
 * сам резолвит). Хранение — module-state как activeThreadId: пикер меняет
 * значение → следующий POST /api/chat уходит с model.
 */
let activeModelId: string | undefined

/** Установка активной модели чата (вызывает ModelPicker). */
export function setActiveModelId(id: string | undefined): void {
  activeModelId = id
}

/**
 * Текущая роль ассистента (VL-265): id из реестра chat_personas. ВСЕГДА
 * `helper` при старте/перезагрузке — localStorage не используется (AC14):
 * дефолт в коде, смена живёт только до перезагрузки страницы.
 * Роль не связана с моделью: пикеры независимы (AC15).
 */
let activePersonaId: string = "helper"

/** Текущая роль (для пикера при маунте — дефолт helper). */
export function getActivePersonaId(): string {
  return activePersonaId
}

/** Установка активной роли (вызывает PersonaPicker). */
export function setActivePersonaId(id: string): void {
  activePersonaId = id
}

/** Решения, уже отправленные на сервер (идемпотентность resume). */
const sentApprovals = new Set<string>()

/**
 * Уведомление о создании нового треда сервером (VL-207): провайдер
 * регистрирует колбэк, ChatPage переводит hash на `#/chat/<id>` — без
 * перезагрузки рантайма (id сравнивается с уже загруженным).
 */
let notifyThreadCreated: ((id: string) => void) | null = null

/** Последний user-текст из messages рантайма. */
function lastUserText(messages: ChatModelRunOptions["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== "user") continue
    if (typeof m.content === "string") return m.content
    return m.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map(p => p.text)
      .join("\n")
  }
  return ""
}

/**
 * Нес отправленные решения по approval из текущего сообщения: tool-call
 * parts с approved !== undefined, id которых ещё нет в sentApprovals.
 */
function pendingApprovalDecisions(
  options: ChatModelRunOptions,
): { toolCallId: string; approved: boolean; reason?: string }[] {
  let current
  try {
    current = options.unstable_getMessage()
  } catch {
    return [] // сообщение может быть недоступно — не роняем run
  }
  if (current.role !== "assistant") return []
  const out: { toolCallId: string; approved: boolean; reason?: string }[] = []
  for (const part of current.content) {
    if (part.type !== "tool-call" || !part.approval) continue
    if (part.approval.approved === undefined) continue
    if (sentApprovals.has(part.approval.id)) continue
    out.push({
      toolCallId: part.toolCallId,
      approved: part.approval.approved,
      ...(part.approval.reason ? { reason: part.approval.reason } : {}),
    })
  }
  return out
}

/**
 * data-часть ошибки стрима (VL-264, AC9): единый рендер с ошибками
 * инструментов — плашка ChatErrorState, а не текст посреди ответа.
 */
function errorPart(message: string): Part {
  return {
    type: "data",
    name: CHAT_ERROR_PART,
    data: { message, retryable: true },
  } as Part
}

/** Разбор одной data-строки SSE. */
function parseEvent(line: string): ChatEvent | null {
  if (!line.startsWith("data:")) return null
  try {
    return JSON.parse(line.slice(5)) as ChatEvent
  } catch {
    return null // битая строка — пропускаем
  }
}

/**
 * Кладёт событие в накопленный content. Возвращает true, если run должен
 * завершиться паузой (approval-gate).
 */
function applyEvent(parts: Part[], ev: ChatEvent): boolean {
  switch (ev.type) {
    case "thread":
      activeThreadId = ev.threadId
      // VL-207: новый тред создан → ChatPage переводит hash на #/chat/<id>
      notifyThreadCreated?.(ev.threadId)
      return false
    case "text": {
      // дельты склеиваем в последний text-part
      const last = parts[parts.length - 1]
      if (last && last.type === "text") {
        parts[parts.length - 1] = { ...last, text: last.text + ev.delta }
      } else {
        parts.push({ type: "text", text: ev.delta })
      }
      return false
    }
    case "tool_start":
      parts.push({
        type: "tool-call",
        toolCallId: ev.id,
        toolName: ev.name,
        // аргументы пришли по сети → гарантированно JSON-совместимы;
        // пересборка через JSON нужна типу ReadonlyJSONObject
        args: JSON.parse(JSON.stringify(ev.args)),
        argsText: JSON.stringify(ev.args),
        // VL-264: write-вызов, разрешённый allow-list'ом треда, приходит с
        // auto:true. Поле не входит в ToolCallMessagePart, поэтому едет в
        // providerMetadata (свободный слот) и читается в PartView.
        ...(ev.auto
          ? { providerMetadata: { vibelog: { auto: true } } }
          : {}),
      })
      return false
    case "tool_end": {
      const idx = parts.findIndex(p => p.type === "tool-call" && p.toolCallId === ev.id)
      if (idx < 0) return false
      let parsed: unknown = ev.result
      try {
        parsed = JSON.parse(ev.result)
      } catch {
        // не-JSON результат (текст ошибки и т.п.) оставляем строкой
      }
      parts[idx] = {
        ...(parts[idx] as Extract<Part, { type: "tool-call" }>),
        result: parsed,
        ...(ev.isError ? { isError: true } : {}),
      }
      return false
    }
    case "approval": {
      // VL-256: гейты последовательные — повторное событие для того же
      // toolCallId не должно создавать второй part (два part'а с одним id
      // дали бы два диалога, а tool_end попал бы в первый)
      const exists = parts.findIndex(p => p.type === "tool-call" && p.toolCallId === ev.toolCallId)
      if (exists >= 0) {
        const prev = parts[exists] as Extract<Part, { type: "tool-call" }>
        parts[exists] = { ...prev, approval: { id: ev.toolCallId } }
        return true
      }
      // write-операция: part с approval-gate, run ставится на паузу
      parts.push({
        type: "tool-call",
        toolCallId: ev.toolCallId,
        toolName: ev.name,
        args: JSON.parse(JSON.stringify(ev.args)),
        argsText: JSON.stringify(ev.args),
        approval: { id: ev.toolCallId },
      })
      return true
    }
    case "error":
      // VL-264 (AC9): ошибка стрима — отдельная data-часть, а не текст
      // посреди ответа. Её рендерит ChatErrorState (единый вид с ошибками
      // инструментов). retryable — ошибка соединения/сервера, а не отказ.
      parts.push({
        type: "data",
        name: CHAT_ERROR_PART,
        data: { message: ev.message, retryable: true },
      })
      return false
    case "done":
      return false
    default:
      return false
  }
}

/** Наш ChatModelAdapter: один run = один POST /api/chat (ход ИЛИ resume). */
const chatAdapter: ChatModelAdapter = {
  async *run(options): AsyncGenerator<ChatModelRunResult, void> {
    const parts: Part[] = []
    let pausedOnApproval = false

    // --- тело запроса: resume (решение по approval) ИЛИ новое сообщение ---
    const decisions = pendingApprovalDecisions(options)
    let body: Record<string, unknown>
    if (decisions.length > 0) {
      const d = decisions[0]!
      sentApprovals.add(d.toolCallId)
      body = {
        threadId: activeThreadId,
        approval: {
          toolCallId: d.toolCallId,
          approved: d.approved,
          ...(d.reason ? { reason: d.reason } : {}),
        },
      }
      if (!body.threadId) {
        // решения без треда (перезагрузка) — сервер отвечает error-событием
        delete body.threadId
      }
    } else {
      body = {
        message: lastUserText(options.messages),
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        // VL-209: переопределение модели (undefined — default из settings.json)
        ...(activeModelId ? { model: activeModelId } : {}),
        // VL-265: роль применяется к следующему сообщению; история треда
        // не переписывается (system-сообщение пересобирается на каждый ход)
        persona: activePersonaId,
      }
    }

    // --- стриминг: читаем поток сами, yield после каждого события ---------
    let res: Response
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (err) {
      if (options.abortSignal.aborted) return // отмена пользователем
      const message = err instanceof Error ? err.message : String(err)
      parts.push(errorPart(message))
      yield { content: [...parts] as Parts }
      return
    }
    if (!res.ok || !res.body) {
      parts.push(errorPart(`сервер ответил ${res.status}`))
      yield { content: [...parts] as Parts }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const handleChunk = (chunk: string): "pause" | "none" => {
      for (const line of chunk.split("\n")) {
        const ev = parseEvent(line)
        if (!ev) continue
        if (applyEvent(parts, ev)) return "pause"
      }
      return "none"
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf("\n\n")
        while (sep !== -1) {
          const chunk = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          if (handleChunk(chunk) === "pause") {
            pausedOnApproval = true
            break
          }
          sep = buffer.indexOf("\n\n")
        }
        if (pausedOnApproval) break
        if (parts.length > 0) yield { content: [...parts] as Parts }
      }
      if (!pausedOnApproval && buffer.trim()) handleChunk(buffer)
    } catch (err) {
      if (options.abortSignal.aborted) return // отмена пользователем
      const message = err instanceof Error ? err.message : String(err)
      parts.push(errorPart(message))
    }

    if (pausedOnApproval) {
      yield { content: [...parts] as Parts, status: { type: "requires-action", reason: "tool-calls" } }
      return
    }
    yield { content: [...parts] as Parts }
  },
}

/**
 * Провайдер чата (VL-207): threadId приходит из hash — при восстановлении
 * существующего треда серверные сообщения уходят в initialMessages, а
 * activeThreadId выставляется до первого хода (иначе resume/продолжение
 * ушло бы на новый тред). Смена треда — через key на провайдере:
 * useLocalRuntime создаётся заново, module-state (activeThreadId,
 * sentApprovals) синхронизируется в эффекте.
 */
export function ChatRuntimeProvider({
  threadId,
  initialMessages,
  allowList,
  onThreadCreated,
  children,
}: {
  /** id треда из hash (undefined — новый тред, сервер создаст при первом ходе). */
  threadId?: string
  /** Восстановленная история (initialMessages для useLocalRuntime). */
  initialMessages?: import("@assistant-ui/react").ThreadMessageLike[]
  /** Allow-list треда (VL-264): инструменты, разрешённые «Always allow». */
  allowList?: readonly string[] | undefined
  /** Новый тред создан сервером → обновить hash на #/chat/<id>. */
  onThreadCreated?: (id: string) => void
  children: React.ReactNode
}) {
  const runtime = useLocalRuntime(chatAdapter, { initialMessages })

  // Колбэк через ref: adapter — module-level, не пересоздаём его на каждый рендер
  const createdRef = React.useRef(onThreadCreated)
  React.useEffect(() => {
    createdRef.current = onThreadCreated
  })

  React.useEffect(() => {
    activeThreadId = threadId
    sentApprovals.clear()
    // VL-264: allow-list — свойство треда, при смене сбрасываем (иначе
    // «разрешено всегда» из другого треда дало бы ложную пометку)
    setAlwaysAllowed(allowList)
    notifyThreadCreated = id => createdRef.current?.(id)
    return () => {
      notifyThreadCreated = null
    }
  }, [threadId, allowList])

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
