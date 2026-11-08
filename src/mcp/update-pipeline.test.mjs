/**
 * Единый пайплайн обновления сущностей (VL-369) — тесты свойств.
 *
 * Проверяется не форма конкретного инструмента, а ТАБЛИЦА ИСХОДОВ:
 * «записали × сущность полная» → applied / partial / noop / noop+missing /
 * rejected. Плюс инвариант, закрывающий класс инцидентов: вызов с корректными
 * аргументами на НЕПОЛНОЙ сущности даёт applied или partial, но НИКОГДА
 * rejected — отказ остаётся только для испорченного аргумента.
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
import { createTaskFile, getTask } from '../../dist/core/store.js';
import { writeDocument } from '../../dist/core/document.js';
import { writeReference } from '../../dist/core/reference.js';
import { createLessonFile, getLesson, lessonToMarkdown } from '../../dist/core/lesson.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-update-pipeline-'));
const backlogDir = join(cwd, 'backlog');

/**
 * Фазовый env агентской сессии на время ВСЕГО файла (VL-370, lesson-88/113/120).
 *
 * После VL-370 неполнота сущности зависит от фазы рана: `getCompletenessRules`
 * ← `resolveGuardPhase` ← `VIBELOG_RUN_PHASE`/`VIBELOG_PHASE_NAME`. Прогон
 * внутри фазы Close наследовал `VIBELOG_PHASE_NAME=close`, применялись правила
 * `DEFAULT_COMPLETENESS.default.close` (AC + DoD), а `createTaskFile`
 * подставляет `config.definition_of_done` НЕотмеченными — неполной становилась
 * каждая фикстура, и ожидания `applied` падали. env чистится на уровне файла,
 * иначе блоки на верхнем уровне (VL-369) работают с унаследованным окружением.
 *
 * `testSpawnEnv` (VL-286) здесь не подходит: вызовы `handleToolCall` идут
 * in-process, а не спавном. Сохранённые значения возвращаются в afterAll.
 */
const savedPhaseEnv = {};

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (
      key === 'VIBELOG_CWD' || key === 'VIBELOG_SESSION_ID' ||
      key.startsWith('VIBELOG_PHASE_') || key.startsWith('VIBELOG_RUN_')
    ) {
      savedPhaseEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'UpdatePipeline Test',
    task_prefix: 'up',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedPhaseEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
  rmSync(cwd, { recursive: true, force: true });
});

/** Разбирает JSON-ack инструмента. */
async function call(name, args) {
  return JSON.parse(await handleToolCall(name, args, cwd));
}

// ── Таблица исходов ────────────────────────────────────────────────────────

describe('VL-369 AC1/AC2 — таблица исходов «записали × сущность полная»', () => {
  it('записали + полная → applied', async () => {
    const t = createTaskFile(cwd, { title: 'Полная', description: 'Описание есть' });
    const ack = await call('backlog_update_task', { id: t.id, priority: 'High' });
    assert.equal(ack.outcome, 'applied', JSON.stringify(ack));
    assert.equal(ack.applied.priority, 'High');
    assert.equal(getTask(cwd, t.id).priority, 'High', 'запись реально в файле');
  });

  it('записали + неполная → partial с missing и готовым вызовом', async () => {
    const t = createTaskFile(cwd, { title: 'Без описания' });
    const ack = await call('backlog_update_task', { id: t.id, priority: 'Low' });
    assert.equal(ack.outcome, 'partial', JSON.stringify(ack));
    assert.equal(ack.missing[0].field, 'description', 'missing от состояния сущности');
    assert.equal(typeof ack.hint, 'string');
  });

  it('нечего менять + полная → noop без missing', async () => {
    const t = createTaskFile(cwd, { title: 'Noop полная', description: 'есть', priority: 'High' });
    const ack = await call('backlog_update_task', { id: t.id, priority: 'High' });
    assert.equal(ack.outcome, 'noop', JSON.stringify(ack));
    assert.equal(ack.noop, true);
    assert.equal(ack.missing, undefined, 'полная сущность — без missing');
  });

  it('нечего менять + неполная → noop + missing (не отказ)', async () => {
    const t = createTaskFile(cwd, { title: 'Noop неполная', priority: 'High' });
    const ack = await call('backlog_update_task', { id: t.id, priority: 'High' });
    assert.equal(ack.outcome, 'noop', JSON.stringify(ack));
    assert.equal(ack.missing[0].field, 'description', 'noop тоже называет пробел');
    assert.equal(typeof ack.hint, 'string');
  });

  it('испорченный аргумент → rejected (единственное место отказа)', async () => {
    const l = createLessonFile(cwd, { title: 'Урок для пустого content' });
    const ack = await call('lesson_update', { id: l.id, content: '   ' });
    assert.equal(ack.outcome, 'rejected', JSON.stringify(ack));
    assert.match(String(ack.error), /Пустое тело урока/);
    assert.match(String(ack.retryWith?.content), /## Проблема/, 'готовый образец в отказе');
  });
});

// ── skipped у ВСЕХ четырёх инструментов (AC3) ──────────────────────────────

describe('VL-369 AC3 — skipped заполняется у всех четырёх инструментов', () => {
  it('backlog_update_task: неизвестное поле и null попадают в skipped', async () => {
    const t = createTaskFile(cwd, { title: 'Skipped задача', description: 'x' });
    const ack = await call('backlog_update_task', {
      id: t.id, description: 'x', окончательноНеизвестное: 1, priority: null,
    });
    const fields = ack.skipped.map(s => s.field);
    assert.ok(fields.includes('окончательноНеизвестное'), `skipped: ${JSON.stringify(ack.skipped)}`);
    assert.ok(fields.includes('priority'), 'переданный null — тоже skipped');
  });

  it('lesson_update: неизвестное поле и null попадают в skipped', async () => {
    const l = createLessonFile(cwd, { title: 'Skipped урок', content: '## Проблема\n\nx\n' });
    const ack = await call('lesson_update', {
      id: l.id, content: '## Проблема\n\nx\n', чужоеПоле: true, status: null,
    });
    const fields = ack.skipped.map(s => s.field);
    assert.ok(fields.includes('чужоеПоле'), `skipped: ${JSON.stringify(ack.skipped)}`);
    assert.ok(fields.includes('status'), 'null — тоже skipped');
  });

  it('document_update: неизвестное поле и null попадают в skipped', async () => {
    const doc = writeDocument(backlogDir, { title: 'Skipped док', type: 'guide' });
    const ack = await call('document_update', { id: doc.id, type: 'guide', чужоеПоле: 1, tags: null });
    const fields = ack.skipped.map(s => s.field);
    assert.ok(fields.includes('чужоеПоле'), `skipped: ${JSON.stringify(ack.skipped)}`);
    assert.ok(fields.includes('tags'), 'null — тоже skipped');
  });

  it('reference_update: неизвестное поле и null попадают в skipped', async () => {
    const ref = writeReference(cwd, { title: 'Skipped ref', type: 'url', url: 'https://example.org/s' });
    const ack = await call('reference_update', { id: ref.id, tags: ['a'], чужоеПоле: 1, url: null });
    const fields = ack.skipped.map(s => s.field);
    assert.ok(fields.includes('чужоеПоле'), `skipped: ${JSON.stringify(ack.skipped)}`);
    assert.ok(fields.includes('url'), 'null — тоже skipped');
  });
});

// ── Инвариант AC5 ──────────────────────────────────────────────────────────

describe('VL-369 AC5 — неполная сущность НИКОГДА не даёт rejected', () => {
  it('все четыре инструмента: корректные аргументы на неполной сущности → applied|partial', async () => {
    // Задача без описания
    const t = createTaskFile(cwd, { title: 'Неполная задача' });
    // Урок с телом-скелетом
    const l = createLessonFile(cwd, { title: 'Неполный урок' });
    // Документ без тела
    const doc = writeDocument(backlogDir, { title: 'Неполный док' });
    // Reference без описания
    const ref = writeReference(cwd, { title: 'Неполный ref', type: 'url', url: 'https://example.org/n' });

    const cases = [
      ['backlog_update_task', { id: t.id, priority: 'High' }],
      ['lesson_update', { id: l.id, linkedTasks: [t.id] }],
      ['document_update', { id: doc.id, title: 'Неполный док (новый)' }],
      ['reference_update', { id: ref.id, tags: ['n'] }],
    ];

    for (const [name, args] of cases) {
      const ack = await call(name, args);
      assert.notEqual(ack.outcome, 'rejected', `${name}: неполнота — не причина отказа: ${JSON.stringify(ack)}`);
      assert.ok(
        ack.outcome === 'applied' || ack.outcome === 'partial',
        `${name}: ожидался applied|partial, получено ${ack.outcome}: ${JSON.stringify(ack)}`,
      );
    }

    // Урок реально записан в файл (наблюдаемое поведение, не только applied)
    assert.deepEqual(getLesson(cwd, l.id).lesson.linked_tasks, [t.id], 'linked_tasks в файле');
  });

  it('rejected — только порча аргумента: пустой content, несуществующий id, неверный тип AC', async () => {
    const l = createLessonFile(cwd, { title: 'Урок порчи', content: '## Проблема\n\nx\n' });
    // Явно пустое тело — JSON-отказ с готовым образцом (хук beforeWrite)
    assert.equal((await call('lesson_update', { id: l.id, content: '' })).outcome, 'rejected');
    // Несуществующий id и неверный тип AC — исключение на границе инструмента
    // (так же, как до VL-369: это порча аргумента, а не свойство сущности)
    await assert.rejects(handleToolCall('backlog_update_task', { id: 'VL-999999', priority: 'High' }, cwd), /не найдена/);
    const t = createTaskFile(cwd, { title: 'AC порча', description: 'x' });
    await assert.rejects(
      handleToolCall('backlog_update_task', { id: t.id, acceptanceCriteria: 42 }, cwd),
      /acceptanceCriteria/,
    );
    // backlog_update_status без status — обязательный аргумент
    await assert.rejects(handleToolCall('backlog_update_status', { id: t.id }, cwd), /status/);
  });
});

// ── AC10: вызов без полей → noop ───────────────────────────────────────────

describe('VL-369 AC10 — вызов без изменяющих полей даёт noop, а не исключение', () => {
  it('все четыре инструмента: {id} → noop (+missing, если сущность неполная)', async () => {
    const t = createTaskFile(cwd, { title: 'Только id задача' });
    const l = createLessonFile(cwd, { title: 'Только id урок' });
    const doc = writeDocument(backlogDir, { title: 'Только id док' });
    const ref = writeReference(cwd, { title: 'Только id ref', type: 'url', url: 'https://example.org/i' });

    for (const [name, id] of [
      ['backlog_update_task', t.id],
      ['lesson_update', l.id],
      ['document_update', doc.id],
      ['reference_update', ref.id],
    ]) {
      const ack = await call(name, { id });
      assert.equal(ack.outcome, 'noop', `${name}: ${JSON.stringify(ack)}`);
      assert.equal(ack.ok, false, `${name}: noop — не успех (lesson-92)`);
    }
  });
});

// ── AC11: append_notes сохраняет неидемпотентность ─────────────────────────

describe('VL-369 AC11 — append_notes не попадает в noop-сверку', () => {
  it('повторное дописывание меняет файл', async () => {
    const t = createTaskFile(cwd, { title: 'Заметки', description: 'x' });
    const first = await call('backlog_update_task', { id: t.id, append_notes: 'строка' });
    assert.equal(first.outcome, 'applied');
    const second = await call('backlog_update_task', { id: t.id, append_notes: 'строка' });
    assert.notEqual(second.outcome, 'noop', 'дописывание всегда меняет файл');
    assert.match(getTask(cwd, t.id).implementationNotes, /строка\nстрока/);
  });
});

// ── VL-370: неполнота зависит от workflow и фазы ───────────────────────────

describe('VL-370 — неполнота как данные (workflow × фаза)', () => {
  const wfCwd = mkdtempSync(join(tmpdir(), 'vibelog-completeness-mcp-'));
  const wfBacklog = join(wfCwd, 'backlog');

  beforeAll(() => {
    mkdirSync(join(wfBacklog, 'tasks'), { recursive: true });
    writeFileSync(join(wfBacklog, 'config.yml'), stringifyYaml({
      project_name: 'Completeness Test',
      task_prefix: 'cp',
      default_status: 'To Do',
      statuses: ['To Do', 'Review', 'Done'],
      priorities: ['High', 'Medium', 'Low'],
      types: ['bug', 'feature', 'chore', 'epic'],
      definition_of_done: ['Тесты проходят'],
    }), 'utf-8');
    mkdirSync(join(wfCwd, '.vibelog'), { recursive: true });
    writeFileSync(join(wfCwd, '.vibelog', 'settings.json'), JSON.stringify({
      workflows: {
        simple: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'do', produces_status: 'Review' },
            { status: 'Review', phase: 'close', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
        strict: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'plan', produces_status: 'Review' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
      task_workflows: { chore: 'simple', epic: 'strict' },
      completeness: {
        // '*' — правила любой фазы: тест не зависит от фазы рана
        strict: { '*': { task: ['labels', 'priority'] } },
      },
    }, null, 2), 'utf-8');
    // Фазовый env уже снят на уровне файла (см. beforeAll верхнего уровня) —
    // вторая очистка здесь не нужна и маскировала бы такую же дыру у соседей.
  });

  afterAll(() => {
    rmSync(wfCwd, { recursive: true, force: true });
  });

  /** Разбирает JSON-ack в каталоге wfCwd. */
  async function callWf(name, args) {
    return JSON.parse(await handleToolCall(name, args, wfCwd));
  }

  it('AC2: simple-workflow — задача без AC и плана полная (applied, missing нет)', async () => {
    const t = createTaskFile(wfCwd, { title: 'Простая', description: 'есть', type: 'chore' });
    const ack = await callWf('backlog_update_task', { id: t.id, priority: 'High' });
    assert.equal(ack.outcome, 'applied', JSON.stringify(ack));
    assert.equal(getTask(wfCwd, t.id).priority, 'High');
  });

  it('AC2: simple-workflow — задача БЕЗ описания неполна только по description', async () => {
    const t = createTaskFile(wfCwd, { title: 'Без описания', type: 'chore' });
    const ack = await callWf('backlog_update_task', { id: t.id, priority: 'Low' });
    assert.equal(ack.outcome, 'partial', JSON.stringify(ack));
    assert.deepEqual(ack.missing.map(m => m.field), ['description']);
  });

  it('AC5: кастомный workflow из settings — missing называет ЕГО поля', async () => {
    const t = createTaskFile(wfCwd, { title: 'Строгая', description: 'есть', type: 'epic' });
    const ack = await callWf('backlog_update_task', { id: t.id, description: 'обновлено' });
    assert.equal(ack.outcome, 'partial', JSON.stringify(ack));
    const fields = ack.missing.map(m => m.field).sort();
    assert.deepEqual(fields, ['labels', 'priority']);
  });

  it('AC9: неизвестная фаза — description из "*" (поведение не зависит от фазы)', async () => {
    const t = createTaskFile(wfCwd, { title: 'Дефолт без описания', type: 'feature' });
    const ack = await callWf('backlog_update_task', { id: t.id, priority: 'Medium' });
    assert.equal(ack.outcome, 'partial', JSON.stringify(ack));
    assert.deepEqual(ack.missing.map(m => m.field), ['description']);
  });

  it('next: готовый повторный вызов использует имя АРГУМЕНТА (plan, не implementationPlan)', async () => {
    const t = createTaskFile(wfCwd, { title: 'План', description: 'есть', type: 'feature' });
    const ack = await callWf('backlog_update_task', { id: t.id, description: 'обновлено' });
    // фаза неизвестна → требуется только description, он есть → applied
    assert.equal(ack.outcome, 'applied', JSON.stringify(ack));
  });
});

// ── AC6: backlog_update_status как частный случай ──────────────────────────

describe('VL-369 AC6 — backlog_update_status в общем пайплайне', () => {
  it('смена статуса → applied; повтор → noop; маркеры текста сохранены', async () => {
    const t = createTaskFile(cwd, { title: 'Статус', description: 'x' });
    const first = await call('backlog_update_status', { id: t.id, status: 'In Progress' });
    assert.equal(first.outcome, 'applied');
    assert.equal(first.applied.status, 'In Progress');
    assert.match(first.message, /Статус задачи .* обновлён/);
    const second = await call('backlog_update_status', { id: t.id, status: 'In Progress' });
    assert.equal(second.outcome, 'noop');
    assert.match(second.message, /Изменений нет/);
    assert.match(second.message, /Следующий шаг: .*backlog_finish_phase/);
  });
});
