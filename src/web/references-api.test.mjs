/**
 * Тесты REST API references (VL-174): GET/PATCH /api/references[/:id], sync.
 *
 * Проверяют контракт страниц references в вебе:
 * - GET список — метаданные БЕЗ тел (type/url/path/tags/linked_tasks);
 * - GET :id — полная запись с body; 404 на неизвестный id;
 * - PATCH — обновление title/tags/url/content, валидация → 400 без записи
 *   мусора в md-файл, переименование файла при смене title;
 * - POST sync — SyncResult-форма и приоритет роута sync перед :id
 *   (sync не матчится как id задачи).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import {
  writeReference,
  referenceCloneDir,
  markdownToReference,
} from '../../dist/core/reference.js';

let cwd;
/** id созданной записи — общий для всех кейсов. */
let refId;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-references-api-'));
  // findBacklogDir ищет вверх по дереву — фикстура должна быть в самом tmp;
  // isBacklogDir требует поддиректорию tasks (как в reference.test.mjs)
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  const ref = writeReference(cwd, {
    title: 'First Source',
    type: 'url',
    url: 'https://example.com/docs',
    tags: ['docs', 'api'],
    linked_tasks: ['VL-1'],
    content: '# Тело\n\nОписание источника.',
  });
  refId = ref.id;
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/references (VL-174)', () => {
  it('список: 200, метаданные без body', () => {
    const res = handleApi('GET', '/api/references', null, cwd);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 1);
    const item = res.body[0];
    // Тела в списке нет — экономия трафика (детальная страница грузит отдельно)
    assert.equal('body' in item, false, 'список не должен содержать body');
    assert.equal(item.reference.id, refId);
    assert.equal(item.reference.type, 'url');
    assert.equal(item.reference.url, 'https://example.com/docs');
    assert.deepEqual(item.reference.tags, ['docs', 'api']);
    assert.deepEqual(item.reference.linked_tasks, ['VL-1']);
    assert.ok(item.path, 'путь к файлу присутствует');
  });
});

describe('GET /api/references/:id (VL-174)', () => {
  it('детали: 200 с body', () => {
    const res = handleApi('GET', `/api/references/${refId}`, null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.reference.id, refId);
    assert.ok(res.body.body.includes('Описание источника'), 'тело отдаётся');
    assert.ok(res.body.path.endsWith('.md'));
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('GET', '/api/references/ref-999', null, cwd);
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/references/:id (VL-174)', () => {
  it('валидный патч → 200, файл обновлён, смена title переименовывает файл', () => {
    const before = handleApi('GET', `/api/references/${refId}`, null, cwd);
    const oldPath = before.body.path;

    const res = handleApi('PATCH', `/api/references/${refId}`, {
      title: 'Renamed Source',
      tags: ['guide'],
      url: 'https://example.com/renamed',
      content: '# Новое тело',
    }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.reference.title, 'Renamed Source');
    assert.deepEqual(res.body.reference.tags, ['guide']);
    assert.equal(res.body.body, '# Новое тело');

    // Файл на диске реально перезаписан и переименован, старый удалён
    const { reference, body } = markdownToReference(readFileSync(res.body.path, 'utf-8'));
    assert.equal(reference.title, 'Renamed Source');
    assert.deepEqual(reference.tags, ['guide']);
    assert.equal(body, '# Новое тело');
    assert.ok(!existsSync(oldPath), 'старый файл удалён при смене title');
    assert.ok(existsSync(res.body.path), 'новый файл существует');
  });

  it('невалидный type → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/references/${refId}`, null, cwd);
    const snapshot = readFileSync(before.body.path, 'utf-8');

    const res = handleApi('PATCH', `/api/references/${refId}`, { type: 'evil' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Недопустимый тип/);
    assert.equal(readFileSync(before.body.path, 'utf-8'), snapshot, 'файл не изменён');
  });

  it('tags не-массив → 400, файл не меняется', () => {
    const before = handleApi('GET', `/api/references/${refId}`, null, cwd);
    const snapshot = readFileSync(before.body.path, 'utf-8');
    const res = handleApi('PATCH', `/api/references/${refId}`, { tags: 'nope' }, cwd);
    assert.equal(res.status, 400);
    assert.equal(readFileSync(before.body.path, 'utf-8'), snapshot);
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('PATCH', '/api/references/ref-999', { title: 'X' }, cwd);
    assert.equal(res.status, 404);
  });
});

describe('POST /api/references/sync (VL-174)', () => {
  it('sync идёт ДО :id-роута → 200 со SyncResult; существующий клон — skipped', () => {
    // repo-референс с заранее созданным каталогом клона — без сети
    const repoRef = writeReference(cwd, {
      title: 'Local Repo',
      type: 'repo',
      url: 'https://example.invalid/repo.git',
      tags: [],
    });
    mkdirSync(referenceCloneDir(cwd, repoRef), { recursive: true });

    const res = handleApi('POST', '/api/references/sync', null, cwd);
    assert.equal(res.status, 200, 'sync не должен матчиться как :id (404)');
    assert.ok(Array.isArray(res.body.cloned));
    assert.ok(Array.isArray(res.body.skipped));
    assert.ok(Array.isArray(res.body.failed));
    // Существующий клон пропускается; url-референс (refId) не участвует
    assert.ok(res.body.skipped.includes(repoRef.id));
    assert.ok(!res.body.skipped.includes(refId), 'type=url не попадает в sync');
    assert.equal(res.body.failed.length, 0, 'без сетевых ошибок');
  });
});
