/**
 * Тесты VL-191 — раннер автоочерери: выбор фазы (первая не-reject, reject
 * только вручную), retry-машина, пустая очередь → running:false (AC3),
 * enqueue без запуска, resume-сброс running→pending после «рестарта».
 *
 * Фазы НЕ спавнятся: тикаем только в состояниях, где startTaskPhase не
 * достигается (пусто/всё done), либо через чистые функции pickAutoPhase /
 * nextFailureAction.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_WORKFLOW } from '../../dist/core/workflow.js';
import { createTaskFile } from '../../dist/core/store.js';
import {
  autoQueuePath,
  loadAutoQueue,
  saveAutoQueue,
  addQueueTasks,
} from '../../dist/core/auto-queue.js';
import { setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import {
  pickAutoPhase,
  nextFailureAction,
  retryResumeArgs,
  setStartPhaseForTests,
  autoTick,
  enqueueAutoTasks,
  startAutoRunner,
  stopAutoRunner,
  resumeAutoRunner,
  autoQueueStatusText,
  stopAutoPoll,
} from '../../dist/bot/auto-runner.js';

/** Фейк-бот: notifyAllChats не шлёт ничего при пустом chats (тестовый cwd). */
const fakeBot = {};

describe('auto-runner (VL-191)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-auto-runner-'));

  afterAll(() => {
    stopAutoPoll();
    rmSync(testRoot, { recursive: true, force: true });
  });

  /** Чистое состояние: директория без файла очереди. */
  function freshDir(name) {
    return join(testRoot, name);
  }

  // ── Выбор фазы: ветвление ──

  it('pickAutoPhase: первая не-reject ветка (To Do → spec, Review → close после code)', () => {
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'To Do'), 'spec', 'reject пропущен');
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Spec'), 'plan');
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Planned'), 'code');
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Review'), 'close', 'close сразу, без ручного ревью');
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'In Progress'), 'code');
  });

  // ── VL-196: авто-retry после отката транзиентного In Progress ──
  //
  // Провал workflow-фазы → finalizePhaseStatus откатывает статус ДО onExit
  // авто-очереди (см. statusAtExit в orchestrator.test.mjs): pickAutoPhase
  // читает уже исходный статус и выбирает ТУ ЖЕ фазу. Без отката статус
  // остался бы In Progress → phase code → чужая фаза и падение retry
  // («нет фазы из статуса» — регрессия, которую закрывает AC2/AC3 VL-196).
  it('VL-196: retry после отката — фаза из исходного статуса, а не code из In Progress', () => {
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Spec'), 'plan', 'после отката — та же фаза');
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'In Progress'), 'code', 'застревание без отката — то, чего избегаем');
    assert.equal(nextFailureAction(1, 1), 'retry', 'первая ошибка → повтор той же фазы');
  });

  it('pickAutoPhase: только reject-ветка → null (reject — только вручную); финалы → null', () => {
    const rejectOnly = {
      initial_status: 'X',
      transitions: [{ status: 'X', phase: 'reject', produces_status: 'Rejected' }],
    };
    assert.equal(pickAutoPhase(rejectOnly, 'X'), null);
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Done'), null);
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'Rejected'), null);
    assert.equal(pickAutoPhase(DEFAULT_WORKFLOW, 'НеСтатус'), null);
  });

  // ── Retry-машина (default max_retries = 1) ──

  it('nextFailureAction: retry пока attempts ≤ max_retries, затем failed', () => {
    assert.equal(nextFailureAction(1, 1), 'retry', 'первая ошибка → 1 повтор');
    assert.equal(nextFailureAction(2, 1), 'failed', 'вторая ошибка → failed');
    assert.equal(nextFailureAction(1, 0), 'failed', 'max_retries 0 → сразу failed');
    assert.equal(nextFailureAction(2, 2), 'retry');
    assert.equal(nextFailureAction(3, 2), 'failed');
  });

  // ── AC3: пустая очередь → running:false ──

  it('autoTick: running:true + пустая очередь → running:false (спец.: остановиться)', () => {
    const dir = freshDir('empty-tick');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    saveAutoQueue(dir, { running: true, tasks: [] });
    autoTick(fakeBot, dir);
    assert.equal(loadAutoQueue(dir).running, false, 'пустая очередь останавливает автопрогон');
  });

  it('autoTick: все элементы done → running:false (нечего запускать)', () => {
    const dir = freshDir('all-done-tick');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    saveAutoQueue(dir, {
      running: true,
      tasks: [{ id: 'VL-1', status: 'done', added_at: 'T' }],
    });
    autoTick(fakeBot, dir);
    assert.equal(loadAutoQueue(dir).running, false);
  });

  it('autoTick: running:false → выход без изменений', () => {
    const dir = freshDir('stopped-tick');
    saveAutoQueue(dir, { running: false, tasks: [{ id: 'VL-1', status: 'pending', added_at: 'T' }] });
    autoTick(fakeBot, dir);
    const q = loadAutoQueue(dir);
    assert.equal(q.running, false);
    assert.equal(q.tasks[0].status, 'pending', 'pending не тронут');
  });

  // ── Команды: add/start/stop/status ──

  it('enqueueAutoTasks: добавляет (running:false — цикл не стартует)', () => {
    const dir = freshDir('enqueue');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    const res = enqueueAutoTasks(fakeBot, dir, ['VL-7', 'VL-8']);
    assert.deepEqual(res.added, ['VL-7', 'VL-8']);
    const again = enqueueAutoTasks(fakeBot, dir, ['VL-7']);
    assert.deepEqual(again.skipped, ['VL-7']);
    const q = loadAutoQueue(dir);
    assert.equal(q.running, false, 'add без start не включает автопрогон');
    assert.equal(q.tasks.length, 2);
  });

  it('startAutoRunner → running:true; stopAutoRunner → false (остановка после текущей фазы — в onExit)', () => {
    const dir = freshDir('start-stop');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    startAutoRunner(fakeBot, dir);
    // Фоновый setImmediate-тик: очередь пустая → сам выставит false;
    // фиксируем семантику start через синхронную запись
    assert.equal(loadAutoQueue(dir).running, true, 'start ставит running:true синхронно');
    stopAutoRunner(dir);
    assert.equal(loadAutoQueue(dir).running, false, 'stop ставит false синхронно');
  });

  it('autoQueueStatusText: отражает очередь', () => {
    const dir = freshDir('status-text');
    addQueueTasks(dir, ['VL-3']);
    const text = autoQueueStatusText(dir);
    assert.match(text, /остановлена/);
    assert.match(text, /VL-3 — pending/);
  });

  // ── AC1: рестарт ──

  it('resumeAutoRunner: running-элементы → pending, при running:true продолжает', async () => {
    const dir = freshDir('resume');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    // «Рестарт»: элемент застрял running (onExit потерян), очередь running
    saveAutoQueue(dir, {
      running: true,
      tasks: [{ id: 'VL-1', status: 'running', added_at: 'T', started_at: 'T2' }],
    });
    resumeAutoRunner(fakeBot, dir);
    let q = loadAutoQueue(dir);
    assert.equal(q.tasks[0].status, 'pending', 'running → pending после рестарта');
    assert.equal(q.running, true, 'running:true сохранён — продолжение');
    // Фоновый tick: backlog нет задач → VL-1 не выберется (нет файла) →
    // pending останется, poll-timer будет ждать; дожидаемся immediate-тика
    await new Promise((r) => setImmediate(r));
    q = loadAutoQueue(dir);
    // Задача VL-1 не существует (нет файла) → sweep пометил failed
    assert.equal(q.tasks[0].status, 'failed', 'несуществующая задача → failed, не зависла');
    stopAutoRunner(dir);
    stopAutoPoll();
  });

  it('resumeAutoRunner: running:false → ничего не запускает', () => {
    const dir = freshDir('resume-stopped');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    saveAutoQueue(dir, {
      running: false,
      tasks: [{ id: 'VL-1', status: 'running', added_at: 'T' }],
    });
    resumeAutoRunner(fakeBot, dir);
    const q = loadAutoQueue(dir);
    assert.equal(q.tasks[0].status, 'pending', 'running-хвост сбрасывается в любом случае');
    assert.equal(q.running, false);
  });

  it('файл очереди существует по autoQueuePath (документированный путь)', () => {
    const dir = freshDir('path-check');
    addQueueTasks(dir, ['VL-1']);
    assert.ok(autoQueuePath(dir).endsWith(join('.vibelog', 'auto-queue.json')));
  });

  // ── VL-200: retry фазы с --resume ──

  /** Пишет мету+jsonl сессии фазы (по образцу прод-пути CLI/orchestrator). */
  function makeSession(dir, sid, { taskId = 'VL-7', phase = 'spec', cwd, jsonl = true } = {}) {
    const sdir = join(dir, '.vibelog', 'agent-sessions');
    mkdirSync(sdir, { recursive: true });
    writeFileSync(
      join(sdir, `${sid}.meta.json`),
      JSON.stringify({ taskId, phase, cwd: cwd ?? dir }),
      'utf-8'
    );
    if (jsonl) {
      writeFileSync(join(sdir, `${sid}.jsonl`), '{"role":"user","content":"старый контекст"}\n', 'utf-8');
    }
  }

  /**
   * Минимальный backlog для createTaskFile: config.yml обязателен
   * (loadConfig кидается при отсутствии — штатная проверка VL-6).
   */
  function makeBacklog(dir) {
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(dir, 'backlog', 'config.yml'),
      'project_name: VL-200 Test\ntask_prefix: VL\ndefault_status: To Do\n' +
        'statuses: [Backlog, To Do, Spec, Planned, In Progress, Review, Done]\ndefinition_of_done: []\n',
      'utf-8'
    );
  }

  /** Ожидание условия с polling (async-цепочки autoTick через setImmediate). */
  async function waitFor(cond, ms = 4000, what = 'условие') {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (cond()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`waitFor: таймаут (${what})`);
  }

  it('retry после exitCode!=0 вызывает startTaskPhase с --resume, счётчики целы (VL-200, AC2)', async () => {
    const dir = freshDir('vl200-retry');
    makeBacklog(dir);
    createTaskFile(dir, { id: 'VL-7', title: 'Задача для retry' }); // status To Do → фаза spec
    makeSession(dir, 'agent-test1');
    saveAutoQueue(dir, {
      running: true,
      tasks: [{ id: 'VL-7', status: 'pending', added_at: 'T', attempts: 0 }],
    });

    const calls = [];
    setStartPhaseForTests((cwd, taskId, phase, opts) => {
      const q = loadAutoQueue(dir);
      const it0 = q.tasks.find((t) => t.id === 'VL-7');
      calls.push({ taskId, phase, opts, attemptsAtCall: it0?.attempts, statusAtCall: it0?.status });
      // exitCode!=0 → finishCurrentPhase → handlePhaseFailure → retry/failed
      opts.onExit({ running: false, phase, exitCode: 1, logTail: 'упало' });
      return { started: true, pid: 1 };
    });

    try {
      autoTick(fakeBot, dir);
      await waitFor(() => calls.length >= 2, 4000, 'второй вызов startTaskPhase');
      await waitFor(
        () => loadAutoQueue(dir).tasks.find((t) => t.id === 'VL-7')?.status === 'failed',
        4000,
        'статус failed'
      );

      assert.equal(calls.length, 2, 'ровно два запуска (первая попытка + retry)');
      // 1-й запуск: без resume, без комментария — штатный фазовый промпт
      assert.deepEqual(calls[0].opts.extraArgs, [], 'первая попытка без --resume');
      assert.equal(calls[0].attemptsAtCall, 0, 'первая попытка — attempts 0');
      // 2-й запуск: retry с --resume существующей сессии фазы
      assert.deepEqual(calls[1].opts.extraArgs, ['--resume', 'agent-test1'], 'retry получил --resume sessionId');
      assert.equal(calls[1].attemptsAtCall, 1, 'retry — attempts 1');
      assert.equal(calls[1].statusAtCall, 'running', 'retry идёт с элементом running');
      // Штатный фазовый промпт: comment/sameSession не подмешаны (AC1)
      assert.equal(calls[1].opts.comment, undefined, 'retry без комментария');
      assert.equal(calls[1].opts.sameSession, undefined, 'retry без переопределения sameSession');

      // Счётчики attempts/max_retries не сломаны: 2 попытки (max_retries default 1) → failed
      const final = loadAutoQueue(dir);
      const item = final.tasks.find((t) => t.id === 'VL-7');
      assert.equal(item.attempts, 2, 'attempts = попыток (0→1→2), без сбросов/переполнений');
      assert.equal(item.status, 'failed', 'вторая ошибка при max_retries=1 → failed');
      assert.equal(final.max_retries ?? 1, 1, 'max_retries не изменён');
    } finally {
      setStartPhaseForTests(null); // isolate:false — шов обязан сброситься
      stopAutoPoll();
    }
  });

  it('retryResumeArgs: сессия есть → --resume; нет/jsonl нет/чужой cwd → [] (VL-200)', () => {
    // 1) полный комплект (meta+jsonl, cwd совпадает) → ['--resume', sid]
    const ok = freshDir('vl200-args-ok');
    makeBacklog(ok);
    createTaskFile(ok, { id: 'VL-7', title: 'Задача' });
    makeSession(ok, 'agent-test1');
    assert.deepEqual(retryResumeArgs(ok, 'VL-7', 'spec'), ['--resume', 'agent-test1']);

    // 2) каталога сессий нет → []
    const empty = freshDir('vl200-args-empty');
    mkdirSync(join(empty, 'backlog', 'tasks'), { recursive: true });
    assert.deepEqual(retryResumeArgs(empty, 'VL-7', 'spec'), [], 'нет сессий → []');

    // 3) meta без jsonl → [] (resume бессилен, лучше новая сессия)
    const noJsonl = freshDir('vl200-args-nojsonl');
    makeBacklog(noJsonl);
    createTaskFile(noJsonl, { id: 'VL-7', title: 'Задача' });
    makeSession(noJsonl, 'agent-test2', { jsonl: false });
    assert.deepEqual(retryResumeArgs(noJsonl, 'VL-7', 'spec'), [], 'meta без jsonl → []');

    // 4) meta.cwd — чужой каталог (VL-98) → []
    const foreign = freshDir('vl200-args-foreign');
    makeBacklog(foreign);
    createTaskFile(foreign, { id: 'VL-7', title: 'Задача' });
    const other = mkdtempSync(join(tmpdir(), 'vibelog-vl200-other-'));
    try {
      makeSession(foreign, 'agent-test3', { cwd: other });
      assert.deepEqual(retryResumeArgs(foreign, 'VL-7', 'spec'), [], 'чужой meta.cwd → []');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }

    // 5) фаза не совпала (сессия code, запрос spec) → []
    const wrongPhase = freshDir('vl200-args-phase');
    makeBacklog(wrongPhase);
    createTaskFile(wrongPhase, { id: 'VL-7', title: 'Задача' });
    makeSession(wrongPhase, 'agent-test4', { phase: 'code' });
    assert.deepEqual(retryResumeArgs(wrongPhase, 'VL-7', 'spec'), [], 'другая фаза → []');
  });

  it('интеграция: реальный спавн retry получает --resume, промпт идентичен (VL-200, AC1)', async () => {
    const dir = freshDir('vl200-spawn');
    makeBacklog(dir);
    createTaskFile(dir, { id: 'VL-8', title: 'Задача интеграционного retry' });
    makeSession(dir, 'agent-vl200', { taskId: 'VL-8' });
    saveAutoQueue(dir, {
      running: true,
      tasks: [{ id: 'VL-8', status: 'pending', added_at: 'T', attempts: 0 }],
    });

    // Стуб qwen: ДОПИСЫВАЕТ argv каждой попытки строкой и падает с exit 1
    const stub = join(dir, 'qwen-stub.cjs');
    const marker = join(dir, 'spawn-marker.jsonl');
    writeFileSync(
      stub,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.VL28_STUB_MARKER, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.writeSync(1, 'stub qwen\\n');
process.exit(1);
`,
      'utf-8'
    );
    chmodSync(stub, 0o755);

    // env-база спавнов (паттерн VL-140): process.env минус VIBELOG_CWD/PHASE_*,
    // иначе тест унаследует окружение хоста и мета/сессии уйдут не туда
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'VIBELOG_CWD' || k === 'VIBELOG_PHASE_TASK_ID' || k === 'VIBELOG_PHASE_NAME') continue;
      if (k === 'VIBELOG_AGENT_BIN' || k.startsWith('VL28_STUB_')) continue;
      env[k] = v;
    }
    env.VIBELOG_QWEN_BIN = stub;
    env.VL28_STUB_MARKER = marker;
    setSpawnEnvBaseForTests(env);

    try {
      autoTick(fakeBot, dir);
      const lines = () =>
        existsSync(marker)
          ? readFileSync(marker, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
          : [];
      await waitFor(() => lines().length >= 2, 8000, 'два спавна (попытка + retry)');

      const runs = lines();
      assert.equal(runs.length, 2, 'ровно два спавна');
      assert.ok(!runs[0].includes('--resume'), 'первая попытка без --resume');
      const ri = runs[1].indexOf('--resume');
      assert.ok(ri >= 0, `retry-spawn без --resume: ${JSON.stringify(runs[1])}`);
      assert.equal(runs[1][ri + 1], 'agent-vl200', '--resume со sessionId сессии фазы');
      // VL-196: retry-промпт идентичен первому, кроме «Последний комментарий» —
      // туда finalize дописал причину провала (чтобы агент видел, что упало)
      const stripLast = (p) => p.replace(/Последний комментарий: [^\n]*/g, 'Последний комментарий: <…>');
      assert.equal(
        stripLast(runs[1][0]),
        stripLast(runs[0][0]),
        'промпт retry идентичен первому — штатный фазовый (AC1)'
      );
      assert.match(runs[1][0], /Фаза spec не удалась/, 'retry видит причину предыдущего провала (VL-196)');

      // Терминал: 2 ошибки при max_retries=1 → failed; третьего спавна нет
      await waitFor(
        () => loadAutoQueue(dir).tasks.find((t) => t.id === 'VL-8')?.status === 'failed',
        4000,
        'статус failed'
      );
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(lines().length, 2, 'третьего спавна после failed не было');
      const item = loadAutoQueue(dir).tasks.find((t) => t.id === 'VL-8');
      assert.equal(item.attempts, 2, 'attempts=2 при max_retries=1');
    } finally {
      setSpawnEnvBaseForTests(null); // шов — в прод-режим (isolate:false)
      stopAutoPoll();
    }
  }, 15000);
});
