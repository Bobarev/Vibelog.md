/**
 * Тесты VL-283 — инварианты клиента «роль зафиксирована за тредом».
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * здесь — по исходникам компонентов: они ловят ровно те регрессии, которые
 * важны для AC3/AC4/AC5 (бейдж вместо пикера в начатом треде; выбор роли
 * доступен только для нового треда; module-state не перетирается при
 * открытии существующего треда).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_DIR = join('web', 'src', 'components', 'chat');
const pickers = readFileSync(join(CHAT_DIR, 'pickers.tsx'), 'utf8');
const thread = readFileSync(join(CHAT_DIR, 'thread.tsx'), 'utf8');
const runtime = readFileSync(join(CHAT_DIR, 'chat-runtime.tsx'), 'utf8');

/** Тело функции/компонента по имени (до следующего объявления верхнего уровня). */
function bodyOf(source, name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `в исходнике нет ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(export (function|const) |function |const [A-Za-z])/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe('VL-283: бейдж роли вместо переключателя (AC3)', () => {
  it('PersonaBadge экспортируется из pickers.tsx', () => {
    assert.match(pickers, /export function PersonaBadge\(/);
  });

  it('бейдж неинтерактивен: без DropdownMenu и без setActivePersonaId', () => {
    const badge = bodyOf(pickers, 'export function PersonaBadge(');
    assert.ok(!badge.includes('DropdownMenu'), 'нет дропдауна в бейдже');
    assert.ok(!badge.includes('setActivePersonaId'), 'бейдж не меняет module-state');
    assert.ok(!badge.includes('onClick'), 'нет обработчика клика');
    assert.match(badge, /title=/, 'подсказка про фиксацию роли');
    assert.match(badge, /aria-label=/, 'доступное имя');
  });

  it('бейдж рисует иконку роли и название', () => {
    const badge = bodyOf(pickers, 'export function PersonaBadge(');
    assert.match(badge, /PersonaIcon/);
    assert.match(badge, /\{label\}/);
  });
});

describe('VL-283: выбор роли только для нового треда (AC4)', () => {
  it('Composer рендерит PersonaPicker только без personaId, иначе PersonaBadge', () => {
    const composer = bodyOf(thread, 'function Composer(');
    assert.match(composer, /personaId/);
    assert.match(
      composer,
      /\{personaId \? <PersonaBadge personaId=\{personaId\} \/> : <PersonaPicker \/>\}/,
      'тернарник бейдж/пикер',
    );
  });

  it('EmptyState (пустой тред) показывает пикер, тред с сообщениями — бейдж', () => {
    const empty = bodyOf(thread, 'function EmptyState(');
    assert.match(empty, /<Composer placeholder=/);
    assert.ok(!empty.includes('personaId'), 'в пустом состоянии — пикер по умолчанию');

    const chatThread = bodyOf(thread, 'function ChatThread(');
    assert.match(chatThread, /personaId=\{threadPersona \?\?/, 'в треде — роль треда');
  });

  it('роль треда приходит из GET /api/chat/threads/:id, а не из module-state', () => {
    assert.match(thread, /persona\?: string \| null/, 'поле в ThreadHistoryResponse');
    assert.match(thread, /persona: data\.persona \?\? null/);
    // VL-313 добавил второй пропс (threadId — resetKey панели расхода),
    // VL-314 — третий (compaction — плашка сжатия), поэтому проверяем
    // наличие пропса, а не дословный тег
    assert.match(thread, /<ChatThread[\s\S]{0,200}threadPersona=\{load\.persona \?\? null\}/);
  });
});

describe('VL-283: module-state не перетирается при открытии треда (AC5)', () => {
  it('chat-runtime не вызывает setActivePersonaId при смене треда', () => {
    const provider = bodyOf(runtime, 'export function ChatRuntimeProvider(');
    assert.ok(!provider.includes('setActivePersonaId'), 'эффект провайдера не трогает выбор роли');
  });

  it('setActivePersonaId вызывается только в пикере (клиентский выбор нового треда)', () => {
    const occurrences = pickers.split('setActivePersonaId').length - 1;
    // импорт + комментарий-объявление + 2 реальных вызова (эффект и onClick)
    assert.ok(occurrences >= 2, 'пикер меняет module-state');
    const badge = bodyOf(pickers, 'export function PersonaBadge(');
    assert.ok(!badge.includes('setActivePersonaId'));
  });
});
