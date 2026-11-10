/**
 * Тесты VL-405 — AGENTS.md в веб-чате: ссылка вместо вставки.
 *
 * TUI-агент и headless-фазы вставляют AGENTS.md в системный промпт целиком
 * (`src/agent/system-prompt.ts`, кап 8000 символов). Веб-чат собирает промпт
 * отдельно (`buildSystemPrompt` в `src/web/chat.ts`) и раньше правил проекта
 * не видел вовсе. Теперь он получает короткую ссылку: файл есть, столько-то
 * символов, читай через `read_file`, если вопрос про правила.
 *
 * Покрыто:
 * - наличие файла → блок `## Правила проекта` с размером и указанием read_file;
 * - текст AGENTS.md в чат-промпт НЕ попадает (экономия контекста);
 * - отсутствие файла — норма, блока нет;
 * - ошибка чтения (EISDIR) — блока нет + сообщение в stderr, чат не падает;
 * - порядок блоков: шаблон → роль → память → уроки → правила → контекст поиска;
 * - инвариант: headless-промпт по-прежнему содержит текст AGENTS.md.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, describeAgentsMd } from '../../dist/web/chat.js';
import { createLessonFile } from '../../dist/core/lesson.js';
import { createTaskFile } from '../../dist/core/store.js';
import { buildSystemPrompt } from '../../dist/agent/system-prompt.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

/** Уникальный маркер внутри AGENTS.md: его не должно быть в чат-промпте. */
const AGENTS_MARKER = 'МАРКЕР-ПРАВИЛ-ПРОЕКТА-VL405';

/** Минимальный backlog-проект. */
function seedProject() {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat AgentsMd Test',
      task_prefix: 'am',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
}

/** Подменный LLM (паттерн chat-lessons.test.mjs): запоминает system-промпт. */
function fakeLlm() {
  const state = { messages: [] };
  return {
    state,
    llm: {
      async streamChat(messages, _tools, opts) {
        state.messages.push(structuredClone(messages));
        const text = 'Ок.';
        for (const piece of text.split(/(?<=\s)/)) opts?.onToken?.(piece);
        return { text, toolCalls: [], usage: zeroUsage() };
      },
    },
  };
}

/** Системный промпт первого вызова модели в ходе чата. */
async function chatSystemPrompt(body) {
  const { llm, state } = fakeLlm();
  for await (const _ev of runChat(body, cwd, { llm })) {
    // события не нужны — интересует только system-сообщение
  }
  return state.messages[0][0].content;
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-agents-md-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  rmSync(join(cwd, 'AGENTS.md'), { recursive: true, force: true });
  seedProject();
});

describe('VL-405 — describeAgentsMd', () => {
  it('AC1: файл есть → ссылка с размером и указанием читать через read_file', () => {
    const text = `# AGENTS.md\n\n${AGENTS_MARKER}\n`;
    writeFileSync(join(cwd, 'AGENTS.md'), text, 'utf-8');
    const block = describeAgentsMd(cwd);
    assert.ok(block, 'блок собран');
    assert.ok(block.startsWith('## Правила проекта'), `заголовок блока: ${block.slice(0, 40)}`);
    assert.ok(block.includes(`(${text.length} символов)`), 'размер в символах указан');
    assert.ok(block.includes('read_file'), 'указание читать через read_file');
    assert.ok(block.includes('В промпт он не вставлен'), 'явно сказано, что текста в промпте нет');
    assert.ok(!block.includes(AGENTS_MARKER), 'текст файла в ссылку не попадает');
  });

  it('AC3: файла нет → null (норма)', () => {
    assert.equal(describeAgentsMd(cwd), null);
  });

  it('AC4: ошибка чтения (EISDIR) → null + сообщение в stderr', () => {
    // Каталог вместо файла: statSync проходит, readFileSync падает EISDIR —
    // детерминированный аналог EACCES (chmod 000 не работает под root).
    mkdirSync(join(cwd, 'AGENTS.md'), { recursive: true });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
      assert.equal(describeAgentsMd(cwd), null, 'блока нет');
    } finally {
      console.error = original;
    }
    assert.equal(errors.length, 1, `одно предупреждение: ${errors.join(' | ')}`);
    assert.ok(errors[0].includes('AGENTS.md'), 'предупреждение про AGENTS.md');
  });
});

describe('VL-405 — блок «Правила проекта» в системном промпте чата', () => {
  it('AC1/AC2: ссылка есть, текста AGENTS.md в промпте нет', async () => {
    writeFileSync(join(cwd, 'AGENTS.md'), `# AGENTS.md\n\n${AGENTS_MARKER}\n`, 'utf-8');
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'am-link' });
    assert.ok(system.includes('## Правила проекта'), 'блок в промпте');
    assert.ok(system.includes('read_file'), 'указание читать через read_file');
    assert.ok(!system.includes(AGENTS_MARKER), 'текст AGENTS.md в промпт НЕ вставлен');
  });

  it('AC3: без AGENTS.md блока нет, промпт собирается как раньше', async () => {
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'am-none' });
    assert.ok(!system.includes('## Правила проекта'), 'блока нет');
    assert.ok(system.includes('## Текущая роль'), 'остальные блоки на месте');
  });

  it('AC4: ошибка чтения не роняет чат — блока нет', async () => {
    mkdirSync(join(cwd, 'AGENTS.md'), { recursive: true });
    const original = console.error;
    console.error = () => {};
    let system;
    try {
      system = await chatSystemPrompt({ message: 'привет', threadId: 'am-err' });
    } finally {
      console.error = original;
    }
    assert.ok(!system.includes('## Правила проекта'), 'блока нет');
    assert.ok(system.includes('## Текущая роль'), 'чат ответил, промпт собран');
  });

  it('AC5: порядок блоков — роль → память → уроки → правила → контекст поиска', async () => {
    // Память персоны
    mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'prompts', 'personas', 'helper.memory.md'), '- Память-маркер.\n', 'utf-8');
    // Урок, релевантный сообщению
    createLessonFile(cwd, {
      id: 'lesson-9405',
      title: 'Сборка фронта: правило',
      status: 'active',
      tags: ['build'],
      kind: 'rule',
      content: '## Проблема\n\nсборка фронта падает\n',
    });
    // Задача для контекста поиска (globalSearch по последнему сообщению)
    createTaskFile(cwd, { title: 'Сборка фронта: задача-маркер' });
    writeFileSync(join(cwd, 'AGENTS.md'), `# AGENTS.md\n\n${AGENTS_MARKER}\n`, 'utf-8');

    const system = await chatSystemPrompt({ message: 'сборка фронта', threadId: 'am-order' });

    const roleAt = system.indexOf('## Текущая роль');
    const memoryAt = system.indexOf('## Память персоны');
    const lessonsAt = system.indexOf('## Уроки проекта');
    const rulesAt = system.indexOf('## Правила проекта');
    const contextAt = system.indexOf('Контекст проекта по текущему сообщению');

    assert.ok(roleAt >= 0, 'блок роли есть');
    assert.ok(memoryAt > roleAt, 'память после роли');
    assert.ok(lessonsAt > memoryAt, 'уроки после памяти');
    assert.ok(rulesAt > lessonsAt, 'правила после уроков');
    assert.ok(contextAt > rulesAt, 'контекст поиска последний');
  });
});

describe('VL-405 — инвариант «фазы и TUI не затронуты»', () => {
  it('AC6: headless-промпт по-прежнему содержит текст AGENTS.md целиком', () => {
    writeFileSync(join(cwd, 'AGENTS.md'), `# AGENTS.md\n\n${AGENTS_MARKER}\n`, 'utf-8');
    const { content, hasAgentsMd } = buildSystemPrompt(cwd);
    assert.equal(hasAgentsMd, true, 'AGENTS.md подключён');
    assert.ok(content.includes(AGENTS_MARKER), 'текст AGENTS.md вставлен как раньше');
    assert.ok(!content.includes('## Правила проекта'), 'ссылочного блока чата в фазах нет');
  });
});
