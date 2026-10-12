import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from '../../dist/core/frontmatter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Корень проекта Vibelog.md
const root = join(__dirname, '..', '..');
// Путь к оригиналу Backlog.md
const backlogRoot = 'refs/Backlog.md';

describe('parseFrontmatter', () => {
  it('Файл с frontmatter и телом', () => {
    const content = `---
id: BACK-100
title: Add web server
status: Done
---

## Description

Текст описания.`;

    const { data, body } = parseFrontmatter(content);
    assert.equal(data.id, 'BACK-100');
    assert.equal(data.title, 'Add web server');
    assert.equal(data.status, 'Done');
    assert.ok(body.includes('## Description'));
    assert.ok(body.includes('Текст описания.'));
  });

  it('Файл без frontmatter', () => {
    const content = `## Description

Обычный markdown без frontmatter.`;

    const { data, body } = parseFrontmatter(content);
    assert.deepStrictEqual(data, {});
    assert.equal(body, content);
  });

  it('Frontmatter с массивами', () => {
    const content = `---
id: BACK-200
labels:
  - enhancement
  - bug
dependencies:
  - task-24.1
  - task-208
---

## Description

Body text.`;

    const { data } = parseFrontmatter(content);
    assert.deepStrictEqual(data.labels, ['enhancement', 'bug']);
    assert.deepStrictEqual(data.dependencies, ['task-24.1', 'task-208']);
  });

  it('Frontmatter с inline-массивом', () => {
    const content = `---
id: BACK-300
labels: [a, b, c]
---

Body`;

    const { data } = parseFrontmatter(content);
    assert.deepStrictEqual(data.labels, ['a', 'b', 'c']);
  });

  it('Пустой файл', () => {
    const { data, body } = parseFrontmatter('');
    assert.deepStrictEqual(data, {});
    assert.equal(body, '');
  });

  it('Только frontmatter, без тела', () => {
    const content = `---
id: BACK-400
title: Only frontmatter
---`;

    const { data, body } = parseFrontmatter(content);
    assert.equal(data.id, 'BACK-400');
    assert.equal(data.title, 'Only frontmatter');
  });
});

describe('serializeFrontmatter', () => {
  it('Сериализует данные и тело', () => {
    const data = { id: 'BACK-1', title: 'Test', status: 'To Do' };
    const body = '## Description\n\nHello world';
    const result = serializeFrontmatter(data, body);

    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('id: BACK-1'));
    assert.ok(result.includes('title: Test'));
    assert.ok(result.endsWith('## Description\n\nHello world'));
  });

  it('Round-trip: parse → serialize → parse', () => {
    const original = `---
id: BACK-100
title: Add embedded web server
status: Done
assignee: []
labels:
  - enhancement
  - web
dependencies: []
priority: medium
created_date: '2025-06-22'
---

## Description

Implement a web-based UI.`;

    const { data: data1, body: body1 } = parseFrontmatter(original);
    const serialized = serializeFrontmatter(data1, body1);
    const { data: data2, body: body2 } = parseFrontmatter(serialized);

    assert.deepStrictEqual(data1, data2);
    assert.equal(body1, body2);
  });
});

describe('Парсинг реальных файлов Backlog.md', () => {
  // refs/ не в git (worktree его не видит) — пропускаем паттерном compat-тестов.
  // console.log в ENOENT-фолбэке НЕ использовать: stdout дочернего процесса
  // node --test — канал сериализации тест-раннера, посторонние записи ломают
  // десериализацию («Unable to deserialize cloned data», поймано в worktree).
  const refsTasksDir = join(backlogRoot, 'backlog', 'tasks');
  const refsCompletedDir = join(backlogRoot, 'backlog', 'completed');

  it('back-200: активная задача с массивами и кавычками', async (t) => {
    const filePath = join(refsTasksDir, 'back-200 - Add-Claude-Code-integration-with-workflow-commands-during-init.md');
    if (!existsSync(filePath)) {
      t.skip(`Оригинал Backlog.md не найден: ${filePath}`);
      return;
    }
    const content = await readFile(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    assert.equal(data.id, 'BACK-200');
    assert.equal(data.title, 'Add Claude Code integration with workflow commands during init');
    assert.equal(data.status, 'To Do');
    assert.ok(Array.isArray(data.assignee));
    assert.ok(Array.isArray(data.labels));
    assert.ok(Array.isArray(data.dependencies));
    assert.equal(data.priority, 'medium');
    assert.ok(body.includes('## Description'));
  });

  it('back-100: завершённая задача', async (t) => {
    const filePath = join(refsCompletedDir, 'back-100 - Add-embedded-web-server-to-Backlog-CLI.md');
    if (!existsSync(filePath)) {
      t.skip(`Оригинал Backlog.md не найден: ${filePath}`);
      return;
    }
    const content = await readFile(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    assert.equal(data.id, 'BACK-100');
    assert.equal(data.status, 'Done');
    assert.ok(body.includes('## Description'));
  });

  it('back-100.1: подзадача с parent_task_id', async (t) => {
    const filePath = join(refsCompletedDir, 'back-100.1 - Setup-React-project-structure-with-shadcn-ui.md');
    if (!existsSync(filePath)) {
      t.skip(`Оригинал Backlog.md не найден: ${filePath}`);
      return;
    }
    const content = await readFile(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    assert.equal(data.id, 'BACK-100.1');
    assert.equal(data.status, 'Done');
    assert.equal(data.parent_task_id, 'task-100');
    assert.ok(body.includes('## Description'));
  });

  it('back-418: задача с кавычками и references', async (t) => {
    const filePath = join(refsTasksDir, 'back-418 - Publish-supported-container-runtime-for-backlog-browser.md');
    if (!existsSync(filePath)) {
      t.skip(`Оригинал Backlog.md не найден: ${filePath}`);
      return;
    }
    const content = await readFile(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    assert.equal(data.id, 'BACK-418');
    assert.ok(Array.isArray(data.references));
    assert.ok(data.references.length > 0);
    assert.ok(data.references[0].startsWith('https://'));
    assert.ok(body.includes('## Description'));
  });
});
