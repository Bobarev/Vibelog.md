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
import { createLessonFile, getLesson, LESSON_BODY_SKELETON } from '../../dist/core/lesson.js';
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
    await handleToolCall('lesson_create', { title: 'Второй', content: 'Тело второго урока' }, testRoot);
    await assert.rejects(
      handleToolCall('lesson_update', { id: 'lesson-2', status: 'nope' }, testRoot),
      /Недопустимый статус lesson/
    );
  });

  it('list: фильтры status/tags', async () => {
    await handleToolCall('lesson_create', { title: 'Про active', status: 'active', tags: ['a', 'b'], content: 'Тело' }, testRoot);
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

  it('update: без полей → noop (VL-369)', async () => {
    // VL-369: вызов без изменяющих аргументов — «менять нечего» (noop),
    // а не испорченный аргумент. Незаполненное тело сообщается полем missing.
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: 'lesson-1' }, testRoot));
    assert.equal(ack.noop, true, `ожидался noop: ${JSON.stringify(ack)}`);
  });

  it('VL-356: create без content через MCP → ok:true со скелетом + missing/hint; файл создан', async () => {
    const before = JSON.parse(await handleToolCall('lesson_list', {}, testRoot)).length;
    const out = await handleToolCall('lesson_create', { title: 'Урок без тела' }, testRoot);
    const ack = JSON.parse(out);
    // VL-356: жёсткий отказ VL-349 замыкал петлю (урок не создан → привязать
    // нечего → модель повторяла вызов до капа). Теперь урок создаётся со
    // скелетом, а о незаполненном теле сообщают missing/hint.
    assert.equal(ack.ok, true, `create без content — успех со скелетом: ${out}`);
    assert.ok(!ack.noop, 'это не noop');
    assert.equal(ack.missing[0].field, 'content', 'missing называет content');
    assert.equal(typeof ack.hint, 'string', 'hint со следующим шагом');
    assert.match(String(ack.message), /тело не заполнено \(скелет\)/, 'message явно говорит про скелет');
    assert.equal(typeof ack.applied.id, 'string', 'applied.id — фактический id');
    assert.equal(ack.applied.title, 'Урок без тела', 'applied.title — фактический заголовок');
    assert.equal(ack.applied.status, 'active', 'applied.status — фактический статус');
    assert.ok(ack.applied.content > 0, 'applied.content — длина тела-скелета');

    const after = JSON.parse(await handleToolCall('lesson_list', {}, testRoot)).length;
    assert.equal(after, before + 1, 'файл урока реально создан');

    // Файл на диске: тело — скелет LESSON_BODY_SKELETON
    const entry = getLesson(testRoot, ack.applied.id);
    assert.ok(entry, 'файл урока существует');
    assert.equal(entry.body.trim(), LESSON_BODY_SKELETON.trim(), 'тело — дефолтный скелет');

    // Тупика нет: сразу после создания без content привязка к задаче работает
    await handleToolCall('backlog_create_task', { title: 'Задача для скелета' }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const taskId = tasks[0].id;
    const linked = JSON.parse(await handleToolCall('lesson_link', { lessonId: ack.applied.id, taskId }, testRoot));
    assert.equal(linked.ok, true, `привязка на уроке-скелете проходит: ${JSON.stringify(linked)}`);
    const linkedView = JSON.parse(await handleToolCall('lesson_view', { id: ack.applied.id }, testRoot));
    assert.deepEqual(linkedView.linked_tasks, [taskId], 'linked_tasks записан');

    // Повтор того же вызова создаёт ВТОРОЙ урок (create не идемпотентен —
    // поведение зафиксировано, чтобы не удивляться), но не даёт серию отказов.
    const second = JSON.parse(await handleToolCall('lesson_create', { title: 'Урок без тела' }, testRoot));
    assert.equal(second.ok, true, `повтор тоже успех: ${JSON.stringify(second)}`);
    assert.notEqual(second.applied.id, ack.applied.id, 'повтор создаёт второй урок (create не идемпотентен)');

    // CLI/ядро-путь без content по-прежнему подставляет скелет (VL-319)
    const core = createLessonFile(testRoot, { title: 'Урок из CLI' });
    const coreEntry = getLesson(testRoot, core.id);
    assert.ok(coreEntry, 'ядро создало файл');
    assert.match(coreEntry.body, /## Проблема/, 'скелет: раздел Проблема');
    assert.match(coreEntry.body, /## Решение/, 'скелет: раздел Решение');
    assert.match(coreEntry.body, /## Пример/, 'скелет: раздел Пример');
  });

  it('VL-356: create с content → ok:true без missing (регресс не задет)', async () => {
    const out = await handleToolCall('lesson_create', { title: 'Урок с телом', content: '## Проблема\n\nбыло\n' }, testRoot);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true, `create с content — успех: ${out}`);
    assert.equal(ack.missing, undefined, 'missing нет — тело заполнено');
    assert.equal(ack.hint, undefined, 'hint нет');
    assert.ok(!/скелет/.test(String(ack.message)), 'message не упоминает скелет');
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
    await handleToolCall('lesson_create', { title: 'Старый урок', status: 'active', content: 'Старое тело' }, testRoot);
    await handleToolCall('lesson_create', { title: 'Новый урок', status: 'active', content: 'Новое тело' }, testRoot);
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
