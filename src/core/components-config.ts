/**
 * Схемы состояния компонентов (VL-333, doc-25 §3.1–3.2).
 *
 * Два файла состояния:
 *
 * 1. секция `components` в `.vibelog/settings.json` — откуда брать компоненты
 *    (registries), куда ставить (aliases — относительные пути от корня
 *    проекта) и где lock-файл;
 * 2. `.vibelog/installed.lock.json` — что уже установлено:
 *    `components[name] = {version, installedAt, dependencies, files{path:{hash, sourceVersion}}}`.
 *
 * Модуль намеренно НЕ содержит CLI-команд и сетевых вызовов: только чтение,
 * валидация, атомарная запись, хеширование и разрешение алиаса в путь.
 * `vb init --components` вызовет `writeComponentsConfig`, `vb install` —
 * `readLock`/`writeLock`/`hashFile`/`resolveAliasPath`.
 *
 * Почему отдельный модуль: ошибка здесь (затёртая секция `models` в
 * settings.json или путь `../..` в `aliases`) проявляется далеко от места
 * поломки, поэтому валидация и запись тестируются изолированно.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadSettings, settingsPath } from './settings.js';

/** Поддерживаемая версия схемы обоих файлов состояния. */
export const COMPONENTS_SCHEMA_VERSION = 1;

/** Запись реестра компонентов: репозиторий-источник компонента. */
export interface RegistryEntry {
  /** Владелец репозитория (без точки — это имя организации/пользователя). */
  owner: string;
  /** Ветка, из которой берутся файлы компонента. */
  branch: string;
}

/**
 * Куда устанавливать компоненты. Все пути — ОТНОСИТЕЛЬНО корня проекта:
 * `vb install` может запускаться из подкаталога, а `aliases` берётся из
 * settings.json, где абсолютных путей быть не должно (иначе конфиг
 * непереносим между машинами и выходит за корень).
 */
export interface Aliases {
  /** Каталог компонентов целиком. */
  components: string;
  /** Каталог UI-примитивов. */
  ui: string;
  /** Файл утилит (не каталог!). */
  utils: string;
  /** Файл глобальных стилей (не каталог!). */
  css: string;
}

/** Секция `components` в `.vibelog/settings.json`. */
export interface ComponentsConfig {
  schemaVersion: number;
  registries: Record<string, RegistryEntry>;
  aliases: Aliases;
  lockFile: string;
}

/** Запись об одном файле установленного компонента. */
export interface LockedFile {
  /** `sha256:` + 64 hex — хеш содержимого записанного файла. */
  hash: string;
  /** Версия компонента, из которой взят файл. */
  sourceVersion: string;
}

/** Установленный компонент. */
export interface LockedComponent {
  version: string;
  /** ISO-строка момента установки. */
  installedAt: string;
  dependencies: string[];
  /** Относительный путь внутри проекта → запись о файле. */
  files: Record<string, LockedFile>;
}

/** Содержимое `.vibelog/installed.lock.json`. */
export interface LockFile {
  schemaVersion: number;
  components: Record<string, LockedComponent>;
}

/** Имена алиасов — фиксированный набор (порядок важен для стабильной записи). */
export const ALIAS_KEYS = ['components', 'ui', 'utils', 'css'] as const;

/** Имя алиаса. */
export type AliasName = (typeof ALIAS_KEYS)[number];

/**
 * Ошибка конфигурации компонентов.
 *
 * `code` 2 — предусловие/схема (нет секции, несовпавший schemaVersion,
 * битый JSON); `code` 3 — данные/путь (значение не проходит проверку:
 * выход за корень проекта, недопустимый owner, неизвестный алиас).
 * CLI печатает `message` одной строкой, поэтому текст самодостаточен.
 */
export class ComponentsConfigError extends Error {
  /** Код ошибки для exit-кода CLI. */
  readonly code: 2 | 3;
  /** Какое поле не прошло валидацию (для диагностики). */
  readonly field: string;

  constructor(message: string, code: 2 | 3, field: string) {
    super(message);
    this.name = 'ComponentsConfigError';
    this.code = code;
    this.field = field;
  }
}

/** Регулярка версии компонента: X.Y.Z, допускается prerelease-суффикс. */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Регулярка хеша: `sha256:` + 64 hex-символа. */
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Объект (не null и не массив). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Проверяет, что путь непустой, относительный и не выходит за корень.
 *
 * Вторая линия защиты от `..` и абсолютных путей: `aliases` приходит из
 * settings.json, который может быть скопирован/изменён вручную.
 */
function assertInsideProject(cwd: string, value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ComponentsConfigError(`поле ${field}: путь должен быть непустой строкой`, 2, field);
  }
  if (isAbsolute(value) || value.startsWith('~')) {
    throw new ComponentsConfigError(
      `поле ${field}: путь «${value}» должен быть относительным (не абсолютным)`,
      3,
      field,
    );
  }
  const root = resolve(cwd);
  const abs = resolve(root, value);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ComponentsConfigError(
      `поле ${field}: путь «${value}» выходит за корень проекта`,
      3,
      field,
    );
  }
}

/**
 * Валидирует значение одного алиаса.
 *
 * Экспортируется отдельно: `vb init --components` проверяет введённые
 * пользователем пути ДО записи в settings.json.
 */
export function validateAliasPath(cwd: string, alias: AliasName, value: string): void {
  assertInsideProject(cwd, value, `aliases.${alias}`);
}

/** Валидирует запись реестра (owner без точки, branch непустой). */
function validateRegistry(name: string, value: unknown): RegistryEntry {
  const field = `registries.${name}`;
  if (!isPlainObject(value)) {
    throw new ComponentsConfigError(`поле ${field}: ожидался объект {owner, branch}`, 2, field);
  }
  const { owner, branch } = value;
  if (typeof owner !== 'string' || owner.trim() === '') {
    throw new ComponentsConfigError(`поле ${field}.owner: ожидалась непустая строка`, 2, `${field}.owner`);
  }
  // Точка в owner — признак того, что вписали домен (gitverse.ru) вместо
  // владельца репозитория: такой URL потом не собрать.
  if (owner.includes('.')) {
    throw new ComponentsConfigError(
      `поле ${field}.owner: «${owner}» не должен содержать точку (нужно имя владельца, не домен)`,
      3,
      `${field}.owner`,
    );
  }
  if (typeof branch !== 'string' || branch.trim() === '') {
    throw new ComponentsConfigError(
      `поле ${field}.branch: ожидалась непустая строка`,
      2,
      `${field}.branch`,
    );
  }
  return { owner, branch };
}

/**
 * Нормализует и валидирует секцию `components` (порядок ключей фиксирован —
 * settings.json коммитится в git, лишний diff из-за переупорядочивания нежелателен).
 */
function normalizeComponents(cwd: string, raw: Record<string, unknown>): ComponentsConfig {
  if (raw.schemaVersion !== COMPONENTS_SCHEMA_VERSION) {
    throw new ComponentsConfigError(
      `поле schemaVersion: поддерживается только ${COMPONENTS_SCHEMA_VERSION}, получено ${JSON.stringify(raw.schemaVersion)}`,
      2,
      'schemaVersion',
    );
  }

  if (!isPlainObject(raw.registries)) {
    throw new ComponentsConfigError('поле registries: ожидался объект', 2, 'registries');
  }
  const registries: Record<string, RegistryEntry> = {};
  for (const name of Object.keys(raw.registries).sort()) {
    if (name.trim() === '') {
      throw new ComponentsConfigError('поле registries: пустое имя реестра', 2, 'registries');
    }
    registries[name] = validateRegistry(name, raw.registries[name]);
  }

  if (!isPlainObject(raw.aliases)) {
    throw new ComponentsConfigError('поле aliases: ожидался объект', 2, 'aliases');
  }
  const aliases: Record<string, string> = {};
  for (const alias of ALIAS_KEYS) {
    const value = raw.aliases[alias];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ComponentsConfigError(
        `поле aliases.${alias}: ожидалась непустая строка`,
        2,
        `aliases.${alias}`,
      );
    }
    validateAliasPath(cwd, alias, value);
    aliases[alias] = value;
  }

  assertInsideProject(cwd, raw.lockFile as string, 'lockFile');

  return {
    schemaVersion: COMPONENTS_SCHEMA_VERSION,
    registries,
    aliases: {
      components: aliases.components,
      ui: aliases.ui,
      utils: aliases.utils,
      css: aliases.css,
    },
    lockFile: raw.lockFile as string,
  };
}

/**
 * Читает секцию `components` из `.vibelog/settings.json`.
 *
 * `null` — секции нет: это НЕ ошибка, а состояние «не инициализировано»
 * (`vb install` превратит его в подсказку «выполните `vb init --components`»).
 * Наличие секции с нарушенной схемой — ошибка (код 2) или недопустимым
 * значением (код 3).
 */
export function readComponentsConfig(cwd: string): ComponentsConfig | null {
  const settings = loadSettings(cwd);
  const raw = settings.components;
  if (raw === undefined) return null;
  if (!isPlainObject(raw)) {
    throw new ComponentsConfigError(
      `поле components в ${settingsPath(cwd)}: ожидался объект`,
      2,
      'components',
    );
  }
  // loadSettings отдаёт валидный JSON-объект; если файла не было — секции нет
  return normalizeComponents(cwd, raw);
}

/**
 * Как `readComponentsConfig`, но отсутствие секции — ошибка (код 2)
 * с подсказкой, что делать. Нужна командам, которым конфигурация
 * обязательна (`vb install`, `vb add`).
 */
export function requireComponentsConfig(cwd: string): ComponentsConfig {
  const config = readComponentsConfig(cwd);
  if (config === null) {
    throw new ComponentsConfigError(
      `секция components не найдена в ${settingsPath(cwd)} — выполните «vb init --components»`,
      2,
      'components',
    );
  }
  return config;
}

/**
 * Склеивает `aliases[alias]` с относительным `target` компонента.
 *
 * `target` приходит из сети (манифест реестра), поэтому проверяется
 * повторно — после склейки путь обязан остаться внутри корня проекта.
 * Для `utils`/`css` (это файлы, а не каталоги) `target` не может содержать `/`.
 *
 * @returns абсолютный путь внутри проекта
 */
export function resolveAliasPath(
  cwd: string,
  config: ComponentsConfig,
  alias: AliasName,
  target: string,
): string {
  if (!(ALIAS_KEYS as readonly string[]).includes(alias)) {
    throw new ComponentsConfigError(
      `неизвестный алиас «${String(alias)}»; доступны: ${ALIAS_KEYS.join(', ')}`,
      3,
      'alias',
    );
  }
  const base = config.aliases[alias];
  if (typeof base !== 'string' || base.trim() === '') {
    throw new ComponentsConfigError(`поле aliases.${alias}: пустое значение`, 3, `aliases.${alias}`);
  }
  validateAliasPath(cwd, alias, base);

  if (typeof target !== 'string' || target.trim() === '') {
    throw new ComponentsConfigError(
      `поле target для алиаса ${alias}: ожидалась непустая строка`,
      3,
      `target`,
    );
  }
  if (isAbsolute(target) || target.startsWith('~')) {
    throw new ComponentsConfigError(
      `поле target для алиаса ${alias}: «${target}» должен быть относительным путём`,
      3,
      'target',
    );
  }
  // Разделение «файл vs каталог» (VL-383, doc-25 §3.3/§3.4).
  //
  // Алиасы-ФАЙЛЫ (utils, css). База — каталог файла-алиаса
  // (`dirname(aliases.utils)`), поэтому `../<file>` легален: корневой элемент
  // `base` объявляет `target: "../utils.ts"`, читая его как «путь относительно
  // файла-алиаса». Форма строгая — ровно один уровень вверх и только имя файла:
  // `../sub/x.ts` (вложенность) и `../../evil.ts` (глубина) отклоняются, иначе
  // `..` превратился бы в произвольный обход дерева.
  //
  // Алиасы-КАТАЛОГИ (ui, components). База — сам каталог, переход вверх запрещён
  // полностью: компонент не должен выбираться из каталога на уровень выше.
  const isFileAlias = alias === 'utils' || alias === 'css';
  const hasUp = target.split(/[\\/]/).includes('..');
  if (isFileAlias) {
    if (hasUp) {
      const legalPrefix = target.startsWith('../') || target.startsWith('..\\');
      const rest = legalPrefix ? target.slice(3) : '';
      if (!legalPrefix || rest === '' || rest.includes('/') || rest.includes('\\')) {
        throw new ComponentsConfigError(
          `поле target для алиаса ${alias}: «${target}» — допустим ровно один переход вверх и только имя файла («../<file>»)`,
          3,
          'target',
        );
      }
    } else if (target.includes('/') || target.includes('\\')) {
      throw new ComponentsConfigError(
        `поле target для алиаса ${alias}: «${target}» — это файл, путь с «/» недопустим`,
        3,
        'target',
      );
    }
  } else if (hasUp) {
    throw new ComponentsConfigError(
      `поле target для алиаса ${alias}: «${target}» содержит переход вверх («..»)`,
      3,
      'target',
    );
  }

  const root = resolve(cwd);
  // Для utils/css алиас — путь к ФАЙЛУ. Обычный target кладётся рядом с ним
  // (dirname), иначе получилось бы «utils.ts/helpers.ts». Но target с ведущим
  // «../» читается относительно самого файла-алиаса (doc-25 §3.4): тогда
  // `../utils.ts` при aliases.utils = 'src/lib/utils.ts' даёт ровно
  // возглавляемый алиасом файл — src/lib/utils.ts (VL-383, AC2).
  const baseAbs = resolve(root, base);
  const isFileAliasBase = alias === 'utils' || alias === 'css';
  const baseDir = isFileAliasBase && !hasUp ? dirname(baseAbs) : baseAbs;
  const abs = resolve(baseDir, target);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ComponentsConfigError(
      `поле target для алиаса ${alias}: «${target}» выходит за корень проекта`,
      3,
      'target',
    );
  }
  return abs;
}

/** Путь к lock-файлу из конфигурации (не хардкод — переносимо). */
export function lockPath(cwd: string, config: ComponentsConfig): string {
  assertInsideProject(cwd, config.lockFile, 'lockFile');
  return resolve(cwd, config.lockFile);
}

/** Хеш содержимого буфера/строки: `sha256:` + hex (VL-333, единая точка). */
export function hashContent(content: Buffer | string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * Хеш файла на диске: `sha256:` + hex от содержимого.
 *
 * Единая точка для `vb install` (что записали) и будущего `vb update`
 * (что лежит сейчас): сравнение хешей = сравнение содержимого.
 */
export function hashFile(absPath: string): string {
  return hashContent(readFileSync(absPath));
}

/** Опции атомарной записи (подмена rename — для теста атомарности). */
export interface WriteJsonAtomicOptions {
  /** Подмена renameSync (тест «сбой на последнем шаге»). */
  rename?: (from: string, to: string) => void;
}

/**
 * Пишет JSON АТОМАРНО: temp-файл в том же каталоге, fsync, rename поверх.
 *
 * Rename в пределах одной ФС атомарен: читатель видит либо старый целый
 * файл, либо новый целый, но никогда половину. При любой ошибке temp
 * удаляется, целевой файл не тронут.
 */
export function writeJsonAtomic(
  path: string,
  data: unknown,
  options: WriteJsonAtomicOptions = {},
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const rand = Math.random().toString(36).slice(2, 10);
  const tmp = `${path}.tmp-${process.pid}-${rand}`;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    (options.rename ?? renameSync)(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp мог не создаться — тогда и чистить нечего
    }
    throw err;
  }
}

/**
 * Записывает секцию `components` в settings.json (read-modify-write).
 *
 * Порядок ключей верхнего уровня сохраняется: секция подменяется на месте,
 * остальные (`chats`, `models`, `providers`, `workflows`, `mcpServers`,
 * `chat_personas`, `commit_coauthor` и любые незнакомые) остаются как были.
 * Без этого `vb init --components` затирал бы настройки бота и моделей.
 */
export function writeComponentsConfig(cwd: string, config: ComponentsConfig): void {
  const normalized = normalizeComponents(cwd, config as unknown as Record<string, unknown>);
  const current = loadSettings(cwd);
  const next: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(current)) {
    if (key === 'components') {
      next.components = normalized;
      placed = true;
    } else {
      next[key] = value;
    }
  }
  if (!placed) next.components = normalized;
  writeJsonAtomic(settingsPath(cwd), next);
}

/** Пустой lock-файл (первый запуск — нормальное состояние). */
export function emptyLock(): LockFile {
  return { schemaVersion: COMPONENTS_SCHEMA_VERSION, components: {} };
}

/** Нормализует lock (порядок ключей фиксирован) и валидирует значения. */
function normalizeLock(raw: Record<string, unknown>, source: string): LockFile {
  if (raw.schemaVersion !== COMPONENTS_SCHEMA_VERSION) {
    throw new ComponentsConfigError(
      `${source}: поле schemaVersion — поддерживается ${COMPONENTS_SCHEMA_VERSION}, получено ${JSON.stringify(raw.schemaVersion)}`,
      2,
      'schemaVersion',
    );
  }
  if (!isPlainObject(raw.components)) {
    throw new ComponentsConfigError(`${source}: поле components — ожидался объект`, 2, 'components');
  }
  const components: Record<string, LockedComponent> = {};
  for (const name of Object.keys(raw.components).sort()) {
    const field = `components.${name}`;
    const entry = raw.components[name];
    if (!isPlainObject(entry)) {
      throw new ComponentsConfigError(`${source}: поле ${field} — ожидался объект`, 2, field);
    }
    const { version, installedAt, dependencies, files } = entry;
    if (typeof version !== 'string' || !VERSION_RE.test(version)) {
      throw new ComponentsConfigError(
        `${source}: поле ${field}.version — ожидалась версия X.Y.Z`,
        2,
        `${field}.version`,
      );
    }
    if (typeof installedAt !== 'string' || Number.isNaN(Date.parse(installedAt))) {
      throw new ComponentsConfigError(
        `${source}: поле ${field}.installedAt — ожидалась ISO-дата`,
        2,
        `${field}.installedAt`,
      );
    }
    if (!Array.isArray(dependencies) || dependencies.some((d) => typeof d !== 'string')) {
      throw new ComponentsConfigError(
        `${source}: поле ${field}.dependencies — ожидался массив строк`,
        2,
        `${field}.dependencies`,
      );
    }
    if (!isPlainObject(files)) {
      throw new ComponentsConfigError(`${source}: поле ${field}.files — ожидался объект`, 2, `${field}.files`);
    }
    const outFiles: Record<string, LockedFile> = {};
    for (const filePath of Object.keys(files).sort()) {
      const fileField = `${field}.files.${filePath}`;
      const file = files[filePath];
      if (!isPlainObject(file)) {
        throw new ComponentsConfigError(
          `${source}: поле ${fileField} — ожидался объект {hash, sourceVersion}`,
          2,
          fileField,
        );
      }
      if (typeof file.hash !== 'string' || !HASH_RE.test(file.hash)) {
        throw new ComponentsConfigError(
          `${source}: поле ${fileField}.hash — ожидался «sha256:<64 hex>»`,
          2,
          `${fileField}.hash`,
        );
      }
      if (typeof file.sourceVersion !== 'string' || !VERSION_RE.test(file.sourceVersion)) {
        throw new ComponentsConfigError(
          `${source}: поле ${fileField}.sourceVersion — ожидалась версия X.Y.Z`,
          2,
          `${fileField}.sourceVersion`,
        );
      }
      if (isAbsolute(filePath) || filePath.split('/').includes('..')) {
        throw new ComponentsConfigError(
          `${source}: путь файла «${filePath}» должен быть относительным внутри проекта`,
          3,
          fileField,
        );
      }
      outFiles[filePath] = { hash: file.hash, sourceVersion: file.sourceVersion };
    }
    components[name] = {
      version,
      installedAt,
      dependencies: dependencies as string[],
      files: outFiles,
    };
  }
  return { schemaVersion: COMPONENTS_SCHEMA_VERSION, components };
}

/**
 * Читает lock-файл по пути из конфигурации.
 *
 * Файла нет → пустой lock (первый запуск). Битый JSON или нарушенная схема →
 * `ComponentsConfigError` с указанием файла и поля.
 */
export function readLock(cwd: string, config: ComponentsConfig): LockFile {
  const path = lockPath(cwd, config);
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyLock();
    throw new ComponentsConfigError(
      `не удалось прочитать ${path}: ${(err as Error).message}`,
      2,
      'lockFile',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Позиция парсера — единственная полезная деталь для правки руками
    throw new ComponentsConfigError(
      `${path}: битый JSON — ${(err as Error).message}`,
      2,
      'lockFile',
    );
  }
  if (!isPlainObject(parsed)) {
    throw new ComponentsConfigError(`${path}: ожидался JSON-объект`, 2, 'lockFile');
  }
  return normalizeLock(parsed, path);
}

/**
 * Пишет lock-файл по пути из конфигурации (атомарно, стабильный порядок).
 *
 * Валидация перед записью: невалидный lock не должен попасть на диск —
 * иначе следующий `vb install` упадёт на чтении собственного файла.
 */
export function writeLock(cwd: string, config: ComponentsConfig, lock: LockFile): void {
  const path = lockPath(cwd, config);
  const normalized = normalizeLock(lock as unknown as Record<string, unknown>, path);
  writeJsonAtomic(path, normalized);
}

/** Абсолютный путь алиаса без target (корень каталога/файл-приёмник). */
export function aliasDir(cwd: string, config: ComponentsConfig, alias: AliasName): string {
  const base = config.aliases[alias];
  validateAliasPath(cwd, alias, base);
  return join(resolve(cwd), base);
}

/**
 * Дефолтная секция `components` (doc-25 §3.1) для `vibelog init --components`.
 *
 * Значения алиасов одинаковы независимо от наличия каталогов: `src/lib/...`
 * — это просто пути, которые создаст первый `vb install`, а детект «а есть ли
 * `src/lib`» ничего бы не изменил (doc-25 фиксирует именно этот набор).
 * `css` намеренно не детектится (`src/app.css` vs `src/styles/app.css`) — вне
 * объёма задачи VL-336. Параметр `cwd` оставлен в сигнатуре: вызывающему
 * (wizard/`applySetup`) нужен контекст проекта, а будущий детект стека
 * добавится здесь, не меняя вызовы.
 */
export function defaultComponentsConfig(cwd: string): ComponentsConfig {
  void cwd;
  return {
    schemaVersion: COMPONENTS_SCHEMA_VERSION,
    registries: { 'vibelog.md': { owner: 'Vibelog-md', branch: 'master' } },
    aliases: {
      components: 'src/lib/components',
      ui: 'src/lib/components/ui',
      utils: 'src/lib/utils.ts',
      css: 'src/app.css',
    },
    lockFile: '.vibelog/installed.lock.json',
  };
}

/**
 * Дополняет существующую секцию `components` дефолтами («дополнить
 * недостающее»): заданные пользователем `registries`/`aliases` побеждают,
 * пустые места заполняются значениями из `defaults`.
 *
 * Зачем слияние, а не перезапись: повторный `vb init --components` не должен
 * откатывать правки путей, которые пользователь сделал руками (AC5). Полная
 * замена — только при явном `--force` (там `applySetup` передаёт дефолты
 * напрямую, минуя эту функцию).
 */
export function mergeComponentsConfig(
  existing: ComponentsConfig | null,
  defaults: ComponentsConfig,
): ComponentsConfig {
  if (existing === null) return defaults;
  const merged: Record<string, string> = { ...existing.aliases };
  for (const alias of ALIAS_KEYS) {
    if (typeof merged[alias] !== 'string' || merged[alias].trim() === '') {
      merged[alias] = defaults.aliases[alias];
    }
  }
  return {
    schemaVersion: COMPONENTS_SCHEMA_VERSION,
    // Порядок ключей фиксирован в normalizeComponents — здесь важен только
    // состав: существующие реестры остаются, недостающие добавляются
    registries: { ...defaults.registries, ...existing.registries },
    aliases: {
      components: merged.components,
      ui: merged.ui,
      utils: merged.utils,
      css: merged.css,
    },
    lockFile:
      typeof existing.lockFile === 'string' && existing.lockFile.trim() !== ''
        ? existing.lockFile
        : defaults.lockFile,
  };
}
