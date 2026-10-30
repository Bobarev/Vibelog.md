/**
 * Тесты лимитов веб-чата (VL-269): чтение конфига, валидация, per-call guard.
 *
 * Время проверяется без реальных задержек там, где возможно: guard устроен
 * на setTimeout, поэтому тесты таймаута используют маленькие окна (20-40 мс)
 * и явные ожидания — флаки исключены короткими окнами и одним ассертом.
 */

import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CHAT_LIMITS_CEILING,
  CHAT_LIMITS_DEFAULT,
  createCallGuard,
  formatChatLimitsErrors,
  resolveChatLimits,
} from '../../dist/web/chat-limits.js';

let cwd;

/** Запись settings.json (единственный источник лимитов). */
function writeSettings(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify(data, null, 2), 'utf-8');
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-limits-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('resolveChatLimits: дефолты', () => {
  it('без settings.json — дефолты 8 / 120 с / 3 / 90 с, без ошибок', () => {
    const { limits, errors } = resolveChatLimits(cwd);
    assert.deepEqual(limits, CHAT_LIMITS_DEFAULT);
    assert.deepEqual(errors, []);
  });

  it('settings.json без секции chat — дефолты, без ошибок', () => {
    writeSettings({ default_agent: 'vb', max_wall_time: 900 });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.deepEqual(limits, CHAT_LIMITS_DEFAULT);
    assert.deepEqual(errors, []);
  });

  it('пустая секция chat — дефолты, без ошибок', () => {
    writeSettings({ chat: {} });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.deepEqual(limits, CHAT_LIMITS_DEFAULT);
    assert.deepEqual(errors, []);
  });

  it('битый settings.json (не JSON) — дефолты', () => {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), '{ битый', 'utf-8');
    const { limits } = resolveChatLimits(cwd);
    assert.deepEqual(limits, CHAT_LIMITS_DEFAULT);
  });
});

describe('resolveChatLimits: override', () => {
  it('все четыре ключа применяются (секунды → мс)', () => {
    writeSettings({ chat: { max_iterations: 20, max_wall_time: 600, max_auto_continue: 5, call_timeout: 45 } });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.equal(limits.maxIterations, 20);
    assert.equal(limits.maxWallTimeMs, 600_000);
    assert.equal(limits.maxAutoContinue, 5);
    assert.equal(limits.callTimeoutMs, 45_000);
    assert.deepEqual(errors, []);
  });

  it('частичный override: остальные ключи — дефолты', () => {
    writeSettings({ chat: { max_iterations: 3 } });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.equal(limits.maxIterations, 3);
    assert.equal(limits.maxWallTimeMs, CHAT_LIMITS_DEFAULT.maxWallTimeMs);
    assert.equal(limits.callTimeoutMs, CHAT_LIMITS_DEFAULT.callTimeoutMs);
    assert.deepEqual(errors, []);
  });

  it('потолки допустимы', () => {
    writeSettings({
      chat: {
        max_iterations: CHAT_LIMITS_CEILING.maxIterations,
        max_wall_time: CHAT_LIMITS_CEILING.maxWallTimeSec,
        max_auto_continue: CHAT_LIMITS_CEILING.maxAutoContinue,
        call_timeout: CHAT_LIMITS_CEILING.callTimeoutSec,
      },
    });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.equal(limits.maxIterations, CHAT_LIMITS_CEILING.maxIterations);
    assert.deepEqual(errors, []);
  });
});

describe('resolveChatLimits: мусор → дефолт + предупреждение', () => {
  const garbage = [0, -1, 2.5, '8', null, true, [], {}];

  it('каждый мусорный вид значения откатывается к дефолту (max_iterations)', () => {
    for (const value of garbage) {
      writeSettings({ chat: { max_iterations: value } });
      const { limits, errors } = resolveChatLimits(cwd);
      assert.equal(limits.maxIterations, CHAT_LIMITS_DEFAULT.maxIterations, `значение ${JSON.stringify(value)}`);
      if (value === null) {
        // null — «ключа нет» для JSON-семантики, но VL-269 трактует как мусор
        assert.equal(errors.length, 1);
      } else {
        assert.equal(errors.length, 1, `значение ${JSON.stringify(value)}`);
        assert.match(errors[0], /chat\.max_iterations/);
      }
    }
  });

  it('значение сверх потолка — дефолт + предупреждение', () => {
    writeSettings({ chat: { max_iterations: CHAT_LIMITS_CEILING.maxIterations + 1 } });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.equal(limits.maxIterations, CHAT_LIMITS_DEFAULT.maxIterations);
    assert.equal(errors.length, 1);
  });

  it('мусор в одном ключе не ломает остальные', () => {
    writeSettings({ chat: { max_iterations: 'много', max_wall_time: 300 } });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.equal(limits.maxIterations, CHAT_LIMITS_DEFAULT.maxIterations);
    assert.equal(limits.maxWallTimeMs, 300_000);
    assert.equal(errors.length, 1);
  });

  it('секция chat — не объект (строка/массив) — дефолты + предупреждение', () => {
    writeSettings({ chat: 'мусор' });
    const { limits, errors } = resolveChatLimits(cwd);
    assert.deepEqual(limits, CHAT_LIMITS_DEFAULT);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /chat: ожидается объект/);
  });
});

describe('formatChatLimitsErrors', () => {
  it('пустой список — пустая строка', () => {
    assert.equal(formatChatLimitsErrors([]), '');
  });

  it('непустой — одна строка с префиксом и перечислением', () => {
    const text = formatChatLimitsErrors(['a: плохо', 'b: тоже']);
    assert.match(text, /^\[vibelog-chat\]/);
    assert.match(text, /a: плохо/);
    assert.match(text, /b: тоже/);
  });
});

describe('createCallGuard: per-call таймаут', () => {
  const guards = [];
  const make = (ms) => {
    const g = createCallGuard(ms);
    guards.push(g);
    return g;
  };
  afterEach(() => {
    for (const g of guards.splice(0)) g.dispose();
  });

  it('срабатывает по бездействию: signal абортится, timedOut() === true', async () => {
    const guard = make(20);
    assert.equal(guard.signal.aborted, false);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(guard.signal.aborted, true);
    assert.equal(guard.timedOut(), true);
  });

  it('noteActivity() перевзводит таймер — живой стрим не убивается', async () => {
    const guard = make(40);
    // «Стрим»: активность каждые 20 мс в течение 100 мс — окно ни разу не истекает
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 20));
      guard.noteActivity();
    }
    assert.equal(guard.signal.aborted, false);
    assert.equal(guard.timedOut(), false);
  });

  it('dispose() снимает таймер: после ожидания таймаута нет', async () => {
    const guard = make(20);
    guard.dispose();
    await new Promise(r => setTimeout(r, 50));
    assert.equal(guard.signal.aborted, false);
    assert.equal(guard.timedOut(), false);
  });

  it('timeoutMs <= 0 — таймаута нет (выключенный лимит)', async () => {
    const guard = make(0);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(guard.signal.aborted, false);
    assert.equal(guard.timedOut(), false);
  });

  it('после срабатывания noteActivity() не «воскрешает» сигнал', async () => {
    const guard = make(15);
    await new Promise(r => setTimeout(r, 40));
    guard.noteActivity();
    assert.equal(guard.signal.aborted, true);
    assert.equal(guard.timedOut(), true);
  });
});
