/**
 * Тесты VL-298 — CLI `vibelog experiment judge` (doc-21 §4, §10, §11).
 *
 * Реальной сети НЕТ: LLM-провайдер подменён локальным `node:http`-сервером на
 * loopback (127.0.0.1) — fetch-guard (VL-132) пропускает loopback, а сам
 * сервер отдаёт валидный SSE-ответ Chat Completions. Это дороже мок-клиента,
 * но проверяет ВЕСЬ путь CLI: settings.json → createLlmClient → apiMode →
 * парс ответа → upsert `score` → `judge_usage`/`cost_judge` в meta.
 *
 * `apiMode` фиксирован в settings.json значением chat (lesson-78/84/145):
 * без явного api_mode модель с `api_mode: responses` уехала бы на /responses.
 * `cwd` теста — mkdtemp через testSpawnEnv (VL-286), иначе CLI ушёл бы на
 * главный репозиторий.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-judge-cli-'));
const backlogDir = join(testRoot, 'backlog');

/** Что вернёт мок-провайдер на следующий запрос; null — 500. */
let nextAnswer = '8/10';
let requests = 0;
let server;
let port = 0;
/** Первое тело запроса — для проверки, что промпт содержит expected_ac. */
let firstBody = '';

/** Фейковый провайдер Chat Completions: SSE-стрим с usage. */
function startServer() {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', async () => {
        requests += 1;
        if (requests === 1) firstBody = raw;
        if (nextAnswer === null) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'мок: сбой провайдера' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({
          choices: [{ delta: { content: nextAnswer } }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', async () => {
      port = server.address().port;
      resolve();
    });
  });
}

/**
 * Запуск CLI асинхронно (НЕ spawnSync!).
 *
 * Мок-провайдер живёт в этом же процессе: `spawnSync` заблокировал бы event
 * loop родителя, и сервер не смог бы ответить — дочерний процесс ждал бы
 * ответа до таймаута (проверено: прогон висел). `spawn` + await exit
 * оставляет loop живым, мок отвечает.
 */
function runCli(args) {
  return new Promise(resolve => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: testRoot, env: testSpawnEnv({ VIBELOG_SKIP_UPDATE_CHECK: 'true' }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

/** Читает results.jsonl прогона. */
function readResults(expId, run) {
  const path = join(backlogDir, 'experiments', expId, `run-${run}`, 'results.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l));
}

/** Читает meta.json прогона. */
function readMeta(expId, run) {
  return JSON.parse(readFileSync(
    join(backlogDir, 'experiments', expId, `run-${run}`, 'meta.json'), 'utf-8',
  ));
}

/** Пишет карточку эксперимента с judge-секцией. */
function writeExperiment(id, { judge, dataset = 'ds-1' } = {}) {
  const dir = join(backlogDir, 'experiments');
  mkdirSync(dir, { recursive: true });
  const lines = [
    '---',
    `id: ${id}`,
    `title: Эксперимент ${id}`,
    'status: running',
    'schema_version: 1',
    `dataset: ${dataset}`,
    'runner: manual',
    'metrics:',
    '  score_field: score',
    '  higher_is_better: true',
    '  baseline: A',
    '  custom: []',
    'variants:',
    '  A:',
    '    prompt: variant-a',
    '  B:',
    '    prompt: variant-b',
  ];
  if (judge !== undefined) {
    lines.push('judge:');
    for (const [k, v] of Object.entries(judge)) lines.push(`  ${k}: ${v}`);
  }
  lines.push('created_date: 2026-01-01', 'updated_date: 2026-01-01', '---', '', `# Эксперимент ${id}`, '');
  writeFileSync(join(dir, `${id}.md`), lines.join('\n'), 'utf-8');
}

/** Пишет meta.json рана (status running, manual). */
function writeMeta(id, run) {
  const runDir = join(backlogDir, 'experiments', id, `run-${run}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify({
    schema_version: 1,
    exp_id: id,
    run,
    status: 'running',
    runner: 'manual',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    pid: null,
    resolution: {},
    results_ignored: false,
    n: 0,
    dropped: 0,
    cost_total: null,
    pricing_missing: true,
    rerun_of: null,
    reason: null,
  }), 'utf-8');
  return runDir;
}

/** Пишет results.jsonl рана. */
function writeResults(id, run, rows) {
  const runDir = join(backlogDir, 'experiments', id, `run-${run}`);
  writeFileSync(join(runDir, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

beforeAll(async () => {
  await startServer();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  // Датасет: expected_ac нужен судье как эталон
  mkdirSync(join(backlogDir, 'experiments', 'datasets'), { recursive: true });
  writeFileSync(join(backlogDir, 'experiments', 'datasets', 'ds-1.jsonl'), [
    '{"task_id":"t1","expected_ac":"ЭТАЛОН-t1"}',
    '{"task_id":"t2","expected_ac":"ЭТАЛОН-t2"}',
    '',
  ].join('\n'), 'utf-8');
  // Модель судьи с pricing: проверяем cost_judge числом, а не null
  mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
  writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({
    providers: {
      mock: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test-key' },
    },
    models: {
      default: 'mock/judge',
      available: {
        'mock/judge': {
          label: 'Мок-судья',
          provider: 'mock',
          model: 'mock-judge-1',
          // api_mode явно: иначе тест зависел бы от локального settings.json
          api_mode: 'chat',
          pricing: { input_per_1m: 1, output_per_1m: 2, cache_per_1m: 0 },
        },
      },
    },
  }, null, 2), 'utf-8');
});

afterAll(() => {
  server?.close();
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-298 — CLI experiment judge', async () => {
  it('заполняет score в существующих строках (upsert) и пишет judge_usage/cost_judge в meta', async () => {
    writeExperiment('exp-1', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-1', 1);
    writeResults('exp-1', 1, [
      { task_id: 't1', variant: 'A', score: null, output: 'результат A1', cost: 0.5 },
      { task_id: 't2', variant: 'A', score: 4, output: 'результат A2' },
    ]);
    nextAnswer = '8/10';
    requests = 0;
    const res = await runCli(['experiment', 'judge', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);

    const rows = readResults('exp-1', 1);
    assert.equal(rows.length, 2, 'строк не добавилось — только правка score');
    assert.equal(rows[0].score, 8, '«8/10» распознано как 8');
    assert.equal(rows[1].score, 8, 'прежний score перезаписан результатом судьи');
    assert.equal(rows[0].output, 'результат A1', 'прочие поля строки сохранены');
    assert.equal(rows[0].cost, 0.5, 'cost варианта не тронут судьёй');

    const meta = readMeta('exp-1', 1);
    assert.deepEqual(meta.judge_usage, {
      input: 200, output: 40, cache: 0, total: 240, requests: 2,
    });
    // (200/1e6)*1 + (40/1e6)*2 = 0.0002 + 0.00008
    assert.equal(meta.cost_judge, 0.00028, 'cost_judge считается по тарифу модели судьи');
    assert.equal(meta.judge_pricing_missing, false);
    assert.equal(meta.judge_model, 'mock/judge');
    assert.equal(meta.cost_total, null, 'cost варианта и cost судьи не смешиваются');

    // Промпт судьи содержит эталон из датасета
    assert.ok(firstBody.includes('ЭТАЛОН-t1'), 'expected_ac попал в промпт судьи');
  });

  it('pass_fail: PASS/FAIL пишутся в score как 1/0', async () => {
    writeExperiment('exp-2', { judge: { enabled: true, scale: 'pass_fail', score_min: 0, score_max: 1 } });
    writeMeta('exp-2', 1);
    writeResults('exp-2', 1, [
      { task_id: 't1', variant: 'A', score: null, output: 'ok' },
    ]);
    nextAnswer = 'PASS';
    const res = await runCli(['experiment', 'judge', 'exp-2']);
    assert.equal(res.status, 0, res.stderr);
    const rows = readResults('exp-2', 1);
    assert.equal(rows[0].score, 1);
    assert.equal(typeof rows[0].score, 'number', 'pass_fail — число, не boolean');
  });

  it('ответ без разбираемой оценки: score остаётся null, error_kind=judge, exit 0', async () => {
    writeExperiment('exp-3', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-3', 1);
    writeResults('exp-3', 1, [
      { task_id: 't1', variant: 'A', score: null, output: 'что-то' },
    ]);
    nextAnswer = 'не могу оценить';
    const res = await runCli(['experiment', 'judge', 'exp-3']);
    assert.equal(res.status, 0, res.stderr);
    const rows = readResults('exp-3', 1);
    assert.equal(rows[0].score, null);
    assert.equal(rows[0].error_kind, 'judge');
    assert.match(rows[0].error, /не удалось разобрать/);
  });

  it('сбой провайдера: строка помечается error_kind=judge, прогон не роняется', async () => {
    writeExperiment('exp-4', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-4', 1);
    writeResults('exp-4', 1, [
      { task_id: 't1', variant: 'A', score: null, output: 'x' },
    ]);
    nextAnswer = null;
    const res = await runCli(['experiment', 'judge', 'exp-4']);
    // Ретраи мок-сервера заканчиваются ошибкой клиента; команда не падает
    assert.equal(res.status, 0, res.stderr);
    const rows = readResults('exp-4', 1);
    assert.equal(rows[0].score, null);
    assert.equal(rows[0].error_kind, 'judge');
  });

  it('нет секции judge в карточке → ошибка, exit 1', async () => {
    writeExperiment('exp-5');
    writeMeta('exp-5', 1);
    writeResults('exp-5', 1, [{ task_id: 't1', variant: 'A', score: null, output: 'x' }]);
    const res = await runCli(['experiment', 'judge', 'exp-5']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /нет секции judge/);
  });

  it('judge.enabled=false → ошибка, exit 1', async () => {
    writeExperiment('exp-6', { judge: { enabled: false, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-6', 1);
    writeResults('exp-6', 1, [{ task_id: 't1', variant: 'A', score: null, output: 'x' }]);
    const res = await runCli(['experiment', 'judge', 'exp-6']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /judge\.enabled=false/);
  });

  it('нет прогонов → ошибка с подсказкой experiment run', async () => {
    writeExperiment('exp-7', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    const res = await runCli(['experiment', 'judge', 'exp-7']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /нет прогонов/);
  });

  it('--run N проверяется по существующим прогонам', async () => {
    writeExperiment('exp-8', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-8', 1);
    writeResults('exp-8', 1, [{ task_id: 't1', variant: 'A', score: null, output: 'x' }]);
    const res = await runCli(['experiment', 'judge', 'exp-8', '--run', '7']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Прогон run-7 не найден/);
  });

  it('пустой results.jsonl → ошибка с подсказкой record', async () => {
    writeExperiment('exp-9', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-9', 1);
    const res = await runCli(['experiment', 'judge', 'exp-9']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /нет строк результатов/);
  });

  it('строка без output не оценивается — судья не вызывается', async () => {
    writeExperiment('exp-10', { judge: { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 } });
    writeMeta('exp-10', 1);
    writeResults('exp-10', 1, [{ task_id: 't1', variant: 'A', score: null }]);
    nextAnswer = '9';
    requests = 0;
    const res = await runCli(['experiment', 'judge', 'exp-10']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(requests, 0, 'нет output — нет запроса к провайдеру');
    const rows = readResults('exp-10', 1);
    assert.equal(rows[0].score, null);
    const meta = readMeta('exp-10', 1);
    assert.equal(meta.judge_usage.requests, 0);
  });
});
