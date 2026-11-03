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
import { resolveModelById } from '../../dist/core/models.js';
import {
  defaultApiKeyEnv,
  gatewayIdFromUrl,
  groupModelsByAuthor,
  modelAuthor,
  secretsLocationOptions,
  LLM_GATEWAYS,
} from '../../dist/cli/commands/init-wizard.js';

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

  it('init --provider/--model пишет gateways и models в settings.json', () => {
    runCli(
      'init', 'Llm', '--prefix', 'll', '--yes',
      '--agents', 'vb', '--skip-llm-check',
      '--provider', 'p1', '--base-url', 'https://api.example/v1', '--api-key-env', 'P1_KEY',
      '--model', 'p1/m1', '--api-mode', 'chat',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.gateways.p1.base_url, 'https://api.example/v1');
    assert.equal(settings.gateways.p1.api_key_env, 'P1_KEY');
    assert.equal(settings.models.default, 'p1/m1');
    assert.equal(settings.models.available['p1/m1'].api_mode, 'chat');
  });

  it('VL-324: --api-mode по умолчанию responses, рантайм-фолбэк не тронут', () => {
    runCli(
      'init', 'LlmDefault', '--prefix', 'ld', '--yes',
      '--agents', 'vb', '--skip-llm-check',
      '--gateway', 'routerai', '--base-url', 'https://routerai.ru/api/v1',
      '--model', 'openai/gpt-4o',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.models.available['openai/gpt-4o'].api_mode, 'responses');
    // AC7: имя env-переменной выводится из шлюза
    assert.equal(settings.gateways.routerai.api_key_env, 'ROUTERAI_API_KEY');
    // AC9: resolveModelById находит созданную модель
    const resolved = resolveModelById(testDir, 'openai/gpt-4o');
    assert.ok(resolved, 'модель резолвится');
    assert.equal(resolved.gatewayId, 'routerai');
    assert.equal(resolved.model, 'openai/gpt-4o');
  });

  it('VL-324: --vendor пишется в models.available, @-хвост срезается из model', () => {
    runCli(
      'init', 'LlmVendor', '--prefix', 'lv', '--yes',
      '--agents', 'vb', '--skip-llm-check',
      '--gateway', 'routerai', '--base-url', 'https://routerai.ru/api/v1',
      '--model', 'openai/gpt-4o@openai', '--vendor', 'openai',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.models.available['openai/gpt-4o'].vendor, 'openai');
    assert.equal(settings.models.available['openai/gpt-4o'].model, 'openai/gpt-4o');
  });

  it('VL-324: --bot-proxy пишется в .env, пустой прокси ключа не создаёт', () => {
    runCli(
      'init', 'Proxy', '--prefix', 'px', '--yes',
      '--agents', '', '--bot-token', '1:a', '--skip-bot-check',
      '--bot-proxy', 'socks5://127.0.0.1:1080',
    );
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('TELEGRAM_PROXY=socks5://127.0.0.1:1080'), env);

    fresh();
    runCli(
      'init', 'NoProxy', '--prefix', 'np', '--yes',
      '--agents', '', '--bot-token', '1:a', '--skip-bot-check',
    );
    const env2 = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(!env2.includes('TELEGRAM_PROXY'), env2);
  });

  it('VL-324: --secrets-location system не пишет .env, но сообщает имена', () => {
    const out = runCli(
      'init', 'Sys', '--prefix', 'sy', '--yes',
      '--agents', '', '--secrets-location', 'system',
      '--bot-token', '9:z', '--skip-bot-check',
    );
    assert.ok(!existsSync(join(testDir, '.env')), '.env не создаётся');
    assert.ok(out.includes('TELEGRAM_BOT_TOKEN'), `в выводе должно быть имя ключа: ${out}`);
  });

  it('VL-324: gatewayIdFromUrl выводит id из домена, defaultApiKeyEnv — имя ключа', () => {
    // AC4: api.cloud.ru → cloud_ru (служебный поддомен api отброшен, зона осталась)
    assert.equal(gatewayIdFromUrl('https://api.cloud.ru/aig/v1'), 'cloud_ru');
    assert.equal(gatewayIdFromUrl('https://routerai.ru/api/v1'), 'routerai_ru');
    assert.equal(gatewayIdFromUrl('http://localhost:8080/v1'), 'localhost');
    assert.ok(gatewayIdFromUrl('не-url').length > 0, 'мусорный ввод не роняет вывод id');
    assert.equal(defaultApiKeyEnv('routerai'), 'ROUTERAI_API_KEY');
    assert.equal(defaultApiKeyEnv('selectel_router'), 'SELECTEL_ROUTER_API_KEY');
    assert.equal(defaultApiKeyEnv('cloud_ru'), 'CLOUD_RU_API_KEY');
    assert.equal(defaultApiKeyEnv('my-gw.example'), 'MY_GW_EXAMPLE_API_KEY');
  });

  it('VL-324: хардкод-список шлюзов содержит RouterAI, Selectel и OpenAI-совместимый', () => {
    const ids = LLM_GATEWAYS.map((g) => g.id);
    assert.deepEqual(ids, ['routerai', 'selectel_router', 'openai_compatible']);
    const routerai = LLM_GATEWAYS[0];
    assert.equal(routerai.base_url, 'https://routerai.ru/api/v1');
    assert.equal(routerai.api_key_env, 'ROUTERAI_API_KEY');
    assert.equal(routerai.catalog, true);
    const selectel = LLM_GATEWAYS[1];
    assert.equal(selectel.base_url, 'https://api.selectel.ru/aig/v1');
    assert.equal(selectel.api_key_env, 'SELECTEL_ROUTER_API_KEY');
  });

  it('VL-320: без --prefix prefix выводится из имени проекта (Vibelog Templates → VT)', () => {
    const out = runCli('init', 'Vibelog Templates', '--yes');
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('task_prefix: VT'), `${config}\n${out}`);
  });

  it('VL-320: явный --prefix приоритетнее вывода из имени', () => {
    runCli('init', 'Vibelog Templates', '--prefix', 'zz', '--yes');
    const config = readFileSync(join(testDir, 'backlog', 'config.yml'), 'utf-8');
    assert.ok(config.includes('task_prefix: zz'), config);
  });

  it('VL-320: --web запускает web-мастер, а не консольный wizard', async () => {
    // Сервер держит процесс — запускаем асинхронно, ждём строку и гасим
    const { spawn } = await import('node:child_process');
    const child = spawn('node', [cliPath, 'init', '--web', '--port', '0', '--no-open'], {
      cwd: testDir,
      env: testSpawnEnv(),
    });
    let out = '';
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 15000);
      const onData = (chunk) => {
        out += chunk.toString('utf8');
        if (out.includes('Веб-мастер настройки')) {
          clearTimeout(timer);
          resolve('ok');
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve('exit');
      });
    });
    const result = await done;
    child.kill('SIGKILL');
    assert.equal(result, 'ok', `web-мастер не стартовал: ${out}`);
    assert.ok(out.includes('Веб-мастер настройки'), out);
    assert.ok(!out.includes('Режим: fresh'), `консольный wizard не должен запускаться: ${out}`);
  });

  // ── VL-327 ──

  it('VL-327: modelAuthor берёт сегмент id до "/"', () => {
    assert.equal(modelAuthor('deepseek/deepseek-chat'), 'deepseek');
    assert.equal(modelAuthor('xiaomi/mimo-v2.6-pro'), 'xiaomi');
    assert.equal(modelAuthor('без-слэша'), 'без-слэша');
  });

  it('VL-327: groupModelsByAuthor группирует по автору и сортирует авторов', () => {
    const models = [
      { id: 'xiaomi/mimo-v2' },
      { id: 'deepseek/deepseek-chat' },
      { id: 'deepseek/deepseek-reasoner' },
      { id: 'openai/gpt-5' },
    ];
    const groups = groupModelsByAuthor(models);
    assert.deepEqual([...groups.keys()], ['deepseek', 'openai', 'xiaomi']);
    assert.equal(groups.get('deepseek').length, 2, 'модели автора не обрезаны');
    assert.deepEqual(
      groups.get('deepseek').map((m) => m.id),
      ['deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'],
    );
  });

  it('VL-327: список моделей автора не обрезан лимитом каталога (50+)', () => {
    // Каталог RouterAI: у одного автора десятки моделей — все должны попасть
    // в список, иначе пользователь снова не найдёт нужную (регресс AC4)
    const models = Array.from({ length: 70 }, (_, i) => ({ id: `deepseek/model-${i}` }));
    const groups = groupModelsByAuthor(models);
    assert.equal(groups.get('deepseek').length, 70);
  });

  it('VL-327: один автор — шаг выбора автора пропускается (группа одна)', () => {
    const groups = groupModelsByAuthor([{ id: 'only/a' }, { id: 'only/b' }]);
    assert.equal(groups.size, 1, 'при одном авторе select автора не нужен');
    assert.equal([...groups.keys()][0], 'only');
  });

  it('VL-327: secretsLocationOptions — ровно два пункта, без settings/both', () => {
    const options = secretsLocationOptions();
    assert.equal(options.length, 2);
    assert.deepEqual(options.map((o) => o.value), ['system', 'env']);
    assert.ok(options[0].label.includes('env (Приоритет: env → .env)'), options[0].label);
    assert.ok(options[1].label.includes('.env (файл в корне проекта)'), options[1].label);
    const labels = options.map((o) => o.label).join(' | ');
    assert.ok(!labels.includes('settings.json'), `пункт settings.json не должен предлагаться: ${labels}`);
    assert.ok(!labels.includes('оба места'), `пункт «оба места» не должен предлагаться: ${labels}`);
  });

  it('VL-327: флаг --secrets-location settings по-прежнему работает (старые проекты)', () => {
    runCli(
      'init', 'Legacy', '--prefix', 'lg', '--yes',
      '--agents', '', '--secrets-location', 'settings',
      '--bot-token', '7:q', '--skip-bot-check',
    );
    const settings = JSON.parse(readFileSync(join(testDir, '.vibelog', 'settings.json'), 'utf-8'));
    assert.equal(settings.env.TELEGRAM_BOT_TOKEN, '7:q');
  });

  it('VL-327: ключ, записанный wizard-ом в .env, виден проверке LLM (не «не найден в окружении»)', () => {
    // Регресс на наблюдавшийся 401: без повторного loadProjectEnv после
    // applySetup ping уходил с apiKey === '' и печатал «ключ X не найден
    // в окружении» (а до VL-327 — бесполезное «LLM ответил 401»).
    // base_url — заведомо закрытый локальный порт: соединение отклоняется
    // сразу, внешней сети тест не касается.
    const out = runCli(
      'init', 'EnvReload', '--prefix', 'er', '--yes',
      '--agents', 'vb',
      '--gateway', 'routerai', '--base-url', 'http://127.0.0.1:1/v1',
      '--api-key-env', 'VL327_TEST_KEY',
      '--model', 'openai/gpt-4o', '--api-key', 'test-key-not-a-secret',
    );
    // Ключ попал в .env и перечитан: проверка ругается на сеть, а не на ключ
    const env = readFileSync(join(testDir, '.env'), 'utf-8');
    assert.ok(env.includes('VL327_TEST_KEY=test-key-not-a-secret'), env);
    assert.ok(
      !out.includes('VL327_TEST_KEY не найден в окружении'),
      `окружение не перечитано после applySetup: ${out}`,
    );
    assert.ok(out.includes('LLM:'), `проверка LLM не выполнилась: ${out}`);
  });
});
