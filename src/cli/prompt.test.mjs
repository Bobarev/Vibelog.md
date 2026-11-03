/**
 * Тесты интерактивного слоя CLI (VL-320): навигация, переключение галочек,
 * отмена, дефолты в не-TTY.
 *
 * Потоки инъектируются (PassThrough) + forceInteractive: true — реальный TTY
 * в тестах недоступен, а raw-mode на PassThrough не нужен (setRawMode
 * отсутствует, слой это учитывает).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { createPromptSession, isInteractive, PromptCancelledError } from '../../dist/cli/prompt.js';

/** Создаёт сессию на PassThrough-потоках и собирает вывод. */
function makeSession() {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => {
    text += chunk.toString('utf8');
  });
  const session = createPromptSession({ input, output, forceInteractive: true });
  return { session, input, output, getText: () => text };
}

/** Последний кадр списка: строки после последнего перевода курсора вверх. */
function lastFrame(text) {
  const chunks = text.split('\x1b[2A');
  const tail = chunks[chunks.length - 1];
  return tail
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, ''))
    .filter((l) => l.includes('❯') || l.includes('[x]') || l.includes('[ ]'));
}

/** Даёт event loop прокрутить запись в поток (иначе данные теряются). */
function tick(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('VL-320 — интерактивный слой prompt', () => {
  it('isInteractive: не-TTY потоки — false', () => {
    assert.equal(isInteractive(new PassThrough(), new PassThrough()), false);
  });

  it('не-TTY: askText/askConfirm/askSelect/askMultiselect возвращают дефолты', async () => {
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
    session.close();
  });

  it('askText: Enter — дефолт, ввод — значение', async () => {
    const { session, input } = makeSession();
    const p1 = session.askText('Имя проекта', 'templares');
    input.write('\r');
    assert.equal(await p1, 'templares');

    const p2 = session.askText('Имя проекта', 'templares');
    input.write('Vibelog Templates\r');
    assert.equal(await p2, 'Vibelog Templates');
    session.close();
  });

  it('askText: валидация в цикле — невалидный ввод переспрашивает', async () => {
    const { session, input } = makeSession();
    const p = session.askText('Prefix', 'VL', (v) => (/^[A-Z]+$/.test(v) ? null : 'только заглавные'));
    input.write('ab\r');
    await tick();
    input.write('VT\r');
    assert.equal(await p, 'VT');
    session.close();
  });

  it('askMultiselect: ↓ двигает активный пункт, space переключает, Enter подтверждает', async () => {
    const { session, input, getText } = makeSession();
    const p = session.askMultiselect('Агенты', [
      { value: 'vb', label: 'vb' },
      { value: 'qwen', label: 'qwen' },
    ], []);
    input.write('\u001b[B'); // вниз → qwen
    input.write(' '); // отметить qwen
    input.write('\r');
    assert.deepEqual(await p, ['qwen']);
    // Курсор отрисован на активном пункте: последний кадр содержит ❯ у qwen
    const frame = lastFrame(getText());
    const active = frame.filter((l) => l.includes('❯'));
    assert.equal(active.length, 1, `активная строка одна: ${JSON.stringify(frame)}`);
    assert.ok(active[0].includes('qwen'), `курсор на qwen: ${active[0]}`);
    session.close();
  });

  it('askMultiselect: ↑ с первого пункта уходит на последний (по кругу)', async () => {
    const { session, input } = makeSession();
    const p = session.askMultiselect('Агенты', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ], []);
    input.write('\u001b[A'); // вверх → b
    input.write(' ');
    input.write('\r');
    assert.deepEqual(await p, ['b']);
    session.close();
  });

  it('askMultiselect: disabled-пункт пропускается навигацией и не переключается', async () => {
    const { session, input } = makeSession();
    const p = session.askMultiselect('Агенты', [
      { value: 'vb', label: 'vb' },
      { value: 'opencode', label: 'opencode', hint: 'Скоро', disabled: true },
      { value: 'qwen', label: 'qwen' },
    ], []);
    input.write('\u001b[B'); // вниз: opencode disabled → qwen
    input.write(' ');
    input.write('\r');
    assert.deepEqual(await p, ['qwen']);
    session.close();
  });

  it('askMultiselect: initial отмечает пункты, space снимает галочку', async () => {
    const { session, input } = makeSession();
    const p = session.askMultiselect('Агенты', [
      { value: 'vb', label: 'vb' },
      { value: 'qwen', label: 'qwen' },
    ], ['qwen']);
    input.write('\u001b[B'); // на qwen
    input.write(' '); // снять
    input.write('\r');
    assert.deepEqual(await p, []);
    session.close();
  });

  it('askSelect: Enter возвращает активный пункт', async () => {
    const { session, input } = makeSession();
    const p = session.askSelect('Секреты', [
      { value: 'env', label: '.env' },
      { value: 'settings', label: 'settings.json' },
    ], 0);
    input.write('\u001b[B');
    input.write('\r');
    assert.equal(await p, 'settings');
    session.close();
  });

  it('Ctrl+C в списке — PromptCancelledError', async () => {
    const { session, input } = makeSession();
    const p = session.askMultiselect('Агенты', [{ value: 'vb', label: 'vb' }], []);
    input.write('\u0003');
    await assert.rejects(p, (err) => err instanceof PromptCancelledError);
    session.close();
  });

  it('Ctrl+C в текстовом вопросе — PromptCancelledError', async () => {
    const { session, input } = makeSession();
    const p = session.askText('Имя', 'x');
    input.write('\u0003');
    await assert.rejects(p, (err) => err instanceof PromptCancelledError);
    session.close();
  });

  it('Esc в списке — отмена', async () => {
    const { session, input } = makeSession();
    const p = session.askSelect('Выбор', [{ value: 'a', label: 'A' }], 0);
    input.write('\u001b');
    await assert.rejects(p, (err) => err instanceof PromptCancelledError);
    session.close();
  });
});
