/**
 * Тесты REST API ленты активности (VL-347): GET /api/activity.
 *
 * Контракт: {events, total, hasMore}; валидация параметров (неизвестный type
 * → 400 со списком допустимых, невалидная дата → 400, limit/offset → 400),
 * пагинация через limit/offset, фильтры type/taskId/source.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { appendBilling } from '../../dist/core/billing.js';
import { ACTIVITY_TYPES } from '../../dist/core/activity.js';

let cwd;

/** GET /api/activity с query string 5-м аргументом (как отдаёт server.ts). */
function activity(queryString = '') {
  return handleApi('GET', '/api/activity', null, cwd, queryString);
}

/** Запись billing с дефолтами. */
function session(over = {}) {
  return {
    sessionId: 'agent-1',
    phase: 'code',
    startedAt: '2026-11-12T10:00:00.000Z',
    startedAtKind: 'run',
    finishedAt: '2026-11-12T10:05:00.000Z',
    durationMs: 300000,
    usage: { input: 10, output: 5, cache: 0, total: 15, requests: 2 },
    agent: 'vb',
    ...over,
  };
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-activity-api-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  for (let i = 0; i < 4; i += 1) {
    appendBilling(cwd, 'VL-100', session({
      sessionId: `s${i}`,
      source: i % 2 === 0 ? 'bot' : 'web',
      startedAt: `2026-11-12T1${i}:00:00.000Z`,
      finishedAt: `2026-11-12T1${i}:05:00.000Z`,
    }));
  }
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/activity (VL-347)', () => {
  it('200 + {events, total, hasMore}', () => {
    const res = activity();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
    assert.equal(typeof res.body.total, 'number');
    assert.equal(typeof res.body.hasMore, 'boolean');
    // 4 рана × (started + finished) = 8 событий
    assert.equal(res.body.total, 8);
    assert.equal(res.body.events.length, 8);
    assert.equal(res.body.hasMore, false);
  });

  it('пагинация: limit/offset, hasMore=true на первой странице', () => {
    const page1 = activity('limit=3');
    assert.equal(page1.status, 200);
    assert.equal(page1.body.events.length, 3);
    assert.equal(page1.body.total, 8);
    assert.equal(page1.body.hasMore, true);

    const page2 = activity('limit=3&offset=3');
    assert.equal(page2.body.events.length, 3);
    assert.equal(page2.body.hasMore, true);
    // Страницы не пересекаются
    const first = page1.body.events.map((e) => `${e.at}|${e.type}`);
    const second = page2.body.events.map((e) => `${e.at}|${e.type}`);
    assert.equal(first.some((k) => second.includes(k)), false);

    const page3 = activity('limit=3&offset=6');
    assert.equal(page3.body.events.length, 2);
    assert.equal(page3.body.hasMore, false);
  });

  it('фильтр по типу (повторяемый параметр и через запятую)', () => {
    const single = activity('type=phase_finished');
    assert.equal(single.status, 200);
    assert.ok(single.body.events.every((e) => e.type === 'phase_finished'));
    assert.equal(single.body.total, 4);

    const multi = activity('type=phase_finished,phase_started');
    assert.equal(multi.body.total, 8);

    const repeated = activity('type=phase_finished&type=phase_started');
    assert.equal(repeated.body.total, 8);
  });

  it('фильтр по source и taskId', () => {
    const bot = activity('source=bot');
    assert.equal(bot.status, 200);
    assert.ok(bot.body.events.every((e) => e.source === 'bot'));

    const task = activity('taskId=VL-100');
    assert.equal(task.body.total, 8);
    const other = activity('taskId=VL-999');
    assert.equal(other.body.total, 0);
    assert.equal(other.body.events.length, 0);
  });

  it('фильтр по периоду since/until', () => {
    const res = activity('since=2026-11-12T12:00:00.000Z');
    assert.equal(res.status, 200);
    assert.ok(res.body.events.every((e) => Date.parse(e.at) >= Date.parse('2026-11-12T12:00:00.000Z')));
  });

  it('неизвестный type → 400 со списком допустимых', () => {
    const res = activity('type=nonsense');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /nonsense/);
    assert.deepEqual(res.body.allowed, [...ACTIVITY_TYPES]);
  });

  it('невалидная дата → 400', () => {
    const res = activity('since=не-дата');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /since/);
  });

  it('невалидный limit/offset → 400', () => {
    assert.equal(activity('limit=0').status, 400);
    assert.equal(activity('limit=abc').status, 400);
    assert.equal(activity('offset=-1').status, 400);
  });

  it('limit больше потолка обрезается до 200', () => {
    const res = activity('limit=1000');
    assert.equal(res.status, 200);
    // Событий всего 8 — проверяем, что запрос не упал и отдал всё
    assert.equal(res.body.events.length, 8);
  });
});
