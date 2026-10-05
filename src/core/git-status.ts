/**
 * Сбор git-статуса незакоммиченных файлов для команды /diff (VL-88).
 *
 * Паттерн src/core/git-user.ts (spawnSync). Read-only: только чтение
 * porcelain/numstat, ничего не коммитится и не меняется в рабочем дереве.
 *
 * core.quotepath=false обязателен для всех вызовов, читающих пути:
 * иначе не-ASCII пути (кириллица) приходят в octal-экранировании
 * ("\321\201...") и не совпадут с numstat (риски плана VL-88).
 * Даже с флагом пути с пробелами приходят в кавычках — снимаем.
 */

import { spawnSync } from 'node:child_process';

/** Маппинг X/Y-кодов porcelain на человекочитаемый статус. */
const STATUS_MAP: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged',
  T: 'Type changed',
};

/** Один файл из git status с числами строк из numstat. */
export interface DiffFile {
  /** Путь из porcelain (раскодированный, без кавычек). */
  path: string;
  /** Для renamed/copied: исходный путь (porcelain "old -> new"). */
  oldPath?: string;
  /** Человекочитаемый статус: Modified/Added/Deleted/Untracked/Renamed/… */
  status: string;
  /** Метка staged: статус из X-колонки (index), не из Y (worktree). */
  staged: boolean;
  /** +N из numstat (staged/unstaged раздельно, 0 для untracked). */
  additions: number;
  /** −N из numstat. */
  deletions: number;
}

/** Результат getGitStatus. */
export interface GitStatus {
  /** Имя текущей ветки (git branch --show-current). */
  branch: string;
  /** Незакоммиченные файлы в порядке porcelain. */
  files: DiffFile[];
}

/**
 * Снимает кавычки C-quoted пути и разэкранирует содержимое.
 *
 * git оборачивает путь в двойные кавычки, если в нём есть спецсимволы
 * (пробел, кавычка, управляющие символы); внутри — escape-последовательности
 * \" \\ \n \t \r и octal \NNN. Обычные пути возвращаются как есть.
 */
function unquotePath(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  return inner.replace(/\\([0-7]{1,3}|.)/g, (_m, esc: string) => {
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
    return map[esc] ?? esc;
  });
}

/**
 * Чистый парсер `git status --porcelain` (тестируется без git).
 *
 * Формат строки: XY PATH (X — index-колонка, Y — worktree-колонка).
 * X != ' ' → запись со staged: true; Y != ' ' → staged: false; обе колонки —
 * две записи (staged не сливается с unstaged, AC VL-88). Untracked (`??`) —
 * одна запись Untracked без numstat. Renamed/copied: "old -> new" → oldPath.
 */
export function parsePorcelain(stdout: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const rawPath = line.slice(3);
    // Ignored-файлы (--ignored не передаём, но на всякий случай пропускаем)
    if (x === '!' && y === '!') continue;
    if (x === '?' && y === '?') {
      files.push({
        path: unquotePath(rawPath),
        status: 'Untracked',
        staged: false,
        additions: 0,
        deletions: 0,
      });
      continue;
    }
    let path = rawPath;
    let oldPath: string | undefined;
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      // Разделитель rename/copy — ровно " -> "; пути с " -> " внутри
      // приходят в кавычках и не ломают split по первому вхождению
      const sep = rawPath.indexOf(' -> ');
      if (sep !== -1) {
        oldPath = unquotePath(rawPath.slice(0, sep));
        path = rawPath.slice(sep + 4);
      }
    }
    path = unquotePath(path);
    const push = (staged: boolean, code: string): void => {
      files.push({
        path,
        ...(oldPath !== undefined ? { oldPath } : {}),
        status: STATUS_MAP[code] ?? code,
        staged,
        additions: 0,
        deletions: 0,
      });
    };
    if (x !== ' ') push(true, x);
    if (y !== ' ') push(false, y);
  }
  return files;
}

/**
 * Чистый парсер `git diff [--cached] --numstat`.
 *
 * Формат строки: ADD<TAB>DEL<TAB>PATH; бинарные/неизвестные счётчики ("-")
 * → 0/0. Для renamed в numstat разделитель "old => new" (не " -> " как в
 * porcelain) — ключ берётся по НОВОМУ пути (сверяется с porcelain).
 */
export function parseNumstat(
  stdout: string
): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, d, ...rest] = parts;
    let path = rest.join('\t');
    const sep = path.indexOf(' => ');
    if (sep !== -1) path = path.slice(sep + 4);
    path = unquotePath(path);
    const num = (s: string): number => (s === '-' ? 0 : Number.parseInt(s, 10) || 0);
    map.set(path, { additions: num(a), deletions: num(d) });
  }
  return map;
}

/**
 * Собирает git-данные проекта: ветка + незакоммиченные файлы со счётчиками.
 *
 * 4 вызова git, все с cwd проекта: branch --show-current, status --porcelain
 * (X/Y-колонки раздельно), diff --numstat (unstaged) и diff --cached --numstat
 * (staged). Счётчики staged-записей берутся из cached-numstat, unstaged — из
 * unstaged-numstat; untracked остаётся 0/0.
 *
 * @param cwd — директория проекта (git-репозиторий)
 * @param env — окружение для запуска git (в тестах — изоляция от глобального конфига)
 * @throws Error «Git недоступен или это не git-репозиторий» — вызывающая сторона ловит и шлёт сообщение в чат
 */
export function getGitStatus(cwd: string, env: NodeJS.ProcessEnv = process.env): GitStatus {
  const run = (args: string[]): string => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf-8', env });
    if (res.error || res.status !== 0) {
      throw new Error('Git недоступен или это не git-репозиторий');
    }
    return res.stdout ?? '';
  };
  // core.quotepath=false — иначе кириллица octal-экранируется и пути
  // porcelain не совпадут с numstat (ловушка рисков плана VL-88)
  const gitArgs = ['-c', 'core.quotepath=false'];
  const branch = run(['branch', '--show-current']).trim();
  const files = parsePorcelain(run([...gitArgs, 'status', '--porcelain']));
  const stagedCounts = parseNumstat(run([...gitArgs, 'diff', '--cached', '--numstat']));
  const unstagedCounts = parseNumstat(run([...gitArgs, 'diff', '--numstat']));
  for (const f of files) {
    const counts = (f.staged ? stagedCounts : unstagedCounts).get(f.path);
    if (counts) {
      f.additions = counts.additions;
      f.deletions = counts.deletions;
    }
  }
  return { branch, files };
}
