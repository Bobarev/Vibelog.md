/**
 * Тесты VL-34/VL-143 — настройки бота (.vibelog/settings.json).
 *
 * Каталоги — в /tmp (findBacklogDir поднимается вверх по дереву).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadBotSettings,
  saveBotSettings,
  resolveToken,
  resolveProxy,
  resolveDefaultAgent,
  resolveMaxWallTime,
  resolveMaxRequests,
  resolveIdleTimeout,
  resolveLoopDetectionRepeat,
  resolveResetLimitsOnResume,
  resolveBranchMode,
  resolveCodeSameSession,
  botSettingsPath,
} from '../../dist/bot/settings.js';
import { saveSettingsPatch } from '../../dist/core/settings.js';

describe('settings (VL-34, VL-143)', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-test-'));
  const savedEnv = process.env.TELEGRAM_BOT_TOKEN;

  afterAll(() => {
    if (savedEnv === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedEnv;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load', () => {
    saveBotSettings(testRoot, { chats: [111, 222] });
    assert.ok(existsSync(botSettingsPath(testRoot)));
    const loaded = loadBotSettings(testRoot);
    assert.deepEqual(loaded.chats, [111, 222]);
  });

  it('отсутствующий файл → пустые настройки', () => {
    const empty = loadBotSettings(join(testRoot, 'nonexistent-sub'));
    assert.deepEqual(empty.chats, []);
    assert.equal(empty.default_agent, undefined);
  });

  it('resolveToken: env приоритетнее env-секции settings.json (VL-143)', () => {
    // Токен живёт в env-секции (telegram_token больше не топ-уровневое поле)
    saveSettingsPatch(testRoot, { env: { TELEGRAM_BOT_TOKEN: 'tok-123' } });
    process.env.TELEGRAM_BOT_TOKEN = 'from-env';
    assert.equal(resolveToken(testRoot), 'from-env');
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(resolveToken(testRoot), 'tok-123');
  });

  it('resolveProxy: env → env-секция settings.json → null (VL-37/VL-143)', () => {
    const savedProxy = process.env.TELEGRAM_PROXY;
    try {
      process.env.TELEGRAM_PROXY = 'http://127.0.0.1:7070';
      assert.equal(resolveProxy(testRoot), 'http://127.0.0.1:7070');
      delete process.env.TELEGRAM_PROXY;
      // Env-секция без TELEGRAM_PROXY → null
      assert.equal(resolveProxy(testRoot), null);
      // С TELEGRAM_PROXY в env-секции
      saveSettingsPatch(testRoot, { env: { TELEGRAM_PROXY: 'http://127.0.0.1:1080' } });
      assert.equal(resolveProxy(testRoot), 'http://127.0.0.1:1080');
    } finally {
      if (savedProxy === undefined) delete process.env.TELEGRAM_PROXY;
      else process.env.TELEGRAM_PROXY = savedProxy;
    }
  });
});

describe('task_type_styles (VL-82)', () => {
  const stylesRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-styles-'));

  afterAll(() => {
    rmSync(stylesRoot, { recursive: true, force: true });
  });

  it('отсутствующий settings.json → дефолты (4 записи)', () => {
    const loaded = loadBotSettings(join(stylesRoot, 'nonexistent'));
    assert.deepEqual(loaded.task_type_styles, {
      bug: 'danger',
      feature: 'success',
      enhancement: 'primary',
      epic: 'primary',
    });
  });

  it('пользовательское переопределение перекрывает дефолты', () => {
    const root = join(stylesRoot, 'override');
    saveBotSettings(root, { chats: [], task_type_styles: { bug: 'success', docs: 'link' } });
    const loaded = loadBotSettings(root);
    assert.deepEqual(loaded.task_type_styles, {
      bug: 'success', // переопределён пользователем
      docs: 'link', // новый тип
      feature: 'success', // дефолт сохранён
      enhancement: 'primary',
      epic: 'primary',
    });
  });

  it('невалидный стиль отброшен → остаётся дефолт danger', () => {
    const root = join(stylesRoot, 'invalid');
    saveBotSettings(root, { chats: [], task_type_styles: { bug: 'green' } });
    const loaded = loadBotSettings(root);
    assert.equal(loaded.task_type_styles.bug, 'danger');
  });

  it('round-trip: в файл попадают только пользовательские стили', () => {
    const root = join(stylesRoot, 'roundtrip');
    saveBotSettings(root, { chats: [111], task_type_styles: { bug: 'success' } });
    const raw = readFileSync(botSettingsPath(root), 'utf-8');
    // Дефолты в файл не записываем — только пользовательское переопределение
    assert.ok(raw.includes('bug'));
    assert.ok(!raw.includes('feature'));
    assert.ok(!raw.includes('enhancement'));
    assert.ok(!raw.includes('epic'));
    const loaded = loadBotSettings(root);
    assert.equal(loaded.task_type_styles.bug, 'success');
  });
});

describe('default_agent (VL-94)', () => {
  const agentRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-agent-'));

  afterAll(() => {
    rmSync(agentRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load: default_agent vb', () => {
    saveBotSettings(agentRoot, { chats: [111], default_agent: 'vb' });
    assert.equal(loadBotSettings(agentRoot).default_agent, 'vb');
  });

  it('resolveDefaultAgent: без файла → qwen; с файлом → значение', () => {
    assert.equal(resolveDefaultAgent(join(agentRoot, 'nonexistent')), 'qwen');
    saveBotSettings(agentRoot, { chats: [], default_agent: 'vb' });
    assert.equal(resolveDefaultAgent(agentRoot), 'vb');
    saveBotSettings(agentRoot, { chats: [], default_agent: 'qwen' });
    assert.equal(resolveDefaultAgent(agentRoot), 'qwen');
  });

  it('невалидное default_agent в файле отброшено → qwen', () => {
    const root = join(agentRoot, 'invalid');
    // botSettingsPath указывает внутрь .vibelog/ — каталог создаём явно
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], default_agent: 'foo' }), 'utf-8');
    assert.equal(loadBotSettings(root).default_agent, undefined);
    assert.equal(resolveDefaultAgent(root), 'qwen');
  });
});

describe('max_wall_time/max_requests (VL-104)', () => {
  const limitsRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-limits-'));

  afterAll(() => {
    rmSync(limitsRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load: лимиты фаз', () => {
    saveBotSettings(limitsRoot, { chats: [111], max_wall_time: 1800, max_requests: 50 });
    const loaded = loadBotSettings(limitsRoot);
    assert.equal(loaded.max_wall_time, 1800);
    assert.equal(loaded.max_requests, 50);
  });

  it('сброс: undefined-поля не попадают в файл', () => {
    saveBotSettings(limitsRoot, { chats: [], max_wall_time: 1800, max_requests: 50 });
    saveBotSettings(limitsRoot, { chats: [] });
    const loaded = loadBotSettings(limitsRoot);
    assert.equal(loaded.max_wall_time, undefined);
    assert.equal(loaded.max_requests, undefined);
  });

  it('битые значения в settings.json игнорируются', () => {
    const root = join(limitsRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(
      botSettingsPath(root),
      JSON.stringify({ chats: [], max_wall_time: 'abc', max_requests: -5 }),
      'utf-8',
    );
    const loaded = loadBotSettings(root);
    assert.equal(loaded.max_wall_time, undefined);
    assert.equal(loaded.max_requests, undefined);
  });

  it('resolveMaxWallTime/resolveMaxRequests: без файла → undefined', () => {
    assert.equal(resolveMaxWallTime(join(limitsRoot, 'nonexistent')), undefined);
    assert.equal(resolveMaxRequests(join(limitsRoot, 'nonexistent')), undefined);
    saveBotSettings(limitsRoot, { chats: [], max_wall_time: 900, max_requests: 40 });
    assert.equal(resolveMaxWallTime(limitsRoot), 900);
    assert.equal(resolveMaxRequests(limitsRoot), 40);
  });
});

describe('idle_timeout_seconds (VL-274)', () => {
  const idleRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-idle-'));

  afterAll(() => {
    rmSync(idleRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load, включая явный 0 (выключенный watchdog)', () => {
    saveBotSettings(idleRoot, { chats: [111], idle_timeout_seconds: 900 });
    assert.equal(loadBotSettings(idleRoot).idle_timeout_seconds, 900);
    saveBotSettings(idleRoot, { chats: [111], idle_timeout_seconds: 0 });
    assert.equal(loadBotSettings(idleRoot).idle_timeout_seconds, 0, '0 пишется явно — это «выключено»');
    // Сброс к дефолту агента — только удаление ключа
    saveBotSettings(idleRoot, { chats: [111] });
    assert.equal(loadBotSettings(idleRoot).idle_timeout_seconds, undefined);
  });

  it('битое значение откатывается к дефолту агента (undefined)', () => {
    const root = join(idleRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(
      botSettingsPath(root),
      JSON.stringify({ chats: [], idle_timeout_seconds: 'abc' }),
      'utf-8',
    );
    assert.equal(loadBotSettings(root).idle_timeout_seconds, undefined);
  });

  it('resolveIdleTimeout: без файла → undefined, с файлом → значение', () => {
    assert.equal(resolveIdleTimeout(join(idleRoot, 'nonexistent')), undefined);
    saveBotSettings(idleRoot, { chats: [], idle_timeout_seconds: 600 });
    assert.equal(resolveIdleTimeout(idleRoot), 600);
  });
});

describe('branch_mode (VL-107)', () => {
  const branchRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-branch-'));

  afterAll(() => {
    rmSync(branchRoot, { recursive: true, force: true });
  });

  it('roundtrip save/load: branch_mode true/false', () => {
    saveBotSettings(branchRoot, { chats: [111], branch_mode: true });
    assert.equal(loadBotSettings(branchRoot).branch_mode, true);
    saveBotSettings(branchRoot, { chats: [111], branch_mode: false });
    // false пишется в файл явно (ключ сохраняется), но resolveBranchMode
    // читает только строгое true — выключение детерминировано
    assert.equal(loadBotSettings(branchRoot).branch_mode, undefined);
  });

  it('resolveBranchMode: без файла → false; с true → true', () => {
    assert.equal(resolveBranchMode(join(branchRoot, 'nonexistent')), false);
    saveBotSettings(branchRoot, { chats: [], branch_mode: true });
    assert.equal(resolveBranchMode(branchRoot), true);
  });

  it('невалидное branch_mode в файле отброшено → false', () => {
    const root = join(branchRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    // JSON хранит строгие типы — «битое» значение здесь строка/число
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], branch_mode: 'foo' }), 'utf-8');
    assert.equal(loadBotSettings(root).branch_mode, undefined);
    assert.equal(resolveBranchMode(root), false);
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], branch_mode: 1 }), 'utf-8');
    assert.equal(loadBotSettings(root).branch_mode, undefined);
    assert.equal(resolveBranchMode(root), false);
  });
});

describe('compact (VL-122)', () => {
  const compactRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-compact-'));

  afterAll(() => {
    rmSync(compactRoot, { recursive: true, force: true });
  });

  it('по умолчанию включён: без файла/ключа → undefined (вкл)', () => {
    assert.equal(loadBotSettings(join(compactRoot, 'nonexistent')).compact, undefined);
    // Без ключа compact в файле — тоже undefined
    saveBotSettings(compactRoot, { chats: [111] });
    assert.equal(loadBotSettings(compactRoot).compact, undefined);
  });

  it('roundtrip: compact false пишется явным ключом и читается', () => {
    saveBotSettings(compactRoot, { chats: [111], compact: false });
    assert.equal(loadBotSettings(compactRoot).compact, false);
    // Ключ присутствует в файле явно (для /set compact off)
    assert.ok(readFileSync(botSettingsPath(compactRoot), 'utf-8').includes('"compact": false'));
  });

  it('невалидные значения compact в файле отброшены → включён', () => {
    const root = join(compactRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    // Читается только строгое false; строки/числа → undefined (вкл по умолчанию)
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], compact: 'foo' }), 'utf-8');
    assert.equal(loadBotSettings(root).compact, undefined);
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], compact: 0 }), 'utf-8');
    assert.equal(loadBotSettings(root).compact, undefined);
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], compact: true }), 'utf-8');
    assert.equal(loadBotSettings(root).compact, undefined);
  });
});

describe('code_same_session (VL-147)', () => {
  const sameRoot = mkdtempSync(join(tmpdir(), 'vibelog-bot-same-'));

  afterAll(() => {
    rmSync(sameRoot, { recursive: true, force: true });
  });

  it('по умолчанию выключен: без файла/ключа → undefined/false', () => {
    assert.equal(loadBotSettings(join(sameRoot, 'nonexistent')).code_same_session, undefined);
    assert.equal(resolveCodeSameSession(join(sameRoot, 'nonexistent')), false);
    // Без ключа в файле — тоже выключен (текущее поведение сохраняется, AC2)
    saveBotSettings(sameRoot, { chats: [111] });
    assert.equal(loadBotSettings(sameRoot).code_same_session, undefined);
    assert.equal(resolveCodeSameSession(sameRoot), false);
  });

  it('roundtrip save/load + resolve: true/false', () => {
    saveBotSettings(sameRoot, { chats: [111], code_same_session: true });
    assert.equal(loadBotSettings(sameRoot).code_same_session, true);
    assert.equal(resolveCodeSameSession(sameRoot), true);
    // false пишется явным ключом (для /set code-same-session off), но resolve
    // читает только строгое true — выключение детерминировано
    saveBotSettings(sameRoot, { chats: [111], code_same_session: false });
    assert.equal(loadBotSettings(sameRoot).code_same_session, undefined);
    assert.ok(readFileSync(botSettingsPath(sameRoot), 'utf-8').includes('"code_same_session": false'));
    assert.equal(resolveCodeSameSession(sameRoot), false);
  });

  it('невалидное code_same_session в файле отброшено → false', () => {
    const root = join(sameRoot, 'invalid');
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    // JSON хранит строгие типы — «битое» значение здесь строка/число
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], code_same_session: 'foo' }), 'utf-8');
    assert.equal(loadBotSettings(root).code_same_session, undefined);
    assert.equal(resolveCodeSameSession(root), false);
    writeFileSync(botSettingsPath(root), JSON.stringify({ chats: [], code_same_session: 1 }), 'utf-8');
    assert.equal(loadBotSettings(root).code_same_session, undefined);
    assert.equal(resolveCodeSameSession(root), false);
  });
});

describe('reset_limits_on_resume (VL-308)', () => {
  it('roundtrip save/load: false — явный opt-out, дефолт — сброс включён', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-settings-rlor-'));
    try {
      // без ключа — сброс включён (per-run семантика)
      assert.equal(loadBotSettings(dir).reset_limits_on_resume, undefined);
      assert.equal(resolveResetLimitsOnResume(dir), true);
      saveBotSettings(dir, { chats: [], reset_limits_on_resume: false });
      assert.equal(loadBotSettings(dir).reset_limits_on_resume, false);
      assert.equal(resolveResetLimitsOnResume(dir), false);
      // сброс настройки (undefined) удаляет ключ → снова дефолт
      saveBotSettings(dir, { chats: [] });
      assert.equal(loadBotSettings(dir).reset_limits_on_resume, undefined);
      assert.equal(resolveResetLimitsOnResume(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('битое значение (не false) игнорируется → дефолт «сброс включён»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-settings-rlor-bad-'));
    try {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({ reset_limits_on_resume: 'off' }), 'utf-8');
      assert.equal(loadBotSettings(dir).reset_limits_on_resume, undefined);
      assert.equal(resolveResetLimitsOnResume(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loop_detection_repeat (VL-306)', () => {
  it('roundtrip save/load: порог loop detection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-settings-ldr-'));
    try {
      saveBotSettings(dir, { chats: [], loop_detection_repeat: 5 });
      assert.equal(loadBotSettings(dir).loop_detection_repeat, 5);
      assert.equal(resolveLoopDetectionRepeat(dir), 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('битое значение игнорируется → undefined (дефолт агента 3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-settings-ldr-bad-'));
    try {
      mkdirSync(join(dir, '.vibelog'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({ loop_detection_repeat: 'abc' }), 'utf-8');
      assert.equal(loadBotSettings(dir).loop_detection_repeat, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('без файла → undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-settings-ldr-none-'));
    try {
      assert.equal(resolveLoopDetectionRepeat(dir), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
