/**
 * Тесты VL-274 — idle-watchdog фазы (src/agent/idle-guard.ts).
 *
 * Две группы: реальные короткие окна (10–60 мс, как в chat-limits.test.mjs —
 * таймеры проверяются вживую) и виртуальные часы через инъекцию `now` (для
 * `idleMs()`, без sleep).
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import { createIdleGuard } from '../../dist/agent/idle-guard.js';

describe('createIdleGuard (VL-274)', () => {
  const guards = [];
  const make = (opts) => {
    const g = createIdleGuard(opts);
    guards.push(g);
    return g;
  };
  afterEach(() => {
    for (const g of guards.splice(0)) g.dispose();
  });

  it('срабатывает по бездействию: signal абортится, timedOut() === true', async () => {
    const g = make({ timeoutMs: 20 });
    assert.equal(g.signal.aborted, false);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(g.signal.aborted, true);
    assert.equal(g.timedOut(), true);
  });

  it('noteActivity() перевзводит таймер — живой (редкий, но регулярный) стрим не убивается', async () => {
    const g = make({ timeoutMs: 40 });
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 20));
      g.noteActivity();
    }
    assert.equal(g.signal.aborted, false, 'регулярные токены не дают сработать watchdog');
    assert.equal(g.timedOut(), false);
  });

  it('timeoutMs = 0 — проверка выключена (аналог HERMES_CRON_TIMEOUT=0)', async () => {
    const g = make({ timeoutMs: 0 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(g.signal.aborted, false);
    assert.equal(g.timedOut(), false);
  });

  it('timeoutMs < 0 — тоже выключено (защита от мусора настроек)', async () => {
    const g = make({ timeoutMs: -100 });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(g.signal.aborted, false);
  });

  it('pause() снимает таймер: долгий tool не считается зависанием', async () => {
    const g = make({ timeoutMs: 20 });
    g.pause();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(g.signal.aborted, false, 'во время инструмента watchdog молчит');
    assert.equal(g.timedOut(), false);
  });

  it('resume() возвращает таймер и отсчитывает окно заново', async () => {
    const g = make({ timeoutMs: 25 });
    g.pause();
    await new Promise((r) => setTimeout(r, 50));
    g.resume();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(g.signal.aborted, false, 'сразу после resume окно ещё не истекло');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(g.signal.aborted, true, 'после resume watchdog снова работает');
  });

  it('внешний сигнал абортит комбинированный (отмена фазы складывается с idle)', () => {
    const outer = new AbortController();
    const g = make({ timeoutMs: 60_000, externalSignal: outer.signal });
    assert.equal(g.signal.aborted, false);
    outer.abort();
    assert.equal(g.signal.aborted, true);
    // Отмена пользователем — это не idle: timedOut() остаётся false
    assert.equal(g.timedOut(), false);
  });

  it('уже отменённый внешний сигнал — комбинированный аборчен сразу', () => {
    const outer = new AbortController();
    outer.abort();
    const g = make({ timeoutMs: 60_000, externalSignal: outer.signal });
    assert.equal(g.signal.aborted, true);
  });

  it('dispose() снимает таймер: после ожидания окна таймаута нет', async () => {
    const g = make({ timeoutMs: 20 });
    g.dispose();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(g.signal.aborted, false);
    assert.equal(g.timedOut(), false);
  });

  it('после срабатывания noteActivity() не «воскрешает» сигнал', async () => {
    const g = make({ timeoutMs: 15 });
    await new Promise((r) => setTimeout(r, 40));
    g.noteActivity();
    assert.equal(g.signal.aborted, true);
    assert.equal(g.timedOut(), true);
  });

  it('idleMs() считает простой по инъекции now', () => {
    const clock = { value: 1000 };
    const g = make({ timeoutMs: 600_000, now: () => clock.value });
    assert.equal(g.idleMs(), 0);
    clock.value = 1000 + 5000;
    assert.equal(g.idleMs(), 5000);
    g.noteActivity();
    assert.equal(g.idleMs(), 0, 'активность сбрасывает отметку');
    clock.value += 2500;
    assert.equal(g.idleMs(), 2500);
  });

  it('pause()/resume() на виртуальных часах не дают сработать таймеру (окно — после resume)', async () => {
    const clock = { value: 0 };
    // Часы двигаем вручную, но реальный таймер взводится на «остаток» окна
    // (200 мс) — комбинируем: pause на время «инструмента», затем resume.
    const g = make({ timeoutMs: 200, now: () => clock.value });
    g.pause();
    clock.value = 10_000; // «инструмент» шёл 10 с
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(g.signal.aborted, false, 'на паузе таймер снят');
    g.resume();
    clock.value = 10_000;
    assert.equal(g.idleMs(), 0, 'окно после resume отсчитывается заново');
    g.dispose();
  });
});