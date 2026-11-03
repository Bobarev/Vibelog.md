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
 * → секреты → бот → LLM (только если vb) → MCP (только если qwen/opencode).
 * Проверки (ping LLM, which qwen, getMe) выполняет вызывающий код (init.ts),
 * чтобы wizard оставался чистым сборщиком ответов.
 */

import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import { createPromptSession } from '../prompt.js';
import type { PromptOption, PromptSession } from '../prompt.js';
import { loadGateways, resolveModelById } from '../../core/models.js';
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
  if (raw === 'env' || raw === 'settings' || raw === 'both') return raw;
  return null;
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
    agents = state.agents.filter((a) => a.enabled).map((a) => a.id);
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
  const botEnabled = flags.bot === true || botToken !== '';
  const bot = botEnabled ? { token: botToken || undefined, chats: botChats } : undefined;

  // LLM: только если выбран vb
  let gateway: SetupAnswers['gateway'];
  let model: SetupAnswers['model'];
  if (agents.includes('vb')) {
    // VL-315: флаг --provider оставлен как алиас --gateway (совместимость CLI)
    const providerId = getFlag(flags, 'gateway', '') || getFlag(flags, 'provider', '');
    const baseUrl = getFlag(flags, 'base-url', '');
    const apiKeyEnv = getFlag(flags, 'api-key-env', '');
    const modelId = getFlag(flags, 'model', '');
    const apiModeRaw = getFlag(flags, 'api-mode', '');
    const apiMode = apiModeRaw === 'responses' ? 'responses' : apiModeRaw === 'chat' ? 'chat' : undefined;

    if (providerId) {
      const known = loadGateways(cwd)[providerId];
      gateway = {
        id: providerId,
        base_url: baseUrl || known?.base_url || '',
        api_key_env: apiKeyEnv || known?.api_key_env,
      };
    }
    if (modelId) {
      const existing = state.models.available[modelId];
      model = {
        id: modelId,
        label: existing?.label,
        gateway: gateway?.id ?? existing?.gateway ?? '',
        ...(existing?.vendor ? { vendor: existing.vendor } : {}),
        model: existing?.model ?? modelId,
        api_mode: apiMode ?? existing?.api_mode ?? 'chat',
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
 * `enabled` в состоянии означает «отмечен по умолчанию»: vb там false, поэтому
 * по умолчанию он НЕ отмечен (AC4). Пункты с `reason` («Скоро») видны, но
 * disabled — навигация их пропускает.
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
    const secretsOptions: PromptOption<SecretsLocation>[] = [
      { value: 'env', label: '.env (файл в корне проекта)', hint: 'по умолчанию' },
      { value: 'settings', label: '.vibelog/settings.json (секция env)' },
      { value: 'both', label: 'оба места' },
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
          0,
        );
      }
    } else {
      secretsLocation = await session.askSelect(
        'Где хранить API-ключи и токены:',
        secretsOptions,
        0,
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
      const chatsRaw = await session.askText('chat_id через запятую (опционально)', '');
      bot = { token: token || undefined, chats: parseChats(chatsRaw) };
    }

    // --- 5. LLM (только если vb) ---
    let gateway: SetupAnswers['gateway'];
    let model: SetupAnswers['model'];
    if (agents.includes('vb')) {
      const gateways = loadGateways(cwd);
      const providerIds = Object.keys(gateways);
      const defProvider = providerIds[0] ?? '';
      const providerId = await session.askText(
        `Шлюз LLM${providerIds.length > 0 ? ` (${providerIds.join('/')})` : ' (id)'}`,
        defProvider,
      );
      if (providerId) {
        const known = gateways[providerId];
        const baseUrl = await session.askText('base_url провайдера', known?.base_url ?? '');
        const apiKeyEnv = await session.askText(
          'Имя env-переменной с ключом',
          known?.api_key_env ?? '',
        );
        gateway = { id: providerId, base_url: baseUrl, api_key_env: apiKeyEnv || undefined };

        const modelIds = Object.keys(state.models.available);
        const defModel = state.models.default ?? modelIds[0] ?? '';
        const modelId = await session.askText(
          `Модель${modelIds.length > 0 ? ` (${modelIds.join('/')})` : ' (id)'}`,
          defModel,
        );
        if (modelId) {
          const existing = state.models.available[modelId];
          const apiModeRaw = await session.askText(
            'api_mode (chat|responses)',
            existing?.api_mode ?? 'chat',
          );
          model = {
            id: modelId,
            label: existing?.label,
            gateway: gateway.id,
            model: existing?.model ?? modelId,
            api_mode: apiModeRaw === 'responses' ? 'responses' : 'chat',
          };
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
export { parseAgents, parseChats, parseSecretsLocation };
