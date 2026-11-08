/**
 * Тесты REST API references (VL-174): GET/PATCH /api/references[/:id], sync.
 *
 * Проверяют контракт страниц references в вебе:
 * - GET список — метаданные БЕЗ тел (type/url/path/tags/linked_tasks);
 * - GET :id — полная запись с body; 404 на неизвестный id;
 * - PATCH — обновление title/tags/url/content, валидация → 400 без записи
 *   мусора в md-файл, переименование файла при смене title;
 * - POST /api/references/sync — общий sync (клоны + кэш), VL-174/VL-358;
 *   живёт в dist/web/references-sync-api.js (async: кэш ходит в сеть);
 * - POST /api/references/:id/sync — поштучный sync, 404 на неизвестный id (VL-358).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import {
  handleReferencesSyncApi,
  humanizeSyncError,
} from '../../dist/web/references-sync-api.js';
import {
  writeReference,
  referenceCloneDir,
  markdownToReference,
} from '../../dist/core/reference.js';

/** Стаб fetch: отдаёт Response с телом/кодом (сеть в тестах запрещена, VL-132). */
function stubFetch(body, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return async () => new Response(body, {
    status,
    headers: new Headers({ 'content-type': contentType }),
  });
}

const SAMPLE_HTML = '<html><body><h1>Заголовок</h1><p>Абзац <a href="/d">ссылка</a>.</p></body></html>';

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

describe('POST /api/references/sync (VL-174, VL-358)', () => {
  it('sync идёт ДО :id-роута → 200 со SyncResult; существующий клон — skipped', async () => {
    // repo-референс с заранее созданным каталогом клона — без сети
    const repoRef = writeReference(cwd, {
      title: 'Local Repo',
      type: 'repo',
      url: 'https://example.invalid/repo.git',
      tags: [],
    });
    mkdirSync(referenceCloneDir(cwd, repoRef), { recursive: true });

    const res = await handleReferencesSyncApi('POST', '/api/references/sync', null, cwd, {
      fetchFn: stubFetch(SAMPLE_HTML),
    });
    assert.ok(res, 'sync не должен матчиться как :id (404)');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.cloned));
    assert.ok(Array.isArray(res.body.skipped));
    assert.ok(Array.isArray(res.body.failed));
    // Существующий клон пропускается
    assert.ok(res.body.skipped.includes(repoRef.id));
    assert.ok(!res.body.cache.skipped.includes(repoRef.id), 'repo не участвует в кэше');
  });

  it('VL-358: общий sync обновляет и кэш url-референсов (additive-форма)', async () => {
    const res = await handleReferencesSyncApi('POST', '/api/references/sync', null, cwd, {
      fetchFn: stubFetch(SAMPLE_HTML),
    });
    assert.ok(res);
    assert.equal(res.status, 200);
    // Прежние поля SyncResult остались в корне — старый фронт не ломается
    for (const key of ['cloned', 'skipped', 'failed', 'cache']) {
      assert.ok(key in res.body, `поле ${key} присутствует`);
    }
    assert.ok(Array.isArray(res.body.cache.updated));
    // url-референс из beforeAll (refId) закэширован в этом прогоне
    const cached = res.body.cache.updated.includes(refId) || res.body.cache.skipped.includes(refId);
    assert.ok(cached, 'url-референс участвует в sync кэша');
    assert.equal(res.body.cache.failed.length, 0);
  });

  it('VL-358: handleApi больше не обслуживает sync (единственная семантика — async)', () => {
    const res = handleApi('POST', '/api/references/sync', null, cwd);
    assert.equal(res.status, 404, 'роут перенесён в references-sync-api.ts');
  });
});

describe('POST /api/references/:id/sync (VL-358)', () => {
  it('url-референс: обновляет кэш, отдаёт свежие cached_at/source_hash', async () => {
    const res = await handleReferencesSyncApi('POST', `/api/references/${refId}/sync`, null, cwd, {
      fetchFn: stubFetch(SAMPLE_HTML),
    });
    assert.ok(res);
    assert.equal(res.status, 200);
    assert.equal(res.body.reference.id, refId);
    assert.ok(res.body.reference.cached_at, 'cached_at заполнен после sync');
    assert.ok(res.body.reference.source_hash, 'source_hash заполнен после sync');
    assert.ok(['updated', 'skipped'].includes(res.body.cache.status));
    assert.ok(existsSync(join(cwd, 'backlog', 'references', 'cache', `${refId}.md`)), 'файл кэша записан');
  });

  it('repo-референс: клон (существующий каталог → ok=false, «уже клонирован»)', async () => {
    const repoRef = writeReference(cwd, {
      title: 'Second Local Repo',
      type: 'repo',
      url: 'https://example.invalid/repo2.git',
      tags: [],
    });
    mkdirSync(referenceCloneDir(cwd, repoRef), { recursive: true });
    const res = await handleReferencesSyncApi('POST', `/api/references/${repoRef.id}/sync`, null, cwd, {});
    assert.ok(res);
    assert.equal(res.status, 200);
    assert.equal(res.body.cloned.ok, false);
    assert.match(res.body.cloned.message, /уже клонирован/);
    assert.equal(res.body.cache, undefined, 'для repo итога кэша нет');
  });

  it('неизвестный id → 404 с понятным сообщением', async () => {
    const res = await handleReferencesSyncApi('POST', '/api/references/ref-999/sync', null, cwd, {});
    assert.ok(res);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Reference не найден');
  });

  it('порядок матчинга: точный /sync не перехватывается :id-роутом', async () => {
    const exact = await handleReferencesSyncApi('GET', '/api/references/sync', null, cwd, {});
    assert.equal(exact, null, 'GET на общий sync — не наш маршрут');
    const single = await handleReferencesSyncApi('DELETE', '/api/references/ref-1/sync', null, cwd, {});
    assert.equal(single, null, 'не-POST — не наш маршрут');
  });

  it('частичная ошибка кэша: 429 humanize, остальные результаты не теряются', async () => {
    // Изолированный проект: один url-референс с двумя ссылками —
    // первая отдаётся, вторая получает 429 (частичный сбой)
    const iso = mkdtempSync(join(tmpdir(), 'vibelog-references-api-429-'));
    try {
      mkdirSync(join(iso, 'backlog', 'tasks'), { recursive: true });
      const ref = writeReference(iso, {
        title: 'Two Links',
        type: 'url',
        url: 'https://example.com/ok',
        urls: ['https://example.com/denied'],
        tags: [],
      });
      let call = 0;
      const fetchFn = async () => {
        call += 1;
        if (call === 1) return stubFetch(SAMPLE_HTML)();
        return stubFetch('rate limited', { status: 429, contentType: 'text/plain' })();
      };
      const res = await handleReferencesSyncApi('POST', '/api/references/sync', null, iso, { fetchFn });
      assert.ok(res);
      assert.equal(res.status, 200);
      // Частичный успех не теряется: референс попадает в failed кэша с
      // человекочитаемой подсказкой про лимит, а не общим «ошибок: N»
      assert.equal(res.body.cache.failed.length, 1);
      assert.equal(res.body.cache.failed[0].id, ref.id);
      assert.match(res.body.cache.failed[0].error, /лимит запросов GitVerse \(HTTP 429\), повторите позже/);
      // Клоны репозиториев при этом посчитаны отдельно (additive-форма цела)
      assert.ok(Array.isArray(res.body.cloned));
      assert.ok(Array.isArray(res.body.skipped));
    } finally {
      rmSync(iso, { recursive: true, force: true });
    }
    // humanize: 429 — подсказка, прочие коды — текст как есть
    assert.equal(humanizeSyncError('HTTP 500 Internal Server Error'), 'HTTP 500 Internal Server Error');
    assert.match(
      humanizeSyncError('Reference ref-1: ошибка обновления кэша: HTTP 429 Too Many Requests'),
      /^лимит запросов GitVerse \(HTTP 429\), повторите позже — Reference ref-1/,
    );
  });
});
