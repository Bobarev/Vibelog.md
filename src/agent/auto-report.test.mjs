/**
 * Тесты авто-отчёта фазы в пост-ране CLI (VL-304).
 *
 * Проверяют, что ран, завершившийся без `backlog_finish_phase`, всё равно
 * оставляет отчёт в задаче и двигает статус по workflow — и что дубля нет,
 * когда отчёт уже записан (finish_phase/прогресс), а также что упавший ран и
 * служебная фаза авто-отчёт не пишут.
 *
 * Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { createTaskFile, getTask, addComment, updateTaskFile } from '../../dist/core/store.js';
import { writeAutoReportIfMissing } from '../../dist/agent/auto-report.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-auto-report-'));
const backlogDir = join(cwd, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  const config = {
    project_name: 'AutoReport Test',
    task_prefix: 'ar',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  };
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Начало рана «в прошлом» — отчёт этого рана ещё не писался. */
const RUN_STARTED_AT = new Date(Date.now() - 60_000).toISOString();

describe('VL-304 — авто-отчёт фазы без backlog_finish_phase', () => {
  let taskId;

  beforeEach(() => {
    const t = createTaskFile(cwd, {
      title: 'Авто-отчёт',
      status: 'Spec',
      acceptanceCriteria: ['Первый пункт', 'Второй пункт'],
      definitionOfDone: ['Тесты проходят'],
    });
    taskId = t.id;
  });

  it('AC3: ран без finish_phase → отчёт @agent записан, статус сдвинут по workflow', () => {
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId,
      phase: 'plan',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, true, 'отчёт должен быть записан');
    const task = getTask(cwd, taskId);
    const last = task.comments[task.comments.length - 1];
    assert.equal(last.author, '@agent');
    assert.match(last.text, /авто-отчёт/);
    assert.match(last.text, /AC отмечено: 0 из 2/);
    // Неотмеченные пункты перечислены явно (не «висят молча»)
    assert.match(last.text, /AC не отмечены \(2\): 1\. Первый пункт; 2\. Второй пункт/);
    assert.match(last.text, /DoD не отмечены \(1\): 1\. Тесты проходят/);
    assert.equal(task.status, 'Planned', 'Spec + plan → Planned');
  });

  it('AC3: отчёт уже записан в этом ране → второго нет (нет дубля с finish_phase)', () => {
    addComment(cwd, taskId, 'Отчёт фазы от finish_phase', '@agent');
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId,
      phase: 'plan',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, false, 'дубль не пишется');
    const task = getTask(cwd, taskId);
    assert.equal(task.comments.length, 1);
    assert.equal(task.status, 'Spec', 'статус не тронут');
  });

  it('упавший ран (isError) авто-отчёт не пишет', () => {
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId,
      phase: 'plan',
      runStartedAt: RUN_STARTED_AT,
      isError: true,
    });
    assert.equal(written, false);
    assert.equal(getTask(cwd, taskId).comments.length, 0);
  });

  it('служебная фаза (comment) авто-отчёт не пишет', () => {
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId,
      phase: 'comment',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, false);
    assert.equal(getTask(cwd, taskId).comments.length, 0);
  });

  it('несуществующая задача → false без исключения', () => {
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId: 'ar-999',
      phase: 'plan',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, false);
  });

  it('VL-309 (AC2): терминальный статус при неотмеченном DoD не ставится, причина в отчёте', () => {
    // Регресс на Close VL-307: авто-отчёт двигал статус по getStatusAfterPhase
    // без проверки неотмеченных пунктов и ставил Done незакрытой задаче.
    const t = createTaskFile(cwd, {
      title: 'Close без DoD',
      status: 'Review',
      acceptanceCriteria: ['Первый пункт'],
      definitionOfDone: ['Тесты проходят', 'Документация обновлена'],
    });
    updateTaskFile(cwd, t.id, {
      definitionOfDone: [{ text: 'Тесты проходят', checked: true }, { text: 'Документация обновлена', checked: false }],
    });
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId: t.id,
      phase: 'close',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, true, 'отчёт пишется');
    const task = getTask(cwd, t.id);
    assert.equal(task.status, 'Review', 'терминальный Done при неотмеченном DoD не ставится');
    const last = task.comments[task.comments.length - 1];
    assert.equal(last.author, '@agent');
    assert.match(last.text, /Статус не изменён/);
    assert.match(last.text, /DoD: #2/);
    assert.match(last.text, /backlog_finish_phase с dodOverride или aborted/);
  });

  it('VL-309 (AC2): все пункты отмечены → статус по workflow ставится', () => {
    const t = createTaskFile(cwd, {
      title: 'Close с DoD',
      status: 'Review',
      acceptanceCriteria: ['Первый пункт'],
      definitionOfDone: ['Тесты проходят'],
    });
    updateTaskFile(cwd, t.id, {
      acceptanceCriteria: [{ text: 'Первый пункт', checked: true }],
      definitionOfDone: [{ text: 'Тесты проходят', checked: true }],
    });
    const written = writeAutoReportIfMissing({
      cwd,
      taskCwd: cwd,
      taskId: t.id,
      phase: 'close',
      runStartedAt: RUN_STARTED_AT,
      isError: false,
    });
    assert.equal(written, true);
    const task = getTask(cwd, t.id);
    assert.equal(task.status, 'Done', 'Review + close → Done, когда всё отмечено');
    assert.doesNotMatch(task.comments[task.comments.length - 1].text, /Статус не изменён/);
  });
});
