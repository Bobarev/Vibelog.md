/**
 * Тесты VL-69 — parentTaskId (Epic / дочерние задачи) через MCP.
 *
 * Проверяет:
 * - backlog_create_task: parentTaskId → parent_task_id во frontmatter + round-trip
 * - backlog_create_task: несуществующий parent → ошибка, задача не создаётся
 * - backlog_update_task: смена и сброс (пустая строка) parentTaskId
 * - backlog_list_tasks: фильтр parentTaskId + parent_task_id в simplified-выводе
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { getTask } from '../../dist/core/store.js';
import { taskToMarkdown, markdownToTask } from '../../dist/core/task.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-mcp-parent-'));
const backlogDir = join(testDir, 'backlog');
const tasksDirPath = join(backlogDir, 'tasks');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDirPath, { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Parent Test',
    task_prefix: 'pt',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done', 'Blocked'],
    types: ['bug', 'feature', 'task', 'epic'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

describe('VL-69 — MCP: parentTaskId в create', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('create с parentTaskId записывает parent_task_id (round-trip)', async () => {
    await handleToolCall('backlog_create_task', { title: 'Эпик', type: 'epic' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Дитя', parentTaskId: 'pt-1', type: 'task' }, testDir);

    const child = getTask(testDir, 'pt-2');
    assert.equal(child.parent_task_id, 'pt-1');

    // Round-trip: parent_task_id и type переживают сериализацию в файл
    const parsed = markdownToTask(taskToMarkdown(child));
    assert.equal(parsed.parent_task_id, 'pt-1');
    assert.equal(parsed.type, 'task');
  });

  it('create с несуществующим parent → ошибка, задача не создаётся', async () => {
    await handleToolCall('backlog_create_task', { title: 'Родитель' }, testDir);
    await assert.rejects(
      handleToolCall('backlog_create_task', { title: 'Сирота', parentTaskId: 'pt-99' }, testDir),
      /Родительская задача pt-99 не найдена/
    );
    const list = await handleToolCall('backlog_list_tasks', {}, testDir);
    assert.ok(!list.includes('Сирота'), 'задача не должна создаться');
  });
});

describe('VL-69 — MCP: parentTaskId в update', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('update: смена и сброс (пустая строка) parentTaskId', async () => {
    await handleToolCall('backlog_create_task', { title: 'Родитель А' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Родитель Б' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Дитя' }, testDir);

    await handleToolCall('backlog_update_task', { id: 'pt-3', parentTaskId: 'pt-2' }, testDir);
    assert.equal(getTask(testDir, 'pt-3').parent_task_id, 'pt-2');

    await handleToolCall('backlog_update_task', { id: 'pt-3', parentTaskId: '' }, testDir);
    assert.equal(getTask(testDir, 'pt-3').parent_task_id, '');
  });

  it('update: несуществующий parent → ошибка, поле не меняется', async () => {
    await handleToolCall('backlog_create_task', { title: 'Родитель' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Дитя', parentTaskId: 'pt-1' }, testDir);

    await assert.rejects(
      handleToolCall('backlog_update_task', { id: 'pt-2', parentTaskId: 'pt-99' }, testDir),
      /Родительская задача pt-99 не найдена/
    );
    assert.equal(getTask(testDir, 'pt-2').parent_task_id, 'pt-1');
  });
});

describe('VL-69 — MCP: parentTaskId в list', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('фильтр parentTaskId + parent_task_id в simplified-выводе', async () => {
    await handleToolCall('backlog_create_task', { title: 'Эпик', type: 'epic' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Дитя 1', parentTaskId: 'pt-1' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Дитя 2', parentTaskId: 'pt-1' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Чужое' }, testDir);

    const result = await handleToolCall('backlog_list_tasks', { parentTaskId: 'pt-1' }, testDir);
    const tasks = JSON.parse(result);
    assert.equal(tasks.length, 2, `фильтр: ${result}`);
    for (const t of tasks) {
      assert.equal(t.parent_task_id, 'pt-1', `parent_task_id в simplified-выводе: ${JSON.stringify(t)}`);
    }

    // Без фильтра — все задачи; у детей parent_task_id заполнен
    const all = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testDir));
    const child = all.find(t => t.id === 'pt-2');
    assert.equal(child.parent_task_id, 'pt-1');
  });
});
