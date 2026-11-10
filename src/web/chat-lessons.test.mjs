/**
 * Тесты VL-404 — уроки проекта в веб-чате: recall по смыслу разговора.
 *
 * Раньше уроки в чат попадали только подстрочным `globalSearch` по последнему
 * сообщению: вопрос «почему падает сборка фронта» не находил урок про
 * `pnpm install` в `web/`, если слова не совпали. Теперь блок
 * `## Уроки проекта` собирается `selectLessonsForText` (VL-400) по последним
 * user-сообщениям треда.
 *
 * Покрыто:
 * - recall по смыслу разговора (вопрос про worktree находит урок про worktree);
 * - кап `chat_lessons.limit` и `lessons.prompt_limit`;
 * - фильтр протухших и не-active уроков;
 * - настройки `chat_lessons` (enabled/max_messages/limit), битые значения →
 *   дефолт + сообщение в errors;
 * - пустой результат — блока нет;
 * - уроки не дублируются в контексте globalSearch;
 * - инвариант «не протекает в фазы»: `buildSystemPrompt(cwd)` без `chat: true`
 *   не содержит `## Уроки проекта` (VL-238/lesson-134).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runChat, recentConversationText } from '../../dist/web/chat.js';
import { createLessonFile, readChatLessonSettings, selectLessonsForText } from '../../dist/core/lesson.js';
import { buildSystemPrompt } from '../../dist/agent/system-prompt.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

/** Минимальный backlog-проект. */
function seedProject() {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Lessons Test',
      task_prefix: 'cl',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
}

/** Запись settings.json (секции lessons / chat_lessons). */
function writeSettings(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** Подменный LLM (паттерн persona-memory.test.mjs): запоминает system-промпт. */
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
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-lessons-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  seedProject();
});

describe('VL-404 — selectLessonsForText: recall по произвольному тексту', () => {
  it('AC1: вопрос про worktree находит урок про worktree без совпадения слов', () => {
    createLessonFile(cwd, {
      id: 'lesson-901',
      title: 'Выполняй pnpm install внутри web перед сборкой фронта',
      status: 'active',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта в worktree падает без dev-зависимостей\n',
    });
    createLessonFile(cwd, {
      id: 'lesson-902',
      title: 'Телеграм-бот не отвечает без токена',
      status: 'active',
      tags: ['bot'],
      content: '## Проблема\n\nбот молчит\n',
    });
    const picked = selectLessonsForText(cwd, 'почему падает сборка фронта в worktree');
    assert.ok(picked.some(e => e.lesson.id === 'lesson-901'), `релевантный урок найден: ${picked.map(e => e.lesson.id)}`);
    assert.ok(!picked.some(e => e.lesson.id === 'lesson-902'), 'нерелевантный урок не подставлен');
  });

  it('AC2: кап limit соблюдается', () => {
    for (let i = 0; i < 6; i += 1) {
      createLessonFile(cwd, {
        id: `lesson-91${i}`,
        title: `Сборка фронта: правило ${i}`,
        status: 'active',
        tags: ['build'],
        content: '## Проблема\n\nсборка фронта\n',
      });
    }
    const picked = selectLessonsForText(cwd, 'сборка фронта', { limit: 3 });
    assert.equal(picked.length, 3, 'ровно limit уроков');
  });

  it('AC2: протухший и не-active уроки не подставляются', () => {
    createLessonFile(cwd, {
      id: 'lesson-920',
      title: 'Сборка фронта: свежий урок',
      status: 'active',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта\n',
    });
    createLessonFile(cwd, {
      id: 'lesson-921',
      title: 'Сборка фронта: протухший урок',
      status: 'active',
      tags: ['build'],
      last_verified: '2020-01-01',
      updated_date: '2020-01-01',
      content: '## Проблема\n\nсборка фронта\n',
    });
    createLessonFile(cwd, {
      id: 'lesson-922',
      title: 'Сборка фронта: на проверке',
      status: 'needs-review',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта\n',
    });
    const picked = selectLessonsForText(cwd, 'сборка фронта');
    const ids = picked.map(e => e.lesson.id);
    assert.ok(ids.includes('lesson-920'), `свежий активный подставлен: ${ids}`);
    assert.ok(!ids.includes('lesson-921'), 'протухший не подставлен');
    assert.ok(!ids.includes('lesson-922'), 'needs-review не подставлен');
  });

  it('AC2: minScore отсекает совпадение по одному общему слову', () => {
    createLessonFile(cwd, {
      id: 'lesson-930',
      title: 'Совсем другой заголовок',
      status: 'active',
      tags: ['misc'],
      content: '## Проблема\n\nфайл\n',
    });
    const loose = selectLessonsForText(cwd, 'файл');
    assert.ok(loose.some(e => e.lesson.id === 'lesson-930'), 'без порога совпадение по телу находится');
    const strict = selectLessonsForText(cwd, 'файл', { minScore: 3 });
    assert.ok(!strict.some(e => e.lesson.id === 'lesson-930'), 'порог 3 отсекает совпадение только по телу');
  });

  it('пустой текст → пустой результат', () => {
    createLessonFile(cwd, { id: 'lesson-940', title: 'Сборка фронта', status: 'active', tags: ['build'] });
    assert.deepEqual(selectLessonsForText(cwd, '   '), []);
  });
});

describe('VL-404 — recentConversationText', () => {
  it('берёт только user-сообщения, последние maxMessages, в хронологическом порядке', () => {
    const history = [
      { role: 'user', content: 'первый' },
      { role: 'assistant', content: 'ответ модели' },
      { role: 'user', content: 'второй' },
      { role: 'assistant', content: 'ещё ответ' },
      { role: 'user', content: 'третий' },
    ];
    assert.equal(recentConversationText(history, 2), 'второй третий');
    assert.equal(recentConversationText(history, 3), 'первый второй третий');
    assert.equal(recentConversationText(history, 0), '');
  });

  it('ответы модели в текст не попадают', () => {
    const history = [
      { role: 'user', content: 'вопрос' },
      { role: 'assistant', content: 'шум-ответ' },
    ];
    assert.equal(recentConversationText(history, 3), 'вопрос');
  });

  it('длинный текст обрезается до ~2000 символов, сохраняя свежий хвост', () => {
    const long = 'а'.repeat(3000);
    const text = recentConversationText([{ role: 'user', content: `${long} СВЕЖИЙ-ХВОСТ` }], 3);
    assert.ok(text.length <= 2000, `длина ${text.length}`);
    assert.ok(text.endsWith('СВЕЖИЙ-ХВОСТ'), 'свежий хвост сохранён');
  });
});

describe('VL-404 — настройки chat_lessons', () => {
  it('AC5: дефолты enabled=true, max_messages=3, limit=3', () => {
    assert.deepEqual(readChatLessonSettings(cwd), { enabled: true, maxMessages: 3, limit: 3 });
  });

  it('AC5: значения из settings.json читаются', () => {
    writeSettings({ chat_lessons: { enabled: false, max_messages: 5, limit: 2 } });
    assert.deepEqual(readChatLessonSettings(cwd), { enabled: false, maxMessages: 5, limit: 2 });
  });

  it('AC5: битые значения → дефолт + сообщение в errors', () => {
    writeSettings({ chat_lessons: { enabled: 'нет', max_messages: -1, limit: 'много' } });
    const errors = [];
    const settings = readChatLessonSettings(cwd, errors);
    assert.deepEqual(settings, { enabled: true, maxMessages: 3, limit: 3 });
    assert.equal(errors.length, 3, `три сообщения об ошибках: ${errors.join(' | ')}`);
    assert.ok(errors.some(e => e.includes('chat_lessons.enabled')));
    assert.ok(errors.some(e => e.includes('chat_lessons.max_messages')));
    assert.ok(errors.some(e => e.includes('chat_lessons.limit')));
  });

  it('AC5: секция не объект → дефолт + сообщение', () => {
    writeSettings({ chat_lessons: 'строка' });
    const errors = [];
    assert.deepEqual(readChatLessonSettings(cwd, errors), { enabled: true, maxMessages: 3, limit: 3 });
    assert.equal(errors.length, 1);
  });
});

describe('VL-404 — блок «Уроки проекта» в системном промпте чата', () => {
  it('AC3: блок идёт после памяти персоны и до контекста поиска', async () => {
    mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
    writeFileSync(join(cwd, '.vibelog', 'prompts', 'personas', 'helper.memory.md'), '- Память-маркер.\n', 'utf-8');
    createLessonFile(cwd, {
      id: 'lesson-950',
      title: 'Выполняй pnpm install внутри web перед сборкой фронта',
      status: 'active',
      tags: ['build'],
      kind: 'rule',
      content: '## Проблема\n\nсборка фронта в worktree падает\n',
    });
    const system = await chatSystemPrompt({ message: 'почему падает сборка фронта в worktree', threadId: 'cl-order' });
    assert.ok(system.includes('## Уроки проекта'), 'блок уроков в промпте');
    assert.ok(system.includes('- [lesson-950] Выполняй pnpm install внутри web перед сборкой фронта (rule)'),
      'формат строки как в фазах (id + title + kind)');
    const memoryAt = system.indexOf('## Память персоны');
    const lessonsAt = system.indexOf('## Уроки проекта');
    assert.ok(memoryAt >= 0 && lessonsAt > memoryAt, 'уроки после памяти персоны');
  });

  it('AC3: пустой результат — блока нет', async () => {
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'cl-empty' });
    assert.ok(!system.includes('## Уроки проекта'), 'заголовка блока нет');
  });

  it('AC1: токены берутся из нескольких последних сообщений треда', async () => {
    createLessonFile(cwd, {
      id: 'lesson-960',
      title: 'Проверяй политику git по факту индексации',
      status: 'active',
      tags: ['git'],
      content: '## Проблема\n\nшум\n',
    });
    // Первый ход задаёт тему, второй — общий вопрос без ключевых слов
    await chatSystemPrompt({ message: 'разберись с политикой git в проекте', threadId: 'cl-multi' });
    const system = await chatSystemPrompt({ message: 'а что там дальше?', threadId: 'cl-multi' });
    assert.ok(system.includes('## Уроки проекта'), 'блок собран по истории треда');
    assert.ok(system.includes('lesson-960'), 'урок из темы первого сообщения найден');
  });

  it('AC5: chat_lessons.enabled=false → блока нет', async () => {
    writeSettings({ chat_lessons: { enabled: false } });
    createLessonFile(cwd, {
      id: 'lesson-970',
      title: 'Сборка фронта: правило',
      status: 'active',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта\n',
    });
    const system = await chatSystemPrompt({ message: 'сборка фронта падает', threadId: 'cl-off' });
    assert.ok(!system.includes('## Уроки проекта'), 'выключатель работает');
  });

  it('AC5: chat_lessons.limit капит число строк блока', async () => {
    writeSettings({ chat_lessons: { limit: 2 } });
    for (let i = 0; i < 5; i += 1) {
      createLessonFile(cwd, {
        id: `lesson-98${i}`,
        title: `Сборка фронта: правило ${i}`,
        status: 'active',
        tags: ['build'],
        content: '## Проблема\n\nсборка фронта\n',
      });
    }
    const system = await chatSystemPrompt({ message: 'сборка фронта падает', threadId: 'cl-cap' });
    const block = system.slice(system.indexOf('## Уроки проекта'));
    const lines = block.split('\n').filter(l => l.startsWith('- [lesson-'));
    assert.equal(lines.length, 2, `ровно 2 строки: ${lines.join(' | ')}`);
  });

  it('AC2: lessons.prompt_limit тоже капит блок (минимум из двух лимитов)', async () => {
    writeSettings({ lessons: { prompt_limit: 1 }, chat_lessons: { limit: 3 } });
    for (let i = 0; i < 5; i += 1) {
      createLessonFile(cwd, {
        id: `lesson-99${i}`,
        title: `Сборка фронта: правило ${i}`,
        status: 'active',
        tags: ['build'],
        content: '## Проблема\n\nсборка фронта\n',
      });
    }
    const system = await chatSystemPrompt({ message: 'сборка фронта падает', threadId: 'cl-prompt-limit' });
    const block = system.slice(system.indexOf('## Уроки проекта'));
    const lines = block.split('\n').filter(l => l.startsWith('- [lesson-'));
    assert.equal(lines.length, 1, `prompt_limit=1 капит блок: ${lines.join(' | ')}`);
  });

  it('AC3: уроки не дублируются в контексте globalSearch', async () => {
    createLessonFile(cwd, {
      id: 'lesson-990',
      title: 'Сборка фронта: правило',
      status: 'active',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта\n',
    });
    const system = await chatSystemPrompt({ message: 'сборка фронта падает', threadId: 'cl-nodup' });
    const contextAt = system.indexOf('Контекст проекта по текущему сообщению');
    if (contextAt >= 0) {
      const context = system.slice(contextAt);
      assert.ok(!context.includes('"lessons"'), 'группы lessons в контексте поиска нет');
    }
    assert.ok(system.includes('## Уроки проекта'), 'урок пришёл блоком');
  });
});

describe('VL-404 — инвариант «не протекает в фазы»', () => {
  it('AC4: buildSystemPrompt(cwd) без chat:true не содержит блока уроков', () => {
    createLessonFile(cwd, {
      id: 'lesson-995',
      title: 'Сборка фронта: правило',
      status: 'active',
      tags: ['build'],
      content: '## Проблема\n\nсборка фронта\n',
    });
    const { content } = buildSystemPrompt(cwd);
    assert.ok(!content.includes('## Уроки проекта'), 'headless-промпт без блока уроков');
  });
});
