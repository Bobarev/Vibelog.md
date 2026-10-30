/**
 * VL-162: урезанный режим backlog_view_task с выбором полей (fields).
 *
 * Контракт:
 * - fields: непустой массив ключей Task → JSON только с перечисленными полями
 *   (порядок ключей = порядок в fields);
 * - без fields / fields: [] → полное представление (обратная совместимость);
 * - неизвестное имя поля → ошибка на русском с перечнем допустимых.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeAll, afterAll } from 'vitest';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { createTaskFile } from '../../dist/core/store.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-mcp-view-fields-'));
const backlogDir = join(testDir, 'backlog');
const tasksDir = join(backlogDir, 'tasks');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(join(backlogDir, 'completed'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'View Fields Test',
    task_prefix: 'vf',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

describe('backlog_view_task — параметр fields (VL-162)', () => {
  beforeAll(() => setup());
  afterAll(() => cleanup());

  it('fields: ["id","title","description"] возвращает только эти поля, в этом порядке', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-1',
      title: 'Задача с описанием',
      description: 'Контекст для фазы Spec',
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'title', 'description'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'title', 'description']);
    assert.equal(parsed.id, 'vf-1');
    assert.equal(parsed.title, 'Задача с описанием');
    assert.equal(parsed.description, 'Контекст для фазы Spec');
  });

  it('выборка acceptanceCriteria: чеклисты возвращаются корректно', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-2',
      title: 'С AC',
      acceptanceCriteria: [{ text: 'Критерий 1', checked: true }, { text: 'Критерий 2', checked: false }],
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'acceptanceCriteria'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'acceptanceCriteria']);
    assert.equal(parsed.acceptanceCriteria.length, 2);
    assert.equal(parsed.acceptanceCriteria[0].text, 'Критерий 1');
    assert.equal(parsed.acceptanceCriteria[0].checked, true);
    assert.equal(parsed.acceptanceCriteria[1].checked, false);
  });

  it('без fields — полное представление, как раньше (обратная совместимость)', async () => {
    const t = createTaskFile(testDir, { id: 'vf-3', title: 'Полная задача' });
    const result = await handleToolCall('backlog_view_task', { id: t.id }, testDir);
    const parsed = JSON.parse(result);
    // Полная задача содержит все frontmatter-поля + секции тела (>20 ключей)
    assert.ok(Object.keys(parsed).length > 20, `Ожидалось > 20 ключей, получено ${Object.keys(parsed).length}`);
    assert.ok(Array.isArray(parsed.comments), 'Полное представление содержит comments');
    assert.ok('implementationPlan' in parsed);
    assert.ok('modified_files' in parsed);
  });

  it('fields: [] (пустой массив) — полное представление (обратная совместимость)', async () => {
    const t = createTaskFile(testDir, { id: 'vf-4', title: 'Пустой fields' });
    const result = await handleToolCall('backlog_view_task', { id: t.id, fields: [] }, testDir);
    const parsed = JSON.parse(result);
    assert.ok(Object.keys(parsed).length > 20);
    assert.ok(Array.isArray(parsed.comments));
  });

  it('неизвестное поле — не ошибка: остальные поля + _warning (VL-260)', async () => {
    const t = createTaskFile(testDir, { id: 'vf-5', title: 'Плохой fields' });
    const result = await handleToolCall('backlog_view_task', { id: t.id, fields: ['id', 'nope'] }, testDir);
    const parsed = JSON.parse(result);
    assert.equal(parsed.id, 'vf-5');
    assert.equal(parsed.nope, undefined);
    assert.ok(typeof parsed._warning === 'string', '_warning присутствует');
    assert.ok(parsed._warning.includes('nope'), `Текст предупреждения: ${parsed._warning}`);
    // Перечень допустимых содержит реальные ключи Task
    assert.ok(parsed._warning.includes('description'));
    assert.ok(parsed._warning.includes('acceptanceCriteria'));
  });

  it('fields не-массив (строка) — явная ошибка, а не тихое полное представление', async () => {
    const t = createTaskFile(testDir, { id: 'vf-6', title: 'Строка вместо массива' });
    await assert.rejects(
      () => handleToolCall('backlog_view_task', { id: t.id, fields: 'id' }, testDir),
      /массивом имён полей/,
    );
  });
});

/**
 * VL-236: нормализация имён полей на входе (camelCase → snake_case).
 *
 * Контракт: точное совпадение приоритетно; иначе camelToSnake и повторная
 * проверка; иначе — прежняя ошибка с перечнем допустимых; дубли канонического
 * ключа в ответ не попадают; не-строковые элементы — явная ошибка.
 */
describe('backlog_view_task — camelCase-алиасы fields (VL-236)', () => {
  beforeAll(() => setup());
  afterAll(() => cleanup());

  it('camelCase frontmatter-поля: modifiedFiles → modified_files (инцидент VL-147/VL-137)', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-11',
      title: 'С изменёнными файлами',
      modified_files: ['src/a.ts', 'src/b.ts'],
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'modifiedFiles'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'modified_files']);
    assert.deepStrictEqual(parsed.modified_files, ['src/a.ts', 'src/b.ts']);
  });

  it('snake_case-алиас поля тела: implementation_plan → implementationPlan', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-12',
      title: 'С планом',
      implementationPlan: '- шаг 1',
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'implementation_plan'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    // Канонический ключ Task для тела — camelCase: алиас нормализуется туда же
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'implementationPlan']);
    assert.equal(parsed.implementationPlan, '- шаг 1');
  });

  it('snake_case-алиас чеклиста: acceptance_criteria → acceptanceCriteria', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-13',
      title: 'С AC',
      acceptanceCriteria: [{ text: 'Критерий', checked: false }],
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['acceptance_criteria'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['acceptanceCriteria']);
    assert.equal(parsed.acceptanceCriteria.length, 1);
  });

  it('смешанный список: порядок ключей ответа = порядок в fields', async () => {
    const t = createTaskFile(testDir, { id: 'vf-14', title: 'Порядок', modified_files: [] });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['title', 'modifiedFiles', 'id'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['title', 'modified_files', 'id']);
  });

  it('alias + canonical одного поля — ключ в ответе один раз', async () => {
    const t = createTaskFile(testDir, { id: 'vf-15', title: 'Дубль', modified_files: ['x.ts'] });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'modified_files', 'modifiedFiles'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'modified_files']);
    assert.deepStrictEqual(parsed.modified_files, ['x.ts']);
  });

  it('мусорное имя в camelCase — не ошибка, валидные поля + _warning (VL-260)', async () => {
    const t = createTaskFile(testDir, { id: 'vf-16', title: 'Мусор' });
    const result = await handleToolCall('backlog_view_task', { id: t.id, fields: ['id', 'nopeField'] }, testDir);
    const parsed = JSON.parse(result);
    assert.equal(parsed.id, 'vf-16');
    assert.ok(parsed._warning.includes('nopeField'), `Текст: ${parsed._warning}`);
    assert.ok(parsed._warning.includes('modified_files'), 'Предупреждение перечисляет допустимые поля');
  });

  it('не-строковый элемент fields — явная ошибка, а не TypeError', async () => {
    const t = createTaskFile(testDir, { id: 'vf-17', title: 'null в fields' });
    await assert.rejects(
      () => handleToolCall('backlog_view_task', { id: t.id, fields: [null] }, testDir),
      /массивом имён полей/,
    );
  });
});

/**
 * VL-260: неизвестный ключ в fields не валит вызов + смысловые алиасы.
 *
 * Контракт: валидные поля возвращаются, неизвестные игнорируются и перечисляются
 * в `_warning` с ближайшими именами; notes/plan/ac/dod/summary — алиасы; алиас
 * не перебивает реальный ключ Task; списковые инструменты используют тот же хелпер.
 */
describe('VL-260 — неизвестные поля не валят вызов, алиасы', () => {
  beforeAll(() => setup());
  afterAll(() => cleanup());

  it('fields: ["id","notes","phase"] → id + implementationNotes + _warning о phase, без ошибки', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-20',
      title: 'Ключевой кейс',
      implementationNotes: 'заметки',
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['id', 'notes', 'phase'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.equal(parsed.id, 'vf-20');
    assert.equal(parsed.implementationNotes, 'заметки');
    assert.equal(parsed.notes, undefined, 'алиас не попадает в ответ под своим именем');
    assert.equal(parsed.phase, undefined);
    assert.ok(typeof parsed._warning === 'string');
    assert.ok(parsed._warning.includes('phase'), parsed._warning);
    assert.ok(parsed._warning.includes('implementationPlan'), `Подсказка: ${parsed._warning}`);
    assert.deepStrictEqual(Object.keys(parsed), ['id', 'implementationNotes', '_warning']);
  });

  it('смысловые алиасы plan/ac/dod резолвятся в канонические ключи', async () => {
    const t = createTaskFile(testDir, {
      id: 'vf-21',
      title: 'Алиасы',
      implementationPlan: '- шаг 1',
      acceptanceCriteria: [{ text: 'AC-1', checked: false }],
      definitionOfDone: [{ text: 'DoD-1', checked: false }],
    });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['plan', 'ac', 'dod'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(
      Object.keys(parsed),
      ['implementationPlan', 'acceptanceCriteria', 'definitionOfDone'],
    );
    assert.equal(parsed.implementationPlan, '- шаг 1');
    assert.equal(parsed.acceptanceCriteria.length, 1);
    assert.equal(parsed.definitionOfDone.length, 1);
  });

  it('алиас не перебивает реальные ключи Task (modified_files остаётся собой)', async () => {
    const t = createTaskFile(testDir, { id: 'vf-22', title: 'Без конфликта', modified_files: ['src/x.ts'] });
    const result = await handleToolCall('backlog_view_task', { id: t.id, fields: ['modified_files'] }, testDir);
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['modified_files']);
    assert.deepStrictEqual(parsed.modified_files, ['src/x.ts']);
  });

  it('все поля неизвестны — {_warning} без ошибки', async () => {
    const t = createTaskFile(testDir, { id: 'vf-23', title: 'Всё мимо' });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['phase', 'sprint'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['_warning']);
    assert.ok(parsed._warning.includes('phase'));
    assert.ok(parsed._warning.includes('sprint'));
  });

  it('дедуп alias + canonical: implementationNotes и notes → один ключ', async () => {
    const t = createTaskFile(testDir, { id: 'vf-24', title: 'Дубль алиаса', implementationNotes: 'x' });
    const result = await handleToolCall(
      'backlog_view_task',
      { id: t.id, fields: ['implementationNotes', 'notes'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(Object.keys(parsed), ['implementationNotes']);
  });

  it('backlog_list_tasks с fields: валидное поле есть, неизвестное → _warning, без throw', async () => {
    createTaskFile(testDir, { id: 'vf-25', title: 'Список с полями' });
    const result = await handleToolCall(
      'backlog_list_tasks',
      { fields: ['id', 'nope'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed.tasks), 'ответ содержит массив tasks');
    assert.ok(parsed.tasks.some((t) => t.id === 'vf-25'));
    assert.deepStrictEqual(Object.keys(parsed.tasks[0]), ['id']);
    assert.ok(parsed._warning.includes('nope'), parsed._warning);
  });

  it('backlog_list_tasks без fields — прежний формат (массив)', async () => {
    const result = await handleToolCall('backlog_list_tasks', {}, testDir);
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed), 'без fields ответ — массив карточек');
    assert.ok(parsed.length > 0);
    assert.ok('parent_task_id' in parsed[0]);
  });

  it('backlog_search с fields: {found, returned, tasks} + _warning, карточки урезаны', async () => {
    createTaskFile(testDir, { id: 'vf-26', title: 'Поиск по полям про совместимость' });
    const result = await handleToolCall(
      'backlog_search',
      { query: 'совместимость', fields: ['id', 'title', 'bogus'] },
      testDir,
    );
    const parsed = JSON.parse(result);
    assert.ok(typeof parsed.found === 'number');
    assert.equal(parsed.returned, parsed.tasks.length);
    assert.ok(parsed.tasks.length > 0);
    assert.deepStrictEqual(Object.keys(parsed.tasks[0]), ['id', 'title']);
    assert.ok(parsed._warning.includes('bogus'), parsed._warning);
  });
});
