/**
 * Workflow с явными переходами «статус → фаза → статус» (VL-188).
 *
 * Единственный источник истины для кнопок фаз бота/веба, валидации
 * переносов на канбан-доске (PATCH /api/tasks/:id) и проверки
 * isPhaseAllowed в оркестраторе. Раньше цепочка spec → plan → code → close
 * была захардкожена в nextPhaseForStatus (core/phase-buttons.ts) и шаблонах
 * фаз — нельзя было пропустить Spec (bugfix), сделать do вместо spec+plan
 * (chore/docs) или ветвить (To Do → spec ИЛИ reject).
 *
 * Конфигурация хранится в .vibelog/settings.json (VL-143, общий файл
 * настроек): ключи workflows (имя → Workflow) и task_workflows
 * (тип задачи → имя workflow). Формат:
 *
 *   "workflows": {
 *     "default": {
 *       "initial_status": "To Do",
 *       "transitions": [
 *         { "status": "To Do", "phase": "spec", "produces_status": "Spec" },
 *         { "status": "Done", "phase": null, "produces_status": null }
 *       ]
 *     }
 *   },
 *   "task_workflows": { "bug": "bugfix", "chore": "simple" }
 *
 * Fallback: нет ключей / битый файл / неизвестное имя → DEFAULT_WORKFLOW
 * (прежняя цепочка spec → plan → code → close + reject) — поведение до
 * VL-188 не меняется.
 *
 * Третий уровень той же схемы «дефолт в коде + перезапись в settings» —
 * НЕПОЛНОТА СУЩНОСТИ (VL-370): ключ `completeness` (workflow → фаза →
 * сущность → поля). Дефолт — DEFAULT_COMPLETENESS, читается loadCompleteness
 * с той же семантикой fallback. Формат:
 *
 *   "completeness": {
 *     "default": {
 *       "plan": { "task": ["implementationPlan"] },
 *       "close": { "task": ["acceptanceCriteria", "definitionOfDone"] },
 *       "*":   { "task": ["description"], "lesson": ["content"] }
 *     }
 *   }
 *
 * Зачем данные, а не список полей в инструменте: для простого workflow
 * (фаза `do` вместо spec+plan) плана и критериев в задаче не бывает вовсе —
 * расчёт неполноты обязан зависеть от workflow задачи и текущей фазы.
 *
 * Модуль намеренно импортирует только settings.js (fs) — веб-клиент НЕ
 * импортирует его напрямую (Vite не потянет node:fs): фазы приходят в
 * ответах API (availablePhases/triggerPhase), логика считается на сервере.
 */

import { loadSettings } from './settings.js';
// VL-410: «статус до фазы» нужен для вычисления следующего шага фазы — во
// время рана задача временно в In Progress (VL-196), и переход надо искать от
// ИСХОДНОГО статуса, иначе `getStatusAfterPhase` не найдёт его и любая фаза
// выглядела бы «не двигающей статус». Циклический импорт безопасен: оба
// модуля обращаются к функциям друг друга только внутри тел функций, а не на
// этапе инициализации модуля.
import { getPhaseTransientStatus } from './phase-transient.js';
import type { Task } from './task.js';

/**
 * Переход workflow: из status фазой phase получается produces_status.
 * phase = null → финальный статус (Done/Rejected), исходящих фаз нет.
 */
export interface Transition {
  /** Текущий статус (источник перехода). */
  status: string;
  /** Фаза, запускающаяся из статуса; null — финальный статус без фаз. */
  phase: string | null;
  /** Статус задачи после успешного завершения фазы; null — не меняется. */
  produces_status: string | null;
}

/** Именованный workflow: стартовый статус + граф переходов. */
export interface Workflow {
  /** Статус, в который попадает задача при ручном «взятии в работу». */
  initial_status: string;
  /** Граф переходов; статус может иметь 0..N исходящих фаз (ветвление). */
  transitions: Transition[];
}

/**
 * Карта неполноты: workflow → фаза → сущность → имена полей.
 *
 * Ключ фазы `'*'` — правило, действующее в ЛЮБОЙ фазе (уроку тело нужно
 * всегда, задаче — описание). Наборы `'*'` и конкретной фазы объединяются.
 */
export type CompletenessMap = Record<string, Record<string, Record<string, string[]>>>;

/**
 * Неполнота сущности по умолчанию (VL-370).
 *
 * Семантика полей: `acceptanceCriteria`/`definitionOfDone` — «все пункты
 * отмечены, пустой чеклист считается полным»; остальные — «значение непустое».
 *
 * - `'*'` содержит `task: ['description']` намеренно: задача без описания
 *   неполна в ЛЮБОЙ фазе, поэтому ответ инструмента не зависит от того,
 *   известна ли фаза (ручной вызов MCP, чужой клиент, тесты без env).
 * - `simple` (фаза `do` вместо spec+plan) НЕ требует ни плана, ни критериев:
 *   в этом workflow их не бывает (templates/phases/phase-do.md).
 * - investigation/bugfix и прочие workflow, объявленные пользователем,
 *   получают правила только из своей записи в settings; дефолт в них
 *   не протекает (см. getCompletenessRules).
 */
export const DEFAULT_COMPLETENESS: CompletenessMap = {
  default: {
    // VL-410: AC обязательны в spec — шаблон фазы (templates/phases/phase-spec.md,
    // шаг 6) объявляет их обязательными, а гейт неполноты требовал только
    // описание. Из-за расхождения задача с заполненным описанием считалась
    // полной, и директива повтора не называла модели ни одного следующего шага
    // (сессия agent-1794313856082: 4 дословных повтора → кап → fail).
    spec: { task: ['description', 'acceptanceCriteria'] },
    plan: { task: ['implementationPlan'] },
    close: { task: ['acceptanceCriteria', 'definitionOfDone'] },
    '*': { task: ['description'], lesson: ['content'] },
  },
  simple: {
    do: { task: ['description'] },
    '*': { task: ['description'], lesson: ['content'] },
  },
};

/**
 * Сущности, для которых `completeness` реально применяется (VL-377).
 *
 * Литеральный набор вместо `string` во втором уровне `CompletenessMap`:
 * имена сущностей НЕ настраиваются, поэтому опечатка (`tsak`) — всегда
 * дефект конфигурации, и `validateCompleteness` обязана её показать.
 */
export const COMPLETENESS_ENTITIES: readonly string[] = ['task', 'lesson'];

/**
 * Известные поля `Task`, которые понимает `taskCompletenessMissing` (VL-377).
 *
 * Список — контракт «что можно требовать», а не «что есть в типе»: TS-типы в
 * рантайме не существуют, поэтому набор продублирован явно. Дрейф ловится
 * тестом (`workflow.test.mjs`: `KNOWN_TASK_FIELDS` ⊇ ключи `createTask(...)`,
 * без лишних имён) — иначе новое поле `Task` давало бы ложное предупреждение
 * «поля нет в Task».
 *
 * Почему это важно: для незнакомого не-чеклист поля `taskCompletenessMissing`
 * делает `isEmptyFieldValue(record[field])` → `undefined` → поле попадает в
 * `missing` ВСЕГДА (обратный эффект опечатки — вечная неполнота).
 */
export const KNOWN_TASK_FIELDS: readonly string[] = [
  // frontmatter
  'id', 'title', 'status', 'priority', 'assignee', 'reporter', 'created_date', 'updated_date',
  'due_date', 'labels', 'dependencies', 'milestone', 'type', 'project', 'parent_task_id',
  'ordinal', 'references', 'documentation', 'modified_files', 'lessons', 'token_usage',
  // тело (секции)
  'description', 'acceptanceCriteria', 'definitionOfDone', 'implementationPlan',
  'implementationNotes', 'finalSummary', 'comments',
];

/**
 * Поля урока, которые реально проверяются (VL-377).
 *
 * Единственное проверяемое поле урока — тело (`content`): метаданные урока
 * (title/tags/…) в расчёте неполноты не участвуют (`src/mcp/tools.ts`,
 * `lessonSpec.completeness`), поэтому прочие имена для `lesson` инертны.
 */
export const KNOWN_LESSON_FIELDS: readonly string[] = ['content'];

/**
 * Предупреждение валидации секции `completeness` (VL-377).
 *
 * Опечатка в настраиваемом имени молча отключала правило неполноты: гейт
 * «нельзя закрыть задачу с неотмеченными пунктами» переставал работать без
 * единого следа в логе/ответе инструмента. Предупреждение — единственный
 * наблюдаемый путь для такого дефекта конфигурации.
 */
export interface CompletenessWarning {
  /** Что не так: структура записи, имя workflow/фазы/сущности/поля, ссылка task_workflows. */
  kind: 'structure' | 'workflow' | 'phase' | 'entity' | 'field' | 'task_workflow';
  /** Путь в конфигурации: `completeness.defualt.close.task[0]`, `task_workflows.bugg`. */
  path: string;
  /** Готовый текст для пользователя: что не так и почему правило не применится. */
  message: string;
}

/**
 * Расстояние Левенштейна — для подсказки «возможно, имелось в виду …».
 *
 * Локальная копия вместо импорта из `src/mcp/tools.ts`: core не должен
 * зависеть от слоя MCP (модуль намеренно импортирует только settings.js).
 * Имена короткие, оптимизации не нужны.
 */
function levenshtein(a: string, b: string): number {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Ближайшее известное имя для опечатки (порог — как у подсказок `_warning`
 * в `update_task`: не больше max(2, len/3) либо вхождение подстроки).
 *
 * @returns имя-кандидат либо null, если ничего похожего нет
 */
function nearestName(input: string, known: readonly string[]): string | null {
  const lower = input.toLowerCase();
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of known) {
    const c = candidate.toLowerCase();
    const distance = c.includes(lower) || lower.includes(c) ? 0 : levenshtein(lower, c);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return best !== null && bestDistance <= threshold ? best : null;
}

/**
 * Валидирует секцию `completeness` (и ссылки `task_workflows`) в settings (VL-377).
 *
 * Читает СЫРОЙ settings, а не `loadCompleteness`: структурно битая запись в
 * карту не попадает и иначе исчезла бы бесследно — а пропуск записи и есть
 * часть дефекта («конфигурация молча не действует»).
 *
 * Проверяемые уровни (AC1 задачи VL-377):
 * - имя workflow — против `loadWorkflows(cwd).workflows` ∪ ключей
 *   `DEFAULT_COMPLETENESS` (`simple` объявлен не в каждом проекте, но его
 *   дефолтная запись легитимна);
 * - имя фазы — против `transitions[].phase` ЭТОГО workflow (+ `'*'`, плюс
 *   `SERVICE_PHASES`). Для workflow без объявления в `workflows` (например
 *   `simple`) фазы не проверяются: переходов нет, предупреждать не о чем;
 * - имя сущности — `COMPLETENESS_ENTITIES` (`task`/`lesson`);
 * - имя поля — `KNOWN_TASK_FIELDS` / `KNOWN_LESSON_FIELDS`;
 * - `task_workflows`: значение обязано быть объявленным workflow (иначе
 *   задача молча получит `default`).
 *
 * Ничего не отбрасывает и не переписывает: `loadCompleteness` продолжает
 * работать по принципу частичной валидности (битая запись выпадает, валидные
 * остаются) — предупреждения лишь делают причину видимой.
 *
 * @param cwd — каталог проекта (.vibelog/settings.json)
 * @returns список предупреждений; пустой массив — конфигурация согласована
 */
export function validateCompleteness(
  cwd: string,
  settingsOverride?: Record<string, unknown>
): CompletenessWarning[] {
  const settings = settingsOverride ?? loadSettings(cwd);
  const config = loadWorkflows(cwd, settingsOverride);
  const declared = Object.keys(config.workflows);
  const warnings: CompletenessWarning[] = [];

  // ── task_workflows: ссылка на необъявленный workflow ──
  const rawTaskMap = settings.task_workflows;
  if (rawTaskMap !== null && typeof rawTaskMap === 'object' && !Array.isArray(rawTaskMap)) {
    for (const [type, value] of Object.entries(rawTaskMap as Record<string, unknown>)) {
      if (typeof value !== 'string' || value === '') continue;
      if (declared.includes(value)) continue;
      const hint = nearestName(value, declared);
      warnings.push({
        kind: 'task_workflow',
        path: `task_workflows.${type}`,
        message:
          `тип задачи «${type}» ссылается на необъявленный workflow «${value}»` +
          (hint !== null ? ` (возможно, имелось в виду «${hint}»)` : '') +
          ` — задача получит правила workflow «default»`,
      });
    }
  }

  const raw = settings.completeness;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return warnings;

  const knownWorkflows = [...declared];
  for (const name of Object.keys(DEFAULT_COMPLETENESS)) {
    if (!knownWorkflows.includes(name)) knownWorkflows.push(name);
  }

  for (const [workflowName, entry] of Object.entries(raw as Record<string, unknown>)) {
    const workflowPath = `completeness.${workflowName}`;

    // 1. Структура записи (фаза → сущность → массив строк).
    if (!isValidCompletenessEntry(entry)) {
      warnings.push({
        kind: 'structure',
        path: workflowPath,
        message:
          `запись «${workflowName}» не соответствует формату «фаза → сущность → массив строк» ` +
          'и пропускается при чтении (правила workflow не применяются)',
      });
      continue; // дальше проверять нечего — данные не той формы
    }

    // 2. Имя workflow.
    if (!knownWorkflows.includes(workflowName)) {
      const hint = nearestName(workflowName, knownWorkflows);
      warnings.push({
        kind: 'workflow',
        path: workflowPath,
        message:
          `workflow «${workflowName}» не объявлен (объявлены: ${knownWorkflows.join(', ')})` +
          (hint !== null ? ` — возможно, имелось в виду «${hint}»` : '') +
          '; запись не применяется, задача получит правила workflow «default»',
      });
      // Фазы/сущности/поля такой записи тоже не применяются — о них сообщать
      // отдельно смысла нет: корень проблемы уже назван.
      continue;
    }

    // 3. Фазы — только для workflow, чьи переходы известны.
    const workflow = config.workflows[workflowName];
    let knownPhases: string[] | null = null;
    if (workflow !== undefined) {
      knownPhases = ['*', ...SERVICE_PHASES];
      for (const t of workflow.transitions) {
        if (t.phase !== null && !knownPhases.includes(t.phase)) knownPhases.push(t.phase);
      }
    }

    for (const [phase, perEntity] of Object.entries(entry as Record<string, Record<string, string[]>>)) {
      const phasePath = `${workflowPath}.${phase}`;
      if (knownPhases !== null && !knownPhases.includes(phase)) {
        const hint = nearestName(phase, knownPhases);
        warnings.push({
          kind: 'phase',
          path: phasePath,
          message:
            `фазы «${phase}» нет в workflow «${workflowName}» (есть: ${knownPhases.join(', ')})` +
            (hint !== null ? ` — возможно, имелось в виду «${hint}»` : '') +
            '; правило этой фазы не применится',
        });
      }

      for (const [entity, fields] of Object.entries(perEntity ?? {})) {
        const entityPath = `${phasePath}.${entity}`;
        if (!COMPLETENESS_ENTITIES.includes(entity)) {
          const hint = nearestName(entity, COMPLETENESS_ENTITIES);
          warnings.push({
            kind: 'entity',
            path: entityPath,
            message:
              `сущность «${entity}» не поддерживается (допустимы: ${COMPLETENESS_ENTITIES.join(', ')})` +
              (hint !== null ? ` — возможно, имелось в виду «${hint}»` : '') +
              '; набор полей не применится, сущность будет считаться полной',
          });
          continue;
        }

        const knownFields = entity === 'lesson' ? KNOWN_LESSON_FIELDS : KNOWN_TASK_FIELDS;
        for (let i = 0; i < (fields ?? []).length; i += 1) {
          const field = fields[i];
          if (knownFields.includes(field)) continue;
          const hint = nearestName(field, knownFields);
          warnings.push({
            kind: 'field',
            path: `${entityPath}[${i}]`,
            message:
              (entity === 'lesson'
                ? `для урока проверяется только ${KNOWN_LESSON_FIELDS.join(', ')} — поле «${field}» не применяется`
                : `поля «${field}» нет в Task — оно всегда будет считаться незаполненным`) +
              (hint !== null ? ` (возможно, имелось в виду «${hint}»)`: ''),
          });
        }
      }
    }
  }

  return warnings;
}

/** Конфигурация workflow проекта (секции settings.json). */
export interface WorkflowConfig {
  /** Имя → workflow; отсутствует 'default' → подставляется DEFAULT_WORKFLOW. */
  workflows: Record<string, Workflow>;
  /** Тип задачи → имя workflow; неизвестный тип → 'default'. */
  task_workflows: Record<string, string>;
}

/**
 * Workflow по умолчанию — цепочка до VL-188 (spec → plan → code → close)
 * плюс ветвление reject и fix-цикл Review → code.
 *
 * Добавлен переход In Progress → code: статус входит в дефолтный список
 * config.ts и поддерживался прежним nextPhaseForStatus — без него задачи
 * в In Progress потеряли бы кнопку фазы (регрессия).
 *
 * Done/Rejected — финалы (phase null), исходящих переходов нет.
 */
export const DEFAULT_WORKFLOW: Workflow = {
  initial_status: 'To Do',
  transitions: [
    { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
    { status: 'To Do', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Spec', phase: 'plan', produces_status: 'Planned' },
    { status: 'Spec', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Planned', phase: 'code', produces_status: 'Review' },
    { status: 'Planned', phase: 'reject', produces_status: 'Rejected' },
    { status: 'In Progress', phase: 'code', produces_status: 'Review' },
    // reject из In Progress: rejectTask запускает LLM-reject для задач,
    // бывших в Code (wasInCode = In Progress|Review) — без этого перехода
    // откат начатых изменений из In Progress блокировался бы (VL-144)
    { status: 'In Progress', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Review', phase: 'close', produces_status: 'Done' },
    { status: 'Review', phase: 'code', produces_status: 'Review' },
    { status: 'Review', phase: 'reject', produces_status: 'Rejected' },
    { status: 'Done', phase: null, produces_status: null },
    { status: 'Rejected', phase: null, produces_status: null },
  ],
};

/** Служебные фазы вне workflow: не проверяются isPhaseAllowed, статуса не меняют. */
export const SERVICE_PHASES: readonly string[] = ['comment', 'prompt', 'analyze', 'resume'];

/**
 * Проверяет, что запись из settings.json — валидный Workflow.
 *
 * Нестрогая валидация (только обязательные поля и типы): битая секция
 * workflows не должна ронять бота/веб — просто выпадает в fallback,
 * как loadSettings при битом JSON.
 */
export function isValidWorkflow(value: unknown): value is Workflow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const wf = value as Partial<Workflow>;
  if (typeof wf.initial_status !== 'string' || wf.initial_status === '') return false;
  if (!Array.isArray(wf.transitions)) return false;
  return wf.transitions.every((t) => {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) return false;
    const tr = t as Partial<Transition>;
    return (
      typeof tr.status === 'string' &&
      (tr.phase === null || typeof tr.phase === 'string') &&
      (tr.produces_status === null || typeof tr.produces_status === 'string')
    );
  });
}

/**
 * Читает конфигурацию workflow из .vibelog/settings.json.
 *
 * Отсутствие файла/ключей, битый JSON, невалидные записи → fallback:
 * { workflows: { default: DEFAULT_WORKFLOW }, task_workflows: {} }.
 * Частичная валидность сохраняется: валидные именованные workflow остаются,
 * битые выпадают; ключ 'default', если невалиден — заменяется DEFAULT_WORKFLOW.
 */
export function loadWorkflows(cwd: string, settingsOverride?: Record<string, unknown>): WorkflowConfig {
  const settings = settingsOverride ?? loadSettings(cwd);
  const rawWorkflows = settings.workflows;
  const rawTaskMap = settings.task_workflows;

  const workflows: Record<string, Workflow> = {};
  if (rawWorkflows !== null && typeof rawWorkflows === 'object' && !Array.isArray(rawWorkflows)) {
    for (const [name, value] of Object.entries(rawWorkflows as Record<string, unknown>)) {
      if (isValidWorkflow(value)) workflows[name] = value;
    }
  }
  if (!isValidWorkflow(workflows.default)) workflows.default = DEFAULT_WORKFLOW;

  const taskWorkflows: Record<string, string> = {};
  if (rawTaskMap !== null && typeof rawTaskMap === 'object' && !Array.isArray(rawTaskMap)) {
    for (const [type, name] of Object.entries(rawTaskMap as Record<string, unknown>)) {
      if (typeof name === 'string' && name !== '') taskWorkflows[type] = name;
    }
  }

  return { workflows, task_workflows: taskWorkflows };
}

/**
 * Имя workflow для задачи: task_workflows[type] → 'default' при отсутствии.
 *
 * @param task — задача; пустой/неизвестный тип → 'default'
 */
export function getWorkflowName(cwd: string, task: Task): string {
  const config = loadWorkflows(cwd);
  const type = (task.type ?? '').toLowerCase();
  const name = config.task_workflows[type];
  return name !== undefined && config.workflows[name] !== undefined ? name : 'default';
}

/**
 * Workflow задачи: по имени из task_workflows, иначе DEFAULT_WORKFLOW.
 *
 * Неизвестное имя в task_workflows (имя удалено из settings.json) →
 * тоже default: задача не должна остаться без workflow.
 */
export function getWorkflowForTask(cwd: string, task: Task): Workflow {
  const config = loadWorkflows(cwd);
  const type = (task.type ?? '').toLowerCase();
  const name = config.task_workflows[type];
  return (name !== undefined ? config.workflows[name] : undefined) ?? config.workflows.default;
}

/**
 * Проверяет, что запись неполноты валидна: фаза → сущность → массив строк.
 *
 * Нестрогая валидация по образцу isValidWorkflow: битая запись выпадает,
 * остальные именованные записи остаются (AC1, семантика loadWorkflows).
 */
function isValidCompletenessEntry(value: unknown): value is Record<string, Record<string, string[]>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((perEntity) => {
    if (perEntity === null || typeof perEntity !== 'object' || Array.isArray(perEntity)) return false;
    return Object.values(perEntity as Record<string, unknown>).every(
      (fields) => Array.isArray(fields) && fields.every((f) => typeof f === 'string' && f !== ''),
    );
  });
}

/**
 * Читает карту неполноты из .vibelog/settings.json (VL-370).
 *
 * Семантика — как у loadWorkflows: нет файла/ключа, битый JSON, невалидная
 * запись → DEFAULT_COMPLETENESS; валидные именованные записи сохраняются.
 *
 * Запись workflow из settings ПОЛНОСТЬЮ заменяет одноимённую дефолтную, а не
 * сливается по фазам: иначе добавление фазы в DEFAULT_COMPLETENESS молча
 * ужесточало бы пользовательский workflow, который он настроил осознанно.
 */
export function loadCompleteness(cwd: string): CompletenessMap {
  const settings = loadSettings(cwd);
  const raw = settings.completeness;
  const result: CompletenessMap = {};
  for (const [name, value] of Object.entries(DEFAULT_COMPLETENESS)) {
    result[name] = value;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidCompletenessEntry(value)) result[name] = value;
  }
  return result;
}

/**
 * Правила неполноты для workflow по имени и фазы (VL-370).
 *
 * Набор = запись фазы + запись `'*'` (объединение без дублей); фаза `null`
 * (ручной вызов MCP, чужой клиент) → только `'*'`.
 *
 * Fallback на дефолт — ТОЛЬКО если workflow не объявлен в settings. Объявлен,
 * но не настроен в `completeness` → набор пуст: дефолт не протекает в
 * пользовательскую конфигурацию (иначе investigation-workflow действующего
 * проекта внезапно потребовал бы `description`).
 *
 * @param workflowName — имя workflow задачи (`getWorkflowName`)
 * @param entity — имя сущности (`task`, `lesson`)
 * @returns имена полей; пустой массив → сущность считается полной
 */
export function getCompletenessFields(
  cwd: string,
  workflowName: string,
  phase: string | null,
  entity: string
): string[] {
  const map = loadCompleteness(cwd);
  const declared = Object.keys(loadWorkflows(cwd).workflows);
  const entry: Record<string, Record<string, string[]>> =
    declared.includes(workflowName) && workflowName !== 'default'
      ? (map[workflowName] ?? {})
      : (map[workflowName] ?? map.default ?? {});
  const fields: string[] = [];
  const sources = phase !== null && phase !== '*' ? [entry[phase], entry['*']] : [entry['*']];
  for (const source of sources) {
    for (const field of source?.[entity] ?? []) {
      if (!fields.includes(field)) fields.push(field);
    }
  }
  return fields;
}

/**
 * Правила неполноты для конкретной задачи и фазы (VL-370).
 *
 * Обёртка над `getCompletenessFields`: имя workflow берётся по типу задачи.
 *
 * @returns поля задачи и урока; пустые массивы → сущность считается полной
 */
export function getCompletenessRules(
  cwd: string,
  task: Task,
  phase: string | null
): { task: string[]; lesson: string[] } {
  const name = getWorkflowName(cwd, task);
  return {
    task: getCompletenessFields(cwd, name, phase, 'task'),
    lesson: getCompletenessFields(cwd, name, phase, 'lesson'),
  };
}

/**
 * Следующий шаг фазы — из ДАННЫХ workflow и `completeness`, а не из имён фаз (VL-410).
 *
 * Зачем: директивы цикла (`appliedRepeatDirective`) раньше
 * знали единственный конкретный шаг — хардкод `phase === 'close'` (VL-368).
 * Для любой другой фазы, включая кастомные (`investigate`, `materialize`,
 * `analyze` из `workflows` в settings), модель получала общую фразу «переходи
 * к следующему пункту» и повторяла вызов дословно до капа
 * `MAX_UNCHANGED_REPEATS_PER_RUN` (сессия agent-1794313856082, фаза spec VL-408).
 *
 * Правило вычисляется из конфигурации:
 * - служебная фаза (`SERVICE_PHASES`) статуса не меняет → отчёт не нужен;
 * - у фазы нет перехода из статуса до фазы (`getStatusAfterPhase === null`) →
 *   отчёт не нужен (фаза не двигает статус);
 * - иначе отчёт обязателен, и если задача неполна по `completeness` — текст
 *   называет КОНКРЕТНЫЕ поля, которые надо передать в том же вызове.
 *
 * `prevStatus` берётся из транзиент-кэша (во время рана задача в In Progress,
 * VL-196) с fallback на текущий статус задачи — как в `auto-report.ts`.
 *
 * Функция читает диск (`getWorkflowForTask`/`getPhaseTransientStatus`), поэтому
 * вызывается ОДИН раз за ран, а не в цикле.
 *
 * @param cwd — каталог проекта (источник workflow/completeness)
 * @param task — задача рана
 * @param phase — фаза рана
 * @returns `required` — обязателен ли `backlog_finish_phase`; `text` — готовый
 *   следующий шаг для директивы; `missing` — неполные поля задачи
 */
export function phaseNextStep(
  cwd: string,
  task: Task,
  phase: string
): { required: boolean; text: string; missing: string[] } {
  if (SERVICE_PHASES.includes(phase)) {
    return {
      required: false,
      text: 'Служебная фаза: отчёт не требуется, заверши работу текстом.',
      missing: [],
    };
  }
  const workflow = getWorkflowForTask(cwd, task);
  const prevStatus = getPhaseTransientStatus(cwd, task.id, phase) ?? task.status;
  if (getStatusAfterPhase(workflow, prevStatus, phase) === null) {
    return {
      required: false,
      text: 'Фаза не двигает статус задачи: заверши работу текстом.',
      missing: [],
    };
  }
  const rules = getCompletenessRules(cwd, task, phase);
  const missing = taskCompletenessMissing(task, rules.task).map((m) => m.field);
  // VL-410: пустой чеклист в `taskCompletenessMissing` считается полным (это
  // верно для гейта терминальности: отмечать нечего). Но для СЛЕДУЮЩЕГО ШАГА
  // фазы, которая объявляет AC обязательными (spec), пустой список — это
  // «критериев ещё нет»: именно так выглядела задача VL-408, и директива
  // молчала о поле. Поэтому здесь пустой чеклист из правил фазы считается
  // неполнотой — локально, не меняя семантику гейта.
  const record = task as unknown as Record<string, unknown>;
  for (const field of rules.task) {
    if (!CHECKLIST_FIELDS.includes(field) || missing.includes(field)) continue;
    const list = (record[field] as unknown[] | undefined) ?? [];
    if (list.length === 0) missing.push(field);
  }
  const base = `Фаза ${phase} не завершена — вызови backlog_finish_phase.`;
  return {
    required: true,
    text:
      missing.length > 0
        ? `${base} Сначала передай в этом же вызове: ${missing.join(', ')}.`
        : base,
    missing,
  };
}

/**
 * Фазы, доступные из текущего статуса (для кнопок бота/веба).
 *
 * Порядок — как в transitions (первый переход ветки — первичное действие).
 * Финальные статусы (phase null) и неизвестные статусы → [].
 *
 * @returns имена фаз (без reject-исключений — reject тоже обычная фаза ветки)
 */
export function getAvailablePhases(workflow: Workflow, currentStatus: string): string[] {
  return workflow.transitions
    .filter((t) => t.status === currentStatus && t.phase !== null)
    .map((t) => t.phase as string);
}

/**
 * Следующая фаза для кнопки «следующий этап»: первая не-reject ветка
 * (reject — запасной/опасный путь, его рендерит отдельная кнопка),
 * если из статуса только reject — он и есть следующий; фаз нет → null.
 *
 * @param currentStatus — текущий статус задачи
 */
export function getNextPhase(workflow: Workflow, currentStatus: string): string | null {
  const phases = getAvailablePhases(workflow, currentStatus);
  return phases.find((p) => p !== 'reject') ?? phases[0] ?? null;
}

/**
 * Статус задачи после успешного завершения фазы из текущего статуса
 * (подстановка {{producesStatus}} в промпт фазы — шаблоны без хардкода).
 *
 * @returns produces_status перехода; переход не найден → null
 *   (вызывающий обязан сначала проверить isPhaseAllowed)
 */
export function getStatusAfterPhase(
  workflow: Workflow,
  currentStatus: string,
  phase: string
): string | null {
  const t = workflow.transitions.find((x) => x.status === currentStatus && x.phase === phase);
  return t ? t.produces_status : null;
}

/**
 * Проверяет, вправе ли фаза перевести задачу из currentStatus в requestedStatus
 * (VL-245). Возвращает текст ошибки для сводки MCP-инструмента либо null.
 *
 * Зачем отдельная функция: `isPhaseAllowed`/`getStatusAfterPhase` описывают
 * инварианты workflow, но проверить их можно было только в оркестраторе —
 * сама запись статуса идёт через `backlog_finish_phase`, и фаза `comment`
 * (служебная, статус не меняет) выставила Done у VL-219 (инцидент VL-231).
 * Функция — единая точка правды для границы MCP: её вызывает только
 * `toolFinishPhase`, а веб/CLI-пути ручных переносов валидируются `canMoveTo`.
 *
 * Семантика:
 * - служебная фаза (SERVICE_PHASES) не двигает статус вообще: для неё любая
 *   смена статуса — запрет (ручные пути идут мимо MCP, флага-исключения в
 *   схеме инструмента нет — агент не должен выписывать себе разрешение);
 * - иначе запрошенный статус обязан совпадать с `produces_status` перехода
 *   «currentStatus + phase» (ветвление и fix-циклы — обычные переходы);
 * - переход не найден (фаза недопустима из статуса, фаза не двигает статус,
 *   `produces_status: null`) → запрет.
 *
 * @param workflow — workflow задачи (`getWorkflowForTask`)
 * @param currentStatus — статус, ИЗ которого фаза считается запущенной
 *   (в транзиенте — статус до фазы, см. `getPhaseTransientStatus`)
 * @param phase — фаза вызывающего (env/мета сессии, не аргумент инструмента)
 * @param requestedStatus — статус, который фаза пытается записать
 * @returns null, если переход допустим; иначе — текст ошибки на русском
 */
export function phaseStatusTransitionError(
  workflow: Workflow,
  currentStatus: string,
  phase: string,
  requestedStatus: string
): string | null {
  if (SERVICE_PHASES.includes(phase)) {
    return (
      `Фаза «${phase}» — служебная и не меняет статус задачи: переход «${currentStatus}» → «${requestedStatus}» запрещён. ` +
      'Статус меняют только workflow-фазы (spec/plan/code/do/close/reject/investigate/materialize); ' +
      'ручной перевод выполняют CLI (`vibelog task edit --status`) или веб-API (PATCH /api/tasks/:id). ' +
      `Не повторяй этот вызов со status: заверши фазу без поля status.`
    );
  }
  const produces = getStatusAfterPhase(workflow, currentStatus, phase);
  if (produces === requestedStatus) return null;
  const available = getAvailablePhases(workflow, currentStatus);
  return (
    `Фаза «${phase}» из статуса «${currentStatus}» не даёт переход в «${requestedStatus}»` +
    (produces !== null
      ? `: она переводит задачу в «${produces}»`
      : `: перехода «${currentStatus}» + «${phase}» в workflow нет`) +
    (available.length > 0 ? ` (доступные фазы из «${currentStatus}»: ${available.join(', ')})` : '') +
    '. Не повторяй вызов с этим status.'
  );
}

/**
 * Разрешена ли фаза из текущего статуса по workflow.
 *
 * Служебные фазы (comment/prompt/analyze/resume) всегда разрешены —
 * они не участвуют в переходах статуса (комментарий уместен из любого
 * статуса, prompt/analyze вообще не привязаны к задаче).
 */
export function isPhaseAllowed(workflow: Workflow, currentStatus: string, phase: string): boolean {
  if (SERVICE_PHASES.includes(phase)) return true;
  return workflow.transitions.some((t) => t.status === currentStatus && t.phase === phase);
}

/**
 * Разрешён ли ручной перенос статуса (канбан-доска, /move, «Взять в работу»).
 *
 * Правила:
 * 1. Транзит: существует переход из from с produces_status = to
 *    (в т.ч. фазовый перенос «задача переместилась в колонку produced»).
 * 2. Ручной вход: to === initial_status, а from — «до-workflow» статус:
 *    в from нет исходящих транзишенов И from не является produces_status
 *    ни одного перехода (Backlog → To Do: «взять в работу», не фаза).
 *    Второе условие закрывает финалы: Done/Rejected тоже без исходящих,
 *    но они достижимы переходами — из них ручной вход запрещён.
 * 3. Нет смены: from === to (повторный бросок в ту же колонку).
 */
export function canMoveTo(workflow: Workflow, from: string, to: string): boolean {
  if (from === to) return true;
  if (workflow.transitions.some((t) => t.status === from && t.produces_status === to)) return true;
  const hasOutgoing = workflow.transitions.some((t) => t.status === from && t.phase !== null);
  if (hasOutgoing) return false;
  const isWorkflowStatus = workflow.transitions.some((t) => t.produces_status === from);
  return !isWorkflowStatus && to === workflow.initial_status;
}

/**
 * Терминальный ли статус — конец жизненного цикла задачи.
 *
 * Признаки (статусы берутся из конфига, хардкод имён недопустим — lesson-32):
 * 1. из статуса нет исходящих фаз (phase !== null);
 * 2. и при этом он либо объявлен финальным маркером (запись с phase: null,
 *    как Done/Rejected в DEFAULT_WORKFLOW), либо достижим как produces_status
 *    другого перехода, либо является initial_status.
 *
 * Статус, которого в workflow нет вовсе (Backlog до ручного входа), и
 * промежуточный статус без исходящих фаз в кастомном workflow терминальными
 * НЕ считаются: задача в них не закрыта.
 *
 * Нужно backlog_finish_phase (VL-248): закрывать задачу (ставить терминальный
 * статус) при невыполненных пунктах DoD допустимо только с явным dodOverride —
 * иначе Done ставился при красном прогоне (инциденты VL-212/VL-219).
 *
 * @param status — проверяемый статус
 */
export function isTerminalStatus(workflow: Workflow, status: string): boolean {
  const hasOutgoing = workflow.transitions.some((t) => t.status === status && t.phase !== null);
  if (hasOutgoing) return false;
  const isFinalMarker = workflow.transitions.some((t) => t.status === status && t.phase === null);
  const isProduced = workflow.transitions.some((t) => t.produces_status === status);
  return isFinalMarker || isProduced || status === workflow.initial_status;
}

/** Итог гейта терминальности: блокировать смену статуса и почему. */
export interface TerminalStatusGateResult {
  /** true — терминальный статус при неотмеченных пунктах ставить нельзя. */
  blocked: boolean;
  /** Готовый текст причины (для отчёта/комментария) — только при blocked. */
  reason?: string;
}

/**
 * Один недостающий пункт неполноты сущности (VL-370).
 *
 * `numbers` заполняется только для полей-чеклистов (AC/DoD): гейту
 * терминальности нужны номера неотмеченных пунктов, и это единственное
 * место, где код знает про эти два поля как про чеклисты.
 */
export interface CompletenessField {
  /** Имя поля сущности (не аргумента вызова). */
  field: string;
  /** Человекочитаемая причина для ответа инструмента. */
  reason: string;
  /** Номера неотмеченных пунктов чеклиста (с 1) — только для AC/DoD. */
  numbers?: number[];
}

/** Поля-чеклисты: неполнота означает «не все пункты отмечены». */
const CHECKLIST_FIELDS: readonly string[] = ['acceptanceCriteria', 'definitionOfDone'];

/** Значение поля пусто: нет значения, пустая строка/пробелы, пустой массив. */
function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Пункт чеклиста отмечен (Backlog.md совместим: строка — не отмечен). */
function isCheckedItem(item: string | { checked?: boolean }): boolean {
  return typeof item === 'string' ? false : item.checked === true;
}

/** Человекочитаемые названия полей задачи для причины неполноты. */
const FIELD_LABELS: Record<string, string> = {
  description: 'описание задачи не заполнено',
  implementationPlan: 'план реализации не заполнен',
  acceptanceCriteria: 'не все критерии приёмки отмечены',
  definitionOfDone: 'не все пункты DoD отмечены',
  title: 'заголовок задачи пуст',
  labels: 'метки не заданы',
  priority: 'приоритет не задан',
};

/**
 * Неполнота задачи ОТ СОСТОЯНИЯ по набору полей (VL-370).
 *
 * Единственный источник `missing` для инструмента и для гейта терминальности
 * (AC4): раньше список полей угадывался по аргументам вызова, а правило
 * «нельзя закрыть задачу с неотмеченными пунктами» существовало в двух копиях
 * (`auto-report.ts` и `phase-transient.ts`) и расходилось.
 *
 * Пустой чеклист считается ПОЛНЫМ: отмечать нечего, требовать нечего.
 *
 * @param task — задача (состояние после записи)
 * @param fields — имена полей из getCompletenessRules
 * @returns недостающие поля с причинами; пустой массив — задача полная
 */
export function taskCompletenessMissing(task: Task, fields: string[]): CompletenessField[] {
  const missing: CompletenessField[] = [];
  const record = task as unknown as Record<string, unknown>;
  for (const field of fields) {
    if (CHECKLIST_FIELDS.includes(field)) {
      const list = (record[field] as Array<string | { checked?: boolean }> | undefined) ?? [];
      const numbers = list
        .map((item, i) => ({ n: i + 1, checked: isCheckedItem(item) }))
        .filter((x) => !x.checked)
        .map((x) => x.n);
      if (numbers.length > 0) {
        missing.push({
          field,
          reason: `${FIELD_LABELS[field] ?? `поле ${field} не заполнено`} (${numbers.map((n) => `#${n}`).join(', ')})`,
          numbers,
        });
      }
      continue;
    }
    if (isEmptyFieldValue(record[field])) {
      missing.push({ field, reason: FIELD_LABELS[field] ?? `поле ${field} не заполнено` });
    }
  }
  return missing;
}

/**
 * Гейт терминальности на общем расчёте неполноты (VL-370).
 *
 * Оба пути смены статуса (`writeAutoReportIfMissing` в агенте и
 * `finalizePhaseStatus` в ядре) зовут ЭТУ функцию — второй копии правила нет
 * (lesson-250). Внутри — приватная `terminalStatusGateCore` (VL-378), поэтому
 * текст причины остаётся байт-в-байт прежним.
 *
 * Для простого workflow набор полей не содержит AC/DoD → блокировать нечего:
 * это следствие правила из данных, а не исключение из кода.
 *
 * @param cwd — каталог проекта (источник workflow и правил неполноты)
 * @param task — задача
 * @param targetStatus — статус, который собирались поставить
 * @param phase — фаза, завершающаяся сейчас (null — неизвестна)
 * @param prevStatus — статус, в котором задача останется при блокировке
 */
export function terminalStatusGateForTask(
  cwd: string,
  task: Task,
  targetStatus: string,
  phase: string | null,
  prevStatus: string
): TerminalStatusGateResult {
  const workflow = getWorkflowForTask(cwd, task);
  const rules = getCompletenessRules(cwd, task, phase);
  const missing = taskCompletenessMissing(task, rules.task);
  const numbers = (field: string): number[] =>
    missing.filter((m) => m.field === field).flatMap((m) => m.numbers ?? []);
  // VL-378: единственный публичный вход — эта функция; низкоуровневая сборка
  // текста (`terminalStatusGateCore`) не экспортируется.
  return terminalStatusGateCore(
    workflow,
    targetStatus,
    numbers('acceptanceCriteria'),
    numbers('definitionOfDone'),
    prevStatus,
  );
}

/**
 * Низкоуровневая сборка решения и текста гейта терминальности (VL-309,
 * вынесена в общую функцию в VL-368).
 *
 * Зачем одна функция: правило VL-248 («Done при невыполненном DoD — только
 * через backlog_finish_phase с dodOverride/aborted») проверялось в ДВУХ местах
 * по-разному. Авто-отчёт пост-рана (`src/agent/auto-report.ts`) гейт имел, а
 * `finalizePhaseStatus` (`src/core/phase-transient.ts`) — нет: если авто-отчёт
 * не записался (ран упал, отчёт уже был, служебная фаза), задача получала Done
 * с висящими AC/DoD. Две копии правила неизбежно разъезжаются, поэтому текст
 * причины собирается здесь, а вызывающие только применяют решение.
 *
 * VL-378: функция ВНУТРЕННЯЯ, без экспорта. Единственный публичный вход в
 * правило терминальности — `terminalStatusGateForTask`, который сам считает
 * неполноту из `CompletenessMap` с учётом workflow задачи и фазы. Прямой вызов
 * низкоуровневой версии обошёл бы расчёт неполноты (правило
 * `DEFAULT_COMPLETENESS.default.spec → description` и любое кастомное) и не
 * учёл бы workflow («в simple у задачи нет AC/DoD — блокировать нечего») —
 * ровно дефект VL-368/VL-370, где два пути считали неотмеченные пункты сами.
 *
 * @param workflow — workflow задачи (источник терминальности)
 * @param targetStatus — статус, который собирались поставить
 * @param uncheckedAc — номера неотмеченных AC (с 1)
 * @param uncheckedDod — номера неотмеченных DoD (с 1)
 * @param prevStatus — статус, в котором задача останется при блокировке
 */
function terminalStatusGateCore(
  workflow: Workflow,
  targetStatus: string,
  uncheckedAc: number[],
  uncheckedDod: number[],
  prevStatus: string
): TerminalStatusGateResult {
  const hasUnchecked = uncheckedAc.length > 0 || uncheckedDod.length > 0;
  if (!hasUnchecked || !isTerminalStatus(workflow, targetStatus)) return { blocked: false };
  const parts: string[] = [];
  if (uncheckedDod.length > 0) parts.push(`DoD: ${uncheckedDod.map((n) => `#${n}`).join(', ')}`);
  if (uncheckedAc.length > 0) parts.push(`AC: ${uncheckedAc.map((n) => `#${n}`).join(', ')}`);
  return {
    blocked: true,
    reason:
      `Статус не изменён: терминальный «${targetStatus}» при неотмеченных пунктах (${parts.join('; ')}) ` +
      'возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). ' +
      `Задача оставлена в «${prevStatus}».`,
  };
}
