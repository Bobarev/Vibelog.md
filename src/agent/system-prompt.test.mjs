/**
 * Тесты VL-96 — системный промпт агента (src/agent/system-prompt.ts).
 *
 * Временные каталоги в /tmp (изоляция — память cli-test-isolation):
 * без AGENTS.md, с AGENTS.md, обрезка по лимиту, ошибка чтения
 * (AGENTS.md как каталог → EISDIR — промпт собирается без него).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSystemPrompt, AGENTS_MD_MAX_CHARS } from '../../dist/agent/system-prompt.js';

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
      assert.match(content, /Vibelog-agent/);
      assert.ok(!content.includes('# AGENTS.md проекта'));
    });
  });

  it('с AGENTS.md — содержимое подключено, базовая часть сохраняется', () => {
    withTmpCwd((dir) => {
      writeFileSync(join(dir, 'AGENTS.md'), '# Правила\nНе ломай сборку.', 'utf-8');
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, true);
      assert.match(content, /Не ломай сборку/);
      assert.match(content, /Vibelog-agent/);
    });
  });

  it('большой AGENTS.md обрезается по лимиту с пометкой', () => {
    withTmpCwd((dir) => {
      const big = 'а'.repeat(AGENTS_MD_MAX_CHARS + 500);
      writeFileSync(join(dir, 'AGENTS.md'), big, 'utf-8');
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, true);
      assert.ok(content.includes('обрезан'), 'пометка об обрезке должна присутствовать');
      // Неразрезанный хвост не должен попасть в промпт: подряд идущих «а» больше лимита быть не может
      assert.ok(!content.includes('а'.repeat(AGENTS_MD_MAX_CHARS + 100)), 'вставка должна быть обрезана');
    });
  });

  it('ошибка чтения (AGENTS.md — каталог) не роняет сборку', () => {
    withTmpCwd((dir) => {
      mkdirSync(join(dir, 'AGENTS.md'));
      const { content, hasAgentsMd } = buildSystemPrompt(dir);
      assert.equal(hasAgentsMd, false);
      assert.match(content, /Vibelog-agent/);
    });
  });
});
