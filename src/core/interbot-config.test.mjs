/**
 * Юнит-тесты лимитов и промптов interbot (VL-438, AC2/AC3).
 *
 * - mergeInterbotLimits: DEFAULT ← глобальная секция ← канал (per-channel
 *   override, doc-32 §2); dedup_ttl_sec → мс;
 * - gateTimeoutMs: канал ← глобальная секция ← 8 с;
 * - readComms парсит interbot_limits/limits с валидацией (битые ключи — warn);
 * - loadInterbotPrompt: проект → пакет → встроенная строка (fallback);
 * - INTERBOT_FALLBACK_TEMPLATES равен файлам templates/prompts/interbot/
 *   (антидрейф двух источников дефолта);
 * - createDedupCache: TTL из конфига применяется (lesson-281 — доходит до
 *   точки применения).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_GATE_TIMEOUT_SEC,
  DEFAULT_LIMITS,
  gateTimeoutMs,
  mergeInterbotLimits,
  readComms,
  resolveInterbotLimits,
  writeComms,
} from '../../dist/core/comms.js';
import {
  INTERBOT_FALLBACK_TEMPLATES,
  loadInterbotPrompt,
  renderPromptTemplate,
} from '../../dist/core/interbot-prompts.js';
import { createDedupCache, DEFAULT_LIMITS as BOT_DEFAULT_LIMITS } from '../../dist/bot/interbot.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-interbot-cfg-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeCommsYaml(text) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'comms.yaml'), text, 'utf-8');
}

describe('mergeInterbotLimits (AC2: мерж DEFAULT ← глобальная ← канал)', () => {
  it('без конфига — дефолты кода', () => {
    assert.deepEqual(mergeInterbotLimits(undefined, undefined), DEFAULT_LIMITS);
  });

  it('глобальная секция перекрывает дефолты, dedup в мс', () => {
    const merged = mergeInterbotLimits(
      { dedup_ttl_sec: 60, bot_rate_per_min: 3, max_depth: 5 },
      undefined,
    );
    assert.equal(merged.dedupTtlMs, 60_000);
    assert.equal(merged.botRatePerMin, 3);
    assert.equal(merged.maxDepth, 5);
    assert.equal(merged.humanRatePerMin, DEFAULT_LIMITS.humanRatePerMin); // не тронут
    assert.equal(merged.globalRunsPerHour, DEFAULT_LIMITS.globalRunsPerHour);
  });

  it('per-channel limits перекрывают глобальные (doc-32 §2)', () => {
    const merged = mergeInterbotLimits(
      { bot_rate_per_min: 3, human_rate_per_min: 2, global_runs_per_hour: 10 },
      { bot_rate_per_min: 1 },
    );
    assert.equal(merged.botRatePerMin, 1, 'канал важнее глобального');
    assert.equal(merged.humanRatePerMin, 2, 'глобальное без переопределения живёт');
    assert.equal(merged.globalRunsPerHour, 10);
  });

  it('DEFAULT_LIMITS в core и реэкспорт из bot идентичны', () => {
    assert.deepEqual(BOT_DEFAULT_LIMITS, DEFAULT_LIMITS);
  });
});

describe('gateTimeoutMs (AC2: GATE_TIMEOUT_MS из конфига)', () => {
  it('без конфига — дефолт 8 с', () => {
    assert.equal(gateTimeoutMs({}), DEFAULT_GATE_TIMEOUT_SEC * 1000);
    assert.equal(DEFAULT_GATE_TIMEOUT_SEC * 1000, 8000);
  });

  it('глобальная секция → мс', () => {
    assert.equal(gateTimeoutMs({ interbot_limits: { gate_timeout_sec: 3 } }), 3000);
  });

  it('канал перекрывает глобальную', () => {
    const channel = { limits: { gate_timeout_sec: 12 } };
    assert.equal(
      gateTimeoutMs({ interbot_limits: { gate_timeout_sec: 3 } }, channel),
      12_000,
    );
  });
});

describe('readComms: парсинг interbot_limits и limits канала (AC2)', () => {
  it('секция и limits канала читаются; битые значения отбрасываются с warn', () => {
    writeCommsYaml(
      [
        'sync_timeout_sec: 45',
        'interbot_limits:',
        '  dedup_ttl_sec: 300',
        '  bot_rate_per_min: 7',
        '  max_depth: -1',
        '  garbage_key: 5',
        'channels:',
        '  - id: main',
        '    transport: telegram',
        '    group_id: -100111',
        '    addressing: mention',
        '    approval: auto',
        '    limits:',
        '      human_rate_per_min: 9',
        '',
      ].join('\n'),
    );
    const warnings = [];
    const cfg = readComms(cwd, { warn: (m) => warnings.push(m) });
    assert.equal(cfg.interbot_limits.dedup_ttl_sec, 300);
    assert.equal(cfg.interbot_limits.bot_rate_per_min, 7);
    assert.equal(cfg.interbot_limits.max_depth, undefined, 'битый дефолт отброшен');
    assert.equal(cfg.interbot_limits.garbage_key, undefined, 'неизвестный ключ отброшен');
    assert.ok(warnings.some((w) => w.includes('max_depth')), 'warn о битом значении');
    assert.ok(warnings.some((w) => w.includes('garbage_key')), 'warn о неизвестном ключе');
    assert.equal(cfg.channels[0].limits.human_rate_per_min, 9);

    // resolveInterbotLimits читает горячо: тот же cwd → мерж с каналом
    const merged = resolveInterbotLimits(cwd, cfg.channels[0]);
    assert.equal(merged.botRatePerMin, 7);
    assert.equal(merged.humanRatePerMin, 9, 'канал перекрывает');
    assert.equal(merged.dedupTtlMs, 300_000);
    assert.equal(merged.maxDepth, DEFAULT_LIMITS.maxDepth);
  });

  it('writeComms сериализует interbot_limits и limits (roundtrip)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-comms-rt-'));
    try {
      writeComms(dir, {
        chats: [],
        sync_timeout_sec: 120,
        interbot_limits: { dedup_ttl_sec: 60, gate_timeout_sec: 3 },
        channels: [
          {
            id: 'main',
            transport: 'telegram',
            group_id: -100111,
            addressing: 'mention',
            approval: 'auto',
            limits: { max_depth: 4 },
          },
        ],
      });
      const cfg = readComms(dir, { warn: () => {} });
      assert.deepEqual(cfg.interbot_limits, { dedup_ttl_sec: 60, gate_timeout_sec: 3 });
      assert.deepEqual(cfg.channels[0].limits, { max_depth: 4 });
      const merged = resolveInterbotLimits(dir, cfg.channels[0]);
      assert.equal(merged.dedupTtlMs, 60_000);
      assert.equal(merged.maxDepth, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createDedupCache: TTL из конфига доходит до применения (lesson-281)', () => {
  it('check(id, ttlMs) протухает по переданному TTL, а не по хардкоду 10 мин', () => {
    let now = 0;
    const cache = createDedupCache(() => now);
    assert.equal(cache.check(1, 1000), false, 'первый — не дубль');
    assert.equal(cache.check(1, 1000), true, 'в TTL — дубль');
    now = 1500; // прошло 1.5 с > TTL 1 с
    assert.equal(cache.check(1, 1000), false, 'протухло → обработывается заново');
  });

  it('без параметра — прежний дефолт 10 минут (регресс)', () => {
    let now = 0;
    const cache = createDedupCache(() => now);
    cache.check(2);
    now = 9 * 60 * 1000;
    assert.equal(cache.check(2), true, 'внутри 10 мин — дубль');
    now = 11 * 60 * 1000;
    assert.equal(cache.check(2), false, 'за 10 мин — протухло');
  });
});

describe('loadInterbotPrompt: fallback-цепочка (AC3)', () => {
  it('проектный файл важнее пакетного', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-prompt-'));
    try {
      mkdirSync(join(dir, '.vibelog', 'prompts', 'interbot'), { recursive: true });
      writeFileSync(join(dir, '.vibelog', 'prompts', 'interbot', 'incoming.md'), 'Проектный {text}');
      assert.equal(loadInterbotPrompt('incoming', dir), 'Проектный {text}');
      // gate без проектного → пакетный файл
      assert.equal(loadInterbotPrompt('gate', dir), loadInterbotPrompt('gate', undefined));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('без cwd — пакетный шаблон templates/prompts/interbot/', () => {
    const incoming = loadInterbotPrompt('incoming', undefined);
    assert.match(incoming, /<no_answer>/);
    assert.match(incoming, /\[DECISION\]/);
    assert.match(incoming, /\{channel\}/);
    const gate = loadInterbotPrompt('gate', undefined);
    assert.match(gate, /read_only/);
    assert.match(gate, /react/);
    assert.match(gate, /ТОЛЬКО одно слово/);
  });

  it('антидрейф: встроенные строки равны файлам пакета (lesson-208)', () => {
    const read = (name) =>
      readFileSync(join('templates', 'prompts', 'interbot', `${name}.md`), 'utf8').trimEnd();
    assert.equal(loadInterbotPrompt('incoming', undefined), read('incoming'));
    assert.equal(loadInterbotPrompt('gate', undefined), read('gate'));
    assert.equal(INTERBOT_FALLBACK_TEMPLATES.incoming, read('incoming'));
    assert.equal(INTERBOT_FALLBACK_TEMPLATES.gate, read('gate'));
  });
});

describe('renderPromptTemplate (AC3: плейсхолдеры и пустые секции)', () => {
  const template = ['Статика {channel}.', '{quote}', '{context}', '', 'Вопрос:', '{text}'].join(
    '\n',
  );

  it('без секций: строки-плейсхолдеры удалены, форма «Вопрос:\\n<текст>»', () => {
    const out = renderPromptTemplate(template, {
      channel: 'Мой канал',
      quote: '',
      context: '',
      text: 'что с релизом?',
    });
    assert.equal(out, 'Статика Мой канал.\n\nВопрос:\nчто с релизом?');
    assert.ok(!out.includes('цитата'));
  });

  it('секция вставляется блоком (заголовок входит в значение)', () => {
    const out = renderPromptTemplate(template, {
      channel: 'X',
      quote: '\nСообщение, на которое отвечает человек (цитата):\nПривет',
      context: '',
      text: 'вопрос',
    });
    assert.match(out, /цитата[\s\S]*Привет[\s\S]*Вопрос:/);
    assert.ok(out.indexOf('цитата') < out.indexOf('Вопрос:'), 'цитата до «Вопрос:»');
  });

  it('значения не переищутся повторно (вопрос с {channel} внутри)', () => {
    const out = renderPromptTemplate(template, {
      channel: 'KANAL',
      quote: '',
      context: '',
      text: 'что за {channel} и {quote}?',
    });
    assert.ok(out.endsWith('Вопрос:\nчто за {channel} и {quote}?'), 'сырой вопрос');
    assert.match(out, /Статика KANAL\./, 'канал подставлен один раз');
  });
});
