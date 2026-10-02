/**
 * Тесты VL-34/VL-38 — форматирование ответов бота (MarkdownV2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeMarkdownV2,
  formatTaskList,
  formatTaskDetail,
  formatBoard,
} from '../../dist/bot/formatting.js';

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

describe('formatting (VL-34/VL-38)', () => {
  it('escapeMarkdownV2: все спецсимволы экранированы', () => {
    const raw = '_*[]()~`>#+-=|{}.!\\ text';
    const escaped = escapeMarkdownV2(raw);
    // Каждый спецсимвол предварён обратным слэшем
    assert.equal(escaped, '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\ text');
  });

  it('escapeMarkdownV2: обычный текст без спецсимволов не меняется', () => {
    assert.equal(escapeMarkdownV2('Обычный текст'), 'Обычный текст');
  });

  it('formatTaskList: жирный ID, статус в скобках', () => {
    const text = formatTaskList([task]);
    assert.match(text, /\*VL\\-1\* — Тестовая задача/);
    assert.match(text, /\\\[To Do\\\]/);
  });

  it('formatTaskList: пустой список', () => {
    assert.match(formatTaskList([]), /Задач нет/);
  });

  it('formatTaskDetail: жирный заголовок и метки полей', () => {
    const text = formatTaskDetail(task);
    assert.match(text, /\*VL\\-1 — Тестовая задача\*/);
    assert.match(text, /\*Статус:\* To Do/);
    assert.match(text, /\*Приоритет:\* High/);
    assert.match(text, /\*Исполнители:\* Pavel/);
    assert.match(text, /\*Метки:\* backend/);
    assert.match(text, /\*Срок:\* 2026\\-10\\-05/);
    assert.match(text, /Описание задачи/);
  });

  it('formatTaskDetail: спецсимволы в заголовке экранированы', () => {
    const weird = { ...task, title: 'Фича *x* и [ссылка](http://yandex.ru)' };
    const text = formatTaskDetail(weird);
    assert.match(text, /Фича \\\*x\\\* и \\\[ссылка\\\]\\\(/);
  });

  it('formatBoard: жирные названия колонок', () => {
    const text = formatBoard(['To Do', 'Done'], [task]);
    assert.match(text, /\*To Do:\* 1/);
    assert.match(text, /\*Done:\* 0/);
  });

  it('formatBoard: пустые статусы', () => {
    assert.match(formatBoard([], [task]), /Статусы не настроены/);
  });
});
