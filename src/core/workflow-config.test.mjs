/**
 * Тесты конструктора workflow (VL-398): describeWorkflow / validateWorkflowConfig /
 * applyWorkflowConfig / parseWorkflowInput.
 *
 * Каталог — mkdtemp (AGENTS.md: фиксированные пути запрещены). Проверяем
 * главное для AC4/AC5: валидация ДО записи, noop при повторе, отказ при битом
 * входе и при нечитаемом settings.json (файл не затирается), --sync-statuses.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyWorkflowConfig,
  describeWorkflow,
  parseWorkflowInput,
  validateWorkflowConfig,
} from '../../dist/core/workflow-config.js';
import { DEFAULT_WORKFLOW, getAvailablePhases, getWorkflowForTask } from '../../dist/core/workflow.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const root = mkdtempSync(join(tmpdir(), 'vibelog-workflow-config-'));
let cwd;

/** Минимальный проект: backlog/config.yml со статусами и пустой .vibelog/. */
function seedProject(name, statuses = ['To Do', 'Spec', 'In Progress', 'Done']) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(join(dir, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'WF Test',
    task_prefix: 'WF',
    default_status: 'To Do',
    statuses,
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
  return dir;
}

/** Простой workflow: To Do --spec--> Spec --code--> In Progress --close--> Done. */
const SIMPLE_WORKFLOW = {
  initial_status: 'To Do',
  transitions: [
    { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
    { status: 'Spec', phase: 'code', produces_status: 'In Progress' },
    { status: 'In Progress', phase: 'close', produces_status: 'Done' },
    { status: 'Done', phase: null, produces_status: null },
  ],
};

beforeEach(() => {
  cwd = seedProject(`p-${Math.random().toString(36).slice(2)}`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('VL-398 — describeWorkflow', () => {
  it('без секции workflows: источник default-in-code и DEFAULT_WORKFLOW', () => {
    const data = describeWorkflow(cwd);
    assert.equal(data.source, 'default-in-code');
    assert.deepEqual(data.transitions, DEFAULT_WORKFLOW.transitions);
    assert.equal(data.initial_status, 'To Do');
    assert.deepEqual(data.statuses, ['To Do', 'Spec', 'In Progress', 'Done']);
    assert.match(data.note, /ДЕФОЛТ В КОДЕ/);
  });

  it('с секцией workflows: источник settings и переходы из файла', () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: { default: SIMPLE_WORKFLOW },
      task_workflows: { chore: 'default' },
    }), 'utf-8');
    const data = describeWorkflow(cwd);
    assert.equal(data.source, 'settings');
    assert.deepEqual(data.transitions, SIMPLE_WORKFLOW.transitions);
    assert.deepEqual(data.task_workflows, { chore: 'default' });
    assert.match(data.note, /settings\.json/);
  });

  it('без backlog/config.yml не падает: статусы пустые', () => {
    const empty = join(root, 'empty-project');
    mkdirSync(empty, { recursive: true });
    const data = describeWorkflow(empty);
    assert.deepEqual(data.statuses, []);
    assert.equal(data.source, 'default-in-code');
  });
});

describe('VL-398 — validateWorkflowConfig', () => {
  it('согласованная конфигурация → находок нет', () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: { default: SIMPLE_WORKFLOW },
    }), 'utf-8');
    assert.deepEqual(validateWorkflowConfig(cwd), []);
  });

  it('статус вне config.statuses → warning с подсказкой --sync-statuses', () => {
    const findings = validateWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Review' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    });
    const status = findings.filter((f) => f.kind === 'status');
    assert.ok(status.length > 0, 'статус Review отсутствует в config.statuses');
    assert.ok(status.every((f) => f.severity === 'warning'));
    assert.match(status[0].message, /sync-statuses/);
  });

  it('недостижимый статус → warning (статус вне config.statuses)', () => {
    const findings = validateWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Done' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    });
    const unreachable = findings.filter((f) => f.kind === 'unreachable');
    assert.equal(unreachable.length, 1);
    assert.match(unreachable[0].message, /Review/);
  });

  it('статус из config.statuses недостижимым не считается (ручной перевод)', () => {
    // In Progress есть в config.statuses, но не производится переходами —
    // это нормально: задачу берут в работу вручную.
    const findings = validateWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Done' },
            { status: 'In Progress', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    });
    assert.deepEqual(findings.filter((f) => f.kind === 'unreachable'), []);
  });

  it('неизвестная фаза → error', () => {
    const findings = validateWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'нетакой', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    });
    const phase = findings.filter((f) => f.kind === 'phase');
    assert.equal(phase.length, 1);
    assert.equal(phase[0].severity, 'error');
  });

  it('висячая ссылка task_workflows → warning (переиспользован validateCompleteness)', () => {
    const findings = validateWorkflowConfig(cwd, {
      workflows: { default: SIMPLE_WORKFLOW },
      task_workflows: { bug: 'bugfix' },
    });
    const dangling = findings.filter((f) => f.kind === 'task_workflow');
    assert.equal(dangling.length, 1);
    assert.match(dangling[0].message, /bugfix/);
  });

  it('ошибка completeness (неизвестное поле) → warning', () => {
    const findings = validateWorkflowConfig(cwd, {
      workflows: { default: SIMPLE_WORKFLOW },
      completeness: { default: { spec: { task: ['нетакогополя'] } } },
    });
    const completeness = findings.filter((f) => f.kind === 'completeness');
    assert.ok(completeness.length > 0);
    assert.ok(completeness.every((f) => f.severity === 'warning'));
  });
});

describe('VL-398 — applyWorkflowConfig', () => {
  it('AC2: записывает workflows и сохраняет остальные ключи settings.json', () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      models: { default: 'm1' },
      chat: { max_iterations: 5 },
    }), 'utf-8');
    const result = applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } });
    assert.equal(result.ok, true);
    const saved = JSON.parse(readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
    assert.deepEqual(saved.workflows.default, SIMPLE_WORKFLOW);
    assert.deepEqual(saved.models, { default: 'm1' }, 'чужие ключи сохранены');
    assert.deepEqual(saved.chat, { max_iterations: 5 });
  });

  it('AC5: повтор того же патча → noop, файл не переписывается', () => {
    applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } });
    const path = join(cwd, '.vibelog', 'settings.json');
    const before = readFileSync(path, 'utf-8');
    const second = applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } });
    assert.equal(second.ok, true);
    assert.equal(second.noop, true);
    assert.equal(readFileSync(path, 'utf-8'), before, 'содержимое файла не изменилось');
  });

  it('AC5: невалидный вход (неизвестная фаза) → отказ, файл не создан', () => {
    const result = applyWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'нетакой', produces_status: 'Done' }],
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok((result.errors ?? []).length > 0);
    assert.equal(existsSync(join(cwd, '.vibelog', 'settings.json')), false, 'файл не создан');
  });

  it('AC5: битая форма workflow → отказ', () => {
    const result = applyWorkflowConfig(cwd, { workflows: { default: { transitions: [] } } });
    assert.equal(result.ok, false);
    assert.match((result.errors ?? []).join(' '), /initial_status/);
  });

  it('AC5: битый settings.json → отказ, файл не затёрт', () => {
    const path = join(cwd, '.vibelog', 'settings.json');
    writeFileSync(path, '{ битый json', 'utf-8');
    const result = applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } });
    assert.equal(result.ok, false);
    assert.match((result.errors ?? []).join(' '), /битый JSON/);
    assert.equal(readFileSync(path, 'utf-8'), '{ битый json', 'файл сохранён как был');
  });

  it('dryRun: ничего не пишет, показывает applied', () => {
    const result = applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } }, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.ok(result.applied);
    assert.equal(existsSync(join(cwd, '.vibelog', 'settings.json')), false);
  });

  it('AC4: syncStatuses дополняет statuses в backlog/config.yml', () => {
    const result = applyWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Review' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    }, { syncStatuses: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.statusesAdded, ['Review']);
    const config = readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8');
    assert.match(config, /Review/);
  });

  it('AC4: без syncStatuses статус не дописывается, но приходит warning', () => {
    const result = applyWorkflowConfig(cwd, {
      workflows: {
        default: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'spec', produces_status: 'Spec' },
            { status: 'Spec', phase: 'code', produces_status: 'Review' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.statusesAdded, undefined);
    assert.ok((result.warnings ?? []).some((w) => w.kind === 'status'));
    const config = readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(!/Review/.test(config), 'config.yml не изменён');
  });

  it('чужие ключи патча попадают в skipped', () => {
    const result = applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW }, models: {} });
    assert.equal(result.ok, true);
    assert.deepEqual((result.skipped ?? []).map((s) => s.field), ['models']);
  });

  it('пустой патч → отказ', () => {
    const result = applyWorkflowConfig(cwd, {});
    assert.equal(result.ok, false);
  });
});

describe('VL-398 — parseWorkflowInput', () => {
  it('JSON-объект разбирается', () => {
    const parsed = parseWorkflowInput('{"workflows": {}}');
    assert.ok('patch' in parsed);
    assert.deepEqual(parsed.patch, { workflows: {} });
  });

  it('YAML разбирается', () => {
    const parsed = parseWorkflowInput('workflows:\n  default:\n    initial_status: To Do\n    transitions: []\n');
    assert.ok('patch' in parsed);
    assert.ok(parsed.patch.workflows);
  });

  it('пустой ввод и битый JSON → ошибка текстом', () => {
    assert.ok('error' in parseWorkflowInput('   '));
    assert.ok('error' in parseWorkflowInput('{ битый'));
  });
});

describe('VL-398 — AC6: применённый workflow управляет фазами', () => {
  it('getAvailablePhases/getWorkflowForTask видят новые переходы', () => {
    applyWorkflowConfig(cwd, { workflows: { default: SIMPLE_WORKFLOW } });
    const task = { id: 'WF-1', type: 'feature', status: 'To Do' };
    const workflow = getWorkflowForTask(cwd, task);
    assert.deepEqual(getAvailablePhases(workflow, 'To Do'), ['spec']);
    assert.deepEqual(getAvailablePhases(workflow, 'Spec'), ['code']);
    assert.deepEqual(getAvailablePhases(workflow, 'In Progress'), ['close']);
    assert.deepEqual(getAvailablePhases(workflow, 'Done'), []);
  });
});
