/**
 * Тесты VL-254 (AC4) — запись прогресса обрыва: мета сессии + комментарий
 * задачи + WIP-коммит фазы code (src/agent/cli.ts:recordRunProgress).
 *
 * Проверяется связка целиком на tmp-проекте: падение по wall-time пишет
 * `run_progress` в мету сессии, коммитит незакоммиченные изменения в ветку
 * и добавляет блок «что сделано / что осталось» комментарием в задачу.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordRunProgress } from '../../dist/agent/cli.js';
import { agentSessionsDir, loadSessionMetaSync, saveSessionMeta } from '../../dist/agent/session.js';
import { buildRunProgress } from '../../dist/agent/run-progress.js';
import { createTaskFile, getTask } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

/** Минимальный backlog-проект в tmp: config.yml + каталог задач (VL-254). */
function setupBacklog(root) {
  mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(root, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Test',
      task_prefix: 'tst',
      default_status: 'To Do',
      statuses: ['To Do', 'In Progress', 'Review', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
}

describe('VL-254 — recordRunProgress (AC4)', () => {
  let dir;
  let sessionsDir;
  const savedCwdEnv = process.env.VIBELOG_CWD;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-run-record-'));
    // Задачи живут там, куда указывает VIBELOG_CWD (в worktree-режиме это
    // главный репозиторий); в тесте — сам tmp-проект, иначе addComment
    // ищет задачу в основном репо агентской сессии (VL-254).
    process.env.VIBELOG_CWD = dir;
    execFileSync('/usr/bin/git', ['init', '-q'], { cwd: dir });
    execFileSync('/usr/bin/git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), 'init\n', 'utf-8');
    execFileSync('/usr/bin/git', ['add', 'README.md'], { cwd: dir });
    execFileSync('/usr/bin/git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    setupBacklog(dir);
    sessionsDir = agentSessionsDir(dir);
  });
  afterAll(() => {
    if (savedCwdEnv === undefined) delete process.env.VIBELOG_CWD;
    else process.env.VIBELOG_CWD = savedCwdEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it('успешный ран — прогресс не пишется', async () => {
    const written = await recordRunProgress({
      loopResult: { is_error: false },
      sessionsDir,
      sessionId: 'agent-ok',
      cwd: dir,
      taskId: 'VL-999',
      phase: 'code',
    });
    assert.equal(written, false);
  });

  it('AC4: обрыв фазы code → run_progress в мете, комментарий задачи, WIP-коммит', async () => {
    const task = createTaskFile(dir, { title: 'Тестовая задача VL-254', status: 'In Progress' });
    const sessionId = 'agent-progress';
    await saveSessionMeta(sessionsDir, sessionId, { taskId: task.id, phase: 'code', cwd: dir });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'done.ts'), 'export const done = 1;\n', 'utf-8');
    const progress = buildRunProgress({
      messages: [
        {
          role: 'assistant',
          content: 'правил модуль',
          tool_calls: [{ id: 'c1', name: 'edit', arguments: { path: 'src/done.ts' } }],
        },
      ],
      reason: 'wall-time',
      durationMs: 60_000,
      payloadBytes: 123_456,
    });
    const written = await recordRunProgress({
      loopResult: { is_error: true, progress },
      sessionsDir,
      sessionId,
      cwd: dir,
      taskId: task.id,
      phase: 'code',
    });
    assert.equal(written, true);
    // 1) мета сессии
    const meta = loadSessionMetaSync(sessionsDir, sessionId);
    assert.equal(meta.run_progress?.reason, 'wall-time');
    assert.equal(meta.run_progress?.phase, 'code');
    assert.match(meta.run_progress?.text ?? '', /Сделано/);
    assert.match(meta.run_progress?.text ?? '', /Осталось/);
    // 2) WIP-коммит в ветку
    assert.ok(meta.run_progress?.commit, 'хэш WIP-коммита записан');
    const committed = execFileSync('/usr/bin/git', ['show', '--name-only', '--pretty=format:', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.match(committed, /src\/done\.ts/);
    assert.doesNotMatch(committed, /backlog\//);
    // 3) комментарий задачи
    const updated = getTask(dir, task.id);
    const last = updated.comments?.[updated.comments.length - 1];
    assert.ok(last, 'комментарий добавлен');
    assert.match(String(last.content ?? last.text ?? last), /Осталось/);
  });

  it('обрыв фазы plan: коммита нет, блок в мете и комментарии есть', async () => {
    const task = createTaskFile(dir, { title: 'Тестовая задача plan VL-254', status: 'In Progress' });
    const sessionId = 'agent-progress-plan';
    await saveSessionMeta(sessionsDir, sessionId, { taskId: task.id, phase: 'plan', cwd: dir });
    writeFileSync(join(dir, 'tmp-plan.txt'), 'x\n', 'utf-8');
    const progress = buildRunProgress({ messages: [], reason: 'max-requests' });
    const written = await recordRunProgress({
      loopResult: { is_error: true, progress },
      sessionsDir,
      sessionId,
      cwd: dir,
      taskId: task.id,
      phase: 'plan',
    });
    assert.equal(written, true);
    const meta = loadSessionMetaSync(sessionsDir, sessionId);
    assert.equal(meta.run_progress?.commit, null, 'фаза plan не коммитит');
    const status = execFileSync('/usr/bin/git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.match(status, /tmp-plan\.txt/, 'незакоммиченный файл plan-раны остаётся на месте');
    rmSync(join(dir, 'tmp-plan.txt'), { force: true });
  });
});
