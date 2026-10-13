/**
 * Тесты VL-144 — rejectTask (оркестратор): разделение механики и LLM.
 *
 * - Никогда не бывшая в Code задача → синхронный механический путь
 *   ({ rejected: true }), спавна нет, файл сразу в completed/.
 * - Несуществующая задача → { error }.
 * - Бывшая в Code → запуск фазы reject (спавн заглушки qwen), механика
 *   (статус Rejected + архив) применяется в onExit завершения фазы.
 *
 * Заглушка qwen — node-скрипт в /tmp (внешние рантаймы запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rejectTask, getRun, setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import { handleApi } from '../../dist/web/api.js';
import { createTaskFile, updateTaskFile, getTask } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-reject-test-'));
const backlogDir = join(testRoot, 'backlog');
const tasksDir = join(backlogDir, 'tasks');
const completedDir = join(backlogDir, 'completed');
const stubBin = join(testRoot, 'qwen-stub.cjs');

/** Заглушка qwen: сразу завершается с кодом 0. */
const STUB = `#!/usr/bin/env node
fs = require('node:fs');
fs.writeSync(1, 'stub reject phase\\n');
process.exit(0);
`;

/** Ожидание завершения фазы (close приходит асинхронно). */
async function waitDone(taskId, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const run = getRun(taskId);
    if (run && !run.running) return run;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`waitDone: таймаут для ${taskId}`);
}

describe('rejectTask (VL-144)', () => {
  beforeAll(() => {
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(completedDir, { recursive: true });
    writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
      project_name: 'Reject Orchestration',
      task_prefix: 'vo',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected'],
      definition_of_done: [],
    }), 'utf-8');
    writeFileSync(stubBin, STUB, 'utf-8');
    chmodSync(stubBin, 0o755);
    // Явная env-база спавнов (VL-140): заглушка вместо настоящего qwen
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'VIBELOG_CWD' || k === 'VIBELOG_PHASE_TASK_ID' || k === 'VIBELOG_PHASE_NAME') continue;
      if (k === 'VIBELOG_AGENT_BIN' || k.startsWith('VL28_STUB_')) continue;
      env[k] = v;
    }
    env.VIBELOG_QWEN_BIN = stubBin;
    setSpawnEnvBaseForTests(env);
  });

  afterAll(() => {
    setSpawnEnvBaseForTests(null);
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('never-in-Code: синхронная механика, без спавна, файл в completed/', () => {
    const task = createTaskFile(testRoot, { title: 'Не в Code', status: 'To Do' });
    const result = rejectTask(testRoot, task.id, 'причина');
    assert.ok('rejected' in result, `ожидался механический путь, получено: ${JSON.stringify(result)}`);
    assert.equal(result.task.status, 'Rejected');
    assert.equal(getRun(task.id), null, 'спавна не было — getRun пуст');
    assert.equal(readdirSync(tasksDir).filter(f => f.includes(task.id)).length, 0, 'ушёл из tasks/');
    const done = readdirSync(completedDir).filter(f => f.includes(task.id));
    assert.equal(done.length, 1, 'в completed/');
    const content = readFileSync(join(completedDir, done[0]), 'utf-8');
    assert.ok(content.includes('Rejected'), 'статус в файле');
    assert.ok(content.includes('причина'), 'комментарий в файле');
  });

  it('never-in-Code без комментария — тоже синхронная механика', () => {
    const task = createTaskFile(testRoot, { title: 'Без комментария', status: 'Spec' });
    const result = rejectTask(testRoot, task.id);
    assert.ok('rejected' in result, 'механический путь');
    assert.equal(result.task.status, 'Rejected');
  });

  it('несуществующая задача → { error }, ничего не архивируется', () => {
    const result = rejectTask(testRoot, 'vo-999');
    assert.ok('error' in result, 'ошибка');
    assert.match(result.error, /не найдена/);
  });

  it('бывшая в Code: запуск фазы reject, механика в onExit (status+архив)', async () => {
    // In Progress — wasInCode true → LLM-путь
    const task = createTaskFile(testRoot, { title: 'Была в Code', status: 'In Progress' });
    let exitCalled = false;
    const result = rejectTask(testRoot, task.id, 'передумали', {
      onExit: () => { exitCalled = true; },
    });
    assert.ok('started' in result, `ожидался запуск LLM-фазы: ${JSON.stringify(result)}`);
    assert.ok(result.pid > 0, 'pid заглушки');
    // До завершения фазы задача ещё в tasks/ (механика — в onExit)
    assert.ok(existsSync(join(tasksDir)) && readdirSync(tasksDir).some(f => f.includes(task.id)),
      'файл в tasks/ пока фаза не завершилась');

    const run = await waitDone(task.id);
    assert.equal(exitCalled, true, 'onExit вызван');
    assert.equal(run.phase, 'reject');
    // Механика применена в onExit ДО пользовательского колбэка
    assert.equal(readdirSync(tasksDir).filter(f => f.includes(task.id)).length, 0, 'ушёл из tasks/');
    const done = readdirSync(completedDir).filter(f => f.includes(task.id));
    assert.equal(done.length, 1, 'в completed/');
    const content = readFileSync(join(completedDir, done[0]), 'utf-8');
    assert.ok(content.includes('Rejected'), 'статус Rejected');
    assert.ok(content.includes('передумали'), 'комментарий');
  });

  it('бывшая в Code + guard: фаза уже выполняется → { error }, без архива', async () => {
    const task = createTaskFile(testRoot, { title: 'Двойной reject', status: 'Review' });
    // Первый запуск — фаза идёт (заглушка быстрая, но guard ещё держится
    // до close): второй вызов в этот же тик обязан упереться в guard
    const first = rejectTask(testRoot, task.id);
    assert.ok('started' in first, 'первый запуск стартует');
    const second = rejectTask(testRoot, task.id);
    assert.ok('error' in second, `второй — guard: ${JSON.stringify(second)}`);
    assert.match(second.error, /уже выполняется/);
    await waitDone(task.id);
    // После завершения механика всё же применилась (onExit первого запуска)
    assert.equal(readdirSync(tasksDir).filter(f => f.includes(task.id)).length, 0);
  });

  it('handleApi: POST /api/tasks/:id/reject — 200 (механика) и 404', () => {
    const task = createTaskFile(testRoot, { title: 'API reject', status: 'To Do' });
    const ok = handleApi('POST', `/api/tasks/${task.id}/reject`, { comment: 'из API' }, testRoot);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, { rejected: true });
    const missing = handleApi('POST', '/api/tasks/vo-999/reject', null, testRoot);
    assert.equal(missing.status, 404);
  });
});
