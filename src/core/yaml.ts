/**
 * Мини-парсер YAML для frontmatter задач Vibelog.md / Backlog.md.
 *
 * Поддерживает подмножество YAML, достаточное для фронтматтера задач:
 * - скаляры: строка, число, boolean, null
 * - массивы через `-` (block) и `[a, b]` (inline)
 * - вложенные объекты по отступам (2 пробела)
 * - строки в кавычках: "..." и '...'
 *
 * Не поддерживает: anchors, multiline (`|`, `>`), complex keys,
 * flow-map, tagged values. Если в оригинале Backlog.md они встретятся —
 * расширим парсер.
 */

/** Кадр стека контекста парсера: текущий объект и его отступ. */
interface StackFrame {
  indent: number;
  obj: Record<string, unknown>;
  /** Ключ массива, в который идут элементы `- value` (блочные массивы). */
  parentKey?: string;
}

/**
 * Парсит YAML-текст в JS-объект.
 *
 * @param text — YAML-текст без обрамляющих `---`
 * @returns распарсенный объект
 * @throws если встречена неподдерживаемая конструкция
 */
export function parseYaml(text: string): Record<string, unknown> {
  if (typeof text !== 'string') {
    throw new Error('parseYaml: ожидается строка');
  }

  const trimmed = text.trim();
  if (trimmed === '') return {};

  const lines = trimmed.split('\n');
  const root: Record<string, unknown> = {};
  // Стек контекстов: [{ indent, obj, parentKey? }]
  // parentKey указывает ключ массива, в который идут элементы `- value`
  const stack: StackFrame[] = [{ indent: -1, obj: root }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Пропускаем пустые строки и комментарии
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmedLine = line.trimStart();

    // Блоковый массив: `- value` или `-` (пустой элемент)
    // Обрабатываем ДО управления стеком, т.к. элементы массива
    // не меняют уровень вложенности — они принадлежат текущему контейнеру
    if (trimmedLine.startsWith('- ') || trimmedLine === '-') {
      const value = trimmedLine === '-' ? '' : trimmedLine.slice(2);
      const parentKey = findParentKey(stack);
      if (parentKey !== null) {
        // Находим кадр стека, содержащий массив, и добавляем элемент
        for (let s = stack.length - 1; s >= 0; s--) {
          const frame = stack[s];
          const container = frame.obj[parentKey];
          if (frame.parentKey === parentKey && Array.isArray(container)) {
            container.push(parseScalar(value));
            break;
          }
        }
      }
      continue;
    }

    // Для остальных строк: закрываем уровни вложенности, которые уже не актуальны.
    // Стек не содержит строк с отступом > текущего (кроме массивов, обработанных выше).
    // Используем строгое сравнение `>`, а не `>=`, чтобы не закрывать
    // текущий уровень вложенности — следующая строка на том же отступе
    // может принадлежать тому же контейнеру (объекту или массиву).
    while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];

    // Inline-массив: `key: [a, b, c]` или пустой `key: []`
    const inlineArrayMatch = trimmedLine.match(/^([\w][\w_-]*):\s*\[(.*)\]\s*$/);
    if (inlineArrayMatch) {
      const [, key, content] = inlineArrayMatch;
      const items = content.trim() === ''
        ? []
        : content.split(',').map(s => parseScalar(s.trim()));
      current.obj[key] = items;
      continue;
    }

    // Обычная пара ключ: значение
    const kvMatch = trimmedLine.match(/^([\w][\w_-]*):\s*(.*)\s*$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      const value = rawValue.trim();

      if (value === '' || value === '|' || value === '>') {
        // Пустое значение — может быть объект или блочный массив.
        // Смотрим следующую непустую строку, чтобы определить тип.
        const nextNonEmpty = findNextNonEmpty(lines, i + 1);
        if (nextNonEmpty !== null) {
          const nextTrimmed = lines[nextNonEmpty].trimStart();
          const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;

          if (nextTrimmed.startsWith('- ') || nextTrimmed === '-') {
            // Блочный массив: `key:\n  - item`
            // Создаём массив и кладём в стек кадр с parentKey,
            // чтобы следующие строки `- item` знали, куда добавлять
            current.obj[key] = [];
            stack.push({ indent: nextIndent, obj: current.obj, parentKey: key });
          } else if (nextIndent > indent) {
            // Вложенный объект: `key:\n  subkey: value`
            const child: Record<string, unknown> = {};
            current.obj[key] = child;
            stack.push({ indent: nextIndent, obj: child });
          } else {
            // Значение на том же уровне — значит ключ ничего не содержит
            current.obj[key] = null;
          }
        } else {
          current.obj[key] = null;
        }
      } else {
        // Скалярное значение
        current.obj[key] = parseScalar(value);
      }
      continue;
    }

    // Если ничего не совпало — пропускаем (может быть заголовок секции и т.п.)
  }

  return root;
}

/**
 * Находит ключ массива в стеке, в который нужно добавлять элементы `- value`.
 */
function findParentKey(stack: StackFrame[]): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (frame.parentKey && Array.isArray(frame.obj[frame.parentKey])) {
      return frame.parentKey;
    }
  }
  return null;
}

/**
 * Находит индекс следующей непустой строки в массиве.
 *
 * @param start — индекс начала поиска
 * @returns индекс непустой строки или null
 */
function findNextNonEmpty(lines: string[], start: number): number | null {
  for (let i = start; i < lines.length; i++) {
    if (lines[i].trim() !== '' && !lines[i].trim().startsWith('#')) {
      return i;
    }
  }
  return null;
}

/**
 * Парсит скалярное значение из строки YAML.
 *
 * Поддерживаемые типы:
 * - Числа: `42`, `3.14`, `-7`
 * - Boolean: `true`, `false`, `yes`, `no`, `on`, `off`
 * - Null: `null`, `~`
 * - Строки в двойных кавычках: `"hello world"` (с экранированием `\"` и `\\`)
 * - Строки в одинарных кавычках: `'hello world'` (с экранированием `''`)
 * - Обычные строки: без кавычек
 *
 * @param raw — сырое значение из YAML
 */
function parseScalar(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === 'false' || raw === 'no' || raw === 'off') return false;

  // Числа (целые и с плавающей точкой)
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  // Строка в двойных кавычках: "текст"
  // Обработка escape-последовательностей: \\ → \, \" → "
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return unescapeDoubleQuoted(raw.slice(1, -1));
  }

  // Строка в одинарных кавычках: 'текст'
  // В одинарных кавычках единственный escape — это '' → '
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  // Обычная строка — возвращаем как есть
  return raw;
}

/**
 * Обрабатывает escape-последовательности в строке в двойных кавычках YAML.
 *
 * В YAML двойные кавычки поддерживают:
 * - `\"` → `"` (экранированная кавычка)
 * - `\\` → `\` (экранированный обратный слэш)
 *
 * Поскольку `\\\"` должно стать `\"` → `\"`, обработка идёт
 * побуквенно, а не через bulk-replace.
 *
 * @param raw — содержимое между кавычками (без обрамляющих `"`)
 */
function unescapeDoubleQuoted(raw: string): string {
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === '"' || next === '\\') {
        result += next;
        i++; // пропускаем следующий символ
      } else {
        result += raw[i];
      }
    } else {
      result += raw[i];
    }
  }
  return result;
}

/**
 * Сериализует JS-объект в YAML-текст.
 *
 * Поддерживает: строки, числа, boolean, null, массивы, вложенные объекты.
 * Строки, содержащие спецсимволы, оборачиваются в кавычки.
 *
 * @param obj — объект для сериализации
 * @param indent — текущий уровень отступа (для рекурсии)
 */
export function stringifyYaml(obj: Record<string, unknown>, indent: number = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${prefix}${key}:`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`);
      } else {
        lines.push(`${prefix}${key}:`);
        for (const item of value) {
          lines.push(`${prefix}  - ${escapeScalar(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${prefix}${key}:`);
      lines.push(stringifyYaml(value as Record<string, unknown>, indent + 1));
    } else {
      lines.push(`${prefix}${key}: ${escapeScalar(value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Экранирует скалярное значение для записи в YAML.
 *
 * - Строки с спецсимволами оборачиваются в одинарные кавычки.
 * - Прочие значения приводятся к строке через `${value}`.
 */
function escapeScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);

  const str = String(value);
  // Если строка пустая, содержит спецсимволы или выглядит как число/boolean — кавычки
  if (
    str === '' ||
    str === 'true' || str === 'false' ||
    str === 'null' || str === 'yes' || str === 'no' ||
    str === 'on' || str === 'off' ||
    /^-?\d+(\.\d+)?$/.test(str) ||
    /[:{}\[\],&*?|>!%@`]/.test(str) ||
    str.startsWith('#')
  ) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
}
