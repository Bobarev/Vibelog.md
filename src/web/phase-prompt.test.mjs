/**
 * Тесты renderPrompt и шаблона close-worktree (VL-109, VL-112; чистка VL-130).
 *
 * Проверяются только СТРУКТУРНЫЕ свойства: подстановка {{taskId}}/{{branch}}/
 * {{worktreeDir}}, отсутствие неподставленных {{...}}, различие собранных
 * промптов close с опцией closeWorktree и без (сравнением промптов, а не по
 * конкретной фразе шаблона). Assert-ы на конкретные формулировки текста
 * шаблонов удалены (VL-130): правка любого текста templates/qwen-commands/*.md
 * не должна ломать тесты.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPrompt } from '../../dist/web/phase-prompt.js';

const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

describe('renderPrompt — подстановка taskId (VL-109)', () => {
  it('taskId подставляется, неподставленных {{taskId}} не остаётся', () => {
    const prompt = renderPrompt('code', 'VL-109');
    assert.ok(prompt.includes('VL-109'), 'taskId должен подставиться');
    assert.ok(!prompt.includes('{{taskId}}'), 'неподставленный {{taskId}} не должен остаться');
    assert.ok(prompt.length > 0, 'промпт собран не пустой');
  });
});

describe('close в worktree — отдельный шаблон (VL-112)', () => {
  it('шаблон phase-close-worktree.md существует и содержит все подстановки', () => {
    const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');
    assert.ok(text.includes('{{taskId}}'), 'подстановка taskId в шаблоне');
    assert.ok(text.includes('{{branch}}'), 'подстановка branch в шаблоне');
    assert.ok(text.includes('{{worktreeDir}}'), 'подстановка worktreeDir в шаблоне');
  });

  it('renderPrompt({ closeWorktree: true }) использует другой шаблон, чем обычный close', () => {
    const vars = { branch: 'vb/vl-77', worktreeDir: '.vibelog/worktrees/vl-77' };
    const p = renderPrompt('close', 'VL-77', vars, { closeWorktree: true });
    const plain = renderPrompt('close', 'VL-77', vars);
    // Различие шаблонов проверяем сравнением собранных промптов,
    // а не по конкретной фразе worktree-шаблона (VL-130)
    assert.ok(p !== plain, 'closeWorktree-промпт должен отличаться от обычного close');
    assert.ok(p.includes('VL-77'), 'taskId подставлен');
    assert.ok(p.includes('vb/vl-77'), '{{branch}} подставлен');
    assert.ok(p.includes('.vibelog/worktrees/vl-77'), '{{worktreeDir}} подставлен');
    assert.ok(!p.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('обычный close без опции — прежний шаблон без подстановок worktree', () => {
    const p = renderPrompt('close', 'VL-77');
    assert.ok(p.includes('VL-77'), 'taskId подставлен');
    assert.ok(!p.includes('{{'), 'неподставленных подстановок не остаться');
  });
});
