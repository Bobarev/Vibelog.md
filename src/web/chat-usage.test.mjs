/**
 * Тесты учёта расхода токенов треда веб-чата (VL-313).
 *
 * Проверяем решения плана, а не только счастливый путь:
 * - процент контекста считается по ПИКУ (input + кэш) запросов треда, а не
 *   суммой по ходам (AC3): сумма на 3-м ходу превысила бы окно;
 * - кэш не завышает пик, если он — подмножество input (риск R1 плана);
 * - деньги считаются по тарифу ТОЙ модели, что дала токены (AC4): после
 *   смены модели прошлые ходы не пересчитываются по чужому тарифу;
 * - reasoning — отдельная величина, из output не вычитается (AC5);
 * - модель без context_window → процента нет вовсе (AC6), не «0%»;
 * - персист в `<threadId>.usage.json` читается обратно теми же цифрами (AC2).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  accumulateThreadUsage,
  contextTokens,
  describeThreadUsage,
  loadThreadUsage,
  recordThreadUsage,
  threadUsageView,
} from '../../dist/web/chat-usage.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-usage-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

/** settings.json с двумя моделями: у одной окно и тариф, у второй только тариф. */
function writeModelsSettings() {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(
    join(cwd, '.vibelog', 'settings.json'),
    `${JSON.stringify(
      {
        providers: {
          routerai: { base_url: 'https://routerai.example/v1', api_key: 'test-key' },
        },
        models: {
          default: 'routerai/big',
          available: {
            // Окно 100k, тариф: 100 ₽/1M вход, 200 ₽/1M выход, 10 ₽/1M кэш
            'routerai/big': {
              label: 'Big',
              provider: 'routerai',
              model: 'big',
              context_window: 100_000,
              pricing: { input_per_1m: 100, output_per_1m: 200, cache_per_1m: 10 },
            },
            // Без context_window — процент не считается (AC6); тариф другой
            'routerai/small': {
              label: 'Small',
              provider: 'routerai',
              model: 'small',
              pricing: { input_per_1m: 1000, output_per_1m: 1000, cache_per_1m: 1000 },
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

const usageFile = threadId => join(cwd, '.vibelog', 'chat-sessions', `${threadId}.usage.json`);

describe('chat-usage: занятый контекст запроса (правило кэша)', () => {
  it('кэш внутри input не складывается (OpenAI/Cloud.ru)', () => {
    // 1000 input, из них 800 кэш — занято 1000, а не 1800
    assert.equal(contextTokens(1000, 800), 1000);
  });

  it('кэш больше «чистого» input — складывается (Anthropic-стиль)', () => {
    assert.equal(contextTokens(200, 5000), 5200);
  });

  it('без кэша занято ровно input', () => {
    assert.equal(contextTokens(1234, 0), 1234);
  });
});

describe('chat-usage: накопление по треду', () => {
  it('пик — максимум по запросам, суммы — кумулятивные (AC3)', () => {
    let usage = null;
    usage = accumulateThreadUsage(usage, { modelId: 'routerai/big', input: 10_000, output: 500, cache: 0 });
    usage = accumulateThreadUsage(usage, { modelId: 'routerai/big', input: 25_000, output: 700, cache: 0 });
    usage = accumulateThreadUsage(usage, { modelId: 'routerai/big', input: 30_000, output: 300, cache: 0 });

    // Сумма input = 65000, но занятый контекст — пик 30000
    assert.equal(usage.peakContext, 30_000);
    assert.equal(usage.byModel['routerai/big'].input, 65_000);
    assert.equal(usage.byModel['routerai/big'].output, 1_500);
    assert.equal(usage.byModel['routerai/big'].requests, 3);
  });

  it('reasoning копится отдельно и не вычитается из output (AC5)', () => {
    let usage = null;
    usage = accumulateThreadUsage(usage, { modelId: 'm', input: 1, output: 100, cache: 0, reasoning: 40 });
    usage = accumulateThreadUsage(usage, { modelId: 'm', input: 1, output: 50, cache: 0, reasoning: 10 });
    assert.equal(usage.byModel.m.output, 150);
    assert.equal(usage.byModel.m.reasoning, 50);
  });

  it('модель последнего запроса запоминается (знаменатель процента)', () => {
    const usage = accumulateThreadUsage(null, { modelId: 'routerai/small', input: 5, output: 1, cache: 0 });
    assert.equal(usage.modelId, 'routerai/small');
  });

  it('запрос без modelId попадает в модель треда', () => {
    let usage = accumulateThreadUsage(null, { modelId: 'routerai/big', input: 10, output: 1, cache: 0 });
    usage = accumulateThreadUsage(usage, { input: 20, output: 2, cache: 0 });
    assert.equal(usage.byModel['routerai/big'].input, 30);
    assert.equal(usage.modelId, 'routerai/big');
  });
});

describe('chat-usage: персист и чтение', () => {
  it('запись и чтение возвращают те же цифры (AC2)', () => {
    writeModelsSettings();
    const recorded = recordThreadUsage(cwd, 'chat-persist-1', {
      modelId: 'routerai/big',
      input: 4_000,
      output: 250,
      cache: 1_000,
      reasoning: 20,
    });
    assert.ok(existsSync(usageFile('chat-persist-1')));
    const loaded = loadThreadUsage(cwd, 'chat-persist-1');
    assert.deepEqual(loaded, recorded);
    assert.equal(loaded.byModel['routerai/big'].cache, 1_000);
  });

  it('второй запрос дописывается к сохранённому агрегату, а не перезаписывает', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-persist-2', { modelId: 'routerai/big', input: 100, output: 10, cache: 0 });
    recordThreadUsage(cwd, 'chat-persist-2', { modelId: 'routerai/big', input: 900, output: 30, cache: 0 });
    const loaded = loadThreadUsage(cwd, 'chat-persist-2');
    assert.equal(loaded.byModel['routerai/big'].input, 1_000);
    assert.equal(loaded.byModel['routerai/big'].requests, 2);
    assert.equal(loaded.peakContext, 900);
  });

  it('sidecar не виден как тред (имя с точкой)', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-persist-3', { modelId: 'routerai/big', input: 1, output: 1, cache: 0 });
    // файл учёта — .usage.json, а не .jsonl: список тредов его не увидит
    assert.ok(usageFile('chat-persist-3').endsWith('.usage.json'));
  });

  it('битый JSON / чужой threadId → null, без исключений', () => {
    mkdirSync(join(cwd, '.vibelog', 'chat-sessions'), { recursive: true });
    writeFileSync(usageFile('chat-broken'), '{не json', 'utf8');
    assert.equal(loadThreadUsage(cwd, 'chat-broken'), null);
    assert.equal(loadThreadUsage(cwd, '../etc/passwd'), null);
    assert.equal(loadThreadUsage(cwd, 'chat-absent'), null);
  });
});

describe('chat-usage: вид для панели (рубли и процент)', () => {
  it('рубли считаются по тарифу модели треда (AC4)', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-cost-1', {
      modelId: 'routerai/big',
      input: 1_000_000,
      output: 1_000_000,
      cache: 1_000_000,
    });
    const view = threadUsageView(cwd, 'chat-cost-1');
    // 100 + 200 + 10 = 310 ₽
    assert.equal(view.cost.input, 100);
    assert.equal(view.cost.output, 200);
    assert.equal(view.cost.cache, 10);
    assert.equal(view.cost.total, 310);
  });

  it('смена модели не пересчитывает прошлые ходы по чужому тарифу (AC4)', () => {
    writeModelsSettings();
    // Ход дешёвой моделью: 1M входа по 100 ₽ = 100 ₽
    recordThreadUsage(cwd, 'chat-cost-2', { modelId: 'routerai/big', input: 1_000_000, output: 0, cache: 0 });
    // Сменили модель в пикере: ход дорогой — 1M входа по 1000 ₽ = 1000 ₽
    recordThreadUsage(cwd, 'chat-cost-2', { modelId: 'routerai/small', input: 1_000_000, output: 0, cache: 0 });

    const view = threadUsageView(cwd, 'chat-cost-2');
    assert.equal(view.cost.total, 1_100, 'первый ход должен остаться по тарифу big (100 ₽)');
    assert.equal(view.input, 2_000_000, 'суммы по треду складываются по обеим моделям');
  });

  it('модель без тарифа даёт нулевую стоимость, не ошибку', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-cost-3', { modelId: 'nope/unknown', input: 5_000, output: 5_000, cache: 0 });
    const view = threadUsageView(cwd, 'chat-cost-3');
    assert.equal(view.cost.total, 0);
    assert.equal(view.input, 5_000);
  });

  it('процент — по пику и окну модели (AC3)', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-pct-1', { modelId: 'routerai/big', input: 20_000, output: 100, cache: 0 });
    recordThreadUsage(cwd, 'chat-pct-1', { modelId: 'routerai/big', input: 50_000, output: 100, cache: 0 });
    const view = threadUsageView(cwd, 'chat-pct-1');
    assert.equal(view.contextWindow, 100_000);
    assert.equal(view.percent, 50);
    assert.equal(view.peakContext, 50_000);
  });

  it('модель без context_window → процента нет вовсе (AC6)', () => {
    writeModelsSettings();
    recordThreadUsage(cwd, 'chat-pct-2', { modelId: 'routerai/small', input: 12_345, output: 10, cache: 0 });
    const view = threadUsageView(cwd, 'chat-pct-2');
    assert.equal(view.contextWindow, undefined);
    assert.equal(view.percent, undefined);
    assert.equal(view.input, 12_345, 'токены всё равно показываются');
  });

  it('пустой тред (учёта нет) → null: панель не показывается (AC7)', () => {
    writeModelsSettings();
    assert.equal(threadUsageView(cwd, 'chat-empty'), null);
    assert.equal(describeThreadUsage(cwd, null), null);
  });

  it('context_window парсится терпимо: мусор отбрасывается', () => {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(
      join(cwd, '.vibelog', 'settings.json'),
      `${JSON.stringify({
        providers: { p: { base_url: 'https://e.example/v1', api_key: 'k' } },
        models: {
          default: 'p/m',
          available: {
            'p/m': { provider: 'p', model: 'm', context_window: '200000' },
          },
        },
      })}\n`,
      'utf8',
    );
    recordThreadUsage(cwd, 'chat-pct-3', { modelId: 'p/m', input: 1_000, output: 1, cache: 0 });
    const view = threadUsageView(cwd, 'chat-pct-3');
    assert.equal(view.contextWindow, undefined, 'строка не считается числом окна');
    assert.equal(view.percent, undefined);
  });
});
