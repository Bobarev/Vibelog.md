/**
 * Тесты VL-194 — core/reference-cache: скачивание, конвертация, sync кэша.
 *
 * Сеть: только инжекция deps.fetchFn (стабы) — реальный fetch в тестах
 * отклоняется guard'ом VL-132 (src/test-setup.mjs).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  downloadText, htmlToMarkdown, classifyContentType,
  cacheReference, refreshReferenceCache, readReferenceCache, syncReferenceCaches,
  MAX_CACHE_BYTES,
} from '../../dist/core/reference-cache.js';
import {
  writeReference, getReference, updateReference, linkReferenceTask, referenceToMarkdown, markdownToReference,
} from '../../dist/core/reference.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-refcache-test-'));
const backlogDir = join(testRoot, 'backlog');
const refsDir = join(backlogDir, 'references');
const cacheDir = join(refsDir, 'cache');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** Стаб fetch: отдаёт Response с заданным телом/заголовками/статусом. */
function stubFetch(body, { status = 200, contentType = 'text/html; charset=utf-8', headers = {} } = {}) {
  const fn = async () => {
    const h = new Headers({ 'content-type': contentType, ...headers });
    return new Response(status === 200 ? body : body, { status, headers: h });
  };
  return fn;
}

const SAMPLE_HTML = [
  '<html><head><title>Page Title</title></head><body>',
  '<header>Site nav</header>',
  '<script>var x=1;</script>',
  '<style>.a{color:red}</style>',
  '<h1>Заголовок</h1>',
  '<p>Абзац с <a href="/doc">ссылкой</a> и <img src="/i.png" alt="pic">.</p>',
  '<ul><li>раз</li><li>два</li></ul>',
  '<blockquote>цитата</blockquote>',
  '<pre><code>const a = 1;</code></pre>',
  '<table><tr><th>Имя</th><th>Значение</th></tr><tr><td>a</td><td>1</td></tr></table>',
  '<footer>footer text</footer>',
  '</body></html>',
].join('\n');

// ── htmlToMarkdown / classifyContentType ──

describe('VL-194 — htmlToMarkdown: чистка и конвертация', () => {
  it('удаляет script/style/nav/footer/header/title, сохраняет контент', () => {
    const md = htmlToMarkdown(SAMPLE_HTML);
    assert.ok(!md.includes('var x=1'), `script просочился: ${md}`);
    assert.ok(!md.includes('color:red'), 'style просочился');
    assert.ok(!md.includes('Site nav'), 'header просочился');
    assert.ok(!md.includes('footer text'), 'footer просочился');
    assert.ok(!md.includes('Page Title'), 'title страницы просочился');
    assert.ok(md.includes('# Заголовок'), `h1: ${md}`);
    assert.ok(md.includes('Абзац с [ссылкой](/doc)'), `p+img: ${md}`);
    assert.ok(/^- +раз/m.test(md), `ul: ${md}`);
    assert.ok(md.includes('> цитата'), 'blockquote');
    assert.ok(md.includes('```'), 'fenced code');
    assert.ok(md.includes('[pic](/i.png)'), 'img');
    assert.ok(md.endsWith('\n'), 'завершается переводом строки');
  });

  it('GFM-таблица конвертируется в markdown-таблицу (ref-17)', () => {
    const md = htmlToMarkdown(SAMPLE_HTML);
    assert.ok(md.includes('| Имя | Значение |'), `таблица: ${md}`);
    assert.ok(md.includes('| --- | --- |'), 'разделитель таблицы');
    assert.ok(md.includes('| a | 1 |'), 'строка таблицы');
  });

  it('classifyContentType: markdown → сохранение как есть; text/* → html; бинарь → отказ', () => {
    assert.equal(classifyContentType('text/markdown; charset=utf-8'), 'markdown');
    assert.equal(classifyContentType('application/markdown'), 'markdown');
    assert.equal(classifyContentType('text/html; charset=utf-8'), 'html');
    assert.equal(classifyContentType('text/plain'), 'html');
    assert.equal(classifyContentType(''), 'html');
    assert.throws(() => classifyContentType('image/png'), /неподдерживаемый content-type/);
    assert.throws(() => classifyContentType('application/pdf'), /неподдерживаемый content-type/);
  });
});

// ── downloadText ──

describe('VL-194 — downloadText: валидация', () => {
  it('неподдерживаемая схема URL → отказ без fetch', async () => {
    await assert.rejects(downloadText('ftp://example.com/x', { fetchFn: stubFetch('x') }), /схема URL/);
    await assert.rejects(downloadText('file:///etc/passwd', { fetchFn: stubFetch('x') }), /схема URL/);
  });

  it('не-200 → отказ с кодом статуса', async () => {
    await assert.rejects(
      downloadText('https://example.com/x', { fetchFn: stubFetch('nope', { status: 404, contentType: 'text/plain' }) }),
      /HTTP 404/,
    );
  });

  it('content-length больше лимита → отказ ДО чтения тела', async () => {
    const fn = async () => new Response('x', {
      headers: { 'content-type': 'text/html', 'content-length': String(MAX_CACHE_BYTES + 1) },
    });
    await assert.rejects(downloadText('https://example.com/big', { fetchFn: fn }), /слишком большой/);
  });

  it('тело больше лимита (без content-length) → отказ после чтения', async () => {
    const big = 'a'.repeat(MAX_CACHE_BYTES + 10);
    await assert.rejects(
      downloadText('https://example.com/big2', { fetchFn: stubFetch(big, { headers: {} }) }),
      /слишком большой/,
    );
  });

  it('ок: возвращает текст и content-type', async () => {
    const res = await downloadText('https://example.com/ok', { fetchFn: stubFetch('<p>hi</p>') });
    assert.equal(res.text, '<p>hi</p>');
    assert.match(res.contentType, /text\/html/);
  });
});

// ── cacheReference / readReferenceCache ──

describe('VL-194 — cacheReference / readReferenceCache', () => {
  it('200 HTML → файл cache/<id>.md + три поля в frontmatter', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-30', title: 'Cached doc', type: 'doc', url: 'https://example.com/doc',
    });
    const res = await cacheReference(testRoot, ref, { fetchFn: stubFetch(SAMPLE_HTML) });
    assert.equal(res.cached, true, res.message);

    const cacheFile = join(cacheDir, 'ref-30.md');
    assert.ok(existsSync(cacheFile), 'файл кэша создан');
    const md = readFileSync(cacheFile, 'utf-8');
    assert.ok(md.includes('# Заголовок'), 'markdown в файле');

    const after = getReference(testRoot, 'ref-30');
    assert.equal(after.reference.cached_path, 'references/cache/ref-30.md', 'cached_path относительно backlog/');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(after.reference.cached_at), `cached_at ISO: ${after.reference.cached_at}`);
    const expectedHash = createHash('sha256').update(SAMPLE_HTML, 'utf8').digest('hex');
    assert.equal(after.reference.source_hash, expectedHash, 'source_hash = sha256 сырого HTML');

    const cached = readReferenceCache(testRoot, after.reference);
    assert.equal(cached, md, 'readReferenceCache возвращает тот же markdown');
  });

  it('markdown content-type → сохранение как есть, без конвертации', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-31', title: 'Raw md', type: 'url', url: 'https://example.com/readme.md',
    });
    const raw = '# Привет\n\nЭто **markdown**.\n';
    const res = await cacheReference(testRoot, ref, { fetchFn: stubFetch(raw, { contentType: 'text/markdown' }) });
    assert.equal(res.cached, true, res.message);
    const md = readFileSync(join(cacheDir, 'ref-31.md'), 'utf-8');
    assert.equal(md, raw, 'тело сохранено без изменений (только trim+\\n)');
  });

  it('битый content-type → cached:false, метаданные не тронуты', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-32', title: 'PNG', type: 'url', url: 'https://example.com/x.png',
    });
    const res = await cacheReference(testRoot, ref, { fetchFn: stubFetch('bin', { contentType: 'image/png' }) });
    assert.equal(res.cached, false);
    assert.match(res.message, /неподдерживаемый content-type/);
    const after = getReference(testRoot, 'ref-32');
    assert.equal(after.reference.cached_path, undefined, 'поля кэша не записаны');
  });

  it('type=repo и отсутствие url → cached:false без fetch', async () => {
    const repo = writeReference(testRoot, { id: 'ref-33', title: 'R', type: 'repo', url: 'https://example.com/r.git' });
    const r1 = await cacheReference(testRoot, repo, { fetchFn: stubFetch('x') });
    assert.equal(r1.cached, false);
    assert.match(r1.message, /не для type=repo/);

    const noUrl = writeReference(testRoot, { id: 'ref-34', title: 'N', type: 'doc' });
    const r2 = await cacheReference(testRoot, noUrl, { fetchFn: stubFetch('x') });
    assert.equal(r2.cached, false);
    assert.match(r2.message, /нет url/);
  });

  it('нет кэша → readReferenceCache null (fallback на url)', () => {
    const ref = writeReference(testRoot, { id: 'ref-35', title: 'No cache', type: 'url', url: 'https://example.com/y' });
    assert.equal(readReferenceCache(testRoot, ref), null);
  });

  it('повторное кэширование перезаписывает файл и поля (идемпотентно)', async () => {
    const ref = writeReference(testRoot, { id: 'ref-36', title: 'Re', type: 'url', url: 'https://example.com/re' });
    await cacheReference(testRoot, ref, { fetchFn: stubFetch('<p>первый</p>') });
    const ref2 = getReference(testRoot, 'ref-36').reference;
    await cacheReference(testRoot, ref2, { fetchFn: stubFetch('<p>второй</p>') });
    const md = readFileSync(join(cacheDir, 'ref-36.md'), 'utf-8');
    assert.ok(md.includes('второй'), md);
    assert.ok(!md.includes('первый'), md);
  });
});

// ── refreshReferenceCache ──

describe('VL-194 — refreshReferenceCache: сверка source_hash', () => {
  it('hash совпал → updated:false, файл не тронут', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-40', title: 'Fresh', type: 'url', url: 'https://example.com/fresh',
    });
    const first = await cacheReference(testRoot, ref, { fetchFn: stubFetch(SAMPLE_HTML) });
    assert.equal(first.cached, true);
    const before = readFileSync(join(cacheDir, 'ref-40.md'), 'utf-8');
    const mtimeBefore = readFileSync(join(refsDir, 'ref-40-Fresh.md'), 'utf-8');

    const reloaded = getReference(testRoot, 'ref-40').reference;
    const res = await refreshReferenceCache(testRoot, reloaded, { fetchFn: stubFetch(SAMPLE_HTML) });
    assert.equal(res.updated, false, res.message);
    assert.match(res.message, /без изменений/);
    assert.equal(readFileSync(join(cacheDir, 'ref-40.md'), 'utf-8'), before, 'файл не перезаписан');
    assert.equal(readFileSync(join(refsDir, 'ref-40-Fresh.md'), 'utf-8'), mtimeBefore, 'метаданные не тронуты');
  });

  it('hash изменился → updated:true, перезапись файла и полей', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-41', title: 'Changing', type: 'url', url: 'https://example.com/chg',
    });
    await cacheReference(testRoot, ref, { fetchFn: stubFetch('<p>v1</p>') });
    const reloaded = getReference(testRoot, 'ref-41').reference;
    const res = await refreshReferenceCache(testRoot, reloaded, { fetchFn: stubFetch('<p>v2</p>') });
    assert.equal(res.updated, true, res.message);
    const md = readFileSync(join(cacheDir, 'ref-41.md'), 'utf-8');
    assert.ok(md.includes('v2') && !md.includes('v1'), md);
    const after = getReference(testRoot, 'ref-41').reference;
    const newHash = createHash('sha256').update('<p>v2</p>', 'utf8').digest('hex');
    assert.equal(after.source_hash, newHash, 'source_hash обновлён');
  });

  it('кэша не было → создаёт (updated:true)', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-42', title: 'Lazy', type: 'url', url: 'https://example.com/lazy',
    });
    const res = await refreshReferenceCache(testRoot, ref, { fetchFn: stubFetch('<p>нет кэша</p>') });
    assert.equal(res.updated, true, res.message);
    assert.ok(existsSync(join(cacheDir, 'ref-42.md')));
  });

  it('битый URL → updated:false с ошибкой (не исключение наружу)', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-43', title: 'Err', type: 'url', url: 'https://example.com/err',
    });
    const failing = async () => { throw new Error('ECONNREFUSED'); };
    const res = await refreshReferenceCache(testRoot, ref, { fetchFn: failing });
    assert.equal(res.updated, false);
    assert.match(res.message, /ошибка обновления/);
  });

  it('repo/без url → пропуск без fetch', async () => {
    const ref = writeReference(testRoot, { id: 'ref-44', title: 'Skip', type: 'file', path: 'x.md' });
    const res = await refreshReferenceCache(testRoot, ref, { fetchFn: stubFetch('x') });
    assert.equal(res.updated, false);
    assert.match(res.message, /пропуск/);
  });
});

// ── syncReferenceCaches ──

describe('VL-194 — syncReferenceCaches', () => {
  it('all: кэширует url/doc/spec с url, обновляет изменившиеся, не трогает repo/file', async () => {
    // ref-30 (doc, cached SAMPLE_HTML) — hash совпадёт → skipped
    // ref-50 (url, без кэша) — создастся → updated
    // ref-51 (file) — нет url → не попадает в цели
    writeReference(testRoot, { id: 'ref-50', title: 'Newly', type: 'url', url: 'https://example.com/newly' });
    writeReference(testRoot, { id: 'ref-51', title: 'Local', type: 'file', path: 'local.md' });

    const res = await syncReferenceCaches(testRoot, { all: true }, { fetchFn: stubFetch(SAMPLE_HTML) });
    const upd = res.updated, skip = res.skipped, fail = res.failed;
    assert.ok(upd.includes('ref-50'), `updated: ${JSON.stringify(res)}`);
    assert.ok(skip.includes('ref-30'), `skipped: ${JSON.stringify(res)}`);
    assert.ok(!upd.concat(skip).includes('ref-51'), 'file-без-url не тронут');
    assert.ok(!upd.concat(skip).includes('ref-33'), 'repo не тронут');
    assert.ok(existsSync(join(cacheDir, 'ref-50.md')), 'кэш создан');
    assert.equal(fail.length, 0, `failed: ${JSON.stringify(fail)}`);
  });

  it('ids: перекачивает указанные; неизвестный id → failed', async () => {
    // ref-30 уже закэширован тем же HTML → skipped; ref-999 отсутствует
    const res = await syncReferenceCaches(testRoot, { ids: ['ref-30', 'ref-999'] }, { fetchFn: stubFetch(SAMPLE_HTML) });
    assert.ok(res.skipped.includes('ref-30'), JSON.stringify(res));
    assert.ok(res.failed.some(f => f.id === 'ref-999' && f.error === 'не найден'), JSON.stringify(res));
  });

  it('ids: [] → ничего не делает', async () => {
    const res = await syncReferenceCaches(testRoot, { ids: [] }, { fetchFn: stubFetch(SAMPLE_HTML) });
    assert.deepEqual(res, { updated: [], skipped: [], failed: [] });
  });

  it('одна ошибка не прерывает остальные', async () => {
    writeReference(testRoot, { id: 'ref-52', title: 'Good', type: 'url', url: 'https://example.com/good' });
    writeReference(testRoot, { id: 'ref-53', title: 'Bad', type: 'url', url: 'https://example.com/bad' });
    const mixed = async (url) => {
      if (String(url).includes('bad')) throw new Error('boom');
      return new Response('<p>ok</p>', { headers: { 'content-type': 'text/html' } });
    };
    const res = await syncReferenceCaches(testRoot, { ids: ['ref-52', 'ref-53'] }, { fetchFn: mixed });
    assert.ok(res.updated.includes('ref-52'), JSON.stringify(res));
    assert.ok(res.failed.some(f => f.id === 'ref-53'), JSON.stringify(res));
  });
});

// ── Регрессии модели (cached_*-поля не теряются) ──

describe('VL-194 — cached_*-поля переживают updateReference/rename/link', () => {
  it('linkReferenceTask не стирает кэш-поля', async () => {
    // Задача нужна linkReferenceTask (двусторонняя связь ссылается на неё)
    const { createTaskFile } = await import('../../dist/core/store.js');
    createTaskFile(testRoot, { id: 'tst-1', title: 'Зачатая tst-1' });
    const ref = writeReference(testRoot, {
      id: 'ref-60', title: 'Linked', type: 'url', url: 'https://example.com/linked',
    });
    await cacheReference(testRoot, ref, { fetchFn: stubFetch(SAMPLE_HTML) });
    linkReferenceTask(testRoot, 'ref-60', 'tst-1');
    const after = getReference(testRoot, 'ref-60').reference;
    assert.equal(after.cached_path, 'references/cache/ref-60.md', 'cached_path уцелел');
    assert.ok(after.cached_at, 'cached_at уцелел');
    assert.ok(after.source_hash, 'source_hash уцелел');
    assert.deepEqual(after.linked_tasks, ['tst-1'], 'связь записана');
  });

  it('смена title (rename файла) не стирает кэш-поля', async () => {
    const ref = writeReference(testRoot, {
      id: 'ref-61', title: 'Old title', type: 'url', url: 'https://example.com/ren',
    });
    await cacheReference(testRoot, ref, { fetchFn: stubFetch(SAMPLE_HTML) });
    updateReference(testRoot, 'ref-61', { title: 'New title' });
    const after = getReference(testRoot, 'ref-61').reference;
    assert.equal(after.title, 'New title');
    assert.equal(after.cached_path, 'references/cache/ref-61.md', 'cached_path при rename');
    // Файл метаданных переименован, кэш по id — на месте
    assert.ok(existsSync(join(cacheDir, 'ref-61.md')));
    assert.ok(!existsSync(join(refsDir, 'ref-61-Old-title.md')), 'старый файл удалён');
  });

  it('кэш-поля в UpdateReferenceInput перезаписываются явно', async () => {
    const ref = writeReference(testRoot, { id: 'ref-62', title: 'Upd', type: 'url', url: 'https://example.com/u' });
    updateReference(testRoot, 'ref-62', {
      cached_path: 'references/cache/ref-62.md',
      cached_at: '2026-10-26T00:00:00.000Z',
      source_hash: 'abc123',
    });
    const after = getReference(testRoot, 'ref-62').reference;
    assert.equal(after.cached_path, 'references/cache/ref-62.md');
    assert.equal(after.cached_at, '2026-10-26T00:00:00.000Z');
    assert.equal(after.source_hash, 'abc123');
  });
});

// ── Round-trip сериализации ──

describe('VL-194 — round-trip кэш-полей через frontmatter/yaml', () => {
  it('ISO cached_at (с двоеточиями) и hex-hash переживают запись/чтение', () => {
    const ref = {
      id: 'ref-70', title: 'RT', type: 'url', tags: [], created_date: '2026-10-26',
      linked_tasks: [],
      cached_path: 'references/cache/ref-70.md',
      cached_at: '2026-10-26T20:15:30.123Z',
      source_hash: createHash('sha256').update('x').digest('hex'),
    };
    const md = referenceToMarkdown(ref, 'тело');
    const parsed = markdownToReference(md);
    assert.equal(parsed.reference.cached_path, 'references/cache/ref-70.md');
    assert.equal(parsed.reference.cached_at, '2026-10-26T20:15:30.123Z');
    assert.equal(parsed.reference.source_hash, ref.source_hash);
    assert.equal(parsed.body, 'тело');
  });

  it('старый формат без кэш-полей парсится в undefined (обратная совместимость)', () => {
    const md = ['---', 'id: ref-71', 'title: Old', 'type: url', 'url: https://example.com/o',
      'tags: []', 'created_date: 2026-01-01', 'linked_tasks: []', '---', 'Описание', ''].join('\n');
    const parsed = markdownToReference(md);
    assert.equal(parsed.reference.cached_path, undefined);
    assert.equal(parsed.reference.cached_at, undefined);
    assert.equal(parsed.reference.source_hash, undefined);
    assert.equal(parsed.body.trim(), 'Описание');
  });

  it('пустые кэш-поля не попадают в frontmatter (чистый файл)', () => {
    const ref = {
      id: 'ref-72', title: 'Clean', type: 'url', tags: [], created_date: '2026-10-26', linked_tasks: [],
    };
    const md = referenceToMarkdown(ref, '');
    assert.ok(!md.includes('cached_path'), md);
    assert.ok(!md.includes('source_hash'), md);
  });
});
