/**
 * Тесты PLAN-09.1 — диагностика (--version, doctor).
 *
 * Проверяет:
 * - vibelog --version выводит имя, версию, пути
 * - vibelog --version --json выводит JSON
 * - vibelog -v выводит только версию
 * - vibelog doctor выполняет проверки окружения
 * - vibelog doctor --json выводит структурированный результат
 * - Exit code при провале обязательных проверок
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testDir = join(__dirname, '..', '..', '.test-diagnostics');

// Читаем версию динамически из package.json, чтобы тесты не ломались при бампе
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version;

/**
 * Извлекает первый JSON-объект из строки.
 *
 * @param {string} out
 * @returns {object}
 */
function extractJson(out) {
  const start = out.indexOf('{');
  assert.ok(start >= 0, 'должен быть JSON');
  // Находим matching closing brace
  let depth = 0;
  let end = start;
  for (let i = start; i < out.length; i++) {
    if (out[i] === '{') depth++;
    if (out[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return JSON.parse(out.slice(start, end));
}

function runCli(args, opts = {}) {
  let raw;
  try {
    raw = execFileSync('node', [cliPath, ...args], {
      cwd: opts.cwd || testDir,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    raw = (err.stdout || '') + (err.stderr || '');
  }
  // Фильтруем dyld-ошибки Catalina и пустые строки
  return raw.split('\n').filter(line =>
    line.trim() !== '' &&
    !line.includes('dyld:') && !line.includes('pwritev') && !line.includes('libSystem') &&
    !line.includes('Referenced from') && !line.includes('Expected in') &&
    !line.includes('Abort trap')
  ).join('\n');
}

describe('Диагностика — --version', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
  });
  after(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('--version выводит имя, версию, пути, node', () => {
    const out = runCli(['--version']);
    assert.ok(out.includes('vibelog.md'), 'должно содержать имя');
    assert.ok(out.includes(VERSION), `должно содержать версию ${VERSION}`);
    assert.ok(out.includes('src:'), 'должно содержать src');
    assert.ok(out.includes('node:'), 'должно содержать node');
    assert.ok(out.includes('vibelog.mjs'), 'src должен указывать на bin/vibelog.mjs');
  });

  it('--version --json выводит JSON', () => {
    const out = runCli(['--version', '--json']);
    const json = extractJson(out);
    assert.equal(json.name, 'vibelog.md');
    assert.equal(json.version, VERSION);
    assert.ok(json.src.includes('vibelog.mjs'));
    assert.ok(json.node.startsWith('v'));
    assert.ok(json.engines.node >= '20');
  });

  it('-v выводит только номер версии', () => {
    const out = runCli(['-v']).trim();
    assert.equal(out, VERSION);
  });

  it('Версия читается из package.json (не 0.0.0)', () => {
    const out = runCli(['--version']);
    assert.ok(!out.includes('0.0.0'), 'версия не должна быть 0.0.0');
  });
});

describe('Диагностика — doctor', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
  });
  after(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('doctor выполняет все проверки', () => {
    const out = runCli(['doctor']);
    assert.ok(out.includes('node'), 'проверка node');
    assert.ok(out.includes('mcp_tools_count'), 'проверка MCP');
    assert.ok(out.includes('mcp_tools_list'), 'проверка списка MCP');
  });

  it('doctor --json выводит структурированный результат', () => {
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    assert.ok(json.ok !== undefined, 'поле ok');
    assert.ok(Array.isArray(json.checks), 'checks — массив');
    assert.ok(Array.isArray(json.warnings), 'warnings — массив');

    const names = json.checks.map(c => c.name);
    assert.ok(names.includes('node'), 'проверка node');
    assert.ok(names.includes('mcp_tools_count'), 'проверка количества MCP');
    assert.ok(names.includes('mcp_tools_list'), 'проверка списка MCP');
  });

  it('doctor --json: MCP-инструменты — 11 штук', () => {
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    const mcpCheck = json.checks.find(c => c.name === 'mcp_tools_count');
    assert.ok(mcpCheck);
    assert.equal(mcpCheck.value, 11);
  });

  it('doctor: exit code 0 при успехе (с backlog)', () => {
    // Инициализируем backlog, чтобы обязательная проверка backlog_dir прошла
    runCli(['init', 'Test', '--prefix', 'tst']);
    const out = runCli(['doctor', '--json']);
    const json = extractJson(out);
    assert.equal(json.ok, true, 'ok должен быть true при наличии backlog');
  });

  it('doctor: ok=false без backlog (обязательная проверка)', () => {
    // Используем директорию ВНЕ проекта, чтобы findBacklogDir не поднялся вверх
    const emptyDir = '/tmp/vibelog-doctor-empty';
    rmSync(emptyDir, { recursive: true, force: true });
    mkdirSync(emptyDir, { recursive: true });
    const out = runCli(['doctor', '--json'], { cwd: emptyDir });
    rmSync(emptyDir, { recursive: true, force: true });
    const json = extractJson(out);
    assert.equal(json.ok, false, 'ok должен быть false без backlog');
  });
});
