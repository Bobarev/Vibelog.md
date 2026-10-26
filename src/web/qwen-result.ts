/**
 * Парсер JSON-результата headless-сессии qwen (VL-64, фикс VL-63).
 *
 * Оркестратор (VL-58+) запускает qwen с `--output-format json`. Реальный
 * формат stdout зависит от версии/адаптера qwen:
 * - stream-json — поток JSON-строк (init, assistant, …, result последней);
 * - json (qwen 0.24.x, JsonOutputAdapter) — одна строка с JSON-МАССИВОМ
 *   всех сообщений сессии `[{init},{assistant},…,{result}]`, result —
 *   последний элемент массива.
 * Раньше парсер понимал только поток строк и на массиве возвращал null —
 * в чат уходил фолбэк «Данные результата недоступны» с сырым логом
 * (жалоба Pavel из Фазы Comment на VL-63).
 *
 * VL-63 (reopen): оркестратор передаёт сюда ТОЛЬКО stdout (stderr копится
 * отдельно) — строки stderr (Warning, логи MCP) не должны вклиниваться
 * в JSON-строки и ломать разбор.
 *
 * Контракт: чистая функция без I/O — парсит уже накопленный stdout-лог.
 */

/** Структурированный результат сессии qwen (поля — из JSON type=result). */
export interface QwenResult {
  /** message.result — финальный текстовый ответ агента. */
  result: string;
  is_error: boolean;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    total_tokens: number;
    reasoning_tokens: number;
  };
}

/**
 * Приводит объект `type=result` к QwenResult: отсутствующие поля получают
 * дефолты (0/''/false), лишние игнорируются. При is_error текст ошибки
 * живёт в `error.message`, а не в `result` — берём его как фолбэк.
 */
function toQwenResult(obj: Record<string, unknown>): QwenResult {
  const usage = (typeof obj.usage === 'object' && obj.usage !== null ? obj.usage : {}) as Record<
    string,
    unknown
  >;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const errObj = (
    typeof obj.error === 'object' && obj.error !== null ? obj.error : {}
  ) as Record<string, unknown>;
  const resultText =
    typeof obj.result === 'string' && obj.result !== ''
      ? obj.result
      : typeof errObj.message === 'string'
        ? errObj.message
        : '';
  return {
    result: resultText,
    is_error: obj.is_error === true,
    num_turns: num(obj.num_turns),
    duration_ms: num(obj.duration_ms),
    duration_api_ms: num(obj.duration_api_ms),
    session_id: typeof obj.session_id === 'string' ? obj.session_id : '',
    usage: {
      input_tokens: num(usage.input_tokens),
      output_tokens: num(usage.output_tokens),
      cache_read_input_tokens: num(usage.cache_read_input_tokens),
      total_tokens: num(usage.total_tokens),
      reasoning_tokens: num(usage.reasoning_tokens),
    },
  };
}

/**
 * Ищет `type=result` в разобранном JSON: объекте либо массиве сообщений.
 * Массив обходится с конца — result всегда последнее сообщение сессии.
 */
function findResult(value: unknown): QwenResult | null {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      const found = findResult(value[i]);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const obj = value as Record<string, unknown>;
  return obj.type === 'result' ? toQwenResult(obj) : null;
}

/**
 * Извлекает последний результат `type=result` из лога qwen.
 *
 * Два реальных формата stdout (см. шапку модуля): NDJSON-поток — обход
 * строк с конца; строка-массив `[{…}]` (qwen 0.24.x json-адаптер) —
 * парсим строку целиком и ищем result в массиве с конца. Если построчный
 * проход не дал результата, пробуем распарсить лог целиком (защита от
 * pretty-printed JSON). Битые строки пропускаются.
 *
 * @param log — накопленный stdout+stderr фазы (может быть пустым)
 * @returns результат либо null, если валидного result нет
 */
export function parseQwenResult(log: string): QwenResult | null {
  if (!log) return null;
  const lines = log.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // битая строка — пропускаем, ищем дальше по хвосту
    }
    const found = findResult(parsed);
    if (found) return found;
  }
  // Фолбэк: лог целиком — один JSON-документ (массив или объект)
  try {
    return findResult(JSON.parse(log.trim()));
  } catch {
    return null;
  }
}

/**
 * Диагностика парсинга (дебаг VL-63): короткая сводка того, что видит
 * парсер в логе — счётчики JSON-строк/массивов, найден ли result и хвост
 * последней JSON-строки. Печатается оркестратором в консоль, когда result
 * не распознан, чтобы было видно, на каком формате падает обработка.
 */
export function explainQwenParse(log: string): string {
  const lines = log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let objectLines = 0;
  let arrayLines = 0;
  let resultFound = false;
  let lastJson = '';
  for (const line of lines) {
    if (line.startsWith('{') || line.startsWith('[')) {
      if (line.startsWith('[')) arrayLines++;
      else objectLines++;
      lastJson = line.slice(0, 100);
    }
    if (resultFound) continue;
    try {
      resultFound = findResult(JSON.parse(line)) !== null;
    } catch {
      // не JSON — норма для строк лога (предупреждения, текстовый шум)
    }
  }
  if (!resultFound) {
    try {
      resultFound = findResult(JSON.parse(log.trim())) !== null;
    } catch {
      // весь лог не является одним JSON — штатный случай
    }
  }
  return (
    `строк: ${lines.length}, JSON-строк: ${objectLines}, строк-массивов: ${arrayLines}, ` +
    `result: ${resultFound ? 'найден' : 'НЕ найден'}; хвост JSON: ${lastJson || '—'}`
  );
}
