import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createTask, taskToMarkdown, markdownToTask, taskFilename } from '../../dist/core/task.js';
import { stringifyYaml, parseYaml } from '../../dist/core/yaml.js';
import { nextTaskId } from '../../dist/core/id.js';
import { renderMarkdown } from '../../dist/core/markdown.js';
import { searchTasks } from '../../dist/core/search.js';
import { blockedBy, blocks, isReady, validateDeps } from '../../dist/core/deps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Тестовая директория — создаём и удаляем для каждого теста
const testDir = join(__dirname, '..', '..', '.test-tmp');
const backlogDir = join(testDir, 'backlog');
const tasksDir = join(backlogDir, 'tasks');
const completedDir = join(backlogDir, 'completed');

function setupTestDir() {
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(completedDir, { recursive: true });
  // Конфиг по умолчанию
  const config = {
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: ['Tests pass'],
  };
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');
}

function cleanupTestDir() {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('task.mjs — модель задачи', () => {
  before(() => setupTestDir());
  after(() => cleanupTestDir());

  it('createTask создаёт объект с дефолтами', () => {
    const config = { default_status: 'To Do' };
    const task = createTask({ id: 'tst-1', title: 'Test task' }, config);
    assert.equal(task.id, 'tst-1');
    assert.equal(task.title, 'Test task');
    assert.equal(task.status, 'To Do');
    assert.deepStrictEqual(task.assignee, []);
    assert.deepStrictEqual(task.labels, []);
    assert.deepStrictEqual(task.dependencies, []);
    assert.equal(task.description, '');
  });

  it('taskToMarkdown генерирует корректный markdown', () => {
    const task = createTask(
      { id: 'tst-1', title: 'Test', description: 'Описание', acceptanceCriteria: ['Критерий 1'] },
      { default_status: 'To Do' }
    );
    const md = taskToMarkdown(task);
    assert.ok(md.startsWith('---\n'));
    assert.ok(md.includes('id: tst-1'));
    assert.ok(md.includes('title: Test'));
    assert.ok(md.includes('## Description'));
    assert.ok(md.includes('<!-- SECTION:DESCRIPTION:BEGIN -->'));
    assert.ok(md.includes('<!-- AC:BEGIN -->'));
    assert.ok(md.includes('- [ ] #1 Критерий 1'));
    assert.ok(md.includes('<!-- AC:END -->'));
  });

  it('markdownToTask парсит обратно', () => {
    const original = createTask(
      { id: 'tst-2', title: 'Parse test', status: 'In Progress', labels: ['bug'] },
      { default_status: 'To Do' }
    );
    const md = taskToMarkdown(original);
    const parsed = markdownToTask(md);
    assert.equal(parsed.id, 'tst-2');
    assert.equal(parsed.title, 'Parse test');
    assert.equal(parsed.status, 'In Progress');
    assert.deepStrictEqual(parsed.labels, ['bug']);
  });

  it('taskFilename генерирует правильное имя файла', () => {
    const task = { id: 'back-100', title: 'Add web server' };
    const name = taskFilename(task);
    assert.equal(name, 'back-100 - Add-web-server.md');
  });

  it('taskFilename экранирует спецсимволы в заголовке', () => {
    const task = { id: 'back-1', title: 'Fix "bug" & (issue)!' };
    const name = taskFilename(task);
    assert.ok(!name.includes('"'));
    assert.ok(!name.includes('&'));
    assert.ok(!name.includes('('));
  });

  it('Round-trip: createTask → taskToMarkdown → markdownToTask', () => {
    const config = { default_status: 'To Do' };
    const original = createTask({
      id: 'tst-3',
      title: 'Round trip',
      description: 'Описание задачи',
      acceptanceCriteria: ['Критерий 1', 'Критерий 2'],
      definitionOfDone: ['DoD 1'],
      labels: ['feature'],
      dependencies: ['tst-1'],
    }, config);

    const md = taskToMarkdown(original);
    const parsed = markdownToTask(md);

    assert.equal(parsed.id, original.id);
    assert.equal(parsed.title, original.title);
    assert.equal(parsed.description, original.description);
    assert.equal(parsed.acceptanceCriteria.length, 2);
    assert.equal(parsed.acceptanceCriteria[0].text, 'Критерий 1');
    assert.equal(parsed.definitionOfDone.length, 1);
    assert.deepStrictEqual(parsed.labels, ['feature']);
    assert.deepStrictEqual(parsed.dependencies, ['tst-1']);
  });

  // --- Баги совместимости PLAN-09.2 ---

  it('Баг A: ## Final Summary без (Optional)', () => {
    const task = createTask({ id: 'tst-10', title: 'Test', finalSummary: 'Итог' }, { default_status: 'To Do' });
    const md = taskToMarkdown(task);
    assert.ok(md.includes('## Final Summary\n'), 'заголовок Final Summary без (Optional)');
    assert.ok(!md.includes('Final Summary (Optional)'), 'не должно содержать (Optional)');
  });

  it('Баг A: ## Implementation Plan и Notes без (Optional)', () => {
    const task = createTask({
      id: 'tst-11', title: 'Test',
      implementationPlan: 'План', implementationNotes: 'Заметки',
    }, { default_status: 'To Do' });
    const md = taskToMarkdown(task);
    assert.ok(md.includes('## Implementation Plan\n'));
    assert.ok(!md.includes('Implementation Plan (Optional)'));
    assert.ok(md.includes('## Implementation Notes\n'));
    assert.ok(!md.includes('Implementation Notes (Optional)'));
  });

  it('Баг C: frontmatter содержит полный набор полей', () => {
    const task = createTask({ id: 'tst-12', title: 'Test' }, { default_status: 'To Do' });
    const md = taskToMarkdown(task);
    // Пустые массивы пишутся
    assert.ok(md.includes('assignee: []'), 'assignee: []');
    assert.ok(md.includes('labels: []'), 'labels: []');
    assert.ok(md.includes('dependencies: []'), 'dependencies: []');
    assert.ok(md.includes('references: []'), 'references: []');
    // Пустые строки пишутся
    assert.ok(md.includes('reporter:'), 'reporter:');
    assert.ok(md.includes('due_date:'), 'due_date:');
    assert.ok(md.includes('milestone:'), 'milestone:');
    // ordinal пишется
    assert.ok(md.includes('ordinal: 0'), 'ordinal: 0');
  });

  it('Баг C: priority в lowercase при записи', () => {
    const task = createTask({ id: 'tst-13', title: 'Test', priority: 'High' }, { default_status: 'To Do' });
    const md = taskToMarkdown(task);
    assert.ok(md.includes('priority: high'), 'priority: high (lowercase)');
    assert.ok(!md.includes('priority: High'), 'не должно быть High с заглавной');
  });

  it('Баг C: priority нормализуется при чтении (round-trip)', () => {
    const task = createTask({ id: 'tst-14', title: 'Test', priority: 'Medium' }, { default_status: 'To Do' });
    const md = taskToMarkdown(task);
    const parsed = markdownToTask(md);
    assert.equal(parsed.priority, 'Medium', 'round-trip сохраняет Medium');
  });

  it('Баг C: round-trip с полным frontmatter', () => {
    const config = { default_status: 'To Do' };
    const original = createTask({
      id: 'tst-15', title: 'Full round-trip',
      priority: 'High', assignee: ['@dev'], labels: ['bug'],
      dependencies: ['tst-1'], references: ['https://example.com'],
      milestone: 'v1.0', reporter: '@pavel', due_date: '2026-12-31',
    }, config);
    const md = taskToMarkdown(original);
    const parsed = markdownToTask(md);

    assert.equal(parsed.priority, 'High');
    assert.deepStrictEqual(parsed.assignee, ['@dev']);
    assert.deepStrictEqual(parsed.labels, ['bug']);
    assert.deepStrictEqual(parsed.dependencies, ['tst-1']);
    assert.deepStrictEqual(parsed.references, ['https://example.com']);
    assert.equal(parsed.milestone, 'v1.0');
    assert.equal(parsed.reporter, '@pavel');
    assert.equal(parsed.due_date, '2026-12-31');
  });
});

describe('id.mjs — генерация ID', () => {
  before(() => setupTestDir());
  after(() => cleanupTestDir());

  it('nextTaskId возвращает tst-1 когда задач нет', () => {
    const id = nextTaskId(testDir, 'tst');
    assert.equal(id, 'tst-1');
  });

  it('nextTaskId возвращает следующий номер', () => {
    // Создаём файл задачи вручную
    writeFileSync(join(tasksDir, 'tst-5 - existing.md'), '---\nid: TST-5\ntitle: existing\nstatus: To Do\n---', 'utf-8');
    const id = nextTaskId(testDir, 'tst');
    assert.equal(id, 'tst-6');
  });

  it('nextTaskId учитывает completed/', () => {
    writeFileSync(join(completedDir, 'tst-10 - done.md'), '---\nid: TST-10\ntitle: done\nstatus: Done\n---', 'utf-8');
    const id = nextTaskId(testDir, 'tst');
    assert.equal(id, 'tst-11');
  });
});

describe('search.mjs — поиск задач', () => {
  before(() => {
    setupTestDir();
    // Создаём тестовые задачи напрямую в файловой системе
    const tasks = [
      { id: 'tst-1', title: 'Add web server', labels: ['enhancement'] },
      { id: 'tst-2', title: 'Fix login bug', labels: ['bug'] },
      { id: 'tst-3', title: 'Update docs', labels: ['documentation'] },
    ];
    for (const t of tasks) {
      const md = taskToMarkdown(createTask(t, { default_status: 'To Do' }));
      writeFileSync(join(tasksDir, `${t.id} - ${t.title.replace(/\s+/g, '-')}.md`), md, 'utf-8');
    }
  });
  after(() => cleanupTestDir());

  it('Пустой запрос → все задачи', () => {
    const results = searchTasks(testDir, '');
    assert.equal(results.length, 3);
  });

  it('Поиск по заголовку', () => {
    const results = searchTasks(testDir, 'web server');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'tst-1');
  });

  it('Поиск по метке', () => {
    const results = searchTasks(testDir, 'bug');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'tst-2');
  });

  it('Регистронезависимый поиск', () => {
    const results = searchTasks(testDir, 'WEB');
    assert.equal(results.length, 1);
  });

  it('Поиск по ID', () => {
    const results = searchTasks(testDir, 'tst-3');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'tst-3');
  });

  it('Ничего не найдено', () => {
    const results = searchTasks(testDir, 'nonexistent');
    assert.equal(results.length, 0);
  });
});

describe('deps.mjs — зависимости', () => {
  before(() => {
    setupTestDir();
    const tasks = [
      { id: 'tst-1', title: 'Base task' },
      { id: 'tst-2', title: 'Depends on 1', dependencies: ['tst-1'] },
      { id: 'tst-3', title: 'Depends on 2', dependencies: ['tst-2'] },
    ];
    for (const t of tasks) {
      const md = taskToMarkdown(createTask(t, { default_status: 'To Do' }));
      writeFileSync(join(tasksDir, `${t.id} - ${t.title.replace(/\s+/g, '-')}.md`), md, 'utf-8');
    }
  });
  after(() => cleanupTestDir());

  it('blockedBy возвращает зависимости', () => {
    const task2 = { id: 'tst-2', dependencies: ['tst-1'] };
    const deps = blockedBy(testDir, task2);
    assert.equal(deps.length, 1);
    assert.equal(deps[0].id, 'tst-1');
  });

  it('blocks возвращает зависимые задачи', () => {
    const task1 = { id: 'tst-1' };
    const blocked = blocks(testDir, task1);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].id, 'tst-2');
  });

  it('isReady — задача без зависимостей готова', () => {
    const task1 = { id: 'tst-1', dependencies: [] };
    assert.equal(isReady(testDir, task1), true);
  });

  it('isReady — задача с невыполненной зависимостью не готова', () => {
    const task2 = { id: 'tst-2', dependencies: ['tst-1'] };
    assert.equal(isReady(testDir, task2), false);
  });

  it('validateDeps — нет циклов', () => {
    const task1 = { id: 'tst-1', dependencies: [] };
    const result = validateDeps(testDir, task1);
    assert.equal(result.valid, true);
    assert.deepStrictEqual(result.cycle, []);
  });

  it('validateDeps — обнаруживает цикл', () => {
    // Создаём циклическую зависимость: A → B → A
    const taskA = { id: 'A', dependencies: ['B'] };
    const taskB = { id: 'B', dependencies: ['A'] };
    const result = validateDeps(testDir, taskA, [taskA, taskB]);
    assert.equal(result.valid, false);
    assert.ok(result.cycle.length > 0);
  });
});

describe('markdown.mjs — рендерер', () => {
  it('Пустой текст → пустая строка', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
  });

  it('Заголовки', () => {
    const result = renderMarkdown('# Hello\n## World');
    assert.ok(result.includes('<h1>Hello</h1>'));
    assert.ok(result.includes('<h2>World</h2>'));
  });

  it('Параграфы', () => {
    const result = renderMarkdown('Text here');
    assert.ok(result.includes('<p>Text here</p>'));
  });

  it('Жирный и курсив', () => {
    const result = renderMarkdown('**bold** and *italic*');
    assert.ok(result.includes('<strong>bold</strong>'));
    assert.ok(result.includes('<em>italic</em>'));
  });

  it('Inline-код', () => {
    const result = renderMarkdown('Use `node` to run');
    assert.ok(result.includes('<code>node</code>'));
  });

  it('Ссылки', () => {
    const result = renderMarkdown('[Google](https://google.com)');
    assert.ok(result.includes('<a href="https://google.com">Google</a>'));
  });

  it('Чеклисты', () => {
    const result = renderMarkdown('- [ ] Not done\n- [x] Done');
    assert.ok(result.includes('type="checkbox"'));
    assert.ok(result.includes('checked'));
  });

  it('Блоки кода', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    assert.ok(result.includes('<pre>'));
    assert.ok(result.includes('language-js'));
  });

  it('Ненумерованные списки', () => {
    const result = renderMarkdown('- Item 1\n- Item 2');
    assert.ok(result.includes('<li>Item 1</li>'));
    assert.ok(result.includes('<li>Item 2</li>'));
  });

  it('Горизонтальная линия', () => {
    const result = renderMarkdown('---');
    assert.ok(result.includes('<hr>'));
  });
});
