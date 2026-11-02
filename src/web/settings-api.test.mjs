/**
 * Тесты REST API настроек (VL-156): GET/PUT /api/settings.
 *
 * Проверяют контракт страницы настроек:
 * - GET отдаёт валидированные поля и НЕ отдаёт env-секцию (секреты);
 * - PUT валидирует как команда /set (400 на мусор, файл не меняется);
 * - PUT пишет через saveBotSettings — env-секция и chats сохраняются (VL-143);
 * - 0/null сбрасывает лимит (ключ удаляется из settings.json).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

/** Прямое чтение settings.json (то, что реально на диске). */
function readSettingsFile() {
  return JSON.parse(readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'));
}

/** Прямая запись settings.json (подготовка данных). */
function writeSettingsFile(data) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-settings-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/settings (VL-156)', () => {
  it('без файла → дефолты: chats [], дефолтные task_type_styles, без env', () => {
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    const { settings } = res.body;
    assert.deepEqual(settings.chats, []);
    // Дефолтные стили типов всегда объект (VL-82)
    assert.equal(settings.task_type_styles.bug, 'danger');
    assert.equal(settings.task_type_styles.feature, 'success');
  });

  it('НЕ отдаёт env-секцию (секреты не утекают в браузер)', () => {
    writeSettingsFile({
      chats: [42],
      env: { TELEGRAM_BOT_TOKEN: 'secret-token-xyz', TELEGRAM_PROXY: 'http://127.0.0.1:7070' },
      default_agent: 'vb',
    });
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('TELEGRAM'), 'в ответе нет TELEGRAM-ключей');
    assert.ok(!raw.includes('secret-token-xyz'), 'токен не отдан');
    assert.ok(!raw.includes('env'), 'env-секция не отдана');
    // Несекретные поля при этом видны
    assert.equal(res.body.settings.default_agent, 'vb');
    assert.deepEqual(res.body.settings.chats, [42]);
  });

  it('git_user_name из кэша settings.json → отдан в теле (VL-166)', () => {
    writeSettingsFile({ git_user_name: 'Pavel' });
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.git_user_name, 'Pavel');
  });

  it('без ключа git_user_name → fallback git config или @agent, всегда строка (VL-166)', () => {
    // Кэш очищен — resolveGitUserName идёт в git config user.name;
    // в tmp-каталоге репозитория нет, но глобальный ~/.gitconfig может
    // дать реальное имя, поэтому проверяем контракт, а не конкретное значение.
    writeSettingsFile({});
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.git_user_name, 'string');
    assert.ok(res.body.git_user_name.length > 0, 'git_user_name — непустая строка');
  });
});

describe('PUT /api/settings — валидация (VL-156)', () => {
  it('невалидный default_agent / отрицательный лимит / неизвестный ключ → 400, файл не изменён', () => {
    writeSettingsFile({ chats: [1], default_agent: 'qwen' });
    const before = readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8');

    for (const body of [
      { default_agent: 'gpt' },
      { max_wall_time: -5 },
      { max_wall_time: 1.5 },
      { branch_mode: 'true' }, // строка вместо boolean
      { foo: 'bar' }, // неизвестный ключ
    ]) {
      const res = handleApi('PUT', '/api/settings', body, cwd);
      assert.equal(res.status, 400, `ожидали 400 для ${JSON.stringify(body)}`);
      assert.ok(res.body.error, 'тело содержит error');
    }

    assert.equal(
      readFileSync(join(cwd, '.vibelog', 'settings.json'), 'utf-8'),
      before,
      'файл не изменился после 400'
    );
  });
});

describe('PUT /api/settings — запись (VL-156)', () => {
  it('валидный патч пишет settings.json, сохраняет env и chats', () => {
    writeSettingsFile({
      chats: [7],
      env: { TELEGRAM_BOT_TOKEN: 'keep-me' },
      default_agent: 'qwen',
    });
    const res = handleApi(
      'PUT',
      '/api/settings',
      { branch_mode: true, max_requests: 300, code_same_session: true, reset_limits_on_resume: false },
      cwd
    );
    assert.equal(res.status, 200);
    // Ответ — sanitized объект без env
    assert.equal(res.body.settings.branch_mode, true);
    assert.equal(res.body.settings.max_requests, 300);
    assert.ok(!JSON.stringify(res.body).includes('TELEGRAM'));

    const file = readSettingsFile();
    assert.equal(file.branch_mode, true);
    assert.equal(file.max_requests, 300);
    assert.equal(file.code_same_session, true);
    // VL-308: opt-out сброса лимитов loop detection при resume
    assert.equal(file.reset_limits_on_resume, false);
    // Read-modify-write сохранил секреты и chats (VL-143)
    assert.equal(file.env.TELEGRAM_BOT_TOKEN, 'keep-me');
    assert.deepEqual(file.chats, [7]);
  });

  it('0/null сбрасывает лимит — ключ удаляется из файла', () => {
    writeSettingsFile({ max_requests: 300, max_wall_time: 600 });
    const res = handleApi('PUT', '/api/settings', { max_requests: 0, max_wall_time: null }, cwd);
    assert.equal(res.status, 200);
    const file = readSettingsFile();
    assert.ok(!('max_requests' in file), 'max_requests удалён (сброс 0)');
    assert.ok(!('max_wall_time' in file), 'max_wall_time удалён (сброс null)');
  });

  it('compact: false пишет явный ключ, true — тоже пишется (веб шлёт явный boolean)', () => {
    const off = handleApi('PUT', '/api/settings', { compact: false }, cwd);
    assert.equal(off.status, 200);
    assert.equal(readSettingsFile().compact, false);

    const on = handleApi('PUT', '/api/settings', { compact: true }, cwd);
    assert.equal(on.status, 200);
    assert.equal(readSettingsFile().compact, true);
  });

  it('пустое тело → no-op 200 (не роняет и не чистит файл)', () => {
    writeSettingsFile({ chats: [9], branch_mode: true });
    const res = handleApi('PUT', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    const file = readSettingsFile();
    assert.equal(file.branch_mode, true);
    assert.deepEqual(file.chats, [9]);
  });
});

describe('GET/PUT /api/settings: секция chat (VL-269)', () => {
  it('GET отдаёт chat после записи секции, env по-прежнему не отдаётся', () => {
    writeSettingsFile({
      chats: [1],
      env: { TELEGRAM_BOT_TOKEN: 'secret-xyz' },
      chat: { max_iterations: 20, max_wall_time: 600, max_auto_continue: 3, call_timeout: 90 },
    });
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.chat, {
      max_iterations: 20,
      max_wall_time: 600,
      max_auto_continue: 3,
      call_timeout: 90,
    });
    assert.equal('env' in res.body.settings, false, 'env-секция не утекает');
  });

  it('GET отбрасывает мусорные ключи секции chat (только положительные целые)', () => {
    writeSettingsFile({ chat: { max_iterations: 'много', max_wall_time: 300, call_timeout: -1 } });
    const res = handleApi('GET', '/api/settings', null, cwd);
    assert.deepEqual(res.body.settings.chat, { max_wall_time: 300 });
  });

  it('PUT принимает chat с валидацией, сохраняет env и chats', () => {
    writeSettingsFile({ chats: [7], env: { TELEGRAM_BOT_TOKEN: 'secret-abc' } });
    const res = handleApi('PUT', '/api/settings', {
      chat: { max_iterations: 30, max_wall_time: 900 },
    }, cwd);
    assert.equal(res.status, 200);
    const file = readSettingsFile();
    assert.deepEqual(file.chat, { max_iterations: 30, max_wall_time: 900 });
    assert.deepEqual(file.chats, [7], 'chats сохранены');
    assert.equal(file.env.TELEGRAM_BOT_TOKEN, 'secret-abc', 'env сохранён');
    assert.deepEqual(res.body.settings.chat, { max_iterations: 30, max_wall_time: 900 });
  });

  it('PUT: 0/null по ключу секции — сброс этого ключа', () => {
    writeSettingsFile({ chat: { max_iterations: 30, max_wall_time: 900 } });
    const res = handleApi('PUT', '/api/settings', {
      chat: { max_iterations: 0, max_wall_time: 900 },
    }, cwd);
    assert.equal(res.status, 200);
    assert.deepEqual(readSettingsFile().chat, { max_wall_time: 900 });
  });

  it('PUT: пустая секция chat — полный сброс, ключ удаляется', () => {
    writeSettingsFile({ chats: [3], chat: { max_iterations: 30 } });
    const res = handleApi('PUT', '/api/settings', { chat: {} }, cwd);
    assert.equal(res.status, 200);
    const file = readSettingsFile();
    assert.equal('chat' in file, false, 'ключ chat удалён');
    assert.deepEqual(file.chats, [3], 'прочие поля целы');
  });

  it('PUT: мусорное значение → 400, файл не меняется', () => {
    writeSettingsFile({ chats: [4], chat: { max_iterations: 30 } });
    const before = readSettingsFile();
    const bad = [
      { chat: { max_iterations: 'много' } },
      { chat: { max_iterations: -5 } },
      { chat: { max_iterations: 2.5 } },
      { chat: { max_iterations: 999 } }, // сверх потолка 200
      { chat: { call_timeout: 0.5 } },
      { chat: { неизвестный_ключ: 5 } },
      { chat: 'мусор' },
      { chat: [] },
    ];
    for (const body of bad) {
      const res = handleApi('PUT', '/api/settings', body, cwd);
      assert.equal(res.status, 400, `ожидался 400 для ${JSON.stringify(body)}`);
      assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0);
    }
    assert.deepEqual(readSettingsFile(), before, 'файл не изменился');
  });
});
