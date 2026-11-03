/**
 * Тесты VL-330 — интерактивный вопрос `ask_user` в веб-чате.
 *
 * Покрывают чистую логику (`src/web/chat-question.ts`): разбор и валидация
 * аргументов ДО паузы, валидация ответа пользователя, формирование
 * синтетического tool-результата, TTL и журнал вопросов. Сквозные сценарии
 * (пауза → resume → продолжение хода) — в `chat.test.mjs`.
 *
 * Каталог — mkdtemp (правило AGENTS.md, lesson-89): фиксированные пути в /tmp
 * при параллельных прогонах затирают друг друга.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ASK_USER_TOOL,
  QUESTION_TTL_MS,
  answerToolResult,
  cancelledQuestionResult,
  isQuestionExpired,
  loadQuestionLog,
  parseAskUserArgs,
  questionAskedAt,
  recordQuestionLog,
  validateAnswer,
} from '../../dist/web/chat-question.js';

/** Валидные аргументы вопроса (база для негативных кейсов). */
function validArgs(extra = {}) {
  return {
    question: 'Продолжить?',
    options: [
      { id: 'yes', label: 'Да' },
      { id: 'no', label: 'Нет' },
    ],
    ...extra,
  };
}

let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-question-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('VL-330 — parseAskUserArgs: валидация до паузы', () => {
  it('валидные аргументы разбираются, allow_custom по умолчанию true', () => {
    const parsed = parseAskUserArgs(validArgs());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.question, 'Продолжить?');
    assert.equal(parsed.value.options.length, 2);
    assert.equal(parsed.value.options[0].id, 'yes');
    assert.equal(parsed.value.allowCustom, true);
  });

  it('описание варианта сохраняется, пустое — отбрасывается', () => {
    const parsed = parseAskUserArgs(
      validArgs({
        options: [
          { id: 'a', label: 'A', description: 'первый подход' },
          { id: 'b', label: 'B', description: '   ' },
        ],
      }),
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.options[0].description, 'первый подход');
    assert.equal('description' in parsed.value.options[1], false);
  });

  it('allow_custom=false сохраняется', () => {
    const parsed = parseAskUserArgs(validArgs({ allow_custom: false }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.allowCustom, false);
  });

  it('пустой question → ошибка', () => {
    for (const question of ['', '   ', undefined, 42]) {
      const parsed = parseAskUserArgs(validArgs({ question }));
      assert.equal(parsed.ok, false, `question=${JSON.stringify(question)}`);
      assert.match(parsed.error, /question/);
    }
  });

  it('меньше двух вариантов → ошибка', () => {
    const parsed = parseAskUserArgs(validArgs({ options: [{ id: 'one', label: 'Один' }] }));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /от 2 до 8/);
  });

  it('больше восьми вариантов → ошибка', () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, label: `Вариант ${i}` }));
    const parsed = parseAskUserArgs(validArgs({ options }));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /от 2 до 8/);
  });

  it('options не массив → ошибка', () => {
    const parsed = parseAskUserArgs(validArgs({ options: 'yes/no' }));
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /options/);
  });

  it('дубли id → ошибка', () => {
    const parsed = parseAskUserArgs(
      validArgs({
        options: [
          { id: 'same', label: 'A' },
          { id: 'same', label: 'B' },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /повторяющийся id/);
  });

  it('пустые id/label у варианта → ошибка', () => {
    const noId = parseAskUserArgs(
      validArgs({ options: [{ id: ' ', label: 'A' }, { id: 'b', label: 'B' }] }),
    );
    assert.equal(noId.ok, false);
    assert.match(noId.error, /пустой id/);

    const noLabel = parseAskUserArgs(
      validArgs({ options: [{ id: 'a', label: '' }, { id: 'b', label: 'B' }] }),
    );
    assert.equal(noLabel.ok, false);
    assert.match(noLabel.error, /пустой label/);
  });
});

describe('VL-330 — validateAnswer: валидация ответа пользователя', () => {
  const asked = parseAskUserArgs(validArgs()).value;

  it('существующий optionId принимается', () => {
    const result = validateAnswer({ optionId: 'yes' }, asked);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { optionId: 'yes' });
  });

  it('чужой optionId отклоняется', () => {
    const result = validateAnswer({ optionId: 'maybe' }, asked);
    assert.equal(result.ok, false);
    assert.match(result.error, /не было среди предложенных/);
  });

  it('custom принимается при allow_custom по умолчанию', () => {
    const result = validateAnswer({ custom: 'свой вариант' }, asked);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { custom: 'свой вариант' });
  });

  it('custom отклоняется при allow_custom=false', () => {
    const strict = parseAskUserArgs(validArgs({ allow_custom: false })).value;
    const result = validateAnswer({ custom: 'свой вариант' }, strict);
    assert.equal(result.ok, false);
    assert.match(result.error, /свободный ввод.*запрещён/);
  });

  it('пустой ответ отклоняется', () => {
    for (const answer of [{}, { optionId: '  ' }, { custom: '' }]) {
      const result = validateAnswer(answer, asked);
      assert.equal(result.ok, false, JSON.stringify(answer));
      assert.match(result.error, /пуст/);
    }
  });

  it('optionId и custom одновременно отклоняются', () => {
    const result = validateAnswer({ optionId: 'yes', custom: 'текст' }, asked);
    assert.equal(result.ok, false);
    assert.match(result.error, /ИЛИ/);
  });
});

describe('VL-330 — синтетический tool-результат', () => {
  const asked = parseAskUserArgs(validArgs()).value;

  it('выбранный вариант → {answer:{id,label}}', () => {
    const content = answerToolResult(asked, { optionId: 'no' });
    assert.deepEqual(JSON.parse(content), { answer: { id: 'no', label: 'Нет' } });
  });

  it('свободный текст → {answer:{custom}}', () => {
    const content = answerToolResult(asked, { custom: 'пожалуй, позже' });
    assert.deepEqual(JSON.parse(content), { answer: { custom: 'пожалуй, позже' } });
  });

  it('снятый вопрос → answer:null с причиной (не «отказ в записи»)', () => {
    const expired = JSON.parse(cancelledQuestionResult('expired'));
    assert.equal(expired.answer, null);
    assert.equal(expired.cancelled, true);
    assert.equal(expired.reason, 'expired');
    assert.match(expired.message, /таймаут/);

    const limit = JSON.parse(cancelledQuestionResult('limit'));
    assert.equal(limit.reason, 'limit');
  });
});

describe('VL-330 — журнал вопросов и TTL 24 ч', () => {
  it('время постановки берётся из журнала', () => {
    assert.equal(questionAskedAt(cwd, 'th-1', 'tc-1'), null);
    recordQuestionLog(cwd, 'th-1', { event: 'asked', toolCallId: 'tc-1', question: 'Вопрос?' });
    const at = questionAskedAt(cwd, 'th-1', 'tc-1');
    assert.ok(typeof at === 'number');
    assert.ok(Math.abs(Date.now() - at) < 5000);
    // журнал пишется отдельным файлом, не в историю треда
    assert.equal(loadQuestionLog(cwd, 'th-1').length, 1);
  });

  it('ответ фиксируется в журнале', () => {
    recordQuestionLog(cwd, 'th-2', { event: 'asked', toolCallId: 'tc-2' });
    recordQuestionLog(cwd, 'th-2', { event: 'answered', toolCallId: 'tc-2', optionId: 'yes' });
    const log = loadQuestionLog(cwd, 'th-2');
    assert.deepEqual(log.map(e => e.event), ['asked', 'answered']);
  });

  it('TTL: запись старше 24 ч считается истёкшей', () => {
    const askedAt = Date.now() - QUESTION_TTL_MS - 1000;
    assert.equal(isQuestionExpired(askedAt), true);
    assert.equal(isQuestionExpired(Date.now() - 1000), false);
    // нет записи (тред старше фичи) — TTL не применяется (fail-open)
    assert.equal(isQuestionExpired(null), false);
  });
});

describe('VL-330 — константы', () => {
  it('имя инструмента и TTL', () => {
    assert.equal(ASK_USER_TOOL, 'ask_user');
    assert.equal(QUESTION_TTL_MS, 24 * 60 * 60 * 1000);
  });
});
