/**
 * Тесты VL-239 — резолв модели рана (фиксация модели на сессии).
 *
 * Проверяется `resolveRunModel`/`modelLogLine` из src/agent/llm-env.ts:
 * приоритет `--model` → `--model-follow-settings` → мета сессии → активная
 * модель → env; падение на пару provider+wire-имя при переименованном id;
 * fail-open при удалённой модели/провайдере и warning о расхождении.
 *
 * Фикстура — mkdtemp (VL-241/lesson-89): фиксированные пути запрещены,
 * параллельные прогоны в worktree затирают друг друга.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modelLogLine, resolveRunModel } from '../../dist/agent/llm-env.js';

let dir;
/** Сохранённые env-переменные LLM — восстанавливаются в afterEach. */
let savedEnv;

const ENV_KEYS = [
  'VIBELOG_LLM_MODEL',
  'VIBELOG_LLM_API_KEY',
  'VIBELOG_LLM_BASE_URL',
  'VL239_KEY_A',
  'VL239_KEY_B',
];

function writeSettings(obj) {
  mkdirSync(join(dir, '.vibelog'), { recursive: true });
  writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(obj), 'utf-8');
}

/** Две модели у разных провайдеров: default — A, вторая — B. */
function settingsTwoModels() {
  return {
    gateways: {
      pa: { base_url: 'https://pa.example/v1', api_key: 'key-a' },
      pb: { base_url: 'https://pb.example/v1', api_key: 'key-b' },
    },
    models: {
      default: 'pa/ModelA',
      available: {
        'pa/ModelA': { label: 'Model A', gateway: 'pa', model: 'wire-a', api_mode: 'chat' },
        'pb/ModelB': { label: 'Model B', gateway: 'pb', model: 'wire-b', api_mode: 'responses' },
      },
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibelog-llm-env-'));
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveRunModel (VL-239)', () => {
  it('мета без model-полей → активная модель из settings (source=settings)', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, { cwd: dir, taskId: 'VL-1', phase: 'plan' });
    assert.equal(resolved.source, 'settings');
    assert.equal(resolved.id, 'pa/ModelA');
    assert.equal(resolved.model, 'wire-a');
    assert.equal(resolved.apiMode, 'chat');
    assert.equal(resolved.baseUrl, 'https://pa.example/v1');
    assert.equal(resolved.apiKey, 'key-a');
    assert.equal(resolved.warning, undefined);
  });

  it('меты нет → активная модель (старые сессии не блокируются)', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, null);
    assert.equal(resolved.source, 'settings');
    assert.equal(resolved.id, 'pa/ModelA');
  });

  it('мета с model_id не-default модели → модель сессии (source=session) + warning о расхождении', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_id: 'pb/ModelB',
      model_gateway: 'pb',
      model_name: 'wire-b',
      api_mode: 'responses',
    });
    assert.equal(resolved.source, 'session');
    assert.equal(resolved.model, 'wire-b');
    assert.equal(resolved.baseUrl, 'https://pb.example/v1');
    assert.equal(resolved.apiKey, 'key-b');
    assert.equal(resolved.apiMode, 'responses');
    assert.ok(resolved.warning, 'предупреждение о расхождении обязательно');
    assert.match(resolved.warning, /модель сессии Model B \(pb\/ModelB\)/);
    assert.match(resolved.warning, /активная в settings Model A \(pa\/ModelA\)/);
    assert.match(resolved.warning, /--model pa\/ModelA/);
    assert.match(resolved.warning, /--model-follow-settings/);
  });

  it('модель сессии = активная модель → без предупреждения', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, { cwd: dir, model_id: 'pa/ModelA', model_name: 'wire-a' });
    assert.equal(resolved.source, 'session');
    assert.equal(resolved.warning, undefined);
  });

  it('model_id переименован, но пара provider+wire-имя совпадает → резолв по паре', () => {
    writeSettings({
      gateways: { pa: { base_url: 'https://pa.example/v1', api_key: 'key-a' } },
      models: {
        default: 'pa/Other',
        available: {
          'pa/Other': { label: 'Other', gateway: 'pa', model: 'wire-other' },
          'pa/Renamed': { label: 'Renamed', gateway: 'pa', model: 'wire-a' },
        },
      },
    });
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_id: 'pa/Old-Name',
      model_gateway: 'pa',
      model_name: 'wire-a',
    });
    assert.equal(resolved.source, 'session');
    assert.equal(resolved.id, 'pa/Renamed');
    assert.equal(resolved.model, 'wire-a');
  });

  it('модель сессии удалена из available → fail-open на активную + warning', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_id: 'gone/Model',
      model_gateway: 'gone',
      model_name: 'wire-gone',
    });
    assert.equal(resolved.source, 'settings');
    assert.equal(resolved.id, 'pa/ModelA');
    assert.ok(resolved.warning);
    assert.match(resolved.warning, /не найдена в settings\.json/);
    assert.match(resolved.warning, /gone\/Model/);
  });

  it('провайдер модели сессии удалён → fail-open на активную + warning', () => {
    writeSettings({
      gateways: { pa: { base_url: 'https://pa.example/v1', api_key: 'key-a' } },
      models: {
        default: 'pa/ModelA',
        available: { 'pa/ModelA': { gateway: 'pa', model: 'wire-a' } },
      },
    });
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_id: 'pb/ModelB',
      model_gateway: 'pb',
      model_name: 'wire-b',
    });
    assert.equal(resolved.source, 'settings');
    assert.ok(resolved.warning);
  });

  it('--model <id> перебивает мету (source=explicit) с предупреждением о переопределении', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(
      dir,
      { cwd: dir, model_id: 'pb/ModelB', model_gateway: 'pb', model_name: 'wire-b' },
      { modelId: 'pa/ModelA' },
    );
    assert.equal(resolved.source, 'explicit');
    assert.equal(resolved.model, 'wire-a');
    assert.ok(resolved.warning);
    assert.match(resolved.warning, /--model переопределяет модель сессии/);
  });

  it('--model <неизвестный id> → throw (явный флаг не fail-open)', () => {
    writeSettings(settingsTwoModels());
    assert.throws(
      () => resolveRunModel(dir, null, { modelId: 'nope/nope' }),
      /Неизвестная модель: nope\/nope — отсутствует в models\.available/,
    );
  });

  it('--model-follow-settings → активная модель, мета игнорируется', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(
      dir,
      { cwd: dir, model_id: 'pb/ModelB', model_gateway: 'pb', model_name: 'wire-b' },
      { followSettings: true },
    );
    assert.equal(resolved.source, 'settings');
    assert.equal(resolved.id, 'pa/ModelA');
    assert.equal(resolved.warning, undefined);
  });

  it('api_mode из меты приоритетнее api_mode модели + отдельное предупреждение', () => {
    writeSettings(settingsTwoModels());
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_id: 'pa/ModelA',
      model_gateway: 'pa',
      model_name: 'wire-a',
      api_mode: 'responses',
    });
    assert.equal(resolved.apiMode, 'responses');
    assert.ok(resolved.warning);
    assert.match(resolved.warning, /api_mode из меты \(responses\)/);
  });

  it('env-only (секции models нет): мета закрепляет wire-имя, baseUrl/apiKey пусты', () => {
    writeSettings({});
    process.env.VIBELOG_LLM_MODEL = 'env-model';
    const resolved = resolveRunModel(dir, {
      cwd: dir,
      model_name: 'session-model',
      api_mode: 'chat',
    });
    assert.equal(resolved.source, 'session');
    assert.equal(resolved.model, 'session-model');
    assert.equal(resolved.baseUrl, undefined);
    assert.equal(resolved.apiKey, undefined);
    assert.ok(resolved.warning, 'расхождение с VIBELOG_LLM_MODEL — предупреждение');
    assert.match(resolved.warning, /env-model/);
  });

  it('env-only без меты → env-модель (source=env, прежнее поведение)', () => {
    writeSettings({});
    process.env.VIBELOG_LLM_MODEL = 'env-model';
    const resolved = resolveRunModel(dir, null);
    assert.equal(resolved.source, 'env');
    assert.equal(resolved.model, 'env-model');
  });
});

describe('modelLogLine (VL-239)', () => {
  it('базовая часть — дословный формат VL-209 + источник', () => {
    writeSettings(settingsTwoModels());
    const settingsLine = modelLogLine(resolveRunModel(dir, null));
    assert.match(settingsLine, /^Модель: Model A \(pa\/ModelA\), api_mode: chat — из настроек$/);

    const sessionLine = modelLogLine(
      resolveRunModel(dir, { cwd: dir, model_id: 'pb/ModelB', model_name: 'wire-b' }),
    );
    assert.match(sessionLine, /^Модель: Model B \(pb\/ModelB\), api_mode: responses — из сессии$/);

    const explicitLine = modelLogLine(resolveRunModel(dir, null, { modelId: 'pb/ModelB' }));
    assert.match(explicitLine, / — явный --model$/);
  });

  it('env-путь: источник «из env»', () => {
    writeSettings({});
    process.env.VIBELOG_LLM_MODEL = 'env-only-model';
    const line = modelLogLine(resolveRunModel(dir, null));
    assert.match(line, /^Модель: env-only-model \(env-only-model\), api_mode: chat — из env$/);
  });
});
