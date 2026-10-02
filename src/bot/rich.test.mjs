/**
 * Тесты VL-39 — рендер Rich Markdown для Telegram Rich Messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderTaskRich, chunkRich, RICH_LIMIT } from '../../dist/bot/rich.js';

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
