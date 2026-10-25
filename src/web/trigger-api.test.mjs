/**
 * Тесты VL-172 — POST /api/tasks/:id/trigger с полем comment.
 *
 * Контракт (аналог commitComment бота, VL-60):
 * - comment непустой → addComment в задачу ДО запуска, extraVars {{comment}}
 *   в промпте (marker-argv заглушки содержит текст);
 * - фаза comment без комментария → 400, запуска нет;
 * - trigger без comment → 202, новых комментариев нет (регрессия VL-28);
 * - несуществующая задача → 404.
 *
 * Заглушка qwen — node-скрипт (внешние рантаймы запрещены), паттерн
 * reject-task.test.mjs / orchestrator.test.mjs: setSpawnEnvBaseForTests.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { getRun, setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import { createTaskFile, getTask } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-trigger-api-'));
const backlogDir = join(testRoot, 'backlog');
const stubBin = join(testRoot, 'qwen-stub.cjs');
const marker = join(testRoot, 'marker.txt');

/** Заглушка qwen: пишет argv (позиционный промпт) в маркер, сразу выходит. */
const STUB = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.VL28_STUB_MARKER) {
  fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify(process.argv.slice(2)));
}
fs.writeSync(1, 'stub qwen\\n');
process.exit(0);
`;

/** Чтение argv запуска из маркера (промпт — позиционный аргумент). */
function readPromptArgv() {
  return JSON.parse(readFileSync(marker, 'utf-8'));
}

/** Ожидание завершения фазы (спавн асинхронен). */
async function waitDone(taskId, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const run = getRun(taskId);
    if (run && !run.running) return run;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`waitDone: таймаут для ${taskId}`);
}

describe('POST /api/tasks/:id/trigger + comment (VL-172)', () => {
  beforeAll(() => {
    mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
    writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
      project_name: 'Trigger Comment Test',
      task_prefix: 'tc',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done'],
      definition_of_done: [],
      labels: [],
      priorities: ['High', 'Medium', 'Low'],
      types: ['bug', 'feature', 'task'],
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
    env.VL28_STUB_MARKER = marker;
    setSpawnEnvBaseForTests(env);
  });

  afterAll(() => {
    setSpawnEnvBaseForTests(null);
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('comment + фаза plan → 202, комментарий в файле и в {{comment}} промпта', async () => {
    const task = createTaskFile(testRoot, { title: 'С комментарием', status: 'Spec' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, {
      phase: 'plan',
      comment: 'учти риски',
    }, testRoot);
    assert.equal(res.status, 202, JSON.stringify(res.body));

    // Комментарий записан ДО запуска (порядок commitComment)
    const fresh = getTask(testRoot, task.id);
    assert.equal(fresh.comments.length, 1);
    assert.equal(fresh.comments[0].text, 'учти риски');

    // {{comment}} подставлен в позиционный промпт заглушки
    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0);
    const argv = readPromptArgv();
    const prompt = argv.join(' ');
    assert.ok(prompt.includes('учти риски'), `промпт не содержит comment: ${prompt.slice(0, 200)}`);
    assert.ok(!prompt.includes('{{comment}}'), 'литеральный {{comment}} остался в промпте');
  });

  it('comment + фаза close → комментарий в файле до старта (taskLastComment)', async () => {
    const task = createTaskFile(testRoot, { title: 'Close с комментом', status: 'Review' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, {
      phase: 'close',
      comment: 'закрываем по ревью',
    }, testRoot);
    assert.equal(res.status, 202, JSON.stringify(res.body));

    const fresh = getTask(testRoot, task.id);
    assert.equal(fresh.comments.length, 1);

    // close-шаблон не имеет {{comment}}, но {{taskLastComment}} читает
    // taskExtraVars ПОСЛЕ addComment — в промпте уже новый комментарий
    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0);
    const prompt = readPromptArgv().join(' ');
    assert.ok(prompt.includes('закрываем по ревью'), 'taskLastComment не подхватил комментарий');
  });

  it('фаза comment без комментария → 400, запуска нет', () => {
    const task = createTaskFile(testRoot, { title: 'Comment без текста', status: 'Spec' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'comment' }, testRoot);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Требуется комментарий/);
    assert.equal(getRun(task.id), null, 'спавна не было');
    assert.equal(getTask(testRoot, task.id).comments.length, 0, 'комментариев не добавлено');
  });

  it('trigger без comment → 202, комментариев не добавлено (регрессия VL-28)', async () => {
    const task = createTaskFile(testRoot, { title: 'Без комментария', status: 'Spec' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'plan' }, testRoot);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(getTask(testRoot, task.id).comments.length, 0);

    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0);
    // Без extraVars contract VL-80: литеральный {{comment}} + фолбэк-строка
    const prompt = readPromptArgv().join(' ');
    assert.ok(prompt.includes('{{comment}}'), 'ожидался литеральный {{comment}} (контракт VL-80)');
  });

  it('несуществующая задача → 404, ничего не пишется', () => {
    const res = handleApi('POST', '/api/tasks/tc-999/trigger', {
      phase: 'plan',
      comment: 'текст',
    }, testRoot);
    assert.equal(res.status, 404);
  });
});
