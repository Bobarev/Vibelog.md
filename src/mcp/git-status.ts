/**
 * MCP-инструмент `git_status` — read-only снимок рабочего дерева (VL-416).
 *
 * Зачем: `git_commit` есть, а посмотреть, что НЕ закоммичено, — нет. В сессии
 * агента из проекта Vibelog UI (отчёт UI-1, принят как VL-388) незакоммиченные
 * настройки заметил человек, а не агент: инструмента чтения состояния дерева
 * не существовало, и `run_shell_command` с `git status` — единственный путь,
 * который модель регулярно забывала.
 *
 * Границы (сознательно узко):
 *   - git-код НЕ дублируется: секция собирается `collectGit` из
 *     `src/core/status.ts` (тот же `spawnSync('git', …)` без shell, что у
 *     `vibelog status`). `collectStatus` целиком не вызывается — он тянет
 *     задачи, автоочередь и grant, а MCP-слою это не нужно (и притащило бы
 *     `web/orchestrator` в реестр инструментов).
 *   - `paths` — необязательное сужение: `git status --porcelain -- <paths>`
 *     по явным путям внутри проекта (вопрос «грязен ли файл задачи перед
 *     коммитом»). Пути резолвятся `resolveInProject`, выход наружу — отказ.
 *   - вне git-репозитория — НЕ ошибка: `ackRead` с `git: null`.
 *   - сбой git (`git.error`) — `ackError` с исходным текстом: выдавать сбой за
 *     «дерево чисто» нельзя, иначе агент закоммитит поверх чужой работы.
 */

import { spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { collectGit } from '../core/status.js';
import { resolveInProject } from '../agent/tools.js';
import { ackError, ackRead } from './tool-result.js';

/** Аргументы `git_status` (совпадают с inputSchema инструмента). */
export interface GitStatusOptions {
  /** Явные пути (относительно проекта) — сузить вывод `git status`. */
  paths?: string[];
}

/** Одна строка `git status --porcelain`: код + путь. */
export interface PorcelainEntry {
  /** Двухбуквенный код статуса (`M`, `??`, `A `, …). */
  code: string;
  /** Путь относительно корня проекта (прямые слэши). */
  path: string;
}

/**
 * Разбирает вывод `git status --porcelain` в список записей.
 *
 * Формат: `XY <path>` (позиции 0–1 — код, 2 — пробел). Переименование печатает
 * `R  old -> new` — берём целевую часть (именно она изменилась). Пустые строки
 * и строки короче 4 символов пропускаются (защита от мусора в выводе).
 *
 * @param out — stdout `git status --porcelain`
 * @returns записи в порядке вывода git
 */
export function parsePorcelain(out: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  for (const line of out.split('\n')) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4).trim();
    if (path === '') continue;
    entries.push({ code, path });
  }
  return entries;
}

/**
 * Снимок рабочего дерева для MCP.
 *
 * @param cwd — каталог проекта (cwd вызова MCP)
 * @param opts — `paths` (необязательное сужение вывода)
 * @returns JSON-ack: `ackRead` с `{ git, branch, changed, untracked, ahead,
 *   behind, upstream }` (+ `paths`/`entries` при сужении) либо `ackError`
 *   при сбое git или пути вне проекта
 */
export function gitStatus(cwd: string, opts: GitStatusOptions = {}): string {
  const rawPaths = Array.isArray(opts.paths) ? opts.paths : [];
  const relPaths: string[] = [];
  for (const entry of rawPaths) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      return ackError('git_status: paths — каждый путь должен быть непустой строкой.');
    }
    const resolved = resolveInProject(cwd, entry.trim());
    if (!resolved.ok) return ackError(`git_status: ${resolved.error}`);
    const rel = relative(cwd, resolved.path).split(sep).join('/');
    if (rel === '') return ackError(`git_status: "${entry}" не указывает на файл внутри проекта`);
    relPaths.push(rel);
  }

  const git = collectGit(cwd);
  if (git === null) {
    // Не git-репозиторий — штатное состояние, а не отказ инструмента.
    return ackRead('git: не git-репозиторий (состояние дерева недоступно)', { git: null });
  }
  if (git.error) {
    return ackError(`git_status: git не ответил: ${git.error}`);
  }

  const applied: Record<string, unknown> = {
    git: true,
    branch: git.branch,
    changed: git.changed,
    untracked: git.untracked,
    ahead: git.ahead,
    behind: git.behind,
    upstream: git.upstream,
  };

  if (relPaths.length > 0) {
    const res = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', ...relPaths], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (res.error || res.status !== 0) {
      const text = (res.stderr ?? '').trim() || (res.error ? res.error.message : 'неизвестная ошибка git');
      return ackError(`git_status: git status по путям не выполнен: ${text}`);
    }
    const entries = parsePorcelain(res.stdout ?? '');
    applied.paths = relPaths;
    applied.entries = entries;
    applied.pathsChanged = entries.length;
  }

  const summary = `Ветка ${git.branch || '—'}: изменено ${git.changed}, неотслеживаемых ${git.untracked}`
    + (git.upstream ? `, ahead ${git.ahead}/behind ${git.behind}` : ', upstream не настроен');
  return ackRead(summary, applied);
}
