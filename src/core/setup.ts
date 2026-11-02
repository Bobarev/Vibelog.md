/**
 * Ядро wizard-а настройки проекта (VL-210).
 *
 * Один источник истины для консольного wizard-а (`vibelog init`) и web-страницы
 * `/setup`: детект режима (fresh/upgrade), чтение текущего состояния как
 * дефолтов, применение ответов. Фронты (readline и HTTP) только собирают
 * `SetupAnswers` — вся семантика записи живёт здесь, иначе консоль и веб
 * разъедутся в upgrade-поведении и в том, куда пишутся секреты.
 *
 * Границы записи (главный инвариант upgrade-режима): wizard НИКОГДА не
 * трогает backlog/tasks/, completed/, docs/, lessons/, references/,
 * decisions/, milestones/ — только backlog/config.yml (project_name и
 * task_prefix) и .vibelog/settings.json (недостающие ключи).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { defaultConfig, loadConfig } from './config.js';
import { stringifyYaml } from './yaml.js';
import { findBacklogDir } from './paths.js';
import { getGitUserName } from './git.js';
import { saveProjectSettings } from './project-settings.js';
import { loadSettings, readSettingsEnv, saveSettingsPatch } from './settings.js';
import { loadModels, loadProviders } from './models.js';
import type { ModelsConfig, ProviderConfig } from './models.js';
import { loadWorkflows } from './workflow.js';
import { readEnvFile, writeSecrets } from './setup-secrets.js';
import type { SecretsLocation } from './setup-secrets.js';
import { hasVibelogMcp, setupMcp } from './setup-mcp.js';
import type { McpTarget } from './setup-mcp.js';

/** Режим работы wizard-а. */
export type SetupMode = 'fresh' | 'upgrade';

/** Идентификаторы агентов, которые знает wizard. */
export type AgentId = 'vb' | 'qwen' | 'opencode' | 'claude';

/** Ответы wizard-а — то, что применяет applySetup. */
export interface SetupAnswers {
  mode: SetupMode;
  projectName: string;
  prefix: string;
  /** Отмеченные галочки; пустой список — проект без агента (валидно). */
  agents: AgentId[];
  /** Агент по умолчанию; имеет смысл только при agents.length > 1. */
  defaultAgent?: AgentId;
  secretsLocation: SecretsLocation;
  bot?: { token?: string; chats: number[] };
  provider?: { id: string; base_url: string; api_key_env?: string; apiKey?: string };
  model?: {
    id: string;
    label?: string;
    provider: string;
    model: string;
    api_mode?: 'chat' | 'responses';
  };
  /** Настраивать ли vibelog MCP (только если выбран qwen/opencode). */
  mcp: boolean;
  /** Перезаписать существующие настройки. */
  force: boolean;
}

/** Состояние проекта на момент запуска wizard-а (дефолты + upgrade-лог). */
export interface SetupState {
  mode: SetupMode;
  projectName: string;
  prefix: string;
  agents: { id: AgentId; available: boolean; enabled: boolean; reason?: string }[];
  defaultAgent?: string;
  secrets: { envFile: boolean; envKeys: string[]; settingsEnvKeys: string[] };
  bot: { configured: boolean; chats: number[] };
  providers: Record<string, ProviderConfig>;
  models: ModelsConfig;
  mcp: { qwen: boolean; opencode: boolean };
  /** Текст проблемы с backlog/config.yml (битый YAML) — wizard её покажет. */
  configError?: string;
}

/** Результат применения ответов. */
export interface SetupResult {
  written: string[];
  skipped: string[];
  warnings: string[];
}

/** Ошибка wizard-а с понятным пользователю текстом (без стектрейса). */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

/** Подпапки backlog/, которые создаёт fresh-init (порядок как в init.ts). */
const BACKLOG_SUBDIRS = [
  'tasks',
  'completed',
  'drafts',
  'docs',
  'decisions',
  'milestones',
  'lessons',
  'references',
];

/** Агенты, для которых wizard умеет настраивать MCP. */
const MCP_AGENTS: AgentId[] = ['qwen', 'opencode'];

/**
 * Определяет режим по наличию backlog/ (или явному флагу --mode).
 *
 * @param cwd — директория проекта
 */
export function detectSetupMode(cwd: string): SetupMode {
  return findBacklogDir(cwd) ? 'upgrade' : 'fresh';
}

/** Читает .qwen/settings.json или .opencode/settings.json (терпимо к битому JSON). */
function readAgentSettings(cwd: string, dir: string): Record<string, unknown> {
  const path = join(cwd, dir, 'settings.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Битый конфиг агента не должен ронять wizard
  }
  return {};
}

/** Признак «конфиг не похож на конфиг Vibelog»: нет ни project_name, ни task_prefix. */
function looksBrokenConfig(config: Record<string, unknown>): boolean {
  return typeof config.project_name !== 'string' && typeof config.task_prefix !== 'string';
}

/**
 * Собирает текущее состояние проекта: дефолты для вопросов и данные для
 * upgrade-лога.
 *
 * @param cwd — директория проекта
 * @param modeOverride — явный режим (--mode), иначе автоопределение
 */
export function readSetupState(cwd: string, modeOverride?: SetupMode): SetupState {
  const mode = modeOverride ?? detectSetupMode(cwd);

  // --- config.yml: имя/prefix + текст ошибки, если YAML битый ---
  let projectName = basename(cwd) || 'My Project';
  let prefix = 'VL';
  let configError: string | undefined;
  if (mode === 'upgrade') {
    try {
      const config = loadConfig(cwd);
      // parseYaml терпим к мусору (возвращает {} вместо исключения), поэтому
      // «битый конфиг» определяем по отсутствию обоих ключей Vibelog
      if (looksBrokenConfig(config)) {
        configError = 'backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи';
      } else {
        if (typeof config.project_name === 'string' && config.project_name !== '') {
          projectName = config.project_name;
        }
        if (typeof config.task_prefix === 'string' && config.task_prefix !== '') {
          prefix = config.task_prefix;
        }
      }
    } catch (err) {
      // Отличаем «нет конфига» от «конфиг битый»: первое — не ошибка wizard-а
      const message = (err as Error)?.message ?? String(err);
      if (!message.includes('Файл конфига не найден')) {
        configError = 'backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи';
      }
    }
  }

  // --- settings.json: провайдеры, модели, секреты, бот, MCP ---
  const settings = loadSettings(cwd);
  const providers = loadProviders(cwd);
  const models = loadModels(cwd);
  const settingsEnv = readSettingsEnv(cwd);
  const envFile = readEnvFile(cwd);

  const chatsRaw = settings.chats;
  const chats = Array.isArray(chatsRaw)
    ? chatsRaw.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    : [];
  const botConfigured =
    settingsEnv.TELEGRAM_BOT_TOKEN !== undefined || envFile.TELEGRAM_BOT_TOKEN !== undefined;

  const defaultAgentRaw = settings.default_agent;
  const defaultAgent = typeof defaultAgentRaw === 'string' && defaultAgentRaw !== ''
    ? defaultAgentRaw
    : undefined;

  // --- агенты: vb всегда доступен; внешние — только при наличии папки ---
  const agents: SetupState['agents'] = [
    { id: 'vb', available: true, enabled: false },
  ];
  if (existsSync(join(cwd, '.qwen'))) {
    agents.push({ id: 'qwen', available: true, enabled: true });
  }
  if (existsSync(join(cwd, '.opencode'))) {
    // Adapter OpenCode ещё не реализован (ROADMAP «future gate») — пункт
    // виден, но не отмечается: иначе wizard запишет нерабочего агента
    agents.push({ id: 'opencode', available: true, enabled: false, reason: 'Скоро' });
  }
  if (existsSync(join(cwd, '.claude'))) {
    agents.push({ id: 'claude', available: true, enabled: false, reason: 'Скоро' });
  }

  return {
    mode,
    projectName,
    prefix,
    agents,
    defaultAgent,
    secrets: {
      envFile: existsSync(join(cwd, '.env')),
      envKeys: Object.keys(envFile),
      settingsEnvKeys: Object.keys(settingsEnv),
    },
    bot: { configured: botConfigured, chats },
    providers,
    models,
    mcp: {
      qwen: hasVibelogMcp(cwd, 'qwen'),
      opencode: hasVibelogMcp(cwd, 'opencode'),
    },
    configError,
  };
}

/** Минимальный AGENTS.md для fresh-init (не перезаписывает существующий). */
function agentsMdTemplate(projectName: string): string {
  return `# AGENTS.md — ${projectName}

Проект использует Vibelog.md — markdown-нативный таск-менеджер, совместимый
с Backlog.md. Задачи живут в \`backlog/tasks/\` (markdown + YAML-frontmatter).

## Основные команды

\`\`\`bash
vibelog task create "Заголовок" -d "Описание" --ac "Критерий"
vibelog task list --ready
vibelog board
vibelog browser
\`\`\`

## Правила работы

- Задачи и документы правь через CLI/MCP Vibelog, а не вручную.
- Перед завершением задачи отметь AC и DoD: \`vibelog task edit <id> --check-ac 1\`.
- Подробные инструкции для агента: \`vibelog instructions\`.
`;
}

/** Валидация prefix: буква, затем буквы/цифры/_/-, до 10 символов. */
export function validatePrefix(value: string): string | null {
  if (!value) return 'Prefix не может быть пустым';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,9}$/.test(value)) {
    return 'Prefix: латинская буква, затем буквы/цифры/_/-, не длиннее 10 символов';
  }
  return null;
}

/** Валидация имени проекта: непустое, без переводов строк. */
export function validateProjectName(value: string): string | null {
  if (!value || value.trim() === '') return 'Имя проекта не может быть пустым';
  if (/[\r\n]/.test(value)) return 'Имя проекта не должно содержать переводов строк';
  return null;
}

/**
 * Применяет ответы wizard-а к проекту.
 *
 * @param cwd — директория проекта
 * @param answers — собранные ответы
 * @throws SetupError — при битом config.yml без force и при невалидных ответах
 */
export function applySetup(cwd: string, answers: SetupAnswers): SetupResult {
  const result: SetupResult = { written: [], skipped: [], warnings: [] };

  const nameError = validateProjectName(answers.projectName);
  if (nameError) throw new SetupError(nameError);
  const prefixError = validatePrefix(answers.prefix);
  if (prefixError) throw new SetupError(prefixError);

  const mode = answers.mode;
  const backlogDir = join(cwd, 'backlog');

  // --- 1. backlog/ и config.yml ---
  if (mode === 'fresh') {
    for (const dir of BACKLOG_SUBDIRS) {
      mkdirSync(join(backlogDir, dir), { recursive: true });
    }
    const config = defaultConfig(answers.projectName, answers.prefix);
    writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
    result.written.push('backlog/config.yml');
    for (const dir of BACKLOG_SUBDIRS) result.written.push(`backlog/${dir}/`);

    // AGENTS.md — только если файла нет: чужой файл не перезаписываем
    const agentsPath = join(cwd, 'AGENTS.md');
    if (!existsSync(agentsPath)) {
      writeFileSync(agentsPath, agentsMdTemplate(answers.projectName), 'utf-8');
      result.written.push('AGENTS.md');
    } else {
      result.skipped.push('AGENTS.md (уже существует)');
    }

    // Кэш git user.name (VL-44) — как в прежнем init
    saveProjectSettings(cwd, { git_user_name: getGitUserName(cwd) });
    result.written.push('.vibelog/settings.json (git_user_name)');
  } else {
    // upgrade: правим ТОЛЬКО project_name/task_prefix, остальное не трогаем
    let config: Record<string, unknown>;
    let broken = false;
    try {
      config = loadConfig(cwd);
      broken = looksBrokenConfig(config);
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (!answers.force) {
        throw new SetupError(
          'backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи',
        );
      }
      // --force: пересоздаём конфиг с дефолтами (явное согласие пользователя)
      config = defaultConfig(answers.projectName, answers.prefix);
      writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
      result.written.push('backlog/config.yml (перезаписан по --force)');
      result.warnings.push(`Исходный config.yml не читался: ${message}`);
    }
    if (broken) {
      if (!answers.force) {
        throw new SetupError(
          'backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи',
        );
      }
      config = defaultConfig(answers.projectName, answers.prefix);
      writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
      result.written.push('backlog/config.yml (перезаписан по --force)');
      result.warnings.push('Исходный config.yml не содержал project_name/task_prefix — перезаписан по --force');
    }
    if (config.project_name !== answers.projectName || config.task_prefix !== answers.prefix) {
      config.project_name = answers.projectName;
      config.task_prefix = answers.prefix;
      writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
      if (!result.written.some((p) => p.startsWith('backlog/config.yml'))) {
        result.written.push('backlog/config.yml (project_name/task_prefix)');
      }
    } else {
      result.skipped.push('backlog/config.yml (значения не изменились)');
    }

    // --force в upgrade-режиме обновляет кэш git user.name (VL-44): раньше
    // это делал только fresh-init, и `init --force` не перечитывал автора
    if (answers.force) {
      saveProjectSettings(cwd, { git_user_name: getGitUserName(cwd) });
      result.written.push('.vibelog/settings.json (git_user_name)');
    }
  }

  // --- 2. settings.json: default_agent, providers, models ---
  const settings = loadSettings(cwd);
  const patch: Record<string, unknown> = {};

  if (answers.agents.length === 0) {
    // Проект без агента — валидный сценарий: ключ не пишем (сбрасываем)
    if (settings.default_agent !== undefined) {
      patch.default_agent = undefined;
      result.written.push('.vibelog/settings.json (default_agent сброшен)');
    }
  } else {
    const chosen = answers.defaultAgent && answers.agents.includes(answers.defaultAgent)
      ? answers.defaultAgent
      : answers.agents[0];
    if (settings.default_agent !== chosen) {
      patch.default_agent = chosen;
      result.written.push(`.vibelog/settings.json (default_agent=${chosen})`);
    } else {
      result.skipped.push(`.vibelog/settings.json (default_agent=${chosen} уже задан)`);
    }
  }

  // providers: дополняем, существующий id не перезаписываем без force
  if (answers.provider) {
    const currentProviders = (settings.providers ?? {}) as Record<string, unknown>;
    const id = answers.provider.id;
    if (currentProviders[id] !== undefined && !answers.force) {
      result.skipped.push(`providers.${id} (уже настроен)`);
    } else {
      const entry: Record<string, unknown> = { base_url: answers.provider.base_url };
      if (answers.provider.api_key_env) entry.api_key_env = answers.provider.api_key_env;
      patch.providers = { ...currentProviders, [id]: entry };
      result.written.push(`.vibelog/settings.json (providers.${id})`);
    }
  }

  // models: дополняем available и выставляем default
  if (answers.model) {
    const currentModels = (settings.models ?? {}) as Record<string, unknown>;
    const currentAvailable = (currentModels.available ?? {}) as Record<string, unknown>;
    const id = answers.model.id;
    const nextAvailable = { ...currentAvailable };
    if (currentAvailable[id] !== undefined && !answers.force) {
      result.skipped.push(`models.available.${id} (уже настроена)`);
    } else {
      const entry: Record<string, unknown> = {
        provider: answers.model.provider,
        model: answers.model.model,
      };
      if (answers.model.label) entry.label = answers.model.label;
      if (answers.model.api_mode) entry.api_mode = answers.model.api_mode;
      nextAvailable[id] = entry;
      result.written.push(`.vibelog/settings.json (models.available.${id})`);
    }
    const nextDefault = currentModels.default === id ? currentModels.default : id;
    if (currentModels.default !== nextDefault) {
      result.written.push(`.vibelog/settings.json (models.default=${id})`);
    }
    patch.models = { ...currentModels, available: nextAvailable, default: nextDefault };
  }

  if (Object.keys(patch).length > 0) saveSettingsPatch(cwd, patch);

  // --- 3. секреты (только имена ключей в отчёте) ---
  const secrets: Record<string, string> = {};
  if (answers.bot?.token) secrets.TELEGRAM_BOT_TOKEN = answers.bot.token;
  if (answers.provider?.apiKey && answers.provider.api_key_env) {
    secrets[answers.provider.api_key_env] = answers.provider.apiKey;
  }
  if (Object.keys(secrets).length > 0) {
    const res = writeSecrets(cwd, secrets, answers.secretsLocation);
    for (const key of res.written) {
      result.written.push(`${answers.secretsLocation === 'settings' ? '.vibelog/settings.json env' : '.env'} (${key})`);
    }
    for (const key of res.skipped) result.skipped.push(`секрет ${key} (уже задан)`);
  }

  // --- 4. чаты бота (несекретные) ---
  if (answers.bot && answers.bot.chats.length > 0) {
    const currentChats = Array.isArray(settings.chats) ? settings.chats : [];
    const merged = Array.from(new Set([...currentChats, ...answers.bot.chats]));
    if (merged.length !== currentChats.length) {
      saveSettingsPatch(cwd, { chats: merged });
      result.written.push(`.vibelog/settings.json (chats: ${merged.length})`);
    }
  }

  // --- 5. MCP (только для выбранных внешних агентов) ---
  const mcpTargets = answers.agents.filter((a): a is McpTarget => MCP_AGENTS.includes(a));
  if (answers.mcp && mcpTargets.length > 0) {
    const mcp = setupMcp(cwd, mcpTargets, { force: answers.force });
    result.written.push(...mcp.written);
    result.skipped.push(...mcp.skipped);
    result.warnings.push(...mcp.warnings);
  } else if (mcpTargets.length > 0) {
    result.skipped.push('MCP (отключён)');
  }

  return result;
}

/** Человекочитаемое имя локации секретов. */
function secretsLabel(loc: SecretsLocation): string {
  if (loc === 'settings') return 'settings.json env';
  if (loc === 'both') return '.env + settings.json env';
  return '.env';
}

/**
 * Формирует строку лога wizard-а (формат из описания VL-210).
 *
 * @param answers — применённые ответы
 * @param state — состояние до применения (для upgrade-строки)
 * @param cwd — директория проекта (для чтения имён workflow)
 */
export function formatSetupLog(answers: SetupAnswers, state: SetupState, cwd: string): string {
  const agents = answers.agents.length === 0
    ? 'нет'
    : answers.agents
        .map((a) => (a === answers.defaultAgent ? `${a} (default)` : a))
        .join(', ');
  const provider = answers.provider ? answers.provider.id : '—';
  const model = answers.model ? answers.model.id : '—';
  const bot = answers.bot?.token ? 'да' : 'нет';
  const mcp = answers.mcp && answers.agents.some((a) => MCP_AGENTS.includes(a)) ? 'да' : 'нет';

  const lines = [
    `Режим: ${answers.mode}${answers.mode === 'upgrade' ? ' (backlog/ найден)' : ''}. ` +
      `Агенты: ${agents}. Провайдер: ${provider}, модель: ${model}. ` +
      `Секреты: ${secretsLabel(answers.secretsLocation)}. Бот: ${bot}. MCP: ${mcp}`,
  ];

  if (answers.mode === 'upgrade') {
    const providersCount = Object.keys(state.providers).length;
    const modelsCount = Object.keys(state.models.available).length;
    let workflowsLabel = '—';
    try {
      const wf = loadWorkflows(cwd);
      workflowsLabel = Object.keys(wf.workflows).join('+') || '—';
    } catch {
      workflowsLabel = '—';
    }
    lines.push(
      `Существующие настройки: providers=${providersCount > 0 ? 'да' : 'нет'}, ` +
        `models=${modelsCount}, workflows=${workflowsLabel}. Дополняю недостающее`,
    );
  }

  return lines.join('\n');
}
