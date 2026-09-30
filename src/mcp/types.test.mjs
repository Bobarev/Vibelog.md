/**
 * Тесты VL-4 (v1.3) — типы задач (bug/feature/...) через CLI и MCP.
 *
 * Проверяет:
 * - defaultConfig: types (как DEFAULT_TASK_TYPES оригинала Backlog.md)
 * - normalizeTaskType: case-insensitive, каноническое написание, fallback
 * - task create --type записывает type во frontmatter
 * - task list --type фильтр, task edit --type смена типа
 * - MCP backlog_create_task / backlog_list_tasks / backlog_update_task с type
 * - Round-trip с форматом Backlog.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { stringifyYaml } from '../core/yaml.mjs';
import { defaultConfig, normalizeTaskType, DEFAULT_TASK_TYPES } from '../core/config.mjs';
import { markdownToTask, taskToMarkdown } from '../core/task.mjs';
import { handleToolCall } from '../mcp/tools.mjs';
import { createTaskFile, getTask } from '../core/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-types');
const backlogDir = join(testDir, 'backlog');
const tasksDirPath = join(backlogDir, 'tasks');
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/**
 * Готовит тестовый backlog.
 *
 * @param {string[]|null} types — массив types для конфига (null — без ключа types)
 */
function setup(types = null) {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDirPath, { recursive: true });
  const config = {
    project_name: 'Types Test',
    task_prefix: 'ty',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  };
  if (types !== null) config.types = types;
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr: ошибки валидации CLI пишет в stderr
  // с exit code 0, поэтому execFileSync вернул бы только пустой stdout
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

// ============================================================
// Конфиг и нормализация
// ============================================================

describe('VL-4 — конфиг и нормализация типов', () => {
  it('defaultConfig содержит types — как DEFAULT_TASK_TYPES оригинала', () => {
    const config = defaultConfig('Test', 'ty');
    assert.deepEqual(config.types, ['bug', 'feature', 'enhancement', 'task', 'chore', 'docs', 'spike']);
    assert.deepEqual(DEFAULT_TASK_TYPES, ['bug', 'feature', 'enhancement', 'task', 'chore', 'docs', 'spike']);
  });

  it('normalizeTaskType: case-insensitive → каноническое написание', () => {
    const config = { types: ['bug', 'feature'] };
    assert.equal(normalizeTaskType(config, 'Bug'), 'bug');
    assert.equal(normalizeTaskType(config, 'FEATURE'), 'feature');
    assert.equal(normalizeTaskType(config, 'bug'), 'bug');
    assert.equal(normalizeTaskType(config, ''), '');
    assert.equal(normalizeTaskType(config, undefined), '');
  });

  it('normalizeTaskType: невалидный тип → ошибка', () => {
    const config = { types: ['bug', 'feature'] };
    assert.throws(() => normalizeTaskType(config, 'task'), /Недопустимый тип/);
    assert.throws(() => normalizeTaskType(config, 'xxx'), /bug, feature/);
  });

  it('normalizeTaskType: fallback на DEFAULT_TASK_TYPES без ключа types', () => {
    assert.equal(normalizeTaskType({}, 'spike'), 'spike');
    assert.equal(normalizeTaskType({ types: [] }, 'docs'), 'docs');
  });
});

// ============================================================
// MCP
// ============================================================

describe('VL-4 — MCP: type в create/list/update', () => {
  before(() => setup());
  after(() => cleanup());

  it('create_task с type записывает тип', async () => {
    await handleToolCall('backlog_create_task', { title: 'Баг', type: 'bug' }, testDir);
    const result = await handleToolCall('backlog_list_tasks', {}, testDir);
    const tasks = JSON.parse(result);
    assert.equal(tasks[0].type, 'bug');
  });

  it('create_task: case-insensitive → канонический тип', async () => {
    await handleToolCall('backlog_create_task', { title: 'Фича', type: 'Feature' }, testDir);
    const result = await handleToolCall('backlog_list_tasks', { type: 'feature' }, testDir);
    const tasks = JSON.parse(result);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'feature');
  });

  it('create_task: невалидный type → ошибка', async () => {
    await assert.rejects(
      handleToolCall('backlog_create_task', { title: 'Х', type: 'xxx' }, testDir),
      /Недопустимый тип/
    );
  });

  it('list_tasks: фильтр по type', async () => {
    // chore уникален для этого теста — сьюте разделяет состояние между it
    await handleToolCall('backlog_create_task', { title: 'Работа', type: 'chore' }, testDir);
    await handleToolCall('backlog_create_task', { title: 'Фича 1', type: 'feature' }, testDir);
    const result = await handleToolCall('backlog_list_tasks', { type: 'chore' }, testDir);
    const tasks = JSON.parse(result);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, 'Работа');
  });

  it('update_task: смена типа', async () => {
    const t = createTaskFile(testDir, { title: 'Смена', type: 'bug' });
    await handleToolCall('backlog_update_task', { id: t.id, type: 'enhancement' }, testDir);
    assert.equal(getTask(testDir, t.id).type, 'enhancement');
  });

  it('update_task: невалидный type → ошибка', async () => {
    const t = createTaskFile(testDir, { title: 'Плохой тип' });
    await assert.rejects(
      handleToolCall('backlog_update_task', { id: t.id, type: 'nope' }, testDir),
      /Недопустимый тип/
    );
  });

  it('Round-trip: type переживает markdownToTask(taskToMarkdown())', async () => {
    const t = createTaskFile(testDir, { title: 'RT тип', type: 'docs' });
    const reparsed = markdownToTask(taskToMarkdown(getTask(testDir, t.id)));
    assert.equal(reparsed.type, 'docs');
  });
});

// ============================================================
// CLI
// ============================================================

describe('VL-4 — CLI: --type', () => {
  before(() => setup());
  after(() => cleanup());

  it('task create --type записывает type во frontmatter', () => {
    const out = runCli('task', 'create', 'CLI фича', '--type', 'feature');
    assert.ok(out.includes('создана'), `create: ${out}`);
    const result = JSON.parse(runCli('task', 'list', '--json'));
    const task = result.data.find(t => t.title === 'CLI фича');
    assert.equal(task.type, 'feature');
    // Проверяем сырой frontmatter файла
    const file = readdirSync(tasksDirPath).find(f => f.endsWith('.md'));
    const content = readFileSync(join(tasksDirPath, file), 'utf-8');
    assert.match(content, /type: feature/);
  });

  it('task create --type: case-insensitive', () => {
    runCli('task', 'create', 'CLI баг', '--type', 'Bug');
    const result = JSON.parse(runCli('task', 'list', '--json'));
    const task = result.data.find(t => t.title === 'CLI баг');
    assert.equal(task.type, 'bug');
  });

  it('task list --type фильтрует по типу', () => {
    runCli('task', 'create', 'Только баг', '--type', 'bug');
    runCli('task', 'create', 'Только фича', '--type', 'feature');
    const result = JSON.parse(runCli('task', 'list', '--type', 'feature', '--json'));
    const titles = result.data.map(t => t.title);
    assert.ok(titles.includes('Только фича'));
    assert.ok(!titles.includes('Только баг'));
  });

  it('task edit --type меняет тип', () => {
    const created = runCli('task', 'create', 'Смена типа', '--type', 'bug');
    const id = created.match(/(ty-\d+)/i)[1];
    runCli('task', 'edit', id, '--type', 'chore');
    const result = JSON.parse(runCli('task', 'list', '--json'));
    const task = result.data.find(t => t.id === id);
    assert.equal(task.type, 'chore');
  });

  it('task create --type: невалидный тип → ошибка, задача не создаётся', () => {
    const before = JSON.parse(runCli('task', 'list', '--json')).data.length;
    const out = runCli('task', 'create', 'Плохая', '--type', 'nope');
    assert.ok(out.includes('Недопустимый тип'), `out: ${out}`);
    const after = JSON.parse(runCli('task', 'list', '--json')).data.length;
    assert.equal(after, before);
  });
});

// ============================================================
// Валидация по кастомному конфигу
// ============================================================

describe('VL-4 — types из конфига', () => {
  before(() => setup(['bug']));
  after(() => cleanup());

  it('CLI: type из кастомного конфига проходит, чужой — нет', () => {
    const ok = runCli('task', 'create', 'Своя фича', '--type', 'bug');
    assert.ok(ok.includes('создана'), `out: ${ok}`);
    const bad = runCli('task', 'create', 'Чужая', '--type', 'feature');
    assert.ok(bad.includes('Недопустимый тип'), `out: ${bad}`);
  });

  it('MCP: type из кастомного конфига', async () => {
    await handleToolCall('backlog_create_task', { title: 'MCP bug', type: 'bug' }, testDir);
    await assert.rejects(
      handleToolCall('backlog_create_task', { title: 'MCP feature', type: 'feature' }, testDir),
      /Недопустимый тип/
    );
  });
});
