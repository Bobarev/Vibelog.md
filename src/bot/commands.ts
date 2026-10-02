/**
 * Парсеры Telegram-команд бота (VL-35).
 *
 * Чистые функции: строка после команды → структурированные аргументы
 * либо {error} с подсказкой синтаксиса. Юнит-тестируемые.
 */

/** Приоритеты задач (как в CLI --priority). */
const PRIORITIES = ['High', 'Medium', 'Low'];

/** Результат разбора /create. */
export interface CreateCommand {
  title: string;
  description?: string;
  priority?: string;
}

/** Результат разбора /status. */
export interface StatusCommand {
  id: string;
  status: string;
}

/** Результат разбора /comment. */
export interface CommentCommand {
  id: string;
  text: string;
}

/** Результат разбора /spec. */
export interface SpecCommand {
  description: string;
}

/** Результат разбора /plan. */
export interface PlanCommand {
  id: string;
}

/** Снятие окружающих кавычек. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Разбирает /create: «Заголовок [-d описание] [--priority High|Medium|Low]».
 *
 * @param text — аргументы команды (без слова /create)
 * @returns аргументы или {error} с подсказкой
 */
export function parseCreateCommand(text: string): CreateCommand | { error: string } {
  const hint = 'Синтаксис: /create Заголовок [-d описание] [--priority High|Medium|Low]';
  let rest = text.trim();
  if (!rest) return { error: hint };

  let priority: string | undefined;
  let description: string | undefined;

  // --priority X: одно слово после флага
  const prioMatch = rest.match(/\s--priority\s+(\S+)/);
  if (prioMatch) {
    const value = unquote(prioMatch[1]);
    if (!PRIORITIES.includes(value)) {
      return { error: `Невалидный приоритет: ${value}. Доступные: ${PRIORITIES.join(', ')}` };
    }
    priority = value;
    rest = rest.replace(prioMatch[0], ' ');
  }

  // -d Описание: всё после флага до конца (флаг --priority уже извлечён).
  // (?:^|\s) — -d может стоять в начале строки, если --priority был извлечён.
  const dMatch = rest.match(/(?:^|\s)-d\s+/);
  if (dMatch) {
    const idx = rest.indexOf(dMatch[0]);
    const flagLen = dMatch[0].length;
    description = unquote(rest.slice(idx + flagLen));
    rest = rest.slice(0, idx);
  }

  const title = unquote(rest);
  if (!title) return { error: hint };

  return {
    title,
    ...(description ? { description } : {}),
    ...(priority ? { priority } : {}),
  };
}

/**
 * Разбирает /status: «VL-1 To Do» — статус может содержать пробелы.
 *
 * @param text — аргументы команды (без слова /status)
 * @returns аргументы или {error} с подсказкой
 */
export function parseStatusCommand(text: string): StatusCommand | { error: string } {
  const hint = 'Синтаксис: /status VL-1 To Do — укажите ID и статус';
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { error: hint };

  const id = trimmed.slice(0, spaceIdx).trim();
  const status = trimmed.slice(spaceIdx + 1).trim();
  if (!id || !status) return { error: hint };

  return { id, status };
}

/**
 * Разбирает /comment: «VL-1 текст комментария» — текст может содержать пробелы.
 *
 * @param text — аргументы команды (без слова /comment)
 * @returns аргументы или {error} с подсказкой
 */
export function parseCommentCommand(text: string): CommentCommand | { error: string } {
  const hint = 'Синтаксис: /comment VL-1 текст комментария';
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { error: hint };

  const id = trimmed.slice(0, spaceIdx).trim();
  const commentText = trimmed.slice(spaceIdx + 1).trim();
  if (!commentText) return { error: hint };

  return { id, text: commentText };
}

/**
 * Разбирает /spec: весь текст после команды — описание фичи.
 * Окружающие кавычки снимаются; пустой ввод — {error} с подсказкой.
 *
 * @param text — аргументы команды (без слова /spec)
 * @returns описание фичи или {error} с подсказкой
 */
export function parseSpecCommand(text: string): SpecCommand | { error: string } {
  const hint = 'Синтаксис: /spec описание фичи';
  const description = unquote(text.trim());
  if (!description) return { error: hint };
  return { description };
}

/**
 * Разбирает /plan: «VL-1» — только ID задачи (первое слово).
 *
 * @param text — аргументы команды (без слова /plan)
 * @returns {id} или {error} с подсказкой
 */
export function parsePlanCommand(text: string): PlanCommand | { error: string } {
  const hint = 'Синтаксис: /plan VL-<id>';
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };
  // ID — первое слово; хвостовой текст игнорируется (lenient, как в /status)
  const id = trimmed.split(/\s+/)[0];
  if (!id) return { error: hint };
  return { id };
}
