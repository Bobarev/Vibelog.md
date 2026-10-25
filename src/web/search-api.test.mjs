/**
 * Тесты REST API глобального поиска (VL-185): GET /api/search.
 *
 * Проверяют контракт:
 * - 200 + группировка по 4 типам (tasks/lessons/references/documents);
 * - поля поиска substring/case-insensitive: задачи — title/description/id/
 *   labels, lessons — title/body/tags, references — title/url/tags,
 *   documents — title/body/type;
 * - лимиты: ≤PER_TYPE на группу, ≤TOTAL суммарно; задачи добираются до
 *   TOTAL − (lessons+references+documents);
 * - query string передаётся 5-м аргументом handleApi (server.ts отрезает
 *   '?' до вызова — риск из плана);
 * - URL-encoded кириллица; пустой q → 200 + пустые группы; без backlog → 400.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { createTaskFile } from '../../dist/core/store.js';
import { createLessonFile } from '../../dist/core/lesson.js';
import { writeReference } from '../../dist/core/reference.js';
import { writeDocument } from '../../dist/core/document.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

let cwd;
/** ВАЖНО: core-функции документов принимают backlogDir, а НЕ cwd (VL-181). */
let backlogDir;

/** GET /api/search с query string 5-м аргументом (как отдаёт server.ts). */
function search(queryString) {
  return handleApi('GET', '/api/search', null, cwd, queryString);
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-search-api-'));
  // findBacklogDir ищет вверх по дереву — фикстура в самом tmp;
  // isBacklogDir требует поддиректорию tasks (паттерн lessons-api.test.mjs)
  backlogDir = join(cwd, 'backlog');
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // createTaskFile требует backlog/config.yml (паттерн store.test.mjs)
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Search Test',
    task_prefix: 'srch',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');

  // --- Базовая группировка (query 'groupq') ---
  createTaskFile(cwd, {
    title: 'Группировка результатов',
    description: 'groupq лежит в описании этой задачи',
    status: 'To Do',
  });
  createLessonFile(cwd, {
    title: 'Урок поиска',
    content: '# Тело\n\ngroupq встречается в теле урока.',
    status: 'active',
    tags: ['поиск'],
  });
  writeReference(cwd, {
    title: 'Внешний источник',
    type: 'url',
    url: 'https://groupq.example.com/docs',
    tags: ['sources'],
    content: '# Тело\n\nИсточник.',
  });
  writeDocument(backlogDir, {
    title: 'Справочный документ',
    type: 'guide',
    tags: ['docs'],
    content: '# Тело\n\ngroupq в теле документа.',
  });
  writeDocument(backlogDir, {
    title: 'Документ с телом',
    type: 'specification',
    tags: ['docs'],
    content: '# Тело\n\nfindme-docbody в теле документа.',
  });

  // --- Поля поиска задач ---
  createTaskFile(cwd, {
    title: 'Поиск по описанию',
    description: 'findme-desc в описании',
    status: 'To Do',
  });
  createTaskFile(cwd, {
    title: 'Поиск по метке',
    labels: ['findme-label'],
    status: 'To Do',
  });
  createTaskFile(cwd, {
    id: 'VL-9001',
    title: 'Поиск по id',
    status: 'To Do',
  });

  // --- Поля поиска lessons/references ---
  createLessonFile(cwd, {
    title: 'Урок с телом',
    content: '# Тело\n\nfindme-lessonbody в теле.',
    status: 'active',
    tags: ['findme-lesstag'],
  });
  writeReference(cwd, {
    title: 'Источник с url',
    type: 'url',
    url: 'https://findme-url.example.com',
    tags: ['findme-reftag'],
    content: '# Тело\n\nИсточник.',
  });

  // --- Лимиты ---
  // mass20: 21 задача → дорастают ровно до TOTAL (20), остальных групп нет
  for (let i = 1; i <= 21; i++) {
    createTaskFile(cwd, { title: `mass20-задача-${i}`, status: 'To Do' });
  }
  // crowded: 15 «чужих» (5+5+5) + 7 задач → задач ровно 5
  for (let i = 1; i <= 7; i++) {
    createTaskFile(cwd, { title: `crowded-задача-${i}`, status: 'To Do' });
  }
  for (let i = 1; i <= 5; i++) {
    createLessonFile(cwd, {
      title: `crowded-урок-${i}`,
      content: '# Тело',
      status: 'active',
    });
    writeReference(cwd, {
      title: `crowded-источник-${i}`,
      type: 'url',
      url: `https://crowded-${i}.example.com`,
      content: '# Тело',
    });
    writeDocument(backlogDir, {
      title: `crowded-документ-${i}`,
      type: 'specification',
      content: '# Тело',
    });
  }
  // sparse: 20 задач + 2 других типа → задач ровно TOTAL − 2 = 18
  for (let i = 1; i <= 20; i++) {
    createTaskFile(cwd, { title: `sparse-задача-${i}`, status: 'To Do' });
  }
  createLessonFile(cwd, { title: 'sparse-урок', content: '# Тело', status: 'active' });
  writeDocument(backlogDir, { title: 'sparse-документ', type: 'specification', content: '# Тело' });
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/search — группировка (VL-185)', () => {
  it('200: результаты сгруппированы по 4 типам, query эхом', () => {
    const res = search('q=groupq');
    assert.equal(res.status, 200);
    assert.equal(res.body.query, 'groupq');
    assert.equal(res.body.tasks.length, 1);
    assert.equal(res.body.lessons.length, 1);
    assert.equal(res.body.references.length, 1);
    assert.equal(res.body.documents.length, 1);
  });

  it('слайм-ответ: без description/body/plan', () => {
    const res = search('q=groupq');
    const task = res.body.tasks[0];
    assert.equal('description' in task, false, 'без description');
    assert.equal('implementationPlan' in task, false, 'без plan');
    assert.equal('finalSummary' in task, false, 'без finalSummary');
    assert.equal('body' in res.body.lessons[0], false, 'без body lesson');
    assert.equal('body' in res.body.references[0], false, 'без body reference');
    assert.equal('body' in res.body.documents[0], false, 'без body document');
    // Метаданные для рендера в dropdown
    assert.equal(typeof task.status, 'string');
    assert.ok(Array.isArray(task.labels));
    assert.ok(Array.isArray(res.body.lessons[0].tags));
    assert.equal(res.body.references[0].url, 'https://groupq.example.com/docs');
    assert.equal(res.body.documents[0].type, 'guide');
  });
});

describe('GET /api/search — поля поиска (VL-185, AC2)', () => {
  it('задачи: description / labels / id (substring, case-insensitive)', () => {
    assert.equal(search('q=findme-desc').body.tasks.length, 1);
    assert.equal(search('q=FINDME-LABEL').body.tasks.length, 1, 'labels без учёта регистра');
    const byId = search('q=vl-9001');
    assert.equal(byId.body.tasks.length, 1);
    assert.equal(byId.body.tasks[0].id, 'VL-9001');
  });

  it('lessons: body / tags', () => {
    assert.equal(search('q=findme-lessonbody').body.lessons.length, 1);
    assert.equal(search('q=findme-lesstag').body.lessons.length, 1);
  });

  it('references: url / tags', () => {
    assert.equal(search('q=findme-url').body.references.length, 1);
    assert.equal(search('q=findme-reftag').body.references.length, 1);
  });

  it('documents: type / body (substring, case-insensitive)', () => {
    const byType = search('q=GUIDE');
    assert.equal(byType.body.documents.length, 1, 'type без учёта регистра');
    assert.equal(byType.body.documents[0].type, 'guide');
    assert.equal(search('q=findme-docbody').body.documents.length, 1);
  });

  it('URL-encoded кириллица в q', () => {
    // 'урок' → %D1%83%D1%80%D0%BE%D0%BA; матчит «Урок поиска»/«Урок с телом»
    const res = search('q=%D1%83%D1%80%D0%BE%D0%BA');
    assert.equal(res.status, 200);
    assert.ok(res.body.lessons.length >= 2, 'кириллический запрос находит lessons');
    assert.ok(res.body.lessons.every(l => l.title.toLowerCase().includes('урок')),
      'все найденные lessons содержат запрос');
  });
});

describe('GET /api/search — лимиты (VL-185, AC1)', () => {
  it('21 задача без других типов → ровно TOTAL (20)', () => {
    const res = search('q=mass20');
    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 20);
    assert.equal(res.body.lessons.length + res.body.references.length + res.body.documents.length, 0);
  });

  it('15 чужих + 7 задач → задач ровно 5, каждая группа ≤ PER_TYPE, сумма = 20', () => {
    const res = search('q=crowded');
    assert.equal(res.body.tasks.length, 5, 'задач добрано до TOTAL − others = 5');
    assert.equal(res.body.lessons.length, 5);
    assert.equal(res.body.references.length, 5);
    assert.equal(res.body.documents.length, 5);
    const total = res.body.tasks.length + res.body.lessons.length +
      res.body.references.length + res.body.documents.length;
    assert.equal(total, 20, 'суммарно не более TOTAL');
  });

  it('others < 15 → задачи дорастают до TOTAL − others', () => {
    const res = search('q=sparse');
    // others = 1 lesson + 1 document = 2 → задач ровно 18
    assert.equal(res.body.lessons.length, 1);
    assert.equal(res.body.documents.length, 1);
    assert.equal(res.body.references.length, 0);
    assert.equal(res.body.tasks.length, 18, 'TOTAL − others = 18');
  });
});

describe('GET /api/search — крайние случаи (VL-185)', () => {
  it('пустой q → 200 + пустые группы', () => {
    for (const qs of ['', 'q=', 'q=%20%20']) {
      const res = search(qs);
      assert.equal(res.status, 200, `qs="${qs}" → 200`);
      assert.deepEqual(res.body.tasks, []);
      assert.deepEqual(res.body.lessons, []);
      assert.deepEqual(res.body.references, []);
      assert.deepEqual(res.body.documents, []);
    }
  });

  it('без 5-го аргумента (пустой queryString) → 200 + пустые группы', () => {
    const res = handleApi('GET', '/api/search', null, cwd);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.tasks, []);
  });

  it('без backlog → 400 вместо 500', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vibelog-search-bare-'));
    try {
      const res = handleApi('GET', '/api/search', null, bare, 'q=x');
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Backlog не найден/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
