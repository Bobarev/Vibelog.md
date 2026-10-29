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

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, chmodSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPrompt, startAnalyze, startPhase, startPrompt, startResume, startTaskPhase, getRun, setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import { handleApi } from '../../dist/web/api.js';
import { addComment, createTaskFile, getTask, updateTaskFile } from '../../dist/core/store.js';
import { ensureTaskWorktree } from '../../dist/core/worktree.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { agentSessionsDir, saveSessionMeta } from '../../dist/agent/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testRoot = mkTestRoot('vibelog-orch-test-');
const backlogDir = join(testRoot, 'backlog');
const stubBin = join(testRoot, 'qwen-stub.cjs');

/**
 * VL-188: permissive-workflow тестового проекта — ВСЕ workflow-фазы разрешены
 * из ВСЕХ статусов. Тесты этого файла проверяют механику спавна/гвардов/мет,
 * а не семантику переходов (она — в workflow.test.mjs и отдельных тестах ниже).
 */
function allowAllPhases(root) {
  const statuses = ['Backlog', 'To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked', 'Rejected'];
  const phases = ['spec', 'plan', 'code', 'do', 'close', 'reject'];
  const transitions = [];
  for (const status of statuses) {
    for (const phase of phases) transitions.push({ status, phase, produces_status: status });
  }
  mkdirSync(join(root, '.vibelog'), { recursive: true });
  const path = join(root, '.vibelog', 'settings.json');
  let cur = {};
  if (existsSync(path)) {
    try { cur = JSON.parse(readFileSync(path, 'utf-8')); } catch { cur = {}; }
  }
  cur.workflows = { default: { initial_status: 'To Do', transitions } };
  writeFileSync(path, JSON.stringify(cur, null, 2), 'utf-8');
}

/** Тестовый корень с permissive-workflow (VL-188). */
function mkTestRoot(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  allowAllPhases(root);
  return root;
}

/** Заглушка qwen: пишет аргументы в маркер, можно спать и падать. */
const STUB = `#!/usr/bin/env node
// Заглушка qwen для тестов VL-28 (внешние рантаймы запрещены — только node).
const fs = require('node:fs');
if (process.env.VL28_STUB_MARKER) {
  fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify(process.argv.slice(2)));
}
fs.writeSync(1, 'stub qwen: ' + (process.argv[1] || '').slice(0, 40) + '\\n');
// VL-64: если задан — печатаем JSON-строку type=result (как real qwen).
// VL-63 (reopen): VL28_STUB_RACE=1 симулирует гонку потоков — JSON пишется
// в два куска, между которыми stderr уходит Warning: строка stderr
// вклинивается в середину JSON-строки stdout (старый общий буфер ломал парсер).
if (process.env.VL28_STUB_RESULT) {
  const json = process.env.VL28_STUB_RESULT;
  if (process.env.VL28_STUB_RACE) {
    const half = Math.floor(json.length / 2);
    fs.writeSync(1, json.slice(0, half));
    fs.writeSync(2, 'Warning: interleaved stderr\\n');
    fs.writeSync(1, json.slice(half) + '\\n');
  } else {
    fs.writeSync(1, json + '\\n');
  }
}
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

// ── VL-140: явные env-объекты вместо глобальных process.env-мутаций ──
//
// Накопленные патчи стабов: тесты полагались на персистентность env внутри
// файла (один тест ставит SLEEP, следующий — только MARKER), поэтому
// состояние копится между вызовами setStubEnv, как раньше в process.env.
let stubEnv = {};

/**
 * Собирает явный env-базу спавнов оркестратора и передаёт в тестовый шов
 * setSpawnEnvBaseForTests (VL-140). База — process.env MINUS ключи, которые
 * не должны утекать в стаб-спавны: VL-125-гвард (VIBELOG_CWD/VIBELOG_PHASE_*)
 * и VIBELOG_AGENT_BIN/VL28_STUB_* (иначе внешний прогон внутри фазы даёт
 * ложные падения — инциденты VL-117/VL-125). patch с undefined — удаление.
 */
function setStubEnv(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete stubEnv[k];
    else stubEnv[k] = v;
  }
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'VIBELOG_CWD' || k === 'VIBELOG_PHASE_TASK_ID' || k === 'VIBELOG_PHASE_NAME') continue;
    if (k === 'VIBELOG_AGENT_BIN' || k.startsWith('VL28_STUB_')) continue;
    env[k] = v;
  }
  env.VIBELOG_QWEN_BIN = stubBin;
  Object.assign(env, stubEnv);
  setSpawnEnvBaseForTests(env);
}

/** Чтение текущего значения патча (заменяет process.env.X в assert-ах). */
function stubEnvGet(key) {
  if (key in stubEnv) return stubEnv[key];
  if (key === 'VIBELOG_QWEN_BIN') return stubBin;
  return process.env[key];
}

/** Сброс накопленных патчей к дефолту (конец тестов с кастомными bin/LLM). */
function resetStubEnv() {
  stubEnv = {};
  setStubEnv({});
}

describe('orchestrator (VL-28)', () => {
  let task1; // для unit-тестов startPhase
  let task2; // для тестов handleApi

  beforeAll(() => {
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
    allowAllPhases(testRoot);
    chmodSync(stubBin, 0o755);
    task1 = createTaskFile(testRoot, { title: 'Задача для фазы 1', status: 'Spec', priority: 'High' });
    task2 = createTaskFile(testRoot, { title: 'Задача для API-тестов', status: 'Backlog', priority: 'Low' });

    // VL-140: env фазы оркестратора собирается явно (setStubEnv) — глобальные
    // process.env-мутации убраны ради fileParallelism. VL-125-гвард встроен
    // в setStubEnv: VIBELOG_QWEN_BIN/VL28_STUB_*/VIBELOG_PHASE_*/VIBELOG_CWD
    // из внешнего окружения не попадают в стаб-спавны (инциденты VL-117/VL-125)
    resetStubEnv();
  });

  afterAll(() => {
    // Тестовый шов — в null (прод-режим process.env) после набора тестов
    setSpawnEnvBaseForTests(null);
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

  it('renderPrompt фазы close подставляет {{taskId}} (VL-55)', () => {
    const prompt = renderPrompt('close', 'VL-55');
    assert.match(prompt, /VL-55/);
    assert.doesNotMatch(prompt, /\{\{taskId\}\}/);
    assert.match(prompt, /Фаза Close/);
  });

  it('renderPrompt фазы comment подставляет {{taskId}} и {{comment}} (VL-60)', () => {
    // Без extraVars {{comment}} остаётся — web-trigger без текста запроса
    // закрыт фолбэком шаблона (последний комментарий задачи через MCP)
    const prompt = renderPrompt('comment', 'VL-60');
    assert.match(prompt, /VL-60/);
    assert.doesNotMatch(prompt, /\{\{taskId\}\}/);
    assert.match(prompt, /Фаза Comment/);
    assert.match(prompt, /\{\{comment\}\}/);

    const withComment = renderPrompt('comment', 'VL-60', { comment: 'тест-запрос' });
    assert.match(withComment, /тест-запрос/);
    assert.doesNotMatch(withComment, /\{\{comment\}\}/);
  });

  it('renderPrompt plan/code подставляет {{comment}} из extraVars (VL-80)', () => {
    const plan = renderPrompt('plan', 'VL-80', { comment: 'учти риски' });
    assert.match(plan, /учти риски/);
    assert.doesNotMatch(plan, /\{\{comment\}\}/);

    const code = renderPrompt('code', 'VL-80', { comment: 'делай по плану' });
    assert.match(code, /делай по плану/);
    assert.doesNotMatch(code, /\{\{comment\}\}/);
  });

  it('renderPrompt plan/code без extraVars сохраняет литеральный {{comment}} (VL-80)', () => {
    // Контракт фолбэка шаблона (web-trigger без extraVars, как у comment-фазы):
    // строка-заглушка просит агента продолжать без комментария
    const plan = renderPrompt('plan', 'VL-80');
    assert.match(plan, /\{\{comment\}\}/);
    const code = renderPrompt('code', 'VL-80');
    assert.match(code, /\{\{comment\}\}/);
  });

  it('startPhase: спавн, double-trigger guard, getRun после завершения', async () => {
    const marker = join(testRoot, 'marker1.txt');
    setStubEnv({ VL28_STUB_MARKER: marker, });
    // 1200мс: под полной нагрузкой параллельного прогона меньшая пауза
    // приводила к флаки — стаб завершался до проверки running === true
    setStubEnv({ VL28_STUB_SLEEP: '1200', VL28_STUB_EXIT: '0', });

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

  it('startPhase: onExit-колбэк — один раз, с exitCode и logTail (VL-48)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-vl48.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    const calls = [];
    const res = startPhase(testRoot, task1.id, 'spec', (run) => calls.push(run));
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    // finish() зовёт колбэк синхронно; пауза — страховка от гонки
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].running, false);
    assert.equal(calls[0].exitCode, run.exitCode);
    assert.match(calls[0].logTail ?? '', /stub qwen/);
  });

  it('startPhase: extraVars попадают в промпт (VL-60)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-vl60.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    const res = startPhase(testRoot, task1.id, 'comment', undefined, {
      comment: 'тест-запрос-vl60',
    });
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.exitCode, 0);
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    // argv[0] — позиционный промпт: содержит текст комментария, {{comment}} подставлен
    assert.ok(argv.some((a) => a.includes('тест-запрос-vl60')));
    assert.ok(argv.some((a) => !a.includes('{{comment}}')));
  });

  it('startPhase: run.result заполнен из JSON type=result (VL-64)', async () => {
    setStubEnv({
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 42411,
      duration_api_ms: 42369,
      num_turns: 1,
      result: 'понг',
      usage: {
        input_tokens: 10956,
        output_tokens: 19,
        cache_read_input_tokens: 10944,
        total_tokens: 10975,
      },
      session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    }),
    });
    const calls = [];
    const res = startPhase(testRoot, task1.id, 'spec', (run) => calls.push(run));
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    await new Promise((r) => setTimeout(r, 50));
    // Основной контракт: парсер нашёл result-строку в логе
    assert.equal(run.result?.result, 'понг');
    assert.equal(run.result?.session_id, 'a470c7dd-2ca8-4510-9d81-b184f932af76');
    assert.equal(run.result?.usage.total_tokens, 10975);
    assert.equal(run.result?.num_turns, 1);
    // onExit-колбэк получает тот же run с result (VL-65 — бот читает его)
    assert.equal(calls.length, 1);
    assert.equal(calls[0].result?.result, 'понг');
  });
  it('startPhase: run.result из строки-массива [{…}] (json-адаптер qwen 0.24.x)', async () => {
    setStubEnv({ VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    // Реальный stdout qwen 0.24.x при --output-format json: одна строка —
    // JSON-массив всех сообщений сессии, result последним элементом
    setStubEnv({
      VL28_STUB_RESULT: JSON.stringify([
      { type: 'system', subtype: 'init', session_id: 'arr-1' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'понг' }] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 1000,
        duration_api_ms: 900,
        num_turns: 1,
        result: 'понг-из-массива',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, total_tokens: 15 },
        session_id: 'arr-1',
      },
    ]),
    });
    const res = startPhase(testRoot, task1.id, 'comment');
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.result?.result, 'понг-из-массива');
    assert.equal(run.result?.session_id, 'arr-1');
    assert.equal(run.result?.usage.total_tokens, 15);
  });

  it('startPhase: result парсится, хотя stderr вклинился в JSON-строку stdout (VL-63 reopen)', async () => {
    setStubEnv({
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RACE: '1',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 900,
      num_turns: 1,
      result: 'понг-сквозь-шум',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, total_tokens: 15 },
      session_id: 'race-1',
    }),
    });
    const res = startPhase(testRoot, task1.id, 'comment');
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    // Стаб пишет JSON в два куска, между которыми stderr уходит Warning —
    // при раздельных буферах stdout/stderr парсер не видит этот шум
    assert.equal(run.result?.result, 'понг-сквозь-шум');
    assert.equal(run.result?.session_id, 'race-1');
    // stderr попадает в logTail (фолбэк бота), но не ломает result
    assert.match(run.logTail ?? '', /Warning: interleaved stderr/);
    setStubEnv({ VL28_STUB_RACE: undefined });
  });

  // ── VL-66/67: startPrompt — произвольный запрос через qwen без задачи ──

  it('renderPrompt фазы prompt подставляет {{prompt}}, {{taskId}} отсутствует (VL-67)', () => {
    const prompt = renderPrompt('prompt', '', { prompt: 'сделай коммиты' });
    assert.match(prompt, /сделай коммиты/);
    assert.doesNotMatch(prompt, /\{\{prompt\}\}/);
    assert.doesNotMatch(prompt, /\{\{taskId\}\}/);
    assert.match(prompt, /команда prompt/);
  });

  it('startPrompt: спавн, getRun("prompt"), result из JSON type=result (VL-67)', async () => {
    setStubEnv({
      VL28_STUB_MARKER: join(testRoot, 'marker-prompt.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 900,
      num_turns: 1,
      result: 'коммиты сделаны',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, total_tokens: 15 },
      session_id: 'prompt-1',
    }),
    });
    const res = startPrompt(testRoot, 'сделай коммиты для файлов');
    assert.equal(res.started, true);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
    assert.equal(run.result?.result, 'коммиты сделаны');
    assert.equal(run.phase, 'prompt');
    // VL-93: агент по умолчанию qwen — рендер session_id без префикса vb:
    assert.equal(run.agent, 'qwen');
    // Маркер: промпт — позиционный аргумент, запрос подставлен
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.ok(argv.some((a) => a.includes('сделай коммиты для файлов')));
    assert.ok(argv.every((a) => !a.includes('{{prompt}}')));
    // Для prompt флагов нет (как у comment) — не spec/plan
    assert.ok(!argv.includes('--allowed-mcp-server-names'));
  });

  it('startPrompt: double-trigger guard по ключу "prompt" (VL-67)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-prompt2.txt'), VL28_STUB_SLEEP: '1200', VL28_STUB_EXIT: '0', });
    const first = startPrompt(testRoot, 'первый запрос');
    assert.equal(first.started, true);
    const second = startPrompt(testRoot, 'второй запрос');
    assert.match(second.error, /уже выполняется/);
    assert.equal(getRun('prompt').running, true);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
  });

  it('startPrompt: agent=vb спавнит VIBELOG_AGENT_BIN (VL-92)', async () => {
    // VIBELOG_QWEN_BIN указывает на заведомо несуществующий путь: если бы
    // выбор бинаря игнорировал агента, spawn упал бы и маркер не создался
    setStubEnv({
      VIBELOG_QWEN_BIN: join(testRoot, 'no-such-qwen-bin'),
      VIBELOG_AGENT_BIN: stubBin,
      VL28_STUB_MARKER: join(testRoot, 'marker-vb.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'от-встроенного-агента',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-1',
    }),
    });
    const res = startPrompt(testRoot, 'запрос к агенту', undefined, 'vb');
    assert.equal(res.started, true);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'от-встроенного-агента');
    // VL-93: run.agent пробрасывается — рендер session_id получает vb:
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.ok(argv.some((a) => a.includes('запрос к агенту')));
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
  });

  it('startPhase: agent=vb спавнит VIBELOG_AGENT_BIN (VL-94)', async () => {
    // Выбор бинаря через параметр startPhase: VIBELOG_QWEN_BIN на заведомо
    // несуществующий путь — если бы агент игнорировался, spawn упал бы
    setStubEnv({
      VIBELOG_QWEN_BIN: join(testRoot, 'no-such-qwen-bin'),
      VIBELOG_AGENT_BIN: stubBin,
      VL28_STUB_MARKER: join(testRoot, 'marker-phase-vb.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'фаза-от-агента',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-phase-1',
    }),
    });
    const res = startPhase(testRoot, task1.id, 'spec', undefined, undefined, 'vb');
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'фаза-от-агента');
    // VL-93/94: run.agent пробрасывается и для фаз (рендер session_id vb:)
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.ok(argv.some((a) => a.includes(task1.id)));
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
  });

  it('startPhase: agent=vb получает --max-wall-time/--max-requests из settings.json (VL-104)', async () => {
    setStubEnv({
      VIBELOG_AGENT_BIN: stubBin,
      VL28_STUB_MARKER: join(testRoot, 'marker-limits-vb.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'фаза-с-лимитами',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-limits-1',
    }),
    });
    // settings.json с лимитами + выключенным компакшном — оркестратор прокидывает
    // все флага (только vb): --no-compact появляется только при явном off (VL-122)
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], max_wall_time: 1800, max_requests: 50, compact: false }), 'utf-8');
    allowAllPhases(testRoot);
    try {
      const res = startPhase(testRoot, task1.id, 'code', undefined, undefined, 'vb');
      assert.equal(res.started, true);
      const run = await waitDone(task1.id);
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const iWall = argv.indexOf('--max-wall-time');
      const iReq = argv.indexOf('--max-requests');
      assert.ok(iWall !== -1 && argv[iWall + 1] === '1800', 'нет --max-wall-time 1800: ' + JSON.stringify(argv));
      assert.ok(iReq !== -1 && argv[iReq + 1] === '50', 'нет --max-requests 50: ' + JSON.stringify(argv));
      assert.ok(argv.includes('--no-compact'), 'нет --no-compact при compact: false: ' + JSON.stringify(argv));
    } finally {
      rmSync(join(testRoot, '.vibelog', 'settings.json'), { force: true });
      allowAllPhases(testRoot);
    }
    // Без settings.json флаги не передаются — поведение прежнее
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-limits-none.txt'), });
    const res2 = startPhase(testRoot, task1.id, 'code', undefined, undefined, 'vb');
    assert.equal(res2.started, true);
    const run2 = await waitDone(task1.id);
    assert.equal(run2.exitCode, 0);
    const argv2 = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.ok(!argv2.includes('--max-wall-time'), 'неожиданный --max-wall-time: ' + JSON.stringify(argv2));
    assert.ok(!argv2.includes('--max-requests'), 'неожиданный --max-requests: ' + JSON.stringify(argv2));
    assert.ok(!argv2.includes('--no-compact'), 'неожиданный --no-compact (компакшн включён по умолчанию): ' + JSON.stringify(argv2));
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
  });

  it('startPrompt: guard общий для qwen и vb (VL-92)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-guard-vb.txt'), VL28_STUB_SLEEP: '1200', VL28_STUB_EXIT: '0', });
    // Активен qwen-промпт → /prompt:vb получает тот же guard-ответ
    const first = startPrompt(testRoot, 'запрос qwen');
    assert.equal(first.started, true);
    const second = startPrompt(testRoot, 'запрос vb', undefined, 'vb');
    assert.match(second.error, /уже выполняется/);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
  });

  // ── VL-93: startResume — продолжение сессии qwen по reply ──

  it('startResume: spawn с --resume <sessionId>, getRun("resume:<sessionId>"), agent qwen (VL-93)', async () => {
    setStubEnv({
      VIBELOG_QWEN_BIN: stubBin,
      VL28_STUB_MARKER: join(testRoot, 'marker-resume.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 700,
      duration_api_ms: 600,
      num_turns: 1,
      result: 'сессия-продолжена',
      usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1, total_tokens: 10 },
      session_id: 'resume-1',
    }),
    });
    const res = startResume(testRoot, '11111111-2222-3333-4444-555555555555', 'продолжай работу');
    assert.equal(res.started, true);
    // VL-145: resume без меты сессии живёт под ключом resume:<sessionId>
    const run = await waitDone('resume:11111111-2222-3333-4444-555555555555');
    assert.equal(run.exitCode, 0);
    assert.equal(run.phase, 'prompt');
    assert.equal(run.result?.result, 'сессия-продолжена');
    // Агент по умолчанию qwen — фолбэк рендера session_id без vb:
    assert.equal(run.agent, 'qwen');
    // Контракт argv: промпт, --resume <sessionId>, затем стандартные флаги
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.deepEqual(argv, [
      'продолжай работу',
      '--resume',
      '11111111-2222-3333-4444-555555555555',
      '--approval-mode',
      'yolo',
      '--output-format',
      'json',
    ]);
  });

  it('startResume: guard от двойного запуска, onExit один раз (VL-93/145)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-resume2.txt'), VL28_STUB_SLEEP: '1200', VL28_STUB_EXIT: '0', });
    let exitCalls = 0;
    let exitRunning = null;
    const first = startResume(
      testRoot,
      '22222222-3333-4444-5555-666666666666',
      'первый',
      (run) => {
        exitCalls += 1;
        exitRunning = run.running;
      }
    );
    assert.equal(first.started, true);
    // VL-145: дубль ТОЙ ЖЕ сессии (без меты) — guard, ключ resume:<sessionId>
    const second = startResume(testRoot, '22222222-3333-4444-5555-666666666666', 'второй');
    assert.match(second.error, /уже выполняется/);
    assert.equal(getRun('resume:22222222-3333-4444-5555-666666666666').running, true);
    // VL-145: ЧУЖАЯ сессия при живом первом — параллельна, без guard
    const other = startResume(testRoot, '33333333-4444-5555-6666-777777777777', 'параллельный');
    assert.equal(other.started, true, JSON.stringify(other));
    const run = await waitDone('resume:22222222-3333-4444-5555-666666666666');
    assert.equal(exitCalls, 1, 'onExit ровно один раз');
    assert.equal(exitRunning, false, 'onExit получает завершённый run');
    assert.equal(run.exitCode, 0);
    assert.equal(run.agent, 'qwen');
    // параллельный запуск тоже дорабатывает — не засоряем Map последующим тестам
    const otherRun = await waitDone('resume:33333333-4444-5555-6666-777777777777');
    assert.equal(otherRun.exitCode, 0);
  });

  // ── VL-145: параллельный запуск разных задач/сессий ──

  it('параллельные resume разных сессий без меты — оба стартуют (VL-145)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-vl145-a.txt'), VL28_STUB_SLEEP: '600', VL28_STUB_EXIT: '0', });
    const s1 = 'aaaa1111-2222-3333-4444-555555555555';
    const s2 = 'bbbb1111-2222-3333-4444-555555555555';
    const r1 = startResume(testRoot, s1, 'первый параллельный');
    const r2 = startResume(testRoot, s2, 'второй параллельный');
    assert.equal(r1.started, true, JSON.stringify(r1));
    assert.equal(r2.started, true, JSON.stringify(r2));
    const run1 = await waitDone(`resume:${s1}`);
    const run2 = await waitDone(`resume:${s2}`);
    assert.equal(run1.exitCode, 0);
    assert.equal(run2.exitCode, 0);
  });

  it('resume задачи не блокируется фазой другой задачи (VL-145)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-vl145-b.txt'), VL28_STUB_SLEEP: '600', VL28_STUB_EXIT: '0', });
    // Свежая задача — lastRuns теста не должен пересекаться с ключами
    // поздних handleApi-тестов (GET «запусков не было» ждёт пустого lastRuns)
    const taskB = createTaskFile(testRoot, { title: 'VL-145: resume-задача', status: 'To Do', priority: 'Low' });
    mkdirSync(join(testRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    // Мета резюмируемой сессии указывает на taskB — фаза живёт у task1
    writeFileSync(
      join(testRoot, '.vibelog', 'agent-sessions', 'agent-vl145-b.meta.json'),
      JSON.stringify({ taskId: taskB.id, phase: 'code', cwd: testRoot }),
      'utf-8'
    );
    const phase = startPhase(testRoot, task1.id, 'code');
    assert.equal(phase.started, true, JSON.stringify(phase));
    const resume = startResume(testRoot, 'agent-vl145-b', 'продолжи вторую');
    assert.equal(resume.started, true, JSON.stringify(resume));
    const runPhase = await waitDone(task1.id);
    const runResume = await waitDone(taskB.id);
    assert.equal(runPhase.exitCode, 0);
    assert.equal(runResume.exitCode, 0);
  });

  it('той же задачи — guard в обе стороны: фаза↔resume (VL-145)', async () => {
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker-vl145-c.txt'), VL28_STUB_SLEEP: '600', VL28_STUB_EXIT: '0', });
    mkdirSync(join(testRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    // Мета до ПЕРВОГО resume: без неё ключ был бы resume:<sessionId>
    // и guard не сработал бы (это и проверяем — задачный ключ общегуард)
    writeFileSync(
      join(testRoot, '.vibelog', 'agent-sessions', 'agent-vl145-c1.meta.json'),
      JSON.stringify({ taskId: task1.id, phase: 'code', cwd: testRoot }),
      'utf-8'
    );
    const hint = `(${task1.id.toUpperCase()})`;
    // 1) живая фаза задачи → resume той же задачи получает guard с её ID
    const phase = startPhase(testRoot, task1.id, 'code');
    assert.equal(phase.started, true, JSON.stringify(phase));
    const blocked = startResume(testRoot, 'agent-vl145-c1', 'resume при живой фазе');
    assert.match(blocked.error, /уже выполняется/);
    assert.ok(blocked.error.includes(hint), `подсказка с ID задачи: ${blocked.error}`);
    const runPhase = await waitDone(task1.id);
    assert.equal(runPhase.exitCode, 0);
    // 2) живой resume задачи → фаза той же задачи получает guard
    const live = startResume(testRoot, 'agent-vl145-c1', 'живой resume');
    assert.equal(live.started, true, JSON.stringify(live));
    const blockedPhase = startPhase(testRoot, task1.id, 'code');
    assert.match(blockedPhase.error, /уже выполняется/);
    assert.ok(blockedPhase.error.includes(hint), `подсказка с ID задачи: ${blockedPhase.error}`);
    const runResume = await waitDone(task1.id);
    assert.equal(runResume.exitCode, 0);
  });

  it('startResume: agent=vb спавнит VIBELOG_AGENT_BIN с --resume (VL-95)', async () => {
    // Выбор бинаря через параметр agent: VIBELOG_QWEN_BIN на заведомо
    // несуществующий путь — если бы агент игнорировался, spawn упал бы
    setStubEnv({
      VIBELOG_QWEN_BIN: join(testRoot, 'no-such-qwen-bin'),
      VIBELOG_AGENT_BIN: stubBin,
      VL28_STUB_MARKER: join(testRoot, 'marker-resume-vb.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'vb-сессия-продолжена',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-resume-1',
    }),
    });
    // Бот передаёт sessionId с префиксом vb: (extractSessionRef) — оркестратор
    // прокидывает его как есть, strip делает CLI агента (VL-95)
    const res = startResume(testRoot, 'vb:agent-1234567890', 'продолжи vb', undefined, 'vb');
    assert.equal(res.started, true);
    // VL-145: у vb-сессии без меты ключ resume:<sessionId> (vb: включается)
    const run = await waitDone('resume:vb:agent-1234567890');
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'vb-сессия-продолжена');
    // VL-95: run.agent пробрасывается и для resume-запусков vb
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
    assert.deepEqual(argv, [
      'продолжи vb',
      '--resume',
      'vb:agent-1234567890',
      '--approval-mode',
      'yolo',
      '--output-format',
      'json',
    ]);
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
  });

  it('startPhase отклоняет phase=prompt — только через startPrompt (VL-67)', () => {
    const res = startPhase(testRoot, task1.id, 'prompt');
    assert.match(res.error, /startPrompt/);
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
    setStubEnv({ VL28_STUB_MARKER: join(testRoot, 'marker2.txt'), VL28_STUB_SLEEP: '0', });
    const started = handleApi('POST', `/api/tasks/${task2.id}/trigger`, { phase: 'spec' }, testRoot);
    assert.equal(started.status, 202);
    assert.equal(started.body.started, true);

    const run = await waitDone(task2.id);
    assert.equal(run.exitCode, 0);
  });

  it('битый bin: spawn-ошибка не крашит API, видна в logTail', async () => {
    setStubEnv({ VIBELOG_QWEN_BIN: join(testRoot, 'no-such-bin'), });
    // spawn асинхронен — API отвечает 202, ошибка уходит в лог
    const res = handleApi('POST', `/api/tasks/${task2.id}/trigger`, { phase: 'spec' }, testRoot);
    assert.equal(res.status, 202);

    const run = await waitDone(task2.id);
    assert.equal(run.exitCode, null);
    assert.match(run.logTail, /Ошибка запуска/);
  });

  // ── VL-85: посевной тест интеграции — оркестратор спавнит vibelog-agent ──

  it('VIBELOG_QWEN_BIN=vibelog-agent: настоящий агент с мок-LM → JSON type=result (VL-85)', async () => {
    // Мок-LM: node:http на эфемерном порту, SSE-ответ с финальным текстом
    const llmServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Готово-из-агента' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cache_read_input_tokens: 2, total_tokens: 17 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));
    const llmPort = llmServer.address().port;

    const agentBin = join(__dirname, '..', '..', 'bin', 'vibelog-agent.mjs');
    setStubEnv({ VIBELOG_QWEN_BIN: agentBin, VIBELOG_LLM_BASE_URL: `http://127.0.0.1:${llmPort}/v1`, VIBELOG_LLM_API_KEY: 'test', VIBELOG_LLM_MODEL: 'test-model' });
    // MCP-сервер недоступен намеренно: агент обязан мягко деградировать
    // (предупреждение в stderr, фаза продолжается без MCP-инструментов)
    setStubEnv({ VIBELOG_BIN: join(testRoot, 'no-such-vibelog') });
    try {
      const res = startPhase(testRoot, task1.id, 'comment');
      assert.equal(res.started, true);
      const run = await waitDone(task1.id, 8000);
      assert.equal(run.exitCode, 0);
      assert.equal(run.result?.result, 'Готово-из-агента');
      assert.equal(run.result?.is_error, false);
      assert.equal(run.result?.usage.total_tokens, 17);
      assert.match(run.result?.session_id ?? '', /^agent-/);
      // stderr агента (диагностика + предупреждение MCP) виден в logTail,
      // но не ломает JSON-парсер stdout — контракт VL-63 выдержан
      assert.match(run.logTail ?? '', /MCP-инструменты недоступны/);
    } finally {
      // VL-140: патчи уходят в явный env-объект — сброс шва возвращает дефолт
      resetStubEnv();
      await new Promise((r) => llmServer.close(r));
    }
  });
  // ── VL-110: resume задачной сессии в worktree её задачи ──

  it('startResume: сессия задачи возобновляется в её worktree (VL-110)', async () => {
    // Отдельный git-корень: worktree требует git-репо с коммитом
    const wtRoot = mkTestRoot('vibelog-orch-wt-');
    const git = (args) => spawnSync('git', ['-C', wtRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(wtRoot, 'backlog'), { recursive: true });
    writeFileSync(join(wtRoot, 'backlog', 'config.yml'), 'project_name: WT Test\n', 'utf-8');
    mkdirSync(join(wtRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    writeFileSync(join(wtRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(wtRoot);
    const wtPath = join(wtRoot, '.vibelog', 'worktrees', 'vl-77');
    // VL-134: worktree создаётся впервые только на фазе plan — resume предсоздаёт
    // её явно, чтобы проверить семантику «работа в worktree при её наличии»
    ensureTaskWorktree(wtRoot, 'VL-77');
    // Мета сессии — как её пишет CLI задачной фазы (VL-110)
    writeFileSync(
      join(wtRoot, '.vibelog', 'agent-sessions', 'agent-999.meta.json'),
      JSON.stringify({ taskId: 'VL-77', phase: 'code', cwd: wtPath }),
      'utf-8'
    );
    // Своя заглушка: пишет argv, cwd процесса и VIBELOG_CWD
    const stubWt = join(wtRoot, 'wt-stub.cjs');
    writeFileSync(stubWt, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  envCwd: process.env.VIBELOG_CWD || null,',
      '}));',
      "fs.writeSync(1, 'stub wt\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stubWt, 0o755);
    setStubEnv({ VIBELOG_QWEN_BIN: stubWt, VL28_STUB_MARKER: join(wtRoot, 'marker-wt.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startResume(wtRoot, 'agent-999', 'продолжи работу');
      assert.equal(res.started, true, JSON.stringify(res));
      // VL-145: мета taskId VL-77 → ключ resume = задачный 'VL-77'
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      // Worktree создан; агент спавнен в нём; VIBELOG_CWD — главный репо
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree vl-77 должна быть создана');
      const marker = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      // realpathSync: macOS /var — симлинк на /private/var, process.cwd() физический
      assert.equal(marker.cwd, realpathSync(wtPath), 'агент должен работать в worktree задачи');
      assert.equal(marker.envCwd, wtRoot, 'VIBELOG_CWD — главный репозиторий');
      // Промпт дополнен примечанием режима веток (как у фаз задач)
      assert.ok(marker.argv[0].includes('Режим параллельной разработки'), marker.argv[0]);
      assert.ok(marker.argv[0].includes('vb/vl-77'), marker.argv[0]);
      assert.deepEqual(marker.argv.slice(1, 3), ['--resume', 'agent-999']);
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(wtRoot, { recursive: true, force: true });
    }
  });

  it('startResume: branch-mode выключен + сессия из worktree → предупреждение (VL-110)', async () => {
    const warnRoot = mkTestRoot('vibelog-orch-warn-');
    mkdirSync(join(warnRoot, 'backlog'), { recursive: true });
    writeFileSync(join(warnRoot, 'backlog', 'config.yml'), 'project_name: Warn Test\n', 'utf-8');
    mkdirSync(join(warnRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    // settings.json БЕЗ branch_mode — resume идёт в главном cwd
    writeFileSync(
      join(warnRoot, '.vibelog', 'agent-sessions', 'agent-888.meta.json'),
      JSON.stringify({ taskId: 'VL-77', phase: 'code', cwd: '/tmp/some-worktree' }),
      'utf-8'
    );
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, VL28_STUB_MARKER: join(warnRoot, 'marker-warn.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startResume(warnRoot, 'agent-888', 'продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      // VL-145: мета taskId есть (VL-77) — ключ задачный независимо от branch-mode
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(argv[0].includes('Внимание'), 'предупреждение о cwd-несовпадении: ' + argv[0]);
      assert.ok(argv[0].includes('branch-mode выключен'), argv[0]);
      assert.ok(argv[0].startsWith('продолжи'), 'исходный текст запроса сохраняется: ' + argv[0]);
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(warnRoot, { recursive: true, force: true });
    }
  });
  // ── VL-112: close-фаза задач с worktree ──

  it('startPhase: close с worktree — спавн в главном репо + merge-шаблон (VL-112)', async () => {
    const closeRoot = mkTestRoot('vibelog-orch-close-');
    mkdirSync(join(closeRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(closeRoot, 'backlog', 'config.yml'), 'project_name: Close WT\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(closeRoot, { id: 'VL-77', title: 'Задача close-worktree' });
    mkdirSync(join(closeRoot, '.vibelog'), { recursive: true });
    // branch_mode включён, worktree vl-77 существует (задача работала в ветке)
    writeFileSync(join(closeRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(closeRoot);
    mkdirSync(join(closeRoot, '.vibelog', 'worktrees', 'vl-77'), { recursive: true });
    // Своя заглушка: пишет argv и cwd процесса
    const stubClose = join(closeRoot, 'close-stub.cjs');
    writeFileSync(stubClose, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '}));',
      "fs.writeSync(1, 'stub close\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stubClose, 0o755);
    setStubEnv({ VIBELOG_QWEN_BIN: stubClose, VL28_STUB_MARKER: join(closeRoot, 'marker-close.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(closeRoot, 'VL-77', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const marker = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      // cwd — ГЛАВНЫЙ репо: close не спавнится в worktree даже при branch_mode
      assert.equal(marker.cwd, realpathSync(closeRoot), 'close должен работать в главном cwd');
      // Промпт — из phase-close-worktree.md, примечания веток нет
      assert.ok(marker.argv[0].includes('merge --no-ff'), 'close-worktree шаблон с merge-шагом');
      assert.ok(marker.argv[0].includes('vb/vl-77'), '{{branch}} подставлен');
      assert.ok(!marker.argv[0].includes('Режим параллельной разработки'), 'примечания worktree не должно быть');
      assert.equal(run.phase, 'close');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(closeRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: close без worktree — прежний шаблон, спавн в главном (VL-112)', async () => {
    const plainRoot = mkTestRoot('vibelog-orch-close0-');
    mkdirSync(join(plainRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(plainRoot, 'backlog', 'config.yml'), 'project_name: Close Plain\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(plainRoot, { id: 'VL-77', title: 'Задача close без worktree' });
    // branch_mode включён, но worktree vl-77 НЕТ
    mkdirSync(join(plainRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(plainRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(plainRoot);
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, VL28_STUB_MARKER: join(plainRoot, 'marker-close0.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(plainRoot, 'VL-77', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(!argv[0].includes('merge --no-ff'), 'без worktree — обычный шаблон close');
      assert.ok(!argv[0].includes('Режим параллельной разработки'), 'worktree не создавалась — примечания нет');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(plainRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: plan с branch_mode — спавн в worktree (регресс VL-112, VL-134)', async () => {
    // Регрессия: исключение close не должно задеть остальные фазы задач.
    // VL-134: первое создание worktree происходит на фазе plan (раньше была code)
    const codeRoot = mkTestRoot('vibelog-orch-code-');
    const git = (args) => spawnSync('git', ['-C', codeRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(codeRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(codeRoot, 'backlog', 'config.yml'), 'project_name: Code WT\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(codeRoot, { id: 'VL-88', title: 'Задача plan в worktree' });
    mkdirSync(join(codeRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(codeRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(codeRoot);
    const stubCode = join(codeRoot, 'code-stub.cjs');
    writeFileSync(stubCode, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '}));',
      "fs.writeSync(1, 'stub code\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stubCode, 0o755);
    setStubEnv({ VIBELOG_QWEN_BIN: stubCode, VL28_STUB_MARKER: join(codeRoot, 'marker-code.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(codeRoot, 'VL-88', 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const wtPath = join(codeRoot, '.vibelog', 'worktrees', 'vl-88');
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree vl-88 должна быть создана для plan');
      const marker = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(marker.cwd, realpathSync(wtPath), 'plan работает в worktree');
      assert.ok(marker.argv[0].includes('Режим параллельной разработки'), 'примечание веток присутствует');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(codeRoot, { recursive: true, force: true });
    }
  });
  // ── VL-114: задачный env оркестратора (мета сессии боевого пути) ──

  /** Заглушка агента, фиксирующая argv/cwd и задачный env в маркере. */
  const writeEnvStub = (dir, markerName) => {
    const stub = join(dir, markerName);
    writeFileSync(stub, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd(),',
      '  envPhaseTaskId: process.env.VIBELOG_PHASE_TASK_ID || null,',
      '  envPhaseName: process.env.VIBELOG_PHASE_NAME || null,',
      '  envCwd: process.env.VIBELOG_CWD || null,',
      '  envLlmKey: process.env.VIBELOG_LLM_API_KEY || null,',
      '}));',
      "fs.writeSync(1, 'stub env\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stub, 0o755);
    return stub;
  };

  it('startPhase: задачный env в spawnEnv (VL-114)', async () => {
    const envRoot = mkTestRoot('vibelog-orch-env-');
    mkdirSync(join(envRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Test\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(envRoot, { id: 'VL-88', title: 'Задача env-теста' });
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(envRoot, 'env-stub.cjs'), VL28_STUB_MARKER: join(envRoot, 'marker-env.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(envRoot, 'VL-88', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.envPhaseTaskId, 'VL-88', 'VIBELOG_PHASE_TASK_ID передаётся без worktree');
      assert.equal(m.envPhaseName, 'code', 'VIBELOG_PHASE_NAME = фаза');
      assert.equal(m.envCwd, null, 'без branch-mode VIBELOG_CWD не задаётся');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: VIBELOG_LLM_API_KEY из базы env попадает в процесс агента (VL-189)', async () => {
    // Общий для бота и браузера спавн (spawnQwenRun): LLM-env наследуется
    // из baseEnv — раньше браузер не грузил .env и ключ не долетал
    const envRoot = mkTestRoot('vibelog-orch-llmenv-');
    mkdirSync(join(envRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: LLM Env Test\n', 'utf-8');
    createTaskFile(envRoot, { id: 'VL-89', title: 'Задача LLM-env-теста' });
    setStubEnv({
      VIBELOG_QWEN_BIN: writeEnvStub(envRoot, 'llmenv-stub.cjs'),
      VL28_STUB_MARKER: join(envRoot, 'marker-llmenv.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VIBELOG_LLM_API_KEY: 'llm-from-base',
    });
    try {
      const res = startPhase(envRoot, 'VL-89', 'spec');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-89');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.envLlmKey, 'llm-from-base', 'VIBELOG_LLM_API_KEY наследуется spawn-ом (VL-189)');
    } finally {
      // Удаление патча обязательно: stubEnv персистентен между тестами файла
      setStubEnv({ VL28_STUB_MARKER: undefined, VIBELOG_LLM_API_KEY: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startPrompt: задачный env не передаётся (VL-114)', async () => {
    const envRoot = mkTestRoot('vibelog-orch-env0-');
    mkdirSync(join(envRoot, 'backlog'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Prompt\n', 'utf-8');
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(envRoot, 'env0-stub.cjs'), VL28_STUB_MARKER: join(envRoot, 'marker-env0.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPrompt(envRoot, 'привет');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('prompt');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.envPhaseTaskId, null, '/prompt не задачная фаза — env нет');
      assert.equal(m.envPhaseName, null);
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: close не получает задачный env (VL-112-гард, VL-114)', async () => {
    const envRoot = mkTestRoot('vibelog-orch-envc-');
    mkdirSync(join(envRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Close\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(envRoot, { id: 'VL-88', title: 'Задача close env-теста' });
    // VL-140: env через setStubEnv — спавн берёт базу из spawnEnvBaseOverride,
    // а не из process.env (мутации process.env в тесте уже не действуют)
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(envRoot, 'envc-stub.cjs'), VL28_STUB_MARKER: join(envRoot, 'marker-envc.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(envRoot, 'VL-88', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.envPhaseTaskId, null, 'close всегда в главном репо — env нет (VL-112)');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startResume с worktreeTaskId: env несёт taskId задачи (VL-114)', async () => {
    const wtRoot = mkTestRoot('vibelog-orch-wt2-');
    const git = (args) => spawnSync('git', ['-C', wtRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(wtRoot, 'backlog'), { recursive: true });
    writeFileSync(join(wtRoot, 'backlog', 'config.yml'), 'project_name: WT Env\n', 'utf-8');
    mkdirSync(join(wtRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    writeFileSync(join(wtRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(wtRoot);
    const wtPath = join(wtRoot, '.vibelog', 'worktrees', 'vl-77');
    // VL-134: resume идёт в worktree только если она уже есть — предсоздаём
    ensureTaskWorktree(wtRoot, 'VL-77');
    writeFileSync(
      join(wtRoot, '.vibelog', 'agent-sessions', 'agent-777.meta.json'),
      JSON.stringify({ taskId: 'VL-77', phase: 'code', cwd: wtPath }),
      'utf-8'
    );
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(wtRoot, 'wt2-stub.cjs'), VL28_STUB_MARKER: join(wtRoot, 'marker-wt2.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startResume(wtRoot, 'agent-777', 'продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      // VL-145: мета taskId VL-77 → ключ resume = задачный 'VL-77'
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.envPhaseTaskId, 'VL-77', 'resume с worktreeTaskId несёт taskId задачи');
      assert.equal(m.envPhaseName, 'prompt');
      assert.equal(m.envCwd, wtRoot, 'branch-mode: VIBELOG_CWD — главный репо');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(wtRoot, { recursive: true, force: true });
    }
  });

  it('E2E: оркестраторный спавн пишет meta.json сессии (VL-114)', async () => {
    // Настоящий агент + мок-LM (паттерн VL-85): доказывает, что боевой путь
    // спавна готовым промптом создаёт мету — дыра VL-110 закрыта end-to-end
    const llmServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Готово-E2E' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));
    const llmPort = llmServer.address().port;
    const agentBin = join(__dirname, '..', '..', 'bin', 'vibelog-agent.mjs');
    setStubEnv({ VIBELOG_QWEN_BIN: agentBin, VIBELOG_LLM_BASE_URL: `http://127.0.0.1:${llmPort}/v1`, VIBELOG_LLM_API_KEY: 'test', VIBELOG_LLM_MODEL: 'test-model', VIBELOG_BIN: join(testRoot, 'no-such-vibelog') });
    try {
      // VL-137: фаза не запускается без читаемой задачи — создаём ot-88 заранее
      createTaskFile(testRoot, { id: 'ot-88', title: 'Задача E2E-меты' });
      const res = startPhase(testRoot, 'ot-88', 'comment');
      assert.equal(res.started, true);
      const run = await waitDone('ot-88', 8000);
      assert.equal(run.exitCode, 0);
      assert.equal(run.result?.result, 'Готово-E2E');
      const sid = run.result?.session_id ?? '';
      assert.match(sid, /^agent-/);
      const metaPath = join(testRoot, '.vibelog', 'agent-sessions', `${sid}.meta.json`);
      assert.ok(existsSync(metaPath), `нет meta.json: ${metaPath}`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(meta.taskId, 'OT-88', 'боевой путь пишет taskId по префиксу конфига testRoot (ot)');
      assert.equal(meta.phase, 'comment');
      assert.equal(meta.cwd, realpathSync(testRoot));
    } finally {
      // VL-140: сброс шва — дефолтный env для последующих тестов файла
      resetStubEnv();
      await new Promise((r) => llmServer.close(r));
    }
  });
  it('branch-mode с task_prefix ot: worktree ot-5 и env OT-5 (VL-118)', async () => {
    // Регрессия хардкода VL: префикс задач проекта читается из конфига
    const otRoot = mkTestRoot('vibelog-orch-ot-');
    const git = (args) => spawnSync('git', ['-C', otRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(otRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(otRoot, 'backlog', 'config.yml'), 'project_name: OT Test\ntask_prefix: ot\n', 'utf-8');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(otRoot, { id: 'ot-5', title: 'Задача чужого префикса' });
    mkdirSync(join(otRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(otRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(otRoot);
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(otRoot, 'ot-stub.cjs'), VL28_STUB_MARKER: join(otRoot, 'marker-ot.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(otRoot, 'ot-5', 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('ot-5');
      assert.equal(run.exitCode, 0);
      const wtPath = join(otRoot, '.vibelog', 'worktrees', 'ot-5');
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree ot-5 создаётся при чужом префиксе');
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.cwd, realpathSync(wtPath), 'фаза работает в worktree ot-5');
      assert.equal(m.envPhaseTaskId, 'OT-5', 'env несёт id по префиксу конфига');
      assert.equal(m.envCwd, otRoot, 'VIBELOG_CWD — главный репо');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(otRoot, { recursive: true, force: true });
    }
  });

  // ── VL-134: worktree создаётся впервые только на фазе plan; для epic — никогда ──

  /** Минимальный git-проект с branch_mode: git init + backlog/config.yml + settings.json. */
  const makeBmRoot = (prefix) => {
    const root = mkTestRoot(prefix);
    const git = (args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-134 Test\n', 'utf-8');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(root);
    return root;
  };

  it('spec с branch_mode: worktree не создаётся, фаза идёт в главном cwd (VL-134)', async () => {
    const specRoot = makeBmRoot('vibelog-orch-vl134-spec-');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(specRoot, { id: 'VL-90', title: 'Задача spec-фазы' });
    // VL-140: env через setStubEnv (spawn идёт из spawnEnvBaseOverride, не process.env)
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(specRoot, 'vl134-spec-stub.cjs'), VL28_STUB_MARKER: join(specRoot, 'marker-vl134-spec.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(specRoot, 'VL-90', 'spec');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-90');
      assert.equal(run.exitCode, 0);
      assert.ok(!existsSync(join(specRoot, '.vibelog', 'worktrees', 'vl-90')), 'worktree не создаётся на spec');
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.cwd, realpathSync(specRoot), 'spec работает в главном cwd');
      assert.ok(!m.argv[0].includes('Режим параллельной разработки'), 'примечания веток в промпте нет');
      assert.equal(m.envCwd, null, 'VIBELOG_CWD не задаётся без worktree');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(specRoot, { recursive: true, force: true });
    }
  });

  it('plan для epic: worktree не создаётся, фаза идёт в главном cwd (VL-134)', async () => {
    const epicRoot = makeBmRoot('vibelog-orch-vl134-epic-');
    // Задача-эпик: type попадает в frontmatter и читается getTask
    const epic = createTaskFile(epicRoot, { title: 'Эпик VL-134', status: 'Planned', type: 'epic' });
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(epicRoot, 'vl134-epic-stub.cjs'), VL28_STUB_MARKER: join(epicRoot, 'marker-vl134-epic.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(epicRoot, epic.id, 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone(epic.id);
      assert.equal(run.exitCode, 0);
      assert.ok(!existsSync(join(epicRoot, '.vibelog', 'worktrees', epic.id.toLowerCase())), 'worktree не создаётся для epic');
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.cwd, realpathSync(epicRoot), 'plan эпика работает в главном cwd');
      assert.ok(!m.argv[0].includes('Режим параллельной разработки'), 'примечания веток в промпте нет');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(epicRoot, { recursive: true, force: true });
    }
  });

  it('code без worktree: не создаётся, фаза идёт в главном cwd (VL-134)', async () => {
    const codeRoot = makeBmRoot('vibelog-orch-vl134-code-');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(codeRoot, { id: 'VL-91', title: 'Задача code без worktree' });
    // VL-140: env через setStubEnv (spawn идёт из spawnEnvBaseOverride, не process.env)
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(codeRoot, 'vl134-code-stub.cjs'), VL28_STUB_MARKER: join(codeRoot, 'marker-vl134-code.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      // Задача переведена в code мимо Plan — без worktree фаза идёт в главный cwd
      const res = startPhase(codeRoot, 'VL-91', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-91');
      assert.equal(run.exitCode, 0);
      assert.ok(!existsSync(join(codeRoot, '.vibelog', 'worktrees', 'vl-91')), 'worktree не создаётся на code');
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.cwd, realpathSync(codeRoot), 'code работает в главном cwd');
      assert.ok(!m.argv[0].includes('Режим параллельной разработки'), 'примечания веток в промпте нет');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(codeRoot, { recursive: true, force: true });
    }
  });

  it('comment с уже созданной worktree: фаза идёт в worktree (VL-134)', async () => {
    const cmtRoot = makeBmRoot('vibelog-orch-vl134-cmt-');
    // VL-137: startPhase подставляет поля задачи и не запускает фазу без читаемой задачи
    createTaskFile(cmtRoot, { id: 'VL-92', title: 'Задача comment в worktree' });
    // Существующая worktree (задача дошла до Plan ранее) — comment работает в ней
    const wtPath = ensureTaskWorktree(cmtRoot, 'VL-92');
    setStubEnv({ VIBELOG_QWEN_BIN: writeEnvStub(cmtRoot, 'vl134-cmt-stub.cjs'), VL28_STUB_MARKER: join(cmtRoot, 'marker-vl134-cmt.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(cmtRoot, 'VL-92', 'comment');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-92');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.equal(m.cwd, realpathSync(wtPath), 'comment работает в существующей worktree');
      assert.ok(m.argv[0].includes('Режим параллельной разработки'), 'примечание веток присутствует');
      assert.equal(m.envCwd, cmtRoot, 'VIBELOG_CWD — главный репозиторий');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(cmtRoot, { recursive: true, force: true });
    }
  });

  // ── VL-137: подстановка полей задачи в первый промпт фазы ──

  it('startPhase: поля задачи подставляются в промпт, {{comment}}-контракт VL-80 цел (VL-137)', async () => {
    const subRoot = mkTestRoot('vibelog-orch-vl137-');
    mkdirSync(join(subRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(subRoot, 'backlog', 'config.yml'), 'project_name: VL-137 Sub\n', 'utf-8');
    createTaskFile(subRoot, {
      id: 'VL-500',
      title: 'Заголовок VL-500',
      description: 'Описание VL-500',
      status: 'Planned',
      acceptanceCriteria: [{ text: 'AC-1 VL-500', checked: true }],
      definitionOfDone: [{ text: 'DoD-1 VL-500', checked: false }],
    });
    addComment(subRoot, 'VL-500', 'Комментарий VL-500', '@user');
    // VL-140: env через setStubEnv (spawn идёт из spawnEnvBaseOverride, не process.env)
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, VL28_STUB_MARKER: join(subRoot, 'marker-vl137.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(subRoot, 'VL-500', 'plan', undefined, { comment: 'учти риски' });
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-500');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const prompt = argv.find((a) => a.includes('Задача (подставлена автоматически)'));
      assert.ok(prompt, 'промпт должен содержать блок подстановки');
      assert.ok(prompt.includes('Заголовок: Заголовок VL-500'), 'taskTitle подставлен');
      assert.ok(prompt.includes('Описание VL-500'), 'taskDescription подставлен');
      assert.ok(prompt.includes('1. [x] AC-1 VL-500'), 'taskAC нумерован и подставлен');
      assert.ok(prompt.includes('1. [ ] DoD-1 VL-500'), 'taskDoD подставлен');
      assert.ok(prompt.includes('Комментарий VL-500'), 'taskLastComment подставлен');
      assert.ok(prompt.includes('статус: Planned'), 'taskStatus подставлен');
      assert.ok(prompt.includes('учти риски'), 'контракт {{comment}} VL-80 сохранён');
      assert.ok(!prompt.includes('{{taskTitle}}'), 'неподставленного {{taskTitle}} не остаётся');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(subRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: epic-задача → в блоке «тип: epic» (VL-137)', async () => {
    const epicSubRoot = mkTestRoot('vibelog-orch-vl137-epic-');
    mkdirSync(join(epicSubRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(epicSubRoot, 'backlog', 'config.yml'), 'project_name: VL-137 Epic\n', 'utf-8');
    createTaskFile(epicSubRoot, { id: 'VL-501', title: 'Эпик VL-501', type: 'epic' });
    // VL-140: env через setStubEnv (spawn идёт из spawnEnvBaseOverride, не process.env)
    setStubEnv({ VIBELOG_QWEN_BIN: stubBin, VL28_STUB_MARKER: join(epicSubRoot, 'marker-vl137-epic.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(epicSubRoot, 'VL-501', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-501');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const prompt = argv.find((a) => a.includes('Задача (подставлена автоматически)'));
      assert.ok(prompt, 'промпт должен содержать блок подстановки');
      assert.ok(prompt.includes('тип: epic'), 'taskType подставлен как epic');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(epicSubRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: задача не найдена → error, фаза НЕ запускается (VL-137, решение Pavel)', () => {
    // Фолбэка «неподставленные {{...}} → прочитай через MCP» нет: если задача
    // не читается на уровне кода, промпт фазы запускаться не должен
    const res = startPhase(testRoot, 'ot-999', 'plan');
    assert.ok(res.error, 'должна вернуться ошибка: ' + JSON.stringify(res));
    assert.match(res.error, /не найдена/);
    assert.equal(res.started, undefined, 'фаза не должна стартовать');
  });

  it('startResume: задачная сессия получает компактный блок задачи (VL-137)', async () => {
    const rbRoot = mkTestRoot('vibelog-orch-vl137-resume-');
    const git = (args) => spawnSync('git', ['-C', rbRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(rbRoot, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(rbRoot, 'backlog', 'config.yml'), 'project_name: VL-137 Resume\n', 'utf-8');
    createTaskFile(rbRoot, { id: 'VL-78', title: 'Задача resume-блока', status: 'In Progress' });
    addComment(rbRoot, 'VL-78', 'Последний комментарий resume', '@user');
    mkdirSync(join(rbRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    writeFileSync(join(rbRoot, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], branch_mode: true }), 'utf-8');
    allowAllPhases(rbRoot);
    const wtPath = join(rbRoot, '.vibelog', 'worktrees', 'vl-78');
    ensureTaskWorktree(rbRoot, 'VL-78');
    writeFileSync(
      join(rbRoot, '.vibelog', 'agent-sessions', 'agent-778.meta.json'),
      JSON.stringify({ taskId: 'VL-78', phase: 'code', cwd: wtPath }),
      'utf-8'
    );
    const stubRb = join(rbRoot, 'rb-stub.cjs');
    writeFileSync(stubRb, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.VL28_STUB_MARKER, JSON.stringify(process.argv.slice(2)));',
      "fs.writeSync(1, 'stub resume\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stubRb, 0o755);
    // VL-140: env через setStubEnv (spawn идёт из spawnEnvBaseOverride, не process.env)
    setStubEnv({ VIBELOG_QWEN_BIN: stubRb, VL28_STUB_MARKER: join(rbRoot, 'marker-rb.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startResume(rbRoot, 'agent-778', 'продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      // VL-145: ключ resume = задачный ключ из меты сессии (здесь VL-78)
      const run = await waitDone('VL-78');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(argv[0].startsWith('продолжи'), 'исходный текст запроса сохраняется');
      assert.ok(argv[0].includes('Задача VL-78: Задача resume-блока'), 'компактный блок: ' + argv[0]);
      assert.ok(argv[0].includes('статус: In Progress'), 'статус в блоке');
      assert.ok(argv[0].includes('Последний комментарий resume'), 'последний комментарий в блоке');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(rbRoot, { recursive: true, force: true });
    }
  });

  // ── VL-141: startAnalyze — headless-разбор сессии агента без задачи ──

  /** Создаёт тестовую сессию vibelog-agent (+ meta) в указанном root. */
  function makeAgentSession(root, sessionId, meta) {
    const dir = join(root, '.vibelog', 'agent-sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      JSON.stringify({ role: 'user', content: 'привет' }) + '\n',
      'utf-8'
    );
    if (meta) {
      writeFileSync(join(dir, `${sessionId}.meta.json`), JSON.stringify(meta), 'utf-8');
    }
  }

  it('startAnalyze: спавн, промпт содержит sessionId/путь, без {{...}} (VL-141)', async () => {
    const anRoot = mkTestRoot('vibelog-orch-an-');
    mkdirSync(join(anRoot, 'backlog'), { recursive: true });
    writeFileSync(join(anRoot, 'backlog', 'config.yml'), 'project_name: An Test\n', 'utf-8');
    makeAgentSession(anRoot, 'agent-555', { taskId: '', phase: 'code', cwd: anRoot });
    setStubEnv({
      VL28_STUB_MARKER: join(anRoot, 'marker-an.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
        type: 'result', subtype: 'success', is_error: false,
        duration_ms: 800, duration_api_ms: 700, num_turns: 3,
        result: 'статистика готова',
        usage: { input_tokens: 9, output_tokens: 4, cache_read_input_tokens: 1, total_tokens: 13 },
        session_id: 'an-1',
      }),
    });
    try {
      // session-ref с префиксом vb: — как присылает бот
      const res = startAnalyze(anRoot, 'vb:agent-555');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('analyze-agent-555');
      assert.equal(run.exitCode, 0);
      assert.equal(run.phase, 'analyze');
      assert.equal(run.result?.result, 'статистика готова');
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const prompt = argv[0];
      assert.ok(prompt.includes('agent-555'), 'sessionId в промпте');
      assert.ok(prompt.includes('.vibelog/agent-sessions/agent-555.jsonl'), 'путь к jsonl в промпте');
      assert.ok(prompt.includes('протокол') || prompt.includes('статистик'), 'шаблон analyze подставлен');
      // Ни одной неподставленной подстановки {{...}}
      assert.doesNotMatch(prompt, /\{\{[a-zA-Z]+\}\}/, 'неподставленные {{...}} в промпте');
      // analyze — флаг vibelog-MCP для рекомендаций (VL-141)
      assert.ok(argv.includes('--allowed-mcp-server-names'), 'analyze получает vibelog-MCP');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(anRoot, { recursive: true, force: true });
    }
  });

  it('startAnalyze: необязательный comment → {{comment}} в промпте; без него — пустая строка (VL-169)', async () => {
    const anRoot = mkTestRoot('vibelog-orch-anc-');
    mkdirSync(join(anRoot, 'backlog'), { recursive: true });
    writeFileSync(join(anRoot, 'backlog', 'config.yml'), 'project_name: An Cmt\n', 'utf-8');
    makeAgentSession(anRoot, 'agent-777', { taskId: '', phase: 'code', cwd: anRoot });
    setStubEnv({
      VL28_STUB_MARKER: join(anRoot, 'marker-anc.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
    });
    try {
      // С комментарием — текст подставляется в промпт
      const res = startAnalyze(anRoot, 'vb:agent-777', undefined, 'qwen', 'сверь объём с AC');
      assert.equal(res.started, true, JSON.stringify(res));
      await waitDone('analyze-agent-777');
      let argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      let prompt = argv[0];
      assert.ok(prompt.includes('сверь объём с AC'), 'текст комментария в промпте');
      assert.doesNotMatch(prompt, /\{\{[a-zA-Z]+\}\}/, 'неподставленные {{...}} при комментарии');
      // Без комментария — подстановка пустая (не literal {{comment}})
      const res2 = startAnalyze(anRoot, 'vb:agent-777', undefined, 'qwen');
      assert.equal(res2.started, true, JSON.stringify(res2));
      await waitDone('analyze-agent-777');
      argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      prompt = argv[0];
      assert.ok(prompt.includes('Дополнительный комментарий пользователя к разбору:'), 'строка комментария в шаблоне');
      assert.doesNotMatch(prompt, /\{\{[a-zA-Z]+\}\}/, 'неподставленные {{...}} без комментария');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(anRoot, { recursive: true, force: true });
    }
  });

  it('startAnalyze: guard по ключу analyze-<id>; разные сессии параллельны (VL-141)', async () => {
    const gRoot = mkTestRoot('vibelog-orch-ang-');
    mkdirSync(join(gRoot, 'backlog'), { recursive: true });
    writeFileSync(join(gRoot, 'backlog', 'config.yml'), 'project_name: An Guard\n', 'utf-8');
    makeAgentSession(gRoot, 'agent-601');
    makeAgentSession(gRoot, 'agent-602');
    setStubEnv({ VL28_STUB_MARKER: join(gRoot, 'marker-ang.txt'), VL28_STUB_SLEEP: '1500', VL28_STUB_EXIT: '0', });
    try {
      const first = startAnalyze(gRoot, 'agent-601');
      assert.equal(first.started, true, JSON.stringify(first));
      // Повторный запуск ТОЙ ЖЕ сессии — guard
      const second = startAnalyze(gRoot, 'vb:agent-601');
      assert.match(second.error, /уже выполняется/);
      // Разная сессия — параллельно разрешено (другой guard-ключ)
      const other = startAnalyze(gRoot, 'agent-602');
      assert.equal(other.started, true, JSON.stringify(other));
      assert.equal(getRun('analyze-agent-601').running, true);
      assert.equal(getRun('analyze-agent-602').running, true);
      await waitDone('analyze-agent-601');
      await waitDone('analyze-agent-602');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined, VL28_STUB_SLEEP: '0' });
      setStubEnv({ VIBELOG_QWEN_BIN: stubBin, });
      rmSync(gRoot, { recursive: true, force: true });
    }
  });

  it('startAnalyze: AC3 (VL-229) — промпт содержит топ повторов из jsonl, без {{repeatTop}}', async () => {
    const rRoot = mkTestRoot('vibelog-orch-anr-');
    mkdirSync(join(rRoot, 'backlog'), { recursive: true });
    writeFileSync(join(rRoot, 'backlog', 'config.yml'), 'project_name: Repeat Test\n', 'utf-8');
    const dir = join(rRoot, '.vibelog', 'agent-sessions');
    mkdirSync(dir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 9; i++) {
      lines.push(
        JSON.stringify({
          role: 'assistant',
          content: null,
          tool_calls: [{ id: `g${i}`, name: 'grep_search', arguments: { pattern: 'zagruzka-loop' } }],
        })
      );
    }
    lines.push(
      JSON.stringify({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'r1', name: 'read_file', arguments: { path: 'src/agent/loop.ts' } }],
      })
    );
    writeFileSync(join(dir, 'agent-888.jsonl'), lines.join('\n') + '\n', 'utf-8');
    writeFileSync(join(dir, 'agent-888.meta.json'), JSON.stringify({ phase: 'code', cwd: rRoot }), 'utf-8');
    setStubEnv({
      VL28_STUB_MARKER: join(rRoot, 'marker-anr.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
        type: 'result', subtype: 'success', is_error: false,
        duration_ms: 100, duration_api_ms: 100, num_turns: 1,
        result: 'ok',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2 },
        session_id: 'an-r',
      }),
    });
    try {
      const res = startAnalyze(rRoot, 'vb:agent-888');
      assert.equal(res.started, true, JSON.stringify(res));
      await waitDone('analyze-agent-888');
      const prompt = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'))[0];
      assert.ok(prompt.includes('grep_search|zagruzka-loop'), 'топ повторяющихся запросов в промпте');
      assert.ok(prompt.includes('9 обращений'), 'число обращений в топе');
      assert.ok(prompt.includes('повторных'), 'сводка с числом повторных вызовов');
      assert.doesNotMatch(prompt, /\{\{repeat(Summary|Top)\}\}/, 'подстановки VL-229 не остались литералами');
    } finally {
      rmSync(rRoot, { recursive: true, force: true });
    }
  });

  it('startAnalyze: нет jsonl → «Сессия не найдена» (VL-141)', () => {
    const mRoot = mkTestRoot('vibelog-orch-anm-');
    try {
      const res = startAnalyze(mRoot, 'agent-999');
      assert.match(res.error, /не найдена/);
    } finally {
      rmSync(mRoot, { recursive: true, force: true });
    }
  });

  it('startAnalyze: битый ref (UUID/VL-1/пусто) → error (VL-141)', () => {
    const badRefs = ['vb:6e3f8a9c-1234-4abc-9def-000000000000', 'VL-1', '', 'agent-abc'];
    for (const ref of badRefs) {
      const res = startAnalyze(testRoot, ref);
      assert.ok('error' in res, `ожидался error для ref "${ref}"`);
      assert.match(res.error, /Некорректный session-ref/);
    }
  });

  it('startPhase отклоняет phase=analyze — только через startAnalyze (VL-141)', () => {
    const res = startPhase(testRoot, 'ot-1', 'analyze');
    assert.ok('error' in res);
    assert.match(res.error, /startAnalyze/);
  });

  // ── VL-147: фаза code в той же сессии агента, что и plan (--resume) ──

  /** Минимальный проект (без git/веток): backlog/config.yml + задача. */
  const makeSameRoot = (prefix, taskId) => {
    const root = mkTestRoot(prefix);
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-147 Test\n', 'utf-8');
    createTaskFile(root, { id: taskId, title: `Задача ${taskId} (VL-147)` });
    return root;
  };

  /** pre-seed меты plan-сессии задачи в agent-sessions/<root>. */
  const seedPlanSession = (root, sessionId, taskId) => {
    saveSessionMetaSyncTest(root, sessionId, { taskId, phase: 'plan', cwd: root });
  };

  // saveSessionMeta — async; тестовый шов — синхронная запись через writeFileSync
  const saveSessionMetaSyncTest = (root, sessionId, meta) => {
    const dir = agentSessionsDir(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.meta.json`), JSON.stringify(meta), 'utf-8');
  };

  it('code + sameSession=true: в argv есть --resume <planSessionId> (VL-147)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-on-', 'VL-1470');
    seedPlanSession(root, 'agent-plan-1470', 'VL-1470');
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl147-on.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(root, 'VL-1470', 'code', undefined, undefined, 'qwen', { sameSession: true });
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1470');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const resumeIdx = argv.indexOf('--resume');
      assert.ok(resumeIdx !== -1, 'в argv есть --resume: ' + JSON.stringify(argv));
      assert.equal(argv[resumeIdx + 1], 'agent-plan-1470', 'после --resume — sessionId plan-сессии');
      // Примечание о продолжении plan в промпте (контекст планирования в истории)
      const prompt = argv.find((a) => a.includes('Фаза 3'));
      assert.ok(prompt?.includes('VL-147'), 'примечание VL-147 в промпте');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('дефолт (настройка off): --resume НЕТ (VL-147, AC2)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-off-', 'VL-1471');
    // Мета plan-сессии есть, но режим выключен — спавн без --resume
    seedPlanSession(root, 'agent-plan-1471', 'VL-1471');
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl147-off.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(root, 'VL-1471', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1471');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(!argv.includes('--resume'), 'без настройки --resume не передаётся: ' + JSON.stringify(argv));
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('настройка code_same_session=true: --resume ЕСТЬ без явного флага (VL-147)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-set-', 'VL-1472');
    seedPlanSession(root, 'agent-plan-1472', 'VL-1472');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(root);
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl147-set.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      const res = startPhase(root, 'VL-1472', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1472');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const resumeIdx = argv.indexOf('--resume');
      assert.ok(resumeIdx !== -1, 'настройка включает --resume: ' + JSON.stringify(argv));
      assert.equal(argv[resumeIdx + 1], 'agent-plan-1472');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sameSession=false при включённой настройке: --resume НЕТ (VL-147, переопределение)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-override-', 'VL-1473');
    seedPlanSession(root, 'agent-plan-1473', 'VL-1473');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(root);
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl147-override.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      // --no-same-session: явный флаг разово обходит включённую настройку
      const res = startPhase(root, 'VL-1473', 'code', undefined, undefined, 'qwen', { sameSession: false });
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1473');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(!argv.includes('--resume'), 'явный false перекрывает настройку: ' + JSON.stringify(argv));
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('настройка on, но план-сессия не найдена: fallback без --resume (VL-147)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-fb-', 'VL-1474');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(root);
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl147-fb.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0', });
    try {
      // Мета plan-сессии отсутствует — обычный новый запуск (регрессий нет)
      const res = startPhase(root, 'VL-1474', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1474');
      assert.equal(run.exitCode, 0, 'fallback-запуск завершается успехом');
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(!argv.includes('--resume'), 'без план-сессии --resume не передаётся: ' + JSON.stringify(argv));
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finish() дописывает мету сессии qwen по result.session_id (VL-147)', async () => {
    const root = makeSameRoot('vibelog-orch-vl147-meta-', 'VL-1475');
    // Стаб печатает JSON type=result с session_id — finish() должен дописать
    // <id>.meta.json с taskId/phase (источник для findTaskPhaseSessionSync)
    setStubEnv({
      VL28_STUB_MARKER: join(root, 'marker-vl147-meta.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, duration_ms: 1,
        duration_api_ms: 1, num_turns: 1, result: 'готово',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2 },
        session_id: 'qwen-sess-1475',
      }),
    });
    try {
      const res = startPhase(root, 'VL-1475', 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1475');
      assert.equal(run.exitCode, 0);
      // saveSessionMeta в finish() — fire-and-forget: ждём появления файла
      const metaPath = join(agentSessionsDir(root), 'qwen-sess-1475.meta.json');
      for (let i = 0; i < 80 && !existsSync(metaPath); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(existsSync(metaPath), `нет meta.json: ${metaPath}`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(meta.taskId, 'VL-1475');
      assert.equal(meta.phase, 'plan');
      // cwd в мете — realpath (как process.cwd() child'а; /var→/private/var в tmpdir macOS)
      assert.equal(meta.cwd, realpathSync(root));
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VL28_STUB_RESULT: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── VL-187: статус sameSession, фолбэк-поиск в worktree, мета при resume ──

  it('мета план-сессии только в worktree-каталоге → --resume (VL-187, фолбэк-поиск)', async () => {
    const root = makeSameRoot('vibelog-orch-vl187-wt-', 'VL-1870');
    // Мета лежит только в agent-sessions worktree задачи (запуск плана из
    // worktree без VIBELOG_CWD/со старым dist) — в главном каталоге её нет
    const wtSessions = join(root, '.vibelog', 'worktrees', 'vl-1870', '.vibelog', 'agent-sessions');
    mkdirSync(wtSessions, { recursive: true });
    writeFileSync(
      join(wtSessions, 'agent-plan-1870.meta.json'),
      JSON.stringify({ taskId: 'VL-1870', phase: 'plan', cwd: join(root, '.vibelog', 'worktrees', 'vl-1870') }),
      'utf-8'
    );
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(root);
    setStubEnv({ VL28_STUB_MARKER: join(root, 'marker-vl187-wt.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(root, 'VL-1870', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      assert.equal(res.sameSession, 'applied', 'статус applied при находке во worktree-каталоге');
      const run = await waitDone('VL-1870');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      const idx = argv.indexOf('--resume');
      assert.ok(idx !== -1, '--resume из worktree-каталога: ' + JSON.stringify(argv));
      assert.equal(argv[idx + 1], 'agent-plan-1870');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('StartResult.sameSession: no-plan-session / off / override-off (VL-187)', async () => {
    // 1) настройка on, мет нет → no-plan-session
    const rootNps = makeSameRoot('vibelog-orch-vl187-nps-', 'VL-1871');
    mkdirSync(join(rootNps, '.vibelog'), { recursive: true });
    writeFileSync(join(rootNps, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(rootNps);
    setStubEnv({ VL28_STUB_MARKER: join(rootNps, 'marker-nps.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(rootNps, 'VL-1871', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      assert.equal(res.sameSession, 'no-plan-session');
      await waitDone('VL-1871');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(rootNps, { recursive: true, force: true });
    }
    // 2) дефолт (настройки нет) → off, поведение прежнее
    const rootOff = makeSameRoot('vibelog-orch-vl187-off2-', 'VL-1872');
    setStubEnv({ VL28_STUB_MARKER: join(rootOff, 'marker-off2.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(rootOff, 'VL-1872', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      assert.equal(res.sameSession, 'off');
      await waitDone('VL-1872');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(rootOff, { recursive: true, force: true });
    }
    // 3) явный sameSession:false при включённой настройке → override-off
    const rootOv = makeSameRoot('vibelog-orch-vl187-ovr-', 'VL-1873');
    seedPlanSession(rootOv, 'agent-plan-1873', 'VL-1873');
    mkdirSync(join(rootOv, '.vibelog'), { recursive: true });
    writeFileSync(join(rootOv, '.vibelog', 'settings.json'), JSON.stringify({ chats: [], code_same_session: true }), 'utf-8');
    allowAllPhases(rootOv);
    setStubEnv({ VL28_STUB_MARKER: join(rootOv, 'marker-ovr.txt'), VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(rootOv, 'VL-1873', 'code', undefined, undefined, 'qwen', { sameSession: false });
      assert.equal(res.started, true, JSON.stringify(res));
      assert.equal(res.sameSession, 'override-off');
      const run = await waitDone('VL-1873');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8'));
      assert.ok(!argv.includes('--resume'), 'override-off не передаёт --resume');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      rmSync(rootOv, { recursive: true, force: true });
    }
  });

  it('reply-resume (--resume) не перезаписывает мету: phase plan сохраняется (VL-187)', async () => {
    const root = makeSameRoot('vibelog-orch-vl187-keep-', 'VL-1874');
    saveSessionMetaSyncTest(root, 'agent-plan-1874', { taskId: 'VL-1874', phase: 'plan', cwd: root });
    setStubEnv({
      VL28_STUB_MARKER: join(root, 'marker-keep.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
      VL28_STUB_RESULT: JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, duration_ms: 1,
        duration_api_ms: 1, num_turns: 1, result: 'продолжено',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2 },
        session_id: 'agent-plan-1874',
      }),
    });
    try {
      // Reply-resume из бота: startResume спавнит phase='prompt' с --resume —
      // раньше finish() затирал мету plan→prompt (инцидент VL-185: у VL-185
      // обе сессии (plan и code) оказались с phase='prompt')
      const res = startResume(root, 'agent-plan-1874', 'Продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1874');
      assert.equal(run.exitCode, 0);
      // saveSessionMeta fire-and-forget → даём finish() пройти и убеждаемся,
      // что существующая мета НЕ перезаписана (без фикса стала бы 'prompt')
      await new Promise((r) => setTimeout(r, 150));
      const meta = JSON.parse(readFileSync(join(agentSessionsDir(root), 'agent-plan-1874.meta.json'), 'utf-8'));
      assert.equal(meta.phase, 'plan', 'resume-ран не затирает phase исходной меты');
      assert.equal(meta.taskId, 'VL-1874');
    } finally {
      setStubEnv({ VL28_STUB_MARKER: undefined });
      setStubEnv({ VL28_STUB_RESULT: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── VL-146: очередь close в branch-mode ──

  /**
   * Стаб qwen для очереди close: пишет в lock-файл пары `VL-N start <ts>` /
   * `VL-N end <ts>` (taskId выцепляет из промпта — позиционный аргумент)
   * и спит VL146_LOCK_SLEEP мс. По финальному lock-файлу тест проверяет
   * порядок прохода очереди и непересечение интервалов (инвариант AC-3).
   */
  const LOCK_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const m = (process.argv[2] || '').match(/VL-\\d+/);
const id = m ? m[0] : 'unknown';
const lock = process.env.VL146_LOCK;
fs.appendFileSync(lock, id + ' start ' + Date.now() + '\\n');
setTimeout(() => {
  fs.appendFileSync(lock, id + ' end ' + Date.now() + '\\n');
  process.exit(0);
}, Number(process.env.VL146_LOCK_SLEEP || 400));
`;

  it('close в branch-mode: второй и третий в очереди, автозапуск строго по очереди (VL-146)', async () => {
    // Проект с branch_mode: git НЕ нужен — close не создаёт worktree (VL-112)
    const root = mkTestRoot('vibelog-vl146-');
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-146 Test\n', 'utf-8');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(
      join(root, '.vibelog', 'settings.json'),
      JSON.stringify({ chats: [], branch_mode: true }),
      'utf-8'
    );
    allowAllPhases(root);
    for (const id of ['VL-1', 'VL-2', 'VL-3']) {
      createTaskFile(root, { id, title: `Задача ${id} (VL-146)` });
    }
    const lockPath = join(root, 'close-lock.txt');
    const lockBin = join(root, 'qwen-lock-stub.cjs');
    writeFileSync(lockBin, LOCK_STUB, 'utf-8');
    chmodSync(lockBin, 0o755);
    setStubEnv({ VIBELOG_QWEN_BIN: lockBin, VL146_LOCK: lockPath, VL146_LOCK_SLEEP: '400' });
    try {
      // Первый close стартует сразу (очередь пуста)
      const r1 = startPhase(root, 'VL-1', 'close');
      assert.equal(r1.started, true, JSON.stringify(r1));
      assert.ok(!r1.queued, 'первый close не в очереди');
      // Второй и третий — в очередь: процесс не создан (pid 0), close не стартует (AC-1)
      const r2 = startPhase(root, 'VL-2', 'close');
      assert.equal(r2.started, true, JSON.stringify(r2));
      assert.equal(r2.queued, true, 'второй close в очереди');
      assert.equal(r2.pid, 0, 'процесс очереди ещё не создан');
      const r3 = startPhase(root, 'VL-3', 'close');
      assert.equal(r3.started, true, JSON.stringify(r3));
      assert.equal(r3.queued, true, 'третий close в очереди');
      // getRun отражает состояние очереди
      const g2 = getRun('VL-2');
      assert.equal(g2.running, false);
      assert.equal(g2.queued, true, 'getRun: VL-2 в очереди close');
      // Guard: повторный close активной задачи — ошибка, не очередь
      const dup1 = startPhase(root, 'VL-1', 'close');
      assert.ok('error' in dup1 && /Запуск уже выполняется \(VL-1\)/.test(dup1.error), JSON.stringify(dup1));
      // Guard: двойной запуск задачи, уже стоящей в очереди
      const dup2 = startPhase(root, 'VL-2', 'close');
      assert.ok('error' in dup2 && /Close уже в очереди/.test(dup2.error), JSON.stringify(dup2));
      // Ожидание полного прохода очереди (AC-2: автозапуск без ручного вмешательства):
      // в lock-файле 6 строк (3 пары start/end)
      let lines = [];
      for (let i = 0; i < 400; i++) {
        lines = existsSync(lockPath)
          ? readFileSync(lockPath, 'utf-8').trim().split('\n').filter(Boolean)
          : [];
        if (lines.length >= 6) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      assert.equal(lines.length, 6, `ожидалось 6 строк lock-файла, получено ${lines.length}: ${lines.join(' | ')}`);
      // Порядок: строго VL-1 → VL-2 → VL-3, парами start/end
      const ids = lines.map((l) => l.split(' ')[0]);
      assert.deepEqual(ids, ['VL-1', 'VL-1', 'VL-2', 'VL-2', 'VL-3', 'VL-3'], 'порядок прохода очереди');
      // Инвариант AC-3: интервалы разных close не пересекаются — в каждый
      // момент фазу close выполняет не более одного агента
      const spans = [];
      for (let i = 0; i < lines.length; i += 2) {
        const [id1, s, t1] = lines[i].split(' ');
        const [id2, e, t2] = lines[i + 1].split(' ');
        assert.equal(s, 'start', `ожидалась строка start: ${lines[i]}`);
        assert.equal(e, 'end', `ожидалась строка end: ${lines[i + 1]}`);
        assert.equal(id1, id2, `пара start/end одной задачи: ${lines[i]} / ${lines[i + 1]}`);
        spans.push({ id: id1, from: Number(t1), to: Number(t2) });
      }
      for (let i = 1; i < spans.length; i++) {
        assert.ok(
          spans[i - 1].to <= spans[i].from,
          `close пересекаются: ${spans[i - 1].id} до ${spans[i - 1].to}, ${spans[i].id} с ${spans[i].from}`
        );
      }
      // Стаб пишет end до close-события у parent — дожидаемся завершения VL-3
      const done3 = await waitDone('VL-3', 8000);
      assert.equal(done3.running, false, 'очередь вычищена, VL-3 завершена');
    } finally {
      setStubEnv({ VIBELOG_QWEN_BIN: undefined, VL146_LOCK: undefined, VL146_LOCK_SLEEP: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('close без branch-mode: очередь не применяется, два close идут параллельно (VL-146)', async () => {
    // Регрессия: вне branch-mode поведение прежнее — гвард только per-task
    const root = mkTestRoot('vibelog-vl146-off-');
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-146 Off Test\n', 'utf-8');
    createTaskFile(root, { id: 'VL-4', title: 'Задача VL-4 (VL-146)' });
    createTaskFile(root, { id: 'VL-5', title: 'Задача VL-5 (VL-146)' });
    const lockPath = join(root, 'close-lock.txt');
    const lockBin = join(root, 'qwen-lock-stub.cjs');
    writeFileSync(lockBin, LOCK_STUB, 'utf-8');
    chmodSync(lockBin, 0o755);
    setStubEnv({ VIBELOG_QWEN_BIN: lockBin, VL146_LOCK: lockPath, VL146_LOCK_SLEEP: '400' });
    try {
      const a = startPhase(root, 'VL-4', 'close');
      const b = startPhase(root, 'VL-5', 'close');
      assert.equal(a.started, true, JSON.stringify(a));
      assert.equal(b.started, true, JSON.stringify(b));
      assert.ok(!a.queued && !b.queued, 'без branch-mode очередь не применяется');
      // Обе фазы завершаются — иначе стабы остаются висеть в воркере
      await waitDone('VL-4', 8000);
      await waitDone('VL-5', 8000);
    } finally {
      setStubEnv({ VIBELOG_QWEN_BIN: undefined, VL146_LOCK: undefined, VL146_LOCK_SLEEP: undefined });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── VL-178: авто-resume после отказа провайдера «high risk» ──

  it('finish() авто-resume при high-risk: 2 спавна, --resume, без цикла', async () => {
    // Стаб ВСЕГДА отвечает high-risk ошибкой: 1-й спавн → авто-resume
    // (счётчик 1 на runKey), 2-й спавн → счётчик исчерпан → onExit один раз.
    // Лог argv аппендится — по нему видно оба спавна и флаг --resume.
    const root = makeSameRoot('vibelog-orch-vl178-', 'VL-1780');
    const logPath = join(root, 'vl178-argv.log');
    const hrStub = join(root, 'qwen-hr-stub.cjs');
    writeFileSync(hrStub, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.VL178_STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.writeSync(1, JSON.stringify({
  type: 'result', is_error: true, duration_ms: 1, duration_api_ms: 1, num_turns: 1,
  result: '',
  error: { message: 'The request was rejected because it was considered high risk' },
  session_id: 'agent-hr-1',
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2 },
}) + '\\n');
process.exit(0);
`, 'utf-8');
    chmodSync(hrStub, 0o755);
    setStubEnv({
      VIBELOG_QWEN_BIN: hrStub,
      VL178_STUB_LOG: logPath,
      VL28_STUB_RESULT: undefined,
      VL28_STUB_MARKER: undefined,
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
    });
    try {
      const calls = [];
      const res = startPhase(root, 'VL-1780', 'spec', (run) => calls.push(run));
      assert.equal(res.started, true, JSON.stringify(res));
      // waitDone ловит финал: 1-й прогон не отдаёт onExit (auto-resume внутри
      // finish), поэтому ждём завершения 2-го прогона
      const run = await waitDone('VL-1780', 8000);
      // Дать второму finish(do) дописать lastRuns/onExit
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(run.result?.is_error, true, 'финальный record — тоже high-risk (стаб не меняется)');
      // Ровно 2 спавна: первый исходный, второй с --resume
      const argvLines = readFileSync(logPath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(argvLines.length, 2, `ожидалось 2 спавна, есть ${argvLines.length}: ${JSON.stringify(argvLines)}`);
      assert.ok(!argvLines[0].includes('--resume'), '1-й спавн без --resume');
      assert.ok(argvLines[1].includes('--resume'), '2-й спавн (авто-resume) с --resume');
      assert.ok(argvLines[1].includes('agent-hr-1'), 'session_id из результата');
      // onExit — ровно один раз, по финальному record (упавший 1-й прогон молчит)
      assert.equal(calls.length, 1, `onExit вызван ${calls.length} раз(а)`);
      assert.equal(calls[0].result?.session_id, 'agent-hr-1');
    } finally {
      setStubEnv({
        VIBELOG_QWEN_BIN: undefined,
        VL178_STUB_LOG: undefined,
        VL28_STUB_RESULT: undefined,
        VL28_STUB_MARKER: undefined,
        VL28_STUB_SLEEP: undefined,
        VL28_STUB_EXIT: undefined,
      });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── VL-199: high-risk-текст при HTTP 200 → is_error в result (без error) → авто-resume ──

  it('VL-199: fail-результат loop с маркером high risk (без error-поля) → авто-resume с --resume', async () => {
    // Форма, которую теперь produce cli.ts после фикса loop: is_error=true,
    // маркер — в result (русское пояснение + оригинал), поля error нет.
    const root = makeSameRoot('vibelog-orch-vl199-', 'VL-1990');
    const logPath = join(root, 'vl199-argv.log');
    const hrStub = join(root, 'qwen-hr199-stub.cjs');
    writeFileSync(hrStub, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.VL199_STUB_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
fs.writeSync(1, JSON.stringify({
  type: 'result', is_error: true, duration_ms: 1, duration_api_ms: 1, num_turns: 1,
  result: 'Отказ провайдера «high risk»: The request was rejected because it was considered high risk — фаза прервана как ошибка (VL-199).',
  session_id: 'agent-hr199-1',
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2 },
}) + '\\n');
process.exit(0);
`, 'utf-8');
    chmodSync(hrStub, 0o755);
    setStubEnv({
      VIBELOG_QWEN_BIN: hrStub,
      VL199_STUB_LOG: logPath,
      VL28_STUB_RESULT: undefined,
      VL28_STUB_MARKER: undefined,
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
    });
    try {
      const calls = [];
      const res = startPhase(root, 'VL-1990', 'spec', (run) => calls.push(run));
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-1990', 8000);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(run.result?.is_error, true, 'финальный record — тоже high-risk');
      const argvLines = readFileSync(logPath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(argvLines.length, 2, `ожидалось 2 спавна, есть ${argvLines.length}: ${JSON.stringify(argvLines)}`);
      assert.ok(!argvLines[0].includes('--resume'), '1-й спавн без --resume');
      assert.ok(argvLines[1].includes('--resume'), '2-й спавн (авто-resume) с --resume');
      assert.ok(argvLines[1].includes('agent-hr199-1'), 'session_id из result');
      assert.equal(calls.length, 1, `onExit вызван ${calls.length} раз(а)`);
      assert.equal(calls[0].result?.session_id, 'agent-hr199-1');
    } finally {
      setStubEnv({
        VIBELOG_QWEN_BIN: undefined,
        VL199_STUB_LOG: undefined,
        VL28_STUB_RESULT: undefined,
        VL28_STUB_MARKER: undefined,
        VL28_STUB_SLEEP: undefined,
        VL28_STUB_EXIT: undefined,
      });
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── VL-180: общий хелпер startTaskPhase (бот ↔ веб, единая точка входа) ──

  it('startTaskPhase: непустой комментарий в файле до спавна, текст в {{comment}}', async () => {
    resetStubEnv();
    setStubEnv({
      VL28_STUB_MARKER: join(testRoot, 'marker-taskphase.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
    });
    const task = createTaskFile(testRoot, { title: 'startTaskPhase с комментарием', status: 'Planned' });
    const res = startTaskPhase(testRoot, task.id, 'plan', { comment: 'учти edge-cases' });
    assert.equal(res.started, true, JSON.stringify(res));
    // Комментарий уже в файле сразу после вызова: addComment внутри хелпера
    // выполняется ДО startPhase — taskExtraVars читает задачу уже с ним
    const fresh = getTask(testRoot, task.id);
    assert.equal(fresh.comments.length, 1, 'комментарий записан до спавна');
    assert.equal(fresh.comments[0].text, 'учти edge-cases');
    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0, run.logTail ?? '');
    const prompt = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8')).join(' ');
    assert.ok(prompt.includes('учти edge-cases'), 'текст комментария подставлен в {{comment}}');
    assert.ok(!prompt.includes('{{comment}}'), 'литеральный {{comment}} не остался');
    resetStubEnv();
  });

  it('startTaskPhase: агент по умолчанию из настроек проекта (default_agent vb)', async () => {
    const settingsDir = join(testRoot, '.vibelog');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ default_agent: 'vb' }), 'utf-8');
    allowAllPhases(testRoot);
    try {
      setStubEnv({
        // Несуществующий qwen-бинарь: если бы агент игнорировался, спавн упал бы
        VIBELOG_QWEN_BIN: join(testRoot, 'no-such-qwen-bin'),
        VIBELOG_AGENT_BIN: stubBin,
        VL28_STUB_MARKER: join(testRoot, 'marker-taskphase-vb.txt'),
        VL28_STUB_SLEEP: '0',
        VL28_STUB_EXIT: '0',
      });
      const task = createTaskFile(testRoot, { title: 'startTaskPhase vb', status: 'Spec' });
      const res = startTaskPhase(testRoot, task.id, 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone(task.id);
      assert.equal(run.exitCode, 0, run.logTail ?? '');
      assert.equal(run.agent, 'vb', 'агент взят из .vibelog/settings.json, не хардкод');
    } finally {
      resetStubEnv();
      rmSync(join(settingsDir, 'settings.json'), { force: true });
      allowAllPhases(testRoot);
    }
  });

  it('startTaskPhase: без комментария — литеральный {{comment}} в промпте (VL-80)', async () => {
    resetStubEnv();
    setStubEnv({
      VL28_STUB_MARKER: join(testRoot, 'marker-taskphase-nocomment.txt'),
      VL28_STUB_SLEEP: '0',
      VL28_STUB_EXIT: '0',
    });
    const task = createTaskFile(testRoot, { title: 'startTaskPhase без комментария', status: 'Planned' });
    const res = startTaskPhase(testRoot, task.id, 'plan');
    assert.equal(res.started, true, JSON.stringify(res));
    const run = await waitDone(task.id);
    assert.equal(run.exitCode, 0, run.logTail ?? '');
    const prompt = JSON.parse(readFileSync(stubEnvGet('VL28_STUB_MARKER'), 'utf-8')).join(' ');
    assert.ok(prompt.includes('{{comment}}'), 'ожидался литеральный {{comment}} (контракт VL-80)');
    assert.equal(getTask(testRoot, task.id).comments.length, 0, 'комментариев не добавлено');
    resetStubEnv();
  });
});

// ── VL-196: transient In Progress на время workflow-фазы ──
//
// Отдельный проектный корень с DEFAULT_WORKFLOW (без settings.json):
// Spec + plan → Planned, чтобы проверять реальные produces_status, а не
// identity-переходы permissive-воркфлоу первого describe. Собственный стаб-
// бинарь обязателен: testRoot первого describe удаляется в его afterAll.
describe('transient In Progress (VL-196)', () => {
  const trRoot = mkdtempSync(join(tmpdir(), 'vibelog-tr-test-'));
  const trBacklog = join(trRoot, 'backlog');
  const trStub = join(trRoot, 'qwen-stub.cjs');
  const trCache = join(trRoot, '.vibelog', 'phase-in-progress.json');

  beforeAll(() => {
    mkdirSync(join(trBacklog, 'tasks'), { recursive: true });
    writeFileSync(join(trBacklog, 'config.yml'), stringifyYaml({
      project_name: 'Transient Orch Test',
      task_prefix: 'VL',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected'],
      definition_of_done: [],
    }), 'utf-8');
    writeFileSync(trStub, STUB, 'utf-8');
    chmodSync(trStub, 0o755);
  });

  afterAll(() => {
    resetStubEnv();
    rmSync(trRoot, { recursive: true, force: true });
  });

  it('старт plan → In Progress во время фазы, успех → produces_status, кэш чист (AC1/AC2)', async () => {
    const task = createTaskFile(trRoot, { id: 'VL-901', title: 'транзиент: успех', status: 'Spec' });
    setStubEnv({ VIBELOG_QWEN_BIN: trStub, VL28_STUB_SLEEP: '400', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(trRoot, task.id, 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      // Синхронно после старта: статус уже виден на канбане (AC1)
      assert.equal(getTask(trRoot, 'VL-901').status, 'In Progress', 'In Progress во время фазы');
      assert.ok(existsSync(trCache), 'кэш .vibelog/phase-in-progress.json создан');
      const run = await waitDone('VL-901');
      assert.equal(run.exitCode, 0, run.logTail ?? '');
      assert.equal(getTask(trRoot, 'VL-901').status, 'Planned', 'produces_status от исходного Spec');
      const cache = JSON.parse(readFileSync(trCache, 'utf-8'));
      assert.equal('VL-901' in cache, false, 'запись кэша удалена после успеха');
    } finally {
      resetStubEnv();
    }
  });

  it('провал фазы → откат к исходному статусу + комментарий-причина (AC2)', async () => {
    const task = createTaskFile(trRoot, { id: 'VL-902', title: 'транзиент: провал', status: 'Spec' });
    setStubEnv({ VIBELOG_QWEN_BIN: trStub, VL28_STUB_SLEEP: '0', VL28_STUB_EXIT: '1' });
    // Статус в момент onExit — критичен для авто-очереди: finalize обязан
    // откатить ДО колбэка, иначе pickAutoPhase возьмёт code из In Progress
    let statusAtExit = null;
    try {
      const res = startPhase(trRoot, task.id, 'plan', (run) => {
        statusAtExit = getTask(trRoot, 'VL-902').status;
      });
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-902');
      assert.notEqual(run.exitCode, 0, 'фаза должна упасть');
      const fresh = getTask(trRoot, 'VL-902');
      assert.equal(fresh.status, 'Spec', 'откат к статусу старта');
      assert.equal(statusAtExit, 'Spec', 'статус откачен К МОМЕНТУ onExit (порядок finalize → onExit)');
      assert.ok(
        fresh.comments.some((c) => /Фаза plan не удалась/.test(c.text)),
        'причина зафиксирована комментарием'
      );
      assert.ok(fresh.comments.some((c) => c.author === '@agent'), 'автор @agent');
      const cache = existsSync(trCache) ? JSON.parse(readFileSync(trCache, 'utf-8')) : {};
      assert.equal('VL-902' in cache, false, 'запись кэша удалена после провала');
    } finally {
      resetStubEnv();
    }
  });

  it('служебная фаза comment не трогает статус (AC1 — только workflow-фазы)', async () => {
    const task = createTaskFile(trRoot, { id: 'VL-903', title: 'транзиент: comment', status: 'Review' });
    setStubEnv({ VIBELOG_QWEN_BIN: trStub, VL28_STUB_SLEEP: '300', VL28_STUB_EXIT: '0' });
    try {
      const res = startTaskPhase(trRoot, task.id, 'comment', { comment: 'просто комментарий' });
      assert.equal(res.started, true, JSON.stringify(res));
      assert.equal(getTask(trRoot, 'VL-903').status, 'Review', 'comment не переводит в In Progress');
      const run = await waitDone('VL-903');
      assert.equal(run.exitCode, 0, run.logTail ?? '');
      assert.equal(getTask(trRoot, 'VL-903').status, 'Review', 'статус не изменился после фазы');
    } finally {
      resetStubEnv();
    }
  });

  it('статус, зафиксированный агентом во время фазы, приоритетен финализации (AC2)', async () => {
    const task = createTaskFile(trRoot, { id: 'VL-904', title: 'транзиент: агент зафиксировал', status: 'Spec' });
    setStubEnv({ VIBELOG_QWEN_BIN: trStub, VL28_STUB_SLEEP: '400', VL28_STUB_EXIT: '0' });
    try {
      const res = startPhase(trRoot, task.id, 'plan');
      assert.equal(res.started, true, JSON.stringify(res));
      // Имитация backlog_finish_phase агентом ПОСЛЕ старта фазы
      updateTaskFile(trRoot, 'VL-904', { status: 'Planned' });
      const run = await waitDone('VL-904');
      assert.equal(run.exitCode, 0, run.logTail ?? '');
      assert.equal(getTask(trRoot, 'VL-904').status, 'Planned', 'финализация не перетирает запись агента');
      const cache = existsSync(trCache) ? JSON.parse(readFileSync(trCache, 'utf-8')) : {};
      assert.equal('VL-904' in cache, false, 'кэш почищен');
    } finally {
      resetStubEnv();
    }
  });
});
