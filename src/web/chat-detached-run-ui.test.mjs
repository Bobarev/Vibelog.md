/**
 * Тесты VL-332 — инварианты клиента «ход не теряется при смене треда».
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * идут по исходникам компонентов (паттерн `chat-persona-ui.test.mjs`).
 * Ловят регрессии, критичные для AC1/AC3/AC4:
 * - fetch чата больше НЕ передаёт `options.abortSignal` (иначе размонтирование
 *   рантайма при смене треда убивало ход вместе с незаписанным ответом);
 * - клиент читает состояние хода (`run`) и показывает индикатор до завершения;
 * - после завершения фонового хода история перезагружается без F5.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_DIR = join('web', 'src', 'components', 'chat');
const runtime = readFileSync(join(CHAT_DIR, 'chat-runtime.tsx'), 'utf8');
const thread = readFileSync(join(CHAT_DIR, 'thread.tsx'), 'utf8');

/** Тело функции/компонента по имени (до следующего объявления верхнего уровня). */
function bodyOf(source, name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `в исходнике нет ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(export (function|const) |function |const [A-Za-z])/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe('VL-332: запрос чата не отменяется сменой треда (AC1)', () => {
  it('fetch("/api/chat") не получает options.abortSignal', () => {
    const start = runtime.indexOf('res = await fetch("/api/chat"');
    assert.ok(start >= 0, 'запрос /api/chat найден');
    const call = runtime.slice(start, start + 200);
    assert.ok(
      !call.includes('signal: options.abortSignal'),
      'смена треда не должна абортить SERVER-ход (иначе ответ теряется)',
    );
  });

  it('в адаптере есть объяснение, зачем сигнал убран (защита от возврата)', () => {
    assert.match(runtime, /VL-332/);
  });
});

describe('VL-332: состояние хода видно в треде (AC3), F5 не нужен (AC4)', () => {
  it('индикатор RunInProgressIndicator существует и рендерится в ленте', () => {
    assert.match(thread, /function RunInProgressIndicator\(/);
    const chatThread = bodyOf(thread, 'function ChatThread(');
    assert.ok(
      chatThread.includes('<RunInProgressIndicator'),
      'индикатор вставлен в ленту треда',
    );
  });

  it('индикатор показывает «выполняется» для running и причину для interrupted', () => {
    const indicator = bodyOf(thread, 'function RunInProgressIndicator(');
    assert.ok(indicator.includes('Ассистент отвечает'), 'текст индикатора выполнения');
    // VL-406: исходы (interrupted/error/cancelled/empty) вынесены в плашку
    // RunOutcomeBanner — индикатор рендерит её на месте точек.
    assert.ok(indicator.includes('<RunOutcomeBanner'), 'обработка прерванного хода');
    const banner = bodyOf(thread, 'function RunOutcomeBanner(');
    assert.ok(banner.includes('interrupted'), 'причина прерванного хода в плашке');
  });

  it('ChatPage знает про run и опрашивает статус до завершения', () => {
    assert.match(thread, /run\?\.\s*status !== "running"/, 'стоп-условие опроса');
    assert.match(thread, /setRetry\(r => r \+ 1\)/, 'перезагрузка истории после хода');
    assert.match(thread, /run=\{load\.run \?\? null\}/, 'состояние хода проброшено в тред');
  });
});
