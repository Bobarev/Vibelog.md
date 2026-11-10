/**
 * Тесты VL-152 — core/reference: CRUD, поиск, двусторонняя связь, clone/sync.
 *
 * Clone/sync тестируются на ЛОКАЛЬНОМ git-репозитории (git init в mkdtemp,
 * file:// URL) — реальная сеть запрещена test-setup guard'ом (VL-132).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  REFERENCE_TYPES, normalizeReferenceType, referenceFilename,
  createReference, referenceToMarkdown, markdownToReference,
  listReferences, getReference, writeReference, updateReference,
  removeReference, searchReferences, findByPath, findByTask,
  cloneReferenceRepo, syncReferenceRepos, linkReferenceTask,
  pullReferenceRepo, diffReferenceClone, referenceCloneDir,
  referenceUrls,
} from '../../dist/core/reference.js';
import { parseFrontmatter } from '../../dist/core/frontmatter.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-reference-test-'));
const backlogDir = join(testRoot, 'backlog');
const refsDir = join(backlogDir, 'references');

/** GIT_CONFIG_GLOBAL=/dev/null изолирует git-тесты от глобального конфига. */
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // Минимальный конфиг — нужен createTaskFile (двусторонняя связь)
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

// ── Типы и сериализация ──

describe('VL-152 — типы и сериализация', () => {
  it('REFERENCE_TYPES: repo, url, file, doc, spec, experiment', () => {
    // VL-294: добавлен тип experiment — ссылка на карточку эксперимента
    assert.deepEqual(REFERENCE_TYPES, ['repo', 'url', 'file', 'doc', 'spec', 'experiment']);
  });

  it('normalizeReferenceType: case-insensitive, ошибка для мусора', () => {
    assert.equal(normalizeReferenceType('REPO'), 'repo');
    assert.equal(normalizeReferenceType('Url'), 'url');
    assert.throws(() => normalizeReferenceType('banana'), /Недопустимый тип reference/);
  });

  it('referenceFilename: <id>-<slug>.md', () => {
    // Точка в «Backlog.md» удаляется без разделителя — как в documentFilename
    assert.equal(referenceFilename('ref-1', 'Backlog.md original'), 'ref-1-Backlogmd-original.md');
    assert.equal(referenceFilename('ref-2', ''), 'ref-2.md');
  });

  it('round-trip: referenceToMarkdown → markdownToReference', () => {
    const ref = createReference({
      id: 'ref-100', title: 'Test', type: 'repo',
      url: 'file:///nonexistent/x.invalid.git', tags: ['a', 'b'],
      created_date: '2026-10-14', linked_tasks: ['VL-1'],
    });
    const md = referenceToMarkdown(ref, 'Описание');
    const parsed = markdownToReference(md);
    assert.deepEqual(parsed.reference, ref);
    assert.equal(parsed.body, 'Описание');
  });

  it('пустые url/path опускаются во frontmatter', () => {
    const ref = createReference({ id: 'ref-101', title: 'T', type: 'file' });
    const { data } = parseFrontmatter(referenceToMarkdown(ref, ''));
    assert.ok(!('url' in data), 'url опущен');
    assert.ok(!('path' in data), 'path опущен');
    assert.deepEqual(data.linked_tasks, []);
  });
});

// ── CRUD ──

describe('VL-152 — CRUD references', () => {
  it('writeReference: id ref-N генерируется, created_date — сегодня', () => {
    const ref = writeReference(testRoot, { title: 'First', type: 'repo', url: 'file:///nonexistent/a.invalid.git' });
    assert.equal(ref.id, 'ref-1');
    assert.match(ref.created_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(existsSync(join(refsDir, 'ref-1-First.md')), 'файл создан');
  });

  it('getReference: case-insensitive, listReferences — все записи', () => {
    writeReference(testRoot, { title: 'Second', type: 'url', url: 'https://x.example/b' });
    const found = getReference(testRoot, 'REF-1');
    assert.ok(found);
    assert.equal(found.reference.title, 'First');
    assert.equal(listReferences(testRoot).length, 2);
  });

  it('getReference: несуществующий → null', () => {
    assert.equal(getReference(testRoot, 'ref-999'), null);
  });

  it('updateReference: поля + переименование файла при смене title', () => {
    const updated = updateReference(testRoot, 'ref-2', { title: 'Second Renamed', tags: ['x'] });
    assert.ok(updated);
    assert.equal(updated.reference.title, 'Second Renamed');
    assert.deepEqual(updated.reference.tags, ['x']);
    assert.ok(existsSync(join(refsDir, 'ref-2-Second-Renamed.md')), 'файл переименован');
    assert.ok(!existsSync(join(refsDir, 'ref-2-Second.md')), 'старый файл удалён');
  });

  it('removeReference: true при удалении, false для несуществующего', () => {
    const ref = writeReference(testRoot, { title: 'Temp', type: 'doc' });
    assert.equal(removeReference(testRoot, ref.id), true);
    assert.equal(getReference(testRoot, ref.id), null);
    assert.equal(removeReference(testRoot, 'ref-777'), false);
  });
});

// ── Поиск ──

describe('VL-152 — searchReferences / findByPath / findByTask', () => {
  beforeAll(() => {
    writeReference(testRoot, {
      id: 'ref-10', title: 'vibe-kanban', type: 'repo',
      url: 'file:///nonexistent/vibe-kanban.invalid.git', path: 'data/vibe-kanban',
      tags: ['kanban', 'ui'], content: 'Референс канбан-доски',
    });
    writeReference(testRoot, {
      id: 'ref-11', title: 'Node fs docs', type: 'url',
      url: 'https://nodejs.org/api/fs.html', tags: ['node'],
    });
  });

  it('searchReferences: substring по title/url/tags/body', () => {
    assert.equal(searchReferences(testRoot, 'kanban').length, 1); // title+tag ref-10
    assert.equal(searchReferences(testRoot, 'nodejs.org').length, 1);
    assert.equal(searchReferences(testRoot, 'Референс канбан').length, 1);
    assert.equal(searchReferences(testRoot, 'nonexistent-needle').length, 0);
  });

  it('findByPath: файл внутри клона → ref с path', () => {
    const found = findByPath(testRoot, '/Users/x/proj/backlog/references/data/vibe-kanban/src/board.ts');
    assert.equal(found.length, 1);
    assert.equal(found[0].reference.id, 'ref-10');
  });

  it('findByPath: сам каталог клона (обратное направление)', () => {
    const found = findByPath(testRoot, 'backlog/references/data/vibe-kanban');
    assert.equal(found.length, 1);
  });

  it('findByTask: linked_tasks содержит taskId', () => {
    updateReference(testRoot, 'ref-10', { linked_tasks: ['VL-42', 'VL-56'] });
    assert.equal(findByTask(testRoot, 'vl-42').length, 1);
    assert.equal(findByTask(testRoot, 'VL-99').length, 0);
  });
});

// ── Двусторонняя связь ──

describe('VL-152 — linkReferenceTask (двусторонняя связь)', () => {
  /** Создаёт минимальную задачу через core store (без CLI). */
  async function makeTask(id) {
    const { createTaskFile } = await import('../../dist/core/store.js');
    mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
    createTaskFile(testRoot, { id, title: `Зачатая ${id}` });
  }

  it('add: linked_tasks ↔ task.references синхронны; add идемпотентен', async () => {
    await makeTask('VL-420');
    const ref = writeReference(testRoot, { title: 'Link test', type: 'spec' });
    assert.equal(linkReferenceTask(testRoot, ref.id, 'VL-420', 'add'), true);

    const entry = getReference(testRoot, ref.id);
    assert.deepEqual(entry.reference.linked_tasks, ['VL-420']);

    const { getTask } = await import('../../dist/core/store.js');
    const task = getTask(testRoot, 'VL-420');
    assert.ok(task.references.includes(ref.id), 'task.references содержит refId');

    // Идемпотентность: повторный add не дублирует
    linkReferenceTask(testRoot, ref.id, 'VL-420', 'add');
    assert.deepEqual(getReference(testRoot, ref.id).reference.linked_tasks, ['VL-420']);
    assert.equal(getTask(testRoot, 'VL-420').references.filter(r => r === ref.id).length, 1);
  });

  it('remove: связь убирается из обоих полей', async () => {
    await makeTask('VL-421');
    const ref = writeReference(testRoot, { title: 'Unlink test', type: 'spec' });
    linkReferenceTask(testRoot, ref.id, 'VL-421', 'add');
    linkReferenceTask(testRoot, ref.id, 'VL-421', 'remove');
    assert.deepEqual(getReference(testRoot, ref.id).reference.linked_tasks, []);
    const { getTask } = await import('../../dist/core/store.js');
    assert.ok(!(getTask(testRoot, 'VL-421').references || []).includes(ref.id));
  });

  it('ошибки: нет reference или нет задачи', async () => {
    await makeTask('VL-422');
    assert.throws(() => linkReferenceTask(testRoot, 'ref-999', 'VL-422'), /Reference ref-999 не найден/);
    const ref = writeReference(testRoot, { title: 'Err test', type: 'spec' });
    assert.throws(() => linkReferenceTask(testRoot, ref.id, 'VL-999'), /Задача VL-999 не найдена/);
  });
});

// ── Clone / sync (локальный git, без сети) ──

describe('VL-152 — cloneReferenceRepo / syncReferenceRepos', () => {
  /** Локальный «удалённый» репозиторий для file://-клонирования. */
  const remoteDir = join(testRoot, 'remote-src');
  const remoteUrl = 'file://' + remoteDir;

  beforeAll(() => {
    // VL-225: к моменту sync в refsDir не должно остаться type=repo записей
    // с внешними https:// URL (AC-1): git clone зависал до 120 с на офлайн-DNS.
    // Фикстуры выше уже не https, но фильтр гарантирует AC независимо от
    // будущих тестов, добавляющих repo-фикстуры до sync-блока.
    for (const entry of listReferences(testRoot)) {
      if (entry.reference.type === 'repo' && /^https?:\/\//.test(entry.reference.url || '')) {
        removeReference(testRoot, entry.reference.id);
      }
    }
    mkdirSync(remoteDir, { recursive: true });
    writeFileSync(join(remoteDir, 'README.md'), '# Remote\n');
    const git = (args) => {
      const res = spawnSync('git', args, { cwd: remoteDir, encoding: 'utf-8', env: gitEnv });
      assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
    };
    git(['init']);
    git(['add', '.']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '--no-gpg-sign']);
  });

  it('clone: клонирует в data/<dir>, идемпотентно пропускает существующее', () => {
    const ref = writeReference(testRoot, {
      id: 'ref-20', title: 'Local clone', type: 'repo', url: remoteUrl, path: 'data/local-src',
    });
    const first = cloneReferenceRepo(testRoot, ref, gitEnv);
    assert.equal(first.cloned, true, first.message);
    assert.ok(existsSync(join(refsDir, 'data', 'local-src', 'README.md')));

    const second = cloneReferenceRepo(testRoot, ref, gitEnv);
    assert.equal(second.cloned, false);
    assert.match(second.message, /уже клонирован/);
  });

  it('clone: ошибка клона не роняет, возвращает сообщение', () => {
    const ref = writeReference(testRoot, {
      id: 'ref-21', title: 'Bad clone', type: 'repo', url: 'file:///nonexistent/path-xyz', path: 'data/bad',
    });
    const res = cloneReferenceRepo(testRoot, ref, gitEnv);
    assert.equal(res.cloned, false);
    assert.match(res.message, /ошибка клонирования/);
  });

  it('clone: только type=repo и только с url', () => {
    const urlRef = writeReference(testRoot, { id: 'ref-22', title: 'U', type: 'url', url: remoteUrl });
    assert.match(cloneReferenceRepo(testRoot, urlRef, gitEnv).message, /только для type=repo/);
    const noUrl = writeReference(testRoot, { id: 'ref-23', title: 'N', type: 'repo' });
    assert.match(cloneReferenceRepo(testRoot, noUrl, gitEnv).message, /нет url/);
  });

  it('sync: cloned/skipped/failed собираются, одна ошибка не прерывает', () => {
    const res = syncReferenceRepos(testRoot, gitEnv);
    // ref-20 уже клонирован → skipped; ref-21 битый → failed; ref-23 без url → failed
    assert.ok(res.skipped.includes('ref-20'), `skipped: ${JSON.stringify(res)}`);
    const failedIds = res.failed.map(f => f.id);
    assert.ok(failedIds.includes('ref-21'), 'ref-21 в failed');
    assert.ok(failedIds.includes('ref-23'), 'ref-23 в failed');

    // Свежий repo клонируется через sync
    writeReference(testRoot, {
      id: 'ref-24', title: 'Sync clone', type: 'repo', url: remoteUrl, path: 'data/sync-src',
    });
    const res2 = syncReferenceRepos(testRoot, gitEnv);
    assert.ok(res2.cloned.includes('ref-24'), `cloned: ${JSON.stringify(res2)}`);
    assert.ok(existsSync(join(refsDir, 'data', 'sync-src', 'README.md')));
  });

  it('removeReference НЕ удаляет клон в data/', () => {
    assert.equal(removeReference(testRoot, 'ref-20'), true);
    assert.ok(existsSync(join(refsDir, 'data', 'local-src', 'README.md')), 'клон сохранён');
  });

// ── VL-291: множественные url (urls) ──
describe('VL-291 — несколько URL у reference', () => {
  it('round-trip: url + urls (2 доп. ссылки)', () => {
    const ref = createReference({
      id: 'ref-90', title: 'Multi', type: 'url',
      url: 'https://a.example/1', urls: ['https://b.example/2', 'https://c.example/3'],
      created_date: '2026-01-01',
    });
    assert.deepEqual(ref.urls, ['https://b.example/2', 'https://c.example/3']);
    const md = referenceToMarkdown(ref, 'тело');
    const parsed = markdownToReference(md);
    assert.equal(parsed.reference.url, 'https://a.example/1');
    assert.deepEqual(parsed.reference.urls, ['https://b.example/2', 'https://c.example/3']);
    assert.deepEqual(referenceUrls(parsed.reference), [
      'https://a.example/1', 'https://b.example/2', 'https://c.example/3',
    ], 'порядок ссылок сохранён');
  });

  it('одиночный url: frontmatter без ключа urls (обратная совместимость)', () => {
    const ref = createReference({ id: 'ref-91', title: 'Single', type: 'url', url: 'https://a.example/1' });
    assert.equal(ref.urls, undefined);
    const md = referenceToMarkdown(ref, '');
    assert.ok(!md.includes('urls:'), md);
    const parsed = markdownToReference(md);
    assert.equal(parsed.reference.urls, undefined);
    assert.deepEqual(referenceUrls(parsed.reference), ['https://a.example/1']);
  });

  it('urls без url: первая ссылка продвигается в url', () => {
    const ref = createReference({ id: 'ref-92', title: 'Promote', type: 'url', urls: ['https://a/1', 'https://b/2'] });
    assert.equal(ref.url, 'https://a/1');
    assert.deepEqual(ref.urls, ['https://b/2']);
  });

  it('дедуп и trim доп. ссылок, дубль первой отбрасывается', () => {
    const ref = createReference({
      id: 'ref-93', title: 'Dedup', type: 'url',
      url: 'https://a/1',
      urls: [' https://a/1 ', '', '  ', 'https://b/2', 'https://b/2'],
    });
    assert.deepEqual(ref.urls, ['https://b/2']);
  });

  it('updateReference({title}) НЕ теряет urls (регрессия merge)', () => {
    const created = writeReference(testRoot, {
      id: 'ref-94', title: 'Keep', type: 'url',
      url: 'https://a/1', urls: ['https://b/2', 'https://c/3'],
    });
    assert.deepEqual(created.urls, ['https://b/2', 'https://c/3']);
    const updated = updateReference(testRoot, 'ref-94', { title: 'Keep renamed' });
    assert.ok(updated);
    assert.deepEqual(updated.reference.urls, ['https://b/2', 'https://c/3'], 'urls пережили rename');
    // link/teg-апдейт тоже не должен стирать urls
    const linked = updateReference(testRoot, 'ref-94', { tags: ['x'] });
    assert.deepEqual(linked.reference.urls, ['https://b/2', 'https://c/3']);
    // сохранение на диск + чтение
    const reread = getReference(testRoot, 'ref-94');
    assert.deepEqual(reread.reference.urls, ['https://b/2', 'https://c/3']);
  });

  it('updateReference({urls: []}) очищает доп. ссылки', () => {
    writeReference(testRoot, { id: 'ref-95', title: 'Clear', type: 'url', url: 'https://a/1', urls: ['https://b/2'] });
    const cleared = updateReference(testRoot, 'ref-95', { urls: [] });
    assert.equal(cleared.reference.urls, undefined);
    const md = readFileSync(getReference(testRoot, 'ref-95').path, 'utf-8');
    assert.ok(!md.includes('urls:'), md);
  });

  it('searchReferences находит по дополнительной ссылке', () => {
    writeReference(testRoot, { id: 'ref-96', title: 'Searchable', type: 'url', url: 'https://a/1', urls: ['https://unique-host-96.example/x'] });
    const found = searchReferences(testRoot, 'unique-host-96');
    assert.ok(found.some(e => e.reference.id === 'ref-96'), JSON.stringify(found.map(e => e.reference.id)));
  });
});

// ── VL-417: pull существующего клона + diff ──

describe('VL-417 — pullReferenceRepo / diffReferenceClone', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-reference-pull-'));
  const bl = join(root, 'backlog');
  const bare = join(root, 'remote-bare.git');
  const work = join(root, 'upstream-work');

  /** git в каталоге; падение — ошибка теста. */
  const git = (args, cwd) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf-8', env: gitEnv });
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout ?? '';
  };

  /** Коммит + push в bare из рабочего репозитория upstream. */
  const commitAndPush = (message) => {
    git(['add', '-A'], work);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message, '--no-gpg-sign'], work);
    git(['push', 'origin', 'HEAD:master'], work);
  };

  const taskFile = (id, status) => [
    '---',
    `id: ${id}`,
    `title: Задача ${id}`,
    `status: ${status}`,
    'created_date: 2026-01-01',
    '---',
    '',
    'Описание.',
    '',
  ].join('\n');

  beforeAll(() => {
    mkdirSync(join(bl, 'tasks'), { recursive: true });
    writeFileSync(join(bl, 'config.yml'), stringifyYaml({
      project_name: 'Pull', task_prefix: 'vl', default_status: 'To Do',
      statuses: ['To Do', 'In Progress', 'Done'], definition_of_done: [],
    }), 'utf-8');

    // bare-«удалённый» + рабочий upstream с задачами/документами/решениями
    mkdirSync(bare, { recursive: true });
    git(['init', '-q', '--bare'], bare);
    mkdirSync(work, { recursive: true });
    git(['init', '-q'], work);
    git(['checkout', '-q', '-b', 'master'], work);
    mkdirSync(join(work, 'backlog', 'tasks'), { recursive: true });
    mkdirSync(join(work, 'backlog', 'docs'), { recursive: true });
    mkdirSync(join(work, 'backlog', 'decisions'), { recursive: true });
    writeFileSync(join(work, 'backlog', 'tasks', 'VL-1 - one.md'), taskFile('VL-1', 'To Do'), 'utf-8');
    writeFileSync(join(work, 'backlog', 'docs', 'doc-1-guide.md'), '# Гайд\n', 'utf-8');
    writeFileSync(join(work, 'backlog', 'decisions', 'decision-1-x.md'), '# ADR\n', 'utf-8');
    git(['remote', 'add', 'origin', bare], work);
    commitAndPush('init');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('первый sync = клон; повторный pull без изменений → changed: false', () => {
    const ref = writeReference(root, {
      id: 'ref-70', title: 'Pull repo', type: 'repo',
      url: 'file://' + bare, path: 'data/pull-src',
    });
    const first = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(first.pulled, true, first.message);
    assert.equal(first.changed, true, first.message);

    const second = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(second.pulled, true, second.message);
    assert.equal(second.changed, false, second.message);
    assert.match(second.message, /без изменений/);
  });

  it('pull с изменениями: changed: true, diff видит новую задачу и документ', () => {
    const ref = getReference(root, 'ref-70').reference;
    const dir = referenceCloneDir(root, ref);
    const before = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', env: gitEnv }).stdout.trim();

    writeFileSync(join(work, 'backlog', 'tasks', 'VL-2 - two.md'), taskFile('VL-2', 'To Do'), 'utf-8');
    writeFileSync(join(work, 'backlog', 'docs', 'doc-2-new.md'), '# Новый\n', 'utf-8');
    commitAndPush('add task and doc');

    const res = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(res.pulled, true, res.message);
    assert.equal(res.changed, true, res.message);

    const after = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', env: gitEnv }).stdout.trim();
    const diff = diffReferenceClone(dir, before, after);
    assert.deepEqual(diff.tasks.added, ['VL-2'], JSON.stringify(diff));
    assert.deepEqual(diff.documents.added, ['doc-2'], JSON.stringify(diff));
    assert.deepEqual(diff.tasks.removed, []);
  });

  it('diff: смена статуса задачи (from/to) и удалённая задача', () => {
    const ref = getReference(root, 'ref-70').reference;
    const dir = referenceCloneDir(root, ref);
    const before = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', env: gitEnv }).stdout.trim();

    writeFileSync(join(work, 'backlog', 'tasks', 'VL-1 - one.md'), taskFile('VL-1', 'Done'), 'utf-8');
    rmSync(join(work, 'backlog', 'tasks', 'VL-2 - two.md'));
    commitAndPush('status change and removal');

    const res = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(res.changed, true, res.message);
    const after = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', env: gitEnv }).stdout.trim();
    const diff = diffReferenceClone(dir, before, after);
    assert.deepEqual(diff.tasks.statusChanged, [{ id: 'VL-1', from: 'To Do', to: 'Done' }], JSON.stringify(diff));
    assert.deepEqual(diff.tasks.removed, ['VL-2'], JSON.stringify(diff));
  });

  it('diff: пустой diff (before === after) — все массивы пусты', () => {
    const ref = getReference(root, 'ref-70').reference;
    const dir = referenceCloneDir(root, ref);
    const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf-8', env: gitEnv }).stdout.trim();
    const diff = diffReferenceClone(dir, head, head);
    assert.deepEqual(diff, {
      tasks: { added: [], removed: [], statusChanged: [] },
      documents: { added: [], removed: [] },
      decisions: { added: [], removed: [] },
    });
  });

  it('локальные незакоммиченные правки → pull падает, текст git проброшен, правки целы', () => {
    const ref = getReference(root, 'ref-70').reference;
    const dir = referenceCloneDir(root, ref);
    const localPath = join(dir, 'backlog', 'tasks', 'VL-1 - one.md');
    writeFileSync(localPath, taskFile('VL-1', 'In Progress'), 'utf-8');

    // В upstream меняем тот же файл — pull --ff-only обязан упасть
    writeFileSync(
      join(work, 'backlog', 'tasks', 'VL-1 - one.md'),
      taskFile('VL-1', 'Done') + '\nДополнительная строка upstream.\n',
      'utf-8',
    );
    commitAndPush('conflicting change');

    const res = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(res.pulled, false, res.message);
    assert.equal(res.changed, false);
    assert.match(res.message, /git pull --ff-only/);
    assert.match(res.message, /удалите каталог клона/);
    // Локальная правка не потеряна (никакого reset/checkout)
    assert.match(readFileSync(localPath, 'utf-8'), /In Progress/);
  });

  it('каталог без .git → failed с подсказкой, каталог не удаляется', () => {
    const ref = writeReference(root, {
      id: 'ref-71', title: 'Not a repo', type: 'repo',
      url: 'file://' + bare, path: 'data/not-git',
    });
    const dir = referenceCloneDir(root, ref);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'keep.txt'), 'x', 'utf-8');

    const res = pullReferenceRepo(root, ref, gitEnv);
    assert.equal(res.pulled, false);
    assert.match(res.message, /не git-репозиторий/);
    assert.match(res.message, /удалите/);
    assert.ok(existsSync(join(dir, 'keep.txt')), 'каталог не удалён');
  });

  it('syncReferenceRepos: updated/skipped/failed и diffs', () => {
    // ref-70 с локальной правкой → failed; ref-71 без .git → failed
    const res = syncReferenceRepos(root, gitEnv);
    const failedIds = res.failed.map(f => f.id);
    assert.ok(failedIds.includes('ref-70'), JSON.stringify(res));
    assert.ok(failedIds.includes('ref-71'), JSON.stringify(res));
    assert.ok(Array.isArray(res.updated));
    assert.ok(Array.isArray(res.skipped));
    assert.equal(typeof res.diffs, 'object');
  });
});
});
