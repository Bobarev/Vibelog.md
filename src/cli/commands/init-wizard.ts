/**
 * Консольный wizard настройки проекта (VL-210, переписан в VL-320).
 *
 * Два режима сбора ответов:
 * - `answersFromFlags` — non-interactive (--yes и/или явные флаги): ничего
 *   не спрашивает, берёт дефолты из состояния проекта;
 * - `runWizard` — интерактив через `createPromptSession` (src/cli/prompt.ts):
 *   текстовые вопросы с дефолтом (Enter — оставить), списки выбора и
 *   мультивыбор агентов (space — галочка, ↑/↓ — курсор, Enter — подтвердить).
 *   Без TTY промпты возвращают дефолты — wizard не падает (AC7).
 *
 * Порядок вопросов — из описания задачи: имя/prefix → агенты → default_agent
 * → секреты → бот (+ прокси) → LLM (только если vb; выбор шлюза из
 * хардкод-списка, каталог моделей RouterAI, ввод ключа с маскировкой) → MCP
 * (только если qwen/opencode).
 * Проверки (ping LLM, which qwen, getMe) выполняет вызывающий код (init.ts),
 * чтобы wizard оставался чистым сборщиком ответов.
 */

import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import { createPromptSession } from '../prompt.js';
import type { PromptOption, PromptSession } from '../prompt.js';
import { loadGateways, resolveModelById } from '../../core/models.js';
import { CATALOG_SEARCH_LIMIT, getCatalogAdapter } from '../../core/provider-catalog.js';
import { readEnvFile } from '../../core/setup-secrets.js';
import { readSettingsEnv } from '../../core/settings.js';
import type { SetupAnswers, SetupState, AgentId } from '../../core/setup.js';
import { derivePrefix, validatePrefix, validateProjectName } from '../../core/setup.js';
import type { SecretsLocation } from '../../core/setup-secrets.js';

/** Все известные агенту идентификаторы (для валидации --agents). */
const ALL_AGENTS: AgentId[] = ['vb', 'qwen', 'opencode', 'claude'];

/** Человекочитаемые подписи агентов для чекбоксов. */
const AGENT_LABELS: Record<AgentId, string> = {
  vb: 'vb (встроенный Vibelog-агент, нужен LLM)',
  qwen: 'qwen (внешний Qwen Code)',
  opencode: 'opencode (внешний OpenCode)',
  claude: 'claude (внешний Claude Code)',
};

/** Разбирает список агентов из строки флага (через запятую). */
function parseAgents(raw: string): AgentId[] {
  if (raw.trim() === '') return [];
  const out: AgentId[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim().toLowerCase();
    if (id === '') continue;
    if ((ALL_AGENTS as string[]).includes(id) && !out.includes(id as AgentId)) {
      out.push(id as AgentId);
    }
  }
  return out;
}

/** Разбирает список chat_id из строки флага (через запятую). */
function parseChats(raw: string): number[] {
  if (raw.trim() === '') return [];
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n !== 0) out.push(n);
  }
  return out;
}

/** Валидирует локацию секретов из флага. */
function parseSecretsLocation(raw: string): SecretsLocation | null {
  if (raw === 'system' || raw === 'env' || raw === 'settings' || raw === 'both') return raw;
  return null;
}

/** Описание хардкод-шлюза LLM (VL-324). */
interface GatewayPreset {
  /** id в settings.gateways. */
  id: string;
  label: string;
  /** base_url из пресета; у openai-совместимого пустой — спрашиваем. */
  base_url?: string;
  /** Дефолтное имя env-переменной с ключом. */
  api_key_env: string;
  /** true — модель/вендор вводит пользователь (Selectel, openai-совместимый). */
  manualModel?: boolean;
  /** true — можно загрузить каталог моделей RouterAI. */
  catalog?: boolean;
}

/**
 * Хардкод-список шлюзов LLM (AC4).
 *
 * Почему хардкод, а не ввод id текстом: пользователь (см. описание VL-324)
 * не знает id/base_url шлюза наизусть — три реально используемых варианта
 * покрывают практику, а кастомный base_url остаётся третьим пунктом.
 */
const LLM_GATEWAYS: GatewayPreset[] = [
  {
    id: 'routerai',
    label: 'RouterAI (агрегатор моделей)',
    base_url: 'https://routerai.ru/api/v1',
    api_key_env: 'ROUTERAI_API_KEY',
    catalog: true,
  },
  {
    id: 'selectel_router',
    label: 'Selectel ИИ-роутер',
    base_url: 'https://api.selectel.ru/aig/v1',
    api_key_env: 'SELECTEL_ROUTER_API_KEY',
    manualModel: true,
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-совместимый (свой base_url)',
    api_key_env: '',
    manualModel: true,
  },
];

/**
 * Выводит id шлюза из домена base_url (AC4): `https://api.cloud.ru/aig/v1`
 * → `cloud_ru`.
 *
 * Берём первое имя домена без служебных меток (`api`, `www`, `aig` — это
 * поддомены-функции, а не бренд), склеиваем через `_` и чистим до
 * [a-z0-9_]. Так `api.cloud.ru` и `cloud.ru` дают один id.
 */
export function gatewayIdFromUrl(baseUrl: string): string {
  let host = '';
  try {
    host = new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    // Не URL — попробуем вытащить домен регуляркой, чтобы не падать
    const m = /^(?:https?:\/\/)?([^/?#]+)/i.exec(baseUrl.trim());
    host = m ? m[1].toLowerCase() : '';
  }
  const SERVICE_LABELS = new Set(['api', 'www', 'aig', 'v1', 'llm', 'gateway', 'openai']);
  const parts = host
    .split('.')
    .filter((p) => p !== '')
    .filter((p) => !SERVICE_LABELS.has(p));
  // Последний элемент — доменная зона (ru/com/ai); «ru» сам по себе не
  // осмысленный id, но если ничего не осталось — используем, что есть
  const usable = parts.length > 0 ? parts : host.split('.').filter((p) => p !== '');
  const id = usable
    .join('_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return id || 'custom';
}

/** Дефолтное имя env-переменной с ключом для произвольного шлюза (AC7). */
export function defaultApiKeyEnv(gatewayId: string): string {
  const upper = gatewayId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `${upper || 'LLM'}_API_KEY`;
}

/** Имя модели без `@`-хвоста (VL-315: в `model` его быть не должно). */
function stripModelSuffix(model: string): string {
  const at = model.indexOf('@');
  return (at === -1 ? model : model.slice(0, at)).trim();
}

/** Форматирует цену за 1M токенов для подписи пункта (пусто — «цена н/д»). */
function formatPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  return `${Number(value.toFixed(4))} ₽/1M`;
}

/**
 * Собирает ответы из флагов (non-interactive путь: --yes и явные флаги).
 *
 * Дефолты при --yes (описание VL-210): агенты — автоопределение по папкам
 * (.qwen/.opencode), vb не добавляется автоматически; бот выключен; секреты
 * в .env; MCP включён, если выбран qwen/opencode.
 *
 * @param flags — флаги CLI
 * @param state — текущее состояние проекта (дефолты)
 * @param cwd — директория проекта (чтение gateways)
 */
export function answersFromFlags(flags: FlagValues, state: SetupState, cwd: string): SetupAnswers {
  const modeFlag = getFlag(flags, 'mode', '');
  const mode = modeFlag === 'fresh' || modeFlag === 'upgrade' ? modeFlag : state.mode;

  const projectName = getFlag(flags, 'project-name', '') || state.projectName;
  const prefix = getFlag(flags, 'prefix', '') || state.prefix;

  // --agents задан явно (даже пустой строкой) — берём как есть;
  // иначе автоопределение по папкам (vb не добавляется). Обратная
  // совместимость: `vibelog init` без --yes и без папок агентов ведёт себя
  // как прежний init — настраивает qwen (он же дефолт resolveDefaultAgent),
  // иначе старые проекты потеряли бы MCP-секцию .qwen/settings.json (VL-6).
  const agentsRaw = flags.agents;
  let agents: AgentId[];
  if (agentsRaw !== undefined) {
    agents = parseAgents(getFlag(flags, 'agents', ''));
  } else {
    // VL-324: vb отмечен по умолчанию только в ИНТЕРАКТИВНОМ чекбоксе (AC1).
    // В non-interactive пути (--yes) его не добавляем: там нельзя спросить
    // LLM-настройки, и проект остался бы с vb без модели — поведение --yes
    // сохраняем как было («агенты по папкам», VL-210).
    agents = state.agents.filter((a) => a.enabled && a.id !== 'vb').map((a) => a.id);
    if (agents.length === 0 && flags.yes !== true) agents = ['qwen'];
  }

  const defaultAgentFlag = getFlag(flags, 'default-agent', '');
  let defaultAgent: AgentId | undefined;
  if (agents.length > 1) {
    if (defaultAgentFlag && (agents as string[]).includes(defaultAgentFlag)) {
      defaultAgent = defaultAgentFlag as AgentId;
    } else if (state.defaultAgent && (agents as string[]).includes(state.defaultAgent)) {
      defaultAgent = state.defaultAgent as AgentId;
    } else {
      defaultAgent = agents[0];
    }
  } else if (agents.length === 1) {
    defaultAgent = agents[0];
  }

  const secretsLocation = parseSecretsLocation(getFlag(flags, 'secrets-location', '')) ?? 'env';

  // Бот: --bot-token сам по себе включает настройку бота
  const botToken = getFlag(flags, 'bot-token', '');
  const botChats = parseChats(getFlag(flags, 'bot-chats', ''));
  const botProxy = getFlag(flags, 'bot-proxy', '');
  const botEnabled = flags.bot === true || botToken !== '' || botProxy !== '';
  const bot = botEnabled
    ? {
        token: botToken || undefined,
        chats: botChats,
        ...(botProxy !== '' ? { proxy: botProxy } : {}),
      }
    : undefined;

  // LLM: только если выбран vb
  let gateway: SetupAnswers['gateway'];
  let model: SetupAnswers['model'];
  if (agents.includes('vb')) {
    // VL-315: флаг --provider оставлен как алиас --gateway (совместимость CLI)
    const providerId = getFlag(flags, 'gateway', '') || getFlag(flags, 'provider', '');
    const baseUrl = getFlag(flags, 'base-url', '');
    const apiKeyEnv = getFlag(flags, 'api-key-env', '');
    const apiKeyFlag = getFlag(flags, 'api-key', '');
    const modelId = getFlag(flags, 'model', '');
    const vendorFlag = getFlag(flags, 'vendor', '');
    // VL-324: дефолт api_mode — responses (рантайм-фолбэк в models.ts/llm.ts
    // НЕ меняем: legacy-проекты и тесты рассчитывают на 'chat', lesson-78)
    const apiModeRaw = getFlag(flags, 'api-mode', '');
    const apiMode = apiModeRaw === 'chat' ? 'chat' : apiModeRaw === 'responses' ? 'responses' : 'responses';

    if (providerId) {
      const known = loadGateways(cwd)[providerId];
      gateway = {
        id: providerId,
        base_url: baseUrl || known?.base_url || '',
        // AC7: имя переменной выводится из шлюза, если флаг не задан
        api_key_env: apiKeyEnv || known?.api_key_env || defaultApiKeyEnv(providerId),
        ...(apiKeyFlag !== '' ? { apiKey: apiKeyFlag } : {}),
      };
    }
    if (modelId) {
      // VL-315/AC9: id модели — её wire-имя без `@`-хвоста (в старом формате
      // Backlog.md хвост обозначал вендора; теперь он живёт в поле vendor).
      // Нормализуем и id, и model, иначе available получил бы ключ с хвостом,
      // а resolveModelById искал бы его уже без хвоста.
      const cleanId = stripModelSuffix(modelId);
      const existing = state.models.available[cleanId] ?? state.models.available[modelId];
      const gatewayId = gateway?.id ?? existing?.gateway ?? '';
      model = {
        id: cleanId,
        label: existing?.label,
        gateway: gatewayId,
        // vendor из флага приоритетнее существующего (AC5)
        ...(vendorFlag !== ''
          ? { vendor: vendorFlag }
          : existing?.vendor
            ? { vendor: existing.vendor }
            : {}),
        model: stripModelSuffix(existing?.model ?? modelId),
        api_mode: apiMode,
      };
    }
  }

  return {
    mode,
    projectName,
    prefix,
    agents,
    defaultAgent,
    secretsLocation,
    secretsOverwrite: flags['secrets-overwrite'] === true,
    bot,
    gateway,
    model,
    mcp: flags['no-mcp'] !== true,
    force: flags.force === true,
  };
}

/**
 * Чекбокс-список агентов (VL-320).
 *
 * Пункты берутся из состояния проекта: vb всегда доступен, внешние агенты
 * появляются только при наличии их папки (setup.ts) — необнаруженные скрыты.
 * `enabled` в состоянии означает «отмечен по умолчанию»: vb там true, если в
 * проекте нет внешних агентов (VL-324, AC1) — тогда он отмечен в чекбоксе.
 * Пункты с `reason` («Скоро») видны, но disabled — навигация их пропускает.
 *
 * @param session — сессия промптов
 * @param items — доступные агенты из состояния проекта
 * @param initial — изначально отмеченные id
 */
async function chooseAgents(
  session: PromptSession,
  items: SetupState['agents'],
  initial: AgentId[],
): Promise<AgentId[]> {
  const options: PromptOption<AgentId>[] = items.map((item) => ({
    value: item.id,
    label: AGENT_LABELS[item.id],
    ...(item.reason ? { hint: item.reason, disabled: true } : {}),
  }));
  return session.askMultiselect(
    'Агенты (space — отметить, ↑/↓ — выбор, Enter — подтвердить):',
    options,
    initial,
  );
}

/**
 * Выбор модели и вендора из каталога шлюза (AC5).
 *
 * Возвращает `null`, если каталог недоступен (сеть/ошибка парсинга) — wizard
 * в этом случае переходит в ручной ввод с сообщением, а не падает.
 *
 * Цены показываются в подписи пункта: рубли за 1M токенов (нормализация
 * `normalizePricing` уже применена каталогом), поэтому пользователь видит
 * стоимость выбора, а не только имя модели.
 *
 * @returns выбранные модель/вендор либо null (каталог недоступен)
 */
async function pickFromCatalog(
  session: PromptSession,
  gateway: { id: string; base_url: string },
): Promise<{ model: string; vendor?: string } | null> {
  let models;
  // Работаем напрямую с адаптером, а не через listCatalogModels: на fresh-проекте
  // шлюза ещё нет в settings.json, и обёртка ответила бы «Неизвестный шлюз».
  // Кэш каталога wizard-у не нужен — он делает один запрос за прогон.
  try {
    const adapter = getCatalogAdapter(gateway.id, { base_url: gateway.base_url });
    models = await adapter.listModels();
  } catch (err) {
    console.error(
      `Каталог моделей недоступен (${(err as Error)?.message ?? String(err)}). Введите модель вручную.`,
    );
    return null;
  }
  if (models.length === 0) {
    console.error('Каталог моделей пуст. Введите модель вручную.');
    return null;
  }
  // Лимит пунктов: каталог RouterAI — сотни моделей, clack-список приемлемо
  // листает первые ~50 (тот же лимит, что у поиска каталога)
  const modelId = await session.askSelect<string>(
    'Модель из каталога:',
    models.slice(0, CATALOG_SEARCH_LIMIT).map((m) => ({
      value: m.id,
      label: m.id,
      hint: `${formatPrice(m.pricing.input_per_1m)} / ${formatPrice(m.pricing.output_per_1m)}`,
    })),
    0,
  );

  let vendors;
  try {
    vendors = await getCatalogAdapter(gateway.id, { base_url: gateway.base_url }).listVendors(modelId);
  } catch (err) {
    // Модель выбрана, вендор не нужен для работы (поле необязательно) —
    // предупреждаем и продолжаем без вендора
    console.error(
      `Вендоры модели недоступны (${(err as Error)?.message ?? String(err)}). Модель будет без вендора.`,
    );
    return { model: modelId };
  }
  if (vendors.length === 0) return { model: modelId };

  const vendorId = await session.askSelect<string>(
    'Вендор (апстрим) модели:',
    [
      // «Без вендора» — штатный вариант: поле vendor необязательно (VL-315)
      { value: '', label: 'без вендора', hint: 'выбор шлюза по умолчанию' },
      ...vendors.map((v) => ({
        value: v.id,
        label: `${v.name} (${v.id})`,
        hint: `${formatPrice(v.pricing.input_per_1m)} / ${formatPrice(v.pricing.output_per_1m)}`,
      })),
    ],
    0,
  );
  return { model: modelId, ...(vendorId !== '' ? { vendor: vendorId } : {}) };
}

/**
 * Интерактивный wizard: собирает ответы по шагам описания VL-210.
 *
 * @param cwd — директория проекта
 * @param flags — флаги CLI (могут предзаполнять ответы)
 * @param state — текущее состояние проекта
 */
export async function runWizard(
  cwd: string,
  flags: FlagValues,
  state: SetupState,
): Promise<SetupAnswers> {
  const session = createPromptSession();
  try {
    // --- 1. Имя проекта и prefix ---
    const projectName = await session.askText(
      'Имя проекта',
      state.projectName,
      validateProjectName,
    );
    // VL-320: prefix выводим из имени проекта (Vibelog Templates → VT),
    // fallback — текущее значение (для fresh это 'VL' из readState).
    const defPrefix = derivePrefix(projectName) ?? state.prefix;
    const prefix = await session.askText('Prefix задач', defPrefix, validatePrefix);

    // --- 2. Агенты ---
    const initialAgents = state.agents.filter((a) => a.enabled).map((a) => a.id);
    const agents = await chooseAgents(session, state.agents, initialAgents);

    let defaultAgent: AgentId | undefined;
    if (agents.length === 1) {
      defaultAgent = agents[0];
    } else if (agents.length > 1) {
      const def = state.defaultAgent && (agents as string[]).includes(state.defaultAgent)
        ? state.defaultAgent
        : agents[0];
      defaultAgent = await session.askSelect<AgentId>(
        'Агент по умолчанию:',
        agents.map((id) => ({ value: id, label: AGENT_LABELS[id] })),
        Math.max(0, agents.indexOf(def as AgentId)),
      );
    }

    // --- 3. Где хранить ключи ---
    // VL-320: выбор из списка вместо текстового ввода с парсингом — шаг, на
    // котором падал прежний wizard, стал предсказуемым (стрелки + Enter).
    // VL-324: пункт «settings.json (секция env)» заменён на «env» — вариант
    // «ничего не писать, пользователь сам заводит переменные окружения»
    // (чтение и так идёт env → .env). Секция env в settings.json остаётся
    // читаемой ради старых проектов, но новым wizard-ом не предлагается.
    const secretsOptions: PromptOption<SecretsLocation>[] = [
      { value: 'system', label: 'env (Приоритет: env → .env)', hint: 'ничего не писать' },
      { value: 'env', label: '.env (файл в корне проекта)', hint: 'по умолчанию' },
      { value: 'settings', label: '.vibelog/settings.json (секция env)' },
      { value: 'both', label: 'оба места (.env + settings.json)' },
    ];
    let secretsLocation: SecretsLocation = 'env';
    if (state.secrets.envKeys.length > 0) {
      const keep = await session.askConfirm(
        `Секреты: .env (${state.secrets.envKeys.length} ключей). Оставить?`,
        true,
      );
      if (!keep) {
        secretsLocation = await session.askSelect(
          'Где хранить API-ключи и токены:',
          secretsOptions,
          1,
        );
      }
    } else {
      secretsLocation = await session.askSelect(
        'Где хранить API-ключи и токены:',
        secretsOptions,
        1,
      );
    }

    // --- 4. Telegram-бот ---
    let bot: SetupAnswers['bot'];
    const botQuestion = state.bot.configured
      ? `Бот уже настроен (чаты: ${state.bot.chats.length}). Перенастроить?`
      : 'Настроить Telegram-бота?';
    const wantBot = await session.askConfirm(botQuestion, false);
    if (wantBot) {
      const token = await session.askText('Токен бота (TELEGRAM_BOT_TOKEN)', '');
      // VL-324: прокси бота — отдельный этап сразу после токена. Пустое
      // значение не пишем вовсе: ключ TELEGRAM_PROXY в .env должен
      // отсутствовать, иначе grammY попытается идти через пустой URL.
      const proxy = await session.askText(
        'Прокси бота (TELEGRAM_PROXY, Enter — не задавать)',
        '',
      );
      const chatsRaw = await session.askText('chat_id через запятую (опционально)', '');
      bot = {
        token: token || undefined,
        chats: parseChats(chatsRaw),
        ...(proxy !== '' ? { proxy } : {}),
      };
    }

    // --- 5. LLM (только если vb) ---
    let gateway: SetupAnswers['gateway'];
    let model: SetupAnswers['model'];
    let secretsOverwrite = false;
    if (agents.includes('vb')) {
      const existingGateways = loadGateways(cwd);
      const preset = await session.askSelect<GatewayPreset>(
        'Шлюз LLM:',
        LLM_GATEWAYS.map((g) => ({
          value: g,
          label: g.label,
          ...(g.base_url ? { hint: g.base_url } : {}),
        })),
        0,
      );

      // base_url и id шлюза: у пресетов заданы, у openai-совместимого —
      // вводит пользователь, id выводим из домена (AC4)
      let baseUrl = preset.base_url ?? '';
      let gatewayId = preset.id;
      if (!preset.base_url) {
        baseUrl = await session.askText('base_url шлюза (напр. https://api.cloud.ru/aig/v1)', '');
        gatewayId = gatewayIdFromUrl(baseUrl);
        // Коллизия с существующим шлюзом: не перезаписываем без --force
        if (existingGateways[gatewayId] !== undefined && flags.force !== true) {
          const alt = await session.askText(
            `Шлюз «${gatewayId}» уже настроен. Другой id (Enter — оставить, без --force не перезапишется)`,
            gatewayId,
          );
          if (alt !== '') gatewayId = alt;
        }
      }

      const known = existingGateways[gatewayId];
      const apiKeyEnv = await session.askText(
        'Имя env-переменной с ключом',
        known?.api_key_env ?? (preset.api_key_env || defaultApiKeyEnv(gatewayId)),
      );
      gateway = {
        id: gatewayId,
        base_url: baseUrl || known?.base_url || '',
        api_key_env: apiKeyEnv || defaultApiKeyEnv(gatewayId),
      };

      // Модель: RouterAI умеет каталог, остальные — ручной ввод
      let modelId = '';
      let vendor: string | undefined;
      if (preset.catalog) {
        const source = await session.askSelect<'catalog' | 'manual' | 'default'>(
          'Откуда модель:',
          [
            { value: 'catalog', label: 'Загрузить из каталога', hint: 'модели и вендоры с ценами' },
            { value: 'manual', label: 'Ввести вручную' },
            { value: 'default', label: 'По умолчанию (без вендора)' },
          ],
          0,
        );
        if (source === 'catalog') {
          const picked = await pickFromCatalog(session, { id: gatewayId, base_url: baseUrl });
          if (picked) {
            modelId = picked.model;
            vendor = picked.vendor;
          } else {
            // Каталог недоступен — фолбэк в ручной ввод (AC5), wizard живёт
            modelId = await session.askText('Модель (id у шлюза)', '');
            const vendorRaw = await session.askText('Вендор (Enter — не задавать)', '');
            if (vendorRaw !== '') vendor = vendorRaw;
          }
        } else if (source === 'manual') {
          modelId = await session.askText('Модель (id у шлюза)', '');
          const vendorRaw = await session.askText('Вендор (Enter — не задавать)', '');
          if (vendorRaw !== '') vendor = vendorRaw;
        } else {
          modelId = await session.askText('Модель (id у шлюза)', '');
        }
      } else {
        modelId = await session.askText('Модель (id у шлюза)', '');
      }

      if (modelId) {
        const cleanModel = stripModelSuffix(modelId);
        const existing = state.models.available[cleanModel];
        // VL-324: дефолт api_mode — responses (AC6)
        const apiModeRaw = await session.askText(
          'api_mode (chat|responses)',
          existing?.api_mode ?? 'responses',
        );
        model = {
          id: cleanModel,
          label: existing?.label,
          gateway: gatewayId,
          ...(vendor !== undefined ? { vendor } : {}),
          model: stripModelSuffix(existing?.model ?? cleanModel),
          api_mode: apiModeRaw === 'chat' ? 'chat' : 'responses',
        };

        // --- 5b. Ввод ключа (AC8) ---
        // Только для файловых локаций: в system ключ заводит пользователь,
        // в settings.json секреты писать не принято (но wizard это умеет —
        // тогда ключ тоже спросим, чтобы не оставить шлюз без ключа).
        if (secretsLocation !== 'system') {
          const envName = gateway.api_key_env ?? defaultApiKeyEnv(gatewayId);
          const already = readEnvFile(cwd)[envName] ?? readSettingsEnv(cwd)[envName];
          if (already !== undefined && already !== '') {
            const overwrite = await session.askConfirm(
              `Ключ ${envName} уже задан. Перезаписать?`,
              false,
            );
            if (overwrite) {
              const value = await session.askPassword(`API-ключ ${envName} (Enter — пропустить)`, '');
              if (value !== '') {
                gateway.apiKey = value;
                secretsOverwrite = true;
              }
            }
          } else {
            const value = await session.askPassword(`API-ключ ${envName} (Enter — пропустить)`, '');
            if (value !== '') gateway.apiKey = value;
          }
        }
      }
    }

    // --- 6. MCP (только если qwen/opencode) ---
    const needsMcp = agents.some((a) => a === 'qwen' || a === 'opencode');
    let mcp = false;
    if (needsMcp) {
      const already = state.mcp.qwen || state.mcp.opencode;
      mcp = await session.askConfirm(
        already ? 'MCP уже настроен (trust: true). Оставить?' : 'Настроить vibelog MCP?',
        true,
      );
    }

    return {
      mode: state.mode,
      projectName,
      prefix,
      agents,
      defaultAgent,
      secretsLocation,
      secretsOverwrite,
      bot,
      gateway,
      model,
      mcp,
      force: flags.force === true,
    };
  } finally {
    session.close();
  }
}

/** Проверяет, что модель из ответов резолвится (для валидации после записи). */
export function modelResolves(cwd: string, id: string): boolean {
  return resolveModelById(cwd, id) !== null;
}

/** Список агентов из флага --agents (экспорт для тестов). */
export { parseAgents, parseChats, parseSecretsLocation, LLM_GATEWAYS };
