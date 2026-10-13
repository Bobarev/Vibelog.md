/**
 * Тесты VL-45 — project-settings (кэш git_user_name в .vibelog/settings.json, VL-143).
 *
 * Каталоги — в /tmp; git-окружение изолируется через GIT_CONFIG_GLOBAL.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  projectSettingsPath,
  loadProjectSettings,
  saveProjectSettings,
  resolveGitUserName,
} from '../../dist/core/project-settings.js';

describe('project-settings (VL-45)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-project-settings-test-'));
  // Пустая HOME-директория: изоляция от ~/.gitconfig, работающая и на старом
  // git 2.24 (Catalina), где GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM игнорируются
  const ISO_HOME = mkdtempSync(join(tmpdir(), 'vibelog-project-settings-home-'));
  // GIT_CONFIG_GLOBAL=/dev/null изолирует тест от глобального git-конфига
  const ISO_ENV = { ...process.env, HOME: ISO_HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
    rmSync(ISO_HOME, { recursive: true, force: true });
  });

  it('projectSettingsPath → .vibelog/settings.json (VL-143)', () => {
    assert.equal(projectSettingsPath('/proj'), join('/proj', '.vibelog', 'settings.json'));
  });

  it('saveProjectSettings + loadProjectSettings roundtrip', () => {
    const dir = join(testRoot, 'roundtrip');
    mkdirSync(dir, { recursive: true });
    saveProjectSettings(dir, { git_user_name: 'Pavel' });

    assert.ok(existsSync(projectSettingsPath(dir)), 'файл settings.json должен существовать');
    const loaded = loadProjectSettings(dir);
    assert.equal(loaded.git_user_name, 'Pavel');
  });

  it('loadProjectSettings: отсутствующий файл → пустые настройки', () => {
    const dir = join(testRoot, 'missing');
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(loadProjectSettings(dir), {});
  });

  it('loadProjectSettings: битый JSON → пустые настройки без throw', () => {
    const dir = join(testRoot, 'broken');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(projectSettingsPath(dir), '{не json вовсе', 'utf-8');
    // JSON.parse может как throw, так и вернуть мусор — важно, что не падает
    const loaded = loadProjectSettings(dir);
    assert.ok(loaded.git_user_name === undefined, 'битый YAML не должен давать git_user_name');
  });

  it('resolveGitUserName: кэш есть → возвращает кэш (git не спавнится)', () => {
    const dir = join(testRoot, 'cached');
    mkdirSync(dir, { recursive: true });
    // Локальный git-конфиг задаёт другое имя — если бы git спавнился, оно бы победило
    spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Git Local User'], { cwd: dir, stdio: 'pipe' });
    saveProjectSettings(dir, { git_user_name: 'Cached User' });

    assert.equal(resolveGitUserName(dir, ISO_ENV), 'Cached User');
  });

  it('resolveGitUserName: кэша нет → fallback на git config', () => {
    const dir = join(testRoot, 'fallback');
    mkdirSync(dir, { recursive: true });
    spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Git Local User'], { cwd: dir, stdio: 'pipe' });

    assert.equal(resolveGitUserName(dir, ISO_ENV), 'Git Local User');
  });

  it('resolveGitUserName: пустой git_user_name в файле → fallback', () => {
    const dir = join(testRoot, 'empty-cache');
    mkdirSync(dir, { recursive: true });
    spawnSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Git Local User'], { cwd: dir, stdio: 'pipe' });
    saveProjectSettings(dir, { git_user_name: '' });

    assert.equal(resolveGitUserName(dir, ISO_ENV), 'Git Local User');
  });

  it('resolveGitUserName: git недоступен и кэша нет → @agent', () => {
    const dir = join(testRoot, 'no-git');
    mkdirSync(dir, { recursive: true });
    // GIT_CONFIG_GLOBAL=/dev/null + негитовая директория → getGitUserName вернёт @agent
    assert.equal(resolveGitUserName(dir, ISO_ENV), '@agent');
  });
});
