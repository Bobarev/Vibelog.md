/**
 * Тесты пакетной установки (VL-424, doc-25 §2.3, §4.3): валидация рефов
 * до сети, дедупликация, цикл батча с тредингом lock, стоп на первой ошибке,
 * агрегация кодов выхода.
 *
 * Сети нет: фикстура — локальный `node:http`-сервер (счётчик запросов — для
 * AC «валидация до сети»), база подставляется через
 * `VIBELOG_REGISTRY_BASE_URL`/`fetchOptions.baseUrl` (VL-335). CLI спавнится
 * в mkdtemp-каталоге, env собирается только через `testSpawnEnv()` (VL-286).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';
import { InstallError } from '../../dist/core/install.js';
import {
  batchExitCode,
  installBatch,
  validateInstallRefs,
} from '../../dist/core/install-batch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-install-batch-'));

/** Файлы реестра: путь в репозитории → содержимое. */
let registryFiles = {};
/** Счётчик запросов к фикстуре: путь → число GET (для AC2 «до сети»). */
let requestCounts = {};
let server;
let baseUrl = '';

beforeEach(async () => {
  registryFiles = {};
  requestCounts = {};
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
    requestCounts[path] = (requestCounts[path] ?? 0) + 1;
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

/** Суммарное число запросов к фикстуре. */
function totalRequests() {
  return Object.values(requestCounts).reduce((sum, n) => sum + n, 0);
}

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

/** Элемент `card` (без зависимостей). */
function cardItem(overrides = {}) {
  return {
    name: 'card',
    type: 'registry:ui',
    version: '1.0.0',
    dependencies: [],
    registryDependencies: [],
    files: [
      { path: 'src/lib/components/ui/card.svelte', target: 'card.svelte', type: 'registry:ui' },
    ],
    ...overrides,
  };
}

/** Читает lock-файл проекта (или null, если его нет). */
function readLockOrNull() {
  const path = join(testDir, '.vibelog', 'installed.lock.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Сетевые опции батча — фикстура вместо GitVerse. */
function fetchOptions() {
  return { baseUrl, transport: 'raw' };
}

/** Запуск CLI в тестовом каталоге: { out, code }. */
function runCli(...args) {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: testDir,
      env: testSpawnEnv({
        VIBELOG_REGISTRY_BASE_URL: baseUrl,
        GITVERSE_REGISTRY_BASE_URL: baseUrl,
        GITVERSE_TOKEN: '',
      }),
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

/** Валидация рефов: { refs, duplicates } без сетевых запросов. */
function validate(...rawRefs) {
  return validateInstallRefs(testDir, rawRefs);
}

describe('validateInstallRefs: валидация до сети', () => {
  it('битый третий реф → InstallError код 1 с номером аргумента, 0 запросов, ничего не записано', () => {
    freshProject();
    let caught;
    try {
      validate('vibelog.md/ui/base', 'vibelog.md/ui/button', 'vibelog.md/ui');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof InstallError, `ожидался InstallError: ${caught}`);
    assert.equal(caught.code, 1);
    assert.match(caught.message, /компонент 3/);
    assert.match(caught.message, /<alias>\/<repo>\/<name>/);
    assert.equal(totalRequests(), 0, 'валидация не должна ходить в сеть');
    assert.ok(!existsSync(join(testDir, 'src')), 'ничего не записано');
    assert.equal(readLockOrNull(), null, 'lock не создан');
  });

  it('неизвестный alias в третьем рефе → InstallError код 2 с номером аргумента, 0 запросов', () => {
    freshProject();
    let caught;
    try {
      validate('vibelog.md/ui/base', 'vibelog.md/ui/button', 'nope/ui/card');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof InstallError, `ожидался InstallError: ${caught}`);
    assert.equal(caught.code, 2);
    assert.match(caught.message, /компонент 3/);
    assert.match(caught.message, /vibelog\.md/, 'список доступных реестров');
    assert.equal(totalRequests(), 0);
  });

  it('пустой список → код 1 с подсказкой множественного формата', () => {
    freshProject();
    assert.throws(
      () => validateInstallRefs(testDir, []),
      (err) =>
        err instanceof InstallError &&
        err.code === 1 &&
        /компоненты/.test(err.message) &&
        /<alias>\/<repo>\/<name> \[/.test(err.message),
    );
    assert.equal(totalRequests(), 0);
  });

  it('дубликаты дедуплицируются с сохранением порядка', () => {
    freshProject();
    const result = validate(
      'vibelog.md/ui/button',
      'vibelog.md/ui/base',
      'vibelog.md/ui/button',
    );
    assert.deepEqual(result.refs, ['vibelog.md/ui/button', 'vibelog.md/ui/base']);
    assert.deepEqual(result.duplicates, ['vibelog.md/ui/button']);
    assert.equal(totalRequests(), 0);
  });

  it('корректный список валидируется без запросов', () => {
    freshProject();
    const result = validate('vibelog.md/ui/base', 'vibelog.md/ui/button', 'vibelog.md/ui/card');
    assert.deepEqual(result.refs, [
      'vibelog.md/ui/base',
      'vibelog.md/ui/button',
      'vibelog.md/ui/card',
    ]);
    assert.deepEqual(result.duplicates, []);
    assert.equal(totalRequests(), 0);
    assert.equal(result.config.registries['vibelog.md'].owner, 'Vibelog-md');
  });
});

describe('installBatch: цикл батча', () => {
  it('[base, button, card] — все записаны, lock содержит все три, base не переустанавливается', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });
    seedItem(cardItem(), { 'src/lib/components/ui/card.svelte': 'card\n' });
    const v = validate('vibelog.md/ui/base', 'vibelog.md/ui/button', 'vibelog.md/ui/card');

    const result = await installBatch({
      root: v.root,
      config: v.config,
      lock: v.lock,
      refs: v.refs,
      fetchOptions: fetchOptions(),
      deps: { confirm: () => false },
    });

    assert.equal(result.failed, undefined);
    assert.equal(result.results.length, 3);
    assert.ok(existsSync(join(testDir, 'src/lib/utils.ts')));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/card.svelte')));
    const lock = readLockOrNull();
    assert.ok(lock.components.base);
    assert.ok(lock.components.button);
    assert.ok(lock.components.card);
    // base запрошен дважды: установка элемента + проверка версии при
    // button, но содержимое utils.ts качалось ОДИН раз — lock после первого
    // элемента виден второму, файл не переустанавливается.
    assert.equal(requestCounts['src/lib/utils.ts'], 1, JSON.stringify(requestCounts));
  });

  it('дедуп [button, button]: второй не выполняется (один запрос манифеста)', async () => {
    freshProject();
    seedItem(buttonItem({ registryDependencies: [] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });
    const v = validate('vibelog.md/ui/button', 'vibelog.md/ui/button');
    assert.deepEqual(v.duplicates, ['vibelog.md/ui/button']);

    const result = await installBatch({
      root: v.root,
      config: v.config,
      lock: v.lock,
      refs: v.refs,
      fetchOptions: fetchOptions(),
      deps: { confirm: () => false },
    });

    assert.equal(result.failed, undefined);
    assert.equal(result.results.length, 1);
    assert.equal(requestCounts['public/r/button.json'], 1, JSON.stringify(requestCounts));
  });

  it('стоп на ошибке: results=[base], failed=404-реф, card не запрашивался, lock содержит base; повтор добирает', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(cardItem(), { 'src/lib/components/ui/card.svelte': 'card\n' });
    // manifest-404: манифеста missing.json в фикстуре нет
    const v = validate('vibelog.md/ui/base', 'vibelog.md/ui/missing', 'vibelog.md/ui/card');

    const first = await installBatch({
      root: v.root,
      config: v.config,
      lock: v.lock,
      refs: v.refs,
      fetchOptions: fetchOptions(),
      deps: { confirm: () => false },
    });

    assert.ok(first.failed, 'ожидался стоп на ошибке');
    assert.equal(first.failed.ref, 'vibelog.md/ui/missing');
    assert.equal(first.failed.error.code, 3, first.failed.error.message);
    assert.equal(first.results.length, 1, 'установлен только base');
    assert.equal(requestCounts['public/r/card.json'], undefined, 'card не запрашивался после стопа');
    assert.ok(existsSync(join(testDir, 'src/lib/utils.ts')), 'base записан и НЕ откатан');
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/card.svelte')));
    const lock = readLockOrNull();
    assert.ok(lock?.components?.base, 'lock содержит base');

    // Повтор добирает: база идемпотентна (не переписывается), card ставится.
    const utilsBefore = readFileSync(join(testDir, 'src/lib/utils.ts'), 'utf-8');
    const v2 = validate('vibelog.md/ui/base', 'vibelog.md/ui/card');
    const second = await installBatch({
      root: v2.root,
      config: v2.config,
      lock: first.lock,
      refs: v2.refs,
      fetchOptions: fetchOptions(),
      deps: { confirm: () => false },
    });
    assert.equal(second.failed, undefined, second.failed?.error.message);
    assert.equal(second.results.length, 2, 'на этот раз установлены base и card');
    assert.equal(
      readFileSync(join(testDir, 'src/lib/utils.ts'), 'utf-8'),
      utilsBefore,
      'base не перезаписан (идемпотентность)',
    );
    assert.ok(readLockOrNull().components.card, 'card добрался в lock');
  });

  it('не-InstallError из onConflict пробрасывается наружу, не превращаясь в failed', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    // Существующий файл с другим содержимым → конфликт → вызов стратегии.
    mkdirSync(join(testDir, 'src/lib'), { recursive: true });
    writeFileSync(join(testDir, 'src/lib/utils.ts'), 'моя версия\n', 'utf-8');
    const v = validate('vibelog.md/ui/base');

    await assert.rejects(
      () =>
        installBatch({
          root: v.root,
          config: v.config,
          lock: v.lock,
          refs: v.refs,
          fetchOptions: fetchOptions(),
          // Стратегия конфликтов кидает обычную ошибку (аналог
          // PromptCancelledError из CLI) — она обязана долететь до вызывающего.
          onConflict: () => {
            throw new Error('стратегия прервана');
          },
          deps: { confirm: () => false },
        }),
      (err) => err.message === 'стратегия прервана',
    );
  });

  it('--dry-run батча: планы обоих элементов посчитаны, файлов и lock нет', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });
    const v = validate('vibelog.md/ui/base', 'vibelog.md/ui/button');
    const planRefs = [];
    const doneRefs = [];

    const result = await installBatch({
      root: v.root,
      config: v.config,
      lock: v.lock,
      refs: v.refs,
      fetchOptions: fetchOptions(),
      dryRun: true,
      deps: { confirm: () => false },
      hooks: {
        onPlanReady: (info) => planRefs.push(info.plans[info.plans.length - 1].ref),
        onElementDone: (ref) => doneRefs.push(ref),
      },
    });

    assert.equal(result.failed, undefined);
    assert.equal(result.results.length, 2);
    assert.deepEqual(planRefs, ['vibelog.md/ui/base', 'vibelog.md/ui/button']);
    assert.deepEqual(doneRefs, ['vibelog.md/ui/base', 'vibelog.md/ui/button']);
    assert.ok(!existsSync(join(testDir, 'src/lib/utils.ts')), 'файлов нет');
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    assert.equal(readLockOrNull(), null, 'lock не создан');
    // Планы посчитаны: каждый элемент вернул планы (для button — base+button).
    assert.equal(result.results[0].outcome.plans.length, 1);
    assert.equal(result.results[1].outcome.plans.length, 2);
    // Lock не изменён — возвращён исходный.
    assert.deepEqual(result.lock, v.lock);
  });
});

describe('batchExitCode: агрегация кодов выхода', () => {
  /** Фейковый итог элемента: written — суммарные записи, files — действия. */
  function fakeResult(written, files) {
    const willSkip = files
      .filter((action) => action === 'skip-identical' || action === 'skip-conflict')
      .map((action) => ({ action }));
    return {
      ref: 'vibelog.md/ui/x',
      outcome: {
        results: [{ written, skipped: [], lockWritten: written.length > 0, lockEntry: {} }],
        plans: [
          {
            files: files.map((action) => ({ action })),
            willSkip,
            item: { name: 'x', version: '1.0.0' },
          },
        ],
      },
    };
  }

  it('записан хоть один файл → 0', () => {
    assert.equal(batchExitCode([fakeResult(['a.ts'], ['create'])]), 0);
    // Частичный успех: элемент1 записал, элемент2 весь конфликт — всё равно 0.
    assert.equal(
      batchExitCode([fakeResult(['a.ts'], ['create']), fakeResult([], ['skip-conflict'])]),
      0,
    );
  });

  it('ни одного файла и ВСЕ файлы ВСЕХ элементов skip-conflict → 4', () => {
    assert.equal(batchExitCode([fakeResult([], ['skip-conflict'])]), 4);
    assert.equal(
      batchExitCode([fakeResult([], ['skip-conflict']), fakeResult([], ['skip-conflict'])]),
      4,
    );
  });

  it('skip-identical без записи → 0 («Уже установлено»)', () => {
    assert.equal(batchExitCode([fakeResult([], ['skip-identical'])]), 0);
    assert.equal(
      batchExitCode([fakeResult([], ['skip-identical']), fakeResult([], ['skip-conflict'])]),
      0,
      'не все элементы all-conflicts-skipped',
    );
  });

  it('пустой батч → 0', () => {
    assert.equal(batchExitCode([]), 0);
  });
});

describe('vb install: пакетная установка (CLI)', () => {
  it('два рефа одной командой: оба установлены, exit 0', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem({ registryDependencies: [] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli(
      'install',
      'vibelog.md/ui/base',
      'vibelog.md/ui/button',
      '--yes',
    );
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(testDir, 'src/lib/utils.ts')));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    const lock = readLockOrNull();
    assert.ok(lock.components.base);
    assert.ok(lock.components.button);
  });

  it('битый реф посередине → код 1, 0 запросов, ничего не установлено', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(cardItem(), { 'src/lib/components/ui/card.svelte': 'card\n' });

    const { out, code } = await runCli(
      'install',
      'vibelog.md/ui/base',
      'vibelog.md/ui',
      'vibelog.md/ui/card',
      '--yes',
    );
    assert.equal(code, 1, out);
    assert.match(out, /компонент 2/);
    assert.equal(totalRequests(), 0, 'валидация до сети');
    assert.ok(!existsSync(join(testDir, 'src')), 'ничего не установлено');
    assert.equal(readLockOrNull(), null);
  });

  it('дубликат в команде: предупреждение, манифест запрошен один раз', async () => {
    freshProject();
    seedItem(buttonItem({ registryDependencies: [] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli(
      'install',
      'vibelog.md/ui/button',
      'vibelog.md/ui/button',
      '--yes',
    );
    assert.equal(code, 0, out);
    assert.match(out, /vibelog\.md\/ui\/button/);
    assert.equal(requestCounts['public/r/button.json'], 1, JSON.stringify(requestCounts));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
  });

  it('стоп на ошибке: сводка «установлено 1 из 3», код ошибки, база записана', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(cardItem(), { 'src/lib/components/ui/card.svelte': 'card\n' });

    const { out, code } = await runCli(
      'install',
      'vibelog.md/ui/base',
      'vibelog.md/ui/missing',
      'vibelog.md/ui/card',
      '--yes',
    );
    assert.equal(code, 3, out);
    assert.match(out, /Установлено 1 из 3/);
    assert.match(out, /vibelog\.md\/ui\/missing/);
    assert.ok(existsSync(join(testDir, 'src/lib/utils.ts')), 'base не откатан');
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/card.svelte')));
    assert.equal(requestCounts['public/r/card.json'], undefined);
  });

  it('повтор батча идемпотентен: «Уже установлено», lock побайтово прежний', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem({ registryDependencies: [] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });
    const args = ['install', 'vibelog.md/ui/base', 'vibelog.md/ui/button', '--yes'];

    const first = await runCli(...args);
    assert.equal(first.code, 0, first.out);
    const lockBefore = readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8');

    const second = await runCli(...args);
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, /Уже установлено/);
    assert.equal(
      readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8'),
      lockBefore,
    );
  });

  it('--dry-run на двух рефах: два плана, lock без изменений', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem({ registryDependencies: [] }), {
      'src/lib/components/ui/button.svelte': 'button\n',
    });

    const { out, code } = await runCli(
      'install',
      'vibelog.md/ui/base',
      'vibelog.md/ui/button',
      '--dry-run',
    );
    assert.equal(code, 0, out);
    assert.match(out, /vibelog\.md\/ui\/base v1\.0\.0/);
    assert.match(out, /vibelog\.md\/ui\/button v1\.0\.0/);
    assert.ok(!existsSync(join(testDir, 'src')), 'файлов нет');
    assert.equal(readLockOrNull(), null, 'lock без изменений');
  });

  it('одиночный установщик не изменился: прежний вывод и коды', async () => {
    freshProject();
    seedItem(baseItem(), { 'src/lib/utils.ts': 'export const cn = 1;\n' });
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'button\n' });
    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);
    assert.ok(out.indexOf('vibelog.md/ui/base v1.0.0') < out.indexOf('vibelog.md/ui/button v1.0.0'), out);
    assert.match(out, /Записан: src\/lib\/utils\.ts/);
    assert.match(out, /Установлена зависимость реестра: vibelog\.md\/ui\/base/);
    assert.match(out, /Обновлён lock/);
  });
});
