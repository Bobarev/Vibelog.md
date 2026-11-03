/**
 * Тесты ввода TUI агента (VL-321): подтверждение на `@clack/prompts` и
 * собственный промпт чата на `@clack/core`.
 *
 * Два уровня (lesson-197): маппинг параметров и отмену проверяем через
 * seam-параметр (фейковый clack — быстрые детерминированные проверки), а
 * поведение промпта чата — на реальном `ChatInputPrompt` с PassThrough
 * (единственный способ убедиться, что редактирование и история действительно
 * работают поверх readline).
 */
import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  ChatInputPrompt,
  createChatPrompt,
  createConfirmPrompt,
  HISTORY_MAX,
  INPUT_MAX_CHARS,
} from '../../dist/agent/tui-input.js';

/** Пауза, чтобы readline успел разобрать нажатие (escapeCodeTimeout = 50 мс). */
function tick(ms = 60) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Входной поток, похожий на TTY: clack проверяет isTTY перед raw-mode. */
function makeInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  return input;
}

/** Выходной поток с шириной терминала (иначе wrapAnsi не знает, куда переносить). */
function makeOutput() {
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 100;
  return output;
}

const streams = [];
afterEach(() => {
  for (const s of streams.splice(0)) s.destroy();
});

describe('createConfirmPrompt (clack confirm, версия как в VL-322)', () => {
  it('маппит вопрос и initialValue и возвращает ответ', async () => {
    const calls = [];
    const result = await createConfirmPrompt('Прервать ход?', false, {
      prompts: {
        confirm: async (opts) => {
          calls.push(opts);
          return true;
        },
        isCancel: (value) => typeof value === 'symbol',
      },
    });
    assert.equal(result, true);
    assert.equal(calls[0].message, 'Прервать ход?');
    assert.equal(calls[0].initialValue, false);
  });

  it('отмена промпта — null, а не false (различимы)', async () => {
    const result = await createConfirmPrompt('Вопрос?', true, {
      prompts: {
        confirm: async () => Symbol('clack:cancel'),
        isCancel: (value) => typeof value === 'symbol',
      },
    });
    assert.equal(result, null);
  });
});

describe('ChatInputPrompt (реальный промпт на PassThrough)', () => {
  it('печатает и редактирует строку, Enter возвращает текст', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const promise = createChatPrompt({ input, output, message: 'сообщение', history: [] });
    await tick();
    input.write('привет');
    await tick();
    // Backspace удаляет последний символ, затем дописываем новый
    input.write('\u007f');
    await tick();
    input.write('!');
    await tick();
    input.write('\r');
    const text = await promise;
    assert.equal(text, 'приве!');
  });

  it('↑ подставляет прошлое сообщение из истории', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const promise = createChatPrompt({
      input,
      output,
      message: 'сообщение',
      history: ['старое сообщение', 'свежее сообщение'],
    });
    await tick();
    // Стрелка вверх: readline подставляет самое свежее сообщение истории
    input.write('\x1b[A');
    await tick();
    input.write('\r');
    assert.equal(await promise, 'свежее сообщение');
  });

  it('Ctrl+C отменяет промпт (null), а не роняет процесс', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const promise = createChatPrompt({ input, output, message: 'сообщение', history: [] });
    await tick();
    input.write('\u0003');
    assert.equal(await promise, null);
  });

  it('Ctrl+D отменяет промпт (null)', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const promise = createChatPrompt({ input, output, message: 'сообщение', history: [] });
    await tick();
    input.write('\u0004');
    assert.equal(await promise, null);
  });

  it('лимит длины: слишком длинная строка не отправляется, промпт живёт дальше', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const prompt = new ChatInputPrompt({ input, output, message: 'сообщение', history: [] });
    const promise = prompt.prompt();
    await tick();
    input.write('x'.repeat(INPUT_MAX_CHARS + 1));
    await tick();
    input.write('\r');
    await tick();
    // Валидация выставила ошибку — промпт не закрылся
    assert.equal(prompt.state, 'error');
    // Убираем лишний символ и отправляем снова
    input.write('\u007f');
    await tick();
    input.write('\r');
    const text = await promise;
    assert.equal(typeof text, 'string');
    assert.equal(text.length, INPUT_MAX_CHARS);
  });

  it('история ограничена HISTORY_MAX записями', () => {
    assert.equal(HISTORY_MAX, 50);
  });

  it('abort signal отменяет открытый промпт (unmount TUI)', async () => {
    const input = makeInput();
    const output = makeOutput();
    streams.push(input, output);
    const ac = new AbortController();
    const promise = createChatPrompt({
      input,
      output,
      message: 'сообщение',
      history: [],
      signal: ac.signal,
    });
    await tick();
    ac.abort();
    assert.equal(await promise, null);
  });
});
