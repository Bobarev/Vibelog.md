/**
 * Пикеры нижней строки композера чата (VL-265): модель и роль ассистента.
 *
 * Образец — ref-22 (assistant-ui, apps/docs/components/pages/examples/
 * perplexity.tsx): ghost-кнопка с названием и ChevronDownIcon, дропдаун с
 * галочкой у выбранного пункта и описанием во второй строке.
 *
 * Модель (ModelPicker): список из GET /api/models, выбор — module-state
 * адаптера (setActiveModelId) → body.model следующего POST /api/chat.
 * Записи в settings.json нет (это разовое переопределение чата).
 *
 * Роль (PersonaPicker): список из GET /api/personas (id/label/description,
 * без текстов промптов), выбор — module-state (setActivePersonaId) →
 * body.persona. Роль модель НЕ задаёт: пикеры независимы.
 *
 * Оба пикера тихо скрываются, если API недоступен или список пуст: это
 * вспомогательные контролы, а не блокирующая часть чата (lesson-16).
 */

import * as React from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  fetchModels,
  fetchPersonas,
  type ModelsData,
  type PersonaInfo,
} from "@/components/settings/api"
import { getActivePersonaId, setActiveModelId, setActivePersonaId } from "./chat-runtime"
import {
  Bot,
  CheckIcon,
  ChevronDownIcon,
  Compass,
  Hammer,
  Lock,
  ScanSearch,
  Sparkles,
  Telescope,
} from "lucide-react"

const TRIGGER_CLASS =
  "flex h-8 items-center gap-1 rounded-full px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"

/** Иконки ролей по id (встроенные + типовые проектные); неизвестная — Bot. */
const PERSONA_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  helper: Sparkles,
  architect: Compass,
  researcher: Telescope,
  auditor: ScanSearch,
  coder: Hammer,
}

/** Отрисовка иконки роли: компонент выбирается внутри, чтобы линтер не
 * считал создание компонента в рендере (react-hooks/static-components). */
function PersonaIcon({ id, className }: { id: string; className?: string }) {
  const Icon = PERSONA_ICONS[id] ?? Bot
  return <Icon className={className} />
}

/**
 * Пикер модели: название модели + ChevronDownIcon, дропдаун с label и
 * description. Не рендерится, если моделей нет (env-fallback, VL-209).
 */
export function ModelPicker() {
  const [data, setData] = React.useState<ModelsData | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetchModels()
      .then((d) => {
        if (cancelled) return
        setData(d)
        // Активная модель = default из settings.json, пока пользователь не выбрал
        setSelected(d.default)
      })
      .catch(() => {
        // Пикер — не критично: при недоступности API прячем
        if (!cancelled) setData({ default: null, available: [], providers: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data || data.available.length === 0) return null
  const current = data.available.find((m) => m.id === selected) ?? data.available[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(TRIGGER_CLASS, "hidden sm:flex")}
        aria-label={`Модель: ${current.label}`}
      >
        <span className="max-w-40 truncate">{current.label}</span>
        <ChevronDownIcon className="size-4 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        {data.available.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => {
              setSelected(m.id)
              setActiveModelId(m.id)
            }}
            className="flex items-start gap-3"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {m.id === current.id ? <CheckIcon className="size-4" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">{m.label}</span>
              {m.description ? (
                <span className="text-xs text-muted-foreground">{m.description}</span>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Загрузка реестра ролей (общая для пикера и бейджа VL-283).
 *
 * `personas === null` — ещё грузим; `[]` — API недоступен/список пуст
 * (тогда ни пикер, ни бейдж не рендерятся, lesson-16).
 *
 * `onLoad` вызывается из then-колбэка fetch (не в теле эффекта): пикеру нужно
 * синхронизировать выбор с ответом сервера, а setState в теле эффекта даёт
 * каскадные рендеры (правило react-hooks/set-state-in-effect).
 */
function usePersonas(
  onLoad?: (personas: PersonaInfo[], defaultId: string) => void,
): { personas: PersonaInfo[] | null; defaultId: string | null } {
  const [personas, setPersonas] = React.useState<PersonaInfo[] | null>(null)
  const [defaultId, setDefaultId] = React.useState<string | null>(null)
  // Колбэк в ref: эффект не перезапускается на каждый рендер
  const loadRef = React.useRef(onLoad)
  React.useEffect(() => {
    loadRef.current = onLoad
  })

  React.useEffect(() => {
    let cancelled = false
    fetchPersonas()
      .then((d) => {
        if (cancelled) return
        setPersonas(d.personas)
        setDefaultId(d.default)
        loadRef.current?.(d.personas, d.default)
      })
      .catch(() => {
        // Пикер — не критично: при недоступности API прячем
        if (!cancelled) setPersonas([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { personas, defaultId }
}

/**
 * Пикер роли: иконка + название + ChevronDownIcon, дропдаун с name +
 * description и галочкой у выбранной роли. Стартовое значение — дефолт
 * сервера (всегда helper, AC14); localStorage не используется.
 *
 * VL-283: пикер показывается ТОЛЬКО в пустом треде — роль фиксируется за
 * тредом при первом ходе, в начатом чате вместо него PersonaBadge.
 */
export function PersonaPicker() {
  // Старт — локальный выбор (module-state); после ответа сервера выбор
  // корректируется: роли могло не оказаться в реестре
  const [selected, setSelected] = React.useState<string>(getActivePersonaId())
  const sync = React.useCallback((roles: PersonaInfo[], fallback: string) => {
    setSelected((prev) => (roles.some((p) => p.id === prev) ? prev : fallback))
    if (!roles.some((p) => p.id === getActivePersonaId())) {
      setActivePersonaId(fallback)
    }
  }, [])
  const { personas } = usePersonas(sync)

  if (!personas || personas.length === 0) return null
  const current = personas.find((p) => p.id === selected) ?? personas[0]!
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(TRIGGER_CLASS, "border border-border bg-transparent")}
        aria-label={`Роль ассистента: ${current.label}`}
      >
        <PersonaIcon id={current.id} className="size-3.5" />
        <span className="max-w-40 truncate">{current.label}</span>
        <ChevronDownIcon className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {personas.map((p) => {
          return (
            <DropdownMenuItem
              key={p.id}
              onClick={() => {
                setSelected(p.id)
                setActivePersonaId(p.id)
              }}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {p.id === current.id ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <PersonaIcon id={p.id} className="size-3.5" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{p.label}</span>
                {p.description ? (
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Бейдж роли треда (VL-283): роль зафиксирована при создании треда и в
 * начатом чате не переключается — значит нужен неинтерактивный индикатор
 * (иконка + название + замок), а не дропдаун.
 *
 * Источник id — ответ `GET /api/chat/threads/:id` (поле `persona`), а НЕ
 * module-state activePersonaId: открытие треда с другой ролью не должно
 * перетирать выбор роли для следующего нового треда (AC5).
 * Роль, которой нет в реестре (удалена из chat_personas), показывается как
 * «Помощник» — сервер в этом случае ведёт тред помощником.
 */
export function PersonaBadge({ personaId }: { personaId: string }) {
  const { personas, defaultId } = usePersonas()
  if (!personas || personas.length === 0) return null
  const fallbackId = defaultId ?? "helper"
  const current =
    personas.find((p) => p.id === personaId) ?? personas.find((p) => p.id === fallbackId)
  const label = current?.label ?? "Помощник"
  const iconId = current?.id ?? fallbackId
  return (
    <span
      className={cn(TRIGGER_CLASS, "border border-border bg-transparent", "cursor-default")}
      title="Роль зафиксирована при создании треда — переключение недоступно"
      aria-label={`Роль треда: ${label} (зафиксирована)`}
    >
      <PersonaIcon id={iconId} className="size-3.5" />
      <span className="max-w-40 truncate">{label}</span>
      <Lock className="size-3 opacity-60" aria-hidden="true" />
    </span>
  )
}
