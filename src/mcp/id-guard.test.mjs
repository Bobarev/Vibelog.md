/**
 * Тесты VL-425 — центральный guard обязательного id в handleToolCall
 * и fail-safe getTask.
 *
 * Инцидент lb-gift LB-16 (vb 1.14.0): модель стабильно НЕ передавала
 * args.id в backlog_finish_phase — 24 вызова подряд падали серверной
 * ошибкой «Cannot read properties of undefined (reading 'toLowerCase')»
 * и сжигали wall-time фазы. Корень: required схемы MCP SDK не валидируется
 * на входе, а обязательность comment была защищена VL-253 (авто-отчёт),
 * обязательность id — нет.
 *
 * Каталог — mkdtempSync (VL-241); фазовый env агентской сессии снимается
 * clearPhaseEnv() на уровне файла (VL-374: in-process handleToolCall).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync,
  readFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall, normalizeTaskId } from '../../dist/mcp/tools.js';
import { createTaskFile, getTask } from '../../dist/core/store.js';
import { clearPhaseEnv } from '../test-env.mjs';

/** Фазовый env агентской сессии на время файла (VL-374). */
let restorePhaseEnv;

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-id-guard-'));
const backlogDir = join(cwd, 'backlog');
const tasksPath = join(backlogDir, 'tasks');
const completedPath = join(backlogDir, 'completed');

/** Байтовый снимок всех файлов задач — «до/после» без чтения задач по-своему. */
function snapshotTaskFiles() {
  const files = {};
  for (const dir of [tasksPath, completedPath]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) files[f] = readFileSync(join(dir, f), 'utf-8');
  }
  return files;
}

/** Вызов, ожидающий контролируемого отказа: возвращает Error или null. */
async function expectError(name, args) {
  try {
    await handleToolCall(name, args, cwd);
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(tasksPath, { recursive: true });
  mkdirSync(completedPath, { recursive: true });
  // Проект с префиксом, ОТЛИЧНЫМ от VL — как в lb-gift: числовые id должны
  // нормализоваться именно в «LB-N», а не в «VL-N»
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'LB Gift',
    task_prefix: 'LB',
    default_status: 'Planned',
    statuses: ['Spec', 'Planned', 'In Progress', 'Review', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(cwd, { recursive: true, force: true });
});

describe('VL-425 — центральный guard обязательного id (handleToolCall)', () => {
  it('AC1: finish_phase без id → отказ «Не передан обязательный аргумент id», TypeError нет, записей нет байтово', async () => {
    createTaskFile(cwd, { title: 'Guard без id', status: 'Planned' }); // LB-1
    const before = snapshotTaskFiles();

    // Воспроизведение инцидента: {aborted, comment} без id
    const err = await expectError('backlog_finish_phase', { aborted: true, comment: 'тест без id' });
    assert.ok(err, 'ожидаемый контролируемый отказ');
    assert.ok(
      !err.message.includes('Cannot read properties'),
      `не TypeError, а внятный текст: ${err.message}`,
    );
    assert.ok(
      err.message.includes('Не передан обязательный аргумент id задачи (обязательное поле схемы)'),
      `нет текста guard'а: ${err.message}`,
    );
    assert.ok(!err.message.includes('LB-1'), 'без вставки конкретного id (решение Pavel)');

    assert.deepEqual(snapshotTaskFiles(), before, 'файлы задач не изменены (байтово до/после)');
    assert.equal(getTask(cwd, 'LB-1').comments.length, 0, 'комментарии не записаны');
  });

  it('AC1: пустой/дробный/отрицательный/объектный id → тот же отказ, не TypeError', async () => {
    const badValues = [
      ['пустая строка', ''],
      ['строка пробелов', '   '],
      ['дробное число', 16.5],
      ['отрицательное', -3],
      ['объект', {}],
      ['массив', ['LB-16']],
      ['null', null],
      ['boolean', true],
      ['не-строковый undefined', undefined],
    ];
    for (const [label, bad] of badValues) {
      const err = await expectError('backlog_finish_phase', { id: bad, comment: 'x' });
      assert.ok(err, `${label}: ожидаемый отказ`);
      assert.ok(
        err.message.includes('Не передан обязательный аргумент id'),
        `${label}: ${err.message}`,
      );
      assert.ok(!err.message.includes('Cannot read properties'), `${label}: не TypeError`);
    }
  });

  it('AC2: id 16 и "16" нормализуются в LB-16 по task_prefix проекта', async () => {
    createTaskFile(cwd, { id: 'LB-16', title: 'Инцидент LB-16', status: 'Planned' });

    // Целое число — модель прислала НОМЕР задачи вместо полного id
    const outNum = await handleToolCall(
      'backlog_finish_phase', { id: 16, comment: 'Фаза (числовой id)' }, cwd,
    );
    assert.ok(!String(outNum).includes('Не передан обязательный'), String(outNum));
    let task = getTask(cwd, 'LB-16');
    assert.ok(task, 'число 16 применено к LB-16 (prefix из конфига, не VL)');
    assert.equal(task.comments.length, 1, 'комментарий записан в LB-16');
    assert.ok(task.comments[0].text.includes('Фаза (числовой id)'));

    // Числовая строка — модель часто присылает числа строками
    await handleToolCall('backlog_finish_phase', { id: '16', comment: 'Фаза (числовая строка)' }, cwd);
    task = getTask(cwd, 'LB-16');
    assert.equal(task.comments.length, 2, 'числовая строка "16" тоже нормализуется');
    assert.ok(task.comments[1].text.includes('Фаза (числовая строка)'));
  });

  it('AC3: нормализация центральная — другие id-инструменты тоже принимают числовой id', async () => {
    // add_comment — тот же guard (required ['id','comment']), а не копия логики
    await handleToolCall('backlog_add_comment', { id: 16, comment: 'центральный guard (VL-425)' }, cwd);
    const task = getTask(cwd, 'LB-16');
    assert.ok(
      task.comments.some((c) => c.text === 'центральный guard (VL-425)'),
      'add_comment с id 16 применился к LB-16',
    );
  });

  it('AC2: нормализованный, но несуществующий id → «Задача LB-99 не найдена», не guard-отказ', async () => {
    const err = await expectError('backlog_view_task', { id: 99 });
    assert.ok(err, 'ожидаемая ошибка «не найдена»');
    assert.ok(err.message.includes('LB-99'), `число не нормализовано: ${err.message}`);
    assert.ok(
      !err.message.includes('Не передан обязательный'),
      `id передан и нормализован — это «не найдена»: ${err.message}`,
    );
  });

  it('AC5: регрессия VL-253 — finish_phase с id, но БЕЗ comment → авто-отчёт, успех', async () => {
    const before = getTask(cwd, 'LB-16').comments.length;
    const out = await handleToolCall(
      'backlog_finish_phase', { id: 16, status: 'In Progress' }, cwd,
    );
    assert.ok(!String(out).includes('Не передан обязательный'), String(out));
    const task = getTask(cwd, 'LB-16');
    assert.equal(task.status, 'In Progress', 'статус применён (fail-open без env фазы)');
    assert.equal(task.comments.length, before + 1, 'авто-отчёт записан вместо comment');
  });

  it("AC3 (негатив): инструменты без id в required не затронуты guard'ом", async () => {
    const out = await handleToolCall('backlog_list_tasks', {}, cwd);
    assert.equal(typeof out, 'string', 'list_tasks без id работает как раньше');
  });

  it('normalizeTaskId — юнит: числа/строки → LB-N, мусор → null', () => {
    assert.equal(normalizeTaskId(cwd, 16), 'LB-16', 'целое число');
    assert.equal(normalizeTaskId(cwd, '16'), 'LB-16', 'числовая строка');
    assert.equal(normalizeTaskId(cwd, ' 16 '), 'LB-16', 'trim перед нормализацией');
    assert.equal(normalizeTaskId(cwd, 'LB-7'), 'LB-7', 'нечисловая строка — как есть');
    assert.equal(normalizeTaskId(cwd, 16.5), null, 'дробное → null');
    assert.equal(normalizeTaskId(cwd, -1), null, 'отрицательное → null');
    assert.equal(normalizeTaskId(cwd, ''), null, 'пустая строка → null');
    assert.equal(normalizeTaskId(cwd, '   '), null, 'пробелы → null');
    assert.equal(normalizeTaskId(cwd, null), null, 'null → null');
    assert.equal(normalizeTaskId(cwd, undefined), null, 'undefined → null');
    assert.equal(normalizeTaskId(cwd, {}), null, 'объект → null');
    assert.equal(normalizeTaskId(cwd, true), null, 'boolean → null');
  });
});
