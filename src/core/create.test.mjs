/**
 * Тесты ядра `vb create` (VL-339, doc-25 §2.1, §4.1).
 *
 * Сети нет: фикстура — локальный git-репозиторий, созданный в тесте, а URL
 * клонирования подставляется через инъекцию `cloneUrl` (не через env, чтобы
 * не влиять на другие тесты). Пакетный менеджер и установка компонентов —
 * моки: настоящий `npm install` ходил бы в сеть и шёл минутами.
 *
 * Отдельно проверяется, что корневые файлы репозитория (README.md) НЕ
 * копируются: cone-режим sparse-checkout разворачивает их, и копирование
 * `<tmp>` целиком дало бы мусор в проекте.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CreateError,
  copyDir,
  createProject,
  parseTemplatePath,
  readTemplateManifest,
  validateProjectName,
} from '../../dist/core/create.js';

/** Каталог теста: mkdtemp (VL-241: фиксированные пути запрещены). */
let testDir;
/** Репозиторий-фикстура с подпапкой шаблона. */
let fixtureRepo;
/** Куда создаются временные каталоги клона. */
let tmpRoot;

/** Запускает git в фикстуре (без наследования env агентской сессии). */
function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
}

/** Создаёт репозиторий-фикстуру: корневой README + подпапка шаблона. */
function makeFixtureRepo(dir, manifest) {
  mkdirSync(join(dir, 'templates', 'svelte-minimal', 'src'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# репозиторий шаблонов\n', 'utf-8');
  writeFileSync(join(dir, 'package.json'), '{"name":"templates-root"}\n', 'utf-8');
  writeFileSync(
    join(dir, 'templates', 'svelte-minimal', 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8',
  );
  writeFileSync(join(dir, 'templates', 'svelte-minimal', 'src', 'app.txt'), 'шаблон\n', 'utf-8');
  git(['init', '-q'], dir);
  git(['checkout', '-q', '-b', 'master'], dir);
  git(['-c', 'user.name=T', '-c', 'user.email=t@e', 'add', '-A'], dir);
  git(['-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-qm', 'init'], dir);
}

/** Манифест корректного шаблона. */
function templateManifest(extra = {}) {
  return {
    name: 'svelte-minimal',
    version: '0.1.0',
    scripts: { postCreate: 'vb init --components --yes' },
    vibelog: { type: 'template', components: [] },
    ...extra,
  };
}

/** Мок раннера пакетного менеджера: запоминает вызовы, отвечает заданным кодом. */
function mockRunner(status = 0) {
  const calls = [];
  return {
    calls,
    runner: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status };
    },
  };
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'vibelog-create-'));
  fixtureRepo = join(testDir, 'fixture');
  tmpRoot = join(testDir, 'tmp');
  mkdirSync(tmpRoot, { recursive: true });
  makeFixtureRepo(fixtureRepo, templateManifest());
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('parseTemplatePath', () => {
  it('разбирает три сегмента', () => {
    assert.deepEqual(parseTemplatePath('vibelog.md/templates/svelte-minimal'), {
      alias: 'vibelog.md',
      repo: 'templates',
      template: 'svelte-minimal',
    });
  });

  it('отклоняет неверное число сегментов кодом 1', () => {
    for (const raw of ['vibelog.md/templates', 'a/b/c/d', '', 'a//b']) {
      assert.throws(
        () => parseTemplatePath(raw),
        (err) => err instanceof CreateError && err.code === 1,
      );
    }
  });
});

describe('validateProjectName', () => {
  it('принимает npm-имена', () => {
    for (const name of ['myapp', 'my-app', 'my_app', 'my.app', 'a1']) {
      assert.equal(validateProjectName(name), null, name);
    }
  });

  it('отклоняет невалидные имена', () => {
    for (const name of ['My App', 'UPPER', '-x', '_x', '.x', '', 'a b', 'привет', 'a'.repeat(215)]) {
      assert.notEqual(validateProjectName(name), null, name);
    }
  });
});

describe('readTemplateManifest', () => {
  it('читает type, components и postCreate', () => {
    const dir = join(testDir, 'manifest-ok');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: { postCreate: 'vb init --components --yes' },
        vibelog: { type: 'template', components: ['vibelog.md/ui/button'] },
      }),
      'utf-8',
    );
    const manifest = readTemplateManifest(dir);
    assert.equal(manifest.type, 'template');
    assert.deepEqual(manifest.components, ['vibelog.md/ui/button']);
    assert.equal(manifest.postCreate, 'vb init --components --yes');
  });

  it('без vibelog.type — код 3', () => {
    const dir = join(testDir, 'manifest-bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}', 'utf-8');
    assert.throws(
      () => readTemplateManifest(dir),
      (err) => err instanceof CreateError && err.code === 3,
    );
  });
});

describe('copyDir', () => {
  it('пропускает .git, node_modules и dist', () => {
    const src = join(testDir, 'copy-src');
    const dest = join(testDir, 'copy-dest');
    mkdirSync(join(src, '.git'), { recursive: true });
    mkdirSync(join(src, 'node_modules'), { recursive: true });
    mkdirSync(join(src, 'dist'), { recursive: true });
    mkdirSync(join(src, 'src'), { recursive: true });
    writeFileSync(join(src, '.git', 'HEAD'), 'x', 'utf-8');
    writeFileSync(join(src, 'node_modules', 'a.js'), 'x', 'utf-8');
    writeFileSync(join(src, 'dist', 'a.js'), 'x', 'utf-8');
    writeFileSync(join(src, 'src', 'a.txt'), 'ok', 'utf-8');
    copyDir(src, dest);
    assert.equal(existsSync(join(dest, '.git')), false);
    assert.equal(existsSync(join(dest, 'node_modules')), false);
    assert.equal(existsSync(join(dest, 'dist')), false);
    assert.equal(readFileSync(join(dest, 'src', 'a.txt'), 'utf-8'), 'ok');
  });
});

describe('createProject', () => {
  it('создаёт проект из локального репозитория, корневые файлы не копируются', async () => {
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      noGit: true,
    });

    const target = join(testDir, 'myapp');
    assert.equal(result.targetDir, target);
    assert.equal(result.branch, 'master');
    assert.equal(result.git, 'skipped');
    assert.equal(existsSync(join(target, 'package.json')), true);
    assert.equal(existsSync(join(target, 'src', 'app.txt')), true);
    // Корневые файлы репозитория развёрнуты cone-режимом, но не копируются.
    assert.equal(existsSync(join(target, 'README.md')), false);
    assert.equal(existsSync(join(target, '.git')), false);
    // postCreate выполнен после install.
    assert.deepEqual(
      deps.calls.map((call) => [call.command, ...call.args].join(' ')),
      ['npm install', 'npm run postCreate'],
    );
    assert.deepEqual(result.scriptsRun, ['postCreate']);
  });

  it('невалидное имя — код 1, каталог не создан', async () => {
    for (const name of ['My App', 'UPPER', '-x']) {
      await assert.rejects(
        createProject({
          cwd: testDir,
          name,
          template: 'vibelog.md/templates/svelte-minimal',
          cloneUrl: fixtureRepo,
          tmpRoot,
          noGit: true,
        }),
        (err) => err instanceof CreateError && err.code === 1,
      );
      assert.equal(existsSync(join(testDir, name)), false);
    }
  });

  it('существующий каталог — код 2, содержимое не тронуто', async () => {
    const target = join(testDir, 'myapp');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep.txt'), 'не трогать', 'utf-8');
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        cloneUrl: fixtureRepo,
        tmpRoot,
        noGit: true,
      }),
      (err) => err instanceof CreateError && err.code === 2,
    );
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf-8'), 'не трогать');
    assert.deepEqual(readdirSync(target), ['keep.txt']);
  });

  it('package.json без vibelog.type — код 3, каталог не создан', async () => {
    const badRepo = join(testDir, 'fixture-bad');
    makeFixtureRepo(badRepo, { name: 'svelte-minimal', version: '0.1.0' });
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        cloneUrl: badRepo,
        tmpRoot,
        noGit: true,
      }),
      (err) => err instanceof CreateError && err.code === 3,
    );
    assert.equal(existsSync(join(testDir, 'myapp')), false);
  });

  it('несуществующий шаблон — код 3', async () => {
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/nope',
        cloneUrl: fixtureRepo,
        tmpRoot,
        noGit: true,
      }),
      (err) => err instanceof CreateError && err.code === 3,
    );
    assert.equal(existsSync(join(testDir, 'myapp')), false);
  });

  it('--no-install: пакетный менеджер не вызывается, файлы на месте', async () => {
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      noInstall: true,
      noGit: true,
    });
    assert.deepEqual(deps.calls, []);
    assert.equal(result.packageManager, null);
    assert.equal(existsSync(join(testDir, 'myapp', 'src', 'app.txt')), true);
  });

  it('--no-git: .git отсутствует', async () => {
    await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    assert.equal(existsSync(join(testDir, 'myapp', '.git')), false);
  });

  it('без --no-git: git init и первый коммит', async () => {
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: mockRunner().runner,
    });
    assert.equal(result.git, 'initialized');
    const target = join(testDir, 'myapp');
    assert.equal(existsSync(join(target, '.git')), true);
    const log = spawnSync('git', ['log', '--oneline'], { cwd: target, encoding: 'utf-8' });
    assert.equal(log.status, 0);
    assert.match(log.stdout, /Initial commit from vibelog\.md\/templates\/svelte-minimal/);
  });

  it('падение postCreate — каталог сохранён, код 3', async () => {
    const deps = mockRunner();
    // Первый вызов (install) успешен, второй (run postCreate) — код 1.
    let call = 0;
    const runner = (command, args, options) => {
      call += 1;
      deps.calls.push({ command, args, cwd: options.cwd });
      return { status: call === 1 ? 0 : 1 };
    };
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        cloneUrl: fixtureRepo,
        tmpRoot,
        depsRunner: runner,
        noGit: true,
      }),
      (err) => err instanceof CreateError && err.code === 3,
    );
    assert.equal(existsSync(join(testDir, 'myapp', 'src', 'app.txt')), true);
  });

  it('vibelog.components: установка вызывается, неудача не отменяет проект', async () => {
    const repo = join(testDir, 'fixture-components');
    makeFixtureRepo(
      repo,
      templateManifest({
        vibelog: { type: 'template', components: ['vibelog.md/ui/button', 'vibelog.md/ui/card'] },
      }),
    );
    const seen = [];
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: repo,
      tmpRoot,
      depsRunner: mockRunner().runner,
      noGit: true,
      installComponents: async (paths, targetDir) => {
        seen.push({ paths, targetDir });
        return {
          installed: ['vibelog.md/ui/button'],
          failed: [{ path: 'vibelog.md/ui/card', error: 'сеть недоступна' }],
        };
      },
    });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].paths, ['vibelog.md/ui/button', 'vibelog.md/ui/card']);
    assert.equal(seen[0].targetDir, join(testDir, 'myapp'));
    assert.deepEqual(result.installedComponents, ['vibelog.md/ui/button']);
    assert.deepEqual(result.failedComponents.map((f) => f.path), ['vibelog.md/ui/card']);
    assert.equal(existsSync(join(testDir, 'myapp', 'src', 'app.txt')), true);
  });

  it('временный каталог удаляется после успеха и после ошибки', async () => {
    const leftovers = () => readdirSync(tmpRoot).filter((n) => n.startsWith('vb-create-'));
    await createProject({
      cwd: testDir,
      name: 'ok-app',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    assert.deepEqual(leftovers(), []);

    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'bad-app',
        template: 'vibelog.md/templates/nope',
        cloneUrl: fixtureRepo,
        tmpRoot,
        noGit: true,
      }),
    );
    assert.deepEqual(leftovers(), []);
  });
});
