/**
 * Тесты консольного wizard-а `vibelog init` (VL-210).
 *
 * Спавнит CLI в mkdtemp-каталоге (testSpawnEnv — VL-286: без env агентской
 * сессии, иначе VIBELOG_CWD уводит CLI на главный репозиторий).
 * Без TTY wizard работает в non-interactive режиме (флаги/дефолты).
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-init-wizard-'));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/** Чистая директория для теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Запуск CLI в тестовом каталоге (stdout+stderr). */
function runCli(...args) {
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 20000,
    env: testSpawnEnv(),
  });
  return (r.stdout || '') + (r.stderr || '');
}

describe('VL-210 — консольный wizard init', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('init --yes создаёт backlog и settings без вопросов', () => {
    const out = runCli('init', 'Wizard Test', '--prefix', 'wt', '--yes');
    assert.ok(existsSync(join(testDir, 'backlog', 'config.yml')), out);
    assert.ok(existsSync(join(testDir, 'backlog', 'tasks')), out);
    assert.ok(existsSync(join(testDir, '.vibelog', 'settings.json')), out);
    assert.ok(existsSync(join(testDir, 'AGENTS.md')), out);
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('project_name: Wizard Test'), config);
    assert.ok(config.includes('task_prefix: wt'), config);
    // --yes без папок агентов: vb не добавляется автоматически
    assert.ok(out.includes('Агенты: нет'), out);
  });

  it('init --agents qwen --no-mcp не пишет MCP-секцию', () => {
    const out = runCli('init', 'NoMcp', '--prefix', 'nm', '--yes', '--agents', 'qwen', '--no-mcp');
    assert.ok(!existsSync(join(testDir, '.qwen', 'settings.json')), out);
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.default_agent, 'qwen');
  });

  it('init --agents qwen пишет MCP-секцию (по умолчанию mcp включён)', () => {
    runCli('init', 'WithMcp', '--prefix', 'wm', '--yes', '--agents', 'qwen');
    const qwen = JSON.parse(readFileSync(join(testDir, '.qwen', 'settings.json'), 'utf-8'));
    assert.equal(qwen.mcpServers.vibelog.trust, true);
  });

  it('init --agents "" — проект без агента', () => {
    const out = runCli('init', 'NoAgent', '--prefix', 'na', '--yes', '--agents', '');
    assert.ok(out.includes('Агенты: нет'), out);
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.default_agent, undefined);
  });

  it('init --mode upgrade дополняет настройки и не трогает задачи', () => {
    // Готовим «существующий» проект
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(testDir, 'backlog', 'config.yml'),
      'project_name: Existing\ntask_prefix: EX\n',
      'utf-8',
    );
    const taskPath = join(testDir, 'backlog', 'tasks', 'EX-1 - Задача.md');
    writeFileSync(taskPath, '---\nid: EX-1\n---\n\n# Задача\n', 'utf-8');
    const before = readFileSync(taskPath, 'utf-8');

    const out = runCli('init', '--mode', 'upgrade', '--yes', '--agents', 'qwen');
    assert.ok(out.includes('Режим: upgrade'), out);
    assert.equal(readFileSync(taskPath, 'utf-8'), before, 'задача не изменилась');
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.default_agent, 'qwen');
  });

  it('init --secrets-location settings --bot-token пишет env-секцию settings.json', () => {
    runCli(
      'init', 'Secrets', '--prefix', 'sc', '--yes',
      '--agents', '', '--secrets-location', 'settings',
      '--bot-token', '123:abc', '--skip-bot-check',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.TELEGRAM_BOT_TOKEN, '123:abc');
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся в режиме settings');
  });

  it('init --secrets-location env --bot-token пишет .env с шапкой', () => {
    runCli(
      'init', 'SecretsEnv', '--prefix', 'se', '--yes',
      '--agents', '', '--bot-token', '456:def', '--skip-bot-check',
    );
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_BOT_TOKEN=456:def'), env);
    assert.ok(env.startsWith('# Vibelog'), env);
  });

  it('повторный init без --force и без TTY — ошибка с подсказкой', () => {
    runCli('init', 'First', '--prefix', 'f1', '--yes');
    const out = runCli('init', 'Second', '--prefix', 'f2', '--yes');
    assert.ok(out.includes('уже инициализирован'), out);
    assert.ok(out.includes('--mode upgrade'), out);
  });

  it('init --help перечисляет новые флаги', () => {
    const out = runCli('init', '--help');
    for (const flag of ['--yes', '--mode', '--agents', '--secrets-location', '--no-mcp', '--web']) {
      assert.ok(out.includes(flag), `в help нет ${flag}: ${out}`);
    }
  });

  it('init --provider/--model пишет providers и models в settings.json', () => {
    runCli(
      'init', 'Llm', '--prefix', 'll', '--yes',
      '--agents', 'vb', '--skip-llm-check',
      '--provider', 'p1', '--base-url', 'https://api.example/v1', '--api-key-env', 'P1_KEY',
      '--model', 'p1/m1', '--api-mode', 'chat',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.providers.p1.base_url, 'https://api.example/v1');
    assert.equal(settings.providers.p1.api_key_env, 'P1_KEY');
    assert.equal(settings.models.default, 'p1/m1');
    assert.equal(settings.models.available['p1/m1'].api_mode, 'chat');
  });
});
