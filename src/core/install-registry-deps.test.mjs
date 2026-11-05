/**
 * Тесты разрешения `registryDependencies` и правила владения файлами
 * (VL-338, doc-25 §1.2, §3.2, §4.3 шаги 5–6).
 *
 * Сети нет: фикстура — локальный `node:http`-сервер, отдающий
 * `public/r/<name>.json` и файлы элементов; база подставляется через
 * `VIBELOG_REGISTRY_BASE_URL` (VL-335). CLI спавнится в mkdtemp-каталоге,
 * env собирается только через `testSpawnEnv()` (VL-286).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';
import { hashContent } from '../../dist/core/components-config.js';
import { InstallError } from '../../dist/core/install.js';
import {
  checkFileOwnership,
  parseRegistryRef,
  resolveRegistryDeps,
  transferOwnership,
} from '../../dist/core/install-registry-deps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-install-regdeps-'));

/** Файлы реестра: путь в репозитории → содержимое. */
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
      res.end('{"code":4305,"message":"bad url"}');
      return;
    }
    const rest = url.slice(idx + marker.length);
    const slash = rest.indexOf('/');
    const path = decodeURIComponent(rest.slice(slash + 1));
    const body = registryFiles[path];
    if (body === undefined) {
      res.writeHead(400, { 'content-type': 'application/json;charset=utf-8' });
      res.end(JSON.stringify({ code: 4305, message: `File: ${path} not found` }));
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

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Секция `components` по умолчанию. */
function defaultComponents() {
  return {
    schemaVersion: 1,
    registries: { 'vibelog.md': { owner: 'Vibelog-md', branch: 'master' } },
    aliases: {
      components: 'src/lib/components',
      ui: 'src/lib/components/ui',
      utils: 'src/lib/utils.ts',
      css: 'src/app.css',
    },
    lockFile: '.vibelog/installed.lock.json',
  };
}

/** Чистый проект с секцией `components`. */
function freshProject(components = defaultComponents()) {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  writeFileSync(
    join(testDir, '.vibelog', 'settings.json'),
    `${JSON.stringify({ components }, null, 2)}\n`,
    'utf-8',
  );
  return testDir;
}

/** Кладёт манифест элемента и его файлы в фикстуру реестра. */
function seedItem(item, files) {
  registryFiles[`public/r/${item.name}.json`] = JSON.stringify(item);
  for (const [path, content] of Object.entries(files)) registryFiles[path] = content;
}

/** Запуск CLI в тестовом каталоге: { out, code }. */
function runCli(...args) {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: testDir,
      env: testSpawnEnv({ VIBELOG_REGISTRY_BASE_URL: baseUrl }),
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      out += chunk;
    });
    child.on('close', (code) => resolve({ out, code }));
  });
}

/** Читает lock-файл проекта. */
function readLockFile() {
  return JSON.parse(readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8'));
}

/** Элемент `base` (utils.ts). */
function baseItem(overrides = {}) {
  return {
    name: 'base',
    type: 'registry:lib',
    version: '1.0.0',
    dependencies: [],
    registryDependencies: [],
    files: [{ path: 'src/lib/utils.ts', target: 'utils.ts', type: 'registry:lib' }],
    ...overrides,
  };
}

/** Элемент `button`, зависящий от `base`. */
function buttonItem(overrides = {}) {
  return {
    name: 'button',
    type: 'registry:ui',
    version: '1.0.0',
    dependencies: [],
    registryDependencies: ['vibelog.md/ui/base'],
    files: [
      { path: 'src/lib/components/ui/button.svelte', target: 'button.svelte', type: 'registry:ui' },
    ],
    ...overrides,
  };
}

/** Контекст установки для юнит-вызовов (без CLI). */
function makeCtx(name = 'button') {
  return {
    root: testDir,
    config: defaultComponents(),
    lock: { schemaVersion: 1, components: {} },
    alias: 'vibelog.md',
    repo: 'ui',
    name,
    branch: 'master',
    registry: { owner: 'Vibelog-md', branch: 'master' },
    ref: `vibelog.md/ui/${name}`,
  };
}

describe('parseRegistryRef', () => {
  it('разбирает три сегмента', () => {
    assert.deepEqual(parseRegistryRef('vibelog.md/ui/base'), {
      alias: 'vibelog.md',
      repo: 'ui',
      name: 'base',
    });
  });

  it('иное число сегментов — код 3 с указанием элемента-источника', () => {
    for (const bad of ['vibelog.md/ui', 'a/b/c/d', '', 'a//b']) {
      try {
        parseRegistryRef(bad, 'vibelog.md/ui/button');
        assert.fail(`ожидалась ошибка для «${bad}»`);
      } catch (err) {
        assert.ok(err instanceof InstallError);
        assert.equal(err.code, 3);
        assert.match(err.message, /vibelog\.md\/ui\/button/);
      }
    }
  });
});

describe('resolveRegistryDeps', () => {
  it('отсутствующая зависимость попадает в планы первой', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    const ctx = makeCtx();
    const res = await resolveRegistryDeps(buttonItem(), {
      root: testDir,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
      fetchOptions: { baseUrl },
    });
    assert.equal(res.plans.length, 1);
    assert.equal(res.plans[0].item.name, 'base');
    assert.equal(res.plans[0].files[0].relPath, 'src/lib/utils.ts');
    assert.deepEqual(res.warnings, []);
  });

  it('уже установленная зависимость не переустанавливается', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    const ctx = makeCtx();
    ctx.lock = {
      schemaVersion: 1,
      components: {
        base: {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          dependencies: [],
          files: { 'src/lib/utils.ts': { hash: hashContent('x'), sourceVersion: '1.0.0' } },
        },
      },
    };
    const res = await resolveRegistryDeps(buttonItem(), {
      root: testDir,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
      fetchOptions: { baseUrl },
    });
    assert.equal(res.plans.length, 0);
    assert.deepEqual(res.alreadyInstalled, ['base']);
    assert.deepEqual(res.warnings, []);
  });

  it('расхождение версий установленной зависимости — предупреждение, не переустановка', async () => {
    freshProject();
    seedItem(baseItem({ version: '2.0.0' }), { 'src/lib/utils.ts': 'x\n' });
    const ctx = makeCtx();
    ctx.lock = {
      schemaVersion: 1,
      components: {
        base: {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          dependencies: [],
          files: {},
        },
      },
    };
    const res = await resolveRegistryDeps(buttonItem(), {
      root: testDir,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
      fetchOptions: { baseUrl },
    });
    assert.equal(res.plans.length, 0);
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0].message, /1\.0\.0/);
    assert.match(res.warnings[0].message, /2\.0\.0/);
  });

  it('цикл A→B→A не зацикливается и даёт предупреждение', async () => {
    freshProject();
    seedItem(baseItem({ registryDependencies: ['vibelog.md/ui/button'] }), {
      'src/lib/utils.ts': 'x\n',
    });
    const ctx = makeCtx();
    const res = await resolveRegistryDeps(buttonItem(), {
      root: testDir,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
      fetchOptions: { baseUrl },
    });
    // base установится, но его собственная ссылка на button не разрешается
    assert.equal(res.plans.length, 1);
    assert.equal(res.plans[0].item.name, 'base');
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0].message, /циклическая ссылка/);
  });

  it('второй уровень не разрешается — предупреждение', async () => {
    freshProject();
    seedItem(baseItem({ registryDependencies: ['vibelog.md/ui/theme'] }), {
      'src/lib/utils.ts': 'x\n',
    });
    seedItem(
      {
        name: 'theme',
        type: 'registry:lib',
        version: '1.0.0',
        dependencies: [],
        registryDependencies: [],
        files: [{ path: 'src/lib/theme.ts', target: 'theme.ts', type: 'registry:lib' }],
      },
      { 'src/lib/theme.ts': 'theme\n' },
    );
    const ctx = makeCtx();
    const res = await resolveRegistryDeps(buttonItem(), {
      root: testDir,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
      fetchOptions: { baseUrl },
    });
    assert.equal(res.plans.length, 1);
    assert.equal(res.plans[0].item.name, 'base');
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0].message, /второго уровня не разрешаются/);
  });

  it('ссылка на другой реестр — ошибка код 3', async () => {
    freshProject();
    const ctx = makeCtx();
    await assert.rejects(
      () =>
        resolveRegistryDeps(buttonItem({ registryDependencies: ['other/ui/base'] }), {
          root: testDir,
          config: ctx.config,
          lock: ctx.lock,
          ctx,
          fetchOptions: { baseUrl },
        }),
      (err) => err instanceof InstallError && err.code === 3,
    );
  });
});

describe('checkFileOwnership', () => {
  /** План с одним файлом (минимальная ручная конструкция). */
  function makePlan(name, relPath, content) {
    const hash = hashContent(content);
    return {
      item: { name, type: 'registry:ui', version: '1.0.0', dependencies: [], registryDependencies: [], files: [] },
      ref: `vibelog.md/ui/${name}`,
      files: [
        {
          sourcePath: relPath,
          relPath,
          absPath: join(testDir, relPath),
          alias: 'ui',
          type: 'registry:ui',
          action: 'create',
          existing: false,
          contentHash: hash,
          content,
        },
      ],
      conflicts: [],
      willWrite: [],
      willSkip: [],
      lockEntry: { version: '1.0.0', installedAt: '2026-01-01T00:00:00.000Z', dependencies: [], files: {} },
      lockUnchanged: false,
    };
  }

  it('совпадающий хеш — переиспользование, второй владелец не появляется', () => {
    const content = 'export const cn = 1;\n';
    const lock = {
      schemaVersion: 1,
      components: {
        base: {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          dependencies: [],
          files: { 'src/lib/utils.ts': { hash: hashContent(content), sourceVersion: '1.0.0' } },
        },
      },
    };
    const plan = makePlan('button', 'src/lib/utils.ts', content);
    const res = checkFileOwnership(lock, plan);
    assert.equal(res.reuses.length, 1);
    assert.equal(res.conflicts.length, 0);
    assert.equal(res.reuses[0].owner, 'base');
    assert.equal(plan.files[0].reusedFrom, 'base');
  });

  it('разные хеши — конфликт с указанием обоих владельцев', () => {
    const lock = {
      schemaVersion: 1,
      components: {
        base: {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          dependencies: [],
          files: { 'src/lib/utils.ts': { hash: hashContent('старое\n'), sourceVersion: '1.0.0' } },
        },
      },
    };
    const plan = makePlan('button', 'src/lib/utils.ts', 'новое\n');
    const res = checkFileOwnership(lock, plan);
    assert.equal(res.reuses.length, 0);
    assert.equal(res.conflicts.length, 1);
    assert.equal(res.conflicts[0].owner, 'base');
    assert.equal(plan.files[0].action, 'conflict');
    assert.equal(plan.conflicts.length, 1);
  });

  it('transferOwnership снимает запись у прежнего владельца при перезаписи', () => {
    const lock = {
      schemaVersion: 1,
      components: {
        base: {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          dependencies: [],
          files: { 'src/lib/utils.ts': { hash: hashContent('старое\n'), sourceVersion: '1.0.0' } },
        },
      },
    };
    const plan = makePlan('button', 'src/lib/utils.ts', 'новое\n');
    plan.files[0].action = 'overwrite';
    const transferred = transferOwnership([plan], lock);
    assert.equal(transferred.length, 1);
    assert.ok(!('src/lib/utils.ts' in lock.components.base.files));
  });
});

describe('vb install: registryDependencies и зависимости npm', () => {
  it('устанавливает base до button, порядок в выводе и lock', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(testDir, 'src/lib/utils.ts')));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    const lock = readLockFile();
    assert.ok(lock.components.base);
    assert.ok(lock.components.button);
    // base напечатан раньше button
    assert.ok(out.indexOf('vibelog.md/ui/base') < out.indexOf('vibelog.md/ui/button'), out);
  });

  it('повторный запуск ничего не переустанавливает', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    const first = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(first.code, 0, first.out);
    const lockAfterFirst = readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8');

    const second = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /уже установлена/);
    assert.equal(
      readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8'),
      lockAfterFirst,
    );
  });

  it('--yes с отсутствующими зависимостями: предупреждение, файлы установлены, package.json не создан', async () => {
    freshProject();
    seedItem(buttonItem({ registryDependencies: [], dependencies: ['clsx'] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);
    assert.match(out, /Зависимости не установлены/);
    assert.match(out, /npm install clsx/);
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    assert.ok(!existsSync(join(testDir, 'package.json')));
    // в lock не попало ни одного пакета: установка не подтверждена
    assert.deepEqual(readLockFile().components.button.dependencies, []);
  });

  it('--dry-run показывает отсутствующие зависимости и ничего не пишет', async () => {
    freshProject();
    seedItem(buttonItem({ registryDependencies: [], dependencies: ['clsx', 'tailwind-merge'] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--dry-run');
    assert.equal(code, 0, out);
    assert.match(out, /отсутствуют 2/);
    assert.match(out, /clsx, tailwind-merge/);
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
  });

  it('уже объявленная в package.json зависимость не предлагается', async () => {
    freshProject();
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({ dependencies: { clsx: '^2.0.0' } }),
      'utf-8',
    );
    seedItem(buttonItem({ registryDependencies: [], dependencies: ['clsx'] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);
    assert.ok(!/Зависимости не установлены/.test(out), out);
  });

  it('переиспользование файла с совпадающим хешем: один владелец в lock', async () => {
    freshProject();
    const shared = 'export const cn = 1;\n';
    // base владеет utils.ts; card объявляет тот же файл с тем же содержимым
    seedItem(baseItem(), { 'src/lib/utils.ts': shared });
    seedItem(
      {
        name: 'card',
        type: 'registry:ui',
        version: '1.0.0',
        dependencies: [],
        registryDependencies: ['vibelog.md/ui/base'],
        files: [
          { path: 'src/lib/utils.ts', target: 'utils.ts', type: 'registry:lib' },
          { path: 'src/lib/components/ui/card.svelte', target: 'card.svelte', type: 'registry:ui' },
        ],
      },
      { 'src/lib/utils.ts': shared, 'src/lib/components/ui/card.svelte': 'card\n' },
    );

    const { out, code } = await runCli('install', 'vibelog.md/ui/card', '--yes');
    assert.equal(code, 0, out);
    const lock = readLockFile();
    assert.ok('src/lib/utils.ts' in lock.components.base.files);
    assert.ok(!('src/lib/utils.ts' in lock.components.card.files), JSON.stringify(lock.components.card));
    assert.match(out, /переиспользован/);
  });

  it('атомарность цепочки: сбой на зависимости — родитель не установлен, lock не изменён', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    freshProject();
    // base пишет utils.ts в src/lib/, но каталог src/lib недоступен для записи
    const libDir = join(testDir, 'src/lib');
    mkdirSync(libDir, { recursive: true });
    chmodSync(libDir, 0o555);
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });

    try {
      const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
      assert.equal(code, 3, out);
      assert.ok(!existsSync(join(testDir, 'src/lib/utils.ts')));
      assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
      assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
    } finally {
      chmodSync(libDir, 0o755);
    }
  });
});
