/**
 * Тесты тика супервизора (VL-270, AC1, AC2, AC3, AC5, AC19, AC26).
 *
 * Ключевые проверки:
 * - wake gate (AC2): при неизменном состоянии LLM НЕ вызывается — счётчик
 *   вызовов стаба равен нулю;
 * - парсинг решения: fenced json, мусор → фолбэк, попытка назначить фазу
 *   отбрасывается (фазы определяет workflow, analyze для лечения не нужен);
 * - рестарт процесса (AC5, AC19): `state.json` с running + мёртвый pid →
 *   тик распознаёт падение и лечит; живой pid (process.pid) → не трогает;
 * - бюджет промпта (AC3): сырые логи целиком не попадают.
 *
 * Спавн фаз подменяется швом setTickStartPhaseForTests — реальный qwen в тестах
 * не запускается (паттерн setSpawnEnvBaseForTests VL-140). Швы сбрасываются
 * в afterEach: isolate:false переиспользует воркеры между файлами.
 */

import { describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskFile, getTask, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { loadState, saveState } from '../../dist/core/supervisor-state.js';
import { writeGrant } from '../../dist/web/supervisor-grant.js';
import {
  buildTickPrompt,
  extractJsonObject,
  parseTickDecision,
  runSupervisorTick,
  setTickActiveCountForTests,
  setTickClockForTests,
  setTickLlmForTests,
  setTickStartPhaseForTests,
} from '../../dist/web/supervisor-tick.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-tick-'));

/** Стаб LLM: считает вызовы, отдаёт заранее заданный ответ. */
function makeLlm(text) {
  const calls = [];
  return {
    calls,
    ask: async (prompt) => {
      calls.push(prompt);
      return typeof text === 'function' ? text(prompt) : text;
    },
  };
}

/** Стаб startTaskPhase: возвращает «запущено» с подставным pid. */
function makeStartPhaseStub() {
  const started = [];
  const fn = (dir, taskId, phase, opts) => {
    started.push({ taskId, phase, comment: opts?.comment, extraArgs: opts?.extraArgs });
    return { started: true, pid: process.pid };
  };
  return { started, fn };
}

/** Grant на набор задач. */
function grantFor(taskIds) {
  writeGrant(cwd, {
    runId: 'run-tick-test',
    taskIds,
    allowedTools: ['backlog_trigger_phase', 'backlog_create_task'],
    grantedAt: '2026-11-01T10:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
}

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Tick Test',
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
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
});

afterEach(() => {
  setTickLlmForTests(null);
  setTickClockForTests(null);
  setTickStartPhaseForTests(null);
  setTickActiveCountForTests(null);
});

describe('wake gate (AC2)', () => {
  it('без grant модель не вызывается и состояние не создаётся', async () => {
    const llm = makeLlm('{"action":"run"}');
    setTickLlmForTests(llm);
    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.skipped, 'no-grant');
    assert.equal(res.llmCalled, false);
    assert.equal(llm.calls.length, 0);
  });

  it('VIBELOG_SUPERVISOR_TICK=off глушит тик целиком', async () => {
    const task = createTaskFile(cwd, { title: 'Задача', status: 'Spec' });
    grantFor([task.id]);
    const llm = makeLlm('{"action":"run"}');
    setTickLlmForTests(llm);
    process.env.VIBELOG_SUPERVISOR_TICK = 'off';
    try {
      const res = await runSupervisorTick(cwd, { llm });
      assert.equal(res.skipped, 'disabled');
      assert.equal(llm.calls.length, 0);
    } finally {
      delete process.env.VIBELOG_SUPERVISOR_TICK;
    }
  });

  it('состояние не изменилось → модель не вызывается (0 вызовов)', async () => {
    const task = createTaskFile(cwd, { title: 'Тихая задача', status: 'Done' });
    grantFor([task.id]);
    const llm = makeLlm('{"action":"run"}');
    setTickLlmForTests(llm);
    setTickStartPhaseForTests(makeStartPhaseStub().fn);

    // Первый тик: терминальная задача — кандидатов нет, решения нет
    const first = await runSupervisorTick(cwd, { llm });
    assert.equal(first.llmCalled, false);
    const second = await runSupervisorTick(cwd, { llm });
    assert.equal(second.skipped, 'unchanged');
    assert.equal(second.llmCalled, false);
    assert.equal(llm.calls.length, 0, 'wake gate обязан экономить вызовы модели');
  });

  it('появилась задача с доступной фазой → модель вызывается', async () => {
    const task = createTaskFile(cwd, { title: 'Готовая', status: 'Spec' });
    grantFor([task.id]);
    const llm = makeLlm(JSON.stringify({ action: 'run', groups: [[task.id]], rationale: { [task.id]: 'одна задача' } }));
    setTickLlmForTests(llm);
    setTickStartPhaseForTests(makeStartPhaseStub().fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.llmCalled, true);
    assert.equal(llm.calls.length, 1);
    assert.equal(res.decision, 'llm');
  });
});

describe('парсинг решения и фолбэк (AC3)', () => {
  it('fenced json извлекается, обычный JSON тоже', () => {
    assert.equal(extractJsonObject('текст ```json\n{"a":1}\n``` хвост'), '{"a":1}');
    assert.equal(extractJsonObject('вот решение: {"a":{"b":2}} конец'), '{"a":{"b":2}}');
    assert.equal(extractJsonObject('нет json вовсе'), null);
  });

  it('валидное решение парсится целиком', () => {
    const { decision, error } = parseTickDecision(JSON.stringify({
      action: 'run',
      reason: 'две задачи независимы',
      groups: [['VL-1', 'VL-2']],
      rationale: { 'VL-1,VL-2': 'разные подсистемы' },
      heal: [{ taskId: 'VL-3', comment: 'попробуй иначе' }],
      bug: [{ taskId: 'VL-4', reason: 'безнадёжно' }],
      stop: [{ taskId: 'VL-5', reason: 'ждём человека' }],
      tuning: { default_action: 'retry' },
    }));
    assert.equal(error, undefined);
    assert.equal(decision.action, 'run');
    assert.deepEqual(decision.groups, [['VL-1', 'VL-2']]);
    assert.equal(decision.rationale['VL-1,VL-2'], 'разные подсистемы');
    assert.equal(decision.heal[0].comment, 'попробуй иначе');
    assert.equal(decision.bug[0].reason, 'безнадёжно');
    assert.equal(decision.stop[0].taskId, 'VL-5');
    assert.deepEqual(decision.tuning, { default_action: 'retry' });
  });

  it('мусор и невалидный action → decision null с причиной', () => {
    assert.equal(parseTickDecision('никакого json').decision, null);
    assert.equal(parseTickDecision('{битый').decision, null);
    assert.equal(parseTickDecision('[]').decision, null);
    const bad = parseTickDecision('{"action":"изобретать"}');
    assert.equal(bad.decision, null);
    assert.match(bad.error, /action вне набора/);
  });

  it('попытка назначить фазу в лечении отбрасывается (фазу определяет workflow)', () => {
    const { decision, notes } = parseTickDecision(JSON.stringify({
      action: 'heal',
      heal: [
        { taskId: 'VL-1', phase: 'analyze', comment: 'разберись' },
        { taskId: 'VL-2', comment: 'разберись как-нибудь' },
      ],
    }));
    assert.equal(decision.heal.length, 1);
    assert.equal(decision.heal[0].taskId, 'VL-2');
    assert.ok(notes.some(n => /analyze/.test(n) && /workflow/.test(n)), notes.join(' | '));
  });

  it('невалидный ответ модели → детерминированный фолбэк, тик не падает', async () => {
    const task = createTaskFile(cwd, { title: 'Фолбэк', status: 'Spec' });
    grantFor([task.id]);
    const llm = makeLlm('модель ответила прозой без JSON');
    setTickLlmForTests(llm);
    const stub = makeStartPhaseStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.decision, 'fallback');
    assert.equal(stub.started.length, 1, 'фолбэк обязан всё равно запустить готовую задачу');
    assert.equal(stub.started[0].taskId, task.id);
  });

  it('LLM не настроен (null) → фолбэк, модель не вызывается', async () => {
    const task = createTaskFile(cwd, { title: 'Без LLM', status: 'Spec' });
    grantFor([task.id]);
    const stub = makeStartPhaseStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);
    const res = await runSupervisorTick(cwd, { llm: null });
    assert.equal(res.llmCalled, false);
    assert.equal(res.decision, 'fallback');
    assert.equal(stub.started.length, 1);
  });
});

describe('рестарт процесса и живость (AC5, AC19)', () => {
  it('state: running + мёртвый pid → тик распознаёт падение и лечит директивой', async () => {
    const task = createTaskFile(cwd, { title: 'Упавшая', status: 'Spec' });
    grantFor([task.id]);
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    // Правило лечения: нет прогресса → директива фазе (comment_and_retry).
    // Дефолтные правила на этот случай дают retry_once_then_bug → retry,
    // поэтому проверяем именно доставку директивы своим правилом (AC7).
    mkdirSync(join(cwd, '.vibelog', 'supervisor'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'supervisor', 'settings.json'), JSON.stringify({
      heal_rules: [{
        id: 'no-progress-directive',
        when: { status_unchanged: true },
        action: 'comment_and_retry',
        comment_template: 'Ты повторно обращался к тем же путям: {top_repeats} (попытка {attempt} по {task_id}).',
      }],
      default_action: 'bug',
    }), 'utf-8');
    saveState(cwd, {
      runId: 'run-tick-test',
      mode: 'conservative',
      startedAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      tick: 1,
      lastDecision: { tick: 1, action: 'run', reason: 'запущено' },
      tasks: {
        [task.id]: {
          phase: 'plan',
          status: 'running',
          phaseRunId: `run-${task.id.toUpperCase()}-plan-1`,
          pid: 999999,
          startedAt: '2026-11-01T10:00:00.000Z',
          attempt: 1,
          healAttempts: 0,
          statusAtStart: 'In Progress',
        },
      },
      tuning: { applied: 0 },
    });
    const llm = makeLlm('{"action":"wait"}');
    setTickLlmForTests(llm);
    const stub = makeStartPhaseStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.ok(res.healed.some(h => h.taskId === task.id && h.ruleId === 'no-progress-directive'), JSON.stringify(res));
    const comment = stub.started.find(s => s.taskId === task.id && s.phase === 'comment');
    assert.ok(comment, `директива должна уйти фазой comment: ${JSON.stringify(stub.started)}`);
    assert.match(comment.comment, /путям:/);
    assert.match(comment.comment, /попытка 1/);
    assert.match(comment.comment, new RegExp(task.id, 'i'));
  });

  it('state: running + живой pid (process.pid) → тик фазу не трогает', async () => {
    const task = createTaskFile(cwd, { title: 'Живая', status: 'In Progress' });
    grantFor([task.id]);
    saveState(cwd, {
      runId: 'run-tick-test',
      mode: 'conservative',
      startedAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      tick: 1,
      lastDecision: { tick: 1, action: 'run', reason: 'запущено' },
      tasks: {
        [task.id]: {
          phase: 'plan',
          status: 'running',
          phaseRunId: `run-${task.id.toUpperCase()}-plan-1`,
          // process.pid жив — фаза «идёт», лечение не применяется
          pid: process.pid,
          startedAt: new Date().toISOString(),
          attempt: 1,
          healAttempts: 0,
          statusAtStart: 'In Progress',
        },
      },
      tuning: { applied: 0 },
    });
    const llm = makeLlm('{"action":"wait"}');
    setTickLlmForTests(llm);
    const stub = makeStartPhaseStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 1);

    const res = await runSupervisorTick(cwd, { llm });
    assert.deepEqual(res.healed, []);
    assert.deepEqual(res.started, []);
    assert.equal(stub.started.length, 0);
  });

  it('статус сменился после смерти процесса → прогресс (done), без лечения', async () => {
    const task = createTaskFile(cwd, { title: 'Прогресс', status: 'Spec' });
    // статус задачи УЖЕ сменился (plan отработал и записал Planned)
    updateTaskFile(cwd, task.id, { status: 'Planned' });
    grantFor([task.id]);
    saveState(cwd, {
      runId: 'run-tick-test',
      mode: 'conservative',
      startedAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      tick: 1,
      lastDecision: { tick: 1, action: 'run', reason: 'запущено' },
      tasks: {
        [task.id]: {
          phase: 'plan',
          status: 'running',
          phaseRunId: `run-${task.id.toUpperCase()}-plan-1`,
          pid: 999999,
          startedAt: '2026-11-01T10:00:00.000Z',
          attempt: 1,
          healAttempts: 0,
          // на старте фазы задача была в Spec → смена на Planned = прогресс
          statusAtStart: 'Spec',
        },
      },
      tuning: { applied: 0 },
    });
    const llm = makeLlm('{"action":"wait"}');
    setTickLlmForTests(llm);
    setTickStartPhaseForTests(makeStartPhaseStub().fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    const key = task.id.toUpperCase();
    const saved = loadState(cwd);
    const entry = saved.tasks[key] ?? saved.tasks[task.id];
    // Прогресс зафиксирован, лечения нет; задача двинулась на следующую фазу
    // (в этом же тике она могла быть уже запущена в фазе code — это тоже верно)
    assert.equal(entry.nextPhase, 'code');
    assert.ok(entry.status === 'done' || entry.status === 'pending' || (entry.status === 'running' && entry.phase === 'code'),
      `неожиданный статус: ${entry.status}/${entry.phase}`);
    assert.deepEqual(res.healed, []);
  });
});

describe('промпт тика (AC3)', () => {
  it('содержит heartbeat, правила, grant, прошлое решение и контракт ответа', () => {
    const task = createTaskFile(cwd, { title: 'Промпт', status: 'Spec', labels: ['web'] });
    grantFor([task.id]);
    const prompt = buildTickPrompt(cwd, {
      state: {
        runId: 'run-tick-test',
        mode: 'conservative',
        startedAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
        tick: 7,
        lastDecision: { tick: 6, action: 'heal', ruleId: 'repeat-loop', taskId: task.id, reason: 'повторы' },
        tasks: {},
        tuning: { applied: 0 },
      },
      heal: { rules: [{ id: 'repeat-loop', when: { repeat_share_min: 0.25 }, action: 'comment_and_retry' }], defaultAction: 'bug', errors: [] },
      runtimeErrors: [],
      grant: { runId: 'run-tick-test', taskIds: [task.id], allowedTools: [], grantedAt: '', expiresAt: '2099-01-01T00:00:00.000Z' },
      heartbeat: '# Heartbeat\n\n| Задача | Фаза |\n|---|---|\n| VL-1 | plan |',
      candidates: [task.id],
      failing: [],
      lastDecision: { tick: 6, action: 'heal', ruleId: 'repeat-loop', taskId: task.id, reason: 'повторы' },
    });
    assert.match(prompt, /## Heartbeat/);
    assert.match(prompt, /## Правила лечения/);
    assert.match(prompt, /"default_action": "bug"/);
    assert.match(prompt, /## Прогон/);
    assert.match(prompt, /## Готовы к запуску/);
    assert.match(prompt, /## Прошлое решение/);
    assert.match(prompt, /## Контракт ответа/);
    assert.match(prompt, /conservative/);
    assert.match(prompt, /max_parallel_phases/);
  });

  it('не содержит сырых логов целиком и усекается по бюджету', () => {
    const task = createTaskFile(cwd, { title: 'Большой лог', status: 'In Progress' });
    grantFor([task.id]);
    const longTail = Array.from({ length: 500 }, (_, i) => `строка-${i + 1}`).join('\n');
    const prompt = buildTickPrompt(cwd, {
      state: {
        runId: 'run-tick-test',
        mode: 'aggressive',
        startedAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
        tick: 1,
        lastDecision: { tick: 0, action: 'wait', reason: '' },
        tasks: {},
        tuning: { applied: 0 },
      },
      heal: { rules: [], defaultAction: 'bug', errors: [] },
      runtimeErrors: [],
      grant: { runId: 'run-tick-test', taskIds: [task.id], allowedTools: [], grantedAt: '', expiresAt: '2099-01-01T00:00:00.000Z' },
      heartbeat: 'кратко',
      candidates: [],
      failing: [{
        taskId: task.id,
        obs: { running: false, status: 'In Progress', logTail: longTail },
        state: { phase: 'code', status: 'failed', attempt: 1, healAttempts: 1 },
      }],
      lastDecision: { tick: 0, action: 'wait', reason: '' },
      maxChars: 1200,
    });
    assert.ok(prompt.length <= 1200, `промпт ${prompt.length} символов`);
    assert.match(prompt, /усечён по бюджету/);
    assert.doesNotMatch(prompt, /строка-1\b/, 'начало длинного лога не должно попасть');
  });
});

describe('workflow-fallback (AC26)', () => {
  it('невалидный/отсутствующий воркфлоу задачи не роняет тик', async () => {
    const task = createTaskFile(cwd, { title: 'Без воркфлоу', status: 'Spec', type: 'chore' });
    grantFor([task.id]);
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: { default: 'сломано', simple: { transitions: 'нет' } },
      task_workflows: { chore: 'нет-такого-воркфлоу' },
    }), 'utf-8');
    const llm = makeLlm('{"action":"wait"}');
    setTickLlmForTests(llm);
    const stub = makeStartPhaseStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    // Главное: тик не упал и выбрал фазу по DEFAULT_WORKFLOW (Spec → plan)
    assert.ok(res.decision === 'llm' || res.decision === 'fallback');
    assert.deepEqual(res.bugs, []);
  });
});