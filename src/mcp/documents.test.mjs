/**
 * Тесты VL-11 — Documents (CLI doc + MCP document_*).
 *
 * Проверяет:
 * - MCP: document_create/view/list/update/search + валидация типа
 * - CLI: doc create/list/view/update/search
 * - Round-trip markdown (documentToMarkdown/markdownToDocument)
 * - listTools() = 21 (16 + 5 document_*)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { documentToMarkdown, markdownToDocument } from '../../dist/core/document.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-documents');
const backlogDir = join(testDir, 'backlog');
const docsDirPath = join(backlogDir, 'docs');
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Docs Test',
    task_prefix: 'dc',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

// ============================================================
// Список инструментов
// ============================================================

describe('VL-11 — document_* инструменты', () => {
  it('Все 21 инструмент, document_* зарегистрированы', () => {
    const tools = listTools();
    assert.equal(tools.length, 21);
    const names = tools.map(t => t.name);
    for (const n of ['document_list', 'document_view', 'document_create', 'document_update', 'document_search']) {
      assert.ok(names.includes(n), `${n} не найден`);
    }
  });

  it('Схемы: create требует title+content, list — query опционален', () => {
    const tools = listTools();
    assert.deepEqual(tools.find(t => t.name === 'document_create').inputSchema.required, ['title', 'content']);
    assert.ok(!tools.find(t => t.name === 'document_list').inputSchema.required);
  });
});

// ============================================================
// MCP
// ============================================================

describe('VL-11 — MCP document_*', () => {
  before(() => setup());
  after(() => cleanup());

  it('create: записывает документ (doc-1, тип по умолчанию other)', async () => {
    const res = await handleToolCall('document_create', { title: 'Гайд API', content: '# API\nТекст' }, testDir);
    assert.ok(res.includes('doc-1'), res);
    const view = JSON.parse(await handleToolCall('document_view', { id: 'doc-1' }, testDir));
    assert.equal(view.title, 'Гайд API');
    assert.equal(view.type, 'other');
    assert.ok(view.content.includes('# API'));
    assert.ok(existsDoc('doc-1'));
  });

  it('create: тип и теги, каноническое написание типа', async () => {
    await handleToolCall('document_create', { title: 'Спецификация X', content: 'тело', type: 'Specification', tags: ['api', 'v1'] }, testDir);
    const view = JSON.parse(await handleToolCall('document_view', { id: 'doc-2' }, testDir));
    assert.equal(view.type, 'specification');
    assert.deepEqual(view.tags, ['api', 'v1']);
  });

  it('create: невалидный тип → ошибка', async () => {
    await assert.rejects(
      handleToolCall('document_create', { title: 'X', content: 'y', type: 'nope' }, testDir),
      /Недопустимый тип документа/
    );
  });

  it('list: все документы + фильтр query', async () => {
    const all = JSON.parse(await handleToolCall('document_list', {}, testDir));
    assert.equal(all.length, 2);
    const filtered = JSON.parse(await handleToolCall('document_list', { query: 'спецификация' }, testDir));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'doc-2');
  });

  it('update: меняет title/type/tags/content', async () => {
    await handleToolCall('document_update', { id: 'doc-2', title: 'Спецификация Y', content: 'новое тело', tags: ['api'] }, testDir);
    const view = JSON.parse(await handleToolCall('document_view', { id: 'doc-2' }, testDir));
    assert.equal(view.title, 'Спецификация Y');
    assert.equal(view.content, 'новое тело');
    assert.deepEqual(view.tags, ['api']);
  });

  it('search: по телу и заголовку', async () => {
    const res = JSON.parse(await handleToolCall('document_search', { query: 'новое тело' }, testDir));
    assert.equal(res.length, 1);
    assert.equal(res[0].id, 'doc-2');
  });

  it('Ошибки: view несуществующего, update без полей', async () => {
    await assert.rejects(handleToolCall('document_view', { id: 'doc-99' }, testDir), /не найден/);
    await assert.rejects(handleToolCall('document_update', { id: 'doc-1' }, testDir), /Не указаны поля/);
  });

  it('Round-trip: documentToMarkdown/markdownToDocument', () => {
    const md = documentToMarkdown({ id: 'doc-9', title: 'RT', type: 'guide', created_date: '2026-10-01', tags: ['a'] }, 'тело RT');
    const { document, body } = markdownToDocument(md);
    assert.deepEqual(document, { id: 'doc-9', title: 'RT', type: 'guide', created_date: '2026-10-01', tags: ['a'] });
    assert.equal(body, 'тело RT');
  });
});

function existsDoc(idPrefix) {
  const files = readdirSync(docsDirPath);
  return files.some(f => f.startsWith(idPrefix));
}

// ============================================================
// CLI
// ============================================================

describe('VL-11 — CLI doc', () => {
  before(() => setup());
  after(() => cleanup());

  it('create/list/view/update/search', () => {
    let out = runCli('doc', 'create', 'README проекта', '--type', 'readme', '--tags', 'main,docs');
    assert.ok(out.includes('doc-1') && out.includes('создан'), `create: ${out}`);

    out = runCli('doc', 'create', 'Гайд миграции', '--type', 'Guide');
    assert.ok(out.includes('doc-2') && out.includes('guide'), `create2: ${out}`);

    out = runCli('doc', 'list');
    assert.ok(out.includes('README проекта') && out.includes('Гайд миграции'), `list: ${out}`);

    out = runCli('doc', 'list', '--type', 'guide');
    assert.ok(out.includes('Гайд миграции') && !out.includes('README'), `list type: ${out}`);

    out = runCli('doc', 'view', 'doc-1');
    assert.ok(out.includes('README проекта') && out.includes('main, docs'), `view: ${out}`);

    out = runCli('doc', 'update', 'doc-2', '--title', 'Гайд обновлён', '--tags', 'migration');
    assert.ok(out.includes('обновлён'), `update: ${out}`);
    out = runCli('doc', 'view', 'doc-2');
    assert.ok(out.includes('Гайд обновлён') && out.includes('migration'), `view2: ${out}`);

    // После update заголовок 'Гайд миграции' заменён — ищем по новому
    out = runCli('doc', 'search', 'обновлён');
    assert.ok(out.includes('doc-2'), `search: ${out}`);

    out = runCli('doc', 'create', 'Плохой', '--type', 'nope');
    assert.ok(out.includes('Недопустимый тип'), `невалидный тип: ${out}`);

    out = runCli('doc', 'view', 'doc-99');
    assert.ok(out.includes('не найден'), `несуществующий: ${out}`);
  });
});
