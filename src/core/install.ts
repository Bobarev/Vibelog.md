/**
 * Ядро `vb install` (VL-337, doc-25 §2.3, §4.3): доставка файлов компонента
 * из реестра в проект.
 *
 * Модуль намеренно не знает про CLI: разбор пути, предусловия, загрузка
 * элемента и его файлов, план установки (чистая функция), разрешение
 * конфликтов и атомарная запись. Команда (`cli/commands/install.ts`) только
 * собирает флаги, спрашивает пользователя и печатает итог.
 *
 * Почему план — отдельная сущность. `--dry-run` и реальная установка обязаны
 * показывать одно и то же: если бы «показать» и «сделать» были разными
 * ветками кода, dry-run рано или поздно разошёлся бы с реальностью. Поэтому
 * `buildInstallPlan` считает всё (целевые пути, действия, конфликты, будущую
 * запись lock), а `applyInstallPlan` лишь исполняет готовый план.
 *
 * Атомарность (ключевое требование задачи). Сценарий сбоя: элемент из трёх
 * файлов, первые два записаны, третий падает (нет прав, диск полон). Проект
 * не должен остаться полуустановленным. Отсюда жёсткий порядок:
 *   1) все файлы пишутся в `.vibelog/tmp/install-<pid>-<rand>/stage/`;
 *   2) существующие целевые файлы копируются в `…/backup/`;
 *   3) только после этого — `rename` на целевые места;
 *   4) при сбое на любом шаге уже перемещённые файлы восстанавливаются из
 *      бэкапа (или удаляются, если файла раньше не было), temp удаляется,
 *      lock не трогается.
 * Temp-каталог обязан быть ВНУТРИ проекта: `rename` между разными файловыми
 * системами не работает, а `os.tmpdir()` на macOS — отдельный том.
 *
 * Идемпотентность. Повторный `vb install` того же компонента — штатная
 * операция. При совпадении хешей файлы не трогаются, `installedAt` не
 * обновляется, lock не переписывается: иначе каждый запуск давал бы шумный
 * diff в git.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  ComponentsConfigError,
  hashContent,
  hashFile,
  readComponentsConfig,
  readLock,
  resolveAliasPath,
  writeLock,
} from './components-config.js';
import type {
  AliasName,
  ComponentsConfig,
  LockFile,
  LockedComponent,
  LockedFile,
  RegistryEntry,
} from './components-config.js';
import { fetchRegistryFile, fetchRegistryItem } from './registry-fetch.js';
import type { RegistryItem } from './registry-fetch.js';
import { findGitRoot } from './git.js';
import { ensureTmpDir } from './tmp.js';

/** Код выхода CLI (doc-25 §5.2). */
export type InstallExitCode = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Ошибка установки с кодом выхода.
 *
 * CLI печатает `message` одной строкой (без стектрейса) и ставит `code` в
 * `process.exitCode`, поэтому текст самодостаточен и содержит подсказку
 * действия.
 */
export class InstallError extends Error {
  readonly code: InstallExitCode;

  constructor(message: string, code: InstallExitCode) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

/** Разобранный путь `<alias>/<repo>/<name>`. */
export interface InstallPath {
  alias: string;
  repo: string;
  name: string;
}

/** Контекст установки: корень проекта, конфигурация, lock, реестр, ветка. */
export interface InstallContext {
  /** Корень проекта (git-корень либо cwd, если git нет). */
  root: string;
  config: ComponentsConfig;
  lock: LockFile;
  alias: string;
  repo: string;
  name: string;
  branch: string;
  registry: RegistryEntry;
  /** Исходная строка `<alias>/<repo>/<name>` — для сообщений. */
  ref: string;
}

/** Действие над одним файлом плана. */
export type InstallFileAction =
  /** Файла нет — создать. */
  | 'create'
  /** Файл уже совпадает с содержимым реестра — не трогать. */
  | 'skip-identical'
  /** Файл есть и отличается — требует решения. */
  | 'conflict'
  /** Конфликт разрешён перезаписью. */
  | 'overwrite'
  /** Конфликт разрешён пропуском. */
  | 'skip-conflict';

/** Один файл плана установки. */
export interface InstallPlanFile {
  /** Путь файла в репозитории реестра (`files[].path`). */
  sourcePath: string;
  /** Относительный путь внутри проекта (posix-разделители). */
  relPath: string;
  /** Абсолютный путь назначения. */
  absPath: string;
  /** Алиас, через который вычислен путь. */
  alias: AliasName;
  /** Тип файла из манифеста (`registry:ui`, …). */
  type: string;
  action: InstallFileAction;
  /** Файл уже существует на диске. */
  existing: boolean;
  /** Хеш существующего файла (если есть). */
  existingHash?: string;
  /** Хеш из `installed.lock.json` (если запись была). */
  lockedHash?: string;
  /** Хеш содержимого из реестра. */
  contentHash: string;
  /** Содержимое файла из реестра. */
  content: string;
  /**
   * Файл уже принадлежит другому элементу с тем же хешем (VL-338, doc-25
   * §3.2): содержимое переиспользуется, но в lock нового элемента путь НЕ
   * записывается — владелец остаётся прежним.
   */
  reusedFrom?: string;
}

/** План установки — единственный источник истины для dry-run и записи. */
export interface InstallPlan {
  item: RegistryItem;
  /** `<alias>/<repo>/<name>` как ввёл пользователь. */
  ref: string;
  files: InstallPlanFile[];
  /** Файлы, требующие решения (до разрешения конфликтов). */
  conflicts: InstallPlanFile[];
  /** Файлы, которые будут записаны. */
  willWrite: InstallPlanFile[];
  /** Файлы, которые будут пропущены. */
  willSkip: InstallPlanFile[];
  /** Запись lock, которая будет записана после успешной установки. */
  lockEntry: LockedComponent;
  /** true — lock уже совпадает, переписывать не нужно (идемпотентность). */
  lockUnchanged: boolean;
}

/** Результат применения плана. */
export interface InstallApplyResult {
  /** Относительные пути записанных файлов. */
  written: string[];
  /** Относительные пути пропущенных файлов. */
  skipped: string[];
  /** Был ли перезаписан lock-файл. */
  lockWritten: boolean;
  /** Запись lock после установки. */
  lockEntry: LockedComponent;
}

/** Опции сетевых вызовов (инъекция нужна тестам: 30 с в тесте неприемлемо). */
export interface InstallFetchOptions {
  baseUrl?: string;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  /** Паузы для 429 без `Retry-After` (VL-380; инъекция для тестов). */
  rateLimitDelaysMs?: readonly number[];
  /** Суммарный бюджет ожидания на 429, мс (инъекция для тестов). */
  rateLimitBudgetMs?: number;
  /** Инъекция пауз: тесты не должны ждать настоящие секунды. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Готовый токен GitVerse (иначе читается из `ctx.root`: shell env → .env). */
  token?: string;
  env?: NodeJS.ProcessEnv;
}

/** Соответствие типа файла реестра алиасу проекта (doc-25 §4.3 шаг 7). */
const TYPE_ALIAS: Record<string, AliasName> = {
  'registry:ui': 'ui',
  'registry:lib': 'utils',
  'registry:hook': 'components',
  'registry:component': 'components',
};

/**
 * Разбирает путь `<alias>/<repo>/<name>`.
 *
 * Ровно три непустых сегмента: иное число — ошибка использования (код 1) с
 * подсказкой формата. Пустые сегменты (`a//b`, `a/b/`) отклоняются так же:
 * иначе `vb install vibelog.md/ui/` скачивал бы `public/r/.json`.
 */
export function parseInstallPath(raw: string): InstallPath {
  const value = String(raw ?? '').trim();
  const parts = value.split('/');
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) {
    throw new InstallError(
      `неверный формат пути «${value}»: ожидалось <alias>/<repo>/<name>, например vibelog.md/ui/button`,
      1,
    );
  }
  return { alias: parts[0], repo: parts[1], name: parts[2] };
}

/** Алиас проекта для типа файла реестра. */
export function aliasForType(type: string): AliasName {
  const alias = TYPE_ALIAS[type];
  if (!alias) {
    throw new InstallError(
      `неизвестный тип файла «${type}»: ожидалось одно из ${Object.keys(TYPE_ALIAS).join(', ')}`,
      3,
    );
  }
  return alias;
}

/** Корень проекта: git-корень, иначе сам cwd. */
export function resolveProjectRoot(cwd: string): string {
  return findGitRoot(cwd) ?? resolve(cwd);
}

/**
 * Собирает контекст установки: корень, секцию `components`, lock, реестр.
 *
 * Отсутствие секции `components` — не поломка, а состояние «не
 * инициализировано»: подсказываем `vb init --components` (код 2). Неизвестный
 * alias — тоже код 2, но со списком доступных: пользователь чаще всего
 * опечатался в имени реестра.
 */
export function resolveInstallContext(
  cwd: string,
  rawPath: string,
  options: { branch?: string } = {},
): InstallContext {
  const { alias, repo, name } = parseInstallPath(rawPath);
  const root = resolveProjectRoot(cwd);

  let config: ComponentsConfig | null;
  try {
    config = readComponentsConfig(root);
  } catch (err) {
    if (err instanceof ComponentsConfigError) throw new InstallError(err.message, err.code);
    throw err;
  }
  if (config === null) {
    throw new InstallError(
      'секция components не найдена в .vibelog/settings.json — выполните «vb init --components»',
      2,
    );
  }

  const registry = config.registries[alias];
  if (!registry) {
    const available = Object.keys(config.registries);
    throw new InstallError(
      available.length > 0
        ? `неизвестный реестр «${alias}»; доступны: ${available.join(', ')}`
        : `неизвестный реестр «${alias}»: в секции components нет ни одного реестра — выполните «vb init --components»`,
      2,
    );
  }

  let lock: LockFile;
  try {
    lock = readLock(root, config);
  } catch (err) {
    if (err instanceof ComponentsConfigError) throw new InstallError(err.message, err.code);
    throw err;
  }

  // Флаг --branch приоритетнее ветки из registries[alias] (doc-25 §2.3)
  const branch = options.branch && options.branch.trim() !== '' ? options.branch.trim() : registry.branch;

  return { root, config, lock, alias, repo, name, branch, registry, ref: `${alias}/${repo}/${name}` };
}

/** Дополняет текст сетевой ошибки контекстом элемента (код 3). */
function withItemContext(ref: string, err: unknown): InstallError {
  const message = err instanceof Error ? err.message : String(err);
  return new InstallError(`элемент «${ref}»: ${message}`, 3);
}

/**
 * Скачивает и валидирует элемент реестра (VL-335).
 *
 * Схема уже проверена в `fetchRegistryItem`; здесь — дополнительная проверка
 * `item.name === name` (защита от подмены: реестр мог отдать чужой манифест).
 */
export async function fetchInstallItem(
  ctx: InstallContext,
  options: InstallFetchOptions = {},
): Promise<RegistryItem> {
  let item: RegistryItem;
  try {
    item = await fetchRegistryItem({
      owner: ctx.registry.owner,
      repo: ctx.repo,
      branch: ctx.branch,
      name: ctx.name,
      // VL-380: токен читается из проекта-получателя (shell env → .env),
      // иначе GitVerse лимитирует анонимные запросы и отдаёт 429.
      cwd: ctx.root,
      ...options,
    });
  } catch (err) {
    throw withItemContext(ctx.ref, err);
  }
  if (item.name !== ctx.name) {
    throw new InstallError(
      `элемент «${ctx.ref}»: реестр вернул манифест с именем «${item.name}» вместо «${ctx.name}»`,
      3,
    );
  }
  return item;
}

/**
 * Скачивает содержимое всех файлов элемента.
 *
 * Манифест элемента (doc-25 §3.3) содержит только `path`/`target`/`type` —
 * самого кода в нём нет, поэтому каждый файл забирается отдельным GET по
 * `files[].path`. Ошибка любого файла — код 3 до любой записи.
 */
export async function fetchInstallContents(
  ctx: InstallContext,
  item: RegistryItem,
  options: InstallFetchOptions = {},
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const file of item.files) {
    try {
      contents[file.path] = await fetchRegistryFile({
        owner: ctx.registry.owner,
        repo: ctx.repo,
        branch: ctx.branch,
        path: file.path,
        // VL-380: токен — из проекта-получателя (shell env → .env).
        cwd: ctx.root,
        ...options,
      });
    } catch (err) {
      throw withItemContext(ctx.ref, err);
    }
  }
  return contents;
}

/** Относительный путь в posix-виде (lock-файл переносим между ОС). */
function toPosixRel(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/');
}

/** Каноническая сериализация (порядок ключей не важен) — для сравнения lock. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Строит план установки. Чистая функция: ничего не пишет на диск.
 *
 * Правила конфликтов (doc-25 §4.3 шаг 8, AC5):
 * 1. файла нет → `create`;
 * 2. хеш файла совпадает с содержимым реестра (то есть с записью в lock после
 *    прошлой установки) → `skip-identical`;
 * 3. иначе → `conflict` (решение принимает CLI: `--force`, `--yes` или
 *    интерактивный выбор).
 *
 * `target` приходит из сети, поэтому путь проверяется повторно
 * (`resolveAliasPath` уже отклоняет абсолютные пути и `..`) — вторая линия
 * защиты от подмены реестра.
 */
export function buildInstallPlan(
  cwd: string,
  config: ComponentsConfig,
  lock: LockFile,
  item: RegistryItem,
  contents: Record<string, string>,
  ref: string,
  now: string = new Date().toISOString(),
): InstallPlan {
  const root = resolve(cwd);
  const existingEntry = lock.components[item.name];
  const files: InstallPlanFile[] = [];

  for (const file of item.files) {
    const alias = aliasForType(file.type);
    let absPath: string;
    try {
      absPath = resolveAliasPath(root, config, alias, file.target);
    } catch (err) {
      if (err instanceof ComponentsConfigError) throw new InstallError(err.message, err.code);
      throw err;
    }
    // Вторая линия защиты: даже если resolveAliasPath пропустит что-то новое,
    // запись за пределы проекта недопустима.
    const rel = relative(root, absPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new InstallError(
        `файл «${file.target}» элемента «${ref}» выходит за корень проекта`,
        3,
      );
    }

    const relPath = toPosixRel(root, absPath);
    const content = contents[file.path] ?? '';
    const contentHash = hashContent(content);
    const existing = existsSync(absPath) && statSync(absPath).isFile();
    const existingHash = existing ? hashFile(absPath) : undefined;
    const lockedHash = existingEntry?.files[relPath]?.hash;

    let action: InstallFileAction;
    if (!existing) action = 'create';
    else if (existingHash === contentHash) action = 'skip-identical';
    else action = 'conflict';

    files.push({
      sourcePath: file.path,
      relPath,
      absPath,
      alias,
      type: file.type,
      action,
      existing,
      existingHash,
      lockedHash,
      contentHash,
      content,
    });
  }

  const plan: InstallPlan = {
    item,
    ref,
    files,
    conflicts: files.filter((file) => file.action === 'conflict'),
    willWrite: [],
    willSkip: [],
    lockEntry: { version: item.version, installedAt: now, dependencies: [], files: {} },
    lockUnchanged: false,
  };
  recomputePlan(plan, lock, now);
  return plan;
}

/**
 * Пересчитывает производные поля плана (willWrite/willSkip, запись lock).
 *
 * Вызывается после каждого изменения `action` — так `--dry-run` и реальная
 * установка видят ровно одно состояние. Экспортируется для VL-338: правило
 * владения файлами (`checkFileOwnership`) меняет `action` и `lockEntry.files`
 * уже после сборки плана, и производные поля обязаны быть пересчитаны.
 */
export function recomputeInstallPlan(
  plan: InstallPlan,
  lock: LockFile,
  now: string = new Date().toISOString(),
  dependencies?: string[],
): void {
  recomputePlan(plan, lock, now, dependencies);
}

function recomputePlan(
  plan: InstallPlan,
  lock: LockFile,
  now: string,
  dependencies?: string[],
): void {
  plan.willWrite = plan.files.filter(
    (file) => file.action === 'create' || file.action === 'overwrite',
  );
  plan.willSkip = plan.files.filter(
    (file) => file.action === 'skip-identical' || file.action === 'skip-conflict',
  );

  const existingEntry = lock.components[plan.item.name];
  const wrote = plan.willWrite.length > 0;
  // installedAt обновляется ТОЛЬКО при реальной записи файлов: иначе повторный
  // запуск меняет lock и даёт diff в git (AC8).
  const installedAt = wrote ? now : (existingEntry?.installedAt ?? now);

  const files: Record<string, LockedFile> = {};
  for (const file of plan.files) {
    if (file.action === 'skip-conflict') {
      // Файл не наш — сохраняем прежнюю запись, если она была.
      const previous = existingEntry?.files[file.relPath];
      if (previous) files[file.relPath] = previous;
      continue;
    }
    // Переиспользованный файл принадлежит другому элементу (VL-338, §3.2):
    // в lock нового элемента путь не дублируется.
    if (file.reusedFrom) continue;
    files[file.relPath] = { hash: file.contentHash, sourceVersion: plan.item.version };
  }

  plan.lockEntry = {
    version: plan.item.version,
    installedAt,
    // Зависимости npm/реестра разрешает VL-338: сюда приходит список
    // подтверждённо установленных пакетов; без него переносим прежнюю запись,
    // чтобы не потерять данные.
    dependencies: dependencies ?? existingEntry?.dependencies ?? [],
    files,
  };

  const hasFiles = Object.keys(files).length > 0;
  if (!hasFiles && !existingEntry) {
    // Нечего записывать: все файлы пропущены по конфликту, прежней записи нет.
    plan.lockUnchanged = true;
    return;
  }
  plan.lockUnchanged = canonical(existingEntry) === canonical(plan.lockEntry);
}

/**
 * Разрешает конфликты плана по готовым решениям.
 *
 * @param decisions — `relPath` → «перезаписать»/«пропустить»; файлы без
 *   решения остаются в состоянии `conflict` (CLI обязан спросить про все)
 */
export function resolveConflicts(
  plan: InstallPlan,
  decisions: Record<string, 'overwrite' | 'skip'>,
  lock: LockFile,
  now: string = new Date().toISOString(),
): void {
  for (const file of plan.files) {
    if (file.action !== 'conflict') continue;
    const decision = decisions[file.relPath];
    if (decision === 'overwrite') file.action = 'overwrite';
    else if (decision === 'skip') file.action = 'skip-conflict';
  }
  plan.conflicts = plan.files.filter((file) => file.action === 'conflict');
  recomputePlan(plan, lock, now);
}

/** Все конфликты разрешены перезаписью (`--force`). */
export function forceOverwrite(plan: InstallPlan, lock: LockFile, now?: string): void {
  const decisions: Record<string, 'overwrite'> = {};
  for (const file of plan.conflicts) decisions[file.relPath] = 'overwrite';
  resolveConflicts(plan, decisions, lock, now);
}

/** Все конфликты пропускаются (`--yes` без `--force`). */
export function skipAllConflicts(plan: InstallPlan, lock: LockFile, now?: string): void {
  const decisions: Record<string, 'skip'> = {};
  for (const file of plan.conflicts) decisions[file.relPath] = 'skip';
  resolveConflicts(plan, decisions, lock, now);
}

/** Все файлы пропущены по конфликту — ни одного не записано (код 4). */
export function isAllConflictsSkipped(plan: InstallPlan): boolean {
  return plan.files.length > 0 && plan.files.every((file) => file.action === 'skip-conflict');
}

/**
 * Откатывает уже выполненные перемещения.
 *
 * Для каждого перемещённого файла: был бэкап — возвращаем его на место,
 * бэкапа не было (файл создавался с нуля) — удаляем созданное. Ошибки отката
 * не должны маскировать исходную: собираем их в текст предупреждения.
 */
function rollback(moved: InstallPlanFile[], backupDir: string): string[] {
  const problems: string[] = [];
  for (const file of moved.slice().reverse()) {
    const backup = join(backupDir, file.relPath);
    try {
      if (existsSync(backup)) {
        mkdirSync(dirname(file.absPath), { recursive: true });
        renameSync(backup, file.absPath);
      } else if (existsSync(file.absPath)) {
        unlinkSync(file.absPath);
      }
    } catch (err) {
      problems.push(`${file.relPath}: ${(err as Error).message}`);
    }
  }
  return problems;
}

/**
 * Применяет план: temp → бэкап → перемещения → lock.
 *
 * Порядок обязателен (см. шапку модуля). При сбое на любом шаге целевые файлы
 * возвращаются в исходное состояние, temp удаляется, lock не трогается.
 */
export function applyInstallPlan(
  cwd: string,
  config: ComponentsConfig,
  lock: LockFile,
  plan: InstallPlan,
): InstallApplyResult {
  const root = resolve(cwd);
  const skipped = plan.willSkip.map((file) => file.relPath);
  const written: string[] = [];
  const nextLock = (): LockFile => ({
    schemaVersion: config.schemaVersion,
    components: { ...lock.components, [plan.item.name]: plan.lockEntry },
  });

  if (plan.willWrite.length === 0) {
    // Нечего писать: lock переписываем только если он реально расходится
    // (например, впервые фиксируем уже лежащий идентичный файл).
    if (!plan.lockUnchanged) {
      writeLock(root, config, nextLock());
      return { written, skipped, lockWritten: true, lockEntry: plan.lockEntry };
    }
    return { written, skipped, lockWritten: false, lockEntry: plan.lockEntry };
  }

  const tempRoot = join(
    ensureTmpDir(root),
    `install-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const stageDir = join(tempRoot, 'stage');
  const backupDir = join(tempRoot, 'backup');
  const moved: InstallPlanFile[] = [];

  try {
    // 1. Всё содержимое — во временный каталог внутри проекта (rename в
    //    пределах одной ФС; os.tmpdir() на macOS — другой том).
    for (const file of plan.willWrite) {
      const staged = join(stageDir, file.relPath);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, file.content, 'utf-8');
    }

    // 2. Бэкап существующих целей: без него откат частичных перемещений
    //    невозможен (файл был — должен стать прежним, а не исчезнуть).
    for (const file of plan.willWrite) {
      if (!file.existing) continue;
      const backup = join(backupDir, file.relPath);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(file.absPath, backup);
    }

    // 3. Перемещения на целевые места.
    for (const file of plan.willWrite) {
      mkdirSync(dirname(file.absPath), { recursive: true });
      renameSync(join(stageDir, file.relPath), file.absPath);
      moved.push(file);
      written.push(file.relPath);
    }

    // 4. Lock — только после успешных перемещений (атомарная запись, VL-333).
    if (!plan.lockUnchanged) {
      writeLock(root, config, nextLock());
    }
  } catch (err) {
    const problems = rollback(moved, backupDir);
    const suffix =
      problems.length > 0
        ? `; не удалось откатить: ${problems.join('; ')}`
        : '; изменения отменены';
    throw new InstallError(
      `не удалось установить «${plan.ref}»: ${(err as Error).message}${suffix}`,
      3,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  return {
    written,
    skipped,
    lockWritten: !plan.lockUnchanged,
    lockEntry: plan.lockEntry,
  };
}

/**
 * Применяет цепочку планов (зависимости + сам элемент) одной транзакцией.
 *
 * VL-338: `registryDependencies` устанавливаются до элемента, но проект не
 * должен остаться с «половиной» набора. Поэтому temp-каталог один на всю
 * цепочку: сначала пишутся файлы ВСЕХ планов, затем бэкапятся существующие
 * цели, затем перемещения, и только в конце — один `writeLock` со всеми
 * записями. Сбой на любом шаге откатывает все перемещённые файлы.
 *
 * Порядок планов = порядок применения: зависимости идут первыми, поэтому
 * `base` окажется на месте до компонента, который на него ссылается.
 */
export function applyInstallChain(
  cwd: string,
  config: ComponentsConfig,
  lock: LockFile,
  plans: InstallPlan[],
): InstallApplyResult[] {
  const root = resolve(cwd);
  const results: InstallApplyResult[] = plans.map((plan) => ({
    written: [],
    skipped: plan.willSkip.map((file) => file.relPath),
    lockWritten: false,
    lockEntry: plan.lockEntry,
  }));

  const allFiles: InstallPlanFile[] = [];
  for (const plan of plans) allFiles.push(...plan.willWrite);

  const nextLock = (): LockFile => {
    const components = { ...lock.components };
    for (const plan of plans) components[plan.item.name] = plan.lockEntry;
    return { schemaVersion: config.schemaVersion, components };
  };
  const lockChanged = plans.some((plan) => !plan.lockUnchanged);

  if (allFiles.length === 0) {
    if (lockChanged) {
      writeLock(root, config, nextLock());
      for (const result of results) result.lockWritten = true;
    }
    return results;
  }

  const tempRoot = join(
    ensureTmpDir(root),
    `install-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const stageDir = join(tempRoot, 'stage');
  const backupDir = join(tempRoot, 'backup');
  const moved: InstallPlanFile[] = [];

  try {
    for (const file of allFiles) {
      const staged = join(stageDir, file.relPath);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, file.content, 'utf-8');
    }

    for (const file of allFiles) {
      if (!file.existing) continue;
      const backup = join(backupDir, file.relPath);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(file.absPath, backup);
    }

    for (const file of allFiles) {
      mkdirSync(dirname(file.absPath), { recursive: true });
      renameSync(join(stageDir, file.relPath), file.absPath);
      moved.push(file);
    }

    if (lockChanged) writeLock(root, config, nextLock());
  } catch (err) {
    const problems = rollback(moved, backupDir);
    const suffix =
      problems.length > 0
        ? `; не удалось откатить: ${problems.join('; ')}`
        : '; изменения отменены';
    const refs = plans.map((plan) => plan.ref).join(', ');
    throw new InstallError(
      `не удалось установить «${refs}»: ${(err as Error).message}${suffix}`,
      3,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  // Итог по каждому плану: что записано именно им (порядок сохранён).
  for (let i = 0; i < plans.length; i += 1) {
    results[i].written = plans[i].willWrite.map((file) => file.relPath);
    results[i].lockWritten = lockChanged;
  }
  return results;
}

/**
 * Простой построчный diff (без внешних зависимостей).
 *
 * Полноценный unified-diff с LCS здесь избыточен: пользователю нужно понять,
 * что он потеряет при перезаписи, а не читать патч. Строки сравниваются по
 * индексу, вывод ограничен `limit` строками.
 */
export function diffLines(before: string, after: string, limit = 40): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      if (out.length < limit) out.push(`  ${left ?? ''}`);
      continue;
    }
    if (left !== undefined && out.length < limit) out.push(`- ${left}`);
    if (right !== undefined && out.length < limit) out.push(`+ ${right}`);
    if (out.length >= limit) break;
  }
  if (out.length >= limit) out.push('… (diff обрезан)');
  return out;
}
