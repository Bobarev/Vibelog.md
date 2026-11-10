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
import { mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile, getTask, listTasks } from '../../dist/core/store.js';
import { statSync } from 'node:fs';
import { writeDocument, getDocument } from '../../dist/core/document.js';
import { writeReference } from '../../dist/core/reference.js';
import { createLessonFile, getLesson, lessonToMarkdown, LESSON_BODY_SKELETON } from '../../dist/core/lesson.js';
import { clearPhaseEnv } from '../test-env.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-write-ack-'));
const backlogDir = join(cwd, 'backlog');

/**
 * Фазовый env агентской сессии на время файла (VL-374): in-process вызовы
 * `handleToolCall` иначе наследуют фазу рана, и расчёт неполноты (VL-370)
 * подменяет ожидаемые applied/partial.
 */
let restorePhaseEnv;

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
  restorePhaseEnv = clearPhaseEnv();
  writeConfig();
});
afterAll(() => {
  restorePhaseEnv();
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

  it('только неизвестные поля → applied+unchanged со skipped, файл не тронут (VL-369/VL-413)', async () => {
    const t = createTaskFile(cwd, { title: 'Только неизвестные' });
    // VL-369: неизвестное поле — не порча аргумента, а «передано, но не
    // записано»: оно попадает в skipped. VL-413: менять нечего — это УСПЕХ
    // с пустым applied, а не событие.
    const ack = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, definitionOfDone: ['x'], foo: 1 }, cwd),
    );
    assert.equal(ack.outcome, 'applied', `ожидался applied: ${JSON.stringify(ack)}`);
    assert.equal(ack.ok, true);
    const fields = ack.skipped.map((f) => f.field);
    assert.ok(fields.includes('definitionOfDone'), `skipped называет definitionOfDone: ${JSON.stringify(fields)}`);
    assert.ok(fields.includes('foo'), 'skipped называет неизвестное foo');
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

describe('VL-303/VL-413 — неизменяющая запись не пишет файл и отвечает applied+unchanged', () => {
  it('AC1/AC2: повтор с уже применёнными полями → ok:true, applied:{}, unchanged:[type]', async () => {
    const t = createTaskFile(cwd, { title: 'Noop-задача', type: 'bug' });
    const first = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd));
    assert.equal(first.ok, true);
    assert.ok(!('unchanged' in first), 'первый вызов — реальная запись');
    const updatedAfterFirst = getTask(cwd, t.id).updated_date;
    const second = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd));
    // VL-413: неизменяющая запись — УСПЕХ. ok:false читался моделью как
    // «не удалось» и давал повтор → кап → fail (сессия agent-1794322537996).
    assert.equal(second.ok, true, `неизменяющая запись — успех: ${JSON.stringify(second)}`);
    assert.equal(second.outcome, 'applied');
    assert.deepEqual(second.unchanged, ['type']);
    assert.deepEqual(second.applied, {}, 'applied пуст — ничего не записано');
    assert.match(second.message, /Изменений нет/);
    // VL-413: директивы «Следующий шаг» в тексте больше нет — она в блоке phase.
    assert.ok(!('hint' in second), 'hint как канал следующего шага удалён');
    assert.ok('phase' in second, 'состояние фазы — блоком данных');
    assert.equal(getTask(cwd, t.id).updated_date, updatedAfterFirst, 'файл не переписан');
  });

  it('частичное совпадение → обычный успех без unchanged', async () => {
    const t = createTaskFile(cwd, { title: 'Частично', priority: 'Low' });
    const ack = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, title: 'Частично', priority: 'High' }, cwd),
    );
    assert.ok(!('unchanged' in ack), 'есть реальное изменение — unchanged быть не должно');
    assert.equal(ack.applied.title, 'Частично');
    assert.equal(ack.applied.priority, 'High');
  });

  it('labels в другом порядке → unchanged (сравнение как множеств)', async () => {
    const t = createTaskFile(cwd, { title: 'Метки', labels: ['a', 'b'] });
    const ack = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, labels: ['b', 'a'] }, cwd));
    assert.deepEqual(ack.unchanged, ['labels'], `порядок меток не изменение: ${JSON.stringify(ack)}`);
  });

  it('append_notes никогда не unchanged — файл дописывается', async () => {
    const t = createTaskFile(cwd, { title: 'Заметки' });
    await handleToolCall('backlog_update_task', { id: t.id, append_notes: 'строка' }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, append_notes: 'строка' }, cwd));
    assert.ok(!('unchanged' in ack), 'дописывание всегда меняет файл');
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

describe('VL-306/VL-413 — неизменяющая запись lesson_update', () => {
  it('AC2: повтор с теми же аргументами → applied+unchanged, файл и updated_date не тронуты', async () => {
    const l = createLessonFile(cwd, { title: 'Урок noop', tags: ['a'], content: '## Проблема\n\nшум\n' });
    const first = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(first.ok, true, `первый вызов — успех: ${JSON.stringify(first)}`);
    const afterFirst = getLesson(cwd, l.id);
    const second = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(second.ok, true, `неизменяющая запись — успех: ${JSON.stringify(second)}`);
    assert.equal(second.outcome, 'applied');
    assert.deepEqual(second.unchanged, ['verified_by'], 'unchanged — имена полей сущности');
    assert.match(second.message, /Изменений нет/);
    const afterSecond = getLesson(cwd, l.id);
    assert.equal(afterSecond.lesson.updated_date, afterFirst.lesson.updated_date, 'updated_date не сдвинут');
    assert.equal(afterSecond.path, afterFirst.path, 'файл не переименован');
  });

  it('AC2: теги в другом порядке → unchanged (сравнение как множества)', async () => {
    const l = createLessonFile(cwd, { title: 'Урок теги', tags: ['a', 'b'], content: '## Проблема\n\nшум\n' });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, tags: ['b', 'a'] }, cwd));
    assert.deepEqual(ack.unchanged, ['tags'], `ожидался unchanged: ${JSON.stringify(ack)}`);
  });

  it('AC2: реальное изменение поля → обычный успех без unchanged', async () => {
    const l = createLessonFile(cwd, { title: 'Урок сброс', tags: ['a'], content: '## Проблема\n\nшум\n' });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, tags: ['a', 'c'] }, cwd));
    assert.equal(ack.ok, true);
    assert.ok(!('unchanged' in ack), 'есть реальное изменение — unchanged быть не должно');
  });
});

describe('VL-319 — пустое тело урока: ошибка вместо noop', () => {
  /** Создаёт урок с ПУСТЫМ телом (как шаблон Close до VL-319). */
  function createEmptyBodyLesson(title) {
    const l = createLessonFile(cwd, { title, tags: ['empty'] });
    const entry = getLesson(cwd, l.id);
    writeFileSync(entry.path, lessonToMarkdown(entry.lesson, ''), 'utf-8');
    return l;
  }

  it('AC1: lesson_update без частей тела на уроке с пустым телом → applied+unchanged + missing (VL-369/VL-379/VL-413)', async () => {
    const l = createEmptyBodyLesson('Урок без тела');
    // VL-369: неполнота — свойство СУЩНОСТИ, а не ошибка вызова.
    // VL-413: «не записали» — успех с unchanged, а не событие.
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id }, cwd));
    assert.equal(ack.outcome, 'applied', `ожидался applied: ${JSON.stringify(ack)}`);
    assert.equal(ack.ok, true);
    // VL-379: missing называет problem — тело теперь передаётся частями
    assert.equal(ack.missing[0].field, 'problem', 'missing называет пропущенное поле');
    assert.equal(ack.retryWith.problem, '<что было не так>', 'готовый каркас — три строки');
  });

  it('AC2/VL-379: lesson_update с пустым problem → ok:false, файл не перезаписан', async () => {
    const l = createLessonFile(cwd, { title: 'Урок с телом', tags: ['x'] });
    const before = readFileSync(getLesson(cwd, l.id).path, 'utf-8');
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, problem: '   ', solution: 'р' }, cwd));
    assert.equal(ack.ok, false, `ожидалась ошибка: ${JSON.stringify(ack)}`);
    assert.match(String(ack.error), /Пустое или неполное тело урока недопустимо/);
    assert.equal(readFileSync(getLesson(cwd, l.id).path, 'utf-8'), before, 'файл не изменён');
  });

  it('AC3: неизменяющая запись содержит missing[0].field === "problem"', async () => {
    const l = createEmptyBodyLesson('Урок без тела 2');
    // VL-355: первый вызов на пустом теле ПРИМЕНЯЕТ переданное поле и
    // предупреждает о незаполненном теле (раньше — отказ целиком).
    const first = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(first.ok, true, `первый вызов применяет поле: ${JSON.stringify(first)}`);
    assert.equal(first.missing[0].field, 'problem', 'успех называет незаполненное тело');
    // Повтор тех же аргументов → applied+unchanged, и он тоже обязан назвать problem
    const repeat = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(repeat.outcome, 'applied', `ожидался applied: ${JSON.stringify(repeat)}`);
    assert.deepEqual(repeat.unchanged, ['verified_by'], 'unchanged — имена полей сущности');
    assert.deepEqual(repeat.applied, {}, 'applied пуст — ничего не записано');
    assert.equal(repeat.missing[0].field, 'problem', 'неизменяющая запись называет незаполненное тело');
  });
});

describe('VL-349 — тело-скелет урока: ошибка вместо noop', () => {
  /** Создаёт урок, тело которого — дефолтный скелет createLessonFile (VL-319). */
  function createSkeletonLesson(title) {
    const l = createLessonFile(cwd, { title, tags: ['skeleton'] });
    const entry = getLesson(cwd, l.id);
    assert.equal(entry.body.trim(), LESSON_BODY_SKELETON.trim(), 'фикстура: тело — дефолтный скелет');
    return l;
  }

  it('AC2: lesson_update без content и без других изменений на теле-скелете → applied+unchanged, повтор исполняется', async () => {
    const l = createSkeletonLesson('Урок-скелет');
    const path = getLesson(cwd, l.id).path;
    const before = readFileSync(path, 'utf-8');
    const args = { id: l.id };
    const first = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    // VL-369/VL-413: "нечего менять + сущность неполная" — успех с unchanged
    // и missing, а не отказ и не событие.
    assert.equal(first.outcome, 'applied', `ожидался applied: ${JSON.stringify(first)}`);
    assert.equal(first.ok, true);
    assert.equal(first.missing[0].field, 'problem', 'missing называет problem');
    assert.equal(readFileSync(path, 'utf-8'), before, 'файл не перезаписан');

    // Повтор той же сигнатуры — тоже applied+unchanged с missing и готовым вызовом
    const second = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    assert.equal(second.outcome, 'applied', `повтор тоже applied: ${JSON.stringify(second)}`);
    assert.equal(second.missing[0].field, 'problem');
    assert.equal(second.retryWith.problem, '<что было не так>', 'готовый каркас — три строки');
  });

  it('AC2/VL-379: после передачи problem+solution урок-скелет дополняется', async () => {
    const l = createSkeletonLesson('Урок-скелет 2');
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: l.id, problem: 'было', solution: 'стало', example: 'пример',
    }, cwd));
    assert.equal(ack.ok, true, `заполнение тела проходит: ${JSON.stringify(ack)}`);
    assert.ok(ack.applied.content > LESSON_BODY_SKELETON.length, 'длина тела выросла');
    const entry = getLesson(cwd, l.id);
    assert.match(entry.body, /## Проблема\nбыло/, 'раздел Проблема склеен сервером');
    assert.match(entry.body, /## Пример\nпример/, 'раздел Пример склеен сервером');
  });

  it('AC3/VL-379: noop при теле-скелете называет problem в missing, а content — в skipped', async () => {
    // Скелет + вызов с удалённым аргументом `content`: менять нечего → noop.
    // noop обязан назвать problem (тело передаётся частями), а присланный
    // content — попасть в skipped с причиной «поле удалено».
    const l = createSkeletonLesson('Урок-скелет 3');
    const entry = getLesson(cwd, l.id);
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: l.id, content: entry.body,
    }, cwd));
    assert.equal(ack.outcome, 'applied', `ожидался applied: ${JSON.stringify(ack)}`);
    assert.ok(!('unchanged' in ack), 'полей для изменения не передано — unchanged не печатается');
    assert.equal(ack.missing[0].field, 'problem', 'ответ называет незаполненное тело');
    assert.equal(ack.skipped[0].field, 'content', 'удалённый аргумент в skipped');
    assert.match(String(ack.skipped[0].reason), /поле удалено/);
    assert.equal(ack.retryWith.problem, '<что было не так>', 'готовый образец аргументов');
  });
});

describe('VL-355 — незаполненное тело урока: частичное применение вместо отказа', () => {
  /** Создаёт урок, тело которого — дефолтный скелет createLessonFile. */
  function createSkeletonLesson(title) {
    const l = createLessonFile(cwd, { title, tags: ['vl355'] });
    assert.equal(getLesson(cwd, l.id).body.trim(), LESSON_BODY_SKELETON.trim(), 'фикстура: тело — скелет');
    return l;
  }

  it('AC1/AC4: регресс agent-1794053090709 — linkedTasks применяется и записывается в файл', async () => {
    const t = createTaskFile(cwd, { title: 'Задача для привязки' });
    const l = createSkeletonLesson('Урок-привязка');
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: l.id, linkedTasks: [t.id], verifiedBy: 'agent',
    }, cwd));
    assert.equal(ack.ok, true, `ожидался успех: ${JSON.stringify(ack)}`);
    assert.ok(!ack.noop, 'это не noop');
    assert.deepEqual(ack.applied.linked_tasks, [t.id], 'applied — фактическое значение из файла');
    // Ключевое: поле реально записано в файл, а не только в applied
    const entry = getLesson(cwd, l.id);
    assert.deepEqual(entry.lesson.linked_tasks, [t.id], 'linked_tasks записан в файл');
    assert.match(readFileSync(entry.path, 'utf-8'), new RegExp(t.id), 'frontmatter содержит задачу');
  });

  it('AC2: успешный ответ несёт missing[content] и готовый retryWith', async () => {
    const t2 = createTaskFile(cwd, { title: 'Задача два' });
    const l = createSkeletonLesson('Урок-предупреждение');
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, linkedTasks: [t2.id] }, cwd));
    assert.equal(ack.ok, true, `ожидался успех: ${JSON.stringify(ack)}`);
    assert.equal(ack.missing[0].field, 'problem', 'missing называет незаполненное тело');
    // VL-413: канал следующего шага — данные (missing/retryWith/phase), не hint.
    assert.equal(ack.retryWith.problem, '<что было не так>', 'готовый образец аргументов');
  });

  it('AC5: повтор того же вызова → applied+unchanged (не отказ), missing содержит problem', async () => {
    const t = createTaskFile(cwd, { title: 'Задача три' });
    const l = createSkeletonLesson('Урок-повтор');
    const args = { id: l.id, linkedTasks: [t.id], verifiedBy: 'agent' };
    const first = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    assert.equal(first.ok, true, `первый вызов применяет: ${JSON.stringify(first)}`);
    const second = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    assert.equal(second.ok, true, `повтор — успех с unchanged: ${JSON.stringify(second)}`);
    assert.equal(second.outcome, 'applied');
    assert.equal(second.missing[0].field, 'problem', 'неизменяющая запись тоже называет пробел');
  });

  it('AC6: вызов без частей тела и без других полей → applied+unchanged + missing: problem (VL-369/VL-413)', async () => {
    const l = createSkeletonLesson('Урок-отказ');
    // VL-369: «нечего менять» — успех с unchanged; незаполненное тело
    // сообщается полем missing, а НЕ отказом. Отказ остался только для
    // испорченного аргумента (например, передан только problem без solution).
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id }, cwd));
    assert.equal(ack.outcome, 'applied', `ожидался applied: ${JSON.stringify(ack)}`);
    assert.equal(ack.missing[0].field, 'problem');
    assert.equal(ack.retryWith.problem, '<что было не так>', 'готовый образец аргументов');
    assert.equal(ack.retryWith.problem, '<что было не так>', 'каркас — три строки, без markdown');
  });

  it('AC1/VL-379: после передачи problem+solution урок-скелет заполняется', async () => {
    const l = createSkeletonLesson('Урок-заполнение');
    const ack = JSON.parse(await handleToolCall('lesson_update', {
      id: l.id, problem: 'было', solution: 'стало', example: 'пример',
    }, cwd));
    assert.equal(ack.ok, true, `заполнение тела проходит: ${JSON.stringify(ack)}`);
    assert.ok(ack.applied.content > LESSON_BODY_SKELETON.length, 'длина тела выросла');
  });

  it('AC1: урок с заполненным телом + linkedTasks → успех без missing', async () => {
    const t = createTaskFile(cwd, { title: 'Задача четыре' });
    const l = createLessonFile(cwd, { title: 'Урок с телом', tags: ['vl355'], content: '## Проблема\n\nшум\n' });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, linkedTasks: [t.id] }, cwd));
    assert.equal(ack.ok, true, `успех: ${JSON.stringify(ack)}`);
    assert.equal(ack.missing, undefined, 'заполненное тело не даёт missing');
  });
});

describe('VL-362 — retryWith с каркасом тела урока', () => {
  /** Создаёт урок, тело которого — дефолтный скелет createLessonFile. */
  function createSkeletonLesson(title) {
    const l = createLessonFile(cwd, { title, tags: ['vl362'] });
    assert.equal(getLesson(cwd, l.id).body.trim(), LESSON_BODY_SKELETON.trim(), 'фикстура: тело — скелет');
    return l;
  }

  it('AC1/AC2/AC3/VL-379: частичное применение (linkedTasks без тела) → retryWith с тремя строками', async () => {
    // Регресс agent-1794067677112: модель пришла привязать задачу, получила
    // partial с missing, но БЕЗ образца тела — и 4 раза повторила вызов.
    const t = createTaskFile(cwd, { title: 'Задача VL-362' });
    const l = createSkeletonLesson('Урок-каркас');
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, linkedTasks: [t.id] }, cwd));
    assert.equal(ack.outcome, 'partial', `ожидался partial: ${JSON.stringify(ack)}`);
    assert.equal(ack.missing[0].field, 'problem');
    assert.equal(typeof ack.retryWith, 'object', 'retryWith обязателен на пути partial');
    // VL-379: каркас — три обычные строки, без markdown и \n
    assert.equal(ack.retryWith.problem, '<что было не так>', 'problem-плейсхолдер');
    assert.equal(ack.retryWith.solution, '<что сделали>', 'solution-плейсхолдер');
    assert.equal(ack.retryWith.example, '<конкретный пример>', 'example-плейсхолдер');
    assert.ok(!JSON.stringify(ack.retryWith).includes('## '), 'markdown в аргументах не генерируется');
    assert.equal(ack.retryWith.problem, '<что было не так>', 'retryWith называет problem');
  });

  it('AC2: повтор уже применённого вызова (unchanged) → retryWith тоже есть', async () => {
    const t = createTaskFile(cwd, { title: 'Задача VL-362 повтор' });
    const l = createSkeletonLesson('Урок-каркас повтор');
    const args = { id: l.id, linkedTasks: [t.id] };
    const first = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    assert.equal(first.outcome, 'partial', `первый вызов применяет: ${JSON.stringify(first)}`);
    const second = JSON.parse(await handleToolCall('lesson_update', args, cwd));
    assert.equal(second.outcome, 'applied', `повтор — applied+unchanged: ${JSON.stringify(second)}`);
    assert.deepEqual(second.unchanged, ['linked_tasks']);
    assert.equal(second.missing[0].field, 'problem');
    assert.equal(second.retryWith.problem, '<что было не так>', 'unchanged тоже несёт каркас тела');
  });

  it('AC1: урок с заполненным телом не получает retryWith', async () => {
    const t = createTaskFile(cwd, { title: 'Задача VL-362 тело' });
    const l = createLessonFile(cwd, { title: 'Урок с телом VL-362', tags: ['vl362'], content: '## Проблема\n\nшум\n' });
    const ack = JSON.parse(await handleToolCall('lesson_update', { id: l.id, linkedTasks: [t.id] }, cwd));
    assert.equal(ack.ok, true, `успех: ${JSON.stringify(ack)}`);
    assert.equal(ack.retryWith, undefined, 'заполненное тело не даёт retryWith');
  });
});

describe('VL-310/VL-413 — неизменяющая запись общая для write-инструментов', () => {
  it('AC1: document_update {id, type} дважды → applied+unchanged, файл не перезаписан', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док noop', type: 'guide', content: 'тело' });
    const before = statSync(getDocument(backlogDir, doc.id).path).mtimeMs;
    const first = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
    assert.equal(first.ok, true, `type уже guide — успех с unchanged: ${JSON.stringify(first)}`);
    assert.equal(first.outcome, 'applied');
    assert.deepEqual(first.unchanged, ['type']);
    assert.match(first.message, /Изменений нет/);
    const after = statSync(getDocument(backlogDir, doc.id).path).mtimeMs;
    assert.equal(after, before, 'файл не перезаписан');
    const second = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
    assert.deepEqual(second.unchanged, ['type'], 'повтор тоже unchanged');
  });

  it('AC1: document_update с реальным изменением → обычный успех', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док смена', type: 'guide' });
    const ack = JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'specification' }, cwd));
    assert.equal(ack.ok, true);
    assert.ok(!('unchanged' in ack));
    assert.equal(ack.applied.type, 'specification');
  });

  it('AC1: document_update с тем же телом → unchanged (сравнение тела)', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док тело', content: '# Тело\nтекст' });
    const ack = JSON.parse(await handleToolCall('document_update', { id: doc.id, content: '# Тело\nтекст' }, cwd));
    assert.deepEqual(ack.unchanged, ['content'], `тело не изменилось: ${JSON.stringify(ack)}`);
  });

  it('AC3: reference_update с теми же тегами (другой порядок) → unchanged', async () => {
    const ref = writeReference(cwd, { title: 'Ref noop', type: 'url', url: 'https://example.com', tags: ['a', 'b'] });
    const ack = JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['b', 'a'] }, cwd));
    assert.deepEqual(ack.unchanged, ['tags'], `порядок тегов не изменение: ${JSON.stringify(ack)}`);
    const real = JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['a', 'c'] }, cwd));
    assert.equal(real.ok, true);
    assert.ok(!('unchanged' in real));
  });

  it('AC3: backlog_update_status с тем же статусом → unchanged', async () => {
    const t = createTaskFile(cwd, { title: 'Статус noop' });
    await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd));
    assert.deepEqual(ack.unchanged, ['status'], `статус не изменился: ${JSON.stringify(ack)}`);
  });

  it('AC3: backlog_update_dependencies с уже существующей зависимостью → unchanged', async () => {
    const base = createTaskFile(cwd, { title: 'База noop' });
    const t = createTaskFile(cwd, { title: 'Зависимая noop' });
    await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd);
    const ack = JSON.parse(await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd));
    assert.deepEqual(ack.unchanged, ['dependencies'], `набор зависимостей тот же: ${JSON.stringify(ack)}`);
  });

  it('AC3: lesson_link и reference_link на уже установленной связи → unchanged', async () => {
    const t = createTaskFile(cwd, { title: 'Связи noop' });
    const l = createLessonFile(cwd, { title: 'Урок связи noop' });
    const ref = writeReference(cwd, { title: 'Ref связи noop', type: 'url', url: 'https://example.org' });
    await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd);
    const lessonAck = JSON.parse(await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd));
    assert.deepEqual(lessonAck.unchanged, ['lessonId', 'taskId', 'action'], `связь уже есть: ${JSON.stringify(lessonAck)}`);
    await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd);
    const refAck = JSON.parse(await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd));
    assert.deepEqual(refAck.unchanged, ['referenceId', 'taskId', 'action'], `связь уже есть: ${JSON.stringify(refAck)}`);
  });
});

/**
 * VL-413: состояние фазы — блок ДАННЫХ в каждом ответе write-инструмента.
 *
 * До VL-413 «чего не хватает» и «что делать дальше» жили в прозе
 * `message`/`hint`, которую модель должна была правильно прочитать. В одном
 * JSON `message` говорил «вызови backlog_finish_phase», а `hint` — «передай
 * поля в этом же вызове»; слабая модель цеплялась за конкретный hint и
 * повторяла вызов (сессия agent-1794322537996, spec VL-408).
 */
describe('VL-413 — блок phase в ответе write-инструмента', () => {
  it('AC3: ответ несёт phase {name, complete, missing[], next}', async () => {
    const t = createTaskFile(cwd, { title: 'Phase-задача', type: 'bug', priority: 'High' });
    const ack = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, type: 'bug', priority: 'High' }, cwd),
    );
    assert.equal(ack.outcome, 'applied');
    assert.ok(ack.phase !== undefined, `блок phase обязателен: ${JSON.stringify(ack)}`);
    assert.deepEqual(Object.keys(ack.phase).sort(), ['complete', 'missing', 'name', 'next']);
    // Фазовый env в тесте снят (clearPhaseEnv) — фаза неизвестна, отчёт не нужен.
    assert.equal(ack.phase.name, null);
    assert.equal(ack.phase.next, null);
    assert.ok(Array.isArray(ack.phase.missing));
  });

  it('AC3: hint как канал следующего шага удалён из успешного ответа', async () => {
    const t = createTaskFile(cwd, { title: 'Hint-задача', type: 'bug', priority: 'High' });
    const ack = JSON.parse(
      await handleToolCall('backlog_update_task', { id: t.id, type: 'bug', priority: 'High' }, cwd),
    );
    assert.ok(!('hint' in ack), `hint не должен появляться: ${JSON.stringify(ack)}`);
    assert.ok(!('noop' in ack), 'исхода noop больше нет');
  });

  it('AC3: неполнота задачи видна в phase.missing и в next.missing', async () => {
    const t = createTaskFile(cwd, { title: 'Неполная phase-задача' });
    const ack = JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, priority: 'Low' }, cwd));
    assert.equal(ack.outcome, 'partial');
    assert.ok(ack.phase.missing.includes('description'), `phase.missing: ${JSON.stringify(ack.phase)}`);
    assert.equal(ack.phase.complete, false);
  });
});

describe('VL-353 — ackErrorDetailed несёт машиночитаемое исправление retryWith', () => {
  it('AC1: retryWith попадает в JSON-ответ аддитивно', async () => {
    const { ackErrorDetailed } = await import('../../dist/mcp/tool-result.js');
    const parsed = JSON.parse(
      ackErrorDetailed('git_commit: чужой путь', {
        retryWith: { allowForeign: true },
        hint: 'Добавь allowForeign: true',
      }),
    );
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, 'git_commit: чужой путь');
    assert.deepEqual(parsed.retryWith, { allowForeign: true });
    assert.equal(parsed.hint, 'Добавь allowForeign: true');
  });

  it('AC1: без retryWith (или с пустым объектом) поля в ответе нет', async () => {
    const { ackErrorDetailed } = await import('../../dist/mcp/tool-result.js');
    const plain = JSON.parse(ackErrorDetailed('ошибка'));
    assert.ok(!('retryWith' in plain), 'поле аддитивное — без исправления его нет');
    const empty = JSON.parse(ackErrorDetailed('ошибка', { retryWith: {} }));
    assert.ok(!('retryWith' in empty), 'пустой retryWith не отдаём: модель прочтёт как «повтори как есть»');
  });

  it('AC1: ackError остаётся обёрткой без деталей', async () => {
    const { ackError } = await import('../../dist/mcp/tool-result.js');
    const parsed = JSON.parse(ackError('ошибка'));
    // VL-357: к контракту добавлено ровно одно поле — `outcome` (исход).
    // Прочие детали (applied/skipped/missing/hint/retryWith) у ackError
    // по-прежнему отсутствуют.
    assert.deepEqual(Object.keys(parsed).sort(), ['error', 'ok', 'outcome']);
    assert.equal(parsed.outcome, 'rejected');
  });
});
