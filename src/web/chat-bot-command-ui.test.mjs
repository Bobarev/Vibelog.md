/**
 * Тесты VL-408 — пункт меню веб-чата «Скопировать команду для бота».
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * статические — по исходникам компонентов (паттерн chat-persona-ui.test.mjs).
 * Ловят ровно те регрессии, которые важны для AC3: команда копируется в
 * формате `/chat <chat-id>`, меню встроено в композер и не рендерится без id.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_DIR = join('web', 'src', 'components', 'chat');
const menu = readFileSync(join(CHAT_DIR, 'chat-menu.tsx'), 'utf8');
const thread = readFileSync(join(CHAT_DIR, 'thread.tsx'), 'utf8');

describe('VL-408: меню чата копирует команду /chat <chat-id> (AC3)', () => {
  it('ChatMenu экспортируется и копирует команду через clipboard', () => {
    assert.match(menu, /export function ChatMenu\(/);
    assert.match(menu, /navigator\.clipboard/);
    assert.match(menu, /writeText\(command\)/);
  });

  it('команда формируется как "/chat <threadId>"', () => {
    assert.match(menu, /`\/chat \$\{threadId\}`/);
  });

  it('без threadId меню не рендерится', () => {
    assert.match(menu, /if \(!threadId\) return null/);
  });

  it('отказ clipboard не теряет команду — показывается текстом', () => {
    assert.match(menu, /setFallback\(command\)/);
  });

  it('меню встроено в композер рядом с пикером модели', () => {
    assert.match(thread, /<ChatMenu threadId=\{threadId\} \/>/);
    const at = thread.indexOf('<ChatMenu threadId={threadId} />');
    const model = thread.indexOf('<ModelPicker />');
    assert.ok(model >= 0 && at > model, 'ChatMenu должен идти после ModelPicker');
  });
});
