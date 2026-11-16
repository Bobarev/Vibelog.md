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
import { extractMemoryLines } from '../../dist/web/chat-subagent.js';
import { handleApi } from '../../dist/web/api.js';
import { appendMemoryEntry, readMemoryEntries } from '../../dist/core/persona-memory.js';
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
    assert.equal(settings.maxTokens, 4000);
    assert.equal(settings.maxAnswerChars, 20000);
    assert.equal(settings.maxIterations, 5);
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
        max_answer_chars: 1000,
        max_iterations: 2,
        on_missing_persona: 'skip',
      },
    });
    const settings = readSubagentSettings(cwd);
    assert.equal(settings.enabled, false);
    assert.equal(settings.display, 'widget');
    assert.equal(settings.maxCallsPerTurn, 1);
    assert.equal(settings.timeoutMs, 100);
    assert.equal(settings.maxTokens, 50);
    assert.equal(settings.maxAnswerChars, 1000);
    assert.equal(settings.maxIterations, 2);
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
        max_answer_chars: 0,
        max_iterations: -1,
      },
    });
    const errors = [];
    const settings = readSubagentSettings(cwd, errors);
    assert.equal(settings.enabled, true);
    assert.equal(settings.display, 'inline');
    assert.equal(settings.maxCallsPerTurn, 2);
    assert.equal(settings.maxDepth, 1, 'глубина > 1 отклоняется');
    assert.equal(settings.timeoutMs, 60000);
    assert.equal(settings.maxTokens, 4000);
    assert.equal(settings.maxAnswerChars, 20000);
    assert.equal(settings.maxIterations, 5);
    assert.ok(errors.length >= 8, `сообщений о битых значениях: ${errors.length}`);
    assert.ok(errors.some(e => /max_depth/.test(e)), 'сообщение про max_depth');
    assert.ok(errors.some(e => /max_answer_chars/.test(e)), 'сообщение про max_answer_chars');
    assert.ok(errors.some(e => /max_iterations/.test(e)), 'сообщение про max_iterations');
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
    assert.ok(!names.includes('memory_forget'), 'memory_forget не выдан консультанту (VL-419)');
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

describe('VL-415 — полный ответ консультанта и частичный результат', () => {
  /** Длинный русский ответ: ~30 КБ в UTF-8 (≈20 тыс. символов). */
  function longAnswer(chars = 20_000) {
    const sentence = 'Разбейте задачу на шаги и двигайтесь по одному. ';
    return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars);
  }

  it('AC1/AC6: ответ 30 КБ (UTF-8) проходит целиком, общий кап 8 КБ не применяется', async () => {
    seedConsultant();
    const answer = longAnswer();
    assert.ok(Buffer.byteLength(answer, 'utf8') >= 30_000, 'ответ действительно ~30 КБ');
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-1', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Развёрнуто?' } }] },
        { text: 'Готово.' },
      ],
      { text: answer },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-long' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-1');
    assert.ok(end, 'tool_end пришёл');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.answer, answer, 'ответ не обрезан');
    assert.equal(parsed.truncated, false);
    assert.equal(parsed.answerChars, answer.length);
    assert.ok(!/вывод обрезан/.test(end.result), 'общий кап не сработал');
    const ev = events.find(e => e.type === 'subagent');
    assert.equal(ev.answer, answer);
    assert.equal(ev.truncated, undefined, 'пометки об обрезке нет');
  });

  it('AC2/AC4/AC5: max_answer_chars=1000 → обрезка по границе слова с пометкой', async () => {
    seedConsultant();
    writeSettings({
      chat_personas: { psychologist: { label: 'Психолог', prompt: 'psychologist' } },
      subagents: { max_answer_chars: 1000 },
    });
    const answer = longAnswer(5000);
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-2', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Готово.' },
      ],
      { text: answer },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-cut' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-2');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.answerChars, answer.length, 'длина полного ответа сохранена');
    assert.ok(parsed.answer.length < answer.length);
    assert.match(parsed.answer, /ответ консультанта обрезан: показано \d+ из 5000 символов/);
    assert.match(parsed.answer, /subagents\.max_answer_chars/, 'пометка называет настройку');
    // Обрезка по границе слова: последний видимый фрагмент — целое слово
    const shown = parsed.answer.split('\n\n[ответ консультанта обрезан')[0];
    assert.ok(!/\s$/.test(shown), 'без висящего пробела');
    assert.ok(shown.length <= 1000, `показано не больше лимита: ${shown.length}`);
    assert.ok(shown.length > 500, `обрезка не в начале ответа: ${shown.length}`);
    // AC5: пометка есть и в событии ленты (UI), а не только в тексте для модели
    const ev = events.find(e => e.type === 'subagent');
    assert.equal(ev.truncated, true);
    assert.equal(ev.answerChars, answer.length);
  });

  it('AC6: read_file по-прежнему капается 8 КБ (регресс не допущен)', async () => {
    writeFileSync(join(cwd, 'big.txt'), 'строка текста\n'.repeat(3000), 'utf-8');
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-415-3', name: 'read_file', arguments: { path: 'big.txt' } }] },
      { text: 'Готово.' },
    ]);
    const events = await collect({ message: 'прочитай', threadId: 'sub-cap' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-3');
    assert.match(end.result, /вывод обрезан/);
  });

  it('AC8: итерации исчерпаны, но текст в последнем ответе был → это и есть ответ', async () => {
    seedConsultant({ allow_tools: ['read_file'] });
    writeFileSync(join(cwd, 'note.txt'), 'заметка', 'utf-8');
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-4', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Готово.' },
      ],
      // Каждая итерация: текст + вызов инструмента (лимит итераций исчерпан)
      () => ({ text: 'Промежуточный, но осмысленный текст.', toolCalls: [{ id: 'c-415-4', name: 'read_file', arguments: { path: 'note.txt' } }] }),
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-lasttext' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-4');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true, 'ответ не потерян');
    assert.match(parsed.answer, /Промежуточный, но осмысленный текст/);
  });

  it('AC9: текст вместе с tool_calls сохраняется и используется, если следующая итерация пуста', async () => {
    seedConsultant({ allow_tools: ['read_file'] });
    writeFileSync(join(cwd, 'note.txt'), 'заметка', 'utf-8');
    let call = 0;
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-5', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Готово.' },
      ],
      () => {
        call++;
        if (call === 1) {
          return { text: 'Сейчас посмотрю файл и отвечу.', toolCalls: [{ id: 'c-415-5', name: 'read_file', arguments: { path: 'note.txt' } }] };
        }
        return { text: '', toolCalls: [] };
      },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-withtext' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-5');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true);
    assert.match(parsed.answer, /Сейчас посмотрю файл/);
  });

  it('AC10/AC11: исчерпаны итерации без текста → partial с перечнем инструментов', async () => {
    seedConsultant({ allow_tools: ['read_file'] });
    writeFileSync(join(cwd, 'note.txt'), 'заметка', 'utf-8');
    writeSettings({
      chat_personas: { psychologist: { label: 'Психолог', prompt: 'psychologist', allow_tools: ['read_file'] } },
      subagents: { max_iterations: 2 },
    });
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-6', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Отвечаю сам.' },
      ],
      () => ({ text: '', toolCalls: [{ id: 'c-415-6', name: 'read_file', arguments: { path: 'note.txt' } }] }),
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-partial' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-6');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.partial, true);
    assert.equal(parsed.empty, undefined, 'partial и empty различаются');
    assert.equal(parsed.iterations, 2, 'лимит итераций настраивается');
    assert.deepEqual(parsed.usedTools, ['read_file', 'read_file']);
    assert.match(parsed.error, /исчерпал лимит итераций \(2\)/);
    assert.match(parsed.error, /read_file/);
    assert.ok(!events.some(e => e.type === 'subagent'), 'события консультации нет');
  });

  it('AC12: пустой ответ без вызовов → empty, а не partial', async () => {
    seedConsultant();
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-7', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Отвечаю сам.' },
      ],
      { text: '   ' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-empty' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-415-7');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.empty, true);
    assert.equal(parsed.partial, undefined);
    assert.match(parsed.error, /вернул пустой ответ/);
  });

  it('AC13: в промпте консультанта есть подсказка экономить итерации', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-415-8', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-prompt' }, { llm });
    assert.match(state.consultantMessages[0][0].content, /не более 2 файлов/);
  });
});

describe('VL-419 — память консультанта: служебные строки ЗАПОМНИТЬ:', () => {
  it('AC4: одна строка — запись извлечена, текст без неё', () => {
    const out = extractMemoryLines('Ответ психолога.\nЗАПОМНИТЬ: Не откладывать задачи дольше недели');
    assert.deepEqual(out.entries, ['Не откладывать задачи дольше недели']);
    assert.equal(out.text, 'Ответ психолога.');
  });

  it('AC4: две строки — обе записями, текст чист', () => {
    const out = extractMemoryLines(
      'Ответ.\nЗАПОМНИТЬ: Первое правило\nЗАПОМНИТЬ: Второе правило',
    );
    assert.deepEqual(out.entries, ['Первое правило', 'Второе правило']);
    assert.equal(out.text, 'Ответ.');
  });

  it('AC4: три строки — берутся первые две, третья отбрасывается и из текста', () => {
    const out = extractMemoryLines(
      'Ответ.\nЗАПОМНИТЬ: Раз\nЗАПОМНИТЬ: Два\nЗАПОМНИТЬ: Три',
    );
    assert.deepEqual(out.entries, ['Раз', 'Два']);
    assert.equal(out.text, 'Ответ.');
    assert.ok(!out.text.includes('Три'));
  });

  it('AC4: строк нет — текст возвращается байт-в-байт (без trim)', () => {
    const raw = 'Обычный ответ с хвостовым пробелом. ';
    const out = extractMemoryLines(raw);
    assert.equal(out.text, raw);
    assert.deepEqual(out.entries, []);
  });

  it('AC4: строка не в конце — всё равно извлекается, пустые строки схлопнуты', () => {
    const out = extractMemoryLines('Середина.\n\nЗАПОМНИТЬ: Правило посередине\n\nКонец.');
    assert.deepEqual(out.entries, ['Правило посередине']);
    assert.equal(out.text, 'Середина.\n\nКонец.');
  });

  it('AC4: регистр префикса значим — «запомнить:» остаётся обычным текстом', () => {
    const raw = 'Ответ.\nзапомнить: строчными буквами';
    const out = extractMemoryLines(raw);
    assert.deepEqual(out.entries, []);
    assert.equal(out.text, raw, 'строка не тронута');
  });

  it('AC3: в промпте консультанта есть блок формата ЗАПОМНИТЬ (≤2 строк, конец)', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-419-p', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.' },
    );
    await collect({ message: 'спроси', threadId: 'sub-419-prompt' }, { llm });
    const prompt = state.consultantMessages[0][0].content;
    assert.match(prompt, /ЗАПОМНИТЬ: <правило одной фразой в императиве>/);
    assert.match(prompt, /Не более 2 строк за консультацию/);
    assert.match(prompt, /САМОМ КОНЦЕ ответа/);
  });

  it('AC5/AC6: запись уходит в память КОНСУЛЬТАНТА, ответ без служебных строк', async () => {
    seedConsultant();
    const { llm, state } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-419-1', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Повторяющаяся ситуация' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Вот мнение.\n\nЗАПОМНИТЬ: Разбирать тревогу до начала рабочего дня' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-419-mem' }, { llm });

    // Файл КОНСУЛЬТАНТА заполнен, роли треда — нет
    const consultantFile = readFileSync(memoryFile('psychologist'), 'utf8');
    assert.match(consultantFile, /Разбирать тревогу до начала рабочего дня/);
    assert.equal(existsSync(memoryFile('helper')), false, 'память роли треда не тронута');

    // Событие memory с ролью консультанта — карточка «Психолог запомнил»
    const memory = events.find(e => e.type === 'memory');
    assert.ok(memory, 'событие memory пришло');
    assert.equal(memory.personaId, 'psychologist');
    assert.equal(memory.personaLabel, 'Психолог');
    assert.match(memory.entry.text, /Разбирать тревогу/);

    // AC6: служебных строк нет ни в событии, ни в tool-результате
    const ev = events.find(e => e.type === 'subagent');
    assert.ok(ev, 'событие subagent пришло');
    assert.ok(!ev.answer.includes('ЗАПОМНИТЬ:'), 'answer события без служебных строк');
    assert.equal(ev.memory?.length, 1, 'запись видна в событии консультации');
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-419-1');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true);
    assert.ok(!end.result.includes('ЗАПОМНИТЬ:'), 'tool-результат без служебных строк');
    assert.match(parsed.answer, /Вот мнение/);

    // Консультанту по-прежнему не выдают инструменты памяти
    const names = state.consultantTools[0];
    assert.ok(!names.includes('memory_remember'));
    assert.ok(!names.includes('memory_forget'));
  });

  it('AC7: дубль → memorySkipped с причиной, консультация ok: true', async () => {
    seedConsultant();
    mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
    writeFileSync(
      memoryFile('psychologist'),
      '- Разбирать тревогу до начала рабочего дня. (2026-11-10)\n',
      'utf-8',
    );
    const { llm } = fakeLlm(
      [
        { toolCalls: [{ id: 'tc-419-2', name: 'ask_persona', arguments: { persona: 'psychologist', question: 'Вопрос' } }] },
        { text: 'Ок.' },
      ],
      { text: 'Ответ.\nЗАПОМНИТЬ: разбирать тревогу до начала рабочего дня' },
    );
    const events = await collect({ message: 'спроси', threadId: 'sub-419-dup' }, { llm });
    const end = events.find(e => e.type === 'tool_end' && e.id === 'tc-419-2');
    const parsed = JSON.parse(end.result);
    assert.equal(parsed.ok, true, 'консультация успешна при отказе записи');
    assert.equal(parsed.memory, undefined, 'записей нет');
    assert.equal(parsed.memorySkipped?.length, 1, 'отказ собран в memorySkipped');
    assert.match(parsed.memorySkipped[0].reason, /уже есть/);
    assert.equal(parsed.memorySkipped[0].text, 'разбирать тревогу до начала рабочего дня');
    const ev = events.find(e => e.type === 'subagent');
    assert.equal(ev.memorySkipped?.length, 1, 'отказ виден в событии');
    assert.ok(!events.some(e => e.type === 'memory'), 'события memory нет (записей нет)');
    // Файл не задублирован
    const lines = readFileSync(memoryFile('psychologist'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'осталась одна запись');
  });

  it('AC8: отмена из карточки консультанта удаляет из ЕГО файла, а не треда', async () => {
    seedConsultant();
    // Роль треда фиксируется первым ходом (файл helper не создаётся)
    const { llm } = fakeLlm([{ text: 'Ок.' }]);
    await collect({ message: 'привет', threadId: 'sub-419-rm' }, { llm });
    appendMemoryEntry(cwd, 'psychologist', 'Наблюдение психолога', new Date(2026, 10, 10));
    appendMemoryEntry(cwd, 'helper', 'Запись помощника', new Date(2026, 10, 10));

    const res = handleApi(
      'POST',
      '/api/chat/threads/sub-419-rm/memory/remove',
      { text: 'Наблюдение психолога', personaId: 'psychologist' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.removed.text, 'Наблюдение психолога.');
    assert.equal(
      readMemoryEntries(cwd, 'psychologist').entries.length,
      0,
      'файл консультанта очищен',
    );
    assert.equal(
      readMemoryEntries(cwd, 'helper').entries.length,
      1,
      'память роли треда не тронута',
    );

    // Неизвестная роль — отказ, а не произвольный путь
    const bad = handleApi(
      'POST',
      '/api/chat/threads/sub-419-rm/memory/remove',
      { text: 'Наблюдение психолога', personaId: 'nope' },
      cwd,
    );
    assert.equal(bad.status, 404);
    assert.match(bad.body.error, /не найдена/);
  });
});
