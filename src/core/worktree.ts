/**
 * Git-worktree для параллельной разработки задач (VL-107).
 *
 * Каждая задача получает ветку `vb/vl-N` и worktree `.vibelog/worktrees/vl-N`:
 * фазы агента работают в изолированном дереве ветки, не мешая главному
 * рабочему дереву. Worktree выбран вместо `dist/VL-N` (первоначальная идея
 * из описания задачи), потому что:
 *   - `package.json.files` включает `dist` — сборки веток попали бы в npm;
 *   - `pnpm build` главного репо делает `rmSync('dist')` — стёр бы веточные сборки;
 *   - `.vibelog/` уже в `.gitignore` — git status главного репо чист.
 *
 * Worktree лежит ВНУТРИ проекта — рантайм-зависимости (grammy, ink, react,
 * undici) резолвятся walk-up в главный node_modules: перезапущенный бот из
 * ветки работает без `pnpm install` в worktree.
 *
 * Backlog живёт ТОЛЬКО в главном репо: MCP-сервер получает VIBELOG_CWD с
 * корнем главного репозитория (см. cli/commands/mcp.ts) — статусы и
 * комментарии задач пишутся в общий backlog/, worktree-копия backlog
 * не трогается, merge ветки не конфликтует с задачами.
 */

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Кэш ensure в памяти процесса: ключ `cwd\0taskId` → путь worktree.
 *
 * Ключ включает cwd: тесты (и редкие кейсы нескольких проектов) создают
 * worktree для одного taskId в разных репозиториях — кэш по одному taskId
 * вернул бы чужой путь. Гарантирует идемпотентность повторного ensure
 * (повторный вызов не трогает git). ensure синхронный (spawnSync) — параллельного
 * выполнения двух ensure в одном процессе нет, поэтому Promise-кэш не нужен.
 */
const ensureCache = new Map<string, string>();

/** Имя ветки задачи: VL-107 → vb/vl-107 (без учёта регистра ID). */
export function taskBranchName(taskId: string): string {
  return 'vb/' + taskId.toLowerCase();
}

/** Путь worktree задачи: <cwd>/.vibelog/worktrees/<id в нижнем регистре>. */
export function taskWorktreeDir(cwd: string, taskId: string): string {
  return join(cwd, '.vibelog', 'worktrees', taskId.toLowerCase());
}

/** Текущая ветка директории (git -C dir branch --show-current) либо null. */
function currentBranch(dir: string): string | null {
  const res = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf-8' });
  if (res.error || res.status !== 0) return null;
  return (res.stdout ?? '').trim() || null;
}

/**
 * Гарантирует наличие worktree для задачи; возвращает путь к нему.
 *
 * Три исхода:
 *   1. директория — worktree на нужной ветке → вернуть путь (идемпотентность);
 *   2. ветка существует, worktree нет → `git worktree add <dir> <branch>`;
 *   3. ни того, ни другого → `git worktree add -b <branch> <dir> HEAD`
 *      (база — текущий HEAD главного репо; НЕЗАКОММИЧЕННЫЕ изменения главного
 *      дерева в ветку не попадают — worktree создаётся от закоммиченного HEAD).
 *
 * @param cwd — корень главного git-репозитория проекта
 * @param taskId — ID задачи (VL-107)
 * @returns абсолютный путь к worktree
 * @throws Error на русском — git недоступен, не git-репо, конфликт веток/директорий
 */
export function ensureTaskWorktree(cwd: string, taskId: string): string {
  const cacheKey = `${cwd}\u0000${taskId}`;
  const cached = ensureCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const dir = taskWorktreeDir(cwd, taskId);
  const branch = taskBranchName(taskId);

  // 1) Уже worktree на нужной ветке → идемпотентность
  if (existsSync(join(dir, '.git'))) {
    const b = currentBranch(dir);
    if (b === branch) {
      ensureCache.set(cacheKey, dir);
      return dir;
    }
    throw new Error(
      `Директория ${dir} — worktree на ветке ${b ?? '(неизвестно)'}, ожидается ${branch}. ` +
        `Удалите её вручную: git worktree remove ${dir}`
    );
  }

  // 2) Ветка существует → добавить worktree на существующей ветке;
  // 3. нет → создать ветку от HEAD. rev-parse --verify различает случаи по
  //    exit-коду — stderr не парсим (локаль-независимо, паттерн git.ts).
  const branchExists =
    spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      encoding: 'utf-8',
    }).status === 0;
  // git worktree add создаёт только последний сегмент пути — родительские
  // директории (.vibelog/worktrees) готовим сами
  mkdirSync(dirname(dir), { recursive: true });
  const args = branchExists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', '-b', branch, dir, 'HEAD'];
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (res.error || res.status !== 0) {
    const detail = (res.stderr ?? res.error?.message ?? '').trim();
    throw new Error(`Не удалось создать worktree для ${taskId}: ${detail}`);
  }

  // Дев-зависимости worktree: node_modules и refs не в git (см. .gitignore)
  // и в worktree отсутствуют — без них pnpm test/build и compat-тесты
  // (refs/Backlog.md) в ветке не работают. Симлинки на главные каталоги:
  // пакетный менеджер и git их игнорируют, обновления main сразу видны.
  linkWorktreeDeps(dir, cwd);

  ensureCache.set(cacheKey, dir);
  return dir;
}

/**
 * Создаёт симлинки node_modules и refs из главного репо в worktree.
 *
 * Идемпотентно: существующие файлы/каталоги/симлинки не трогаются —
 * повторный ensure или worktree с реальным node_modules (после pnpm install)
 * не ломаются. Если в главном репо каталога нет (свежий клон без refs) —
 * симлинк не создаётся.
 *
 * @param dir — путь worktree задачи
 * @param cwd — корень главного репозитория (там лежат node_modules/refs)
 */
function linkWorktreeDeps(dir: string, cwd: string): void {
  for (const name of ['node_modules', 'refs']) {
    const target = join(cwd, name);
    const link = join(dir, name);
    // lstat — битый симлинк (наследие) тоже считаем «занятым» и не трогаем
    const linkTaken = existsSync(link) || (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() ?? false);
    if (!existsSync(target) || linkTaken) continue;
    try {
      symlinkSync(target, link, 'dir');
    } catch {
      // гонка/отсутствие прав не должна ронять ensure — тесты сообщат сами
    }
  }
}

/**
 * Собирает worktree задачи главным tsc (без сети, без pnpm install).
 *
 * Сборка идёт из ГЛАВНОГО node_modules (`node <cwd>/node_modules/typescript/
 * lib/tsc.js -p <worktree>`): worktree внутри проекта резолвит типы/импорты
 * walk-up в главный node_modules. Перед сборкой dist worktree удаляется —
 * мусор от прошлых сборок не попадает в результат.
 *
 * @param cwd — корень главного репозитория (там лежит node_modules с typescript)
 * @param taskId — ID задачи; worktree должен быть создан ensureTaskWorktree
 * @throws Error на русском — нет typescript (подсказка pnpm install), tsc упал
 *   (хвост stderr), или не создался ожидаемый dist/cli/router.js
 */
export function buildTaskWorktree(cwd: string, taskId: string): void {
  const dir = taskWorktreeDir(cwd, taskId);
  rmSync(join(dir, 'dist'), { recursive: true, force: true });

  const tscPath = join(cwd, 'node_modules', 'typescript', 'lib', 'tsc.js');
  if (!existsSync(tscPath)) {
    throw new Error(
      `Не удалось собрать ветку ${taskId}: typescript не найден (${tscPath}) — выполните pnpm install`
    );
  }

  const res = spawnSync(process.execPath, [tscPath, '-p', dir], { cwd, encoding: 'utf-8' });
  if (res.status !== 0) {
    const tail = (res.stderr ?? '').trim().slice(-500);
    throw new Error(`Сборка ветки ${taskId} завершилась с ошибкой (код ${res.status}): ${tail}`);
  }
  if (!existsSync(join(dir, 'dist', 'cli', 'router.js'))) {
    throw new Error(
      `Сборка ветки ${taskId} не создала dist/cli/router.js — проверьте tsconfig в ветке ${taskBranchName(taskId)}`
    );
  }
}

/** Путь к CLI внутри worktree: <worktree>/bin/vibelog.mjs (исполняет dist ветки). */
export function worktreeCliPath(cwd: string, taskId: string): string {
  return join(taskWorktreeDir(cwd, taskId), 'bin', 'vibelog.mjs');
}
