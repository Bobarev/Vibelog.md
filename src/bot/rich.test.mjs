/**
 * Тесты VL-39 — рендер Rich Markdown для Telegram Rich Messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderTaskRich, renderPhaseResultRich, chunkRich, RICH_LIMIT } from '../../dist/bot/rich.js';

const fullTask = {
  id: 'VL-34',
  title: 'Telegram-бот: каркас',
  status: 'Done',
  priority: 'High',
  assignee: ['Pavel'],
  reporter: '',
  created_date: '2026-10-02 11:00',
  updated_date: '2026-10-02 12:00',
  due_date: '2026-10-05',
  labels: ['bot', 'telegram'],
  dependencies: [],
  milestone: '',
  type: '',
  project: '',
  parent_task_id: '',
  ordinal: 0,
  references: [],
  documentation: [],
  modified_files: [],
  description: 'Описание с ```блоком кода``` внутри',
  acceptanceCriteria: [
    { text: 'Каркас работает', checked: true },
    { text: 'Пин-код генерируется', checked: false },
  ],
  definitionOfDone: [{ text: 'Тесты проходят', checked: true }],
  implementationPlan: '1. Создать модули\n2. Подключить grammy',
  implementationNotes: '',
  finalSummary: 'Готово',
  comments: [
    { author: '@agent', created: '2026-10-02 12:00', text: 'Фаза выполнена' },
    { author: 'Pavel', created: '2026-10-02 12:30', text: 'Отлично' },
  ],
};

describe('renderTaskRich (VL-39)', () => {
  it('шапка: заголовок и меты', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /^# VL-34 — Telegram-бот: каркас/);
    assert.match(md, /\*\*Статус:\*\* Done/);
    assert.match(md, /\*\*Приоритет:\*\* High/);
    assert.match(md, /\*\*Исполнители:\*\* Pavel/);
    assert.match(md, /\*\*Метки:\*\* bot, telegram/);
    assert.match(md, /\*\*Срок:\*\* 2026-10-05/);
  });

  it('AC/DoD — task list с отметками', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /## Acceptance Criteria\n\n- \[x\] Каркас работает\n- \[ \] Пин-код генерируется/);
    assert.match(md, /## Definition of Done\n\n- \[x\] Тесты проходят/);
  });

  it('секции plan/summary присутствуют, пустые notes опущены', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /## Implementation Plan\n\n1\. Создать модули/);
    assert.match(md, /## Final Summary\n\nГотово/);
    assert.doesNotMatch(md, /Implementation Notes/);
  });

  it('комментарии: автор, дата, разделитель', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /## Комментарии/);
    assert.match(md, /\*\*@agent\*\* · 2026-10-02 12:00\n\nФаза выполнена/);
    assert.match(md, /\n\n---\n\n\*\*Pavel\*\*/);
  });

  it('описание с ``` экранируется (не ломает GFM)', () => {
    const md = renderTaskRich(fullTask);
    assert.doesNotMatch(md, /```блок/);
    assert.match(md, /` ` `блоком кода` ` `/);
  });

  it('минимальная задача: только шапка', () => {
    const minimal = {
      ...fullTask,
      description: '',
      acceptanceCriteria: [],
      definitionOfDone: [],
      implementationPlan: '',
      finalSummary: '',
      comments: [],
      labels: [],
      assignee: [],
    };
    const md = renderTaskRich(minimal);
    assert.match(md, /^# VL-34/);
    assert.doesNotMatch(md, /## /);
  });
});

describe('renderPhaseResultRich (VL-71)', () => {
  const okRun = {
    running: false,
    phase: 'comment',
    exitCode: 0,
    result: {
      result: 'понг (тест) [скобки]',
      is_error: false,
      num_turns: 1,
      duration_ms: 42411,
      duration_api_ms: 42369,
      session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
      usage: {
        input_tokens: 10956,
        output_tokens: 19,
        cache_read_input_tokens: 10944,
        total_tokens: 10975,
      },
    },
  };

  it('успех: заголовок, меты, session_id в backticks; скобки без экранирования', () => {
    const md = renderPhaseResultRich(okRun);
    assert.match(md, /^# Фаза comment: завершена \(код 0\)/);
    assert.match(md, /понг \(тест\) \[скобки\]/);
    assert.doesNotMatch(md, /\\\(/);
    assert.match(md, /\*\*Входные токены:\*\* 10956/);
    assert.match(md, /\*\*Сгенерированные токены:\*\* 19/);
    assert.match(md, /\*\*Кэш-токены:\*\* 10944/);
    assert.match(md, /\*\*Всего токенов:\*\* 10975/);
    assert.match(md, /\*\*Общее время:\*\* 42411 мс \(api: 42369 мс\)/);
    assert.match(md, /\*\*Количество запросов:\*\* 1/);
    assert.match(md, /`a470c7dd-2ca8-4510-9d81-b184f932af76`/);
  });

  it('фолбэк без result: logTail в тройных backticks', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: undefined,
      logTail: 'warn: обрыв\n```\nвнутри лога\n```',
    });
    assert.match(md, /\*\*Данные результата недоступны\*\*/);
    assert.match(md, /```/);
    // тройные backticks внутри logTail экранируются fenceSafe — блок не ломается
    assert.match(md, /` ` `\nвнутри лога/);
    assert.doesNotMatch(md, /```внутри/);
  });

  it('ошибка: ненулевой код и is_error при коде 0', () => {
    const codeErr = renderPhaseResultRich({ ...okRun, exitCode: 1 });
    assert.match(codeErr, /# Фаза comment: ошибка \(код 1\)/);
    const qwenErr = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, is_error: true },
    });
    assert.match(qwenErr, /# Фаза comment: ошибка \(код 0\) \(ошибка qwen\)/);
  });

  it('пустой session_id — строки нет', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, session_id: '' },
    });
    assert.doesNotMatch(md, /a470c7dd/);
    assert.match(md, /Количество запросов:\*\* 1/);
  });

  it('result длиннее 1500 символов — обрезка с многоточием', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, result: 'а'.repeat(1600) },
    });
    assert.match(md, /а{1500}…/);
  });
});
describe('chunkRich (VL-39)', () => {
  it('короткий текст — одна часть', () => {
    assert.deepEqual(chunkRich('короткий'), ['короткий']);
  });

  it('длинный текст — разбивка по границам абзацев', () => {
    const long = 'абзац. '.repeat(10000); // ~70К символов
    const chunks = chunkRich(long, 1000);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 1000, `часть ${c.length} > 1000`);
  });

  it('лимит по умолчанию — RICH_LIMIT', () => {
    assert.equal(RICH_LIMIT, 32768);
  });
});
