/**
 * Тесты VL-406 — клиент веб-чата: индикатор хода и плашка исхода.
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * идут по исходникам компонентов (паттерн `chat-detached-run-ui.test.mjs`).
 * Ловят регрессии, критичные для AC1/AC2/AC5/AC9–AC12:
 * - индикатор — три пульсирующие точки, а не шиммер по тексту;
 * - индикатор привязан к статусу хода (включая паузы между tool-вызовами);
 * - плашка исхода различает `empty`/`error`/`interrupted`/`cancelled` и даёт
 *   кнопку «Повторить»;
 * - «Повторить» идёт путём `retry: true` (без дубля user-сообщения), а не
 *   повторной отправкой текста;
 * - композер показывает «Стоп» по серверному статусу `running`;
 * - анимация уважает `prefers-reduced-motion`.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_DIR = join('web', 'src', 'components', 'chat');
const thread = readFileSync(join(CHAT_DIR, 'thread.tsx'), 'utf8');
const runtime = readFileSync(join(CHAT_DIR, 'chat-runtime.tsx'), 'utf8');
const css = readFileSync(join('web', 'src', 'index.css'), 'utf8');

/** Тело функции/компонента по имени (до следующего объявления верхнего уровня). */
function bodyOf(source, name) {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `в исходнике нет ${name}`);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n(export (function|const) |function |const [A-Za-z])/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe('VL-406: индикатор активного хода (AC9/AC10/AC12)', () => {
  it('есть компонент TypingDots с тремя точками', () => {
    const dots = bodyOf(thread, 'function TypingDots(');
    assert.equal(
      (dots.match(/typing-dot/g) ?? []).length,
      3,
      'ровно три точки (не спиннер-кольцо)',
    );
  });

  it('индикатор показывает точки, пока ход идёт (статус running или рантайм)', () => {
    const indicator = bodyOf(thread, 'function RunInProgressIndicator(');
    assert.ok(indicator.includes('<TypingDots'), 'визуальный индикатор — точки');
    assert.ok(
      indicator.includes('run?.status === "running"'),
      'привязка к серверному статусу хода, а не к потоку токенов',
    );
    assert.ok(
      indicator.includes('s.thread.isRunning'),
      'первый ход в новом треде: run ещё null, а стрим уже идёт',
    );
  });

  it('шиммер по тексту больше не используется в индикаторе', () => {
    const indicator = bodyOf(thread, 'function RunInProgressIndicator(');
    assert.ok(!indicator.includes('ShimmerLabel'), 'шиммер заменён точками');
  });

  it('анимация точек уважает prefers-reduced-motion', () => {
    assert.match(css, /@keyframes vl-typing-dot/);
    assert.match(css, /\.typing-dot\s*\{/);
    const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
    assert.match(reduced, /\.typing-dot\s*\{[^}]*animation:\s*none/, 'точки статичны');
  });
});

describe('VL-406: плашка исхода вместо молчания (AC1/AC2/AC11)', () => {
  it('есть плашка исхода с текстом для empty и кнопкой «Повторить»', () => {
    const banner = bodyOf(thread, 'function RunOutcomeBanner(');
    assert.ok(banner.includes('"empty"'), 'пустой ответ различается');
    assert.match(banner, /Модель вернула пустой ответ/);
    assert.match(banner, /Повторить/);
  });

  it('плашка различает error / interrupted / cancelled', () => {
    const banner = bodyOf(thread, 'function RunOutcomeBanner(');
    assert.ok(banner.includes('"interrupted"'));
    assert.ok(banner.includes('"cancelled"'));
    assert.match(banner, /Ход завершился ошибкой/);
  });

  it('плашка рендерится в той же позиции, что индикатор (без скачка)', () => {
    const indicator = bodyOf(thread, 'function RunInProgressIndicator(');
    assert.ok(
      indicator.includes('<RunOutcomeBanner'),
      'исход занимает место индикатора в ленте',
    );
  });

  it('«Повторить» идёт путём retry, а не повторной отправкой текста (AC3)', () => {
    const banner = bodyOf(thread, 'function RunOutcomeBanner(');
    assert.ok(banner.includes('requestRetryLastTurn()'), 'кнопка помечает повтор хода');
    assert.ok(!banner.includes('composer.send'), 'текст заново не отправляется');
    assert.ok(
      runtime.includes('retry: true'),
      'адаптер отправляет POST с retry: true (без дубля user-сообщения)',
    );
  });
});

describe('VL-406: композер отражает серверное состояние (AC5)', () => {
  it('кнопка «Стоп» показывается по серверному running', () => {
    const composer = bodyOf(thread, 'function Composer(');
    assert.ok(composer.includes('serverRunning'), 'пропс серверного состояния');
    assert.ok(composer.includes('ComposerPrimitive.Cancel'), 'кнопка отмены');
    assert.ok(composer.includes('/cancel'), 'явный POST отмены хода на сервере');
  });

  it('ChatThread передаёт серверный статус в композер', () => {
    const chatThread = bodyOf(thread, 'function ChatThread(');
    assert.ok(chatThread.includes('serverRunning={run?.status === "running"}'));
  });
});

describe('VL-406: состояние хода перечитывается после локального хода', () => {
  it('есть наблюдатель RunStateWatcher и колбэк onRunSettled', () => {
    assert.match(thread, /function RunStateWatcher\(/);
    assert.match(thread, /onRunSettled/);
    assert.match(thread, /refreshRunState/);
  });

  it('опрос истории перезагружает её при любом исходе, включая empty', () => {
    assert.match(thread, /data\.run\.status !== "running"/);
  });
});
