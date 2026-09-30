/**
 * Тесты PLAN-10 — команды /vibelog:* для Qwen Code.
 *
 * Проверяет:
 * - Шаблоны templates/qwen-commands/{spec,plan,code}.md
 * - vibelog init --skills создаёт .qwen/commands/vibelog/
 * - vibelog init без --skills НЕ создаёт
 * - --skills=qwen работает, --skills=claude — ошибка
 * - Идемпотентность (повторный init не перезаписывает)
 * - --force перезаписывает
 * - AGENTS.md дополняется секцией VIBELOG:SKILLS
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
// Вне проекта — чтобы findBacklogDir не поднялся вверх к backlog/ проекта
const testDir = '/tmp/vibelog-skills-test';
const templatesDir = join(__dirname, '..', '..', 'templates', 'qwen-commands');

function runCli(args) {
  try {
    return execFileSync('node', [cliPath, ...args], {
      cwd: testDir, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '');
  }
}

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

// ============================================================
// Часть A: Шаблоны
// ============================================================

describe('PLAN-10 — шаблоны команд', () => {
  it('spec.md существует и содержит {{args}}', () => {
    const content = readFileSync(join(templatesDir, 'spec.md'), 'utf-8');
    assert.ok(content.includes('---'), 'YAML frontmatter');
    assert.ok(content.includes('description:'), 'description в frontmatter');
    assert.ok(content.includes('{{args}}'), '{{args}} в теле');
    assert.ok(content.includes('Фаза 1'), 'упоминание Фазы 1');
  });

  it('plan.md существует и содержит {{args}}', () => {
    const content = readFileSync(join(templatesDir, 'plan.md'), 'utf-8');
    assert.ok(content.includes('---'), 'YAML frontmatter');
    assert.ok(content.includes('description:'), 'description в frontmatter');
    assert.ok(content.includes('{{args}}'), '{{args}} в теле');
    assert.ok(content.includes('backlog_view_task'), 'MCP-инструмент');
    assert.ok(content.includes('backlog_update_task'), 'MCP-инструмент');
  });

  it('code.md существует и содержит {{args}}', () => {
    const content = readFileSync(join(templatesDir, 'code.md'), 'utf-8');
    assert.ok(content.includes('---'), 'YAML frontmatter');
    assert.ok(content.includes('description:'), 'description в frontmatter');
    assert.ok(content.includes('{{args}}'), '{{args}} в теле');
    assert.ok(content.includes('backlog_manage_ac'), 'MCP-инструмент');
    assert.ok(content.includes('backlog_add_comment'), 'MCP-инструмент');
    assert.ok(content.includes('backlog_update_status'), 'MCP-инструмент');
  });
});

// ============================================================
// Часть B: init --skills
// ============================================================

describe('PLAN-10 — init --skills', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });
  after(() => cleanup());

  it('init без --skills — команды /vibelog:* НЕ создаются', () => {
    runCli(['init', 'Test', '--prefix', 'tst']);
    // .qwen/settings.json теперь создаётся всегда (VL-6, MCP-автонастройка),
    // но команды /vibelog:* — только по флагу --skills
    assert.ok(!existsSync(join(testDir, '.qwen', 'commands', 'vibelog')), 'команды /vibelog:* не должны существовать');
  });

  it('init --skills создаёт .qwen/commands/vibelog/', () => {
    runCli(['init', 'Skills Test', '--prefix', 'skt', '--skills']);
    const dir = join(testDir, '.qwen', 'commands', 'vibelog');
    assert.ok(existsSync(join(dir, 'spec.md')), 'spec.md');
    assert.ok(existsSync(join(dir, 'plan.md')), 'plan.md');
    assert.ok(existsSync(join(dir, 'code.md')), 'code.md');
  });

  it('init --skills=qwen работает', () => {
    runCli(['init', 'Qwen Test', '--prefix', 'qwt', '--skills=qwen']);
    assert.ok(existsSync(join(testDir, '.qwen', 'commands', 'vibelog', 'spec.md')));
  });

  it('init --skills=claude — ошибка', () => {
    const out = runCli(['init', 'Claude Test', '--prefix', 'clt', '--skills=claude']);
    assert.ok(out.includes('claude') || out.includes('не поддерживается'), `Должна быть ошибка: ${out}`);
  });

  it('Идемпотентность: повторный init не перезаписывает', () => {
    runCli(['init', 'Idem Test', '--prefix', 'idt', '--skills']);
    // Модифицируем файл
    const specPath = join(testDir, '.qwen', 'commands', 'vibelog', 'spec.md');
    writeFileSync(specPath, 'MODIFIED', 'utf-8');
    // Повторный init
    runCli(['init', 'Idem Test', '--prefix', 'idt', '--skills']);
    const content = readFileSync(specPath, 'utf-8');
    assert.equal(content, 'MODIFIED', 'Файл не должен перезаписываться');
  });

  it('--force перезаписывает', () => {
    runCli(['init', 'Force Test', '--prefix', 'frt', '--skills']);
    const specPath = join(testDir, '.qwen', 'commands', 'vibelog', 'spec.md');
    writeFileSync(specPath, 'MODIFIED', 'utf-8');
    runCli(['init', 'Force Test', '--prefix', 'frt', '--skills', '--force']);
    const content = readFileSync(specPath, 'utf-8');
    assert.ok(content.includes('Фаза 1'), 'Файл должен быть перезаписан из шаблона');
  });

  it('AGENTS.md дополняется секцией VIBELOG:SKILLS', () => {
    runCli(['init', 'Ag Test', '--prefix', 'agt', '--skills']);
    const content = readFileSync(join(testDir, 'AGENTS.md'), 'utf-8');
    assert.ok(content.includes('VIBELOG:SKILLS:BEGIN'), 'BEGIN маркер');
    assert.ok(content.includes('VIBELOG:SKILLS:END'), 'END маркер');
    assert.ok(content.includes('/vibelog:spec'), 'упоминание /vibelog:spec');
  });

  it('Секция AGENTS.md не дублируется', () => {
    runCli(['init', 'Dup Test', '--prefix', 'dpt', '--skills']);
    runCli(['init', 'Dup Test', '--prefix', 'dpt', '--skills', '--force']);
    const content = readFileSync(join(testDir, 'AGENTS.md'), 'utf-8');
    const count = (content.match(/VIBELOG:SKILLS:BEGIN/g) || []).length;
    assert.equal(count, 1, 'Секция должна быть ровно одна');
  });
});
