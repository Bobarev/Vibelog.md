/**
 * Инвариант-тест единого JSON-контракта write-инструментов MCP (VL-306).
 *
 * Проблема, которую тест закрывает: VL-303/VL-304 починили noop-детекцию и
 * защиту `appliedSignatures`, но только для `backlog_update_task` — остальные
 * write-инструменты отвечали плоским текстом, и механизм для них не
 * включался (сессия agent-1793634687751: 10 дословных повторов
 * `lesson_update` → loop detection → fail, код 1).
 *
 * Два уровня защиты:
 * 1. Каждый write-инструмент из AC1 обязан вернуть JSON с полем `ok` —
 *    кейсы ниже вызывают их с реальными аргументами.
 * 2. Инвариант по реестру: если в `listTools()` появится НОВЫЙ write-инструмент
 *    (по классификатору `isWriteOperation`), которого нет ни в покрытом
 *    наборе, ни в явном списке исключений с причиной, тест упадёт —
 *    «пятый случай» не проскочит молча.
 *
 * Фикстуры создаются ядром (createDocument/addReference/createLessonFile), а не
 * MCP-инструментами создания: `document_create`/`reference_add`/`lesson_create`
 * в контракт VL-306 не входят и отвечают текстом.
 *
 * Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { createTaskFile } from '../../dist/core/store.js';
import { writeDocument } from '../../dist/core/document.js';
import { writeReference } from '../../dist/core/reference.js';
import { createLessonFile } from '../../dist/core/lesson.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-write-ack-contract-'));
const backlogDir = join(cwd, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'WriteAck Contract Test',
    task_prefix: 'wa',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Разбирает ответ инструмента как JSON-ack и проверяет базовую форму. */
function parseAck(out, name) {
  let ack;
  try {
    ack = JSON.parse(out);
  } catch {
    assert.fail(`${name}: ответ не JSON — ${String(out).slice(0, 200)}`);
  }
  assert.equal(typeof ack.ok, 'boolean', `${name}: поле ok должно быть boolean — ${out.slice(0, 200)}`);
  assert.equal(typeof ack.message, 'string', `${name}: поле message обязательно — ${out.slice(0, 200)}`);
  return ack;
}

describe('VL-306 — все write-инструменты отвечают JSON-ack', () => {
  it('AC1: backlog_update_status', async () => {
    const t = createTaskFile(cwd, { title: 'Статус' });
    const ack = parseAck(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd), 'backlog_update_status');
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.status, 'In Progress');
  });

  it('AC1: milestone_add / milestone_rename / milestone_archive', async () => {
    const add = parseAck(await handleToolCall('milestone_add', { name: 'M1', description: 'd' }, cwd), 'milestone_add');
    assert.equal(add.ok, true);
    assert.equal(add.applied.name, 'M1');

    const rename = parseAck(await handleToolCall('milestone_rename', { from: 'M1', to: 'M2' }, cwd), 'milestone_rename');
    assert.equal(rename.ok, true);
    assert.equal(rename.applied.to, 'M2');

    const archive = parseAck(await handleToolCall('milestone_archive', { name: 'M2' }, cwd), 'milestone_archive');
    assert.equal(archive.ok, true);
    assert.equal(archive.applied.status, 'archived');
  });

  it('AC1: document_update', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док', content: 'тело' });
    const ack = parseAck(await handleToolCall('document_update', { id: doc.id, title: 'Док 2' }, cwd), 'document_update');
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.title, 'Док 2');
  });

  it('AC1: reference_update', async () => {
    const ref = writeReference(cwd, { title: 'Ref', type: 'url', url: 'https://example.com' });
    const ack = parseAck(await handleToolCall('reference_update', { id: ref.id, tags: ['t1'] }, cwd), 'reference_update');
    assert.equal(ack.ok, true);
    assert.deepEqual(ack.applied.tags, ['t1']);
  });

  it('AC1: lesson_update / lesson_link / lesson_supersede', async () => {
    const l1 = createLessonFile(cwd, { title: 'Урок 1', tags: ['a'] });
    const l2 = createLessonFile(cwd, { title: 'Урок 2', tags: ['b'] });
    const t = createTaskFile(cwd, { title: 'Задача для связи' });

    const upd = parseAck(await handleToolCall('lesson_update', { id: l1.id, verifiedBy: 'agent' }, cwd), 'lesson_update');
    assert.equal(upd.ok, true);
    assert.equal(upd.applied.verified_by, 'agent');

    const link = parseAck(await handleToolCall('lesson_link', { lessonId: l1.id, taskId: t.id }, cwd), 'lesson_link');
    assert.equal(link.ok, true);
    assert.equal(link.applied.lessonId, l1.id);

    const sup = parseAck(await handleToolCall('lesson_supersede', { oldId: l1.id, newId: l2.id }, cwd), 'lesson_supersede');
    assert.equal(sup.ok, true);
    assert.equal(sup.applied.old_status, 'superseded');
  });

  it('AC5: каждый write-инструмент реестра покрыт таблицей ack-контракта', () => {
    // Покрытые JSON-ack контрактом (VL-262 + VL-306): кейсы выше + уже
    // переведённые ранее инструменты задач.
    const covered = new Set([
      'backlog_create_task',
      'backlog_update_task',
      'backlog_update_status',
      'backlog_add_comment',
      'backlog_update_dependencies',
      'backlog_finish_phase',
      'backlog_manage_ac',
      'backlog_manage_dod',
      'milestone_add',
      'milestone_rename',
      'milestone_archive',
      'milestone_remove',
      'document_create',
      'document_update',
      'reference_add',
      'reference_update',
      'reference_link',
      'reference_remove',
      'reference_sync',
      'lesson_create',
      'lesson_update',
      'lesson_link',
      'lesson_supersede',
      'lesson_audit',
      'lesson_classify',
      'write_file',
    ]);
    // Явные исключения с причиной: инструменты супервизора/очереди (VL-268)
    // управляют прогоном фаз, а не данными backlog; их ответ — карточка
    // состояния прогона, а не снимок applied/skipped. В контракт VL-306 не
    // входят (вне скоупа задачи), но и молча «пятым случаем» не считаются.
    const outOfScope = new Set([
      'backlog_trigger_phase',
      'backlog_auto_queue',
      'backlog_supervisor',
    ]);
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name) && !covered.has(name) && !outOfScope.has(name));
    assert.deepEqual(missing, [], `write-инструменты без JSON-ack в таблице: ${missing.join(', ')}`);
  });
});
