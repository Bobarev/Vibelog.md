/**
 * Тесты VL-153 — MCP-инструменты lesson_* (7 штук) + backlog_update_task
 * lessons + backlog_search hasLessons.
 *
 * Проверяет: регистрацию в listTools, вызовы handleToolCall, валидацию
 * статуса, двустороннюю связь с задачей, supersede, подбор уроков.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-mcp-lesson-test-'));
const backlogDir = join(testRoot, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-153 — регистрация lesson_* инструментов', () => {
  it('все 7 lesson_* в listTools', () => {
    const names = listTools().map(t => t.name);
    for (const n of ['lesson_list', 'lesson_create', 'lesson_view', 'lesson_update', 'lesson_search_lessons', 'lesson_link', 'lesson_supersede']) {
      assert.ok(names.includes(n), `${n} не найден`);
    }
  });
});

describe('VL-153 — lesson_create / view / list / search / update', () => {
  it('create: создаёт lesson, view — метаданные + тело', async () => {
    const out = await handleToolCall('lesson_create', {
      title: 'Тесты батчами', tags: ['tests'], sourceTasks: ['VL-1'], content: 'Проблема/Решение',
    }, testRoot);
    assert.match(out, /Lesson lesson-1 создан/);
    const view = JSON.parse(await handleToolCall('lesson_view', { id: 'lesson-1' }, testRoot));
    assert.equal(view.title, 'Тесты батчами');
    assert.equal(view.status, 'active');
    assert.deepEqual(view.tags, ['tests']);
    assert.deepEqual(view.source_tasks, ['VL-1']);
    assert.equal(view.body, 'Проблема/Решение');
  });

  it('create: невалидный статус через update → ошибка', async () => {
    await handleToolCall('lesson_create', { title: 'Второй' }, testRoot);
    await assert.rejects(
      handleToolCall('lesson_update', { id: 'lesson-2', status: 'nope' }, testRoot),
      /Недопустимый статус lesson/
    );
  });

  it('list: фильтры status/tags', async () => {
    await handleToolCall('lesson_create', { title: 'Про active', status: 'active', tags: ['a', 'b'] }, testRoot);
    const all = JSON.parse(await handleToolCall('lesson_list', {}, testRoot));
    assert.ok(all.length >= 3);
    const actives = JSON.parse(await handleToolCall('lesson_list', { status: 'active' }, testRoot));
    assert.ok(actives.every(l => l.status === 'active'));
    const tagged = JSON.parse(await handleToolCall('lesson_list', { tags: ['a'] }, testRoot));
    assert.ok(tagged.every(l => l.tags.includes('a')));
  });

  it('search: substring по title/tags/body', async () => {
    const found = JSON.parse(await handleToolCall('lesson_search_lessons', { query: 'батчами' }, testRoot));
    assert.ok(found.length >= 1);
  });

  it('update: поля + content; несуществующий → ошибка', async () => {
    const out = await handleToolCall('lesson_update', { id: 'lesson-1', title: 'Тесты батчами (новое)', tags: ['tests', 'ci'] }, testRoot);
    assert.match(out, /обновлён/);
    const view = JSON.parse(await handleToolCall('lesson_view', { id: 'lesson-1' }, testRoot));
    assert.equal(view.title, 'Тесты батчами (новое)');
    assert.deepEqual(view.tags, ['tests', 'ci']);
    await assert.rejects(handleToolCall('lesson_view', { id: 'lesson-999' }, testRoot), /не найден/);
  });

  it('update: без полей → ошибка', async () => {
    await assert.rejects(handleToolCall('lesson_update', { id: 'lesson-1' }, testRoot), /Не указаны поля/);
  });

  it('VL-319: create без content → файл со скелетом (тело непустое)', async () => {
    const out = await handleToolCall('lesson_create', { title: 'Урок без тела' }, testRoot);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true, `create отвечает JSON-ack: ${out}`);
    assert.ok(ack.applied.content > 0, 'applied.content — длина непустого тела');
    const lessons = JSON.parse(await handleToolCall('lesson_list', {}, testRoot));
    const created = lessons.find(l => l.title === 'Урок без тела');
    const view = JSON.parse(await handleToolCall('lesson_view', { id: created.id }, testRoot));
    assert.match(view.body, /## Проблема/, 'скелет содержит раздел Проблема');
    assert.match(view.body, /## Решение/, 'скелет содержит раздел Решение');
    assert.match(view.body, /## Пример/, 'скелет содержит раздел Пример');
  });
});

describe('VL-153 — lesson_link + backlog_update_task lessons', () => {
  it('link add/remove синхронизирует linked_tasks ↔ task.lessons', async () => {
    await handleToolCall('backlog_create_task', { title: 'Задача для связи', labels: ['tests'] }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const taskId = tasks[0].id;

    const linked = await handleToolCall('lesson_link', { lessonId: 'lesson-1', taskId }, testRoot);
    assert.match(linked, /связан/);

    const view = JSON.parse(await handleToolCall('lesson_view', { id: 'lesson-1' }, testRoot));
    assert.deepEqual(view.linked_tasks, [taskId]);

    const task = JSON.parse(await handleToolCall('backlog_view_task', { id: taskId }, testRoot));
    assert.ok(task.lessons.includes('lesson-1'), `task.lessons: ${JSON.stringify(task.lessons)}`);

    await handleToolCall('lesson_link', { lessonId: 'lesson-1', taskId, action: 'remove' }, testRoot);
    const view2 = JSON.parse(await handleToolCall('lesson_view', { id: 'lesson-1' }, testRoot));
    assert.deepEqual(view2.linked_tasks, []);
  });

  it('link: несуществующие lesson/задача → ошибка', async () => {
    await assert.rejects(handleToolCall('lesson_link', { lessonId: 'lesson-999', taskId: 'VL-1' }, testRoot), /не найден/);
  });

  it('backlog_update_task: полная замена lessons', async () => {
    await handleToolCall('backlog_create_task', { title: 'Задача lessons' }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const taskId = tasks.find(t => t.title === 'Задача lessons').id;
    await handleToolCall('backlog_update_task', { id: taskId, lessons: ['lesson-1', 'lesson-3'] }, testRoot);
    const task = JSON.parse(await handleToolCall('backlog_view_task', { id: taskId }, testRoot));
    assert.deepEqual(task.lessons, ['lesson-1', 'lesson-3']);
  });
});

describe('VL-153 — lesson_supersede', () => {
  it('oldId → superseded, newId → active с supersedes', async () => {
    await handleToolCall('lesson_create', { title: 'Старый урок', status: 'active' }, testRoot);
    await handleToolCall('lesson_create', { title: 'Новый урок', status: 'active' }, testRoot);
    const lessons = JSON.parse(await handleToolCall('lesson_list', {}, testRoot));
    const oldId = lessons.find(l => l.title === 'Старый урок').id;
    const newId = lessons.find(l => l.title === 'Новый урок').id;
    const out = await handleToolCall('lesson_supersede', { oldId, newId }, testRoot);
    assert.match(out, /заменяет/);
    const oldView = JSON.parse(await handleToolCall('lesson_view', { id: oldId }, testRoot));
    const newView = JSON.parse(await handleToolCall('lesson_view', { id: newId }, testRoot));
    assert.equal(oldView.status, 'superseded');
    assert.equal(newView.status, 'active');
    assert.equal(newView.supersedes, oldId);
  });

  it('supersede: неизвестный id → ошибка', async () => {
    await assert.rejects(handleToolCall('lesson_supersede', { oldId: 'lesson-999', newId: 'lesson-1' }, testRoot), /не найден/);
  });
});

describe('VL-153 — backlog_search hasLessons', () => {
  it('hasLessons=true/false фильтрует по наличию lessons', async () => {
    await handleToolCall('backlog_create_task', { title: 'С lessons' }, testRoot);
    await handleToolCall('backlog_create_task', { title: 'Без lessons' }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const withL = tasks.find(t => t.title === 'С lessons').id;
    const withoutL = tasks.find(t => t.title === 'Без lessons').id;
    await handleToolCall('backlog_update_task', { id: withL, lessons: ['lesson-1'] }, testRoot);

    const withResult = JSON.parse(await handleToolCall('backlog_search', { hasLessons: true }, testRoot)).tasks;
    assert.ok(withResult.every(t => t.id !== withoutL), 'hasLessons=true не содержит задачу без lessons');
    assert.ok(withResult.some(t => t.id === withL), 'hasLessons=true содержит задачу с lessons');

    const withoutResult = JSON.parse(await handleToolCall('backlog_search', { hasLessons: false }, testRoot)).tasks;
    assert.ok(withoutResult.some(t => t.id === withoutL), 'hasLessons=false содержит задачу без lessons');
    assert.ok(withoutResult.every(t => t.id !== withL), 'hasLessons=false не содержит задачу с lessons');
  });
});
