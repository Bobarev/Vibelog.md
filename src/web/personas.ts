/**
 * Реестр ролей («персон») веб-чата (VL-265).
 *
 * Роль — это дополнительный блок системного промпта плюс пара настроек
 * поведения (дефолтный статус создаваемой задачи, будущий allow_tools).
 * Общие правила (доступ read/write, список инструментов, границы проекта)
 * живут в templates/prompts/chat-system.md и в файлах ролей НЕ дублируются:
 * итоговый промпт = общая часть + блок роли + контекст globalSearch
 * (сборка — buildSystemPrompt в src/web/chat.ts).
 *
 * Источники реестра:
 * 1. Встроенные роли в коде (BUILTIN_PERSONAS) — работают БЕЗ секции
 *    settings.json: helper / architect / supervisor.
 * 2. Секция `chat_personas` в `.vibelog/settings.json` — ключ = id роли,
 *    значение = { label, description?, prompt, allow_tools?, default_status? }.
 *    Секция ТОЛЬКО переопределяет встроенную роль (по id) и добавляет новые
 *    (проектные роли вроде researcher/auditor).
 *
 * Валидация терпимая (паттерн loadSettings/VL-209): битые записи не роняют
 * чат, а попадают в список `errors`, который отдаёт GET /api/personas и
 * логирует сервер. Встроенная роль при ошибке в секции остаётся рабочей.
 *
 * Резолвер текста роли — зеркало loadChatSystemTemplate (src/web/tool-policy.ts):
 * `<cwd>/.vibelog/prompts/personas/<prompt>.md` → встроенный
 * `templates/prompts/personas/<prompt>.md`; оба отсутствуют — fail-closed
 * (ошибка установки: роль объявлена, а текста нет).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from '../core/settings.js';
import { loadConfig } from '../core/config.js';
import { listTools } from '../mcp/tools.js';

/** Каталог проектных переопределений промптов ролей (относительно cwd). */
export const PROJECT_PERSONAS_DIR = join('.vibelog', 'prompts', 'personas');

/** Роль по умолчанию при старте чата (AC14: всегда helper, без localStorage). */
export const DEFAULT_PERSONA_ID = 'helper';

/** Статус создаваемой задачи, когда роль его не задала. */
const FALLBACK_DEFAULT_STATUS = 'Spec';

/** Локальные (не-MCP) инструменты чата — тоже валидные имена для allow_tools. */
const LOCAL_CHAT_TOOLS = ['read_file', 'write_file', 'search_files'] as const;

/** Одна роль реестра (после слияния встроенных и проектных). */
export interface PersonaConfig {
  /** id роли (ключ в chat_personas / встроенный id). */
  id: string;
  /** Название для пикера («Помощник»). */
  label: string;
  /** Короткое описание для второй строки пикера. */
  description?: string;
  /**
   * Имя файла шаблона промпта без расширения:
   * `<cwd>/.vibelog/prompts/personas/<prompt>.md` →
   * `templates/prompts/personas/<prompt>.md`.
   */
  prompt: string;
  /**
   * Шов на будущее (VL-265, AC10): список разрешённых инструментов роли.
   * Читается и валидируется, но фильтрация chatToolDefs по нему —
   * отдельная задача.
   */
  allowTools?: string[];
  /** Статус создаваемой из чата задачи (helper → Spec, architect → Planned). */
  defaultStatus?: string;
}

/** Сводка роли для GET /api/personas — без текста промпта (AC13). */
export interface PersonaSummary {
  id: string;
  label: string;
  description?: string;
}

/**
 * Встроенные роли (AC9): работают без секции chat_personas. Тексты —
 * templates/prompts/personas/<prompt>.md; проекты переопределяют их
 * файлами .vibelog/prompts/personas/<prompt>.md.
 */
export const BUILTIN_PERSONAS: readonly PersonaConfig[] = [
  {
    id: 'helper',
    label: 'Помощник',
    description: 'Работа с backlog: быстро отвечает и создаёт задачи в Spec',
    prompt: 'helper',
    defaultStatus: 'Spec',
  },
  {
    id: 'architect',
    label: 'Архитектор',
    description: 'Исследует код и backlog глубже, создаёт задачи в Planned',
    prompt: 'architect',
    defaultStatus: 'Planned',
  },
  {
    id: 'supervisor',
    label: 'Супервизор',
    description: 'Ведёт прогон: запускает фазы, лечит зацикливания, заводит баги',
    prompt: 'supervisor',
    defaultStatus: 'Spec',
  },
];

/**
 * id удалённых встроенных ролей (VL-273): запись в chat_personas с таким id
 * НЕ воскрешает роль — она отбрасывается с ошибкой. Смысл: старая/чужая
 * конфигурация не должна молча вернуть в пикер подпись удалённой роли.
 * Имя `orchestrator` занято модулем запуска одной фазы (src/web/orchestrator.ts)
 * и в реестре ролей больше не используется — роль заменена на `supervisor`.
 */
export const RETIRED_PERSONA_IDS: readonly string[] = ['orchestrator'];

/** Путь к встроенному каталогу шаблонов (dist/web/personas.js → ../../templates/prompts/personas/). */
const bundledPersonasDir = fileURLToPath(
  new URL('../../templates/prompts/personas/', import.meta.url),
);

/** Полный реестр ролей вместе с ошибками валидации секции. */
export interface PersonasRegistry {
  /** Роли в порядке: встроенные (как объявлены), затем проектные. */
  personas: PersonaConfig[];
  /** Понятные ошибки секции chat_personas (пусто — всё валидно). */
  errors: string[];
}

/**
 * Читает секцию chat_personas и сливает её со встроенными ролями.
 *
 * Переопределение — по совпадению id (встроенная роль меняет label/prompt/
 * default_status, порядок сохраняется); новая запись добавляется в конец.
 * Битые записи отбрасываются с ошибкой (паттерн loadSettings): чат должен
 * работать даже при сломанной секции.
 */
export function loadPersonas(cwd: string): PersonasRegistry {
  const errors: string[] = [];
  const raw = loadSettings(cwd).chat_personas;
  const personas: PersonaConfig[] = BUILTIN_PERSONAS.map(p => ({ ...p }));

  if (raw === undefined) return { personas, errors };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push('settings.json: секция chat_personas должна быть объектом {id: {...}}');
    return { personas, errors };
  }

  // Индексы встроенных ролей — для переопределения по id с сохранением порядка
  const builtinIndex = new Map(personas.map((p, i) => [p.id, i]));

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    // id удалённой встроенной роли (VL-273): не добавляем и не переопределяем —
    // конфигурация не должна воскрешать роль, убранную из реестра
    if (RETIRED_PERSONA_IDS.includes(id)) {
      errors.push(
        `settings.json: роль "${id}" удалена из реестра (заменена ролью "supervisor") — запись chat_personas с этим id игнорируется`,
      );
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push(`settings.json: роль "${id}" в chat_personas должна быть объектом`);
      continue;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.label !== 'string' || v.label.trim() === '') {
      errors.push(`settings.json: у роли "${id}" не задан label`);
      continue;
    }
    if (typeof v.prompt !== 'string' || v.prompt.trim() === '') {
      errors.push(`settings.json: у роли "${id}" не задан prompt (имя файла шаблона без .md)`);
      continue;
    }
    const persona: PersonaConfig = { id, label: v.label.trim(), prompt: v.prompt.trim() };
    if (typeof v.description === 'string' && v.description.trim() !== '') {
      persona.description = v.description.trim();
    }
    if (v.allow_tools !== undefined) {
      const allowed = parseAllowTools(id, v.allow_tools, errors);
      if (allowed) persona.allowTools = allowed;
    }
    if (v.default_status !== undefined) {
      const status = parseDefaultStatus(cwd, id, v.default_status, errors);
      if (status) persona.defaultStatus = status;
    }
    const idx = builtinIndex.get(id);
    if (idx !== undefined) {
      // Переопределение встроенной роли: недозаданные поля наследуются
      personas[idx] = { ...personas[idx]!, ...persona };
    } else {
      personas.push(persona);
    }
  }
  return { personas, errors };
}

/**
 * Разбор allow_tools: массив непустых строк с известными именами инструментов
 * (MCP-реестр listTools() + локальные read_file/write_file/search_files).
 *
 * @returns массив имён либо null при ошибке (ошибка уже добавлена в errors)
 */
function parseAllowTools(id: string, value: unknown, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`settings.json: у роли "${id}" allow_tools должен быть массивом имён инструментов`);
    return null;
  }
  const known = new Set<string>([...listTools().map(t => t.name), ...LOCAL_CHAT_TOOLS]);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      errors.push(`settings.json: у роли "${id}" в allow_tools ожидаются непустые строки`);
      return null;
    }
    const name = item.trim();
    if (!known.has(name)) {
      errors.push(`settings.json: у роли "${id}" allow_tools ссылается на неизвестный инструмент "${name}"`);
      return null;
    }
    out.push(name);
  }
  return out;
}

/**
 * Разбор default_status: статус должен существовать в backlog/config.yml
 * (loadConfig().statuses). Невалидный — ошибка, роль получает дефолт.
 */
function parseDefaultStatus(
  cwd: string,
  id: string,
  value: unknown,
  errors: string[],
): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`settings.json: у роли "${id}" default_status должен быть непустой строкой`);
    return null;
  }
  const status = value.trim();
  let statuses: string[] = [];
  try {
    const rawStatuses = loadConfig(cwd).statuses;
    statuses = Array.isArray(rawStatuses)
      ? rawStatuses.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    // Битый конфиг проекта — не повод ронять чат: считаем статус неизвестным
    statuses = [];
  }
  if (!statuses.includes(status)) {
    errors.push(
      `settings.json: у роли "${id}" default_status "${status}" отсутствует в statuses backlog/config.yml`,
    );
    return null;
  }
  return status;
}

/** Реестр только со сводками для пикера (без текстов промптов). */
export function listPersonas(cwd: string): { personas: PersonaSummary[]; errors: string[] } {
  const { personas, errors } = loadPersonas(cwd);
  return {
    personas: personas.map(p => ({
      id: p.id,
      label: p.label,
      ...(p.description ? { description: p.description } : {}),
    })),
    errors,
  };
}

/** Роль по id; null — неизвестный id. */
export function resolvePersona(cwd: string, id: string): PersonaConfig | null {
  return loadPersonas(cwd).personas.find(p => p.id === id) ?? null;
}

/** Все ошибки секции chat_personas (для логов/диагностики сервера). */
export function validatePersonasConfig(cwd: string): string[] {
  return loadPersonas(cwd).errors;
}

/**
 * Статус создаваемой из чата задачи по роли (AC12): helper → Spec,
 * architect → Planned. Явно переданный в вызове статус по-прежнему
 * приоритетнее — это решает toolCreateTask (src/mcp/tools.ts), здесь
 * только дефолт.
 */
export function resolveDefaultStatus(persona: PersonaConfig | null | undefined): string {
  return persona?.defaultStatus || FALLBACK_DEFAULT_STATUS;
}

/**
 * Текст промпта роли: проектное переопределение → встроенный шаблон.
 *
 * @throws Error, если файл отсутствует в обоих каталогах (fail-closed —
 *   роль объявлена, а текста нет: молча пустой промпт хуже явной ошибки)
 */
export function loadPersonaPrompt(cwd: string, persona: PersonaConfig): string {
  const rel = join(PROJECT_PERSONAS_DIR, `${persona.prompt}.md`);
  try {
    return readFileSync(join(cwd, rel), 'utf8').trimEnd();
  } catch {
    // Нет переопределения — падаем на встроенный шаблон
  }
  const bundled = join(bundledPersonasDir, `${persona.prompt}.md`);
  try {
    return readFileSync(bundled, 'utf8').trimEnd();
  } catch {
    throw new Error(
      `Шаблон роли "${persona.id}" не найден: ${rel} (проект) и ${bundled} (пакет)`,
    );
  }
}
