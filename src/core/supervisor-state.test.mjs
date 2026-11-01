/**
 * Тесты состояния прогона супервизора (VL-270, AC20: state/heartbeat,
 * атомарность, живость по pid).
 *
 * Ключевые свойства, которые проверяются:
 * - `state.json` пишется атомарно (temp + rename) — после записи temp нет,
 *   а файл всегда читается как целый JSON (AC4);
 * - живость фазы — по pid + phaseRunId (AC5): живой процесс с ТЕМ ЖЕ
 *   phaseRunId — идущая фаза, мёртвый pid или другой phaseRunId — не идущая;
 * - heartbeat содержит то, по чему принимается решение: таблицу задач,
 *   прошлое решение, обоснование групп и предупреждения правил.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  heartbeatPath,
  isPidAlive,
  loadState,
  phaseAlive,
  saveState,
  snapshotKey,
  statePath,
  tailLines,
  writeHeartbeat,
} from '../../dist/core/supervisor-state.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-state-'));

/** Минимальное состояние с одной задачей. */
function makeState(overrides = {}) {
  return {
    runId: 'run-test',
    mode: 'conservative',
    startedAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    tick: 1,
    lastDecision: { tick: 1, action: 'wait', reason: 'нечего делать' },
    tasks: {
      'VL-1': {
        phase: 'plan',
        status: 'running',
        phaseRunId: 'run-VL-1-plan-1',
        pid: process.pid,
        startedAt: '2026-11-01T10:00:00.000Z',
        attempt: 1,
        healAttempts: 0,
        groupId: 'g1',
      },
    },
    tuning: { applied: 0 },
    ...overrides,
  };
}

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

describe('state.json: запись и чтение (AC4)', () => {
  it('saveState → loadState возвращает то же состояние; temp-файла нет', () => {
    const state = makeState();
    saveState(cwd, state);
    assert.ok(existsSync(statePath(cwd)));
    assert.ok(!existsSync(`${statePath(cwd)}.tmp`), 'temp-файл не должен оставаться');
    const back = loadState(cwd);
    assert.equal(back.runId, 'run-test');
    assert.equal(back.mode, 'conservative');
    assert.equal(back.tick, 1);
    assert.equal(back.tasks['VL-1'].phase, 'plan');
    assert.equal(back.tasks['VL-1'].phaseRunId, 'run-VL-1-plan-1');
    assert.equal(back.lastDecision.action, 'wait');
  });

  it('битый JSON → null (тик начнёт состояние заново)', () => {
    mkdirSync(join(cwd, '.vibelog', 'supervisor'), { recursive: true });
    writeFileSync(statePath(cwd), '{ половина объекта', 'utf-8');
    assert.equal(loadState(cwd), null);
  });

  it('файла нет → null', () => {
    assert.equal(loadState(cwd), null);
  });

  it('мусор в задачах выпадает, валидные остаются', () => {
    saveState(cwd, makeState({
      tasks: {
        'VL-1': { phase: 'plan', status: 'running', attempt: 1, healAttempts: 0 },
        'VL-2': 'это не объект',
        'VL-3': { status: 'done' },
      },
    }));
    const back = loadState(cwd);
    assert.deepEqual(Object.keys(back.tasks), ['VL-1']);
  });
});

describe('живость фазы по pid + phaseRunId (AC5)', () => {
  it('isPidAlive: текущий процесс жив, заведомо свободный pid — нет', () => {
    assert.equal(isPidAlive(process.pid), true);
    // 999999 — pid вне диапазона практических значений на macOS/Linux
    assert.equal(isPidAlive(999999), false);
    assert.equal(isPidAlive(undefined), false);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-5), false);
    assert.equal(isPidAlive('42'), false);
  });

  it('phaseAlive: живой pid + совпавший phaseRunId → true', () => {
    const state = makeState();
    assert.equal(phaseAlive(state, 'VL-1'), true);
  });

  it('phaseAlive: мёртвый pid → false (после рестарта фаза не считается идущей)', () => {
    const state = makeState();
    state.tasks['VL-1'].pid = 999999;
    assert.equal(phaseAlive(state, 'VL-1'), false);
  });

  it('phaseAlive: несовпавший phaseRunId → false (защита от переиспользованного pid)', () => {
    const state = makeState();
    delete state.tasks['VL-1'].phaseRunId;
    assert.equal(phaseAlive(state, 'VL-1'), false);
    state.tasks['VL-1'].phaseRunId = '';
    assert.equal(phaseAlive(state, 'VL-1'), false);
  });

  it('phaseAlive: статус не running → false даже при живом pid', () => {
    const state = makeState();
    state.tasks['VL-1'].status = 'failed';
    assert.equal(phaseAlive(state, 'VL-1'), false);
  });
});

describe('snapshotKey: wake gate (AC2)', () => {
  it('одинаковое состояние → одинаковый ключ', () => {
    const state = makeState();
    const obs = { 'VL-1': { running: true, status: 'Spec', nextPhase: 'plan' } };
    assert.equal(snapshotKey(state, obs, 'g1'), snapshotKey(state, obs, 'g1'));
  });

  it('смена статуса задачи меняет ключ', () => {
    const state = makeState();
    const a = snapshotKey(state, { 'VL-1': { running: true, status: 'Spec' } }, 'g1');
    const b = snapshotKey(state, { 'VL-1': { running: true, status: 'Planned' } }, 'g1');
    assert.notEqual(a, b);
  });

  it('появление/смена ошибки меняет ключ, номер тика — НЕ меняет', () => {
    const state = makeState();
    const before = snapshotKey(state, { 'VL-1': { running: false, status: 'Spec' } }, 'g1');
    state.tick = 99;
    assert.equal(snapshotKey(state, { 'VL-1': { running: false, status: 'Spec' } }, 'g1'), before);
    state.tasks['VL-1'].lastError = 'payload limit';
    assert.notEqual(snapshotKey(state, { 'VL-1': { running: false, status: 'Spec' } }, 'g1'), before);
  });

  it('смена repeat-метрик и grant меняют ключ', () => {
    const state = makeState();
    const base = snapshotKey(state, { 'VL-1': { running: false, status: 'Spec' } }, 'g1');
    const withStats = snapshotKey(
      state,
      { 'VL-1': { running: false, status: 'Spec', repeatStats: { tool_calls_total: 10, repeat_calls: 6, repeat_share: 0.6, top: [] } } },
      'g1',
    );
    assert.notEqual(base, withStats);
    assert.notEqual(base, snapshotKey(state, { 'VL-1': { running: false, status: 'Spec' } }, 'g2'));
  });

  it('VL-275: blockedBy входит в ключ (снятие блокировки будит тик)', () => {
    const state = makeState();
    const obs = { 'VL-1': { running: false, status: 'Spec' } };
    const without = snapshotKey(state, obs, 'g1');
    state.tasks['VL-1'].blockedBy = ['VL-209'];
    const withBlocker = snapshotKey(state, obs, 'g1');
    assert.notEqual(without, withBlocker, 'появление блокировки меняет ключ');
    // Снятие блокировки возвращает состояние к прежнему ключу — значит тик
    // увидит изменение и запустит разблокированную задачу (AC4)
    delete state.tasks['VL-1'].blockedBy;
    assert.equal(snapshotKey(state, obs, 'g1'), without);
  });
});

describe('heartbeat.md и tailLines', () => {
  it('VL-275: heartbeat перечисляет заблокированные задачи и помечает внешние блокеры', () => {
    const state = makeState();
    state.tasks['VL-2'] = {
      phase: 'plan',
      status: 'pending',
      attempt: 0,
      healAttempts: 0,
      blockedBy: ['VL-209', 'VL-1'],
    };
    const text = writeHeartbeat(cwd, state, { running: true });
    assert.match(text, /## Заблокированы зависимостями/);
    assert.match(text, /- VL-2 — ждёт VL-209 \(нет в прогоне\), VL-1/);
    // Блокеров у VL-1 нет — в секции он не появляется
    assert.doesNotMatch(text, /- VL-1 —/);
  });

  it('снятие блокировки убирает секцию блокировок из heartbeat', () => {
    const state = makeState();
    const text = writeHeartbeat(cwd, state, { running: true });
    assert.doesNotMatch(text, /## Заблокированы зависимостями/);
  });

  it('heartbeat содержит прогон, таблицу задач, прошлое решение и обоснование групп', () => {
    const state = makeState();
    const text = writeHeartbeat(cwd, state, {
      grant: { runId: 'run-test', expiresAt: '2026-11-01T18:00:00.000Z', active: true },
      running: true,
      groupsRationale: ['Волна 1: VL-1, VL-2 — обоснование: разные подсистемы'],
      ruleErrors: ['heal_rules[2] — action "x" вне набора, правило выпало'],
      observations: {
        'VL-1': {
          running: false,
          status: 'Spec',
          logTail: 'строка 1\nстрока 2\nстрока 3',
          lastRunError: 'max-wall-time',
        },
      },
    });
    assert.ok(existsSync(heartbeatPath(cwd)));
    assert.equal(readFileSync(heartbeatPath(cwd), 'utf8'), text);
    assert.match(text, /# Heartbeat прогона run-test/);
    assert.match(text, /Прогон: идёт/);
    assert.match(text, /\| VL-1 \| plan \| running/);
    assert.match(text, /## Прошлое решение/);
    assert.match(text, /обоснование: разные подсистемы/);
    assert.match(text, /Предупреждения правил лечения/);
    assert.match(text, /fail_reason: max-wall-time/);
  });

  it('heartbeat не дублирует сырые логи: только фрагмент (≤8 строк)', () => {
    const state = makeState();
    const long = Array.from({ length: 50 }, (_, i) => `log-line-${i + 1}`).join('\n');
    const text = writeHeartbeat(cwd, state, {
      running: true,
      observations: { 'VL-1': { running: false, status: 'Spec', logTail: long } },
    });
    assert.match(text, /log-line-50/);
    assert.doesNotMatch(text, /log-line-1\n/, 'самое начало длинного лога не должно попасть');
    assert.doesNotMatch(text, /log-line-42/);
  });

  it('остановленная задача помечается в таблице', () => {
    const state = makeState();
    state.tasks['VL-1'].frozen = true;
    const text = writeHeartbeat(cwd, state, { running: true });
    assert.match(text, /\(остановлена\)/);
  });

  it('tailLines берёт последние N непустых строк', () => {
    assert.equal(tailLines('a\n\nb\nc', 2), 'b\nc');
    assert.equal(tailLines(undefined, 3), '');
    assert.equal(tailLines('  ', 3), '');
  });
});