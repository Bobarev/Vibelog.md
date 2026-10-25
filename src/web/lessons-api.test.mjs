/**
 * Тесты REST API lessons (VL-182): GET/PATCH /api/lessons[/:id].
 *
 * Проверяют контракт страниц lessons в вебе:
 * - GET список — метаданные БЕЗ тел (id/title/status/tags);
 * - GET :id — полная запись с body; 404 на неизвестный id;
 * - PATCH — обновление title/tags/status/content, валидация → 400 без записи
 *   мусора в md-файл, переименование файла при смене title;
 * - 400 при отсутствии backlog на всех трёх хендлерах (паттерн VL-181).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { createLessonFile, markdownToLesson } from '../../dist/core/lesson.js';

let cwd;
/** id созданного lesson — общий для всех кейсов. */
let lessonId;
/** id второй записи — для проверки 404 на неизвестном id хватает lesson-999. */

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-lessons-api-'));
  // findBacklogDir ищет вверх по дереву — фикстура должна быть в самом tmp;
  // isBacklogDir требует поддиректорию tasks (как в references-api.test.mjs)
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  const lesson = createLessonFile(cwd, {
    title: 'Первый урок',
    status: 'active',
    tags: ['web', 'ui'],
    source_tasks: ['VL-153'],
    linked_tasks: ['VL-174'],
    content: '# Тело\n\nОписание урока.',
  });
  lessonId = lesson.id;
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/lessons (VL-182)', () => {
  it('список: 200, метаданные без body', () => {
    const res = handleApi('GET', '/api/lessons', null, cwd);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 1);
    const item = res.body[0];
    // Тела в списке нет — экономия трафика (детальная страница грузит отдельно)
    assert.equal('body' in item, false, 'список не должен содержать body');
    assert.equal(item.lesson.id, lessonId);
    assert.equal(item.lesson.title, 'Первый урок');
    assert.equal(item.lesson.status, 'active');
    assert.deepEqual(item.lesson.tags, ['web', 'ui']);
    assert.deepEqual(item.lesson.source_tasks, ['VL-153']);
    assert.deepEqual(item.lesson.linked_tasks, ['VL-174']);
    assert.ok(item.path.endsWith('.md'), 'путь к файлу заканчивается .md');
  });
});

describe('GET /api/lessons/:id (VL-182)', () => {
  it('детали: 200 с body', () => {
    const res = handleApi('GET', `/api/lessons/${lessonId}`, null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.lesson.id, lessonId);
    assert.ok(res.body.body.includes('Описание урока'), 'тело отдаётся');
    assert.ok(res.body.path.endsWith('.md'));
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('GET', '/api/lessons/lesson-999', null, cwd);
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Lesson не найден/);
  });
});

describe('PATCH /api/lessons/:id (VL-182)', () => {
  it('валидный патч → 200, файл обновлён, смена title переименовывает файл', () => {
    const before = handleApi('GET', `/api/lessons/${lessonId}`, null, cwd);
    const oldPath = before.body.path;

    const res = handleApi('PATCH', `/api/lessons/${lessonId}`, {
      title: 'Переименованный урок',
      tags: ['core'],
      status: 'outdated',
      content: '# Новое тело',
    }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.lesson.title, 'Переименованный урок');
    assert.deepEqual(res.body.lesson.tags, ['core']);
    assert.equal(res.body.lesson.status, 'outdated');
    assert.equal(res.body.body, '# Новое тело');

    // Файл на диске реально перезаписан и переименован, старый удалён
    const { lesson, body } = markdownToLesson(readFileSync(res.body.path, 'utf-8'));
    assert.equal(lesson.title, 'Переименованный урок');
    assert.equal(lesson.status, 'outdated');
    assert.deepEqual(lesson.tags, ['core']);
    assert.equal(body, '# Новое тело');
    assert.ok(!existsSync(oldPath), 'старый файл удалён при смене title');
    assert.ok(existsSync(res.body.path), 'новый файл существует');
    // updated_date обновляется при любом патче (семантика updateLesson)
    assert.equal(lesson.updated_date, new Date().toISOString().slice(0, 10));
  });

  it('невалидный status → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/lessons/${lessonId}`, null, cwd);
    const snapshot = readFileSync(before.body.path, 'utf-8');

    const res = handleApi('PATCH', `/api/lessons/${lessonId}`, { status: 'evil' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Недопустимый статус/);
    assert.equal(readFileSync(before.body.path, 'utf-8'), snapshot, 'файл не изменён');
  });

  it('tags не-массив → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/lessons/${lessonId}`, null, cwd);
    const snapshot = readFileSync(before.body.path, 'utf-8');
    const res = handleApi('PATCH', `/api/lessons/${lessonId}`, { tags: 'nope' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /tags — массив строк/);
    assert.equal(readFileSync(before.body.path, 'utf-8'), snapshot);
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('PATCH', '/api/lessons/lesson-999', { title: 'X' }, cwd);
    assert.equal(res.status, 404);
  });
});

describe('без backlog (VL-182/паттерн VL-181)', () => {
  it('все три хендлера → 400 вместо 500', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vibelog-lessons-bare-'));
    try {
      for (const [method, url, body] of [
        ['GET', '/api/lessons', null],
        ['GET', '/api/lessons/lesson-1', null],
        ['PATCH', '/api/lessons/lesson-1', { title: 'X' }],
      ]) {
        const res = handleApi(method, url, body, bare);
        assert.equal(res.status, 400, `${method} ${url} → 400 без backlog`);
        assert.match(res.body.error, /Backlog не найден/);
      }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
