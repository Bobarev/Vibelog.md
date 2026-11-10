/**
 * Тесты VL-409 — субагенты-персоны: инструмент `ask_persona`.
 *
 * Идея: субагент — не роль фазы, а ПЕРСОНА, вызываемая из персоны. Помощник
 * зовёт «Психолога» и получает его мнение как результат инструмента; сервер
 * делает отдельный запрос к модели с промптом/памятью/уроками консультанта.
 *
 * Покрыто (AC1–AC14):
 * - инструмент только в веб-чате (в MCP-реестре его нет — headless/TUI не видят);
 * - классификация: `ask_persona` НЕ write (иначе Allow/Deny на консультацию);
 * - валидация аргументов: пустой вопрос, роль = текущая, лимит вызовов;
 * - неизвестная роль: `error` (дефолт) — ошибка + список ролей, `skip` — нейтрально;
 * - глубина 1: консультанту НЕ передаётся `ask_persona` и `memory_remember`;
 * - allow_tools консультанта: по умолчанию только чтение, write отсекается;
 * - консультация не пишет в память консультанта;
 * - таймаут не роняет ход;
 * - настройки секции `subagents` и битые значения;
 * - учёт токенов консультации с пометкой роли;
 * - событие `subagent` в ленте.
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
import { readSubagentSettings, SUBAGENT_DEFAULTS, DEFAULT_CONSULTANT_TOOLS } from '../../dist/core/subagents.js';
import { loadSubagentUsage } from '../../dist/web/chat-subagent-usage.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

/** Минимальный backlog-проект (конфиг со statuses нужен валидации ролей). */
function seedProject() {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Subagent Test',
      task_prefix: 'cs',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
}

/** Запись settings.json (секции chat_personas / subagents). */
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

/** Файл памяти роли. */
function memoryFile(name) {
  return join(cwd, '.vibelog', 'prompts', 'personas', `${name}.memory.md`);
}

/**
 * Фейковый LLM: различает ОСНОВНОЙ ход и вложенный запрос консультанта по
 * системному промпту (у консультанта в system лежит его собственный текст).
 *
 * @param main — сценарий основного хода (очередь ответов)
 * @param consultant — ответ консультанта (текст) либо функция от messages
 */
function fakeLlm(main, consultant = { text: 'Мнение консультанта.' }) {
  const state = { calls: 0, mainMessages: [], consultantMessages: [], consultantTools: [] };
  const llm = {
    async streamChat(messages, tools, opts) {
      const system = messages.find(m => m.role === 'system');
      const isConsultant = typeof system?.content === 'string' && system.content.includes('КОНСУЛЬТАНТ');
      if (isConsultant) {
        state.consultantMessages.push(structuredClone(messages));
        state.consultantTools.push((tools ?? []).map(t => t.name));
        const step = typeof consultant === 'function' ? consultant(messages) : consultant;
        if (step?.hang) {
          // Ждём отмены: таймаут консультации должен сработать
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5000);
            opts?.signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          });
        }
        return { text: step?.text ?? '', toolCalls: step?.toolCalls ?? [], usage: zeroUsage() };
      }
      state.mainMessages.push(structuredClone(messages));
      const step = main[state.calls] ?? main[main.length - 1];
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

/** Роль-консультант «Психолог» с проектным промптом. */
function seedConsultant(extra = {}) {
  writeProjectPrompt('psychologist', 'Ты — КОНСУЛЬТАНТ-психолог проекта. Отвечай кратко.');
  writeSettings({
    chat_personas: {
      psychologist: { label: 'Психолог', prompt: 'psychologist', ...extra },
    },
  });
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-subagent-'));
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

describe('VL-409 — доступность инструмента и классификация', () => {
  it('AC1: ask_persona объявлен в chatToolDefs, когда известна роль', () => {
    const defs = chatToolDefs(cwd, { id: 'helper', label: 'Помощник', prompt: 'helper' });
    const def = defs.find(d => d.name === 'ask_persona');
    assert.ok(def, 'ask_persona объявлен');
    assert.deepEqual(def.inputSchema.required, ['persona', 'question']);
    assert.equal(def.inputSchema.properties.context.type, 'string');
  });

  it('AC1: без роли инструмента нет (headless-путь)', () => {
    assert.ok(!chatToolDefs(cwd).some(d => d.name === 'ask_persona'));
  });

  it('AC1: ask_persona отсутствует в MCP-реестре (TUI и фазы его не видят)', () => {
    assert.ok(!listTools().some(t => t.name === 'ask_persona'));
  });

  it('AC1: subagents.enabled=false убирает инструмент', () => {
    writeSettings({ subagents: { enabled: false } });
    const defs = chatToolDefs(cwd, { id: 'helper', label: 'Помощник', prompt: 'helper' });
    assert.ok(!defs.some(d => d.name === 'ask_persona'));
  });

  it('AC4/риск: ask_persona НЕ write — иначе Allow/Deny на консультацию', () => {
    assert.equal(isWriteOperation('ask_persona'), false);
    assert.equal(isWriteOperation('write_file'), true);
  });

  it('AC4: ask_persona можно указать в allow_tools роли (имя валидно)', () => {
    // Валидатор allow_tools не должен ругаться на имя инструмента
    writeSettings({
      chat_personas: {
        helper: { label: 'Помощник', prompt: 'helper', allow_tools: ['ask_persona', 'read_file'] },
      },
    });
    const defs = chatToolDefs(cwd, { id: 'helper', label: 'Помощник', prompt: 'helper', allowTools: ['ask_persona', 'read_file'] });
    assert.ok(defs.some(d => d.name === 'ask_persona'), 'ask_persona разрешён allow_tools');
  });
});

describe('VL-409 — настройки секции subagents', () => {
  it('AC7: без секции — дефолты', () => {
    const settings = readSubagentSettings(cwd);
    assert.deepEqual(settings, SUBAGENT_DEFAULTS);
    assert.equal(settings.enabled, true);
    assert.equal(settings.display, 'inline');
    assert.equal(settings.maxCallsPerTurn, 2);
    assert.equal(settings.maxDepth, 1);
    assert.equal(settings.timeoutMs, 60000);
    assert.equal(settings.maxTokens, 2000);
    assert.equal(settings.onMissingPersona, 'error');
  });

  it('AC7: валидные значения применяются', () => {
    writeSettings({
      subagents: {
        enabled: false,
        display: 'widget',
        max_calls_per_turn: 1,
        max_depth: 1,
        timeout_ms: 100,
        max_tokens: 50,
        on_missing_persona: 'skip',
      },
    });
    const settings = readSubagentSettings(cwd);
    assert.equal(settings.enabled, false);
    assert.equal(settings.display, 'widget');
    assert.equal(settings.maxCallsPerTurn, 1);
    assert.equal(settings.timeoutMs, 100);
    assert.equal(settings.maxTokens, 50);
    assert.equal(settings.onMissingPersona, 'skip');
  });

  it('AC7: битые значения → дефолты + сообщения, чат не падает', () => {
    writeSettings({
      subagents: {
        enabled: 'да',
        display: 'карточка',
        max_calls_per_turn: 0,
        max_depth: 3,
        timeout_ms: -5,
        max_tokens: 'много',
      },
    });
    const errors = [];
    const settings = readSubagentSettings(cwd, errors);
    assert.equal(settings.enabled, true);
    assert.equal(settings.display, 'inline');
    assert.equal(settings.maxCallsPerTurn, 2);
    assert.equal(settings.maxDepth, 1, 'глубина > 1 отклоняется');
    assert.equal(settings.timeoutMs, 60000);
    assert.equal(settings.maxTokens, 2000);
    assert.ok(errors.length >= 6, `сообщений о битых значениях: ${errors.length}`);
    assert.ok(errors.some(e => /max_depth/.test(e)), 'сообщение про max_depth');
  });

  it('AC14: неизвестный on_missing_persona → error + сообщение (не молчаливое приведение)', () => {
    writeSettings({ subagents: { on_missing_persona: 'eror' } });
    const errors = [];
    const settings = readSubagentSettings(cwd, errors);
    assert.equal(settings.onMissingPersona, 'error');
    assert.ok(errors.some(e => /on_missing_persona/.test(e)), 'сообщение про on_missing_persona');
  });

  it('AC4: DEFAULT_CONSULTANT_TOOLS — только чтение', () => {
    for (const name of DEFAULT_CONSULTANT_TOOLS) {
      assert.equal(isWriteOperation(name), false, `${name} должен быть read`);
    }
    assert.ok(DEFAULT_CONSULTANT_TOOLS.includes('read_file'));
    assert.ok(DEFAULT_CONSULTANT_TOOLS.includes('backlog_view_task'));
  });
});

describe('VL-409 — консультация в ходе чата', () => {
  it('AC2/AC6: успешная консультация → событие subagent и ответ в tool-результате', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-1', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Как снизить тревожность?' } }] },
        { text: 'Готово.' },
      ],
      { text: 'Дышите ровно и разбейте задачу на шаги.' },
    );
    const events = await collect({ message: 'спроси психолога', threadId: 'sub-ok' }, { llm });
    const ev = events.find(e => e.type === 'subagent');
    assert.ok(ev, 'событие subagent пришло');
    assert.equal(ev.personaId, 'psychologist');
    assert.equal(ev.personaLabel, 'Психолог');
    assert.equal(ev.question, 'Как снизить тревожность?');
    assert.match(ev.answer, /Дышите ровно/);
    assert.equal(ev.display, 'inline', 'дефолтный режим отображения');
    // Ответ консультанта — в tool-результате основного хода
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-1');
    assert.ok(end, 'tool_end пришёл');
    assert.match(end.result, /Дышите ровно/);
    // AC2: консультант получил СВОЙ промпт, а не историю треда
    const consultantMsgs = state.consultantMessages[0];
    assert.match(consultantMsgs[0].content, /КОНСУЛЬТАНТ-психолог/);
    assert.equal(consultantMsgs.length, 2, 'system + вопрос, без истории треда');
    assert.match(consultantMsgs[1].content, /Как снизить тревожность/);
  });

  it('AC3: глубина 1 — консультанту НЕ передаются ask_persona и memory_remember', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-2', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-depth' }, { llm });
    const names = state.consultantTools[0];
    assert.ok(!names.includes('ask_persona'), 'ask_persona не выдан консультанту');
    assert.ok(!names.includes('memory_remember'), 'memory_remember не выдан консультанту');
  });

  it('AC4: консультант получает только чтение по умолчанию', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-3', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-tools' }, { llm });
    const names = state.consultantTools[0];
    assert.ok(names.includes('read_file'), 'read_file выдан');
    assert.ok(!names.includes('write_file'), 'write_file не выдан');
    assert.ok(!names.includes('edit'), 'edit не выдан');
    assert.ok(!names.includes('backlog_create_task'), 'write-инструменты MCP не выданы');
  });

  it('AC4: allow_tools консультанта расширяет набор, но write всё равно отсекается', async () => {
    seedConsultant({ allow_tools: ['read_file', 'write_file', 'backlog_search'] });
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-4', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-allow' }, { llm });
    const names = state.consultantTools[0];
    assert.ok(names.includes('backlog_search'), 'разрешённый read выдан');
    assert.ok(!names.includes('write_file'), 'write отсечён даже при allow_tools');
  });

  it('AC5: консультация не пишет в память консультанта', async () => {
    seedConsultant();
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-5', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-memory' }, { llm });
    assert.equal(existsSync(memoryFile('psychologist')), false, 'память консультанта не создана');
  });

  it('AC1: пустой вопрос → ошибка tool-результатом, консультант не вызывался', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-6', name: 'ask_persona', arguments: { persona: 'psychologist', question: '   ' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-empty' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-6');
    assert.ok(end);
    assert.match(end.result, /question/);
    assert.equal(state.consultantMessages.length, 0, 'консультант не вызывался');
  });

  it('AC1: роль = текущая → отказ с причиной', async () => {
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-7', name: 'ask_persona', arguments: { persona: 'helper', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси себя', threadId: 'sub-self' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-7');
    assert.match(end.result, /собственная/);
    assert.equal(state.consultantMessages.length, 0);
  });

  it('AC1/AC13: неизвестная роль при on_missing_persona=error → ошибка + список ролей', async () => {
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-8', name: 'ask_persona', arguments: { persona: 'nope', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-missing-error' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-8');
    assert.match(end.result, /не найдена/);
    assert.match(end.result, /helper \(Помощник\)/, 'перечень доступных ролей');
    assert.ok(!events.some(e => e.type === 'subagent'), 'события консультации нет');
  });

  it('AC13: неизвестная роль при on_missing_persona=skip → нейтральный результат', async () => {
    writeSettings({ subagents: { on_missing_persona: 'skip' } });
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-9', name: 'ask_persona', arguments: { persona: 'nope', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-missing-skip' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-9');
    assert.match(end.result, /отвечай сам/);
    assert.ok(!/не найдена\. Доступные/.test(end.result), 'без списка ролей и пометки ошибки');
    assert.equal(end.isError, undefined, 'в ленте не помечено как ошибка');
  });

  it('AC8: превышение max_calls_per_turn → отказ с причиной и лимитом', async () => {
    seedConsultant();
    writeSettings({
      chat_personas: { psychologist: { label: 'Психолог', prompt: 'psychologist' } },
      subagents: { max_calls_per_turn: 1 },
    });
    const { llm, state } = fakeLlm(
      [
        {
          toolCalls: [
            { id: 'tc-sub-10a', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Первый' } },
            { id: 'tc-sub-10b', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Второй' } },
          ],
        },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси дважды', threadId: 'sub-limit' }, { llm });
    const first = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-10a');
    const second = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-10b');
    assert.match(first.result, /Ответ\./, 'первый вызов прошёл');
    assert.match(second.result, /лимит консультаций/);
    assert.match(second.result, /1/, 'текущий лимит назван');
    assert.equal(state.consultantMessages.length, 1, 'консультант вызван один раз');
  });

  it('AC9: таймаут консультации не роняет ход', async () => {
    seedConsultant();
    writeSettings({
      chat_personas: { psychologist: { label: 'Психолог', prompt: 'psychologist' } },
      subagents: { timeout_ms: 50 },
    });
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-11', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Отвечаю сам.' },
      ],
      { hang: true },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-timeout' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-sub-11');
    assert.ok(end, 'tool_end пришёл');
    assert.match(end.result, /не ответил за 50 мс/);
    // Ход продолжился: финальный текст основного хода в ленте
    const text = events.filter(e => e.type === 'text').map(e => e.delta).join('');
    assert.match(text, /Отвечаю сам/);
  });

  it('AC10: токены консультации учтены с пометкой роли', async () => {
    seedConsultant();
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-12', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-usage' }, { llm });
    const usage = loadSubagentUsage(cwd, 'sub-usage');
    assert.ok(usage, 'sidecar учёта создан');
    assert.ok(usage.byPersona.psychologist, 'запись по роли консультанта');
    assert.equal(usage.byPersona.psychologist.calls, 1);
  });

  it('AC6: display=widget → событие subagent с display widget', async () => {
    seedConsultant();
    writeSettings({
      chat_personas: { psychologist: { label: 'Психолог', prompt: 'psychologist' } },
      subagents: { display: 'widget' },
    });
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-13', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-widget' }, { llm });
    const ev = events.find(e => e.type === 'subagent');
    assert.equal(ev.display, 'widget');
  });

  it('AC2: консультант видит свою память в промпте', async () => {
    seedConsultant();
    mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
    writeFileSync(memoryFile('psychologist'), '- Пользователь не любит англицизмы. (2026-11-10)\n', 'utf-8');
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-14', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-mem-read' }, { llm });
    assert.match(state.consultantMessages[0][0].content, /не любит англицизмы/);
  });

  it('AC2: консультант может прочитать файл и ответить (мини-цикл)', async () => {
    seedConsultant({ allow_tools: ['read_file'] });
    writeFileSync(join(cwd, 'note.txt'), 'важная заметка', 'utf-8');
    let consultantCall = 0;
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-sub-15', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Что в note.txt?' } }] },
        { text: 'Ок.' },
      ],
      () => {
        consultantCall++;
        if (consultantCall === 1) {
          return { toolCalls: [{ id: 'c-1', name: 'read_file', arguments: { path: 'note.txt' } }] };
        }
        return { text: 'В файле важная заметка.' };
      },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-loop' }, { llm });
    const ev = events.find(e => e.type === 'subagent');
    assert.match(ev.answer, /важная заметка/);
  });
});
