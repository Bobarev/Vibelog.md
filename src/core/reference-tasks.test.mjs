/**
 * Тесты VL-418 — чтение задач из клона референса (ядро).
 *
 * Проверяет `listCloneTasks`/`getCloneTask`/`suggestCloneTaskIds` на
 * mkdtemp-фикстурах: фильтры (status/labels/type), includeCompleted, лимит,
 * натуральную сортировку ID, сортировку по updated/priority, пустой каталог.
 *
 * Ядро не знает про cwd и backlog/ — принимает уже резолвленный каталог клона.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  listCloneTasks, getCloneTask, suggestCloneTaskIds, naturalCompare,
  DEFAULT_CLONE_TASKS_LIMIT, MAX_CLONE_TASKS_LIMIT,
} from '../../dist/core/reference-tasks.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-reference-tasks-'));
const cloneDir = join(testRoot, 'clone');
const tasksDirPath = join(cloneDir, 'backlog', 'tasks');
const completedDirPath = join(cloneDir, 'backlog', 'completed');

/** Собирает markdown задачи в формате Backlog.md/Vibelog.md. */
function taskMarkdown({ id, title, status = 'To Do', priority = '', labels = [], type = '', updated = '' }) {
  const lines = ['---', `id: ${id}`, `title: ${title}`, `status: ${status}`];
  if (priority) lines.push(`priority: ${priority}`);
  if (type) lines.push(`type: ${type}`);
  lines.push(`labels: [${labels.join(', ')}]`);
  if (updated) lines.push(`updated_date: ${updated}`);
  lines.push('---', '', '<!-- SECTION:DESCRIPTION:BEGIN -->', `Описание ${id}`, '<!-- SECTION:DESCRIPTION:END -->', '');
  return lines.join('\n');
}

function writeTask(dir, task) {
  writeFileSync(join(dir, `${task.id} - ${task.title.replace(/\s+/g, '-')}.md`), taskMarkdown(task), 'utf-8');
}

beforeAll(() => {
  mkdirSync(tasksDirPath, { recursive: true });
  mkdirSync(completedDirPath, { recursive: true });
  writeTask(tasksDirPath, { id: 'VL-9', title: 'Девять', status: 'Planned', priority: 'Low', labels: ['ui'], type: 'feature', updated: '2026-01-01 10:00' });
  writeTask(tasksDirPath, { id: 'VL-10', title: 'Десять', status: 'Planned', priority: 'High', labels: ['ui', 'api'], type: 'bug', updated: '2026-02-01 10:00' });
  writeTask(tasksDirPath, { id: 'VL-11', title: 'Одиннадцать', status: 'Done', priority: 'Medium', labels: ['api'], type: 'feature', updated: '2026-03-01 10:00' });
  writeTask(tasksDirPath, { id: 'VL-100', title: 'Сто', status: 'Planned', priority: '', labels: [], type: 'feature', updated: '2026-04-01 10:00' });
  writeTask(completedDirPath, { id: 'VL-5', title: 'Пять', status: 'Done', priority: 'High', labels: ['ui'], type: 'feature', updated: '2025-12-01 10:00' });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-418 — listCloneTasks: листинг и includeCompleted', () => {
  it('читает backlog/tasks/ клона', () => {
    const { tasks, total } = listCloneTasks(cloneDir);
    assert.equal(total, 4);
    assert.deepEqual(tasks.map(t => t.id), ['VL-9', 'VL-10', 'VL-11', 'VL-100']);
  });

  it('includeCompleted: true добавляет backlog/completed/', () => {
    const { tasks, total } = listCloneTasks(cloneDir, { includeCompleted: true });
    assert.equal(total, 5);
    assert.ok(tasks.some(t => t.id === 'VL-5'));
  });

  it('каталог без backlog/tasks/ → пустой массив, не исключение', () => {
    const empty = join(testRoot, 'no-backlog');
    mkdirSync(empty, { recursive: true });
    const res = listCloneTasks(empty);
    assert.deepEqual(res.tasks, []);
    assert.equal(res.total, 0);
  });
});

describe('VL-418 — фильтры', () => {
  it('status: точное совпадение, case-insensitive', () => {
    const { tasks, total } = listCloneTasks(cloneDir, { status: 'planned' });
    assert.equal(total, 3);
    assert.ok(tasks.every(t => t.status === 'Planned'));
  });

  it('labels: AND по всем меткам', () => {
    const { tasks } = listCloneTasks(cloneDir, { labels: ['ui', 'api'] });
    assert.deepEqual(tasks.map(t => t.id), ['VL-10']);
  });

  it('пустой массив labels не фильтрует', () => {
    const { total } = listCloneTasks(cloneDir, { labels: [] });
    assert.equal(total, 4);
  });

  it('type: точное совпадение', () => {
    const { tasks } = listCloneTasks(cloneDir, { type: 'bug' });
    assert.deepEqual(tasks.map(t => t.id), ['VL-10']);
  });
});

describe('VL-418 — лимит и total', () => {
  it('limit усекает список, total показывает полное число', () => {
    const { tasks, total } = listCloneTasks(cloneDir, { limit: 2 });
    assert.equal(tasks.length, 2);
    assert.equal(total, 4);
  });

  it('дефолтный лимит — 50, потолок — 200', () => {
    assert.equal(DEFAULT_CLONE_TASKS_LIMIT, 50);
    assert.equal(MAX_CLONE_TASKS_LIMIT, 200);
    // limit больше потолка усекается до 200 (на 4 задачах видно только total)
    const { tasks, total } = listCloneTasks(cloneDir, { limit: 10_000 });
    assert.equal(tasks.length, 4);
    assert.equal(total, 4);
  });
});

describe('VL-418 — сортировка', () => {
  it('id: натуральная (VL-9 < VL-10 < VL-100)', () => {
    const { tasks } = listCloneTasks(cloneDir, { sort: 'id' });
    assert.deepEqual(tasks.map(t => t.id), ['VL-9', 'VL-10', 'VL-11', 'VL-100']);
  });

  it('naturalCompare: числа сравниваются как числа', () => {
    assert.ok(naturalCompare('VL-9', 'VL-10') < 0);
    assert.ok(naturalCompare('VL-100', 'VL-11') > 0);
    assert.equal(naturalCompare('VL-7', 'VL-7'), 0);
  });

  it('updated: по updated_date убыв. (свежие первыми)', () => {
    const { tasks } = listCloneTasks(cloneDir, { sort: 'updated' });
    assert.deepEqual(tasks.map(t => t.id), ['VL-100', 'VL-11', 'VL-10', 'VL-9']);
  });

  it('priority: High → Medium → Low → пусто', () => {
    const { tasks } = listCloneTasks(cloneDir, { sort: 'priority' });
    assert.deepEqual(tasks.map(t => t.id), ['VL-10', 'VL-11', 'VL-9', 'VL-100']);
  });
});

describe('VL-418 — getCloneTask и подсказки ID', () => {
  it('находит задачу по ID в tasks/', () => {
    const task = getCloneTask(cloneDir, 'VL-10');
    assert.ok(task);
    assert.equal(task.id, 'VL-10');
    assert.equal(task.title, 'Десять');
  });

  it('находит задачу в completed/', () => {
    const task = getCloneTask(cloneDir, 'VL-5');
    assert.ok(task);
    assert.equal(task.status, 'Done');
  });

  it('неизвестный ID → null', () => {
    assert.equal(getCloneTask(cloneDir, 'VL-999'), null);
  });

  it('suggestCloneTaskIds: сначала ID с тем же префиксом', () => {
    const near = suggestCloneTaskIds(cloneDir, 'VL-1');
    assert.ok(near.length > 0);
    assert.ok(near.includes('VL-10'));
    assert.ok(!near.includes('VL-1'));
  });
});
