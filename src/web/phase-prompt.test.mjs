/**
 * Тесты VL-109 — шаблоны фаз (templates/qwen-commands): раздел
 * «Экономия ходов» во всех шести шаблонах + регрессия renderPrompt.
 *
 * Причина правок — анализ сессии VL-98 (backlog/docs/doc-12): агент тратил
 * бюджет фазы на перечитывание файлов из плана и чтение задач-инцидентов
 * по упоминаниям в шагах.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPrompt } from '../../dist/web/phase-prompt.js';

const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/** Файлы шаблонов по фазам (тот же маппинг, что PHASE_FILES в phase-prompt.ts). */
const PHASE_FILES = {
  spec: 'phase-1.md',
  plan: 'phase-2.md',
  code: 'phase-3.md',
  close: 'phase-close.md',
  comment: 'phase-comment.md',
  prompt: 'prompt.md',
};

describe('шаблоны фаз — экономия ходов (VL-109)', () => {
  for (const [phase, file] of Object.entries(PHASE_FILES)) {
    it(`${phase} (${file}) содержит раздел «Экономия ходов»`, () => {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('## Экономия ходов'), `в ${file} нет раздела «Экономия ходов»`);
    });
  }

  it('phase-2: ls-проверка файлов плана перед записью', () => {
    const text = readFileSync(join(templatesDir, 'phase-2.md'), 'utf-8');
    assert.match(text, /проверь существование каждого файла.* ls/);
  });

  it('phase-3: правило «верь плану» и лимит поиска недостающего файла', () => {
    const text = readFileSync(join(templatesDir, 'phase-3.md'), 'utf-8');
    assert.match(text, /Implementation Plan.*— применяй его напрямую/);
    assert.match(text, /не более 2 ходов на поиск/);
  });

  it('renderPrompt: подстановка taskId и раздел экономии не сломаны', () => {
    const prompt = renderPrompt('code', 'VL-109');
    assert.ok(prompt.includes('VL-109'), 'taskId должен подставиться');
    assert.ok(!prompt.includes('{{taskId}}'), 'неподставленный {{taskId}} не должен остаться');
    assert.ok(prompt.includes('## Экономия ходов'), 'раздел должен попасть в собранный промпт');
  });
});

describe('close в worktree — отдельный шаблон (VL-112)', () => {
  it('шаблон phase-close-worktree.md существует и содержит merge-протокол', () => {
    const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');
    assert.ok(text.includes('{{taskId}}'), 'подстановка taskId');
    assert.ok(text.includes('merge --no-ff'), 'шаг слияния ветки');
    assert.ok(text.includes('НЕ резолвь'), 'конфликт не резолвится молча');
    assert.ok(text.includes('git worktree remove'), 'очистка worktree');
    assert.ok(text.includes('git branch -d'), 'удаление ветки');
    assert.ok(text.includes('docs(task)'), 'docs(task)-коммит в главном репо');
  });

  it('renderPrompt({ closeWorktree: true }) выбирает close-worktree шаблон', () => {
    const p = renderPrompt(
      'close',
      'VL-77',
      { branch: 'vb/vl-77', worktreeDir: '.vibelog/worktrees/vl-77' },
      { closeWorktree: true }
    );
    assert.ok(p.includes('merge --no-ff'), 'должен использоваться close-worktree шаблон');
    assert.ok(p.includes('vb/vl-77'), '{{branch}} подставлен');
    assert.ok(p.includes('.vibelog/worktrees/vl-77'), '{{worktreeDir}} подставлен');
    assert.ok(!p.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('обычный close без опции — прежний шаблон без merge-шага', () => {
    const p = renderPrompt('close', 'VL-77');
    assert.ok(!p.includes('merge --no-ff'), 'без closeWorktree worktree-шаблон не применяется');
    assert.ok(p.includes('## Правила'), 'обычный шаблон close сохранён');
  });
});

describe('VL-126: коммит Фазы 3, документация Close, проверки после merge', () => {
  it('phase-3 коммитит в ветку и не трогает CHANGELOG/docs', () => {
    const text = readFileSync(join(templatesDir, 'phase-3.md'), 'utf-8');
    assert.ok(text.includes('git commit -m "feat: {{taskId}}'), 'шаг feat-коммита в ветку');
    assert.ok(text.includes('CHANGELOG.md и документы backlog/docs в Фазе 3 НЕ обновляй'), 'запрет документации в Фазе 3');
  });

  it('оба close-шаблона содержат шаг документации и CHANGELOG', () => {
    for (const file of ['phase-close.md', 'phase-close-worktree.md']) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('docs: {{taskId}} — документация и CHANGELOG'), file + ': docs-коммит документации');
      assert.ok(text.includes('CHANGELOG.md'), file + ': шаг CHANGELOG');
    }
  });

  it('close-worktree проверяет сборку и тесты после merge', () => {
    const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');
    assert.ok(text.includes('pnpm build'), 'сборка после merge');
    assert.ok(text.includes('pnpm test'), 'тесты после merge');
    assert.ok(text.includes('НЕ выполняй шаги 6–11'), 'прерывание при падении сборки/тестов');
  });
});
