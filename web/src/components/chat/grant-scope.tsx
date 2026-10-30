/**
 * Состав прогона в approval-карточке grant (VL-268, AC10).
 *
 * Когда модель предлагает `backlog_supervisor { action: "start" }`, сервер
 * добавляет в approval-событие данные прогона: задачи, порядок, волны,
 * развязываемые инструменты и срок действия. Пользователь видит, что именно
 * он разрешает, может снять чекбоксы инструментов и поправить срок — правки
 * уходят на сервер (`POST /api/chat/supervisor/grant-draft`) ДО решения Allow,
 * чтобы `start` стартовал ровно с тем grant'ом, который подтверждён.
 *
 * Визуал — стиль VL-264 (paper-карточка внутри карточки, mono-подписи),
 * отдельных цветовых решений не вводим.
 */

import * as React from "react"

import { cn } from "@/lib/utils"
import { field, mono } from "./surfaces"

/** Данные прогона из approval-события (зеркало SupervisorGrantPreview сервера). */
export interface GrantPreview {
  runId: string
  taskIds: string[]
  tools: { name: string; enabled: boolean; description: string }[]
  expiresAt: string
  grantedAt: string
  order: { id: string; status: string; phase: string; wave: number; priority: string }[]
  groups: string[][]
  rationale: string
  skipped: { id: string; reason: string }[]
  maxParallelPhases: number
}

/** Вытаскивает grant-предпросмотр из providerMetadata tool-call part'а. */
export function grantPreviewOf(part: {
  providerMetadata?: unknown
}): GrantPreview | null {
  const meta = part.providerMetadata as { vibelog?: { grant?: unknown } } | undefined
  const raw = meta?.vibelog?.grant
  if (raw === null || typeof raw !== "object") return null
  const g = raw as Partial<GrantPreview>
  if (typeof g.runId !== "string" || !Array.isArray(g.taskIds)) return null
  return {
    runId: g.runId,
    taskIds: g.taskIds.filter((t): t is string => typeof t === "string"),
    tools: Array.isArray(g.tools)
      ? g.tools
          .filter(t => t !== null && typeof t === "object")
          .map(t => ({
            name: String((t as { name?: unknown }).name ?? ""),
            enabled: (t as { enabled?: unknown }).enabled !== false,
            description: String((t as { description?: unknown }).description ?? ""),
          }))
          .filter(t => t.name !== "")
      : [],
    expiresAt: typeof g.expiresAt === "string" ? g.expiresAt : "",
    grantedAt: typeof g.grantedAt === "string" ? g.grantedAt : "",
    order: Array.isArray(g.order) ? g.order : [],
    groups: Array.isArray(g.groups) ? g.groups : [],
    rationale: typeof g.rationale === "string" ? g.rationale : "",
    skipped: Array.isArray(g.skipped) ? g.skipped : [],
    maxParallelPhases: typeof g.maxParallelPhases === "number" ? g.maxParallelPhases : 2,
  }
}

/** ISO → значение для input[type=datetime-local] (локальное время браузера). */
function toLocalInput(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ""
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** Значение datetime-local → ISO (невалидное → ""). */
export function fromLocalInput(value: string): string {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString()
}

/** Состояние правок карточки (что уйдёт в draft при подтверждении). */
export interface GrantEdits {
  allowedTools: string[]
  expiresAt: string
}

/**
 * Блок состава прогона: задачи с фазами/волнами, чекбоксы инструментов, срок.
 *
 * Состояние правок поднимается в ApprovalCard через `onChange` — карточка
 * отправляет draft перед решением (как «Always allow» в VL-264).
 */
export function GrantScope({
  preview,
  disabled = false,
  onChange,
}: {
  preview: GrantPreview
  disabled?: boolean
  onChange: (edits: GrantEdits) => void
}) {
  const [enabled, setEnabled] = React.useState<string[]>(() =>
    preview.tools.filter(t => t.enabled).map(t => t.name),
  )
  const [expires, setExpires] = React.useState(() => toLocalInput(preview.expiresAt))

  // Правки уходят наверх до первого решения: draft должен существовать к
  // моменту Allow, иначе start пойдёт с дефолтным набором инструментов
  React.useEffect(() => {
    onChange({ allowedTools: enabled, expiresAt: fromLocalInput(expires) || preview.expiresAt })
  }, [enabled, expires, preview.expiresAt])

  const toggle = (name: string) => {
    setEnabled(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className={cn(mono, "text-[10px] tracking-wider text-muted-foreground uppercase")}>
        Прогон {preview.runId}
      </p>

      <dl className={cn(field, "flex flex-col gap-1.5 rounded-xl px-3.5 py-2.5 text-xs")}>
        {preview.order.map(item => (
          <div key={item.id} className="flex items-baseline justify-between gap-3">
            <dt className="font-mono text-foreground/80">{item.id}</dt>
            <dd className="text-muted-foreground">
              {item.status} → {item.phase} · волна {item.wave} · {item.priority}
            </dd>
          </div>
        ))}
        {preview.order.length === 0 && (
          <div className="text-muted-foreground">Задач с доступной фазой нет</div>
        )}
      </dl>

      <div className={cn(field, "flex flex-col gap-1.5 rounded-xl px-3.5 py-2.5 text-xs")}>
        <span className="text-muted-foreground">Развязываемые инструменты</span>
        {preview.tools.map(tool => (
          <label key={tool.name} className="flex items-start gap-2 text-foreground/80">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled.includes(tool.name)}
              disabled={disabled}
              onChange={() => toggle(tool.name)}
              data-slot="grant-tool-checkbox"
              data-tool={tool.name}
            />
            <span>
              <span className="font-mono">{tool.name}</span>
              {tool.description ? <span className="text-muted-foreground"> — {tool.description}</span> : null}
            </span>
          </label>
        ))}
        <span className="text-muted-foreground">
          write_file и другие файловые изменения сюда не входят — они всегда спрашивают подтверждение.
        </span>
      </div>

      <label className={cn(field, "flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-xs")}>
        <span className="text-muted-foreground">Срок действия</span>
        <input
          type="datetime-local"
          className="bg-transparent font-mono text-xs text-foreground/80 outline-none"
          value={expires}
          disabled={disabled}
          onChange={event => setExpires(event.target.value)}
          data-slot="grant-expires-input"
        />
      </label>

      {preview.skipped.length > 0 && (
        <p className="text-[11px] text-foreground/60">
          Пропущены: {preview.skipped.map(s => `${s.id} — ${s.reason}`).join("; ")}
        </p>
      )}
    </div>
  )
}

/**
 * Сохранение правок карточки на сервере (draft).
 *
 * Вызывается ApprovalCard'ом ПЕРЕД respondToApproval: сервер подхватит draft
 * при выполнении `backlog_supervisor start`. Ошибка не блокирует решение
 * (иначе пользователь не смог бы подтвердить прогон из-за сети), но текст
 * возвращается — карточка его покажет.
 */
export async function saveGrantDraft(
  preview: GrantPreview,
  edits: GrantEdits,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/chat/supervisor/grant-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: preview.runId,
        taskIds: preview.taskIds,
        allowedTools: edits.allowedTools,
        expiresAt: edits.expiresAt,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `сервер ответил ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
