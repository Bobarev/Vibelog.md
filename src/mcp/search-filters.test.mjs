/**
 * Тесты VL-8 — расширенные фильтры backlog_search / searchTasks.
 *
 * Проверяет:
 * - Фильтры status/type/priority/project/modifiedFiles/limit (AND, case-insensitive)
 * - Обратная совместимость: строковый второй аргумент searchTasks = query
 * - Вызов MCP без query (только фильтры) — как в оригинале Backlog.md
 * - Вывод содержит type/project/labels/milestone
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { searchTasks } from '../../dist/core/search.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile } from '../../dist/core/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-search');
const backlogDir = join(testDir, 'backlog');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Search Test',
    task_prefix: 'sr',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');

  // Набор задач для фильтрации
  createTaskFile(testDir, {
    title: 'Баг авторизации', status: 'To Do', priority: 'High',
    type: 'bug', project: 'web', labels: ['auth'], modified_files: ['src/auth/login.ts'],
  });
  createTaskFile(testDir, {
    title: 'Фича поиска', status: 'In Progress', priority: 'Low',
    type: 'feature', project: 'core', modified_files: ['src/core/search.mjs', 'docs/search.md'],
  });
  createTaskFile(testDir, {
    title: 'Доки API', status: 'Done', priority: 'Medium',
    type: 'docs', project: 'web', milestone: 'v1.3',
  });
  createTaskFile(testDir, {
    title: 'Чистка кода', status: 'To Do', priority: 'Medium',
    type: 'chore', project: 'core',
  });
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

describe('VL-8 — фильтры поиска (ядро)', () => {
  before(() => setup());
  after(() => cleanup());

  it('фильтр status (case-insensitive)', () => {
    const r = searchTasks(testDir, { status: 'to do' });
    assert.equal(r.length, 2);
    assert.ok(r.every(t => t.status === 'To Do'));
  });

  it('фильтр type', () => {
    const r = searchTasks(testDir, { type: 'BUG' });
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'Баг авторизации');
  });

  it('фильтр priority', () => {
    const r = searchTasks(testDir, { priority: 'medium' });
    assert.equal(r.length, 2);
  });

  it('фильтр project', () => {
    const r = searchTasks(testDir, { project: 'core' });
    assert.equal(r.length, 2);
    assert.ok(r.every(t => t.project === 'core'));
  });

  it('фильтр modifiedFiles — подстрока, case-insensitive', () => {
    const r = searchTasks(testDir, { modifiedFiles: ['CORE/SEARCH'] });
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'Фича поиска');
  });

  it('modifiedFiles: несовпадение не проходит', () => {
    const r = searchTasks(testDir, { modifiedFiles: ['nonexistent/path'] });
    assert.equal(r.length, 0);
  });

  it('комбинация query + status + type (AND)', () => {
    const r = searchTasks(testDir, { query: 'авторизации', status: 'To Do', type: 'bug' });
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'Баг авторизации');
  });

  it('query без совпадений + фильтр', () => {
    const r = searchTasks(testDir, { query: 'несуществующее', status: 'To Do' });
    assert.equal(r.length, 0);
  });

  it('limit обрезает выдачу', () => {
    const r = searchTasks(testDir, { limit: 2 });
    assert.equal(r.length, 2);
  });

  it('строковый второй аргумент = query (обратная совместимость)', () => {
    const r = searchTasks(testDir, 'авторизации');
    assert.equal(r.length, 1);
    assert.equal(r[0].title, 'Баг авторизации');
  });

  it('без фильтров возвращает все задачи', () => {
    const r = searchTasks(testDir, {});
    assert.equal(r.length, 4);
  });
});

describe('VL-8 — backlog_search (MCP)', () => {
  before(() => setup());
  after(() => cleanup());

  it('вызов без query — только фильтры (как в оригинале)', async () => {
    const res = await handleToolCall('backlog_search', { status: 'Done' }, testDir);
    const data = JSON.parse(res);
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Доки API');
  });

  it('query по-прежнему работает', async () => {
    const res = await handleToolCall('backlog_search', { query: 'фича' }, testDir);
    const data = JSON.parse(res);
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Фича поиска');
  });

  it('вывод содержит type/project/labels/milestone', async () => {
    const res = await handleToolCall('backlog_search', { query: 'поиска' }, testDir);
    const data = JSON.parse(res);
    assert.equal(data[0].type, 'feature');
    assert.equal(data[0].project, 'core');
    assert.deepEqual(data[0].labels, []);
    assert.equal(data[0].milestone, '');
  });

  it('лимит и фильтры через MCP', async () => {
    const res = await handleToolCall('backlog_search', { status: 'To Do', limit: 1 }, testDir);
    const data = JSON.parse(res);
    assert.equal(data.length, 1);
  });
});
