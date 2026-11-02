/**
 * Автокоммит файла задачи после записи token_usage (VL-277).
 *
 * Разбор проблемы: фаза Close коммитила файл задачи изнутри агента (шаг 6
 * шаблона `templates/phases/phase-close.md`), а учёт токенов рана пишется
 * ПОЗЖЕ — пост-раном уже завершившегося процесса (`src/agent/cli.ts`,
 * `src/web/orchestrator.ts`). В момент шага 6 агент физически не знает
 * расход рана, поэтому `token_usage` во фронтмэттере появлялся уже после
 * docs(task)-коммита → файл задачи оставался грязным ровно один раз
 * после каждого close.
 *
 * Решение (вариант 1 плана): коммит файла задачи переносится из шаблона в
 * пост-ран — порядок становится детерминированным (usage записан → коммит).
 * Если HEAD уже docs(task)-коммит этой задачи и он не запушен, изменение
 * вливается в него через `--amend`, иначе создаётся отдельный коммит.
 *
 * Границы (риски R1–R4 плана):
 * - коммитится ТОЛЬКО явный путь файла задачи в главном репозитории
 *   (`taskCwd` = VIBELOG_CWD в branch-mode): `backlog/references/data/` и
 *   любые иные файлы не трогаются, `git add -A` не используется;
 * - гейт по фазе: `TASK_COMMIT_PHASES` (сейчас только close) — иначе
 *   framework начал бы коммитить backlog во всех фазах;
 * - любая git-ошибка глушится в stderr и не меняет exit-код и статус уже
 *   завершившейся фазы (паттерн `commitProgressChanges`, VL-254).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findBacklogDir, tasksDir, completedDir } from '../core/paths.js';
import { appendCommitTrailer, commitMessageArgs, resolveCommitCoauthor } from '../core/commit-trailer.js';

/**
 * Фазы, в которых framework коммитит файл задачи после записи usage.
 *
 * Только фазы, где шаблон раньше коммитил файл задачи сам (close и его
 * worktree-вариант идут одной фазой 'close'). Расширение на comment —
 * отдельным решением: в spec/plan/code/comment автокоммита быть не должно
 * (AC7 VL-277).
 */
export const TASK_COMMIT_PHASES: readonly string[] = ['close'];

/** Проверяет, коммитит ли framework файл задачи в этой фазе рана. */
export function isTaskCommitPhase(phase?: string): boolean {
  return typeof phase === 'string' && TASK_COMMIT_PHASES.includes(phase);
}

/** Тонкая обёртка над git: синхронно, с таймаутом, обрезанный stdout. */
function git(cwd: string, args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();
}

/**
 * Ищет файл задачи по ID (tasks/, затем completed/).
 *
 * Slug имени файла не угадывается: ID сравнивается с началом имени, иначе
 * `git add` получал бы несуществующий путь при расхождении slug и заголовка
 * (ловушка git+кириллица, VL-121).
 */
function resolveTaskPath(cwd: string, taskId: string): string | null {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return null;
  const idLower = taskId.toLowerCase();
  for (const dir of [tasksDir(backlogDir), completedDir(backlogDir)]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const lower = file.toLowerCase();
      if (lower.startsWith(`${idLower} `) || lower.startsWith(`${idLower}.`)) {
        return join(dir, file);
      }
    }
  }
  return null;
}

/**
 * Запушен ли текущий HEAD (есть upstream и он указывает на тот же коммит).
 *
 * Нет upstream → считаем «не запушен»: амендить локальный коммит безопасно.
 * Ошибка git (пустой репозиторий, detached HEAD без upstream) → false.
 */
function isHeadPushed(cwd: string): boolean {
  try {
    const head = git(cwd, ['rev-parse', 'HEAD']);
    const upstream = git(cwd, ['rev-parse', '@{u}']);
    return head !== '' && head === upstream;
  } catch {
    return false;
  }
}

/**
 * Коммитит файл задачи после записи token_usage рана.
 *
 * Порядок: грязь по явному пути → `git add -- <путь>` → `--amend`, если HEAD
 * это docs(task)-коммит этой задачи и он не запушен, иначе новый коммит.
 *
 * @param cwd — главный репозиторий, где живут файлы задач (VIBELOG_CWD)
 * @param taskId — ID задачи
 * @param phase — фаза рана (попадает в тему нового коммита)
 * @returns short-hash созданного/изменённого коммита либо null
 *          (нечего коммитить / файл не найден / ошибка git)
 */
export function commitTaskFile(cwd: string, taskId: string, phase: string): string | null {
  try {
    const taskPath = resolveTaskPath(cwd, taskId);
    if (!taskPath) return null;
    // Явный путь, не весь backlog: чужие/генерируемые файлы (references/data/)
    // в коммит попасть не должны.
    const dirty = git(cwd, ['status', '--porcelain', '--', taskPath]);
    if (dirty === '') return null;

    git(cwd, ['add', '--', taskPath]);

    const subject = git(cwd, ['log', '-1', '--pretty=%s']);
    // Предикат темы (риск R2): амендить можно ТОЛЬКО коммит закрытия этой
    // задачи или предыдущий token_usage-коммит. `refs и lessons`/`docs:`/`feat:`
    // тоже начинаются с `docs(task): <ID>`-подобных тем — их не переписываем.
    const isOwnDocsCommit =
      subject.startsWith(`docs(task): ${taskId}`) &&
      (subject.includes('закрытие задачи') || subject.includes('token_usage'));
    if (isOwnDocsCommit && !isHeadPushed(cwd)) {
      // Комментарий/статус из finish_phase и token_usage сливаются в ОДИН
      // docs(task)-коммит; тема сохраняется. VL-302: `--no-edit` больше не
      // годится — трейлер дописывается в сообщение, поэтому берём полное
      // сообщение (`%B`, не `%s`: тело коммита терять нельзя) и передаём его
      // через `-m` (риск R1 плана).
      const fullMessage = git(cwd, ['log', '-1', '--pretty=%B']);
      const amended = appendCommitTrailer(fullMessage, resolveCommitCoauthor(cwd));
      git(cwd, ['commit', '--amend', '--no-verify', '-m', amended]);
    } else {
      // Чужой HEAD (refs/lessons, docs, feat) не переписываем — новый коммит.
      git(cwd, [
        'commit',
        '--no-verify',
        ...commitMessageArgs(cwd, `docs(task): ${taskId} — token_usage (${phase})`),
      ]);
    }
    return git(cwd, ['rev-parse', '--short', 'HEAD']);
  } catch (err) {
    // Фаза уже завершилась — git не должен менять её exit-код (риск R4).
    console.error(
      `[vibelog-agent] файл задачи ${taskId} не закоммичен: ${(err as Error).message}`,
    );
    return null;
  }
}
