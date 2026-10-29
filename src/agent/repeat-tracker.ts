/**
 * Детектор повторов обращений агента к одним и тем же файлам/паттернам (VL-229).
 *
 * Разбор сессий VL-221/VL-226 показал системный антипаттерн: агент жадно
 * перебирает `grep_search` (218 вызовов = 35% tool-вызовов сессии) и
 * многократно перечитывает одни и те же файлы (loop.ts — 39, test-setup.mjs —
 * 46). Раздувается контекст, растёт доля «Продолжи» и число wall-убийств.
 *
 * Модуль даёт два независимых механизма:
 * 1. `createRepeatGuard` — предупреждение МОДЕЛИ в ходе рана (порог 3 для
 *    поиска, 5 для чтения файла): агент получает в контекст «используй ранее
 *    полученный результат» вместо очередного дублирующего вызова.
 * 2. `analyzeToolRepeats` — ПОСТ-ФАКТУМ метрика по всему транскрипту сессии
 *    (топ повторяющихся ключей и их доля от всех tool-вызовов), которая
 *    пишется в мету сессии и в отчёт /analyze.
 *
 * Модуль намеренно чистый: без fs и без MCP — поэтому тестируется и на
 * массиве сообщений, и на jsonl (через парсер в session.ts), и в loop.
 */

import { isValidToolCall, type ChatMessage } from './llm.js';

/** Порог повторов поиска (grep_search/glob с тем же pattern, дефолт 3). */
export const REPEAT_SEARCH_LIMIT_DEFAULT = 3;
/** Порог повторов чтения (read_file с тем же path, дефолт 5). */
export const REPEAT_READ_LIMIT_DEFAULT = 5;

/**
 * Категория повтора: от неё зависит, срабатывает ли guard и на каком пороге.
 * - search — grep_search/glob: повтор запроса тратит контекст без новой информации;
 * - read — read_file: повторное чтение того же файла (в т.ч. кусками);
 * - write — edit/write_file: в метрике считается, но guard НЕ ставит —
 *   повторная правка одного файла легитимна (итеративное исправление).
 */
export type RepeatKind = 'search' | 'read' | 'write';

/**
 * Канонический объект повтора по имени инструмента и его аргументам.
 *
 * Ключ намеренно грубый (pattern для поиска, path для файловых операций):
 * offset/limit/glob/path поиска игнорируются — инцидент VL-226 показал, что
 * 39 чтений одного файла шли РАЗНЫМИ кусками, и точный ключ «path+offset»
 * не поймал бы зацикливание. `run_shell_command` и прочие инструменты
 * возвращают null: shell-команда как ключ даёт шум (каждый вызов уникален
 * по мелочи и не детектирует перечитывание файлов).
 */
export function toolRepeatTarget(name: string, args: Record<string, unknown>): string | null {
  const str = (key: string): string | null => {
    const v = args[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  switch (name) {
    case 'grep_search':
      return str('pattern');
    case 'glob':
      return str('pattern');
    case 'read_file':
    case 'edit':
    case 'write_file':
      return str('path');
    default:
      return null;
  }
}

/** Категория повтора по имени инструмента (null — не отслеживается). */
export function toolRepeatKind(name: string): RepeatKind | null {
  switch (name) {
    case 'grep_search':
    case 'glob':
      return 'search';
    case 'read_file':
      return 'read';
    case 'edit':
    case 'write_file':
      return 'write';
    default:
      return null;
  }
}

/**
 * Ключ повтора в формате `<имя инструмента>|<объект>` — он же `path|pattern`
 * из AC1 (для файловых операций — `read_file|src/agent/loop.ts`).
 *
 * @returns null, если инструмент не отслеживается либо аргумент отсутствует
 */
export function repeatKey(name: string, args: Record<string, unknown>): string | null {
  const target = toolRepeatTarget(name, args);
  if (target === null) return null;
  return `${name}|${target}`;
}

/** Одна строка топа повторов: ключ и число обращений. */
export interface RepeatEntry {
  key: string;
  count: number;
}

/**
 * Метрика повторов транскрипта (AC1).
 *
 * `tool_calls_total` — все валидные tool-вызовы сессии (семантика совпадает с
 * countToolCallsInMessages: фантомы VL-215 не считаются, НО shell и прочие
 * неотслеживаемые вызовы входят — иначе доля повторов была бы завышена).
 * `repeat_calls` — вызовы, чей ключ уже встречался ранее (второй и далее).
 * `repeat_share` — repeat_calls / tool_calls_total (0 при пустом транскрипте).
 * `top` — до 10 ключей с count > 1 по убыванию: одиночные обращения не
 * «повтор», в топ не попадают.
 */
export interface RepeatStats {
  /** Все валидные tool-вызовы транскрипта. */
  tool_calls_total: number;
  /** Вызовы с уже встречавшимся ключом (2-е и последующие обращения). */
  repeat_calls: number;
  /** repeat_calls / tool_calls_total, округлено до 4 знаков (0 — нет данных). */
  repeat_share: number;
  /** Топ повторяющихся ключей (count > 1), максимум 10. */
  top: RepeatEntry[];
}

/** Пустая метрика: транскрипт без tool-вызовов (или старый jsonl). */
export function emptyRepeatStats(): RepeatStats {
  return { tool_calls_total: 0, repeat_calls: 0, repeat_share: 0, top: [] };
}

/**
 * Считает метрику повторов по сообщениям транскрипта (AC1).
 *
 * Для `/analyze` и меты сессии важен ВЕСЬ транскрипт (включая прошлые раны
 * resume), а не только текущий ран — поэтому вход — messages, а не счётчики.
 */
export function analyzeToolRepeats(messages: ChatMessage[]): RepeatStats {
  const counts = new Map<string, number>();
  let total = 0;
  let repeats = 0;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      if (!isValidToolCall(tc)) continue; // фантомы VL-215 бюджет не едят
      total++;
      const key = repeatKey(tc.name, (tc.arguments ?? {}) as Record<string, unknown>);
      if (key === null) continue;
      const seen = counts.get(key) ?? 0;
      if (seen >= 1) repeats++;
      counts.set(key, seen + 1);
    }
  }
  const top: RepeatEntry[] = [];
  for (const [key, count] of counts) {
    if (count > 1) top.push({ key, count });
  }
  top.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    tool_calls_total: total,
    repeat_calls: repeats,
    repeat_share: total === 0 ? 0 : Math.round((repeats / total) * 10000) / 10000,
    top: top.slice(0, 10),
  };
}

/** Опции guard'а повторов: пороги и выключение. */
export interface RepeatGuardOptions {
  /** Порог повторов поиска (дефолт REPEAT_SEARCH_LIMIT_DEFAULT = 3). */
  searchLimit?: number;
  /** Порог повторов чтения файла (дефолт REPEAT_READ_LIMIT_DEFAULT = 5). */
  readLimit?: number;
}

/** Guard повторов: выдаёт текст предупреждения модели либо null. */
export interface RepeatGuard {
  /**
   * Учитывает вызов инструмента и возвращает предупреждение, если порог
   * достигнут. `null` — повтор в норме либо инструмент не отслеживается.
   */
  note(name: string, args: Record<string, unknown>): string | null;
}

/**
 * Создаёт guard повторов (AC2): счётчик по ключу в пределах ОДНОГО рана.
 *
 * Стейт живёт в памяти процесса и создаётся на каждый runLoop — при resume
 * счёт сбрасывается (риск 3 плана): иначе модель получала бы предупреждение
 * за действия прошлого рана, а прошлые вызовы уже дали ей их результаты.
 * Метрика по всей сессии считается отдельно (analyzeToolRepeats), асимметрия
 * осознанная.
 *
 * Предупреждение отдаётся на N-м вызове (порог) и на каждом последующем:
 * однократное предупреждение модель легко «забывает» на длинном ране.
 * `edit`/`write_file` в счётчиках участвуют, но предупреждения не дают —
 * повторная правка файла легитимна (итеративное исправление).
 */
export function createRepeatGuard(options: RepeatGuardOptions = {}): RepeatGuard {
  const limits: Record<RepeatKind, number> = {
    search: options.searchLimit ?? REPEAT_SEARCH_LIMIT_DEFAULT,
    read: options.readLimit ?? REPEAT_READ_LIMIT_DEFAULT,
    // 0 = «никогда»: write-повторы только в метрике
    write: 0,
  };
  const counts = new Map<string, number>();
  return {
    note(name: string, args: Record<string, unknown>): string | null {
      const kind = toolRepeatKind(name);
      const key = repeatKey(name, args);
      if (kind === null || key === null) return null;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      const limit = limits[kind];
      if (limit <= 0 || count < limit) return null;
      // Маркер «используй ранее полученный результат» обязателен: по нему
      // опознаются предупреждения в тестах и разборе сессий (lesson-76).
      const hint =
        kind === 'search'
          ? 'сузь pattern/path или читай найденный файл'
          : 'читай нужные чанки offset/limit одним вызовом';
      return `Ты уже обращался к ${key} ${count} раз — используй ранее полученный результат (${hint}), не повторяй вызов.`;
    },
  };
}