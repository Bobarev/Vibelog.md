/**
 * Команда `vibelog status` — сводка «где я» (VL-341).
 *
 * Только печать: данные собирает `collectStatus` (src/core/status.ts).
 * Три режима:
 * - по умолчанию — блоки с заголовками (версия, проект, задачи, фазы,
 *   очередь, прогон, git); пустая секция — одна строка «—»;
 * - `--json` — тот же объект структурированно (стабильные ключи, для скриптов
 *   и агента);
 * - `--short` — по строке на пункт, без заголовков и рамок.
 *
 * Код возврата: 0 всегда, кроме отсутствия `backlog/` → 1 с подсказкой
 * `vibelog init` (совместимо с обязательной проверкой `doctor`).
 */

import { colorize, colors } from '../ui.js';
import { hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { collectStatus } from '../../core/status.js';
import type { ProjectStatus } from '../../core/status.js';

/** Строка-заглушка пустой секции. */
const EMPTY = '—';

/** Секция «Задачи»: счётчики по статусам в порядке убывания. */
function tasksLine(status: ProjectStatus): string {
  const entries = Object.entries(status.tasks.byStatus);
  if (entries.length === 0) return EMPTY;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.map(([name, count]) => `${name}: ${count}`).join(', ') + ` (всего ${status.tasks.total})`;
}

/** Секция «Фазы»: по строке на идущий ран. */
function runsLines(status: ProjectStatus): string[] {
  if (status.runs.length === 0) return [EMPTY];
  return status.runs.map((run) => {
    const parts = [`${run.taskId} — ${run.phase || '—'}`];
    if (run.pid !== undefined) parts.push(`pid ${run.pid}`);
    if (run.startedAt) parts.push(`старт ${run.startedAt}`);
    return parts.join(', ');
  });
}

/** Секция «Очередь»: флаг прогона + элементы по статусам. */
function queueLines(status: ProjectStatus): string[] {
  const q = status.queue;
  if (q.error) return [`ошибка чтения: ${q.error}`];
  const head = `автопрогон ${q.running ? 'запущен' : 'остановлен'}`;
  const parts: string[] = [];
  if (q.pending.length > 0) parts.push(`pending: ${q.pending.join(', ')}`);
  if (q.runningIds.length > 0) parts.push(`running: ${q.runningIds.join(', ')}`);
  if (q.done.length > 0) parts.push(`done: ${q.done.join(', ')}`);
  if (q.failed.length > 0) {
    parts.push(
      `failed: ${q.failed.map((f) => (f.reason ? `${f.id} (${f.reason})` : f.id)).join(', ')}`
    );
  }
  return parts.length === 0 ? [head] : [head, ...parts];
}

/** Секция «Прогон» (grant супервизора). */
function grantLines(status: ProjectStatus): string[] {
  const g = status.grant;
  if (!g) return ['прогона нет'];
  return [`${g.runId}: задачи ${g.taskIds.join(', ') || '—'}, до ${g.expiresAt}`];
}

/** Секция «Git». */
function gitLines(status: ProjectStatus): string[] {
  const g = status.git;
  if (!g) return ['не git-репозиторий'];
  if (g.error) return [`ошибка: ${g.error}`];
  const parts = [`ветка ${g.branch || '—'}`, `изменено ${g.changed}`, `нетрекнуто ${g.untracked}`];
  if (g.upstream) parts.push(`ahead ${g.ahead}`, `behind ${g.behind}`);
  else parts.push('upstream не настроен');
  return [parts.join(', ')];
}

/** Человекочитаемый вывод: блоки с заголовками. */
function printHuman(status: ProjectStatus): void {
  const head = `Vibelog.md ${status.version}`;
  console.log(colorize(head, colors.bold));
  console.log('');

  const project = status.project
    ? `${status.project.name || '—'} (префикс ${status.project.taskPrefix || '—'})`
    : 'backlog/ не найден — выполните vibelog init';
  console.log(colorize('Проект:', colors.bold), project);
  console.log(colorize('Задачи:', colors.bold), tasksLine(status));

  console.log(colorize('Фазы:', colors.bold));
  for (const line of runsLines(status)) console.log(`  ${line}`);

  console.log(colorize('Очередь:', colors.bold));
  for (const line of queueLines(status)) console.log(`  ${line}`);

  console.log(colorize('Прогон:', colors.bold));
  for (const line of grantLines(status)) console.log(`  ${line}`);

  console.log(colorize('Git:', colors.bold));
  for (const line of gitLines(status)) console.log(`  ${line}`);
}

/** Краткий вывод: одна строка на пункт, без заголовков. */
function printShort(status: ProjectStatus): void {
  const project = status.project
    ? `${status.project.name || '—'} (${status.project.taskPrefix || '—'})`
    : 'backlog/ не найден';
  console.log(`version: ${status.version}`);
  console.log(`project: ${project}`);
  console.log(`tasks: ${tasksLine(status)}`);
  for (const line of runsLines(status)) console.log(`run: ${line}`);
  for (const line of queueLines(status)) console.log(`queue: ${line}`);
  for (const line of grantLines(status)) console.log(`grant: ${line}`);
  for (const line of gitLines(status)) console.log(`git: ${line}`);
}

/**
 * Выполняет команду status.
 *
 * @param positional — позиционные аргументы (не используются)
 * @param flags — флаги (--json, --short, --no-git)
 * @param cwd — текущая рабочая директория
 */
export async function runStatus(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  void positional;
  const status = collectStatus(cwd, { noGit: hasFlag(flags, 'no-git') });

  if (flags.json) {
    console.log(JSON.stringify(status, null, 2));
  } else if (flags.short) {
    printShort(status);
  } else {
    printHuman(status);
  }

  // Нет backlog/ — код 1 с подсказкой (как обязательная проверка doctor)
  if (status.project === null) {
    console.error(colorize('backlog/ не найден — выполните vibelog init', colors.yellow));
    process.exitCode = 1;
  }
}
