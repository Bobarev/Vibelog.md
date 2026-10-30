/**
 * Тесты VL-88 (git-данные для /diff) и VL-90 (git log для /commits).
 *
 * Парсеры — чистые (без git); интеграция — реальный git в mkdtemp /tmp
 * (паттерн add-comment.test.mjs), изоляция GIT_CONFIG_GLOBAL.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getGitStatus, parsePorcelain, parseNumstat, getGitLog, parseGitLog, getMergeState } from '../../dist/core/git.js';

// GIT_CONFIG_GLOBAL=/dev/null изолирует тест от глобального git-конфига
const ISO_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

describe('parsePorcelain (VL-88)', () => {
  it('modified staged (X-колонка) и unstaged (Y-колонка)', () => {
    const files = parsePorcelain('M  a.txt\n M b.txt\n');
    assert.equal(files.length, 2);
    assert.deepEqual(
      { path: files[0].path, status: files[0].status, staged: files[0].staged },
      { path: 'a.txt', status: 'Modified', staged: true }
    );
    assert.deepEqual(
      { path: files[1].path, status: files[1].status, staged: files[1].staged },
      { path: 'b.txt', status: 'Modified', staged: false }
    );
  });

  it('MM — две записи (staged не сливается с unstaged)', () => {
    const files = parsePorcelain('MM c.txt\n');
    assert.equal(files.length, 2);
    assert.equal(files[0].staged, true);
    assert.equal(files[1].staged, false);
  });

  it('untracked ?? → Untracked без метки staged', () => {
    const files = parsePorcelain('?? new.txt\n');
    assert.equal(files.length, 1);
    assert.equal(files[0].status, 'Untracked');
    assert.equal(files[0].staged, false);
  });

  it('renamed: R  old -> new → oldPath + новый путь', () => {
    const files = parsePorcelain('R  old.txt -> new.txt\n');
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'new.txt');
    assert.equal(files[0].oldPath, 'old.txt');
    assert.equal(files[0].status, 'Renamed');
    assert.equal(files[0].staged, true);
  });

  it('added/deleted статусы', () => {
    const files = parsePorcelain('A  added.txt\nD  gone.txt\n');
    assert.equal(files[0].status, 'Added');
    assert.equal(files[1].status, 'Deleted');
  });

  it('кириллица в пути (quotepath=false, кавычки снимаются)', () => {
    const files = parsePorcelain(' M "старый файл.txt"\n?? "новый файл.md"\n');
    assert.equal(files[0].path, 'старый файл.txt');
    assert.equal(files[1].path, 'новый файл.md');
  });
});

describe('parseNumstat (VL-88)', () => {
  it('обычные счётчики +N/−N по пути', () => {
    const map = parseNumstat('5\t2\tsrc/app.ts\n');
    assert.deepEqual(map.get('src/app.ts'), { additions: 5, deletions: 2 });
  });

  it('бинарник "-\t-" → 0/0', () => {
    const map = parseNumstat('-\t-\timg.png\n');
    assert.deepEqual(map.get('img.png'), { additions: 0, deletions: 0 });
  });

  it('renamed "old => new" → ключ по новому пути', () => {
    const map = parseNumstat('0\t0\told.txt => new.txt\n');
    assert.deepEqual(map.get('new.txt'), { additions: 0, deletions: 0 });
    assert.ok(!map.has('old.txt'));
  });

  it('кириллица в пути numstat', () => {
    const map = parseNumstat('3\t0\tстарый файл.txt\n');
    assert.deepEqual(map.get('старый файл.txt'), { additions: 3, deletions: 0 });
  });
});

describe('getGitStatus — интеграция с реальным git (VL-88)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-gitstatus-test-'));

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('ветка, staged/unstaged/untracked/renamed со счётчиками', () => {
    const git = (...args) =>
      spawnSync('git', args, { cwd: testRoot, encoding: 'utf-8', env: ISO_ENV });
    git('init');
    git('checkout', '-b', 'vl88-test');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(join(testRoot, 'a.txt'), '1\n2\n3\n', 'utf-8');
    writeFileSync(join(testRoot, 'b.txt'), 'x\ny\nz\n', 'utf-8');
    writeFileSync(join(testRoot, 'c.txt'), 'k\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'init');

    // staged-модификация a.txt (+2 строки)
    writeFileSync(join(testRoot, 'a.txt'), '1\n2\n3\n4\n5\n', 'utf-8');
    git('add', 'a.txt');
    // unstaged-модификация b.txt (+1 строка)
    writeFileSync(join(testRoot, 'b.txt'), 'x\ny\nz\nw\n', 'utf-8');
    // untracked с кириллицей в имени
    writeFileSync(join(testRoot, 'новый файл.md'), 'new\n', 'utf-8');
    // renamed staged
    git('mv', 'c.txt', 'c-renamed.txt');

    const status = getGitStatus(testRoot, ISO_ENV);
    assert.equal(status.branch, 'vl88-test');

    const byPath = (p) => status.files.find((f) => f.path === p);
    const a = byPath('a.txt');
    assert.ok(a, 'a.txt в статусе');
    assert.equal(a.status, 'Modified');
    assert.equal(a.staged, true, 'a.txt staged');
    assert.equal(a.additions, 2, 'a.txt +2 из cached-numstat');
    assert.equal(a.deletions, 0);

    const b = byPath('b.txt');
    assert.ok(b, 'b.txt в статусе');
    assert.equal(b.staged, false, 'b.txt unstaged');
    assert.equal(b.additions, 1, 'b.txt +1 из unstaged-numstat');

    const r = byPath('c-renamed.txt');
    assert.ok(r, 'c-renamed.txt в статусе');
    assert.equal(r.status, 'Renamed');
    assert.equal(r.oldPath, 'c.txt');
    assert.equal(r.staged, true);

    const u = byPath('новый файл.md');
    assert.ok(u, 'новый файл.md в статусе (кириллица, quotepath=false)');
    assert.equal(u.status, 'Untracked');
    assert.equal(u.additions, 0, 'untracked без numstat');
    assert.equal(u.deletions, 0);
  });

  it('не-git-директория → throw с русским сообщением', () => {
    const plain = mkdtempSync(join(tmpdir(), 'vibelog-gitstatus-nogit-'));
    try {
      assert.throws(() => getGitStatus(plain, ISO_ENV), /Git недоступен или это не git-репозиторий/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('parseGitLog (VL-90)', () => {
  it('парсит \x1f-поля: hash, author, date, subject', () => {
    const out =
      'abc123\x1fАлексей\x1f2026-10-05 18:00\x1fДобавить парсер\n' +
      'def456\x1fPavel\x1f2026-10-04 12:30\x1fИсправить баг\n';
    const commits = parseGitLog(out);
    assert.equal(commits.length, 2);
    assert.deepEqual(commits[0], {
      hash: 'abc123',
      author: 'Алексей',
      date: '2026-10-05 18:00',
      subject: 'Добавить парсер',
    });
    assert.equal(commits[1].hash, 'def456');
    assert.equal(commits[1].subject, 'Исправить баг');
  });

  it('пустой stdout → []', () => {
    assert.deepEqual(parseGitLog(''), []);
  });

  it('subject с \x1f → join остатка (защита от разрыва)', () => {
    const out = 'abc\x1fАвтор\x1f2026-10-05\x1fТема\x1fс разделителем\n';
    const commits = parseGitLog(out);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, 'Тема\x1fс разделителем');
  });
});

describe('getGitLog — интеграция с реальным git (VL-90)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-gitlog-test-'));

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  const git = (...args) =>
    spawnSync('git', args, { cwd: testRoot, encoding: 'utf-8', env: ISO_ENV });

  it('3 коммита → count=2 возвращает ровно 2, [0] — последний', () => {
    git('init');
    git('checkout', '-b', 'vl90-test');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(join(testRoot, 'a.txt'), '1\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'первый');
    writeFileSync(join(testRoot, 'b.txt'), '2\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'второй');
    writeFileSync(join(testRoot, 'c.txt'), '3\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'третий');

    const commits = getGitLog(testRoot, 2, ISO_ENV);
    assert.equal(commits.length, 2, 'count=2 → ровно 2 коммита');
    assert.equal(commits[0].subject, 'третий', '[0] — последний коммит');
    assert.ok(commits[0].hash.length > 0, 'hash непустой');
    assert.ok(commits[0].author.length > 0, 'author непустой');
  });

  it('пустой репозиторий (только git init) → []', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vibelog-gitlog-empty-'));
    try {
      const res = spawnSync('git', ['init'], { cwd: empty, encoding: 'utf-8', env: ISO_ENV });
      assert.equal(res.status, 0);
      assert.deepEqual(getGitLog(empty, 10, ISO_ENV), []);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('не-git-директория → throw /Git недоступен/', () => {
    const notGit = mkdtempSync(join(tmpdir(), 'vibelog-gitlog-nogit-'));
    try {
      assert.throws(() => getGitLog(notGit, 10, ISO_ENV), /Git недоступен/);
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  });
});

describe('getMergeState (VL-246)', () => {
  /** Минимальный git-репозиторий с одним коммитом; возвращает функцию git. */
  const initRepo = (root) => {
    const git = (...args) =>
      spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: ISO_ENV });
    git('init');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    writeFileSync(join(root, 'a.txt'), 'base\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'init');
    return git;
  };

  it('merge не идёт → inProgress=false, head="", unmerged=[]', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-mergestate-clean-'));
    try {
      initRepo(root);
      assert.deepEqual(getMergeState(root, ISO_ENV), {
        inProgress: false,
        head: '',
        unmerged: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('MERGE_HEAD есть → inProgress=true и head = sha вливаемого коммита', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-mergestate-head-'));
    try {
      const git = initRepo(root);
      const sha = git('rev-parse', 'HEAD').stdout.trim();
      // Имитируем начатый merge: git пишет MERGE_HEAD в .git/ (файл, не каталог)
      writeFileSync(join(root, '.git', 'MERGE_HEAD'), sha + '\n', 'utf-8');
      // Конфликтующих файлов нет — unmerged пуст, это тоже корректный кейс
      const state = getMergeState(root, ISO_ENV);
      assert.equal(state.inProgress, true, 'MERGE_HEAD обнаружен');
      assert.equal(state.head, sha, 'head — sha из MERGE_HEAD');
      assert.deepEqual(state.unmerged, [], 'конфликтов нет');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('не-git-директория → fail-open (не throw)', () => {
    const notGit = mkdtempSync(join(tmpdir(), 'vibelog-mergestate-nogit-'));
    try {
      assert.deepEqual(getMergeState(notGit, ISO_ENV), {
        inProgress: false,
        head: '',
        unmerged: [],
      });
    } finally {
      rmSync(notGit, { recursive: true, force: true });
    }
  });
});
