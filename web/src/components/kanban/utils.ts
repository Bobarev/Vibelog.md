/**
 * Утилиты доски VL-27 (по мотивам _components/utils.ts шаблона).
 *
 * Отличие от шаблона: columnIds не константа, а список статусов из конфига,
 * поэтому поиск колонки идёт по динамическому массиву.
 */

import type { BoardState, KanbanTask } from '../../types/kanban';

/**
 * Сборка доски: группировка задач по статусу.
 *
 * Колонки = статусы из конфига + статусы, встретившиеся в задачах,
 * но отсутствующие в конфиге («сироты» — в конец, чтобы карточка не пропала).
 */
export function buildBoard(tasks: KanbanTask[], statuses: string[]): BoardState {
  const board: BoardState = {};
  for (const status of statuses) board[status] = [];
  for (const task of tasks) {
    if (!board[task.status]) board[task.status] = [];
    board[task.status].push(task);
  }
  return board;
}

/** ID колонки, которой принадлежит задача (или сама колонка, если id — статус). */
export function findColumnId(board: BoardState, id: string): string | undefined {
  if (id in board) return id;
  return Object.keys(board).find(columnId =>
    board[columnId].some(task => task.id === id)
  );
}

/** Задача по ID на всей доске. */
export function findTask(board: BoardState, id: string): KanbanTask | undefined {
  for (const tasks of Object.values(board)) {
    const task = tasks.find(item => item.id === id);
    if (task) return task;
  }
  return undefined;
}
