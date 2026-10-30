/**
 * Тесты снимка applied/skipped и идемпотентности write-инструментов MCP (VL-262).
 *
 * Проверяют контракт ответа на реальных операциях с задачами:
 * - applied берётся из файла ПОСЛЕ записи (что записалось, а не что просили);
 * - переданное поле вне известного набора попадает в skipped (раньше молча терялось);
 * - атомарность: ошибка валидации одного поля не применяет остальные;
 * - idempotencyKey: повтор не создаёт дубль и не перезаписывает updated_date.
 *
 * Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile, getTask, listTasks } from '../../dist/core/store.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-write-ack-'));
const backlogDir = join(cwd, 'backlog');

function writeConfig() {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  const config = {
    project_name: 'WriteAck Test',
    task_prefix: 'wa',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  };
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml(config), 'utf-8');}

beforeAll(() => {
  writeConfig();
});
afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('VL-262 — applied отражает фактическое состояние файла', () => {
  it('update_task с 3 полями → applied содержит ровно записанные значения', async () => {
    const t = createTaskFile(cwd, { title: 'Исходный заголовок', description: 'д', priority: 'Low' });
    const out = await handleToolCall(
      'backlog_update_task',
      { id: t.id, title: 'Новый заголовок', priority: 'High', labels: ['acl', 'mcp'] },
      cwd,
    );
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true);
    assert.match(ack.message, /обновлена/);
    assert.equal(ack.applied.title, 'Новый заголовок');
    assert.equal(ack.applied.priority, 'High');
    assert.deepEqual(ack.applied.labels, ['acl', 'mcp']);
    assert.deepEqual(ack.skipped, []);
    // сверка с диском — applied не врёт
    const stored = getTask(cwd, t.id);
    assert.equal(stored.title, 'Новый заголовок');
    assert.equal(stored.priority, 'High');
    assert.deepEqual(stored.labels, ['acl', 'mcp']);
  });

  it('неизвестное поле вызова (definitionOfDone) → skipped с причиной, файл не изменён', async () => {
    const t = createTaskFile(cwd, { title: 'Скип-тест' });
    const out = await handleToolCall(
      'backlog_update_task',
      { id: t.id, title: 'Скип-тест 2', definitionOfDone: ['Неизвестное поле'] },
      cwd,
    );
    const ack = JSON.parse(out);
    assert.equal(ack.applied.title, 'Скип-тест 2');
    assert.equal(ack.skipped.length, 1);
    assert.equal(ack.skipped[0].field, 'definitionOfDone');
    assert.match(ack.skipped[0].reason, /неизвестное поле/);
  });

  it('type: null → skipped (поле не стёрто)', async () => {
    const t = createTaskFile(cwd, { title: 'Null-тип', type: 'bug' });
    const out = await handleToolCall('backlog_update_task', { id: t.id, type: null, priority: 'Medium' }, cwd);
    const ack = JSON.parse(out);
    assert.equal(ack.applied.priority, 'Medium');
    assert.ok(ack.skipped.some((s) => s.field === 'type'), `type должен быть в skipped: ${out}`);
    assert.equal(getTask(cwd, t.id).type, 'bug', 'type не стёрт');
  });
});

describe('VL-262 — атомарность обновления', () => {
  it('ошибка валидации parentTaskId не применяет остальные поля', async () => {
    const t = createTaskFile(cwd, { title: 'Атомарность', priority: 'Low', labels: ['было'] });
    await assert.rejects(
      handleToolCall(
        'backlog_update_task',
        { id: t.id, title: 'Должен откатиться', labels: ['новое'], parentTaskId: 'wa-999' },
        cwd,
      ),
      /не найдена/,
    );
    const stored = getTask(cwd, t.id);
    assert.equal(stored.title, 'Атомарность', 'title не изменён');
    assert.deepEqual(stored.labels, ['было'], 'labels не изменены');
    assert.equal(stored.priority, 'Low');
  });

  it('только неизвестные поля → ошибка с перечнем допустимых, файл не тронут', async () => {
    const t = createTaskFile(cwd, { title: 'Только неизвестные' });
    await assert.rejects(
      handleToolCall('backlog_update_task', { id: t.id, definitionOfDone: ['x'], foo: 1 }, cwd),
      /Неизвестные поля: .*definitionOfDone/,
    );
    assert.equal(getTask(cwd, t.id).title, 'Только неизвестные');
  });
});

describe('VL-262 — idempotencyKey', () => {
  it('повтор create с тем же ключом → одна задача и пометка idempotentReplay', async () => {
    const args = { title: 'Идемпотентная задача', idempotencyKey: 'create-same-1' };
    const first = JSON.parse(await handleToolCall('backlog_create_task', args, cwd));
    const second = JSON.parse(await handleToolCall('backlog_create_task', args, cwd));
    assert.equal(first.ok, true);
    assert.ok(!first.idempotentReplay);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.applied.id, first.applied.id, 'тот же id задачи');
    const dupes = listTasks(cwd).filter((t) => t.title === 'Идемпотентная задача');
    assert.equal(dupes.length, 1, 'дубля нет');
  });

  it('повтор update_task с тем же ключом не перезаписывает updated_date', async () => {
    const t = createTaskFile(cwd, { title: 'Идемпотентный апдейт' });
    const args = { id: t.id, priority: 'High', idempotencyKey: 'upd-same-1' };
    await handleToolCall('backlog_update_task', args, cwd);
    const afterFirst = getTask(cwd, t.id).updated_date;
    const second = JSON.parse(await handleToolCall('backlog_update_task', args, cwd));
    assert.equal(second.idempotentReplay, true);
    assert.equal(getTask(cwd, t.id).updated_date, afterFirst, 'файл не перезаписан');
  });

  it('idempotencyKey другой — эффект применяется заново', async () => {
    const t = createTaskFile(cwd, { title: 'Разные ключи' });
    await handleToolCall('backlog_update_task', { id: t.id, priority: 'High', idempotencyKey: 'k1' }, cwd);
    const second = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, priority: 'Low', idempotencyKey: 'k2' }, cwd),
    );
    assert.ok(!second.idempotentReplay);
    assert.equal(getTask(cwd, t.id).priority, 'Low');
  });

  it('add_comment с ключом не дублирует комментарий', async () => {
    const t = createTaskFile(cwd, { title: 'Один комментарий' });
    const args = { id: t.id, comment: 'текст отчёта', author: '@agent', idempotencyKey: 'cmt-1' };
    await handleToolCall('backlog_add_comment', args, cwd);
    await handleToolCall('backlog_add_comment', args, cwd);
    assert.equal(getTask(cwd, t.id).comments.length, 1, 'комментарий один');
  });
});

describe('VL-262 — applied у остальных write-инструментов', () => {
  it('update_status → applied.status; add_comment → applied.comment', async () => {
    const t = createTaskFile(cwd, { title: 'Статус и коммент' });
    const st = JSON.parse(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd));
    assert.equal(st.applied.status, 'In Progress');
    assert.match(st.message, /обновлён/);
    const cm = JSON.parse(await handleToolCall('backlog_add_comment', { id: t.id, comment: 'привет' }, cwd));
    assert.equal(cm.applied.comment.author, '@agent');
    assert.equal(cm.applied.comment.id, t.id);
  });

  it('update_dependencies → applied.dependencies', async () => {
    const base = createTaskFile(cwd, { title: 'База' });
    const t = createTaskFile(cwd, { title: 'Зависимая' });
    const out = JSON.parse(await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd));
    assert.deepEqual(out.applied.dependencies, [base.id]);
  });
});
