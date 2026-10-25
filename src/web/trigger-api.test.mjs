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
    // VL-180: и бинарь vb-агента — та же заглушка: тест default_agent=vb
    // должен спавнить заглушку, а не настоящий bin/vibelog-agent.mjs
    env.VIBELOG_AGENT_BIN = stubBin;
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

  it('default_agent vb в settings.json → запуск фазы агентом vb (VL-180)', async () => {
    // AC1: веб больше не хардкодит 'qwen' — триггер берёт агента из
    // настроек проекта (.vibelog/settings.json), как бот (resolveDefaultAgent)
    const settingsDir = join(testRoot, '.vibelog');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ default_agent: 'vb' }), 'utf-8');
    try {
      const task = createTaskFile(testRoot, { title: 'Агент из настроек', status: 'Spec' });
      const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'plan' }, testRoot);
      assert.equal(res.status, 202, JSON.stringify(res.body));
      const run = await waitDone(task.id);
      assert.equal(run.exitCode, 0, run.logTail ?? '');
      assert.equal(run.agent, 'vb', 'агент запуска — default_agent из settings.json');
      // Спавн шёл через VIBELOG_AGENT_BIN (заглушка): промпт записан в маркер
      const argv = readPromptArgv();
      assert.ok(argv.join(' ').length > 0, 'заглушка получила промпт');
    } finally {
      rmSync(join(settingsDir, 'settings.json'), { force: true });
    }
  });

  it('без settings.json → агент по умолчанию qwen (регрессия VL-180)', async () => {
    // Хронологический фолбэк resolveDefaultAgent: файла настроек нет → 'qwen'
    rmSync(join(testRoot, '.vibelog', 'settings.json'), { force: true });
    const task = createTaskFile(testRoot, { title: 'Дефолтный агент', status: 'Spec' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'plan' }, testRoot);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0, run.logTail ?? '');
    assert.equal(run.agent, 'qwen', 'без settings.json агент — qwen, как раньше');
  });
});


// ── VL-188: workflow-валидация trigger и PATCH-переходов ──

describe('VL-188 — workflow в API фаз и переходов', () => {
  // ПослеAll первого describe удалил testRoot — воссоздаём минимальный backlog
  beforeAll(() => {
    mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
    writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
      project_name: 'Trigger Workflow Test',
      task_prefix: 'tc',
      default_status: 'To Do',
      statuses: ['Backlog', 'To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done'],
      definition_of_done: [],
      labels: [],
      priorities: ['High', 'Medium', 'Low'],
      types: ['bug', 'feature', 'task'],
    }), 'utf-8');
  });

  it('trigger фазы из недопустимого статуса → 409 с текстом «недопустима из статуса»', () => {
    // To Do → plan не существует в default workflow (нужен Spec)
    const task = createTaskFile(testRoot, { title: 'Workflow: plan из To Do', status: 'To Do' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'plan' }, testRoot);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.match(res.body.error, /Фаза plan недопустима из статуса To Do/);
    // Фаза не выполнялась: статус остался To Do (агент по finish_phase сменил бы его)
    assert.equal(getTask(testRoot, task.id).status, 'To Do', 'статус не изменился');
  });

  it('trigger допустимой фазы из ветвления (To Do → spec) → 202', () => {
    const task = createTaskFile(testRoot, { title: 'Workflow: spec из To Do', status: 'To Do' });
    const res = handleApi('POST', `/api/tasks/${task.id}/trigger`, { phase: 'spec' }, testRoot);
    assert.equal(res.status, 202, JSON.stringify(res.body));
  });

  it('PATCH /api/tasks/:id: транзит → 200 + triggerPhase; без транзита → 400', () => {
    // To Do → Spec — транзит фазы spec → 200, triggerPhase=spec
    const task = createTaskFile(testRoot, { title: 'Workflow: PATCH транзит', status: 'To Do' });
    const ok = handleApi('PATCH', `/api/tasks/${task.id}`, { status: 'Spec' }, testRoot);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.triggerPhase, 'spec', 'перенос в Spec производит фазу spec');
    assert.equal(ok.body.status, 'Spec');

    // Spec → Done — транзита нет → 400, файл не изменился
    const bad = handleApi('PATCH', `/api/tasks/${task.id}`, { status: 'Done' }, testRoot);
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.match(bad.body.error, /Переход «Spec» → «Done» недоступен по workflow задачи/);
    assert.equal(getTask(testRoot, task.id).status, 'Spec', 'статус не изменился');
  });

  it('PATCH: ручной вход в initial_status (Backlog → To Do) → 200, triggerPhase=null', () => {
    const task = createTaskFile(testRoot, { title: 'Workflow: Backlog → To Do', status: 'Backlog' });
    const res = handleApi('PATCH', `/api/tasks/${task.id}`, { status: 'To Do' }, testRoot);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.triggerPhase, null, 'ручной переход без фазы');
    assert.equal(res.body.status, 'To Do');
  });

  it('PATCH: смена НЕ-статуса не проверяется workflow', () => {
    const task = createTaskFile(testRoot, { title: 'Workflow: патч названия', status: 'To Do' });
    const res = handleApi('PATCH', `/api/tasks/${task.id}`, { title: 'Новое название' }, testRoot);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.title, 'Новое название');
  });

  it('GET /api/tasks/:id и список содержат availablePhases (ветвление To Do → spec/reject)', () => {
    const task = createTaskFile(testRoot, { title: 'Workflow: availablePhases', status: 'To Do' });
    const one = handleApi('GET', `/api/tasks/${task.id}`, null, testRoot);
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.availablePhases, ['spec', 'reject'], 'ветвление default из To Do');
    assert.equal(one.body.startTo, null, 'To Do — initial, кнопки «взять в работу» нет');

    const list = handleApi('GET', '/api/tasks', null, testRoot);
    const found = list.body.find((t) => t.id === task.id);
    assert.ok(found, 'задача в списке');
    assert.deepEqual(found.availablePhases, ['spec', 'reject']);
  });

  it('GET /api/config содержит initialStatus из default workflow', () => {
    const res = handleApi('GET', '/api/config', null, testRoot);
    assert.equal(res.status, 200);
    assert.equal(res.body.initialStatus, 'To Do');
  });
});
