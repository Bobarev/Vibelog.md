import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { stringifyYaml } from './yaml.mjs';
import {
  listTasks, getTask, createTaskFile,
  updateTaskFile, archiveTaskFile, completeTaskFile,
} from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-store');
const backlogDir = join(testDir, 'backlog');

function setup() {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  mkdirSync(join(backlogDir, 'completed'), { recursive: true });
  mkdirSync(join(backlogDir, 'drafts'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
}

describe('store.mjs — CRUD операции', () => {
  before(() => setup());
  after(() => cleanup());

  it('listTasks — пусто когда задач нет', () => {
    assert.deepStrictEqual(listTasks(testDir), []);
  });

  it('createTaskFile — создаёт задачу и файл', () => {
    const task = createTaskFile(testDir, {
      title: 'Тестовая задача',
      description: 'Описание',
      priority: 'High',
      labels: ['bug'],
      acceptanceCriteria: [{ text: 'Критерий 1', checked: false }],
    });
    assert.equal(task.id, 'tst-1');
    assert.equal(task.title, 'Тестовая задача');
    assert.equal(task.status, 'To Do');
    assert.ok(existsSync(join(backlogDir, 'tasks', 'tst-1 - Тестовая-задача.md')));
  });

  it('listTasks — возвращает созданную задачу', () => {
    const tasks = listTasks(testDir);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'tst-1');
    assert.equal(tasks[0].title, 'Тестовая задача');
  });

  it('getTask — находит по ID', () => {
    const task = getTask(testDir, 'tst-1');
    assert.ok(task);
    assert.equal(task.id, 'tst-1');
    assert.equal(task.priority, 'High');
    assert.deepStrictEqual(task.labels, ['bug']);
    assert.equal(task.acceptanceCriteria.length, 1);
    assert.equal(task.acceptanceCriteria[0].text, 'Критерий 1');
  });

  it('getTask — возвращает null для несуществующей', () => {
    assert.equal(getTask(testDir, 'tst-999'), null);
  });

  it('updateTaskFile — обновляет статус', () => {
    const updated = updateTaskFile(testDir, 'tst-1', { status: 'In Progress' });
    assert.equal(updated.status, 'In Progress');
    const task = getTask(testDir, 'tst-1');
    assert.equal(task.status, 'In Progress');
  });

  it('updateTaskFile — обновляет AC', () => {
    const updated = updateTaskFile(testDir, 'tst-1', {
      acceptanceCriteria: [
        { text: 'Критерий 1', checked: true },
        { text: 'Критерий 2', checked: false },
      ],
    });
    assert.equal(updated.acceptanceCriteria.length, 2);
    assert.equal(updated.acceptanceCriteria[0].checked, true);
    assert.equal(updated.acceptanceCriteria[1].checked, false);
  });

  it('updateTaskFile — выбрасывает ошибку для несуществующей задачи', () => {
    assert.throws(() => updateTaskFile(testDir, 'tst-999', {}), /не найдена/);
  });

  it('archiveTaskFile — перемещает в completed/', () => {
    archiveTaskFile(testDir, 'tst-1');
    assert.ok(!existsSync(join(backlogDir, 'tasks', 'tst-1 - Тестовая-задача.md')));
    assert.ok(existsSync(join(backlogDir, 'completed', 'tst-1 - Тестовая-задача.md')));
  });

  it('completeTaskFile — меняет статус и архивирует', () => {
    // Создаём новую задачу
    createTaskFile(testDir, { title: 'Для завершения' });
    const task = completeTaskFile(testDir, 'tst-2');
    assert.equal(task.status, 'Done');
    assert.ok(!existsSync(join(backlogDir, 'tasks', 'tst-2 - Для-завершения.md')));
    assert.ok(existsSync(join(backlogDir, 'completed', 'tst-2 - Для-завершения.md')));
  });

  it('createTaskFile — генерирует следующий ID', () => {
    createTaskFile(testDir, { title: 'Третья задача' });
    const task = getTask(testDir, 'tst-3');
    assert.ok(task);
    assert.equal(task.id, 'tst-3');
  });
});
