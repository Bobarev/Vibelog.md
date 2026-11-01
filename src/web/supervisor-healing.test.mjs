/**
 * Тесты лечения (VL-270, AC6–AC11): порядок правил, семантика `when`,
 * подстановки шаблона, исчерпание heal_attempts → авто-баг и стоп, авто-баг
 * по формату описания, битое правило не роняет тик.
 *
 * Тик вызывается напрямую (runSupervisorTick) с подставными швами: спавн фаз —
 * стаб, LLM — стаб, счётчик активных фаз — стаб. Реальный qwen не запускается.
 */

import { describe, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskFile, getTask, listTasks, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { loadState, saveState } from '../../dist/core/supervisor-state.js';
import { writeGrant } from '../../dist/web/supervisor-grant.js';
import {
  createAutoBug,
  matchHealRule,
  renderCommentTemplate,
  runSupervisorTick,
  setTickActiveCountForTests,
  setTickLlmForTests,
  setTickStartPhaseForTests,
} from '../../dist/web/supervisor-tick.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-healing-'));

/** Стаб LLM: «ничего не меняю» — проверяем детерминированный код лечения. */
function passiveLlm() {
  const calls = [];
  return { calls, ask: async (p) => (calls.push(p), '{"action":"wait"}') };
}

/** Стаб startTaskPhase: фиксирует вызовы, возвращает «запущено». */
function startStub() {
  const started = [];
  return {
    started,
    fn: (dir, taskId, phase, opts) => {
      started.push({ taskId, phase, comment: opts?.comment });
      return { started: true, pid: process.pid };
    },
  };
}

function grantFor(taskIds) {
  writeGrant(cwd, {
    runId: 'run-heal',
    taskIds,
    allowedTools: ['backlog_trigger_phase', 'backlog_create_task'],
    grantedAt: '2026-11-01T10:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
}

function writeHealConfig(body) {
  mkdirSync(join(cwd, '.vibelog', 'supervisor'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'supervisor', 'settings.json'), JSON.stringify(body), 'utf-8');
}

/**
 * Кладёт state с УПАВШЕЙ фазой задачи (мёртвый pid, статус не сменился).
 * Задача остаётся в `In Progress` — «фаза отработала, а прогресса нет».
 */
function seedFailed(task, overrides = {}) {
  saveState(cwd, {
    runId: 'run-heal',
    mode: 'conservative',
    startedAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    tick: 1,
    lastDecision: { tick: 1, action: 'run', reason: 'запущено' },
    tasks: {
      [task.id.toUpperCase()]: {
        phase: 'plan',
        status: 'running',
        phaseRunId: `run-${task.id.toUpperCase()}-plan-1`,
        pid: 999999,
        startedAt: '2026-11-01T10:00:00.000Z',
        attempt: 1,
        healAttempts: 0,
        statusAtStart: 'In Progress',
        ...overrides,
      },
    },
    tuning: { applied: 0 },
  });
}

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Healing Test',
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
  setTickStartPhaseForTests(null);
  setTickActiveCountForTests(null);
});

describe('matchHealRule: порядок и семантика when (AC6)', () => {
  const rules = [
    { id: 'repeat-loop', when: { repeat_share_min: 0.25, repeat_calls_min: 8 }, action: 'comment_and_retry', commentTemplate: 'x' },
    { id: 'payload-limit', when: { fail_reason_contains: ['payload', 'max-payload'] }, action: 'retry' },
    { id: 'wall-timeout', when: { fail_reason_contains: ['max-wall-time', 'таймаут', 'timeout'] }, action: 'retry' },
    { id: 'no-progress', when: { status_unchanged: true }, action: 'retry_once_then_bug' },
  ];

  it('первое совпадение выигрывает (порядок важен)', () => {
    const hit = matchHealRule(rules, { repeatShare: 0.5, repeatCalls: 10, failReason: 'payload превышен', statusUnchanged: true });
    assert.equal(hit.id, 'repeat-loop');
  });

  it('repeat_share_min и repeat_calls_min — AND (одного мало)', () => {
    assert.equal(matchHealRule(rules.slice(0, 1), { repeatShare: 0.5, repeatCalls: 3, failReason: '', statusUnchanged: false }), null);
    assert.equal(matchHealRule(rules.slice(0, 1), { repeatShare: 0.1, repeatCalls: 30, failReason: '', statusUnchanged: false }), null);
    assert.equal(matchHealRule(rules.slice(0, 1), { repeatShare: 0.3, repeatCalls: 9, failReason: '', statusUnchanged: false }).id, 'repeat-loop');
  });

  it('fail_reason_contains — OR по вариантам, регистр не важен', () => {
    assert.equal(matchHealRule([rules[1]], { repeatShare: 0, repeatCalls: 0, failReason: 'Ошибка: PAYLOAD слишком большой', statusUnchanged: false }).id, 'payload-limit');
    assert.equal(matchHealRule([rules[2]], { repeatShare: 0, repeatCalls: 0, failReason: 'превышен max-wall-time', statusUnchanged: false }).id, 'wall-timeout');
    assert.equal(matchHealRule([rules[2]], { repeatShare: 0, repeatCalls: 0, failReason: 'таймаут провайдера', statusUnchanged: false }).id, 'wall-timeout');
    assert.equal(matchHealRule([rules[1]], { repeatShare: 0, repeatCalls: 0, failReason: 'другое', statusUnchanged: false }), null);
  });

  it('status_unchanged срабатывает только при отсутствии прогресса', () => {
    assert.equal(matchHealRule([rules[3]], { repeatShare: 0, repeatCalls: 0, failReason: '', statusUnchanged: true }).id, 'no-progress');
    assert.equal(matchHealRule([rules[3]], { repeatShare: 0, repeatCalls: 0, failReason: '', statusUnchanged: false }), null);
  });

  it('status_unchanged: false в правиле — срабатывает только когда прогресс БЫЛ', () => {
    const rule = { id: 'progress-only', when: { status_unchanged: false }, action: 'retry' };
    assert.equal(matchHealRule([rule], { repeatShare: 0, repeatCalls: 0, failReason: '', statusUnchanged: false }).id, 'progress-only');
    assert.equal(matchHealRule([rule], { repeatShare: 0, repeatCalls: 0, failReason: '', statusUnchanged: true }), null);
  });

  it('ни одно правило не совпало → null (решение отдаётся модели, уровень 2)', () => {
    assert.equal(matchHealRule(rules, { repeatShare: 0, repeatCalls: 0, failReason: 'тесты упали: 3 failed', statusUnchanged: false }), null);
  });
});

describe('renderCommentTemplate: подстановки (AC7)', () => {
  it('подставляет top_repeats, fail_reason, task_id, attempt', () => {
    const text = renderCommentTemplate(
      'Ты повторно обращался: {top_repeats}. Причина: {fail_reason}. {task_id}, попытка {attempt}.',
      { topRepeats: 'read_file src/a.ts ×6', failReason: 'payload', taskId: 'VL-9', attempt: 2 },
    );
    assert.equal(text, 'Ты повторно обращался: read_file src/a.ts ×6. Причина: payload. VL-9, попытка 2.');
  });

  it('неизвестная подстановка остаётся как есть (шаблон правит модель)', () => {
    assert.equal(renderCommentTemplate('{неизвестно} {task_id}', { taskId: 'VL-1' }), '{неизвестно} VL-1');
  });

  it('отсутствующие данные дают понятный текст, а не пустоту', () => {
    const text = renderCommentTemplate('{top_repeats} | {fail_reason}', {});
    assert.match(text, /повторов не зафиксировано/);
    assert.match(text, /причина не зафиксирована/);
  });
});

describe('healing уровня 1 в тике (AC6–AC9)', () => {
  it('repeat-loop: высокие повторы → директива фазой comment + рестарт учтён', async () => {
    const task = createTaskFile(cwd, { title: 'Зациклилась', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{
        id: 'repeat-loop',
        when: { repeat_share_min: 0.25, repeat_calls_min: 8 },
        action: 'comment_and_retry',
        comment_template: 'Ты повторно обращался к тем же путям: {top_repeats}. Используй ранее полученный результат; следующий шаг — правка, а не чтение.',
      }],
      default_action: 'bug',
    });
    seedFailed(task, {
      lastRepeatStats: {
        tool_calls_total: 30,
        repeat_calls: 18,
        repeat_share: 0.6,
        top: [{ key: 'read_file|src/web/chat.ts', count: 6 }, { key: 'grep_search|loop', count: 3 }],
      },
    });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    // Правило сработало (либо repeat-loop, либо, при отсутствии метрики, no-progress-путь)
    assert.ok(res.healed.length === 1, JSON.stringify(res));
    assert.equal(res.healed[0].taskId, task.id.toUpperCase());
    // Директива ушла фазой comment с подставленным шаблоном
    const comment = stub.started.find(s => s.phase === 'comment');
    assert.ok(comment, JSON.stringify(stub.started));
    assert.match(comment.comment, /повторно обращался/);
    assert.match(comment.comment, /read_file\|src\/web\/chat\.ts ×6/);
    // Правило записано в цепочку state (нужно авто-багу)
    const saved = loadState(cwd);
    assert.ok((saved.tasks[task.id.toUpperCase()].ruleChain ?? []).includes(res.healed[0].ruleId));
  });

  it('payload-limit: транзиентная ошибка → retry той же фазы', async () => {
    const task = createTaskFile(cwd, { title: 'Payload', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'payload-limit', when: { fail_reason_contains: ['payload'] }, action: 'retry' }],
      default_action: 'bug',
    });
    seedFailed(task, { lastError: 'payload превышен: 1.2 МБ' });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.healed.length, 1);
    assert.equal(res.healed[0].ruleId, 'payload-limit');
    const restart = stub.started.find(s => s.taskId === task.id && s.phase === 'plan');
    assert.ok(restart, `должен быть retry фазы plan: ${JSON.stringify(stub.started)}`);
    assert.equal(stub.started.some(s => s.phase === 'comment'), false);
  });

  it('stop: правило останавливает задачу (frozen, больше не запускается)', async () => {
    const task = createTaskFile(cwd, { title: 'Стоп', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'hard-stop', when: { fail_reason_contains: ['секрет'] }, action: 'stop' }],
      default_action: 'bug',
    });
    seedFailed(task, { lastError: 'утечка секрета в лог' });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.deepEqual(res.stopped, [task.id.toUpperCase()]);
    assert.equal(res.bugs.length, 0);
    assert.equal(stub.started.length, 0);
    const saved = loadState(cwd);
    assert.equal(saved.tasks[task.id.toUpperCase()].frozen, true);
  });

  it('heal_attempts исчерпан → авто-баг в Spec и стоп по задаче (AC9)', async () => {
    const task = createTaskFile(cwd, { title: 'Безнадёжная', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'payload-limit', when: { fail_reason_contains: ['payload'] }, action: 'retry' }],
      default_action: 'bug',
    });
    // heal_attempts по умолчанию 2 — ставим исчерпание
    seedFailed(task, { healAttempts: 2, lastError: 'payload превышен', ruleChain: ['payload-limit', 'no-progress'] });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.bugs.length, 1, JSON.stringify(res));
    const bugTask = getTask(cwd, res.bugs[0].bugId);
    assert.equal(bugTask.status, 'Spec');
    assert.ok(bugTask.labels.includes('auto-bug'));
    assert.ok(bugTask.labels.includes('plan'), `метка фазы: ${bugTask.labels.join(',')}`);
    assert.match(bugTask.description, /## Причина/);
    assert.match(bugTask.description, /payload превышен/);
    assert.match(bugTask.description, /## Цепочка лечения/);
    assert.match(bugTask.description, /payload-limit/);
    assert.match(bugTask.description, new RegExp(`## Исходная задача\\n${task.id}`, 'i'));
    assert.equal(stub.started.length, 0, 'после авто-бага задача не перезапускается');
    assert.equal(loadState(cwd).tasks[task.id.toUpperCase()].frozen, true);
  });

  it('default_action применяется, когда ни одно правило не совпало (AC9)', async () => {
    const task = createTaskFile(cwd, { title: 'Содержательная', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'payload-limit', when: { fail_reason_contains: ['payload'] }, action: 'retry' }],
      default_action: 'bug',
    });
    seedFailed(task, { lastError: 'тесты упали: 3 failed' });
    // Модель не даёт содержательного разбора (passiveLlm → wait)
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    setTickStartPhaseForTests(startStub().fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.equal(res.healed.length, 1);
    assert.equal(res.healed[0].ruleId, 'default_action');
    assert.equal(res.bugs.length, 1, 'default_action=bug должен завести баг');
  });

  it('retry_once_then_bug: повтор на первой попытке, баг на последней (AC6)', async () => {
    const task = createTaskFile(cwd, { title: 'Один повтор', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'no-progress', when: { status_unchanged: true }, action: 'retry_once_then_bug' }],
      default_action: 'bug',
    });
    seedFailed(task, { healAttempts: 0 });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const first = await runSupervisorTick(cwd, { llm });
    assert.equal(first.bugs.length, 0);
    assert.equal(first.healed[0].ruleId, 'no-progress');
    assert.equal(stub.started.length, 1, 'первая попытка — retry');

    // Второй тик: попытка уже потрачена (healAttempts=1, лимит 2) → ещё retry,
    // третий (healAttempts=2) → bug. Проверяем последний шаг напрямую.
    seedFailed(task, { healAttempts: 2 });
    const second = await runSupervisorTick(cwd, { llm });
    assert.equal(second.bugs.length, 1, JSON.stringify(second));
  });

  it('ошибка доставки директивы/рестарта расходует healAttempts и доходит до авто-бага (VL-276)', async () => {
    const task = createTaskFile(cwd, { title: 'Залипший лок (VL-276)', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    writeHealConfig({
      heal_rules: [{ id: 'no-progress', when: { status_unchanged: true }, action: 'retry_once_then_bug' }],
      default_action: 'bug',
    });
    seedFailed(task, { healAttempts: 0 });
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    // Стаб оркестратора: лок навсегда — ровно то, что давал инцидент VL-248
    const attempts = [];
    setTickStartPhaseForTests((dir, taskId, phase) => {
      attempts.push({ taskId, phase });
      return { error: `Запуск уже выполняется (${String(taskId).toUpperCase()})` };
    });
    setTickActiveCountForTests(() => 0);
    const key = task.id.toUpperCase();

    // Тик 1: доставка не удалась → попытка израсходована (иначе цикл бесконечен)
    const first = await runSupervisorTick(cwd, { llm });
    assert.equal(attempts.length, 1, 'попытка запуска была');
    const afterFirst = loadState(cwd).tasks[key];
    assert.equal(afterFirst.healAttempts, 1, 'неудачная доставка расходует бюджет лечения');
    assert.equal(afterFirst.status, 'failed', 'неудача оставляет задачу в failed, а не running');
    assert.match(afterFirst.lastError ?? '', /транспорт|Запуск уже выполняется/, 'причина различима как транспортная');
    assert.equal(first.bugs.length, 0, 'на первой попытке баг не заводится');

    // Тик 2: ещё одна попытка (1 < лимита 2) — снова неудача, бюджет исчерпан
    const second = await runSupervisorTick(cwd, { llm });
    assert.equal(loadState(cwd).tasks[key].healAttempts, 2, 'вторая неудача тоже расходует бюджет');
    assert.equal(second.bugs.length, 0, 'пока бюджет не исчерпан, баг не заводится');

    // Тик 3: healAttempts=2 >= лимита 2 → авто-баг и стоп (цикл завершён)
    const third = await runSupervisorTick(cwd, { llm });
    assert.equal(third.bugs.length, 1, `ожидался авто-баг: ${JSON.stringify(third)}`);
    assert.equal(loadState(cwd).tasks[key].frozen, true, 'задача остановлена после бага');
  });

  it('битое правило не роняет тик: выпадает с предупреждением, тик работает', async () => {
    const task = createTaskFile(cwd, { title: 'Битый конфиг', status: 'Spec' });
    updateTaskFile(cwd, task.id, { status: 'In Progress' });
    grantFor([task.id]);
    // Файл правил — мусор: тик обязан откатиться к дефолтным правилам
    mkdirSync(join(cwd, '.vibelog', 'supervisor'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'supervisor', 'settings.json'), '{ это не json', 'utf-8');
    seedFailed(task);
    const llm = passiveLlm();
    setTickLlmForTests(llm);
    const stub = startStub();
    setTickStartPhaseForTests(stub.fn);
    setTickActiveCountForTests(() => 0);

    const res = await runSupervisorTick(cwd, { llm });
    assert.ok(res.errors.some(e => /не читается как JSON/.test(e)), res.errors.join(' | '));
    // Дефолтное правило no-progress (retry_once_then_bug) обработало падение
    assert.equal(res.healed.length, 1);
    assert.ok(stub.started.length >= 1);
  });
});

describe('createAutoBug: формат описания (AC11)', () => {
  it('детерминированное описание: причина, лог, сессия, цепочка, исходная задача', () => {
    const source = createTaskFile(cwd, { title: 'Исходная задача', status: 'Spec' });
    const bug = createAutoBug(cwd, {
      taskId: source.id,
      phase: 'code',
      failReason: 'тесты упали: 3 failed',
      logTail: 'строка A\nстрока B\nстрока C',
      sessionId: 'agent-123',
      ruleChain: ['repeat-loop', 'no-progress'],
      sourceTaskTitle: source.title,
    });
    assert.equal(bug.created, true);
    const task = getTask(cwd, bug.id);
    assert.match(task.title, /^\[авто\] code /);
    assert.equal(task.status, 'Spec');
    assert.equal(task.type, 'bug');
    assert.deepEqual(task.labels.sort(), ['auto-bug', 'code']);
    assert.match(task.description, /## Причина\ntests?|тесты упали/);
    assert.match(task.description, /## Последние строки лога/);
    assert.match(task.description, /строка C/);
    assert.match(task.description, /## Сессия/);
    assert.match(task.description, /agent-123/);
    assert.match(task.description, /## Цепочка лечения/);
    assert.match(task.description, /попытка 1: repeat-loop/);
    assert.match(task.description, /попытка 2: no-progress/);
    assert.match(task.description, /## Исходная задача/);
    assert.match(task.description, new RegExp(source.id, 'i'));
    // Зависимостей нет: баг-задача должна быть готова к работе, а не ждать
    assert.deepEqual(task.dependencies ?? [], []);
  });

  it('повторный баг по той же цепочке не создаётся (дедуп от лавины)', () => {
    const source = createTaskFile(cwd, { title: 'Исходная 2', status: 'Spec' });
    const ctx = {
      taskId: source.id,
      phase: 'plan',
      failReason: 'нет прогресса',
      ruleChain: ['no-progress'],
      sourceTaskTitle: source.title,
    };
    const first = createAutoBug(cwd, ctx);
    const second = createAutoBug(cwd, ctx);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.id, first.id);
    assert.equal(listTasks(cwd).filter(t => t.labels.includes('auto-bug') && t.description.includes(source.id)).length, 1);
  });

  it('другая цепочка по той же задаче → отдельный баг', () => {
    const source = createTaskFile(cwd, { title: 'Исходная 3', status: 'Spec' });
    const a = createAutoBug(cwd, { taskId: source.id, phase: 'plan', failReason: 'x', ruleChain: ['r1'], sourceTaskTitle: source.title });
    const b = createAutoBug(cwd, { taskId: source.id, phase: 'plan', failReason: 'y', ruleChain: ['r2'], sourceTaskTitle: source.title });
    assert.notEqual(a.id, b.id);
  });
});