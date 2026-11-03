/**
 * Тесты VL-314 — слэш-команды веб-чата (/help, /trim, /compact).
 *
 * Покрывают AC1–AC14:
 * - реестр команд и `GET /api/chat/commands` (без исполнения);
 * - `/help` собирается из реестра, неизвестная команда → ошибка со списком;
 * - парсер `/name args` (регистр, не-команды, `/` без имени);
 * - `/trim`: sidecar, границы, орфан-гард, сброс, неизменность jsonl;
 * - `/compact`: инкрементальность (prior-summary + новые), резолв шаблона,
 *   учёт usage без инкремента `requests`;
 * - отказ в approval-паузе;
 * - терпимый парсинг настроек сжатия.
 *
 * Без сети: LLM подменяется fakeLlm (паттерн chat.test.mjs), каталог —
 * mkdtemp (AGENTS.md: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, loadChatHistory } from '../../dist/web/chat.js';
import {
  CHAT_COMMANDS,
  commandsView,
  findCommand,
  helpText,
  parseCommand,
  unknownCommandText,
} from '../../dist/web/chat-commands.js';
import {
  buildWireMessages,
  estimateTokens,
  loadChatSummaryTemplate,
  loadCompaction,
  pickTrimIndex,
  resetCompaction,
  resolveChatCompaction,
  resolveTargetTokens,
  saveCompaction,
} from '../../dist/web/chat-compaction.js';
import { loadThreadUsage } from '../../dist/web/chat-usage.js';
import { handleApi } from '../../dist/web/api.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-cmd-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Cmd Test',
      task_prefix: 'cc',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
  // Цель сжатия — маленькая, чтобы тестовые истории заведомо её превышали
  // (иначе /trim и /compact отвечают «сжимать нечего» и проверять нечего).
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    JSON.stringify({ chat: { compact_target_tokens: 2000 } }),
    'utf8',
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Фейковый LLM: очередь ответов; usage можно задать явно. */
function fakeLlm(script) {
  const state = { calls: 0, messages: [] };
  const llm = {
    async streamChat(messages, _tools, opts) {
      state.messages.push(structuredClone(messages));
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      if (step instanceof Error) throw step;
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) opts?.onToken?.(t);
      return {
        text: step.text ?? tokens.join(''),
        toolCalls: step.toolCalls ?? [],
        usage: step.usage ?? zeroUsage(),
      };
    },
  };
  return { llm, state };
}

/** Сбор всех событий runChat. */
async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

/** Текст ответа из событий text. */
function textOf(events) {
  return events.filter(e => e.type === 'text').map(e => e.delta).join('');
}

/** Записать историю треда в jsonl (как это делает ход чата). */
function seedHistory(threadId, messages) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${threadId}.jsonl`),
    messages.map(m => JSON.stringify(m)).join('\n') + '\n',
    'utf8',
  );
}

/** Длинная история: 40 пар user/assistant — заведомо больше цели сжатия. */
function longHistory(pairs = 40) {
  const out = [];
  for (let i = 0; i < pairs; i++) {
    out.push({ role: 'user', content: `вопрос ${i} ` + 'текст '.repeat(60) });
    out.push({ role: 'assistant', content: `ответ ${i} ` + 'подробно '.repeat(60) });
  }
  return out;
}

describe('реестр команд и /help (AC1, AC2, AC3)', () => {
  it('реестр содержит help, trim, compact с usage и описанием', () => {
    const names = CHAT_COMMANDS.map(c => c.name);
    assert.deepEqual(names, ['help', 'trim', 'compact']);
    for (const c of CHAT_COMMANDS) {
      assert.ok(c.description.length > 0, `${c.name}: пустое описание`);
      assert.ok(c.usage.startsWith('/'), `${c.name}: usage без слэша`);
    }
  });

  it('commandsView отдаёт метаданные без обработчиков (сериализуемо)', () => {
    const view = commandsView();
    assert.equal(view.length, CHAT_COMMANDS.length);
    for (const c of view) {
      assert.equal(typeof c.name, 'string');
      assert.equal(typeof c.description, 'string');
      assert.equal(typeof c.usage, 'string');
      assert.ok(Array.isArray(c.examples));
      assert.equal(c.run, undefined);
    }
    // JSON-сериализация не теряет полей (обработчики не утекли)
    assert.equal(JSON.parse(JSON.stringify(view)).length, view.length);
  });

  it('helpText собирается из реестра: каждая команда и пример на месте', () => {
    const text = helpText();
    for (const c of CHAT_COMMANDS) {
      assert.ok(text.includes(c.usage), `нет usage ${c.usage}`);
      assert.ok(text.includes(c.description), `нет описания ${c.name}`);
      for (const ex of c.examples ?? []) assert.ok(text.includes(ex), `нет примера ${ex}`);
    }
  });

  it('helpText учитывает переданный реестр (не хардкод)', () => {
    const text = helpText([{ name: 'x', description: 'тестовая', usage: '/x' }]);
    assert.ok(text.includes('/x'));
    assert.ok(!text.includes('/compact'));
  });

  it('unknownCommandText перечисляет доступные команды', () => {
    const text = unknownCommandText('foo');
    assert.match(text, /Неизвестная команда: \/foo/);
    for (const c of CHAT_COMMANDS) assert.ok(text.includes(`/${c.name}`));
  });

  it('findCommand ищет без учёта регистра, неизвестная → null', () => {
    assert.equal(findCommand('HELP')?.name, 'help');
    assert.equal(findCommand('nope'), null);
  });

  it('GET /api/chat/commands отдаёт реестр без исполнения', async () => {
    const res = handleApi('GET', '/api/chat/commands', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.commands.length, CHAT_COMMANDS.length);
    assert.deepEqual(
      res.body.commands.map(c => c.name),
      CHAT_COMMANDS.map(c => c.name),
    );
  });
});

describe('парсер команд', () => {
  it('обычный текст — не команда', () => {
    assert.equal(parseCommand('привет'), null);
    assert.equal(parseCommand('текст /compact внутри'), null);
    assert.equal(parseCommand(''), null);
    assert.equal(parseCommand('/'), null);
    assert.equal(parseCommand('   '), null);
  });

  it('имя приводится к нижнему регистру, аргументы разбиваются', () => {
    assert.deepEqual(parseCommand('/HELP'), { name: 'help', args: [] });
    assert.deepEqual(parseCommand('  /trim off  '), { name: 'trim', args: ['off'] });
    assert.deepEqual(parseCommand('/compact reset extra'), { name: 'compact', args: ['reset', 'extra'] });
  });
});

describe('/help и неизвестная команда через runChat (AC2, AC3)', () => {
  it('/help отдаёт справку, в LLM не уходит', async () => {
    const { llm, state } = fakeLlm([{ text: 'не должно вызываться' }]);
    const events = await collect({ message: '/help', threadId: 'cmd-help' }, { llm });
    const text = textOf(events);
    assert.ok(text.includes('/trim'));
    assert.ok(text.includes('/compact'));
    assert.equal(state.calls, 0, 'LLM не должен вызываться для /help');
    assert.ok(events.some(e => e.type === 'done'));
    // Команда не попала в историю треда
    assert.equal(loadChatHistory(cwd, 'cmd-help').length, 0);
  });

  it('неизвестная команда → ошибка со списком, в LLM не уходит', async () => {
    const { llm, state } = fakeLlm([{ text: 'не должно вызываться' }]);
    const events = await collect({ message: '/foo', threadId: 'cmd-unknown' }, { llm });
    const text = textOf(events);
    assert.match(text, /Неизвестная команда: \/foo/);
    assert.ok(text.includes('/help'));
    assert.equal(state.calls, 0);
    assert.equal(loadChatHistory(cwd, 'cmd-unknown').length, 0);
  });
});

describe('/trim (AC5, AC11, AC13)', () => {
  it('пишет sidecar, jsonl не меняется, отчёт содержит номера', async () => {
    const threadId = 'trim-basic';
    const history = longHistory(40);
    seedHistory(threadId, history);
    const before = readFileSync(join(cwd, '.vibelog', 'chat-sessions', `${threadId}.jsonl`), 'utf8');

    const { llm, state } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/trim', threadId }, { llm });
    const text = textOf(events);
    assert.match(text, /Контекст сжат/);
    assert.equal(state.calls, 0, '/trim не должен звать LLM');

    const sidecar = loadCompaction(cwd, threadId);
    assert.ok(sidecar !== null);
    assert.equal(sidecar.method, 'trim');
    assert.ok(sidecar.fromIndex > 0);
    assert.ok(sidecar.fromIndex < history.length);

    // jsonl не тронут (AC5)
    const after = readFileSync(join(cwd, '.vibelog', 'chat-sessions', `${threadId}.jsonl`), 'utf8');
    assert.equal(after, before);
    assert.equal(loadChatHistory(cwd, threadId).length, history.length);
  });

  it('payload после /trim короче полной истории и валиден (орфан-гард)', async () => {
    const threadId = 'trim-wire';
    // Хвост начинается с tool-сообщения — орфан-гард должен сдвинуть точку
    const history = [
      { role: 'user', content: 'постановка' },
      { role: 'assistant', content: 'ок' },
      { role: 'user', content: 'ещё' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', name: 'backlog_search', arguments: {} }] },
      { role: 'tool', tool_call_id: 't1', content: 'результат' },
      { role: 'assistant', content: 'готово' },
    ];
    seedHistory(threadId, history);
    saveCompaction(cwd, threadId, {
      fromIndex: 4, // указывает ровно на tool-сообщение
      method: 'trim',
      compactedAt: new Date().toISOString(),
    });
    const wire = buildWireMessages(history, loadCompaction(cwd, threadId));
    assert.ok(wire.length < history.length);
    // Хвост не начинается с tool (AC13)
    const firstUser = wire.findIndex(m => m.role === 'user');
    assert.notEqual(wire[firstUser + 1]?.role, 'tool');
  });

  it('/trim off удаляет sidecar, payload снова полный (AC11)', async () => {
    const threadId = 'trim-off';
    seedHistory(threadId, longHistory(20));
    saveCompaction(cwd, threadId, { fromIndex: 10, method: 'trim', compactedAt: new Date().toISOString() });
    assert.ok(loadCompaction(cwd, threadId) !== null);

    const { llm } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/trim off', threadId }, { llm });
    assert.match(textOf(events), /Сжатие сброшено/);
    assert.equal(loadCompaction(cwd, threadId), null);
    const history = loadChatHistory(cwd, threadId);
    assert.equal(buildWireMessages(history, loadCompaction(cwd, threadId)), history);
  });

  it('сброс без сжатия — понятный ответ, не ошибка', async () => {
    const { llm } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/trim off', threadId: 'trim-nothing' }, { llm });
    assert.match(textOf(events), /сбрасывать нечего/);
  });

  it('пустой тред — сжимать нечего', async () => {
    const { llm } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/trim', threadId: 'trim-empty' }, { llm });
    assert.match(textOf(events), /Тред пуст/);
  });

  it('история в пределах цели — сжатие не применяется', async () => {
    const threadId = 'trim-small';
    seedHistory(threadId, [
      { role: 'user', content: 'коротко' },
      { role: 'assistant', content: 'ответ' },
    ]);
    const { llm } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/trim', threadId }, { llm });
    assert.match(textOf(events), /Сжимать нечего/);
    assert.equal(loadCompaction(cwd, threadId), null);
  });
});

describe('/compact (AC6, AC7, AC12)', () => {
  it('инкрементально: второй вызов получает prior-summary и только новые сообщения', async () => {
    const threadId = 'compact-inc';
    seedHistory(threadId, longHistory(40));
    const { llm, state } = fakeLlm([{ text: '## Задача\nпервое саммари' }, { text: '## Задача\nвторое саммари' }]);

    const first = await collect({ message: '/compact', threadId }, { llm });
    assert.match(textOf(first), /LLM-саммари/);
    const firstState = loadCompaction(cwd, threadId);
    assert.equal(firstState.method, 'summary');
    assert.equal(firstState.summary, '## Задача\nпервое саммари');
    assert.equal(state.calls, 1);

    // Добавляем новые сообщения после точки сжатия
    const history = loadChatHistory(cwd, threadId);
    const extended = [
      ...history,
      { role: 'user', content: 'новый вопрос ' + 'текст '.repeat(60) },
      { role: 'assistant', content: 'новый ответ ' + 'подробно '.repeat(60) },
    ];
    seedHistory(threadId, extended);

    const second = await collect({ message: '/compact', threadId }, { llm });
    assert.match(textOf(second), /второе саммари/);
    assert.equal(state.calls, 2);
    // Промпт второго вызова содержит предыдущее саммари (инкрементальность)
    const prompt = state.messages[1][0].content;
    assert.ok(prompt.includes('первое саммари'), 'нет prior-summary в промпте');
    // Инкрементальность: пересказываются только сообщения, выпавшие из хвоста
    // (от прежней точки до новой), а не вся история заново.
    const secondState = loadCompaction(cwd, threadId);
    assert.ok(secondState.fromIndex >= firstState.fromIndex);
    const fellOut = extended[firstState.fromIndex];
    assert.ok(
      prompt.includes(fellOut.content.slice(0, 20)),
      'нет сообщений, выпавших из хвоста',
    );
    // Новые сообщения остаются в хвосте дословно — их в промпте саммари нет
    assert.ok(!prompt.includes('новый вопрос'), 'новые сообщения не должны пересказываться');
    // Саммари переписано, а не накоплено
    assert.equal(secondState.summary, '## Задача\nвторое саммари');
    assert.ok(!secondState.summary.includes('первое саммари'));
  });

  it('usage саммари учитывается в панели, но requests не растёт (AC12)', async () => {
    const threadId = 'compact-usage';
    seedHistory(threadId, longHistory(40));
    const usage = {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      total_tokens: 1200,
      reasoning_tokens: 0,
    };
    const { llm } = fakeLlm([{ text: 'саммари', usage }]);
    const events = await collect({ message: '/compact', threadId }, { llm });
    // Событие usage ушло клиенту
    const usageEvent = events.find(e => e.type === 'usage');
    assert.ok(usageEvent, 'нет события usage');
    assert.equal(usageEvent.usage.input, 1000);
    assert.equal(usageEvent.usage.output, 200);
    // requests не инкрементится вызовом саммари
    const stored = loadThreadUsage(cwd, threadId);
    assert.equal(stored.byModel.unknown.requests, 0);
    assert.equal(stored.byModel.unknown.input, 1000);
  });

  it('ошибка LLM → понятный ответ, sidecar не пишется', async () => {
    const threadId = 'compact-fail';
    seedHistory(threadId, longHistory(40));
    const { llm } = fakeLlm([new Error('сеть недоступна')]);
    const events = await collect({ message: '/compact', threadId }, { llm });
    assert.match(textOf(events), /Не удалось получить саммари: сеть недоступна/);
    assert.equal(loadCompaction(cwd, threadId), null);
  });

  it('пустое саммари не применяется', async () => {
    const threadId = 'compact-empty';
    seedHistory(threadId, longHistory(40));
    const { llm } = fakeLlm([{ text: '   ' }]);
    const events = await collect({ message: '/compact', threadId }, { llm });
    assert.match(textOf(events), /пустое саммари/);
    assert.equal(loadCompaction(cwd, threadId), null);
  });

  it('/compact reset удаляет sidecar (AC11)', async () => {
    const threadId = 'compact-reset';
    seedHistory(threadId, longHistory(20));
    saveCompaction(cwd, threadId, {
      fromIndex: 5,
      method: 'summary',
      summary: 'старое',
      compactedAt: new Date().toISOString(),
    });
    const { llm } = fakeLlm([{ text: 'ok' }]);
    const events = await collect({ message: '/compact reset', threadId }, { llm });
    assert.match(textOf(events), /Сжатие сброшено/);
    assert.equal(loadCompaction(cwd, threadId), null);
  });
});

describe('резолв шаблона саммари (AC7)', () => {
  it('встроенный шаблон читается из templates/prompts/chat-summary.md', () => {
    const text = loadChatSummaryTemplate(cwd);
    assert.ok(text.includes('## Задача'));
    assert.ok(text.includes('## Следующий шаг'));
  });

  it('переопределение проекта приоритетнее встроенного', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-summary-'));
    try {
      mkdirSync(join(dir, '.vibelog', 'prompts'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'prompts', 'chat-summary.md'), 'СВОЙ ШАБЛОН', 'utf8');
      assert.equal(loadChatSummaryTemplate(dir), 'СВОЙ ШАБЛОН');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('отказ в approval-паузе (AC4)', () => {
  it('команда при висящем tool_calls → отказ с причиной, LLM не зовётся', async () => {
    const threadId = 'cmd-approval';
    seedHistory(threadId, [
      { role: 'user', content: 'создай задачу' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', name: 'backlog_create_task', arguments: { title: 'X' } }],
      },
    ]);
    const { llm, state } = fakeLlm([{ text: 'не должно вызываться' }]);
    const events = await collect({ message: '/trim', threadId }, { llm });
    const text = textOf(events);
    assert.match(text, /Команда недоступна/);
    assert.match(text, /подтверждени/i);
    assert.equal(state.calls, 0);
    assert.equal(loadCompaction(cwd, threadId), null);
  });
});

describe('настройки сжатия (AC8, AC9)', () => {
  it('без секции chat — дефолты без ошибок', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-cfg-'));
    try {
      const { settings, errors } = resolveChatCompaction(dir);
      assert.deepEqual(errors, []);
      assert.equal(settings.enabled, true);
      assert.equal(settings.targetPercent, 5);
      assert.equal(settings.targetTokens, 50_000);
      assert.equal(settings.keepTail, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('валидные значения читаются', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-cfg-'));
    try {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(
        join(dir, '.vibelog', 'settings.json'),
        JSON.stringify({
          chat: {
            compact_enabled: false,
            compact_target_percent: 12,
            compact_target_tokens: 1234,
            compact_keep_tail: 3,
          },
        }),
        'utf8',
      );
      const { settings, errors } = resolveChatCompaction(dir);
      assert.deepEqual(errors, []);
      assert.equal(settings.enabled, false);
      assert.equal(settings.targetPercent, 12);
      assert.equal(settings.targetTokens, 1234);
      assert.equal(settings.keepTail, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('битые значения → дефолт + сообщение, без падения', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-cfg-'));
    try {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(
        join(dir, '.vibelog', 'settings.json'),
        JSON.stringify({
          chat: {
            compact_enabled: 'да',
            compact_target_percent: 0,
            compact_target_tokens: -5,
            compact_keep_tail: 1.5,
          },
        }),
        'utf8',
      );
      const { settings, errors } = resolveChatCompaction(dir);
      assert.equal(errors.length, 4);
      assert.equal(settings.enabled, true);
      assert.equal(settings.targetPercent, 5);
      assert.equal(settings.targetTokens, 50_000);
      assert.equal(settings.keepTail, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compact_enabled=false → команды отказывают', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-chat-cfg-'));
    try {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(
        join(dir, '.vibelog', 'settings.json'),
        JSON.stringify({ chat: { compact_enabled: false } }),
        'utf8',
      );
      const { llm } = fakeLlm([{ text: 'ok' }]);
      const events = [];
      for await (const ev of runChat({ message: '/trim', threadId: 'cfg-off' }, dir, { llm })) events.push(ev);
      assert.match(textOf(events), /Сжатие контекста выключено/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveTargetTokens: процент окна либо fallback (AC8)', () => {
    assert.equal(resolveTargetTokens(1_000_000, 5, 50_000), 50_000);
    assert.equal(resolveTargetTokens(undefined, 5, 50_000), 50_000);
    assert.equal(resolveTargetTokens(0, 5, 50_000), 50_000);
    assert.equal(resolveTargetTokens(200_000, 10, 50_000), 20_000);
    // Процент ограничен 1..100
    assert.equal(resolveTargetTokens(1000, 0, 50_000), 10);
    assert.equal(resolveTargetTokens(1000, 500, 50_000), 1000);
  });
});

describe('утилиты сжатия', () => {
  it('estimateTokens растёт с объёмом и учитывает tool_calls', () => {
    const small = estimateTokens([{ role: 'user', content: 'привет' }]);
    const big = estimateTokens([{ role: 'user', content: 'привет '.repeat(100) }]);
    assert.ok(big > small);
    const withCalls = estimateTokens([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'a', name: 'backlog_search', arguments: { query: 'x'.repeat(400) } }],
      },
    ]);
    assert.ok(withCalls > 50);
  });

  it('pickTrimIndex: вся история в бюджете → messages.length', () => {
    const msgs = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    assert.equal(pickTrimIndex(msgs, 1_000_000), msgs.length);
    assert.equal(pickTrimIndex([], 100), 0);
  });

  it('pickTrimIndex: маленькая цель → точка ближе к концу', () => {
    const msgs = longHistory(20);
    const idx = pickTrimIndex(msgs, 100);
    assert.ok(idx > 0 && idx < msgs.length);
  });

  it('buildWireMessages без точки возвращает историю как есть', () => {
    const msgs = longHistory(3);
    assert.equal(buildWireMessages(msgs, null), msgs);
  });

  it('buildWireMessages с саммари подменяет первый user', () => {
    const msgs = longHistory(10);
    const wire = buildWireMessages(msgs, {
      fromIndex: 10,
      method: 'summary',
      summary: 'краткое содержание',
      compactedAt: new Date().toISOString(),
    });
    const firstUser = wire.find(m => m.role === 'user');
    assert.ok(firstUser.content.includes('краткое содержание'));
    assert.ok(firstUser.content.includes('[Сжатая история диалога]'));
  });

  it('resetCompaction: false, если сбрасывать нечего', () => {
    assert.equal(resetCompaction(cwd, 'no-such-thread'), false);
  });

  it('loadCompaction: битый sidecar → null', () => {
    const threadId = 'broken-sidecar';
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${threadId}.compaction.json`), '{ битый', 'utf8');
    assert.equal(loadCompaction(cwd, threadId), null);
  });

  it('loadCompaction: невалидный threadId → null', () => {
    assert.equal(loadCompaction(cwd, '../etc/passwd'), null);
  });
});

describe('плашка сжатия в клиенте (AC10)', () => {
  it('thread.tsx рендерит плашку по данным GET /api/chat/threads/:id', () => {
    const src = readFileSync(new URL('../../web/src/components/chat/thread.tsx', import.meta.url), 'utf8');
    // Поле в ответе API и в состоянии загрузки
    assert.match(src, /compaction\?: CompactionState \| null/);
    assert.match(src, /compaction: data\.compaction \?\? null/);
    // Компонент плашки и её текст
    assert.match(src, /function CompactionBanner\(/);
    assert.match(src, /Контекст сжат: в модель уходит с \{compaction\.fromIndex \+ 1\}-го сообщения/);
    // Плашка внутри непустого треда (полная история в ленте остаётся)
    assert.match(src, /<CompactionBanner compaction=\{compaction \?\? null\} \/>/);
  });
});

describe('payload хода учитывает точку сжатия (AC5, AC13)', () => {
  it('после /trim в модель уходит усечённая история, jsonl полон', async () => {
    const threadId = 'wire-trim';
    const history = longHistory(40);
    seedHistory(threadId, history);
    const { llm: trimLlm } = fakeLlm([{ text: 'ok' }]);
    await collect({ message: '/trim', threadId }, { llm: trimLlm });
    const sidecar = loadCompaction(cwd, threadId);
    assert.ok(sidecar !== null);

    const { llm, state } = fakeLlm([{ text: 'ответ' }]);
    await collect({ message: 'продолжим', threadId }, { llm });
    const sent = state.messages[0];
    // system + усечённый payload: меньше полной истории + 1
    assert.ok(sent.length < history.length + 1, `payload не усечён: ${sent.length}`);
    // jsonl полон (AC5)
    assert.equal(loadChatHistory(cwd, threadId).length, history.length + 2);
  });
});
