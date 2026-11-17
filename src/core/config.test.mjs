/**
 * Тесты VL-118 — taskIdPattern: id задач проверяется по task_prefix конфига
 * проекта, а не хардкодом VL. Регрессия инцидента: проект с префиксом ot/LB
 * молча терял branch-mode, мету сессии и worktree-resume.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { taskPrefix, taskIdPattern } from '../../dist/core/config.js';

describe('taskIdPattern — id по префиксу конфига проекта (VL-118)', () => {
  const withConfig = (yaml) => {
    const dir = mkdtempSync(join(tmpdir(), 'vl-config-prefix-'));
    mkdirSync(join(dir, 'backlog'), { recursive: true });
    writeFileSync(join(dir, 'backlog', 'config.yml'), yaml, 'utf-8');
    return dir;
  };

  it('обычный префикс: ot-5 матчится (без учёта регистра), VL-5 — нет', () => {
    const dir = withConfig('project_name: OT\ntask_prefix: ot\n');
    try {
      const re = taskIdPattern(dir);
      assert.ok(re.test('ot-5'), 'свой префикс');
      assert.ok(re.test('OT-5'), 'без учёта регистра');
      assert.ok(!re.test('VL-5'), 'чужой префикс не матчится');
      assert.ok(!re.test('ot-x'), 'суффикс должен быть числом');
      assert.ok(!re.test('xot-5'), 'префикс — весь id, не середина');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('префикс со спецсимволами regex экранируется — литералы, не паттерн', () => {
    const dir = withConfig('project_name: Sp\ntask_prefix: a.b+\n');
    try {
      const re = taskIdPattern(dir);
      assert.ok(re.test('a.b+-3'), 'спецсимволы матчатся как литералы');
      assert.ok(!re.test('axb-3'), 'точка не заменяет любой символ');
      assert.ok(!re.test('aab-3'), 'плюс не означает повтор');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('нет backlog/конфига — дефолт VL (prompt без проекта)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vl-config-none-'));
    try {
      const re = taskIdPattern(dir);
      assert.ok(re.test('VL-7'), 'дефолтный префикс работает');
      assert.ok(!re.test('ot-7'), 'чужие id отфильтрованы');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('пустой task_prefix — дефолт VL', () => {
    const dir = withConfig("project_name: E\ntask_prefix: ''\n");
    try {
      assert.ok(taskIdPattern(dir).test('VL-7'), 'пустой префикс → дефолт');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ——— VL-425: taskPrefix — единственный источник префикса (taskIdPattern и
  // normalizeTaskId/MCP-guard читают одну и ту же логику) ———

  it('taskPrefix — префикс из config.yml проекта', () => {
    const dir = withConfig('project_name: LB\ntask_prefix: LB\n');
    try {
      assert.equal(taskPrefix(dir), 'LB', 'свой префикс из конфига');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('taskPrefix — дефолт VL: пустой префикс и отсутствие backlog/', () => {
    const empty = withConfig("project_name: E\ntask_prefix: ''\n");
    const noBacklog = mkdtempSync(join(tmpdir(), 'vl-config-noprefix-'));
    try {
      assert.equal(taskPrefix(empty), 'VL', 'пустой префикс → дефолт');
      assert.equal(taskPrefix(noBacklog), 'VL', 'нет backlog/ → дефолт');
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(noBacklog, { recursive: true, force: true });
    }
  });
});
