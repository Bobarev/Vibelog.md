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

  it('неизвестное поле — ошибка на русском с перечнем допустимых имён', async () => {
    const t = createTaskFile(testDir, { id: 'vf-5', title: 'Плохой fields' });
    await assert.rejects(
      () => handleToolCall('backlog_view_task', { id: t.id, fields: ['id', 'nope'] }, testDir),
      (err) => {
        assert.ok(err.message.includes('Неизвестные поля: nope.'), `Текст ошибки: ${err.message}`);
        // Перечень допустимых содержит реальные ключи Task
        assert.ok(err.message.includes('description'), 'Ошибка перечисляет допустимые поля');
        assert.ok(err.message.includes('acceptanceCriteria'));
        return true;
      },
    );
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

  it('мусорное имя в camelCase всё ещё ошибка с перечнем допустимых', async () => {
    const t = createTaskFile(testDir, { id: 'vf-16', title: 'Мусор' });
    await assert.rejects(
      () => handleToolCall('backlog_view_task', { id: t.id, fields: ['id', 'nopeField'] }, testDir),
      (err) => {
        assert.ok(err.message.includes('Неизвестные поля: nopeField.'), `Текст ошибки: ${err.message}`);
        assert.ok(err.message.includes('modified_files'), 'Ошибка перечисляет допустимые поля');
        return true;
      },
    );
  });

  it('не-строковый элемент fields — явная ошибка, а не TypeError', async () => {
    const t = createTaskFile(testDir, { id: 'vf-17', title: 'null в fields' });
    await assert.rejects(
      () => handleToolCall('backlog_view_task', { id: t.id, fields: [null] }, testDir),
      /массивом имён полей/,
    );
  });
});
