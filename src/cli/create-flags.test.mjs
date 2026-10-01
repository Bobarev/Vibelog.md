/**
 * Тесты VL-16..18 — P2-хвост v1.3: флаги task create/edit.
 *
 * VL-16: DoD-дефолты из конфига + --no-dod-defaults
 * VL-17: --project/--parent/--ordinal/--final-summary + MCP create (ordinal/finalSummary/project)
 * VL-18: --draft + edit --final-summary/--append-final-summary/--clear-final-summary/--ordinal
 *
 * CLI — /tmp + spawnSync; MCP — in-process (in-project .test-create-flags).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile, getTask } from '../../dist/core/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// CLI
// ============================================================

const cliDir = '/tmp/vibelog-create-flags-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function cliFresh() {
  rmSync(cliDir, { recursive: true, force: true });
  mkdirSync(cliDir, { recursive: true });
  // init пишет definition_of_done: ['Тесты проходят', 'Документация обновлена', 'Нет регрессий']
  runCli('init', 'Flags CLI', '--prefix', 'fl');
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: cliDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

/** Создаёт задачу и возвращает её view --json. */
function createAndRead(createArgs) {
  const out = runCli('task', 'create', ...createArgs);
  const id = out.match(/(fl-\d+)/)[1];
  return { id, view: runCli('task', 'view', id, '--json') };
}

describe('VL-16 — DoD-дефолты и --no-dod-defaults', () => {
  after(() => rmSync(cliDir, { recursive: true, force: true }));

  it('create без --dod наполняет дефолты из конфига', () => {
    cliFresh();
    const { view } = createAndRead(['Дефолтная']);
    assert.ok(view.includes('Тесты проходят'), `дефолт1: ${view.slice(0, 400)}`);
    assert.ok(view.includes('Нет регрессий'), 'дефолт3');
  });

  it('--no-dod-defaults отключает дефолты', () => {
    cliFresh();
    const { view } = createAndRead(['Без дефолтов', '--no-dod-defaults']);
    assert.ok(!view.includes('Тесты проходят'), `дефолтов быть не должно: ${view.slice(0, 300)}`);
  });

  it('--dod имеет приоритет над дефолтами', () => {
    cliFresh();
    const { view } = createAndRead(['Свой DoD', '--dod', 'Свой критерий']);
    assert.ok(view.includes('Свой критерий'), view.slice(0, 300));
    assert.ok(!view.includes('Тесты проходят'), 'дефолты не подмешиваются');
  });
});

describe('VL-17 — create --project/--parent/--ordinal/--final-summary', () => {
  after(() => rmSync(cliDir, { recursive: true, force: true }));

  it('флаги записывают поля (round-trip)', () => {
    cliFresh();
    runCli('task', 'create', 'Родитель');
    const { view } = createAndRead(['Поля', '--project', 'web', '--parent', 'fl-1', '--ordinal', '5', '--final-summary', 'Готово на 100%']);
    assert.ok(view.includes('"project": "web"'), view.slice(0, 400));
    assert.ok(view.includes('"parent_task_id": "fl-1"'), 'parent');
    assert.ok(view.includes('"ordinal": 5'), 'ordinal');
    assert.ok(view.includes('Готово на 100%'), 'finalSummary');
  });

  it('--parent: несуществующая задача → ошибка, не создаётся', () => {
    cliFresh();
    const out = runCli('task', 'create', 'Сирота', '--parent', 'fl-99');
    assert.ok(out.includes('Родительская задача fl-99 не найдена'), `out: ${out}`);
    const list = runCli('task', 'list', '--json');
    assert.ok(!list.includes('Сирота'), 'задача не должна создаться');
  });

  it('MCP create принимает ordinal/finalSummary/project', async () => {
    const testDir = join(__dirname, '..', '..', '.test-create-flags');
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'config.yml'), stringifyYaml({
      project_name: 'CF',
      task_prefix: 'cf',
      default_status: 'To Do',
      statuses: ['To Do', 'Done'],
      definition_of_done: [],
    }), 'utf-8');

    try {
      await handleToolCall('backlog_create_task', { title: 'MCP поля', ordinal: 3, finalSummary: 'Итог', project: 'core' }, testDir);
      const result = await handleToolCall('backlog_list_tasks', {}, testDir);
      // list_tasks упрощает вывод — проверяем через view
      const view = JSON.parse(await handleToolCall('backlog_view_task', { id: 'cf-1' }, testDir));
      assert.equal(view.ordinal, 3);
      assert.equal(view.finalSummary, 'Итог');
      assert.equal(view.project, 'core');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe('VL-18 — create --draft + edit --final-summary/--ordinal', () => {
  after(() => rmSync(cliDir, { recursive: true, force: true }));

  it('create --draft: черновик в drafts/, в tasks/ пусто', () => {
    cliFresh();
    const out = runCli('task', 'create', 'Черновиковая идея', '--draft', '-d', 'Описание');
    assert.ok(out.includes('Черновик draft-1'), `out: ${out}`);
    const drafts = readdirSync(join(cliDir, 'backlog', 'drafts')).filter(f => f.endsWith('.md'));
    assert.equal(drafts.length, 1);
    const tasks = readdirSync(join(cliDir, 'backlog', 'tasks')).filter(f => f.endsWith('.md'));
    assert.equal(tasks.length, 0, 'задача создаваться не должна');
  });

  it('edit: финальные флаги', () => {
    cliFresh();
    const { id } = createAndRead(['Резюме-тест']);

    runCli('task', 'edit', id, '--final-summary', 'Первая строка');
    let view = runCli('task', 'view', id, '--json');
    assert.ok(view.includes('Первая строка'), `replace: ${view.slice(0, 300)}`);

    runCli('task', 'edit', id, '--append-final-summary', 'Вторая строка');
    view = runCli('task', 'view', id, '--json');
    assert.ok(view.includes('Первая строка') && view.includes('Вторая строка'), 'append');

    runCli('task', 'edit', id, '--clear-final-summary');
    view = runCli('task', 'view', id, '--json');
    assert.ok(!view.includes('Первая строка') && !view.includes('Вторая строка'), 'clear');

    runCli('task', 'edit', id, '--ordinal', '7');
    view = runCli('task', 'view', id, '--json');
    assert.ok(view.includes('"ordinal": 7'), `ordinal: ${view.slice(0, 300)}`);
  });

  it('edit --ordinal: невалидное значение → ошибка', () => {
    cliFresh();
    const { id } = createAndRead(['Ordinal ошибка']);
    const out = runCli('task', 'edit', id, '--ordinal', 'abc');
    assert.ok(out.includes('--ordinal должен быть целым числом'), `out: ${out}`);
  });
});
