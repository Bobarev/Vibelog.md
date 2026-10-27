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
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; result: string; isError?: boolean }
  | { type: "approval"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string }

/**
 * Текущий threadId (MVP: один тред на страницу). Событие thread записывает,
 * resume-запросы читают. При новой загрузке страницы — undefined → сервер
 * создаст новый тред.
 */
let activeThreadId: string | undefined

/** Решения, уже отправленные на сервер (идемпотентность resume). */
const sentApprovals = new Set<string>()

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
    case "approval":
      // backlog_create_task: part с approval-gate, run ставится на паузу
      parts.push({
        type: "tool-call",
        toolCallId: ev.toolCallId,
        toolName: ev.name,
        args: JSON.parse(JSON.stringify(ev.args)),
        argsText: JSON.stringify(ev.args),
        approval: { id: ev.toolCallId },
      })
      return true
    case "error":
      parts.push({ type: "text", text: `Ошибка чата: ${ev.message}` })
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
      yield { content: [...parts, { type: "text", text: `Ошибка чата: ${message}` }] as Parts }
      return
    }
    if (!res.ok || !res.body) {
      yield {
        content: [...parts, { type: "text", text: `Ошибка чата: сервер ответил ${res.status}` }] as Parts,
      }
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
      parts.push({ type: "text", text: `Ошибка чата: ${message}` })
    }

    if (pausedOnApproval) {
      yield { content: [...parts] as Parts, status: { type: "requires-action", reason: "tool-calls" } }
      return
    }
    yield { content: [...parts] as Parts }
  },
}

/** Провайдер чата: один adapter на страницу (threadIds — module state). */
export function ChatRuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(chatAdapter)
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
