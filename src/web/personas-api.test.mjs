/**
 * Тесты CRUD ролей через REST API (VL-403, AC8/AC9).
 *
 * Покрываем:
 * - GET /api/personas/:id — полные данные: метаданные + ТЕКСТ промпта и
 *   ТЕКСТ памяти (в списке текстов нет);
 * - PUT /api/personas/:id — правка label/description/default_status/
 *   allow_tools/промпта/памяти; встроенная роль переопределяется;
 * - POST /api/personas — создание проектной роли: запись в chat_personas +
 *   файл промпта;
 * - DELETE /api/personas/:id — только проектные, файлы остаются;
 * - валидация ДО записи: пустой label, дубль id, неизвестный default_status,
 *   неизвестный инструмент, память сверх лимита → 400, файл не меняется;
 * - чужие секции settings.json (models, workflows, mcpServers) целы.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-personas-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  rmSync(join(cwd, 'backlog'), { recursive: true, force: true });
  seedProject();
});

/** Минимальный backlog-проект: конфиг со statuses нужен валидации default_status. */
function seedProject(statuses = ['To Do', 'Spec', 'Planned', 'In Progress', 'Done']) {
  mkdirSync(join(cwd, 'backlog'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    ['project_name: Test', 'task_prefix: TS', 'statuses:', ...statuses.map(s => `  - ${s}`)].join('\n') + '\n',
    'utf-8',
  );
}

function settingsPath() {
  return join(cwd, '.vibelog', 'settings.json');
}

function readSettings() {
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'));
}

function writeSettings(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function promptPath(name) {
  return join(cwd, '.vibelog', 'prompts', 'personas', `${name}.md`);
}

function memoryPath(name) {
  return join(cwd, '.vibelog', 'prompts', 'personas', `${name}.memory.md`);
}

function writeProjectPrompt(name, text) {
  mkdirSync(join(cwd, '.vibelog', 'prompts', 'personas'), { recursive: true });
  writeFileSync(promptPath(name), text, 'utf-8');
}

/** settings.json с чужими секциями — проверяем, что они целы после записи. */
const foreignSettings = () => ({
  models: { default: 'routerai/mimo/pro', available: { 'routerai/mimo/pro': { label: 'MiMo' } } },
  workflows: { custom: { initial_status: 'Spec' } },
  mcpServers: { local: { command: 'node' } },
  chat_personas: {
    researcher: { label: 'Ресёрчер', description: 'Ищет', prompt: 'researcher' },
  },
});

describe('GET /api/personas/:id (AC8)', () => {
  it('отдаёт метаданные, текст промпта и текст памяти', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'Ты — ресёрчер.');
    writeFileSync(memoryPath('researcher'), '- Любит краткость. (2026-11-10)\n', 'utf-8');

    const res = handleApi('GET', '/api/personas/researcher', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.persona.id, 'researcher');
    assert.equal(res.body.persona.label, 'Ресёрчер');
    assert.equal(res.body.persona.builtin, false);
    assert.equal(res.body.promptText, 'Ты — ресёрчер.');
    assert.match(res.body.memoryText, /Любит краткость/);
    assert.equal(res.body.memory.limit, 2500);
    assert.equal(res.body.memory.truncated, false);
    assert.ok(res.body.statuses.includes('Spec'));
    assert.ok(Array.isArray(res.body.tools) && res.body.tools.length > 0);
  });

  it('встроенная роль: builtin=true, текст из шаблона пакета', () => {
    const res = handleApi('GET', '/api/personas/helper', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.persona.builtin, true);
    assert.ok(res.body.promptText.length > 0);
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('GET', '/api/personas/ghost', null, cwd);
    assert.equal(res.status, 404);
  });

  it('список по-прежнему без текстов промптов', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'Секретный текст.');
    const res = handleApi('GET', '/api/personas', null, cwd);
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes('Секретный текст.'));
  });
});

describe('POST /api/personas — создание проектной роли (AC4)', () => {
  it('создаёт запись в chat_personas и файл промпта', () => {
    writeSettings(foreignSettings());
    const res = handleApi(
      'POST',
      '/api/personas',
      {
        id: 'psychologist',
        label: 'Психолог',
        description: 'Личные дела',
        promptText: 'Ты — психолог.',
        defaultStatus: 'Spec',
      },
      cwd,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.persona.id, 'psychologist');
    assert.equal(res.body.persona.builtin, false);

    const stored = readSettings();
    assert.deepEqual(stored.chat_personas.psychologist, {
      label: 'Психолог',
      prompt: 'psychologist',
      description: 'Личные дела',
      default_status: 'Spec',
    });
    assert.equal(readFileSync(promptPath('psychologist'), 'utf-8').trim(), 'Ты — психолог.');
    // Чужие секции целы
    assert.deepEqual(stored.models, foreignSettings().models);
    assert.deepEqual(stored.workflows, foreignSettings().workflows);
    assert.deepEqual(stored.mcpServers, foreignSettings().mcpServers);
    assert.ok(stored.chat_personas.researcher);
  });

  it('роль появляется в реестре (пикер чата)', () => {
    writeSettings(foreignSettings());
    handleApi('POST', '/api/personas', { id: 'coach', label: 'Коуч', promptText: 'Ты — коуч.' }, cwd);
    const list = handleApi('GET', '/api/personas', null, cwd);
    assert.ok(list.body.personas.some(p => p.id === 'coach'));
  });

  it('дубль id проектной роли → 400, файл не меняется', () => {
    writeSettings(foreignSettings());
    const before = readSettings();
    const res = handleApi(
      'POST',
      '/api/personas',
      { id: 'researcher', label: 'Другой', promptText: 'x' },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /уже существует/);
    assert.deepEqual(readSettings(), before);
  });

  it('дубль id встроенной роли → 400', () => {
    writeSettings(foreignSettings());
    const res = handleApi('POST', '/api/personas', { id: 'helper', label: 'X', promptText: 'x' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /встроенной/);
  });

  it('зарезервированный id (RETIRED_PERSONA_IDS) → 400', () => {
    writeSettings(foreignSettings());
    const res = handleApi(
      'POST',
      '/api/personas',
      { id: 'orchestrator', label: 'X', promptText: 'x' },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /зарезервирован/);
  });

  it('недопустимый id (путь, заглавные) → 400', () => {
    writeSettings(foreignSettings());
    for (const id of ['../evil', 'Bad Id', 'a/b', '']) {
      const res = handleApi('POST', '/api/personas', { id, label: 'X', promptText: 'x' }, cwd);
      assert.equal(res.status, 400, `id=${JSON.stringify(id)}`);
    }
    assert.ok(!existsSync(join(cwd, '.vibelog', 'prompts', 'personas', '..', 'evil.md')));
  });

  it('пустой label → 400, файл промпта не создан', () => {
    writeSettings(foreignSettings());
    const res = handleApi(
      'POST',
      '/api/personas',
      { id: 'empty', label: '   ', promptText: 'x' },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /label/);
    assert.ok(!existsSync(promptPath('empty')));
  });

  it('пустой promptText → 400', () => {
    writeSettings(foreignSettings());
    const res = handleApi('POST', '/api/personas', { id: 'noprompt', label: 'X', promptText: '  ' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /promptText/);
  });

  it('неизвестный default_status → 400, ничего не записано', () => {
    writeSettings(foreignSettings());
    const before = readSettings();
    const res = handleApi(
      'POST',
      '/api/personas',
      { id: 'badstatus', label: 'X', promptText: 'x', defaultStatus: 'Ghost' },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Ghost/);
    assert.deepEqual(readSettings(), before);
    assert.ok(!existsSync(promptPath('badstatus')));
  });
});

describe('PUT /api/personas/:id — правка роли (AC3/AC6/AC7)', () => {
  it('правка label/description/default_status проектной роли', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'Ты — ресёрчер.');
    const res = handleApi(
      'PUT',
      '/api/personas/researcher',
      { label: 'Исследователь', description: 'Копает', defaultStatus: 'Planned' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.persona.label, 'Исследователь');
    const stored = readSettings();
    assert.equal(stored.chat_personas.researcher.label, 'Исследователь');
    assert.equal(stored.chat_personas.researcher.default_status, 'Planned');
    assert.equal(stored.chat_personas.researcher.prompt, 'researcher');
    assert.deepEqual(stored.models, foreignSettings().models);
  });

  it('встроенная роль переопределяется (запись в chat_personas), prompt сохраняется', () => {
    writeSettings(foreignSettings());
    const res = handleApi('PUT', '/api/personas/helper', { label: 'Ассистент' }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.persona.builtin, true);
    const stored = readSettings();
    assert.equal(stored.chat_personas.helper.label, 'Ассистент');
    assert.equal(stored.chat_personas.helper.prompt, 'helper');
    // Реестр видит переопределение
    const list = handleApi('GET', '/api/personas', null, cwd);
    const helper = list.body.personas.find(p => p.id === 'helper');
    assert.equal(helper.label, 'Ассистент');
  });

  it('правка промпта пишет файл в .vibelog/prompts/personas/', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'Старый текст.');
    const res = handleApi('PUT', '/api/personas/researcher', { promptText: 'Новый текст.' }, cwd);
    assert.equal(res.status, 200);
    assert.equal(readFileSync(promptPath('researcher'), 'utf-8').trim(), 'Новый текст.');
    assert.equal(res.body.promptText, 'Новый текст.');
  });

  it('правка памяти пишет файл *.memory.md', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'x');
    const res = handleApi(
      'PUT',
      '/api/personas/researcher',
      { memoryText: '- Любит краткость. (2026-11-10)' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.match(readFileSync(memoryPath('researcher'), 'utf-8'), /Любит краткость/);
    assert.equal(res.body.memory.chars > 0, true);
  });

  it('пустая память удаляет файл', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'x');
    writeFileSync(memoryPath('researcher'), '- Запись. (2026-11-10)\n', 'utf-8');
    const res = handleApi('PUT', '/api/personas/researcher', { memoryText: '' }, cwd);
    assert.equal(res.status, 200);
    assert.ok(!existsSync(memoryPath('researcher')));
  });

  it('память сверх лимита → 400, файл не меняется (AC7)', () => {
    writeSettings({ ...foreignSettings(), persona_memory: { max_chars: 20 } });
    writeProjectPrompt('researcher', 'x');
    writeFileSync(memoryPath('researcher'), '- Старая. (2026-11-10)\n', 'utf-8');
    const before = readFileSync(memoryPath('researcher'), 'utf-8');
    const res = handleApi(
      'PUT',
      '/api/personas/researcher',
      { memoryText: 'а'.repeat(50) },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /превышает лимит 20/);
    assert.equal(readFileSync(memoryPath('researcher'), 'utf-8'), before);
  });

  it('пустой label → 400, settings.json не меняется', () => {
    writeSettings(foreignSettings());
    const before = readSettings();
    const res = handleApi('PUT', '/api/personas/researcher', { label: '  ' }, cwd);
    assert.equal(res.status, 400);
    assert.deepEqual(readSettings(), before);
  });

  it('неизвестный default_status → 400', () => {
    writeSettings(foreignSettings());
    const res = handleApi('PUT', '/api/personas/researcher', { defaultStatus: 'Ghost' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Ghost/);
  });

  it('неизвестный инструмент в allow_tools → 400', () => {
    writeSettings(foreignSettings());
    const res = handleApi(
      'PUT',
      '/api/personas/researcher',
      { allowTools: ['read_file', 'ghost_tool'] },
      cwd,
    );
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ghost_tool/);
  });

  it('валидный allow_tools сохраняется', () => {
    writeSettings(foreignSettings());
    const res = handleApi(
      'PUT',
      '/api/personas/researcher',
      { allowTools: ['read_file', 'search_files'] },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.deepEqual(readSettings().chat_personas.researcher.allow_tools, [
      'read_file',
      'search_files',
    ]);
  });

  it('неизвестный id → 404', () => {
    writeSettings(foreignSettings());
    const res = handleApi('PUT', '/api/personas/ghost', { label: 'X' }, cwd);
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/personas/:id (AC5/AC6)', () => {
  it('удаляет проектную роль из chat_personas, файлы остаются', () => {
    writeSettings(foreignSettings());
    writeProjectPrompt('researcher', 'Текст.');
    writeFileSync(memoryPath('researcher'), '- Запись. (2026-11-10)\n', 'utf-8');

    const res = handleApi('DELETE', '/api/personas/researcher', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 'researcher');
    assert.match(res.body.promptPath, /researcher\.md$/);
    assert.match(res.body.memoryPath, /researcher\.memory\.md$/);

    const stored = readSettings();
    assert.equal(stored.chat_personas.researcher, undefined);
    // Файлы НЕ удалены (риск R4 плана)
    assert.ok(existsSync(promptPath('researcher')));
    assert.ok(existsSync(memoryPath('researcher')));
    // Чужие секции целы
    assert.deepEqual(stored.models, foreignSettings().models);
  });

  it('встроенную роль удалить нельзя → 400', () => {
    writeSettings(foreignSettings());
    const before = readSettings();
    const res = handleApi('DELETE', '/api/personas/helper', null, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /встроенная/);
    assert.deepEqual(readSettings(), before);
  });

  it('неизвестный id → 404', () => {
    writeSettings(foreignSettings());
    const res = handleApi('DELETE', '/api/personas/ghost', null, cwd);
    assert.equal(res.status, 404);
  });
});
