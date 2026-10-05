/**
 * Локальные инструменты агента (VL-83, компонент 2 эпика VL-75).
 *
 * Шесть инструментов для tool calling: read_file, write_file, edit,
 * run_shell_command, grep_search, glob. Без внешних зависимостей: валидация —
 * plain TS; shell — только execFile('/bin/bash', ['-lc', command]) без
 * shell:true на уровне Node; пути резолвятся от cwd и отклоняются, если
 * вышли за пределы проекта. Ошибки — текстом модели (не исключениями): loop
 * дописывает их в messages и продолжает.
 */

import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
function resolveInProject(
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

/** Читает файл как utf-8 текстом модели (ошибки — текстом, не исключением). */
function readTextFile(abs: string): { ok: true; content: string } | { ok: false; error: string } {
  try {
    if (!existsSync(abs)) return { ok: false, error: `Файл не найден: ${abs}` };
    if (statSync(abs).isDirectory()) return { ok: false, error: `Это директория, не файл: ${abs}` };
    return { ok: true, content: readFileSync(abs, 'utf8') };
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Инструмент read_file: строки с offset (0-based) и limit сверху. */
function makeReadFile(cwd: string): ToolSpec {
  return {
    name: 'read_file',
    description:
      'Читает текстовый файл проекта. offset — 0-based номер строки начала, limit — максимум строк.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
        offset: { type: 'number', description: '0-based номер строки начала' },
        limit: { type: 'number', description: 'Максимум возвращаемых строк' },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const target = resolveInProject(cwd, args.path as string);
      if (!target.ok) return target.error;
      const read = readTextFile(target.path);
      if (!read.ok) return read.error;
      const lines = read.content.split('\n');
      const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : lines.length;
      const slice = lines.slice(offset, offset + limit);
      return slice.join('\n');
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
            resolvePromise(parts.join('\n'));
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
      return matches.join('\n') + suffix;
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
      return files.join('\n') + suffix;
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
