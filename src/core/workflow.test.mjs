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
  SERVICE_PHASES,
  loadWorkflows,
  getWorkflowName,
  getWorkflowForTask,
  getAvailablePhases,
  getNextPhase,
  getStatusAfterPhase,
  isPhaseAllowed,
  canMoveTo,
} from '../../dist/core/workflow.js';
import { pickAutoPhase } from '../../dist/bot/auto-runner.js';
import { settingsPath } from '../../dist/core/settings.js';

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
