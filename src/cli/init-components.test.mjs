/**
 * Тесты шага «компоненты» в `vibelog init` (VL-336, doc-25 §2.2/§3.1).
 *
 * Часть кейсов спавнит CLI в mkdtemp-каталоге (env только через
 * `testSpawnEnv()` — VL-286: иначе `VIBELOG_CWD` агентской сессии уводит CLI
 * на главный репозиторий), часть проверяет `applySetup`/`answersFromFlags`
 * напрямую — там нужны ответы, которые интерактивный wizard собрал бы через
 * `p.confirm` (Svelte-подобный seam в `runWizard` отсутствует, поэтому отказ
 * проверяется на уровне применения ответов).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';
import { applySetup, readSetupState } from '../../dist/core/setup.js';
import { answersFromFlags } from '../../dist/cli/commands/init-wizard.js';
import {
  defaultComponentsConfig,
  mergeComponentsConfig,
  readComponentsConfig,
} from '../../dist/core/components-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-init-components-'));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/** Чистая директория теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Запуск CLI в тестовом каталоге: { out, code }. */
function runCli(...args) {
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 30000,
    env: testSpawnEnv(),
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

/** Читает settings.json тестового проекта. */
function readSettings() {
  return JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
}

/** Сырой текст settings.json (для проверки байт-в-байт идемпотентности). */
function readSettingsRaw() {
  return readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8');
}

/** Пишет settings.json с «чужими» секциями, которые init не должен трогать. */
function seedSettings(extra = {}) {
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  // upgrade-режим требует читаемый backlog/config.yml: без него applySetup
  // отверг бы прогон, и проверка «секции сохранены» была бы бессмысленной
  mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(testDir, 'backlog', 'config.yml'),
    'project_name: Seeded\ntask_prefix: SD\n',
    'utf-8',
  );
  const data = {
    chats: [{ id: 1, title: 'Мой чат' }],
    models: { default: 'p1/m1', available: { 'p1/m1': { gateway: 'p1', model: 'm1' } } },
    providers: { p1: { base_url: 'https://api.example/v1' } },
    workflows: { application: { stages: ['Spec', 'Done'] } },
    mcpServers: { vibelog: { command: 'node', trust: true } },
    chat_personas: { 'собеседник': 'кратко' },
    неизвестный_ключ: { вложенный: [1, 2, 3] },
    ...extra,
  };
  writeFileSync(
    join(testDir, '.vibelog', 'settings.json'),
    `${JSON.stringify(data, null, 2)}\n`,
    'utf-8',
  );
  return data;
}

describe('VL-336 — шаг «компоненты» в vibelog init', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC1/AC4: init --components создаёт секцию по схеме doc-25 §3.1 и lock-файл', () => {
    const { out } = runCli('init', 'Comp', '--prefix', 'cp', '--yes', '--components');
    const settings = readSettings();
    assert.deepEqual(settings.components, {
      schemaVersion: 1,
      registries: { 'vibelog.md': { owner: 'Vibelog-md', branch: 'master' } },
      aliases: {
        components: 'src/lib/components',
        ui: 'src/lib/components/ui',
        utils: 'src/lib/utils.ts',
        css: 'src/app.css',
      },
      lockFile: '.vibelog/installed.lock.json',
    });
    const lock = JSON.parse(readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8'));
    assert.deepEqual(lock, { schemaVersion: 1, components: {} });
    // AC11: вывод сообщает, что создано и какие алиасы записаны
    assert.ok(out.includes('секция components'), out);
    assert.ok(out.includes('installed.lock.json'), out);
    assert.ok(out.includes('components=src/lib/components'), out);
  });

  it('AC2: чужие секции settings.json сохраняются без изменений', () => {
    const seeded = seedSettings();
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--components');
    const after = readSettings();
    for (const key of ['chats', 'models', 'providers', 'workflows', 'mcpServers', 'chat_personas', 'неизвестный_ключ']) {
      assert.deepEqual(after[key], seeded[key], `секция ${key} изменилась`);
    }
    assert.equal(after.components.schemaVersion, 1);
  });

  it('AC3: --no-components не создаёт ни секции, ни lock-файла', () => {
    const seeded = seedSettings();
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--no-components');
    const after = readSettings();
    assert.equal(after.components, undefined, 'секция components не должна появиться');
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')), 'lock-файл не создан');
    assert.deepEqual(after.models, seeded.models, 'прочие настройки не тронуты');
  });

  it('AC3: одновременные --components и --no-components → код 1', () => {
    const { out, code } = runCli('init', 'Both', '--prefix', 'bt', '--yes', '--components', '--no-components');
    assert.equal(code, 1, out);
    assert.ok(out.includes('взаимоисключающие'), out);
    assert.ok(!existsSync(join(testDir, '.vibelog', 'settings.json')), 'ничего не записано');
  });

  it('AC5: повторный прогон не меняет settings.json (байт-в-байт)', () => {
    runCli('init', 'Idem', '--prefix', 'id', '--yes', '--components');
    const first = readSettingsRaw();
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--components');
    assert.equal(readSettingsRaw(), first, 'второй прогон не должен менять файл');
  });

  it('AC5: существующие алиасы/registries не перетираются, недостающие дополняются', () => {
    seedSettings({
      components: {
        schemaVersion: 1,
        registries: { 'мой-реестр': { owner: 'me', branch: 'main' } },
        aliases: {
          components: 'app/components',
          ui: 'app/components/ui',
          utils: 'app/utils.ts',
          css: 'app/app.css',
        },
        lockFile: '.vibelog/installed.lock.json',
      },
    });
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--components');
    const components = readSettings().components;
    assert.equal(components.aliases.components, 'app/components');
    assert.equal(components.aliases.css, 'app/app.css');
    assert.equal(components.registries['мой-реестр'].owner, 'me');
    // Дефолтный реестр добавлен, существующий сохранён
    assert.ok(components.registries['vibelog.md']);
  });

  it('AC6: --force перезаписывает секцию дефолтами, но не трогает другие секции', () => {
    const seeded = seedSettings({
      components: {
        schemaVersion: 1,
        registries: { 'старый': { owner: 'old', branch: 'dev' } },
        aliases: {
          components: 'old/components',
          ui: 'old/ui',
          utils: 'old/utils.ts',
          css: 'old/app.css',
        },
        lockFile: '.vibelog/installed.lock.json',
      },
    });
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--force', '--components');
    const after = readSettings();
    assert.deepEqual(after.components, defaultComponentsConfig(testDir));
    assert.deepEqual(after.models, seeded.models);
    assert.deepEqual(after.chats, seeded.chats);
  });

  it('AC4: существующий lock-файл не перезаписывается', () => {
    runCli('init', 'Lock', '--prefix', 'lk', '--yes', '--components');
    const lockBefore = readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8');
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--components');
    const lockAfter = readFileSync(join(testDir, '.vibelog', 'installed.lock.json'), 'utf-8');
    assert.equal(lockAfter, lockBefore);
  });

  it('AC8: --yes без флага создаёт секцию (дефолт «да»)', () => {
    runCli('init', 'Default', '--prefix', 'df', '--yes');
    assert.equal(readSettings().components.schemaVersion, 1);
    assert.ok(existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
  });

  it('AC9/AC10: проект без package.json — успех, алиасы относительны корня', () => {
    assert.ok(!existsSync(join(testDir, 'package.json')));
    const { code, out } = runCli('init', 'Plain', '--prefix', 'pl', '--yes', '--components');
    assert.equal(code, 0, out);
    for (const value of Object.values(readSettings().components.aliases)) {
      assert.ok(!value.startsWith('/') && !value.startsWith('..'), `путь не относительный: ${value}`);
    }
  });

  it('AC7: отказ в wizard-е (components.enabled=false) оставляет секцию отсутствующей', () => {
    const state = readSetupState(testDir);
    const answers = answersFromFlags({ yes: true }, state, testDir);
    // Имитируем ответ «нет» интерактивного p.confirm
    const result = applySetup(testDir, { ...answers, components: { enabled: false } });
    assert.equal(readSettings().components, undefined);
    assert.ok(!existsSync(join(testDir, '.vibelog', 'installed.lock.json')));
    assert.ok(!result.written.some((p) => p.includes('components')), result.written.join(','));
  });

  it('answersFromFlags: дефолт «да», --no-components — «нет»', () => {
    const state = readSetupState(testDir);
    assert.deepEqual(answersFromFlags({ yes: true }, state, testDir).components, { enabled: true });
    assert.deepEqual(answersFromFlags({ 'no-components': true }, state, testDir).components, { enabled: false });
  });

  it('mergeComponentsConfig: null → дефолты, пустое поле дополняется', () => {
    const defaults = defaultComponentsConfig(testDir);
    assert.deepEqual(mergeComponentsConfig(null, defaults), defaults);
    const merged = mergeComponentsConfig(
      { ...defaults, aliases: { ...defaults.aliases, ui: '' }, registries: {} },
      defaults,
    );
    assert.equal(merged.aliases.ui, defaults.aliases.ui);
    assert.deepEqual(merged.registries, defaults.registries);
  });

  it('readComponentsConfig видит записанную секцию (совместимость с vb install)', () => {
    runCli('init', 'Read', '--prefix', 'rd', '--yes', '--components');
    const config = readComponentsConfig(testDir);
    assert.ok(config);
    assert.equal(config.lockFile, '.vibelog/installed.lock.json');
  });
});
