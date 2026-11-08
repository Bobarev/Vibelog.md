/**
 * Тесты VL-188 — core/workflow.ts: переходы «статус → фаза → статус».
 *
 * Фикстуры — settings.json во временных каталогах (/tmp): default/simple/bugfix,
 * fallback без workflows, битый файл, ветвление, canMoveTo-валидация.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_WORKFLOW,
  DEFAULT_COMPLETENESS,
  SERVICE_PHASES,
  loadWorkflows,
  loadCompleteness,
  getCompletenessRules,
  getCompletenessFields,
  validateCompleteness,
  COMPLETENESS_ENTITIES,
  KNOWN_TASK_FIELDS,
  KNOWN_LESSON_FIELDS,
  taskCompletenessMissing,
  terminalStatusGateForTask,
  getWorkflowName,
  getWorkflowForTask,
  getAvailablePhases,
  getNextPhase,
  getStatusAfterPhase,
  isPhaseAllowed,
  canMoveTo,
  phaseStatusTransitionError,
  isTerminalStatus,
} from '../../dist/core/workflow.js';
import { pickAutoPhase } from '../../dist/bot/auto-runner.js';
import { settingsPath } from '../../dist/core/settings.js';
import { createTask } from '../../dist/core/task.js';

/** Минимальная задача для getWorkflowForTask/getWorkflowName (нужен type). */
const task = (type) => ({ id: 'VL-1', type });

describe('workflow (VL-188)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-workflow-'));

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  /** Каталог проекта с заданным содержимым settings.json. */
  function project(name, settings) {
    const dir = join(testRoot, name);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');
    return dir;
  }

  // ── Fallback ──

  it('нет settings.json → default workflow (spec → plan → code → close)', () => {
    const cfg = loadWorkflows(join(testRoot, 'nonexistent'));
    assert.deepEqual(cfg.workflows.default, DEFAULT_WORKFLOW);
    assert.deepEqual(cfg.task_workflows, {});
  });

  it('битый JSON → fallback на DEFAULT_WORKFLOW', () => {
    const dir = join(testRoot, 'broken');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), '{не json', 'utf-8');
    assert.deepEqual(loadWorkflows(dir).workflows.default, DEFAULT_WORKFLOW);
  });

  it('битая запись default → заменяется DEFAULT_WORKFLOW, валидные именованные остаются', () => {
    const dir = project('partially-broken', {
      workflows: {
        default: { nope: true },
        simple: { initial_status: 'To Do', transitions: [] },
      },
      task_workflows: { chore: 'simple' },
    });
    const cfg = loadWorkflows(dir);
    assert.deepEqual(cfg.workflows.default, DEFAULT_WORKFLOW);
    assert.deepEqual(cfg.workflows.simple, { initial_status: 'To Do', transitions: [] });
    assert.equal(cfg.task_workflows.chore, 'simple');
  });

  // ── Именованные workflow из описания VL-188 ──

  const named = project('named', {
    workflows: {
      default: DEFAULT_WORKFLOW,
      simple: {
        initial_status: 'To Do',
        transitions: [
          { status: 'To Do', phase: 'do', produces_status: 'Review' },
          { status: 'To Do', phase: 'reject', produces_status: 'Rejected' },
          { status: 'Review', phase: 'close', produces_status: 'Done' },
          { status: 'Review', phase: 'do', produces_status: 'Review' },
          { status: 'Review', phase: 'reject', produces_status: 'Rejected' },
          { status: 'Done', phase: null, produces_status: null },
          { status: 'Rejected', phase: null, produces_status: null },
        ],
      },
      bugfix: {
        initial_status: 'To Do',
        transitions: [
          { status: 'To Do', phase: 'plan', produces_status: 'Planned' },
          { status: 'To Do', phase: 'reject', produces_status: 'Rejected' },
          { status: 'Planned', phase: 'code', produces_status: 'Review' },
          { status: 'Review', phase: 'close', produces_status: 'Done' },
          { status: 'Review', phase: 'code', produces_status: 'Review' },
          { status: 'Done', phase: null, produces_status: null },
          { status: 'Rejected', phase: null, produces_status: null },
        ],
      },
    },
    task_workflows: { bug: 'bugfix', feature: 'default', chore: 'simple', docs: 'simple' },
  });

  it('getWorkflowName: task_workflows по типу, неизвестный тип → default', () => {
    assert.equal(getWorkflowName(named, task('bug')), 'bugfix');
    assert.equal(getWorkflowName(named, task('chore')), 'simple');
    assert.equal(getWorkflowName(named, task('feature')), 'default');
    assert.equal(getWorkflowName(named, task('unknown')), 'default');
    assert.equal(getWorkflowName(named, task('')), 'default');
  });

  it('getWorkflowName без settings.json → default', () => {
    assert.equal(getWorkflowName(join(testRoot, 'nonexistent'), task('bug')), 'default');
  });

  it('getWorkflowForTask: имя workflow по типу, неизвестное имя → DEFAULT_WORKFLOW', () => {
    const dir = project('dangling-name', {
      workflows: { default: DEFAULT_WORKFLOW },
      task_workflows: { bug: 'deleted-workflow' },
    });
    assert.deepEqual(getWorkflowForTask(named, task('bug')), loadWorkflows(named).workflows.bugfix);
    assert.deepEqual(getWorkflowForTask(dir, task('bug')), DEFAULT_WORKFLOW);
    assert.deepEqual(getWorkflowForTask(named, task('feature')), DEFAULT_WORKFLOW);
  });

  // ── Ветвление ──

  it('getAvailablePhases: To Do → [spec, reject] (ветвление default)', () => {
    assert.deepEqual(getAvailablePhases(DEFAULT_WORKFLOW, 'To Do'), ['spec', 'reject']);
  });

  it('getAvailablePhases: simple To Do → [do, reject]; финальные статусы → []', () => {
    const simple = loadWorkflows(named).workflows.simple;
    assert.deepEqual(getAvailablePhases(simple, 'To Do'), ['do', 'reject']);
    assert.deepEqual(getAvailablePhases(simple, 'Done'), []);
    assert.deepEqual(getAvailablePhases(DEFAULT_WORKFLOW, 'НеСтатус'), []);
  });

  it('getNextPhase: первая не-reject ветка, только reject → reject, финал → null', () => {
    assert.equal(getNextPhase(DEFAULT_WORKFLOW, 'To Do'), 'spec');
    assert.equal(getNextPhase(DEFAULT_WORKFLOW, 'Spec'), 'plan');
    assert.equal(getNextPhase(DEFAULT_WORKFLOW, 'Review'), 'close');
    const onlyReject = { initial_status: 'To Do', transitions: [{ status: 'X', phase: 'reject', produces_status: 'Rejected' }] };
    assert.equal(getNextPhase(onlyReject, 'X'), 'reject');
    assert.equal(getNextPhase(DEFAULT_WORKFLOW, 'Done'), null);
  });

  it('getStatusAfterPhase: по переходу; неизвестная пара → null', () => {
    assert.equal(getStatusAfterPhase(DEFAULT_WORKFLOW, 'To Do', 'spec'), 'Spec');
    assert.equal(getStatusAfterPhase(DEFAULT_WORKFLOW, 'Review', 'code'), 'Review');
    assert.equal(getStatusAfterPhase(DEFAULT_WORKFLOW, 'Done', 'close'), null);
    assert.equal(getStatusAfterPhase(DEFAULT_WORKFLOW, 'To Do', 'plan'), null);
  });

  // ── isPhaseAllowed ──

  it('isPhaseAllowed: workflow-фазы только по переходам', () => {
    assert.equal(isPhaseAllowed(DEFAULT_WORKFLOW, 'To Do', 'spec'), true);
    assert.equal(isPhaseAllowed(DEFAULT_WORKFLOW, 'To Do', 'plan'), false);
    assert.equal(isPhaseAllowed(DEFAULT_WORKFLOW, 'Spec', 'plan'), true);
    assert.equal(isPhaseAllowed(DEFAULT_WORKFLOW, 'To Do', 'do'), false);
  });

  it('isPhaseAllowed: простые workflow — do без spec/plan, bugfix — plan без spec', () => {
    const simple = loadWorkflows(named).workflows.simple;
    const bugfix = loadWorkflows(named).workflows.bugfix;
    assert.equal(isPhaseAllowed(simple, 'To Do', 'do'), true);
    assert.equal(isPhaseAllowed(simple, 'To Do', 'spec'), false);
    assert.equal(isPhaseAllowed(bugfix, 'To Do', 'plan'), true);
    assert.equal(isPhaseAllowed(bugfix, 'To Do', 'spec'), false);
    assert.equal(isPhaseAllowed(bugfix, 'Spec', 'plan'), false);
  });

  it('isPhaseAllowed: служебные фазы всегда разрешены', () => {
    for (const phase of SERVICE_PHASES) {
      assert.equal(isPhaseAllowed(DEFAULT_WORKFLOW, 'Done', phase), true, phase);
    }
  });

  // ── canMoveTo ──

  it('canMoveTo: транзиты по produces_status', () => {
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'To Do', 'Spec'), true);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Spec', 'Planned'), true);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Review', 'Done'), true);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Review', 'Review'), true); // fix-цикл code
  });

  it('canMoveTo: без транзита — запрет (Spec → Done, To Do → Review)', () => {
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Spec', 'Done'), false);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'To Do', 'Review'), false);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'To Do', 'Done'), false);
  });

  it('canMoveTo: ручной вход в initial_status из бесфазного статуса (Backlog → To Do)', () => {
    const withBacklog = {
      initial_status: 'To Do',
      transitions: [...DEFAULT_WORKFLOW.transitions, { status: 'Backlog', phase: null, produces_status: null }],
    };
    assert.equal(canMoveTo(withBacklog, 'Backlog', 'To Do'), true);
    // А из фазового статуса мимо перехода — нельзя
    assert.equal(canMoveTo(withBacklog, 'Backlog', 'Spec'), false);
  });

  it('canMoveTo: финальные статусы без исходящих → только from === to', () => {
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Done', 'To Do'), false);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Rejected', 'To Do'), false);
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Done', 'Done'), true);
  });

  // ── isTerminalStatus (VL-248) ──

  it('isTerminalStatus: Done/Rejected терминальны, промежуточные — нет', () => {
    for (const status of ['Done', 'Rejected']) {
      assert.equal(isTerminalStatus(DEFAULT_WORKFLOW, status), true, status);
    }
    for (const status of ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Backlog']) {
      assert.equal(isTerminalStatus(DEFAULT_WORKFLOW, status), false, status);
    }
  });

  it('isTerminalStatus: кастомный финал и бесфазный статус вне workflow', () => {
    // Кастомный workflow: финал — 'Archive' (phase null), 'Review' ведёт в него
    const custom = {
      initial_status: 'To Do',
      transitions: [
        { status: 'To Do', phase: 'do', produces_status: 'Review' },
        { status: 'Review', phase: 'close', produces_status: 'Archive' },
        { status: 'Archive', phase: null, produces_status: null },
      ],
    };
    assert.equal(isTerminalStatus(custom, 'Archive'), true, 'финальный маркер');
    assert.equal(isTerminalStatus(custom, 'Review'), false, 'есть исходящая фаза');
    assert.equal(isTerminalStatus(custom, 'To Do'), false, 'есть исходящая фаза');
    assert.equal(isTerminalStatus(custom, 'Backlog'), false, 'статуса нет в workflow');
    // initial_status без исходящих фаз — тупик, считаем терминальным
    const onlyInitial = { initial_status: 'Backlog', transitions: [] };
    assert.equal(isTerminalStatus(onlyInitial, 'Backlog'), true, 'бесфазный initial — тупик');
  });

  it('canMoveTo: initial_status без исходящих транзишенов-фаз из from', () => {
    // From = статус с исходящими фазами → вход в initial_status мимо переходов запрещён
    assert.equal(canMoveTo(DEFAULT_WORKFLOW, 'Spec', 'To Do'), false);
  });
});

// ── VL-195: investigation-workflow (расследование инцидентов) ──

describe('investigation workflow (VL-195)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-investigation-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Проект с investigation-workflow: ни одна фаза не производит In Progress (R1). */
  const dir = (() => {
    const d = join(root, 'project');
    mkdirSync(join(d, '.vibelog'), { recursive: true });
    writeFileSync(
      settingsPath(d),
      JSON.stringify(
        {
          workflows: {
            investigation: {
              initial_status: 'To Do',
              transitions: [
                { status: 'To Do', phase: 'investigate', produces_status: 'Review' },
                { status: 'Review', phase: 'materialize', produces_status: 'Done' },
                { status: 'Review', phase: 'reject', produces_status: 'Done' },
                { status: 'Done', phase: null, produces_status: null },
              ],
            },
          },
          task_workflows: { investigation: 'investigation' },
        },
        null,
        2
      ),
      'utf-8'
    );
    return d;
  })();

  it('тип investigation получает свой workflow; In Progress не производится', () => {
    const wf = getWorkflowForTask(dir, task('investigation'));
    assert.equal(wf.initial_status, 'To Do');
    assert.deepEqual(getAvailablePhases(wf, 'To Do'), ['investigate']);
    assert.ok(
      wf.transitions.every((t) => t.produces_status !== 'In Progress'),
      'ни одна фаза не ведёт в In Progress (инвариант после ревью)'
    );
  });

  it('цепочка: To Do →[investigate]→ Review →[materialize]→ Done, ветвление reject', () => {
    const wf = getWorkflowForTask(dir, task('investigation'));
    assert.equal(getStatusAfterPhase(wf, 'To Do', 'investigate'), 'Review');
    assert.equal(getStatusAfterPhase(wf, 'Review', 'materialize'), 'Done');
    assert.equal(getStatusAfterPhase(wf, 'Review', 'reject'), 'Done');
    assert.deepEqual(getAvailablePhases(wf, 'Review'), ['materialize', 'reject']);
    assert.equal(getNextPhase(wf, 'Review'), 'materialize', 'reject не первый для «следующего этапа»');
  });

  it('isPhaseAllowed: каждая фаза только из своего статуса', () => {
    const wf = getWorkflowForTask(dir, task('investigation'));
    assert.equal(isPhaseAllowed(wf, 'To Do', 'investigate'), true);
    assert.equal(isPhaseAllowed(wf, 'Review', 'investigate'), false, 'investigate не из Review');
    assert.equal(isPhaseAllowed(wf, 'To Do', 'materialize'), false, 'materialize не из To Do');
  });

  it('canMoveTo: To Do → Review и Review → Done возможны; To Do → In Progress — нет', () => {
    const wf = getWorkflowForTask(dir, task('investigation'));
    assert.equal(canMoveTo(wf, 'To Do', 'Review'), true);
    assert.equal(canMoveTo(wf, 'Review', 'Done'), true);
    assert.equal(canMoveTo(wf, 'To Do', 'In Progress'), false);
    assert.equal(canMoveTo(wf, 'To Do', 'Done'), false);
  });

  it('pickAutoPhase: авто-цепочка To Do → investigate → Review → materialize → Done', () => {
    const wf = getWorkflowForTask(dir, task('investigation'));
    let status = 'To Do';
    const path = [status];
    for (let i = 0; i < 4; i++) {
      const phase = pickAutoPhase(wf, status);
      if (!phase) break;
      status = getStatusAfterPhase(wf, status, phase);
      path.push(status);
    }
    assert.deepEqual(path, ['To Do', 'Review', 'Done']);
  });
});

// ── VL-245: валидация смены статуса фазой workflow ──

describe('phaseStatusTransitionError (VL-245)', () => {
  it('служебные фазы статус не меняют — любая смена отклоняется', () => {
    for (const phase of SERVICE_PHASES) {
      const err = phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Review', phase, 'Done');
      assert.ok(err, `служебная фаза ${phase} должна блокировать смену статуса`);
      assert.ok(err.includes('служебная'), `нет пояснения про служебную фазу: ${err}`);
      assert.ok(err.includes('Не повторяй'), `нет следующего шага (lesson-92): ${err}`);
    }
  });

  it('инцидент VL-231: comment не выставляет Done из To Do', () => {
    const err = phaseStatusTransitionError(DEFAULT_WORKFLOW, 'To Do', 'comment', 'Done');
    assert.ok(err, 'comment + Done должен отклоняться');
    assert.ok(err.includes('Done') && err.includes('comment'), `нет деталей перехода: ${err}`);
  });

  it('штатный переход Review + close → Done разрешён', () => {
    assert.equal(phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Review', 'close', 'Done'), null);
  });

  it('fix-цикл Review + code → Review разрешён, чужой статус — нет', () => {
    assert.equal(phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Review', 'code', 'Review'), null);
    const err = phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Review', 'code', 'Done');
    assert.ok(err, 'code не переводит в Done');
    assert.ok(err.includes('Review'), `ошибка должна называть фактический produces_status: ${err}`);
  });

  it('фаза не из того статуса отклоняется (close из To Do)', () => {
    const err = phaseStatusTransitionError(DEFAULT_WORKFLOW, 'To Do', 'close', 'Done');
    assert.ok(err, 'close из To Do недопустим');
    assert.ok(err.includes('workflow нет'), `нет пояснения об отсутствии перехода: ${err}`);
  });

  it('финальные статусы: любой запрос статуса отклоняется', () => {
    assert.ok(phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Done', 'close', 'Done'));
    assert.ok(phaseStatusTransitionError(DEFAULT_WORKFLOW, 'Rejected', 'code', 'Review'));
  });

  it('кастомный workflow уважается (investigation: To Do + investigate → Review)', () => {
    const wf = {
      initial_status: 'To Do',
      transitions: [
        { status: 'To Do', phase: 'investigate', produces_status: 'Review' },
        { status: 'Review', phase: 'materialize', produces_status: 'Done' },
        { status: 'Done', phase: null, produces_status: null },
      ],
    };
    assert.equal(phaseStatusTransitionError(wf, 'To Do', 'investigate', 'Review'), null);
    assert.ok(phaseStatusTransitionError(wf, 'To Do', 'investigate', 'Done'));
  });
});

// ── VL-370: неполнота сущности как данные (workflow × фаза × сущность) ──

describe('DEFAULT_COMPLETENESS и loadCompleteness (VL-370)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-completeness-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Каталог проекта с заданным содержимым settings.json. */
  function project(name, settings) {
    const dir = join(root, name);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');
    return dir;
  }

  it('дефолт: default требует plan → implementationPlan, close → AC/DoD, */task → description', () => {
    assert.deepEqual(DEFAULT_COMPLETENESS.default.plan.task, ['implementationPlan']);
    assert.deepEqual(DEFAULT_COMPLETENESS.default.close.task, ['acceptanceCriteria', 'definitionOfDone']);
    // AC9: '*' несёт description — задача без описания неполна и при неизвестной фазе
    assert.deepEqual(DEFAULT_COMPLETENESS.default['*'].task, ['description']);
    assert.deepEqual(DEFAULT_COMPLETENESS.default['*'].lesson, ['content']);
  });

  it('нет ключа completeness → DEFAULT_COMPLETENESS', () => {
    const dir = join(root, 'no-key');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({ task_workflows: {} }), 'utf-8');
    assert.deepEqual(loadCompleteness(dir), DEFAULT_COMPLETENESS);
  });

  it('битый JSON / отсутствующий файл → DEFAULT_COMPLETENESS', () => {
    const broken = join(root, 'broken');
    mkdirSync(join(broken, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(broken), '{не json', 'utf-8');
    assert.deepEqual(loadCompleteness(broken), DEFAULT_COMPLETENESS);
    assert.deepEqual(loadCompleteness(join(root, 'nonexistent')), DEFAULT_COMPLETENESS);
  });

  it('валидная именованная запись перекрывает дефолт, битая выпадает', () => {
    const dir = project('partial', {
      completeness: {
        custom: { do: { task: ['description', 'labels'] } },
        broken: { do: 'нет-это-не-массив' },
      },
    });
    const map = loadCompleteness(dir);
    assert.deepEqual(map.custom, { do: { task: ['description', 'labels'] } });
    assert.equal(map.broken, undefined, 'битая запись выпала');
    assert.deepEqual(map.default, DEFAULT_COMPLETENESS.default, 'дефолт сохранён');
  });

  it('запись workflow заменяет дефолтную ЦЕЛИКОМ (не сливается по фазам)', () => {
    const dir = project('replace', {
      completeness: { default: { do: { task: ['labels'] } } },
    });
    const map = loadCompleteness(dir);
    assert.deepEqual(map.default, { do: { task: ['labels'] } });
  });
});

describe('getCompletenessRules и taskCompletenessMissing (VL-370)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-completeness-rules-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const simple = {
    initial_status: 'To Do',
    transitions: [
      { status: 'To Do', phase: 'do', produces_status: 'Review' },
      { status: 'Review', phase: 'close', produces_status: 'Done' },
      { status: 'Done', phase: null, produces_status: null },
    ],
  };

  const simpleDir = (() => {
    const dir = join(root, 'simple');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({
      workflows: { simple },
      task_workflows: { chore: 'simple' },
    }, null, 2), 'utf-8');
    return dir;
  })();

  /** Проект, где workflow объявлен, но в completeness не настроен (действующий проект). */
  const declaredDir = (() => {
    const dir = join(root, 'declared');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({
      workflows: {
        investigation: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'investigate', produces_status: 'Review' }],
        },
      },
      task_workflows: { investigation: 'investigation' },
    }, null, 2), 'utf-8');
    return dir;
  })();

  const customDir = (() => {
    const dir = join(root, 'custom');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({
      workflows: {
        strict: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'plan', produces_status: 'Planned' }],
        },
      },
      task_workflows: { epic: 'strict' },
      completeness: { strict: { plan: { task: ['labels', 'priority'] } } },
    }, null, 2), 'utf-8');
    return dir;
  })();

  const emptyDir = join(root, 'empty');
  mkdirSync(join(emptyDir, '.vibelog'), { recursive: true });
  writeFileSync(settingsPath(emptyDir), '{}', 'utf-8');

  it('AC2: simple + do не требует AC и плана (только description)', () => {
    const rules = getCompletenessRules(simpleDir, task('chore'), 'do');
    assert.deepEqual(rules.task, ['description']);
    assert.ok(!rules.task.includes('acceptanceCriteria'));
    assert.ok(!rules.task.includes('implementationPlan'));
  });

  it('фаза null → правила только из "*" (AC9: description остаётся)', () => {
    assert.deepEqual(getCompletenessRules(emptyDir, task('feature'), null).task, ['description']);
  });

  it('AC3: default — spec→description, plan→implementationPlan, close→AC/DoD', () => {
    assert.deepEqual(getCompletenessRules(emptyDir, task('feature'), 'spec').task, ['description']);
    assert.ok(getCompletenessRules(emptyDir, task('feature'), 'plan').task.includes('implementationPlan'));
    const close = getCompletenessRules(emptyDir, task('feature'), 'close').task;
    assert.ok(close.includes('acceptanceCriteria') && close.includes('definitionOfDone'));
  });

  it('AC10: объявленный-но-не-настроенный workflow → пустой набор (дефолт не протекает)', () => {
    assert.deepEqual(getCompletenessRules(declaredDir, task('investigation'), 'investigate').task, []);
  });

  it('AC5: кастомный workflow из settings — правила без правки кода инструментов', () => {
    assert.deepEqual(getCompletenessFields(customDir, 'strict', 'plan', 'task'), ['labels', 'priority']);
  });

  it('taskCompletenessMissing: пустое поле и неотмеченный чеклист дают numbers', () => {
    const t = {
      id: 'VL-1',
      description: '',
      acceptanceCriteria: [{ text: 'a', checked: true }, { text: 'b', checked: false }],
      definitionOfDone: [{ text: 'd', checked: false }],
    };
    const missing = taskCompletenessMissing(t, ['description', 'acceptanceCriteria', 'definitionOfDone']);
    assert.deepEqual(missing.map(m => m.field), ['description', 'acceptanceCriteria', 'definitionOfDone']);
    assert.deepEqual(missing[1].numbers, [2]);
    assert.deepEqual(missing[2].numbers, [1]);
  });

  it('AC11: пустой чеклист считается полным', () => {
    const t = { id: 'VL-2', acceptanceCriteria: [], definitionOfDone: [] };
    assert.deepEqual(taskCompletenessMissing(t, ['acceptanceCriteria', 'definitionOfDone']), []);
  });

  it('заполненная задача без правил неполноты — полная', () => {
    const t = { id: 'VL-3', description: 'есть' };
    assert.deepEqual(taskCompletenessMissing(t, []), []);
    assert.deepEqual(taskCompletenessMissing(t, ['description']), []);
  });

  it('AC4: terminalStatusGateForTask — simple не блокирует Done при неотмеченных AC/DoD', () => {
    const t = {
      id: 'VL-4', type: 'chore', description: 'есть',
      acceptanceCriteria: [{ text: 'a', checked: false }],
      definitionOfDone: [{ text: 'd', checked: false }],
    };
    assert.equal(terminalStatusGateForTask(simpleDir, t, 'Done', 'close', 'Review').blocked, false);
  });

  it('AC4/AC12: default блокирует Done при неотмеченном DoD, текст — публичный (VL-378)', () => {
    const t = {
      id: 'VL-5', type: 'feature', description: 'есть',
      acceptanceCriteria: [{ text: 'a', checked: true }],
      definitionOfDone: [{ text: 'd', checked: false }],
    };
    const gate = terminalStatusGateForTask(emptyDir, t, 'Done', 'close', 'Review');
    assert.equal(gate.blocked, true);
    assert.match(gate.reason, /DoD: #1/);
    // VL-378: низкоуровневая сборка текста приватна, поэтому байт-в-байт
    // проверяется текст, который отдаёт единственный публичный вход.
    assert.equal(
      gate.reason,
      'Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #1) ' +
        'возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). ' +
        'Задача оставлена в «Review».',
    );
  });
});

// ── VL-377: валидация ключей completeness (опечатка не должна молчать) ──

describe('validateCompleteness (VL-377)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-completeness-validate-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Каталог проекта с заданным содержимым settings.json. */
  function project(name, settings) {
    const dir = join(root, name);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');
    return dir;
  }

  it('опечатка в имени workflow → предупреждение kind=workflow (правило не применяется)', () => {
    const dir = project('typo-workflow', {
      completeness: { defualt: { close: { task: ['acceptanceCriteria'] } } },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'workflow');
    assert.equal(warnings[0].path, 'completeness.defualt');
    assert.match(warnings[0].message, /defualt/);
    assert.match(warnings[0].message, /default/, 'подсказка с ближайшим именем');

    // Демонстрация исходного дефекта: запись лежит в карте, но не применяется.
    assert.deepEqual(loadCompleteness(dir).defualt, { close: { task: ['acceptanceCriteria'] } });
    const close = getCompletenessRules(dir, task('feature'), 'close').task;
    assert.ok(close.includes('acceptanceCriteria'), 'сработал дефолт, а не опечатанная запись');
  });

  it('опечатка в имени фазы → предупреждение kind=phase', () => {
    const dir = project('typo-phase', {
      completeness: { default: { clsoe: { task: ['acceptanceCriteria'] } } },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'phase');
    assert.equal(warnings[0].path, 'completeness.default.clsoe');
    assert.match(warnings[0].message, /clsoe/);
    assert.match(warnings[0].message, /close/, 'подсказка с ближайшей фазой');
  });

  it('опечатка в имени сущности → предупреждение kind=entity', () => {
    const dir = project('typo-entity', {
      completeness: { default: { close: { tsak: ['acceptanceCriteria'] } } },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'entity');
    assert.equal(warnings[0].path, 'completeness.default.close.tsak');
    assert.match(warnings[0].message, /tsak/);
    assert.match(warnings[0].message, /task/, 'подсказка с допустимой сущностью');
  });

  it('опечатка в имени поля → предупреждение kind=field + поле даёт вечную неполноту', () => {
    const dir = project('typo-field', {
      completeness: { default: { close: { task: ['acceptanceCriterias'] } } },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'field');
    assert.equal(warnings[0].path, 'completeness.default.close.task[0]');
    assert.match(warnings[0].message, /acceptanceCriterias/);

    // Почему это дефект: неизвестное не-чеклист поле «пустое» всегда.
    const full = {
      id: 'VL-1', description: 'есть', acceptanceCriteria: [], definitionOfDone: [],
    };
    const missing = taskCompletenessMissing(full, ['acceptanceCriterias']);
    assert.deepEqual(missing.map((m) => m.field), ['acceptanceCriterias']);
  });

  it('AC3: валидная конфигурация с КАСТОМНЫМ workflow предупреждений не даёт', () => {
    const dir = project('valid-custom', {
      workflows: {
        investigation: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'investigate', produces_status: 'Review' },
            { status: 'Review', phase: 'materialize', produces_status: 'Done' },
            { status: 'Review', phase: 'reject', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
      task_workflows: { investigation: 'investigation' },
      completeness: {
        investigation: {
          investigate: { task: ['description'] },
          materialize: { task: ['implementationPlan'] },
          '*': { task: ['description'], lesson: ['content'] },
        },
        // simple не объявлен в workflows, но его запись легитимна (дефолт в коде)
        simple: { do: { task: ['description'] }, '*': { task: ['description'] } },
      },
    });
    assert.deepEqual(validateCompleteness(dir), []);
  });

  it('AC5: структурно битая запись даёт kind=structure, валидная рядом остаётся', () => {
    const dir = project('broken-entry', {
      workflows: {
        custom: {
          initial_status: 'To Do',
          transitions: [{ status: 'To Do', phase: 'do', produces_status: 'Done' }],
        },
      },
      completeness: {
        custom: { do: { task: ['description'] } },
        broken: { do: 'нет-это-не-массив' },
      },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'structure');
    assert.equal(warnings[0].path, 'completeness.broken');
    // частичная валидность не изменилась: валидная запись на месте, битая выпала
    const map = loadCompleteness(dir);
    assert.deepEqual(map.custom, { do: { task: ['description'] } });
    assert.equal(map.broken, undefined);
  });

  it('task_workflows на необъявленный workflow → предупреждение kind=task_workflow', () => {
    const dir = project('typo-task-workflow', {
      task_workflows: { bug: 'nope' },
    });
    const warnings = validateCompleteness(dir);
    assert.equal(warnings.length, 1, JSON.stringify(warnings));
    assert.equal(warnings[0].kind, 'task_workflow');
    assert.equal(warnings[0].path, 'task_workflows.bug');
    assert.match(warnings[0].message, /nope/);
  });

  it('пустой/несуществующий каталог → предупреждений нет', () => {
    assert.deepEqual(validateCompleteness(join(root, 'nonexistent')), []);
    const empty = join(root, 'empty');
    mkdirSync(join(empty, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(empty), '{}', 'utf-8');
    assert.deepEqual(validateCompleteness(empty), []);
  });

  it('дрейф-гард: KNOWN_TASK_FIELDS совпадает с ключами createTask, литералы сущностей/полей урока', () => {
    const created = Object.keys(createTask({ id: 'VL-1', title: 't' }, {}));
    for (const field of created) {
      assert.ok(KNOWN_TASK_FIELDS.includes(field), `KNOWN_TASK_FIELDS потерял поле Task: ${field}`);
    }
    // `token_usage` — опциональное поле Task (VL-198): createTask пишет его
    // только при наличии, поэтому в списке известных оно есть, а в объекте нет.
    // Лишние имена — дефект: они разрешили бы требовать несуществующее поле.
    const OPTIONAL_TASK_FIELDS = ['token_usage'];
    const extra = KNOWN_TASK_FIELDS.filter((f) => !created.includes(f) && !OPTIONAL_TASK_FIELDS.includes(f));
    assert.deepEqual(extra, [], `KNOWN_TASK_FIELDS содержит неизвестные поля: ${extra.join(', ')}`);

    assert.deepEqual([...COMPLETENESS_ENTITIES], ['task', 'lesson']);
    assert.deepEqual([...KNOWN_LESSON_FIELDS], ['content']);
  });
});
