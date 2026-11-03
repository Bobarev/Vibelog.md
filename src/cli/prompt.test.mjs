/**
 * Тесты интерактивного слоя CLI (VL-322): обёртка над `@clack/prompts`.
 *
 * Проверяем то, что принадлежит нам, а не clack: не-TTY-дефолты (AC4),
 * маппинг параметров в промпты clack, превращение отмены в
 * `PromptCancelledError` (AC5). Навигация/галочки/отрисовка — зона clack,
 * их кадры здесь не проверяются (прежние тесты кадров удалены как избыточные).
 *
 * Маппинг проверяется через seam `prompts` (фейковая реализация clack) —
 * реальный TTY в тестах недоступен, а фейк позволяет увидеть, какие опции
 * ушли в промпт. Отмена реальным clack-промптом проверяется отдельно на
 * PassThrough-потоках.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { createPromptSession, isInteractive, PromptCancelledError } from '../../dist/cli/prompt.js';

/** Символ отмены: у clack это приватный `CANCEL_SYMBOL`, для фейка — любой symbol. */
const CANCEL = Symbol('clack:cancel');

/**
 * Фейковая реализация clack: запоминает опции каждого промпта и возвращает
 * заранее заданный результат.
 */
function fakePrompts(result) {
  const calls = [];
  const record = (name) => async (opts) => {
    calls.push({ name, opts });
    return typeof result === 'function' ? result(name, opts) : result;
  };
  return {
    calls,
    prompts: {
      text: record('text'),
      confirm: record('confirm'),
      select: record('select'),
      multiselect: record('multiselect'),
      password: record('password'),
      isCancel: (value) => value === CANCEL,
    },
  };
}

/** Сессия на фейковом clack (интерактивная ветка без TTY). */
function makeFakeSession(result) {
  const fake = fakePrompts(result);
  const session = createPromptSession({
    input: new PassThrough(),
    output: new PassThrough(),
    forceInteractive: true,
    prompts: fake.prompts,
  });
  return { session, calls: fake.calls };
}

/** Даёт event loop прокрутить запись в поток (иначе данные теряются). */
function tick(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('VL-322 — интерактивный слой prompt (обёртка над clack)', () => {
  it('isInteractive: не-TTY потоки — false', () => {
    assert.equal(isInteractive(new PassThrough(), new PassThrough()), false);
  });

  it('не-TTY: askText/askConfirm/askSelect/askMultiselect/askPassword возвращают дефолты', async () => {
    const session = createPromptSession({
      input: new PassThrough(),
      output: new PassThrough(),
    });
    assert.equal(await session.askText('Имя', 'def'), 'def');
    assert.equal(await session.askConfirm('Бот?', true), true);
    assert.equal(
      await session.askSelect('Выбор', [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ], 1),
      'b',
    );
    assert.deepEqual(
      await session.askMultiselect('Агенты', [
        { value: 'vb', label: 'vb' },
        { value: 'qwen', label: 'qwen' },
        { value: 'opencode', label: 'opencode', disabled: true },
      ], ['qwen', 'opencode']),
      ['qwen'],
      'disabled-пункт отфильтрован',
    );
    // VL-324: askPassword в не-TTY возвращает дефолт (обычно '' — «пропустить»)
    assert.equal(await session.askPassword('API-ключ', ''), '');
    session.close();
  });

  it('не-TTY: askSelect с disabled стартовым пунктом берёт первый доступный', async () => {
    const session = createPromptSession({
      input: new PassThrough(),
      output: new PassThrough(),
    });
    assert.equal(
      await session.askSelect('Выбор', [
        { value: 'a', label: 'A', disabled: true },
        { value: 'b', label: 'B' },
      ], 0),
      'b',
    );
  });

  it('askSelect с пустым списком — ошибка', async () => {
    const session = createPromptSession({
      input: new PassThrough(),
      output: new PassThrough(),
    });
    await assert.rejects(() => session.askSelect('Выбор', [], 0), /пустой список/);
  });

  it('askText: в clack уходят message, defaultValue, placeholder и валидация итогового значения', async () => {
    const { session, calls } = makeFakeSession('VT');
    const value = await session.askText('Prefix', 'VL', (v) => (/^[A-Z]+$/.test(v) ? null : 'только заглавные'));
    assert.equal(value, 'VT');
    const [call] = calls;
    assert.equal(call.name, 'text');
    assert.equal(call.opts.message, 'Prefix');
    assert.equal(call.opts.defaultValue, 'VL');
    assert.ok(String(call.opts.placeholder).includes('VL'), call.opts.placeholder);
    // Пустой ввод валидируется как дефолт, невалидный — возвращает текст ошибки
    assert.equal(call.opts.validate(''), undefined);
    assert.equal(call.opts.validate('ab'), 'только заглавные');
    assert.equal(call.opts.validate('VT'), undefined);
    session.close();
  });

  it('askText: пустой ввод превращается в дефолт, пробелы обрезаются', async () => {
    const { session } = makeFakeSession('   ');
    assert.equal(await session.askText('Имя', 'templares'), 'templares');
    session.close();
  });

  it('askConfirm: initialValue из дефолта', async () => {
    const { session, calls } = makeFakeSession(false);
    assert.equal(await session.askConfirm('Бот?', false), false);
    assert.equal(calls[0].name, 'confirm');
    assert.equal(calls[0].opts.initialValue, false);
    session.close();
  });

  it('askSelect: initialValue — значение пункта по initialIndex, disabled пропускается', async () => {
    const { session, calls } = makeFakeSession('settings');
    const value = await session.askSelect('Секреты', [
      { value: 'env', label: '.env' },
      { value: 'settings', label: 'settings.json', hint: 'в settings' },
    ], 1);
    assert.equal(value, 'settings');
    const [call] = calls;
    assert.equal(call.name, 'select');
    assert.equal(call.opts.initialValue, 'settings');
    assert.deepEqual(call.opts.options, [
      { value: 'env', label: '.env' },
      { value: 'settings', label: 'settings.json', hint: 'в settings' },
    ]);
    session.close();
  });

  it('askMultiselect: initialValues отфильтрованы по disabled, required: false', async () => {
    const { session, calls } = makeFakeSession(['qwen']);
    const value = await session.askMultiselect('Агенты', [
      { value: 'vb', label: 'vb' },
      { value: 'qwen', label: 'qwen' },
      { value: 'opencode', label: 'opencode', hint: 'Скоро', disabled: true },
    ], ['qwen', 'opencode']);
    assert.deepEqual(value, ['qwen']);
    const [call] = calls;
    assert.equal(call.name, 'multiselect');
    assert.deepEqual(call.opts.initialValues, ['qwen']);
    assert.equal(call.opts.required, false, 'пустой выбор должен быть допустим');
    assert.equal(call.opts.options[2].disabled, true);
    session.close();
  });

  it('VL-324: askPassword маппится на clack.password, пустой ввод → дефолт', async () => {
    const { session, calls } = makeFakeSession('  secret-value  ');
    assert.equal(await session.askPassword('API-ключ ROUTERAI_API_KEY', ''), 'secret-value');
    const [call] = calls;
    assert.equal(call.name, 'password', 'используется маскированный промпт, а не text');
    assert.equal(call.opts.message, 'API-ключ ROUTERAI_API_KEY');
    assert.equal(call.opts.input !== undefined, true, 'потоки инъектируются');
    session.close();
  });

  it('VL-324: askPassword с пустым вводом возвращает переданный дефолт', async () => {
    const { session } = makeFakeSession('   ');
    assert.equal(await session.askPassword('API-ключ', ''), '');
    session.close();
  });

  it('отмена (CANCEL_SYMBOL) в любом промпте — PromptCancelledError', async () => {
    for (const run of [
      (s) => s.askText('Имя', 'x'),
      (s) => s.askConfirm('Бот?', true),
      (s) => s.askSelect('Выбор', [{ value: 'a', label: 'A' }], 0),
      (s) => s.askMultiselect('Агенты', [{ value: 'vb', label: 'vb' }], []),
      (s) => s.askPassword('API-ключ', ''),
    ]) {
      const { session } = makeFakeSession(CANCEL);
      await assert.rejects(() => run(session), (err) => err instanceof PromptCancelledError);
      session.close();
    }
  });

  it('Ctrl+C в реальном clack-промпте — PromptCancelledError', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = createPromptSession({ input, output, forceInteractive: true });
    const p = session.askText('Имя', 'x');
    await tick();
    input.write('\u0003');
    await assert.rejects(p, (err) => err instanceof PromptCancelledError);
    session.close();
  });

  it('Ctrl+C в реальном clack-списке — PromptCancelledError', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = createPromptSession({ input, output, forceInteractive: true });
    const p = session.askSelect('Выбор', [{ value: 'a', label: 'A' }], 0);
    await tick();
    input.write('\u0003');
    await assert.rejects(p, (err) => err instanceof PromptCancelledError);
    session.close();
  });
});
