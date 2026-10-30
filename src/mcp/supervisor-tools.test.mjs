/**
 * Тесты MCP-инструментов супервизора (VL-268, AC1/AC3/AC5/AC6/AC14).
 *
 * Проверяется:
 * - регистрация 4 инструментов в реестре (listTools) с русскими описаниями и
 *   полными inputSchema (properties + required);
 * - валидация на границе: нет id/action/ids → {ok:false,error} без исключений;
 * - backlog_auto_queue: add с дедупликацией ядра (pending → skipped, done → реанимация);
 * - backlog_supervisor plan — сухой прогон (grant не пишется, фаза не спавнится);
 * - backlog_trigger_phase: недопустимая фаза и «фаза уже идёт» дают разные тексты.
 *
 * Спавн заглушается stub-бином (паттерн trigger-api.test.mjs).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { loadAutoQueue } from '../../dist/core/auto-queue.js';
import { setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import { findActiveGrant } from '../../dist/web/supervisor-grant.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-tools-'));
const stubBin = join(testRoot, 'qwen-stub.cjs');

/** Заглушка qwen: печатает строку, сразу выходит. */
const STUB = `#!/usr/bin/env node
process.stdout.write('stub qwen\\n');
process.exit(0);
`;

/** Разбор JSON-ответа инструмента (все пути отвечают JSON). */
function parse(out) {
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

beforeAll(() => {
  mkdirSync(join(testRoot, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(testRoot, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Tools Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected'],
    definition_of_done: [],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'task'],
  }), 'utf-8');
  writeFileSync(stubBin, STUB, 'utf-8');
  chmodSync(stubBin, 0o755);
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('VIBELOG_')) continue;
    env[k] = v;
  }
  env.VIBELOG_QWEN_BIN = stubBin;
  env.VIBELOG_AGENT_BIN = stubBin;
  setSpawnEnvBaseForTests(env);
});

afterAll(() => {
  setSpawnEnvBaseForTests(null);
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-268 — регистрация и схемы 4 инструментов (AC1)', () => {
  const NAMES = [
    'backlog_trigger_phase',
    'backlog_phase_status',
    'backlog_auto_queue',
    'backlog_supervisor',
  ];

  it('все 4 инструмента есть в MCP-реестре', () => {
    const names = listTools().map(t => t.name);
    for (const name of NAMES) assert.ok(names.includes(name), `${name} не зарегистрирован`);
  });

  it('описания на русском и непустые', () => {
    const tools = new Map(listTools().map(t => [t.name, t]));
    for (const name of NAMES) {
      const tool = tools.get(name);
      assert.ok(tool);
      assert.ok(tool.description.length > 40, `${name}: описание слишком короткое`);
      assert.match(tool.description, /[а-яА-ЯёЁ]/, `${name}: описание должно быть на русском`);
    }
  });

  it('inputSchema полный: properties + required', () => {
    const tools = new Map(listTools().map(t => [t.name, t]));
    const expected = {
      backlog_trigger_phase: { props: ['id', 'phase', 'comment', 'sameSession'], required: ['id'] },
      backlog_phase_status: { props: ['id'], required: ['id'] },
      backlog_auto_queue: { props: ['action', 'ids'], required: ['action'] },
      backlog_supervisor: { props: ['action', 'ids', 'expiresInHours', 'expiresAt'], required: ['action'] },
    };
    for (const [name, spec] of Object.entries(expected)) {
      const tool = tools.get(name);
      assert.equal(tool.inputSchema.type, 'object');
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [...spec.props].sort());
      assert.deepEqual([...tool.inputSchema.required].sort(), [...spec.required].sort());
    }
  });
});

describe('VL-268 — валидация на границе (AC3, без исключений)', () => {
  it('backlog_trigger_phase без id → {ok:false,error}', async () => {
    const out = parse(await handleToolCall('backlog_trigger_phase', {}, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /id/);
  });

  it('backlog_trigger_phase: несуществующая задача → отдельный текст', async () => {
    const out = parse(await handleToolCall('backlog_trigger_phase', { id: 'VL-999999' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /не найдена/);
  });

  it('backlog_phase_status без id → ошибка; с id — JSON-состояние', async () => {
    const bad = parse(await handleToolCall('backlog_phase_status', {}, testRoot));
    assert.equal(bad.ok, false);
    const task = createTaskFile(testRoot, { title: 'Статус', status: 'Spec' });
    const out = JSON.parse(await handleToolCall('backlog_phase_status', { id: task.id }, testRoot));
    assert.equal(out.id, task.id);
    assert.equal(out.running, false);
    assert.ok('repeat_stats' in out, 'repeat_stats присутствует (null без сессий)');
  });

  it('backlog_auto_queue без action / неизвестный action → ошибки', async () => {
    const bad = parse(await handleToolCall('backlog_auto_queue', {}, testRoot));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /action/);
    const unknown = parse(await handleToolCall('backlog_auto_queue', { action: 'взорвать' }, testRoot));
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /add \| start \| stop \| status/);
  });

  it('backlog_supervisor без action и plan без ids → понятные ошибки', async () => {
    const bad = parse(await handleToolCall('backlog_supervisor', {}, testRoot));
    assert.equal(bad.ok, false);
    const noIds = parse(await handleToolCall('backlog_supervisor', { action: 'plan' }, testRoot));
    assert.equal(noIds.ok, false);
    assert.match(noIds.error, /ids/);
  });

  it('backlog_supervisor start без ids и без draft → «нужен ids»', async () => {
    const out = parse(await handleToolCall('backlog_supervisor', { action: 'start' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /ids/);
  });
});

describe('VL-268 — backlog_auto_queue (AC5)', () => {
  it('add: pending → пропуск, done → реанимация в pending', async () => {
    const first = createTaskFile(testRoot, { title: 'Первая', status: 'To Do' });
    const added = parse(await handleToolCall('backlog_auto_queue', { action: 'add', ids: [first.id] }, testRoot));
    assert.equal(added.ok, true);
    assert.deepEqual(added.applied.added, [first.id]);

    // повторный add той же pending-задачи → skipped
    const again = parse(await handleToolCall('backlog_auto_queue', { action: 'add', ids: [first.id] }, testRoot));
    assert.equal(again.ok, true);
    const queue = loadAutoQueue(testRoot);
    assert.equal(queue.tasks.filter(t => t.id === first.id).length, 1, 'дубля нет');
  });

  it('start/stop переключают running, status отдаёт очередь', async () => {
    const start = parse(await handleToolCall('backlog_auto_queue', { action: 'start' }, testRoot));
    assert.equal(start.ok, true);
    assert.equal(loadAutoQueue(testRoot).running, true);
    const stop = parse(await handleToolCall('backlog_auto_queue', { action: 'stop' }, testRoot));
    assert.equal(stop.ok, true);
    assert.equal(loadAutoQueue(testRoot).running, false);
    const status = JSON.parse(await handleToolCall('backlog_auto_queue', { action: 'status' }, testRoot));
    assert.equal(typeof status.running, 'boolean');
    assert.ok(Array.isArray(status.tasks));
  });
});

describe('VL-268 — backlog_supervisor plan — сухой прогон (AC6)', () => {
  it('plan показывает состав и порядок, но НЕ пишет grant и не спавнит фазу', async () => {
    const task = createTaskFile(testRoot, { title: 'План', status: 'Spec', priority: 'High' });
    const out = await handleToolCall('backlog_supervisor', { action: 'plan', ids: [task.id] }, testRoot);
    assert.match(out, /Прогон run-/);
    assert.match(out, /Волна 1/);
    assert.equal(findActiveGrant(testRoot), null, 'plan не выдаёт grant');
    // задача не перешла в другой статус — фаза не запускалась
    const fresh = (await import('../../dist/core/store.js')).getTask(testRoot, task.id);
    assert.equal(fresh.status, 'Spec');
  });
});

describe('VL-268 — backlog_trigger_phase: фазы и ошибки', () => {
  it('без phase берётся первая по workflow (Spec → plan) и фаза запускается', async () => {
    const task = createTaskFile(testRoot, { title: 'Запуск', status: 'Spec' });
    const out = parse(await handleToolCall('backlog_trigger_phase', { id: task.id }, testRoot));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.applied.phase, 'plan');
    await new Promise(r => setTimeout(r, 1200));
  });

  it('недопустимая фаза из статуса → текст со списком разрешённых', async () => {
    const task = createTaskFile(testRoot, { title: 'Фаза', status: 'Spec' });
    const out = parse(await handleToolCall('backlog_trigger_phase', { id: task.id, phase: 'close' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /недопустима из статуса Spec/);
    assert.match(out.error, /plan/);
  });

  it('фаза comment без комментария → ошибка валидации', async () => {
    const task = createTaskFile(testRoot, { title: 'Комментарий', status: 'Spec' });
    const out = parse(await handleToolCall('backlog_trigger_phase', { id: task.id, phase: 'comment' }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /comment/);
  });

  it('фаза уже идёт → отдельное сообщение «Фаза уже идёт»', async () => {
    const task = createTaskFile(testRoot, { title: 'Занята', status: 'Spec' });
    const first = parse(await handleToolCall('backlog_trigger_phase', { id: task.id }, testRoot));
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = parse(await handleToolCall('backlog_trigger_phase', { id: task.id }, testRoot));
    assert.equal(second.ok, false);
    assert.match(second.error, /уже идёт|Запуск уже выполняется/);
    await new Promise(r => setTimeout(r, 1200));
  });

  it('задача вне grant-а прогона → отказ с предложением расширить', async () => {
    const inside = createTaskFile(testRoot, { title: 'В прогоне', status: 'Spec' });
    const outside = createTaskFile(testRoot, { title: 'Вне прогона', status: 'Spec' });
    const { writeGrant, GRANTABLE_TOOLS } = await import('../../dist/web/supervisor-grant.js');
    writeGrant(testRoot, {
      runId: 'run-vl-268-tools',
      taskIds: [inside.id],
      allowedTools: [...GRANTABLE_TOOLS],
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const out = parse(await handleToolCall('backlog_trigger_phase', { id: outside.id }, testRoot));
    assert.equal(out.ok, false);
    assert.match(out.error, /вне прогона/);
    // снимаем grant, чтобы не влиять на другие тесты файла
    const { revokeGrant } = await import('../../dist/web/supervisor-grant.js');
    revokeGrant(testRoot, 'run-vl-268-tools', 'конец теста');
  });

  it('превышен max_parallel_phases → отдельный текст', async () => {
    // лимит 1 в настройках проекта; запускаем две фазы разных задач подряд
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { max_parallel_phases: 1 },
    }), 'utf-8');
    const a = createTaskFile(testRoot, { title: 'Параллель A', status: 'Spec' });
    const b = createTaskFile(testRoot, { title: 'Параллель B', status: 'Spec' });
    const first = parse(await handleToolCall('backlog_trigger_phase', { id: a.id }, testRoot));
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = parse(await handleToolCall('backlog_trigger_phase', { id: b.id }, testRoot));
    assert.equal(second.ok, false);
    assert.match(second.error, /лимит параллельных фаз/);
    await new Promise(r => setTimeout(r, 1200));
    rmSync(join(testRoot, '.vibelog', 'settings.json'), { force: true });
  });
});
