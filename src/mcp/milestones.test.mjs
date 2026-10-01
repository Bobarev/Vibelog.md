/**
 * Тесты VL-3 (v1.3) — milestones (вехи) через MCP и CLI.
 *
 * Проверяет:
 * - milestone_add / milestone_list / milestone_rename / milestone_remove / milestone_archive (MCP)
 * - CLI: milestone add|list|rename|remove|archive
 * - remove --task-handling clear|keep|reassign
 * - rename обновляет milestone в задачах
 * - archive переносит в completed/
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile, getTask } from '../../dist/core/store.js';
import { listMilestones } from '../../dist/core/milestone.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-milestones');
const backlogDir = join(testDir, 'backlog');
const tasksDirPath = join(backlogDir, 'tasks');
const milestonesDirPath = join(backlogDir, 'milestones');
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDirPath, { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Milestones Test',
    task_prefix: 'vl',
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

describe('MCP v1.3 — milestone-инструменты', () => {
  it('Все 5 milestone-инструментов зарегистрированы', () => {
    const tools = listTools();
    const names = tools.map(t => t.name);
    for (const name of ['milestone_list', 'milestone_add', 'milestone_rename', 'milestone_remove', 'milestone_archive']) {
      assert.ok(names.includes(name), `${name} не найден`);
    }
  });

  it('Milestone-инструменты имеют inputSchema', () => {
    const tools = listTools();
    for (const name of ['milestone_list', 'milestone_add', 'milestone_rename', 'milestone_remove', 'milestone_archive']) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool.inputSchema, `${name} не имеет inputSchema`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  it('Обязательные поля: add=name, rename=from+to, remove=archive=name', () => {
    const tools = listTools();
    assert.deepEqual(tools.find(t => t.name === 'milestone_add').inputSchema.required, ['name']);
    assert.deepEqual(tools.find(t => t.name === 'milestone_rename').inputSchema.required, ['from', 'to']);
    assert.deepEqual(tools.find(t => t.name === 'milestone_remove').inputSchema.required, ['name']);
    assert.deepEqual(tools.find(t => t.name === 'milestone_archive').inputSchema.required, ['name']);
  });
});

// ============================================================
// MCP-инструменты
// ============================================================

describe('MCP v1.3 — milestone CRUD', () => {
  before(() => setup());
  after(() => cleanup());

  it('add: создаёт файл backlog/milestones/<slug>.md', async () => {
    const res = await handleToolCall('milestone_add', { name: 'v1.3', description: 'Релиз', due_date: '2026-12-31' }, testDir);
    assert.ok(res.includes('v1.3'));
    assert.ok(existsSync(join(milestonesDirPath, 'v13.md')), 'Файл v13.md должен существовать');
    const milestones = listMilestones(backlogDir);
    assert.equal(milestones.length, 1);
    assert.equal(milestones[0].name, 'v1.3');
    assert.equal(milestones[0].description, 'Релиз');
    assert.equal(milestones[0].due_date, '2026-12-31');
    assert.equal(milestones[0].status, 'active');
  });

  it('list: возвращает JSON, архивные скрыты по умолчанию', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    await handleToolCall('milestone_add', { name: 'v1.4' }, testDir);
    await handleToolCall('milestone_archive', { name: 'v1.4' }, testDir);

    const res = await handleToolCall('milestone_list', {}, testDir);
    const data = JSON.parse(res);
    assert.equal(data.length, 1);
    assert.equal(data[0].name, 'v1.3');

    const resAll = await handleToolCall('milestone_list', { include_archived: true }, testDir);
    const dataAll = JSON.parse(resAll);
    assert.equal(dataAll.length, 2);
  });

  it('rename: переименовывает и обновляет milestone в задачах', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    const t = createTaskFile(testDir, { title: 'В вехе v1.3' });
    await handleToolCall('backlog_update_task', { id: t.id, milestone: 'v1.3' }, testDir);

    await handleToolCall('milestone_rename', { from: 'v1.3', to: 'v1.4' }, testDir);

    const milestones = listMilestones(backlogDir);
    assert.equal(milestones.length, 1);
    assert.equal(milestones[0].name, 'v1.4');
    assert.ok(!existsSync(join(milestonesDirPath, 'v13.md')), 'Старый файл удалён');

    const task = getTask(testDir, t.id);
    assert.equal(task.milestone, 'v1.4');
  });

  it('rename: --no-update-tasks (update_tasks=false) не трогает задачи', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    const t = createTaskFile(testDir, { title: 'Остаётся в v1.3' });
    await handleToolCall('backlog_update_task', { id: t.id, milestone: 'v1.3' }, testDir);

    await handleToolCall('milestone_rename', { from: 'v1.3', to: 'v1.4', update_tasks: false }, testDir);

    const task = getTask(testDir, t.id);
    assert.equal(task.milestone, 'v1.3');
  });

  it('remove --task-handling clear: снимает milestone с задач', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    const t1 = createTaskFile(testDir, { title: 'Задача 1' });
    const t2 = createTaskFile(testDir, { title: 'Задача 2' });
    const t3 = createTaskFile(testDir, { title: 'Другая веха' });
    await handleToolCall('backlog_update_task', { id: t1.id, milestone: 'v1.3' }, testDir);
    await handleToolCall('backlog_update_task', { id: t2.id, milestone: 'v1.3' }, testDir);
    await handleToolCall('backlog_update_task', { id: t3.id, milestone: 'v2' }, testDir);

    const res = await handleToolCall('milestone_remove', { name: 'v1.3', task_handling: 'clear' }, testDir);
    assert.ok(res.includes('v1.3'));

    assert.equal(getTask(testDir, t1.id).milestone, '');
    assert.equal(getTask(testDir, t2.id).milestone, '');
    assert.equal(getTask(testDir, t3.id).milestone, 'v2');
    assert.equal(listMilestones(backlogDir).filter(m => m.name === 'v1.3').length, 0);
  });

  it('remove --task-handling keep: задачи сохраняют milestone', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    const t = createTaskFile(testDir, { title: 'Keep' });
    await handleToolCall('backlog_update_task', { id: t.id, milestone: 'v1.3' }, testDir);

    await handleToolCall('milestone_remove', { name: 'v1.3', task_handling: 'keep' }, testDir);

    assert.equal(getTask(testDir, t.id).milestone, 'v1.3');
  });

  it('remove --task-handling reassign: переносит на целевую веху', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    const t = createTaskFile(testDir, { title: 'Reassign' });
    await handleToolCall('backlog_update_task', { id: t.id, milestone: 'v1.3' }, testDir);

    await handleToolCall('milestone_remove', { name: 'v1.3', task_handling: 'reassign', reassign_to: 'v2' }, testDir);

    assert.equal(getTask(testDir, t.id).milestone, 'v2');
  });

  it('archive: переносит в completed/ со статусом archived', async () => {
    await handleToolCall('milestone_add', { name: 'v1.3' }, testDir);
    await handleToolCall('milestone_archive', { name: 'v1.3' }, testDir);

    assert.ok(!existsSync(join(milestonesDirPath, 'v13.md')), 'Файл убран из milestones/');
    assert.ok(existsSync(join(backlogDir, 'completed', 'v13.md')), 'Файл в completed/');
  });

  it('Ошибки: remove/rename несуществующей вехи', async () => {
    await assert.rejects(
      handleToolCall('milestone_remove', { name: 'нету' }, testDir),
      /не найдена/
    );
    await assert.rejects(
      handleToolCall('milestone_rename', { from: 'нету', to: 'x' }, testDir),
      /не найдена/
    );
  });
});

// ============================================================
// CLI
// ============================================================

describe('CLI v1.3 — milestone', () => {
  before(() => setup());
  after(() => cleanup());

  it('add/list/rename/remove/archive', async () => {
    runCli('milestone', 'add', 'v1.3', '-d', 'Описание', '--due-date', '2026-12-31');
    assert.ok(existsSync(join(milestonesDirPath, 'v13.md')));

    let out = runCli('milestone', 'list');
    assert.ok(out.includes('v1.3'), `list: ${out}`);
    assert.ok(out.includes('2026-12-31'), `list due: ${out}`);

    out = runCli('milestone', 'rename', 'v1.3', 'v1.4');
    assert.ok(out.includes('v1.4'), `rename: ${out}`);
    assert.ok(!existsSync(join(milestonesDirPath, 'v13.md')));
    assert.ok(existsSync(join(milestonesDirPath, 'v14.md')));

    out = runCli('milestone', 'archive', 'v1.4');
    assert.ok(out.includes('архивирована'), `archive: ${out}`);
    assert.ok(existsSync(join(backlogDir, 'completed', 'v14.md')));
  });

  it('rename обновляет milestone в задачах', async () => {
    runCli('milestone', 'add', 'v1.3');
    const t = createTaskFile(testDir, { title: 'CLI rename' });
    runCli('task', 'edit', t.id, '--milestone', 'v1.3');

    runCli('milestone', 'rename', 'v1.3', 'v2.0');

    assert.equal(getTask(testDir, t.id).milestone, 'v2.0');
  });

  it('remove --task-handling clear снимает milestone с задач', async () => {
    runCli('milestone', 'add', 'v1.3');
    const t = createTaskFile(testDir, { title: 'CLI clear' });
    runCli('task', 'edit', t.id, '--milestone', 'v1.3');

    runCli('milestone', 'remove', 'v1.3', '--task-handling', 'clear');

    assert.equal(getTask(testDir, t.id).milestone, '');
    assert.ok(!existsSync(join(milestonesDirPath, 'v13.md')));
  });

  it('remove --task-handling reassign --reassign-to', async () => {
    runCli('milestone', 'add', 'v1.3');
    runCli('milestone', 'add', 'v2.0');
    const t = createTaskFile(testDir, { title: 'CLI reassign' });
    runCli('task', 'edit', t.id, '--milestone', 'v1.3');

    runCli('milestone', 'remove', 'v1.3', '--task-handling', 'reassign', '--reassign-to', 'v2.0');

    assert.equal(getTask(testDir, t.id).milestone, 'v2.0');
  });

  it('remove --no-update-tasks (rename --no-update-tasks) не трогает задачи', async () => {
    runCli('milestone', 'add', 'v1.3');
    const t = createTaskFile(testDir, { title: 'CLI no-update' });
    runCli('task', 'edit', t.id, '--milestone', 'v1.3');

    runCli('milestone', 'rename', 'v1.3', 'v1.4', '--no-update-tasks');

    assert.equal(getTask(testDir, t.id).milestone, 'v1.3');
  });

  it('list --show-completed показывает архивные', async () => {
    runCli('milestone', 'add', 'v1.3');
    runCli('milestone', 'archive', 'v1.3');

    let out = runCli('milestone', 'list');
    assert.ok(!out.includes('v1.3'), `не должен показывать архивные: ${out}`);

    out = runCli('milestone', 'list', '--show-completed');
    assert.ok(out.includes('v1.3'), `должен показывать архивные: ${out}`);
  });
});
