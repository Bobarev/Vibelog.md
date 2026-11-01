/**
 * Тесты системного промпта агента (src/agent/system-prompt.ts); чистка VL-130.
 *
 * Временные каталоги в /tmp (изоляция — память cli-test-isolation):
 * без AGENTS.md, с AGENTS.md, обрезка по лимиту, ошибка чтения
 * (AGENTS.md как каталог → EISDIR — промпт собирается без него).
 *
 * Проверяются только структурные свойства: hasAgentsMd, включение данных
 * тестового AGENTS.md, лимит длины вставки, стабильность повторной сборки,
 * отсутствие ID задач VL-N. Assert-ы на конкретные формулировки
 * templates/agent-prompt.md удалены (VL-130): правка текста шаблона
 * не должна ломать тесты.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSystemPrompt, loadAgentChatRules, AGENTS_MD_MAX_CHARS } from '../../dist/agent/system-prompt.js';

/** Путь к шаблону базовой части (тот же, что в system-prompt.ts). */
const agentPromptPath = fileURLToPath(new URL('../../templates/agent-prompt.md', import.meta.url));

/** Путь к встроенному шаблону блока чат-режима (VL-238). */
const agentChatPromptPath = fileURLToPath(new URL('../../templates/agent-prompt-chat.md', import.meta.url));

/** Базовая часть промпта как её читает buildSystemPrompt: шаблон без хвостовых пробелов. */
function basePrompt() {
  return readFileSync(agentPromptPath, 'utf-8').trimEnd();
}

/** Временный cwd + автоочистка. */
function withTmpCwd(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-agent-sysprompt-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('buildSystemPrompt (VL-96)', () => {
  it('без AGENTS.md — только базовая часть, hasAgentsMd=false', () => {
    withTmpCwd((dir) => {
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, false);
      // Структурно: промпт равен шаблону базовой части, а не его фрагменту
      assert.equal(content, basePrompt(), 'без AGENTS.md промпт — ровно базовая часть');
      // Служебный разделитель добавляется только при подключении AGENTS.md
      assert.ok(!content.includes('# AGENTS.md проекта'), 'разделителя AGENTS.md быть не должно');
    });
  });

  it('с AGENTS.md — содержимое подключено, базовая часть сохраняется', () => {
    withTmpCwd((dir) => {
      // Уникальный текст тестового AGENTS.md — вводные данные теста, не шаблон
      writeFileSync(join(dir, 'AGENTS.md'), '# Правила\nНе ломай сборку.', 'utf-8');
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, true);
      assert.ok(content.includes('Не ломай сборку'), 'AGENTS.md подключён в промпт');
      // Базовая часть — стабильный префикс, содержимое AGENTS.md идёт после неё
      assert.ok(content.startsWith(basePrompt()), 'базовая часть должна сохраняться');
    });
  });

  it('большой AGENTS.md обрезается по лимиту', () => {
    withTmpCwd((dir) => {
      // Подкаталог без AGENTS.md — чтобы получить длину чистой базовой части
      const base = buildSystemPrompt(join(dir, 'no-agents')).content;
      const big = 'а'.repeat(AGENTS_MD_MAX_CHARS + 500);
      writeFileSync(join(dir, 'AGENTS.md'), big, 'utf-8');
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, true);
      // Вставка ограничена лимитом: общий размер — базовая часть + лимит + запас
      // на служебный разделитель и пометку об обрезке
      assert.ok(
        content.length <= base.length + AGENTS_MD_MAX_CHARS + 200,
        `промпт должен обрезаться по лимиту (длина ${content.length})`,
      );
      // Неразрезанный хвост не должен попасть в промпт: подряд идущих «а» больше лимита быть не может
      assert.ok(!content.includes('а'.repeat(AGENTS_MD_MAX_CHARS + 100)), 'вставка должна быть обрезана');
    });
  });

  it('ошибка чтения (AGENTS.md — каталог) не роняет сборку', () => {
    withTmpCwd((dir) => {
      mkdirSync(join(dir, 'AGENTS.md'));
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, false);
      assert.equal(content, basePrompt(), 'промпт собирается без AGENTS.md');
    });
  });

  it('сборка стабильна: повторный вызов даёт тот же текст (VL-109)', () => {
    withTmpCwd((dir) => {
      assert.equal(buildSystemPrompt(dir).content, buildSystemPrompt(dir).content);
    });
  });

  it('VL-117: в базовой части нет упоминаний VL-N (шаблон универсален для других проектов)', () => {
    withTmpCwd((dir) => {
      const { content } = buildSystemPrompt(dir);
      assert.ok(!/VL-\d+/.test(content), 'базовая часть промпта не должна содержать ID задач Vibelog');
    });
  });

  // VL-249: правило «не удаляй собственный рабочий каталог» проверяем по
  // техническим токенам (командам), а не по формулировке — правка прозы
  // шаблона тест не должна ломать (принцип VL-130).
  it('VL-249: базовая часть запрещает удаление собственного cwd и указывает уборку worktree из главного каталога', () => {
    withTmpCwd((dir) => {
      const { content } = buildSystemPrompt(dir);
      assert.match(content, /worktree remove/);
      assert.match(content, /worktree prune/);
      assert.match(content, /rmSync\(process\.cwd\(\)\)|rm -rf \./);
    });
  });
});

// VL-238: правила чат-режима — opt-in, проверяем по устойчивым токенам
// (не по дословной формулировке, принцип VL-130).
describe('buildSystemPrompt — блок чат-режима (VL-238)', () => {
  it('AC2: opts.chat=true подключает блок правил, дефолт — нет (фазы не затронуты)', () => {
    withTmpCwd((dir) => {
      const chat = buildSystemPrompt(dir, { chat: true }).content;
      const phase = buildSystemPrompt(dir).content;
      assert.match(chat, /Продолжи/, 'правило «Продолжи» = запрос результата');
      assert.match(chat, /не проверено/, 'пометка непроверенного при исчерпании тайм-бокса');
      assert.match(chat, /8–10 вызовов/, 'ориентир тайм-бокса');
      // Инвариант «правила чата не протекают в headless-фазы». Токен «Продолжи»
      // для этого не годится: он уже есть в базовой части (resume-фаза), поэтому
      // проверяем уникальные маркеры самого блока.
      assert.doesNotMatch(phase, /Режим ответа/, 'без opts.chat блок не подключается');
      assert.doesNotMatch(phase, /не проверено/);
      assert.doesNotMatch(phase, /8–10 вызовов/);
      // Базовая часть сохранена как префикс
      assert.ok(chat.startsWith(basePrompt()), 'базовая часть должна оставаться префиксом');
    });
  });

  it('AC2: порядок сборки — база → чат-блок → AGENTS.md проекта', () => {
    withTmpCwd((dir) => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Правила\nНе ломай сборку.', 'utf-8');
      const { content } = buildSystemPrompt(dir, { chat: true });
      const baseIdx = content.indexOf(basePrompt());
      const chatIdx = content.indexOf('Режим ответа');
      const agentsIdx = content.indexOf('# AGENTS.md проекта');
      assert.ok(baseIdx === 0, 'базовая часть идёт первой');
      assert.ok(chatIdx > baseIdx, 'чат-блок после базовой части');
      assert.ok(agentsIdx > chatIdx, 'AGENTS.md — последним');
    });
  });

  it('AC3: проектное переопределение .vibelog/prompts/agent-prompt-chat.md приоритетнее встроенного', () => {
    withTmpCwd((dir) => {
      mkdirSync(join(dir, '.vibelog', 'prompts'), { recursive: true });
      writeFileSync(
        join(dir, '.vibelog', 'prompts', 'agent-prompt-chat.md'),
        'ПРОЕКТНЫЕ ПРАВИЛА ЧАТА',
        'utf-8',
      );
      assert.equal(loadAgentChatRules(dir), 'ПРОЕКТНЫЕ ПРАВИЛА ЧАТА');
      const { content } = buildSystemPrompt(dir, { chat: true });
      assert.ok(content.includes('ПРОЕКТНЫЕ ПРАВИЛА ЧАТА'), 'проектный блок подставлен');
      assert.ok(!content.includes('8–10 вызовов'), 'встроенный блок заменён проектным');
    });
  });

  it('AC3: оба шаблона отсутствуют → fail-closed с понятной ошибкой', () => {
    withTmpCwd((dir) => {
      const backup = `${agentChatPromptPath}.vl238-backup`;
      renameSync(agentChatPromptPath, backup);
      try {
        assert.throws(
          () => loadAgentChatRules(dir),
          /Шаблон промпта чат-режима не найден/,
          'fail-closed ошибка при отсутствии обоих файлов',
        );
      } finally {
        renameSync(backup, agentChatPromptPath);
      }
    });
  });

  it('AC1: встроенный шаблон чат-режима компактен (≤10 непустых строк)', () => {
    const text = readFileSync(agentChatPromptPath, 'utf-8');
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    assert.ok(lines.length <= 10, `блок чат-режима должен быть компактным (${lines.length} строк)`);
  });
});
