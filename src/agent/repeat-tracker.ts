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
 * VL-357: пороги повторов исходов вызова (applied / noop / error) за ран.
 *
 * До VL-357 эти пороги жили в `src/agent/loop.ts` (`MAX_*_REPEATS_PER_RUN`),
 * а порог noop-серии веб-чата — своей константой в `src/web/tool-dedup.ts`.
 * Три независимых детектора давали три разных словаря директив на один и тот
 * же инцидент. Теперь порог объявлен ОДИН раз здесь.
 *
 * VL-359: сюда же переехали пороги детекторов повторов, которые оставались
 * локальными в `src/agent/loop.ts` (`PHANTOM_CALL_LIMIT_DEFAULT`,
 * `INTENT_LOOP_REPEAT_DEFAULT`) — AC3 VL-357 требовал единственного источника.
 */
export const REPEAT_LIMITS = {
  /** Порог предупреждения для поиска (grep/glob/search_files). */
  search: REPEAT_SEARCH_LIMIT_DEFAULT,
  /** Порог предупреждения для чтения файла. */
  read: REPEAT_READ_LIMIT_DEFAULT,
  /** Порог предупреждения для shell-скелета. */
  shell: REPEAT_SHELL_LIMIT_DEFAULT,
  /** Порог предупреждения для правки файла. */
  write: REPEAT_WRITE_LIMIT_DEFAULT,
  /** Порог блокировки правки файла. */
  writeBlock: REPEAT_WRITE_BLOCK_DEFAULT,
  /**
   * VL-310: сколько раз за ран можно повторить УЖЕ ПРИМЕНЁННЫЙ вызов.
   * Терминального выхода на первом повторе нет (VL-304 обрывал работу
   * середины фазы): модели уходит директива «переходи к отчёту», а кап
   * ограничивает вечный круг.
   */
  applied: 3,
  /**
   * VL-309: кап повторов noop-вызова («изменений нет»). Noop ≠ работа
   * сделана, поэтому штатного выхода нет — только честный fail() после
   * исчерпания (инцидент Close VL-307).
   */
  noop: 3,
  /**
   * VL-323: кап серии дословных повторов вызова, вернувшего отказ.
   * 5, а не 3: модели нужно время применить подсказку из текста ошибки
   * (инцидент Close VL-320).
   */
  error: 5,
  /** VL-253: кап заблокированных вызовов за ран (директивы не должны раздувать контекст). */
  blockedCalls: 5,
  /** VL-229: кап предупреждений о повторах за ран. */
  warnMax: 15,
  /**
   * VL-215: сколько ходов ПОДРЯД модель может отдавать фантомные tool_calls
   * (пустые name/id) до fail(). 3 — по образцу loop detection VL-83:
   * фантомный ход тратит LLM-запрос, но единичный случай модель исправляет
   * сама (получает текст-ошибку), 3 подряд — признак сломанного провайдера.
   */
  phantom: 3,
  /**
   * VL-119: дефолт guard'а зацикливания намерений — 4 хода подряд с одним
   * промежуточным текстом. Порог 4, а не 3 — снизить ложные срабатывания:
   * одинаковый короткий текст («Ок.») на паре ходов ещё не зацикливание.
   */
  intent: 4,
} as const;

/**
 * VL-284: сколько повторов можно заблокировать за один ран (дефолт 5).
 *
 * По образцу `REPEAT_WARN_MAX_PER_RUN` (VL-229): каждая блокировка — это
 * tool-результат с директивой, и без капа зацикленный ран раздувал бы
 * контекст самими директивами, то есть лечил бы симптом тем же способом,
 * каким растёт payload.
 *
 * VL-359: значение берётся из единого `REPEAT_LIMITS.blockedCalls` — раньше
 * это были две константы с одним значением, объявленные рядом, и правка одной
 * из них расходилась с другой.
 */
export const REPEAT_BLOCK_MAX_PER_RUN = REPEAT_LIMITS.blockedCalls;

/** VL-215: кап фантомных tool_calls подряд за ран. */
export const PHANTOM_CALL_LIMIT_DEFAULT = REPEAT_LIMITS.phantom;
/** VL-119: дефолт guard'а зацикливания намерений. */
export const INTENT_LOOP_REPEAT_DEFAULT = REPEAT_LIMITS.intent;

/** VL-310: кап повторов уже применённого вызова за ран. */
export const MAX_APPLIED_REPEATS_PER_RUN = REPEAT_LIMITS.applied;
/** VL-309: кап повторов noop-вызова за ран. */
export const MAX_NOOP_REPEATS_PER_RUN = REPEAT_LIMITS.noop;
/** VL-323: кап серии дословных повторов отказавшего вызова за ран. */
export const MAX_ERROR_REPEATS_PER_RUN = REPEAT_LIMITS.error;
/** VL-253: кап заблокированных вызовов за ран. */
export const MAX_BLOCKED_CALLS_PER_RUN = REPEAT_LIMITS.blockedCalls;
/** VL-229: кап предупреждений о повторах за ран. */
export const REPEAT_WARN_MAX_PER_RUN = REPEAT_LIMITS.warnMax;

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
 * Служебные аргументы вызова, НЕ входящие в сигнатуру (VL-326, VL-357).
 *
 * `idempotencyKey` — маркер повтора, а не семантика вызова: он описывает «это
 * тот же самый вызов, что и раньше», а не «что именно делает вызов». Пока
 * ключ входил в сигнатуру, новый ключ на каждый повтор делал сигнатуры
 * разными, и дедупликация обходилась сменой служебного поля (инцидент VL-324).
 *
 * VL-357: список ОДИН на оба детектора — `callSignature` (точный дубль) и
 * `repeatKey` (грубый ключ) вырезают его одинаково, а не двумя реализациями.
 */
export const NON_SEMANTIC_ARGS: readonly string[] = ['idempotencyKey'];

/** Копия аргументов без служебных полей (входной объект не мутируется). */
function stripNonSemanticArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  // Аргументы приходят и строкой (веб-слой и супервизор сериализуют args):
  // оператор `in` на строке бросает TypeError, и весь ход рушился с
  // «Cannot use 'in' operator to search for 'idempotencyKey'».
  if (args === undefined || args === null) return undefined;
  if (typeof args !== 'object') return undefined;
  let hasNonSemantic = false;
  for (const key of NON_SEMANTIC_ARGS) {
    if (key in args) {
      hasNonSemantic = true;
      break;
    }
  }
  if (!hasNonSemantic) return args;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (NON_SEMANTIC_ARGS.includes(key)) continue;
    copy[key] = value;
  }
  return copy;
}

/**
 * Стабильная сериализация значения для точной сигнатуры вызова (VL-255).
 *
 * Ключи объектов сортируются рекурсивно — `{a:1,b:2}` и `{b:2,a:1}` дают
 * одинаковую подпись (порядок ключей в JSON модели не стабилен).
 * `undefined`/функции/символы отбрасываются как отсутствующие. BigInt
 * сериализуется строкой: JSON.stringify на нём бросает исключение.
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`);
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => stableSerialize(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(',')}}`;
}

/**
 * Ключ вызова: имя инструмента + стабильная сериализация аргументов (VL-255).
 *
 * Точный ключ: ловит именно «дословный» повтор. Грубый `repeatKey` ниже
 * схлопывает все чтения одного файла в один ключ (независимо от offset/limit)
 * и годится для предупреждений, но не для блокировки исполнения.
 *
 * VL-357: единственная реализация на оба слоя (агентский цикл и веб-чат);
 * служебные аргументы (`NON_SEMANTIC_ARGS`) вырезаются до сериализации.
 */
export function callSignature(name: string, args: Record<string, unknown> | undefined): string {
  const stripped = stripNonSemanticArgs(args);
  // Не-объектные аргументы сериализуются как есть: сигнатура должна различать
  // вызовы, а не падать на чужом формате (строковый args веб-слоя).
  const payload = stripped !== undefined ? stripped : args;
  return `${name}|${stableSerialize(payload ?? {})}`;
}

/**
 * Ключ повтора в формате `<имя инструмента>|<объект>` — он же `path|pattern`
 * из AC1 (для файловых операций — `read_file|src/agent/loop.ts`).
 *
 * VL-357: служебные аргументы вырезаются так же, как в `callSignature`, —
 * смена `idempotencyKey` не превращает повтор в «новый» вызов.
 *
 * @returns null, если инструмент не отслеживается либо аргумент отсутствует
 */
export function repeatKey(name: string, args: Record<string, unknown>): string | null {
  const target = toolRepeatTarget(name, stripNonSemanticArgs(args) ?? {});
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

/**
 * Подсказка следующего шага для директивы loop detection (VL-251).
 *
 * Сообщение о зацикливании раньше было констатацией и уходило ролью
 * assistant — модель не понимала, что делать вместо повтора. Теперь директива
 * уходит tool-результатом и заканчивается конкретным действием.
 */
export const NEXT_STEP_HINT =
  'Следующий шаг: смени аргументы или инструмент, прочитай актуальное состояние (backlog_view_task / git status / grep) либо заверши фазу финальным текстом.';

/** Длина текста в UTF-8 байтах (без node:Buffer — модуль остаётся чистым). */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Предел длины директивы в байтах (инвариант VL-310).
 *
 * Готовый JSON-вызов с кириллическими путями легко его превышает, поэтому
 * `retryDirective` перебирает варианты усечения, сохраняя `retryWith` —
 * именно он и есть смысл директивы.
 */
export const DIRECTIVE_MAX_BYTES = 400;

/** Максимальная длина текста ошибки внутри директивы (инвариант < 400 байт). */
const ERROR_IN_DIRECTIVE_MAX_CHARS = 100;

/** Сколько символов хвоста сохранить (готовая подсказка стоит в конце). */
const ERROR_IN_DIRECTIVE_TAIL_CHARS = 35;

/**
 * Обрезает текст отказа для подстановки в директиву loop detection (VL-323).
 *
 * Сжимает пробелы. Длинный текст режется с сохранением ХВОСТА: готовая
 * подсказка («передай allowForeign: true») у ackError стоит в конце сообщения,
 * и простое усечение по голове её съедало (риск R2 плана VL-323: директива
 * обязана остаться < 400 байт, инвариант VL-310).
 *
 * VL-351: текст из `hint` не режется вовсе — он короткий по построению
 * (готовая инструкция), а обрезка по голове+хвосту калечила его.
 */
export function clipErrorText(text: string, fromHint = false): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (fromHint || flat.length <= ERROR_IN_DIRECTIVE_MAX_CHARS) return flat;
  const head = ERROR_IN_DIRECTIVE_MAX_CHARS - ERROR_IN_DIRECTIVE_TAIL_CHARS - 1;
  return `${flat.slice(0, head)}…${flat.slice(-ERROR_IN_DIRECTIVE_TAIL_CHARS)}`;
}

/**
 * Извлекает текст отказа из JSON-ответа write-инструмента (VL-323, VL-351).
 *
 * ackError кладёт причину в `error`, ackDenied — в `message`; для прочих форм
 * берётся первое непустое из них. `hint` идёт ПЕРВЫМ: это короткое готовое
 * действие для модели, а `error` у ackErrorDetailed бывает длинным и содержать
 * примеры markdown, из которых обрезка оставляла бессмысленный обрывок.
 * `fromHint` сообщает вызывающему, что текст короткий по построению.
 *
 * VL-357: тип исхода сведён к протоколу — `retryWith` читается из `next` (новая
 * форма) и из корня (форма VL-353), чтобы старые ответы не теряли исправление.
 */
export function parsedErrorText(
  output: string,
): { text: string; fromHint: boolean; retryWith?: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(output) as {
      hint?: unknown;
      error?: unknown;
      message?: unknown;
      retryWith?: unknown;
      next?: { retryWith?: unknown; hint?: unknown };
    } | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const rawRetry = parsed.next?.retryWith ?? parsed.retryWith;
    const retryWith =
      rawRetry !== null && typeof rawRetry === 'object' && !Array.isArray(rawRetry)
        ? (rawRetry as Record<string, unknown>)
        : undefined;
    for (const [value, fromHint] of [
      [parsed.next?.hint ?? parsed.hint, true],
      [parsed.error, false],
      [parsed.message, false],
    ] as const) {
      if (typeof value === 'string' && value.trim() !== '') {
        return retryWith === undefined ? { text: value, fromHint } : { text: value, fromHint, retryWith };
      }
    }
    if (retryWith !== undefined) return { text: '', fromHint: false, retryWith };
    return null;
  } catch {
    return null;
  }
}

/**
 * Собирает директиву с ГОТОВЫМ вызовом (VL-353).
 *
 * Модель получает строку, которую можно скопировать в следующий tool_call без
 * размышлений: имя инструмента + JSON аргументов повторённого вызова с
 * подставленным `retryWith`. Если JSON не влезает в лимит VL-310, `paths`
 * усекается до первого элемента с пометкой «остальные пути — те же»: смысл
 * директивы (`retryWith`) сохраняется всегда.
 */
export function retryDirective(
  name: string,
  retryWith: Record<string, unknown>,
  callArgs?: Record<string, unknown>,
): string {
  const head = `Loop detection: ${name} — предыдущий вызов отклонён. Повтори так: ${name} `;
  const merged: Record<string, unknown> = { ...(callArgs ?? {}), ...retryWith };
  const paths = merged.paths;
  const samePathsNote = ' (остальные пути — те же)';
  const candidates: string[] = [JSON.stringify(merged)];
  if (Array.isArray(paths) && paths.length > 1) {
    candidates.push(JSON.stringify({ ...merged, paths: [paths[0]] }) + samePathsNote);
  }
  if (Array.isArray(paths)) {
    candidates.push(JSON.stringify({ ...merged, paths: [] }) + samePathsNote);
  }
  for (const candidate of candidates) {
    const text = head + candidate;
    if (byteLength(text) < DIRECTIVE_MAX_BYTES) return text;
  }
  return head + clipErrorText(JSON.stringify(retryWith), false);
}

/**
 * Текст директивы loop detection для tool-результата заблокированного вызова.
 *
 * Маркерная подстрока «Loop detection» сохранена намеренно (lesson-76): по ней
 * распознают событие существующие тесты и разборы сессий.
 *
 * VL-323: если предыдущий ответ по этой сигнатуре был отказом, директива
 * обязана назвать ПРИЧИНУ отказа и готовое исправление — иначе слабая модель
 * читает общее «смени аргументы» как «попробуй ещё раз» и повторяет дословно
 * (инцидент Close VL-320). VL-353: если инструмент дал `retryWith`, директива
 * выдаёт ГОТОВЫЙ вызов, а не описательное «исправь аргументы».
 *
 * @param name — имя повторённого инструмента
 * @param repeatLimit — порог повторов, при котором сработала блокировка
 * @param lastError — текст последнего отказа по этой сигнатуре (если был)
 * @param fromHint — текст взят из поля `hint`: он короткий по построению
 * @param retryWith — машиночитаемое исправление из отказа
 * @param callArgs — аргументы повторённого вызова
 */
export function loopDetectionDirective(
  name: string,
  repeatLimit: number,
  lastError?: string,
  fromHint = false,
  retryWith?: Record<string, unknown>,
  callArgs?: Record<string, unknown>,
): string {
  if (retryWith !== undefined && Object.keys(retryWith).length > 0) {
    return retryDirective(name, retryWith, callArgs);
  }
  const reason = lastError === undefined ? '' : clipErrorText(lastError, fromHint);
  if (reason !== '') {
    return (
      `Loop detection: ${name} — предыдущий вызов отклонён: ${reason}. Повтор даст тот же отказ — исправь аргументы.`
    );
  }
  return (
    `Loop detection: инструмент ${name} вызван ${repeatLimit} раза подряд с одинаковыми аргументами — вызов НЕ выполнен и заблокирован. ` +
    `Повтор с теми же аргументами бесполезен. ${NEXT_STEP_HINT}`
  );
}

/**
 * Текст директивы для повтора вызова, чей результат уже был ok/noop (VL-303).
 *
 * Отличие от `loopDetectionDirective`: вызов УЖЕ применён, поэтому фазу
 * прерывать нельзя — модели нужно лишь перейти к отчёту. Маркерная подстрока
 * «уже применён» используется тестами и разборами сессий.
 */
export function appliedNoopDirective(name: string): string {
  return (
    `Вызов ${name} уже применён ранее — повтор с теми же аргументами НЕ выполнен, он ничего не изменит. ` +
    'Изменения применены; переходи к следующему пункту фазы, а если работа сделана — к отчёту (backlog_finish_phase).'
  );
}

/**
 * Текст директивы для повтора вызова, чей ответ был noop (VL-309, VL-319).
 *
 * Отличие от `appliedNoopDirective`: noop означает «изменений нет», а не
 * «работа сделана». Поэтому ран НЕ завершается — модели напоминают, что повтор
 * бесполезен, и направляют к следующему шагу. Маркерная подстрока «Изменений
 * нет» используется тестами и разборами сессий.
 *
 * VL-319: прежний текст утверждал «вызов уже был выполнен» — это НЕВЕРНЫЙ факт:
 * первый же ответ был noop, вызов не исполнялся. Модель читала «не выполнен» и
 * повторяла дословно (сессия agent-1793712738536: 4 повтора `lesson_update`
 * без `content` → кап → fail).
 */
export function noopRepeatDirective(name: string): string {
  return (
    `Изменений нет: вызов ${name} НЕ исполнен (поля уже такие). Повтор ничего не изменит. ` +
    'Следующий шаг: прочитай состояние (lesson_view) или смени аргумент — добавь отсутствующее поле.'
  );
}
