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
import { statSync } from 'node:fs';
import { writeDocument, getDocument } from '../../dist/core/document.js';
import { writeReference } from '../../dist/core/reference.js';
import { createLessonFile, getLesson } from '../../dist/core/lesson.js';

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

describe('VL-303 — no-op update_task не пишет файл и отвечает noop', () => {
  it('AC1: повтор с уже применёнными полями → {ok:true, noop:true}, файл не переписан', async () => {
    const t = createTaskFile(cwd, { title: 'Noop-задача', type: 'bug' });
    const first = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd));
    assert.equal(first.ok, true);
    assert.ok(!first.noop, 'первый вызов — обычный успех');
    const updatedAfterFirst = getTask(cwd, t.id).updated_date;
    const second = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd));
    // VL-304: noop — ошибка, а не успех (lesson-92): ok:false + reason:'noop'
    assert.equal(second.ok, false, `noop не должен быть успехом: ${JSON.stringify(second)}`);
    assert.equal(second.noop, true, `ожидался noop: ${JSON.stringify(second)}`);
    assert.equal(second.reason, 'noop');
    assert.match(second.message, /Изменений нет/);
    assert.match(second.message, /Следующий шаг: backlog_finish_phase/);
    assert.equal(second.applied.type, 'feature');
    assert.equal(getTask(cwd, t.id).updated_date, updatedAfterFirst, 'файл не переписан');
  });

  it('частичное совпадение → обычный успех без noop', async () => {
    const t = createTaskFile(cwd, { title: 'Частично', priority: 'Low' });
    const ack = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, title: 'Частично', priority: 'High' }, cwd),
    );
    assert.ok(!ack.noop, 'есть реальное изменение — noop быть не должно');
    assert.equal(ack.applied.title, 'Частично');
    assert.equal(ack.applied.priority, 'High');
  });

  it('labels в другом порядке → noop (сравнение как множеств)', async () => {
    const t = createTaskFile(cwd, { title: 'Метки', labels: ['a', 'b'] });
    const ack = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, labels: ['b', 'a'] }, cwd));
    assert.equal(ack.noop, true, `порядок меток не изменение: ${JSON.stringify(ack)}`);
  });

  it('append_notes никогда не noop — файл дописывается', async () => {
    const t = createTaskFile(cwd, { title: 'Заметки' });
    await handleToolCall('backlog_update_task', { id: t.id, append_notes: 'строка' }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, append_notes: 'строка' }, cwd));
    assert.ok(!ack.noop, 'дописывание всегда меняет файл');
    assert.match(getTask(cwd, t.id).implementationNotes, /строка\nстрока/);
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

describe('VL-306 — noop-детекция lesson_update', () => {
  it('AC2: повтор с теми же аргументами → ackNoop, файл и updated_date не тронуты', async () => {
    const l = createLessonFile(cwd, { title: 'Урок noop', tags: ['a'] });
    const first = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(first.ok, true, `первый вызов — успех: ${JSON.stringify(first)}`);
    const afterFirst = getLesson(cwd, l.id);
    const second = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(second.ok, false, `noop не успех: ${JSON.stringify(second)}`);
    assert.equal(second.noop, true);
    assert.equal(second.reason, 'noop');
    assert.match(second.message, /Изменений нет/);
    assert.match(second.message, /Следующий шаг: backlog_finish_phase/);
    assert.equal(second.applied.verified_by, 'agent');
    const afterSecond = getLesson(cwd, l.id);
    assert.equal(afterSecond.lesson.updated_date, afterFirst.lesson.updated_date, 'updated_date не сдвинут');
    assert.equal(afterSecond.path, afterFirst.path, 'файл не переименован');
  });

  it('AC2: теги в другом порядке → noop (сравнение как множества)', async () => {
    const l = createLessonFile(cwd, { title: 'Урок теги', tags: ['a', 'b'] });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, tags: ['b', 'a'] }, cwd));
    assert.equal(ack.noop, true, `ожидался noop: ${JSON.stringify(ack)}`);
  });

  it('AC2: реальное изменение поля → обычный успех без noop', async () => {
    const l = createLessonFile(cwd, { title: 'Урок сброс', tags: ['a'] });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, tags: ['a', 'c'] }, cwd));
    assert.equal(ack.ok, true);
    assert.ok(!ack.noop, 'есть реальное изменение — noop быть не должно');
  });
});

describe('VL-310 — noop-детекция общая для write-инструментов', () => {
  it('AC1: document_update {id, type} дважды → noop, файл не перезаписан', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док noop', type: 'guide', content: 'тело' });
    const before = statSync(getDocument(backlogDir, doc.id).path).mtimeMs;
    const first = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
    assert.equal(first.ok, false, `type уже guide — noop ожидался: ${JSON.stringify(first)}`);
    assert.equal(first.noop, true);
    assert.equal(first.reason, 'noop');
    assert.match(first.message, /Изменений нет/);
    assert.match(first.message, /Следующий шаг/);
    assert.equal(first.applied.type, 'guide');
    const after = statSync(getDocument(backlogDir, doc.id).path).mtimeMs;
    assert.equal(after, before, 'файл не перезаписан');
    const second = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
    assert.equal(second.noop, true, 'повтор тоже noop');
  });

  it('AC1: document_update с реальным изменением → обычный успех', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док смена', type: 'guide' });
    const ack = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'specification' }, cwd));
    assert.equal(ack.ok, true);
    assert.ok(!ack.noop);
    assert.equal(ack.applied.type, 'specification');
  });

  it('AC1: document_update с тем же телом → noop (сравнение тела)', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док тело', content: '# Тело\nтекст' });
    const ack = JSON.parse(await handleToolCall('document_update', { id: doc.id, content: '# Тело\nтекст' }, cwd));
    assert.equal(ack.noop, true, `тело не изменилось: ${JSON.stringify(ack)}`);
  });

  it('AC3: reference_update с теми же тегами (другой порядок) → noop', async () => {
    const ref = writeReference(cwd, { title: 'Ref noop', type: 'url', url: 'https://example.com', tags: ['a', 'b'] });
    const ack = JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['b', 'a'] }, cwd));
    assert.equal(ack.noop, true, `порядок тегов не изменение: ${JSON.stringify(ack)}`);
    const real = JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['a', 'c'] }, cwd));
    assert.equal(real.ok, true);
    assert.ok(!real.noop);
  });

  it('AC3: backlog_update_status с тем же статусом → noop', async () => {
    const t = createTaskFile(cwd, { title: 'Статус noop' });
    await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd));
    assert.equal(ack.noop, true, `статус не изменился: ${JSON.stringify(ack)}`);
  });

  it('AC3: backlog_update_dependencies с уже существующей зависимостью → noop', async () => {
    const base = createTaskFile(cwd, { title: 'База noop' });
    const t = createTaskFile(cwd, { title: 'Зависимая noop' });
    await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd));
    assert.equal(ack.noop, true, `набор зависимостей тот же: ${JSON.stringify(ack)}`);
  });

  it('AC3: lesson_link и reference_link на уже установленной связи → noop', async () => {
    const t = createTaskFile(cwd, { title: 'Связи noop' });
    const l = createLessonFile(cwd, { title: 'Урок связи noop' });
    const ref = writeReference(cwd, { title: 'Ref связи noop', type: 'url', url: 'https://example.org' });
    await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd);
    const lessonAck = JSON.parse(await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd));
    assert.equal(lessonAck.noop, true, `связь уже есть: ${JSON.stringify(lessonAck)}`);
    await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd);
    const refAck = JSON.parse(await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd));
    assert.equal(refAck.noop, true, `связь уже есть: ${JSON.stringify(refAck)}`);
  });
});
