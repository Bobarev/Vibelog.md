/**
 * Веб-мастер настройки проекта `#/setup` (VL-210, выровнен с CLI-wizard в VL-328).
 *
 * Секции-Card по шагам: проект → агенты → секреты → бот → LLM → MCP.
 * Данные — GET /api/setup (текущие значения как дефолты, upgrade-режим
 * показывает их же), сохранение — POST /api/setup (то же ядро, что у
 * консольного wizard-а: core/setup.ts applySetup).
 *
 * VL-328: форма повторяет возможности консольного wizard-а после VL-324/327 —
 * шлюз выбирается из пресетов ядра (core/llm-presets.ts), api_key_env
 * подставляется по шлюзу, модель и вендор берутся из каталога
 * (/api/catalog/*) двухступенчатым выбором «автор → модели автора», api_mode
 * по умолчанию `responses`, есть TELEGRAM_PROXY и подтверждение перезаписи
 * ключа. Раньше здесь были сырые текстовые поля с устаревшими дефолтами.
 *
 * Секреты в браузер не приходят: сервер отдаёт только keySet/envKeys.
 * После сохранения — баннер «Проект настроен» и переход на канбан (#/).
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
  fetchCatalogModels,
  fetchCatalogVendors,
  fetchSetupState,
  pingLlm,
  postSetup,
  type BotCheckResult,
  type CatalogModel,
  type CatalogVendor,
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

/** Локации секретов (VL-329: секция env settings.json удалена). */
type SecretsLocation = "system" | "env"

/** Цена за 1M токенов для подписи пункта (как в CLI-wizard-е, VL-324). */
function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—"
  return `${Number(value.toFixed(4))} ₽/1M`
}

/** Подпись модели/вендора: имя + цены входа/выхода (AC3). */
function priceHint(pricing: { input_per_1m: number; output_per_1m: number } | undefined): string {
  return `${formatPrice(pricing?.input_per_1m)} / ${formatPrice(pricing?.output_per_1m)}`
}

/** Автор модели — сегмент id до `/` (deepseek/deepseek-chat → deepseek). */
function authorOf(modelId: string): string {
  const at = modelId.indexOf("/")
  return at === -1 ? modelId : modelId.slice(0, at)
}

/** Состояние формы. */
interface FormState {
  projectName: string
  prefix: string
  agents: string[]
  defaultAgent: string
  secretsLocation: SecretsLocation
  botEnabled: boolean
  botToken: string
  botChats: string
  /** VL-324/328: TELEGRAM_PROXY; пустое значение не пишется в .env. */
  botProxy: string
  /** Выбранный пресет шлюза (id из core/llm-presets.ts). */
  gatewayPreset: string
  /** id шлюза: у пресетов совпадает, у custom выводится из домена. */
  gatewayId: string
  baseUrl: string
  apiKeyEnv: string
  apiKey: string
  /** VL-328 (AC7): перезаписать уже существующий ключ. */
  secretsOverwrite: boolean
  modelId: string
  /** Автор модели для двухступенчатого выбора. */
  modelAuthor: string
  /** Вендор (апстрим) модели; "" — без вендора. */
  vendor: string
  apiMode: "chat" | "responses"
  mcp: boolean
}

/**
 * Находит шлюз в состоянии, соответствующий пресету: сначала по id пресета,
 * иначе (для custom) первый настроенный шлюз, которого нет среди пресетов.
 */
function findGatewayForPreset(s: SetupStateData, presetId: string) {
  const preset = s.gatewayPresets.find((p) => p.id === presetId)
  if (preset === undefined) return undefined
  if (!preset.custom) return s.gateways.find((g) => g.id === preset.id)
  const presetIds = new Set(s.gatewayPresets.map((p) => p.id))
  return s.gateways.find((g) => !presetIds.has(g.id))
}

/** Состояние → форма (текущие значения как дефолты). */
function toFormState(s: SetupStateData): FormState {
  const enabled = s.agents.filter((a) => a.enabled).map((a) => a.id)
  // VL-328: дефолтный шлюз — первый настроенный; если шлюзов ещё нет,
  // подставляем первый пресет (RouterAI) — как делает CLI-wizard (AC1).
  const knownGateway =
    s.gateways.find((g) => s.gatewayPresets.some((p) => p.id === g.id)) ?? s.gateways[0]
  const matchedPreset = s.gatewayPresets.find((p) => p.id === knownGateway?.id)
  const presetId = matchedPreset?.id ?? s.gatewayPresets[0]?.id ?? ""
  const preset = s.gatewayPresets.find((p) => p.id === presetId)
  const activeGateway = knownGateway ?? undefined
  const defaultModelId = s.models.default ?? s.models.available[0]?.id ?? ""
  const defaultModel = s.models.available.find((m) => m.id === defaultModelId)
  return {
    projectName: s.projectName,
    prefix: s.prefix,
    agents: enabled,
    defaultAgent: s.defaultAgent ?? enabled[0] ?? "",
    secretsLocation: "env",
    botEnabled: s.bot.configured,
    botToken: "",
    botChats: s.bot.chats.join(","),
    botProxy: "",
    gatewayPreset: presetId,
    gatewayId: activeGateway?.id ?? preset?.id ?? "",
    baseUrl: activeGateway?.base_url ?? preset?.base_url ?? "",
    apiKeyEnv: activeGateway?.api_key_env ?? preset?.api_key_env ?? "",
    apiKey: "",
    secretsOverwrite: false,
    modelId: defaultModelId,
    modelAuthor: defaultModelId !== "" ? authorOf(defaultModelId) : "",
    vendor: defaultModel?.vendor ?? "",
    // VL-328 (AC4): дефолт api_mode — responses (было chat)
    apiMode: defaultModel?.api_mode ?? "responses",
    mcp: true,
  }
}

export function SetupPage() {
  const [state, setState] = React.useState<SetupStateData | null>(null)
  const [form, setForm] = React.useState<FormState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState<{ written: string[]; skipped: string[] } | null>(null)
  const [ping, setPing] = React.useState<LlmPingResult | null>(null)
  const [pinging, setPinging] = React.useState(false)
  const [botCheck, setBotCheck] = React.useState<BotCheckResult | null>(null)

  // VL-328 (AC3): каталог моделей и вендоров — как в CLI-wizard-е (VL-316/324)
  const [catalogModels, setCatalogModels] = React.useState<CatalogModel[] | null>(null)
  const [catalogVendors, setCatalogVendors] = React.useState<CatalogVendor[] | null>(null)
  const [catalogError, setCatalogError] = React.useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  /** Ручной ввод модели (каталог недоступен или модели нет в каталоге). */
  const [manualModel, setManualModel] = React.useState(false)

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

  /** Выбор пресета шлюза: подставляет base_url/api_key_env/id (AC1, AC2). */
  function choosePreset(presetId: string) {
    if (!state || !form) return
    const preset = state.gatewayPresets.find((p) => p.id === presetId)
    if (preset === undefined) return
    const known = findGatewayForPreset(state, presetId)
    setForm({
      ...form,
      gatewayPreset: presetId,
      gatewayId: known?.id ?? preset.id,
      // custom: base_url вводит пользователь, но ранее настроенный — как дефолт
      baseUrl: known?.base_url ?? preset.base_url ?? "",
      apiKeyEnv: known?.api_key_env ?? preset.api_key_env,
      // Смена шлюза меняет пространство моделей — сбрасываем каталог
      vendor: "",
      modelAuthor: "",
    })
    setCatalogModels(null)
    setCatalogVendors(null)
    setCatalogError(null)
  }

  /**
   * Загружает каталог моделей выбранного шлюза (AC3).
   *
   * Шлюз на fresh-проекте ещё не в settings.json, поэтому каталог спрашиваем
   * по id пресета — сервер сам возьмёт base_url из ядра (VL-328).
   */
  async function loadCatalog(presetId: string) {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const { models } = await fetchCatalogModels(presetId, "")
      setCatalogModels(models)
      const first = models[0]
      if (first !== undefined) {
        setForm((prev) =>
          prev ? { ...prev, modelAuthor: prev.modelId ? authorOf(prev.modelId) : authorOf(first.id) } : prev,
        )
      }
      return models
    } catch (err) {
      setCatalogError((err as Error).message)
      setManualModel(true)
      return null
    } finally {
      setCatalogLoading(false)
    }
  }

  /** Выбор модели: тянет вендоров (апстримы) с их ценами (AC3). */
  async function chooseModel(gatewayForCatalog: string, modelId: string) {
    if (!form) return
    setForm({ ...form, modelId, modelAuthor: authorOf(modelId), vendor: "" })
    setCatalogVendors(null)
    if (modelId === "") return
    try {
      const { vendors } = await fetchCatalogVendors(gatewayForCatalog, modelId)
      setCatalogVendors(vendors)
    } catch {
      // Вендор необязателен (VL-315): без него работает шлюз по умолчанию
      setCatalogVendors([])
    }
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
      const proxy = form.botProxy.trim()
      const preset = state.gatewayPresets.find((p) => p.id === form.gatewayPreset)
      const result = await postSetup({
        mode: state.mode,
        projectName: form.projectName,
        prefix: form.prefix,
        agents: form.agents,
        defaultAgent: form.agents.length > 1 ? form.defaultAgent : undefined,
        secretsLocation: form.secretsLocation,
        // VL-328 (AC6): пустой прокси не отправляем — ключ TELEGRAM_PROXY
        // не должен появляться в .env пустым (grammY ждёт URL)
        bot: form.botEnabled
          ? { token: form.botToken || undefined, chats, ...(proxy !== "" ? { proxy } : {}) }
          : undefined,
        gateway: form.gatewayId
          ? {
              id: form.gatewayId,
              ...(preset !== undefined ? { preset: preset.id } : {}),
              base_url: form.baseUrl,
              api_key_env: form.apiKeyEnv || undefined,
              apiKey: form.apiKey || undefined,
            }
          : undefined,
        model: form.modelId
          ? {
              id: form.modelId,
              gateway: form.gatewayId,
              ...(form.vendor !== "" ? { vendor: form.vendor } : {}),
              model: form.modelId,
              api_mode: form.apiMode,
            }
          : undefined,
        // VL-328 (AC7): подтверждение перезаписи существующего ключа
        secretsOverwrite: form.secretsOverwrite,
        mcp: form.mcp,
      })
      setSaved({ written: result.written, skipped: result.skipped })
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
  const activePreset = state.gatewayPresets.find((p) => p.id === form.gatewayPreset)
  const isCustomGateway = activePreset?.custom === true
  const presetHasCatalog = activePreset?.catalog === true
  const selectedGateway = state.gateways.find((g) => g.id === form.gatewayId)
  const keyAlreadySet = selectedGateway?.keySet === true
  const modelAuthors = catalogModels === null
    ? []
    : Array.from(new Set(catalogModels.map((m) => authorOf(m.id)))).sort()
  const authorModels = catalogModels === null || form.modelAuthor === ""
    ? []
    : catalogModels.filter((m) => authorOf(m.id) === form.modelAuthor)
  const visibleLocations = state.secretsLocations

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
              Записано: {saved.written.length > 0 ? saved.written.join(", ") : "изменений нет"}
              {saved.skipped.length > 0
                ? `. Пропущено (уже заданы): ${saved.skipped.join(", ")}`
                : ""}
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
              <Select value={form.defaultAgent} onValueChange={(v) => set("defaultAgent", v)}>
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

      {/* 3. Секреты — только предлагаемые локации (AC5) */}
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
          {visibleLocations.map((loc) => (
            <label key={loc.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="secrets-location"
                checked={form.secretsLocation === loc.id}
                onChange={() => set("secretsLocation", loc.id)}
              />
              <span>{loc.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* 4. Бот (+ TELEGRAM_PROXY, AC6) */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram-бот</CardTitle>
          <CardDescription>
            {state.bot.configured
              ? `Бот уже настроен (чаты: ${state.bot.chats.length})`
              : "Опционально: управление задачами из Telegram"}
            {state.bot.proxySet ? " · прокси задан" : ""}
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
                <Label htmlFor="setup-bot-proxy">Прокси (TELEGRAM_PROXY)</Label>
                <Input
                  id="setup-bot-proxy"
                  placeholder="Enter — не задавать (http://host:port)"
                  value={form.botProxy}
                  onChange={(e) => set("botProxy", e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Нужен, если api.telegram.org недоступен напрямую. Проверка бота пойдёт через
                  прокси.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="setup-bot-chats">chat_id через запятую (сохранятся в .env)</Label>
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

      {/* 5. LLM: пресеты шлюзов, каталог моделей, вендор, api_mode (AC1-AC4, AC7) */}
      {needsLlm && (
        <Card>
          <CardHeader>
            <CardTitle>LLM: шлюз и модель</CardTitle>
            <CardDescription>
              {state.gateways.length > 0
                ? `Настроены шлюзы: ${state.gateways.map((g) => g.id).join(", ")}`
                : "Шлюзов пока нет — выберите вариант из списка"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Шлюз</Label>
              <Select value={form.gatewayPreset} onValueChange={choosePreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.gatewayPresets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                      {preset.base_url ? ` — ${preset.base_url}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isCustomGateway && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="setup-base-url">base_url</Label>
                  <Input
                    id="setup-base-url"
                    placeholder="https://api.cloud.ru/aig/v1"
                    value={form.baseUrl}
                    onChange={(e) => set("baseUrl", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setup-gateway-id">id шлюза</Label>
                  <Input
                    id="setup-gateway-id"
                    placeholder="выводится из домена"
                    value={form.gatewayId}
                    onChange={(e) => set("gatewayId", e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Пусто — сервер выведет id из домена (api.cloud.ru → cloud_ru).
                  </p>
                </div>
              </>
            )}

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
                autoComplete="off"
                placeholder={
                  keyAlreadySet ? "ключ уже задан — см. подтверждение ниже" : "оставьте пустым, чтобы не задавать"
                }
                value={form.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
              />
              {(keyAlreadySet || state.secrets.envKeys.length > 0) && (
                <label className="flex items-center gap-2 pt-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.secretsOverwrite}
                    onChange={(e) => set("secretsOverwrite", e.target.checked)}
                  />
                  <span>
                    Перезаписать существующие секреты (без этого уже заданные ключи
                    пропускаются)
                  </span>
                </label>
              )}
            </div>

            {/* Модель: каталог двухступенчато либо ручной ввод (AC3) */}
            {presetHasCatalog && !manualModel && (
              <>
                <div className="space-y-1">
                  <Label>Автор модели</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={catalogLoading}
                      onClick={() => void loadCatalog(form.gatewayPreset)}
                    >
                      {catalogLoading
                        ? "Загружаю…"
                        : catalogModels === null
                          ? "Загрузить каталог"
                          : "Обновить каталог"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setManualModel(true)}>
                      Ввести вручную
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Модель автора</Label>
                  <Select
                    value={form.modelAuthor}
                    onValueChange={(v) => {
                      setForm((prev) => (prev ? { ...prev, modelAuthor: v, vendor: "" } : prev))
                      setCatalogVendors(null)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="сначала загрузите каталог" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelAuthors.map((author) => (
                        <SelectItem key={author} value={author}>
                          {author}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={form.modelId}
                    onValueChange={(v) => void chooseModel(form.gatewayPreset, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="выберите модель" />
                    </SelectTrigger>
                    <SelectContent>
                      {authorModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id} — {priceHint(m.pricing)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {manualModel && (
              <div className="space-y-1">
                <Label htmlFor="setup-model">Модель (id)</Label>
                <Input
                  id="setup-model"
                  placeholder="напр. deepseek/deepseek-chat"
                  value={form.modelId}
                  onChange={(e) => set("modelId", e.target.value)}
                />
              </div>
            )}

            {/* Вендор: выбор с ценами либо «без вендора» (AC3) */}
            {!manualModel && (
              <div className="space-y-1 sm:col-span-2">
                <Label>Вендор (апстрим) модели</Label>
                <Select
                  value={form.vendor === "" ? "__none__" : form.vendor}
                  onValueChange={(v) => set("vendor", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="без вендора" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">без вендора (шлюз по умолчанию)</SelectItem>
                    {(catalogVendors ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} ({v.id}) — {priceHint(v.pricing)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {catalogError !== null && (
                  <p className="text-destructive text-xs">{catalogError}</p>
                )}
              </div>
            )}

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
                  <SelectItem value="responses">responses</SelectItem>
                  <SelectItem value="chat">chat</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
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