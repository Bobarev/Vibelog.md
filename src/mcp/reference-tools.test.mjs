/**
 * Тесты VL-152 — MCP-инструменты reference_* (7 штук).
 *
 * Проверяет: регистрацию в listTools (29 всего), вызовы handleToolCall,
 * clone default=true/false, валидацию типа, двустороннюю связь с задачей.
 *
 * Clone — только локальный file://-репозиторий (без сети).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-mcp-reference-test-'));
const backlogDir = join(testRoot, 'backlog');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const remoteDir = join(testRoot, 'remote-src');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // Минимальный конфиг — нужен backlog_create_task (тесты reference_link)
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  // Локальный «удалённый» репозиторий
  mkdirSync(remoteDir, { recursive: true });
  writeFileSync(join(remoteDir, 'file.txt'), 'x\n');
  const git = (args) => {
    const res = spawnSync('git', args, { cwd: remoteDir, encoding: 'utf-8', env: gitEnv });
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  };
  git(['init']);
  git(['add', '.']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '--no-gpg-sign']);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-152 — регистрация reference_* инструментов', () => {
  it('все 7 reference_* в listTools; всего 29 инструментов', () => {
    const tools = listTools();
    assert.equal(tools.length, 29);
    const names = tools.map(t => t.name);
    for (const n of ['reference_list', 'reference_add', 'reference_view', 'reference_search', 'reference_remove', 'reference_link', 'reference_sync']) {
      assert.ok(names.includes(n), `${n} не найден`);
    }
  });
});

describe('VL-152 — reference_add / view / list / search / remove', () => {
  it('add: создаёт reference, возвращает id', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'MCP ref', type: 'url', url: 'https://example.com/doc', tags: ['t1'], description: 'Описание',
    }, testRoot);
    assert.match(out, /Reference ref-1 создан/);
    const view = await handleToolCall('reference_view', { id: 'ref-1' }, testRoot);
    const parsed = JSON.parse(view);
    assert.equal(parsed.title, 'MCP ref');
    assert.equal(parsed.type, 'url');
    assert.equal(parsed.body, 'Описание');
  });

  it('add: невалидный тип → ошибка', async () => {
    await assert.rejects(
      handleToolCall('reference_add', { title: 'X', type: 'nope' }, testRoot),
      /Недопустимый тип reference/
    );
  });

  it('list: фильтры type/tags', async () => {
    await handleToolCall('reference_add', { title: 'Repo one', type: 'repo', tags: ['a', 'b'] }, testRoot);
    const all = JSON.parse(await handleToolCall('reference_list', {}, testRoot));
    assert.ok(all.length >= 2);
    const repos = JSON.parse(await handleToolCall('reference_list', { type: 'repo' }, testRoot));
    assert.ok(repos.every(r => r.type === 'repo'));
    const tagged = JSON.parse(await handleToolCall('reference_list', { tags: ['a'] }, testRoot));
    assert.ok(tagged.every(r => r.tags.includes('a')));
  });

  it('search: substring', async () => {
    const found = JSON.parse(await handleToolCall('reference_search', { query: 'nodejs' }, testRoot));
    await handleToolCall('reference_add', { title: 'Node docs', type: 'url', url: 'https://nodejs.org/api/fs.html' }, testRoot);
    const found2 = JSON.parse(await handleToolCall('reference_search', { query: 'nodejs' }, testRoot));
    assert.ok(found2.length >= 1);
    assert.ok(Array.isArray(found));
  });

  it('view: несуществующий → ошибка; remove: удаляет', async () => {
    await assert.rejects(handleToolCall('reference_view', { id: 'ref-999' }, testRoot), /не найден/);
    const added = await handleToolCall('reference_add', { title: 'Temp', type: 'doc' }, testRoot);
    const id = added.match(/Reference (ref-\d+)/)[1];
    const removed = await handleToolCall('reference_remove', { id }, testRoot);
    assert.match(removed, /удалён/);
    await assert.rejects(handleToolCall('reference_view', { id }, testRoot), /не найден/);
  });
});

describe('VL-152 — reference_add clone и reference_sync', () => {
  const url = 'file://' + remoteDir;

  it('clone default=true для repo: клонирует в data/<dir>', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'Local repo', type: 'repo', url, path: 'data/local-repo',
    }, testRoot);
    assert.match(out, /клонирован/, out);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'local-repo', 'file.txt')));
  });

  it('clone=false: только метаданные, каталог не создан', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'No clone repo', type: 'repo', url, path: 'data/no-clone-repo', clone: false,
    }, testRoot);
    assert.doesNotMatch(out, /клонирован в/);
    assert.ok(!existsSync(join(backlogDir, 'references', 'data', 'no-clone-repo')));
  });

  it('sync: доклонировал отсутствующий, пропустил существующий', async () => {
    // no-clone-repo ещё не склонирован → sync клонирует; local-repo → skip
    const res = JSON.parse(await handleToolCall('reference_sync', {}, testRoot));
    assert.ok(res.cloned.includes('ref-5'), JSON.stringify(res)); // ref-5 = No clone repo
    assert.ok(res.skipped.includes('ref-4'), JSON.stringify(res)); // ref-4 = Local repo
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'no-clone-repo', 'file.txt')));
  });
});

describe('VL-152 — reference_link (двусторонняя связь) и backlog_update_task references', () => {
  it('link add/remove синхронизирует linked_tasks ↔ task.references', async () => {
    await handleToolCall('backlog_create_task', { title: 'Задача для связи' }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const taskId = tasks[0].id;

    const linked = await handleToolCall('reference_link', { referenceId: 'ref-1', taskId }, testRoot);
    assert.match(linked, /связан/);

    const view = JSON.parse(await handleToolCall('reference_view', { id: 'ref-1' }, testRoot));
    assert.deepEqual(view.linked_tasks, [taskId]);

    const task = JSON.parse(await handleToolCall('backlog_view_task', { id: taskId }, testRoot));
    assert.ok(task.references.includes('ref-1'), `task.references: ${JSON.stringify(task.references)}`);

    // remove
    await handleToolCall('reference_link', { referenceId: 'ref-1', taskId, action: 'remove' }, testRoot);
    const view2 = JSON.parse(await handleToolCall('reference_view', { id: 'ref-1' }, testRoot));
    assert.deepEqual(view2.linked_tasks, []);
  });

  it('link: несуществующие reference/задача → ошибка', async () => {
    await assert.rejects(handleToolCall('reference_link', { referenceId: 'ref-999', taskId: 'VL-1' }, testRoot), /не найден/);
  });

  it('backlog_update_task: полная замена references', async () => {
    await handleToolCall('backlog_create_task', { title: 'Задача references' }, testRoot);
    const tasks = JSON.parse(await handleToolCall('backlog_list_tasks', {}, testRoot));
    const taskId = tasks.find(t => t.title === 'Задача references').id;
    await handleToolCall('backlog_update_task', { id: taskId, references: ['ref-1', 'ref-2'] }, testRoot);
    const task = JSON.parse(await handleToolCall('backlog_view_task', { id: taskId }, testRoot));
    assert.deepEqual(task.references, ['ref-1', 'ref-2']);
  });
});
