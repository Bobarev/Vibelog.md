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
 * - ответ на `ask_user` (VL-331) — human-tool, а НЕ Reload: инструмент
 *   объявлен в `unstable_humanToolNames`, карточка завершает вызов через
 *   `part.addResult({answer:{id,label}} | {answer:{custom}})`, результат
 *   пишется в тот же tool-call part, и рантайм продолжает run в ТОМ ЖЕ
 *   сообщении (Reload создавал sibling-сообщение → переключатель «< 2/2 >»).
 *   Адаптер читает ответ из unstable_getMessage().content и шлёт POST { answer };
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

import type { ThreadUsageView } from "@/lib/chat-usage"

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
  | {
      type: "approval"
      toolCallId: string
      name: string
      args: Record<string, unknown>
      /** VL-268: данные карточки grant (состав прогона, инструменты, срок). */
      grant?: unknown
    }
  /** VL-330: интерактивный вопрос — ход на паузе до ответа пользователя. */
  | {
      type: "question"
      toolCallId: string
      question: string
      options: { id: string; label: string; description?: string }[]
      allowCustom: boolean
    }
  | { type: "done" }
  | { type: "error"; message: string }
  /**
   * VL-402: модель записала предпочтение пользователя в память роли. Запись
   * уже применена (Allow/Deny не спрашивали — она обратима), поэтому в ленте
   * появляется строка «Запомнил: …» с кнопкой «Убрать».
   */
  | {
      type: "memory"
      entry: { index: number; text: string; date: string }
      personaId: string
      /** VL-419: метка роли для карточки «<Роль> запомнил: …». */
      personaLabel?: string
    }
  /**
   * VL-409: консультация другой роли (`ask_persona`) завершена. display
   * определяет вид в ленте: inline — раскрываемый tool-call, widget — карточка.
   */
  | {
      type: "subagent"
      personaId: string
      personaLabel: string
      question: string
      answer: string
      tokens: { input: number; output: number; total: number }
      display?: "inline" | "widget"
      /** VL-415: ответ обрезан по `subagents.max_answer_chars`. */
      truncated?: boolean
      /** VL-415: длина полного ответа до обрезки. */
      answerChars?: number
      /** VL-415: консультант исчерпал итерации — ответ частичный. */
      partial?: boolean
      /** VL-415: инструменты, которые консультант успел вызвать. */
      usedTools?: string[]
    }
  /** VL-313: расход токенов треда после очередного вызова модели. */
  | { type: "usage"; usage: ThreadUsageView }
  /**
   * VL-269: ход остановлен лимитом, история сохранена. Клиент продолжает ход
   * сам (до `maxAutoContinue` раз), без нового user-сообщения.
   */
  /**
   * VL-317: цена вендора разошлась с каталогом. kind='ask' — ход не начался,
   * карточка предлагает «Продолжить»/«Перейти на <вендор>»; kind='warn' —
   * ход идёт, в ленте остаётся предупреждение; kind='auto' — вендор
   * переключён автоматически.
   */
  | {
      type: "pricing"
      kind: "ask" | "warn" | "auto"
      state: "ok" | "drift" | "unknown"
      message: string
      model?: string
      vendor?: string
      alternative?: string
      maxDeltaPercent?: number
    }
  | {
      type: "truncated"
      reason: "iterations" | "wall_time"
      step: number
      saved?: boolean
      limits?: {
        maxIterations: number
        maxWallTimeSec: number
        maxAutoContinue: number
        callTimeoutSec: number
      }
    }

/**
 * Имя data-части «ход остановлен лимитом» (VL-269): рендерится плашкой со
 * причиной и кнопкой «Продолжить» — когда авто-продолжения уже исчерпаны.
 */
export const CHAT_TRUNCATED_PART = "chat-truncated"

/**
 * Сколько авто-продолжений делает клиент, если сервер не сообщил свой лимит
 * (`chat.max_auto_continue`, VL-269). Значение приходит в событии truncated.
 */
const MAX_AUTO_CONTINUE_FALLBACK = 3

/**
 * Имя data-части ошибки стрима (VL-264, AC9). Раньше ошибка дописывалась
 * text-частью посреди ответа; теперь это отдельная data-часть, которую
 * thread.tsx рендерит единой плашкой ChatErrorState.
 */
export const CHAT_ERROR_PART = "chat-error"

/**
 * Имя data-части «дрейф цены вендора» (VL-317): карточка с было/стало и
 * кнопками «Продолжить» / «Перейти на <вендор>» (AC5), либо предупреждение
 * в ленте (AC7).
 */
export const CHAT_PRICING_PART = "chat-pricing"

/**
 * Имя data-части «запись в память персоны» (VL-402): строка «Запомнил: …» с
 * кнопкой «Убрать». Живёт в content сообщения (как pricing/truncated), поэтому
 * после F5 восстанавливается из jsonl — но кнопка неактивна, если запись уже
 * убрана (набор отмен приходит с сервера, `setMemoryRemovals`).
 */
export const CHAT_MEMORY_PART = "chat-memory"

/**
 * Имя data-части «консультация другой роли» (VL-409): карточка с вопросом и
 * ответом консультанта. Используется при `subagents.display: widget`; при
 * `inline` (дефолт) консультация рендерится обычным tool-call'ом с раскрытием.
 */
export const CHAT_SUBAGENT_PART = "chat-subagent"

/**
 * Текущий threadId (VL-207: id приходит из hash при восстановлении,
 * событие thread записывает id при первом ходе в новом треде). Resume и
 * следующие ходы продолжают тот же jsonl. Выставляется провайдером при
 * смене треда (useEffect — до первого действия пользователя).
 */
/**
 * VL-317: решение пользователя по карточке дрейфа цены. Живёт module-state,
 * потому что карточка и адаптер run — разные компоненты (как allow-list
 * треда VL-264): карточка пишет, следующий POST хода читает и очищает.
 * `undefined` — решения нет (обычный ход).
 */
let pricingDecision: { ack: boolean; vendor?: string } | undefined

/**
 * Записывает решение по дрейфу цены (VL-317): `ack` — «Продолжить»
 * (расхождение принимается), `vendor` — «Перейти на <вендор>».
 */
export function setPricingDecision(ack: boolean, vendor?: string): void {
  pricingDecision = { ack, ...(vendor !== undefined ? { vendor } : {}) }
}

/** Забирает решение по цене и очищает его (один POST = одно решение). */
function takePricingDecision(): { ack: boolean; vendor?: string } | undefined {
  const d = pricingDecision
  pricingDecision = undefined
  return d
}

let activeThreadId: string | undefined

/**
 * VL-406: запрос повтора последнего хода.
 *
 * Кнопка «Повторить» у плашки исхода (пустой ответ / ошибка / прерванный ход)
 * перезапускает ход по уже накопленной истории — нового user-сообщения быть не
 * должно. Флаг живёт module-state (как `pricingDecision`): кнопка пишет,
 * следующий POST адаптера читает и очищает, сервер по `retry: true` не
 * дописывает user-сообщение в jsonl (иначе получился бы дубль).
 */
let retryRequested = false

/** Пометить следующий ход как повтор последнего (VL-406). */
export function requestRetryLastTurn(): void {
  retryRequested = true
}

/** Забрать флаг повтора и очистить его (один POST = один повтор). */
function takeRetryRequest(): boolean {
  const value = retryRequested
  retryRequested = false
  return value
}

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
 * VL-402: отменённые записи памяти активного треда (тексты).
 *
 * Заполняется при восстановлении истории (`data.memoryRemovals`) и при
 * нажатии «Убрать» — карточка «Запомнил: …» после F5 показывает, что запись
 * уже убрана, а не предлагает удалить её второй раз. Сбрасывается при смене
 * треда (как allow-list).
 */
const memoryRemovals = new Set<string>()

/** Убрана ли запись памяти в активном треде (по тексту записи). */
export function isMemoryRemoved(text: string): boolean {
  return memoryRemovals.has(text)
}

/** Локальная пометка «запись убрана» (после успешного POST /memory/remove). */
export function markMemoryRemoved(text: string): void {
  memoryRemovals.add(text)
}

/** Замена набора отменённых записей при загрузке треда с сервера. */
export function setMemoryRemovals(texts: readonly string[] | undefined): void {
  memoryRemovals.clear()
  for (const text of texts ?? []) memoryRemovals.add(text)
}

/**
 * VL-331: ответы на интерактивный вопрос, уже отправленные на сервер.
 *
 * Ответ на `ask_user` — human-tool: карточка завершает вызов через
 * `part.addResult(...)`, результат ложится в тот же tool-call part, и рантайм
 * сам продолжает run в том же сообщении (без sibling-ветки). Адаптер при
 * повторном вызове читает результат из `unstable_getMessage().content` и шлёт
 * POST с полем `answer`. Набор защищает от повторной отправки того же ответа
 * (по образцу `sentApprovals`).
 */
const sentAnswers = new Set<string>()

/**
 * Ответ на вопрос из текущего сообщения, ещё не отправленный на сервер.
 *
 * Читаем `part.result` (его положил `addResult`), а не module-state: так
 * состояние переживает перерисовку и совпадает с тем, что видит карточка.
 * `{answer:null}` (вопрос снят/TTL) ответом не считается — отправлять нечего.
 */
function pendingAnswerDecision(
  options: ChatModelRunOptions,
): { toolCallId: string; optionId?: string; custom?: string } | undefined {
  let current
  try {
    current = options.unstable_getMessage()
  } catch {
    return undefined // сообщение может быть недоступно — не роняем run
  }
  if (current.role !== "assistant") return undefined
  for (const part of current.content) {
    if (part.type !== "tool-call" || part.toolName !== "ask_user") continue
    if (part.result === undefined || part.result === null) continue
    if (sentAnswers.has(part.toolCallId)) continue
    const result = part.result as { answer?: unknown }
    const answer = result.answer
    if (typeof answer !== "object" || answer === null) continue
    if (typeof (answer as { id?: unknown }).id === "string") {
      return { toolCallId: part.toolCallId, optionId: (answer as { id: string }).id }
    }
    if (typeof (answer as { custom?: unknown }).custom === "string") {
      return { toolCallId: part.toolCallId, custom: (answer as { custom: string }).custom }
    }
  }
  return undefined
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
 * Текущая роль ассистента (VL-265, VL-283): id из реестра chat_personas.
 * ВСЕГДА `helper` при старте/перезагрузке — localStorage не используется
 * (AC14 VL-265): дефолт в коде, смена живёт только до перезагрузки страницы.
 *
 * VL-283: это выбор роли для СЛЕДУЮЩЕГО нового треда — сервер фиксирует её
 * за тредом при первом ходе (`<threadId>.persona.json`) и последующие ходы
 * поле `persona` игнорируют. Поэтому открытие существующего треда (в т.ч.
 * начатого другой ролью) значение НЕ меняет: пикер показывает этот выбор в
 * пустом состоянии, а роль самого треда приходит с сервера и рисуется
 * бейджем (PersonaBadge).
 * Роль не связана с моделью: пикеры независимы (AC15 VL-265).
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

/**
 * Расход токенов активного треда (VL-313): приходит событием `usage` после
 * каждого вызова модели и из `GET /api/chat/threads/:id` при восстановлении.
 *
 * Хранение — module-state с подпиской (как activeThreadId/activeModelId):
 * панель живёт в шапке треда, а событие приходит в адаптере рантайма, между
 * ними нет общего React-дерева. Подписка через useSyncExternalStore даёт
 * панели обновление без перезагрузки страницы (AC1).
 */
let activeUsage: ThreadUsageView | null = null
const usageListeners = new Set<() => void>()

/** Текущий расход треда (null — учёта нет: пустой тред). */
export function getActiveUsage(): ThreadUsageView | null {
  return activeUsage
}

/** Установка расхода треда (событие usage / восстановление истории). */
export function setActiveUsage(usage: ThreadUsageView | null): void {
  activeUsage = usage
  for (const listener of usageListeners) listener()
}

/** Подписка на изменение расхода (для useSyncExternalStore). */
export function subscribeActiveUsage(listener: () => void): () => void {
  usageListeners.add(listener)
  return () => {
    usageListeners.delete(listener)
  }
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
 *
 * `state.truncated` (VL-269) фиксирует событие лимита: content получает
 * data-часть плашки, а решение «продолжать автоматически» принимает run.
 */
function applyEvent(
  parts: Part[],
  ev: ChatEvent,
  state?: { truncated?: Extract<ChatEvent, { type: "truncated" }> },
): boolean {
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
      // VL-268: данные карточки grant (состав прогона, инструменты, срок) едут
      // в providerMetadata — свободный слот протокола, как `auto` в VL-264.
      // Каст нужен, потому что grant — произвольный JSON от сервера, а
      // PartProviderMetadata типизирован как ReadonlyJSONObject.
      type ToolCallPart = Extract<Part, { type: "tool-call" }>
      const grantMeta: Partial<ToolCallPart> =
        ev.name === "backlog_supervisor" && ev.grant !== undefined && ev.grant !== null
          ? {
              providerMetadata: { vibelog: { grant: ev.grant } } as unknown as ToolCallPart["providerMetadata"],
            }
          : {}
      // VL-256: гейты последовательные — повторное событие для того же
      // toolCallId не должно создавать второй part (два part'а с одним id
      // дали бы два диалога, а tool_end попал бы в первый)
      const exists = parts.findIndex(p => p.type === "tool-call" && p.toolCallId === ev.toolCallId)
      if (exists >= 0) {
        const prev = parts[exists] as Extract<Part, { type: "tool-call" }>
        parts[exists] = { ...prev, approval: { id: ev.toolCallId }, ...grantMeta }
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
        ...grantMeta,
      })
      return true
    }
    case "question": {
      // VL-330: интерактивный вопрос — tool-call part с аргументами вопроса и
      // пауза run (как approval). Ответ уходит следующим POST с полем `answer`,
      // а результат приходит обычным tool_end и живёт в part.result — поэтому
      // карточка восстанавливается после F5 уже отвеченной.
      const exists = parts.findIndex(p => p.type === "tool-call" && p.toolCallId === ev.toolCallId)
      const args = {
        question: ev.question,
        options: ev.options,
        allow_custom: ev.allowCustom,
      }
      if (exists >= 0) {
        const prev = parts[exists] as Extract<Part, { type: "tool-call" }>
        parts[exists] = { ...prev, args: JSON.parse(JSON.stringify(args)) }
        return true
      }
      parts.push({
        type: "tool-call",
        toolCallId: ev.toolCallId,
        toolName: "ask_user",
        args: JSON.parse(JSON.stringify(args)),
        argsText: JSON.stringify(args),
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
    case "pricing":
      // VL-317: карточка/предупреждение о цене. В content кладём data-часть —
      // её рендерит PartView (thread.tsx). Ход при kind='ask' сервер уже
      // завершил событием done, поэтому run не продолжается сам.
      parts.push({
        type: "data",
        name: CHAT_PRICING_PART,
        data: {
          kind: ev.kind,
          state: ev.state,
          message: ev.message,
          ...(ev.model !== undefined ? { model: ev.model } : {}),
          ...(ev.vendor !== undefined ? { vendor: ev.vendor } : {}),
          ...(ev.alternative !== undefined ? { alternative: ev.alternative } : {}),
          ...(ev.maxDeltaPercent !== undefined ? { maxDeltaPercent: ev.maxDeltaPercent } : {}),
        },
      })
      return false
    case "done":
      return false
    case "memory":
      // VL-402: запись памяти уже применена сервером — показываем её в ленте
      // data-частью (как pricing/truncated), чтобы строка пережила F5.
      // VL-419: personaId/personaLabel есть и у записей консультанта — карточка
      // пишет «<Роль> запомнил: …», а «Убрать» удаляет из файла этой роли.
      parts.push({
        type: "data",
        name: CHAT_MEMORY_PART,
        data: {
          index: ev.entry.index,
          text: ev.entry.text,
          date: ev.entry.date,
          personaId: ev.personaId,
          ...(ev.personaLabel !== undefined ? { personaLabel: ev.personaLabel } : {}),
        },
      })
      return false
    case "usage":
      // VL-313: расход треда — обновляем module-state панели (AC1). В content
      // сообщения ничего не кладём: это метаданные треда, а не часть ответа.
      setActiveUsage(ev.usage)
      return false
    case "subagent":
      // VL-409: консультация уже выполнена сервером. При display: widget
      // показываем карточку (data-часть переживает F5); при inline (дефолт)
      // ничего не добавляем — вопрос и ответ уже видны в tool-call части
      // ask_persona (её args/result приходят событиями tool_start/tool_end).
      if (ev.display === "widget") {
        parts.push({
          type: "data",
          name: CHAT_SUBAGENT_PART,
          data: {
            personaId: ev.personaId,
            personaLabel: ev.personaLabel,
            question: ev.question,
            answer: ev.answer,
            tokens: ev.tokens,
            // VL-415: пометка об обрезке должна пережить F5 — кладём в data-часть
            ...(ev.truncated === true ? { truncated: true } : {}),
            ...(ev.answerChars !== undefined ? { answerChars: ev.answerChars } : {}),
          },
        })
      }
      return false
    case "truncated": {
      // VL-269: ход остановлен лимитом, история сохранена. Плашку с причиной
      // и кнопкой «Продолжить» рендерит thread.tsx (PartView); флаг читает
      // run — он решает, продолжать автоматически или отдать кнопку.
      if (state) state.truncated = ev
      parts.push({
        type: "data",
        name: CHAT_TRUNCATED_PART,
        data: { reason: ev.reason, step: ev.step, saved: ev.saved !== false },
      })
      return false
    }
    default:
      return false
  }
}

/**
 * Наш ChatModelAdapter: один run = один ход, но ход может состоять из
 * нескольких POST. Событие `truncated` (VL-269) означает «сервер упёрся в
 * лимит, история сохранена» — клиент сам повторяет ход с `continue: true`
 * (без нового user-сообщения), пока не исчерпает `max_auto_continue`.
 * Дальше плашка с кнопкой «Продолжить» — ручное продолжение как аварийный
 * выход, а не рабочий ритм.
 */
const chatAdapter: ChatModelAdapter = {
  async *run(options): AsyncGenerator<ChatModelRunResult, void> {
    const parts: Part[] = []
    // Решения по approval читаются один раз: авто-продолжение уже не resume
    const decisions = pendingApprovalDecisions(options)
    /** Сколько авто-продолжений сделано в этом ходе (AC9). */
    let autoContinues = 0

    for (;;) {
      const state: { truncated?: Extract<ChatEvent, { type: "truncated" }> } = {}
      let pausedOnApproval = false

      // --- тело очередного POST -------------------------------------------
      let body: Record<string, unknown>
      // VL-331: ответ на интерактивный вопрос — human-tool: результат уже в
      // part.result (его положил addResult), отправляем его серверу первым.
      const answer = autoContinues === 0 ? pendingAnswerDecision(options) : undefined
      if (answer !== undefined) {
        sentAnswers.add(answer.toolCallId)
        body = {
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          answer: {
            toolCallId: answer.toolCallId,
            ...(answer.optionId !== undefined ? { optionId: answer.optionId } : {}),
            ...(answer.custom !== undefined ? { custom: answer.custom } : {}),
          },
        }
      } else if (decisions.length > 0 && autoContinues === 0) {
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
      } else if (autoContinues > 0) {
        // VL-269 (AC8): продолжение хода без user-сообщения и без пустой
        // строки в треде — сервер дописывает историю к уже накопленной.
        body = {
          continue: true,
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          ...(activeModelId ? { model: activeModelId } : {}),
        }
      } else if (takeRetryRequest()) {
        // VL-406: «Повторить» у плашки исхода (пустой ответ / ошибка /
        // прерванный ход). Повтор идёт по накопленной истории: user-сообщение
        // НЕ отправляется заново, иначе в jsonl появился бы дубль (AC3).
        body = {
          retry: true,
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          ...(activeModelId ? { model: activeModelId } : {}),
        }
      } else {
        // VL-317: ответ на карточку дрейфа цены — то же сообщение, но с
        // подтверждением расхождения и/или выбранным вендором
        const pricing = takePricingDecision()
        body = {
          message: lastUserText(options.messages),
          ...(pricing !== undefined
            ? {
                ...(pricing.ack ? { pricingAck: true } : {}),
                ...(pricing.vendor !== undefined ? { pricingVendor: pricing.vendor } : {}),
              }
            : {}),
          ...(activeThreadId ? { threadId: activeThreadId } : {}),
          // VL-209: переопределение модели (undefined — default из settings.json)
          ...(activeModelId ? { model: activeModelId } : {}),
          // VL-265/VL-283/VL-423: поле persona сервер читает ТОЛЬКО на первом
          // ходе нового треда (когда у треда ещё нет зафиксированной роли).
          // Для существующего треда оно всегда игнорируется, а его несовпадение
          // (module-state пикера ≠ роль треда) давало warn на каждом ходе —
          // шлём только когда треда ещё нет.
          ...(activeThreadId ? {} : { persona: activePersonaId }),
        }
      }

      // --- стриминг: читаем поток сами, yield после каждого события -------
      // VL-332: fetch НЕ получает options.abortSignal — иначе переключение
      // треда (рантайм размонтируется → сигнал абортится) убивало ход вместе
      // с ответом, который сервер так и не записывал в jsonl. Теперь ход
      // живёт на сервере, а здесь мы лишь прекращаем читать поток.
      let res: Response
      try {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
          if (applyEvent(parts, ev, state)) return "pause"
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
        yield { content: [...parts] as Parts }
        return
      }

      if (pausedOnApproval) {
        yield { content: [...parts] as Parts, status: { type: "requires-action", reason: "tool-calls" } }
        return
      }

      // AC11: остановка пользователем прерывает авто-продолжение — новый ход
      // не запускается (ComposerPrimitive.Cancel абортит abortSignal).
      if (options.abortSignal.aborted) return

      // --- авто-продолжение (AC8/AC9/AC10) --------------------------------
      const truncated = state.truncated
      if (truncated) {
        const maxAuto = truncated.limits?.maxAutoContinue ?? MAX_AUTO_CONTINUE_FALLBACK
        if (autoContinues < maxAuto) {
          autoContinues++
          const why = truncated.reason === "wall_time" ? "лимит времени" : "лимит итераций"
          parts.push({
            type: "text",
            text: `\n\n_Продолжаю — шаг ${autoContinues}, ${why} исчерпан._\n\n`,
          })
          yield { content: [...parts] as Parts }
          continue
        }
        // Авто-продолжения исчерпаны: плашка truncated остаётся в content,
        // thread.tsx показывает по ней кнопку «Продолжить» (ручной ход).
      }

      yield { content: [...parts] as Parts }
      return
    }
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
  initialUsage,
  onThreadCreated,
  children,
}: {
  /** id треда из hash (undefined — новый тред, сервер создаст при первом ходе). */
  threadId?: string
  /** Восстановленная история (initialMessages для useLocalRuntime). */
  initialMessages?: import("@assistant-ui/react").ThreadMessageLike[]
  /** Allow-list треда (VL-264): инструменты, разрешённые «Always allow». */
  allowList?: readonly string[] | undefined
  /**
   * Расход токенов треда из GET /api/chat/threads/:id (VL-313, AC2): панель
   * восстанавливает те же цифры после перезагрузки страницы.
   */
  initialUsage?: ThreadUsageView | null
  /** Новый тред создан сервером → обновить hash на #/chat/<id>. */
  onThreadCreated?: (id: string) => void
  children: React.ReactNode
}) {
  const runtime = useLocalRuntime(chatAdapter, {
    initialMessages,
    // VL-331: `ask_user` — human-tool: run встаёт на паузу, пока карточка не
    // завершит вызов через `part.addResult(...)`. Без этого списка рантайм
    // считал бы вызов «незавершённым обычным инструментом» и продолжал ход.
    unstable_humanToolNames: ["ask_user"],
  })

  // Колбэк через ref: adapter — module-level, не пересоздаём его на каждый рендер
  const createdRef = React.useRef(onThreadCreated)
  React.useEffect(() => {
    createdRef.current = onThreadCreated
  })

  React.useEffect(() => {
    activeThreadId = threadId
    sentApprovals.clear()
    // VL-331: отправленные ответы на вопросы — тоже свойство треда
    sentAnswers.clear()
    // VL-264: allow-list — свойство треда, при смене сбрасываем (иначе
    // «разрешено всегда» из другого треда дало бы ложную пометку)
    setAlwaysAllowed(allowList)
    // VL-313: расход — тоже свойство треда: новый тред начинается с нуля
    setActiveUsage(initialUsage ?? null)
    notifyThreadCreated = id => createdRef.current?.(id)
    return () => {
      notifyThreadCreated = null
    }
  }, [threadId, allowList, initialUsage])

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
