/**
 * Команда `vibelog config` — управление конфигом проекта.
 *
 * Подкоманды:
 * - get <key> — показать значение
 * - set <key> <value> — изменить значение (типизация по ключу)
 * - list — все ключи конфига
 *
 * Ключи — как в backlog/config.yml (snake_case, формат оригинала Backlog.md).
 * Семантика оригинала: фиксированный список ключей + парсинг значения по типу.
 */

import { printSuccess, printError, printInfo } from '../ui.mjs';
import { loadConfig, saveConfig, defaultConfig } from '../../core/config.mjs';

/** Ключи-массивы: значение парсится как JSON-массив или список через запятую. */
const ARRAY_KEYS = ['statuses', 'labels', 'priorities', 'types', 'definition_of_done'];

/** Ключи-boolean: значение true/false. */
const BOOLEAN_KEYS = ['auto_open_browser', 'remote_operations', 'auto_commit', 'bypass_git_hooks', 'check_active_branches'];

/** Ключи-числа: значение парсится Number(). */
const NUMBER_KEYS = ['default_port', 'active_branch_days', 'max_column_width'];

/**
 * Whitelist допустимых ключей — из defaultConfig.
 *
 * @returns {string[]}
 */
function allowedKeys() {
  return Object.keys(defaultConfig('x', 'x'));
}

/**
 * Парсит строковое значение по типу ключа.
 *
 * @param {string} key
 * @param {string} raw — строка из CLI
 * @returns {string|number|boolean|string[]}
 * @throws {Error} — при невалидном значении
 */
function parseValue(key, raw) {
  if (ARRAY_KEYS.includes(key)) {
    // JSON-массив ("[\"a\",\"b\"]") или список через запятую ("a,b")
    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map(String);
      } catch { /* fallthrough: comma-режим */ }
    }
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (BOOLEAN_KEYS.includes(key)) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${key}: ожидается true или false, получено: ${raw}`);
  }
  if (NUMBER_KEYS.includes(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key}: ожидается число, получено: ${raw}`);
    return n;
  }
  return raw;
}

/**
 * Форматирует значение для вывода.
 *
 * @param {unknown} value
 * @returns {string}
 */
function formatValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Выполняет команду config.
 *
 * @param {string} subcommand
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runConfig(subcommand, positional, flags, cwd) {
  switch (subcommand) {
    case 'get':
      return configGet(positional, cwd);
    case 'set':
      return configSet(positional, cwd);
    case 'list':
      return configList(cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: get, set, list');
  }
}

/**
 * Проверяет ключ по whitelist; при ошибке печатает подсказку.
 *
 * @param {string} key
 * @returns {boolean}
 */
function checkKey(key) {
  if (!allowedKeys().includes(key)) {
    printError(`Неизвестный ключ конфига: ${key}`);
    printInfo(`Допустимые: ${allowedKeys().join(', ')}`);
    return false;
  }
  return true;
}

function configGet(positional, cwd) {
  const key = positional[0];
  if (!key) {
    printError('Использование: vibelog config get <key>');
    return;
  }
  if (!checkKey(key)) return;

  const config = loadConfig(cwd);
  const value = config[key];
  if (value === undefined || value === '') {
    printInfo('Пусто');
    return;
  }
  console.log(formatValue(value));
}

function configSet(positional, cwd) {
  const key = positional[0];
  // Значение — всё остальное (может содержать пробелы); пустая строка допустима (очистка)
  const raw = positional.slice(1).join(' ');
  if (!key || positional.length < 2) {
    printError('Использование: vibelog config set <key> <value>');
    return;
  }
  if (!checkKey(key)) return;

  try {
    const parsed = parseValue(key, raw);
    const config = loadConfig(cwd);
    config[key] = parsed;
    saveConfig(cwd, config);
    printSuccess(`${key} = ${formatValue(parsed)}`);
  } catch (err) {
    printError(err.message);
  }
}

function configList(cwd) {
  const config = loadConfig(cwd);
  console.log('');
  for (const [k, v] of Object.entries(config)) {
    console.log(`  ${k} = ${formatValue(v)}`);
  }
}
