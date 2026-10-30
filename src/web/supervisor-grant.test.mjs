/**
 * Тесты grant-механизма супервизора (VL-268, doc-19 §15).
 *
 * Проверяется ровно то, что обещано в AC7–AC9/AC11:
 * - формат файла grant'а и TTL (дефолт 8 ч, явный expiresAt, мусор → ошибка);
 * - истечение срока и отзыв (findActiveGrant перестаёт видеть);
 * - задача вне taskIds отклоняется с предложением расширить прогон;
 * - инструмент вне allowedTools идёт обычным Allow/Deny;
 * - write_file/edit НИКОГДА не попадают в grant (sanitizeTools + GRANTABLE_TOOLS);
 * - draft не считается активным grant'ом и не запускает прогон.
 *
 * Каталог — mkdtemp (AGENTS.md: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_GRANT_TTL_HOURS,
  GRANTABLE_TOOLS,
  checkSupervisorGrant,
  clearGrantDraft,
  computeExpiresAt,
  findActiveGrant,
  grantPath,
  isGrantActive,
  isGrantExpired,
  latestGrantDraft,
  listGrants,
  loadGrant,
  makeRunId,
  revokeGrant,
  sanitizeTools,
  saveGrantDraft,
  taskIdsOfArgs,
  writeGrant,
} from '../../dist/web/supervisor-grant.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-grant-'));

/** Готовый grant: 2 задачи, все grantable-инструменты, срок в будущем. */
function baseGrant(runId, overrides = {}) {
  const grantedAt = new Date('2026-10-31T21:58:00Z').toISOString();
  return {
    runId,
    taskIds: ['VL-263', 'VL-264'],
    allowedTools: [...GRANTABLE_TOOLS],
    grantedAt,
    expiresAt: '2026-11-01T06:00:00.000Z',
    ...overrides,
  };
}

beforeAll(() => {
  rmSync(join(testRoot, 'backlog'), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // каждый тест — чистый каталог grant'ов
  rmSync(join(testRoot, '.vibelog'), { recursive: true, force: true });
});

describe('VL-268 — формат grant-файла и TTL', () => {
  it('writeGrant пишет файл .vibelog/supervisor/grants/<runId>.json со всеми полями', () => {
    const grant = baseGrant('run-2026-10-31T21-58-00');
    writeGrant(testRoot, grant);
    const path = grantPath(testRoot, grant.runId);
    assert.ok(existsSync(path), 'файл grant-а должен существовать');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(raw.runId, grant.runId);
    assert.deepEqual(raw.taskIds, grant.taskIds);
    assert.deepEqual(raw.allowedTools, grant.allowedTools);
    assert.equal(raw.grantedAt, grant.grantedAt);
    assert.equal(raw.expiresAt, grant.expiresAt);
    // ISO 8601 парсится — контракт полей дат
    assert.ok(!Number.isNaN(Date.parse(raw.grantedAt)));
    assert.ok(!Number.isNaN(Date.parse(raw.expiresAt)));
  });

  it('makeRunId даёт run-<ISO без двоеточий и миллисекунд>', () => {
    const runId = makeRunId(new Date('2026-10-31T22:00:00.123Z'));
    assert.equal(runId, 'run-2026-10-31T22-00-00');
  });

  it('computeExpiresAt: дефолт 8 часов от момента выдачи', () => {
    const grantedAt = '2026-10-31T22:00:00.000Z';
    const res = computeExpiresAt(grantedAt);
    assert.ok('expiresAt' in res);
    const diffHours = (Date.parse(res.expiresAt) - Date.parse(grantedAt)) / 3_600_000;
    assert.equal(diffHours, DEFAULT_GRANT_TTL_HOURS);
  });

  it('computeExpiresAt: expiresInHours задаёт TTL, явный expiresAt приоритетнее', () => {
    const grantedAt = '2026-10-31T22:00:00.000Z';
    const twoHours = computeExpiresAt(grantedAt, 2);
    assert.equal(Date.parse(twoHours.expiresAt), Date.parse('2026-11-01T00:00:00.000Z'));
    const explicit = computeExpiresAt(grantedAt, 2, '2026-11-01T04:00:00.000Z');
    assert.equal(explicit.expiresAt, '2026-11-01T04:00:00.000Z');
  });

  it('computeExpiresAt: мусор → понятная ошибка (не «вечный» grant)', () => {
    const grantedAt = '2026-10-31T22:00:00.000Z';
    assert.ok('error' in computeExpiresAt(grantedAt, -1));
    assert.ok('error' in computeExpiresAt(grantedAt, 'много'));
    assert.ok('error' in computeExpiresAt(grantedAt, undefined, 'не дата'));
    assert.ok('error' in computeExpiresAt(grantedAt, undefined, '2020-01-01T00:00:00Z'), 'срок в прошлом');
  });

  it('битый grant-файл → loadGrant null (fail-closed)', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId));
    writeFileSync(grantPath(testRoot, runId), '{не json', 'utf8');
    assert.equal(loadGrant(testRoot, runId), null);
    assert.equal(findActiveGrant(testRoot), null);
  });
});

describe('VL-268 — истечение и отзыв', () => {
  it('истёкший expiresAt не считается активным и требует подтверждения', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId, { expiresAt: '2026-10-31T23:00:00.000Z' }));
    const now = new Date('2026-11-01T00:30:00.000Z');
    const grant = loadGrant(testRoot, runId);
    assert.ok(grant);
    assert.equal(isGrantExpired(grant, now), true);
    assert.equal(isGrantActive(grant, now), false);
    assert.equal(findActiveGrant(testRoot, now), null);
    const verdict = checkSupervisorGrant(testRoot, 'backlog_trigger_phase', { id: 'VL-263' }, now);
    assert.equal(verdict.granted, false);
    assert.equal(verdict.needsApproval, true);
    assert.equal(verdict.expired, true);
  });

  it('отзыв: revokedAt записан, findActiveGrant пуст, вызовы снова требуют Allow/Deny', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId));
    const now = new Date('2026-10-31T23:00:00.000Z');
    assert.equal(findActiveGrant(testRoot, now)?.runId, runId);

    const revoked = revokeGrant(testRoot, runId, 'остановлен пользователем');
    assert.ok(revoked);
    assert.ok(typeof revoked.revokedAt === 'string');
    assert.equal(revoked.revokeReason, 'остановлен пользователем');
    assert.equal(findActiveGrant(testRoot, now), null);

    const verdict = checkSupervisorGrant(testRoot, 'backlog_supervisor', { action: 'plan' }, now);
    assert.equal(verdict.granted, false);
    assert.equal(verdict.needsApproval, true);
  });

  it('listGrants отдаёт свежие первыми и не считает draft grant-ом', () => {
    writeGrant(testRoot, baseGrant('run-2026-10-31T20-00-00', { grantedAt: '2026-10-31T20:00:00.000Z' }));
    writeGrant(testRoot, baseGrant('run-2026-10-31T22-00-00', { grantedAt: '2026-10-31T22:00:00.000Z' }));
    saveGrantDraft(testRoot, {
      runId: 'run-2026-10-31T23-00-00',
      taskIds: ['VL-1'],
      allowedTools: ['backlog_trigger_phase'],
      expiresAt: '2026-11-01T06:00:00.000Z',
    });
    const list = listGrants(testRoot);
    assert.equal(list.length, 2);
    assert.equal(list[0].runId, 'run-2026-10-31T22-00-00');
  });
});

describe('VL-268 — проверка перед вызовом: задачи и инструменты', () => {
  it('задача внутри taskIds → granted; вне — отказ с предложением расширить прогон', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId));
    const now = new Date('2026-10-31T23:00:00.000Z');

    const inside = checkSupervisorGrant(testRoot, 'backlog_trigger_phase', { id: 'vl-263' }, now);
    assert.equal(inside.granted, true, 'регистр ID не важен');
    assert.equal(inside.runId, runId);

    const outside = checkSupervisorGrant(testRoot, 'backlog_trigger_phase', { id: 'VL-999' }, now);
    assert.equal(outside.granted, false);
    assert.match(outside.error, /вне прогона/);
    assert.match(outside.error, /расширить прогон/);
  });

  it('ids-массив тоже сверяется с taskIds (JSON-строка массива принимается)', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId));
    const now = new Date('2026-10-31T23:00:00.000Z');
    const ok = checkSupervisorGrant(testRoot, 'backlog_supervisor', { action: 'plan', ids: ['VL-263', 'VL-264'] }, now);
    assert.equal(ok.granted, true);
    const bad = checkSupervisorGrant(testRoot, 'backlog_auto_queue', { action: 'add', ids: '["VL-263","VL-777"]' }, now);
    assert.equal(bad.granted, false);
    assert.match(bad.error, /VL-777/);
  });

  it('инструмент вне allowedTools → needsApproval (обычный Allow/Deny)', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId, { allowedTools: ['backlog_trigger_phase'] }));
    const now = new Date('2026-10-31T23:00:00.000Z');
    const verdict = checkSupervisorGrant(testRoot, 'backlog_auto_queue', { action: 'status' }, now);
    assert.equal(verdict.granted, false);
    assert.equal(verdict.needsApproval, true);
    assert.equal(verdict.error, undefined);
  });

  it('backlog_create_task сверке taskIds не подлежит (нет аргумента задачи)', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId, {
      allowedTools: ['backlog_create_task'],
    }));
    const now = new Date('2026-10-31T23:00:00.000Z');
    const verdict = checkSupervisorGrant(testRoot, 'backlog_create_task', { title: 'баг из прогона' }, now);
    assert.equal(verdict.granted, true);
  });

  it('нет grant-а → needsApproval (страховка: без подтверждения не запускаем)', () => {
    const verdict = checkSupervisorGrant(testRoot, 'backlog_trigger_phase', { id: 'VL-263' });
    assert.equal(verdict.granted, false);
    assert.equal(verdict.needsApproval, true);
    assert.equal(verdict.reason, 'no-grant');
  });
});

describe('VL-268 — write_file и файловые операции не grantable (AC9)', () => {
  it('GRANTABLE_TOOLS не содержит write_file/edit', () => {
    assert.ok(!GRANTABLE_TOOLS.includes('write_file'));
    assert.ok(!GRANTABLE_TOOLS.includes('edit'));
    assert.ok(!GRANTABLE_TOOLS.includes('run_shell_command'));
  });

  it('sanitizeTools отбрасывает write_file и edit из пользовательского ввода', () => {
    const cleaned = sanitizeTools(['backlog_trigger_phase', 'write_file', 'edit', 'backlog_supervisor']);
    assert.deepEqual(cleaned, ['backlog_trigger_phase', 'backlog_supervisor']);
  });

  it('сохранённый draft с write_file не даёт grant-пути для write_file', () => {
    const draft = saveGrantDraft(testRoot, {
      runId: 'run-2026-10-31T22-00-00',
      taskIds: ['VL-263'],
      allowedTools: ['backlog_trigger_phase', 'write_file', 'edit'],
      expiresAt: '2026-11-01T06:00:00.000Z',
    });
    assert.deepEqual(draft.allowedTools, ['backlog_trigger_phase']);
    const loaded = latestGrantDraft(testRoot);
    assert.deepEqual(loaded.allowedTools, ['backlog_trigger_phase']);
  });

  it('grant, записанный вручную с write_file, при чтении теряет write_file', () => {
    const runId = 'run-2026-10-31T22-00-00';
    writeGrant(testRoot, baseGrant(runId, {
      allowedTools: ['backlog_trigger_phase', 'write_file'],
    }));
    const grant = loadGrant(testRoot, runId);
    assert.deepEqual(grant.allowedTools, ['backlog_trigger_phase']);
  });
});

describe('VL-268 — draft карточки', () => {
  it('draft сохраняется, читается и очищается; активным grant-ом не считается', () => {
    const runId = 'run-2026-10-31T22-00-00';
    saveGrantDraft(testRoot, {
      runId,
      taskIds: ['VL-1'],
      allowedTools: ['backlog_trigger_phase'],
      expiresAt: '2026-11-01T06:00:00.000Z',
    });
    assert.equal(findActiveGrant(testRoot), null, 'draft не даёт разрешений');
    const loaded = latestGrantDraft(testRoot);
    assert.equal(loaded.runId, runId);
    clearGrantDraft(testRoot, runId);
    assert.equal(latestGrantDraft(testRoot), null);
  });

  it('taskIdsOfArgs собирает id и ids (строка/массив)', () => {
    assert.deepEqual(taskIdsOfArgs({ id: 'VL-1' }), ['VL-1']);
    assert.deepEqual(taskIdsOfArgs({ ids: ['VL-1', 'VL-2'] }), ['VL-1', 'VL-2']);
    assert.deepEqual(taskIdsOfArgs({ ids: '["VL-1","VL-2"]' }), ['VL-1', 'VL-2']);
    assert.deepEqual(taskIdsOfArgs({}), []);
  });
});
