/**
 * Утилиты отображения для CLI Vibelog.md.
 *
 * ANSI-цвета, форматирование таблиц, промпты.
 * Минимальная реализация без сторонних зависимостей.
 */

import readline from 'node:readline';

/**
 * ANSI-коды цветов.
 * Используем базовые 8 цветов — они работают на всех терминалах.
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * Оборачивает текст в ANSI-цвет.
 *
 * @param {string} text — текст
 * @param {string} color — ANSI-код цвета
 * @returns {string}
 */
export function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

/**
 * Выводит заголовок команды.
 *
 * @param {string} title — текст заголовка
 */
export function printHeader(title) {
  console.log(`\n${colorize(` ${title} `, colors.bold + colors.cyan)}\n`);
}

/**
 * Выводит сообщение об успехе.
 *
 * @param {string} message
 */
export function printSuccess(message) {
  console.log(`${colorize('✓', colors.green)} ${message}`);
}

/**
 * Выводит сообщение об ошибке.
 *
 * @param {string} message
 */
export function printError(message) {
  console.error(`${colorize('✗', colors.red)} ${message}`);
}

/**
 * Выводит информационное сообщение.
 *
 * @param {string} message
 */
export function printInfo(message) {
  console.log(`${colorize('ℹ', colors.blue)} ${message}`);
}

/**
 * Выводит предупреждение.
 *
 * @param {string} message
 */
export function printWarning(message) {
  console.log(`${colorize('⚠', colors.yellow)} ${message}`);
}

/**
 * Выводит таблицу задач в терминале.
 *
 * @param {object[]} tasks — массив задач
 * @param {object} [options] — опции отображения
 * @param {string[]} [options.columns] — список полей для отображения
 * @param {number} [options.maxWidth=20] — максимальная ширина колонки
 */
export function printTaskTable(tasks, options = {}) {
  const columns = options.columns || ['id', 'title', 'status', 'priority', 'labels'];
  const maxWidth = options.maxWidth || 20;

  if (tasks.length === 0) {
    printInfo('Задач не найдено.');
    return;
  }

  // Формируем строки
  const rows = tasks.map(task => {
    return columns.map(col => {
      let val = task[col];
      if (Array.isArray(val)) val = val.join(', ');
      if (val === undefined || val === null) val = '';
      val = String(val);
      // Обрезаем длинные значения
      if (val.length > maxWidth) val = val.slice(0, maxWidth - 2) + '..';
      return val;
    });
  });

  // Вычисляем ширину колонок
  const widths = columns.map((col, i) => {
    const headerLen = col.length;
    const maxDataLen = Math.max(...rows.map(r => r[i].length));
    return Math.max(headerLen, maxDataLen) + 2; // +2 для отступов
  });

  // Вывод заголовка
  const header = columns.map((col, i) => col.padEnd(widths[i])).join('');
  console.log(colorize(header, colors.bold));

  // Разделитель
  const separator = widths.map(w => '─'.repeat(w)).join('');
  console.log(colorize(separator, colors.dim));

  // Строки
  for (const row of rows) {
    const line = row.map((cell, i) => cell.padEnd(widths[i])).join('');
    console.log(line);
  }

  console.log(`\n${colorize(`${tasks.length} задач`, colors.dim)}`);
}

/**
 * Выводит одну задачу в развёрнутом виде.
 *
 * @param {object} task — объект задачи
 */
export function printTaskDetail(task) {
  printHeader(`${task.id} — ${task.title}`);

  const fields = [
    ['Статус', task.status],
    ['Приоритет', task.priority],
    ['Исполнитель', Array.isArray(task.assignee) ? task.assignee.join(', ') : task.assignee],
    ['Метки', Array.isArray(task.labels) ? task.labels.join(', ') : ''],
    ['Зависимости', Array.isArray(task.dependencies) ? task.dependencies.join(', ') : ''],
    ['Создано', task.created_date],
    ['Обновлено', task.updated_date],
  ];

  for (const [label, value] of fields) {
    if (value) {
      console.log(`  ${colorize(label + ':', colors.dim)} ${value}`);
    }
  }

  if (task.description) {
    console.log(`\n${colorize('Описание:', colors.bold)}\n`);
    console.log(task.description);
  }

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    console.log(`\n${colorize('Критерии приёмки:', colors.bold)}`);
    for (const ac of task.acceptanceCriteria) {
      const mark = ac.checked ? colorize('✓', colors.green) : colorize('○', colors.dim);
      console.log(`  ${mark} #${task.acceptanceCriteria.indexOf(ac) + 1} ${ac.text}`);
    }
  }

  if (task.definitionOfDone && task.definitionOfDone.length > 0) {
    console.log(`\n${colorize('Definition of Done:', colors.bold)}`);
    for (const dod of task.definitionOfDone) {
      const mark = dod.checked ? colorize('✓', colors.green) : colorize('○', colors.dim);
      console.log(`  ${mark} ${dod.text}`);
    }
  }
}

/**
 * Рендерит ANSI-канбан-доску.
 *
 * @param {object[]} tasks — массив задач
 * @param {string[]} statuses — список статусов (колонки)
 * @param {number} [maxWidth=30] — максимальная ширина колонки
 */
export function printBoard(tasks, statuses, maxWidth = 30) {
  // Группируем задачи по статусу
  const grouped = {};
  for (const status of statuses) {
    grouped[status] = [];
  }
  for (const task of tasks) {
    const status = task.status || 'To Do';
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(task);
  }

  // Рисуем колонки
  const colWidth = Math.max(maxWidth, 15);
  const header = statuses.map(s => colorize(s.padEnd(colWidth), colors.bold)).join(' │ ');
  console.log(`\n${header}`);
  console.log(statuses.map(() => '─'.repeat(colWidth)).join('─┼─'));

  // Находим максимальное количество строк
  const maxRows = Math.max(...statuses.map(s => grouped[s].length));

  for (let row = 0; row < maxRows; row++) {
    const cells = statuses.map(status => {
      const taskList = grouped[status];
      if (row < taskList.length) {
        const task = taskList[row];
        const text = `${task.id} ${task.title}`;
        const truncated = text.length > colWidth - 2 ? text.slice(0, colWidth - 4) + '..' : text;
        return truncated.padEnd(colWidth);
      }
      return ' '.repeat(colWidth);
    });
    console.log(cells.join(' │ '));
  }

  console.log(`\n${colorize(`${tasks.length} задач`, colors.dim)}`);
}

/**
 * Запрашивает ввод пользователя через readline.
 *
 * @param {string} prompt — текст приглашения
 * @returns {Promise<string>} — введённая строка
 */
export function prompt(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(promptText, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Запрашивает подтверждение (да/нет).
 *
 * @param {string} question — текст вопроса
 * @returns {Promise<boolean>}
 */
export async function confirm(question) {
  const answer = await prompt(`${question} (y/n): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
