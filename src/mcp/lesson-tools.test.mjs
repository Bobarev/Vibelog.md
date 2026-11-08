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
import { clearPhaseEnv } from '../test-env.mjs';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-mcp-lesson-test-'));
const backlogDir = join(testRoot, 'backlog');

/** Фазовый env агентской сессии на время файла (VL-374, in-process handleToolCall). */
let restorePhaseEnv;

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
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
  restorePhaseEnv();
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
  it('create: создаёт lesson, view — метаданные + склеенное тело', async () => {
    const out = await handleToolCall('lesson_create', {
      title: 'Тесты батчами', tags: ['tests'], sourceTasks: ['VL-1'],
      problem: 'проблема', solution: 'решение',
    }, testRoot);
    assert.match(out, /Lesson lesson-1 создан/);
    const view = JSON.parse(await handleToolCall('lesson_view', { id: 'lesson-1' }, testRoot));
    assert.equal(view.title, 'Тесты батчами');
    assert.equal(view.status, 'active');
    assert.deepEqual(view.tags, ['tests']);
    assert.deepEqual(view.source_tasks, ['VL-1']);
    // VL-379: сервер склеивает тело из частей
    assert.equal(view.body, '## Проблема\nпроблема\n\n## Решение\nрешение\n');
  });

  it('create: невалидный статус через update → ошибка', async () => {
    await handleToolCall('lesson_create', { title: 'Второй', problem: 'п', solution: 'р' }, testRoot);
    await assert.rejects(
      handleToolCall('lesson_update', { id: 'lesson-2', status: 'nope' }, testRoot),
      /Недопустимый статус lesson/
    );
  });

  it('list: фильтры status/tags', async () => {
    await handleToolCall('lesson_create', { title: 'Про active', status: 'active', tags: ['a', 'b'], problem: 'п', solution: 'р' }, testRoot);
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

  it('update: поля + тело; несуществующий → ошибка', async () => {
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

  // VL-379 (AC3): тело склеивается с заголовками; example опускается, если не передан.
  it('VL-379: create с problem+solution+example → тело с тремя разделами', async () => {
    const out = await handleToolCall('lesson_create', {
      title: 'Урок со примером', problem: 'было так', solution: 'стало так', example: 'пример кода',
    }, testRoot);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true, `create с частями — успех: ${out}`);
    assert.equal(ack.missing, undefined, 'missing нет — тело заполнено');
    const view = JSON.parse(await handleToolCall('lesson_view', { id: ack.applied.id }, testRoot));
    assert.match(view.body, /## Проблема/, 'раздел Проблема');
    assert.match(view.body, /было так/);
    assert.match(view.body, /## Решение/, 'раздел Решение');
    assert.match(view.body, /стало так/);
    assert.match(view.body, /## Пример/, 'раздел Пример');
    assert.match(view.body, /пример кода/);
  });

  it('VL-379: create без example → раздел «## Пример» опущен', async () => {
    const ack = JSON.parse(await handleToolCall('lesson_create', {
      title: 'Урок без примера', problem: 'было', solution: 'стало',
    }, testRoot));
    const view = JSON.parse(await handleToolCall('lesson_view', { id: ack.applied.id }, testRoot));
    assert.match(view.body, /## Проблема/);
    assert.match(view.body, /## Решение/);
    assert.ok(!view.body.includes('## Пример'), `без example раздела нет: ${JSON.stringify(view.body)}`);
  });

  it('VL-379 (AC7): create без problem/solution → ok:false, файл НЕ создан', async () => {
    // Регресс agent-1794146250210: урок-скелет был неустранимым дефектом.
    // Теперь урок без тела создать нельзя — отказ до записи.
    const before = JSON.parse(await handleToolCall('lesson_list', {}, testRoot)).length;
    const out = await handleToolCall('lesson_create', { title: 'Урок без тела' }, testRoot);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, false, `create без тела — отказ: ${out}`);
    assert.match(String(ack.error), /problem/, 'отказ называет problem');
    assert.deepEqual(ack.missing.map(m => m.field), ['problem', 'solution'], 'missing называет оба поля');
    assert.equal(typeof ack.hint, 'string', 'hint со следующим шагом');
    assert.equal(ack.retryWith.problem, '<что было не так>', 'retryWith — три строки, без markdown');
    assert.equal(ack.retryWith.solution, '<что сделали>');
    const after = JSON.parse(await handleToolCall('lesson_list', {}, testRoot)).length;
    assert.equal(after, before, 'файл урока не создан');
  });

  it('VL-379: create с пустым problem → отказ (пробелы не считаются телом)', async () => {
    const out = await handleToolCall('lesson_create', { title: 'Урок с пустым problem', problem: '   ', solution: 'р' }, testRoot);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, false, `ожидался отказ: ${out}`);
    assert.deepEqual(ack.missing.map(m => m.field), ['problem']);
  });

  it('VL-379 (AC4): переданный content → skipped с причиной «поле удалено», урок создан по частям', async () => {
    const ack = JSON.parse(await handleToolCall('lesson_create', {
      title: 'Урок с лишним content', problem: 'п', solution: 'р', content: '## Проблема\n\nстарое\n',
    }, testRoot));
    assert.equal(ack.ok, true, `create проходит: ${JSON.stringify(ack)}`);
    assert.equal(ack.skipped.length, 1, 'content попал в skipped');
    assert.equal(ack.skipped[0].field, 'content');
    assert.match(String(ack.skipped[0].reason), /поле удалено/, 'причина объясняет замену');
    const view = JSON.parse(await handleToolCall('lesson_view', { id: ack.applied.id }, testRoot));
    assert.ok(!view.body.includes('старое'), 'переданный content не записан');
  });

  it('VL-379: update с problem+solution → полная замена тела файла', async () => {
    const created = JSON.parse(await handleToolCall('lesson_create', { title: 'Урок на замену', problem: 'старое', solution: 'старое решение' }, testRoot));
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: created.applied.id, problem: 'новое', solution: 'новое решение', example: 'пример',
    }, testRoot));
    assert.equal(ack.ok, true, `update проходит: ${JSON.stringify(ack)}`);
    const view = JSON.parse(await handleToolCall('lesson_view', { id: created.applied.id }, testRoot));
    assert.match(view.body, /новое/);
    assert.ok(!view.body.includes('старое'), 'тело заменено целиком');
    assert.match(view.body, /## Пример/);
  });

  it('VL-379: update {content} без частей → skipped + noop (поле удалено)', async () => {
    const created = JSON.parse(await handleToolCall('lesson_create', { title: 'Урок с content в update', problem: 'п', solution: 'р' }, testRoot));
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: created.applied.id, content: '## Проблема\n\nx\n',
    }, testRoot));
    assert.equal(ack.noop, true, `менять нечего — noop: ${JSON.stringify(ack)}`);
    assert.equal(ack.skipped[0].field, 'content');
    assert.match(String(ack.skipped[0].reason), /поле удалено/);
  });

  it('VL-379: update только example без problem/solution → отказ', async () => {
    const created = JSON.parse(await handleToolCall('lesson_create', { title: 'Урок про example', problem: 'п', solution: 'р' }, testRoot));
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: created.applied.id, example: 'пример' }, testRoot));
    assert.equal(ack.ok, false, `ожидался отказ: ${JSON.stringify(ack)}`);
    assert.equal(ack.missing[0].field, 'problem');
  });

  it('VL-319: CLI/ядро-путь без content по-прежнему подставляет скелет', async () => {
    // VL-379: скелет остался ТОЛЬКО у ядра/CLI (живой человек может сохранить черновик).
    const core = createLessonFile(testRoot, { title: 'Урок из CLI' });
    const coreEntry = getLesson(testRoot, core.id);
    assert.ok(coreEntry, 'ядро создало файл');
    assert.equal(coreEntry.body.trim(), LESSON_BODY_SKELETON.trim(), 'тело — скелет');
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
    await handleToolCall('lesson_create', { title: 'Старый урок', status: 'active', problem: 'старое', solution: 'старое решение' }, testRoot);
    await handleToolCall('lesson_create', { title: 'Новый урок', status: 'active', problem: 'новое', solution: 'новое решение' }, testRoot);
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
