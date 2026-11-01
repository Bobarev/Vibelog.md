/**
 * Тесты лимитов роли supervisor и таймера тика (VL-270, AC1, AC15).
 *
 * Проверяется:
 * - при активной персоне `supervisor` ход чата использует лимиты из
 *   `supervisor.limits` (30 итераций / 600 с), а не общие 8/120 (AC15);
 * - для остальных ролей значения НЕ меняются (иначе длинный ход «перетёк» бы
 *   в обычный чат против воли пользователя);
 * - таймер тика поднимается только при активном grant, глушится env-флагом и
 *   снимается stopSupervisorTimer (AC1).
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat } from '../../dist/web/chat.js';
import { zeroUsage } from '../../dist/agent/llm.js';
import { createTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { writeGrant } from '../../dist/web/supervisor-grant.js';
import {
  isSupervisorTimerRunning,
  startSupervisorTimer,
  stopSupervisorTimer,
} from '../../dist/web/supervisor-tick.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-limits-'));

/** LLM, отвечающий мгновенно и без инструментов. */
function textLlm() {
  return {
    streamChat: async () => ({ text: 'ок', toolCalls: [], usage: zeroUsage() }),
  };
}

/**
 * LLM, который всегда просит инструмент, — ход упрётся в лимит итераций и
 * вернёт событие truncated со снимком фактических лимитов (AC15: по нему
 * видно, какие именно значения применились к роли).
 */
function loopingLlm() {
  let n = 0;
  return {
    streamChat: async () => {
      n += 1;
      return {
        text: '',
        toolCalls: [{ id: `call-${n}`, name: 'backlog_search', arguments: JSON.stringify({ query: `q${n}` }) }],
        usage: zeroUsage(),
      };
    },
  };
}

/** Собирает события runChat с заданным LLM. */
async function collectWith(body, llm) {
  const events = [];
  for await (const ev of runChat(body, cwd, { llm })) events.push(ev);
  return events;
}

/** Собирает события runChat с текстовым LLM. */
async function collect(body) {
  return collectWith(body, textLlm());
}

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Limits Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked'],
    definition_of_done: [],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'task'],
  }), 'utf-8');
});

afterAll(() => {
  stopSupervisorTimer();
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  stopSupervisorTimer();
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
});

afterEach(() => {
  stopSupervisorTimer();
  delete process.env.VIBELOG_SUPERVISOR_TICK;
});

describe('лимиты роли supervisor (AC15)', () => {
  it('персона supervisor берёт лимиты из supervisor.limits (по событию truncated)', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { limits: { chat_max_iterations: 4, chat_max_wall_time: 900 } },
    }), 'utf-8');
    const events = await collectWith({ message: 'hello', threadId: 't-sup', persona: 'supervisor' }, loopingLlm());
    const truncated = events.find(e => e.type === 'truncated' && e.reason === 'iterations');
    assert.ok(truncated, `ожидалось усечение по итерациям: ${JSON.stringify(events.slice(-3))}`);
    assert.equal(truncated.step, 4, 'шаг усечения = supervisor.limits.chat_max_iterations');
    assert.equal(truncated.limits.maxIterations, 4);
    assert.equal(truncated.limits.maxWallTimeSec, 900);
  });

  it('персона helper сохраняет общие лимиты (truncated по 8, не по supervisor-значению)', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { limits: { chat_max_iterations: 4, chat_max_wall_time: 900 } },
    }), 'utf-8');
    const events = await collectWith({ message: 'hello', threadId: 't-helper-limit', persona: 'helper' }, loopingLlm());
    const truncated = events.find(e => e.type === 'truncated' && e.reason === 'iterations');
    assert.ok(truncated, 'ход должен упереться в общий лимит итераций');
    assert.notEqual(truncated.step, 4, 'лимит supervisor не должен применяться к helper');
  });

  it('битые supervisor.limits не роняют ход (дефолты + лог)', async () => {
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { limits: { chat_max_iterations: 'много' } },
    }), 'utf-8');
    const events = await collect({ message: 'привет', threadId: 't-bad', persona: 'supervisor' });
    assert.equal(events[0].type, 'thread');
    assert.ok(!events.some(e => e.type === 'error'), JSON.stringify(events));
  });
});

describe('таймер тика (AC1)', () => {
  it('без активного grant таймер не заводится', () => {
    assert.equal(startSupervisorTimer(cwd, { intervalMs: 10_000 }), false);
    assert.equal(isSupervisorTimerRunning(), false);
  });

  it('с активным grant таймер поднимается и снимается stopSupervisorTimer', () => {
    const task = createTaskFile(cwd, { title: 'Прогон', status: 'Spec' });
    writeGrant(cwd, {
      runId: 'run-timer',
      taskIds: [task.id],
      allowedTools: ['backlog_trigger_phase'],
      grantedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    assert.equal(startSupervisorTimer(cwd, { intervalMs: 3_600_000 }), true);
    assert.equal(isSupervisorTimerRunning(), true);
    stopSupervisorTimer();
    assert.equal(isSupervisorTimerRunning(), false);
  });

  it('VIBELOG_SUPERVISOR_TICK=off глушит таймер даже при grant', () => {
    const task = createTaskFile(cwd, { title: 'Прогон 2', status: 'Spec' });
    writeGrant(cwd, {
      runId: 'run-timer-2',
      taskIds: [task.id],
      allowedTools: ['backlog_trigger_phase'],
      grantedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    process.env.VIBELOG_SUPERVISOR_TICK = 'off';
    assert.equal(startSupervisorTimer(cwd, { intervalMs: 3_600_000 }), false);
    assert.equal(isSupervisorTimerRunning(), false);
  });
});