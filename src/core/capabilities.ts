/**
 * Сборка справочника возможностей Vibelog (VL-394).
 *
 * Задача модуля — отдать ПОЛНЫЙ и АКТУАЛЬНЫЙ справочник (workflow, фазы,
 * MCP-инструменты, CLI-команды, ключи конфигов, правила доступа) без
 * дублирования знаний в тексте шаблона: всё, что есть в структуре кода,
 * читается из неё (`DEFAULT_WORKFLOW`, `DEFAULT_COMPLETENESS`, `PHASES`,
 * `listTools()`, `defaultConfig()`, `CLI_COMMANDS`).
 *
 * Почему это важно: в новом проекте (`vb init`) знание о фазах есть только
 * как дефолт в коде — ни в `backlog/config.yml`, ни в `.vibelog/settings.json`
 * его нет. Агент, ищущий схему workflow в файлах, не находит ничего и тратит
 * десятки тысяч токенов. Справочник собран из тех же источников, что и
 * исполнение, поэтому «устареть» он не может по конструкции.
 *
 * Модуль — чистый node (fs через шаблоны фаз); в браузерный бандл не входит.
 */

import {
  DEFAULT_COMPLETENESS,
  DEFAULT_WORKFLOW,
  SERVICE_PHASES,
  loadCompleteness,
  loadWorkflows,
} from './workflow.js';
import type { CompletenessMap, Transition, Workflow } from './workflow.js';
import { defaultConfig } from './config.js';
import { PHASES, PROJECT_PROMPTS_DIR, loadPhaseTemplate } from '../web/phase-prompt.js';
import { listTools } from '../mcp/tools.js';
import { CLI_COMMANDS } from '../cli/command-registry.js';
import type { CliCommandEntry } from '../cli/command-registry.js';

/** Версия схемы JSON-вывода (растёт при несовместимом изменении формы). */
export const CAPABILITIES_SCHEMA_VERSION = 1;

/** Откуда взят действующий workflow. */
export type WorkflowSource = 'default-in-code' | 'settings';

/** Секция «workflow»: действующая схема статусов и переходов. */
export interface CapabilitiesWorkflow {
  /** Стартовый статус («взяли в работу»). */
  initial_status: string;
  /** Граф переходов: статус → фаза → статус после фазы. */
  transitions: Transition[];
  /** `default-in-code` — работает DEFAULT_WORKFLOW; `settings` — переопределён. */
  source: WorkflowSource;
  /** Пояснение источника (печатается в markdown как есть). */
  note: string;
}

/** Секция «phases»: имя фазы, назначение, файл шаблона. */
export interface CapabilitiesPhase {
  /** Имя фазы (`spec`, `code`, …). */
  name: string;
  /** Краткое назначение (из шаблона; fallback — таблица PHASE_PURPOSES). */
  purpose: string;
  /** Файл шаблона внутри `templates/phases/`. */
  template: string;
  /** true — шаблон можно переопределить в `.vibelog/prompts/phases/`. */
  overridable: boolean;
}

/** Секция «mcpTools»: имя инструмента и его описание из реестра. */
export interface CapabilitiesTool {
  name: string;
  description: string;
}

/** Ключ `backlog/config.yml` с дефолтным значением. */
export interface CapabilitiesConfigKey {
  key: string;
  /** Дефолт из `defaultConfig()` в компактном виде (`[…]` для массивов). */
  defaultValue: string;
}

/** Ключ `.vibelog/settings.json`, который реально читается кодом. */
export interface CapabilitiesSettingsKey {
  key: string;
  summary: string;
}

/** Правила доступа и контракт ответа write-инструментов. */
export interface CapabilitiesAccess {
  read: string;
  write: string;
  /** Контракт ответа write-инструмента. */
  ack: string;
  /** Причины отказа и их смысл. */
  reasons: { reason: string; meaning: string }[];
}

/** Полный машиночитаемый справочник (`--json`). */
export interface CapabilitiesData {
  schemaVersion: number;
  kind: 'capabilities';
  workflow: CapabilitiesWorkflow;
  taskWorkflows: Record<string, string>;
  completeness: CompletenessMap;
  phases: CapabilitiesPhase[];
  servicePhases: string[];
  mcpTools: CapabilitiesTool[];
  cliCommands: CliCommandEntry[];
  configSource: string;
  configKeys: CapabilitiesConfigKey[];
  settingsSource: string;
  settingsKeys: CapabilitiesSettingsKey[];
  templateOverrideDir: string;
  access: CapabilitiesAccess;
  nextSteps: string[];
}

/**
 * Короткие назначения фаз — fallback, когда шаблон не прочитан.
 *
 * Основной источник назначения — первая содержательная строка шаблона
 * (`templates/phases/*.md`, AC1/AC3 описания задачи). Таблица нужна, чтобы
 * справочник не терял смысл при отсутствии `templates/` (например, при
 * запуске из неполной установки) — иначе фаза показалась бы безымянной.
 */
const PHASE_PURPOSES: Record<string, string> = {
  spec: 'уточнение требований и критериев приёмки',
  plan: 'изучение кода и план реализации',
  code: 'реализация, тесты, отчёт',
  do: 'реализация без планирования (simple workflow)',
  close: 'закрытие: статус, коммиты, документация',
  comment: 'выполнение запроса из комментария',
  prompt: 'произвольный запрос пользователя',
  analyze: 'разбор сессии агента по session-ref',
  reject: 'отказ от задачи с учётом начатых изменений',
  investigate: 'расследование инцидента',
  materialize: 'создание задач из расследования',
};

/**
 * Ключи `.vibelog/settings.json`, которые РЕАЛЬНО читаются кодом.
 *
 * Список — единственная ручная часть справочника: имена ключей не собраны в
 * реестр, они разбросаны по `loadSettings(cwd).<key>` и `loadBotSettings`.
 * Значения здесь НЕ дублируются (только имя + строка назначения), поэтому
 * дрейф ограничен переименованием ключа. Секреты (`TELEGRAM_BOT_TOKEN`,
 * `GITVERSE_TOKEN`, `TELEGRAM_CHAT_IDS`) живут в `.env`, не в settings.json
 * (VL-329) — секция `env` больше не читается.
 */
const SETTINGS_KEYS: CapabilitiesSettingsKey[] = [
  { key: 'workflows', summary: 'именованные workflow (default + свои); отсутствует — DEFAULT_WORKFLOW; правится `vibelog workflow apply`' },
  { key: 'task_workflows', summary: 'тип задачи → имя workflow (bug → bugfix); неизвестный тип → default; правится `vibelog workflow apply`' },
  { key: 'completeness', summary: 'неполнота сущности: workflow → фаза → entity → поля; правится `vibelog workflow apply`' },
  { key: 'models', summary: 'реестр LLM-моделей и активная модель (default/available)' },
  { key: 'gateways', summary: 'шлюзы LLM: id, base_url, api_key_env (старое имя — providers)' },
  { key: 'api_mode', summary: 'chat | responses — режим LLM API по умолчанию' },
  { key: 'supervisor', summary: 'настройки супервизора: max_parallel_phases и т.п.' },
  { key: 'mcp', summary: 'настройки MCP (в т.ч. бюджет вывода инструментов)' },
  { key: 'mcpServers', summary: 'внешние MCP-серверы в формате Qwen Code' },
  { key: 'lessons', summary: 'пороги аудита уроков: дубли, протухание, лимит задач техдолга' },
  { key: 'pricing', summary: 'тарифы моделей для подсчёта стоимости сессий' },
  { key: 'pricing_guard', summary: 'сверка цены вендора с каталогом (VL-317)' },
  { key: 'upstream', summary: 'канал баг-репортов между проектами (mode git|api)' },
  { key: 'chat', summary: 'лимиты веб-чата: max_iterations, max_wall_time, call_timeout' },
  { key: 'chat_max_tool_calls', summary: 'лимит tool-вызовов на ход веб-чата' },
  { key: 'chat_personas', summary: 'персоны чата (системные подсказки)' },
  { key: 'catalog', summary: 'каталог предложений/UI-компонентов' },
  { key: 'max_wall_time', summary: 'лимит времени фазы, секунды (дефолт 600)' },
  { key: 'default_agent', summary: 'агент по умолчанию для фаз и кнопок бота' },
  { key: 'branch_mode', summary: 'параллельная разработка в git worktree ветки vb/vl-N' },
  { key: 'compact', summary: 'компакшн истории LLM-запроса (false — выключить)' },
  { key: 'code_same_session', summary: 'фаза code продолжает plan-сессию (--resume)' },
  { key: 'commit_coauthor', summary: 'трейлер Co-authored-by в коммитах (false — выключить)' },
  { key: 'reset_limits_on_resume', summary: 'сброс накопленных лимитов loop detection при resume' },
  { key: 'idle_timeout_seconds', summary: 'idle-таймаут фазы (0 — watchdog выключен)' },
  { key: 'loop_detection_repeat', summary: 'порог loop detection: одинаковых вызовов подряд' },
  { key: 'max_requests', summary: 'лимит LLM-запросов (ходов модели) на фазу' },
  { key: 'task_type_styles', summary: 'тип задачи → стиль кнопки в rich-выводе бота' },
  { key: 'git_user_name', summary: 'имя автора для git-операций фаз' },
];

/**
 * Пример секции `workflows` для markdown-вывода.
 *
 * Полный DEFAULT_WORKFLOW в пример не годится: 13 переходов раздувают
 * markdown вдвое. Здесь минимальный ВАЛИДНЫЙ workflow (проверяется
 * `isValidWorkflow`: непустой initial_status + массив переходов) — он
 * показывает форму, а не подменяет дефолт содержимым.
 */
const EXAMPLE_WORKFLOW_SECTION = {
  workflows: {
    default: {
      initial_status: 'To Do',
      transitions: [
        { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
        { status: 'Spec', phase: 'plan', produces_status: 'Planned' },
        { status: 'Planned', phase: 'code', produces_status: 'Review' },
        { status: 'Review', phase: 'close', produces_status: 'Done' },
      ],
    },
    // simple: одна фаза do вместо spec+plan — неполнота берётся из completeness.simple
    simple: { initial_status: 'To Do', transitions: [{ status: 'To Do', phase: 'do', produces_status: 'Done' }] },
  },
  task_workflows: { chore: 'simple' },
};

/** Правила доступа и контракт ответа — стабильный текст (источник: tool-result.ts). */
const ACCESS: CapabilitiesAccess = {
  read: 'Чтение (list/view/search/status/map) — сразу: файлов проекта не меняет.',
  write:
    'create/update/delete/complete/trigger_phase/commit — через подтверждение Allow/Deny ' +
    '(в фазе агента запись идёт сразу: фаза уже санкционирована).',
  ack:
    '{ok, outcome, applied, skipped}: applied — что записалось, skipped — что нет и почему. ' +
    'Отказ подтверждения: {ok:false, denied:true, reason}. Повтор с idempotencyKey не ' +
    'применяет изменение второй раз (idempotentReplay:true).',
  reasons: [
    { reason: 'denied', meaning: 'пользователь отказал — повторять нельзя' },
    { reason: 'not_confirmed', meaning: 'подтверждение не получено — повтор безопасен' },
    { reason: 'noop', meaning: 'менять нечего: переданные значения совпадают с текущими' },
  ],
};

/** Подсказки «что делать дальше» для нового проекта. */
const NEXT_STEPS: string[] = [
  'Статусы из backlog/config.yml уже совпадают с дефолтным workflow — секцию `workflows` в settings.json писать НЕ обязательно: при отсутствии ключа работает DEFAULT_WORKFLOW.',
  'Свой workflow — только если нужен другой граф фаз: обсуди проект с ролью `workflow-designer` в веб-чате или собери конфигурацию через `vibelog workflow apply` (MCP: `workflow_apply`); проверка — `vibelog workflow validate`.',
  'Промпт фазы переопределяется файлом .vibelog/prompts/phases/phase-<фаза>.md — правка пакета не нужна.',
  'Краткие азы для агента: `vibelog instructions`; карта кода: `vibelog map`; состояние проекта: `vibelog status`.',
];

/** Обрезает строку до max символов по границе слова (для markdown-вывода). */
function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Назначение фазы из шаблона: текст в скобках первой строки либо fallback.
 *
 * Шаблоны начинаются с «Ты — автоматический исполнитель Vibelog (Фаза 2:
 * Plan) для задачи …» — содержательная часть именно в скобках; у `prompt.md`
 * там «команда prompt: …». Если шаблон прочитать не удалось (нет каталога) —
 * берём PHASE_PURPOSES, чтобы справочник не терял смысла.
 */
function phasePurpose(name: string, template: string): string {
  // Первая строка шаблона — «Ты — автоматический исполнитель Vibelog (Фаза 2:
  // Plan) для задачи {{taskId}}». Заголовок в скобках («Фаза 2: Plan») сам по
  // себе бесполезен в справочнике, поэтому по умолчанию берём содержательное
  // назначение из PHASE_PURPOSES, а из шаблона — только факт его наличия.
  // Если фазы нет в таблице (новая фаза без записи), берём содержимое скобок.
  if (PHASE_PURPOSES[name]) return PHASE_PURPOSES[name];
  const firstLine = template.split('\n').find((line) => line.trim() !== '') ?? '';
  const inParens = firstLine.match(/\(([^)]{3,120})\)/);
  return truncate(inParens ? inParens[1] : firstLine, 60);
}

/** Компактное представление дефолтного значения ключа config.yml. */
function compactValue(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length} элементов]`;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value === '' ? "''" : value;
  return String(value);
}

/**
 * Собирает справочник возможностей проекта.
 *
 * Битый или отсутствующий `.vibelog/settings.json` не роняет сборку:
 * `loadSettings` возвращает `{}`, `loadWorkflows`/`loadCompleteness` падают
 * в дефолты. Потенциально бросающие части (чтение шаблонов фаз) обёрнуты
 * в try/catch: справочник обязан печататься даже в неполной установке.
 *
 * @param cwd — корень проекта (для settings.json и переопределений шаблонов)
 */
export function buildCapabilities(cwd: string): CapabilitiesData {
  // --- workflow: дефолт из кода либо переопределение в settings.json -------
  let workflow: Workflow = DEFAULT_WORKFLOW;
  let taskWorkflows: Record<string, string> = {};
  let source: WorkflowSource = 'default-in-code';
  try {
    const config = loadWorkflows(cwd);
    workflow = config.workflows.default ?? DEFAULT_WORKFLOW;
    taskWorkflows = config.task_workflows ?? {};
    // Сравнение по ссылке: loadWorkflows кладёт именно DEFAULT_WORKFLOW,
    // когда ключа `workflows` в settings.json нет (или он битый).
    source = workflow === DEFAULT_WORKFLOW ? 'default-in-code' : 'settings';
  } catch {
    // Битый settings.json не должен ломать справочник — работаем на дефолте
  }

  const note =
    source === 'default-in-code'
      ? 'Дефолт в коде (DEFAULT_WORKFLOW, src/core/workflow.ts); в .vibelog/settings.json ключа `workflows` нет — работает эта схема.'
      : 'Взят из ключа `workflows` в .vibelog/settings.json (переопределяет DEFAULT_WORKFLOW). Убери ключ — вернётся дефолт из кода.';

  // --- completeness -------------------------------------------------------
  let completeness: CompletenessMap = DEFAULT_COMPLETENESS;
  try {
    completeness = loadCompleteness(cwd);
  } catch {
    // fallback на DEFAULT_COMPLETENESS
  }

  // --- фазы: имя + назначение из шаблона -----------------------------------
  const phases: CapabilitiesPhase[] = PHASES.map((name) => {
    try {
      const template = loadPhaseTemplate(name, { cwd });
      return {
        name,
        purpose: phasePurpose(name, template),
        template: name === 'prompt' ? 'prompt.md' : `phase-${name}.md`,
        overridable: true,
      };
    } catch {
      return {
        name,
        purpose: PHASE_PURPOSES[name] ?? '(назначение недоступно)',
        template: name === 'prompt' ? 'prompt.md' : `phase-${name}.md`,
        overridable: true,
      };
    }
  });

  // --- MCP-инструменты и CLI-команды: только из реестров -------------------
  const mcpTools: CapabilitiesTool[] = listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
  const cliCommands: CliCommandEntry[] = CLI_COMMANDS.map((entry) => ({
    name: entry.name,
    summary: entry.summary,
  }));

  // --- ключи backlog/config.yml: из defaultConfig --------------------------
  const defaults = defaultConfig('<project>', '<PREFIX>');
  const configKeys: CapabilitiesConfigKey[] = Object.entries(defaults).map(([key, value]) => ({
    key,
    defaultValue: compactValue(value),
  }));

  return {
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    kind: 'capabilities',
    workflow: {
      initial_status: workflow.initial_status,
      transitions: workflow.transitions,
      source,
      note,
    },
    taskWorkflows,
    completeness,
    phases,
    servicePhases: [...SERVICE_PHASES],
    mcpTools,
    cliCommands,
    configSource: 'backlog/config.yml — дефолтные ключи из defaultConfig() (src/core/config.ts)',
    configKeys,
    settingsSource:
      '.vibelog/settings.json — ключи, которые реально читает код (секреты и chat_id живут в .env; секция `env` не читается, VL-329)',
    settingsKeys: SETTINGS_KEYS,
    templateOverrideDir: PROJECT_PROMPTS_DIR,
    access: ACCESS,
    nextSteps: NEXT_STEPS,
  };
}

/** Компактная строка перехода: `To Do --spec--> Spec`. */
function transitionLine(t: Transition): string {
  if (t.phase === null) return `${t.status} — финальный статус`;
  return `${t.status} --${t.phase}--> ${t.produces_status ?? t.status}`;
}

/**
 * Укладывает элементы в строки по два — экономия markdown-объёма.
 *
 * Справочник печатается в один tool-ответ, а элементов много (50 MCP-инструментов,
 * 29 CLI-команд, 29+16 ключей конфигов). По одному элементу на строку вывод
 * выходит за ~20 КБ; по два в строке — вдвое компактнее при той же полноте.
 * Полные (не урезанные) описания остаются в `--json`.
 *
 * @param items — элементы
 * @param render — превращает элемент в текст пункта (без маркера)
 */
function pairLines<T>(items: readonly T[], render: (item: T) => string, perLine = 2): string[] {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += perLine) {
    const chunk: string[] = [];
    for (let j = i; j < Math.min(i + perLine, items.length); j++) chunk.push(render(items[j]));
    lines.push(`- ${chunk.join(' · ')}`);
  }
  return lines;
}

/**
 * Рендерит справочник в компактный markdown (человекочитаемая форма).
 *
 * Ограничение размера: ориентир ~8 КБ — один tool-ответ. Поэтому описания
 * MCP-инструментов и CLI-команд обрезаются (markdown — обзор, полные данные —
 * `--json`), а переходы workflow печатаются одной строкой на переход.
 *
 * @param data — результат buildCapabilities
 */
export function renderCapabilitiesMarkdown(data: CapabilitiesData): string {
  const lines: string[] = [];

  lines.push('# Vibelog — справочник возможностей');
  lines.push('');
  lines.push('Собрано из кода: workflow — DEFAULT_WORKFLOW, фазы — templates/phases, MCP — listTools(),');
  lines.push('CLI — src/cli/command-registry.ts, ключи — defaultConfig()/loadSettings().');
  lines.push('Машиночитаемая форма без обрезки: `vibelog capabilities --json`.');
  lines.push('');

  // --- workflow -----------------------------------------------------------
  lines.push('## Workflow: статусы и фазы');
  lines.push('');
  lines.push(data.workflow.note);
  lines.push(`Стартовый статус: **${data.workflow.initial_status}**. ` +
    'Служебные фазы (вне workflow, статус не меняют): ' + data.servicePhases.join(', ') + '.');
  lines.push('');
  lines.push('```');
  for (const line of pairLines(data.workflow.transitions, transitionLine)) lines.push(line.slice(2));
  lines.push('```');
  lines.push('');
  lines.push('Пример секции `workflows` в `.vibelog/settings.json` (сокращённо; нужны все переходы):');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(EXAMPLE_WORKFLOW_SECTION));
  lines.push('```');
  lines.push('');

  // --- task_workflows -----------------------------------------------------
  lines.push('## task_workflows (тип задачи → workflow)');
  lines.push('');
  const taskEntries = Object.entries(data.taskWorkflows);
  if (taskEntries.length === 0) {
    lines.push('Не задано: все типы задач используют `default`.');
  } else {
    for (const [type, wf] of taskEntries) lines.push(`- \`${type}\` → \`${wf}\``);
  }
  lines.push('');

  // --- completeness -------------------------------------------------------
  lines.push('## completeness (какие поля обязательны в какой фазе)');
  lines.push('');
  for (const [wfName, phases] of Object.entries(data.completeness)) {
    lines.push(`**${wfName}**`);
    for (const [phaseName, entities] of Object.entries(phases)) {
      const parts = Object.entries(entities).map(([entity, fields]) => `${entity}: ${fields.join(', ')}`);
      lines.push(`- ${phaseName === '*' ? 'любая фаза' : phaseName} → ${parts.join('; ')}`);
    }
  }
  lines.push('');

  // --- фазы ---------------------------------------------------------------
  lines.push('## Фазы');
  lines.push('');
  lines.push(`Переопределение шаблона: \`${data.templateOverrideDir}/<файл>\` (приоритетнее встроенного).`);
  lines.push('');
  lines.push(...pairLines(data.phases, (p) => `\`${p.name}\` — ${truncate(p.purpose, 34)}`));
  lines.push('');
  lines.push('Файл шаблона: `phase-<фаза>.md` (у `prompt` — `prompt.md`) в `templates/phases/`.');
  lines.push('');

  // --- MCP ----------------------------------------------------------------
  lines.push(`## MCP-инструменты (${data.mcpTools.length})`);
  lines.push('');
  lines.push('Имена с описаниями — `vibelog capabilities --json`.');
  lines.push('');
  lines.push(...pairLines(data.mcpTools, (tool) => `\`${tool.name}\``, 5));
  lines.push('');

  // --- CLI ----------------------------------------------------------------
  lines.push(`## CLI-команды (${data.cliCommands.length})`);
  lines.push('');
  lines.push(...pairLines(data.cliCommands, (cmd) => `\`${cmd.name}\` — ${truncate(cmd.summary, 26)}`, 2));
  lines.push('');

  // --- конфиги ------------------------------------------------------------
  lines.push('## Ключи backlog/config.yml');
  lines.push('');
  lines.push(data.configSource);
  lines.push('');
  lines.push(...pairLines(data.configKeys, ({ key, defaultValue }) =>
    `\`${key}\`=${truncate(defaultValue, 18)}`, 3));
  lines.push('');

  lines.push('## Ключи .vibelog/settings.json');
  lines.push('');
  lines.push(data.settingsSource);
  lines.push('');
  lines.push(...pairLines(data.settingsKeys, ({ key }) => `\`${key}\``, 4));
  lines.push('');
  lines.push('Назначение каждого ключа — `vibelog capabilities --json` (settingsKeys[].summary).');
  lines.push('');

  // --- доступ и контракт --------------------------------------------------
  lines.push('## Доступ: чтение и запись');
  lines.push('');
  lines.push(`- **Чтение** — сразу, без подтверждения (файлы не меняются).`);
  lines.push(`- **Запись** — ${data.access.write}`);
  lines.push(`- **Ответ write-инструмента** — ${data.access.ack}`);
  for (const r of data.access.reasons) lines.push(`  - \`${r.reason}\` — ${r.meaning}`);
  lines.push('');

  // --- дальше -------------------------------------------------------------
  lines.push('## Что делать дальше');
  lines.push('');
  for (const step of data.nextSteps) lines.push(`- ${step}`);
  lines.push('');

  return lines.join('\n');
}
