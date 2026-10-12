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
