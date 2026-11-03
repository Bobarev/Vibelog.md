/**
 * Веб-мастер настройки проекта `#/setup` (VL-210).
 *
 * Секции-Card по шагам описания: проект → агенты → секреты → бот → LLM → MCP.
 * Данные — GET /api/setup (текущие значения как дефолты, upgrade-режим
 * показывает их же), сохранение — POST /api/setup (то же ядро, что у
 * консольного wizard-а: core/setup.ts applySetup).
 *
 * Секреты в браузер не приходят: сервер отдаёт только keySet/envKeys.
 * После сохранения — баннер «Проект настроен» и переход на канбан (#/).
 * Компонента toast в ui/ нет — не добавляем зависимость ради одного сообщения.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  checkBot,
  fetchSetupState,
  pingLlm,
  postSetup,
  type BotCheckResult,
  type LlmPingResult,
  type SetupStateData,
} from "./api"

/** Подписи агентов (те же, что в консольном wizard-е). */
const AGENT_LABELS: Record<string, string> = {
  vb: "vb — встроенный Vibelog-агент (нужен LLM)",
  qwen: "qwen — внешний Qwen Code",
  opencode: "opencode — внешний OpenCode",
  claude: "claude — внешний Claude Code",
}

/** Состояние формы. */
interface FormState {
  projectName: string
  prefix: string
  agents: string[]
  defaultAgent: string
  secretsLocation: "env" | "settings" | "both"
  botEnabled: boolean
  botToken: string
  botChats: string
  gatewayId: string
  baseUrl: string
  apiKeyEnv: string
  apiKey: string
  modelId: string
  apiMode: "chat" | "responses"
  mcp: boolean
}

/** Состояние → форма (текущие значения как дефолты). */
function toFormState(s: SetupStateData): FormState {
  const enabled = s.agents.filter((a) => a.enabled).map((a) => a.id)
  const firstGateway = s.gateways[0]
  const firstModel = s.models.available[0]
  return {
    projectName: s.projectName,
    prefix: s.prefix,
    agents: enabled,
    defaultAgent: s.defaultAgent ?? enabled[0] ?? "",
    secretsLocation: "env",
    botEnabled: s.bot.configured,
    botToken: "",
    botChats: s.bot.chats.join(","),
    gatewayId: firstGateway?.id ?? "",
    baseUrl: firstGateway?.base_url ?? "",
    apiKeyEnv: firstGateway?.api_key_env ?? "",
    apiKey: "",
    modelId: s.models.default ?? firstModel?.id ?? "",
    apiMode: firstModel?.api_mode ?? "chat",
    mcp: true,
  }
}

export function SetupPage() {
  const [state, setState] = React.useState<SetupStateData | null>(null)
  const [form, setForm] = React.useState<FormState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState<string[] | null>(null)
  const [ping, setPing] = React.useState<LlmPingResult | null>(null)
  const [pinging, setPinging] = React.useState(false)
  const [botCheck, setBotCheck] = React.useState<BotCheckResult | null>(null)

  React.useEffect(() => {
    let alive = true
    fetchSetupState()
      .then((data) => {
        if (!alive) return
        setState(data)
        setForm(toFormState(data))
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  /** Обновляет одно поле формы. */
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  /** Переключает галочку агента (disabled-агенты не переключаются). */
  function toggleAgent(id: string) {
    if (!form) return
    const agent = state?.agents.find((a) => a.id === id)
    if (agent?.reason) return
    const next = form.agents.includes(id)
      ? form.agents.filter((a) => a !== id)
      : [...form.agents, id]
    setForm({
      ...form,
      agents: next,
      defaultAgent: next.includes(form.defaultAgent) ? form.defaultAgent : next[0] ?? "",
    })
  }

  /** Сохранение формы. */
  async function handleSave() {
    if (!form || !state) return
    setSaving(true)
    setError(null)
    try {
      const chats = form.botChats
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n !== 0)
      const result = await postSetup({
        mode: state.mode,
        projectName: form.projectName,
        prefix: form.prefix,
        agents: form.agents,
        defaultAgent: form.agents.length > 1 ? form.defaultAgent : undefined,
        secretsLocation: form.secretsLocation,
        bot: form.botEnabled
          ? { token: form.botToken || undefined, chats }
          : undefined,
        gateway: form.gatewayId
          ? {
              id: form.gatewayId,
              base_url: form.baseUrl,
              api_key_env: form.apiKeyEnv || undefined,
              apiKey: form.apiKey || undefined,
            }
          : undefined,
        model: form.modelId
          ? {
              id: form.modelId,
              gateway: form.gatewayId,
              model: form.modelId,
              api_mode: form.apiMode,
            }
          : undefined,
        mcp: form.mcp,
      })
      setSaved(result.written)
      // Редирект на канбан после короткой паузы, чтобы баннер был виден
      window.setTimeout(() => {
        window.location.hash = "#/"
      }, 1200)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** Ping LLM. */
  async function handlePing() {
    if (!form) return
    setPinging(true)
    setPing(null)
    try {
      setPing(await pingLlm(form.modelId || undefined))
    } finally {
      setPinging(false)
    }
  }

  /** Проверка токена бота. */
  async function handleBotCheck() {
    if (!form) return
    setBotCheck(await checkBot(form.botToken || undefined))
  }

  if (error && !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ошибка настройки</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!form || !state) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const needsLlm = form.agents.includes("vb")
  const needsMcp = form.agents.includes("qwen") || form.agents.includes("opencode")

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Настройка проекта</h1>
        <p className="text-muted-foreground text-sm">
          Режим: {state.mode === "upgrade" ? "upgrade (backlog/ найден)" : "fresh (новый проект)"}
          {state.configError ? ` — ${state.configError}` : ""}
        </p>
      </div>

      {saved && (
        <Card className="border-green-600/40">
          <CardHeader>
            <CardTitle>Проект настроен</CardTitle>
            <CardDescription>
              Записано: {saved.length > 0 ? saved.join(", ") : "изменений нет"}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Ошибка</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* 1. Проект */}
      <Card>
        <CardHeader>
          <CardTitle>Проект</CardTitle>
          <CardDescription>Имя проекта и префикс ID задач</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="setup-name">Имя проекта</Label>
            <Input
              id="setup-name"
              value={form.projectName}
              onChange={(e) => set("projectName", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="setup-prefix">Prefix</Label>
            <Input
              id="setup-prefix"
              value={form.prefix}
              onChange={(e) => set("prefix", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Агенты */}
      <Card>
        <CardHeader>
          <CardTitle>Агенты</CardTitle>
          <CardDescription>
            Ни одна галочка не обязательна: без агента проект работает как таск-менеджер
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.agents.map((agent) => (
            <label
              key={agent.id}
              className={`flex items-center gap-2 text-sm ${agent.reason ? "opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={form.agents.includes(agent.id)}
                disabled={Boolean(agent.reason)}
                onChange={() => toggleAgent(agent.id)}
              />
              <span>{AGENT_LABELS[agent.id] ?? agent.id}</span>
              {agent.reason && <span className="text-muted-foreground">— {agent.reason}</span>}
            </label>
          ))}
          {form.agents.length > 1 && (
            <div className="space-y-1 pt-2">
              <Label>Агент по умолчанию</Label>
              <Select
                value={form.defaultAgent}
                onValueChange={(v) => set("defaultAgent", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {form.agents.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Секреты */}
      <Card>
        <CardHeader>
          <CardTitle>Где хранить ключи</CardTitle>
          <CardDescription>
            {state.secrets.envFile
              ? `.env уже есть (${state.secrets.envKeys.length} ключей)`
              : ".env будет создан"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(
            [
              ["env", ".env (gitignore) — рекомендуется"],
              ["settings", "settings.json (секция env, gitignore)"],
              ["both", "Оба (.env + fallback на settings.json env)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="secrets-location"
                checked={form.secretsLocation === value}
                onChange={() => set("secretsLocation", value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* 4. Бот */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram-бот</CardTitle>
          <CardDescription>
            {state.bot.configured
              ? `Бот уже настроен (чаты: ${state.bot.chats.length})`
              : "Опционально: управление задачами из Telegram"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.botEnabled}
              onChange={(e) => set("botEnabled", e.target.checked)}
            />
            <span>Настроить бота</span>
          </label>
          {form.botEnabled && (
            <>
              <div className="space-y-1">
                <Label htmlFor="setup-bot-token">Токен (TELEGRAM_BOT_TOKEN)</Label>
                <Input
                  id="setup-bot-token"
                  type="password"
                  placeholder="оставьте пустым, чтобы не менять"
                  value={form.botToken}
                  onChange={(e) => set("botToken", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="setup-bot-chats">chat_id через запятую</Label>
                <Input
                  id="setup-bot-chats"
                  value={form.botChats}
                  onChange={(e) => set("botChats", e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleBotCheck}>
                  Проверить токен
                </Button>
                {botCheck && (
                  <span className="text-sm">
                    {botCheck.ok ? `OK: @${botCheck.username ?? "бот"}` : botCheck.error}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 5. LLM */}
      {needsLlm && (
        <Card>
          <CardHeader>
            <CardTitle>LLM: провайдер и модель</CardTitle>
            <CardDescription>
              {state.gateways.length > 0
                ? `Шлюзы: ${state.gateways.map((p) => p.id).join(", ")}`
                : "Провайдеров пока нет — заполните id и base_url"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="setup-provider">Провайдер (id)</Label>
              <Input
                id="setup-provider"
                value={form.gatewayId}
                onChange={(e) => set("gatewayId", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-base-url">base_url</Label>
              <Input
                id="setup-base-url"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-key-env">Имя env-переменной с ключом</Label>
              <Input
                id="setup-key-env"
                value={form.apiKeyEnv}
                onChange={(e) => set("apiKeyEnv", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-key">Ключ (сохранится в выбранное место)</Label>
              <Input
                id="setup-key"
                type="password"
                placeholder="оставьте пустым, если уже задан"
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="setup-model">Модель (id)</Label>
              <Input
                id="setup-model"
                value={form.modelId}
                onChange={(e) => set("modelId", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>api_mode</Label>
              <Select
                value={form.apiMode}
                onValueChange={(v) => set("apiMode", v as "chat" | "responses")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">chat</SelectItem>
                  <SelectItem value="responses">responses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePing} disabled={pinging}>
                {pinging ? "Проверяю…" : "Проверить"}
              </Button>
              {ping && (
                <span className="text-sm">
                  {ping.ok
                    ? `${ping.model}: ${ping.latencyMs} мс${
                        ping.usage
                          ? `, usage ${ping.usage.input}/${ping.usage.output}/${ping.usage.total}`
                          : ""
                      }`
                    : ping.error}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. MCP */}
      {needsMcp && (
        <Card>
          <CardHeader>
            <CardTitle>MCP-сервер</CardTitle>
            <CardDescription>
              {state.mcp.qwen || state.mcp.opencode
                ? "MCP уже настроен (trust: true)"
                : "Записать mcpServers.vibelog в конфиг агента"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.mcp}
                onChange={(e) => set("mcp", e.target.checked)}
              />
              <span>Настроить vibelog MCP</span>
            </label>
          </CardContent>
        </Card>
      )}

      <Separator />
      <div className="flex items-center gap-2 pb-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </Button>
        <Button variant="ghost" onClick={() => (window.location.hash = "#/")}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
