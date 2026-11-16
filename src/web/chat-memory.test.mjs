/**
 * Тесты VL-402 — запись памяти персоны веб-чата.
 *
 * Память (VL-401) читается и подставляется в системный промпт; эта задача
 * добавляет ЗАПИСЬ: инструмент `memory_remember` (модель), команду `/memory`
 * (пользователь) и отмену записи из ленты чата.
 *
 * Покрыто:
 * - инструмент доступен только в веб-чате (в MCP-реестре его нет — headless
 *   фазы и TUI его не видят, как `ask_user` VL-330);
 * - классификация: `memory_remember` НЕ write (иначе Allow/Deny на каждую
 *   запись) — решение закреплено тестом, чтобы правка классификатора не
 *   сломала затею молча;
 * - валидация: пустой текст, дубль, превышение лимита → отказ, файл не меняется;
 * - формат записи `- <текст>. (YYYY-MM-DD)`;
 * - событие `memory` в SSE и отмена записи (файл + sidecar треда);
 * - `/memory` все подкоманды, включая двухшаговый `clear`;
 * - изоляция по персонам: пишем только в файл роли треда.
 *
 * Каталог — mkdtemp (правило AGENTS.md, lesson-89).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat } from '../../dist/web/chat.js';
import { chatToolDefs, isWriteOperation } from '../../dist/web/tool-policy.js';
import { listTools } from '../../dist/mcp/tools.js';
import { handleApi } from '../../dist/web/api.js';
import { CHAT_COMMANDS, commandsView, findCommand } from '../../dist/web/chat-commands.js';
import {
  appendMemoryEntry,
  clearMemory,
  readMemoryEntries,
  removeMemoryEntry,
} from '../../dist/core/persona-memory.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

/** Минимальный backlog-проект (конфиг со statuses нужен валидации ролей). */
function seedProject() {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Memory Test',
      task_prefix: 'cm',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
}

/** Запись settings.json (секции chat_personas / persona_memory). */
function writeSettings(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** Проектный промпт роли (чтобы не зависеть от встроенных шаблонов). */
function writeProjectPrompt(name, text) {
  const dir = join(cwd, '.vibelog', 'prompts', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), text, 'utf-8');
}

/** Содержимое файла памяти роли. */
function memoryFile(name) {
  return join(cwd, '.vibelog', 'prompts', 'personas', `${name}.memory.md`);
}

/** Фейковый LLM: очередь ответов {text?, toolCalls?} (паттерн chat.test.mjs). */
function fakeLlm(script) {
  const state = { calls: 0, messages: [] };
  const llm = {
    async streamChat(messages, _tools, opts) {
      state.messages.push(structuredClone(messages));
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) opts?.onToken?.(t);
      return {
        text: step.text ?? tokens.join(''),
        toolCalls: step.toolCalls ?? [],
        usage: zeroUsage(),
      };
    },
  };
  return { llm, state };
}

/** Сбор всех событий runChat в массив. */
async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-memory-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  seedProject();
  writeProjectPrompt('helper', 'Ты — помощник проекта.');
  writeProjectPrompt('architect', 'Ты — архитектор проекта.');
});

describe('VL-402 — доступность инструмента и классификация', () => {
  it('AC1: memory_remember есть в инструментах веб-чата, когда известна роль', () => {
    const defs = chatToolDefs(cwd, { id: 'helper', label: 'Помощник', prompt: 'helper' });
    const def = defs.find(d => d.name === 'memory_remember');
    assert.ok(def, 'memory_remember объявлен в chatToolDefs');
    assert.equal(def.inputSchema.properties.text.type, 'string');
    assert.deepEqual(def.inputSchema.required, ['text']);
    assert.equal(typeof def.handler, 'function', 'handler присутствует');
  });

  it('AC1: без роли инструмент не добавляется (headless-путь)', () => {
    assert.ok(!chatToolDefs(cwd).some(d => d.name === 'memory_remember'));
  });

  it('AC1: memory_remember отсутствует в MCP-реестре (TUI и фазы его не видят)', () => {
    assert.ok(!listTools().some(t => t.name === 'memory_remember'));
  });

  it('AC1/риск R2: memory_remember НЕ write — иначе Allow/Deny на каждую запись', () => {
    assert.equal(isWriteOperation('memory_remember'), false);
    // Контрольная точка: write_file по-прежнему требует подтверждения
    assert.equal(isWriteOperation('write_file'), true);
  });
});

describe('VL-402 — валидация записи (ядро)', () => {
  it('AC3: формат строки — «- <текст>. (YYYY-MM-DD)»', () => {
    const res = appendMemoryEntry(cwd, 'helper', 'Не использовать англицизмы', new Date(2026, 10, 10));
    assert.equal(res.ok, true);
    const raw = readFileSync(memoryFile('helper'), 'utf8');
    assert.equal(raw, '- Не использовать англицизмы. (2026-11-10)\n');
  });

  it('AC3: точка не дублируется, если текст уже кончается на .!?', () => {
    appendMemoryEntry(cwd, 'helper', 'Отвечай кратко!', new Date(2026, 10, 10));
    assert.equal(readFileSync(memoryFile('helper'), 'utf8'), '- Отвечай кратко! (2026-11-10)\n');
  });

  it('AC1: пустой текст → отказ, файл не создаётся', () => {
    const res = appendMemoryEntry(cwd, 'helper', '   ');
    assert.equal(res.ok, false);
    assert.match(res.reason, /пуст/);
    assert.equal(existsSync(memoryFile('helper')), false);
  });

  it('AC1: дубль (без учёта регистра и пунктуации) → отказ, файл не меняется', () => {
    appendMemoryEntry(cwd, 'helper', 'Не использовать англицизмы', new Date(2026, 10, 10));
    const before = readFileSync(memoryFile('helper'), 'utf8');
    const res = appendMemoryEntry(cwd, 'helper', 'не использовать англицизмы.');
    assert.equal(res.ok, false);
    assert.match(res.reason, /уже есть/);
    assert.equal(readFileSync(memoryFile('helper'), 'utf8'), before);
  });

  it('AC3: превышение лимита → отказ с размером и лимитом, файл не меняется', () => {
    writeSettings({ persona_memory: { max_chars: 60 } });
    appendMemoryEntry(cwd, 'helper', 'Первая заметка о пользователе', new Date(2026, 10, 10));
    const before = readFileSync(memoryFile('helper'), 'utf8');
    const res = appendMemoryEntry(cwd, 'helper', 'Вторая заметка о пользователе подлиннее');
    assert.equal(res.ok, false);
    assert.match(res.reason, /60/);
    assert.match(res.reason, /заполнена/);
    assert.equal(readFileSync(memoryFile('helper'), 'utf8'), before);
  });

  it('AC4: удаление по номеру с перенумерацией', () => {
    appendMemoryEntry(cwd, 'helper', 'Первая', new Date(2026, 10, 10));
    appendMemoryEntry(cwd, 'helper', 'Вторая', new Date(2026, 10, 10));
    const removed = removeMemoryEntry(cwd, 'helper', 1);
    assert.equal(removed.ok, true);
    const state = readMemoryEntries(cwd, 'helper');
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].index, 1);
    assert.equal(state.entries[0].text, 'Вторая.');
  });

  it('AC4: удаление несуществующего номера → отказ', () => {
    const res = removeMemoryEntry(cwd, 'helper', 5);
    assert.equal(res.ok, false);
    assert.match(res.reason, /пуста/);
  });

  it('AC4: clearMemory очищает файл', () => {
    appendMemoryEntry(cwd, 'helper', 'Заметка', new Date(2026, 10, 10));
    const res = clearMemory(cwd, 'helper');
    assert.equal(res.removed, 1);
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 0);
  });
});

describe('VL-402 — инструмент в ходе чата и событие memory', () => {
  it('AC2: успешная запись → событие memory с текстом и ролью', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-mem-1', name: 'memory_remember', arguments: { text: 'Не пиши англицизмами' } }] },
      { text: 'Запомнил.' },
    ]);
    const events = await collect({ message: 'не пиши англицизмами', threadId: 'mem-event' }, { llm });
    const memory = events.find(e => e.type === 'memory');
    assert.ok(memory, 'событие memory должно прийти');
    assert.equal(memory.entry.text, 'Не пиши англицизмами');
    assert.equal(memory.personaId, 'helper');
    assert.match(memory.entry.date, /^\d{4}-\d{2}-\d{2}$/);
    // Запись реально в файле роли треда
    assert.match(readFileSync(memoryFile('helper'), 'utf8'), /Не пиши англицизмами/);
    // Allow/Deny не спрашивали (AC2: запись не блокирует разговор)
    assert.ok(!events.some(e => e.type === 'approval'), 'карточки подтверждения нет');
  });

  it('AC1: пустой текст → ошибка tool-результатом, событие memory не шлётся', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-mem-2', name: 'memory_remember', arguments: { text: '  ' } }] },
      { text: 'Ок.' },
    ]);
    const events = await collect({ message: 'запомни', threadId: 'mem-empty' }, { llm });
    assert.ok(!events.some(e => e.type === 'memory'), 'события нет');
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-mem-2');
    assert.ok(end, 'tool_end пришёл');
    assert.match(end.result, /"ok":false/);
    assert.equal(existsSync(memoryFile('helper')), false);
  });

  it('AC6: запись идёт в память роли ТРЕДА, а не в чужую', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-mem-3', name: 'memory_remember', arguments: { text: 'Только для архитектора' } }] },
      { text: 'Ок.' },
    ]);
    await collect({ message: 'запомни', threadId: 'mem-arch', persona: 'architect' }, { llm });
    assert.match(readFileSync(memoryFile('architect'), 'utf8'), /Только для архитектора/);
    assert.equal(existsSync(memoryFile('helper')), false, 'память помощника не тронута');
  });
});

describe('VL-402 — команда /memory', () => {
  it('AC4: /memory без аргументов показывает записи, размер и лимит', async () => {
    appendMemoryEntry(cwd, 'helper', 'Отвечай кратко', new Date(2026, 10, 10));
    const { llm } = fakeLlm([{ text: 'не используется' }]);
    const events = await collect({ message: '/memory', threadId: 'cmd-list' }, { llm });
    const text = events.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(text, /Память роли/);
    assert.match(text, /1\. Отвечай кратко/);
    assert.match(text, /из 2500 символов/);
  });

  it('AC4: /memory add добавляет запись', async () => {
    const { llm } = fakeLlm([{ text: 'не используется' }]);
    const events = await collect({ message: '/memory add Не пиши длинно', threadId: 'cmd-add' }, { llm });
    const text = events.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(text, /Запомнил: Не пиши длинно/);
    assert.match(readFileSync(memoryFile('helper'), 'utf8'), /Не пиши длинно/);
  });

  it('AC4: /memory remove <N> удаляет запись', async () => {
    appendMemoryEntry(cwd, 'helper', 'Первая', new Date(2026, 10, 10));
    appendMemoryEntry(cwd, 'helper', 'Вторая', new Date(2026, 10, 10));
    const { llm } = fakeLlm([{ text: 'не используется' }]);
    const events = await collect({ message: '/memory remove 1', threadId: 'cmd-remove' }, { llm });
    const text = events.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(text, /Удалено: Первая/);
    assert.doesNotMatch(readFileSync(memoryFile('helper'), 'utf8'), /Первая/);
  });

  it('AC4: /memory clear требует подтверждения, /memory clear yes очищает', async () => {
    appendMemoryEntry(cwd, 'helper', 'Заметка', new Date(2026, 10, 10));
    const { llm } = fakeLlm([{ text: 'не используется' }]);
    const first = await collect({ message: '/memory clear', threadId: 'cmd-clear' }, { llm });
    const firstText = first.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(firstText, /Подтвердите: `\/memory clear yes`/);
    assert.match(readFileSync(memoryFile('helper'), 'utf8'), /Заметка/, 'без подтверждения не стёрто');

    const second = await collect({ message: '/memory clear yes', threadId: 'cmd-clear' }, { llm });
    const secondText = second.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(secondText, /Память очищена/);
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 0);
  });

  it('AC4: /memory в реестре команд и в справке', () => {
    assert.ok(findCommand('memory'), 'команда зарегистрирована');
    const view = commandsView().find(c => c.name === 'memory');
    assert.ok(view, 'команда видна в GET /api/chat/commands');
    assert.match(view.usage, /\/memory/);
    assert.ok(CHAT_COMMANDS.some(c => c.name === 'memory'));
  });

  it('AC5: /memory в approval-паузе отказывает с причиной', async () => {
    // Первый ход оставляет висящий write-вызов (approval-пауза)
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-w-1', name: 'write_file', arguments: { path: 'a.txt', content: 'x' } }] },
    ]);
    const first = await collect({ message: 'запиши файл', threadId: 'cmd-pause' }, { llm });
    assert.ok(first.some(e => e.type === 'approval'), 'ход на паузе подтверждения');

    const second = await collect({ message: '/memory', threadId: 'cmd-pause' }, { llm });
    const text = second.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(text, /Команда недоступна/);
    assert.match(text, /подтверждени/);
  });
});

describe('VL-402 — отмена записи из ленты (AC2)', () => {
  it('AC2: POST /memory/remove удаляет запись и пишет sidecar треда', async () => {
    appendMemoryEntry(cwd, 'helper', 'Убрать меня', new Date(2026, 10, 10));
    // Роль треда фиксируется первым ходом
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'mem-remove' }, { llm });

    const res = handleApi(
      'POST',
      '/api/chat/threads/mem-remove/memory/remove',
      { text: 'Убрать меня' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.removed.text, 'Убрать меня.');
    assert.doesNotMatch(readFileSync(memoryFile('helper'), 'utf8'), /Убрать меня/);

    // После F5 клиент узнаёт об отмене из истории треда
    const history = handleApi('GET', '/api/chat/threads/mem-remove', null, cwd);
    assert.equal(history.status, 200);
    assert.ok(
      history.body.memoryRemovals.some(r => r.text === 'Убрать меня.'),
      'отмена видна в ответе истории',
    );
  });

  it('AC2: повторная отмена уже удалённой записи → 404 с понятной ошибкой', () => {
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    return collect({ message: 'привет', threadId: 'mem-remove-2' }, { llm }).then(() => {
      const res = handleApi(
        'POST',
        '/api/chat/threads/mem-remove-2/memory/remove',
        { text: 'Нет такой' },
        cwd,
      );
      assert.equal(res.status, 404);
      assert.match(res.body.error, /не найдена/);
    });
  });

  it('AC2: удаление по тексту не сносит соседнюю запись при сдвиге номеров', () => {
    appendMemoryEntry(cwd, 'helper', 'Первая', new Date(2026, 10, 10));
    appendMemoryEntry(cwd, 'helper', 'Вторая', new Date(2026, 10, 10));
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    return collect({ message: 'привет', threadId: 'mem-shift' }, { llm }).then(() => {
      // Убираем первую по тексту, затем вторую по тексту же — номера сдвинулись
      handleApi('POST', '/api/chat/threads/mem-shift/memory/remove', { text: 'Первая' }, cwd);
      const res = handleApi('POST', '/api/chat/threads/mem-shift/memory/remove', { text: 'Вторая' }, cwd);
      assert.equal(res.status, 200);
      assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 0);
    });
  });
});

describe('VL-419 — инструмент memory_forget и выход из переполнения', () => {
  const role = { id: 'helper', label: 'Помощник', prompt: 'helper' };

  /** Handler инструмента из chatToolDefs (тот же путь, что у модели в чате). */
  function toolHandler(name) {
    const def = chatToolDefs(cwd, role).find(d => d.name === name);
    assert.ok(def, `${name} объявлен в chatToolDefs`);
    return def.handler;
  }

  it('AC9: memory_forget есть в чатах при известной роли, нет без роли и в MCP', () => {
    assert.ok(chatToolDefs(cwd, role).some(d => d.name === 'memory_forget'));
    assert.ok(!chatToolDefs(cwd).some(d => d.name === 'memory_forget'), 'без роли — headless-путь');
    assert.ok(!listTools().some(t => t.name === 'memory_forget'), 'нет в MCP-реестре/TOOL_KINDS');
  });

  it('AC10: memory_forget НЕ write (REVERSIBLE_WRITE_TOOLS) — без Allow/Deny', () => {
    assert.equal(isWriteOperation('memory_forget'), false);
    assert.equal(isWriteOperation('memory_forget', { index: 1 }), false);
    // Решение закреплено тестом: классификатор вернёт инструмент в write — упадёт
    assert.equal(isWriteOperation('write_file'), true, 'write_file по-прежнему подтверждается');
  });

  it('AC9: {index} удаляет нужную запись, chars уменьшается', async () => {
    appendMemoryEntry(cwd, 'helper', 'Первая заметка', new Date(2026, 10, 10));
    appendMemoryEntry(cwd, 'helper', 'Вторая заметка', new Date(2026, 10, 10));
    const before = readMemoryEntries(cwd, 'helper');
    const res = JSON.parse(await toolHandler('memory_forget')({ index: 1 }));
    assert.equal(res.ok, true);
    assert.deepEqual(res.applied, ['memory']);
    assert.equal(res.removed.index, 1);
    assert.match(res.removed.text, /Первая заметка/);
    const after = readMemoryEntries(cwd, 'helper');
    assert.equal(after.entries.length, 1);
    assert.equal(after.entries[0].text, 'Вторая заметка.', 'сдвиг номеров корректен');
    assert.ok(res.chars < before.chars, 'chars уменьшился');
    assert.equal(res.limit, before.limit);
  });

  it('AC9: {text} находит по нормализованному совпадению (регистр/пунктуация)', async () => {
    appendMemoryEntry(cwd, 'helper', 'Не пиши длинно', new Date(2026, 10, 10));
    const res = JSON.parse(await toolHandler('memory_forget')({ text: 'не пиши длинно.' }));
    assert.equal(res.ok, true);
    assert.match(res.removed.text, /Не пиши длинно/);
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 0);
  });

  it('AC9: оба аргумента / ни одного → отказ, файл не менялся', async () => {
    appendMemoryEntry(cwd, 'helper', 'Запись', new Date(2026, 10, 10));
    const handler = toolHandler('memory_forget');
    const both = JSON.parse(await handler({ index: 1, text: 'Запись' }));
    assert.equal(both.ok, false);
    assert.match(both.error, /РОВНО один/);
    const none = JSON.parse(await handler({}));
    assert.equal(none.ok, false);
    assert.match(none.error, /нужен один аргумент/);
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 1, 'файл не менялся');
  });

  it('AC9: index вне диапазона → отказ со списком записей (текст — тоже)', async () => {
    appendMemoryEntry(cwd, 'helper', 'Одна запись', new Date(2026, 10, 10));
    const handler = toolHandler('memory_forget');
    const res = JSON.parse(await handler({ index: 5 }));
    assert.equal(res.ok, false);
    assert.match(res.error, /№5 нет/);
    assert.ok(Array.isArray(res.entries), 'список записей для исправления');
    assert.equal(res.entries[0].index, 1);
    assert.match(res.entries[0].text, /Одна запись/);
    const byText = JSON.parse(await handler({ text: 'нет такого' }));
    assert.equal(byText.ok, false);
    assert.ok(Array.isArray(byText.entries), 'по тексту тоже приходит список');
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 1, 'файл не менялся');
  });

  it('AC11: memory_remember при переполнении возвращает hint с memory_forget', async () => {
    writeSettings({ persona_memory: { max_chars: 60 } });
    appendMemoryEntry(cwd, 'helper', 'Первая заметка о пользователе', new Date(2026, 10, 10));
    const res = JSON.parse(
      await toolHandler('memory_remember')({ text: 'Вторая заметка о пользователе подлиннее' }),
    );
    assert.equal(res.ok, false);
    assert.equal(typeof res.chars, 'number', 'текущий размер в ответе');
    assert.equal(res.limit, 60, 'лимит в ответе');
    assert.match(res.hint, /memory_forget/);
    assert.match(res.hint, /\/memory remove/);
    // Дубль/пустой текст hint'а не получают — это не переполнение
    writeSettings({});
    const dup = JSON.parse(
      await toolHandler('memory_remember')({ text: 'Первая заметка о пользователе' }),
    );
    assert.equal(dup.ok, false);
    assert.equal(dup.hint, undefined);
  });

  it('AC9/AC10: вызов memory_forget в ходе чата — без карточки Allow/Deny', async () => {
    appendMemoryEntry(cwd, 'helper', 'Устаревшая запись', new Date(2026, 10, 10));
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-forget-1', name: 'memory_forget', arguments: { index: 1 } }] },
      { text: 'Готово.' },
    ]);
    const events = await collect({ message: 'почисти память', threadId: 'forget-run' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-forget-1');
    assert.ok(end, 'tool_end пришёл');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true);
    assert.ok(!events.some(e => e.type === 'approval'), 'Allow/Deny не спрашивали');
    assert.equal(readMemoryEntries(cwd, 'helper').entries.length, 0);
  });
});
