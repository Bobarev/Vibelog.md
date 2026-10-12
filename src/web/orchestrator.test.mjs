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

import { renderPrompt, startPhase, startPrompt, startResume, getRun } from '../../dist/web/orchestrator.js';
import { handleApi } from '../../dist/web/api.js';
import { createTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe('orchestrator (VL-28)', () => {
  const savedEnv = {};
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
    chmodSync(stubBin, 0o755);
    task1 = createTaskFile(testRoot, { title: 'Задача для фазы 1', status: 'Spec', priority: 'High' });
    task2 = createTaskFile(testRoot, { title: 'Задача для API-тестов', status: 'Backlog', priority: 'Low' });

    // VL-125: env фазы оркестратора (VL-114) не должен утекать в стаб-спавны
    // теста — иначе pnpm test, запущенный агентом ВНУТРИ фазы, даёт ложные
    // падения env-тестов (инцидент VL-117)
    for (const key of ['VIBELOG_QWEN_BIN', 'VIBELOG_AGENT_BIN', 'VL28_STUB_MARKER', 'VL28_STUB_SLEEP', 'VL28_STUB_EXIT', 'VL28_STUB_RESULT', 'VL28_STUB_RACE', 'VIBELOG_PHASE_TASK_ID', 'VIBELOG_PHASE_NAME', 'VIBELOG_CWD']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.VIBELOG_QWEN_BIN = stubBin;
  });

  afterAll(() => {
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

  it('startPhase: onExit-колбэк — один раз, с exitCode и logTail (VL-48)', async () => {
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-vl48.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
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
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-vl60.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    const res = startPhase(testRoot, task1.id, 'comment', undefined, {
      comment: 'тест-запрос-vl60',
    });
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.exitCode, 0);
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    // argv[0] — позиционный промпт: содержит текст комментария, {{comment}} подставлен
    assert.ok(argv.some((a) => a.includes('тест-запрос-vl60')));
    assert.ok(argv.some((a) => !a.includes('{{comment}}')));
  });

  it('startPhase: run.result заполнен из JSON type=result (VL-64)', async () => {
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
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
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    // Реальный stdout qwen 0.24.x при --output-format json: одна строка —
    // JSON-массив всех сообщений сессии, result последним элементом
    process.env.VL28_STUB_RESULT = JSON.stringify([
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
    ]);
    const res = startPhase(testRoot, task1.id, 'comment');
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.result?.result, 'понг-из-массива');
    assert.equal(run.result?.session_id, 'arr-1');
    assert.equal(run.result?.usage.total_tokens, 15);
  });

  it('startPhase: result парсится, хотя stderr вклинился в JSON-строку stdout (VL-63 reopen)', async () => {
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RACE = '1';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 900,
      num_turns: 1,
      result: 'понг-сквозь-шум',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, total_tokens: 15 },
      session_id: 'race-1',
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
    delete process.env.VL28_STUB_RACE;
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
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-prompt.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      duration_api_ms: 900,
      num_turns: 1,
      result: 'коммиты сделаны',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, total_tokens: 15 },
      session_id: 'prompt-1',
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
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    assert.ok(argv.some((a) => a.includes('сделай коммиты для файлов')));
    assert.ok(argv.every((a) => !a.includes('{{prompt}}')));
    // Для prompt флагов нет (как у comment) — не spec/plan
    assert.ok(!argv.includes('--allowed-mcp-server-names'));
  });

  it('startPrompt: double-trigger guard по ключу "prompt" (VL-67)', async () => {
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-prompt2.txt');
    process.env.VL28_STUB_SLEEP = '1200';
    process.env.VL28_STUB_EXIT = '0';
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
    process.env.VIBELOG_QWEN_BIN = join(testRoot, 'no-such-qwen-bin');
    process.env.VIBELOG_AGENT_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-vb.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'от-встроенного-агента',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-1',
    });
    const res = startPrompt(testRoot, 'запрос к агенту', undefined, 'vb');
    assert.equal(res.started, true);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'от-встроенного-агента');
    // VL-93: run.agent пробрасывается — рендер session_id получает vb:
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    assert.ok(argv.some((a) => a.includes('запрос к агенту')));
    process.env.VIBELOG_QWEN_BIN = stubBin;
  });

  it('startPhase: agent=vb спавнит VIBELOG_AGENT_BIN (VL-94)', async () => {
    // Выбор бинаря через параметр startPhase: VIBELOG_QWEN_BIN на заведомо
    // несуществующий путь — если бы агент игнорировался, spawn упал бы
    process.env.VIBELOG_QWEN_BIN = join(testRoot, 'no-such-qwen-bin');
    process.env.VIBELOG_AGENT_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-phase-vb.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'фаза-от-агента',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-phase-1',
    });
    const res = startPhase(testRoot, task1.id, 'spec', undefined, undefined, 'vb');
    assert.equal(res.started, true);
    const run = await waitDone(task1.id);
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'фаза-от-агента');
    // VL-93/94: run.agent пробрасывается и для фаз (рендер session_id vb:)
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    assert.ok(argv.some((a) => a.includes(task1.id)));
    process.env.VIBELOG_QWEN_BIN = stubBin;
  });

  it('startPhase: agent=vb получает --max-wall-time/--max-requests из bot.yml (VL-104)', async () => {
    process.env.VIBELOG_AGENT_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-limits-vb.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'фаза-с-лимитами',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-limits-1',
    });
    // bot.yml с лимитами — оркестратор прокидывает оба флага (только vb)
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'bot.yml'), 'chats: []\nmax_wall_time: 1800\nmax_requests: 50\n', 'utf-8');
    try {
      const res = startPhase(testRoot, task1.id, 'code', undefined, undefined, 'vb');
      assert.equal(res.started, true);
      const run = await waitDone(task1.id);
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      const iWall = argv.indexOf('--max-wall-time');
      const iReq = argv.indexOf('--max-requests');
      assert.ok(iWall !== -1 && argv[iWall + 1] === '1800', 'нет --max-wall-time 1800: ' + JSON.stringify(argv));
      assert.ok(iReq !== -1 && argv[iReq + 1] === '50', 'нет --max-requests 50: ' + JSON.stringify(argv));
    } finally {
      rmSync(join(testRoot, '.vibelog', 'bot.yml'), { force: true });
    }
    // Без bot.yml флаги не передаются — поведение прежнее
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-limits-none.txt');
    const res2 = startPhase(testRoot, task1.id, 'code', undefined, undefined, 'vb');
    assert.equal(res2.started, true);
    const run2 = await waitDone(task1.id);
    assert.equal(run2.exitCode, 0);
    const argv2 = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    assert.ok(!argv2.includes('--max-wall-time'), 'неожиданный --max-wall-time: ' + JSON.stringify(argv2));
    assert.ok(!argv2.includes('--max-requests'), 'неожиданный --max-requests: ' + JSON.stringify(argv2));
    process.env.VIBELOG_QWEN_BIN = stubBin;
  });

  it('startPrompt: guard общий для qwen и vb (VL-92)', async () => {
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-guard-vb.txt');
    process.env.VL28_STUB_SLEEP = '1200';
    process.env.VL28_STUB_EXIT = '0';
    // Активен qwen-промпт → /prompt:vb получает тот же guard-ответ
    const first = startPrompt(testRoot, 'запрос qwen');
    assert.equal(first.started, true);
    const second = startPrompt(testRoot, 'запрос vb', undefined, 'vb');
    assert.match(second.error, /уже выполняется/);
    const run = await waitDone('prompt');
    assert.equal(run.exitCode, 0);
  });

  // ── VL-93: startResume — продолжение сессии qwen по reply ──

  it('startResume: spawn с --resume <sessionId>, getRun("resume"), agent qwen (VL-93)', async () => {
    process.env.VIBELOG_QWEN_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-resume.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 700,
      duration_api_ms: 600,
      num_turns: 1,
      result: 'сессия-продолжена',
      usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1, total_tokens: 10 },
      session_id: 'resume-1',
    });
    const res = startResume(testRoot, '11111111-2222-3333-4444-555555555555', 'продолжай работу');
    assert.equal(res.started, true);
    const run = await waitDone('resume');
    assert.equal(run.exitCode, 0);
    assert.equal(run.phase, 'prompt');
    assert.equal(run.result?.result, 'сессия-продолжена');
    // Агент по умолчанию qwen — фолбэк рендера session_id без vb:
    assert.equal(run.agent, 'qwen');
    // Контракт argv: промпт, --resume <sessionId>, затем стандартные флаги
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
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

  it('startResume: guard от двойного запуска, onExit один раз (VL-93)', async () => {
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-resume2.txt');
    process.env.VL28_STUB_SLEEP = '1200';
    process.env.VL28_STUB_EXIT = '0';
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
    // Пока жив — второй resume получает guard; getRun('resume') — running
    const second = startResume(testRoot, '33333333-4444-5555-6666-777777777777', 'второй');
    assert.match(second.error, /уже выполняется/);
    assert.equal(getRun('resume').running, true);
    const run = await waitDone('resume');
    assert.equal(exitCalls, 1, 'onExit ровно один раз');
    assert.equal(exitRunning, false, 'onExit получает завершённый run');
    assert.equal(run.exitCode, 0);
    assert.equal(run.agent, 'qwen');
  });

  it('startResume: agent=vb спавнит VIBELOG_AGENT_BIN с --resume (VL-95)', async () => {
    // Выбор бинаря через параметр agent: VIBELOG_QWEN_BIN на заведомо
    // несуществующий путь — если бы агент игнорировался, spawn упал бы
    process.env.VIBELOG_QWEN_BIN = join(testRoot, 'no-such-qwen-bin');
    process.env.VIBELOG_AGENT_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(testRoot, 'marker-resume-vb.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    process.env.VL28_STUB_RESULT = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      duration_api_ms: 400,
      num_turns: 1,
      result: 'vb-сессия-продолжена',
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, total_tokens: 7 },
      session_id: 'vb-resume-1',
    });
    // Бот передаёт sessionId с префиксом vb: (extractSessionRef) — оркестратор
    // прокидывает его как есть, strip делает CLI агента (VL-95)
    const res = startResume(testRoot, 'vb:agent-1234567890', 'продолжи vb', undefined, 'vb');
    assert.equal(res.started, true);
    const run = await waitDone('resume');
    assert.equal(run.exitCode, 0);
    // Контракт VL-63 сохранён: тот же parseQwenResult для обоих агентов
    assert.equal(run.result?.result, 'vb-сессия-продолжена');
    // VL-95: run.agent пробрасывается и для resume-запусков vb
    assert.equal(run.agent, 'vb');
    const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
    assert.deepEqual(argv, [
      'продолжи vb',
      '--resume',
      'vb:agent-1234567890',
      '--approval-mode',
      'yolo',
      '--output-format',
      'json',
    ]);
    process.env.VIBELOG_QWEN_BIN = stubBin;
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
    const saved = {};
    for (const key of ['VIBELOG_QWEN_BIN', 'VIBELOG_LLM_BASE_URL', 'VIBELOG_LLM_API_KEY', 'VIBELOG_LLM_MODEL', 'VIBELOG_BIN']) {
      saved[key] = process.env[key];
    }
    process.env.VIBELOG_QWEN_BIN = agentBin;
    process.env.VIBELOG_LLM_BASE_URL = `http://127.0.0.1:${llmPort}/v1`;
    process.env.VIBELOG_LLM_API_KEY = 'test';
    process.env.VIBELOG_LLM_MODEL = 'test-model';
    // MCP-сервер недоступен намеренно: агент обязан мягко деградировать
    // (предупреждение в stderr, фаза продолжается без MCP-инструментов)
    process.env.VIBELOG_BIN = join(testRoot, 'no-such-vibelog');
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
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise((r) => llmServer.close(r));
    }
  });
  // ── VL-110: resume задачной сессии в worktree её задачи ──

  it('startResume: сессия задачи возобновляется в её worktree (VL-110)', async () => {
    // Отдельный git-корень: worktree требует git-репо с коммитом
    const wtRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-wt-'));
    const git = (args) => spawnSync('git', ['-C', wtRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(wtRoot, 'backlog'), { recursive: true });
    writeFileSync(join(wtRoot, 'backlog', 'config.yml'), 'project_name: WT Test\n', 'utf-8');
    mkdirSync(join(wtRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    writeFileSync(join(wtRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
    const wtPath = join(wtRoot, '.vibelog', 'worktrees', 'vl-77');
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
    process.env.VIBELOG_QWEN_BIN = stubWt;
    process.env.VL28_STUB_MARKER = join(wtRoot, 'marker-wt.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startResume(wtRoot, 'agent-999', 'продолжи работу');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('resume');
      assert.equal(run.exitCode, 0);
      // Worktree создан; агент спавнен в нём; VIBELOG_CWD — главный репо
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree vl-77 должна быть создана');
      const marker = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      // realpathSync: macOS /var — симлинк на /private/var, process.cwd() физический
      assert.equal(marker.cwd, realpathSync(wtPath), 'агент должен работать в worktree задачи');
      assert.equal(marker.envCwd, wtRoot, 'VIBELOG_CWD — главный репозиторий');
      // Промпт дополнен примечанием режима веток (как у фаз задач)
      assert.ok(marker.argv[0].includes('Режим параллельной разработки'), marker.argv[0]);
      assert.ok(marker.argv[0].includes('vb/vl-77'), marker.argv[0]);
      assert.deepEqual(marker.argv.slice(1, 3), ['--resume', 'agent-999']);
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(wtRoot, { recursive: true, force: true });
    }
  });

  it('startResume: branch-mode выключен + сессия из worktree → предупреждение (VL-110)', async () => {
    const warnRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-warn-'));
    mkdirSync(join(warnRoot, 'backlog'), { recursive: true });
    writeFileSync(join(warnRoot, 'backlog', 'config.yml'), 'project_name: Warn Test\n', 'utf-8');
    mkdirSync(join(warnRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    // bot.yml БЕЗ branch_mode — resume идёт в главном cwd
    writeFileSync(
      join(warnRoot, '.vibelog', 'agent-sessions', 'agent-888.meta.json'),
      JSON.stringify({ taskId: 'VL-77', phase: 'code', cwd: '/tmp/some-worktree' }),
      'utf-8'
    );
    process.env.VIBELOG_QWEN_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(warnRoot, 'marker-warn.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startResume(warnRoot, 'agent-888', 'продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('resume');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.ok(argv[0].includes('Внимание'), 'предупреждение о cwd-несовпадении: ' + argv[0]);
      assert.ok(argv[0].includes('branch-mode выключен'), argv[0]);
      assert.ok(argv[0].startsWith('продолжи'), 'исходный текст запроса сохраняется: ' + argv[0]);
    } finally {
      delete process.env.VL28_STUB_MARKER;
      rmSync(warnRoot, { recursive: true, force: true });
    }
  });
  // ── VL-112: close-фаза задач с worktree ──

  it('startPhase: close с worktree — спавн в главном репо + merge-шаблон (VL-112)', async () => {
    const closeRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-close-'));
    mkdirSync(join(closeRoot, 'backlog'), { recursive: true });
    writeFileSync(join(closeRoot, 'backlog', 'config.yml'), 'project_name: Close WT\n', 'utf-8');
    mkdirSync(join(closeRoot, '.vibelog'), { recursive: true });
    // branch_mode включён, worktree vl-77 существует (задача работала в ветке)
    writeFileSync(join(closeRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
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
    process.env.VIBELOG_QWEN_BIN = stubClose;
    process.env.VL28_STUB_MARKER = join(closeRoot, 'marker-close.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(closeRoot, 'VL-77', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const marker = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      // cwd — ГЛАВНЫЙ репо: close не спавнится в worktree даже при branch_mode
      assert.equal(marker.cwd, realpathSync(closeRoot), 'close должен работать в главном cwd');
      // Промпт — из phase-close-worktree.md, примечания веток нет
      assert.ok(marker.argv[0].includes('merge --no-ff'), 'close-worktree шаблон с merge-шагом');
      assert.ok(marker.argv[0].includes('vb/vl-77'), '{{branch}} подставлен');
      assert.ok(!marker.argv[0].includes('Режим параллельной разработки'), 'примечания worktree не должно быть');
      assert.equal(run.phase, 'close');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(closeRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: close без worktree — прежний шаблон, спавн в главном (VL-112)', async () => {
    const plainRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-close0-'));
    mkdirSync(join(plainRoot, 'backlog'), { recursive: true });
    writeFileSync(join(plainRoot, 'backlog', 'config.yml'), 'project_name: Close Plain\n', 'utf-8');
    // branch_mode включён, но worktree vl-77 НЕТ
    mkdirSync(join(plainRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(plainRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
    process.env.VIBELOG_QWEN_BIN = stubBin;
    process.env.VL28_STUB_MARKER = join(plainRoot, 'marker-close0.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(plainRoot, 'VL-77', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-77');
      assert.equal(run.exitCode, 0);
      const argv = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.ok(!argv[0].includes('merge --no-ff'), 'без worktree — обычный шаблон close');
      assert.ok(!argv[0].includes('Режим параллельной разработки'), 'worktree не создавалась — примечания нет');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      rmSync(plainRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: code с branch_mode — спавн в worktree (регресс VL-112)', async () => {
    // Регрессия: исключение close не должно задеть остальные фазы задач
    const codeRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-code-'));
    const git = (args) => spawnSync('git', ['-C', codeRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(codeRoot, 'backlog'), { recursive: true });
    writeFileSync(join(codeRoot, 'backlog', 'config.yml'), 'project_name: Code WT\n', 'utf-8');
    mkdirSync(join(codeRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(codeRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
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
    process.env.VIBELOG_QWEN_BIN = stubCode;
    process.env.VL28_STUB_MARKER = join(codeRoot, 'marker-code.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(codeRoot, 'VL-88', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const wtPath = join(codeRoot, '.vibelog', 'worktrees', 'vl-88');
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree vl-88 должна быть создана для code');
      const marker = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(marker.cwd, realpathSync(wtPath), 'code работает в worktree');
      assert.ok(marker.argv[0].includes('Режим параллельной разработки'), 'примечание веток присутствует');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
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
      '}));',
      "fs.writeSync(1, 'stub env\\n');",
      'process.exit(0);',
      '',
    ].join('\n'), 'utf-8');
    chmodSync(stub, 0o755);
    return stub;
  };

  it('startPhase: задачный env в spawnEnv (VL-114)', async () => {
    const envRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-env-'));
    mkdirSync(join(envRoot, 'backlog'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Test\n', 'utf-8');
    process.env.VIBELOG_QWEN_BIN = writeEnvStub(envRoot, 'env-stub.cjs');
    process.env.VL28_STUB_MARKER = join(envRoot, 'marker-env.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(envRoot, 'VL-88', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(m.envPhaseTaskId, 'VL-88', 'VIBELOG_PHASE_TASK_ID передаётся без worktree');
      assert.equal(m.envPhaseName, 'code', 'VIBELOG_PHASE_NAME = фаза');
      assert.equal(m.envCwd, null, 'без branch-mode VIBELOG_CWD не задаётся');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startPrompt: задачный env не передаётся (VL-114)', async () => {
    const envRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-env0-'));
    mkdirSync(join(envRoot, 'backlog'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Prompt\n', 'utf-8');
    process.env.VIBELOG_QWEN_BIN = writeEnvStub(envRoot, 'env0-stub.cjs');
    process.env.VL28_STUB_MARKER = join(envRoot, 'marker-env0.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPrompt(envRoot, 'привет');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('prompt');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(m.envPhaseTaskId, null, '/prompt не задачная фаза — env нет');
      assert.equal(m.envPhaseName, null);
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startPhase: close не получает задачный env (VL-112-гард, VL-114)', async () => {
    const envRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-envc-'));
    mkdirSync(join(envRoot, 'backlog'), { recursive: true });
    writeFileSync(join(envRoot, 'backlog', 'config.yml'), 'project_name: Env Close\n', 'utf-8');
    process.env.VIBELOG_QWEN_BIN = writeEnvStub(envRoot, 'envc-stub.cjs');
    process.env.VL28_STUB_MARKER = join(envRoot, 'marker-envc.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(envRoot, 'VL-88', 'close');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('VL-88');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(m.envPhaseTaskId, null, 'close всегда в главном репо — env нет (VL-112)');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it('startResume с worktreeTaskId: env несёт taskId задачи (VL-114)', async () => {
    const wtRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-wt2-'));
    const git = (args) => spawnSync('git', ['-C', wtRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(wtRoot, 'backlog'), { recursive: true });
    writeFileSync(join(wtRoot, 'backlog', 'config.yml'), 'project_name: WT Env\n', 'utf-8');
    mkdirSync(join(wtRoot, '.vibelog', 'agent-sessions'), { recursive: true });
    writeFileSync(join(wtRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
    const wtPath = join(wtRoot, '.vibelog', 'worktrees', 'vl-77');
    writeFileSync(
      join(wtRoot, '.vibelog', 'agent-sessions', 'agent-777.meta.json'),
      JSON.stringify({ taskId: 'VL-77', phase: 'code', cwd: wtPath }),
      'utf-8'
    );
    process.env.VIBELOG_QWEN_BIN = writeEnvStub(wtRoot, 'wt2-stub.cjs');
    process.env.VL28_STUB_MARKER = join(wtRoot, 'marker-wt2.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startResume(wtRoot, 'agent-777', 'продолжи');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('resume');
      assert.equal(run.exitCode, 0);
      const m = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(m.envPhaseTaskId, 'VL-77', 'resume с worktreeTaskId несёт taskId задачи');
      assert.equal(m.envPhaseName, 'prompt');
      assert.equal(m.envCwd, wtRoot, 'branch-mode: VIBELOG_CWD — главный репо');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
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
    const keys = ['VIBELOG_QWEN_BIN', 'VIBELOG_LLM_BASE_URL', 'VIBELOG_LLM_API_KEY', 'VIBELOG_LLM_MODEL', 'VIBELOG_BIN', 'VIBELOG_PHASE_TASK_ID', 'VIBELOG_PHASE_NAME'];
    const saved = {};
    for (const key of keys) saved[key] = process.env[key];
    process.env.VIBELOG_QWEN_BIN = agentBin;
    process.env.VIBELOG_LLM_BASE_URL = `http://127.0.0.1:${llmPort}/v1`;
    process.env.VIBELOG_LLM_API_KEY = 'test';
    process.env.VIBELOG_LLM_MODEL = 'test-model';
    process.env.VIBELOG_BIN = join(testRoot, 'no-such-vibelog');
    delete process.env.VIBELOG_PHASE_TASK_ID;
    delete process.env.VIBELOG_PHASE_NAME;
    try {
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
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise((r) => llmServer.close(r));
    }
  });
  it('branch-mode с task_prefix ot: worktree ot-5 и env OT-5 (VL-118)', async () => {
    // Регрессия хардкода VL: префикс задач проекта читается из конфига
    const otRoot = mkdtempSync(join(tmpdir(), 'vibelog-orch-ot-'));
    const git = (args) => spawnSync('git', ['-C', otRoot, ...args], { encoding: 'utf-8' });
    git(['init', '-q']);
    git(['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    mkdirSync(join(otRoot, 'backlog'), { recursive: true });
    writeFileSync(join(otRoot, 'backlog', 'config.yml'), 'project_name: OT Test\ntask_prefix: ot\n', 'utf-8');
    mkdirSync(join(otRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(otRoot, '.vibelog', 'bot.yml'), 'chats: []\nbranch_mode: true\n', 'utf-8');
    process.env.VIBELOG_QWEN_BIN = writeEnvStub(otRoot, 'ot-stub.cjs');
    process.env.VL28_STUB_MARKER = join(otRoot, 'marker-ot.txt');
    process.env.VL28_STUB_SLEEP = '0';
    process.env.VL28_STUB_EXIT = '0';
    try {
      const res = startPhase(otRoot, 'ot-5', 'code');
      assert.equal(res.started, true, JSON.stringify(res));
      const run = await waitDone('ot-5');
      assert.equal(run.exitCode, 0);
      const wtPath = join(otRoot, '.vibelog', 'worktrees', 'ot-5');
      assert.ok(existsSync(join(wtPath, '.git')), 'worktree ot-5 создаётся при чужом префиксе');
      const m = JSON.parse(readFileSync(process.env.VL28_STUB_MARKER, 'utf-8'));
      assert.equal(m.cwd, realpathSync(wtPath), 'фаза работает в worktree ot-5');
      assert.equal(m.envPhaseTaskId, 'OT-5', 'env несёт id по префиксу конфига');
      assert.equal(m.envCwd, otRoot, 'VIBELOG_CWD — главный репо');
    } finally {
      delete process.env.VL28_STUB_MARKER;
      process.env.VIBELOG_QWEN_BIN = stubBin;
      rmSync(otRoot, { recursive: true, force: true });
    }
  });
});
