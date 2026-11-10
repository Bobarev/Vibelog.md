/**
 * Субагенты-персоны (VL-409): настройки консультаций и набор инструментов
 * консультанта по умолчанию.
 *
 * Идея (обсуждение 2026-11-10): субагент — не роль фазы, а ПЕРСОНА, которую
 * зовёт другая персона. Помощник в проекте личных дел может спросить
 * «Психолога» или «Бизнес-наставника» — разные экспертизы в одном разговоре.
 * Реализация — инструмент `ask_persona`: сервер делает отдельный запрос к
 * модели с промптом и памятью консультанта и возвращает ответ как результат
 * инструмента (см. `src/web/chat-subagent.ts`).
 *
 * Почему настройки живут в core, а не в веб-слое: их читает и веб-чат, и
 * тесты, и (в будущем) страница «Персоны» для подсказок. Модуль чистый —
 * только чтение settings.json, без HTTP и без LLM.
 *
 * Валидация терпимая (паттерн `readLessonSettings`/`readChatLessonSettings`):
 * битое значение не роняет чат — берётся дефолт, а в `errors` попадает
 * понятное сообщение. Исключение — `on_missing_persona`: неизвестное значение
 * НЕ приводится молча к дефолту, а сообщается в `errors` (иначе опечатка
 * `on_missing_persona: "eror"` тихо включила бы `error` и пользователь не
 * понял бы, почему роль «не находится»).
 */

import { loadSettings } from './settings.js';

/** Как показывать консультацию в ленте чата. */
export type SubagentDisplay = 'inline' | 'widget';

/**
 * Имя инструмента консультации (VL-409).
 *
 * Живёт в core, а не в `src/web/chat-subagent.ts`, чтобы не появился цикл
 * импортов: `personas.ts` (список валидных имён `allow_tools`) и
 * `tool-policy.ts` (объявление инструмента) должны знать имя, а
 * `chat-subagent.ts` сам импортирует оба этих модуля.
 */
export const ASK_PERSONA_TOOL = 'ask_persona';

/** Поведение при вызове несуществующей роли-консультанта. */
export type SubagentMissingPersona = 'error' | 'skip';

/** Настройки субагентов (секция `subagents` в `.vibelog/settings.json`). */
export interface SubagentSettings {
  /** Включены ли консультации вообще (дефолт true). */
  enabled: boolean;
  /** `inline` — раскрываемый tool-call (дефолт), `widget` — карточка. */
  display: SubagentDisplay;
  /** Сколько консультаций разрешено за один ход (дефолт 2). */
  maxCallsPerTurn: number;
  /**
   * Глубина вложенности. Значения > 1 ОТКЛОНЯЮТСЯ (дефолт 1): консультант не
   * зовёт консультанта, иначе стоимость становится непредсказуемой.
   */
  maxDepth: number;
  /** Таймаут одной консультации, мс (дефолт 60000). */
  timeoutMs: number;
  /** Лимит токенов ответа консультанта (дефолт 2000). */
  maxTokens: number;
  /** `error` (дефолт) — tool-результат с ошибкой и списком ролей; `skip` — нейтрально. */
  onMissingPersona: SubagentMissingPersona;
}

/** Дефолты секции `subagents` (действуют без настройки). */
export const SUBAGENT_DEFAULTS: SubagentSettings = {
  enabled: true,
  display: 'inline',
  maxCallsPerTurn: 2,
  maxDepth: 1,
  timeoutMs: 60_000,
  maxTokens: 2_000,
  onMissingPersona: 'error',
};

/**
 * Инструменты консультанта по умолчанию — ТОЛЬКО чтение.
 *
 * Почему именно чтение: консультация — это «спросить мнение», а не «пусть
 * другая роль что-то поменяет в проекте». Писать консультант не должен ни
 * файлы, ни backlog: пользователь не давал на это согласия, а карточки
 * Allow/Deny внутри вложенного запроса показать некому. Роль может расширить
 * набор своим `allow_tools` (VL-407) — осознанно.
 */
export const DEFAULT_CONSULTANT_TOOLS: readonly string[] = [
  'read_file',
  'search_files',
  'backlog_search',
  'backlog_view_task',
  'backlog_list_tasks',
  'project_map',
  'lesson_search_lessons',
  'lesson_view',
  'document_view',
  'document_list',
];

/** Непустое целое ≥ 1 из значения настройки (иначе undefined). */
function positiveInt(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) return undefined;
  return Math.floor(num);
}

/**
 * Читает секцию `subagents` и накладывает её на {@link SUBAGENT_DEFAULTS}.
 *
 * @param cwd — каталог проекта (там `.vibelog/settings.json`)
 * @param errors — необязательный аккумулятор предупреждений (чат работает)
 */
export function readSubagentSettings(cwd: string, errors?: string[]): SubagentSettings {
  const result: SubagentSettings = { ...SUBAGENT_DEFAULTS };
  let raw: unknown;
  try {
    raw = loadSettings(cwd).subagents;
  } catch {
    return result;
  }
  if (raw === undefined) return result;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors?.push(
      'settings.json: секция subagents должна быть объектом {enabled, display, max_calls_per_turn, max_depth, timeout_ms, max_tokens, on_missing_persona}',
    );
    return result;
  }
  const section = raw as Record<string, unknown>;

  if (section.enabled !== undefined) {
    if (typeof section.enabled === 'boolean') {
      result.enabled = section.enabled;
    } else {
      errors?.push('settings.json: subagents.enabled должен быть boolean — взято значение по умолчанию (true)');
    }
  }

  if (section.display !== undefined) {
    if (section.display === 'inline' || section.display === 'widget') {
      result.display = section.display;
    } else {
      errors?.push(
        `settings.json: subagents.display = "${String(section.display)}" неизвестен (допустимо inline|widget) — взято "inline"`,
      );
    }
  }

  const maxCalls = positiveInt(section.max_calls_per_turn);
  if (section.max_calls_per_turn !== undefined) {
    if (maxCalls === undefined) {
      errors?.push(
        'settings.json: subagents.max_calls_per_turn должен быть целым ≥ 1 — взято значение по умолчанию (2)',
      );
    } else {
      result.maxCallsPerTurn = maxCalls;
    }
  }

  if (section.max_depth !== undefined) {
    const depth = positiveInt(section.max_depth);
    if (depth === undefined) {
      errors?.push('settings.json: subagents.max_depth должен быть целым ≥ 1 — взято значение по умолчанию (1)');
    } else if (depth > 1) {
      // Глубина > 1 запрещена осознанно: консультант не зовёт консультанта
      errors?.push(
        `settings.json: subagents.max_depth = ${depth} не поддерживается (максимум 1: консультант не вызывает консультанта) — взято 1`,
      );
    } else {
      result.maxDepth = depth;
    }
  }

  if (section.timeout_ms !== undefined) {
    const timeout = positiveInt(section.timeout_ms);
    if (timeout === undefined) {
      errors?.push('settings.json: subagents.timeout_ms должен быть целым ≥ 1 — взято значение по умолчанию (60000)');
    } else {
      result.timeoutMs = timeout;
    }
  }

  if (section.max_tokens !== undefined) {
    const tokens = positiveInt(section.max_tokens);
    if (tokens === undefined) {
      errors?.push('settings.json: subagents.max_tokens должен быть целым ≥ 1 — взято значение по умолчанию (2000)');
    } else {
      result.maxTokens = tokens;
    }
  }

  if (section.on_missing_persona !== undefined) {
    if (section.on_missing_persona === 'error' || section.on_missing_persona === 'skip') {
      result.onMissingPersona = section.on_missing_persona;
    } else {
      // Не молчаливое приведение: пользователь должен узнать, что опечатка
      // не сработала, и что действует дефолт `error`.
      errors?.push(
        `settings.json: subagents.on_missing_persona = "${String(section.on_missing_persona)}" неизвестен (допустимо error|skip) — взято "error"`,
      );
    }
  }

  return result;
}
