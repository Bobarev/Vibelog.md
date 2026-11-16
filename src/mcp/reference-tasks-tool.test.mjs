/**
 * Тесты VL-418 — MCP-инструменты reference_tasks / reference_task_view.
 *
 * Проверяет: регистрацию в listTools и TOOL_KINDS, ошибки (неизвестный ref,
 * type≠repo, отсутствующий клон), успешный листинг с total/returned,
 * просмотр задачи, подсказку ближайших ID и — главное — отказ при симлинке
 * клона наружу (realpath-проверка внутри references/data/).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { clearPhaseEnv } from '../test-env.mjs';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-mcp-reference-tasks-'));
const backlogDir = join(testRoot, 'backlog');
const dataDir = join(backlogDir, 'references', 'data');
const cloneDir = join(dataDir, 'clone-a');

/** Фазовый env агентской сессии на время файла (VL-374, in-process handleToolCall). */
let restorePhaseEnv;

function taskMarkdown({ id, title, status = 'To Do', priority = '', labels = [], type = '' }) {
  const lines = ['---', `id: ${id}`, `title: ${title}`, `status: ${status}`];
  if (priority) lines.push(`priority: ${priority}`);
  if (type) lines.push(`type: ${type}`);
  lines.push(`labels: [${labels.join(', ')}]`, '---', '',
    '<!-- SECTION:DESCRIPTION:BEGIN -->', `Описание ${id}`, '<!-- SECTION:DESCRIPTION:END -->', '');
  return lines.join('\n');
}

function writeTask(dir, task) {
  writeFileSync(join(dir, `${task.id} - ${task.title.replace(/\s+/g, '-')}.md`), taskMarkdown(task), 'utf-8');
}

/** Пишет файл reference в backlog/references/. */
function writeReference({ id, title, type, path }) {
  const dir = join(backlogDir, 'references');
  mkdirSync(dir, { recursive: true });
  const lines = ['---', `id: ${id}`, `title: ${title}`, `type: ${type}`];
  if (path) lines.push(`path: ${path}`);
  lines.push('tags: []', 'created_date: 2026-01-01', 'linked_tasks: []', '---', '');
  writeFileSync(join(dir, `${id}-${title.replace(/\s+/g, '-')}.md`), lines.join('\n'), 'utf-8');
}

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');

  // Клон референса с задачами
  mkdirSync(join(cloneDir, 'backlog', 'tasks'), { recursive: true });
  writeTask(join(cloneDir, 'backlog', 'tasks'), { id: 'VL-9', title: 'Девять', status: 'Planned', priority: 'Low', labels: ['ui'], type: 'feature' });
  writeTask(join(cloneDir, 'backlog', 'tasks'), { id: 'VL-10', title: 'Десять', status: 'Planned', priority: 'High', labels: ['ui', 'api'], type: 'bug' });
  writeTask(join(cloneDir, 'backlog', 'tasks'), { id: 'VL-11', title: 'Одиннадцать', status: 'Done', priority: 'Medium', labels: ['api'], type: 'feature' });

  writeReference({ id: 'ref-1', title: 'Clone A', type: 'repo', path: 'clone-a' });
  writeReference({ id: 'ref-2', title: 'Url one', type: 'url' });
  writeReference({ id: 'ref-3', title: 'Missing clone', type: 'repo', path: 'clone-missing' });

  // Симлинк внутри data/, ведущий НАРУЖУ (в каталог вне references/data/)
  const outside = join(testRoot, 'outside');
  mkdirSync(join(outside, 'backlog', 'tasks'), { recursive: true });
  writeTask(join(outside, 'backlog', 'tasks'), { id: 'VL-666', title: 'Снаружи', status: 'Planned' });
  symlinkSync(outside, join(dataDir, 'clone-escape'));
  writeReference({ id: 'ref-4', title: 'Escape', type: 'repo', path: 'clone-escape' });
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-418 — регистрация инструментов', () => {
  it('reference_tasks и reference_task_view в listTools', () => {
    const names = listTools().map(t => t.name);
    assert.ok(names.includes('reference_tasks'));
    assert.ok(names.includes('reference_task_view'));
  });

  it('TOOL_KINDS: оба инструмента — read', () => {
    assert.equal(TOOL_KINDS.reference_tasks, 'read');
    assert.equal(TOOL_KINDS.reference_task_view, 'read');
  });

  it('в схеме нет аргумента пути (path/dir) — модель не подставит произвольный путь', () => {
    for (const name of ['reference_tasks', 'reference_task_view']) {
      const tool = listTools().find(t => t.name === name);
      const props = Object.keys(tool.inputSchema.properties);
      assert.ok(!props.includes('path'), `${name}: аргумент path запрещён`);
      assert.ok(!props.includes('dir'), `${name}: аргумент dir запрещён`);
      assert.ok(props.includes('reference'), `${name}: reference обязателен`);
    }
  });
});

describe('VL-418 — reference_tasks: ошибки', () => {
  it('неизвестный reference → ackError', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', { reference: 'ref-999' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /не найден/);
  });

  it('type=url → ackError «только type=repo»', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', { reference: 'ref-2' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /только из type=repo/);
  });

  it('клон отсутствует → ackError с подсказкой reference_sync', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', { reference: 'ref-3' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /reference_sync/);
  });

  it('симлинк клона наружу → отказ (realpath-проверка)', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', { reference: 'ref-4' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /выходит за references\/data/);
  });
});

describe('VL-418 — reference_tasks: успешный вызов', () => {
  it('возвращает total/returned/tasks', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', { reference: 'ref-1' }, testRoot));
    assert.equal(out.ok, true);
    assert.equal(out.outcome, 'read');
    assert.equal(out.applied.reference, 'ref-1');
    assert.equal(out.applied.total, 3);
    assert.equal(out.applied.returned, 3);
    assert.deepEqual(out.applied.tasks.map(t => t.id), ['VL-9', 'VL-10', 'VL-11']);
  });

  it('фильтр по статусу + limit: total больше returned', async () => {
    const out = JSON.parse(await handleToolCall('reference_tasks', {
      reference: 'ref-1', status: 'Planned', limit: 1,
    }, testRoot));
    assert.equal(out.applied.total, 2);
    assert.equal(out.applied.returned, 1);
    assert.match(out.message, /показано 1 из 2/);
  });

  it('фильтр по меткам (AND) и типу', async () => {
    const byLabels = JSON.parse(await handleToolCall('reference_tasks', {
      reference: 'ref-1', labels: ['ui', 'api'],
    }, testRoot));
    assert.deepEqual(byLabels.applied.tasks.map(t => t.id), ['VL-10']);
    const byType = JSON.parse(await handleToolCall('reference_tasks', {
      reference: 'ref-1', type: 'bug',
    }, testRoot));
    assert.deepEqual(byType.applied.tasks.map(t => t.id), ['VL-10']);
  });
});

describe('VL-418 — reference_task_view', () => {
  it('находит задачу по ID и отдаёт полное тело', async () => {
    const out = JSON.parse(await handleToolCall('reference_task_view', {
      reference: 'ref-1', id: 'VL-10',
    }, testRoot));
    assert.equal(out.ok, true);
    assert.equal(out.applied.task.id, 'VL-10');
    assert.equal(out.applied.task.title, 'Десять');
    assert.match(out.applied.task.description, /Описание VL-10/);
  });

  it('неизвестный id → ackError со списком ближайших ID', async () => {
    const out = JSON.parse(await handleToolCall('reference_task_view', {
      reference: 'ref-1', id: 'VL-1',
    }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /не найдена/);
    assert.match(out.error, /Ближайшие ID/);
    assert.match(out.error, /VL-10/);
  });

  it('type=url → ackError', async () => {
    const out = JSON.parse(await handleToolCall('reference_task_view', {
      reference: 'ref-2', id: 'VL-10',
    }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /только из type=repo/);
  });
});
