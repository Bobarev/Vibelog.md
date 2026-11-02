/**
 * Консольный wizard настройки проекта (VL-210, шаг 2 плана).
 *
 * Два режима сбора ответов:
 * - `answersFromFlags` — non-interactive (--yes и/или явные флаги): ничего
 *   не спрашивает, берёт дефолты из состояния проекта;
 * - `runWizard` — интерактив на readline: текстовые вопросы с дефолтом
 *   (Enter — оставить), чекбоксы агентов — посимвольный raw-mode список
 *   (space — toggle, ↑/↓ — курсор, Enter — подтвердить). При отсутствии
 *   TTY (тесты, пайпы) чекбоксы деградируют в нумерованный ввод.
 *
 * Порядок вопросов — из описания задачи: имя/prefix → агенты → default_agent
 * → секреты → бот → LLM (только если vb) → MCP (только если qwen/opencode).
 * Проверки (ping LLM, which qwen, getMe) выполняет вызывающий код (init.ts),
 * чтобы wizard оставался чистым сборщиком ответов.
 */

import { createInterface } from 'node:readline';
import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import { printInfo, printError } from '../ui.js';
import { loadProviders, resolveModelById } from '../../core/models.js';
import type { SetupAnswers, SetupState, AgentId } from '../../core/setup.js';
import { validatePrefix, validateProjectName } from '../../core/setup.js';
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
 * @param cwd — директория проекта (чтение providers)
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
  let provider: SetupAnswers['provider'];
  let model: SetupAnswers['model'];
  if (agents.includes('vb')) {
    const providerId = getFlag(flags, 'provider', '');
    const baseUrl = getFlag(flags, 'base-url', '');
    const apiKeyEnv = getFlag(flags, 'api-key-env', '');
    const modelId = getFlag(flags, 'model', '');
    const apiModeRaw = getFlag(flags, 'api-mode', '');
    const apiMode = apiModeRaw === 'responses' ? 'responses' : apiModeRaw === 'chat' ? 'chat' : undefined;

    if (providerId) {
      const known = loadProviders(cwd)[providerId];
      provider = {
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
        provider: provider?.id ?? existing?.provider ?? '',
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
    provider,
    model,
    mcp: flags['no-mcp'] !== true,
    force: flags.force === true,
  };
}

/** Обёртка над readline: один вопрос с дефолтом (Enter — дефолт). */
function createPrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    async ask(question: string, def: string): Promise<string> {
      const suffix = def !== '' ? ` [${def}]` : '';
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${question}${suffix}: `, (a) => resolve(a.trim()));
      });
      return answer === '' ? def : answer;
    },
    async askYesNo(question: string, def: boolean): Promise<boolean> {
      const answer = await new Promise<string>((resolve) => {
        rl.question(`${question} (${def ? 'Y/n' : 'y/N'}): `, (a) => resolve(a.trim().toLowerCase()));
      });
      if (answer === '') return def;
      return answer === 'y' || answer === 'yes' || answer === 'д' || answer === 'да';
    },
    close(): void {
      rl.close();
    },
  };
}

/**
 * Чекбокс-список агентов.
 *
 * В TTY — raw-mode: space переключает, стрелки двигают курсор, Enter
 * подтверждает. Без TTY (тесты, пайпы) — нумерованный ввод: «1,2» через
 * запятую, пустая строка — ничего не отмечено.
 *
 * @param items — доступные агенты (disabled не переключаются)
 * @param initial — изначально отмеченные id
 * @param ask — функция текстового вопроса (fallback без TTY)
 */
async function chooseAgents(
  items: SetupState['agents'],
  initial: AgentId[],
  ask: (q: string, def: string) => Promise<string>,
): Promise<AgentId[]> {
  const selectable = items.filter((i) => !i.reason);
  const selected = new Set<AgentId>(initial.filter((id) => selectable.some((s) => s.id === id)));

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Fallback: нумерованный ввод
    printInfo('Агенты (номера через запятую, пусто — без агента):');
    items.forEach((item, idx) => {
      const mark = selected.has(item.id) ? 'x' : ' ';
      const note = item.reason ? ` — ${item.reason}` : '';
      console.log(`  ${idx + 1}) [${mark}] ${AGENT_LABELS[item.id]}${note}`);
    });
    const def = items
      .map((item, idx) => (selected.has(item.id) ? String(idx + 1) : ''))
      .filter(Boolean)
      .join(',');
    const raw = await ask('Номера', def);
    const out: AgentId[] = [];
    for (const part of raw.split(',')) {
      const idx = Number(part.trim()) - 1;
      const item = items[idx];
      if (item && !item.reason && !out.includes(item.id)) out.push(item.id);
    }
    return out;
  }

  // TTY: посимвольный raw-mode список
  let cursor = 0;
  const render = (): void => {
    process.stdout.write('\x1b[?25l'); // скрыть курсор
    items.forEach((item, idx) => {
      const pointer = idx === cursor ? '❯' : ' ';
      const mark = selected.has(item.id) ? 'x' : ' ';
      const note = item.reason ? ` — ${item.reason}` : '';
      process.stdout.write(`\r\x1b[2K${pointer} [${mark}] ${AGENT_LABELS[item.id]}${note}\n`);
    });
    process.stdout.write('\x1b[?25h');
  };
  const clear = (): void => {
    // Перерисовка: поднимаемся на число строк списка и чистим
    for (let i = 0; i < items.length; i++) {
      process.stdout.write('\x1b[1A\r\x1b[2K');
    }
  };

  printInfo('Агенты (space — отметить, ↑/↓ — выбор, Enter — подтвердить):');
  render();

  return new Promise<AgentId[]>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk: string): void => {
      // Стрелки приходят как ESC-последовательности
      if (chunk === '\u001b[A') {
        cursor = (cursor - 1 + items.length) % items.length;
        clear();
        render();
        return;
      }
      if (chunk === '\u001b[B') {
        cursor = (cursor + 1) % items.length;
        clear();
        render();
        return;
      }
      if (chunk === ' ') {
        const item = items[cursor];
        if (item && !item.reason) {
          if (selected.has(item.id)) selected.delete(item.id);
          else selected.add(item.id);
        }
        clear();
        render();
        return;
      }
      if (chunk === '\r' || chunk === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        resolve(items.filter((i) => selected.has(i.id)).map((i) => i.id));
        return;
      }
      // Ctrl+C — выходим без изменений (ответы не применяются)
      if (chunk === '\u0003') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve([]);
      }
    };
    stdin.on('data', onData);
  });
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
  const p = createPrompter();
  try {
    // --- 1. Имя проекта и prefix ---
    let projectName = state.projectName;
    for (;;) {
      const raw = await p.ask('Имя проекта', projectName);
      const err = validateProjectName(raw);
      if (!err) {
        projectName = raw;
        break;
      }
      printError(err);
    }
    let prefix = state.prefix;
    for (;;) {
      const raw = await p.ask('Prefix задач', prefix);
      const err = validatePrefix(raw);
      if (!err) {
        prefix = raw;
        break;
      }
      printError(err);
    }

    // --- 2. Агенты ---
    const initialAgents = state.agents.filter((a) => a.enabled).map((a) => a.id);
    const agents = await chooseAgents(state.agents, initialAgents, p.ask);

    let defaultAgent: AgentId | undefined;
    if (agents.length === 1) {
      defaultAgent = agents[0];
    } else if (agents.length > 1) {
      const def = state.defaultAgent && (agents as string[]).includes(state.defaultAgent)
        ? state.defaultAgent
        : agents[0];
      const raw = await p.ask(`Агент по умолчанию (${agents.join('/')})`, def);
      defaultAgent = (agents as string[]).includes(raw) ? (raw as AgentId) : (def as AgentId);
    }

    // --- 3. Где хранить ключи ---
    let secretsLocation: SecretsLocation = 'env';
    if (state.secrets.envKeys.length > 0) {
      const keep = await p.askYesNo(
        `Секреты: .env (${state.secrets.envKeys.length} ключей). Оставить?`,
        true,
      );
      if (!keep) {
        const raw = await p.ask('Где хранить ключи (env|settings|both)', 'env');
        secretsLocation = parseSecretsLocation(raw) ?? 'env';
      }
    } else {
      const raw = await p.ask('Где хранить API-ключи и токены (env|settings|both)', 'env');
      secretsLocation = parseSecretsLocation(raw) ?? 'env';
    }

    // --- 4. Telegram-бот ---
    let bot: SetupAnswers['bot'];
    const botQuestion = state.bot.configured
      ? `Бот уже настроен (чаты: ${state.bot.chats.length}). Перенастроить?`
      : 'Настроить Telegram-бота?';
    const wantBot = await p.askYesNo(botQuestion, false);
    if (wantBot) {
      const token = await p.ask('Токен бота (TELEGRAM_BOT_TOKEN)', '');
      const chatsRaw = await p.ask('chat_id через запятую (опционально)', '');
      bot = { token: token || undefined, chats: parseChats(chatsRaw) };
    }

    // --- 5. LLM (только если vb) ---
    let provider: SetupAnswers['provider'];
    let model: SetupAnswers['model'];
    if (agents.includes('vb')) {
      const providers = loadProviders(cwd);
      const providerIds = Object.keys(providers);
      const defProvider = providerIds[0] ?? '';
      const providerId = await p.ask(
        `Провайдер LLM${providerIds.length > 0 ? ` (${providerIds.join('/')})` : ' (id)'}`,
        defProvider,
      );
      if (providerId) {
        const known = providers[providerId];
        const baseUrl = await p.ask('base_url провайдера', known?.base_url ?? '');
        const apiKeyEnv = await p.ask('Имя env-переменной с ключом', known?.api_key_env ?? '');
        provider = { id: providerId, base_url: baseUrl, api_key_env: apiKeyEnv || undefined };

        const modelIds = Object.keys(state.models.available);
        const defModel = state.models.default ?? modelIds[0] ?? '';
        const modelId = await p.ask(
          `Модель${modelIds.length > 0 ? ` (${modelIds.join('/')})` : ' (id)'}`,
          defModel,
        );
        if (modelId) {
          const existing = state.models.available[modelId];
          const apiModeRaw = await p.ask(
            'api_mode (chat|responses)',
            existing?.api_mode ?? 'chat',
          );
          model = {
            id: modelId,
            label: existing?.label,
            provider: provider.id,
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
      mcp = await p.askYesNo(
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
      provider,
      model,
      mcp,
      force: flags.force === true,
    };
  } finally {
    p.close();
  }
}

/** Проверяет, что модель из ответов резолвится (для валидации после записи). */
export function modelResolves(cwd: string, id: string): boolean {
  return resolveModelById(cwd, id) !== null;
}

/** Список агентов из флага --agents (экспорт для тестов). */
export { parseAgents, parseChats, parseSecretsLocation };
