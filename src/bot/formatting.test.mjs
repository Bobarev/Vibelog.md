/**
 * Тесты VL-34 — форматирование ответов бота.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatTaskList, formatTaskDetail, formatBoard } from '../../dist/bot/formatting.js';

const task = {
  id: 'VL-1',
  title: 'Тестовая задача',
  status: 'To Do',
  priority: 'High',
  assignee: ['Pavel'],
  reporter: '',
  due_date: '2026-10-05',
  labels: ['backend'],
  description: 'Описание задачи',
  comments: [],
};

describe('formatting (VL-34)', () => {
  it('formatTaskList: строки с ID и статусом', () => {
    const text = formatTaskList([task]);
    assert.match(text, /VL-1 — Тестовая задача \[To Do\]/);
  });

  it('formatTaskList: пустой список', () => {
    assert.match(formatTaskList([]), /Задач нет/);
  });

  it('formatTaskDetail: все поля', () => {
    const text = formatTaskDetail(task);
    assert.match(text, /VL-1 — Тестовая задача/);
    assert.match(text, /Статус: To Do/);
    assert.match(text, /Приоритет: High/);
    assert.match(text, /Исполнители: Pavel/);
    assert.match(text, /Метки: backend/);
    assert.match(text, /Срок: 2026-10-05/);
    assert.match(text, /Описание задачи/);
  });

  it('formatBoard: количество по статусам', () => {
    const text = formatBoard(['To Do', 'Done'], [task]);
    assert.match(text, /To Do: 1/);
    assert.match(text, /Done: 0/);
  });

  it('formatBoard: пустые статусы', () => {
    assert.match(formatBoard([], [task]), /Статусы не настроены/);
  });
});
