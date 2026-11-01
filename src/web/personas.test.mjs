/**
 * Тесты реестра ролей веб-чата (VL-265): src/web/personas.ts + GET /api/personas.
 *
 * Покрываем: встроенные роли без секции chat_personas, переопределение
 * дефолтной роли, добавление проектной, невалидную секцию (не объект /
 * без label / без prompt), валидацию allow_tools и default_status,
 * fail-closed резолвер промпта и приоритет проектного шаблона,
 * resolveDefaultStatus и GET /api/personas (без текстов промптов).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA_ID,
  listPersonas,
  loadPersonaPrompt,
  loadPersonas,
  resolveDefaultStatus,
  resolvePersona,
  validatePersonasConfig,
} from '../../dist/web/personas.js';
import { handleApi } from '../../dist/web/api.js';

let cwd;

/** Минимальный backlog-проект: конфиг со statuses нужен валидации default_status. */
function seedProject(statuses = ['To Do', 'Spec', 'Planned', 'In Progress', 'Done']) {
  mkdirSync(join(cwd, 'backlog'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    ['project_name: Test', 'task_prefix: TS', 'statuses:', ...statuses.map(s => `  - ${s}`)].join('\n') + '\n',
    'utf-8',
  );
}

/** Запись секции chat_personas в settings.json. */
function writePersonas(chatPersonas) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify({ chat_personas: chatPersonas }, null, 2)}\n`,
    'utf-8',
  );
}

/** Проектный шаблон роли: .vibelog/prompts/personas/<name>.md */
function writeProjectPrompt(name, text) {
  const dir = join(cwd, '.vibelog', 'prompts', 'personas');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), text, 'utf-8');
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-personas-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  seedProject();
});

describe('реестр ролей: встроенные (AC9)', () => {
  it('без секции chat_personas доступны 3 встроенные роли с label и default_status', () => {
    const { personas, errors } = loadPersonas(cwd);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      personas.map(p => p.id),
      ['helper', 'architect', 'orchestrator', 'supervisor'],
    );
    const helper = personas.find(p => p.id === 'helper');
    assert.equal(helper.label, 'Помощник');
    assert.equal(helper.defaultStatus, 'Spec');
    assert.equal(personas.find(p => p.id === 'architect').defaultStatus, 'Planned');
    assert.equal(DEFAULT_PERSONA_ID, 'helper');
    assert.equal(BUILTIN_PERSONAS.length, 4);
  });

  it('resolvePersona: известный id → роль, неизвестный → null', () => {
    assert.equal(resolvePersona(cwd, 'architect').label, 'Архитектор');
    assert.equal(resolvePersona(cwd, 'nope'), null);
  });
});

describe('реестр ролей: секция chat_personas (AC8)', () => {
  it('переопределяет встроенную роль по id и сохраняет порядок', () => {
    writePersonas({
      helper: { label: 'Ассистент', description: 'Свой помощник', prompt: 'helper', default_status: 'To Do' },
    });
    const { personas, errors } = loadPersonas(cwd);
    assert.deepEqual(errors, []);
    assert.equal(personas[0].id, 'helper');
    assert.equal(personas[0].label, 'Ассистент');
    assert.equal(personas[0].description, 'Свой помощник');
    assert.equal(personas[0].defaultStatus, 'To Do');
    // Встроенные поля, не перечисленные в секции, наследуются
    assert.equal(personas[0].defaultStatus, 'To Do');
    assert.equal(personas.length, 4);
  });

  it('добавляет проектную роль в конец реестра', () => {
    writePersonas({
      researcher: {
        label: 'Ресёрчер',
        description: 'Ищет информацию',
        prompt: 'researcher',
        default_status: 'Spec',
      },
    });
    writeProjectPrompt('researcher', 'Ищи источники и предлагай задачи.');
    const { personas, errors } = loadPersonas(cwd);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      personas.map(p => p.id),
      ['helper', 'architect', 'orchestrator', 'supervisor', 'researcher'],
    );
    const researcher = personas[4];
    assert.equal(researcher.label, 'Ресёрчер');
    assert.equal(loadPersonaPrompt(cwd, researcher), 'Ищи источники и предлагай задачи.');
  });

  it('секция не объект → понятная ошибка, встроенные роли живы', () => {
    writePersonas(['bad']);
    const { personas, errors } = loadPersonas(cwd);
    assert.equal(personas.length, 4);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /chat_personas должна быть объектом/);
    assert.deepEqual(validatePersonasConfig(cwd), errors);
  });

  it('роль без label / без prompt → ошибки с id, встроенные живы', () => {
    writePersonas({
      broken1: { prompt: 'broken1' },
      broken2: { label: 'Без промпта' },
    });
    const { personas, errors } = loadPersonas(cwd);
    assert.equal(personas.length, 4);
    assert.equal(errors.length, 2);
    assert.ok(errors.some(e => e.includes('"broken1"') && e.includes('label')));
    assert.ok(errors.some(e => e.includes('"broken2"') && e.includes('prompt')));
  });
});

describe('allow_tools: шов без фильтрации (AC10)', () => {
  it('валидный массив известных инструментов читается в роль', () => {
    writePersonas({
      researcher: {
        label: 'Ресёрчер',
        prompt: 'researcher',
        allow_tools: ['backlog_search', 'read_file', 'search_files'],
      },
    });
    const { personas, errors } = loadPersonas(cwd);
    assert.deepEqual(errors, []);
    assert.deepEqual(personas.find(p => p.id === 'researcher').allowTools, [
      'backlog_search',
      'read_file',
      'search_files',
    ]);
  });

  it('не массив и неизвестное имя инструмента → ошибки валидации', () => {
    writePersonas({
      a: { label: 'A', prompt: 'a', allow_tools: 'read_file' },
      b: { label: 'B', prompt: 'b', allow_tools: ['no_such_tool'] },
    });
    const { errors } = loadPersonas(cwd);
    assert.equal(errors.length, 2);
    assert.ok(errors.some(e => e.includes('allow_tools должен быть массивом')));
    assert.ok(errors.some(e => e.includes('неизвестный инструмент "no_such_tool"')));
  });
});

describe('default_status по роли (AC12)', () => {
  it('helper → Spec, architect → Planned, без роли → Spec', () => {
    assert.equal(resolveDefaultStatus(resolvePersona(cwd, 'helper')), 'Spec');
    assert.equal(resolveDefaultStatus(resolvePersona(cwd, 'architect')), 'Planned');
    assert.equal(resolveDefaultStatus(null), 'Spec');
  });

  it('невалидный default_status → ошибка, роль работает на дефолте роли', () => {
    writePersonas({ helper: { label: 'Помощник', prompt: 'helper', default_status: 'НетТакого' } });
    const { personas, errors } = loadPersonas(cwd);
    assert.ok(errors.some(e => e.includes('default_status "НетТакого"')));
    assert.equal(personas[0].defaultStatus, 'Spec');
  });

  it('default_status не строка → ошибка', () => {
    writePersonas({ helper: { label: 'Помощник', prompt: 'helper', default_status: 42 } });
    const { errors } = loadPersonas(cwd);
    assert.ok(errors.some(e => e.includes('default_status должен быть непустой строкой')));
  });
});

describe('резолвер промпта роли (AC6)', () => {
  it('встроенный шаблон читается из templates/prompts/personas', () => {
    const helper = resolvePersona(cwd, 'helper');
    const text = loadPersonaPrompt(cwd, helper);
    assert.ok(text.length > 0);
    assert.ok(text.includes('Помощник') || text.includes('helper'));
  });

  it('проектный шаблон приоритетнее встроенного', () => {
    writeProjectPrompt('architect', 'Свой архитектор.');
    assert.equal(loadPersonaPrompt(cwd, resolvePersona(cwd, 'architect')), 'Свой архитектор.');
  });

  it('отсутствие шаблона → fail-closed с обоими путями и id роли', () => {
    writePersonas({ ghost: { label: 'Призрак', prompt: 'no-such-prompt-file' } });
    const ghost = resolvePersona(cwd, 'ghost');
    assert.throws(
      () => loadPersonaPrompt(cwd, ghost),
      err => {
        assert.match(err.message, /Шаблон роли "ghost" не найден/);
        assert.match(err.message, /no-such-prompt-file\.md/);
        assert.match(err.message, /\(проект\)/);
        assert.match(err.message, /\(пакет\)/);
        return true;
      },
    );
  });
});

describe('GET /api/personas (AC13)', () => {
  const get = () => handleApi('GET', '/api/personas', null, cwd);

  it('отдаёт id/label/description и дефолт helper, без текстов промптов', () => {
    writePersonas({
      researcher: { label: 'Ресёрчер', description: 'Ищет информацию', prompt: 'researcher' },
    });
    writeProjectPrompt('researcher', 'Секретный текст промпта.');
    const res = get();
    assert.equal(res.status, 200);
    assert.equal(res.body.default, 'helper');
    assert.deepEqual(res.body.errors, []);
    assert.deepEqual(
      res.body.personas.map(p => p.id),
      ['helper', 'architect', 'orchestrator', 'supervisor', 'researcher'],
    );
    assert.ok(res.body.personas.every(p => p.prompt === undefined));
    assert.ok(!JSON.stringify(res.body).includes('Секретный текст промпта'));
    assert.equal(res.body.personas[4].description, 'Ищет информацию');
  });

  it('невалидная секция → 200 с ошибками в errors (чат не падает)', () => {
    writePersonas({ broken: { prompt: 'broken' } });
    const res = get();
    assert.equal(res.status, 200);
    assert.ok(res.body.errors.length >= 1);
    assert.equal(res.body.personas.length, 4);
  });

  it('listPersonas отдаёт сводки без prompt/allowTools', () => {
    const { personas } = listPersonas(cwd);
    assert.ok(personas.every(p => Object.keys(p).every(k => ['id', 'label', 'description'].includes(k))));
  });
});
