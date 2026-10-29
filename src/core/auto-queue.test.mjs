/**
 * Тесты VL-191 — автоочередь .vibelog/auto-queue.json:
 * load/save и персистентность (AC1), add-дедуп, выбор следующей задачи
 * (только pending, зависимости Done, priority High→Medium→Low, FIFO — AC2),
 * sweep терминальных статусов.
 *
 * Каталоги — в /tmp: findBacklogDir поднимается по дереву, в tmp нет
 * случайного backlog (в противном случае тесты цепляли бы чужие задачи).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { createTaskFile, updateTaskFile } from '../../dist/core/store.js';
import {
  autoQueuePath,
  loadAutoQueue,
  saveAutoQueue,
  addQueueTasks,
  setQueueRunning,
  updateQueueTask,
  removeQueueTask,
  sweepQueue,
  pickNextQueueTask,
  formatAutoQueue,
} from '../../dist/core/auto-queue.js';

/** Читает сырой JSON файла очереди (для проверки полей AC1). */
function rawQueue(dir) {
  return JSON.parse(readFileSync(autoQueuePath(dir), 'utf-8'));
}

describe('auto-queue (VL-191)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-auto-queue-'));
  /** Проект с backlog/tasks + config.yml (prefix VL). */
  const proj = join(testRoot, 'proj');

  /**
   * Новый чистый проект в /tmp: backlog/tasks + config.yml (prefix VL).
   * findBacklogDir поднимается по дереву — каждый тест берёт свой проект,
   * чтобы createTaskFile не цеплял чужой backlog и ID начинались с VL-1.
   */
  function newProj(name) {
    const dir = join(testRoot, name);
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(dir, 'backlog', 'config.yml'),
      stringifyYaml({
        project_name: 'Test',
        task_prefix: 'VL',
        default_status: 'To Do',
        statuses: ['To Do', 'Spec', 'Planned', 'Review', 'Done', 'Rejected'],
        definition_of_done: [],
      }),
      'utf-8'
    );
    return dir;
  }

  beforeAll(() => {
    mkdirSync(join(proj, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(
      join(proj, 'backlog', 'config.yml'),
      stringifyYaml({
        project_name: 'Test',
        task_prefix: 'VL',
        default_status: 'To Do',
        statuses: ['To Do', 'Spec', 'Planned', 'Review', 'Done', 'Rejected'],
        definition_of_done: [],
      }),
      'utf-8'
    );
  });

  afterAll(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  // ── AC1: формат и персистентность ──

  it('autoQueuePath → .vibelog/auto-queue.json', () => {
    assert.equal(autoQueuePath('/proj'), join('/proj', '.vibelog', 'auto-queue.json'));
  });

  it('нет файла / битый JSON / массив → дефолт остановленной очереди', () => {
    const empty = join(testRoot, 'empty');
    assert.deepEqual(loadAutoQueue(empty), { running: false, tasks: [] });
    mkdirSync(join(empty, '.vibelog'), { recursive: true });
    writeFileSync(autoQueuePath(empty), '{битый', 'utf-8');
    assert.deepEqual(loadAutoQueue(empty), { running: false, tasks: [] });
    writeFileSync(autoQueuePath(empty), '[1,2]', 'utf-8');
    assert.deepEqual(loadAutoQueue(empty), { running: false, tasks: [] });
  });

  it('save → load roundtrip: running и tasks (id, status, added_at, started_at) переживают рестарт (AC1)', () => {
    const dir = join(testRoot, 'persist');
    saveAutoQueue(dir, {
      running: true,
      tasks: [
        { id: 'VL-1', status: 'running', added_at: '2026-10-26T00:00:00.000Z', started_at: '2026-10-26T01:00:00.000Z' },
        { id: 'VL-2', status: 'pending', added_at: '2026-10-26T00:00:01.000Z' },
      ],
    });
    // «Рестарт» — просто новое чтение файла новым вызовом
    const loaded = loadAutoQueue(dir);
    assert.equal(loaded.running, true);
    assert.equal(loaded.tasks.length, 2);
    assert.deepEqual(
      { ...loaded.tasks[0] },
      { id: 'VL-1', status: 'running', added_at: '2026-10-26T00:00:00.000Z', started_at: '2026-10-26T01:00:00.000Z' }
    );
    assert.equal(loaded.tasks[1].status, 'pending');
    // Поля AC1 фиксируются в сыром файле
    const raw = rawQueue(dir);
    assert.equal(raw.running, true);
    assert.deepEqual(Object.keys(raw.tasks[0]).sort(), ['added_at', 'id', 'started_at', 'status']);
  });

  it('битые элементы отбрасываются, max_retries нормализуется', () => {
    const dir = join(testRoot, 'normalize');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      autoQueuePath(dir),
      JSON.stringify({
        running: 'yes',
        max_retries: -3,
        tasks: [{ id: 'VL-1', status: 'pending', added_at: 'x' }, { id: 42 }, null, { id: 'VL-2', status: 'wut', added_at: 'x' }],
      }),
      'utf-8'
    );
    const q = loadAutoQueue(dir);
    assert.equal(q.running, false, 'running не-bool → false');
    assert.equal(q.max_retries, 1, 'битый max_retries → default 1');
    assert.deepEqual(q.tasks.map((t) => t.id), ['VL-1'], 'валидные элементы прошли');
  });

  // ── add: дедуп и реанимация ──

  it('addQueueTasks: новые добавляются pending; повторно в очереди → skip; done/failed → сброс в pending', () => {
    const dir = join(testRoot, 'add');
    const r1 = addQueueTasks(dir, ['VL-1', 'VL-2']);
    assert.deepEqual(r1.added, ['VL-1', 'VL-2']);
    assert.deepEqual(r1.skipped, []);
    const r2 = addQueueTasks(dir, ['VL-2', 'VL-3']);
    assert.deepEqual(r2.added, ['VL-3']);
    assert.deepEqual(r2.skipped, ['VL-2'], 'pending → skip (уже в очереди)');
    // done → пере-add реанимирует
    updateQueueTask(dir, 'VL-1', { status: 'done' });
    const r3 = addQueueTasks(dir, ['VL-1']);
    assert.deepEqual(r3.added, ['VL-1']);
    const q = loadAutoQueue(dir);
    assert.equal(q.tasks.find((t) => t.id === 'VL-1').status, 'pending');
    assert.equal(q.tasks.find((t) => t.id === 'VL-1').attempts, 0);
  });

  it('setQueueRunning / updateQueueTask / removeQueueTask', () => {
    const dir = join(testRoot, 'mutate');
    addQueueTasks(dir, ['VL-1']);
    setQueueRunning(dir, true);
    assert.equal(loadAutoQueue(dir).running, true);
    setQueueRunning(dir, false);
    assert.equal(loadAutoQueue(dir).running, false);
    updateQueueTask(dir, 'VL-1', { status: 'running', started_at: 'T' });
    assert.equal(loadAutoQueue(dir).tasks[0].started_at, 'T');
    updateQueueTask(dir, 'VL-MISSING', { status: 'failed' }); // no-op, не падает
    removeQueueTask(dir, 'VL-1');
    assert.equal(loadAutoQueue(dir).tasks.length, 0);
  });

  // ── sweep ──

  it('sweepQueue: удалённая → failed, Done → done, Rejected → failed; терминальные в очереди не трогаются', () => {
    const dir = newProj('sweep');
    createTaskFile(dir, { title: 'Готовая', status: 'Done' }); // VL-1
    createTaskFile(dir, { title: 'Отклонённая', status: 'Rejected' }); // VL-2
    createTaskFile(dir, { title: 'Живая', status: 'To Do' }); // VL-3
    addQueueTasks(dir, ['VL-1', 'VL-2', 'VL-3', 'VL-999']);
    updateQueueTask(dir, 'VL-1', { status: 'done' }); // терминальный не перезаписывается
    const q = loadAutoQueue(dir);
    const changed = sweepQueue(dir, q);
    assert.equal(changed, true);
    const byId = Object.fromEntries(q.tasks.map((t) => [t.id, t.status]));
    assert.equal(byId['VL-1'], 'done');
    assert.equal(byId['VL-2'], 'failed', 'Rejected → failed');
    assert.equal(byId['VL-3'], 'pending', 'живая задача не тронута');
    assert.equal(byId['VL-999'], 'failed', 'удалённая → failed');
    // Повторный sweep — без изменений (идемпотентность)
    assert.equal(sweepQueue(dir, q), false);
  });

  // ── AC2: выбор следующей ──

  it('pickNext: только pending (running/done/failed пропускаются)', () => {
    const dir = newProj('pick-pending');
    createTaskFile(dir, { title: 'A', priority: 'High' }); // VL-1
    createTaskFile(dir, { title: 'B', priority: 'Low' }); // VL-2
    addQueueTasks(dir, ['VL-1', 'VL-2']);
    updateQueueTask(dir, 'VL-1', { status: 'running' });
    const q = loadAutoQueue(dir);
    assert.equal(pickNextQueueTask(dir, q).id, 'VL-2', 'running не выбирается');
    updateQueueTask(dir, 'VL-2', { status: 'failed' });
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)), null, 'нет pending → null');
  });

  it('pickNext: несуществующая задача и терминальный статус → не выбираются', () => {
    const dir = newProj('pick-missing');
    createTaskFile(dir, { title: 'Готово', status: 'Done' }); // VL-1
    addQueueTasks(dir, ['VL-1', 'VL-404']);
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)), null);
  });

  it('pickNext: зависимости не Done → «пока пропустить» (элемент остаётся pending)', () => {
    const dir = newProj('pick-deps');
    createTaskFile(dir, { title: 'Блокер' }); // VL-1
    createTaskFile(dir, { title: 'Зависит', dependencies: ['VL-1'] }); // VL-2
    addQueueTasks(dir, ['VL-2']);
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)), null, 'зависимость не Done → skip');
    updateTaskFile(dir, 'VL-1', { status: 'Done' });
    const picked = pickNextQueueTask(dir, loadAutoQueue(dir));
    assert.equal(picked?.id, 'VL-2', 'зависимость Done → задача доступна');
    assert.equal(loadAutoQueue(dir).tasks[0].status, 'pending', 'skip не помечал failed');
  });

  it('pickNext: сортировка High → Medium → Low, внутри приоритета FIFO по added_at (AC2)', () => {
    const dir = newProj('pick-sort');
    createTaskFile(dir, { title: 'Низкий', priority: 'Low' }); // VL-1
    createTaskFile(dir, { title: 'Средний', priority: 'Medium' }); // VL-2
    createTaskFile(dir, { title: 'Высокий первый', priority: 'High' }); // VL-3
    createTaskFile(dir, { title: 'Высокий второй', priority: 'High' }); // VL-4
    // Добавляем вперемешанном порядке: VL-2, VL-4, VL-1, VL-3 —
    // added_at монотонен (nextIsoDate), поэтому FIFO High: VL-4 → VL-3
    addQueueTasks(dir, ['VL-2', 'VL-4', 'VL-1', 'VL-3']);
    const q = loadAutoQueue(dir);
    assert.equal(pickNextQueueTask(dir, q).id, 'VL-4', 'первый High по FIFO (добавлен раньше)');
    updateQueueTask(dir, 'VL-4', { status: 'done' });
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)).id, 'VL-3', 'второй High по FIFO');
    updateQueueTask(dir, 'VL-3', { status: 'done' });
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)).id, 'VL-2', 'потом Medium');
    updateQueueTask(dir, 'VL-2', { status: 'done' });
    assert.equal(pickNextQueueTask(dir, loadAutoQueue(dir)).id, 'VL-1', 'потом Low');
  });

  // ── VL-228: failed_permanent (исчерпанные ретраи) ──

  it('VL-228 load: failed_permanent c fail_reason сохраняется, битый fail_reason отбрасывается', () => {
    const dir = join(testRoot, 'vl228-load');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(
      autoQueuePath(dir),
      JSON.stringify({
        running: true,
        max_retries: 1,
        tasks: [
          { id: 'VL-1', status: 'failed_permanent', added_at: 'T', attempts: 2, fail_reason: 'упало' },
          { id: 'VL-2', status: 'failed_permanent', added_at: 'T', fail_reason: 42 },
        ],
      }),
      'utf-8'
    );
    const q = loadAutoQueue(dir);
    assert.deepEqual(q.tasks.map((t) => t.id), ['VL-1', 'VL-2'], 'failed_permanent не отбрасывается при загрузке');
    assert.equal(q.tasks[0].fail_reason, 'упало');
    assert.equal(q.tasks[1].fail_reason, undefined, 'не-строковый fail_reason отброшен, элемент жив');
  });

  it('VL-228 add: failed_permanent не реанимируется (AC2 — /auto add не перетирает)', () => {
    const dir = join(testRoot, 'vl228-add');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    saveAutoQueue(dir, {
      running: false,
      max_retries: 1,
      tasks: [{ id: 'VL-1', status: 'failed_permanent', added_at: 'T', attempts: 2, fail_reason: 'упало' }],
    });
    const res = addQueueTasks(dir, ['VL-1']);
    assert.deepEqual(res.added, []);
    assert.deepEqual(res.skipped, ['VL-1'], 'failed_permanent → skip');
    const item = loadAutoQueue(dir).tasks.find((t) => t.id === 'VL-1');
    assert.equal(item.status, 'failed_permanent', 'статус не тронут');
    assert.equal(item.fail_reason, 'упало', 'причина сохранена');
    assert.equal(item.attempts, 2, 'счётчик попыток не сброшен');
    // Ручной обход: remove → add создаёт элемент заново с attempts=0
    removeQueueTask(dir, 'VL-1');
    const again = addQueueTasks(dir, ['VL-1']);
    assert.deepEqual(again.added, ['VL-1']);
    assert.equal(loadAutoQueue(dir).tasks[0].attempts, 0);
  });

  it('VL-228 sweep: застрявший failed с attempts > max_retries → failed_permanent + причина; идемпотентно', () => {
    const dir = newProj('vl228-sweep');
    createTaskFile(dir, { title: 'Живая' }); // VL-1
    saveAutoQueue(dir, {
      running: false,
      max_retries: 1,
      tasks: [
        { id: 'VL-1', status: 'failed', added_at: 'T', attempts: 2 },
        { id: 'VL-2', status: 'failed', added_at: 'T', attempts: 1 },
        { id: 'VL-3', status: 'failed_permanent', added_at: 'T', attempts: 2, fail_reason: 'прежняя' },
        { id: 'VL-4', status: 'done', added_at: 'T', attempts: 5 },
      ],
    });
    const q = loadAutoQueue(dir);
    assert.equal(sweepQueue(dir, q), true);
    const byId = Object.fromEntries(q.tasks.map((t) => [t.id, t]));
    assert.equal(byId['VL-1'].status, 'failed_permanent', 'attempts 2 > max 1 → failed_permanent');
    assert.match(byId['VL-1'].fail_reason, /ретраи исчерпаны \(attempts=2 > max_retries=1\)/);
    assert.equal(byId['VL-2'].status, 'failed', 'attempts 1 ≤ max 1 → ещё не терминален');
    assert.equal(byId['VL-3'].status, 'failed_permanent');
    assert.equal(byId['VL-3'].fail_reason, 'прежняя', 'причина не перезаписана');
    assert.equal(byId['VL-4'].status, 'done', 'done не тронут');
    assert.equal(sweepQueue(dir, q), false, 'повторный sweep идемпотентен');
  });

  it('VL-228 pickNext: failed_permanent не выбирается, соседний pending — выбирается', () => {
    const dir = newProj('vl228-pick');
    createTaskFile(dir, { title: 'Терминальная', priority: 'High' }); // VL-1
    createTaskFile(dir, { title: 'Живая', priority: 'Low' }); // VL-2
    saveAutoQueue(dir, {
      running: false,
      max_retries: 1,
      tasks: [
        { id: 'VL-1', status: 'failed_permanent', added_at: 'T1', attempts: 2, fail_reason: 'упало' },
        { id: 'VL-2', status: 'pending', added_at: 'T2', attempts: 0 },
      ],
    });
    const picked = pickNextQueueTask(dir, loadAutoQueue(dir));
    assert.equal(picked?.id, 'VL-2', 'failed_permanent не выбирается даже с High');
  });

  it('VL-228 formatAutoQueue: строка failed_permanent содержит причину', () => {
    const text = formatAutoQueue({
      running: false,
      max_retries: 1,
      tasks: [{ id: 'VL-9', status: 'failed_permanent', added_at: 'T', fail_reason: 'код выхода 1' }],
    });
    assert.match(text, /VL-9 — failed_permanent, причина: код выхода 1/);
  });

  // ── формат /auto status ──

  it('formatAutoQueue: пустая и непустая', () => {
    assert.match(formatAutoQueue({ running: false, tasks: [] }), /остановлена/);
    assert.match(formatAutoQueue({ running: false, tasks: [] }), /Очередь пуста/);
    const text = formatAutoQueue({
      running: true,
      max_retries: 2,
      tasks: [{ id: 'VL-5', status: 'pending', added_at: 'T1' }],
    });
    assert.match(text, /запущена/);
    assert.match(text, /retries: 2/);
    assert.match(text, /VL-5 — pending \(добавлена T1\)/);
  });
});
