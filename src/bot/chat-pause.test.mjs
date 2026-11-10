/**
 * Тесты VL-414 — чистые хелперы пауз хода в боте (src/bot/chat-pause.ts).
 *
 * Без grammy и сети: клавиатуры, разбор callback_data, тексты карточек.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  approvalKeyboard,
  approvalText,
  expiredQuestionText,
  parseChatCallback,
  questionKeyboard,
  questionText,
} from '../../dist/bot/chat-pause.js';

describe('parseChatCallback (VL-414)', () => {
  it('AC6: решения approval', () => {
    assert.deepEqual(parseChatCallback('chata:allow'), { kind: 'approval', decision: 'allow' });
    assert.deepEqual(parseChatCallback('chata:deny'), { kind: 'approval', decision: 'deny' });
    assert.deepEqual(parseChatCallback('chata:always'), { kind: 'approval', decision: 'always' });
  });

  it('AC10: индекс варианта вопроса', () => {
    assert.deepEqual(parseChatCallback('chatq:0'), { kind: 'question', index: 0 });
    assert.deepEqual(parseChatCallback('chatq:7'), { kind: 'question', index: 7 });
  });

  it('чужие и битые callback → null (обработчик зовёт next)', () => {
    for (const data of ['', 'comment:VL-1', 'next:VL-1', 'resume:qwen:x', 'chata:', 'chata:maybe', 'chatq:', 'chatq:x', 'chatq:1:2']) {
      assert.equal(parseChatCallback(data), null, `data=${data}`);
    }
  });
});

describe('approvalKeyboard (VL-414)', () => {
  it('AC6: три кнопки — Allow / Deny / Always allow', () => {
    const kb = approvalKeyboard();
    const flat = kb.inline_keyboard.flat();
    assert.equal(flat.length, 3);
    assert.deepEqual(
      flat.map((b) => b.callback_data),
      ['chata:allow', 'chata:deny', 'chata:always']
    );
    for (const button of flat) {
      assert.ok(button.text.length > 0);
      assert.ok(button.callback_data.length <= 64, 'лимит Telegram на callback_data');
    }
  });
});

describe('questionKeyboard (VL-414)', () => {
  it('AC10: по одной кнопке на вариант, callback = chatq:<индекс>', () => {
    const kb = questionKeyboard([
      { id: 'yes', label: 'Да' },
      { id: 'no', label: 'Нет' },
      { id: 'later', label: 'Позже' },
    ]);
    const flat = kb.inline_keyboard.flat();
    assert.equal(flat.length, 3);
    assert.deepEqual(
      flat.map((b) => b.text),
      ['Да', 'Нет', 'Позже']
    );
    assert.deepEqual(
      flat.map((b) => b.callback_data),
      ['chatq:0', 'chatq:1', 'chatq:2']
    );
  });

  it('callback_data не содержит toolCallId (лимит 64 байта)', () => {
    const kb = questionKeyboard([{ id: 'a'.repeat(60), label: 'Длинный id' }]);
    assert.equal(kb.inline_keyboard[0][0].callback_data, 'chatq:0');
  });
});

describe('approvalText (VL-414)', () => {
  it('AC6: имя инструмента и аргументы в тексте, всё экранировано', () => {
    const text = approvalText({ name: 'write_file', args: { path: 'src/a.ts', content: 'x' } });
    assert.match(text, /Требуется подтверждение/);
    assert.match(text, /write\\_file/, 'имя инструмента экранировано для MarkdownV2');
    assert.match(text, /path: src\/a\.ts/);
  });

  it('AC6: превью grant выводится при наличии', () => {
    const text = approvalText({
      name: 'backlog_supervisor',
      args: { action: 'start' },
      grant: {
        runId: 'run-1',
        taskIds: ['VL-1', 'VL-2'],
        tools: [],
        expiresAt: '2026-11-11T00:00:00.000Z',
        grantedAt: '2026-11-10T00:00:00.000Z',
        order: [],
        groups: [],
        rationale: '',
        skipped: [],
        maxParallelPhases: 2,
      },
    });
    assert.match(text, /run\\-1/);
    assert.match(text, /VL\\-1, VL\\-2/);
  });

  it('длинные аргументы обрезаются', () => {
    const text = approvalText({ name: 'write_file', args: { content: 'a'.repeat(1000) } });
    assert.ok(text.length < 1000, 'превью не раздувает карточку');
  });
});

describe('questionText (VL-414)', () => {
  it('AC10: вопрос и description вариантов в тексте, не в кнопке', () => {
    const text = questionText({
      question: 'Продолжить?',
      options: [
        { id: 'yes', label: 'Да', description: 'продолжаем работу' },
        { id: 'no', label: 'Нет' },
      ],
      allowCustom: true,
    });
    assert.match(text, /Продолжить\?/);
    assert.match(text, /продолжаем работу/);
    assert.match(text, /напишите свой ответ/);
  });

  it('AC12: при allowCustom=false подсказка про кнопки', () => {
    const text = questionText({
      question: 'Выберите',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      allowCustom: false,
    });
    assert.match(text, /свободный ввод .* запрещён/);
  });
});

describe('expiredQuestionText (VL-414)', () => {
  it('AC13: сообщение про снятие по TTL 24 ч', () => {
    assert.match(expiredQuestionText(), /24 ч/);
    assert.match(expiredQuestionText(), /снят/);
  });
});
