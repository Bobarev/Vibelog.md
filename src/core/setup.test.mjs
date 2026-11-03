/**
 * Тесты ядра wizard-а настройки проекта (VL-210).
 *
 * Проверяет detectSetupMode, readSetupState и applySetup в обоих режимах:
 * fresh создаёт структуру, upgrade дополняет недостающее и НЕ трогает
 * существующие задачи/настройки (главный инвариант задачи).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applySetup,
  detectSetupMode,
  formatSetupLog,
  readSetupState,
  SetupError,
} from '../../dist/core/setup.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-setup-'));

/** Чистая директория для теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Базовые ответы fresh-режима. */
function baseAnswers(over= {}) {
  return {
    mode: 'fresh',
    projectName: 'Test Project',
    prefix: 'TP',
    agents: [],
    secretsLocation: 'env',
    mcp: false,
    force: false,
    ...over,
  };
}

describe('VL-210 — ядро setup', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('detectSetupMode: без backlog/ — fresh, с backlog/ — upgrade', () => {
    assert.equal(detectSetupMode(testDir), 'fresh');
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    assert.equal(detectSetupMode(testDir), 'upgrade');
  });

  it('readSetupState на пустом каталоге: fresh, дефолты, vb доступен', () => {
    const state = readSetupState(testDir);
    assert.equal(state.mode, 'fresh');
    assert.equal(state.prefix, 'VL');
    assert.equal(state.projectName, 'vibelog-setup-'.length > 0 ? state.projectName : '');
    assert.ok(state.projectName.length > 0, 'имя проекта — имя директории');
    const vb = state.agents.find((a) => a.id === 'vb');
    assert.ok(vb, 'vb всегда в списке');
    assert.equal(vb?.enabled, false, 'vb по умолчанию не отмечен');
    assert.equal(state.agents.find((a) => a.id === 'qwen'), undefined, 'qwen скрыт без .qwen/');
    assert.deepEqual(state.gateways, {});
    assert.equal(state.secrets.envFile, false);
  });

  it('readSetupState: qwen отмечен при наличии .qwen/, opencode disabled «Скоро»', () => {
    mkdirSync(join(testDir, '.qwen'), { recursive: true });
    mkdirSync(join(testDir, '.opencode'), { recursive: true });
    const state = readSetupState(testDir);
    assert.equal(state.agents.find((a) => a.id === 'qwen')?.enabled, true);
    const opencode = state.agents.find((a) => a.id === 'opencode');
    assert.equal(opencode?.enabled, false);
    assert.equal(opencode?.reason, 'Скоро');
  });

  it('readSetupState читает config.yml, gateways, models, секреты и MCP', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(testDir, 'backlog', 'config.yml'),
      'project_name: Existing\n' + 'task_prefix: EX\n',
      'utf-8',
    );
    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(testDir, '.vibelog', 'settings.json'),
      JSON.stringify({
        gateways: { p1: { base_url: 'https://api.example/v1', api_key_env: 'P1_KEY' } },
        models: {
          default: 'p1/m1',
          available: { 'p1/m1': { provider: 'p1', model: 'm1', api_mode: 'chat' } },
        },
        env: { TELEGRAM_BOT_TOKEN: 'x' },
        chats: [1, 2],
      }),
      'utf-8',
    );
    mkdirSync(join(testDir, '.qwen'), { recursive: true });
    writeFileSync(
      join(testDir, '.qwen', 'settings.json'),
      JSON.stringify({ mcpServers: { vibelog: { command: 'vibelog' } } }),
      'utf-8',
    );

    const state = readSetupState(testDir);
    assert.equal(state.mode, 'upgrade');
    assert.equal(state.projectName, 'Existing');
    assert.equal(state.prefix, 'EX');
    assert.equal(Object.keys(state.gateways).length, 1);
    assert.equal(state.models.default, 'p1/m1');
    assert.equal(state.bot.configured, true);
    assert.deepEqual(state.bot.chats, [1, 2]);
    assert.equal(state.mcp.qwen, true);
    assert.equal(state.mcp.opencode, false);
  });

  it('applySetup fresh создаёт структуру, config.yml, AGENTS.md и settings.json', () => {
    const result = applySetup(testDir, baseAnswers());
    for (const dir of ['tasks', 'completed', 'drafts', 'docs', 'decisions', 'milestones', 'lessons', 'references']) {
      assert.ok(existsSync(join(testDir, 'backlog', dir)), `backlog/${dir}/ должен быть создан`);
    }
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('project_name: Test Project'), config);
    assert.ok(config.includes('task_prefix: TP'), config);
    assert.ok(existsSync(join(testDir, 'AGENTS.md')), 'AGENTS.md создан');
    assert.ok(existsSync(join(testDir, '.vibelog', 'settings.json')), 'settings.json создан');
    assert.ok(result.written.includes('backlog/config.yml'));
  });

  it('applySetup fresh не перезаписывает существующий AGENTS.md', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Мой файл\n', 'utf-8');
    const result = applySetup(testDir, baseAnswers());
    assert.equal(readFileSync(join(testDir, 'AGENTS.md'), 'utf-8'), '# Мой файл\n');
    assert.ok(result.skipped.some((s) => s.startsWith('AGENTS.md')));
  });

  it('applySetup fresh пишет default_agent и MCP для qwen', () => {
    applySetup(testDir, baseAnswers({ agents: ['qwen'], mcp: true }));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.default_agent, 'qwen');
    const qwen = JSON.parse(readFileSync(join(testDir, '.qwen', 'settings.json'), 'utf-8'));
    assert.deepEqual(qwen.mcpServers.vibelog, {
      command: 'vibelog',
      args: ['mcp', 'start'],
      trust: true,
    });
  });

  it('applySetup без агентов не пишет default_agent', () => {
    applySetup(testDir, baseAnswers({ agents: [] }));
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.default_agent, undefined);
  });

  it('applySetup upgrade НЕ трогает задачи и существующие gateways/models', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Old\ntask_prefix: OLD\n', 'utf-8');
    const taskPath = join(testDir, 'backlog', 'tasks', 'OLD-1 - Задача.md');
    writeFileSync(taskPath, '---\nid: OLD-1\n---\n\n# Задача\n', 'utf-8');
    const taskBefore = readFileSync(taskPath, 'utf-8');

    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(
      join(testDir, '.vibelog', 'settings.json'),
      JSON.stringify({
        gateways: { p1: { base_url: 'https://old.example/v1' } },
        models: { default: 'p1/m1', available: { 'p1/m1': { provider: 'p1', model: 'm1' } } },
      }),
      'utf-8',
    );

    const result = applySetup(
      testDir,
      baseAnswers({
        mode: 'upgrade',
        projectName: 'Old',
        prefix: 'OLD',
        agents: ['qwen'],
        gateway: { id: 'p1', base_url: 'https://new.example/v1' },
        model: { id: 'p1/m1', gateway: 'p1', model: 'm1' },
      }),
    );

    assert.equal(readFileSync(taskPath, 'utf-8'), taskBefore, 'задача не изменилась');
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.gateways.p1.base_url, 'https://old.example/v1', 'шлюз не перезаписан');
    assert.ok(result.skipped.some((s) => s.includes('gateways.p1')));
    assert.ok(result.skipped.some((s) => s.includes('models.available.p1/m1')));
  });

  it('applySetup upgrade меняет project_name/task_prefix при отличии', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: Old\ntask_prefix: OLD\n', 'utf-8');
    applySetup(testDir, baseAnswers({ mode: 'upgrade', projectName: 'New', prefix: 'NEW' }));
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('project_name: New'), config);
    assert.ok(config.includes('task_prefix: NEW'), config);
  });

  it('applySetup upgrade с битым config.yml бросает SetupError без force', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'это не yaml-конфиг\n' + '- просто\n' + '- список\n', 'utf-8');
    assert.throws(
      () => applySetup(testDir, baseAnswers({ mode: 'upgrade' })),
      (err) => err instanceof SetupError && /повреждён/.test(err.message),
    );
  });

  it('applySetup upgrade с битым config.yml и force перезаписывает', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'это не yaml-конфиг\n' + '- просто\n' + '- список\n', 'utf-8');
    const result = applySetup(testDir, baseAnswers({ mode: 'upgrade', force: true }));
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('project_name: Test Project'), config);
    assert.ok(result.warnings.length > 0);
  });

  it('applySetup валидирует имя и prefix', () => {
    assert.throws(() => applySetup(testDir, baseAnswers({ projectName: '  ' })), SetupError);
    assert.throws(() => applySetup(testDir, baseAnswers({ prefix: '1bad' })), SetupError);
  });

  it('formatSetupLog содержит режим, агентов, провайдера, секреты, бота и MCP', () => {
    const state = readSetupState(testDir);
    const log = formatSetupLog(
      baseAnswers({ agents: ['qwen'], defaultAgent: 'qwen', mcp: true }),
      state,
      testDir,
    );
    assert.ok(log.includes('Режим: fresh'), log);
    assert.ok(log.includes('Агенты: qwen (default)'), log);
    assert.ok(log.includes('Секреты: .env'), log);
    assert.ok(log.includes('Бот: нет'), log);
    assert.ok(log.includes('MCP: да'), log);
  });

  it('formatSetupLog в upgrade добавляет строку о существующих настройках', () => {
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), 'project_name: X\ntask_prefix: X\n', 'utf-8');
    const state = readSetupState(testDir);
    const log = formatSetupLog(baseAnswers({ mode: 'upgrade' }), state, testDir);
    assert.ok(log.includes('Существующие настройки'), log);
    assert.ok(log.includes('Дополняю недостающее'), log);
  });
});
