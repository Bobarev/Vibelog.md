/**
 * Тесты VL-412 — MCP-инструменты архитектурных решений (decisions / ADR).
 *
 * Проверяет:
 * - регистрацию decision_list/view/create/update в `listTools()` и `TOOL_KINDS`
 *   (list/view → read, create/update → write);
 * - CRUD через MCP: create → list → view → update;
 * - точечную правку ADR-секций (остальные секции целы, отсутствующая
 *   добавляется в каноническом порядке, `## ` внутри fenced-блока не режет
 *   секцию);
 * - валидацию до записи: пустой title, неизвестный id, недопустимый статус —
 *   файл не меняется;
 * - дубли id: `decision_list` отдаёт `duplicates`, `getDecision` помечает
 *   `ambiguous`, `vibelog doctor` предупреждает;
 * - decisions в `globalSearch`.
 *
 * Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { listTools, handleToolCall } from '../../dist/mcp/tools.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { getDecision, listDecisions, findDuplicateIds } from '../../dist/core/decision.js';
import { globalSearch } from '../../dist/core/search.js';
import { clearPhaseEnv } from '../test-env.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-decision-tools-'));
const backlogDir = join(cwd, 'backlog');
const decisionsDirPath = join(backlogDir, 'decisions');

let restorePhaseEnv;

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Decision Tools Test',
    task_prefix: 'dt',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(cwd, { recursive: true, force: true });
});

/** Разбирает ответ инструмента как JSON-ack. */
function ack(out) {
  try {
    return JSON.parse(out);
  } catch {
    assert.fail(`ответ не JSON — ${String(out).slice(0, 300)}`);
  }
}

/** Файлы решений в каталоге. */
function decisionFiles() {
  return readdirSync(decisionsDirPath).filter(f => f.endsWith('.md')).sort();
}

describe('VL-412 — регистрация инструментов решений', () => {
  it('AC2: decision_* есть в listTools() с inputSchema типа object', () => {
    const tools = listTools();
    const names = tools.map(t => t.name);
    for (const n of ['decision_list', 'decision_view', 'decision_create', 'decision_update']) {
      assert.ok(names.includes(n), `${n} не зарегистрирован`);
      const tool = tools.find(t => t.name === n);
      assert.equal(tool.inputSchema.type, 'object', `${n}: inputSchema.type`);
      assert.ok(tool.inputSchema.properties, `${n}: properties`);
    }
    assert.deepEqual(tools.find(t => t.name === 'decision_create').inputSchema.required, ['title']);
    assert.deepEqual(tools.find(t => t.name === 'decision_view').inputSchema.required, ['id']);
  });

  it('AC2: TOOL_KINDS — list/view read, create/update write', () => {
    assert.equal(TOOL_KINDS.decision_list, 'read');
    assert.equal(TOOL_KINDS.decision_view, 'read');
    assert.equal(TOOL_KINDS.decision_create, 'write');
    assert.equal(TOOL_KINDS.decision_update, 'write');
    assert.equal(isWriteOperation('decision_list'), false);
    assert.equal(isWriteOperation('decision_view'), false);
    assert.equal(isWriteOperation('decision_create'), true);
    assert.equal(isWriteOperation('decision_update'), true);
  });
});

describe('VL-412 — CRUD через MCP', () => {
  it('AC3: create → ackOk с id, list → решение в списке, view → тело', async () => {
    const created = ack(await handleToolCall('decision_create', {
      title: 'Стек фронтенда',
      status: 'accepted',
      context: 'Нужен фронтенд',
      decision: 'Svelte 5 Runes',
      consequences: 'Меньше кода',
      alternatives: 'React',
    }, cwd));
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.applied.id, 'decision-1');
    assert.equal(created.applied.status, 'accepted');
    assert.equal(created.applied.title, 'Стек фронтенда');

    const list = ack(await handleToolCall('decision_list', {}, cwd));
    assert.equal(list.ok, true);
    assert.equal(list.read, true, 'list — чтение');
    assert.equal(list.applied.decisions.length, 1);
    assert.equal(list.applied.decisions[0].id, 'decision-1');
    assert.equal(list.applied.duplicates, undefined, 'дублей нет — поля нет');

    const view = ack(await handleToolCall('decision_view', { id: 'decision-1' }, cwd));
    assert.equal(view.ok, true);
    assert.equal(view.applied.decision.title, 'Стек фронтенда');
    assert.match(view.applied.body, /## Context/);
    assert.match(view.applied.body, /Svelte 5 Runes/);
    assert.equal(view.applied.ambiguous, undefined);
  });

  it('AC1: decision_list фильтрует по статусу', async () => {
    await handleToolCall('decision_create', { title: 'Отказ от SQLite', status: 'rejected' }, cwd);
    const accepted = ack(await handleToolCall('decision_list', { status: 'accepted' }, cwd));
    assert.equal(accepted.applied.decisions.length, 1);
    assert.equal(accepted.applied.decisions[0].id, 'decision-1');
    const rejected = ack(await handleToolCall('decision_list', { status: 'REJECTED' }, cwd));
    assert.equal(rejected.applied.decisions.length, 1, 'фильтр case-insensitive');
    assert.equal(rejected.applied.decisions[0].id, 'decision-2');
  });

  it('AC3: decision_update меняет статус, тело не тронуто; повтор → applied+unchanged', async () => {
    const before = ack(await handleToolCall('decision_view', { id: 'decision-2' }, cwd));
    const upd = ack(await handleToolCall('decision_update', { id: 'decision-2', status: 'accepted' }, cwd));
    assert.equal(upd.ok, true, JSON.stringify(upd));
    assert.equal(upd.applied.status, 'accepted');
    assert.deepEqual(Object.keys(upd.applied).sort(), ['id', 'status'], 'applied — только изменённые поля');

    const after = ack(await handleToolCall('decision_view', { id: 'decision-2' }, cwd));
    assert.equal(after.applied.decision.status, 'accepted');
    assert.equal(after.applied.body, before.applied.body, 'тело не тронуто');

    const repeat = ack(await handleToolCall('decision_update', { id: 'decision-2', status: 'accepted' }, cwd));
    // VL-413: неизменяющая запись — успех с перечнем неизменённых полей.
    assert.equal(repeat.ok, true, `ожидался успех: ${JSON.stringify(repeat)}`);
    assert.deepEqual(repeat.unchanged, ['status']);
    assert.match(String(repeat.message), /Изменений нет/);
  });
});

describe('VL-412 — точечная правка ADR-секций (AC4)', () => {
  it('замена ## Context не трогает остальные секции', async () => {
    const upd = ack(await handleToolCall('decision_update', {
      id: 'decision-1', context: 'Новый контекст',
    }, cwd));
    assert.equal(upd.ok, true, JSON.stringify(upd));
    assert.equal(upd.applied.context, true);

    const view = ack(await handleToolCall('decision_view', { id: 'decision-1' }, cwd));
    const body = view.applied.body;
    assert.match(body, /## Context\n\nНовый контекст/);
    assert.match(body, /## Decision\n\nSvelte 5 Runes/, 'Decision цел');
    assert.match(body, /## Consequences\n\nМеньше кода/, 'Consequences цел');
    assert.match(body, /## Alternatives\n\nReact/, 'Alternatives цел');
    assert.equal((body.match(/## Context/g) || []).length, 1, 'секция не задублирована');
  });

  it('отсутствующая секция добавляется в каноническом порядке', async () => {
    const created = ack(await handleToolCall('decision_create', {
      title: 'Только контекст', context: 'К',
    }, cwd));
    const id = created.applied.id;
    await handleToolCall('decision_update', { id, alternatives: 'Альтернатива' }, cwd);
    const view = ack(await handleToolCall('decision_view', { id }, cwd));
    const body = view.applied.body;
    const ctxAt = body.indexOf('## Context');
    const altAt = body.indexOf('## Alternatives');
    assert.ok(ctxAt >= 0 && altAt > ctxAt, 'Alternatives после Context');
  });

  it('## внутри fenced-блока не режет секцию', async () => {
    const created = ack(await handleToolCall('decision_create', {
      title: 'С кодом',
      context: 'Контекст',
      decision: 'Решение',
    }, cwd));
    const id = created.applied.id;
    // Вставляем fenced-блок с «## » внутри в секцию Decision
    await handleToolCall('decision_update', {
      id,
      decision: 'Текст\n\n```md\n## Не заголовок\n```\n\nХвост',
    }, cwd);
    const view = ack(await handleToolCall('decision_view', { id }, cwd));
    assert.match(view.applied.body, /## Не заголовок/, 'содержимое fenced-блока сохранено');
    assert.match(view.applied.body, /Хвост/, 'хвост секции сохранён');
    assert.equal((view.applied.body.match(/## Decision/g) || []).length, 1);
  });

  it('смена title переименовывает файл', async () => {
    const created = ack(await handleToolCall('decision_create', { title: 'Старое имя' }, cwd));
    const id = created.applied.id;
    const upd = ack(await handleToolCall('decision_update', { id, title: 'Новое имя' }, cwd));
    assert.equal(upd.ok, true, JSON.stringify(upd));
    assert.equal(upd.applied.title, 'Новое имя');
    const files = decisionFiles();
    assert.ok(files.some(f => f.startsWith(`${id}-Новое-имя`)), `файл переименован: ${files.join(', ')}`);
    assert.ok(!files.some(f => f.startsWith(`${id}-Старое-имя`)), 'старый файл удалён');
  });
});

describe('VL-412 — валидация до записи (AC5)', () => {
  it('пустой title при create → ошибка, файл не создан', async () => {
    const before = decisionFiles().length;
    const res = ack(await handleToolCall('decision_create', { title: '   ' }, cwd));
    assert.equal(res.ok, false);
    assert.match(String(res.error), /title/);
    assert.equal(decisionFiles().length, before, 'файл не создан');
  });

  it('недопустимый статус при create → ошибка, файл не создан', async () => {
    const before = decisionFiles().length;
    const res = ack(await handleToolCall('decision_create', { title: 'Мусор', status: 'мусор' }, cwd));
    assert.equal(res.ok, false);
    assert.match(String(res.error), /Недопустимый статус/);
    assert.equal(decisionFiles().length, before);
  });

  it('неизвестный id при view/update → ошибка со списком доступных', async () => {
    const view = ack(await handleToolCall('decision_view', { id: 'decision-99' }, cwd));
    assert.equal(view.ok, false);
    assert.match(String(view.error), /не найдено/);
    assert.match(String(view.error), /decision-1/, 'перечислены доступные id');

    const upd = ack(await handleToolCall('decision_update', { id: 'decision-99', status: 'accepted' }, cwd));
    assert.equal(upd.ok, false);
    assert.match(String(upd.error), /не найдено/);
  });

  it('недопустимый статус при update → ошибка, файл не меняется', async () => {
    const before = ack(await handleToolCall('decision_view', { id: 'decision-1' }, cwd));
    const res = ack(await handleToolCall('decision_update', { id: 'decision-1', status: 'мусор' }, cwd));
    assert.equal(res.ok, false);
    assert.match(String(res.error), /Недопустимый статус/);
    const after = ack(await handleToolCall('decision_view', { id: 'decision-1' }, cwd));
    assert.equal(after.applied.decision.status, before.applied.decision.status);
    assert.equal(after.applied.body, before.applied.body);
  });
});

describe('VL-412 — дубли id (AC7)', () => {
  it('findDuplicateIds находит повтор, decision_list отдаёт duplicates, getDecision — ambiguous', async () => {
    // Имитируем реальный дефект проекта: два файла с одним id
    writeFileSync(join(decisionsDirPath, 'decision-50-Первая-версия.md'),
      '---\nid: decision-50\ntitle: Первая версия\ndate: 2026-01-01\nstatus: proposed\n---\n## Context\n\nстарое\n', 'utf-8');
    writeFileSync(join(decisionsDirPath, 'decision-50-Вторая-версия.md'),
      '---\nid: decision-50\ntitle: Вторая версия\ndate: 2026-01-02\nstatus: accepted\n---\n## Context\n\nновое\n', 'utf-8');

    const entries = listDecisions(backlogDir);
    assert.deepEqual(findDuplicateIds(entries), ['decision-50']);

    const list = ack(await handleToolCall('decision_list', {}, cwd));
    assert.deepEqual(list.applied.duplicates, ['decision-50'], 'decision_list помечает конфликт');

    const view = ack(await handleToolCall('decision_view', { id: 'decision-50' }, cwd));
    assert.equal(view.ok, true);
    assert.equal(view.applied.ambiguous, true, 'getDecision сообщает о неоднозначности');
    assert.match(String(view.message), /ambiguous/);

    const entry = getDecision(backlogDir, 'decision-50');
    assert.equal(entry.ambiguous, true);
  });
});

describe('VL-412 — decisions в globalSearch (AC6)', () => {
  it('поиск по телу решения находит его в группе decisions', () => {
    const res = globalSearch(cwd, 'Svelte 5 Runes');
    assert.ok(Array.isArray(res.decisions), 'поле decisions в результате');
    assert.ok(res.decisions.some(d => d.id === 'decision-1'), `найдено: ${JSON.stringify(res.decisions)}`);
    const hit = res.decisions.find(d => d.id === 'decision-1');
    assert.equal(hit.status, 'accepted');
    assert.equal(typeof hit.date, 'string');
    assert.equal('body' in hit, false, 'слим-хит без тела');
  });

  it('поиск по заголовку и id решения', () => {
    assert.ok(globalSearch(cwd, 'Стек фронтенда').decisions.some(d => d.id === 'decision-1'));
    assert.ok(globalSearch(cwd, 'decision-2').decisions.some(d => d.id === 'decision-2'));
  });

  it('пустой запрос → пустая группа decisions', () => {
    assert.deepEqual(globalSearch(cwd, '').decisions, []);
  });
});
