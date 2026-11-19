/**
 * Тесты CRUD каналов через REST API (VL-438, AC1/AC5/AC6).
 *
 * Покрываем:
 * - GET/POST/PUT/DELETE /api/comms/channels — полный CRUD;
 * - GET/PUT /api/comms/settings — sync_timeout_sec, default_channel,
 *   секция interbot_limits (лимиты + gate_timeout_sec);
 * - GET/PUT /api/comms/prompts — чтение/запись/сброс шаблонов;
 * - валидация ДО записи → 400, файл не меняется;
 * - чужие top-level секции comms.yaml целы (read-modify-write);
 * - секреты (bot_token/proxy) НИКОГДА не в ответах — только признаки;
 * - 409 на удаление default-канала без force (guard AC5).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-comms-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
  seedComms();
});

function commsPath() {
  return join(cwd, '.vibelog', 'comms.yaml');
}

/**
 * comms.yaml с секретами, чужей top-level секцией и каналом —
 * проверяем, что API не трогает ничего лишнего.
 */
function seedComms() {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    commsPath(),
    [
      'secrets:',
      '  telegram:',
      "    bot_token: 'SECRET-TOKEN-123:abc'",
      "    proxy: 'socks5://user:pass@proxy:1080'",
      '',
      'chats:',
      '  - 777',
      '',
      'default_channel: main',
      'sync_timeout_sec: 120',
      '',
      '# чужая секция — API не должна её терять',
      'custom_section:',
      '  keep: true',
      '  nested:',
      '    value: 42',
      '',
      'channels:',
      '  - id: main',
      '    label: Основной',
      '    transport: telegram',
      '    group_id: -100111',
      '    addressing: mention',
      '    approval: admin',
      '    admin_chat: 777',
      '  - id: second',
      '    transport: telegram',
      '    group_id: -100222',
      '    addressing: all',
      '    approval: auto',
      '',
    ].join('\n'),
    'utf-8',
  );
}

function readCommsFile() {
  return readFileSync(commsPath(), 'utf-8');
}

/** Секция из сырого файла (строковый признак — надёжнее парсера в тесте). */
function hasForeignSection() {
  return readCommsFile().includes('custom_section') && readCommsFile().includes('value: 42');
}

describe('GET /api/comms/channels (AC1)', () => {
  it('список каналов + default + признаки секретов, значений секретов нет', () => {
    const res = handleApi('GET', '/api/comms/channels', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.channels.length, 2);
    const main = res.body.channels.find((c) => c.id === 'main');
    assert.equal(main.label, 'Основной');
    assert.equal(main.group_id, -100111);
    assert.equal(main.addressing, 'mention');
    assert.equal(main.approval, 'admin');
    assert.equal(main.admin_chat, 777);
    assert.equal(res.body.default_channel, 'main');
    assert.deepEqual(res.body.secrets, { bot_token: true, proxy: true });
    // AC5: ни одного значения секрета в ответе
    const json = JSON.stringify(res.body);
    assert.ok(!json.includes('SECRET-TOKEN'), 'bot_token не утёк в ответ');
    assert.ok(!json.includes('socks5://'), 'proxy не утёк в ответ');
    assert.ok(!json.includes('user:pass'), 'proxy не утёк в ответ');
  });

  it('GET /api/comms/channels/:id — канал + эффективные лимиты', () => {
    const res = handleApi('GET', '/api/comms/channels/main', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.channel.id, 'main');
    assert.equal(res.body.is_default, true);
    assert.equal(res.body.effective_limits.botRatePerMin, 10); // дефолт кода
    assert.ok(!JSON.stringify(res.body).includes('SECRET'));
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('GET', '/api/comms/channels/ghost', null, cwd);
    assert.equal(res.status, 404);
  });
});

describe('POST /api/comms/channels — создание (AC1)', () => {
  it('создаёт канал, запись появляется в comms.yaml', () => {
    const res = handleApi(
      'POST',
      '/api/comms/channels',
      { id: 'lb-link', label: 'Связь с LB', group_id: -100333, addressing: 'mention' },
      cwd,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.channel.id, 'lb-link');
    const file = readCommsFile();
    assert.match(file, /id: lb-link/);
    assert.match(file, /-100333/);
    // секреты и чужая секция не тронуты
    assert.ok(file.includes('SECRET-TOKEN-123:abc'), 'секреты сохранены');
    assert.ok(hasForeignSection(), 'чужая секция цела');
  });

  it('дубль id → 400, файл не меняется', () => {
    const before = readCommsFile();
    const res = handleApi('POST', '/api/comms/channels', { id: 'main', group_id: -1 }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /уже существует/);
    assert.equal(readCommsFile(), before, 'файл не изменился');
  });

  it('валидация: битый id / отсутствующий group_id / 0 → 400', () => {
    const before = readCommsFile();
    for (const body of [
      { id: 'Bad ID!', group_id: -1 },
      { id: 'no-group' },
      { id: 'zero', group_id: 0 },
      { id: 'float', group_id: 1.5 },
    ]) {
      const res = handleApi('POST', '/api/comms/channels', body, cwd);
      assert.equal(res.status, 400, `ожидали 400 для ${JSON.stringify(body)}`);
      assert.equal(typeof res.body.error, 'string');
    }
    assert.equal(readCommsFile(), before, 'файл не изменился');
  });
});

describe('PUT /api/comms/channels/:id — правка (AC1)', () => {
  it('правит поля и limits, чужие записи канала не тронуты', () => {
    const res = handleApi(
      'PUT',
      '/api/comms/channels/second',
      { label: 'Второй', addressing: 'mention', limits: { bot_rate_per_min: 3, max_depth: 4 } },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.channel.label, 'Второй');
    assert.equal(res.body.channel.addressing, 'mention');
    assert.deepEqual(res.body.channel.limits, { bot_rate_per_min: 3, max_depth: 4 });
    const file = readCommsFile();
    assert.ok(hasForeignSection(), 'чужая секция цела');
    assert.ok(file.includes('SECRET-TOKEN-123:abc'), 'секреты целы');
    assert.match(file, /bot_rate_per_min: 3/);
  });

  it('битые значения limits → 400, файл не меняется', () => {
    const before = readCommsFile();
    for (const limits of [{ bot_rate_per_min: -1 }, { unknown_key: 3 }, { max_depth: 'много' }]) {
      const res = handleApi('PUT', '/api/comms/channels/second', { limits }, cwd);
      assert.equal(res.status, 400, `ожидали 400 для ${JSON.stringify(limits)}`);
    }
    assert.equal(readCommsFile(), before);
  });

  it('битые enums → 400', () => {
    const before = readCommsFile();
    assert.equal(
      handleApi('PUT', '/api/comms/channels/second', { addressing: 'everything' }, cwd).status,
      400,
    );
    assert.equal(
      handleApi('PUT', '/api/comms/channels/second', { approval: 'maybe' }, cwd).status,
      400,
    );
    assert.equal(readCommsFile(), before);
  });

  it('переименование (другой id в PUT) → 400', () => {
    const res = handleApi('PUT', '/api/comms/channels/second', { id: 'renamed' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /переименование/);
  });

  it('неизвестный id → 404', () => {
    const res = handleApi('PUT', '/api/comms/channels/ghost', { label: 'x' }, cwd);
    assert.equal(res.status, 404);
  });
});

describe('DELETE /api/comms/channels/:id + guard default (AC5)', () => {
  it('обычный канал удаляется', () => {
    const res = handleApi('DELETE', '/api/comms/channels/second', null, cwd, '');
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 'second');
    assert.ok(!readCommsFile().includes('id: second'), 'канал удалён из файла');
    assert.ok(hasForeignSection(), 'чужая секция цела');
  });

  it('default-канал без force → 409 с предупреждением, файл цел', () => {
    const before = readCommsFile();
    const res = handleApi('DELETE', '/api/comms/channels/main', null, cwd, '');
    assert.equal(res.status, 409);
    assert.equal(res.body.requires_force, true);
    assert.match(res.body.warning, /default_channel/);
    assert.equal(readCommsFile(), before, 'файл не изменился');
  });

  it('default-канал с force=1 удаляется, default_channel сброшен', () => {
    const res = handleApi('DELETE', '/api/comms/channels/main', null, cwd, 'force=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.default_channel_cleared, true);
    const file = readCommsFile();
    assert.ok(!file.includes('id: main'), 'канал удалён');
    assert.ok(!file.includes('default_channel'), 'default сброшен');
    assert.ok(file.includes('SECRET-TOKEN-123:abc'), 'секреты целы');
    assert.ok(hasForeignSection(), 'чужая секция цела');
  });
});

describe('GET/PUT /api/comms/settings (AC1/AC2)', () => {
  it('GET отдаёт параметры, эффективные лимиты и признаки секретов', () => {
    const res = handleApi('GET', '/api/comms/settings', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.sync_timeout_sec, 120);
    assert.equal(res.body.default_channel, 'main');
    assert.deepEqual(res.body.secrets, { bot_token: true, proxy: true });
    assert.equal(res.body.effective.botRatePerMin, 10);
    assert.equal(res.body.effective.gate_timeout_ms, 8000); // GATE_TIMEOUT_MS дефолт
    assert.ok(!JSON.stringify(res.body).includes('SECRET'));
  });

  it('PUT применяет sync_timeout_sec и interbot_limits (AC2)', () => {
    const res = handleApi(
      'PUT',
      '/api/comms/settings',
      {
        sync_timeout_sec: 60,
        interbot_limits: {
          dedup_ttl_sec: 120,
          bot_rate_per_min: 5,
          human_rate_per_min: 2,
          global_runs_per_hour: 10,
          max_depth: 3,
          gate_timeout_sec: 4,
        },
      },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.sync_timeout_sec, 60);
    assert.equal(res.body.interbot_limits.gate_timeout_sec, 4);
    const file = readCommsFile();
    assert.match(file, /sync_timeout_sec: 60/);
    assert.match(file, /gate_timeout_sec: 4/);
    assert.ok(hasForeignSection(), 'чужая секция цела');
    assert.ok(file.includes('SECRET-TOKEN-123:abc'), 'секреты целы');
    assert.ok(file.includes('keep: true'), 'вложенность чужой секции цела');
  });

  it('PUT: несуществующий default_channel → 400, файл цел', () => {
    const before = readCommsFile();
    const res = handleApi('PUT', '/api/comms/settings', { default_channel: 'ghost' }, cwd);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /не найден/);
    assert.equal(readCommsFile(), before);
  });

  it('PUT: сброс default_channel (null) убирает ключ', () => {
    const res = handleApi('PUT', '/api/comms/settings', { default_channel: null }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.default_channel, null);
    assert.ok(!readCommsFile().includes('default_channel'));
  });

  it('PUT: битые лимиты/таймаут → 400, файл цел', () => {
    const before = readCommsFile();
    for (const body of [
      { sync_timeout_sec: 0 },
      { sync_timeout_sec: 'быстро' },
      { interbot_limits: { max_depth: -2 } },
      { interbot_limits: { nonsense: 1 } },
    ]) {
      const res = handleApi('PUT', '/api/comms/settings', body, cwd);
      assert.equal(res.status, 400, `ожидали 400 для ${JSON.stringify(body)}`);
    }
    assert.equal(readCommsFile(), before);
  });

  it('PUT молча игнорирует попытку записать секреты', () => {
    const res = handleApi(
      'PUT',
      '/api/comms/settings',
      { bot_token: 'hack', secrets: { telegram: { bot_token: 'hack2' } } },
      cwd,
    );
    assert.equal(res.status, 200);
    const file = readCommsFile();
    assert.ok(file.includes('SECRET-TOKEN-123:abc'), 'секрет не перезаписан');
    assert.ok(!file.includes('hack'), 'значение из тела не попало в файл');
  });
});

describe('GET/PUT /api/comms/prompts (AC3)', () => {
  it('GET: дефолты из пакета, source=default, проектных файлов нет', () => {
    const res = handleApi('GET', '/api/comms/prompts', null, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.incoming.source, 'default');
    assert.equal(res.body.gate.source, 'default');
    assert.match(res.body.incoming.text, /\{channel\}|Ты отвечаешь/);
    assert.match(res.body.incoming.text, /<no_answer>/);
    assert.match(res.body.gate.text, /read_only/);
    assert.ok(!existsSync(join(cwd, '.vibelog', 'prompts', 'interbot', 'incoming.md')));
  });

  it('PUT пишет проектный файл, GET отдаёт source=project', () => {
    const res = handleApi(
      'PUT',
      '/api/comms/prompts',
      { name: 'incoming', text: 'Мой промпт для {channel}.\nВопрос:\n{text}' },
      cwd,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'project');
    const path = join(cwd, '.vibelog', 'prompts', 'interbot', 'incoming.md');
    assert.ok(existsSync(path));
    assert.match(readFileSync(path, 'utf8'), /Мой промпт/);
    const get = handleApi('GET', '/api/comms/prompts', null, cwd);
    assert.equal(get.body.incoming.source, 'project');
    assert.match(get.body.incoming.text, /Мой промпт/);
  });

  it('PUT reset=1 удаляет проектный файл → source=default', () => {
    handleApi('PUT', '/api/comms/prompts', { name: 'gate', text: 'Гейт-текст' }, cwd);
    const res = handleApi('PUT', '/api/comms/prompts', { name: 'gate', reset: true }, cwd);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'default');
    assert.ok(!existsSync(join(cwd, '.vibelog', 'prompts', 'interbot', 'gate.md')));
  });

  it('валидация: неизвестное имя / пустой текст → 400', () => {
    const before = handleApi('GET', '/api/comms/prompts', null, cwd);
    assert.equal(
      handleApi('PUT', '/api/comms/prompts', { name: 'other', text: 'x' }, cwd).status,
      400,
    );
    assert.equal(
      handleApi('PUT', '/api/comms/prompts', { name: 'incoming', text: '  ' }, cwd).status,
      400,
    );
    const after = handleApi('GET', '/api/comms/prompts', null, cwd);
    assert.deepEqual(after.body, before.body);
  });
});

describe('чужие секции и settings.json (AC1)', () => {
  it('settings.json не затрагивается comms-API вовсе', () => {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    const settingsPath = join(cwd, '.vibelog', 'settings.json');
    const settings = { models: { default: 'x' }, workflows: { custom: {} } };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    handleApi('PUT', '/api/comms/settings', { sync_timeout_sec: 30 }, cwd);
    handleApi('POST', '/api/comms/channels', { id: 'z', group_id: -9 }, cwd);
    handleApi('PUT', '/api/comms/prompts', { name: 'incoming', text: 'x' }, cwd);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf-8')), settings);
  });

  it('повреждённая структура secrets не роняет патч и не теряет соседние секции', () => {
    // Мини-парсер yaml терпим к битым скалярам (не бросает) — патч пишет,
    // но чужие секции и целевая структура должны пережить перезапись
    writeFileSync(commsPath(), 'secrets: [битая структура\nchats: [1]\n', 'utf-8');
    const res = handleApi('PUT', '/api/comms/settings', { sync_timeout_sec: 30 }, cwd);
    assert.equal(res.status, 200);
    const file = readCommsFile();
    assert.match(file, /sync_timeout_sec: 30/);
    assert.ok(file.includes('битая структура'), 'повреждённая секция не потеряна');
    assert.match(file, /chats/);
  });
});
