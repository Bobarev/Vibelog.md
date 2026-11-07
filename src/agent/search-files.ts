/**
 * Поиск по файлам проекта (VL-234): общий модуль обхода дерева + инструмент
 * `search_files`.
 *
 * Зачем отдельный модуль: до VL-234 найти место использования/определения
 * символа можно было только серией `read_file` с `offset`/`limit` — агент
 * читал файл кусками по 80–120 строк и всё равно промахивался (инцидент
 * VL-232: `reference-cache.ts` и `cli.ts` перечитывались по 2-3 раза).
 * Теперь один вызов `search_files` даёт «где встречается X» с путями,
 * номерами строк и контекстом.
 *
 * Модуль намеренно без внешних зависимостей (`node:fs`/`node:path`) и без
 * MCP: файловые инструменты живут в локальном наборе агента и веб-чата,
 * а не в backlog-домене MCP-сервера (см. план VL-234).
 *
 * Правила обхода и игнора вынесены сюда в единственном экземпляре
 * (lesson-37): `grep_search` и `glob` в src/agent/tools.ts, а также
 * `search_files` здесь используют один `walkFiles`/`SKIP_DIRS`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { formatMissingPathHint, miniGlobToRegex, resolveInProject, truncateToolOutput } from './tools.js';

/**
 * Каталоги, которые обход не рассматривает (шум, размер репозитория, а для
 * `.git` — запрещённое к разбору содержимое). `dist` (в т.ч. `web/dist`) —
 * скомпилированный дубль `src/`: поиск по нему даёт вдвое больше совпадений
 * без новой информации. До VL-234 `dist` не исключался — это осознанное
 * изменение поведения `grep_search`/`glob`, зафиксировано в CHANGELOG.
 */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Рекурсивный обход дерева проекта (readdirSync, синхронно — инструменты
 * всё равно выполняются в loop без параллелизма). Возвращает относительные
 * posix-пути файлов; лимит — защита от раздувания вывода.
 *
 * Симлинки-каталоги не разворачиваются: `Dirent.isDirectory()` для них
 * false, поэтому обход не может выйти за пределы проекта по ссылке.
 *
 * @param root — абсолютный путь корня обхода
 * @param limit — максимум собранных файлов
 * @param opts.skipDirs — переопределение списка пропускаемых каталогов
 */
export function walkFiles(
  root: string,
  limit: number,
  opts: { skipDirs?: Set<string> } = {},
): string[] {
  const skipDirs = opts.skipDirs ?? SKIP_DIRS;
  const out: string[] = [];
  const stack = [''];
  while (stack.length > 0 && out.length < limit) {
    const relDir = stack.pop() as string;
    const absDir = relDir === '' ? root : join(root, relDir);
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue; // недоступная директория не должна ронять обход
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  }
  return out.sort();
}

/** Максимальный размер файла для поиска: крупнее — пропускаем молча (AC4). */
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024;

/** Лимит совпадений по умолчанию (пометка об усечении добавляется в выдачу). */
export const SEARCH_DEFAULT_LIMIT = 100;

/** Максимум строк контекста до/после совпадения (защита от раздувания вывода). */
export const SEARCH_MAX_CONTEXT = 5;

/** Предохранитель обхода: больше 10k файлов разбирать бессмысленно. */
const WALK_LIMIT = 10_000;

/** Сколько первых байт проверять на NUL при детекте бинарника. */
const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Бинарный ли файл: NUL-байт в первых 8 КБ. Такой файл пропускаем молча —
 * чтение бинарника в utf8 дало бы мусор в выдаче модели.
 */
export function isBinaryContent(buf: Uint8Array): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Собирает регулярку поиска из паттерна.
 *
 * По умолчанию `regex: false` — паттерн трактуется как literal-подстрока
 * (безопаснее: `foo.bar` не матчит `fooXbar`, а `(` не роняет поиск).
 * `regex: true` включает JS-регекс; невалидный — текст модели, не исключение.
 *
 * @returns RegExp либо `{ error }` с текстом для модели
 */
export function buildSearchRegex(
  pattern: string,
  opts: { regex?: boolean; caseSensitive?: boolean } = {},
): RegExp | { error: string } {
  const flags = opts.caseSensitive === false ? 'i' : '';
  if (opts.regex) {
    try {
      return new RegExp(pattern, flags);
    } catch (err) {
      return { error: `Невалидный regex в pattern: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  // Literal: экранируем все regex-метасимволы.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, flags);
}

/** Одна строка выдачи: совпадение (`isMatch`) или строка контекста. */
export interface SearchHit {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

/**
 * Бюджет одной строки-совпадения в выдаче (VL-354).
 *
 * Инцидент `agent-1794052713009`: `grep_search` собирал совпадения в
 * алфавитном порядке (`walkFiles` → `out.sort()`), поэтому `CHANGELOG.md` и
 * `backlog/docs/*` шли раньше `src/`. Одна запись CHANGELOG — это строка
 * длиной ~4 КБ, а `truncateToolOutput` режет вывод по СИМВОЛАМ (8 КБ). Итог:
 * первые 8 КБ выдачи занимали две-три строки документации, а файл
 * `src/agent/loop.ts`, ради которого шёл поиск, в вывод не попадал вообще —
 * модель повторяла тот же запрос и упиралась в loop detection.
 *
 * 300 символов при бюджете 8 КБ даёт ~25 совпадений в выдаче вместо 2–3.
 */
export const MATCH_LINE_MAX_CHARS = 300;

/** Сколько символов контекста оставить перед совпадением при сдвиге окна. */
const MATCH_LINE_LEAD_CHARS = 100;

/**
 * Усекает одну строку-совпадение до `MATCH_LINE_MAX_CHARS` (VL-354).
 *
 * Маркер содержит готовый `path` для `read_file` — модель не гадает, откуда
 * взять полный текст. Если совпадение оказалось за пределами окна (паттерн
 * встретился в позиции 5000 длинной строки), окно сдвигается так, чтобы
 * совпадение было видно: иначе модель получила бы «совпадение есть», но не
 * поняла бы контекст.
 *
 * @param text — исходная строка файла
 * @param pathLabel — путь для маркера (относительно корня проекта)
 * @param lineNo — 1-based номер строки для маркера
 * @param matchIndex — позиция совпадения в строке (-1 — неизвестна/контекст)
 */
export function truncateMatchLine(
  text: string,
  pathLabel: string,
  lineNo: number,
  matchIndex = -1,
): string {
  if (text.length <= MATCH_LINE_MAX_CHARS) return text;
  const marker = `…[строка усечена: ${text.length} символов, читай read_file "${pathLabel}:${lineNo}"]`;
  const head = MATCH_LINE_MAX_CHARS - MATCH_LINE_LEAD_CHARS;
  if (matchIndex > head) {
    const from = Math.max(0, matchIndex - MATCH_LINE_LEAD_CHARS);
    return `…${text.slice(from, from + MATCH_LINE_MAX_CHARS)}${marker}`;
  }
  return `${text.slice(0, MATCH_LINE_MAX_CHARS)}${marker}`;
}

/**
 * Префиксы путей, которые в выдаче поиска идут раньше остальных (VL-354).
 *
 * Эвристика: для поиска СИМВОЛОВ код важнее документации. `walkFiles`
 * сортирует по алфавиту, и `CHANGELOG.md`/`backlog/` оказываются впереди
 * `src/` — при усечении вывода по бюджету код выпадает. Список вынесен в
 * константу: структура проекта может измениться, правится в одном месте.
 */
export const PRIORITY_PREFIXES = ['src/', 'templates/', 'scripts/', 'web/src/'];

/**
 * Индекс приоритета пути: меньше — раньше в выдаче.
 *
 * Префикс ищется на границе сегмента (`/src/`), а не только в начале строки:
 * при поиске с явным `path` пути в выдаче получают его префикс
 * (`backlog/docs/src/...`), и проверка `startsWith` не сработала бы
 * (на этом упал первый вариант VL-354-теста).
 */
export function pathPriority(rel: string): number {
  const padded = `/${rel}`;
  const idx = PRIORITY_PREFIXES.findIndex((p) => padded.includes(`/${p}`));
  return idx === -1 ? PRIORITY_PREFIXES.length : idx;
}

/**
 * Переупорядочивает файлы поиска: код (`src/`, `templates/`, `scripts/`,
 * `web/src/`) → остальное по алфавиту (VL-354). Мутирует и возвращает
 * переданный массив — вызывающий код и так владеет им единолично.
 */
export function sortFilesByPriority<T extends { relOut: string }>(files: T[]): T[] {
  return files.sort(
    (a, b) => pathPriority(a.relOut) - pathPriority(b.relOut) || a.relOut.localeCompare(b.relOut),
  );
}

/**
 * Обрезает собранную выдачу поиска и, если что-то потерялось, дописывает
 * маркер потерь (VL-354).
 *
 * `truncateToolOutput` сообщает только «показаны первые N из M символов» —
 * модель не понимает, ЧТО выпало, и повторяет тот же запрос. Здесь
 * добавляется счётчик показанных элементов и подсказка сузить запрос.
 *
 * @param joined — уже собранный текст выдачи (с лимитным суффиксом)
 * @param total — сколько элементов (совпадений) собрано всего
 * @param unit — слово для маркера («совпадений»)
 * @param countShown — как посчитать показанные элементы в обрезанном тексте
 */
export function truncateWithLossMarker(
  joined: string,
  total: number,
  unit: string,
  countShown: (out: string) => number,
): string {
  const out = truncateToolOutput(joined);
  if (out.length >= joined.length) return out;
  const shown = countShown(out);
  return `${out}\n…[показано ${shown} из ${total} ${unit}; сузь path или glob]`;
}

/** Считает строки формата `file:line: …` — совпадения в выдаче grep_search. */
export function countGrepMatchLines(out: string): number {
  return out.split('\n').filter((line) => /^.+:\d+:/.test(line)).length;
}

/** Считает строки-совпадения в выдаче search_files (`  N: текст`). */
export function countSearchMatchLines(out: string): number {
  return out.split('\n').filter((line) => /^\s+\d+:/.test(line)).length;
}

/**
 * Форматирует выдачу в стиле `grep -n`/`-C`: заголовок файла, затем строки
 * `  N: текст` (совпадение) и `  N- текст` (контекст). Результаты
 * сгруппированы по файлу, между файлами — пустая строка.
 */
export function formatSearchResults(hits: SearchHit[]): string {
  const parts: string[] = [];
  let current = '';
  for (const hit of hits) {
    if (hit.file !== current) {
      if (parts.length > 0) parts.push('');
      parts.push(hit.file);
      current = hit.file;
    }
    const sep = hit.isMatch ? ':' : '-';
    parts.push(`  ${hit.line}${sep} ${hit.text}`);
  }
  return parts.join('\n');
}

/** Аргументы поиска (после валидации на границе handler'а). */
interface SearchOptions {
  pattern: string;
  glob: string | null;
  path: string;
  context: number;
  limit: number;
  regex: boolean;
  caseSensitive: boolean;
}

/**
 * Приводит аргументы инструмента к типизированным опциям. Числовые поля
 * зажимаются в допустимые диапазоны, строки с неверным типом игнорируются
 * (модель часто присылает `"5"` вместо `5`).
 */
function normalizeOptions(args: Record<string, unknown>): SearchOptions {
  const num = (key: string, def: number): number => {
    const raw = args[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
    return def;
  };
  const str = (key: string): string | null => {
    const v = args[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  return {
    pattern: typeof args.pattern === 'string' ? args.pattern : '',
    glob: str('glob'),
    path: str('path') ?? '.',
    context: Math.max(0, Math.min(SEARCH_MAX_CONTEXT, num('context', 0))),
    limit: Math.max(1, num('limit', SEARCH_DEFAULT_LIMIT)),
    regex: args.regex === true,
    caseSensitive: args.caseSensitive !== false,
  };
}

/**
 * Основная точка поиска (общая для агента и веб-чата): резолв границ
 * проекта, обход дерева, фильтр glob, пропуск бинарников и файлов > 1 МБ,
 * сбор совпадений до лимита, группировка по файлу и кап вывода
 * (`truncateToolOutput` — единая точка, lesson-30).
 *
 * Ошибки возвращаются текстом модели (как у остальных файловых инструментов),
 * не исключениями.
 *
 * @param cwd — корень проекта (граница доступа)
 * @param args — сырые аргументы инструмента
 */
export async function searchProjectFiles(
  cwd: string,
  args: Record<string, unknown>,
): Promise<string> {
  const opts = normalizeOptions(args);
  if (opts.pattern === '') return 'Паттерн не задан: передайте pattern';
  const regex = buildSearchRegex(opts.pattern, { regex: opts.regex, caseSensitive: opts.caseSensitive });
  if ('error' in regex) return regex.error;

  const start = resolveInProject(cwd, opts.path, { allowRoot: true });
  if (!start.ok) return start.error;

  let files: { relRoot: string; relOut: string; abs: string }[];
  let startIsFile = false;
  try {
    startIsFile = !statSync(start.path).isDirectory();
  } catch {
    // VL-257: отсутствующий path — листинг ближайшего существующего каталога
    // и похожие пути вместо голого «Не удалось прочитать путь: ENOENT…».
    const hint = formatMissingPathHint(cwd, opts.path);
    return truncateToolOutput(
      hint === null ? `Путь не найден: ${opts.path}` : `Путь не найден: ${opts.path}\n\n${hint}`,
    );
  }
  if (startIsFile) {
    files = [
      {
        relRoot: '.',
        relOut: relative(cwd, start.path).split(sep).join('/'),
        abs: start.path,
      },
    ];
  } else {
    const relStart = relative(cwd, start.path).split(sep).join('/');
    files = sortFilesByPriority(
      walkFiles(start.path, WALK_LIMIT).map((rel) => ({
        // glob матчится по пути ОТНОСИТЕЛЬНО корня поиска (как его пишет
        // пользователь), а выдача — относительно корня проекта.
        relRoot: rel,
        relOut: relStart === '' ? rel : `${relStart}/${rel}`,
        abs: join(start.path, rel),
      })),
    );
  }

  const globRegex = opts.glob ? miniGlobToRegex(opts.glob) : null;
  const hits: SearchHit[] = [];
  let matchCount = 0;
  let truncated = false;

  outer: for (const file of files) {
    if (globRegex && !globRegex.test(file.relRoot)) continue;
    let size: number;
    try {
      size = statSync(file.abs).size;
    } catch {
      continue; // исчезнувший файл — не ошибка поиска
    }
    if (size > SEARCH_MAX_FILE_BYTES) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(file.abs);
    } catch {
      continue; // недоступный/битый файл пропускаем молча
    }
    if (isBinaryContent(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    const matched: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matched.push(i);
        matchCount++;
        if (matchCount >= opts.limit) {
          truncated = true;
          break;
        }
      }
    }
    if (matched.length === 0) continue;
    // Окна контекста объединяем, чтобы соседние совпадения не дублировали
    // строки в выдаче (поведение grep -C).
    const marks = new Map<number, boolean>();
    for (const idx of matched) {
      const from = Math.max(0, idx - opts.context);
      const to = Math.min(lines.length - 1, idx + opts.context);
      for (let j = from; j <= to; j++) {
        marks.set(j, marks.get(j) === true || j === idx);
      }
    }
    for (const [idx, isMatch] of [...marks.entries()].sort((a, b) => a[0] - b[0])) {
      // VL-354: каждая строка выдачи усекается отдельно — одна гигантская
      // строка (запись CHANGELOG, абзац doc-*) не должна съедать бюджет 8 КБ.
      const raw = lines[idx];
      const matchIndex = isMatch ? raw.search(regex) : -1;
      hits.push({
        file: file.relOut,
        line: idx + 1,
        text: truncateMatchLine(raw, file.relOut, idx + 1, matchIndex),
        isMatch,
      });
    }
    if (truncated) break outer;
  }

  if (matchCount === 0) return 'Совпадений не найдено';
  const body = formatSearchResults(hits);
  const suffix = truncated ? `\n…[достигнут лимит ${opts.limit} совпадений; сузь pattern/glob]` : '';
  // VL-354: маркер потерь — сколько совпадений реально попало в вывод.
  return truncateWithLossMarker(body + suffix, matchCount, 'совпадений', countSearchMatchLines);
}
