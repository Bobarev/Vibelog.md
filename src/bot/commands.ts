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

/** Агент-исполнитель фаз (VL-92/94): qwen либо встроенный vibelog-agent. */
export type AgentName = 'qwen' | 'vb';

/** Результат разбора /comment. */
export interface CommentCommand {
  id: string;
  text: string;
  /** Агент Фазы Comment: задан явно суффиксом :<agent> (VL-94). */
  agent?: AgentName;
}

/** Результат разбора /spec. */
export interface SpecCommand {
  description: string;
  /** Агент Фазы 1: задан явно суффиксом :<agent> (VL-94). */
  agent?: AgentName;
}

/** Результат разбора /plan. Опциональный комментарий — хвост после ID (VL-80). */
export interface PlanCommand {
  id: string;
  comment?: string;
  /** Агент Фазы 2: задан явно суффиксом :<agent> (VL-94). */
  agent?: AgentName;
}

/** Результат разбора /code. Опциональный комментарий — хвост после ID (VL-80). */
export interface CodeCommand {
  id: string;
  comment?: string;
  /** Агент Фазы 3: задан явно суффиксом :<agent> (VL-94). */
  agent?: AgentName;
  /**
   * Явное переопределение настройки code_same_session (VL-147): true —
   * продолжить plan-сессию (--same-session), false — разово обойти включённую
   * настройку (--no-same-session). undefined — брать настройку.
   */
  sameSession?: boolean;
}

/** Результат разбора /close. */
export interface CloseCommand {
  id: string;
  /** Агент Фазы Close: задан явно суффиксом :<agent> (VL-94). */
  agent?: AgentName;
}

/**
 * Результат разбора /set (VL-94/104): параметр настройки и его значение.
 * Дискриминированный union: в handler switch сужает key → value без
 * приведений (agent: AgentName; числовые лимиты: number).
 */
export type SetCommand =
  /** Агент по умолчанию для команд и кнопок действий (VL-94). */
  | { key: 'agent'; value: AgentName }
  /** Лимит времени фазы в секундах; 0 — сброс настройки (VL-104). */
  | { key: 'max-wall-time'; value: number }
  /** Лимит LLM-запросов фазы (ходов модели); 0 — сброс (VL-104). */
  | { key: 'max-requests'; value: number }
  /** Режим параллельной разработки в git-ветках vb/vl-N (VL-107). */
  | { key: 'branch-mode'; value: boolean }
  /** Компакшн истории LLM-запроса (VL-122); по умолчанию включён. */
  | { key: 'compact'; value: boolean }
  /** Code в сессии Plan (VL-147); по умолчанию выключен. */
  | { key: 'code-same-session'; value: boolean };

/** Результат разбора /prompt (VL-66/92): запрос без задачи + агент-исполнитель. */
export interface PromptCommand {
  text: string;
  /** Агент: задан явно суффиксом :<agent>; иначе — из настроек (VL-94). */
  agent?: AgentName;
}

/** Результат разбора /analyze (VL-141): сессия агента для разбора + агент-исполнитель. */
export interface AnalyzeCommand {
  /** Голый идентификатор сессии (agent-XXX, без префикса vb:). */
  sessionId: string;
  /** Агент: задан явно суффиксом :<agent>; иначе — из настроек (VL-94). */
  agent?: AgentName;
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
 * Суффикс :<agent> выбирает агента Фазы Comment (VL-94, см. extractAgent).
 *
 * @param text — аргументы команды (без слова /comment)
 * @param commandWord — слово команды с суффиксом (comment:vb), как в /prompt
 * @returns {id, text, agent?} или {error} с подсказкой
 */
export function parseCommentCommand(
  text: string,
  commandWord = ''
): CommentCommand | { error: string } {
  const hint = 'Синтаксис: /comment[:agent] VL-1 текст комментария (агенты: qwen, vb)';
  const parsed = extractAgent('comment', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  const trimmed = parsed.text;
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { error: hint };
  const id = trimmed.slice(0, spaceIdx).trim();
  const commentText = trimmed.slice(spaceIdx + 1).trim();
  if (!id || !commentText) return { error: hint };
  return { id, text: commentText, ...(parsed.agent ? { agent: parsed.agent } : {}) };
}

/**
 * Разбирает /spec: весь текст после команды — описание фичи.
 * Суффикс :<agent> выбирает агента Фазы 1 (VL-94, см. extractAgent).
 * Окружающие кавычки снимаются; пустой ввод — {error} с подсказкой.
 *
 * @param text — аргументы команды (без слова /spec)
 * @param commandWord — слово команды с суффиксом (spec:vb), как в /prompt
 * @returns {description, agent?} или {error} с подсказкой
 */
export function parseSpecCommand(
  text: string,
  commandWord = ''
): SpecCommand | { error: string } {
  const hint = 'Синтаксис: /spec[:agent] описание фичи (агенты: qwen, vb)';
  const parsed = extractAgent('spec', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  const description = unquote(parsed.text);
  if (!description) return { error: hint };
  return { description, ...(parsed.agent ? { agent: parsed.agent } : {}) };
}

/**
 * Разбирает /plan: «VL-1» или «VL-1 комментарий» (VL-80).
 * Комментарий — хвост после ID, как в /comment; но опционален:
 * /plan VL-1 без хвоста обязан работать (регрессия VL-50).
 * Суффикс :<agent> выбирает агента Фазы 2 (VL-94, см. extractAgent).
 *
 * @param text — аргументы команды (без слова /plan)
 * @param commandWord — слово команды с суффиксом (plan:vb), как в /prompt
 * @returns {id, comment?, agent?} или {error} с подсказкой
 */
export function parsePlanCommand(
  text: string,
  commandWord = ''
): PlanCommand | { error: string } {
  const hint = 'Синтаксис: /plan[:agent] VL-<id> [комментарий] (агенты: qwen, vb)';
  const parsed = extractAgent('plan', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  const trimmed = parsed.text;
  if (!trimmed) return { error: hint };
  const agent = parsed.agent ? { agent: parsed.agent } : {};
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { id: trimmed, ...agent };
  const id = trimmed.slice(0, spaceIdx).trim();
  const comment = trimmed.slice(spaceIdx + 1).trim();
  if (!id) return { error: hint };
  // Ключи comment/agent добавляем ТОЛЬКО при наличии — иначе сломаются deepEqual-тесты
  return comment ? { id, comment, ...agent } : { id, ...agent };
}

/**
 * Разбирает /code: «VL-1» или «VL-1 комментарий» (VL-80), как /plan.
 * Суффикс :<agent> выбирает агента Фазы 3 (VL-94, см. extractAgent).
 * Флаги --same-session/--no-same-session (VL-147) вырезаются из текста ДО
 * разбора id/комментария — иначе токен попал бы в комментарий фазы; если
 * заданы оба — выигрывает позитивный --same-session.
 *
 * @param text — аргументы команды (без слова /code)
 * @param commandWord — слово команды с суффиксом (code:vb), как в /prompt
 * @returns {id, comment?, agent?, sameSession?} или {error} с подсказкой
 */
export function parseCodeCommand(
  text: string,
  commandWord = ''
): CodeCommand | { error: string } {
  const hint =
    'Синтаксис: /code[:agent] VL-<id> [комментарий] [--same-session|--no-same-session] (агенты: qwen, vb)';
  const parsed = extractAgent('code', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  // VL-147: --no-same-session первым — строка не содержит --same-session как
  // подстроки (после -- сразу no), порядок защищает от двойной замены
  let sameSession: boolean | undefined;
  let rest = parsed.text;
  if (rest.includes('--no-same-session')) {
    sameSession = false;
    rest = rest.replace(/--no-same-session/g, ' ');
  }
  if (rest.includes('--same-session')) {
    sameSession = true;
    rest = rest.replace(/--same-session/g, ' ');
  }
  const trimmed = rest.trim();
  if (!trimmed) return { error: hint };
  // Ключи comment/agent/sameSession добавляем ТОЛЬКО при наличии — иначе
  // сломаются deepEqual в тестах команд без флагов
  const agent = parsed.agent ? { agent: parsed.agent } : {};
  const flag = sameSession !== undefined ? { sameSession } : {};
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { id: trimmed, ...agent, ...flag };
  const id = trimmed.slice(0, spaceIdx).trim();
  const comment = trimmed.slice(spaceIdx + 1).trim();
  if (!id) return { error: hint };
  return comment ? { id, comment, ...agent, ...flag } : { id, ...agent, ...flag };
}

/**
 * Разбирает /close: «VL-1» — только ID задачи (первое слово).
 * Копия parseCodeCommand (VL-53) — фаза Close закрывает задачу.
 * Суффикс :<agent> выбирает агента Фазы Close (VL-94, см. extractAgent).
 *
 * @param text — аргументы команды (без слова /close)
 * @param commandWord — слово команды с суффиксом (close:vb), как в /prompt
 * @returns {id, agent?} или {error} с подсказкой
 */
export function parseCloseCommand(
  text: string,
  commandWord = ''
): CloseCommand | { error: string } {
  const hint = 'Синтаксис: /close[:agent] VL-<id> (агенты: qwen, vb)';
  const parsed = extractAgent('close', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  const id = parsed.text.split(/\s+/)[0];
  if (!id) return { error: hint };
  return { id, ...(parsed.agent ? { agent: parsed.agent } : {}) };
}

/**
 * Разбирает /set: «agent <qwen|vb>» | «max-wall-time <сек>» |
 * «max-requests <N>» | «branch-mode <on|off>» | «compact <on|off>» |
 * «code-same-session <on|off>» (VL-94/104/107/122/147).
 * Числовые параметры — неотрицательные целые: 0 — явный сброс настройки
 * (удаление ключа в settings.json), дробные, отрицательные и пустые значения —
 * {error} с подсказкой. Булевы on/off-параметры принимают on|off|true|false
 * (регистр не важен — значение уже в нижнем регистре).
 *
 * @param text — аргументы команды (без слова /set)
 * @returns {key, value} или {error} с подсказкой
 */
export function parseSetCommand(text: string): SetCommand | { error: string } {
  const hint =
    'Синтаксис: /set agent <qwen|vb> | max-wall-time <сек> | max-requests <N> | branch-mode <on|off> | compact <on|off> | code-same-session <on|off> (0/пусто — сброс у числовых)';
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };
  const spaceIdx = trimmed.indexOf(' ');
  const key = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).trim().toLowerCase();
  const value = (spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim()).toLowerCase();
  if (
    key !== 'agent' &&
    key !== 'max-wall-time' &&
    key !== 'max-requests' &&
    key !== 'branch-mode' &&
    key !== 'compact' &&
    key !== 'code-same-session'
  ) {
    return {
      error: `Неизвестный параметр: ${key}. Доступные: agent, max-wall-time, max-requests, branch-mode, compact, code-same-session. ${hint}`,
    };
  }
  if (key === 'agent') {
    if (value !== 'qwen' && value !== 'vb') {
      return { error: `Неизвестный агент: ${value || '(пусто)'}. Доступные: qwen, vb. ${hint}` };
    }
    return { key: 'agent', value };
  }
  // Булевы on/off-параметры (VL-107 branch-mode, VL-122 compact, VL-147
  // code-same-session): on/true → true, off/false → false
  if (key === 'branch-mode' || key === 'compact' || key === 'code-same-session') {
    // Явные литералы ключа — дискриминированный union SetCommand не принимает
    // суженный `key: 'branch-mode' | 'compact' | 'code-same-session'` без приведения
    if (value === 'on' || value === 'true') {
      if (key === 'compact') return { key: 'compact', value: true };
      if (key === 'code-same-session') return { key: 'code-same-session', value: true };
      return { key: 'branch-mode', value: true };
    }
    if (value === 'off' || value === 'false') {
      if (key === 'compact') return { key: 'compact', value: false };
      if (key === 'code-same-session') return { key: 'code-same-session', value: false };
      return { key: 'branch-mode', value: false };
    }
    return {
      error: `${key}: ожидается on|off (true|false), получено: ${value || '(пусто)'}. ${hint}`,
    };
  }
  // Числовые параметры (VL-104): Number('') === 0 — пустое значение отдельно
  // отсекаем, иначе «/set max-wall-time» без числа прочиталось бы как сброс.
  const n = Number(value);
  if (value === '' || !Number.isInteger(n) || n < 0) {
    return {
      error: `${key}: ожидается неотрицательное целое (0 — сброс), получено: ${value || '(пусто)'}. ${hint}`,
    };
  }
  return { key, value: n };
}

/**
 * Разбирает /restart: пусто → перезапуск из корневого dist/ (VL-70);
 * «VL-N» (без учёта регистра) → перезапуск из worktree ветки vb/vl-N (VL-107).
 * ID нормализуется к верхнему регистру — branch/taskWorktreeDir приводят
 * к нижнему сами, но сообщения бота и кэш работают с канонической формой.
 *
 * @param text — аргументы команды (без слова /restart)
 * @returns {taskId?} или {error} с подсказкой
 */
export function parseRestartCommand(text: string): { taskId?: string } | { error: string } {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (/^vl-\d+$/i.test(trimmed)) return { taskId: trimmed.toUpperCase() };
  return { error: 'Синтаксис: /restart [VL-N]' };
}

/**
 * Извлекает суффикс :<agent> из слова команды и (двойная доставка при
 * оборванной Telegram-entity, паттерн VL-92) из начала текста.
 * Общий хелпер парсеров фаз (VL-94) и /prompt (VL-92).
 *
 * @param commandName — имя команды без слэша и суффикса (spec, prompt…)
 * @param commandWord — слово команды с суффиксом (spec:vb); из текста
 *   сообщения, т.к. grammy 1.46 не отдаёт ctx.command
 * @param text — аргументы команды
 * @param hint — подсказка синтаксиса для {error}
 * @returns агент (только при явном суффиксе) + текст без суффикса либо {error}
 */
function extractAgent(
  commandName: string,
  commandWord: string,
  text: string,
  hint: string
): { agent?: AgentName; text: string } | { error: string } {
  let agent: AgentName | undefined;
  const word = commandWord.match(new RegExp('^' + commandName + ':(\\S+)$'));
  if (word) {
    const suffix = word[1];
    if (suffix === 'vb') agent = 'vb';
    else if (suffix === 'qwen') agent = 'qwen';
    else return { error: hint };
  }
  let rest = text.trim();
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    const token = sp === -1 ? rest.slice(1) : rest.slice(1, sp);
    if (token === 'qwen' || token === 'vb') {
      if (agent === undefined) agent = token === 'vb' ? 'vb' : 'qwen';
      rest = sp === -1 ? '' : rest.slice(sp + 1).trim();
    }
  }
  return { agent, text: rest };
}

/**
 * Разбирает /prompt: весь текст после команды — запрос пользователя.
 * Суффикс :<agent> выбирает агента (VL-92): без суффикса — агент по
 * умолчанию из настроек (VL-94), :vb — встроенный vibelog-agent,
 * неизвестный — {error} с подсказкой (спавна нет).
 * Без unquote — запрос естественный, кавычки значимы (VL-66).
 *
 * @param text — аргументы команды (без слова команды)
 * @param commandWord — слово команды с суффиксом (prompt:vb); приходит из
 *   хендлера, т.к. grammy 1.46 не отдаёт ctx.command
 * @returns {text, agent?} или {error} с подсказкой
 */
export function parsePromptCommand(
  text: string,
  commandWord = ''
): PromptCommand | { error: string } {
  const hint = 'Синтаксис: /prompt[:agent] <запрос> (агенты: qwen, vb)';
  const parsed = extractAgent('prompt', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  if (!parsed.text) return { error: hint };
  return { text: parsed.text, ...(parsed.agent ? { agent: parsed.agent } : {}) };
}

/**
 * Разбирает /analyze (VL-141): session-ref сессии vibelog-agent для разбора.
 * Суффикс :<agent> выбирает агента-исполнителя (как у /prompt, VL-94).
 * Session-ref в том же формате, что у resume: vb:agent-XXX либо голый
 * agent-XXX (префикс vb: снимается). qwen-UUID отклоняется — у qwen-сессий
 * нет jsonl-транскрипта для разбора.
 *
 * @param text — аргументы команды (без слова команды)
 * @param commandWord — слово команды с суффиксом (analyze:vb)
 * @returns {sessionId, agent?} или {error} с подсказкой
 */
export function parseAnalyzeCommand(
  text: string,
  commandWord = ''
): AnalyzeCommand | { error: string } {
  const hint = 'Синтаксис: /analyze[:agent] vb:agent-<id> (префикс vb: необязателен)';
  const parsed = extractAgent('analyze', commandWord, text, hint);
  if ('error' in parsed) return parsed;
  if (!parsed.text) return { error: hint };
  // Нормализация vb:agent-XXX → agent-XXX; UUID qwen не матчится → error
  const bare = parsed.text.replace(/^vb:/, '');
  if (!/^agent-\d+$/.test(bare)) return { error: hint };
  return { sessionId: bare, ...(parsed.agent ? { agent: parsed.agent } : {}) };
}

/** Результат разбора /resume (VL-171): сессия для возобновления + комментарий. */
export interface ResumeCommand {
  /**
   * Голый идентификатор сессии: agent-XXX (vb) либо UUID (qwen) — тот же
   * нормализованный формат, что возвращает extractSessionRef для qwen.
   */
  sessionId: string;
  /** Агент-владелец сессии: определяется форматом ref; суффикс :<agent> перекрывает. */
  agent: AgentName;
  /** Необязательный комментарий — промпт возобновления; пустой → «Продолжи». */
  comment: string;
}

/**
 * Разбирает /resume (VL-171): «<session-ref> [комментарий]» — возобновление
 * сохранённой сессии агента без reply на сообщение бота.
 *
 * Session-ref в том же формате, что у reply-resume (extractSessionRef):
 * vb:agent-XXX / голый agent-XXX → встроенный vibelog-agent; qwen:UUID /
 * голый UUID → qwen. Агент определяется форматом ref; явный суффикс
 * :<agent> (как у /prompt, VL-94) перекрывает определение. Остаток текста —
 * необязательный комментарий (промпт фазы); без него — «Продолжи».
 *
 * @param text — аргументы команды (без слова команды)
 * @param commandWord — слово команды с суффиксом (resume:vb)
 * @returns {sessionId, agent, comment} или {error} с подсказкой
 */
export function parseResumeCommand(
  text: string,
  commandWord = ''
): ResumeCommand | { error: string } {
  const hint =
    'Синтаксис: /resume vb:agent-<id> [комментарий] (также qwen-UUID; префикс vb:/qwen: необязателен)';
  // Суффикс :<agent> обрабатываем до разбора ref — как у /prompt: неизвестный
  // агент → {error} с подсказкой, спавна нет
  let suffix: AgentName | undefined;
  if (commandWord.includes(':')) {
    const agentPart = commandWord.slice(commandWord.indexOf(':') + 1);
    if (agentPart !== 'qwen' && agentPart !== 'vb') {
      return { error: 'Синтаксис: /resume[:agent] <session-ref> [комментарий] (агенты: qwen, vb)' };
    }
    suffix = agentPart;
  }
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };
  const sp = trimmed.search(/\s/);
  const ref = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const comment = sp === -1 ? '' : trimmed.slice(sp).trim();
  // Нормализация ref → {sessionId, agent}: как у extractSessionRef (VL-93) —
  // vb:агент-матч и UUID qwen; всё прочее → error с подсказкой
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const qwenPref = ref.match(/^qwen:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  let sessionId: string;
  let agent: AgentName;
  const bare = ref.replace(/^vb:/, '');
  if (/^agent-\d+$/.test(bare) && !qwenPref) {
    sessionId = bare;
    agent = 'vb';
  } else if (qwenPref) {
    sessionId = qwenPref[1];
    agent = 'qwen';
  } else if (uuidRe.test(ref)) {
    sessionId = ref;
    agent = 'qwen';
  } else {
    return { error: hint };
  }
  // Явный суффикс :<agent> перекрывает агента по формату ref (VL-94-паттерн)
  return { sessionId, agent: suffix ?? agent, comment: comment || 'Продолжи' };
}

/** Результат разбора /commits (VL-90): сколько коммитов показать. */
export interface CommitsCommand {
  count: number;
}

/**
 * Разбирает /commits: пусто → 10; положительное целое → N;
 * иначе {error} с подсказкой синтаксиса.
 *
 * @param text — аргументы команды (без слова /commits)
 * @returns {count} или {error} с подсказкой
 */
export function parseCommitsCommand(text: string): CommitsCommand | { error: string } {
  const hint = 'Синтаксис: /commits [N]';
  const trimmed = text.trim();
  if (!trimmed) return { count: 10 };
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n > 0) return { count: n };
  }
  return { error: hint };
}

/** Ссылка на сессию агента из информационного сообщения бота (VL-93). */
export interface SessionRef {
  /** Агент, создавший сессию: qwen (UUID) либо vb (agent-<ts>). */
  agent: 'qwen' | 'vb';
  /** Идентификатор сессии: UUID (qwen) либо vb:<token> (vb). */
  sessionId: string;
}

/**
 * Извлекает идентификатор сессии из текста сообщения бота (VL-93).
 *
 * Информационное сообщение о завершении фазы (rich.ts / formatting.ts)
 * выводит session_id в одинарных backticks последней строкой. Telegram
 * может отдать reply_to_message без backticks (entities хранятся отдельно),
 * поэтому сначала ищутся backtick-обёртки, затем голый токен.
 *
 * Проверяются последние две строки текста — session_id всегда в хвосте
 * рендера. Форматы (единый вывод '<agent>:<session_id>', VL-93):
 * qwen:<UUID> и голый UUID (старые сообщения); vb:<agent-N> / agent-N (vb).
 *
 * @param text — текст сообщения бота (reply_to_message.text)
 * @returns SessionRef либо null, если токена сессии нет
 */
export function extractSessionRef(text: string): SessionRef | null {
  // Хвост в две строки: последняя — session_id, предпоследняя — время/меты
  const tail = text.split('\n').slice(-2).join('\n');
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Приоритет у vb:agent-N — специфичнее голого agent-N (без префикса)
  const vbRe = /^(?:vb:)?agent-[0-9]+$/;
  // Единый формат вывода сессии qwen (VL-93): qwen:<UUID>; --resume нужен
  // голый UUID без префикса агента
  const qwenRe = /^qwen:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  // 1) Backtick-обёртки — основной формат рендера; в хвосте может быть
  //    несколько токенов — проверяем все, валидный — последним
  const btAll = [...tail.matchAll(/`([^`]+)`/g)];
  for (const m of btAll) {
    const t = m[1].trim();
    if (t.startsWith('vb:') && vbRe.test(t)) return { agent: 'vb', sessionId: t };
    if (vbRe.test(t)) return { agent: 'vb', sessionId: 'vb:' + t };
    const qm = t.match(qwenRe);
    if (qm) return { agent: 'qwen', sessionId: qm[1] };
    if (uuidRe.test(t)) return { agent: 'qwen', sessionId: t };
  }
  // 2) Голый токен — фолбэк, если Telegram не отдал backticks
  const vbBare = tail.match(/\bvb:agent-[0-9]+\b/);
  if (vbBare) return { agent: 'vb', sessionId: vbBare[0] };
  const agentBare = tail.match(/\bagent-[0-9]+\b/);
  if (agentBare) return { agent: 'vb', sessionId: 'vb:' + agentBare[0] };
  // Единый формат вывода сессии qwen (VL-93): qwen:<UUID> — до голого UUID
  // (старые сообщения в истории чата); --resume нужен голый UUID
  const qwenBare = tail.match(/\bqwen:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (qwenBare) return { agent: 'qwen', sessionId: qwenBare[1] };
  const uuid = tail.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  if (uuid) return { agent: 'qwen', sessionId: uuid[0] };
  return null;
}

/**
 * Плоский текст rich-сообщения Telegram из его блоков (VL-93 fix).
 *
 * Информационное сообщение фазы шлётся sendRichMessage — у него нет поля
 * text (RichMessageMessage = CommonMessage & MsgWith<"rich_message">),
 * контент живёт в rich_message.blocks. Reply на rich-сообщение отдаёт
 * blocks без markdown-разметки: `` `uuid` `` → paragraph с code-фрагментом
 * (голый токен). Рекурсия: строка → как есть; массив → конкатенация
 * (inline-фрагменты); объект → поле text, у списка — items, у
 * custom_emoji — alternative_text; блоки разделяются '\n'.
 *
 * @param value — rich_message (или его часть: блок, RichText-фрагмент)
 * @returns плоский текст для extractSessionRef (без markdown-символов)
 */
export function richToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(richToText).join('');
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.blocks)) return obj.blocks.map(richToText).join('\n');
    if (Array.isArray(obj.items)) return obj.items.map(richToText).join('\n');
    if ('text' in obj) return richToText(obj.text);
    if (typeof obj.alternative_text === 'string') return obj.alternative_text;
  }
  return '';
}
