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
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  CreateError,
  copyDir,
  createProject,
  installTemplateComponents,
  makeBinShim,
  parseTemplatePath,
  postCreateEnv,
  readTemplateManifest,
  selfBinPath,
  validateProjectName,
} from '../../dist/core/create.js';
import {
  CREATE_MARKER_DEFAULTS,
  CREATE_MARKER_ENV,
  CREATE_MARKER_GIT,
  CREATE_MARKER_INTERACTIVE,
  CREATE_MARKER_INTERACTIVE_ENV,
  CREATE_MARKER_NO_GIT,
  createInteractiveMarkerValue,
  createMarkerValue,
  readCreateContext,
} from '../../dist/core/env-markers.js';

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
  // Ветка dev — для проверки `--branch` и `registries[alias].branch`.
  git(['branch', 'dev'], dir);
}

/** Секция `components` как её создаёт `vb init --components`. */
function componentsConfig(registries = { 'vibelog.md': { owner: 'Vibelog-md', branch: 'master' } }) {
  return {
    schemaVersion: 1,
    registries,
    aliases: {
      components: 'src/lib/components',
      ui: 'src/lib/components/ui',
      utils: 'src/lib/utils.ts',
      css: 'src/app.css',
    },
    lockFile: '.vibelog/installed.lock.json',
  };
}

/** Пишет `.vibelog/settings.json` с секцией `components` в каталог проекта. */
function writeSettings(dir, components) {
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(
    join(dir, '.vibelog', 'settings.json'),
    `${JSON.stringify({ components }, null, 2)}\n`,
    'utf-8',
  );
}

/**
 * Раннер git, который запоминает аргументы и подменяет сетевой URL на
 * локальную фикстуру: так проверяется собранный URL без похода в сеть.
 */
function recordingGitRunner(fixture) {
  const calls = [];
  return {
    calls,
    runner: (args, cwd) => {
      calls.push(args);
      const patched = args.map((arg) => (/^https?:\/\//.test(arg) ? fixture : arg));
      const res = spawnSync('git', patched, { cwd, encoding: 'utf-8' });
      return {
        status: res.status,
        stdout: res.stdout ?? '',
        stderr: res.stderr ?? '',
        ...(res.error ? { error: res.error } : {}),
      };
    },
  };
}

/** URL клонирования из записанных вызовов git. */
function cloneUrlOf(calls) {
  const clone = calls.find((args) => args[0] === 'clone');
  assert.ok(clone, 'git clone не вызывался');
  return clone.find((arg) => /^https?:\/\//.test(arg));
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
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { status };
    },
  };
}

/** Путь к существующему файлу-фикстуре (для `selfBin`). */
function fakeBin(dir, name = 'vibelog.mjs') {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '// энтрипоинт CLI\n', 'utf-8');
  return path;
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

describe('резолв owner из registries (VL-385)', () => {
  it('owner берётся из registries[alias].owner, регистр сохраняется', async () => {
    writeSettings(testDir, componentsConfig());
    const git = recordingGitRunner(fixtureRepo);
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      tmpRoot,
      gitRunner: git.runner,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    // Регрессия VL-385: раньше в URL подставлялся alias «vibelog.md».
    assert.equal(cloneUrlOf(git.calls), 'https://gitverse.ru/Vibelog-md/templates.git');
    assert.equal(result.branch, 'master');
    assert.deepEqual(result.warnings, []);
  });

  it('пустой каталог: дефолтная запись реестра (не хардкод, а defaultComponentsConfig)', async () => {
    const git = recordingGitRunner(fixtureRepo);
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      tmpRoot,
      gitRunner: git.runner,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    assert.equal(cloneUrlOf(git.calls), 'https://gitverse.ru/Vibelog-md/templates.git');
    assert.match(cloneUrlOf(git.calls), /Vibelog-md\//);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /дефолтн/);
  });

  it('неизвестный alias — код 2 со списком доступных и без git-вызовов', async () => {
    writeSettings(testDir, componentsConfig());
    const git = recordingGitRunner(fixtureRepo);
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'nope/templates/x',
        tmpRoot,
        gitRunner: git.runner,
        depsRunner: mockRunner().runner,
        noGit: true,
      }),
      (err) => {
        assert.ok(err instanceof CreateError);
        assert.equal(err.code, 2);
        assert.match(err.message, /vibelog\.md/);
        return true;
      },
    );
    assert.equal(git.calls.length, 0);
    assert.equal(existsSync(join(testDir, 'myapp')), false);
  });

  it('owner с точкой — код 2 с указанием ограничения GitVerse', async () => {
    // readComponentsConfig отклонит домен в owner ещё на чтении секции.
    writeSettings(
      testDir,
      componentsConfig({ 'vibelog.md': { owner: 'gitverse.ru', branch: 'master' } }),
    );
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        tmpRoot,
        noGit: true,
      }),
      (err) => {
        assert.ok(err instanceof CreateError);
        assert.equal(err.code, 2);
        assert.match(err.message, /точку/);
        return true;
      },
    );
  });

  it('секция components без нужного alias — код 2 с подсказкой про vb init --components', async () => {
    writeSettings(testDir, componentsConfig({ other: { owner: 'Someone', branch: 'main' } }));
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        tmpRoot,
        noGit: true,
      }),
      (err) => {
        assert.ok(err instanceof CreateError);
        assert.equal(err.code, 2);
        assert.match(err.message, /other/);
        assert.match(err.message, /vb init --components/);
        return true;
      },
    );
  });

  it('--branch переопределяет ветку, без флага берётся registries[alias].branch', async () => {
    writeSettings(
      testDir,
      componentsConfig({ 'vibelog.md': { owner: 'Vibelog-md', branch: 'dev' } }),
    );
    const withFlag = recordingGitRunner(fixtureRepo);
    const result = await createProject({
      cwd: testDir,
      name: 'flagapp',
      template: 'vibelog.md/templates/svelte-minimal',
      branch: 'master',
      tmpRoot,
      gitRunner: withFlag.runner,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    assert.equal(result.branch, 'master');
    const cloneWithFlag = withFlag.calls.find((args) => args[0] === 'clone');
    assert.equal(cloneWithFlag[cloneWithFlag.indexOf('--branch') + 1], 'master');

    const withoutFlag = recordingGitRunner(fixtureRepo);
    const second = await createProject({
      cwd: testDir,
      name: 'regapp',
      template: 'vibelog.md/templates/svelte-minimal',
      tmpRoot,
      gitRunner: withoutFlag.runner,
      depsRunner: mockRunner().runner,
      noGit: true,
    });
    assert.equal(second.branch, 'dev');
  });
});

describe('VIBELOG_BIN и верификация postCreate (VL-386)', () => {
  // macOS: /var и /tmp — симлинки на /private/...; realpathSync разворачивает их,
  // поэтому ожидание тоже нормализуется (так тест не зависит от платформы).
  const real = (path) => realpathSync(path);

  it('selfBinPath: абсолютный путь существующего файла', () => {
    const bin = fakeBin(join(testDir, 'bin'));
    assert.equal(selfBinPath(bin), real(bin));
  });

  it('selfBinPath: пустой или несуществующий путь — null', () => {
    assert.equal(selfBinPath(null), null);
    assert.equal(selfBinPath(''), null);
    assert.equal(selfBinPath(join(testDir, 'no-such-vibelog.mjs')), null);
  });

  it('selfBinPath: относительный путь разрешается от cwd', () => {
    const bin = fakeBin(join(testDir, 'bin'));
    assert.equal(selfBinPath(relative(process.cwd(), bin)), real(bin));
  });

  it('postCreateEnv: VIBELOG_BIN поверх process.env, существующие переменные не затёрты', () => {
    const bin = fakeBin(join(testDir, 'bin'));
    const env = postCreateEnv(bin);
    assert.equal(env.VIBELOG_BIN, bin);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.HOME, process.env.HOME);
  });

  it('postCreateEnv: каталог-шим встаёт в начало PATH, хвост PATH сохранён', () => {
    const env = postCreateEnv('vibelog.mjs', '/shim/dir');
    assert.equal(env.PATH, `/shim/dir${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`);
    assert.ok(env.PATH.endsWith(process.env.PATH));
  });

  it('makeBinShim создаёт исполняемые vb и vibelog, запускающие этот CLI', () => {
    const bin = fakeBin(join(testDir, 'bin'));
    const shim = makeBinShim(bin, tmpRoot);
    if (shim === null) {
      // Windows: shell-шим не поддерживается — проверять нечего.
      assert.equal(process.platform, 'win32');
      return;
    }
    try {
      for (const name of ['vb', 'vibelog']) {
        const shimPath = join(shim, name);
        assert.equal(existsSync(shimPath), true, name);
        const body = readFileSync(shimPath, 'utf-8');
        assert.match(body, /^#!\/bin\/sh/);
        assert.match(body, /exec /);
        assert.ok(body.includes(bin), body);
        assert.ok((statSync(shimPath).mode & 0o111) !== 0, `${name} не исполняемый`);
      }
    } finally {
      rmSync(shim, { recursive: true, force: true });
    }
  });

  it('makeBinShim: без энтрипоинта шим не создаётся', () => {
    assert.equal(makeBinShim(null, tmpRoot), null);
  });

  it('postCreateEnv: переменные агентской фазы не протекают в чужой проект', () => {
    process.env.VIBELOG_PHASE_NAME = 'code';
    process.env.VIBELOG_RUN_ID = 'run-1';
    try {
      const env = postCreateEnv('vibelog.mjs');
      assert.equal(env.VIBELOG_PHASE_NAME, undefined);
      assert.equal(env.VIBELOG_RUN_ID, undefined);
      assert.equal(env.VIBELOG_BIN, 'vibelog.mjs');
    } finally {
      delete process.env.VIBELOG_PHASE_NAME;
      delete process.env.VIBELOG_RUN_ID;
    }
  });

  it('postCreateEnv: без энтрипоинта VIBELOG_BIN не задаётся', () => {
    const env = postCreateEnv(null);
    assert.equal(env.VIBELOG_BIN, undefined);
    assert.equal(env.PATH, process.env.PATH);
  });

  it('VIBELOG_BIN передаётся в env раннера postCreate, install — без env', async () => {
    const bin = fakeBin(join(testDir, 'bin'));
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: bin,
      noGit: true,
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.ok(post, 'postCreate не запускался');
    assert.equal(post.env.VIBELOG_BIN, real(bin));
    // PATH наследован целиком (npm-скрипту нужны node и tsc), но с шимом
    // впереди: так даже шаблон, зовущий «vb» по имени, получит нашу версию.
    assert.ok(post.env.PATH.endsWith(process.env.PATH), post.env.PATH);
    if (process.platform !== 'win32') {
      assert.notEqual(post.env.PATH, process.env.PATH);
    }
    // install пакетов в окружении не нуждается — env не передаётся вовсе.
    const install = deps.calls.find((call) => call.args[0] === 'install');
    assert.equal(install.env, undefined);
    // Компонентов у шаблона нет — предупреждения о секции нет
    // (единственное возможное — про дефолтный реестр).
    assert.equal(
      result.warnings.some((w) => /VIBELOG_BIN|components/.test(w)),
      false,
    );
  });

  it('нет энтрипоинта: VIBELOG_BIN не передан, есть предупреждение', async () => {
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: null,
      noGit: true,
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.equal(post.env.VIBELOG_BIN, undefined);
    // Шима тоже нет: подменять PATH нечем, шаблон уйдёт в глобальный vb.
    assert.equal(post.env.PATH, process.env.PATH);
    const hints = result.warnings.filter((w) => /VIBELOG_BIN/.test(w));
    assert.equal(hints.length, 1, result.warnings.join(' | '));
  });

  it('postCreate не создал секцию components при непустом vibelog.components — предупреждение', async () => {
    const repo = join(testDir, 'fixture-components');
    makeFixtureRepo(
      repo,
      templateManifest({ vibelog: { type: 'template', components: ['vibelog.md/ui/button'] } }),
    );
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: repo,
      tmpRoot,
      selfBin: fakeBin(join(testDir, 'bin')),
      depsRunner: mockRunner().runner,
      noGit: true,
      installComponents: async (paths) => ({
        installed: [],
        failed: paths.map((path) => ({ path, error: 'секция components не найдена' })),
      }),
    });
    const stale = result.warnings.find((w) => /устаревший/.test(w));
    assert.ok(stale, `нет предупреждения про устаревший CLI: ${result.warnings.join(' | ')}`);
    assert.match(stale, /components/);
    assert.match(stale, /VIBELOG_BIN/);
    assert.deepEqual(
      result.failedComponents.map((f) => f.path),
      ['vibelog.md/ui/button'],
    );
  });

  it('postCreate создал секцию components — предупреждения нет', async () => {
    const repo = join(testDir, 'fixture-components');
    makeFixtureRepo(
      repo,
      templateManifest({ vibelog: { type: 'template', components: ['vibelog.md/ui/button'] } }),
    );
    const deps = mockRunner();
    // Эмулируем настоящий postCreate: секция появляется в каталоге проекта.
    const runner = (command, args, options) => {
      const status = deps.runner(command, args, options).status;
      if (args[0] === 'run') writeSettings(options.cwd, componentsConfig());
      return { status };
    };
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: repo,
      tmpRoot,
      selfBin: fakeBin(join(testDir, 'bin')),
      depsRunner: runner,
      noGit: true,
      installComponents: async (paths) => ({ installed: paths, failed: [] }),
    });
    assert.equal(
      result.warnings.some((w) => /устаревший/.test(w)),
      false,
    );
    assert.deepEqual(result.installedComponents, ['vibelog.md/ui/button']);
  });

  it('installTemplateComponents: отсутствие секции подсказывает про VIBELOG_BIN', async () => {
    const dir = join(testDir, 'no-config');
    mkdirSync(dir, { recursive: true });
    const outcome = await installTemplateComponents(['vibelog.md/ui/button'], dir);
    assert.deepEqual(outcome.installed, []);
    assert.equal(outcome.failed.length, 1);
    assert.match(outcome.failed[0].error, /components/);
    assert.match(outcome.failed[0].error, /VIBELOG_BIN/);
  });
});

describe('маркер VIBELOG_CREATE для postCreate (VL-389)', () => {
  it('createMarkerValue: git будет → 1, --no-git → no-git', () => {
    assert.equal(createMarkerValue(false), CREATE_MARKER_GIT);
    assert.equal(createMarkerValue(true), CREATE_MARKER_NO_GIT);
    assert.equal(CREATE_MARKER_ENV, 'VIBELOG_CREATE');
  });

  it('readCreateContext: без маркера fromCreate=false, git не ждём', () => {
    const ctx = readCreateContext({});
    assert.equal(ctx.fromCreate, false);
    assert.equal(ctx.gitWillBeInitialized, false);
  });

  it('readCreateContext: маркер 1 — git будет; no-git — не будет', () => {
    assert.deepEqual(readCreateContext({ VIBELOG_CREATE: '1' }), {
      fromCreate: true,
      gitWillBeInitialized: true,
      forceInteractive: false,
    });
    assert.deepEqual(readCreateContext({ VIBELOG_CREATE: 'no-git' }), {
      fromCreate: true,
      gitWillBeInitialized: false,
      forceInteractive: false,
    });
  });

  it('postCreateEnv по умолчанию ставит VIBELOG_CREATE=1', () => {
    const env = postCreateEnv('vibelog.mjs');
    assert.equal(env.VIBELOG_CREATE, '1');
  });

  it('postCreateEnv с noGit ставит VIBELOG_CREATE=no-git', () => {
    const env = postCreateEnv('vibelog.mjs', null, true);
    assert.equal(env.VIBELOG_CREATE, 'no-git');
  });

  it('VIBELOG_CREATE передаётся в env раннера postCreate (обычный запуск → 1)', async () => {
    const deps = mockRunner();
    await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: fakeBin(join(testDir, 'bin')),
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.ok(post, 'postCreate не запускался');
    assert.equal(post.env.VIBELOG_CREATE, '1');
    // install маркер не нужен — env не передаётся вовсе.
    assert.equal(deps.calls.find((call) => call.args[0] === 'install').env, undefined);
  });

  it('VIBELOG_CREATE=no-git при --no-git', async () => {
    const deps = mockRunner();
    await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: fakeBin(join(testDir, 'bin')),
      noGit: true,
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.equal(post.env.VIBELOG_CREATE, 'no-git');
  });
});

describe('installTemplateComponents и registryDependencies (VL-390)', () => {
  /** Файлы фикстуры-реестра: путь в репозитории → содержимое. */
  let registryFiles = {};
  let server;
  let baseUrl = '';

  beforeEach(async () => {
    registryFiles = {};
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const marker = '/raw/branch/';
      const idx = url.indexOf(marker);
      if (idx === -1) {
        res.writeHead(400);
        res.end('{\"code\":4305}');
        return;
      }
      const rest = url.slice(idx + marker.length);
      const slash = rest.indexOf('/');
      const path = decodeURIComponent(rest.slice(slash + 1));
      const body = registryFiles[path];
      if (body === undefined) {
        res.writeHead(400, { 'content-type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ code: 4305, message: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  });

  /** Кладёт манифест элемента и его файлы в фикстуру реестра. */
  function seedItem(item, files) {
    registryFiles[`public/r/${item.name}.json`] = JSON.stringify(item);
    for (const [path, content] of Object.entries(files)) registryFiles[path] = content;
  }

  /** Элемент `base` — utils.ts и theme.css с npm-зависимостями. */
  function baseItem() {
    return {
      name: 'base',
      type: 'registry:lib',
      version: '1.0.0',
      dependencies: ['clsx', 'tailwind-merge'],
      registryDependencies: [],
      files: [
        { path: 'src/lib/utils.ts', target: '../utils.ts', type: 'registry:lib' },
        { path: 'src/lib/theme.css', target: '../theme.css', type: 'registry:lib' },
      ],
    };
  }

  /** Элемент `button`, зависящий от `base`. */
  function buttonItem() {
    return {
      name: 'button',
      type: 'registry:ui',
      version: '1.0.0',
      dependencies: [],
      registryDependencies: ['vibelog.md/ui/base'],
      files: [
        { path: 'src/lib/components/ui/button.svelte', target: 'button.svelte', type: 'registry:ui' },
      ],
    };
  }

  /** Пустой проект с секцией components (как после postCreate). */
  function freshProject() {
    const dir = join(testDir, 'created');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeSettings(dir, componentsConfig());
    return dir;
  }

  /** Раннер пакетного менеджера: пишет package.json как настоящий npm. */
  function depsRunnerWritingPackageJson(calls, status = 0) {
    return (command, args, options) => {
      calls.push({ command, args });
      if (status !== 0) return { status };
      const deps = {};
      for (const name of args.slice(1)) deps[name] = '^1.0.0';
      const path = join(options.cwd, 'package.json');
      const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : {};
      writeFileSync(
        path,
        JSON.stringify({ ...existing, dependencies: { ...(existing.dependencies ?? {}), ...deps } }),
        'utf-8',
      );
      return { status };
    };
  }

  it('ставит base (зависимость) до button: файлы, lock и npm-пакеты', async () => {
    const dir = freshProject();
    seedItem(baseItem(), {
      'src/lib/utils.ts': 'export const cn = (...a) => a.join(" ");\n',
      'src/lib/theme.css': ':root { --x: 1; }\n',
    });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    const calls = [];
    const outcome = await installTemplateComponents(['vibelog.md/ui/button'], dir, {
      packageManager: 'npm',
      depsRunner: depsRunnerWritingPackageJson(calls),
      fetchOptions: { baseUrl, transport: 'raw' },
    });

    assert.deepEqual(outcome.failed, []);
    assert.deepEqual(outcome.installed, ['vibelog.md/ui/button']);
    // AC2: оба элемента на месте — base даёт utils.ts/theme.css.
    assert.ok(existsSync(join(dir, 'src/lib/utils.ts')), 'нет utils.ts');
    assert.ok(existsSync(join(dir, 'src/lib/theme.css')), 'нет theme.css');
    assert.ok(existsSync(join(dir, 'src/lib/components/ui/button.svelte')));
    // AC3: в lock обе записи, у base два файла, у button один.
    const lock = JSON.parse(readFileSync(join(dir, '.vibelog/installed.lock.json'), 'utf-8'));
    assert.ok(lock.components.base, JSON.stringify(lock));
    assert.ok(lock.components.button, JSON.stringify(lock));
    assert.equal(Object.keys(lock.components.base.files).length, 2);
    assert.equal(Object.keys(lock.components.button.files).length, 1);
    // AC4: пакеты цепочки поставлены одной командой.
    assert.deepEqual(calls, [{ command: 'npm', args: ['install', 'clsx', 'tailwind-merge'] }]);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    assert.ok(pkg.dependencies.clsx);
    assert.ok(pkg.dependencies['tailwind-merge']);
    // AC5: в lock зависимости button записаны пакеты, поставленные для цепочки.
    assert.deepEqual(lock.components.base.dependencies, ['clsx', 'tailwind-merge']);
  });

  it('неудача npm-зависимостей попадает в failed с причиной', async () => {
    const dir = freshProject();
    seedItem(baseItem(), {
      'src/lib/utils.ts': 'x\n',
      'src/lib/theme.css': 'y\n',
    });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    const outcome = await installTemplateComponents(['vibelog.md/ui/button'], dir, {
      packageManager: 'npm',
      depsRunner: () => ({ status: 1 }),
      fetchOptions: { baseUrl, transport: 'raw' },
    });

    assert.deepEqual(outcome.installed, []);
    assert.equal(outcome.failed.length, 1);
    assert.equal(outcome.failed[0].path, 'vibelog.md/ui/button');
    assert.match(outcome.failed[0].error, /clsx/);
    assert.match(outcome.failed[0].error, /tailwind-merge/);
    // Транзакция не применилась: ни файлов, ни lock.
    assert.ok(!existsSync(join(dir, 'src/lib/components/ui/button.svelte')));
    assert.ok(!existsSync(join(dir, '.vibelog/installed.lock.json')));
  });

  it('повторный вызов не переустанавливает уже стоящий base', async () => {
    const dir = freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'x\n', 'src/lib/theme.css': 'y\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    const first = await installTemplateComponents(['vibelog.md/ui/button'], dir, {
      packageManager: 'npm',
      depsRunner: depsRunnerWritingPackageJson([]),
      fetchOptions: { baseUrl, transport: 'raw' },
    });
    assert.deepEqual(first.failed, []);
    const lockAfterFirst = readFileSync(join(dir, '.vibelog/installed.lock.json'), 'utf-8');

    // Второй компонент той же цепочки: base уже в lock.
    seedItem(
      {
        name: 'card',
        type: 'registry:ui',
        version: '1.0.0',
        dependencies: [],
        registryDependencies: ['vibelog.md/ui/base'],
        files: [{ path: 'src/lib/components/ui/card.svelte', target: 'card.svelte', type: 'registry:ui' }],
      },
      { 'src/lib/components/ui/card.svelte': 'card\n' },
    );
    const second = await installTemplateComponents(['vibelog.md/ui/card'], dir, {
      packageManager: 'npm',
      depsRunner: depsRunnerWritingPackageJson([]),
      fetchOptions: { baseUrl, transport: 'raw' },
    });
    assert.deepEqual(second.failed, []);
    const lock = JSON.parse(readFileSync(join(dir, '.vibelog/installed.lock.json'), 'utf-8'));
    assert.ok(lock.components.base);
    assert.equal(lock.components.base.installedAt, JSON.parse(lockAfterFirst).components.base.installedAt);
    assert.ok(existsSync(join(dir, 'src/lib/components/ui/card.svelte')));
  });

  it('несколько компонентов шаблона: base не ставится дважды', async () => {
    const dir = freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'x\n', 'src/lib/theme.css': 'y\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });
    seedItem(
      {
        name: 'card',
        type: 'registry:ui',
        version: '1.0.0',
        dependencies: [],
        registryDependencies: ['vibelog.md/ui/base'],
        files: [{ path: 'src/lib/components/ui/card.svelte', target: 'card.svelte', type: 'registry:ui' }],
      },
      { 'src/lib/components/ui/card.svelte': 'card\n' },
    );

    const outcome = await installTemplateComponents(
      ['vibelog.md/ui/button', 'vibelog.md/ui/card'],
      dir,
      {
        packageManager: 'npm',
        depsRunner: depsRunnerWritingPackageJson([]),
        fetchOptions: { baseUrl, transport: 'raw' },
      },
    );
    assert.deepEqual(outcome.failed, []);
    assert.deepEqual(outcome.installed, ['vibelog.md/ui/button', 'vibelog.md/ui/card']);
    const lock = JSON.parse(readFileSync(join(dir, '.vibelog/installed.lock.json'), 'utf-8'));
    assert.deepEqual(Object.keys(lock.components).sort(), ['base', 'button', 'card']);
    assert.equal(Object.keys(lock.components.base.files).length, 2);
  });
});

describe('режим настройки в postCreate: VIBELOG_CREATE_INTERACTIVE (VL-392)', () => {
  it('createInteractiveMarkerValue: интерактив → 1, дефолты → yes', () => {
    assert.equal(createInteractiveMarkerValue(true), CREATE_MARKER_INTERACTIVE);
    assert.equal(createInteractiveMarkerValue(false), CREATE_MARKER_DEFAULTS);
    assert.equal(CREATE_MARKER_INTERACTIVE, '1');
    assert.equal(CREATE_MARKER_DEFAULTS, 'yes');
    assert.equal(CREATE_MARKER_INTERACTIVE_ENV, 'VIBELOG_CREATE_INTERACTIVE');
  });

  it('postCreateEnv: по умолчанию маркер режима = yes (прежнее поведение)', () => {
    const env = postCreateEnv('vibelog.mjs');
    assert.equal(env.VIBELOG_CREATE_INTERACTIVE, 'yes');
    // Маркер «откуда вызван init» (VL-389) не меняется: это отдельная ось.
    assert.equal(env.VIBELOG_CREATE, '1');
  });

  it('postCreateEnv: interactive=true ставит маркер режима = 1', () => {
    const env = postCreateEnv('vibelog.mjs', null, false, true);
    assert.equal(env.VIBELOG_CREATE_INTERACTIVE, '1');
  });

  it('readCreateContext: маркер режима даёт forceInteractive, без него — false', () => {
    assert.equal(readCreateContext({}).forceInteractive, false);
    assert.equal(readCreateContext({ VIBELOG_CREATE: '1' }).forceInteractive, false);
    assert.equal(
      readCreateContext({ VIBELOG_CREATE: '1', VIBELOG_CREATE_INTERACTIVE: '1' }).forceInteractive,
      true,
    );
    assert.equal(readCreateContext({ VIBELOG_CREATE_INTERACTIVE: 'yes' }).forceInteractive, false);
  });

  it('createProject без interactive: в env postCreate уходит yes (в тестах нет TTY)', async () => {
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: fakeBin(join(testDir, 'bin')),
      noGit: true,
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.ok(post, 'postCreate не запускался');
    assert.equal(post.env.VIBELOG_CREATE_INTERACTIVE, 'yes');
    assert.equal(result.setupCancelled, false);
  });

  it('createProject с interactive: маркер режима = 1', async () => {
    const deps = mockRunner();
    await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: fakeBin(join(testDir, 'bin')),
      noGit: true,
      interactive: true,
    });
    const post = deps.calls.find((call) => call.args[0] === 'run');
    assert.equal(post.env.VIBELOG_CREATE_INTERACTIVE, '1');
  });

  it('отмена wizard-а (postCreate вернул 5) в интерактиве: проект создан, настройка отменена', async () => {
    const runner = (command, args) => ({ status: args[0] === 'run' ? 5 : 0 });
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: runner,
      selfBin: fakeBin(join(testDir, 'bin')),
      interactive: true,
    });
    assert.equal(result.setupCancelled, true);
    assert.deepEqual(result.scriptsRun, ['postCreate']);
    assert.equal(existsSync(join(result.targetDir, 'package.json')), true);
    assert.equal(result.git, 'initialized');
    assert.equal(result.failedComponents.length, 0);
  });

  it('код 5 от postCreate без интерактива — прежняя ошибка с кодом 3', async () => {
    const runner = (command, args) => ({ status: args[0] === 'run' ? 5 : 0 });
    await assert.rejects(
      createProject({
        cwd: testDir,
        name: 'myapp',
        template: 'vibelog.md/templates/svelte-minimal',
        cloneUrl: fixtureRepo,
        tmpRoot,
        depsRunner: runner,
        selfBin: fakeBin(join(testDir, 'bin')),
        noGit: true,
      }),
      (err) => err instanceof CreateError && err.code === 3,
    );
  });

  it('--no-install: postCreate не вызывается, полной настройки нет', async () => {
    const deps = mockRunner();
    const result = await createProject({
      cwd: testDir,
      name: 'myapp',
      template: 'vibelog.md/templates/svelte-minimal',
      cloneUrl: fixtureRepo,
      tmpRoot,
      depsRunner: deps.runner,
      selfBin: fakeBin(join(testDir, 'bin')),
      noInstall: true,
      interactive: true,
    });
    assert.deepEqual(deps.calls, []);
    assert.equal(result.packageManager, null);
    assert.equal(result.setupCancelled, false);
    assert.deepEqual(result.scriptsRun, []);
  });
});
