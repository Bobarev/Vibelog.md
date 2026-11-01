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
 * Порог повторов shell-скелетов (VL-254, дефолт 3).
 *
 * В разборе VL-235 shell-вызовы составили 72 из 110 tool-calls (65%), и
 * типовой антипаттерн «проверим ещё раз то же самое через node -e» guard не
 * видел вовсе: ключом была вся команда, а она уникальна по мелочи. Порог 3 —
 * как у поиска: второй вызов ещё бывает оправдан, третий — уже зацикливание.
 */
export const REPEAT_SHELL_LIMIT_DEFAULT = 3;

/**
 * VL-284: порог повторов правки одного файла (дефолт 6).
 *
 * Инцидент VL-284 (close VL-280): главным зацикленным вызовом был именно
 * `edit|src/mcp/tools.ts`×5 в цикле с `pnpm build`, а guard write-операции
 * вовсе не отслеживал (`write: 0`) — модель не получила ни одного
 * предупреждения, payload рос до 508 КБ, фаза сгорела за 5 попыток.
 * Итеративная правка одного файла — норма (исправил → проверил → поправил),
 * поэтому порог выше, чем у поиска: 6-я правка того же пути за ран — уже
 * повод предупредить.
 */
export const REPEAT_WRITE_LIMIT_DEFAULT = 6;

/**
 * VL-284: порог блокировки правки одного файла (дефолт 8).
 *
 * Отдельная константа, а не `writeLimit * blockMultiplier`: у write порог
 * эскалации задан явно, потому что цена ложной блокировки правки выше, чем
 * у чтения (модель не сможет дописать нужное изменение в этом ране).
 */
export const REPEAT_WRITE_BLOCK_DEFAULT = 8;

/**
 * VL-284: сколько повторов можно заблокировать за один ран (дефолт 5).
 *
 * По образцу `REPEAT_WARN_MAX_PER_RUN` (VL-229): каждая блокировка — это
 * tool-результат с директивой, и без капа зацикленный ран раздувал бы
 * контекст самими директивами, то есть лечил бы симптом тем же способом,
 * каким растёт payload.
 */
export const REPEAT_BLOCK_MAX_PER_RUN = 5;

/**
 * Категория повтора: от неё зависит, срабатывает ли guard и на каком пороге.
 * - search — grep_search/glob: повтор запроса тратит контекст без новой информации;
 * - read — read_file: повторное чтение того же файла (в т.ч. кусками);
 * - write — edit/write_file: в метрике считается, а с VL-284 ещё и даёт
 *   предупреждение (порог 6) и блокировку (порог 8): инцидент VL-284 показал,
 *   что цикл `edit` + `pnpm build` в close — такой же антипаттерн, как
 *   перечитывание файла, только контекст он раздувает быстрее;
 * - shell (VL-254) — run_shell_command: ключ — нормализованный скелет команды,
 *   а не вся строка (см. shellCommandKey). В VL-235 однотипные `node -e` и
 *   `grep -rn` по тем же путям давали 65% всех tool-calls, а guard не видел их
 *   вовсе — каждая команда уникальна по мелочи.
 */
export type RepeatKind = 'search' | 'read' | 'write' | 'shell';

/** Флаги node, включающие eval-режим (тело скрипта идёт следом). */
const NODE_EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);

/**
 * FNV-1a (32 бита) → 8 hex-символов.
 *
 * Собственная реализация вместо `node:crypto`, чтобы repeat-tracker остался
 * чистым модулем без Node-API (так он тестируется на массивах сообщений, а не
 * только на файлах). Для ключа повтора криптостойкость не нужна — нужен
 * стабильный короткий отпечаток тела скрипта.
 */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // Умножение на 16777619 через сдвиги: без потерь в 32-битной арифметике
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Нормализованный «скелет» shell-команды — ключ повтора для run_shell_command.
 *
 * Идея (VL-254): разные вызовы одной операции должны попадать в один ключ,
 * а различия в аргументах-мелочах — нет. Правила:
 * 1. Берётся первый сегмент цепочки (`&&`, `||`, `;`, `|`) — остальные части
 *    составной команды для детекта зацикливания не важны.
 * 2. `node -e/--eval/-p/--print` (в т.ч. с `--input-type=module`) → ключ
 *    `node-e|<FNV-1a первых 200 символов скрипта>`: одноразовые обходчики
 *    дерева — главный источник шума в VL-235.
 * 3. Иначе — имя команды + второй токен (подкоманда, если это не флаг) +
 *    уникальные флаги + значимые аргументы (пути и маски: содержат `/`, `*`
 *    или расширение файла), отсортированные. Так `pnpm build` не схлопывается
 *    с `pnpm test`, а `grep -rn foo src` и `grep -rn bar src` — схлопываются.
 *
 * @returns скелет (пустая строка для пустой команды), не длиннее 80 символов
 */
export function shellCommandKey(command: string): string {
  const trimmed = typeof command === 'string' ? command.trim() : '';
  if (!trimmed) return '';
  const first = trimmed.split(/&&|\|\||;|\|/)[0].trim();
  const tokens = first.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  // node с eval-телом: тело — весь хвост после eval-флага (--input-type
  // принимает значение, поэтому ищем первый eval-флаг, а не позицию 1)
  if (tokens[0] === 'node' || tokens[0] === 'nodejs') {
    const evalIdx = tokens.findIndex((t) => NODE_EVAL_FLAGS.has(t));
    if (evalIdx !== -1) {
      const body = tokens.slice(evalIdx + 1).join(' ').slice(0, 200);
      return `node-e|${fnv1aHex(body)}`;
    }
  }
  const rest = tokens.slice(1);
  const flags = [...new Set(rest.filter((t) => t.startsWith('-')))].sort();
  const significant = [
    ...new Set(rest.filter((t) => !t.startsWith('-') && (/[/*]/.test(t) || /\.\w+$/.test(t)))),
  ].sort();
  const skeleton = [
    tokens[0],
    // Второй токен-подкоманда (`pnpm build`, `git status`) — часть скелета:
    // без него все команды одного раннера слились бы в один ключ
    ...(tokens[1] !== undefined && !tokens[1].startsWith('-') ? [tokens[1]] : []),
    ...flags,
    ...significant,
  ].join(' ');
  return skeleton.length > 80 ? skeleton.slice(0, 80) : skeleton;
}

/**
 * Канонический объект повтора по имени инструмента и его аргументам.
 *
 * Ключ намеренно грубый (pattern для поиска, path для файловых операций):
 * offset/limit/glob/path поиска игнорируются — инцидент VL-226 показал, что
 * 39 чтений одного файла шли РАЗНЫМИ кусками, и точный ключ «path+offset»
 * не поймал бы зацикливание. Для `run_shell_command` ключ — скелет команды
 * (shellCommandKey, VL-254). Прочие инструменты возвращают null.
 */
export function toolRepeatTarget(name: string, args: Record<string, unknown>): string | null {
  const str = (key: string): string | null => {
    const v = args[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  switch (name) {
    case 'grep_search':
    case 'search_files':
      return str('pattern');
    case 'glob':
      return str('pattern');
    case 'read_file':
    case 'edit':
    case 'write_file':
      return str('path');
    case 'run_shell_command': {
      // VL-254: ключ — скелет команды, а не вся строка (см. shellCommandKey)
      const command = str('command');
      return command === null ? null : shellCommandKey(command);
    }
    default:
      return null;
  }
}

/** Категория повтора по имени инструмента (null — не отслеживается). */
export function toolRepeatKind(name: string): RepeatKind | null {
  switch (name) {
    case 'grep_search':
    case 'search_files':
    case 'glob':
      return 'search';
    case 'read_file':
      return 'read';
    case 'edit':
    case 'write_file':
      return 'write';
    case 'run_shell_command':
      return 'shell';
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
 * countToolCallsInMessages: фантомы VL-215 не считаются; shell-вызовы входят
 * с VL-254).
 * `repeat_calls` — вызовы, чей ключ уже встречался ранее (второй и далее).
 * `repeat_share` — repeat_calls / tool_calls_total (0 при пустом транскрипте).
 * `top` — до 10 ключей с count > 1 по убыванию: одиночные обращения не
 * «повтор», в топ не попадают.
 * `shell_*` (VL-254) — отдельная строка для `run_shell_command`: в VL-235
 * shell составил 65% tool-calls, и без раздельного счётчика вклад shell
 * маскировал долю повторов поиска/чтения.
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
  /** Все валидные вызовы run_shell_command (VL-254). */
  shell_tool_calls: number;
  /** Shell-вызовы, чей скелет уже встречался ранее (VL-254). */
  shell_repeat_calls: number;
  /** shell_repeat_calls / shell_tool_calls, округлено до 4 знаков (0 — нет данных). */
  shell_share: number;
  /** Топ повторяющихся shell-скелетов (count > 1), максимум 10. */
  shell_top: RepeatEntry[];
}

/** Пустая метрика: транскрипт без tool-вызовов (или старый jsonl). */
export function emptyRepeatStats(): RepeatStats {
  return {
    tool_calls_total: 0,
    repeat_calls: 0,
    repeat_share: 0,
    top: [],
    shell_tool_calls: 0,
    shell_repeat_calls: 0,
    shell_share: 0,
    shell_top: [],
  };
}

/** Топ ключей с count > 1 по убыванию (максимум 10) — общий для обеих метрик. */
function topRepeats(counts: Map<string, number>): RepeatEntry[] {
  const top: RepeatEntry[] = [];
  for (const [key, count] of counts) {
    if (count > 1) top.push({ key, count });
  }
  top.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return top.slice(0, 10);
}

/** Доля repeat/total, округлённая до 4 знаков (0 при пустом total). */
function shareOf(repeat: number, total: number): number {
  return total === 0 ? 0 : Math.round((repeat / total) * 10000) / 10000;
}

/**
 * Считает метрику повторов по сообщениям транскрипта (AC1).
 *
 * Для `/analyze` и меты сессии важен ВЕСЬ транскрипт (включая прошлые раны
 * resume), а не только текущий ран — поэтому вход — messages, а не счётчики.
 * Shell-вызовы (VL-254) считаются и в общей метрике, и отдельной строкой.
 */
export function analyzeToolRepeats(messages: ChatMessage[]): RepeatStats {
  const counts = new Map<string, number>();
  const shellCounts = new Map<string, number>();
  let total = 0;
  let repeats = 0;
  let shellTotal = 0;
  let shellRepeats = 0;
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
      if (tc.name === 'run_shell_command') {
        shellTotal++;
        const shellSeen = shellCounts.get(key) ?? 0;
        if (shellSeen >= 1) shellRepeats++;
        shellCounts.set(key, shellSeen + 1);
      }
    }
  }
  return {
    tool_calls_total: total,
    repeat_calls: repeats,
    repeat_share: shareOf(repeats, total),
    top: topRepeats(counts),
    shell_tool_calls: shellTotal,
    shell_repeat_calls: shellRepeats,
    shell_share: shareOf(shellRepeats, shellTotal),
    shell_top: topRepeats(shellCounts),
  };
}

/** Опции guard'а повторов: пороги и выключение. */
export interface RepeatGuardOptions {
  /** Порог повторов поиска (дефолт REPEAT_SEARCH_LIMIT_DEFAULT = 3). */
  searchLimit?: number;
  /** Порог повторов чтения файла (дефолт REPEAT_READ_LIMIT_DEFAULT = 5). */
  readLimit?: number;
  /** Порог повторов shell-скелета (VL-254, дефолт REPEAT_SHELL_LIMIT_DEFAULT = 3). */
  shellLimit?: number;
  /**
   * VL-284: порог предупреждения для правки одного файла (дефолт
   * REPEAT_WRITE_LIMIT_DEFAULT = 6). `0` — выключить порог для write
   * (поведение до VL-284: только метрика).
   */
  writeLimit?: number;
  /**
   * VL-284: порог блокировки для правки одного файла (дефолт
   * REPEAT_WRITE_BLOCK_DEFAULT = 8). Игнорируется при `writeLimit <= 0`.
   */
  writeBlockLimit?: number;
  /**
   * VL-284: во сколько раз порог блокировки больше порога предупреждения для
   * search/read/shell (дефолт 2). Для write порог блокировки задан явно —
   * цена ложной блокировки правки выше, чем ложной блокировки чтения.
   */
  blockMultiplier?: number;
}

/** Guard повторов: предупреждение + эскалация до блокировки (VL-284). */
export interface RepeatGuard {
  /**
   * Учитывает вызов инструмента и возвращает предупреждение, если порог
   * достигнут. `null` — повтор в норме либо инструмент не отслеживается.
   */
  note(name: string, args: Record<string, unknown>): string | null;
  /**
   * VL-284: пора ли НЕ выполнять этот вызов (порог блокировки достигнут).
   *
   * Счётчик НЕ инкрементирует — инкремент делает `note`, который loop
   * вызывает первым. `false`, если порог для категории выключен (`<= 0`) —
   * fail-open: без явных порогов guard не блокирует ничего.
   */
  shouldBlock(name: string, args: Record<string, unknown>): boolean;
  /** VL-284: сколько вызовов guard заблокировал за ран (для stderr). */
  blockedCount(): number;
  /** VL-284: пометить вызов заблокированным (увеличивает blockedCount). */
  noteBlocked(): void;
  /** VL-284: текущее число обращений по ключу (0, если не отслеживается). */
  countOf(name: string, args: Record<string, unknown>): number;
}

/**
 * Текст директивы блокировки повтора (VL-284).
 *
 * Маркер «Повтор заблокирован» стабилен (lesson-76): по нему событие опознают
 * тесты и разборы сессий. Формулировка намеренно НЕ пересекается с маркером
 * loop detection (`Loop detection:`) — причины разные: там один и тот же
 * вызов подряд, здесь накопленный счётчик за ран.
 */
export function repeatBlockDirective(key: string, count: number, kind: RepeatKind): string {
  const next =
    kind === 'write'
      ? 'правь другой участок файла либо зафиксируй прогресс и оформи аварийный итог фазы — повторная правка того же места нового результата не даст'
      : kind === 'read'
        ? 'возьми нужный диапазон одним read_file'
        : kind === 'search'
          ? 'сузь pattern/path либо работай с уже найденным файлом'
          : 'используй уже полученный вывод команды';
  return `Повтор заблокирован: ${key} — ${count} обращений за ран. Вызов НЕ выполнен. ${next}.`;
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
 * С VL-284 guard не только советует, но и эскалирует: после порога блокировки
 * вызов не выполняется (AC2) — иначе на зацикленном ране совет игнорируется,
 * а payload растёт до отказа провайдера (инцидент VL-284: 508 КБ).
 */
export function createRepeatGuard(options: RepeatGuardOptions = {}): RepeatGuard {
  const limits: Record<RepeatKind, number> = {
    search: options.searchLimit ?? REPEAT_SEARCH_LIMIT_DEFAULT,
    read: options.readLimit ?? REPEAT_READ_LIMIT_DEFAULT,
    // VL-254: однотипные shell-вызовы — самый частый вид зацикливания
    shell: options.shellLimit ?? REPEAT_SHELL_LIMIT_DEFAULT,
    // VL-284: правка одного файла 6 раз за ран — уже зацикливание (инцидент
    // close VL-280: `edit|src/mcp/tools.ts`×5 без единого предупреждения)
    write: options.writeLimit ?? REPEAT_WRITE_LIMIT_DEFAULT,
  };
  const multiplier = options.blockMultiplier ?? 2;
  const blockLimits: Record<RepeatKind, number> = {
    // Порог блокировки: у write он задан явно, у прочих — кратен множителю.
    // `limit <= 0` (порог выключен) → 0, то есть блокировки нет (fail-open).
    search: limits.search > 0 ? limits.search * multiplier : 0,
    read: limits.read > 0 ? limits.read * multiplier : 0,
    shell: limits.shell > 0 ? limits.shell * multiplier : 0,
    write: limits.write > 0 ? (options.writeBlockLimit ?? REPEAT_WRITE_BLOCK_DEFAULT) : 0,
  };
  const counts = new Map<string, number>();
  let blocked = 0;
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
          : kind === 'shell'
            ? 'используй её вывод; для обзора дерева/модулей — project_map или read_file каталога'
            : kind === 'write'
              ? 'правь другой участок файла или переходи к проверке — повторная правка того же места не даёт нового результата'
              : 'читай нужные чанки offset/limit одним вызовом';
      // Для shell формулировка «используй полученный вывод» — из AC1 VL-254
      return `Ты уже обращался к ${key} ${count} раз — используй ранее полученный результат (${hint}), не повторяй вызов.`;
    },
    shouldBlock(name: string, args: Record<string, unknown>): boolean {
      const kind = toolRepeatKind(name);
      const key = repeatKey(name, args);
      if (kind === null || key === null) return false;
      const blockLimit = blockLimits[kind];
      // 0 — порог выключен (fail-open): guard не блокирует «по умолчанию»
      if (blockLimit <= 0) return false;
      return (counts.get(key) ?? 0) >= blockLimit;
    },
    blockedCount(): number {
      return blocked;
    },
    noteBlocked(): void {
      blocked++;
    },
    countOf(name: string, args: Record<string, unknown>): number {
      const key = repeatKey(name, args);
      return key === null ? 0 : (counts.get(key) ?? 0);
    },
  };
}