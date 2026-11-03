/**
 * Тесты ai-phase runner экспериментов (VL-299, doc-21 §11–§14).
 *
 * Спавн рана подменяется моком (`spawnRun`): тесты проверяют логику
 * изоляции/стоимости/ошибок, а не работу агента. Реальный git-worktree
 * создаётся в mkdtemp-репозитории — откат между задачами проверяется по
 * фактическому состоянию дерева (это и есть главный риск фичи).
 *
 * env дочерних процессов собирается только через `testSpawnEnv()` (VL-286):
 * иначе унаследованный VIBELOG_CWD/VIBELOG_PHASE_* уводит запись в реальный
 * репозиторий агентской сессии.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runAiPhaseExperiment, assertNoActiveRun, ExperimentRunError,
  DEFAULT_TASK_TIMEOUT_SEC, toolCallsFromSession, buildRunEnv,
} from '../core/experiment-runner.js';
import { writeExperiment, readMetaJson, runDirFor } from '../core/experiment.js';
import { resultsPath, readResultsFile } from '../core/results.js';
import { experimentWorktreeDir } from '../core/worktree.js';
import { parseExperimentMarker, billingSuppressed, EXPERIMENT_ENV } from '../core/billing.js';
import { testSpawnEnv } from '../test-env.mjs';

/** git-репозиторий с backlog и одним коммитом (база для worktree прогона). */
function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'backlog', 'experiments', 'datasets'), { recursive: true });
  writeFileSync(join(dir, 'backlog', 'config.yml'), 'project_name: Exp Runner\n', 'utf-8');
  writeFileSync(join(dir, 'README.md'), 'base\n', 'utf-8');
  const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: dir, encoding: 'utf-8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/** Пишет датасет из строк task_id. */
function writeDataset(dir, name, taskIds) {
  const body = taskIds.map(id => JSON.stringify({ task_id: id, expected_ac: `ожидание ${id}` })).join('\n') + '\n';
  writeFileSync(join(dir, 'backlog', 'experiments', 'datasets', `${name}.jsonl`), body, 'utf-8');
}

/** Создаёт карточку эксперимента с вариантами A/B. */
function makeExperiment(dir, over = {}) {
  return writeExperiment(join(dir, 'backlog'), {
    title: 'Тестовый эксперимент',
    dataset: 'ds',
    runner: 'ai-phase',
    variants: {
      A: { prompt: 'builtin:spec', model: 'prov/a' },
      B: { prompt: 'builtin:spec', model: 'prov/b' },
    },
    ...over,
  });
}

/** Мок-спавн: пишет файл в worktree (проверка отката) и отдаёт stdout-результат. */
function mockSpawn(over = {}) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    // «Вариант пишет файл» — откат обязан его удалить до следующей задачи
    writeFileSync(join(params.cwd, 'variant-output.txt'), 'грязь варианта\n', 'utf-8');
    const stdout = JSON.stringify({
      type: 'result',
      result: 'готово',
      is_error: false,
      num_turns: 3,
      tool_calls_total: 7,
      duration_ms: 1000,
      duration_api_ms: 900,
      session_id: 'agent-test',
      usage: {
        input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0,
        total_tokens: 1500, reasoning_tokens: 0,
      },
    });
    return { code: 0, stdout, stderr: '', timedOut: false, interrupted: false, ...over };
  };
  fn.calls = calls;
  return fn;
}

describe('experiment-runner (VL-299)', () => {
  let dir;
  beforeEach(() => {
    dir = makeRepo('vibelog-exp-runner-');
    writeDataset(dir, 'ds', ['t1', 't2']);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('прогон идёт в отдельном worktree, после каждой задачи — откат (reset --hard + clean -fd)', async () => {
    const exp = makeExperiment(dir);
    const spawnRun = mockSpawn();
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun,
    });

    expect(result.status).toBe('completed');
    // 2 строки × 2 варианта = 4 рана
    expect(spawnRun.calls).toHaveLength(4);
    const wt = experimentWorktreeDir(dir, exp.id, result.run);
    for (const call of spawnRun.calls) {
      expect(call.cwd).toBe(wt);
      // env-маркер эксперимента обязателен в каждом ране
      expect(call.env[EXPERIMENT_ENV]).toBe(`${exp.id}/run-${result.run}`);
    }
    // Откат сработал: файл, который «писал» вариант, в worktree отсутствует
    expect(existsSync(join(wt, 'variant-output.txt'))).toBe(false);
    // worktree удалён в конце прогона
    expect(existsSync(wt)).toBe(false);
    // results.jsonl содержит 4 строки (upsert по (task_id, variant))
    const parsed = readResultsFile(resultsPath(result.runDir));
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.every(r => r.tool_calls === 7)).toBe(true);
  });

  it('cost считается по модели варианта; нет pricing → cost: null и pricing_missing', async () => {
    // settings.json: тариф только у модели A
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({
      providers: { p: { base_url: 'http://127.0.0.1:1/v1' } },
      models: {
        default: 'prov/a',
        available: {
          'prov/a': { provider: 'p', model: 'a', pricing: { input_per_1m: 1, output_per_1m: 2, cache_per_1m: 0 } },
          'prov/b': { provider: 'p', model: 'b' },
        },
      },
    }), 'utf-8');
    const exp = makeExperiment(dir);
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun: mockSpawn(),
    });

    const rows = readResultsFile(resultsPath(result.runDir)).rows;
    const a = rows.filter(r => r.variant === 'A');
    const b = rows.filter(r => r.variant === 'B');
    // A: 1000/1e6*1 + 500/1e6*2 = 0.001 + 0.001 = 0.002
    expect(a.every(r => r.cost === 0.002)).toBe(true);
    // B: тарифа нет → null (НЕ 0: ноль означал бы «бесплатен»)
    expect(b.every(r => r.cost === null)).toBe(true);
    expect(result.pricingMissing).toBe(true);
    const meta = readMetaJson(result.runDir);
    expect(meta.pricing_missing).toBe(true);
    // cost_total — только по известным тарифам
    expect(meta.cost_total).toBe(0.004);
  });

  it('timeout задачи → строка с error_kind=timeout, прогон продолжается', async () => {
    const exp = makeExperiment(dir);
    let n = 0;
    const spawnRun = async (params) => {
      n += 1;
      const base = await mockSpawn()(params);
      // первый ран — таймаут
      return n === 1 ? { ...base, code: null, timedOut: true } : base;
    };
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun,
    });
    const rows = readResultsFile(resultsPath(result.runDir)).rows;
    expect(rows).toHaveLength(4);
    const timedOut = rows.filter(r => r.error_kind === 'timeout');
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].task_id).toBe('t1');
    expect(timedOut[0].variant).toBe('A');
    // прогон не прерван: остальные строки без ошибок
    expect(rows.filter(r => !r.error_kind)).toHaveLength(3);
    expect(result.status).toBe('completed');
  });

  it('SIGINT → status failed с частичными results', async () => {
    const exp = makeExperiment(dir);
    const spawnRun = async (params) => {
      const base = await mockSpawn()(params);
      // Прерывание приходит во время первого рана
      process.emit('SIGINT');
      return { ...base, code: null, interrupted: true };
    };
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun,
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/прерван/);
    const meta = readMetaJson(result.runDir);
    expect(meta.status).toBe('failed');
    expect(meta.finished_at).not.toBeNull();
    // частичные results сохранены (первая строка успела записаться)
    const rows = readResultsFile(resultsPath(result.runDir)).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].error_kind).toBe('interrupted');
  });

  it('--dry-run: матрица и оценка стоимости, ран не создаётся', async () => {
    const exp = makeExperiment(dir);
    const lines = [];
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id,
      dryRun: true, onProgress: (l) => lines.push(l),
      spawnRun: async () => { throw new Error('спавн не должен вызываться в dry-run'); },
    });
    expect(result.status).toBe('dry-run');
    expect(result.run).toBeNull();
    const text = lines.join('\n');
    expect(text).toMatch(/прогонов \(строк × вариантов\): 4/);
    // данных прошлых ранов нет → «оценки нет»
    expect(text).toMatch(/оценки нет/);
    // ран не создан
    expect(existsSync(runDirFor(join(dir, 'backlog'), exp.id, 1))).toBe(false);
  });

  it('lock: второй прогон при живом pid — отказ, не очередь', async () => {
    const exp = makeExperiment(dir);
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun: mockSpawn(),
    });
    // эмулируем «прогон идёт»: meta последнего рана с живым pid
    const runDir = runDirFor(join(dir, 'backlog'), exp.id, result.run);
    const meta = readMetaJson(runDir);
    writeFileSync(join(runDir, 'meta.json'), JSON.stringify({
      ...meta, status: 'running', finished_at: null, pid: process.pid,
    }), 'utf-8');
    expect(() => assertNoActiveRun(join(dir, 'backlog'), exp.id)).toThrow(ExperimentRunError);
    await expect(runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun: mockSpawn(),
    })).rejects.toThrow(/уже идёт/);
  });

  it('дефолтный таймаут задачи — 600 с; timeout_sec карточки переопределяет', async () => {
    expect(DEFAULT_TASK_TIMEOUT_SEC).toBe(600);
    const exp = makeExperiment(dir, { timeout_sec: 42 });
    const spawnRun = mockSpawn();
    await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun,
    });
    // --max-wall-time рана = timeout_sec карточки
    expect(spawnRun.calls[0].args).toContain('42');
    expect(spawnRun.calls[0].timeoutMs).toBe(42000);
  });

  it('tool_calls: fallback на countToolCallsInMessages по jsonl сессии', async () => {
    const exp = makeExperiment(dir);
    // Ран без tool_calls_total в stdout, но с jsonl сессии
    const sessionsDir = join(dir, '.vibelog', 'agent-sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'agent-test.jsonl'), [
      JSON.stringify({ role: 'assistant', content: '', tool_calls: [{ id: '1', name: 'read_file', arguments: '{}' }] }),
      JSON.stringify({ role: 'assistant', content: '', tool_calls: [{ id: '2', name: 'edit', arguments: '{}' }] }),
    ].join('\n') + '\n', 'utf-8');
    const spawnRun = async (params) => {
      writeFileSync(join(params.cwd, 'x.txt'), 'x', 'utf-8');
      return {
        code: 0,
        stdout: JSON.stringify({
          type: 'result', result: 'ok', is_error: false, num_turns: 2,
          duration_ms: 10, duration_api_ms: 10, session_id: 'agent-test',
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2, reasoning_tokens: 0 },
        }),
        stderr: '', timedOut: false, interrupted: false,
      };
    };
    const result = await runAiPhaseExperiment({
      cwd: dir, backlogDir: join(dir, 'backlog'), expId: exp.id, spawnRun,
    });
    const rows = readResultsFile(resultsPath(result.runDir)).rows;
    expect(rows.every(r => r.tool_calls === 2)).toBe(true);
    expect(toolCallsFromSession(dir, 'agent-test')).toBe(2);
    // нет сессии → undefined («нет данных», не 0)
    expect(toolCallsFromSession(dir, 'agent-missing')).toBeUndefined();
  });
});

describe('billing: подавление для эксперимента (VL-299)', () => {
  it('parseExperimentMarker разбирает exp-<id>/run-<N> и отвергает мусор', () => {
    expect(parseExperimentMarker('exp-1/run-3')).toEqual({ expId: 'exp-1', run: 3 });
    expect(parseExperimentMarker('exp-12/run-1')).toEqual({ expId: 'exp-12', run: 1 });
    expect(parseExperimentMarker('')).toBeNull();
    expect(parseExperimentMarker('exp-1')).toBeNull();
    expect(parseExperimentMarker('exp-1/run-0')).toBeNull();
    expect(parseExperimentMarker('run-1/exp-1')).toBeNull();
  });

  it('billingSuppressed смотрит на env-маркер', () => {
    expect(billingSuppressed({})).toBe(false);
    expect(billingSuppressed({ [EXPERIMENT_ENV]: 'exp-2/run-5' })).toBe(true);
    expect(billingSuppressed({ [EXPERIMENT_ENV]: 'мусор' })).toBe(false);
  });

  it('buildRunEnv ставит маркер и снимает фазовый env родителя', () => {
    const env = buildRunEnv(
      testSpawnEnv({ VIBELOG_PHASE_TASK_ID: 'VL-1', VIBELOG_PHASE_NAME: 'code', VIBELOG_RUN_PHASE: 'code' }),
      'exp-1', 2, 't1', 'A', '/main'
    );
    expect(env[EXPERIMENT_ENV]).toBe('exp-1/run-2');
    expect(env.VIBELOG_EXPERIMENT_TASK_ID).toBe('t1');
    expect(env.VIBELOG_EXPERIMENT_VARIANT).toBe('A');
    expect(env.VIBELOG_CWD).toBe('/main');
    expect(env.VIBELOG_PHASE_TASK_ID).toBeUndefined();
    expect(env.VIBELOG_PHASE_NAME).toBeUndefined();
    expect(env.VIBELOG_RUN_PHASE).toBeUndefined();
  });
});
