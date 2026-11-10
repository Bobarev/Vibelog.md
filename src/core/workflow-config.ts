/**
 * Конструктор workflow: описание, валидация и применение конфигурации (VL-398).
 *
 * Зачем отдельный модуль, а не расширение `workflow.ts`: там 900+ строк и
 * «единственный источник истины» для ИСПОЛНЕНИЯ (кнопки фаз, isPhaseAllowed,
 * оркестратор). Конфигуратор — отдельный домен: он читает ту же схему, но
 * ничего не исполняет, и его правки не должны раздувать модуль исполнения
 * (тот же приём, что у `src/mcp/supervisor.ts`).
 *
 * Три операции, общие для CLI (`vibelog workflow`) и MCP (`workflow_get` /
 * `workflow_apply`):
 * - `describeWorkflow` — эффективная схема + источник (дефолт в коде или
 *   settings.json). Источник определяется сравнением по ссылке: `loadWorkflows`
 *   кладёт именно `DEFAULT_WORKFLOW`, когда ключа нет (src/core/workflow.ts:448);
 * - `validateWorkflowConfig` — диагностика переходов. Проверки неполноты и
 *   висячих ссылок `task_workflows` НЕ дублируются: они уже есть в
 *   `validateCompleteness` (src/core/workflow.ts:239) и переиспользуются —
 *   требование AC2/D «doctor и workflow validate используют одни проверки»;
 * - `applyWorkflowConfig` — запись секций `workflows` / `task_workflows` /
 *   `completeness` в `.vibelog/settings.json` с валидацией ДО записи.
 *
 * Безопасность записи (AC5): `loadSettings` при битом JSON возвращает `{}`
 * (src/core/settings.ts:50-66), поэтому `saveSettingsPatch` затёр бы файл
 * пользователя. Здесь файл читается отдельно и явно: нечитаемый JSON —
 * отказ, а не «пустые настройки».
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  DEFAULT_WORKFLOW,
  loadCompleteness,
  loadWorkflows,
  isValidWorkflow,
  validateCompleteness,
} from './workflow.js';
import type { CompletenessMap, CompletenessWarning, Transition, Workflow } from './workflow.js';
import { loadConfig, saveConfig } from './config.js';
import { loadSettings, saveSettingsPatch, settingsPath } from './settings.js';
import { parseYaml } from './yaml.js';
import { PHASES, loadPhaseTemplate } from '../web/phase-prompt.js';

/** Ключи settings.json, которыми управляет конструктор. */
export const WORKFLOW_KEYS = ['workflows', 'task_workflows', 'completeness'] as const;

/** Откуда взят действующий workflow. */
export type WorkflowSource = 'default-in-code' | 'settings';

/** Эффективная конфигурация workflow проекта. */
export interface WorkflowDescription {
  /** Имя действующего workflow (всегда `default` — его берут задачи без своего). */
  name: string;
  /** `default-in-code` — работает DEFAULT_WORKFLOW; `settings` — переопределён. */
  source: WorkflowSource;
  /** Пояснение источника для человека. */
  note: string;
  initial_status: string;
  transitions: Transition[];
  /** Тип задачи → имя workflow. */
  task_workflows: Record<string, string>;
  /** Объявленные имена workflow (включая `default`). */
  workflows: string[];
  /** Карта неполноты (дефолт + переопределения). */
  completeness: CompletenessMap;
  /** Статусы из backlog/config.yml; пустой массив — конфиг недоступен. */
  statuses: string[];
}

/** Находка валидации: что не так и насколько это критично. */
export interface WorkflowFinding {
  /** Группа проверки: статусы, достижимость, фазы, ссылки, неполнота. */
  kind: 'status' | 'unreachable' | 'phase' | 'task_workflow' | 'completeness';
  /** Путь в конфигурации: `workflows.default.transitions[3].phase`. */
  path: string;
  /** Готовый текст для пользователя. */
  message: string;
  /** `error` — конфигурация нерабочая (apply отказывает), `warning` — шум/подсказка. */
  severity: 'error' | 'warning';
}

/** Поле патча, которое не применено, и причина. */
export interface SkippedKey {
  field: string;
  reason: string;
}

/** Результат `applyWorkflowConfig`. */
export interface ApplyResult {
  ok: boolean;
  /** Патч совпал с текущим содержимым — файл не тронут. */
  noop?: boolean;
  /** Прогон без записи (`--dry-run`). */
  dryRun?: boolean;
  /** Что записано (или было бы записано при dryRun). */
  applied?: Record<string, unknown>;
  /** Переданные, но не применённые ключи. */
  skipped?: SkippedKey[];
  /** Предупреждения валидации (не блокируют запись). */
  warnings?: WorkflowFinding[];
  /** Причины отказа: при непустом списке файл НЕ изменён. */
  errors?: string[];
  /** Статусы, дописанные в backlog/config.yml (`--sync-statuses`). */
  statusesAdded?: string[];
}

/** Статусы из backlog/config.yml; недоступный конфиг — пустой список. */
function readStatuses(cwd: string): string[] {
  try {
    const raw = loadConfig(cwd).statuses;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    // Нет backlog/ или битый config.yml — статусы неизвестны, проверка
    // «статус вне config.statuses» просто не выполняется (не ложная тревога).
    return [];
  }
}

/**
 * Эффективный workflow проекта и его источник.
 *
 * @param cwd — корень проекта (.vibelog/settings.json, backlog/config.yml)
 */
export function describeWorkflow(cwd: string): WorkflowDescription {
  const config = loadWorkflows(cwd);
  const workflow: Workflow = config.workflows.default ?? DEFAULT_WORKFLOW;
  const fromSettings = workflow !== DEFAULT_WORKFLOW;
  return {
    name: 'default',
    source: fromSettings ? 'settings' : 'default-in-code',
    note: fromSettings
      ? 'Источник: ключ `workflows` в `.vibelog/settings.json` (переопределяет DEFAULT_WORKFLOW).'
      : 'Источник: ДЕФОЛТ В КОДЕ — `DEFAULT_WORKFLOW` (src/core/workflow.ts). Ключа `workflows` в `.vibelog/settings.json` нет; это нормально.',
    initial_status: workflow.initial_status,
    transitions: workflow.transitions,
    task_workflows: config.task_workflows,
    workflows: Object.keys(config.workflows),
    completeness: loadCompleteness(cwd),
    statuses: readStatuses(cwd),
  };
}

/** Все статусы, упомянутые в переходах workflow (источники и результаты). */
function statusesOf(workflow: Workflow): string[] {
  const out: string[] = [workflow.initial_status];
  for (const t of workflow.transitions) {
    if (!out.includes(t.status)) out.push(t.status);
    if (t.produces_status !== null && !out.includes(t.produces_status)) out.push(t.produces_status);
  }
  return out;
}

/**
 * Диагностика конфигурации workflow.
 *
 * Проверки:
 * - `status` — статус перехода/стартовый статус отсутствует в
 *   `backlog/config.yml statuses` (warning: подсказка про `--sync-statuses`);
 * - `unreachable` — статус есть только как источник перехода и не является
 *   ни стартовым, ни результатом ни одного перехода (warning);
 * - `phase` — фаза вне `PHASES` или без шаблона в `templates/phases` /
 *   `.vibelog/prompts/phases` (error: фаза не запустится);
 * - `task_workflow` / `completeness` — из `validateCompleteness`
 *   (src/core/workflow.ts:239), маппинг без дублирования логики (warning).
 *
 * @param cwd — корень проекта
 * @param settingsOverride — проверяемые настройки вместо файла (валидация
 *   патча ДО записи); при передаче файл не читается
 */
export function validateWorkflowConfig(
  cwd: string,
  settingsOverride?: Record<string, unknown>
): WorkflowFinding[] {
  const config = loadWorkflows(cwd, settingsOverride);
  const statuses = readStatuses(cwd);
  const findings: WorkflowFinding[] = [];

  for (const [name, workflow] of Object.entries(config.workflows)) {
    const prefix = `workflows.${name}`;

    // ── статусы вне config.statuses ──
    if (statuses.length > 0) {
      for (const status of statusesOf(workflow)) {
        if (statuses.includes(status)) continue;
        findings.push({
          kind: 'status',
          path: `${prefix}.transitions`,
          message:
            `статус «${status}» отсутствует в statuses backlog/config.yml — ` +
            'задача не сможет в него перейти; дополните список ' +
            '(`vibelog workflow apply --sync-statuses` или `vibelog config set statuses ...`)',
          severity: 'warning',
        });
      }
    }

    // ── недостижимые статусы ──
    // Статус, объявленный в config.statuses, недостижимым не считается: в него
    // задачу переводят вручную (например `In Progress` в DEFAULT_WORKFLOW —
    // «взяли в работу» без фазы). Иначе дефолтный workflow давал бы ложный шум.
    const produced = new Set<string>([workflow.initial_status]);
    for (const t of workflow.transitions) {
      if (t.produces_status !== null) produced.add(t.produces_status);
    }
    const seen = new Set<string>();
    for (const t of workflow.transitions) {
      if (produced.has(t.status) || seen.has(t.status)) continue;
      seen.add(t.status);
      if (statuses.includes(t.status)) continue;
      findings.push({
        kind: 'unreachable',
        path: `${prefix}.transitions`,
        message:
          `статус «${t.status}» недостижим: он не стартовый и не производится ` +
          'ни одним переходом — фазы из него не запустятся',
        severity: 'warning',
      });
    }

    // ── фазы: известность и наличие шаблона ──
    for (let i = 0; i < workflow.transitions.length; i += 1) {
      const phase = workflow.transitions[i].phase;
      if (phase === null) continue;
      const path = `${prefix}.transitions[${i}].phase`;
      if (!(PHASES as readonly string[]).includes(phase)) {
        findings.push({
          kind: 'phase',
          path,
          message: `фаза «${phase}» неизвестна (допустимы: ${PHASES.join(', ')})`,
          severity: 'error',
        });
        continue;
      }
      try {
        loadPhaseTemplate(phase, { cwd });
      } catch (err) {
        findings.push({
          kind: 'phase',
          path,
          message: `у фазы «${phase}» нет шаблона промпта: ${(err as Error).message}`,
          severity: 'error',
        });
      }
    }
  }

  // ── task_workflows и completeness: переиспользуем готовый валидатор ──
  for (const warning of validateCompleteness(cwd, settingsOverride)) {
    findings.push(mapCompletenessWarning(warning));
  }

  return findings;
}

/** Маппинг предупреждения неполноты в находку конструктора (без потери текста). */
function mapCompletenessWarning(warning: CompletenessWarning): WorkflowFinding {
  return {
    kind: warning.kind === 'task_workflow' ? 'task_workflow' : 'completeness',
    path: warning.path,
    message: warning.message,
    severity: 'warning',
  };
}

/** Канонический JSON (ключи отсортированы) — сравнение «то же содержимое». */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/**
 * Читает settings.json для записи, отличая «файла нет» от «файл битый».
 *
 * @returns объект настроек либо текст ошибки (файл существует, но не читается)
 */
function readSettingsForWrite(cwd: string): { settings: Record<string, unknown> } | { error: string } {
  const path = settingsPath(cwd);
  if (!existsSync(path)) return { settings: {} };
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    return { error: `не удалось прочитать ${path}: ${(err as Error).message}` };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${path}: ожидается JSON-объект — запись отменена, файл не изменён` };
    }
    return { settings: parsed as Record<string, unknown> };
  } catch (err) {
    return {
      error:
        `${path}: битый JSON (${(err as Error).message}) — запись отменена, ` +
        'файл не изменён. Исправьте файл вручную и повторите',
    };
  }
}

/**
 * Применяет фрагмент конфигурации workflow к `.vibelog/settings.json`.
 *
 * Порядок (важен для AC5 «битый вход не пишет ничего»):
 * 1. отбор известных ключей (`workflows`/`task_workflows`/`completeness`),
 *    остальные — в `skipped`;
 * 2. безопасное чтение текущего файла (битый JSON → отказ);
 * 3. валидация СЛИТОЙ конфигурации (`validateWorkflowConfig` с override):
 *    любая находка `severity: 'error'` → отказ, файл не тронут;
 * 4. noop: патч совпадает с текущим содержимым → файл не тронут;
 * 5. `--dry-run` → вернуть, что было бы записано;
 * 6. `--sync-statuses` → дописать недостающие статусы в backlog/config.yml;
 * 7. запись через `saveSettingsPatch` (read-modify-write: чужие ключи целы).
 *
 * @param cwd — корень проекта
 * @param patch — фрагмент с ключами workflows/task_workflows/completeness
 * @param opts — dryRun (не писать), syncStatuses (дополнить config.statuses)
 */
export function applyWorkflowConfig(
  cwd: string,
  patch: Record<string, unknown>,
  opts: { dryRun?: boolean; syncStatuses?: boolean } = {}
): ApplyResult {
  const skipped: SkippedKey[] = [];
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((WORKFLOW_KEYS as readonly string[]).includes(key)) clean[key] = value;
    else skipped.push({ field: key, reason: 'не относится к workflow (допустимы workflows, task_workflows, completeness)' });
  }
  if (Object.keys(clean).length === 0) {
    return {
      ok: false,
      errors: ['во входных данных нет ни одного ключа workflow (workflows, task_workflows, completeness)'],
      ...(skipped.length > 0 ? { skipped } : {}),
    };
  }

  // Форма каждого workflow проверяется до слияния: битая запись иначе молча
  // выпала бы в fallback (loadWorkflows отбрасывает невалидные записи).
  const rawWorkflows = clean.workflows;
  if (rawWorkflows !== undefined) {
    if (rawWorkflows === null || typeof rawWorkflows !== 'object' || Array.isArray(rawWorkflows)) {
      return { ok: false, errors: ['workflows: ожидается объект «имя → workflow»'] };
    }
    for (const [name, value] of Object.entries(rawWorkflows as Record<string, unknown>)) {
      if (!isValidWorkflow(value)) {
        return {
          ok: false,
          errors: [
            `workflows.${name}: невалидный workflow — нужны непустой initial_status ` +
            'и массив transitions вида {status, phase, produces_status}',
          ],
        };
      }
    }
  }

  const read = readSettingsForWrite(cwd);
  if ('error' in read) return { ok: false, errors: [read.error] };

  const merged = { ...read.settings, ...clean };
  const findings = validateWorkflowConfig(cwd, merged);
  const errors = findings.filter((f) => f.severity === 'error').map((f) => `${f.path}: ${f.message}`);
  const warnings = findings.filter((f) => f.severity === 'warning');
  if (errors.length > 0) {
    return { ok: false, errors, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  const noop = Object.entries(clean).every(
    ([key, value]) => canonical(read.settings[key]) === canonical(value)
  );
  if (noop) {
    return {
      ok: true,
      noop: true,
      applied: clean,
      ...(skipped.length > 0 ? { skipped } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      applied: clean,
      ...(skipped.length > 0 ? { skipped } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // Статусы синхронизируются ДО записи settings: если config.yml не пишется,
  // лучше отказать целиком, чем оставить workflow со статусами-призраками.
  let statusesAdded: string[] = [];
  if (opts.syncStatuses) {
    const current = readStatuses(cwd);
    const wanted: string[] = [];
    for (const value of Object.values(merged.workflows ?? {})) {
      if (!isValidWorkflow(value)) continue;
      for (const status of statusesOf(value)) {
        if (!current.includes(status) && !wanted.includes(status)) wanted.push(status);
      }
    }
    if (wanted.length > 0) {
      try {
        const config = loadConfig(cwd);
        saveConfig(cwd, { ...config, statuses: [...current, ...wanted] });
        statusesAdded = wanted;
      } catch (err) {
        return {
          ok: false,
          errors: [`не удалось дополнить statuses в backlog/config.yml: ${(err as Error).message}`],
        };
      }
    }
  }

  saveSettingsPatch(cwd, clean);
  return {
    ok: true,
    applied: clean,
    ...(statusesAdded.length > 0 ? { statusesAdded } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Разбирает вход `workflow apply`: JSON или YAML.
 *
 * Эвристика простая и предсказуемая: первый непробельный символ `{` — JSON
 * (так выглядит и вывод `workflow show --json`), иначе YAML (человеческий
 * формат из документации). Ошибка разбора возвращается текстом, а не
 * исключением: CLI печатает её и выходит с кодом 1.
 *
 * @param text — содержимое файла или stdin
 */
export function parseWorkflowInput(text: string): { patch: Record<string, unknown> } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { error: 'пустой ввод: ожидается JSON или YAML с ключами workflows/task_workflows/completeness' };
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'JSON: ожидается объект верхнего уровня' };
      }
      return { patch: parsed as Record<string, unknown> };
    } catch (err) {
      return { error: `JSON не разобран: ${(err as Error).message}` };
    }
  }
  try {
    const parsed = parseYaml(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'YAML: ожидается объект верхнего уровня' };
    }
    return { patch: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: `YAML не разобран: ${(err as Error).message}` };
  }
}
