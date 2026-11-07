/**
 * Тесты сборки ленты активности (VL-347): src/core/activity.ts.
 *
 * Фикстура — mkdtemp-каталог (lesson-104): .vibelog/billing, .vibelog/
 * agent-sessions, .vibelog/auto-queue.json, .vibelog/supervisor/grants и
 * backlog/tasks. Проверяем: сборку из всех источников, сортировку, фильтры,
 * причину падения из меты (AC5), отсутствие source → unknown (AC4), битый
 * файл не роняет сборку, limit/offset/total.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectActivity, ACTIVITY_TYPES } from '../core/activity.js';
import { appendBilling } from '../core/billing.js';
import { createTaskFile } from '../core/store.js';
import { saveConfig, defaultConfig } from '../core/config.js';

let cwd;

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

/** Пишет мету сессии в .vibelog/agent-sessions. */
function writeMeta(sessionId, meta) {
  const dir = join(cwd, '.vibelog', 'agent-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.meta.json`),
    JSON.stringify({ sessionId, cwd, ...meta }, null, 2),
    'utf-8'
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-activity-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  // createTaskFile читает backlog.config.yml — фикстура должна его иметь
  saveConfig(cwd, defaultConfig());
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('collectActivity (VL-347)', () => {
  it('billing с 3 записями → 3 phase_finished + 3 phase_started, обратная хронология', () => {
    appendBilling(cwd, 'VL-1', session({ sessionId: 'a1', startedAt: '2026-11-12T10:00:00.000Z', finishedAt: '2026-11-12T10:05:00.000Z' }));
    appendBilling(cwd, 'VL-1', session({ sessionId: 'a2', startedAt: '2026-11-12T11:00:00.000Z', finishedAt: '2026-11-12T11:05:00.000Z' }));
    appendBilling(cwd, 'VL-1', session({ sessionId: 'a3', startedAt: '2026-11-12T12:00:00.000Z', finishedAt: '2026-11-12T12:05:00.000Z' }));

    const { events, total } = collectActivity(cwd, {});
    const finished = events.filter((e) => e.type === 'phase_finished');
    expect(finished).toHaveLength(3);
    expect(total).toBe(6);
    // Обратная хронология: первое событие — самое свежее
    expect(events[0].at).toBe('2026-11-12T12:05:00.000Z');
    expect(events[events.length - 1].at).toBe('2026-11-12T10:00:00.000Z');
    // Ссылка на задачу есть у каждого события рана
    expect(finished[0].links).toEqual([{ kind: 'task', id: 'VL-1' }]);
  });

  it('fallback: true → phase_failed с причиной из run_progress (AC5)', () => {
    appendBilling(cwd, 'VL-2', session({ sessionId: 'b1', fallback: true }));
    writeMeta('b1', {
      taskId: 'VL-2',
      phase: 'code',
      run_progress: {
        reason: 'wall-time',
        text: 'Сделано: парсер. Осталось: тесты.',
        done: ['парсер'],
        pending: ['тесты'],
      },
    });

    const { events } = collectActivity(cwd, { types: ['phase_failed'] });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('phase_failed');
    expect(events[0].summary).toContain('wall-time');
    expect(events[0].summary).toContain('Осталось: тесты');
    expect(events[0].details.reason).toContain('wall-time');
  });

  it('run_progress отсутствует → phase_failed с «причина не записана»', () => {
    appendBilling(cwd, 'VL-3', session({ sessionId: 'c1', fallback: true }));
    const { events } = collectActivity(cwd, { types: ['phase_failed'] });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('причина не записана');
  });

  it('last_run.is_error в мете тоже даёт phase_failed', () => {
    appendBilling(cwd, 'VL-4', session({ sessionId: 'd1' }));
    writeMeta('d1', { taskId: 'VL-4', last_run: { is_error: true } });
    const { events } = collectActivity(cwd, { types: ['phase_failed'] });
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe('VL-4');
  });

  // VL-368: ран, упавший через fail() (кап повторов/лимит), не пишет
  // run_progress — причина должна браться из текста результата рана.
  it('VL-368: причина падения без run_progress берётся из last_run.result', () => {
    appendBilling(cwd, 'VL-11', session({ sessionId: 'k1', fallback: true }));
    writeMeta('k1', {
      taskId: 'VL-11',
      last_run: {
        is_error: true,
        finishedAt: '2026-11-12T10:05:00.000Z',
        result: 'Кап повторов исчерпан: модель 4 раза повторила вызов lesson_update',
      },
    });
    const { events } = collectActivity(cwd, { types: ['phase_failed'] });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain('Кап повторов исчерпан');
    expect(events[0].summary).not.toContain('причина не записана');
    expect(events[0].details.reason).toContain('Кап повторов исчерпан');
  });

  it('запись без source → unknown (AC4)', () => {
    appendBilling(cwd, 'VL-5', session({ sessionId: 'e1' }));
    const { events } = collectActivity(cwd, { types: ['phase_finished'] });
    expect(events[0].source).toBe('unknown');
  });

  it('source из billing попадает в событие', () => {
    appendBilling(cwd, 'VL-6', session({ sessionId: 'f1', source: 'bot' }));
    const { events } = collectActivity(cwd, { types: ['phase_finished'] });
    expect(events[0].source).toBe('bot');
  });

  it('фильтры по type/taskId/source/периоду', () => {
    appendBilling(cwd, 'VL-7', session({ sessionId: 'g1', source: 'bot', startedAt: '2026-11-01T10:00:00.000Z', finishedAt: '2026-11-01T10:05:00.000Z' }));
    appendBilling(cwd, 'VL-8', session({ sessionId: 'g2', source: 'web', startedAt: '2026-11-12T10:00:00.000Z', finishedAt: '2026-11-12T10:05:00.000Z' }));

    expect(collectActivity(cwd, { taskId: 'vl-7' }).events.every((e) => e.taskId === 'VL-7')).toBe(true);
    expect(collectActivity(cwd, { source: 'web' }).events.every((e) => e.source === 'web')).toBe(true);
    expect(collectActivity(cwd, { types: ['phase_started'] }).events.every((e) => e.type === 'phase_started')).toBe(true);
    const period = collectActivity(cwd, { since: '2026-11-10T00:00:00.000Z' });
    expect(period.events.every((e) => e.taskId === 'VL-8')).toBe(true);
    const until = collectActivity(cwd, { until: '2026-11-05T00:00:00.000Z' });
    expect(until.events.every((e) => e.taskId === 'VL-7')).toBe(true);
  });

  it('битый billing/*.json не роняет сборку — остальные события на месте', () => {
    appendBilling(cwd, 'VL-9', session({ sessionId: 'h1' }));
    writeFileSync(join(cwd, '.vibelog', 'billing', 'VL-10.json'), '{ битый json', 'utf-8');
    const { events } = collectActivity(cwd, { types: ['phase_finished'] });
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe('VL-9');
  });

  it('limit/offset/total: total — до среза, страница — после', () => {
    for (let i = 0; i < 5; i += 1) {
      appendBilling(cwd, 'VL-11', session({
        sessionId: `i${i}`,
        startedAt: `2026-11-12T1${i}:00:00.000Z`,
        finishedAt: `2026-11-12T1${i}:05:00.000Z`,
      }));
    }
    const page1 = collectActivity(cwd, { types: ['phase_finished'], limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.events).toHaveLength(2);
    const page2 = collectActivity(cwd, { types: ['phase_finished'], limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.events).toHaveLength(2);
    expect(page2.events[0].at).not.toBe(page1.events[0].at);
  });

  it('события задач: создание, приблизительная смена статуса, комментарий', () => {
    createTaskFile(cwd, {
      id: 'VL-20',
      title: 'Задача с комментарием',
      status: 'In Progress',
      created_date: '2026-11-10T09:00:00.000Z',
      updated_date: '2026-11-11T09:00:00.000Z',
      comments: [{ author: '@agent', created: '2026-11-11T10:00:00.000Z', text: 'Отчёт фазы' }],
    });

    const { events } = collectActivity(cwd, { taskId: 'VL-20' });
    const created = events.find((e) => e.type === 'task_created');
    expect(created).toBeTruthy();
    const changed = events.find((e) => e.type === 'task_status_changed');
    expect(changed).toBeTruthy();
    // Честная пометка приблизительности (риск плана)
    expect(changed.details.approximate).toBe(true);
    const comment = events.find((e) => e.type === 'comment');
    expect(comment).toBeTruthy();
    expect(comment.summary).toContain('Отчёт фазы');
  });

  it('закрытая задача даёт task_closed', () => {
    createTaskFile(cwd, {
      id: 'VL-21',
      title: 'Закрытая',
      status: 'Done',
      created_date: '2026-11-10T09:00:00.000Z',
      updated_date: '2026-11-11T09:00:00.000Z',
    });
    const { events } = collectActivity(cwd, { taskId: 'VL-21' });
    expect(events.some((e) => e.type === 'task_closed')).toBe(true);
  });

  it('автоочередь: провал элемента и запуск прогона', () => {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(
      join(cwd, '.vibelog', 'auto-queue.json'),
      JSON.stringify({
        running: true,
        tasks: [
          { id: 'VL-30', status: 'failed', added_at: '2026-11-12T09:00:00.000Z', started_at: '2026-11-12T09:30:00.000Z', attempts: 1, fail_reason: 'exit 1' },
        ],
      }),
      'utf-8'
    );
    const { events } = collectActivity(cwd, {});
    const failed = events.find((e) => e.type === 'queue_failed');
    expect(failed).toBeTruthy();
    expect(failed.summary).toContain('exit 1');
    expect(failed.source).toBe('queue');
    expect(events.some((e) => e.type === 'queue_started')).toBe(true);
  });

  it('grant супервизора: выдача и отзыв', () => {
    const dir = join(cwd, '.vibelog', 'supervisor', 'grants');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'run-1.json'),
      JSON.stringify({
        runId: 'run-1',
        taskIds: ['VL-40'],
        allowedTools: ['backlog_trigger_phase'],
        grantedAt: '2026-11-12T20:00:00.000Z',
        expiresAt: '2026-11-13T04:00:00.000Z',
        revokedAt: '2026-11-12T22:00:00.000Z',
        revokeReason: 'stop',
      }),
      'utf-8'
    );
    const { events } = collectActivity(cwd, {});
    const started = events.find((e) => e.type === 'grant_started');
    const revoked = events.find((e) => e.type === 'grant_revoked');
    expect(started).toBeTruthy();
    expect(started.links).toEqual([{ kind: 'task', id: 'VL-40' }]);
    expect(revoked).toBeTruthy();
    expect(revoked.summary).toContain('stop');
  });

  it('все типы событий из ACTIVITY_TYPES — валидный список без дублей', () => {
    expect(new Set(ACTIVITY_TYPES).size).toBe(ACTIVITY_TYPES.length);
    expect(ACTIVITY_TYPES).toHaveLength(12);
  });
});
