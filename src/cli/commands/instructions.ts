/**
 * Команда `vibelog instructions` — инструкции для AI-агентов (VL-396).
 *
 * До VL-396 здесь было 4 литеральных текста про CLI-команды задач, и агент в
 * новом проекте не узнавал главного: как устроен фазовый workflow (и что его
 * дефолт живёт В КОДЕ, а не в конфиге проекта), какие есть MCP-инструменты и
 * по каким правилам их применять, какие ключи читаются из settings.json.
 *
 * Теперь тем семь, и четыре из них (overview, workflow, mcp, settings)
 * ГЕНЕРИРУЮТСЯ из реестров кода: `DEFAULT_WORKFLOW`/`DEFAULT_COMPLETENESS`
 * (src/core/workflow.ts), `listTools()` (src/mcp/tools.ts),
 * `buildCapabilities()` (src/core/capabilities.ts). Литеральный список
 * разъехался бы с исполнением — именно этого задача и должна избежать
 * (AC6: новый инструмент в реестре обязан попасть в отчёт, а не потеряться).
 *
 * Размер одной темы — ориентир до ~8 КБ: это один tool-ответ агента.
 */

import { printInfo, printError } from '../ui.js';
import type { FlagValues } from '../args.js';
import {
  DEFAULT_COMPLETENESS,
  DEFAULT_WORKFLOW,
  SERVICE_PHASES,
  loadWorkflows,
} from '../../core/workflow.js';
import type { Transition, Workflow } from '../../core/workflow.js';
import { buildCapabilities } from '../../core/capabilities.js';
import { listTools } from '../../mcp/tools.js';
import { PROJECT_PROMPTS_DIR } from '../../web/phase-prompt.js';

/**
 * Полный список тем в порядке вывода.
 *
 * Единственный источник для листинга, текста ошибки, `--help` роутера и
 * summary в реестре CLI-команд: раньше список тем был размазан по трём
 * местам и разъезжался.
 */
export const INSTRUCTION_TOPICS = [
  'overview',
  'workflow',
  'mcp',
  'settings',
  'task-creation',
  'task-execution',
  'task-finalization',
] as const;

/** Имя темы инструкций. */
export type InstructionTopic = (typeof INSTRUCTION_TOPICS)[number];

/** Одна строка назначения темы — для листинга и текста ошибки. */
const TOPIC_SUMMARIES: Record<InstructionTopic, string> = {
  overview: 'обзор: что такое Vibelog, фазовый workflow, куда смотреть дальше',
  workflow: 'фазы и статусы, ветки reject и fix-цикл, ключи workflows/task_workflows/completeness',
  mcp: 'MCP-инструменты по группам и правила их применения',
  settings: 'ключи .vibelog/settings.json и backlog/config.yml, git-политика',
  'task-creation': 'создание задач через CLI',
  'task-execution': 'выполнение задач через CLI',
  'task-finalization': 'завершение задач через CLI',
};

/**
 * Группы MCP-инструментов: заголовок + имена из реестра `listTools()`.
 *
 * Имена литеральные (реестр не размечен по группам), поэтому дрейф ловится
 * тестом-инвариантом: каждое имя обязано существовать в `listTools()`, а
 * каждый инструмент реестра — попасть в какую-нибудь группу (незнакомые
 * уходят в «прочее», см. `groupMcpTools`).
 */
export const MCP_GROUPS: readonly { title: string; names: readonly string[] }[] = [
  {
    title: 'Задачи и чеклисты',
    names: [
      'backlog_create_task', 'backlog_list_tasks', 'backlog_view_task',
      'backlog_update_task', 'backlog_update_status', 'backlog_manage_ac',
      'backlog_manage_dod', 'backlog_add_comment', 'backlog_update_dependencies',
      'backlog_search', 'backlog_ready',
    ],
  },
  {
    title: 'Документы',
    names: [
      'document_list', 'document_view', 'document_create',
      'document_update', 'document_edit', 'document_search',
    ],
  },
  {
    title: 'Вехи',
    names: ['milestone_list', 'milestone_add', 'milestone_rename', 'milestone_remove', 'milestone_archive'],
  },
  {
    title: 'Lessons (уроки из опыта задач)',
    names: [
      'lesson_list', 'lesson_create', 'lesson_view', 'lesson_update',
      'lesson_search_lessons', 'lesson_link', 'lesson_supersede',
      'lesson_audit', 'lesson_classify',
    ],
  },
  {
    title: 'References (внешние источники знаний)',
    names: [
      'reference_list', 'reference_add', 'reference_view', 'reference_search',
      'reference_remove', 'reference_update', 'reference_link', 'reference_sync',
    ],
  },
  {
    title: 'Фазы и супервизор',
    names: [
      'backlog_finish_phase', 'backlog_trigger_phase', 'backlog_phase_status',
      'backlog_auto_queue', 'backlog_supervisor',
    ],
  },
  {
    title: 'Код и git',
    names: ['project_map', 'git_commit'],
  },
  {
    title: 'Upstream (баг-репорты между проектами)',
    names: ['upstream_report_bug', 'upstream_list_reports', 'upstream_ack_report'],
  },
];

/** Заголовок группы для инструментов, которых нет ни в одной группе. */
const OTHER_GROUP_TITLE = 'Прочее (новые инструменты реестра)';

/**
 * Раскладывает инструменты реестра по группам.
 *
 * Незнакомое имя не теряется: оно попадает в группу «прочее» в конце списка
 * (AC6 — новый инструмент в реестре не ломает партиционирование). Пустые
 * группы не печатаются: группа, все имена которой исчезли из реестра, не
 * должна занимать место в tool-ответе.
 *
 * @param tools — инструменты реестра (достаточно поля `name`)
 * @returns группы в порядке `MCP_GROUPS` + «прочее» (если непусто)
 */
export function groupMcpTools(
  tools: readonly { name: string }[]
): { title: string; tools: string[] }[] {
  const known = new Set<string>();
  const groups: { title: string; tools: string[] }[] = [];

  for (const group of MCP_GROUPS) {
    const names = group.names.filter((name) => tools.some((tool) => tool.name === name));
    for (const name of names) known.add(name);
    if (names.length > 0) groups.push({ title: group.title, tools: names });
  }

  const rest = tools.map((tool) => tool.name).filter((name) => !known.has(name));
  if (rest.length > 0) groups.push({ title: OTHER_GROUP_TITLE, tools: rest });

  return groups;
}

/** Компактная строка перехода: `To Do --spec--> Spec`. */
function transitionLine(t: Transition): string {
  if (t.phase === null) return `${t.status} — финальный статус`;
  return `${t.status} --${t.phase}--> ${t.produces_status ?? t.status}`;
}

/**
 * Действующий workflow проекта и его источник.
 *
 * Сравнение по ссылке: `loadWorkflows` кладёт именно `DEFAULT_WORKFLOW`, когда
 * ключа `workflows` в settings.json нет (или он битый) — так же определяет
 * источник `buildCapabilities` (src/core/capabilities.ts).
 */
function activeWorkflow(cwd: string): { workflow: Workflow; fromSettings: boolean } {
  try {
    const config = loadWorkflows(cwd);
    const workflow = config.workflows.default ?? DEFAULT_WORKFLOW;
    return { workflow, fromSettings: workflow !== DEFAULT_WORKFLOW };
  } catch {
    // Битый settings.json не должен ломать инструкцию — работаем на дефолте
    return { workflow: DEFAULT_WORKFLOW, fromSettings: false };
  }
}

/** Пример секции `workflows` — минимальный валидный граф (форма, не дефолт). */
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
    simple: {
      initial_status: 'To Do',
      transitions: [{ status: 'To Do', phase: 'do', produces_status: 'Done' }],
    },
  },
  task_workflows: { chore: 'simple' },
  completeness: {
    default: {
      plan: { task: ['implementationPlan'] },
      close: { task: ['acceptanceCriteria', 'definitionOfDone'] },
      '*': { task: ['description'], lesson: ['content'] },
    },
  },
};

/** Тема `overview`: что такое Vibelog и как устроен жизненный цикл задачи. */
function overviewTopic(cwd: string): string {
  const { workflow, fromSettings } = activeWorkflow(cwd);
  const lines: string[] = [];

  lines.push('# Vibelog.md — инструкция для AI-агента');
  lines.push('');
  lines.push('Vibelog.md — markdown-нативный таск-менеджер для git-репозиториев,');
  lines.push('совместимый по формату данных с Backlog.md. Задачи — markdown-файлы');
  lines.push('с YAML-фронтматтером в `backlog/tasks/`; завершённые уезжают в `backlog/completed/`.');
  lines.push('');
  lines.push('## Базовые команды');
  lines.push('');
  lines.push('```bash');
  lines.push('vibelog task create "Заголовок" -d "Описание" --ac "Критерий"');
  lines.push('vibelog task list --ready');
  lines.push('vibelog task view <id>');
  lines.push('vibelog board');
  lines.push('vibelog search "текст"');
  lines.push('```');
  lines.push('');
  lines.push('## Workflow — фазовый процесс');
  lines.push('');
  lines.push('Жизненный цикл задачи — цепочка фаз, каждая фаза двигает статус:');
  lines.push('');
  lines.push('```');
  for (const t of workflow.transitions) lines.push(transitionLine(t));
  lines.push('```');
  lines.push('');
  lines.push('Ветки: `reject` из любого рабочего статуса → `Rejected`; fix-цикл');
  lines.push('`Review --code--> Review` — доработка после ревью без возврата в Planned.');
  lines.push('Служебные фазы вне workflow (статус не меняют): ' + SERVICE_PHASES.join(', ') + '.');
  lines.push('');
  lines.push(
    fromSettings
      ? 'Действующая схема взята из ключа `workflows` в `.vibelog/settings.json` (переопределяет дефолт).'
      : 'Это ДЕФОЛТ В КОДЕ (`DEFAULT_WORKFLOW`, src/core/workflow.ts). Секции `workflows` в `.vibelog/settings.json` может не быть — её отсутствие нормально и означает «работает дефолт».'
  );
  lines.push('');
  lines.push('## Куда смотреть дальше');
  lines.push('');
  lines.push('- `vibelog instructions workflow` — фазы, ветки, ключи `workflows`/`task_workflows`/`completeness`;');
  lines.push('- `vibelog instructions mcp` — MCP-инструменты по группам и правила их применения;');
  lines.push('- `vibelog instructions settings` — ключи `.vibelog/settings.json` и `backlog/config.yml`;');
  lines.push('- `vibelog capabilities` — полный справочник, собранный из кода (`--json` — машиночитаемо);');
  lines.push('- `vibelog map` — карта кода проекта; `vibelog status` — «где я».');
  lines.push('');

  return lines.join('\n');
}

/** Тема `workflow`: фазы, статусы, переопределение и полнота. */
function workflowTopic(cwd: string): string {
  const { workflow, fromSettings } = activeWorkflow(cwd);
  const lines: string[] = [];

  lines.push('# Workflow: фазы, статусы, переопределение');
  lines.push('');
  lines.push('## Действующая схема');
  lines.push('');
  lines.push(
    fromSettings
      ? 'Источник: ключ `workflows` в `.vibelog/settings.json` (переопределяет `DEFAULT_WORKFLOW`).'
      : 'Источник: ДЕФОЛТ В КОДЕ — `DEFAULT_WORKFLOW` (src/core/workflow.ts). Ключа `workflows` в `.vibelog/settings.json` нет; это нормально.'
  );
  lines.push(`Стартовый статус: **${workflow.initial_status}**.`);
  lines.push('');
  lines.push('```');
  for (const t of workflow.transitions) lines.push(transitionLine(t));
  lines.push('```');
  lines.push('');
  lines.push('Служебные фазы вне workflow (статус не меняют): ' + SERVICE_PHASES.join(', ') + '.');
  lines.push('');
  lines.push('## Ключи `.vibelog/settings.json`');
  lines.push('');
  lines.push('`workflows` — **переопределение**, а не обязательная настройка: нет ключа →');
  lines.push('работает `DEFAULT_WORKFLOW`; битый JSON или невалидная запись → тоже дефолт.');
  lines.push('`task_workflows` — тип задачи → имя workflow (неизвестный тип → `default`).');
  lines.push('`completeness` — какие поля обязательны в какой фазе (workflow → фаза → сущность → поля).');
  lines.push('');
  lines.push('Пример (сокращённый; в своём workflow нужны все переходы):');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(EXAMPLE_WORKFLOW_SECTION, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('`simple` — workflow с единственной фазой `do` (реализация без spec+plan):');
  lines.push('в нём нет ни плана, ни критериев, поэтому и `completeness` для него свой.');
  lines.push('');
  lines.push('## Полнота по умолчанию (`DEFAULT_COMPLETENESS`)');
  lines.push('');
  for (const [wfName, phases] of Object.entries(DEFAULT_COMPLETENESS)) {
    lines.push(`**${wfName}**`);
    for (const [phaseName, entities] of Object.entries(phases)) {
      const parts = Object.entries(entities).map(([entity, fields]) => `${entity}: ${fields.join(', ')}`);
      lines.push(`- ${phaseName === '*' ? 'любая фаза' : phaseName} → ${parts.join('; ')}`);
    }
  }
  lines.push('');
  lines.push('## Переопределение шаблона фазы');
  lines.push('');
  lines.push(`Файл \`${PROJECT_PROMPTS_DIR}/phase-<фаза>.md\` (у фазы \`prompt\` — \`prompt.md\`)`);
  lines.push('приоритетнее встроенного `templates/phases/`. Правка пакета не нужна.');
  lines.push('');
  lines.push('Полный справочник (фазы с назначением, ключи, MCP): `vibelog capabilities`.');
  lines.push('');

  return lines.join('\n');
}

/** Тема `mcp`: группы инструментов и правила применения. */
function mcpTopic(cwd: string): string {
  const lines: string[] = [];
  const groups = groupMcpTools(listTools());

  lines.push('# MCP-инструменты: группы и правила');
  lines.push('');
  lines.push('MCP-сервер (`vibelog mcp start`) отдаёт инструменты по stdio; список ниже');
  lines.push('собран из реестра `listTools()` — новый инструмент появляется здесь сам.');
  lines.push('');

  for (const group of groups) {
    lines.push(`## ${group.title} (${group.tools.length})`);
    lines.push('');
    for (const name of group.tools) lines.push(`- \`${name}\``);
    lines.push('');
  }

  lines.push('## Правила применения');
  lines.push('');
  lines.push('- **`backlog/` правится только MCP-инструментами.** `edit`/`write_file` по');
  lines.push('  `backlog/tasks/`, `backlog/docs/`, `backlog/lessons/` запрещены: правка уйдёт');
  lines.push('  в worktree-копию и потеряется, а формат (frontmatter, чеклисты) разъедется.');
  lines.push('- **Чтение** (`list`/`view`/`search`/`ready`/`project_map`) — сразу, без подтверждения:');
  lines.push('  файлов проекта не меняет.');
  lines.push('- **Запись** (`create`/`update`/`delete`/`complete`/`trigger_phase`/`commit`) — через');
  lines.push('  подтверждение Allow/Deny. В фазе агента запись идёт сразу: фаза уже санкционирована.');
  lines.push('- **Контракт ответа write-инструмента** — `{ok, outcome, applied, skipped}`:');
  lines.push('  `applied` — что записалось, `skipped` — что нет и почему. Отказ подтверждения:');
  lines.push('  `{ok:false, denied:true, reason}`; причины — `denied` (пользователь отказал,');
  lines.push('  повторять нельзя), `not_confirmed` (подтверждение не получено, повтор безопасен),');
  lines.push('  `noop` (менять нечего).');
  lines.push('- **`idempotencyKey`** — повтор с тем же ключом не применяет изменение второй раз,');
  lines.push('  а возвращает результат первого (`idempotentReplay: true`). Передавай при повторе');
  lines.push('  после таймаута.');
  lines.push('- **`backlog_finish_phase`** — завершение фазы одним вызовом: статус + отчёт +');
  lines.push('  отметки AC/DoD. Отдельные `backlog_update_status`/`backlog_add_comment` для');
  lines.push('  отчёта фазы не нужны.');
  lines.push('');
  lines.push('Полные описания и схемы аргументов: `vibelog capabilities --json` (секция `mcpTools`).');
  lines.push('');

  return lines.join('\n');
}

/** Тема `settings`: читаемые ключи конфигов и git-политика `.vibelog/`. */
function settingsTopic(cwd: string): string {
  const lines: string[] = [];

  lines.push('# Настройки: `.vibelog/settings.json` и `backlog/config.yml`');
  lines.push('');

  let settingsKeys: { key: string; summary: string }[] = [];
  let configKeys: { key: string; defaultValue: string }[] = [];
  try {
    const data = buildCapabilities(cwd);
    settingsKeys = data.settingsKeys;
    configKeys = data.configKeys;
  } catch {
    // Неполная установка (нет templates/) не должна ломать инструкцию:
    // печатаем хотя бы git-политику и отсылку к capabilities
  }

  if (settingsKeys.length > 0) {
    lines.push('## `.vibelog/settings.json` — ключи, которые реально читает код');
    lines.push('');
    for (const { key, summary } of settingsKeys) lines.push(`- \`${key}\` — ${summary}`);
    lines.push('');
  }

  if (configKeys.length > 0) {
    lines.push('## `backlog/config.yml` — ключи проекта (дефолты из `defaultConfig()`)');
    lines.push('');
    for (const { key, defaultValue } of configKeys) lines.push(`- \`${key}\` = ${defaultValue}`);
    lines.push('');
  }

  lines.push('## Git-политика `.vibelog/`');
  lines.push('');
  lines.push('Коммитятся: `config.json`, `installed.lock.json`, `settings.json`, `prompts/`, `billing/`.');
  lines.push('Локальны (в `.vibelog/.gitignore`): `agent-sessions/`, `chat-sessions/`, `cache/`,');
  lines.push('`qwen-debug/`, `tmp/`, `supervisor/`, `worktrees/`, `idempotency.json`,');
  lines.push('`auto-queue.json`, `phase-in-progress.json`, `*.log`.');
  lines.push('');
  lines.push('**Секретов в `settings.json` нет**: токены, API-ключи и `TELEGRAM_CHAT_IDS` живут');
  lines.push('только в `.env` в корне проекта (приоритет: shell-окружение → `.env`). Секция `env`');
  lines.push('в `settings.json` больше не читается.');
  lines.push('');
  lines.push('Полный справочник ключей: `vibelog capabilities --json` (секции `settingsKeys`, `configKeys`).');
  lines.push('');

  return lines.join('\n');
}

/** Статические темы про CLI-команды задач (тексты не менялись с VL-396). */
const STATIC_TOPICS: Record<string, string> = {
  'task-creation': `# Создание задач в Vibelog.md

## Формат команды
\`\`\`bash
vibelog task create "Заголовок" [опции]
\`\`\`

## Опции
- \`-d "Описание"\` — описание задачи
- \`--ac "Критерий"\` — критерий приёмки (повторяется)
- \`--dod "Критерий"\` — критерий DoD (повторяется)
- \`--priority High\` — приоритет
- \`--labels bug,feature\` — метки
- \`--deps task-1,task-2\` — зависимости
- \`--milestone v1.0\` — веха
- \`--due-date 2025-12-31\` — срок
- \`-a @user\` — исполнитель

## Пример
\`\`\`bash
vibelog task create "Добавить авторизацию" \\
  -d "Реализовать JWT-авторизацию" \\
  --ac "Токен создаётся при логине" \\
  --ac "Токен обновляется" \\
  --priority High \\
  --labels backend,security
\`\`\`
`,

  'task-execution': `# Выполнение задач в Vibelog.md

## Workflow
1. **Найти задачу**: \`vibelog task list -s "To Do"\`
2. **Взять в работу**: \`vibelog task edit <id> -s "In Progress"\`
3. **Выполнять работу**, отмечая AC по мере готовности:
   \`vibelog task edit <id> --check-ac 1\`
4. **Добавлять заметки**: \`vibelog task edit <id> --append-notes "Сделано X"\`
5. **Завершить**: \`vibelog task complete <id>\`

## Проверка зависимостей
\`\`\`bash
vibelog task list  # убедиться, что зависимости выполнены
\`\`\`
`,

  'task-finalization': `# Завершение задач в Vibelog.md

## Проверка перед завершением
1. Все AC отмечены: \`vibelog task view <id>\`
2. DoD выполнен
3. Код протестирован

## Завершение
\`\`\`bash
vibelog task complete <id>
\`\`\`

Эта команда:
- Меняет статус на "Done"
- Перемещает файл из backlog/tasks/ в backlog/completed/
`,
};

/**
 * Собирает все темы инструкций: статические литералы + генерируемые из кода.
 *
 * @param cwd — корень проекта (settings.json, шаблоны фаз)
 */
export function buildInstructions(cwd: string): Record<string, string> {
  return {
    overview: overviewTopic(cwd),
    workflow: workflowTopic(cwd),
    mcp: mcpTopic(cwd),
    settings: settingsTopic(cwd),
    ...STATIC_TOPICS,
  };
}

/** Блок «Темы» для листинга и текста ошибки. */
function topicsList(): string {
  return INSTRUCTION_TOPICS.map((topic) => `  ${topic} — ${TOPIC_SUMMARIES[topic]}`).join('\n');
}

/**
 * Выполняет команду instructions.
 *
 * @param positional — [topic]
 */
export async function runInstructions(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const topic = positional[0] || 'overview';
  const instructions = buildInstructions(cwd);

  const text = instructions[topic];
  if (!text) {
    printError(`Неизвестная тема: ${topic}`);
    printInfo(`Доступные темы:\n${topicsList()}`);
    return;
  }

  console.log(text);

  // Без явной темы печатаем ещё и листинг: агент видит, что справочник не
  // ограничен overview (AC5).
  if (!positional[0]) {
    printInfo(`Темы инструкций:\n${topicsList()}`);
  }
}
