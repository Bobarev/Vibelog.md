/**
 * Карта проекта для агента (VL-235): модули `src/` — путь, назначение и экспорты.
 *
 * Проблема (VL-232): даже с листингом каталогов (VL-233) и grep (VL-234) агенту
 * нужно несколько вызовов, чтобы понять «что вообще есть в проекте»: он угадывал
 * пути (`src/agent/orchestrator.ts` вместо `src/web/orchestrator.ts`, искал
 * `auto-runner.ts` в `src/core/`), на что ушло 6 холостых `read_file`. Карта
 * отвечает на вопрос «где реализован X» одним вызовом.
 *
 * Источник описаний — уже существующие шапки `/** … *\/` модулей: первая
 * содержательная строка. Экспорты собираются регуляркой, а не парсером TS:
 * полноценный парсинг потребовал бы зависимости (запрещены, AGENTS.md), а список
 * экспортов — вспомогательная информация, назначение и путь важнее.
 *
 * Допущение (зафиксировано осознанно): `export { a, b }` списком, `export type`
 * и `export interface` в список НЕ попадают — они не помогают агенту выбрать
 * модуль, а их сбор регуляркой даёт ложные срабатывания в теле файлов.
 *
 * Кэша нет: генерация — синхронный обход ~90 файлов (единицы миллисекунд), а
 * устаревшая карта хуже, чем её отсутствие.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Каталог карты по умолчанию (относительно корня проекта). */
export const PROJECT_MAP_DEFAULT_DIR = 'src';

/** Максимальная длина описания модуля в байтовом бюджете «полной» карты. */
export const PROJECT_MAP_DESC_MAX = 60;

/** Максимальная длина описания на ступени сжатия 2 (VL-235, AC4). */
export const PROJECT_MAP_DESC_COMPACT = 40;

/** Максимальное число модулей в карте (AC2: согласованный объём ~150). */
export const PROJECT_MAP_MODULE_LIMIT = 150;

/** Максимальное число строк в выборке по `query`. */
export const PROJECT_MAP_QUERY_LIMIT = 40;

/** Бюджет ответа инструмента в байтах (AC4: 4–8 КБ). */
export const PROJECT_MAP_MAX_BYTES = 8 * 1024;

/** Каталоги, которые обход не разворачивает (шум и размер репозитория). */
const PROJECT_MAP_SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** Опции генерации карты проекта. */
export interface ProjectMapOptions {
  /** Подкаталог проекта (по умолчанию `src`); пустая строка — весь проект. */
  dir?: string;
  /** Подстрока по пути/описанию/экспортам — узкая выборка с полными данными. */
  query?: string;
  /** Показывать ли экспорты (`false` — только путь и назначение). */
  exports?: boolean;
  /** Лимит модулей (по умолчанию PROJECT_MAP_MODULE_LIMIT). */
  limit?: number;
  /** Бюджет ответа в байтах (по умолчанию PROJECT_MAP_MAX_BYTES). */
  maxBytes?: number;
}

/** Результат генерации карты. */
export interface ProjectMapResult {
  /** Готовый markdown-текст для модели. */
  text: string;
  /** Сколько модулей найдено всего (до усечения по лимиту). */
  modules: number;
  /** Сколько модулей показано в тексте. */
  shown: number;
  /** Уровень сжатия: 0 — полный, 1 — без экспортов, 2 — короткие описания, 3 — только имена. */
  compacted: 0 | 1 | 2 | 3;
  /** true — список усечён лимитом модулей. */
  truncated: boolean;
}

/** Один модуль карты: относительный путь, описание, экспорты. */
interface MapModule {
  /** Путь относительно корня карты, posix-разделители. */
  rel: string;
  /** Первая содержательная строка шапки (может быть пустой). */
  desc: string;
  /** Имена экспортов (function/const/let/class), возможно пусто. */
  exports: string[];
}

/**
 * Рекурсивный обход каталога с `.ts`-файлами (синхронно, без зависимостей).
 * Отсортированный результат даёт детерминированный порядок карты независимо
 * от порядка readdir (AC1/AC5: localeCompare с 'en' — как в formatDirListing).
 *
 * @param root — абсолютный путь каталога карты
 */
function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const relDir = stack.pop() as string;
    const absDir = relDir === '' ? root : join(root, relDir);
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue; // недоступный каталог не должен ронять карту
    }
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!PROJECT_MAP_SKIP_DIRS.has(entry.name)) stack.push(relPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        // Тесты (*.test.mjs / *.test.ts) и декларации (*.d.ts) в карту не идут:
        // они шумят и не помогают выбрать модуль реализации.
        if (relPath.includes('.test.') || entry.name.endsWith('.d.ts')) continue;
        out.push(relPath);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Первая содержательная строка шапки-комментария `/** … *\/` файла.
 * Пустая строка — шапки нет (строка модуля выводится без описания).
 */
function firstDocLine(content: string): string {
  const block = content.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!block) return '';
  for (const raw of block[1].split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '').trim();
    if (line) return line.replace(/\s+/g, ' ');
  }
  return '';
}

/**
 * Имена экспортов из директив `export function|const|let|class` (с учётом
 * `export default` и `export async`). Интерфейсы/типы не собираются — см.
 * допущение в шапке модуля.
 */
function collectExports(content: string): string[] {
  const re = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  return names;
}

/** Обрезает строку до `limit` символов с многоточием. */
function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

/** Собирает модули каталога карты. */
function collectModules(root: string): MapModule[] {
  const modules: MapModule[] = [];
  for (const rel of walkTsFiles(root)) {
    let content = '';
    try {
      content = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue; // нечитаемый файл — пропускаем, карта не должна падать
    }
    modules.push({ rel, desc: firstDocLine(content), exports: collectExports(content) });
  }
  return modules;
}

/**
 * Рендер карты по уровню сжатия.
 * 0 — описания + экспорты, 1 — без экспортов, 2 — короткие описания, 3 — только имена.
 */
function render(
  modules: MapModule[],
  level: 0 | 1 | 2 | 3,
  showExports: boolean,
): string {
  const byDir = new Map<string, MapModule[]>();
  for (const mod of modules) {
    const idx = mod.rel.lastIndexOf('/');
    const dir = idx < 0 ? '' : mod.rel.slice(0, idx);
    const list = byDir.get(dir);
    if (list) list.push(mod);
    else byDir.set(dir, [mod]);
  }
  const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  const lines: string[] = [];
  for (const dir of dirs) {
    lines.push(dir === '' ? './' : `${dir}/`);
    for (const mod of byDir.get(dir) as MapModule[]) {
      const name = mod.rel.slice(mod.rel.lastIndexOf('/') + 1);
      let line = `  ${name}`;
      const descLimit = level >= 2 ? PROJECT_MAP_DESC_COMPACT : PROJECT_MAP_DESC_MAX;
      if (level < 3 && mod.desc) line += ` — ${clip(mod.desc, descLimit)}`;
      if (level < 2 && showExports && mod.exports.length > 0) {
        line += ` [${mod.exports.join(', ')}]`;
      }
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/**
 * Ступенчатое сжатие под бюджет байтов (AC4): (1) убрать экспорты,
 * (2) сократить описания, (3) оставить только имена модулей. Полный текст
 * всегда помечается маркером сжатия, чтобы модель знала об усечении.
 */
function fitBudget(
  modules: MapModule[],
  showExports: boolean,
  maxBytes: number,
): { text: string; compacted: 0 | 1 | 2 | 3 } {
  const steps: Array<{ level: 0 | 1 | 2 | 3; exports: boolean }> = [
    { level: 0, exports: showExports },
    { level: 1, exports: false },
    { level: 2, exports: false },
    { level: 3, exports: false },
  ];
  let text = '';
  let level: 0 | 1 | 2 | 3 = 0;
  for (const step of steps) {
    text = render(modules, step.level, step.exports);
    level = step.level;
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) break;
  }
  if (level > 0) {
    text += `\n…[карта сжата: уровень ${level} (${level === 1 ? 'без экспортов' : level === 2 ? 'короткие описания' : 'только имена модулей'}), модулей: ${modules.length}]`;
  }
  return { text, compacted: level };
}

/**
 * Строит карту проекта: модули каталога (по умолчанию `src`), путь + первая
 * строка шапки + экспорты. Сеть не используется, чтение синхронное.
 *
 * Режимы:
 * - обычный — группировка по каталогам, усечение по `limit`, сжатие по бюджету;
 * - `query` — узкая выборка (до PROJECT_MAP_QUERY_LIMIT строк) с полными
 *   описаниями и всеми экспортами: это ответ на вопрос «где реализован X».
 *
 * @param cwd — корень проекта (границы доступа)
 * @param options — параметры генерации
 */
export function buildProjectMap(cwd: string, options: ProjectMapOptions = {}): ProjectMapResult {
  const rawDir = options.dir === undefined ? PROJECT_MAP_DEFAULT_DIR : options.dir;
  // Пустой dir — весь проект; защита от абсолютных путей и выхода наружу.
  const dir = rawDir.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (dir.startsWith('/') || dir.split('/').includes('..')) {
    return {
      text: `Недопустимый dir: ${rawDir} (ожидается путь внутри проекта)`,
      modules: 0,
      shown: 0,
      compacted: 0,
      truncated: false,
    };
  }
  const root = dir === '' ? cwd : join(cwd, dir);
  const all = collectModules(root);
  const label = dir === '' ? '' : `${dir}/`;
  const headerLabel = label === '' ? './' : label;
  if (all.length === 0) {
    return {
      text: `Каталог ${headerLabel} не найден или не содержит .ts-модулей — карта не построена (уточните dir)`,
      modules: 0,
      shown: 0,
      compacted: 0,
      truncated: false,
    };
  }
  for (const mod of all) mod.rel = `${label}${mod.rel}`.replace(sep, '/');

  const query = (options.query ?? '').trim().toLowerCase();
  if (query) {
    const hits = all.filter(
      (mod) =>
        mod.rel.toLowerCase().includes(query) ||
        mod.desc.toLowerCase().includes(query) ||
        mod.exports.some((name) => name.toLowerCase().includes(query)),
    );
    if (hits.length === 0) {
      return {
        text: `Совпадений не найдено: "${options.query}" (искали по пути, описанию и экспортам в ${headerLabel})`,
        modules: 0,
        shown: 0,
        compacted: 0,
        truncated: false,
      };
    }
    const shown = hits.slice(0, PROJECT_MAP_QUERY_LIMIT);
    const lines = shown.map((mod) => {
      const desc = mod.desc ? ` — ${clip(mod.desc, 200)}` : '';
      const exps = mod.exports.length > 0 ? ` [${mod.exports.join(', ')}]` : '';
      return `${mod.rel}${desc}${exps}`;
    });
    const truncated = hits.length > shown.length;
    if (truncated) {
      lines.push(`…[выборка усечена: показано ${shown.length} из ${hits.length}; сузьте query]`);
    }
    return {
      text: `Модули по запросу "${options.query}" (${shown.length} из ${hits.length}):\n${lines.join('\n')}`,
      modules: hits.length,
      shown: shown.length,
      compacted: 0,
      truncated,
    };
  }

  const limit = Number.isFinite(options.limit) && (options.limit as number) > 0
    ? Math.floor(options.limit as number)
    : PROJECT_MAP_MODULE_LIMIT;
  const shown = all.slice(0, limit);
  const truncated = all.length > shown.length;
  const maxBytes = Number.isFinite(options.maxBytes) && (options.maxBytes as number) > 0
    ? Math.floor(options.maxBytes as number)
    : PROJECT_MAP_MAX_BYTES;
  const fitted = fitBudget(shown, options.exports !== false, maxBytes);
  const parts = [`Карта проекта ${headerLabel} (${shown.length} модулей из ${all.length})`, fitted.text];
  if (truncated) {
    parts.push(`…[карта усечена: показано ${shown.length} из ${all.length} модулей; уточните dir/query]`);
  }
  return {
    text: parts.join('\n'),
    modules: all.length,
    shown: shown.length,
    compacted: fitted.compacted,
    truncated,
  };
}
