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
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_WORKFLOW } from '../../dist/core/workflow.js';
import {
  autoQueuePath,
  loadAutoQueue,
  saveAutoQueue,
  addQueueTasks,
} from '../../dist/core/auto-queue.js';
import {
  pickAutoPhase,
  nextFailureAction,
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
});
