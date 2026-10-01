/**
 * Тесты VL-15 — batch AC/DoD и task list --limit/--skip.
 *
 * CLI (/tmp, spawnSync):
 * - --check-ac 1,3 / --uncheck-dod 1,2 — несколько индексов через запятую
 * - невалидный индекс в списке → ошибка, валидные обрабатываются
 * - task list --skip/--limit (после фильтров/сортировки), валидация
 *
 * MCP (in-process):
 * - manage_ac/manage_dod: index — одиночный номер или массив
 * - remove массива — по убыванию (без сдвига)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.mjs';
import { createTaskFile, getTask } from '../../dist/core/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// CLI
// ============================================================

const cliDir = '/tmp/vibelog-batch-cli-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function cliFresh() {
  rmSync(cliDir, { recursive: true, force: true });
  mkdirSync(cliDir, { recursive: true });
  runCli('init', 'Batch CLI', '--prefix', 'bt');
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: cliDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

describe('VL-15 — CLI batch AC/DoD + list limit/skip', () => {
  after(() => rmSync(cliDir, { recursive: true, force: true }));

  it('edit --check-ac 1,3 и --uncheck-dod 1,2', () => {
    cliFresh();
    const out = runCli('task', 'create', 'Батч', '--ac', 'К1', '--ac', 'К2', '--ac', 'К3', '--dod', 'Д1', '--dod', 'Д2');
    const id = out.match(/(bt-\d+)/)[1];

    runCli('task', 'edit', id, '--check-ac', '1,3', '--check-dod', '1,2');
    const view = runCli('task', 'view', id, '--json');
    // Проверяем отметки по текстам (checked: true рядом с К1/К3, Д1/Д2)
    assert.ok(view.includes('"checked": true'), view.slice(0, 300));
    const task = JSON.parse(view.includes('{') ? extractJson(view) : '{}');
    // Резервный разбор: через count checked
    const checkedCount = (view.match(/"checked": true/g) || []).length;
    assert.equal(checkedCount, 4, 'должны быть отмечены К1, К3, Д1, Д2');

    runCli('task', 'edit', id, '--uncheck-dod', '1,2');
    const view2 = runCli('task', 'view', id, '--json');
    const checkedAfter = (view2.match(/"checked": true/g) || []).length;
    assert.equal(checkedAfter, 2, 'после uncheck-dod остаются К1 и К3');
  });

  it('невалидный индекс в списке: ошибка + валидные обработаны', () => {
    cliFresh();
    const out = runCli('task', 'create', 'Ошибки', '--ac', 'К1', '--ac', 'К2');
    const id = out.match(/(bt-\d+)/)[1];

    const res = runCli('task', 'edit', id, '--check-ac', '1,99');
    assert.ok(res.includes('Неверный индекс 99'), `res: ${res}`);
    const view = runCli('task', 'view', id, '--json');
    const checkedCount = (view.match(/"checked": true/g) || []).length;
    assert.equal(checkedCount, 1, 'валидный индекс 1 отмечен');
  });

  it('list --skip/--limit после фильтрации; валидация', () => {
    cliFresh();
    for (const t of ['Задача А', 'Задача Б', 'Задача В']) {
      runCli('task', 'create', t);
    }

    let out = runCli('task', 'list', '--limit', '2', '--json');
    let data = JSON.parse(out).data;
    assert.equal(data.length, 2);

    out = runCli('task', 'list', '--skip', '2', '--json');
    data = JSON.parse(out).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Задача В');

    out = runCli('task', 'list', '--skip', '1', '--limit', '1', '--json');
    data = JSON.parse(out).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].title, 'Задача Б');

    out = runCli('task', 'list', '--limit', 'abc');
    assert.ok(out.includes('--limit должен быть целым числом'), `limit ошибка: ${out}`);
  });
});

/** Достаёт первый JSON-объект из вывода (для резервного разбора). */
function extractJson(text) {
  const start = text.indexOf('{');
  return start >= 0 ? text.slice(start) : '{}';
}

// ============================================================
// MCP (in-process)
// ============================================================

const testDir = join(__dirname, '..', '..', '.test-batch');
const backlogDir = join(testDir, 'backlog');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Batch MCP',
    task_prefix: 'bm',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

describe('VL-15 — MCP manage_ac/dod с массивами', () => {
  before(() => setup());
  after(() => rmSync(testDir, { recursive: true, force: true }));

  it('check/uncheck с массивом index', async () => {
    const t = createTaskFile(testDir, { title: 'Массив' });
    for (const text of ['К1', 'К2', 'К3']) {
      await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text }, testDir);
    }
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: [1, 3] }, testDir);
    let task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria[0].checked, true);
    assert.equal(task.acceptanceCriteria[1].checked, false);
    assert.equal(task.acceptanceCriteria[2].checked, true);

    // Одиночный index работает как раньше
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: 2 }, testDir);
    task = getTask(testDir, t.id);
    assert.equal(task.acceptanceCriteria[1].checked, true);
  });

  it('remove с массивом — по убыванию, без сдвига', async () => {
    const t = createTaskFile(testDir, { title: 'Удаление' });
    for (const text of ['Д1', 'Д2', 'Д3', 'Д4']) {
      await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text }, testDir);
    }
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'remove', index: [1, 3] }, testDir);
    const task = getTask(testDir, t.id);
    assert.deepEqual(task.definitionOfDone.map(d => d.text), ['Д2', 'Д4']);
  });

  it('невалидный индекс в массиве → reject', async () => {
    const t = createTaskFile(testDir, { title: 'Ошибка массива' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'К1' }, testDir);
    await assert.rejects(
      handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: [1, 5] }, testDir),
      /Неверный индекс: 5/
    );
  });
});
