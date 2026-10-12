/**
 * Тесты VL-107 — git-worktree для параллельной разработки задач.
 *
 * Интеграция — реальный git в mkdtemp /tmp (паттерн git.test.mjs): init +
 * commit, затем ensure/build на временных ветках. Глобальный git-конфиг
 * изолируется (ISO_ENV), локальный user задаётся в temp-репо.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  taskBranchName,
  taskWorktreeDir,
  ensureTaskWorktree,
  buildTaskWorktree,
  worktreeCliPath,
} from '../../dist/core/worktree.js';

// GIT_CONFIG_GLOBAL=/dev/null изолирует тест от глобального git-конфига
const ISO_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

/** Создаёт temp git-репо с одним коммитом (HEAD обязателен для worktree add). */
function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: ISO_ENV });
  git('init');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'README.md'), 'init\n', 'utf-8');
  // .vibelog/ в .gitignore — как в реальном проекте (VL-107: worktree в
  // .vibelog/worktrees не должен засорять git status главного репо)
  writeFileSync(join(root, '.gitignore'), '.vibelog/\n', 'utf-8');
  git('add', '-A');
  git('commit', '-m', 'init');
  return { root, git };
}

describe('taskBranchName / taskWorktreeDir (VL-107)', () => {
  it('VL-107 → vb/vl-107, регистр ID не важен', () => {
    assert.equal(taskBranchName('VL-107'), 'vb/vl-107');
    assert.equal(taskBranchName('vl-7'), 'vb/vl-7');
  });

  it('путь worktree: <cwd>/.vibelog/worktrees/<id в нижнем регистре>', () => {
    assert.equal(
      taskWorktreeDir('/repo', 'VL-107'),
      join('/repo', '.vibelog', 'worktrees', 'vl-107')
    );
  });
});

describe('ensureTaskWorktree — интеграция с реальным git (VL-107)', () => {
  const repos = [];
  after(() => {
    for (const r of repos) rmSync(r, { recursive: true, force: true });
  });

  it('создаёт ветку vb/vl-N и worktree от HEAD; git status главного репо чист', () => {
    const { root, git } = makeRepo('vibelog-worktree-create-');
    repos.push(root);
    const dir = ensureTaskWorktree(root, 'VL-1');
    assert.equal(dir, taskWorktreeDir(root, 'VL-1'));
    assert.ok(existsSync(join(dir, '.git')), '.git в worktree (файл worktree)');
    assert.ok(existsSync(join(dir, 'README.md')), 'контент HEAD скопирован');
    // worktree на нужной ветке
    const branch = spawnSync('git', ['-C', dir, 'branch', '--show-current'], {
      encoding: 'utf-8',
      env: ISO_ENV,
    });
    assert.equal(branch.stdout.trim(), 'vb/vl-1');
    // ветка существует в главном репо
    const ref = git('rev-parse', '--verify', '--quiet', 'refs/heads/vb/vl-1');
    assert.equal(ref.status, 0);
    // git status главного репо не засорён worktree (untracked в .gitignore нет,
    // но .vibelog/worktrees — вложенный worktree, git status его не показывает
    // как незнакомые файлы: worktree зарегистрирован). Проверяем отсутствие
    // изменений tracked-файлов:
    const status = git('status', '--porcelain');
    assert.equal(status.stdout.trim(), '', `главное дерево чистое, got: ${status.stdout}`);
  });

  it('идемпотентность: повторный ensure возвращает тот же путь', () => {
    const { root } = makeRepo('vibelog-worktree-idem-');
    repos.push(root);
    const a = ensureTaskWorktree(root, 'VL-2');
    const b = ensureTaskWorktree(root, 'VL-2');
    assert.equal(a, b);
  });

  it('reuse существующей ветки: ветка есть, worktree нет → worktree на ней', () => {
    const { root, git } = makeRepo('vibelog-worktree-reuse-');
    repos.push(root);
    git('branch', 'vb/vl-3');
    const dir = ensureTaskWorktree(root, 'VL-3');
    const branch = spawnSync('git', ['-C', dir, 'branch', '--show-current'], {
      encoding: 'utf-8',
      env: ISO_ENV,
    });
    assert.equal(branch.stdout.trim(), 'vb/vl-3');
  });

  it('не-git директория → throw с русским сообщением', () => {
    const plain = mkdtempSync(join(tmpdir(), 'vibelog-worktree-nogit-'));
    repos.push(plain);
    assert.throws(
      () => ensureTaskWorktree(plain, 'VL-4'),
      /Не удалось создать worktree для VL-4/
    );
  });

  it('worktree на чужой ветке в нужной директории → throw с подсказкой', () => {
    const { root, git } = makeRepo('vibelog-worktree-mismatch-');
    repos.push(root);
    // Симуляция: worktree уже стоит в директории vl-5, но ветка переименована
    const dir = taskWorktreeDir(root, 'VL-5');
    mkdirSync(join(root, '.vibelog', 'worktrees'), { recursive: true });
    git('worktree', 'add', '-b', 'vb/vl-5', dir, 'HEAD');
    git('-C', dir, 'branch', '-m', 'vb/vl-5', 'vb/other');
    assert.throws(() => ensureTaskWorktree(root, 'VL-5'), /worktree на ветке vb\/other/);
  });

  it('симлинки node_modules/refs из главного репо в worktree (VL-107 fix)', () => {
    const { root } = makeRepo('vibelog-worktree-links-');
    repos.push(root);
    // Каталоги-dev в главном репо (в реальном проекте — gitignored)
    mkdirSync(join(root, 'node_modules', 'dummy-pkg'), { recursive: true });
    mkdirSync(join(root, 'refs', 'Backlog.md', 'backlog'), { recursive: true });
    const dir = ensureTaskWorktree(root, 'VL-8');
    // Симлинки созданы и указывают на каталоги главного репо
    for (const name of ['node_modules', 'refs']) {
      const link = join(dir, name);
      assert.ok(lstatSync(link).isSymbolicLink(), `${name} — симлинк в worktree`);
      assert.equal(readlinkSync(link), join(root, name));
    }
    // Контент доступен через симлинк (тесты worktree так и читают refs)
    assert.ok(existsSync(join(dir, 'refs', 'Backlog.md', 'backlog')));
    // Идемпотентность: повторный ensure не падает на существующих симлинках
    assert.equal(ensureTaskWorktree(root, 'VL-8'), dir);
  });

  it('без node_modules/refs в главном репо — симлинки не создаются (VL-107 fix)', () => {
    const { root } = makeRepo('vibelog-worktree-nolinks-');
    repos.push(root);
    const dir = ensureTaskWorktree(root, 'VL-9');
    assert.ok(!existsSync(join(dir, 'node_modules')), 'node_modules не создан из пустоты');
    assert.ok(!existsSync(join(dir, 'refs')), 'refs не создан из пустоты');
  });
});

describe('buildTaskWorktree (VL-107)', () => {
  const repos = [];
  after(() => {
    for (const r of repos) rmSync(r, { recursive: true, force: true });
  });

  it('нет node_modules/typescript → throw с подсказкой pnpm install', () => {
    const { root } = makeRepo('vibelog-worktree-nots-');
    repos.push(root);
    ensureTaskWorktree(root, 'VL-6');
    assert.throws(() => buildTaskWorktree(root, 'VL-6'), /typescript не найден.*pnpm install/);
  });

  // Полная сборка: temp-репо с минималистичным tsconfig/src/bin + симлинк на
  // node_modules главного проекта (tsc берётся оттуда, @types резолвится
  // walk-up из worktree через tempRoot/node_modules). Guard: без typescript
  // в окружении разработчика тест пропускается (паттерн плана VL-107).
  const realTsc = join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js');
  it('собирает worktree: dist/cli/router.js создан, stale-dist удалён', { skip: !existsSync(realTsc) }, () => {
    const { root, git } = makeRepo('vibelog-worktree-build-');
    repos.push(root);
    // Минимальный проект в temp-репо (структура src/cli + bin — как проверка
    // existsSync(dist/cli/router.js) в buildTaskWorktree)
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          rootDir: 'src',
          outDir: 'dist',
          strict: true,
          noEmitOnError: true,
        },
        include: ['src/**/*'],
      }),
      'utf-8'
    );
    mkdirSync(join(root, 'src', 'cli'), { recursive: true });
    writeFileSync(join(root, 'src', 'cli', 'router.ts'), 'export const ok = true;\n', 'utf-8');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(join(root, 'bin', 'vibelog.mjs'), '// cli\n', 'utf-8');
    git('add', '-A');
    git('commit', '-m', 'проект');

    const dir = ensureTaskWorktree(root, 'VL-7');
    // stale-мусор в dist worktree должен быть удалён перед сборкой
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'stale.js'), 'старое\n', 'utf-8');

    // Симлинк node_modules: tsc запускается как node <root>/node_modules/...
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');

    buildTaskWorktree(root, 'VL-7');
    assert.ok(existsSync(join(dir, 'dist', 'cli', 'router.js')), 'dist/cli/router.js собран');
    assert.ok(!existsSync(join(dir, 'dist', 'stale.js')), 'stale-dist удалён');
    // CLI worktree существует (для /restart VL-7)
    assert.equal(worktreeCliPath(root, 'VL-7'), join(dir, 'bin', 'vibelog.mjs'));
    assert.ok(existsSync(worktreeCliPath(root, 'VL-7')));
  });
});
