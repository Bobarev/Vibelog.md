/**
 * Тесты VL-333 — схемы состояния компонентов (doc-25 §3.1–3.2):
 * секция `components` в .vibelog/settings.json и .vibelog/installed.lock.json
 * — чтение, валидация, атомарная запись, хеширование, разрешение алиасов.
 *
 * Каталоги — только mkdtemp (AGENTS.md): параллельные прогоны не должны
 * затирать друг друга.
 */

import { describe, it, afterAll, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ALIAS_KEYS,
  COMPONENTS_SCHEMA_VERSION,
  ComponentsConfigError,
  aliasDir,
  emptyLock,
  hashContent,
  hashFile,
  lockPath,
  readComponentsConfig,
  readLock,
  requireComponentsConfig,
  resolveAliasPath,
  validateAliasPath,
  writeComponentsConfig,
  writeJsonAtomic,
  writeLock,
} from '../../dist/core/components-config.js';
import { settingsPath } from '../../dist/core/settings.js';

/** Валидная конфигурация по умолчанию для тестов. */
function validConfig() {
  return {
    schemaVersion: COMPONENTS_SCHEMA_VERSION,
    registries: { 'vibelog.md': { owner: 'Vibelog-md', branch: 'main' } },
    aliases: {
      components: 'src/lib/components',
      ui: 'src/lib/components/ui',
      utils: 'src/lib/utils.ts',
      css: 'src/app.css',
    },
    lockFile: '.vibelog/installed.lock.json',
  };
}

/** Создаёт изолированный каталог проекта. */
function makeProject(root, name) {
  const dir = join(root, name);
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  return dir;
}

/** Записывает settings.json сырым объектом. */
function writeSettings(dir, data) {
  writeFileSync(settingsPath(dir), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** Достаёт ошибку нужного кода из брошенного вызова. */
function expectError(fn, code, field) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ComponentsConfigError, `ожидалась ComponentsConfigError, получено ${err}`);
    assert.equal(err.code, code, `код ошибки: ${err.message}`);
    if (field) assert.equal(err.field, field);
    return err;
  }
  throw new Error('ожидалось исключение, но вызов прошёл успешно');
}

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-components-config-'));

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('readComponentsConfig (VL-333)', () => {
  it('валидная секция читается', () => {
    const dir = makeProject(testRoot, 'read-valid');
    writeSettings(dir, { components: validConfig() });
    const config = readComponentsConfig(dir);
    assert.deepEqual(config, validConfig());
  });

  it('отсутствие секции → null (не инициализировано, не ошибка)', () => {
    const dir = makeProject(testRoot, 'read-absent');
    writeSettings(dir, { git_user_name: 'user' });
    assert.equal(readComponentsConfig(dir), null);
    // requireComponentsConfig — та же ситуация, но с подсказкой
    const err = expectError(() => requireComponentsConfig(dir), 2, 'components');
    assert.match(err.message, /vb init --components/);
  });

  it('отсутствующий settings.json → null', () => {
    const dir = join(testRoot, 'read-no-file');
    assert.equal(readComponentsConfig(dir), null);
  });

  it('schemaVersion: 2 → код 2', () => {
    const dir = makeProject(testRoot, 'read-schema2');
    writeSettings(dir, { components: { ...validConfig(), schemaVersion: 2 } });
    expectError(() => readComponentsConfig(dir), 2, 'schemaVersion');
  });

  it('отсутствует алиас → код 2 с именем поля', () => {
    const dir = makeProject(testRoot, 'read-missing-alias');
    const cfg = validConfig();
    delete cfg.aliases.ui;
    writeSettings(dir, { components: cfg });
    expectError(() => readComponentsConfig(dir), 2, 'aliases.ui');
  });

  it('owner с точкой → код 3', () => {
    const dir = makeProject(testRoot, 'read-owner-dot');
    writeSettings(dir, {
      components: { ...validConfig(), registries: { r: { owner: 'gitverse.ru', branch: 'main' } } },
    });
    expectError(() => readComponentsConfig(dir), 3, 'registries.r.owner');
  });

  it('пустой branch → код 2', () => {
    const dir = makeProject(testRoot, 'read-empty-branch');
    writeSettings(dir, {
      components: { ...validConfig(), registries: { r: { owner: 'o', branch: '' } } },
    });
    expectError(() => readComponentsConfig(dir), 2, 'registries.r.branch');
  });
});

describe('валидация путей алиасов (VL-333)', () => {
  it('aliases.ui = "../../etc" → код 3', () => {
    const dir = makeProject(testRoot, 'alias-dotdot');
    writeSettings(dir, {
      components: { ...validConfig(), aliases: { ...validConfig().aliases, ui: '../../etc' } },
    });
    expectError(() => readComponentsConfig(dir), 3, 'aliases.ui');
  });

  it('aliases.ui = "/etc" → код 3', () => {
    const dir = makeProject(testRoot, 'alias-abs');
    writeSettings(dir, {
      components: { ...validConfig(), aliases: { ...validConfig().aliases, ui: '/etc' } },
    });
    expectError(() => readComponentsConfig(dir), 3, 'aliases.ui');
  });

  it('validateAliasPath: валидный путь проходит, ../ выходит', () => {
    const dir = makeProject(testRoot, 'alias-validate');
    validateAliasPath(dir, 'components', 'src/lib/components');
    expectError(() => validateAliasPath(dir, 'components', '../outside'), 3, 'aliases.components');
  });

  it('target = "../x.svelte" → код 3', () => {
    const dir = makeProject(testRoot, 'alias-target-dotdot');
    const config = validConfig();
    expectError(() => resolveAliasPath(dir, config, 'ui', '../x.svelte'), 3, 'target');
  });

  it('target абсолютный → код 3', () => {
    const dir = makeProject(testRoot, 'alias-target-abs');
    expectError(() => resolveAliasPath(dir, validConfig(), 'ui', '/etc/passwd'), 3, 'target');
  });

  it('utils/css — файл: target с "/" недопустим', () => {
    const dir = makeProject(testRoot, 'alias-file-target');
    expectError(() => resolveAliasPath(dir, validConfig(), 'utils', 'nested/file.ts'), 3, 'target');
    // без "/" — склеивается с базой: путь лежит рядом с файлом-приёмником
    const resolved = resolveAliasPath(dir, validConfig(), 'utils', 'helpers.ts');
    assert.ok(resolved.endsWith(join('src', 'lib', 'helpers.ts')), resolved);
  });

  it('неизвестный алиас → понятная ошибка со списком доступных', () => {
    const dir = makeProject(testRoot, 'alias-unknown');
    const err = expectError(
      () => resolveAliasPath(dir, validConfig(), 'nope', 'x.ts'),
      3,
      'alias',
    );
    for (const alias of ALIAS_KEYS) assert.match(err.message, new RegExp(alias));
  });

  it('resolveAliasPath склеивает каталог с target', () => {
    const dir = makeProject(testRoot, 'alias-resolve');
    const resolved = resolveAliasPath(dir, validConfig(), 'ui', 'button/Button.svelte');
    assert.ok(resolved.endsWith(join('ui', 'button', 'Button.svelte')), resolved);
    assert.equal(aliasDir(dir, validConfig(), 'components'), join(dir, 'src/lib/components'));
  });
});

describe('writeComponentsConfig: read-modify-write (VL-333)', () => {
  it('сохраняет посторонние секции settings.json', () => {
    const dir = makeProject(testRoot, 'write-preserve');
    const foreign = {
      chats: [1, 2],
      models: { default: 'qwen', list: ['a', 'b'] },
      providers: { p: { baseUrl: 'http://x' } },
      workflows: { default: { phases: ['plan'] } },
      mcpServers: { vibelog: { command: 'node' } },
      chat_personas: [{ id: 'p1' }],
      commit_coauthor: 'Co-authored-by: x',
      git_user_name: 'user',
      unknown_section: { deep: { nested: true } },
    };
    writeSettings(dir, foreign);
    writeComponentsConfig(dir, validConfig());

    const after = JSON.parse(readFileSync(settingsPath(dir), 'utf-8'));
    assert.deepEqual(after.components, validConfig());
    for (const [key, value] of Object.entries(foreign)) {
      assert.deepEqual(after[key], value, `секция ${key} затёрта`);
    }
    // порядок верхнего уровня сохранён (settings.json коммитится в git)
    assert.deepEqual(Object.keys(after), [...Object.keys(foreign), 'components']);
  });

  it('второй вызов с теми же данными → файл байт-в-байт идентичен', () => {
    const dir = makeProject(testRoot, 'write-idempotent');
    writeSettings(dir, { chats: [7], components: { ...validConfig(), schemaVersion: 1 } });
    writeComponentsConfig(dir, validConfig());
    const first = readFileSync(settingsPath(dir), 'utf-8');
    writeComponentsConfig(dir, validConfig());
    const second = readFileSync(settingsPath(dir), 'utf-8');
    assert.equal(second, first);
  });

  it('перестановка ключей во входной конфигурации не меняет вывод', () => {
    const dir = makeProject(testRoot, 'write-order');
    const cfg = validConfig();
    writeComponentsConfig(dir, cfg);
    const first = readFileSync(settingsPath(dir), 'utf-8');
    const shuffled = {
      lockFile: cfg.lockFile,
      aliases: {
        css: cfg.aliases.css,
        utils: cfg.aliases.utils,
        ui: cfg.aliases.ui,
        components: cfg.aliases.components,
      },
      registries: { 'vibelog.md': { branch: 'main', owner: 'Vibelog-md' } },
      schemaVersion: 1,
    };
    writeComponentsConfig(dir, shuffled);
    assert.equal(readFileSync(settingsPath(dir), 'utf-8'), first);
  });

  it('невалидная конфигурация не пишется (файл не тронут)', () => {
    const dir = makeProject(testRoot, 'write-invalid');
    writeSettings(dir, { chats: [1] });
    const before = readFileSync(settingsPath(dir), 'utf-8');
    const bad = { ...validConfig(), aliases: { ...validConfig().aliases, ui: '../escape' } };
    expectError(() => writeComponentsConfig(dir, bad), 3, 'aliases.ui');
    assert.equal(readFileSync(settingsPath(dir), 'utf-8'), before);
  });
});

describe('writeJsonAtomic (VL-333)', () => {
  it('сбой rename → целевой файл не изменён, temp удалён', () => {
    const dir = join(testRoot, 'atomic-fail');
    mkdirSync(dir, { recursive: true });
    const target = join(dir, 'installed.lock.json');
    writeFileSync(target, '{"старое":true}\n', 'utf-8');

    assert.throws(() =>
      writeJsonAtomic(target, { новое: true }, {
        rename: () => {
          throw new Error('rename сломан');
        },
      }),
    );
    assert.equal(readFileSync(target, 'utf-8'), '{"старое":true}\n');
    const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftovers, [], `temp не убран: ${leftovers.join(', ')}`);
  });

  it('успешная запись не оставляет temp и создаёт каталог', () => {
    const dir = join(testRoot, 'atomic-ok', 'nested');
    const target = join(dir, 'x.json');
    writeJsonAtomic(target, { a: 1 });
    assert.equal(readFileSync(target, 'utf-8'), '{\n  "a": 1\n}\n');
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.includes('.tmp-')),
      [],
    );
  });
});

describe('readLock / writeLock (VL-333)', () => {
  const goodHash = `sha256:${'a'.repeat(64)}`;

  function lockSample() {
    return {
      schemaVersion: 1,
      components: {
        button: {
          version: '1.0.0',
          installedAt: '2026-01-02T03:04:05.000Z',
          dependencies: ['utils'],
          files: { 'src/lib/components/ui/Button.svelte': { hash: goodHash, sourceVersion: '1.0.0' } },
        },
      },
    };
  }

  it('отсутствующий файл → пустой lock', () => {
    const dir = makeProject(testRoot, 'lock-absent');
    const config = validConfig();
    assert.deepEqual(readLock(dir, config), emptyLock());
  });

  it('round-trip: writeLock → readLock', () => {
    const dir = makeProject(testRoot, 'lock-roundtrip');
    const config = validConfig();
    const lock = lockSample();
    writeLock(dir, config, lock);
    assert.deepEqual(readLock(dir, config), lock);
    assert.ok(existsSync(lockPath(dir, config)));
  });

  it('lock пишется по пути из конфигурации, не хардкодом', () => {
    const dir = makeProject(testRoot, 'lock-custom-path');
    const config = { ...validConfig(), lockFile: '.vibelog/custom.lock.json' };
    writeLock(dir, config, emptyLock());
    assert.ok(existsSync(join(dir, '.vibelog', 'custom.lock.json')));
    assert.ok(!existsSync(join(dir, '.vibelog', 'installed.lock.json')));
  });

  it('битый JSON → код 2 с указанием файла', () => {
    const dir = makeProject(testRoot, 'lock-broken');
    const config = validConfig();
    writeFileSync(lockPath(dir, config), '{"components": {', 'utf-8');
    const err = expectError(() => readLock(dir, config), 2, 'lockFile');
    assert.match(err.message, /installed\.lock\.json/);
  });

  it('невалидный хеш → код 2', () => {
    const dir = makeProject(testRoot, 'lock-bad-hash');
    const config = validConfig();
    const lock = lockSample();
    lock.components.button.files['src/lib/components/ui/Button.svelte'].hash = 'md5:xyz';
    writeFileSync(lockPath(dir, config), JSON.stringify(lock), 'utf-8');
    expectError(() => readLock(dir, config), 2);
  });

  it('несовпавший schemaVersion → код 2', () => {
    const dir = makeProject(testRoot, 'lock-schema');
    const config = validConfig();
    writeFileSync(lockPath(dir, config), JSON.stringify({ schemaVersion: 2, components: {} }), 'utf-8');
    expectError(() => readLock(dir, config), 2, 'schemaVersion');
  });

  it('невалидная версия компонента и installedAt → код 2', () => {
    const dir = makeProject(testRoot, 'lock-bad-version');
    const config = validConfig();
    const lock = lockSample();
    lock.components.button.version = 'v1';
    writeFileSync(lockPath(dir, config), JSON.stringify(lock), 'utf-8');
    expectError(() => readLock(dir, config), 2, 'components.button.version');

    const lock2 = lockSample();
    lock2.components.button.installedAt = 'не дата';
    writeFileSync(lockPath(dir, config), JSON.stringify(lock2), 'utf-8');
    expectError(() => readLock(dir, config), 2, 'components.button.installedAt');
  });

  it('writeLock не пишет невалидный lock', () => {
    const dir = makeProject(testRoot, 'lock-write-invalid');
    const config = validConfig();
    const lock = lockSample();
    lock.components.button.version = 'nope';
    expectError(() => writeLock(dir, config, lock), 2);
    assert.ok(!existsSync(lockPath(dir, config)));
  });
});

describe('хеширование (VL-333)', () => {
  const fixture = 'экспорт const x = 1;\n';

  it('hashContent — sha256:<hex> от содержимого', () => {
    const expected = `sha256:${createHash('sha256').update(fixture).digest('hex')}`;
    assert.equal(hashContent(fixture), expected);
    assert.match(hashContent(Buffer.from(fixture)), /^sha256:[0-9a-f]{64}$/);
  });

  it('hashFile совпадает с hashContent для файла с тем же содержимым', () => {
    const dir = join(testRoot, 'hash');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'utils.ts');
    writeFileSync(file, fixture, 'utf-8');
    assert.equal(hashFile(file), hashContent(fixture));
  });

  it('изменение содержимого меняет хеш', () => {
    assert.notEqual(hashContent('a'), hashContent('b'));
  });
});

describe('интеграция: реальный поток init → install → update (VL-333)', () => {
  let dir;
  beforeAll(() => {
    dir = makeProject(testRoot, 'flow');
    writeSettings(dir, { models: { default: 'qwen' } });
    writeComponentsConfig(dir, validConfig());
    mkdirSync(join(dir, 'src/lib/components/ui'), { recursive: true });
    writeFileSync(join(dir, 'src/lib/components/ui/Button.svelte'), '<button />', 'utf-8');
  });

  it('читает конфиг, пишет lock с реальным хешем файла', () => {
    const config = requireComponentsConfig(dir);
    const abs = resolveAliasPath(dir, config, 'ui', 'Button.svelte');
    const lock = readLock(dir, config);
    lock.components['ui'] = {
      version: '1.0.0',
      installedAt: new Date().toISOString(),
      dependencies: [],
      files: { 'src/lib/components/ui/Button.svelte': { hash: hashFile(abs), sourceVersion: '1.0.0' } },
    };
    writeLock(dir, config, lock);
    const reread = readLock(dir, config);
    assert.equal(
      reread.components.ui.files['src/lib/components/ui/Button.svelte'].hash,
      hashContent('<button />'),
    );
    // посторонняя секция models пережила обе записи
    const settings = JSON.parse(readFileSync(settingsPath(dir), 'utf-8'));
    assert.deepEqual(settings.models, { default: 'qwen' });
  });
});
