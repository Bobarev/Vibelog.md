/**
 * Тесты VL-298 — LLM-judge экспериментов (`src/core/judge.ts`, doc-21 §4/§11).
 *
 * Сеть НЕ используется: `scoreRows` получает мок-`LlmClient` (интерфейс
 * `streamChat`), поэтому ни `fetch`, ни `createLlmClient` не вызываются.
 * Даже если бы вызвались — глобальный fetch-guard test-setup заблокировал бы
 * не-loopback хост (VL-132).
 *
 * `cwd` — mkdtemp-каталог без `.vibelog/settings.json`: иначе резолв модели
 * судьи подхватил бы локальный `models.default` с `api_mode: responses`
 * (lesson-78/84/145).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildJudgePrompt, buildJudgeMessages, parseJudgeScore, validateJudgeConfig, scoreRows,
} from '../../dist/core/judge.js';
import { zeroUsage } from '../../dist/agent/llm.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-judge-'));

/** Базовая конфигурация numeric-судьи (1..10). */
const JUDGE = { enabled: true, scale: 'numeric', score_min: 1, score_max: 10 };

/** PASS/FAIL-конфигурация. */
const JUDGE_PF = { enabled: true, scale: 'pass_fail', score_min: 0, score_max: 1 };

/** Мок-клиент: возвращает ответы из очереди, считает вызовы и usage. */
function mockClient(texts, { usage } = {}) {
  const state = { calls: 0, messages: [] };
  const client = {
    model: 'mock/judge',
    async streamChat(messages) {
      state.messages.push(messages);
      const idx = Math.min(state.calls, texts.length - 1);
      state.calls += 1;
      const item = texts[idx];
      if (item instanceof Error) throw item;
      return {
        text: String(item),
        toolCalls: [],
        usage: usage ?? { ...zeroUsage(), input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      };
    },
  };
  return { client, state };
}

beforeAll(() => {
  // Каталог существует и пуст: settings.json нет → env-fallback резолва модели
  assert.ok(testRoot.length > 0);
});
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-298 — parseJudgeScore (numeric)', () => {
  it('«7/10» при шкале 1..10 → 7, а не 0.7', () => {
    assert.equal(parseJudgeScore('7/10 — почти всё хорошо', JUDGE), 7);
  });

  it('«0.7» при шкале 0..1 → 0.7', () => {
    const judge = { enabled: true, scale: 'numeric', score_min: 0, score_max: 1 };
    assert.equal(parseJudgeScore('0.7', judge), 0.7);
  });

  it('«85%» при шкале 0..1 → 0.85', () => {
    const judge = { enabled: true, scale: 'numeric', score_min: 0, score_max: 1 };
    assert.equal(parseJudgeScore('соответствие 85%', judge), 0.85);
  });

  it('дробь с другим знаменателем: 3/5 при шкале 1..10 → 3 (числитель)', () => {
    assert.equal(parseJudgeScore('3/5', JUDGE), 3);
  });

  it('голое число и десятичная запятая', () => {
    assert.equal(parseJudgeScore('Оценка: 8 из 10', JUDGE), 8);
    const judge = { enabled: true, scale: 'numeric', score_min: 0, score_max: 1 };
    assert.equal(parseJudgeScore('0,6 — средне', judge), 0.6);
  });

  it('значение вне шкалы → null (не обрезается до границы)', () => {
    assert.equal(parseJudgeScore('42 из 10', JUDGE), null);
    assert.equal(parseJudgeScore('0', JUDGE), null);
  });

  it('мусор без чисел → null', () => {
    assert.equal(parseJudgeScore('не могу оценить', JUDGE), null);
    assert.equal(parseJudgeScore('', JUDGE), null);
    assert.equal(parseJudgeScore('   ', JUDGE), null);
  });
});

describe('VL-298 — parseJudgeScore (pass_fail)', () => {
  it('PASS/FAIL → 1/0 числом, а не булевым', () => {
    assert.equal(parseJudgeScore('PASS', JUDGE_PF), 1);
    assert.equal(parseJudgeScore('FAIL — критерий не выполнен', JUDGE_PF), 0);
  });

  it('варианты слов: passed/failed, да/нет, соответствует/не соответствует', () => {
    assert.equal(parseJudgeScore('passed', JUDGE_PF), 1);
    assert.equal(parseJudgeScore('failed', JUDGE_PF), 0);
    assert.equal(parseJudgeScore('да', JUDGE_PF), 1);
    assert.equal(parseJudgeScore('нет', JUDGE_PF), 0);
    assert.equal(parseJudgeScore('не соответствует', JUDGE_PF), 0);
    assert.equal(parseJudgeScore('соответствует', JUDGE_PF), 1);
  });

  it('1 и 0 числом тоже понимаются', () => {
    assert.equal(parseJudgeScore('1', JUDGE_PF), 1);
    assert.equal(parseJudgeScore('0', JUDGE_PF), 0);
  });

  it('«fail» не матчится как «pass» (порядок проверок)', () => {
    // Регресс: подстрочный поиск /pass/ внутри «failed» не должен давать 1
    assert.equal(parseJudgeScore('failed test', JUDGE_PF), 0);
  });

  it('мусор → null', () => {
    assert.equal(parseJudgeScore('затрудняюсь', JUDGE_PF), null);
  });
});

describe('VL-298 — validateJudgeConfig', () => {
  it('корректная numeric-конфигурация без проблем', () => {
    assert.deepEqual(validateJudgeConfig(JUDGE), []);
  });

  it('отсутствие секции — проблема', () => {
    const problems = validateJudgeConfig(undefined);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'judge');
  });

  it('score_min >= score_max — проблема', () => {
    const problems = validateJudgeConfig({ enabled: true, scale: 'numeric', score_min: 5, score_max: 5 });
    assert.ok(problems.some(p => p.field === 'score_min'));
  });

  it('pass_fail со шкалой 1..10 — проблема (фиксировано 0..1)', () => {
    const problems = validateJudgeConfig({ enabled: true, scale: 'pass_fail', score_min: 1, score_max: 10 });
    assert.ok(problems.some(p => p.message.includes('0..1')));
  });

  it('enabled=false — проблема-предупреждение, но не блокирующая (field=enabled)', () => {
    const problems = validateJudgeConfig({ ...JUDGE, enabled: false });
    assert.deepEqual(problems.map(p => p.field), ['enabled']);
  });

  it('нечисловые границы — проблемы', () => {
    const problems = validateJudgeConfig({
      enabled: true, scale: 'numeric', score_min: Number.NaN, score_max: Number.NaN,
    });
    assert.equal(problems.filter(p => p.field === 'score_min' || p.field === 'score_max').length, 2);
  });
});

describe('VL-298 — buildJudgePrompt', () => {
  it('включает expected_ac, input и output', () => {
    const prompt = buildJudgePrompt(
      { task_id: 't1', expected_ac: 'возвращает [] для пустого входа', input: 'пустой массив' },
      { task_id: 't1', variant: 'A', score: null, output: 'return []' },
      JUDGE,
    );
    assert.ok(prompt.includes('возвращает [] для пустого входа'));
    assert.ok(prompt.includes('пустой массив'));
    assert.ok(prompt.includes('return []'));
    assert.ok(prompt.includes('от 1 до 10'));
  });

  it('без expected_ac и input промпт всё равно строится (оценка по output)', () => {
    const prompt = buildJudgePrompt(undefined, { task_id: 't2', variant: 'B', score: null, output: 'текст' }, JUDGE);
    assert.ok(prompt.includes('текст'));
    assert.ok(!prompt.includes('Ожидаемый результат'));
  });

  it('pass_fail просит PASS/FAIL и не просит число', () => {
    const prompt = buildJudgePrompt(undefined, { task_id: 't3', variant: 'A', score: null, output: 'x' }, JUDGE_PF);
    assert.ok(prompt.includes('PASS или FAIL'));
    assert.ok(!prompt.includes('от 0 до 1'));
  });

  it('пустой output помечается как «(пусто)»', () => {
    const prompt = buildJudgePrompt(undefined, { task_id: 't4', variant: 'A', score: null }, JUDGE);
    assert.ok(prompt.includes('(пусто)'));
  });

  it('buildJudgeMessages даёт system+user', () => {
    const messages = buildJudgeMessages(undefined, { task_id: 't', variant: 'A', score: null, output: 'o' }, JUDGE);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
  });
});

describe('VL-298 — scoreRows на мок-клиенте (без сети)', () => {
  it('upsert-ит score в существующие строки, повторяя прочие поля', async () => {
    const { client, state } = mockClient(['8/10', '3']);
    const pairs = [
      { result: { task_id: 't1', variant: 'A', score: null, output: 'вариант A' } },
      { result: { task_id: 't2', variant: 'A', score: null, output: 'вариант B', tool_calls: 4 } },
    ];
    const out = await scoreRows(pairs, JUDGE, { client, cwd: testRoot, apiMode: 'chat' });
    assert.equal(state.calls, 2);
    assert.equal(out.rows[0].score, 8);
    assert.equal(out.rows[1].score, 3);
    assert.equal(out.rows[1].tool_calls, 4, 'прочие поля строки должны сохраниться');
    assert.equal(out.scored, 2);
    assert.equal(out.skipped, 0);
  });

  it('перезаписывает прежний score, а не добавляет второй', async () => {
    const { client } = mockClient(['9']);
    const out = await scoreRows(
      [{ result: { task_id: 't1', variant: 'A', score: 5, output: 'o' } }],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(out.rows.length, 1);
    assert.equal(out.rows[0].score, 9);
  });

  it('строка без output не оценивается: score остаётся прежним', async () => {
    const { client, state } = mockClient(['7']);
    const out = await scoreRows(
      [
        { result: { task_id: 't1', variant: 'A', score: null } },
        { result: { task_id: 't2', variant: 'A', score: null, output: '  ' } },
      ],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(state.calls, 0, 'нет output — нет вызова судьи');
    assert.equal(out.scored, 0);
    assert.equal(out.skipped, 2);
    assert.equal(out.rows[0].score, null);
    assert.equal(out.rows[0].error, undefined);
  });

  it('неразборчивый ответ: строка остаётся, error_kind=judge', async () => {
    const { client } = mockClient(['не могу оценить']);
    const out = await scoreRows(
      [{ result: { task_id: 't1', variant: 'A', score: null, output: 'o' } }],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(out.scored, 0);
    assert.equal(out.skipped, 1);
    assert.equal(out.rows[0].score, null);
    assert.equal(out.rows[0].error_kind, 'judge');
    assert.match(out.rows[0].error, /не удалось разобрать/);
  });

  it('ошибка клиента на одной строке не роняет остальные', async () => {
    const { client, state } = mockClient([new Error('провайдер недоступен'), '6']);
    const out = await scoreRows(
      [
        { result: { task_id: 't1', variant: 'A', score: null, output: 'x' } },
        { result: { task_id: 't2', variant: 'A', score: null, output: 'y' } },
      ],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(state.calls, 2);
    assert.equal(out.rows[0].score, null);
    assert.equal(out.rows[0].error_kind, 'judge');
    assert.match(out.rows[0].error, /провайдер недоступен/);
    assert.equal(out.rows[1].score, 6);
    assert.equal(out.scored, 1);
    assert.equal(out.skipped, 1);
  });

  it('usage суммируется, requests считает вызовы', async () => {
    const { client } = mockClient(['5', '6', '7']);
    const out = await scoreRows(
      ['a', 'b', 'c'].map((o, i) => ({ result: { task_id: `t${i}`, variant: 'A', score: null, output: o } })),
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(out.usage.requests, 3);
    assert.equal(out.usage.input, 300);
    assert.equal(out.usage.output, 60);
    assert.equal(out.usage.total, 360);
  });

  it('тарифа модели судьи нет → cost null и pricingMissing (не 0)', async () => {
    const { client } = mockClient(['5']);
    const out = await scoreRows(
      [{ result: { task_id: 't1', variant: 'A', score: null, output: 'o' } }],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(out.cost, null);
    assert.equal(out.pricingMissing, true);
  });

  it('непригодная конфигурация judge → ошибка до вызовов клиента', async () => {
    const { client, state } = mockClient(['5']);
    await assert.rejects(
      () => scoreRows(
        [{ result: { task_id: 't1', variant: 'A', score: null, output: 'o' } }],
        { enabled: true, scale: 'pass_fail', score_min: 1, score_max: 10 },
        { client, cwd: testRoot, apiMode: 'chat' },
      ),
      /Конфигурация judge непригодна/,
    );
    assert.equal(state.calls, 0);
  });

  it('pass_fail-строки получают 1/0 числом', async () => {
    const { client } = mockClient(['PASS', 'FAIL']);
    const out = await scoreRows(
      [
        { result: { task_id: 't1', variant: 'A', score: null, output: 'ok' } },
        { result: { task_id: 't2', variant: 'A', score: null, output: 'bad' } },
      ],
      JUDGE_PF, { client, cwd: testRoot, apiMode: 'chat' },
    );
    assert.equal(out.rows[0].score, 1);
    assert.equal(out.rows[1].score, 0);
  });

  it('expected_ac из строки датасета попадает в промпт', async () => {
    const { client, state } = mockClient(['7']);
    await scoreRows(
      [{
        dataset: { task_id: 't1', expected_ac: 'ОЖИДАЕМЫЙ-КРИТЕРИЙ' },
        result: { task_id: 't1', variant: 'A', score: null, output: 'o' },
      }],
      JUDGE, { client, cwd: testRoot, apiMode: 'chat' },
    );
    const userMessage = state.messages[0].find(m => m.role === 'user');
    assert.ok(userMessage.content.includes('ОЖИДАЕМЫЙ-КРИТЕРИЙ'));
  });

  it('явно указанная неизвестная модель судьи без мока клиента → ошибка с id модели', async () => {
    // Без opts.client клиент строился бы по env — до этого не доходим: резолв
    // модели идёт первым и обязан назвать неизвестный id в тексте ошибки.
    await assert.rejects(
      () => scoreRows([], { ...JUDGE, model: 'nope/unknown-model' }, { cwd: testRoot, apiMode: 'chat' }),
      /nope\/unknown-model/,
    );
  });
});
