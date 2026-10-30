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
  it('все 8 reference_* в listTools; всего 38 инструментов', () => {
    const tools = listTools();
    assert.equal(tools.length, 38);
    const names = tools.map(t => t.name);
    for (const n of ['reference_list', 'reference_add', 'reference_view', 'reference_search', 'reference_remove', 'reference_update', 'reference_link', 'reference_sync']) {
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

describe('VL-164 — reference_update', () => {
  it('обновление tags — полная замена списка; видно через view и list', async () => {
    const added = await handleToolCall('reference_add', {
      title: 'Update target', type: 'url', url: 'https://example.com/update',
      tags: ['a', 'b'], description: 'Старое описание',
    }, testRoot);
    const id = added.match(/ref-\d+/)[0];

    const out = await handleToolCall('reference_update', { id, tags: ['c'] }, testRoot);
    assert.ok(out.includes('обновлён'), out);

    const view = JSON.parse(await handleToolCall('reference_view', { id }, testRoot));
    assert.deepEqual(view.tags, ['c'], 'tags заменены полностью, без merge');

    const list = JSON.parse(await handleToolCall('reference_list', {}, testRoot));
    const found = list.find(r => r.id === id);
    assert.deepEqual(found.tags, ['c'], 'list показывает обновлённые tags');
  });

  it('обновление description — полная замена тела; видно через view', async () => {
    const added = await handleToolCall('reference_add', {
      title: 'Body target', type: 'doc', path: 'docs/body.md', description: 'Старое тело',
    }, testRoot);
    const id = added.match(/ref-\d+/)[0];

    await handleToolCall('reference_update', { id, description: 'Новое тело' }, testRoot);

    const view = JSON.parse(await handleToolCall('reference_view', { id }, testRoot));
    assert.equal(view.body, 'Новое тело', 'body заменён полностью');
  });

  it('несуществующий id → понятная ошибка на русском', async () => {
    await assert.rejects(
      handleToolCall('reference_update', { id: 'ref-999', tags: ['x'] }, testRoot),
      /не найден/,
    );
  });

  it('без полей для обновления → ошибка', async () => {
    await assert.rejects(
      handleToolCall('reference_update', { id: 'ref-1' }, testRoot),
      /Не указаны поля/,
    );
  });
});

// ── VL-194: локальный markdown-кэш через MCP (cache=true, sync id/all) ──

describe('VL-194 — MCP кэш: reference_add{cache}, reference_view, reference_sync', () => {
  /** Loopback-сервер: guard VL-132 пропускает только 127.0.0.1. */
  let server;
  let base;
  let pageBody;

  beforeAll(async () => {
    const http = await import('node:http');
    pageBody = '<html><head><title>T</title></head><body><header>nav</header><h1>MCP док</h1><p>v1</p></body></html>';
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageBody);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('add{cache:true} → view содержит cached_markdown', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'MCP cached', type: 'doc', url: `${base}/mcp-doc`, cache: true,
    }, testRoot);
    assert.match(out, /закэшировано/, out);

    const id = out.match(/Reference (ref-\d+)/)?.[1];
    assert.ok(id, out);
    const view = JSON.parse(await handleToolCall('reference_view', { id }, testRoot));
    assert.equal(typeof view.cached_markdown, 'string', JSON.stringify(Object.keys(view)));
    assert.match(view.cached_markdown, /# MCP док/, view.cached_markdown);
    assert.doesNotMatch(view.cached_markdown, /nav/, 'header вычищен');
    assert.ok(view.cached_path.endsWith(`${id}.md`), view.cached_path);
    assert.ok(view.cached_at, 'cached_at в метаданных');
    assert.match(view.source_hash, /^[0-9a-f]{64}$/, view.source_hash);
  });

  it('view без кэша → cached_markdown: null (fallback на url)', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'MCP no cache', type: 'url', url: `${base}/plain`,
    }, testRoot);
    const id = out.match(/Reference (ref-\d+)/)?.[1];
    const view = JSON.parse(await handleToolCall('reference_view', { id }, testRoot));
    assert.equal(view.cached_markdown, null, 'нет кэша → null');
    assert.ok(view.url, 'url остаётся для fallback');
  });

  it('add{cache:true} без url → сообщение об ошибке, создание не падает', async () => {
    const out = await handleToolCall('reference_add', {
      title: 'MCP cache no url', type: 'doc', cache: true,
    }, testRoot);
    assert.match(out, /Reference ref-\d+ создан/, out);
    assert.match(out, /нужен url/, out);
  });

  it('reference_sync{id}: сверка source_hash (без изменений / обновление)', async () => {
    const list = JSON.parse(await handleToolCall('reference_list', { type: 'doc' }, testRoot));
    const cached = list.find(r => r.title === 'MCP cached');
    assert.ok(cached, JSON.stringify(list));

    const res1 = JSON.parse(await handleToolCall('reference_sync', { id: cached.id }, testRoot));
    assert.ok(res1.skipped.includes(cached.id), `res1: ${JSON.stringify(res1)}`);

    pageBody = '<html><body><h1>MCP док</h1><p>v2</p></body></html>';
    try {
      const res2 = JSON.parse(await handleToolCall('reference_sync', { id: cached.id }, testRoot));
      assert.ok(res2.updated.includes(cached.id), `res2: ${JSON.stringify(res2)}`);
      const view = JSON.parse(await handleToolCall('reference_view', { id: cached.id }, testRoot));
      assert.match(view.cached_markdown, /v2/, view.cached_markdown);
    } finally {
      pageBody = '<html><head><title>T</title></head><body><header>nav</header><h1>MCP док</h1><p>v1</p></body></html>';
    }
  });

  it('reference_sync{id} несуществующего → ошибка', async () => {
    await assert.rejects(
      handleToolCall('reference_sync', { id: 'ref-999' }, testRoot),
      /не найден/,
    );
  });

  it('reference_sync{all:true} → клоны + кэши url/doc/spec', async () => {
    const res = JSON.parse(await handleToolCall('reference_sync', { all: true }, testRoot));
    // Клоны — прежнее поведение сохраняется
    assert.ok(Array.isArray(res.cloned), JSON.stringify(res));
    assert.ok(Array.isArray(res.updated), JSON.stringify(res));
    assert.ok(Array.isArray(res.failed), JSON.stringify(res));
    // Хэши уже синхронизированы предыдущими тестами → skipped или updated
    assert.ok(res.updated.length + res.skipped.length > 0, JSON.stringify(res));
  });

  it('reference_sync без аргументов — прежнее поведение (только клон-поля)', async () => {
    const res = JSON.parse(await handleToolCall('reference_sync', {}, testRoot));
    assert.ok('cloned' in res, JSON.stringify(Object.keys(res)));
    assert.ok(!('updated' in res), 'без аргументов полей кэша нет');
  });
});
