/**
 * Тесты REST API конфига проекта (VL-165): GET/PUT /api/config.
 *
 * Проверяют контракт страницы «Конфиг проекта»:
 * - GET отдаёт config.yml как есть;
 * - PUT валидирует зеркало CLI config set (400 на мусор, файл не меняется);
 * - PUT пишет через saveConfig — патч применяется к существующему конфигу;
 * - связка default_status ∈ statuses проверяется по итоговому конфигу.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';
import { parseYaml, stringifyYaml } from '../../dist/core/yaml.js';

let cwd;

/** Прямое чтение config.yml (то, что реально на диске). */
function readFileConfig() {
  return parseYaml(readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8'));
}

/** Прямая запись config.yml (подготовка данных). */
function writeFixtureConfig(config) {
  mkdirSync(join(cwd, 'backlog'), { recursive: true });
  const yaml = stringifyYaml(config);
  writeFileSync(join(cwd, 'backlog', 'config.yml'), yaml, 'utf-8');
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-config-api-'));
  // findBacklogDir ищет вверх по дереву — фикстура должна быть в самом tmp
  writeFixtureConfig({
    project_name: 'test-project',
    task_prefix: 'TST',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'task'],
    definition_of_done: ['Тесты проходят'],
    auto_commit: false,
    default_port: 6420,
  });
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/config (VL-165)', () => {
  it('отдаёт конфиг с диска', () => {
    const res = handleApi('GET', '/api/config', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.project_name, 'test-project');
    assert.equal(res.body.task_prefix, 'TST');
    assert.deepEqual(res.body.statuses, ['To Do', 'In Progress', 'Done']);
  });
});

describe('PUT /api/config (VL-165)', () => {
  it('валидный патч → 200, config.yml обновлён read-modify-write', () => {
    const res = handleApi('PUT', '/api/config', { max_column_width: 30, labels: ['ui'] }, cwd);
    assert.equal(res.status, 200);
    // Файл на диске реально изменился
    const onDisk = readFileConfig();
    assert.equal(onDisk.max_column_width, 30);
    assert.deepEqual(onDisk.labels, ['ui']);
    // Не переданные ключи сохранены (read-modify-write, не перезапись дефолтами)
    assert.equal(onDisk.project_name, 'test-project');
    assert.equal(onDisk.task_prefix, 'TST');
    // Ответ — свежий конфиг с диска
    assert.equal(res.body.max_column_width, 30);
  });

  it('неизвестный ключ → 400, файл не меняется', () => {
    const before = readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8');
    const res = handleApi('PUT', '/api/config', { evil_key: 'x' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Неизвестный ключ конфига: evil_key/);
    assert.equal(readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8'), before);
  });

  it('auto_commit строкой → 400 (строго boolean)', () => {
    const res = handleApi('PUT', '/api/config', { auto_commit: 'yes' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /auto_commit.*boolean/);
  });

  it('массив с нестроками → 400', () => {
    const res = handleApi('PUT', '/api/config', { statuses: ['To Do', 42] }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /statuses.*массив непустых строк/);
  });

  it('пустой элемент массива → 400', () => {
    const res = handleApi('PUT', '/api/config', { priorities: ['High', ' '] }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /priorities/);
  });

  it('неположительное число → 400', () => {
    const res = handleApi('PUT', '/api/config', { default_port: 0 }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /default_port.*положительное число/);
  });

  it('default_status вне итоговых statuses → 400, файл не меняется', () => {
    const before = readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8');
    const res = handleApi('PUT', '/api/config', { default_status: 'NoSuch' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /default_status "NoSuch" отсутствует в statuses/);
    assert.equal(readFileSync(join(cwd, 'backlog', 'config.yml'), 'utf-8'), before);
  });

  it('default_status + statuses патчем разом → 200 (связка по итоговому конфигу)', () => {
    const res = handleApi(
      'PUT',
      '/api/config',
      { default_status: 'In Progress', statuses: ['To Do', 'In Progress'] },
      cwd
    );
    assert.equal(res.status, 200);
    const onDisk = readFileConfig();
    assert.equal(onDisk.default_status, 'In Progress');
    assert.deepEqual(onDisk.statuses, ['To Do', 'In Progress']);
  });

  it('default_editor допускает пустую строку (дефолт агента)', () => {
    const res = handleApi('PUT', '/api/config', { default_editor: '' }, cwd);
    assert.equal(res.status, 200);
    assert.equal(readFileConfig().default_editor, '');
  });
});
