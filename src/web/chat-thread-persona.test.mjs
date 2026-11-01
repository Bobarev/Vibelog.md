/**
 * Тесты VL-283 — роль фиксируется за тредом.
 *
 * Роль выбирается при создании треда и дальше не меняется: она хранится в
 * sidecar `<threadId>.persona.json` в `.vibelog/chat-sessions/` (паттерн
 * `.allow.json` VL-264) и отдаётся клиенту в `GET /api/chat/threads/:id`.
 *
 * Покрыто:
 * - sidecar читается/пишется идемпотентно (повтор не перетирает первый выбор);
 * - невалидный threadId и битый JSON → роли нет, файл за пределы каталога не пишется;
 * - чужой `body.persona` в зафиксированном треде игнорируется (AC1);
 * - ошибка валидации на первом ходе НЕ фиксирует роль (тред не портится);
 * - старый тред без sidecar (до VL-283) ведёт себя как helper (Р2 плана);
 * - роль из sidecar, удалённая из реестра, → helper без перезаписи файла;
 * - `effectiveThreadPersona` / API: пустой тред → null, начатый → роль (AC2).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringifyYaml } from '../../dist/core/yaml.js';

import {
  runChat,
  readThreadPersona,
  fixThreadPersona,
  effectiveThreadPersona,
  listChatThreads,
  loadChatHistory,
} from '../../dist/web/chat.js';
import { handleApi } from '../../dist/web/api.js';
import { zeroUsage } from '../../dist/agent/llm.js';

/**
 * Проект-фикстура: конфиг backlog + settings.json с секцией chat_personas.
 * Свой mkdtemp на файл (lesson-89): параллельные прогоны не затирают друг друга.
 */
let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-tpersona-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Thread Persona Test',
      task_prefix: 'tp',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    JSON.stringify(
      {
        chat_personas: {
          researcher: { label: 'Ресёрчер', description: 'Ищет информацию', prompt: 'researcher' },
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'prompts', 'personas', 'researcher.md'),
    'Ты — ресёрчер проекта: ищи источники.',
    'utf-8',
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Подменный LLM (паттерн chat.test.mjs): пишет system-промпт каждого вызова. */
function fakeLlm(replies) {
  const state = { calls: 0, messages: [] };
  const queue = [...replies];
  return {
    state,
    llm: {
      async streamChat(messages, _tools, opts) {
        state.messages.push(structuredClone(messages));
        state.calls++;
        const reply = queue.shift() ?? { text: 'Ок.' };
        for (const piece of (reply.text ?? '').split(/(?<=\s)/)) opts?.onToken?.(piece);
        // usage обязателен: сервер пишет статистику хода (VL-255)
        return { text: reply.text ?? '', toolCalls: reply.toolCalls ?? [], usage: zeroUsage() };
      },
    },
  };
}

/** Сбор событий runChat. */
async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

/** Путь sidecar-файла роли треда. */
function personaPath(threadId) {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.persona.json`);
}

/** Записать историю треда напрямую (симуляция «старого» треда до VL-283). */
function seedHistory(threadId, messages) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${threadId}.jsonl`),
    messages.map(m => JSON.stringify(m)).join('\n') + '\n',
    'utf-8',
  );
}

describe('VL-283: sidecar роли треда (хранение)', () => {
  it('readThreadPersona: нет файла → null, после fixThreadPersona → id', () => {
    assert.equal(readThreadPersona(cwd, 'sp-none'), null);
    assert.equal(fixThreadPersona(cwd, 'sp-none', 'architect'), 'architect');
    assert.equal(readThreadPersona(cwd, 'sp-none'), 'architect');
    const raw = JSON.parse(readFileSync(personaPath('sp-none'), 'utf8'));
    assert.equal(raw.persona, 'architect');
    assert.ok(typeof raw.fixedAt === 'string' && raw.fixedAt.length > 0, 'fixedAt ISO');
  });

  it('fixThreadPersona идемпотентна: повтор с другим id возвращает исходный и файл не меняет', () => {
    fixThreadPersona(cwd, 'sp-idem', 'architect');
    const before = readFileSync(personaPath('sp-idem'), 'utf8');
    assert.equal(fixThreadPersona(cwd, 'sp-idem', 'helper'), 'architect');
    assert.equal(readFileSync(personaPath('sp-idem'), 'utf8'), before, 'файл не перезаписан');
    assert.equal(readThreadPersona(cwd, 'sp-idem'), 'architect');
  });

  it('readThreadPersona: битый JSON → null (тред продолжает работать)', () => {
    mkdirSync(join(cwd, '.vibelog', 'chat-sessions'), { recursive: true });
    writeFileSync(personaPath('sp-broken'), '{не json', 'utf-8');
    assert.equal(readThreadPersona(cwd, 'sp-broken'), null);
  });

  it('невалидный threadId: ничего не читаем и не пишем за пределы каталога', () => {
    assert.equal(readThreadPersona(cwd, '../evil'), null);
    assert.equal(fixThreadPersona(cwd, '../evil', 'architect'), 'architect');
    assert.ok(!existsSync(join(cwd, '.vibelog', 'evil.persona.json')), 'вне chat-sessions не создан');
    assert.ok(!existsSync(join(cwd, '.vibelog', 'chat-sessions', '..', 'evil.persona.json')));
  });

  it('listChatThreads не видит sidecar (треды не задваиваются)', () => {
    seedHistory('sp-list', [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'Ок' }]);
    fixThreadPersona(cwd, 'sp-list', 'architect');
    const threads = listChatThreads(cwd).filter(t => t.threadId === 'sp-list');
    assert.equal(threads.length, 1, 'ровно один тред');
    assert.equal(threads[0].messageCount, 2, 'sidecar не попал в историю');
  });
});

describe('VL-283: роль фиксируется первым ходом (сервер)', () => {
  it('первый ход с persona фиксирует роль, второй ход с другим persona её не меняет (AC1)', async () => {
    const first = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'первый', threadId: 'tp-first', persona: 'architect' }, { llm: first.llm });
    assert.equal(first.state.messages[0][0].content.includes('## Текущая роль: Архитектор'), true);
    assert.equal(readThreadPersona(cwd, 'tp-first'), 'architect');

    const second = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'второй', threadId: 'tp-first', persona: 'helper' }, { llm: second.llm });
    assert.equal(
      second.state.messages[0][0].content.includes('## Текущая роль: Архитектор'),
      true,
      'system-промпт прежней роли',
    );
    assert.equal(
      second.state.messages[0][0].content.includes('## Текущая роль: Помощник'),
      false,
      'роль не переключилась',
    );
    assert.equal(readThreadPersona(cwd, 'tp-first'), 'architect', 'sidecar не перезаписан');
  });

  it('второй ход с неизвестным persona в зафиксированном треде не ломает ход', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collect({ message: 'ещё', threadId: 'tp-first', persona: 'nope' }, { llm });
    assert.equal(events.some(e => e.type === 'error'), false, 'ошибки нет');
    assert.equal(state.calls, 1, 'LLM вызван');
    assert.equal(readThreadPersona(cwd, 'tp-first'), 'architect');
  });

  it('неизвестная роль на ПЕРВОМ ходе → error и sidecar не создан', async () => {
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collect({ message: 'привет', threadId: 'tp-bad', persona: 'nope' }, { llm });
    const err = events.find(e => e.type === 'error');
    assert.ok(err);
    assert.equal(err.message, 'Неизвестная роль: nope');
    assert.equal(state.calls, 0);
    assert.ok(!existsSync(personaPath('tp-bad')), 'sidecar не создан');
  });

  it('первый тред без persona фиксирует helper', async () => {
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'tp-default' }, { llm });
    assert.equal(readThreadPersona(cwd, 'tp-default'), 'helper');
  });

  it('старый тред без sidecar (до VL-283): роль helper, чужой persona игнорируется', async () => {
    seedHistory('tp-legacy', [
      { role: 'user', content: 'старый вопрос' },
      { role: 'assistant', content: 'старый ответ' },
    ]);
    assert.equal(readThreadPersona(cwd, 'tp-legacy'), null, 'sidecar ещё нет');
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'продолжим', threadId: 'tp-legacy', persona: 'architect' }, { llm });
    assert.equal(
      state.messages[0][0].content.includes('## Текущая роль: Помощник'),
      true,
      'старый тред → helper',
    );
    assert.equal(readThreadPersona(cwd, 'tp-legacy'), 'helper', 'роль зафиксирована как helper');
    assert.equal(loadChatHistory(cwd, 'tp-legacy').length, 4, 'история дописана, не переписана');
  });

  it('роль из sidecar, удалённая из реестра → helper, sidecar не перезаписан', async () => {
    fixThreadPersona(cwd, 'tp-retired', 'orchestrator');
    const before = readFileSync(personaPath('tp-retired'), 'utf8');
    const { llm, state } = fakeLlm([{ text: 'Ок.' }]);
    const events = await collect({ message: 'привет', threadId: 'tp-retired' }, { llm });
    assert.equal(events.some(e => e.type === 'error'), false, 'ход не упал');
    assert.equal(state.calls, 1);
    assert.equal(
      state.messages[0][0].content.includes('## Текущая роль: Помощник'),
      true,
      'fallback на helper',
    );
    assert.equal(readFileSync(personaPath('tp-retired'), 'utf8'), before, 'sidecar цел');
  });
});

describe('VL-283: роль треда в API (AC2)', () => {
  it('effectiveThreadPersona: пустой тред → null, начатый → зафиксированная роль', async () => {
    assert.equal(effectiveThreadPersona(cwd, 'tp-empty'), null, 'треда нет');
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'tp-api', persona: 'architect' }, { llm });
    assert.equal(effectiveThreadPersona(cwd, 'tp-api'), 'architect');
  });

  it('effectiveThreadPersona: старый тред без sidecar → helper', () => {
    seedHistory('tp-legacy2', [{ role: 'user', content: 'вопрос' }]);
    assert.equal(effectiveThreadPersona(cwd, 'tp-legacy2'), 'helper');
  });

  it('GET /api/chat/threads/:id отдаёт persona треда', async () => {
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'tp-http', persona: 'architect' }, { llm });

    const res = handleApi('GET', '/api/chat/threads/tp-http', null, cwd, '');
    assert.equal(res.status, 200);
    assert.equal(res.body.persona, 'architect', 'persona в ответе истории');
    assert.ok(Array.isArray(res.body.messages));

    // Тред без ходов и без sidecar → persona: null (клиент покажет пикер)
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    writeFileSync(join(dir, 'tp-nohops.jsonl'), '', 'utf-8');
    const empty = handleApi('GET', '/api/chat/threads/tp-nohops', null, cwd, '');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.persona, null);
  });
});
