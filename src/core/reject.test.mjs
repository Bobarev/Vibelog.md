/**
 * Тесты VL-144 — механика отказа от задачи (rejectTaskFile) и детектор wasInCode.
 *
 * rejectTaskFile: статус Rejected → перенос в completed/, опциональный
 * комментарий, ошибка на несуществующей задаче.
 * wasInCode: 4 кейса детектора (отчёт «Фаза 3 (Code)», статус In Progress,
 * непустой finalSummary, To Do без признаков) — от него зависит выбор пути
 * reject (механика vs LLM-откат).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import {
  createTaskFile,
  updateTaskFile,
  addComment,
  getTask,
  rejectTaskFile,
  wasInCode,
} from '../../dist/core/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '..', '.test-reject');
const backlogDir = join(testDir, 'backlog');
const tasksDir = join(backlogDir, 'tasks');
const completedDir = join(backlogDir, 'completed');

function setup() {
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(completedDir, { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Reject Test',
    task_prefix: 'rjt',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done', 'Rejected'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
}

describe('VL-144 — rejectTaskFile (механика отказа)', () => {
  let task;

  beforeAll(() => setup());
  afterAll(() => cleanup());

  beforeEach(() => {
    // Свежая задача на каждый кейс: архив переносит файл, старые не мешают
    task = createTaskFile(testDir, { title: 'Отклоняемая задача', status: 'To Do' });
  });

  it('без комментария: статус Rejected, файл уходит в completed/', () => {
    const rejected = rejectTaskFile(testDir, task.id);
    assert.equal(rejected.status, 'Rejected');
    // Файл задачи больше не в tasks/...
    const inTasks = readdirSync(tasksDir).filter(f => f.includes(task.id));
    assert.equal(inTasks.length, 0, `файл ${task.id} должен уйти из tasks/`);
    // ...и лежит в completed/
    const inCompleted = readdirSync(completedDir).filter(f => f.includes(task.id));
    assert.equal(inCompleted.length, 1, `файл ${task.id} должен быть в completed/`);
    // В архивном файле статус Rejected
    const content = readFileSync(join(completedDir, inCompleted[0]), 'utf-8');
    assert.ok(content.includes('Rejected'), 'статус Rejected в файле');
  });

  it('с комментарием: причина добавляется в задачу до архива', () => {
    const rejected = rejectTaskFile(testDir, task.id, 'Не актуально больше');
    assert.equal(rejected.status, 'Rejected');
    const inCompleted = readdirSync(completedDir).filter(f => f.includes(task.id));
    assert.equal(inCompleted.length, 1);
    const content = readFileSync(join(completedDir, inCompleted[0]), 'utf-8');
    assert.ok(content.includes('Не актуально больше'), 'комментарий в архивном файле');
  });

  it('пустой комментарий (пустая строка) — не добавляет пустых комментариев', () => {
    const rejected = rejectTaskFile(testDir, task.id, '   ');
    assert.equal(rejected.status, 'Rejected');
    assert.equal(rejected.comments.length, 0, 'пустой комментарий не пишется');
  });

  it('несуществующая задача — ошибка', () => {
    assert.throws(() => rejectTaskFile(testDir, 'rjt-999'), /не найдена/);
  });
});

describe('VL-144 — wasInCode (детектор бывшей в Code)', () => {
  let base;

  beforeAll(() => setup());
  afterAll(() => cleanup());

  beforeEach(() => {
    base = createTaskFile(testDir, { title: 'Детектор', status: 'To Do' });
  });

  it('отчёт «Фаза 3 (Code)» в комментариях → true', () => {
    const t = addComment(testDir, base.id, 'Фаза 3 (Code) выполнена. Тип: task.');
    assert.equal(wasInCode(t), true);
  });

  it('статус In Progress → true (код шёл)', () => {
    const t = updateTaskFile(testDir, base.id, { status: 'In Progress' });
    assert.equal(wasInCode(t), true);
  });

  it('статус Review → true (код шёл/после Code)', () => {
    const t = updateTaskFile(testDir, base.id, { status: 'Review' });
    assert.equal(wasInCode(t), true);
  });

  it('непустой finalSummary → true', () => {
    const t = updateTaskFile(testDir, base.id, { finalSummary: 'Готово' });
    assert.equal(wasInCode(t), true);
  });

  it('непустые implementationNotes → true', () => {
    const t = updateTaskFile(testDir, base.id, { implementationNotes: 'Что-то сделано' });
    assert.equal(wasInCode(t), true);
  });

  it('To Do без признаков → false (механика, без LLM)', () => {
    const t = getTask(testDir, base.id);
    assert.equal(wasInCode(t), false);
  });

  it('Spec/Planned без признаков → false', () => {
    for (const status of ['Spec', 'Planned']) {
      const t = updateTaskFile(testDir, base.id, { status });
      assert.equal(wasInCode(t), false, `${status} — ещё не Code`);
    }
  });
});
