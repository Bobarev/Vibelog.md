/**
 * Парсер аргументов командной строки для Vibelog.md.
 *
 * Поддерживает:
 * - `--flag value` / `-f value` — флаги со значением
 * - `--flag` — флаги-переключатели
 * - Повторяющиеся флаги → массив: `--ac "a" --ac "b"` → `['a', 'b']`
 *
 * Не используем сторонние библиотеки (zero runtime dependencies).
 */

/**
 * Парсит массив аргументов в структурированный объект.
 *
 * Возвращает { command, subcommand, positional, flags }:
 * - command: первая позиция (например "task")
 * - subcommand: вторая позиция (например "create")
 * - positional: остальные позиции
 * - flags: объект с флагами (массивы для повторяющихся)
 *
 * @param {string[]} args — аргументы командной строки (без node и пути к скрипту)
 * @returns {{ command: string, subcommand: string, positional: string[], flags: Record<string, string|boolean|string[]> }}
 */
export function parseArgs(args) {
  const result = {
    command: '',
    subcommand: '',
    positional: [],
    flags: {},
  };

  let i = 0;

  // Собираем позиционные аргументы (пока не встретим флаг)
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('-')) break;
    if (!result.command) {
      result.command = arg;
    } else if (!result.subcommand) {
      result.subcommand = arg;
    } else {
      result.positional.push(arg);
    }
    i++;
  }

  // Парсим флаги
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      // Длинный флаг: --flag, --flag value, --flag=value
      let flagName = arg.slice(2);
      let inlineValue;

      // Поддержка --flag=value
      const eqIdx = flagName.indexOf('=');
      if (eqIdx !== -1) {
        inlineValue = flagName.slice(eqIdx + 1);
        flagName = flagName.slice(0, eqIdx);
      }

      if (inlineValue !== undefined) {
        // --flag=value
        addFlag(result.flags, flagName, inlineValue);
        i++;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        // --flag value
        addFlag(result.flags, flagName, args[i + 1]);
        i += 2;
      } else {
        // --flag (переключатель)
        addFlag(result.flags, flagName, true);
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Короткий флаг: -f value или -f
      const flagChar = arg[1];

      // Маппинг коротких флагов на длинные
      const longName = shortFlagMap(flagChar);

      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        addFlag(result.flags, longName, args[i + 1]);
        i += 2;
      } else {
        addFlag(result.flags, longName, true);
        i++;
      }
    } else {
      // Позиционный аргумент после флагов
      result.positional.push(arg);
      i++;
    }
  }

  return result;
}

/**
 * Добавляет флаг в объект.
 * Если флаг уже существует — превращает значение в массив.
 *
 * @param {Record<string, unknown>} flags — объект флагов
 * @param {string} key — имя флага
 * @param {unknown} value — значение
 */
function addFlag(flags, key, value) {
  if (flags[key] === undefined) {
    flags[key] = value;
  } else if (Array.isArray(flags[key])) {
    flags[key].push(value);
  } else {
    flags[key] = [flags[key], value];
  }
}

/**
 * Маппинг коротких флагов на длинные имена.
 *
 * Совместимо с Backlog.md:
 * -d → description
 * -a → assignee
 * -s → status
 * -l → labels
 * -p → priority (или parent, зависит от контекста)
 *
 * @param {string} char — символ флага (без дефиса)
 * @returns {string} — длинное имя флага
 */
function shortFlagMap(char) {
  const map = {
    d: 'description',
    a: 'assignee',
    s: 'status',
    l: 'labels',
    p: 'priority',
  };
  return map[char] || char;
}

/**
 * Получает значение флага как строку.
 *
 * @param {Record<string, unknown>} flags — объект флагов
 * @param {string} key — имя флага
 * @param {string} [defaultValue=''] — значение по умолчанию
 * @returns {string}
 */
export function getFlag(flags, key, defaultValue = '') {
  const val = flags[key];
  if (val === undefined || val === true) return defaultValue;
  if (Array.isArray(val)) return val[0];
  return String(val);
}

/**
 * Получает значение флага как массив строк.
 *
 * @param {Record<string, unknown>} flags — объект флагов
 * @param {string} key — имя флага
 * @returns {string[]}
 */
export function getFlagArray(flags, key) {
  const val = flags[key];
  if (val === undefined) return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

/**
 * Проверяет, установлен ли флаг-переключатель.
 *
 * @param {Record<string, unknown>} flags — объект флагов
 * @param {string} key — имя флага
 * @returns {boolean}
 */
export function hasFlag(flags, key) {
  return flags[key] === true || flags[key] !== undefined;
}
