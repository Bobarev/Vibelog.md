/**
 * Тесты VL-401 — память персоны веб-чата.
 *
 * Память — файл `.vibelog/prompts/personas/<prompt>.memory.md` рядом с
 * промптом роли: личные заметки о пользователе (как с ним разговаривать,
 * что он не любит), которые переживают тред. В git не едут (личная
 * информация), в headless-фазы не подставляются.
 *
 * Покрыто:
 * - чтение файла и подстановка блоком `## Память персоны` в системный промпт
 *   чата (между блоком роли и контекстом поиска);
 * - отсутствие файла — норма: блока нет вовсе (не «(пусто)»);
 * - превышение лимита: обрезка по границе строки + явная пометка, а не
 *   молчаливая потеря;
 * - лимит из settings.json (`persona_memory.max_chars`), битое значение →
 *   дефолт + сообщение в errors;
 * - `GET /api/personas` отдаёт состояние памяти без текста;
 * - инвариант «не протекает в фазы»: `buildSystemPrompt(cwd)` без `chat: true`
 *   не содержит ни текста памяти, ни заголовка блока (VL-238/lesson-134);
 * - git-исключение `prompts/personas/*.memory.md` при живом `!prompts/**`
 *   (проверка по факту индексации, lesson-243).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  PERSONA_MEMORY_DEFAULT_MAX_CHARS,
  PERSONA_MEMORY_SUFFIX,
  listPersonas,
  loadPersonaMemory,
  loadPersonas,
  readPersonaMemoryLimit,
  resolvePersona,
} from '../../dist/web/personas.js';
import { runChat } from '../../dist/web/chat.js';
import { handleApi } from '../../dist/web/api.js';
import { buildSystemPrompt } from '../../dist/agent/system-prompt.js';
import { writeVibelogGitignore } from '../../dist/core/gitignore.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { zeroUsage } from '../../dist/agent/llm.js';

let cwd;

/** Минимальный backlog-проект (конфиг со statuses нужен валидации ролей). */
function seedProject() {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Persona Memory Test',
      task_prefix: 'pm',
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

/** Файл памяти персоны: .vibelog/prompts/personas/<name>.memory.md */
function writeMemory(name, text) {
  const dir = join(cwd, '.vibelog', 'prompts', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}${PERSONA_MEMORY_SUFFIX}`), text, 'utf-8');
}

/** Проектный промпт роли (чтобы не зависеть от встроенных шаблонов). */
function writeProjectPrompt(name, text) {
  const dir = join(cwd, '.vibelog', 'prompts', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), text, 'utf-8');
}

/** Подменный LLM (паттерн chat.test.mjs): запоминает system-промпт вызова. */
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
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-persona-memory-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  seedProject();
});

describe('VL-401 — чтение памяти персоны', () => {
  it('AC1: файл читается по имени из поля prompt роли', () => {
    writeProjectPrompt('helper', 'Ты — помощник.');
    writeMemory('helper', '- Не использовать англицизмы без перевода. (2026-11-10)\n');
    const persona = resolvePersona(cwd, 'helper');
    const memory = loadPersonaMemory(cwd, persona);
    assert.equal(memory.exists, true);
    assert.equal(memory.truncated, false);
    assert.match(memory.text, /Не использовать англицизмы/);
    assert.equal(memory.chars, memory.text.length);
  });

  it('AC1: отсутствие файла — норма, пустой текст и exists:false', () => {
    const persona = resolvePersona(cwd, 'helper');
    const memory = loadPersonaMemory(cwd, persona);
    assert.deepEqual(memory, { text: '', chars: 0, truncated: false, exists: false });
  });

  it('AC1: имя файла берётся из prompt, а не из id роли', () => {
    writeSettings({
      chat_personas: { researcher: { label: 'Ресёрчер', prompt: 'researcher-prompt' } },
    });
    writeProjectPrompt('researcher-prompt', 'Ищи источники.');
    writeMemory('researcher-prompt', '- Любит короткие ответы. (2026-11-10)');
    const memory = loadPersonaMemory(cwd, resolvePersona(cwd, 'researcher'));
    assert.equal(memory.exists, true);
    assert.match(memory.text, /короткие ответы/);
  });

  it('AC1: пустой файл памяти считается отсутствующей памятью', () => {
    writeMemory('helper', '   \n\n');
    const memory = loadPersonaMemory(cwd, resolvePersona(cwd, 'helper'));
    assert.equal(memory.exists, false);
    assert.equal(memory.text, '');
  });
});

describe('VL-401 — подстановка в системный промпт чата', () => {
  it('AC2: блок «## Память персоны» между блоком роли и контекстом поиска', async () => {
    writeProjectPrompt('helper', 'Ты — помощник проекта.');
    writeMemory('helper', '- Объясняй термины. (2026-11-10)');
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'mem-order' });
    assert.ok(system.includes('## Память персоны'), 'блок памяти в промпте');
    assert.ok(system.includes('Объясняй термины'), 'текст памяти в промпте');
    const roleAt = system.indexOf('## Текущая роль');
    const memoryAt = system.indexOf('## Память персоны');
    assert.ok(roleAt >= 0 && memoryAt > roleAt, 'память идёт после блока роли');
  });

  it('AC2: без файла памяти блок не добавляется вовсе', async () => {
    writeProjectPrompt('helper', 'Ты — помощник проекта.');
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'mem-absent' });
    assert.ok(!system.includes('## Память персоны'), 'заголовка блока нет');
    assert.ok(!system.includes('(пусто)'), 'пустая память не даёт шума');
  });

  it('AC2: память одной роли не подставляется другой', async () => {
    writeProjectPrompt('helper', 'Ты — помощник проекта.');
    writeProjectPrompt('architect', 'Ты — архитектор проекта.');
    writeMemory('helper', '- Только для помощника. (2026-11-10)');
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'mem-arch', persona: 'architect' });
    assert.ok(!system.includes('Только для помощника'));
    assert.ok(!system.includes('## Память персоны'));
  });
});

describe('VL-401 — лимит размера памяти', () => {
  it('AC3: дефолт 2500 символов без секции persona_memory', () => {
    assert.equal(readPersonaMemoryLimit(cwd), PERSONA_MEMORY_DEFAULT_MAX_CHARS);
    assert.equal(PERSONA_MEMORY_DEFAULT_MAX_CHARS, 2500);
  });

  it('AC3: лимит читается из settings.json (persona_memory.max_chars)', () => {
    writeSettings({ persona_memory: { max_chars: 100 } });
    assert.equal(readPersonaMemoryLimit(cwd), 100);
  });

  it('AC3: битое значение → дефолт + сообщение в errors, чат не падает', () => {
    for (const bad of ['abc', 0, -5, null]) {
      writeSettings({ persona_memory: { max_chars: bad } });
      const errors = [];
      assert.equal(readPersonaMemoryLimit(cwd, errors), PERSONA_MEMORY_DEFAULT_MAX_CHARS);
      assert.equal(errors.length, 1, `значение ${JSON.stringify(bad)} должно дать ошибку`);
      assert.match(errors[0], /persona_memory\.max_chars/);
    }
  });

  it('AC3: секция persona_memory не объект → дефолт + ошибка', () => {
    writeSettings({ persona_memory: 'много' });
    const errors = [];
    assert.equal(readPersonaMemoryLimit(cwd, errors), PERSONA_MEMORY_DEFAULT_MAX_CHARS);
    assert.match(errors[0], /persona_memory должна быть объектом/);
  });

  it('AC4: превышение лимита — обрезка по границе строки и явная пометка', () => {
    writeSettings({ persona_memory: { max_chars: 60 } });
    const lines = [
      '- Первая заметка о пользователе. (2026-11-10)',
      '- Вторая заметка о пользователе. (2026-11-10)',
      '- Третья заметка о пользователе. (2026-11-10)',
    ];
    writeMemory('helper', lines.join('\n'));
    const errors = [];
    const memory = loadPersonaMemory(cwd, resolvePersona(cwd, 'helper'), errors);
    assert.equal(memory.truncated, true);
    assert.equal(memory.exists, true);
    assert.ok(memory.chars > 60, 'chars — полный размер файла');
    assert.match(memory.text, /\[память обрезана: показано \d+ из \d+ символов — почистите файл\]/);
    // Обрезка по \n: первая строка цела, вторая не обрублена посередине
    assert.ok(memory.text.startsWith(lines[0]), memory.text);
    assert.ok(!memory.text.includes('Вторая заметка о пользователе. (2026-11-10)'), 'вторая строка не влезла целиком');
    assert.ok(errors.some(e => /превышает лимит 60/.test(e)), 'предупреждение в errors');
  });

  it('AC4: в промпт уходит обрезанный блок с пометкой', async () => {
    writeSettings({ persona_memory: { max_chars: 40 } });
    writeProjectPrompt('helper', 'Ты — помощник проекта.');
    writeMemory('helper', '- Заметка номер один. (2026-11-10)\n- Заметка номер два. (2026-11-10)');
    const system = await chatSystemPrompt({ message: 'привет', threadId: 'mem-trunc' });
    assert.ok(system.includes('## Память персоны'));
    assert.match(system, /память обрезана/);
  });

  it('AC4: память в пределах лимита не помечается', () => {
    writeSettings({ persona_memory: { max_chars: 500 } });
    writeMemory('helper', '- Короткая заметка. (2026-11-10)');
    const memory = loadPersonaMemory(cwd, resolvePersona(cwd, 'helper'));
    assert.equal(memory.truncated, false);
    assert.doesNotMatch(memory.text, /память обрезана/);
  });
});

describe('VL-401 — GET /api/personas: состояние памяти без текста', () => {
  it('AC6: memory {exists, chars, truncated} для каждой роли, текста нет', () => {
    writeMemory('helper', '- Личная заметка о пользователе. (2026-11-10)');
    const res = handleApi('GET', '/api/personas', null, cwd);
    assert.equal(res.status, 200);
    const helper = res.body.personas.find(p => p.id === 'helper');
    assert.equal(helper.memory.exists, true);
    assert.ok(helper.memory.chars > 0);
    assert.equal(helper.memory.truncated, false);
    const architect = res.body.personas.find(p => p.id === 'architect');
    assert.deepEqual(architect.memory, { exists: false, chars: 0, truncated: false });
    assert.ok(!JSON.stringify(res.body).includes('Личная заметка'), 'текст памяти не отдаётся');
  });

  it('AC4/AC6: превышение лимита видно в API как truncated + предупреждение в errors', () => {
    writeSettings({ persona_memory: { max_chars: 20 } });
    writeMemory('helper', '- Очень длинная личная заметка о пользователе. (2026-11-10)');
    const res = handleApi('GET', '/api/personas', null, cwd);
    const helper = res.body.personas.find(p => p.id === 'helper');
    assert.equal(helper.memory.truncated, true);
    assert.ok(res.body.errors.some(e => /превышает лимит 20/.test(e)));
  });

  it('AC6: listPersonas отдаёт memory, но не текст', () => {
    writeMemory('helper', '- Заметка. (2026-11-10)');
    const { personas } = listPersonas(cwd);
    assert.ok(personas.every(p => p.memory && typeof p.memory.exists === 'boolean'));
    assert.ok(!JSON.stringify(personas).includes('Заметка.'));
  });
});

describe('VL-401 — инвариант «память не протекает в фазы»', () => {
  it('AC2: buildSystemPrompt(cwd) без chat:true не содержит памяти', () => {
    writeMemory('helper', '- Уникальный маркер памяти персоны. (2026-11-10)');
    const { content } = buildSystemPrompt(cwd);
    assert.ok(!content.includes('Уникальный маркер памяти персоны'), 'текст памяти не протёк');
    assert.ok(!content.includes('## Память персоны'), 'заголовок блока не протёк');
  });

  it('AC2: реестр ролей не подмешивает память в промпт роли', () => {
    writeMemory('helper', '- Уникальный маркер памяти персоны. (2026-11-10)');
    const { personas } = loadPersonas(cwd);
    assert.ok(!JSON.stringify(personas).includes('Уникальный маркер'));
  });
});

describe('VL-401 — git-исключение памяти персон', () => {
  it('AC5: *.memory.md не индексируется, промпт роли и settings.json — индексируются', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-persona-memory-git-'));
    try {
      spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
      writeVibelogGitignore(dir);
      mkdirSync(join(dir, '.vibelog', 'prompts', 'personas'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'prompts', 'personas', 'helper.md'), 'Ты — помощник.', 'utf-8');
      writeFileSync(
        join(dir, '.vibelog', 'prompts', 'personas', 'helper.memory.md'),
        '- Личное. (2026-11-10)',
        'utf-8',
      );
      writeFileSync(join(dir, '.vibelog', 'settings.json'), '{}\n', 'utf-8');

      // Политику проверяем по факту индексации, а не через check-ignore -q
      // (lesson-243: на git 2.24 отрицания дают ложный «игнорируется»).
      spawnSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
      const tracked = spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf-8' })
        .stdout.split('\n')
        .filter(l => l !== '');

      assert.ok(
        !tracked.includes('.vibelog/prompts/personas/helper.memory.md'),
        'память персоны не должна попадать в git',
      );
      assert.ok(
        tracked.includes('.vibelog/prompts/personas/helper.md'),
        'промпт роли по-прежнему коммитится (!prompts/** не сломан)',
      );
      assert.ok(tracked.includes('.vibelog/settings.json'), 'settings.json коммитится');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('VL-419 — раздел «Память» в шаблонах ролей (критерий — роль-специфика)', () => {
  /** Исходник шаблона относительно тест-файла (паттерн tool-policy.test.mjs). */
  function templateSrc(rel) {
    return readFileSync(fileURLToPath(new URL(`../../templates/prompts/${rel}`, import.meta.url)), 'utf8');
  }

  const cases = [
    ['helper', /СТИЛЕ ОБЩЕНИЯ/i, /разовые факты.*не запоминай/i],
    ['architect', /формат плана/, /lessons и decisions/],
    ['supervisor', /видеть прогон/, /settings\.json/],
    ['workflow-designer', /workflow_get/, /процессе проекта/],
  ];

  for (const [name, criterion, guard] of cases) {
    it(`AC2: personas/${name}.md содержит «## Память» со своим критерием`, () => {
      const src = templateSrc(`personas/${name}.md`);
      const at = src.indexOf('## Память');
      assert.ok(at >= 0, 'раздел «## Память» есть');
      const next = src.indexOf('\n## ', at + 1);
      const section = src.slice(at, next < 0 ? undefined : next);
      assert.match(section, criterion, 'критерий специфичен для роли');
      assert.match(section, guard, 'граница критерия зафиксирована');
    });
  }

  it('AC1: chat-system.md — только механизм, критерий «что запоминать» вынесен', () => {
    const paragraph = templateSrc('chat-system.md')
      .split('\n')
      .find(l => l.startsWith('Память персоны'));
    assert.ok(paragraph, 'абзац «Память персоны» на месте');
    assert.match(paragraph, /сказано в промпте твоей роли/, 'критерий отослан к роли');
    assert.ok(!paragraph.includes('СТИЛЯ ОБЩЕНИЯ'), 'критерий стиля высен из общего шаблона');
    assert.ok(!paragraph.includes('разовые факты'), 'критерий разовых фактов вынесен');
    assert.ok(!paragraph.includes('когда пользователь поправляет'), 'старый критерий удалён');
  });
});
