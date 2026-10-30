/**
 * Прогресс фазы до обрыва (VL-254).
 *
 * Разбор VL-235: фаза Code сгорела на wall-time, не оставив ни коммита, ни
 * отчёта — ветка осталась с незакоммиченными M-файлами, а транскрипт сессии
 * был единственным источником правды о том, что уже сделано. Восстанавливать
 * прогресс руками по 20+ КБ JSONL-строк — дорого и с ошибками.
 *
 * Модуль решает две задачи:
 * 1. `buildRunProgress` — чистая сборка блока «что сделано / что осталось» по
 *    сообщениям рана (без fs и MCP — тестируется на массивах сообщений).
 * 2. `commitProgressChanges` — сохранить незакоммиченную работу фазы code в
 *    ветку, чтобы resume начался не с нуля (единственный не-чистый кусок,
 *    вынесен отдельно и полностью гасит свои ошибки).
 *
 * Жёсткие ограничения по безопасности (риск R4 плана): коммит делается только
 * по явным путям из `git status`, файлы `backlog/` исключаются всегда,
 * `git add -A` запрещён, любая ошибка уходит в stderr и не меняет exit-код
 * уже завершившейся фазы.
 */

import { execFileSync } from 'node:child_process';
import { parsePorcelain } from '../core/git.js';
import { isValidToolCall, type ChatMessage } from './llm.js';

/** Причина обрыва рана: лимит времени, лимит запросов или прочее. */
export type RunProgressReason = 'wall-time' | 'max-requests' | 'other';

/** Блок «что сделано / что осталось» для меты сессии и комментария задачи. */
export interface RunProgress {
  reason: RunProgressReason;
  /** Готовый markdown-блок (маркеры «Сделано»/«Осталось» обязательны). */
  text: string;
  /** Завершённые шаги: пути правок и последняя реплика модели. */
  done: string[];
  /** Что осталось: чек-лист незавершённых шагов фазы. */
  pending: string[];
  /** Хэш WIP-коммита (только для упавшей фазы code); null — коммита нет. */
  commit?: string | null;
}

/** Максимум путей правок в блоке «Сделано» (блок должен быть коротким). */
const PROGRESS_MAX_FILES = 10;
/** Максимум символов последней реплики модели в блоке «Сделано». */
const PROGRESS_MAX_TEXT = 300;

/** Человекочитаемые подписи причин обрыва. */
const REASON_LABELS: Record<RunProgressReason, string> = {
  'wall-time': 'по лимиту wall-time',
  'max-requests': 'по лимиту LLM-запросов',
  other: 'по ошибке',
};

/**
 * Собирает блок «что сделано / что осталось» по сообщениям рана.
 *
 * «Сделано» выводится из фактических следов работы модели, а не из её
 * самоотчёта: пути `edit`/`write_file` — проверяемый признак правки файла,
 * плюс последняя непустая текстовая реплика assistant (что модель успела
 * сообщить). «Осталось» — фиксированный чек-лист для любого обрыва: прогон
 * тестов/сборки в этом ране не завершён (иначе ран не упал бы), отчёт фазы не
 * записан, DoD не отмечен.
 */
export function buildRunProgress(input: {
  messages: ChatMessage[];
  reason: RunProgressReason;
  durationMs?: number;
  payloadBytes?: number;
}): RunProgress {
  const files = new Set<string>();
  let lastText = '';
  for (const m of input.messages) {
    if (m.role !== 'assistant') continue;
    if (typeof m.content === 'string' && m.content.trim() !== '') {
      // Последняя содержательная реплика — самодостаточный след «на чём
      // модель остановилась» (перебиваем на каждом непустом тексте).
      lastText = m.content.trim();
    }
    for (const tc of m.tool_calls ?? []) {
      if (!isValidToolCall(tc)) continue;
      if (tc.name !== 'edit' && tc.name !== 'write_file') continue;
      const p = (tc.arguments ?? {}).path;
      if (typeof p === 'string' && p.trim() !== '') files.add(p);
    }
  }
  const done = [...files].slice(0, PROGRESS_MAX_FILES);
  if (lastText) {
    done.push(
      lastText.length > PROGRESS_MAX_TEXT ? `${lastText.slice(0, PROGRESS_MAX_TEXT)}…` : lastText,
    );
  }
  const pending = [
    'проверки (сборка / полный прогон тестов) в этом ране не завершены',
    'отчёт фазы (backlog_finish_phase) не записан',
    'AC/DoD не отмечены',
  ];
  const lines: string[] = [`### Прогресс до обрыва (${REASON_LABELS[input.reason]})`];
  lines.push('**Сделано:**');
  if (done.length === 0) {
    lines.push('- (правок и реплик модели в ране нет)');
  } else {
    for (const item of done) lines.push(`- ${item}`);
  }
  lines.push('**Осталось:**');
  for (const item of pending) lines.push(`- ${item}`);
  const meta: string[] = [];
  if (input.durationMs !== undefined) meta.push(`время рана ${Math.round(input.durationMs / 1000)} с`);
  if (input.payloadBytes !== undefined) meta.push(`payload ${input.payloadBytes} байт`);
  if (meta.length > 0) lines.push(`_${meta.join(', ')}_`);
  return { reason: input.reason, text: lines.join('\n'), done, pending, commit: null };
}

/** Дописывает в блок строку о WIP-коммите (если он был создан). */
export function appendCommitToProgress(progress: RunProgress, hash: string | null): RunProgress {
  if (!hash) return progress;
  return {
    ...progress,
    commit: hash,
    text: `${progress.text}\n\nНезакоммиченные изменения сохранены в ветку: коммит \`${hash}\`.`,
  };
}

/** Пути из `git status --porcelain`, которые можно коммитить (не backlog/). */
export function committablePaths(cwd: string): string[] {
  const out = execFileSync('/usr/bin/git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return parsePorcelain(out)
    .map((f) => f.path)
    // Файлы задач/документов backlog живут в главном репозитории и правятся
    // только через MCP — в WIP-коммит фазы они попадать не должны.
    .filter((p) => p !== '' && !p.startsWith('backlog/'));
}

/**
 * Коммитит незакоммиченный прогресс фазы в текущую ветку.
 *
 * Явные пути: `git add -u` для изменённых/удалённых + `git add <путь>` для
 * новых файлов, `git add -A` не используется никогда. Ошибки глушатся в
 * stderr — обрыв уже случился, exit-код фазы менять нельзя (риск R4).
 *
 * @returns short-hash коммита либо null (нечего коммитить / ошибка git)
 */
export function commitProgressChanges(cwd: string, taskId: string, reason: string): string | null {
  try {
    const paths = committablePaths(cwd);
    if (paths.length === 0) return null;
    // -u индексирует изменения уже известных файлов; новые добавляем поимённо
    execFileSync('/usr/bin/git', ['add', '-u'], { cwd, encoding: 'utf8', timeout: 30_000 });
    execFileSync('/usr/bin/git', ['add', '--', ...paths], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    });
    execFileSync(
      '/usr/bin/git',
      ['commit', '--no-verify', '-m', `wip(${taskId}): прогресс фазы code до обрыва (${reason})`],
      { cwd, encoding: 'utf8', timeout: 120_000 },
    );
    return execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
  } catch (err) {
    // Диагностика в точке срабатывания → logTail оркестратора (lesson-77)
    console.error(
      `[vibelog-agent] WIP-коммит прогресса не создан (${taskId}): ${(err as Error).message}`,
    );
    return null;
  }
}
