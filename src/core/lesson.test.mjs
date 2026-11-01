/**
 * Тесты VL-153 — core/lesson: CRUD, поиск, двусторонняя связь, supersede,
 * loadLessonsForTask (подбор по tags задачи).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  LESSON_STATUSES, normalizeLessonStatus, lessonFilename,
  createLesson, lessonToMarkdown, markdownToLesson,
  listLessons, getLesson, createLessonFile, updateLesson,
  searchLessons, linkLesson, supersedeLesson, loadLessonsForTask,
} from '../../dist/core/lesson.js';
import { parseFrontmatter } from '../../dist/core/frontmatter.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-lesson-test-'));
const backlogDir = join(testRoot, 'backlog');
const lessonsDir = join(backlogDir, 'lessons');

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

// ── Типы и сериализация ──

describe('VL-153 — типы и сериализация', () => {
  it('LESSON_STATUSES: active, needs-review, outdated, superseded', () => {
    assert.deepEqual(LESSON_STATUSES, ['active', 'needs-review', 'outdated', 'superseded']);
  });

  it('normalizeLessonStatus: case-insensitive, ошибка для мусора', () => {
    assert.equal(normalizeLessonStatus('ACTIVE'), 'active');
    assert.equal(normalizeLessonStatus('Outdated'), 'outdated');
    assert.throws(() => normalizeLessonStatus('banana'), /Недопустимый статус lesson/);
  });

  it('lessonFilename: lesson-N-<slug>.md', () => {
    assert.equal(lessonFilename('lesson-1', 'Медленные тесты spawn'), 'lesson-1-Медленные-тесты-spawn.md');
    assert.equal(lessonFilename('lesson-2', ''), 'lesson-2.md');
  });

  it('round-trip: lessonToMarkdown → markdownToLesson', () => {
    const lesson = createLesson({
      id: 'lesson-100', title: 'Test', status: 'active',
      tags: ['tests', 'ci'], source_tasks: ['VL-1'], linked_tasks: ['VL-2'],
      created_date: '2026-10-14', updated_date: '2026-10-14', supersedes: '',
    });
    const md = lessonToMarkdown(lesson, 'Проблема / Решение');
    const parsed = markdownToLesson(md);
    assert.deepEqual(parsed.lesson, lesson);
    assert.equal(parsed.body, 'Проблема / Решение');
  });

  it('createLesson: дефолтный status=active, supersedes=', () => {
    const lesson = createLesson({ title: 'X' });
    assert.equal(lesson.status, 'active');
    assert.equal(lesson.supersedes, '');
    assert.deepEqual(lesson.tags, []);
  });
});

// ── CRUD ──

describe('VL-153 — CRUD lessons', () => {
  it('createLessonFile: id lesson-N генерируется, даты — сегодня, файл создан', () => {
    const lesson = createLessonFile(testRoot, { title: 'Первый урок', tags: ['a'] });
    assert.equal(lesson.id, 'lesson-1');
    assert.match(lesson.created_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(lesson.updated_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(existsSync(join(lessonsDir, 'lesson-1-Первый-урок.md')), 'файл создан');
  });

  it('getLesson: case-insensitive; listLessons — все записи', () => {
    createLessonFile(testRoot, { title: 'Второй', tags: ['b'] });
    const found = getLesson(testRoot, 'LESSON-1');
    assert.ok(found);
    assert.equal(found.lesson.title, 'Первый урок');
    assert.equal(listLessons(testRoot).length, 2);
  });

  it('getLesson: несуществующий → null', () => {
    assert.equal(getLesson(testRoot, 'lesson-999'), null);
  });

  it('updateLesson: поля + переименование файла при смене title + updated_date', () => {
    const updated = updateLesson(testRoot, 'lesson-2', { title: 'Второй (новый)', tags: ['x'], status: 'outdated' });
    assert.ok(updated);
    assert.equal(updated.lesson.title, 'Второй (новый)');
    assert.equal(updated.lesson.status, 'outdated');
    assert.deepEqual(updated.lesson.tags, ['x']);
    assert.ok(existsSync(join(lessonsDir, 'lesson-2-Второй-новый.md')), 'файл переименован');
    assert.ok(!existsSync(join(lessonsDir, 'lesson-2-Второй.md')), 'старый файл удалён');
  });

  it('updateLesson: несуществующий → null', () => {
    assert.equal(updateLesson(testRoot, 'lesson-777', { title: 'x' }), null);
  });
});

// ── Поиск ──

describe('VL-153 — searchLessons', () => {
  beforeAll(() => {
    createLessonFile(testRoot, {
      id: 'lesson-10', title: 'Spawn медленные тесты', status: 'active',
      tags: ['tests', 'ci'], content: 'Запускай батчами по 10',
    });
    createLessonFile(testRoot, {
      id: 'lesson-11', title: 'YAML парсинг', status: 'active',
      tags: ['yaml'], content: 'Проверяй кодировку',
    });
  });

  it('substring по id/title/tags/body', () => {
    assert.equal(searchLessons(testRoot, 'Spawn').length, 1);
    assert.equal(searchLessons(testRoot, 'yaml').length, 1);
    assert.equal(searchLessons(testRoot, 'батчами').length, 1);
    assert.equal(searchLessons(testRoot, 'nonexistent-needle').length, 0);
  });

  it('пустой запрос → все lessons', () => {
    assert.ok(searchLessons(testRoot, '').length >= 4);
  });
});

// ── Двусторонняя связь ──

describe('VL-153 — linkLesson (двусторонняя связь)', () => {
  async function makeTask(id, labels = []) {
    const { createTaskFile } = await import('../../dist/core/store.js');
    mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
    createTaskFile(testRoot, { id, title: `Зачатая ${id}`, labels });
  }

  it('add: linked_tasks ↔ task.lessons синхронны; add идемпотентен', async () => {
    await makeTask('VL-420');
    const lesson = createLessonFile(testRoot, { title: 'Link test', tags: ['link'] });
    assert.equal(linkLesson(testRoot, lesson.id, 'VL-420', 'add'), true);

    assert.deepEqual(getLesson(testRoot, lesson.id).lesson.linked_tasks, ['VL-420']);

    const { getTask } = await import('../../dist/core/store.js');
    const task = getTask(testRoot, 'VL-420');
    assert.ok(task.lessons.includes(lesson.id), 'task.lessons содержит lessonId');

    linkLesson(testRoot, lesson.id, 'VL-420', 'add');
    assert.deepEqual(getLesson(testRoot, lesson.id).lesson.linked_tasks, ['VL-420']);
    assert.equal(getTask(testRoot, 'VL-420').lessons.filter(l => l === lesson.id).length, 1);
  });

  it('remove: связь убирается из обоих полей', async () => {
    await makeTask('VL-421');
    const lesson = createLessonFile(testRoot, { title: 'Remove test' });
    linkLesson(testRoot, lesson.id, 'VL-421', 'add');
    linkLesson(testRoot, lesson.id, 'VL-421', 'remove');
    assert.deepEqual(getLesson(testRoot, lesson.id).lesson.linked_tasks, []);
    const { getTask } = await import('../../dist/core/store.js');
    assert.ok(!getTask(testRoot, 'VL-421').lessons.includes(lesson.id));
  });

  it('ошибка при неизвестном lesson или задаче', () => {
    assert.throws(() => linkLesson(testRoot, 'lesson-999', 'VL-420'), /не найден/);
    assert.throws(() => linkLesson(testRoot, 'lesson-1', 'VL-999'), /не найдена/);
  });
});

// ── Supersede ──

describe('VL-153 — supersedeLesson', () => {
  it('oldId → superseded, newId → active с supersedes', () => {
    const oldL = createLessonFile(testRoot, { title: 'Старый урок', status: 'active' });
    const newL = createLessonFile(testRoot, { title: 'Новый урок', status: 'outdated' });
    supersedeLesson(testRoot, oldL.id, newL.id);
    assert.equal(getLesson(testRoot, oldL.id).lesson.status, 'superseded');
    const nw = getLesson(testRoot, newL.id).lesson;
    assert.equal(nw.status, 'active');
    assert.equal(nw.supersedes, oldL.id);
  });

  it('ошибка при неизвестном id или совпадении', () => {
    assert.throws(() => supersedeLesson(testRoot, 'lesson-999', 'lesson-1'), /не найден/);
    assert.throws(() => supersedeLesson(testRoot, 'lesson-1', 'lesson-1'), /сам себя/);
  });
});

// ── loadLessonsForTask ──

describe('VL-153 — loadLessonsForTask', () => {
  async function makeTask(id, labels = []) {
    const { createTaskFile } = await import('../../dist/core/store.js');
    createTaskFile(testRoot, { id, title: `T ${id}`, labels });
  }

  it('подбирает active lessons с теми же tags (по labels задачи)', async () => {
    await makeTask('VL-500', ['tests', 'perf']);
    createLessonFile(testRoot, {
      id: 'lesson-50', title: 'Тесты батчами', status: 'active', tags: ['tests'],
    });
    createLessonFile(testRoot, {
      id: 'lesson-51', title: 'Не про тесты', status: 'active', tags: ['other'],
    });
    const res = loadLessonsForTask(testRoot, 'VL-500');
    assert.ok(res.includes('- [lesson-50] Тесты батчами'), 'нашёл совпавший по tags');
    assert.ok(!res.some(r => r.includes('lesson-51')), 'не подставил чужой tags');
  });

  it('НЕ подставляет не-active (outdated/superseded)', async () => {
    await makeTask('VL-501', ['stale']);
    createLessonFile(testRoot, { id: 'lesson-52', title: 'Устаревший', status: 'outdated', tags: ['stale'] });
    assert.deepEqual(loadLessonsForTask(testRoot, 'VL-501'), []);
  });

  it('нет tags у задачи → []; нет совпадений → []; нет задачи → []', async () => {
    await makeTask('VL-502', []);
    assert.deepEqual(loadLessonsForTask(testRoot, 'VL-502'), []);
    await makeTask('VL-503', ['zzz-no-match']);
    assert.deepEqual(loadLessonsForTask(testRoot, 'VL-503'), []);
    assert.deepEqual(loadLessonsForTask(testRoot, 'VL-NOPE'), []);
  });
});

// ── frontmatter: supersedes и полный набор полей ──

describe('VL-153 — frontmatter поля', () => {
  it('полный набор полей присутствует и round-trip стабилен', () => {
    const lesson = createLesson({
      id: 'lesson-200', title: 'Полный', status: 'active',
      tags: ['a'], source_tasks: ['VL-1'], linked_tasks: ['VL-2'],
      created_date: '2026-01-01', updated_date: '2026-01-02', supersedes: 'lesson-199',
    });
    const { data } = parseFrontmatter(lessonToMarkdown(lesson, ''));
    for (const key of ['id', 'title', 'status', 'tags', 'source_tasks', 'linked_tasks', 'created_date', 'updated_date', 'supersedes']) {
      assert.ok(key in data, `поле ${key} есть во frontmatter`);
    }
    assert.equal(data.supersedes, 'lesson-199');
    assert.deepEqual(markdownToLesson(lessonToMarkdown(lesson, '')).lesson, lesson);
  });
});
