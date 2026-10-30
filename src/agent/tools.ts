/**
 * Локальные инструменты агента (VL-83, компонент 2 эпика VL-75).
 *
 * Шесть инструментов для tool calling: read_file, write_file, edit,
 * run_shell_command, grep_search, glob. Без внешних зависимостей: валидация —
 * plain TS; shell — только execFile('/bin/bash', ['-lc', command]) без
 * shell:true на уровне Node; пути резолвятся от cwd и отклоняются, если
 * вышли за пределы проекта — как аргументы-пути, так и строки shell-команд
 * (checkShellCommandInProject, VL-99). Ошибки — текстом модели (не
 * исключениями): loop дописывает их в messages и продолжает.
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Опции выполнения handler'а инструмента (прокидка отмены из loop). */
export interface ToolHandlerContext {
  signal?: AbortSignal;
}

/** Описание одного инструмента: JSON-схема + handler. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx?: ToolHandlerContext) => Promise<string>;
}

/** Результат валидации аргументов: null — ок, иначе текст для модели. */
export type ValidateResult = string | null;

/**
 * Лимит tool-вывода для модели (VL-110): 8KB. Необрезанные выводы (25–34KB
 * git ls-files, большие grep, длинные файлы) заливали контекст каждой
 * итерации loop — ходы замедлялись до 5–15 минут, модель деградировала
 * (инцидент VL-98: пустой финальный ответ на раздутом контексте).
 * Per-stream обрезка run_shell_command (64KB на поток) остаётся — это
 * финальный, более жёсткий лимит уже собранного вывода перед моделью.
 */
export const TOOL_OUTPUT_MAX_CHARS = 8 * 1024;

/**
 * Маскирует значения секретов в shell-выводе (VL-115): строки NAME=value,
 * где NAME содержит API_KEY/TOKEN/SECRET/PASSWORD (без учёта регистра),
 * заменяются на NAME=***. Инцидент VL-113: «env | grep» вывел реальный
 * VIBELOG_LLM_API_KEY в транскрипт сессии — ключ оседал в jsonl на диске
 * и уходил в контекст модели при resume. Применяется только к выводу
 * run_shell_command: файловые инструменты (read_file/grep/glob) не
 * маскируются, чтобы не искажать чтение кода и документации.
 */
export function maskSecrets(text: string): string {
  return text.replace(
    /^([A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)=(\S.*)$/gim,
    (_line, name: string) => `${name}=***`
  );
}

/**
 * Обрезает tool-вывод до TOOL_OUTPUT_MAX_CHARS с пометкой для модели.
 * Короткий вывод возвращается без изменений (регрессия VL-83-тестов).
 */
export function truncateToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_MAX_CHARS) return text;
  return (
    text.slice(0, TOOL_OUTPUT_MAX_CHARS) +
    `\n…[вывод обрезан: показаны первые ${TOOL_OUTPUT_MAX_CHARS} из ${text.length} символов; чтобы получить остальное, сузь запрос — файл, диапазон строк или паттерн]`
  );
}

/**
 * Валидация аргументов по JSON-схеме (top-level): обязательные поля и типы
 * string/number/boolean/array/object. Нарушение — строка модели вида
 * «Невалидные аргументы инструмента X: …», не исключение.
 */
export function validateArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
  toolName: string,
): ValidateResult {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  for (const key of required) {
    if (typeof key !== 'string') continue;
    if (args[key] === undefined || args[key] === null) {
      return `Невалидные аргументы инструмента ${toolName}: отсутствует обязательное поле "${key}"`;
    }
  }
  for (const [key, prop] of Object.entries(properties)) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    const type = prop.type;
    if (typeof type !== 'string') continue;
    const ok =
      type === 'array'
        ? Array.isArray(value)
        : type === 'object'
          ? typeof value === 'object' && !Array.isArray(value)
          : typeof value === type;
    if (!ok) {
      return `Невалидные аргументы инструмента ${toolName}: поле "${key}" должно иметь тип ${type}`;
    }
  }
  return null;
}

/**
 * Резолвит путь относительно cwd проекта и отказывается от выхода за его
 * пределы (защита от ../ и абсолютных путей наружу). Для file-операций
 * путь не может быть самим cwd (это директория).
 */
export function resolveInProject(
  cwd: string,
  rawPath: string,
  opts: { allowRoot?: boolean } = {},
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof rawPath !== 'string' || rawPath === '') {
    return { ok: false, error: 'Путь не задан' };
  }
  const abs = resolve(cwd, rawPath);
  const rel = relative(cwd, abs);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (outside) {
    return { ok: false, error: `Путь выходит за пределы проекта: ${rawPath}` };
  }
  if (!opts.allowRoot && (rel === '' || rel === '.')) {
    return { ok: false, error: `Путь должен указывать на файл внутри проекта: ${rawPath}` };
  }
  return { ok: true, path: abs };
}

/**
 * Лимит записей в листинге каталога (VL-233): защита от раздувания вывода —
 * каталог вида node_modules содержит десятки тысяч записей, они залили бы
 * контекст модели (тот же класс проблемы, что TOOL_OUTPUT_MAX_CHARS, VL-110).
 */
export const DIR_LISTING_MAX = 200;

/**
 * Служебные каталоги (VL-233): в листинге родителя видны как записи с `/`,
 * но сами не разворачиваются — внутри них агент не ориентируется по именам
 * файлов, а вывод огромен (node_modules/dist) либо запрещён к разбору (.git).
 * Это НЕ SKIP_DIRS из walkFiles: поведение glob/grep_search не меняем.
 */
const SERVICE_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Листинг каталога для read_file (VL-233): отсортированные записи одного
 * уровня, каталоги — с суффиксом `/`. Заменяет прежнюю ошибку «Это
 * директория, не файл»: агент без glob/списка не мог узнать структуру
 * проекта и угадывал пути (инцидент обсуждения VL-232 — 6+ холостых
 * read_file по несуществующим путям).
 *
 * Границы: путь уже проверен resolveInProject; дополнительно realpath
 * отсекает симлинк наружу проекта (сравнение с realpath самого cwd —
 * на macOS /tmp → /private/tmp, иначе любой тест в mkdtemp ложно отклонялся).
 * Пути внутри служебных каталогов отклоняются до readdirSync.
 *
 * @param cwd — корень проекта (границы доступа)
 * @param absDir — абсолютный путь каталога (уже внутри cwd)
 */
export function formatDirListing(
  cwd: string,
  absDir: string,
): { ok: true; text: string } | { ok: false; error: string } {
  const relDir = relative(cwd, absDir).split(sep).join('/');
  // Служебные каталоги не разворачиваем: путь или любой его сегмент.
  const segments = relDir.split('/');
  for (const segment of segments) {
    if (SERVICE_DIRS.has(segment)) {
      return {
        ok: false,
        error: `Служебный каталог (${segment}) не разворачивается: ${absDir}`,
      };
    }
  }
  // Симлинк наружу проекта: чтение файла такое поведение сохраняет (AC4),
  // а листинг — расширяет видимость структуры, поэтому границу проверяем.
  let real: string;
  try {
    real = realpathSync(absDir);
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось прочитать каталог: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let cwdReal: string;
  try {
    cwdReal = realpathSync(cwd);
  } catch {
    cwdReal = cwd;
  }
  const relReal = relative(cwdReal, real);
  if (relReal === '..' || relReal.startsWith(`..${sep}`) || isAbsolute(relReal)) {
    return {
      ok: false,
      error: `Путь выходит за пределы проекта (симлинк): ${absDir}`,
    };
  }
  let dirents;
  try {
    dirents = readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось прочитать каталог: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const label = relDir === '' ? './' : `${relDir}/`;
  if (dirents.length === 0) return { ok: true, text: `Каталог пуст: ${label}` };
  // Сортировка: каталоги первыми, внутри группы — по имени. localeCompare с
  // 'en' — детерминизм независимо от локали машины (тесты не зависят от LANG).
  const dirs: string[] = [];
  const files: string[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) dirs.push(`${entry.name}/`);
    else files.push(entry.name);
  }
  dirs.sort((a, b) => a.localeCompare(b, 'en'));
  files.sort((a, b) => a.localeCompare(b, 'en'));
  const all = [...dirs, ...files];
  const shown = all.slice(0, DIR_LISTING_MAX);
  const header = `Листинг каталога ${label} (${all.length} записей, показано ${shown.length})`;
  const suffix =
    all.length > shown.length
      ? `\n…[листинг усечён: показано ${shown.length} из ${all.length} записей; сузь путь]`
      : '';
  return { ok: true, text: header + '\n' + shown.join('\n') + suffix };
}

/** Читает файл как utf-8 текстом модели (ошибки — текстом, не исключением). */
function readTextFile(abs: string): { ok: true; content: string } | { ok: false; error: string } {
  try {
    if (!existsSync(abs)) return { ok: false, error: `Файл не найден: ${abs}` };
    return { ok: true, content: readFileSync(abs, 'utf8') };
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Инструмент read_file: строки файла (offset 0-based, limit сверху) либо
 * листинг каталога (VL-233). Путь резолвится с allowRoot — `path: '.']`
 * даёт листинг корня проекта, а не отказ «Путь должен указывать на файл».
 */
function makeReadFile(cwd: string): ToolSpec {
  return {
    name: 'read_file',
    description:
      'Читает текстовый файл проекта (offset — 0-based номер строки начала, limit — максимум строк). ' +
      'Если path — каталог, возвращает отсортированный листинг (каталоги с "/", лимит 200 записей; ' +
      'offset/limit игнорируются; node_modules/.git/dist не разворачиваются).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу или каталогу относительно корня проекта' },
        offset: { type: 'number', description: '0-based номер строки начала' },
        limit: { type: 'number', description: 'Максимум возвращаемых строк' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const rawPath = args.path;
      if (typeof rawPath !== 'string' || rawPath === '') return 'Путь не задан';
      const target = resolveInProject(cwd, rawPath, { allowRoot: true });
      if (!target.ok) return target.error;
      if (existsSync(target.path) && statSync(target.path).isDirectory()) {
        const listing = formatDirListing(cwd, target.path);
        return listing.ok ? truncateToolOutput(listing.text) : listing.error;
      }
      const read = readTextFile(target.path);
      if (!read.ok) return read.error;
      const lines = read.content.split('\n');
      const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : lines.length;
      const slice = lines.slice(offset, offset + limit);
      return truncateToolOutput(slice.join('\n'));
    },
  };
}

/** Инструмент write_file: mkdir -p родительской директории + запись utf-8. */
function makeWriteFile(cwd: string): ToolSpec {
  return {
    name: 'write_file',
    description: 'Создаёт или перезаписывает файл внутри проекта (родительские директории создаются).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
        content: { type: 'string', description: 'Содержимое файла' },
      },
      required: ['path', 'content'],
    },
    handler: async (args) => {
      const target = resolveInProject(cwd, args.path as string);
      if (!target.ok) return target.error;
      try {
        mkdirSync(dirname(target.path), { recursive: true });
        writeFileSync(target.path, args.content as string, 'utf8');
        return `Файл записан: ${relative(cwd, target.path)} (${Buffer.byteLength(args.content as string, 'utf8')} байт)`;
      } catch (err) {
        return `Не удалось записать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * Инструмент edit: строгая замена строк. Без replace_all old_string обязан
 * найтись ровно один раз — иначе отказ (защита от двусмысленных правок,
 * как в инструментах qwen-code).
 */
function makeEdit(cwd: string): ToolSpec {
  return {
    name: 'edit',
    description:
      'Заменяет old_string на new_string в файле. Без replace_all строка должна встречаться ровно один раз.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
        old_string: { type: 'string', description: 'Точный текст для поиска' },
        new_string: { type: 'string', description: 'Текст замены' },
        replace_all: { type: 'boolean', description: 'Заменить все вхождения' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    handler: async (args) => {
      const target = resolveInProject(cwd, args.path as string);
      if (!target.ok) return target.error;
      const read = readTextFile(target.path);
      if (!read.ok) return read.error;
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const replaceAll = args.replace_all === true;
      // split/join вместо replace(): replace со строкой трактует $-символы.
      const count = read.content.split(oldStr).length - 1;
      if (count === 0) return `Строка old_string не найдена в файле: ${target.path}`;
      if (!replaceAll && count > 1) {
        return `Строка old_string найдена ${count} раз(а) в файле ${target.path}: уточни текст или используй replace_all`;
      }
      try {
        writeFileSync(target.path, read.content.split(oldStr).join(newStr), 'utf8');
        return `Выполнено замен: ${replaceAll ? count : 1} (${relative(cwd, target.path)})`;
      } catch (err) {
        return `Не удалось записать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * POSIX-специальные файлы (VL-104): штатные цели редиректов (2>/dev/null)
 * и служебные устройства — не пути к данным пользователя. Без allow-list
 * ложные отказы губили tool-call целиком (сессия vb:agent-1791289270341:
 * 3 отказа команд с 2>/dev/null за фазу).
 */
const SPECIAL_FILES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/stdin']);

/**
 * Команды-фильтры (VL-201): первый не-флаг-аргумент которых — паттерн
 * (поиск/скрипт), а не путь. Слэш-паттерны `/auto`, `/web start` — штатный
 * объект поиска в документации, они не читают файлы и пропускаются целиком.
 */
const FILTER_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk']);

/**
 * Три класса флагов-фильтров со СПРАВОЧНЫМ значением (VL-201).
 *
 * Граница «паттерн ↔ файловый аргумент» у grep/rg/sed смещается только этими
 * флагами: пропуск флага из таблицы даёт ложный отказ (fail-safe), ложное
 * включение boolean-флага может сместить границу и пропустить файловый
 * аргумент (дыра). Поэтому в таблицы включены только флаги с гарантированной
 * семантикой GNU grep/rg и POSIX sed.
 */
// Значение — сам паттерн (grep/rg/sed: -e, --regexp): следующий токен не путь.
const PATTERN_VALUE_FLAGS = new Set(['-e', '--regexp']);
// Значение — файл паттернов (-f, --file): путь проверяется, паттерн считается заданным.
const PATH_VALUE_FLAGS = new Set(['-f', '--file']);
// Значение — число/действие (-m 2, -A 3, -d ACTION): проверяется как обычный
// токен, но НЕ считается паттерном — иначе `grep -m 2 "/auto" f` сместит
// границу и "/auto" ложно отклонится как файл вне проекта.
const CONTEXT_VALUE_FLAGS = new Set([
  '-m',
  '-A',
  '-B',
  '-C',
  '-d',
  '-D',
  '--max-count',
  '--after-context',
  '--before-context',
  '--context',
]);

/**
 * Токен похож на regex/глоб-паттерн grep/sed, а не на путь (VL-104).
 *
 * Метасимволы в двух видах: экранированные (\|, \(, \[) — штатный
 * grep-паттерн вида "/set\|max-wall-time"; голые (*?+{}[]^$|) — глоб
 * и regex-паттерны. Токен без метасимволов не матчится — регрессии нет.
 * Лексическая эвристика: путь с метасимволами в имени не проверяется —
 * остаточный риск сопоставим с лексической проверкой VL-99.
 * VL-179: на вход подаётся путь после снятия экранирования скобок —
 * `\(main\)` перестаёт выглядеть как regex-экранирование и проверяется
 * как путь, а `\|`/`\.` в паттернах сохраняются и по-прежнему пропускаются.
 */
function isRegexPatternToken(token: string): boolean {
  // Экранированные метасимволы regex: \|, \(, \[ и т.п.
  if (/\\[()[\]{}|*+?^$]/.test(token)) return true;
  // Голые метасимволы: глоб (*, ?, +, {}, []), анкеры (^, $, |)
  return /[*?+{}[\]^$|]/.test(token);
}

/**
 * Лексическая проверка shell-команды на обращения за пределы проекта (VL-99).
 *
 * Правило «работай только внутри cwd» в system-prompt — инструкция для модели,
 * а не ограничение исполнения: bash -lc исполнил бы команду как есть. Поэтому
 * пути наружу ловятся здесь, до execFile — источник запросов macOS TCC-доступа
 * (Фото/Календарь/рабочий стол): «ls ~» и «find ~» вели агента в ~/Desktop,
 * ~/Pictures, ~/Library/Calendar. Проверки: токен ~ в позиции пути, $HOME и
 * ${HOME}, абсолютные пути вне cwd, относительные с сегментом .., резолвящиеся
 * наружу. Спецфайлы /dev/* и regex-паттерны grep/sed пропускаются (VL-104).
 * наружу. Лексика не закрывает динамическое построение путей (командные
 * подстановки, base64) — остаточный риск, минимизируется правилом промпта.
 * VL-179: токенизатор учитывает shell-экранирование — `\(`, `\)`, `\'`,
 * `\"` не разбивают токен, route-группы `src/app/\(main\)/...` проверяются
 * как единый относительный путь; фрагменты после разбиения на разделителе
 * не возникают и не считаются абсолютными путями.
 * VL-201: позиционный (контекстный) анализ — токен в позиции аргумента-паттерна
 * команды-фильтра (grep/rg/sed/awk: первый не-флаг-аргумент либо значение
 * -e/--regexp) не является путём по семантике утилиты и пропускается целиком —
 * слэш-паттерны `/auto`, `/web start` без regex-метасимволов больше не
 * отклоняются как абсолютные пути. Токенизатор ловит разделители `;|&()<>`,
 * чтобы команда после `|`/`&&`/`;` распознавалась как новая. Инвариант VL-99
 * сохранён: ~, $HOME (обе верхнеуровневые проверки — ДО токенизации, поэтому
 * `cat ~/x` отклоняется и в позиции паттерна), `..` наружу и реальные
 * абсолютные пути — по-прежнему (в т.ч. файловые аргументы после паттерна:
 * `grep x /etc/passwd`).
 */
export function checkShellCommandInProject(command: string, cwd: string): ValidateResult {
  // Отказ с одинаковым текстом для всех срабатываний проверок.
  const reject = (what: string): string =>
    `Команда отклонена: обращение к путям вне проекта (${what}). Разрешены только пути внутри ${cwd}`;
  // ~ или ~user в позиции пути: начало/конец строки или после разделителя shell
  // (`;|&=(`, пробел), затем / или конец токена — ловит и «ls ~», и «ls ~/Desktop».
  if (/(^|[\s;|&=(])~($|[/\s;|&)])/.test(command)) {
    return reject('~');
  }
  // $HOME / ${HOME} — любое вхождение: переменная вне проекта по определению.
  if (/\$\{?HOME\}?/.test(command)) {
    return reject('$HOME');
  }
  // Токенизация по разделителям shell; кавычки снимаются — путь внутри кавычек
  // так же опасен, как и без них. VL-179: shell-экранирование учитывается —
  // `\(`, `\)`, `\'`, `\"` и т.п. не разбивают токен на разделителе, иначе
  // route-группа `src/app/\(main\)/dashboard/` превращалась в фрагмент
  // `/dashboard/...`, который ложно считался абсолютным путём вне проекта.
  // VL-201: разделители `;|&()<>` — отдельные токены, чтобы команда после
  // `|`/`&&`/`;`/`(` распознавалась как новая (грань нужна позиционному
  // анализу паттерна). Кавычечные альтернативы стоят первыми — `|` внутри
  // кавычек и `\|` внутри escape-ветки токен не разбивают.
  const tokens =
    command.match(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\\[^\s]|[^\s;|&()<>])+|[;|&()<>]/g,
    ) ?? [];
  // VL-201: состояние позиционного анализа — живёт в пределах одного сегмента
  // команды (между разделителями).
  let commandName: string | null = null; // командное слово текущего сегмента
  let startOfSegment = false; // текущий токен — первое слово сегмента (команда)
  let patternSupplied = false; // паттерн команды уже занят
  // Ожидаемое значение справа от value-флага: pattern (пропустить как паттерн),
  // path (проверить как путь + паттерн задан), value (проверить, но не паттерн).
  let expect: 'none' | 'pattern' | 'path' | 'value' = 'none';
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '');
    // VL-179: снимаем экранирование ТОЛЬКО скобок — src/app/\(main\)/...
    // проверяется как src/app/(main)/... . Полный shell-unescape намеренно
    // НЕ делаем: \.\. в regex-паттерне не должен превращаться в сегмент
    // '..' (ложный reject).
    const path = token.replace(/\\([()])/g, '$1');
    // VL-201: разделитель — конец сегмента: следующий токен новая команда
    // (в `git log | grep "/auto"` паттерн относится к grep, а не к git).
    if (/^[;|&()<>]$/.test(token)) {
      commandName = null;
      startOfSegment = false;
      patternSupplied = false;
      expect = 'none';
      continue;
    }
    // Первое слово сегмента — команда; её саму проверяем как обычный путь ниже
    // (командное слово от путевых проверок не освобождается: /usr/bin/foo — отказ).
    if (commandName === null) {
      commandName = token;
      startOfSegment = true;
      patternSupplied = false;
      expect = 'none';
    } else {
      startOfSegment = false;
    }
    // VL-201: позиция аргумента-паттерна — не путь по семантике утилиты,
    // пропускается целиком (слэш-паттерн `/auto` файлы не читает). Проверка ДО
    // ветки `~`: `grep "~" docs` — паттерн, а не обращение к дому.
    const isPatternPosition =
      expect === 'pattern' ||
      (!startOfSegment &&
        expect === 'none' &&
        FILTER_COMMANDS.has(commandName) &&
        !patternSupplied &&
        !token.startsWith('-'));
    if (isPatternPosition) {
      patternSupplied = true;
      expect = 'none';
      continue;
    }
    // Значение -f/--file: токЕН сам — путь (проверяется ниже), а паттерн уже
    // задан файлом — следующий не-флаг-аргумент уже файловый.
    if (expect === 'path') {
      expect = 'none';
      patternSupplied = true;
    } else if (expect === 'value') {
      // Число/действие (-m 2, -A 3): проверяется как обычный токен, но граница
      // паттерна не смещается — `grep -m 2 "/auto" f` → "/auto" остаётся паттерном.
      expect = 'none';
    }
    // Тилда после снятия кавычек — та же домашняя директория (~, ~/...).
    if (token === '~' || token.startsWith('~/')) return reject('~');
    // Флаги: переменные и подстановки путями не считаем — резолвить нечего;
    // флаги команд-фильтров двигают контекст позиционного анализа (VL-201).
    if (token.startsWith('-')) {
      if (FILTER_COMMANDS.has(commandName)) {
        if (PATTERN_VALUE_FLAGS.has(token)) {
          expect = 'pattern';
        } else if (PATH_VALUE_FLAGS.has(token)) {
          expect = 'path';
        } else if (CONTEXT_VALUE_FLAGS.has(token)) {
          expect = 'value';
        } else if (/^--(?:regexp|file)=/.test(token) || /^-[ef].+/.test(token)) {
          // Attached/equals-формы (-eX, --regexp=X): паттерн уже задан.
          // Значение внутри `=` не валидируется — как и любой `-`-токен (VL-99),
          // остаточный риск, не регрессия.
          patternSupplied = true;
        }
      }
      continue;
    }
    if (token.startsWith('$') || token.includes('`')) continue;
    // Спецфайлы POSIX (VL-104): /dev/null и др. — не пути к данным пользователя.
    if (SPECIAL_FILES.has(token)) continue;
    // Regex-паттерны grep/sed (VL-104): токен с метасимволами — паттерн,
    // а не путь ("/set\|max-wall-time" начинается с /, но путём не является).
    // VL-179: проверяем path после снятия экранирования скобок — иначе
    // src/app/\(main\)/../.. содержал бы `\(` и пропустил бы проверку `..`.
    if (isRegexPatternToken(path)) continue;
    // Абсолютный путь должен резолвиться внутрь проекта.
    if (isAbsolute(path)) {
      const rel = relative(cwd, path);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return reject(path);
      }
      continue;
    }
    // Относительный с ..: резолвим от cwd — src/../ok внутри, ../.. наружу.
    if (path.split('/').includes('..')) {
      const abs = resolve(cwd, path);
      const rel = relative(cwd, abs);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return reject(path);
      }
    }
  }
  return null;
}

/**
 * Инструмент run_shell_command: bash -lc с аргументами массивом (без
 * shell:true — интерполирует только bash, Node не парсит команду второй
 * раз). Таймаут по умолчанию 120с с SIGKILL; abort-сигнал тоже убивает
 * процесс. Обрезка вывода до 64КБ на поток.
 */
function makeRunShellCommand(cwd: string): ToolSpec {
  return {
    name: 'run_shell_command',
    description:
      'Выполняет shell-команду через /bin/bash -lc. Аргументы — массив (без shell:true). Таймаут по умолчанию 120 секунд.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Команда для bash -lc' },
        cwd: { type: 'string', description: 'Рабочая директория внутри проекта' },
        timeout_ms: { type: 'number', description: 'Таймаут в миллисекундах (дефолт 120000)' },
      },
      required: ['command'],
    },
    handler: (args, ctx) =>
      new Promise<string>((resolvePromise) => {
        const command = args.command as string;
        const TIMEOUT_DEFAULT = 120_000;
        const timeout =
          typeof args.timeout_ms === 'number' && args.timeout_ms > 0
            ? Math.floor(args.timeout_ms)
            : TIMEOUT_DEFAULT;
        let workDir = cwd;
        if (args.cwd !== undefined) {
          const target = resolveInProject(cwd, args.cwd as string, { allowRoot: true });
          if (!target.ok) {
            resolvePromise(target.error);
            return;
          }
          workDir = target.path;
        }
        // VL-99: команда валидируется до запуска — лексическая проверка
        // обращений за пределы проекта (~, $HOME, абсолютные/..-пути).
        const commandError = checkShellCommandInProject(command, cwd);
        if (commandError !== null) {
          resolvePromise(commandError);
          return;
        }
        if (ctx?.signal?.aborted) {
          resolvePromise('Команда отменена пользователем');
          return;
        }
        const child = execFile(
          '/bin/bash',
          ['-lc', command],
          {
            cwd: workDir,
            timeout,
            killSignal: 'SIGKILL',
            maxBuffer: 8 * 1024 * 1024,
            encoding: 'utf8',
          },
          (err, stdout, stderr) => {
            ctx?.signal?.removeEventListener('abort', onAbort);
            const MAX_OUTPUT = 64 * 1024;
            const cut = (s: string): string =>
              s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[вывод обрезан до 64КБ]` : s;
            const exitCode = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
            const timedOut = err !== null && (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true && !ctx?.signal?.aborted;
            const parts = [
              `exit code: ${exitCode}`,
              `stdout:\n${cut(stdout ?? '')}`,
              `stderr:\n${cut(stderr ?? '')}`,
            ];
            if (timedOut) parts.push(`[таймаут ${timeout} мс — процесс убит по SIGKILL]`);
            if (ctx?.signal?.aborted) parts.push('[отменено пользователем]');
            // VL-110: финальная обрезка собранного вывода до 8KB для модели
            resolvePromise(maskSecrets(truncateToolOutput(parts.join('\n'))));
          },
        );
        const onAbort = (): void => {
          child.kill('SIGKILL');
        };
        ctx?.signal?.addEventListener('abort', onAbort, { once: true });
      }),
  };
}

/** Превращает мини-glob (*.** → regex) в регулярку по относительному пути. */
export function miniGlobToRegex(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // ** — любое кол-во директорий; **/ дополнительно поглощает слэш.
        i++;
        if (glob[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
  }
  return new RegExp(`^${source}$`);
}

/** Каталоги, которые обход не рассматривает (шум и размер репозитория). */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Рекурсивный обход дерева проекта (readdirSync, синхронно — инструменты
 * anyway выполняются в loop без параллелизма). Возвращает относительные
 * posix-пути файлов; лимит — защита от раздувания вывода.
 */
function walkFiles(root: string, limit: number): string[] {
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
        if (!SKIP_DIRS.has(entry.name)) stack.push(relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  }
  return out.sort();
}

/** Инструмент grep_search: рекурсивный поиск по regex, формат file:line: text. */
function makeGrepSearch(cwd: string): ToolSpec {
  return {
    name: 'grep_search',
    description:
      'Поиск по содержимому файлов проекта: regex-паттерн, формат file:line: text. Лимит 200 совпадений.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Регулярное выражение (поддержка JS regex)' },
        path: { type: 'string', description: 'Директория или файл для поиска (дефолт — весь проект)' },
        glob: { type: 'string', description: 'Фильтр имён файлов, например "*.ts" или "src/**/*.ts"' },
      },
      required: ['pattern'],
    },
    handler: async (args) => {
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern as string);
      } catch (err) {
        return `Невалидный regex в pattern: ${err instanceof Error ? err.message : String(err)}`;
      }
      const startRel = typeof args.path === 'string' ? args.path : '.';
      const start = resolveInProject(cwd, startRel, { allowRoot: true });
      if (!start.ok) return start.error;
      const globRegex = typeof args.glob === 'string' && args.glob ? miniGlobToRegex(args.glob) : null;
      const LIMIT = 200;
      const rootFiles = statSync(start.path).isDirectory()
        ? walkFiles(start.path, 10_000).map((rel) => ({
            // glob матчится по пути ОТНОСИТЕЛЬНО корня поиска (как пишет
            // пользователь), а вывод — относительно проекта.
            relRoot: rel,
            relOut: startRel === '.' ? rel : `${startRel.replace(/\/+$/, '')}/${rel}`,
            abs: join(start.path, rel),
          }))
        : [
            {
              relRoot: '.',
              relOut: relative(cwd, start.path),
              abs: start.path,
            },
          ];
      const matches: string[] = [];
      for (const file of rootFiles) {
        if (matches.length >= LIMIT) break;
        if (globRegex && !globRegex.test(file.relRoot)) continue;
        let content: string;
        try {
          content = readFileSync(file.abs, 'utf8');
        } catch {
          continue; // бинарник/битый файл — пропускаем
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= LIMIT) break;
          if (regex.test(lines[i])) matches.push(`${file.relOut}:${i + 1}:${lines[i]}`);
        }
      }
      if (matches.length === 0) return 'Совпадений не найдено';
      const suffix = matches.length >= LIMIT ? `\n…[достигнут лимит ${LIMIT} совпадений]` : '';
      return truncateToolOutput(matches.join('\n') + suffix);
    },
  };
}

/** Инструмент glob: только имена файлов, лимит 500. */
function makeGlob(cwd: string): ToolSpec {
  return {
    name: 'glob',
    description: 'Поиск файлов по glob-паттерну (относительные пути проекта). Лимит 500.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob-паттерн, например "src/**/*.ts"' },
      },
      required: ['pattern'],
    },
    handler: async (args) => {
      const regex = miniGlobToRegex(args.pattern as string);
      const LIMIT = 500;
      const files = walkFiles(cwd, 10_000).filter((rel) => regex.test(rel)).slice(0, LIMIT);
      if (files.length === 0) return 'Файлы не найдены';
      const suffix = files.length >= LIMIT ? `\n…[достигнут лимит ${LIMIT} файлов]` : '';
      return truncateToolOutput(files.join('\n') + suffix);
    },
  };
}

/** Список локальных инструментов для loop агента (привязка к cwd проекта). */
export function listLocalTools(cwd: string): ToolSpec[] {
  const root = resolve(cwd);
  return [
    makeReadFile(root),
    makeWriteFile(root),
    makeEdit(root),
    makeRunShellCommand(root),
    makeGrepSearch(root),
    makeGlob(root),
  ];
}
