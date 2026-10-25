/**
 * Тесты REST API документов (VL-181): GET/POST /api/documents, GET/PATCH /api/documents/:id.
 *
 * Проверяют контракт страниц documents в вебе:
 * - GET список — метаданные БЕЗ тел (title/type/tags/created_date), счётчик
 *   растёт после создания;
 * - POST — 201 + id doc-N, файл существует; предвалидация → 400 (нет title,
 *   мусорный type, tags не-массив) без создания файла;
 * - GET :id — полная запись с body; 404 на неизвестный id;
 * - PATCH — обновление title/tags/content, переименование файла при смене
 *   title, валидация → 400 без записи мусора, 404 на неизвестный id;
 * - без backlog/ → 400 (findBacklogDir вернул null).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { writeDocument, getDocument } from '../../dist/core/document.js';

let cwd;
/** id созданного документа — общий для кейсов чтения/патча. */
let docId;
/** ВАЖНО: core-функции документов принимают backlogDir, а НЕ cwd (VL-181). */
let backlogDir;

/** Файлы в backlog/docs/ созданного cwd (для проверок «файл не создан»). */
function docFiles(base) {
  const dir = join(base, 'backlog', 'docs');
  return existsSync(dir) ? readdirSync(dir) : [];
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-documents-api-'));
  // findBacklogDir ищет вверх по дереву — фикстура в самом tmp;
  // isBacklogDir требует поддиректорию tasks (как в references-api.test.mjs)
  backlogDir = join(cwd, 'backlog');
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  const doc = writeDocument(backlogDir, {
    title: 'First Doc',
    type: 'guide',
    tags: ['docs', 'api'],
    content: '# Тело\n\nОписание документа.',
  });
  docId = doc.id;
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/documents (VL-181)', () => {
  it('список: 200, метаданные без body; после создания второго — счётчик растёт', () => {
    const res = handleApi('GET', '/api/documents', null, cwd);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 1);
    const item = res.body[0];
    // Тела в списке нет — экономия трафика (детальная страница грузит отдельно)
    assert.equal('body' in item, false, 'список не должен содержать body');
    assert.equal(item.document.id, docId);
    assert.equal(item.document.title, 'First Doc');
    assert.equal(item.document.type, 'guide');
    assert.deepEqual(item.document.tags, ['docs', 'api']);
    assert.ok(item.document.created_date, 'created_date присутствует');
    assert.ok(item.path, 'путь к файлу присутствует');

    // Создание второго документа — счётчик списка растёт
    const created = handleApi('POST', '/api/documents', { title: 'Second Doc' }, cwd);
    assert.equal(created.status, 201);
    const after = handleApi('GET', '/api/documents', null, cwd);
    assert.equal(after.body.length, 2);
  });
});

describe('POST /api/documents (VL-181)', () => {
  it('валидное создание → 201, id doc-N, файл существует', () => {
    const res = handleApi('POST', '/api/documents', {
      title: 'Third Doc',
      type: 'readme',
      tags: ['x'],
      content: '# Привет',
    }, cwd);
    assert.equal(res.status, 201);
    assert.match(res.body.id, /^doc-\d+$/);
    assert.equal(res.body.title, 'Third Doc');
    assert.equal(res.body.type, 'readme');
    assert.ok(res.body.created_date, 'created_date задаётся');
    const entry = getDocument(backlogDir, res.body.id);
    assert.ok(entry, 'файл документа создан');
    assert.equal(entry.body, '# Привет');
  });

  it('без title → 400, файл не создан', () => {
    const before = docFiles(cwd).length;
    const res = handleApi('POST', '/api/documents', { type: 'guide' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /заголовок/i);
    assert.equal(docFiles(cwd).length, before, 'файлов не добавилось');
  });

  it('мусорный type → 400, файл не создан', () => {
    const before = docFiles(cwd).length;
    const res = handleApi('POST', '/api/documents', { title: 'Evil', type: 'evil' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Недопустимый тип/);
    assert.equal(docFiles(cwd).length, before, 'файл не создан');
  });

  it('tags не-массив → 400, файл не создан', () => {
    const before = docFiles(cwd).length;
    const res = handleApi('POST', '/api/documents', { title: 'Evil', tags: 'nope' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /tags — массив строк/);
    assert.equal(docFiles(cwd).length, before, 'файл не создан');
  });
});

describe('GET /api/documents/:id (VL-181)', () => {
  it('детали: 200 с body', () => {
    const res = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.document.id, docId);
    assert.ok(res.body.body.includes('Описание документа'), 'тело отдаётся');
    assert.ok(res.body.path.endsWith('.md'));
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('GET', '/api/documents/doc-999', null, cwd);
    assert.equal(res.status, 404);
    assert.match(res.body.error, /не найден/);
  });
});

describe('PATCH /api/documents/:id (VL-181)', () => {
  it('валидный патч → 200, обновлены title/tags/content; смена title переименовывает файл', () => {
    const before = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    const oldPath = before.body.path;

    const res = handleApi('PATCH', `/api/documents/${docId}`, {
      title: 'Renamed Doc',
      tags: ['guide', 'new'],
      content: '# Новое тело',
    }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.document.title, 'Renamed Doc');
    assert.deepEqual(res.body.document.tags, ['guide', 'new']);
    assert.equal(res.body.body, '# Новое тело');

    // Файл на диске перезаписан и переименован, старый удалён
    const entry = getDocument(backlogDir, docId);
    assert.equal(entry.document.title, 'Renamed Doc');
    assert.equal(entry.body, '# Новое тело');
    assert.ok(!existsSync(oldPath), 'старый файл удалён при смене title');
    assert.ok(existsSync(entry.path), 'новый файл существует');
  });

  it('невалидный type → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    const res = handleApi('PATCH', `/api/documents/${docId}`, { type: 'evil' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Недопустимый тип/);
    const after = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    assert.equal(after.body.path, before.body.path, 'файл не изменён');
    assert.equal(after.body.document.title, before.body.document.title);
  });

  it('tags не-массив → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    const res = handleApi('PATCH', `/api/documents/${docId}`, { tags: 'nope' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /tags — массив строк/);
    const after = handleApi('GET', `/api/documents/${docId}`, null, cwd);
    assert.deepEqual(after.body.document.tags, before.body.document.tags);
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('PATCH', '/api/documents/doc-999', { title: 'X' }, cwd);
    assert.equal(res.status, 404);
  });
});

describe('без backlog/ (VL-181)', () => {
  it('findBacklogDir null → 400 на всех documents-хендлерах', () => {
    // Пустой tmp без backlog/ НЕ поднимается к родительским каталогам до
    // findBacklogDir: mkdtemp в системном tmp, выше backlog/ обычно нет
    const empty = mkdtempSync(join(tmpdir(), 'vibelog-documents-nobacklog-'));
    try {
      const get = handleApi('GET', '/api/documents', null, empty);
      assert.equal(get.status, 400);
      assert.match(get.body.error, /Backlog не найден/);

      const post = handleApi('POST', '/api/documents', { title: 'X' }, empty);
      assert.equal(post.status, 400);

      const detail = handleApi('GET', '/api/documents/doc-1', null, empty);
      assert.equal(detail.status, 400);

      const patch = handleApi('PATCH', '/api/documents/doc-1', { title: 'X' }, empty);
      assert.equal(patch.status, 400);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
