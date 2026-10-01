/**
 * Тесты VL-28 — оркестратор фаз Qwen Code.
 *
 * Проверяет:
 * - renderPrompt: подстановка {{taskId}}, ошибка при неизвестной фазе
 * - startPhase: спавн заглушки (VIBELOG_QWEN_BIN), double-trigger guard
 * - getRun: running → после завершения exitCode/logTail
 * - handleApi: POST trigger 404/409/202, GET trigger
 *
 * Заглушка qwen — node-скрипт в /tmp; каталоги тестов тоже в /tmp
 * (findBacklogDir поднимается вверх и внутри проекта находит настоящий backlog/).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderPrompt, startPhase, getRun } from '../../dist/web/orchestrator.js';
import { handleApi } from '../../dist/web/api.js';
import { createTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-test-'));
const backlogDir = join(testRoot, 'backlog');
const stubBin = join(testRoot, 'qwen-stub.cjs');

/** Заглушка qwen: пишет аргументы в маркер, можно спать и падать. */
const STUB = `#!/usr/bin/env node
// Заглушка qwen для тестов VL-28 (внешние рантаймы запрещены — только node).
const fs = require('node:fs');
if (process.env.VL28_STUB_MARKER) {
  fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify(process.argv.slice(2)));
}
fs.writeSync(1, 'stub qwen: ' + (process.argv[1] || '').slice(0, 40) + '\\n');
const sleep = Number(process.env.VL28_STUB_SLEEP || 0);
if (sleep > 0) {
  setTimeout(() => process.exit(Number(process.env.VL28_STUB_EXIT || 0)), sleep);
} else {
  process.exit(Number(process.env.VL28_STUB_EXIT || 0));
}
`;

/** Ожидание условия с дедлайном (close/error приходят асинхронно). */
async function waitDone(taskId, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const run = getRun(taskId);
    if (run && !run.running) return run;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`waitDone: таймаут для ${taskId}`);
}

describe('orchestrator (VL-28)', () => {
  const savedEnv = {};
  let task1; // для unit-тестов startPhase
  let task2; // для тестов handleApi

  before(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
    writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
      project_name: 'Orch Test',
      task_prefix: 'ot',
      default_status: 'To Do',
      statuses: ['Backlog', 'To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done'],
      definition_of_done: [],
    }), 'utf-8');
    writeFileSync(stubBin, STUB, 'utf-8');
    chmodSync(stubBin, 0o755);
    task1 = createTaskFile(testRoot, { title: 'Задача для фазы 1', status: 'Spec', priority: 'High' });
    task2 = createTaskFile(testRoot, { title: 'Задача для API-тестов', status: 'Backlog', priority: 'Low' });

    for (const key of ['VIBELOG_QWEN_BIN', 'VL28_STUB_MARKER', 'VL28_STUB_SLEEP', 'VL28_STUB_EXIT']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.VIBELOG_QWEN_BIN = stubBin;
  });

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('renderPrompt подставляет {{taskId}}', () => {
    const prompt = renderPrompt('spec', 'VL-42');
    assert.match(prompt, /VL-42/);
    assert.doesNotMatch(prompt, /\{\{taskId\}\}/);
    assert.match(prompt, /Фаза 1/);
  });

  it('renderPrompt отклоняет неизвестную фазу', () => {
    assert.throws(() => renderPrompt('deploy', 'VL-42'), /Неизвестная фаза/);
  });

  it('startPhase: спавн, double-trigger guard, getRun после завершения', async () => {
    const marker = join(testRoot, 'marker1.txt');
    process.env.VL28_STUB_MARKER = marker;
    // 1200мс: под полной нагрузкой параллельного прогона меньшая пауза
    // приводила к флаки — стаб завершался до проверки running === true
    process.env.VL28_STUB_SLEEP = '1200';
    process.env.VL28_STUB_EXIT = '0';

    const first = startPhase(testRoot, task1.id, 'spec');
    assert.equal(first.started, true);

    // Double-trigger, пока процесс жив — guard должен отказать
    const second = startPhase(testRoot, task1.id, 'spec');
    assert.match(second.error, /уже выполняется/);

    assert.equal(getRun(task1.id).running, true);

    const run = await waitDone(task1.id);
    assert.equal(run.exitCode, 0);
    assert.match(run.logTail, /stub qwen/);

    // Маркер: промпт содержал ID задачи и --approval-mode yolo
    const argv = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.ok(argv.includes('--approval-mode') && argv.includes('yolo'));
    assert.ok(argv.some(a => a.includes(task1.id)));
  });

  it('startPhase отклоняет неизвестную фазу', () => {
    const res = startPhase(testRoot, task1.id, 'deploy');
    assert.match(res.error, /Неизвестная фаза/);
  });

  it('handleApi: POST trigger 404/409/202 и GET trigger', async () => {
    // 404 — задачи нет
    const notFound = handleApi('POST', '/api/tasks/VL-999/trigger', { phase: 'spec' }, testRoot);
    assert.equal(notFound.status, 404);

    // 409 — неизвестная фаза (guard в orchestrator)
    const bad = handleApi('POST', `/api/tasks/${task2.id}/trigger`, { phase: 'deploy' }, testRoot);
    assert.equal(bad.status, 409);

    // GET без запусков — {running:false}
    const idle = handleApi('GET', `/api/tasks/${task2.id}/trigger`, null, testRoot);
    assert.equal(idle.status, 200);
    assert.deepEqual(idle.body, { running: false });

    // 202 — успешный запуск, затем завершение видно в GET
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker2.txt');
    process.env.VL28_STUB_SLEEP = '0';
    const started = handleApi('POST', `/api/tasks/${task2.id}/trigger`, { phase: 'spec' }, testRoot);
    assert.equal(started.status, 202);
    assert.equal(started.body.started, true);

    const run = await waitDone(task2.id);
    assert.equal(run.exitCode, 0);
  });

  it('битый bin: spawn-ошибка не крашит API, видна в logTail', async () => {
    process.env.VIBELOG_QWEN_BIN = join(testRoot, 'no-such-bin');
    // spawn асинхронен — API отвечает 202, ошибка уходит в лог
    const res = handleApi('POST', `/api/tasks/${task2.id}/trigger`, { phase: 'spec' }, testRoot);
    assert.equal(res.status, 202);

    const run = await waitDone(task2.id);
    assert.equal(run.exitCode, null);
    assert.match(run.logTail, /Ошибка запуска/);
  });
});
