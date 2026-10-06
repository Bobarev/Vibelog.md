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

// ============================================================
// VL-69 — промпты фаз под Epic/parentTaskId
// ============================================================

describe('VL-69 — промпты фаз поддержку Epic/parentTaskId', () => {
  const phasesDir = join(__dirname, '..', '..', 'templates', 'qwen-commands');

  it('phase-1.md (Spec) запрещает создание задач и упоминает epic', () => {
    const content = readFileSync(join(phasesDir, 'phase-1.md'), 'utf-8');
    assert.ok(content.includes('НЕ создавай'), 'запрет создания задач');
    assert.ok(content.includes('type=epic'), 'определение масштаба');
  });

  it('phase-2.md (Plan) содержит parentTaskId', () => {
    const content = readFileSync(join(phasesDir, 'phase-2.md'), 'utf-8');
    assert.ok(content.includes('parentTaskId'), 'parentTaskId');
  });

  it('phase-3.md (Code) содержит parentTaskId и backlog_list_tasks', () => {
    const content = readFileSync(join(phasesDir, 'phase-3.md'), 'utf-8');
    assert.ok(content.includes('parentTaskId'), 'parentTaskId');
    assert.ok(content.includes('backlog_list_tasks'), 'backlog_list_tasks');
  });

  it('phase-close.md (Close) содержит parentTaskId', () => {
    const content = readFileSync(join(phasesDir, 'phase-close.md'), 'utf-8');
    assert.ok(content.includes('parentTaskId'), 'parentTaskId');
  });
});
// ============================================================
// VL-105 — ревизия промптов: дубли устранены, дрейф закрыт
// ============================================================

describe('VL-105 — инварианты промптов', () => {
  const tmplDir = join(__dirname, '..', '..', 'templates', 'qwen-commands');
  const phaseFiles = [
    'phase-1.md', 'phase-2.md', 'phase-3.md', 'phase-close.md',
    'phase-comment.md', 'prompt.md', 'spec.md', 'plan.md', 'code.md',
  ];

  it('В шаблонах фаз нет pnpm и «Только Node.js» — правила проекта в AGENTS.md', () => {
    for (const name of phaseFiles) {
      const content = readFileSync(join(tmplDir, name), 'utf-8');
      assert.ok(!/pnpm/i.test(content), name + ': pnpm-правила не должны дублироваться');
      assert.ok(!/только node\.js/i.test(content), name + ': запрет рантаймов не должен дублироваться');
    }
  });

  it('code.md (интерактивный): статус исходной задачи — Review, Done только у эпика', () => {
    const content = readFileSync(join(tmplDir, 'code.md'), 'utf-8');
    assert.ok(content.includes('"status": "Review"'), 'статус исходной задачи — Review (как в phase-3.md)');
    // Done допустим ровно один раз — закрытие эпика, когда все дети Done
    const doneCount = (content.match(/"status": "Done"/g) || []).length;
    assert.equal(doneCount, 1, 'Done — только для эпика (все дети Done)');
  });

  it('plan.md содержит Planned — статус дочерним задачам и эпику', () => {
    const content = readFileSync(join(tmplDir, 'plan.md'), 'utf-8');
    assert.ok(content.includes('Planned'), 'установка Planned дочерним задачам');
  });

  it('spec.md: вопросы при неполном описании (синхронизация с phase-1)', () => {
    const content = readFileSync(join(tmplDir, 'spec.md'), 'utf-8');
    assert.ok(content.includes('задай вопросы'), 'вопросы пользователю при неполном описании');
  });

  it('BASE_PROMPT не дублирует AGENTS.md: нет русского языка и pnpm', () => {
    const content = readFileSync(join(__dirname, '..', '..', 'src', 'agent', 'system-prompt.ts'), 'utf-8');
    assert.ok(!content.includes('Отвечай на русском'), 'русский язык — в AGENTS.md проекта');
    assert.ok(!/pnpm/i.test(content), 'pnpm-правила — в AGENTS.md проекта');
  });
});

