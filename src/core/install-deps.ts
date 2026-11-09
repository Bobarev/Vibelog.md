/**
 * Сверка npm-зависимостей элемента реестра с проектом (VL-338, doc-25 §3.3,
 * §4.3 шаг 6).
 *
 * Элемент реестра объявляет `dependencies` — имена пакетов без версий
 * (`["clsx", "tailwind-merge"]`). Задача модуля — ответить на два вопроса:
 * «чего не хватает в проекте» и «какой командой это доустановить». Сама
 * установка — тонкая обёртка над `spawnSync` с инъекцией раннера: в тестах
 * нельзя запускать настоящий пакетный менеджер (сеть, минуты, побочные
 * эффекты в `node_modules`).
 *
 * Почему список пакетов берётся ТОЛЬКО из JSON реестра (decision-9 п.8):
 * CLI не содержит перечня «известных пакетов». Иначе каждая новая
 * зависимость компонента требовала бы релиза CLI, а расхождение списка с
 * реестром давало бы ложные «всё установлено».
 *
 * Почему `--yes` не устанавливает пакеты (решение задачи): `--yes` означает
 * «не задавай вопросов», а не «правь мой package.json». Молчаливая установка
 * зависимостей меняет состав проекта и его lock-файл — это действие, которое
 * пользователь должен подтвердить явно.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Поддерживаемые пакетные менеджеры. */
export type PackageManager = 'pnpm' | 'npm' | 'bun' | 'yarn';

/**
 * Lock-файлы в порядке приоритета (doc-25 §4.3 шаг 6).
 *
 * Порядок массива — и есть приоритет: pnpm → bun → yarn → npm. Проект может
 * содержать несколько lock-файлов (остались от миграции), и выбирать
 * «первый попавшийся» из `readdir` нельзя — результат зависел бы от ФС.
 */
const LOCK_FILES: ReadonlyArray<{ file: string; pm: PackageManager }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'bun.lock', pm: 'bun' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'package-lock.json', pm: 'npm' },
];

/** Результат запуска пакетного менеджера. */
export interface DepsRunResult {
  /** Команда завершилась кодом 0. */
  ok: boolean;
  /** Фактически использованный менеджер (может отличаться при fallback). */
  pm: PackageManager;
  /** Полная команда: `[bin, ...args]`. */
  command: string[];
  /** Текст ошибки запуска (ENOENT, права) — не код выхода. */
  error?: string;
  /** Менеджер, который не нашёлся и был заменён на npm. */
  fallbackFrom?: PackageManager;
}

/** Минимальный контракт результата `spawnSync` (для инъекции в тестах). */
export interface DepsRunnerResult {
  status: number | null;
  error?: Error;
}

/**
 * Функция запуска процесса. Инъекция нужна тестам: `stdio: 'inherit'` в
 * vitest неудобен, а настоящий `pnpm add` ходил бы в сеть.
 *
 * `env` — окружение дочернего процесса (VL-386). Передаётся только там, где
 * дочернему процессу нужно знать про путь к CLI (`vb create` → `postCreate`);
 * по умолчанию `spawnSync` наследует `process.env`.
 */
export type DepsRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => DepsRunnerResult;

/**
 * Определяет пакетный менеджер проекта по lock-файлу.
 *
 * Ни одного lock-файла → `npm`: это менеджер по умолчанию у Node.js, и
 * предлагать пользователю команду, которой у него может не быть, хуже, чем
 * самую распространённую.
 */
export function detectPackageManager(cwd: string): PackageManager {
  for (const { file, pm } of LOCK_FILES) {
    if (existsSync(join(cwd, file))) return pm;
  }
  return 'npm';
}

/**
 * Команда установки пакетов.
 *
 * Возвращается массив аргументов, а не строка: запуск идёт через `spawnSync`
 * без shell (как в `core/git.ts`), поэтому имена пакетов не могут быть
 * истолкованы как shell-синтаксис.
 */
export function installCommand(pm: PackageManager, packages: string[]): string[] {
  switch (pm) {
    case 'pnpm':
      return ['pnpm', 'add', ...packages];
    case 'bun':
      return ['bun', 'add', ...packages];
    case 'yarn':
      return ['yarn', 'add', ...packages];
    case 'npm':
    default:
      return ['npm', 'install', ...packages];
  }
}

/**
 * Пакеты, уже объявленные в проекте: `dependencies` + `devDependencies`.
 *
 * `devDependencies` учитываются намеренно: пакет, стоящий в dev-секции, всё
 * равно резолвится при сборке, и предлагать его повторно — шум. Нет
 * `package.json` — пустое множество, а не ошибка: `vb init` не требует
 * конкретного стека (decision-9), и `vb install` в таком проекте должен
 * работать, просто предложив поставить всё.
 */
export function readProjectDeps(cwd: string): Set<string> {
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) return new Set();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    // Битый package.json — не повод падать: считаем, что зависимостей нет,
    // и предложим установку (пользователь увидит команду целиком).
    return new Set();
  }
  const out = new Set<string>();
  if (raw === null || typeof raw !== 'object') return out;
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const value = (raw as Record<string, unknown>)[section];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const name of Object.keys(value as Record<string, unknown>)) out.add(name);
  }
  return out;
}

/**
 * Отсутствующие в проекте зависимости элемента.
 *
 * Порядок объявления из элемента сохраняется: вывод детерминирован, а
 * команда установки читается так же, как манифест реестра.
 */
export function missingDeps(
  item: { dependencies: string[] },
  projectDeps: Set<string>,
): string[] {
  const out: string[] = [];
  for (const name of item.dependencies) {
    if (!projectDeps.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Раннер по умолчанию: настоящий процесс с наследованием stdio. */
const defaultDepsRunner: DepsRunner = (command, args, options) => {
  // env передаётся, только если вызывающий его задал (VL-386): явный
  // `env: undefined` в spawnSync заменяет окружение на пустое на некоторых
  // платформах, поэтому поле добавляется условно.
  const res = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'inherit',
    ...(options.env !== undefined ? { env: options.env } : {}),
  });
  return { status: res.status, ...(res.error ? { error: res.error } : {}) };
};

/**
 * Запускает установку пакетов.
 *
 * `ENOENT` (менеджер определён по lock-файлу, но не установлен) — не тупик:
 * пробуем `npm` и сообщаем об этом через `fallbackFrom`. Иначе пользователь
 * получил бы «spawn pnpm ENOENT» без подсказки, что делать.
 */
export function runDepsInstall(
  pm: PackageManager,
  packages: string[],
  cwd: string,
  runner: DepsRunner = defaultDepsRunner,
): DepsRunResult {
  const command = installCommand(pm, packages);
  const res = runner(command[0], command.slice(1), { cwd });
  const code = (res.error as NodeJS.ErrnoException | undefined)?.code;
  if (res.error && code === 'ENOENT' && pm !== 'npm') {
    const fallback = installCommand('npm', packages);
    const retry = runner(fallback[0], fallback.slice(1), { cwd });
    return {
      ok: retry.status === 0,
      pm: 'npm',
      command: fallback,
      fallbackFrom: pm,
      ...(retry.error ? { error: retry.error.message } : {}),
    };
  }
  return {
    ok: res.status === 0,
    pm,
    command,
    ...(res.error ? { error: res.error.message } : {}),
  };
}

/** Человекочитаемая команда для подсказки в выводе. */
export function formatCommand(command: string[]): string {
  return command.join(' ');
}
