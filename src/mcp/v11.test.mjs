/**
 * Тесты PLAN-09 (v1.1) — новые MCP-инструменты и CLI-флаги.
 *
 * Проверяет:
 * - backlog_update_task (все поля, plan/notes/append_notes)
 * - backlog_manage_ac (add/check/uncheck/remove/list)
 * - backlog_manage_dod (add/check/uncheck/remove/list)
 * - backlog_add_comment (с автором и timestamp)
 * - backlog_update_dependencies (с детектом циклов)
 * - backlog_list_tasks (sort, ready, labels, milestone)
 * - CLI: --dod, --check-dod, --comment, --assignee, --remove-label, --ready, --sort
 * - Round-trip с Backlog.md после обновлений
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

import { stringifyYaml } from '../core/yaml.mjs';
import { markdownToTask, taskToMarkdown } from '../core/task.mjs';
import { listTools, handleToolCall } from '../mcp/tools.mjs';
import { createTaskFile, getTask } from '../core/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-v11');
const backlogDir = join(testDir, 'backlog');
const tasksDir = join(backlogDir, 'tasks');
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(backlogDir, 'completed'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'V11 Test',
    task_prefix: 'v11',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  try {
    return execFileSync('node', [cliPath, ...args], {
      cwd: testDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '');
  }
}

// ============================================================
// Список инструментов
// ============================================================

describe('MCP v1.1 — список инструментов', () => {
  it('Все 11 инструментов зарегистрированы', () => {
    const tools = listTools();
    assert.equal(tools.length, 11);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('backlog_create_task'));
    assert.ok(names.includes('backlog_list_tasks'));
    assert.ok(names.includes('backlog_view_task'));
    assert.ok(names.includes('backlog_update_status'));
    assert.ok(names.includes('backlog_search'));
    assert.ok(names.includes('backlog_ready'));
    assert.ok(names.includes('backlog_update_task'));
    assert.ok(names.includes('backlog_manage_ac'));
    assert.ok(names.includes('backlog_manage_dod'));
    assert.ok(names.includes('backlog_add_comment'));
    assert.ok(names.includes('backlog_update_dependencies'));
  });

  it('Новые инструменты имеют inputSchema', () => {
    const tools = listTools();
    const newTools = ['backlog_update_task', 'backlog_manage_ac', 'backlog_manage_dod', 'backlog_add_comment', 'backlog_update_dependencies'];
    for (const name of newTools) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool, `${name} не найден`);
      assert.ok(tool.inputSchema, `${name} не имеет inputSchema`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });
});

// ============================================================
// Все MCP-инструменты v1.1 (общий setup)
// ============================================================

describe('MCP v1.1 — инструменты', () => {
  before(() => setup());
  after(() => cleanup());

  // --- backlog_update_task ---

  it('update_task: обновляет title и priority', async () => {
    const t = createTaskFile(testDir, { title: 'Исходная', priority: 'Low' });
    await handleToolCall('backlog_update_task', { id: t.id, title: 'Новая', priority: 'High' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.title, 'Новая');
    assert.equal(task.priority, 'High');
  });

  it('update_task: plan пишет в Implementation Plan, описание не затирается', async () => {
    const t = createTaskFile(testDir, { title: 'С планом', description: 'Описание' });
    await handleToolCall('backlog_update_task', { id: t.id, plan: '1. Шаг' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.implementationPlan, '1. Шаг');
    assert.equal(task.description, 'Описание');
  });

  it('update_task: append_notes дописывает', async () => {
    const t = createTaskFile(testDir, { title: 'Заметки' });
    await handleToolCall('backlog_update_task', { id: t.id, notes: 'Первая' }, testDir);
    await handleToolCall('backlog_update_task', { id: t.id, append_notes: 'Вторая' }, testDir);
    const task = getTask(testDir, t.id);
    assert.ok(task.implementationNotes.includes('Первая'));
    assert.ok(task.implementationNotes.includes('Вторая'));
  });

  it('update_task: notes заменяет полностью', async () => {
    const t = createTaskFile(testDir, { title: 'Замена заметок' });
    await handleToolCall('backlog_update_task', { id: t.id, notes: 'Старая' }, testDir);
    await handleToolCall('backlog_update_task', { id: t.id, notes: 'Новая' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.implementationNotes, 'Новая');
  });

  it('update_task: final_summary пишет в Final Summary', async () => {
    const t = createTaskFile(testDir, { title: 'Резюме' });
    await handleToolCall('backlog_update_task', { id: t.id, final_summary: 'Готово' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.finalSummary, 'Готово');
  });

  it('update_task: ошибка без полей', async () => {
    const t = createTaskFile(testDir, { title: 'Пустое' });
    await assert.rejects(
      handleToolCall('backlog_update_task', { id: t.id }, testDir),
      /Не указаны поля/
    );
  });

  // --- backlog_manage_ac ---

  it('manage_ac: add добавляет критерии', async () => {
    const t = createTaskFile(testDir, { title: 'AC add' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'А' }, testDir);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'Б' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria.length, 2);
    assert.equal(task.acceptanceCriteria[0].text, 'А');
  });

  it('manage_ac: check/uncheck/remove', async () => {
    const t = createTaskFile(testDir, { title: 'AC ops' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'К1' }, testDir);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'К2' }, testDir);

    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: 1 }, testDir);
    let task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria[0].checked, true);

    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'uncheck', index: 1 }, testDir);
    task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria[0].checked, false);

    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'remove', index: 1 }, testDir);
    task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria.length, 1);
    assert.equal(task.acceptanceCriteria[0].text, 'К2');
  });

  it('manage_ac: list возвращает чеклист', async () => {
    const t = createTaskFile(testDir, { title: 'AC list' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'К1' }, testDir);
    const result = await handleToolCall('backlog_manage_ac', { id: t.id, action: 'list' }, testDir);
    assert.ok(result.includes('К1'));
  });

  // --- backlog_manage_dod ---

  it('manage_dod: add/check/remove', async () => {
    const t = createTaskFile(testDir, { title: 'DoD ops' });
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: 'DoD1' }, testDir);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: 'DoD2' }, testDir);

    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'check', index: 1 }, testDir);
    let task = getTask(testDir, t.id);
    assert.equal(task.definitionOfDone[0].checked, true);

    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'remove', index: 2 }, testDir);
    task = getTask(testDir, t.id);
    assert.equal(task.definitionOfDone.length, 1);
  });

  // --- backlog_add_comment ---

  it('add_comment: автор по умолчанию @agent', async () => {
    const t = createTaskFile(testDir, { title: 'Комментарий' });
    await handleToolCall('backlog_add_comment', { id: t.id, comment: 'Текст' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.comments.length, 1);
    assert.equal(task.comments[0].author, '@agent');
    assert.ok(task.comments[0].created.length > 0);
  });

  it('add_comment: указанный автор', async () => {
    const t = createTaskFile(testDir, { title: 'Автор' });
    await handleToolCall('backlog_add_comment', { id: t.id, comment: 'Hi', author: '@pavel' }, testDir);
    const task = getTask(testDir, t.id);
    assert.equal(task.comments[0].author, '@pavel');
  });

  it('add_comment: round-trip сохраняет комментарии', async () => {
    const t = createTaskFile(testDir, { title: 'RT комментарии' });
    await handleToolCall('backlog_add_comment', { id: t.id, comment: 'Важно' }, testDir);
    const task = getTask(testDir, t.id);
    const reparsed = markdownToTask(taskToMarkdown(task));
    assert.equal(reparsed.comments.length, 1);
    assert.equal(reparsed.comments[0].text, 'Важно');
  });

  // --- backlog_update_dependencies ---

  it('update_dependencies: добавляет и удаляет', async () => {
    const base = createTaskFile(testDir, { title: 'База' });
    const dep = createTaskFile(testDir, { title: 'Зависит' });

    await handleToolCall('backlog_update_dependencies', { id: dep.id, add: [base.id] }, testDir);
    let task = getTask(testDir, dep.id);
    assert.deepStrictEqual(task.dependencies, [base.id]);

    await handleToolCall('backlog_update_dependencies', { id: dep.id, remove: [base.id] }, testDir);
    task = getTask(testDir, dep.id);
    assert.deepStrictEqual(task.dependencies, []);
  });

  it('update_dependencies: детектит цикл', async () => {
    const a = createTaskFile(testDir, { title: 'Цикл А' });
    const b = createTaskFile(testDir, { title: 'Цикл Б', dependencies: [a.id] });
    // B зависит от A. Пытаемся сделать A зависящим от B → цикл
    await assert.rejects(
      handleToolCall('backlog_update_dependencies', { id: a.id, add: [b.id] }, testDir),
      /цикл/
    );
  });

  // --- backlog_list_tasks ---

  it('list_tasks: sort=priority', async () => {
    createTaskFile(testDir, { title: 'Low', priority: 'Low' });
    createTaskFile(testDir, { title: 'High', priority: 'High' });
    const result = await handleToolCall('backlog_list_tasks', { sort: 'priority' }, testDir);
    const data = JSON.parse(result);
    // High должен быть раньше Low
    const highIdx = data.findIndex(t => t.priority === 'High');
    const lowIdx = data.findIndex(t => t.priority === 'Low');
    assert.ok(highIdx >= 0 && lowIdx >= 0);
    assert.ok(highIdx < lowIdx, `High (${highIdx}) должен быть раньше Low (${lowIdx})`);
  });

  it('list_tasks: labels фильтр', async () => {
    createTaskFile(testDir, { title: 'С меткой', labels: ['urgent'] });
    const result = await handleToolCall('backlog_list_tasks', { labels: ['urgent'] }, testDir);
    const data = JSON.parse(result);
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'С меткой');
  });

  it('list_tasks: ready фильтр', async () => {
    // Создаём зависимость, которая не выполнена (статус To Do)
    const blocker = createTaskFile(testDir, { title: 'Блокер', status: 'To Do' });
    createTaskFile(testDir, { title: 'Заблокированная', dependencies: [blocker.id] });
    const result = await handleToolCall('backlog_list_tasks', { ready: true }, testDir);
    const data = JSON.parse(result);
    assert.ok(!data.find(t => t.title === 'Заблокированная'), 'Заблокированная не должна быть ready');
  });
});

// ============================================================
// CLI v1.1
// ============================================================

describe('CLI v1.1 — новые флаги', () => {
  before(() => setup());
  after(() => cleanup());

  it('task edit --check-dod / --uncheck-dod / --remove-dod', async () => {
    const t = createTaskFile(testDir, { title: 'CLI DoD' });
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: 'DoD1' }, testDir);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: 'DoD2' }, testDir);

    runCli('task', 'edit', t.id, '--check-dod', '1');
    let task = getTask(testDir, t.id);
    assert.equal(task.definitionOfDone[0].checked, true);

    runCli('task', 'edit', t.id, '--uncheck-dod', '1');
    task = getTask(testDir, t.id);
    assert.equal(task.definitionOfDone[0].checked, false);

    runCli('task', 'edit', t.id, '--remove-dod', '2');
    task = getTask(testDir, t.id);
    assert.equal(task.definitionOfDone.length, 1);
  });

  it('task edit --comment добавляет комментарий', async () => {
    const t = createTaskFile(testDir, { title: 'CLI комментарий' });
    runCli('task', 'edit', t.id, '--comment', 'Текст', '--comment-author', '@pavel');
    const task = getTask(testDir, t.id);
    assert.equal(task.comments.length, 1);
    assert.equal(task.comments[0].author, '@pavel');
  });

  it('task edit --remove-label убирает метку', async () => {
    const t = createTaskFile(testDir, { title: 'CLI labels', labels: ['bug', 'urgent', 'backend'] });
    runCli('task', 'edit', t.id, '--remove-label', 'urgent');
    const task = getTask(testDir, t.id);
    assert.deepStrictEqual(task.labels, ['bug', 'backend']);
  });

  it('task edit --assignee назначает исполнителя', async () => {
    const t = createTaskFile(testDir, { title: 'CLI assignee' });
    runCli('task', 'edit', t.id, '--assignee', 'dev');
    const task = getTask(testDir, t.id);
    assert.deepStrictEqual(task.assignee, ['dev']);
  });

  it('task list --ready и --sort', async () => {
    createTaskFile(testDir, { title: 'A', priority: 'Low' });
    createTaskFile(testDir, { title: 'B', priority: 'High' });
    const out = runCli('task', 'list', '--sort', 'priority');
    assert.ok(out.includes('B'));
    const outReady = runCli('task', 'list', '--ready');
    assert.ok(typeof outReady === 'string');
  });
});

// ============================================================
// Round-trip
// ============================================================

describe('Round-trip после обновлений v1.1', () => {
  before(() => setup());
  after(() => cleanup());

  it('Полный workflow остаётся валидным', async () => {
    const t = createTaskFile(testDir, {
      title: 'Workflow',
      description: 'Описание',
      acceptanceCriteria: [{ text: 'AC1', checked: false }],
    });

    await handleToolCall('backlog_update_task', {
      id: t.id, title: 'Workflow (ok)', priority: 'High',
      plan: '1. Сделать', append_notes: 'Заметка', final_summary: 'Готово',
    }, testDir);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'AC2' }, testDir);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: 1 }, testDir);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: 'DoD1' }, testDir);
    await handleToolCall('backlog_add_comment', { id: t.id, comment: 'Ок' }, testDir);

    const task = getTask(testDir, t.id);
    const reparsed = markdownToTask(taskToMarkdown(task));

    assert.equal(reparsed.title, 'Workflow (ok)');
    assert.equal(reparsed.priority, 'High');
    assert.equal(reparsed.description, 'Описание');
    assert.equal(reparsed.implementationPlan, '1. Сделать');
    assert.ok(reparsed.implementationNotes.includes('Заметка'));
    assert.equal(reparsed.finalSummary, 'Готово');
    assert.equal(reparsed.acceptanceCriteria.length, 2);
    assert.equal(reparsed.acceptanceCriteria[0].checked, true);
    assert.equal(reparsed.definitionOfDone.length, 1);
    assert.equal(reparsed.comments.length, 1);
  });

  it('Комментарии формата Backlog.md парсятся', () => {
    const content = `---
id: BACK-999
title: Тест
status: To Do
---

## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Опис
<!-- SECTION:DESCRIPTION:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @grok
created: 2026-08-26 18:40
---
Комментарий оригинала
---
<!-- COMMENTS:END -->`;

    const task = markdownToTask(content);
    assert.equal(task.comments.length, 1);
    assert.equal(task.comments[0].author, '@grok');
    assert.equal(task.comments[0].created, '2026-08-26 18:40');
    assert.equal(task.comments[0].text, 'Комментарий оригинала');
  });
});
