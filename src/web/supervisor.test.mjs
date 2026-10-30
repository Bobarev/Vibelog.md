/**
 * Тесты прогона супервизора (VL-268): план, настройки, старт/стоп/статус.
 *
 * Спавн фаз подменяется stub-бином qwen (паттерн src/web/trigger-api.test.mjs):
 * настоящий агент в тестах запускать нельзя. Все процессы заглушки завершаются
 * мгновенно, после afterAll снимается env-база и удаляется каталог.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskFile, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { setSpawnEnvBaseForTests } from '../../dist/web/orchestrator.js';
import {
  buildGrantPreview,
  buildSupervisorPlan,
  formatSupervisorPlan,
  loadSupervisorSettings,
  startSupervisorRun,
  stopSupervisorRun,
  supervisorRunStatus,
} from '../../dist/web/supervisor.js';
import { findActiveGrant, writeGrant, GRANTABLE_TOOLS } from '../../dist/web/supervisor-grant.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-'));
const stubBin = join(testRoot, 'qwen-stub.cjs');

const STUB = `#!/usr/bin/env node
process.stdout.write('stub qwen\\n');
process.exit(0);
`;

/** Ожидание завершения запущенной фазы. */
async function waitIdle(ms = 4000) {
  await new Promise(r => setTimeout(r, ms));
}

beforeAll(() => {
  mkdirSync(join(testRoot, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(testRoot, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected', 'Completed'],
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

describe('VL-268 — buildSupervisorPlan (сухой прогон)', () => {
  it('порядок по приоритету, группы-волны по внутренним зависимостям', () => {
    const high = createTaskFile(testRoot, { title: 'Высокий', status: 'Spec', priority: 'High' });
    const low = createTaskFile(testRoot, { title: 'Низкий', status: 'Spec', priority: 'Low' });
    const medium = createTaskFile(testRoot, { title: 'Средний', status: 'Spec', priority: 'Medium' });
    updateTaskFile(testRoot, low.id, { dependencies: [high.id] });

    const plan = buildSupervisorPlan(testRoot, [low.id, medium.id, high.id]);
    assert.deepEqual(plan.taskIds.slice(0, 1), [high.id], 'High идёт первым');
    assert.equal(plan.order[0].phase, 'plan', 'Spec → plan');
    // high в волне 1, low зависит от high → волна 2
    assert.equal(plan.order.find(i => i.id === high.id).wave, 1);
    assert.equal(plan.order.find(i => i.id === low.id).wave, 2);
    assert.equal(plan.groups.length, 2);
    assert.ok(plan.rationale.includes('Волна 1'));
    assert.ok(formatSupervisorPlan(plan).includes(plan.runId));
  });

  it('терминальные и несуществующие задачи попадают в skipped с причиной', () => {
    const done = createTaskFile(testRoot, { title: 'Готова', status: 'Done' });
    const plan = buildSupervisorPlan(testRoot, [done.id, 'VL-999999']);
    assert.equal(plan.taskIds.length, 0);
    assert.equal(plan.skipped.length, 2);
    assert.ok(plan.skipped.some(s => s.id === 'VL-999999' && /не найдена/.test(s.reason)));
    assert.ok(plan.skipped.some(s => s.id === done.id && /терминальна/.test(s.reason)));
  });

  it('задача с внешним незавершённым блокером пропускается', () => {
    const blocker = createTaskFile(testRoot, { title: 'Блокер', status: 'Planned' });
    const dependent = createTaskFile(testRoot, { title: 'Зависимая', status: 'Spec' });
    updateTaskFile(testRoot, dependent.id, { dependencies: [blocker.id] });
    const plan = buildSupervisorPlan(testRoot, [dependent.id]);
    assert.equal(plan.taskIds.length, 0);
    assert.match(plan.skipped[0].reason, /заблокирована зависимостями/);
  });
});

describe('VL-268 — настройки прогона терпимы к мусору', () => {
  it('битая секция supervisor → дефолты + ошибка в списке', () => {
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { max_parallel_phases: 'много', default_ttl_hours: -5 },
    }), 'utf-8');
    const settings = loadSupervisorSettings(testRoot);
    assert.equal(settings.maxParallelPhases, 2);
    assert.equal(settings.defaultTtlHours, 8);
    assert.equal(settings.errors.length, 2);
    rmSync(join(testRoot, '.vibelog'), { recursive: true, force: true });
  });

  it('валидная секция применяется', () => {
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({
      supervisor: { max_parallel_phases: 3, default_ttl_hours: 4 },
    }), 'utf-8');
    const settings = loadSupervisorSettings(testRoot);
    assert.equal(settings.maxParallelPhases, 3);
    assert.equal(settings.defaultTtlHours, 4);
    assert.equal(settings.errors.length, 0);
    rmSync(join(testRoot, '.vibelog'), { recursive: true, force: true });
  });
});

describe('VL-268 — старт, статус и отзыв grant-а', () => {
  it('startSupervisorRun пишет grant и запускает фазу; stop отзывает', async () => {
    const task = createTaskFile(testRoot, { title: 'Прогон', status: 'Spec', priority: 'High' });
    const plan = buildSupervisorPlan(testRoot, [task.id]);
    assert.equal(plan.taskIds.length, 1);

    const grantedAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(grantedAt) + 3_600_000).toISOString();
    const res = startSupervisorRun(testRoot, plan, [...GRANTABLE_TOOLS], expiresAt, grantedAt);
    assert.equal(res.ok, true, res.message);
    assert.equal(res.runId, plan.runId);
    assert.ok(findActiveGrant(testRoot), 'grant записан и активен');
    assert.equal(res.startedTask, task.id);

    await waitIdle(1500);

    const stopped = stopSupervisorRun(testRoot, plan.runId);
    assert.equal(stopped.ok, true);
    assert.equal(findActiveGrant(testRoot), null, 'после stop активного grant-а нет');

    const status = supervisorRunStatus(testRoot);
    assert.equal(status.active, false);
    assert.ok(status.revokedAt);
  });

  it('startSupervisorRun без задач → отказ, grant не пишется', () => {
    const done = createTaskFile(testRoot, { title: 'Терминальна', status: 'Done' });
    const plan = buildSupervisorPlan(testRoot, [done.id]);
    const res = startSupervisorRun(testRoot, plan, [...GRANTABLE_TOOLS], '2030-01-01T00:00:00.000Z');
    assert.equal(res.ok, false);
    assert.match(res.message, /нет задач/);
    assert.equal(findActiveGrant(testRoot), null);
  });

  it('stopSupervisorRun без прогона → ok:false с понятным текстом', () => {
    // чистый каталог: без записей прогонов останавливать нечего
    const clean = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-clean-'));
    const res = stopSupervisorRun(clean);
    rmSync(clean, { recursive: true, force: true });
    assert.equal(res.ok, false);
    assert.match(res.message, /нечего/);
  });

  it('супервизор отзывает grant автоматически, когда все задачи терминальны', () => {
    const task = createTaskFile(testRoot, { title: 'Завершённая', status: 'Done' });
    writeGrant(testRoot, {
      runId: 'run-vl-268-auto-revoke',
      taskIds: [task.id],
      allowedTools: [...GRANTABLE_TOOLS],
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const status = supervisorRunStatus(testRoot);
    assert.equal(status.finished, true);
    assert.equal(status.autoRevoked, true);
    assert.equal(findActiveGrant(testRoot), null);
  });
});

describe('VL-268 — предпросмотр карточки grant', () => {
  it('buildGrantPreview отдаёт состав, волны, инструменты и срок', () => {
    const task = createTaskFile(testRoot, { title: 'Карточка', status: 'Spec' });
    const preview = buildGrantPreview(testRoot, [task.id], { expiresInHours: 2 });
    assert.equal(preview.taskIds.length, 1);
    assert.equal(preview.tools.length, GRANTABLE_TOOLS.length);
    assert.ok(preview.tools.every(t => t.enabled === true));
    assert.ok(!preview.tools.some(t => t.name === 'write_file'), 'write_file не grantable');
    const hours = (Date.parse(preview.expiresAt) - Date.parse(preview.grantedAt)) / 3_600_000;
    assert.equal(hours, 2);
    assert.ok(preview.rationale.length > 0);
    assert.equal(preview.maxParallelPhases, 2);
  });
});
