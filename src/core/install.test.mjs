/**
 * Тесты ядра `vb install` (VL-337, doc-25 §2.3, §4.3).
 *
 * Сети нет: фикстура — локальный `node:http`-сервер, отдающий
 * `public/r/<name>.json` и файлы компонента; база подставляется через
 * `VIBELOG_REGISTRY_BASE_URL` (VL-335). CLI спавнится в mkdtemp-каталоге,
 * env собирается только через `testSpawnEnv()` (VL-286): иначе `VIBELOG_CWD`
 * агентской сессии увёл бы CLI на главный репозиторий.
 *
 * Отдельно проверяется атомарность: элемент из трёх файлов, третий целевой
 * каталог недоступен для записи → ни один файл не появился, существовавший
 * файл остался прежним, lock не изменён, temp удалён.
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
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';
import { hashContent } from '../../dist/core/components-config.js';
import { diffLines, parseInstallPath, InstallError } from '../../dist/core/install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-install-'));

/** Файлы реестра: путь в репозитории → содержимое. */
let registryFiles = {};
let server;
let baseUrl = '';

beforeEach(async () => {
  registryFiles = {};
  server = createServer((req, res) => {
    const url = req.url ?? '';
    let path;
    // VL-382: два транспорта — raw (анонимно) и Contents API (с токеном).
    // /repos/<owner>/<repo>/contents/<path>?ref=<branch>&scope=full
    const contentsMarker = '/contents/';
    const contentsIdx = url.indexOf(contentsMarker);
    if (contentsIdx !== -1) {
      const rest = url.slice(contentsIdx + contentsMarker.length);
      path = decodeURIComponent(rest.split('?')[0]);
      const body = registryFiles[path];
      if (body === undefined) {
        res.writeHead(404, { 'content-type': 'application/json;charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no file', status: 404 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/vnd.gitverse.object+json;version=1' });
      res.end(
        JSON.stringify({
          type: 'file',
          encoding: 'base64',
          size: Buffer.byteLength(body, 'utf8'),
          name: path.split('/').pop(),
          path,
          content: Buffer.from(body, 'utf8').toString('base64'),
        }),
      );
      return;
    }
    // /api/repos/<owner>/<repo>/raw/branch/<branch>/<path>
    const marker = '/raw/branch/';
    const idx = url.indexOf(marker);
    if (idx === -1) {
      res.writeHead(400);
      res.end('{"code":4305,"message":"bad url"}');
      return;
    }
    const rest = url.slice(idx + marker.length);
    const slash = rest.indexOf('/');
    path = decodeURIComponent(rest.slice(slash + 1));
    const body = registryFiles[path];
    if (body === undefined) {
      // GitVerse отдаёт 400 на отсутствующий файл (спайк, doc-25 §10)
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

/** Секция `components` по умолчанию (как `vb init --components`). */
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

/** Кладёт манифест элемента и его файлы в фикстуру реестра. */
function seedItem(item, files) {
  registryFiles[`public/r/${item.name}.json`] = JSON.stringify(item);
  for (const [path, content] of Object.entries(files)) registryFiles[path] = content;
}

/**
 * Запуск CLI в тестовом каталоге: { out, code }.
 *
 * Асинхронно (`spawn`, не `spawnSync`): фикстура реестра — HTTP-сервер в этом
 * же процессе, а синхронный спавн блокирует event loop и сервер не успевает
 * ответить (CLI ждёт таймаут 30 с).
 */
function runCli(...args) {
  return new Promise((resolve) => {
    const token = process.env.VIBELOG_TEST_REGISTRY_TOKEN ?? '';
    const child = spawn('node', [cliPath, ...args], {
      cwd: testDir,
      // VL-382: обе базы (raw и Contents API) подменяются одним именем;
      // GITVERSE_TOKEN снимаем — иначе унаследованный из агентской сессии
      // токен увёл бы CLI на Публичный API, а фикстура изображает raw.
      env: testSpawnEnv({
        VIBELOG_REGISTRY_BASE_URL: baseUrl,
        GITVERSE_REGISTRY_BASE_URL: baseUrl,
        GITVERSE_TOKEN: token,
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

/** Читает lock-файл проекта. */
function readLockFile() {
  return JSON.parse(readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8'));
}

/** Сырой текст lock-файла (для побайтовой идемпотентности). */
function readLockRaw() {
  return readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8');
}

/** Однофайловый элемент `button`. */
function buttonItem(overrides = {}) {
  return {
    name: 'button',
    type: 'registry:ui',
    version: '1.0.0',
    dependencies: ['clsx'],
    registryDependencies: [],
    files: [
      { path: 'src/lib/components/ui/button.svelte', target: 'button.svelte', type: 'registry:ui' },
    ],
    ...overrides,
  };
}

describe('parseInstallPath', () => {
  it('разбирает три сегмента', async () => {
    assert.deepEqual(parseInstallPath('vibelog.md/ui/button'), {
      alias: 'vibelog.md',
      repo: 'ui',
      name: 'button',
    });
  });

  it('иное число сегментов — код 1 с подсказкой формата', async () => {
    for (const bad of ['vibelog.md/ui', 'a/b/c/d', '', 'a//b']) {
      try {
        parseInstallPath(bad);
        assert.fail(`ожидалась ошибка для «${bad}»`);
      } catch (err) {
        assert.ok(err instanceof InstallError);
        assert.equal(err.code, 1);
        assert.match(err.message, /<alias>\/<repo>\/<name>/);
      }
    }
  });
});

describe('diffLines', () => {
  it('показывает различия и ограничивает вывод', async () => {
    const out = diffLines('a\nb\n', 'a\nc\n');
    assert.ok(out.includes('- b'));
    assert.ok(out.includes('+ c'));
    const long = diffLines('x\n'.repeat(100), 'y\n'.repeat(100), 5);
    assert.ok(long.length <= 6);
  });
});

describe('vb install', () => {
  it('VL-382: с токеном запрос идёт через Contents API и файл ставится', async () => {
    freshProject();
    const content = 'export const button = 1; // кнопка\n';
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': content });

    process.env.VIBELOG_TEST_REGISTRY_TOKEN = 'gv_test_token';
    let result;
    try {
      result = await runCli('install', 'vibelog.md/ui/button', '--yes');
    } finally {
      delete process.env.VIBELOG_TEST_REGISTRY_TOKEN;
    }
    assert.equal(result.code, 0, result.out);
    assert.equal(
      readFileSync(join(testDir, 'src/lib/components/ui/button.svelte'), 'utf-8'),
      content,
    );
  });

  it('устанавливает один файл и пишет корректный хеш в lock', async () => {
    freshProject();
    const content = 'export const button = 1;\n';
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': content });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);

    const target = join(testDir, 'src/lib/components/ui/button.svelte');
    assert.ok(existsSync(target));
    assert.equal(readFileSync(target, 'utf-8'), content);

    const lock = readLockFile();
    const entry = lock.components.button;
    assert.equal(entry.version, '1.0.0');
    assert.equal(entry.files['src/lib/components/ui/button.svelte'].hash, hashContent(content));
    assert.equal(entry.files['src/lib/components/ui/button.svelte'].sourceVersion, '1.0.0');
  });

  it('VL-383: элемент registry:lib с target "../utils.ts" устанавливается', async () => {
    freshProject();
    const item = {
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
    const utilsContent = 'export const cn = (...a: string[]) => a.join(" ");\n';
    const themeContent = ':root { --x: 1; }\n';
    seedItem(item, {
      'src/lib/utils.ts': utilsContent,
      'src/lib/theme.css': themeContent,
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/base', '--yes');
    assert.equal(code, 0, out);
    // Оба файла — registry:lib → алиас utils, база — каталог алиаса src/lib,
    // значит "../utils.ts" и "../theme.css" ложатся в src/lib/ (AC2 VL-383).
    assert.equal(readFileSync(join(testDir, 'src/lib/utils.ts'), 'utf-8'), utilsContent);
    assert.equal(readFileSync(join(testDir, 'src/lib/theme.css'), 'utf-8'), themeContent);
    const files = readLockFile().components.base.files;
    assert.equal(files['src/lib/utils.ts'].hash, hashContent(utilsContent));
    assert.equal(files['src/lib/theme.css'].hash, hashContent(themeContent));
  });

  it('устанавливает мультифайловый элемент целиком', async () => {
    freshProject();
    const item = {
      name: 'card',
      type: 'registry:ui',
      version: '1.0.0',
      dependencies: [],
      registryDependencies: [],
      files: [
        { path: 'src/lib/components/ui/card/card.svelte', target: 'card/card.svelte', type: 'registry:ui' },
        {
          path: 'src/lib/components/ui/card/card-header.svelte',
          target: 'card/card-header.svelte',
          type: 'registry:ui',
        },
      ],
    };
    seedItem(item, {
      'src/lib/components/ui/card/card.svelte': 'card\n',
      'src/lib/components/ui/card/card-header.svelte': 'header\n',
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/card', '--yes');
    assert.equal(code, 0, out);
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/card/card.svelte')));
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/card/card-header.svelte')));
    const files = readLockFile().components.card.files;
    assert.equal(Object.keys(files).length, 2);
  });

  it('конфликт без --force в --yes: файл не перезаписан, код 0, предупреждение', async () => {
    freshProject();
    const target = join(testDir, 'src/lib/components/ui/button.svelte');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'моя версия\n', 'utf-8');
    // Двухфайловый элемент: один файл конфликтует, второй создаётся —
    // это и есть «частичный успех» (код 0). Если бы конфликтовали все файлы,
    // по doc-25 §5.2 был бы код 4 (отдельный кейс ниже).
    const item = buttonItem({
      files: [
        { path: 'src/lib/components/ui/button.svelte', target: 'button.svelte', type: 'registry:ui' },
        { path: 'src/lib/components/ui/button-var.svelte', target: 'button-var.svelte', type: 'registry:ui' },
      ],
    });
    seedItem(item, {
      'src/lib/components/ui/button.svelte': 'версия реестра\n',
      'src/lib/components/ui/button-var.svelte': 'variant\n',
    });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 0, out);
    assert.equal(readFileSync(target, 'utf-8'), 'моя версия\n');
    assert.ok(existsSync(join(testDir, 'src/lib/components/ui/button-var.svelte')));
    assert.match(out, /--force/);
  });

  it('конфликт с --force: файл перезаписан, хеш в lock обновлён', async () => {
    freshProject();
    const target = join(testDir, 'src/lib/components/ui/button.svelte');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'моя версия\n', 'utf-8');
    const content = 'версия реестра\n';
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': content });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes', '--force');
    assert.equal(code, 0, out);
    assert.equal(readFileSync(target, 'utf-8'), content);
    assert.equal(
      readLockFile().components.button.files['src/lib/components/ui/button.svelte'].hash,
      hashContent(content),
    );
  });

  it('все файлы конфликтуют и пропущены → код 4', async () => {
    freshProject();
    const target = join(testDir, 'src/lib/components/ui/button.svelte');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'моя версия\n', 'utf-8');
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'версия реестра\n' });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 4, out);
    assert.equal(readFileSync(target, 'utf-8'), 'моя версия\n');
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
  });

  it('--dry-run: план напечатан, файлов и lock нет, temp не создан', async () => {
    freshProject();
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'x\n' });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--dry-run');
    assert.equal(code, 0, out);
    assert.match(out, /dry-run/);
    assert.match(out, /button\.svelte/);
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/button.svelte')));
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
    const tmp = join(testDir, '.vibelog', 'tmp');
    if (existsSync(tmp)) {
      assert.equal(readdirSync(tmp).filter((n) => n.startsWith('install-')).length, 0);
    }
  });

  it('идемпотентность: второй прогон не меняет lock побайтово', async () => {
    freshProject();
    seedItem(buttonItem(), { 'src/lib/components/ui/button.svelte': 'x\n' });

    const first = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(first.code, 0, first.out);
    const lockAfterFirst = readLockRaw();

    const second = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(second.code, 0, second.out);
    assert.equal(readLockRaw(), lockAfterFirst);
    assert.match(second.out, /изменений нет/);
  });

  it('атомарность: сбой на последнем файле откатывает всё', async () => {
    // root обходит права доступа — тест бессмыслен, честно пропускаем
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    freshProject();
    const uiDir = join(testDir, 'src/lib/components/ui');
    mkdirSync(uiDir, { recursive: true });
    // b.svelte существует с другим содержимым — проверяем восстановление
    writeFileSync(join(uiDir, 'b.svelte'), 'прежнее содержимое\n', 'utf-8');
    // c/ недоступен для записи — rename третьего файла упадёт
    const blocked = join(uiDir, 'c');
    mkdirSync(blocked, { recursive: true });
    chmodSync(blocked, 0o555);

    const item = {
      name: 'trio',
      type: 'registry:ui',
      version: '1.0.0',
      dependencies: [],
      registryDependencies: [],
      files: [
        { path: 'src/lib/components/ui/a.svelte', target: 'a.svelte', type: 'registry:ui' },
        { path: 'src/lib/components/ui/b.svelte', target: 'b.svelte', type: 'registry:ui' },
        { path: 'src/lib/components/ui/c/c.svelte', target: 'c/c.svelte', type: 'registry:ui' },
      ],
    };
    seedItem(item, {
      'src/lib/components/ui/a.svelte': 'a\n',
      'src/lib/components/ui/b.svelte': 'b\n',
      'src/lib/components/ui/c/c.svelte': 'c\n',
    });

    try {
      const { out, code } = await runCli('install', 'vibelog.md/ui/trio', '--yes', '--force');
      assert.equal(code, 3, out);
      // новый файл не появился
      assert.ok(!existsSync(join(uiDir, 'a.svelte')));
      // существовавший файл восстановлен из бэкапа
      assert.equal(readFileSync(join(uiDir, 'b.svelte'), 'utf-8'), 'прежнее содержимое\n');
      // lock не тронут
      assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
      // temp удалён
      const tmp = join(testDir, '.vibelog', 'tmp');
      if (existsSync(tmp)) {
        assert.equal(readdirSync(tmp).filter((n) => n.startsWith('install-')).length, 0);
      }
    } finally {
      chmodSync(blocked, 0o755);
    }
  });

  it('target с «..» → код 3, ничего не записано', async () => {
    freshProject();
    const item = buttonItem({
      files: [{ path: 'src/lib/components/ui/evil.svelte', target: '../evil.svelte', type: 'registry:ui' }],
    });
    seedItem(item, { 'src/lib/components/ui/evil.svelte': 'evil\n' });

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 3, out);
    assert.ok(!existsSync(join(testDir, 'src/lib/components/ui/evil.svelte')));
    assert.ok(!existsSync(join(testDir, 'src/lib/evil.svelte')));
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
  });

  it('неизвестный alias → код 2 со списком доступных', async () => {
    freshProject();
    const { out, code } = await runCli('install', 'nope/ui/button', '--yes');
    assert.equal(code, 2, out);
    assert.match(out, /vibelog\.md/);
  });

  it('нет секции components → код 2 с подсказкой vb init --components', async () => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(join(testDir, '.vibelog', 'settings.json'), '{}\n', 'utf-8');

    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--yes');
    assert.equal(code, 2, out);
    assert.match(out, /vb init --components/);
  });

  it('путь из двух сегментов → код 1', async () => {
    freshProject();
    const { out, code } = await runCli('install', 'vibelog.md/ui', '--yes');
    assert.equal(code, 1, out);
    assert.match(out, /<alias>\/<repo>\/<name>/);
  });

  it('неизвестный флаг → код 1', async () => {
    freshProject();
    const { out, code } = await runCli('install', 'vibelog.md/ui/button', '--forse');
    assert.equal(code, 1, out);
    assert.match(out, /--forse/);
  });

  it('элемент не найден в реестре → код 3', async () => {
    freshProject();
    const { out, code } = await runCli('install', 'vibelog.md/ui/missing', '--yes');
    assert.equal(code, 3, out);
    assert.match(out, /missing/);
  });
});
