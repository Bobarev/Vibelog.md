/**
 * Тесты VL-407 — `allow_tools` персоны РЕАЛЬНО ограничивает инструменты чата.
 *
 * До этой задачи поле читалось и валидировалось, но ни на что не влияло:
 * любая роль получала полный набор (edit, write_file, backlog_update_task…).
 * Проверяем три уровня:
 * 1. `chatToolDefs(cwd, persona)` — фильтрация ИТОГОВОГО списка (включая
 *    локальные read_file/write_file/edit/search_files и ask_user);
 * 2. wire-запрос — модель не видит отфильтрованные имена в `tools`;
 * 3. `executeTool` — вызов вне списка (устаревший tool_call в истории,
 *    resume) получает машиночитаемый отказ, а не исполняется.
 *
 * Семантика значений: `undefined` — всё (совместимость), `[]` — ничего, кроме
 * всегда-доступного `memory_remember`, непустой массив — ровно эти имена.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chatToolDefs } from '../../dist/web/tool-policy.js';
import { runChat } from '../../dist/web/chat.js';
import { loadPersonas } from '../../dist/web/personas.js';
import { zeroUsage } from '../../dist/agent/llm.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

let cwd;

/** Роль-фикстура: ограниченный набор инструментов (только чтение). */
const AUDITOR = {
  label: 'Аудитор',
  prompt: 'auditor',
  allow_tools: ['backlog_search', 'read_file', 'search_files'],
};

/** Роль-фикстура: пустой список — «ничего не разрешено». */
const SILENT = { label: 'Молчун', prompt: 'silent', allow_tools: [] };

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-vl407-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'VL407 Test',
    task_prefix: 'at',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({
    chat_personas: { auditor: AUDITOR, silent: SILENT },
  }, null, 2), 'utf-8');
  for (const name of ['auditor', 'silent']) {
    writeFileSync(
      join(cwd, '.vibelog', 'prompts', 'personas', `${name}.md`),
      `Ты — роль ${name}.`,
      'utf-8',
    );
  }
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Роль из реестра по id (как её видит чат). */
function persona(id) {
  const found = loadPersonas(cwd).personas.find(p => p.id === id);
  assert.ok(found, `роль ${id} должна быть в реестре`);
  return found;
}

/** Фейковый LLM: очередь ответов, запоминает переданные tools. */
function fakeLlm(script) {
  const state = { calls: 0, tools: [] };
  const llm = {
    async streamChat(_messages, tools, opts) {
      state.tools = tools;
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      const tokens = step.text ? step.text.split(/(?<=\s)/) : [];
      for (const t of tokens) opts?.onToken?.(t);
      return { text: step.text ?? '', toolCalls: step.toolCalls ?? [], usage: zeroUsage() };
    },
  };
  return { llm, state };
}

/** Сбор событий runChat. */
async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

describe('VL-407 — chatToolDefs фильтрует итоговый список', () => {
  it('AC1: остаются только перечисленные имена (+ memory_remember)', () => {
    const names = chatToolDefs(cwd, persona('auditor')).map(d => d.name).sort();
    assert.deepEqual(names, ['backlog_search', 'memory_remember', 'read_file', 'search_files']);
  });

  it('AC2: allow_tools не задан → полный набор, как раньше', () => {
    const names = chatToolDefs(cwd, persona('helper')).map(d => d.name);
    for (const name of ['read_file', 'write_file', 'edit', 'search_files', 'ask_user', 'backlog_update_task', 'git_commit']) {
      assert.ok(names.includes(name), `${name} должен быть доступен роли без allow_tools`);
    }
  });

  it('AC3: пустой массив → только memory_remember (не «всё разрешено»)', () => {
    const names = chatToolDefs(cwd, persona('silent')).map(d => d.name);
    assert.deepEqual(names, ['memory_remember']);
  });

  it('AC4: локальные инструменты чата участвуют в фильтрации', () => {
    const names = chatToolDefs(cwd, persona('auditor')).map(d => d.name);
    assert.ok(names.includes('read_file'), 'read_file разрешён списком');
    assert.ok(!names.includes('write_file'), 'write_file не разрешён');
    assert.ok(!names.includes('edit'), 'edit не разрешён');
    assert.ok(!names.includes('ask_user'), 'ask_user не разрешён (его имя надо добавить в список)');
  });

  it('AC5: memory_remember не отваливается при заданном allow_tools', () => {
    const names = chatToolDefs(cwd, persona('auditor')).map(d => d.name);
    assert.ok(names.includes('memory_remember'), 'память роли доступна всегда');
    // и без роли инструмента нет вовсе (headless-пути)
    assert.ok(!chatToolDefs(cwd).some(d => d.name === 'memory_remember'));
  });

  it('AC4: имена edit/ask_user/memory_remember валидны в allow_tools', () => {
    const { errors } = loadPersonas(cwd);
    assert.deepEqual(errors, [], 'валидатор принимает локальные имена чата');
  });
});

describe('VL-407 — wire-запрос и отказ при вызове', () => {
  it('AC6: модель не видит отфильтрованные имена в tools', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'vl407-wire', persona: 'auditor' }, { llm });
    const names = state.tools.map(t => t.name);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('backlog_search'));
    for (const forbidden of ['edit', 'write_file', 'backlog_update_task', 'git_commit', 'ask_user']) {
      assert.ok(!names.includes(forbidden), `${forbidden} не должен уходить в wire-запрос`);
    }
  });

  it('AC7: вызов вне списка → машиночитаемый отказ, файл не изменён', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-wf', name: 'write_file', arguments: { path: 'hack.txt', content: 'x' } }] },
      { text: 'Понял.' },
    ]);
    const events = await collect({ message: 'запиши файл', threadId: 'vl407-deny', persona: 'auditor' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-wf');
    assert.ok(end, 'tool_end для запрещённого вызова');
    assert.equal(end.isError, true);
    const ack = JSON.parse(end.result);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /не разрешён роли "Аудитор"/);
    // Никакой карточки Allow/Deny: подтверждать запрещённую операцию бессмысленно
    assert.ok(!events.some(e => e.type === 'approval'), 'approval-гейт не открывается');
  });

  it('AC5: memory_remember работает при заданном allow_tools без упоминания в списке', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-mem', name: 'memory_remember', arguments: { text: 'Пользователь любит краткость' } }] },
      { text: 'Запомнил.' },
    ]);
    const events = await collect({ message: 'запомни', threadId: 'vl407-mem', persona: 'auditor' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-mem');
    assert.ok(end, 'tool_end для memory_remember');
    assert.notEqual(end.isError, true, `memory_remember не должен быть отклонён: ${end.result}`);
    assert.ok(events.some(e => e.type === 'memory'), 'событие memory в ленте');
  });

  it('AC3: пустой allow_tools → любой вызов отклоняется', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-rd', name: 'read_file', arguments: { path: 'backlog/config.yml' } }] },
      { text: 'Ок.' },
    ]);
    const events = await collect({ message: 'прочитай', threadId: 'vl407-empty', persona: 'silent' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-rd');
    assert.ok(end);
    assert.equal(end.isError, true);
    assert.match(JSON.parse(end.result).error, /не разрешён роли "Молчун"/);
  });
});
