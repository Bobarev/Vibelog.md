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
    files = walkFiles(start.path, WALK_LIMIT).map((rel) => ({
      // glob матчится по пути ОТНОСИТЕЛЬНО корня поиска (как его пишет
      // пользователь), а выдача — относительно корня проекта.
      relRoot: rel,
      relOut: relStart === '' ? rel : `${relStart}/${rel}`,
      abs: join(start.path, rel),
    }));
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
      hits.push({ file: file.relOut, line: idx + 1, text: lines[idx], isMatch });
    }
    if (truncated) break outer;
  }

  if (matchCount === 0) return 'Совпадений не найдено';
  const body = formatSearchResults(hits);
  const suffix = truncated ? `\n…[достигнут лимит ${opts.limit} совпадений; сузь pattern/glob]` : '';
  return truncateToolOutput(body + suffix);
}
