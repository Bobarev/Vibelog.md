/**
 * Ядро `vb create` (VL-339, doc-25 §2.1, §4.1): создание нового проекта из
 * шаблона, живущего подпапкой в репозитории шаблонов.
 *
 * Задача модуля — вся последовательность «пустой каталог → работающий проект»:
 * разбор пути шаблона, валидация имени, клонирование подпапки через
 * `sparse-checkout`, проверка манифеста, копирование, установка зависимостей,
 * `scripts.postCreate`, установка `vibelog.components` и `git init` с первым
 * коммитом. CLI (`cli/commands/create.ts`) только разбирает флаги, спрашивает
 * пакетный менеджер и печатает итог.
 *
 * Почему `sparse-checkout`, а не zip-архив (doc-25 §10): спайк показал, что
 * GitVerse отдаёт `--filter=blob:none`, поэтому клонируется только нужная
 * подпапка, а не весь репозиторий шаблонов. Fallback на архив не нужен.
 *
 * Порядок команд клонирования критичен: `sparse-checkout set` **до**
 * `checkout`. Если сделать наоборот, рабочее дерево развернётся полностью —
 * ровно то, чего мы избегаем.
 *
 * Cone-режим разворачивает и корневые файлы репозитория (README, корневой
 * package.json) — это документированное поведение git, а не ошибка. Поэтому
 * копируется ТОЛЬКО `<tmp>/<template>`, а не содержимое `<tmp>`.
 *
 * Совместимость: `git sparse-checkout` появился в git 2.25, а целевая машина
 * проекта — macOS 10.15 Catalina с git 2.24. Для неё есть эквивалентный
 * legacy-путь (`core.sparseCheckout` + `.git/info/sparse-checkout`), который
 * даёт тот же результат. Без него команда не работала бы на целевой ОС.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { commitMessageArgs } from './commit-trailer.js';
import { readComponentsConfig, readLock } from './components-config.js';
import type { ComponentsConfig, LockFile, RegistryEntry } from './components-config.js';
import { detectPackageManager } from './install-deps.js';
import type { DepsRunner, PackageManager } from './install-deps.js';
import {
  applyInstallChain,
  buildInstallPlan,
  fetchInstallContents,
  fetchInstallItem,
  parseInstallPath,
  skipAllConflicts,
} from './install.js';
import type { InstallContext } from './install.js';
import { DEFAULT_REGISTRY_BASE } from './registry-fetch.js';

/** Код выхода CLI (doc-25 §5.2). */
export type CreateExitCode = 1 | 2 | 3 | 5;

/**
 * Ошибка создания проекта с кодом выхода.
 *
 * CLI печатает `message` одной строкой (без стектрейса), поэтому текст
 * самодостаточен и содержит подсказку действия.
 */
export class CreateError extends Error {
  readonly code: CreateExitCode;

  constructor(message: string, code: CreateExitCode) {
    super(message);
    this.name = 'CreateError';
    this.code = code;
  }
}

/** Разобранный путь шаблона `<alias>/<repo>/<template>`. */
export interface TemplatePath {
  alias: string;
  repo: string;
  template: string;
}

/** Результат запуска git-команды (минимальный контракт `spawnSync`). */
export interface GitRunResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

/**
 * Функция запуска git. Инъекция нужна тестам: настоящий `git clone` ходил бы
 * в сеть, а фикстура-репозиторий создаётся локально.
 */
export type GitRunner = (args: string[], cwd: string) => GitRunResult;

/** Установщик компонентов шаблона (инъекция в тестах: без сети). */
export type ComponentsInstaller = (
  paths: string[],
  targetDir: string,
) => Promise<{ installed: string[]; failed: Array<{ path: string; error: string }> }>;

/** Манифест шаблона — то, что читается из `package.json` подпапки. */
export interface TemplateManifest {
  /** `vibelog.type` как есть (для сообщения об ошибке). */
  type?: string;
  /** `vibelog.components` — пути вида `vibelog.md/ui/button`. */
  components: string[];
  /** `scripts.postCreate` — команда, выполняемая после установки зависимостей. */
  postCreate?: string;
}

/** Итог создания проекта — всё, что CLI печатает в финальном блоке. */
export interface CreateResult {
  /** Абсолютный путь созданного проекта. */
  targetDir: string;
  /** `<alias>/<repo>/<template>` как ввёл пользователь. */
  ref: string;
  branch: string;
  /** Пакетный менеджер (null — установка пропущена через `--no-install`). */
  packageManager: PackageManager | null;
  installedComponents: string[];
  failedComponents: Array<{ path: string; error: string }>;
  /** Выполненные скрипты шаблона (`postCreate`). */
  scriptsRun: string[];
  /** Состояние git: инициализирован, пропущен флагом или git недоступен. */
  git: 'initialized' | 'skipped' | 'unavailable';
  warnings: string[];
}

/** Опции клонирования подпапки шаблона. */
export interface CloneTemplateOptions {
  owner: string;
  repo: string;
  branch: string;
  /** Имя подпапки шаблона внутри репозитория. */
  template: string;
  /** Куда создавать временный каталог (по умолчанию `os.tmpdir()`). */
  tmpRoot?: string;
  /** База URL клонирования (по умолчанию GitVerse). */
  baseUrl?: string;
  /** Полный URL клонирования — приоритетнее `baseUrl` (инъекция в тестах). */
  cloneUrl?: string;
  /** Рабочий каталог для `git clone` (по умолчанию `process.cwd()`). */
  cwd?: string;
  gitRunner?: GitRunner;
  /** Куда сообщать предупреждения (например, про `--filter` на чужом хосте). */
  onWarning?: (message: string) => void;
}

/** Опции создания проекта. */
export interface CreateProjectOptions {
  /** Текущий рабочий каталог: в нём создаётся `./<name>`. */
  cwd: string;
  name: string;
  /** Строка `<alias>/<repo>/<template>`. */
  template: string;
  branch?: string;
  packageManager?: PackageManager;
  /**
   * Резолвер пакетного менеджера, вызываемый ПОСЛЕ копирования шаблона:
   * только тогда виден lock-файл шаблона, по которому CLI предлагает дефолт.
   */
  resolvePackageManager?: (templateDir: string) => Promise<PackageManager> | PackageManager;
  noInstall?: boolean;
  noGit?: boolean;
  gitRunner?: GitRunner;
  depsRunner?: DepsRunner;
  installComponents?: ComponentsInstaller;
  tmpRoot?: string;
  baseUrl?: string;
  cloneUrl?: string;
  onWarning?: (message: string) => void;
}

/** Каталоги, которые не копируются из шаблона (мусор клона и сборки). */
const COPY_SKIP = new Set(['.git', 'node_modules', 'dist']);

/** Раннер git по умолчанию: настоящий процесс без shell. */
const defaultGitRunner: GitRunner = (args, cwd) => {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    ...(res.error ? { error: res.error } : {}),
  };
};

/** Раннер пакетного менеджера по умолчанию: наследует stdio (прогресс виден). */
const defaultDepsRunner: DepsRunner = (command, args, options) => {
  const res = spawnSync(command, args, { cwd: options.cwd, stdio: 'inherit' });
  return { status: res.status, ...(res.error ? { error: res.error } : {}) };
};

/** Последние строки stderr — для сообщения об ошибке git. */
function tail(text: string | undefined, lines = 3): string {
  const value = (text ?? '').trim();
  if (value === '') return 'без вывода';
  return value.split('\n').slice(-lines).join(' | ');
}

/**
 * Разбирает путь шаблона `<alias>/<repo>/<template>`.
 *
 * Ровно три непустых сегмента: иное число — ошибка использования (код 1) с
 * примером. Пустые сегменты (`a//b`) отклоняются так же — иначе клонировался
 * бы каталог с пустым именем.
 */
export function parseTemplatePath(raw: string): TemplatePath {
  const value = String(raw ?? '').trim();
  const parts = value.split('/');
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) {
    throw new CreateError(
      `неверный формат шаблона «${value}»: ожидалось <alias>/<repo>/<template>, например vibelog.md/templates/svelte-minimal`,
      1,
    );
  }
  return { alias: parts[0], repo: parts[1], template: parts[2] };
}

/**
 * Проверяет имя проекта по правилам npm.
 *
 * @returns текст ошибки либо `null`, если имя допустимо
 */
export function validateProjectName(name: string): string | null {
  const value = String(name ?? '');
  if (value.trim() === '') return 'имя проекта не может быть пустым';
  if (value !== value.trim()) return 'имя проекта не может начинаться или заканчиваться пробелом';
  if (value.length > 214) return 'имя проекта длиннее 214 символов';
  if (/[A-Z]/.test(value)) {
    return 'имя проекта должно быть в нижнем регистре: заглавные буквы недопустимы';
  }
  if (/\s/.test(value)) return 'имя проекта не может содержать пробелы';
  if (!/^[a-z0-9._-]+$/.test(value)) {
    return 'в имени проекта допустимы только строчные латинские буквы, цифры и символы «-», «_», «.»';
  }
  if (value.startsWith('.') || value.startsWith('_')) {
    return 'имя проекта не может начинаться с «.» или «_»';
  }
  if (value.startsWith('-')) return 'имя проекта не может начинаться с «-»';
  return null;
}

/**
 * Ветка шаблона: флаг → `registries[alias].branch` → `master`.
 *
 * Отсутствие секции `components` (команда запускается вне проекта) — не
 * ошибка: `vb create` работает и в пустом каталоге, где настроек ещё нет.
 */
export function resolveTemplateBranch(cwd: string, alias: string, flag?: string): string {
  if (flag !== undefined && flag.trim() !== '') return flag.trim();
  try {
    const config = readComponentsConfig(cwd);
    const entry: RegistryEntry | undefined = config?.registries[alias];
    if (entry && typeof entry.branch === 'string' && entry.branch.trim() !== '') {
      return entry.branch.trim();
    }
  } catch {
    // Битые настройки не должны мешать созданию проекта: ветка по умолчанию
    // рабочая (в репозиториях GitVerse ветки `main` нет).
  }
  return 'master';
}

/**
 * Клонирует подпапку шаблона во временный каталог.
 *
 * Последовательность строго фиксирована (doc-25 §4.1 шаг 3): `sparse-checkout
 * set` до `checkout`, иначе развернётся всё дерево. Возвращается и временный
 * каталог (его уборка — на вызывающем коде через `finally`), и найденный
 * каталог шаблона.
 */
export function cloneTemplate(options: CloneTemplateOptions): {
  tmp: string;
  templateDir: string;
} {
  const git = options.gitRunner ?? defaultGitRunner;
  const tmpRoot = options.tmpRoot ?? tmpdir();
  const tmp = mkdtempSync(join(tmpRoot, 'vb-create-'));
  try {
    return cloneInto(tmp, options, git);
  } catch (err) {
    // Каталог создан здесь — здесь и убирается: вызывающий код ещё не знает
    // путь, если клонирование упало (иначе `vb-create-*` оставался бы в
    // os.tmpdir() после каждой ошибки).
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** Тело `cloneTemplate`: все шаги клонирования в готовом временном каталоге. */
function cloneInto(
  tmp: string,
  options: CloneTemplateOptions,
  git: GitRunner,
): { tmp: string; templateDir: string } {
  const url =
    options.cloneUrl ??
    `${options.baseUrl ?? DEFAULT_REGISTRY_BASE}/${options.owner}/${options.repo}.git`;
  const cloneCwd = options.cwd ?? process.cwd();

  const run = (args: string[], cwd: string, what: string): GitRunResult => {
    const res = git(args, cwd);
    if (res.error) {
      throw new CreateError(`git ${what}: ${res.error.message}`, 3);
    }
    if (res.status !== 0) {
      throw new CreateError(`git ${what}: ${tail(res.stderr)}`, 3);
    }
    return res;
  };

  const cloned = run(
    ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', '--branch', options.branch, url, tmp],
    cloneCwd,
    'clone',
  );
  // Хост может не поддерживать partial clone: это предупреждение, а не
  // ошибка — клон всё равно рабочий, просто тяжелее (на GitVerse не бывает).
  if ((cloned.stderr ?? '').includes('filtering not recognized by server')) {
    options.onWarning?.(
      'сервер не поддерживает частичное клонирование (--filter=blob:none) — шаблон скачан целиком',
    );
  }

  const sparseInit = git(['sparse-checkout', 'init', '--cone'], tmp);
  // Путь шаблона внутри репозитория бывает двух видов: подпапка в корне
  // (`svelte-minimal/` — так устроен репозиторий `templates`) и вложенная в
  // одноимённый каталог (`templates/svelte-minimal/`). Оба варианта
  // запрашиваются сразу: cone-режим принимает список каталогов, а лишний
  // несуществующий путь git молча игнорирует. Иначе пришлось бы клонировать
  // дважды, чтобы угадать раскладку.
  const sparsePaths = sparseCandidates(options.repo, options.template);
  if (sparseInit.status === 0) {
    run(['sparse-checkout', 'set', ...sparsePaths], tmp, 'sparse-checkout set');
  } else if (isSparseUnsupported(sparseInit)) {
    // git < 2.25 (macOS 10.15 Catalina): команды `sparse-checkout` нет, но
    // механизм тот же — конфиг + файл шаблонов. Результат идентичен cone-режиму.
    enableLegacySparseCheckout(tmp, sparsePaths, git);
  } else {
    throw new CreateError(`git sparse-checkout init: ${tail(sparseInit.stderr)}`, 3);
  }

  run(['checkout', options.branch], tmp, 'checkout');

  const templateDir = findTemplateDir(tmp, sparsePaths);
  if (templateDir === null) {
    throw new CreateError(
      `шаблон «${options.template}» не найден в репозитории ${options.owner}/${options.repo} (ветка ${options.branch}): проверьте имя шаблона и ветку`,
      3,
    );
  }
  return { tmp, templateDir };
}

/** Возможные пути шаблона внутри репозитория (в порядке приоритета). */
export function sparseCandidates(repo: string, template: string): string[] {
  const paths = [template];
  const nested = `${repo}/${template}`;
  if (nested !== template) paths.push(nested);
  return paths;
}

/** Первый существующий каталог шаблона среди кандидатов. */
function findTemplateDir(tmp: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const dir = join(tmp, candidate);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/** Старый git не знает `sparse-checkout` — это не поломка, а версия. */
function isSparseUnsupported(res: GitRunResult): boolean {
  const text = `${res.stderr ?? ''}${res.stdout ?? ''}`;
  return (
    text.includes('is not a git command') ||
    text.includes('unknown subcommand') ||
    text.includes('not a git command')
  );
}

/** Legacy-включение sparse-checkout для git < 2.25. */
function enableLegacySparseCheckout(tmp: string, paths: string[], git: GitRunner): void {
  const res = git(['config', 'core.sparseCheckout', 'true'], tmp);
  if (res.status !== 0) {
    throw new CreateError(`git config core.sparseCheckout: ${tail(res.stderr)}`, 3);
  }
  const infoDir = join(tmp, '.git', 'info');
  mkdirSync(infoDir, { recursive: true });
  // Ведущий и замыкающий слэши — формат шаблонов sparse-checkout: каталог
  // целиком, родительские каталоги git добавляет сам.
  const patterns = paths.map((path) => `/${path}/`).join('\n');
  writeFileSync(join(infoDir, 'sparse-checkout'), `${patterns}\n`, 'utf-8');
}

/**
 * Рекурсивно копирует каталог, пропуская `.git`, `node_modules`, `dist`.
 *
 * `.git` обязателен в списке исключений: скопированный git-каталог сломал бы
 * последующий `git init` (репозиторий уже существует).
 */
export function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isSymbolicLink()) {
      // Симлинки шаблона копируем как файлы: цель может отсутствовать в
      // подпапке (она осталась в неразвёрнутой части репозитория).
      copyFileSync(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    }
  }
}

/**
 * Читает и проверяет `package.json` шаблона.
 *
 * `vibelog.type !== "template"` — код 3 с фактическим значением: самая частая
 * причина — опечатка в имени подпапки, из-за которой скопировался обычный
 * пакет монорепозитория.
 */
export function readTemplateManifest(templateDir: string): TemplateManifest {
  const path = join(templateDir, 'package.json');
  if (!existsSync(path)) {
    throw new CreateError(
      `в шаблоне нет package.json (${path}): это не шаблон Vibelog — проверьте путь --template`,
      3,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new CreateError(`package.json шаблона не разбирается: ${(err as Error).message}`, 3);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CreateError('package.json шаблона: ожидался JSON-объект', 3);
  }
  const pkg = raw as Record<string, unknown>;
  const vibelog = pkg.vibelog;
  const meta =
    vibelog !== null && typeof vibelog === 'object' && !Array.isArray(vibelog)
      ? (vibelog as Record<string, unknown>)
      : {};
  const type = typeof meta.type === 'string' ? meta.type : undefined;
  if (type !== 'template') {
    throw new CreateError(
      type === undefined
        ? 'package.json шаблона: поле vibelog.type отсутствует, ожидалось "template"'
        : `package.json шаблона: vibelog.type = "${type}", ожидалось "template"`,
      3,
    );
  }
  const components = Array.isArray(meta.components)
    ? meta.components.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  const scripts = pkg.scripts;
  const postCreate =
    scripts !== null && typeof scripts === 'object' && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>).postCreate
      : undefined;
  return {
    type,
    components,
    ...(typeof postCreate === 'string' && postCreate.trim() !== ''
      ? { postCreate: postCreate.trim() }
      : {}),
  };
}

/**
 * Устанавливает компоненты шаблона логикой `vb install` (VL-337/338).
 *
 * Корень проекта — сам созданный каталог, а НЕ git-корень: `vb create` может
 * запускаться внутри другого репозитория, и `findGitRoot` увёл бы установку в
 * родительский проект.
 *
 * Ошибка одного компонента не отменяет создание проекта: проект уже рабочий,
 * а неудачные пути перечисляются в итоге.
 */
export async function installTemplateComponents(
  paths: string[],
  targetDir: string,
): Promise<{ installed: string[]; failed: Array<{ path: string; error: string }> }> {
  const installed: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  if (paths.length === 0) return { installed, failed };

  let config: ComponentsConfig | null;
  let lock: LockFile;
  try {
    config = readComponentsConfig(targetDir);
    if (config === null) {
      throw new Error('секция components не найдена в .vibelog/settings.json');
    }
    lock = readLock(targetDir, config);
  } catch (err) {
    const message = (err as Error).message;
    for (const path of paths) failed.push({ path, error: message });
    return { installed, failed };
  }

  for (const ref of paths) {
    try {
      const { alias, repo, name } = parseInstallPath(ref);
      const registry = config.registries[alias];
      if (!registry) {
        throw new Error(`неизвестный реестр «${alias}»`);
      }
      const ctx: InstallContext = {
        root: resolve(targetDir),
        config,
        lock,
        alias,
        repo,
        name,
        branch: registry.branch,
        registry,
        ref,
      };
      const item = await fetchInstallItem(ctx);
      const contents = await fetchInstallContents(ctx, item);
      const plan = buildInstallPlan(ctx.root, config, lock, item, contents, ref);
      // Конфликтов в свежем проекте быть не должно; если файл всё же есть
      // (его создал postCreate) — не перезаписываем без спроса.
      skipAllConflicts(plan, lock);
      applyInstallChain(ctx.root, config, lock, [plan]);
      installed.push(ref);
    } catch (err) {
      failed.push({ path: ref, error: (err as Error).message });
    }
  }
  return { installed, failed };
}

/**
 * Создаёт проект из шаблона.
 *
 * Временный каталог клона удаляется в `finally` при любом исходе: и при
 * успехе, и при ошибке клонирования, и при падении `postCreate`.
 */
export async function createProject(options: CreateProjectOptions): Promise<CreateResult> {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    options.onWarning?.(message);
  };

  const nameError = validateProjectName(options.name);
  if (nameError !== null) {
    throw new CreateError(`${nameError} (получено «${options.name}»); перезапись не предусмотрена`, 1);
  }
  const { alias, repo, template } = parseTemplatePath(options.template);
  const targetDir = resolve(options.cwd, options.name);
  if (existsSync(targetDir)) {
    throw new CreateError(
      `каталог «${options.name}» уже существует: ${targetDir}; флаг --force не поддерживается — выберите другое имя или удалите каталог`,
      2,
    );
  }

  const branch = resolveTemplateBranch(options.cwd, alias, options.branch);
  const ref = `${alias}/${repo}/${template}`;
  const git = options.gitRunner ?? defaultGitRunner;
  const depsRunner = options.depsRunner ?? defaultDepsRunner;

  let tmp: string | null = null;
  let manifest: TemplateManifest;
  try {
    const cloned = cloneTemplate({
      owner: alias,
      repo,
      branch,
      template,
      ...(options.tmpRoot !== undefined ? { tmpRoot: options.tmpRoot } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.cloneUrl !== undefined ? { cloneUrl: options.cloneUrl } : {}),
      cwd: options.cwd,
      gitRunner: git,
      onWarning: warn,
    });
    tmp = cloned.tmp;
    // Манифест проверяется ДО создания каталога проекта: иначе при ошибке
    // остался бы пустой каталог, который потом блокирует повторный запуск.
    manifest = readTemplateManifest(cloned.templateDir);
    copyDir(cloned.templateDir, targetDir);
  } finally {
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
  }

  const result: CreateResult = {
    targetDir,
    ref,
    branch,
    packageManager: null,
    installedComponents: [],
    failedComponents: [],
    scriptsRun: [],
    git: 'skipped',
    warnings,
  };

  // --- Зависимости и postCreate ---
  if (options.noInstall === true) {
    // --no-install: ни пакетного менеджера, ни postCreate, ни компонентов —
    // пользователь попросил не трогать зависимости, а postCreate и установка
    // компонентов обычно их требуют (и ходят в сеть).
    return finishGit(result, options, git, ref, warn);
  }

  const pm =
    options.packageManager ??
    (options.resolvePackageManager
      ? await options.resolvePackageManager(targetDir)
      : detectPackageManager(targetDir));
  result.packageManager = pm;

  const install = depsRunner(pm, ['install'], { cwd: targetDir });
  if (install.error) {
    throw new CreateError(
      `не удалось запустить «${pm} install»: ${install.error.message}; проект сохранён в ${targetDir} — установите зависимости вручную`,
      3,
    );
  }
  if (install.status !== 0) {
    throw new CreateError(
      `«${pm} install» завершился с кодом ${install.status ?? 'неизвестно'}; проект сохранён в ${targetDir} — исправьте и запустите вручную`,
      3,
    );
  }

  if (manifest.postCreate !== undefined) {
    const post = depsRunner(pm, ['run', 'postCreate'], { cwd: targetDir });
    if (post.error || post.status !== 0) {
      // doc-25 §8 п.5: каталог НЕ удаляется — в нём уже лежит рабочий код,
      // и повторная установка зависимостей дороже ручной правки скрипта.
      const reason = post.error ? post.error.message : `код ${post.status ?? 'неизвестно'}`;
      throw new CreateError(
        `scripts.postCreate завершился с ошибкой (${reason}); проект сохранён в ${targetDir} — исправьте и запустите «${pm} run postCreate» вручную`,
        3,
      );
    }
    result.scriptsRun.push('postCreate');
  }

  // --- Компоненты шаблона (после postCreate: он создаёт секцию components) ---
  if (manifest.components.length > 0) {
    const installer = options.installComponents ?? installTemplateComponents;
    const outcome = await installer(manifest.components, targetDir);
    result.installedComponents = outcome.installed;
    result.failedComponents = outcome.failed;
    for (const failure of outcome.failed) {
      warn(`компонент «${failure.path}» не установлен: ${failure.error}`);
    }
  }

  return finishGit(result, options, git, ref, warn);
}

/**
 * Шаг git: `init` + `add -A` + первый коммит с трейлером.
 *
 * Недоступный git — предупреждение, а не ошибка: проект уже создан и рабочий,
 * а `git init` пользователь может выполнить сам.
 */
function finishGit(
  result: CreateResult,
  options: CreateProjectOptions,
  git: GitRunner,
  ref: string,
  warn: (message: string) => void,
): CreateResult {
  if (options.noGit === true) {
    result.git = 'skipped';
    return result;
  }
  const cwd = result.targetDir;
  const init = git(['init'], cwd);
  if (init.error || init.status !== 0) {
    result.git = 'unavailable';
    warn(
      `git init не выполнен (${init.error ? init.error.message : tail(init.stderr)}): проект создан, инициализируйте репозиторий вручную`,
    );
    return result;
  }
  result.git = 'initialized';

  const add = git(['add', '-A'], cwd);
  if (add.error || add.status !== 0) {
    warn(`git add -A не выполнен: ${add.error ? add.error.message : tail(add.stderr)}`);
    return result;
  }
  const commit = git(
    ['commit', ...commitMessageArgs(cwd, `Initial commit from ${ref}`)],
    cwd,
  );
  if (commit.error || commit.status !== 0) {
    warn(
      `первый коммит не создан (${commit.error ? commit.error.message : tail(commit.stderr)}): файлы добавлены в индекс, закоммитьте вручную`,
    );
  }
  return result;
}
