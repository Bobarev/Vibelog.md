/**
 * Тесты VL-381 — прогресс сетевых операций `vb install`.
 *
 * Зачем отдельный файл. Проверяются две независимые вещи:
 * 1) `createProgressPrinter` (чистая функция над событиями транспорта) —
 *    формат строк, однократность предупреждения про 429, различие текстов при
 *    наличии и отсутствии токена;
 * 2) CLI целиком — прогресс идёт в STDERR, а stdout остаётся чистым (`--dry-run`
 *    парсится скриптами), `--verbose` добавляет URL, токен не печатается.
 *
 * Сети нет: фикстура — локальный `node:http`-сервер в mkdtemp-каталоге
 * (`testSpawnEnv`, VL-286). Паузы на 429 в CLI-тестах не воспроизводятся:
 * политика ретраев не меняется (VL-381 — только наблюдаемость), а настоящие
 * 60 с в тесте неприемлемы — паузы проверяются на уровне принтера.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';
import { RATE_LIMIT_BUDGET_MS } from '../../dist/core/gitverse-http.js';
import { createProgressPrinter } from '../../dist/cli/commands/install.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-install-progress-'));

/** Собирает принтер с перехватом строк. */
function collector(overrides = {}) {
  const lines = [];
  const print = createProgressPrinter({
    verbose: false,
    hasToken: false,
    write: (line) => lines.push(line),
    ...overrides,
  });
  return { lines, print };
}

/** Событие ожидания на 429. */
function rateLimitWait(attempt = 2, attemptsMax = 4) {
  return {
    kind: 'waiting',
    url: 'https://gitverse.ru/x',
    attempt,
    attemptsMax,
    delayMs: 60_000,
    reason: 'rate_limited',
  };
}

describe('VL-381: createProgressPrinter', () => {
  it('без --verbose URL не печатается, пауза — предупреждение + строка ожидания', () => {
    const { lines, print } = collector();
    print({ kind: 'request', url: 'https://gitverse.ru/secret-путь', attempt: 1, attemptsMax: 3 });
    print({ kind: 'response', url: 'https://gitverse.ru/x', attempt: 1, attemptsMax: 3, status: 200 });
    print(rateLimitWait());
    // Запрос и ответ без --verbose молчат; пауза даёт диагностику (один раз)
    // и строку «жду».
    assert.equal(lines.length, 2, `лишние строки: ${JSON.stringify(lines)}`);
    assert.match(lines[1], /жду 60 с \(429, попытка 2\/4\)/);
    assert.ok(!lines[1].includes('https://'), 'URL без --verbose не печатается');
  });

  it('с --verbose печатает URL, статус, размер и попытку', () => {
    const { lines, print } = collector({ verbose: true });
    print({ kind: 'request', url: 'https://gitverse.ru/a.json', attempt: 1, attemptsMax: 3 });
    print({
      kind: 'response',
      url: 'https://gitverse.ru/a.json',
      attempt: 1,
      attemptsMax: 3,
      status: 200,
      bytes: 1234,
    });
    assert.match(lines[0], /GET https:\/\/gitverse\.ru\/a\.json .*попытка 1\/3/);
    assert.match(lines[1], /← 200 \(1234 байт\)/);
  });

  it('429 без токена: предупреждение сразу и ровно один раз, с оценкой бюджета', () => {
    const { lines, print } = collector();
    print(rateLimitWait(2, 4));
    print(rateLimitWait(3, 4));
    const warnings = lines.filter((line) => line.includes('GITVERSE_TOKEN'));
    assert.equal(warnings.length, 1, `предупреждение повторилось: ${JSON.stringify(lines)}`);
    assert.match(warnings[0], /ограничил анонимные запросы/);
    assert.match(warnings[0], /попытка 2\/4/);
    assert.match(
      warnings[0],
      new RegExp(`суммарно до ${Math.round(RATE_LIMIT_BUDGET_MS / 1000)} с`),
    );
  });

  it('429 с токеном: другой текст, токена в выводе нет', () => {
    const { lines, print } = collector({ hasToken: true, verbose: true });
    print(rateLimitWait());
    const warning = lines.find((line) => line.includes('429'));
    assert.ok(warning, `нет предупреждения: ${JSON.stringify(lines)}`);
    assert.match(warning, /даже с токеном/);
    assert.ok(!lines.join('\n').includes('ограничил анонимные'));
  });

  it('5xx-пауза печатается только в --verbose и не путается с 429', () => {
    const quiet = collector();
    quiet.print({ kind: 'waiting', url: 'u', attempt: 2, attemptsMax: 3, delayMs: 1500, reason: 'server' });
    assert.deepEqual(quiet.lines, []);

    const loud = collector({ verbose: true });
    loud.print({ kind: 'waiting', url: 'u', attempt: 2, attemptsMax: 3, delayMs: 1500, reason: 'server' });
    assert.equal(loud.lines.length, 1);
    assert.match(loud.lines[0], /жду 2 с \(5xx, попытка 2\/3\)/);
  });
});

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
    const path = decodeURIComponent(rest.slice(rest.indexOf('/') + 1));
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

/** Чистый проект с секцией `components`. */
function freshProject() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(testDir, '.vibelog'), { recursive: true });
  const components = {
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
  writeFileSync(
    join(testDir, '.vibelog', 'settings.json'),
    `${JSON.stringify({ components }, null, 2)}\n`,
    'utf-8',
  );
  return testDir;
}

/** Однофайловый элемент `button` в фикстуре реестра. */
function seedButton() {
  const item = {
    name: 'button',
    type: 'registry:ui',
    version: '1.0.0',
    dependencies: [],
    registryDependencies: [],
    files: [
      { path: 'src/lib/components/ui/button.svelte', target: 'button.svelte', type: 'registry:ui' },
    ],
  };
  registryFiles['public/r/button.json'] = JSON.stringify(item);
  registryFiles['src/lib/components/ui/button.svelte'] = 'button\n';
}

/** Запуск CLI: stdout и stderr собираются РАЗДЕЛЬНО (в этом смысл задачи). */
function runCli(args, extraEnv = {}) {
  const env = testSpawnEnv({ VIBELOG_REGISTRY_BASE_URL: baseUrl, ...extraEnv });
  // Токен из окружения агентской сессии не должен попадать в тест.
  delete env.GITVERSE_TOKEN;
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], { cwd: testDir, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

describe('VL-381: vb install — прогресс', () => {
  it('--dry-run: прогресс в stderr, stdout — только план', async () => {
    freshProject();
    seedButton();

    const { stdout, stderr, code } = await runCli(['install', 'vibelog.md/ui/button', '--dry-run']);
    assert.equal(code, 0, stderr);
    assert.match(stderr, /→ скачиваю vibelog\.md\/ui\/button…/);
    assert.match(stderr, /→ скачиваю файлы \(1\)…/);
    assert.match(stdout, /План установки/, 'stdout должен содержать план');
    assert.ok(
      !stdout.includes('скачиваю'),
      `прогресс попал в stdout: ${JSON.stringify(stdout)}`,
    );
    assert.ok(!stdout.includes('https://'), 'URL без --verbose в stdout не появляется');
  });

  it('--verbose добавляет URL и HTTP-статус в stderr, не в stdout', async () => {
    freshProject();
    seedButton();

    const { stdout, stderr, code } = await runCli([
      'install',
      'vibelog.md/ui/button',
      '--dry-run',
      '--verbose',
    ]);
    assert.equal(code, 0, stderr);
    assert.ok(stderr.includes('GET '), `нет URL в stderr: ${JSON.stringify(stderr)}`);
    assert.ok(stderr.includes('public/r/button.json'), 'URL манифеста не напечатан');
    assert.match(stderr, /← 200/);
    assert.match(stderr, /токен: нет/);
    assert.ok(!stdout.includes('public/r/button.json'), 'URL утёк в stdout');
  });

  it('--verbose не печатает сам токен, только источник', async () => {
    freshProject();
    seedButton();
    const secret = 'gv_supersecret_token_value';
    writeFileSync(join(testDir, '.env'), `GITVERSE_TOKEN=${secret}\n`, 'utf-8');

    const { stdout, stderr, code } = await runCli([
      'install',
      'vibelog.md/ui/button',
      '--dry-run',
      '--verbose',
    ]);
    assert.equal(code, 0, stderr);
    assert.match(stderr, /токен: из \.env/);
    assert.ok(!stderr.includes(secret), 'токен утёк в stderr');
    assert.ok(!stdout.includes(secret), 'токен утёк в stdout');
  });

  it('без --verbose URL и токен источника в stderr не печатаются', async () => {
    freshProject();
    seedButton();

    const { stdout, stderr, code } = await runCli(['install', 'vibelog.md/ui/button', '--dry-run']);
    assert.equal(code, 0, stderr);
    assert.ok(!stderr.includes('GET '), 'без --verbose URL печататься не должен');
    assert.ok(!stderr.includes('токен:'), 'без --verbose источник токена не печатается');
    assert.ok(!stdout.includes('скачиваю'));
  });
});
