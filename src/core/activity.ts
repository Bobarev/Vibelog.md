/**
 * Лента активности — единый read-only лог работ по проекту (VL-347).
 *
 * Данные уже есть, но разложены по пяти источникам, и «что и когда
 * запускалось и чем закончилось» приходилось собирать руками:
 *
 * | Источник | Что даёт |
 * |---|---|
 * | `.vibelog/billing/<TASK>.json` | завершённые раны: фаза, время, usage, fallback |
 * | `.vibelog/agent-sessions/*.meta.json` | `runs[]`, `run_progress` (причина обрыва), `last_run.is_error` |
 * | `backlog/tasks/*.md` | создание/смена статуса задачи, комментарии |
 * | `.vibelog/auto-queue.json` | очередь: запуск/остановка/провал элемента |
 * | `.vibelog/supervisor/grants/*.json` | прогоны супервизора: выдача и отзыв grant |
 *
 * Модуль НИЧЕГО не пишет (AC1): только чтение. Каждый источник читается в
 * собственном try/catch — битый файл не роняет ленту (паттерн `collectStatus`
 * VL-341): пропускаем источник/запись и отдаём остальное.
 *
 * Причина падения фазы (AC5) берётся из МЕТЫ сессии (`run_progress.reason` +
 * `run_progress.text`, VL-254/VL-274), а не из комментария задачи: если
 * комментарий не записался (обрыв до `addComment`), в вебе причина всё равно
 * видна. `abortedReason` из `getRun` (VL-289) в модуль не тянется — он живёт
 * в памяти процесса оркестратора, а лента строится по файлам (переживает
 * рестарт `vibelog browser`); признак aborted попадает в мету через
 * `last_run.is_error`/`run_progress`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readBilling } from './billing.js';
import type { BillingSource } from './billing.js';
import { loadAutoQueue } from './auto-queue.js';
import { listTasks } from './store.js';
import { grantsDir } from '../web/supervisor-grant.js';

/** Тип события ленты (AC2). */
export type ActivityType =
  | 'phase_started'
  | 'phase_finished'
  | 'phase_failed'
  | 'task_created'
  | 'task_status_changed'
  | 'task_closed'
  | 'comment'
  | 'queue_started'
  | 'queue_stopped'
  | 'queue_failed'
  | 'grant_started'
  | 'grant_revoked';

/** Все допустимые типы — валидация API-фильтра и UI-мультивыбора. */
export const ACTIVITY_TYPES: readonly ActivityType[] = [
  'phase_started',
  'phase_finished',
  'phase_failed',
  'task_created',
  'task_status_changed',
  'task_closed',
  'comment',
  'queue_started',
  'queue_stopped',
  'queue_failed',
  'grant_started',
  'grant_revoked',
];

/** Источник запуска события; `unknown` — старые записи без поля (AC4). */
export type ActivitySource = BillingSource | 'unknown';

/** Ссылка на сущность, к которой можно перейти из ленты (AC3). */
export interface ActivityLink {
  kind: 'task' | 'reference' | 'document' | 'lesson';
  id: string;
}

/** Одно событие ленты (AC3). */
export interface ActivityEvent {
  /** Момент события (ISO 8601) — база сортировки. */
  at: string;
  type: ActivityType;
  taskId?: string;
  phase?: string;
  source?: ActivitySource;
  /** Одна строка для ленты. */
  summary: string;
  /** Раскрытие записи: usage, duration, reason, commit, approximate и т.п. */
  details?: Record<string, unknown>;
  links?: ActivityLink[];
}

/** Параметры выборки (AC6). */
export interface ActivityQuery {
  since?: string;
  until?: string;
  types?: ActivityType[];
  taskId?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

/** Результат сборки: страница событий + полное число до среза. */
export interface ActivityResult {
  events: ActivityEvent[];
  total: number;
}

/** Лимит по умолчанию и потолок страницы (риск «объём данных» плана). */
export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 200;

/** Предел превью комментария в ленте. */
const COMMENT_PREVIEW = 200;

/** Безопасное чтение JSON: битый/отсутствующий файл → null (лента не падает). */
function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Список файлов каталога с фильтром по расширению; нет каталога → []. */
function listFiles(dir: string, suffix: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(suffix));
  } catch {
    return [];
  }
}

/**
 * mtime файла (мс) — дешёвый предфильтр по периоду: при заданном `since`
 * файлы, изменённые раньше, не читаем вовсе (риск «объём данных» плана).
 */
function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Мета сессии в объёме, нужном ленте (полный SessionMeta не требуется). */
interface MetaLite {
  sessionId?: string;
  taskId?: string;
  phase?: string;
  lastRunPhase?: string;
  last_run?: { is_error?: boolean; finishedAt?: string; result?: string };
  run_progress?: {
    reason?: string;
    phase?: string;
    finishedAt?: string;
    text?: string;
    commit?: string | null;
  };
  runs?: {
    sessionId?: string;
    phase?: string;
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
  }[];
}

/** Читает все меты сессий проекта: sessionId → MetaLite (битые пропускаются). */
function readSessionMetas(cwd: string, sinceMs: number): Map<string, MetaLite> {
  const dir = join(cwd, '.vibelog', 'agent-sessions');
  const map = new Map<string, MetaLite>();
  for (const file of listFiles(dir, '.meta.json')) {
    const path = join(dir, file);
    if (sinceMs > 0 && mtimeMs(path) < sinceMs) continue;
    const parsed = readJsonSafe(path);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const meta = parsed as MetaLite;
    const id = typeof meta.sessionId === 'string' && meta.sessionId
      ? meta.sessionId
      : basename(file, '.meta.json');
    map.set(id, meta);
  }
  return map;
}

/**
 * Причина падения рана из меты: reason + текст «что сделано / что осталось».
 *
 * VL-368: `run_progress` пишется только на путях `buildRunProgress`
 * (wall-time/max-requests/idle). Ран, упавший через `fail()` (кап повторов,
 * лимиты, loop detection), оставлял ленту с «причина не записана», хотя текст
 * результата есть в мете (`last_run.result`). Поэтому при отсутствии
 * `run_progress` берём текст результата рана — «причина не записана» остаётся
 * только для действительно пустого результата.
 */
function failureReason(meta: MetaLite | undefined): string | undefined {
  const progress = meta?.run_progress;
  const reason = typeof progress?.reason === 'string' ? progress.reason.trim() : '';
  const text = typeof progress?.text === 'string' ? progress.text.trim() : '';
  if (reason || text) return [reason ? `причина: ${reason}` : '', text].filter(Boolean).join(' — ');
  // Fallback: текст результата упавшего рана (обрезка — лента не должна пухнуть)
  const raw = typeof meta?.last_run?.result === 'string' ? meta.last_run.result : '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return `причина: ${flat.length > 200 ? `${flat.slice(0, 200)}…` : flat}`;
}

/** События из billing: завершённые раны (phase_started + finished/failed). */
function billingEvents(
  cwd: string,
  metas: Map<string, MetaLite>,
  sinceMs: number
): ActivityEvent[] {
  const dir = join(cwd, '.vibelog', 'billing');
  const events: ActivityEvent[] = [];
  for (const file of listFiles(dir, '.json')) {
    const path = join(dir, file);
    if (sinceMs > 0 && mtimeMs(path) < sinceMs) continue;
    const taskId = basename(file, '.json');
    let record;
    try {
      // readBilling бросает на битом JSON — запись пропускаем, лента живёт
      record = readBilling(cwd, taskId);
    } catch {
      continue;
    }
    for (const session of record.sessions) {
      const meta = metas.get(session.sessionId);
      const source: ActivitySource = session.source ?? 'unknown';
      const startedAt = session.startedAt;
      const finishedAt = session.finishedAt;
      const phase = session.phase ?? meta?.lastRunPhase ?? meta?.phase;
      const links: ActivityLink[] = [{ kind: 'task', id: record.taskId }];
      const baseDetails: Record<string, unknown> = {
        sessionId: session.sessionId,
        agent: session.agent,
        model: session.model,
        durationMs: session.durationMs,
        usage: session.usage,
        ...(session.sessionPhase ? { sessionPhase: session.sessionPhase } : {}),
        ...(session.fallback ? { fallback: true } : {}),
      };
      if (startedAt) {
        events.push({
          at: startedAt,
          type: 'phase_started',
          taskId: record.taskId,
          phase,
          source,
          summary: `Запущена фаза ${phase ?? '?'} (${session.agent ?? 'агент'})`,
          details: { ...baseDetails },
          links,
        });
      }
      if (!finishedAt) continue;
      // Падение: fallback-запись (ран убит/упал до учёта) либо is_error в мете
      const failed = session.fallback === true || meta?.last_run?.is_error === true;
      const reason = failureReason(meta);
      if (failed) {
        events.push({
          at: finishedAt,
          type: 'phase_failed',
          taskId: record.taskId,
          phase,
          source,
          // AC5: причина из меты; комментарий в задачу мог не записаться
          summary: reason
            ? `Фаза ${phase ?? '?'} упала — ${reason}`
            : `Фаза ${phase ?? '?'} упала (причина не записана)`,
          details: {
            ...baseDetails,
            ...(reason ? { reason } : {}),
            ...(meta?.run_progress?.commit ? { commit: meta.run_progress.commit } : {}),
          },
          links,
        });
        continue;
      }
      events.push({
        at: finishedAt,
        type: 'phase_finished',
        taskId: record.taskId,
        phase,
        source,
        summary: `Фаза ${phase ?? '?'} завершена`,
        details: { ...baseDetails },
        links,
      });
    }
  }
  return events;
}

/**
 * События из мет сессий: раны, которые ещё идут (нет `finishedAt`).
 * Завершённые раны уже пришли из billing — дублей не создаём.
 */
function runningRunEvents(metas: Map<string, MetaLite>): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const meta of metas.values()) {
    if (!meta.taskId) continue;
    for (const run of meta.runs ?? []) {
      if (!run.startedAt || run.finishedAt) continue;
      events.push({
        at: run.startedAt,
        type: 'phase_started',
        taskId: meta.taskId,
        phase: run.phase ?? meta.lastRunPhase ?? meta.phase,
        source: 'unknown',
        summary: `Фаза ${run.phase ?? '?'} идёт (ран не завершён)`,
        details: { sessionId: run.sessionId ?? meta.sessionId, running: true },
        links: [{ kind: 'task', id: meta.taskId }],
      });
    }
  }
  return events;
}

/** События из задач: создание, смена статуса (приблизительно), закрытие, комментарии. */
function taskEvents(cwd: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  let tasks;
  try {
    tasks = listTasks(cwd);
  } catch {
    return events;
  }
  for (const task of tasks) {
    const links: ActivityLink[] = [{ kind: 'task', id: task.id }];
    if (task.created_date) {
      events.push({
        at: task.created_date,
        type: 'task_created',
        taskId: task.id,
        summary: `Создана задача ${task.id}: ${task.title}`,
        details: { status: task.status, type: task.type, priority: task.priority },
        links,
      });
    }
    // Истории статусов в задаче нет — только updated_date. Честно помечаем
    // approximate: true (риск плана), за точное событие не выдаём.
    if (task.updated_date && task.updated_date !== task.created_date) {
      const closed = task.status === 'Done';
      events.push({
        at: task.updated_date,
        type: closed ? 'task_closed' : 'task_status_changed',
        taskId: task.id,
        summary: closed
          ? `Задача ${task.id} закрыта`
          : `Задача ${task.id}: статус ${task.status} (приблизительно)`,
        details: { status: task.status, approximate: true },
        links,
      });
    }
    for (const comment of task.comments ?? []) {
      if (!comment.created) continue;
      const text = (comment.text ?? '').replace(/\s+/g, ' ').trim();
      events.push({
        at: comment.created,
        type: 'comment',
        taskId: task.id,
        summary: `Комментарий ${comment.author || '—'} к ${task.id}: ${
          text.length > COMMENT_PREVIEW ? `${text.slice(0, COMMENT_PREVIEW)}…` : text
        }`,
        details: { author: comment.author, text },
        links,
      });
    }
  }
  return events;
}

/** События автоочереди: запуск/остановка прогона и провалы элементов. */
function queueEvents(cwd: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  let queue;
  try {
    queue = loadAutoQueue(cwd);
  } catch {
    return events;
  }
  // В файле нет истории запусков/остановок — восстанавливаем по элементам:
  // started_at элемента = момент запуска, fail_reason = провал. Событие
  // «очередь запущена/остановлена» выводим из running + самого раннего
  // started_at (приблизительно, помечаем).
  const started = queue.tasks
    .map((t) => t.started_at)
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .sort();
  if (queue.running && started.length > 0) {
    events.push({
      at: started[0],
      type: 'queue_started',
      source: 'queue',
      summary: `Автоочередь запущена (${queue.tasks.length} задач)`,
      details: { running: true, tasks: queue.tasks.length, approximate: true },
    });
  }
  for (const item of queue.tasks) {
    if (item.status === 'failed' || item.status === 'failed_permanent') {
      events.push({
        at: item.started_at || item.added_at,
        type: 'queue_failed',
        taskId: item.id,
        source: 'queue',
        summary: `Очередь: провал ${item.id}${item.fail_reason ? ` — ${item.fail_reason}` : ''}`,
        details: {
          status: item.status,
          attempts: item.attempts,
          ...(item.fail_reason ? { reason: item.fail_reason } : {}),
        },
        links: [{ kind: 'task', id: item.id }],
      });
    }
  }
  return events;
}

/** События grant-ов супервизора: выдача и отзыв прогона. */
function grantEvents(cwd: string): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  const dir = grantsDir(cwd);
  for (const file of listFiles(dir, '.json')) {
    // draft-файлы карточки подтверждения — не прогон, в ленту не идут
    if (file.endsWith('.draft.json')) continue;
    const parsed = readJsonSafe(join(dir, file));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const grant = parsed as {
      runId?: string;
      taskIds?: string[];
      grantedAt?: string;
      expiresAt?: string;
      revokedAt?: string;
      revokeReason?: string;
    };
    const runId = grant.runId ?? basename(file, '.json');
    const taskIds = Array.isArray(grant.taskIds) ? grant.taskIds : [];
    const links: ActivityLink[] = taskIds.map((id) => ({ kind: 'task' as const, id }));
    if (grant.grantedAt) {
      events.push({
        at: grant.grantedAt,
        type: 'grant_started',
        source: 'supervisor',
        summary: `Супервизор: прогон ${runId} (${taskIds.length} задач)`,
        details: { runId, taskIds, expiresAt: grant.expiresAt },
        links,
      });
    }
    if (grant.revokedAt) {
      events.push({
        at: grant.revokedAt,
        type: 'grant_revoked',
        source: 'supervisor',
        summary: `Супервизор: прогон ${runId} остановлен${
          grant.revokeReason ? ` — ${grant.revokeReason}` : ''
        }`,
        details: { runId, ...(grant.revokeReason ? { reason: grant.revokeReason } : {}) },
        links,
      });
    }
  }
  return events;
}

/** Парсит ISO-дату; невалидная → NaN (фильтр по периоду её отбросит). */
function parseTime(value?: string): number {
  if (!value) return NaN;
  return Date.parse(value);
}

/**
 * Собирает ленту активности проекта (AC1).
 *
 * Read-only: ни один файл не пишется. Источники читаются по одному разу,
 * каждый в try/catch — битый файл пропускается, остальные события на месте.
 * Сортировка по `at` убыв., `limit`/`offset` применяются ПОСЛЕ сортировки,
 * `total` — полное число до среза (AC6/AC10).
 *
 * @param cwd — корень проекта (backlog/ и .vibelog/ ищутся в нём)
 * @param query — фильтры периода/типа/задачи/источника и пагинация
 */
export function collectActivity(cwd: string, query: ActivityQuery = {}): ActivityResult {
  const sinceMs = parseTime(query.since);
  const untilMs = parseTime(query.until);
  // Предфильтр по mtime: при заданном since файлы, изменённые раньше, не читаем
  const metas = readSessionMetas(cwd, Number.isFinite(sinceMs) ? sinceMs : 0);

  const all: ActivityEvent[] = [
    ...billingEvents(cwd, metas, Number.isFinite(sinceMs) ? sinceMs : 0),
    ...runningRunEvents(metas),
    ...taskEvents(cwd),
    ...queueEvents(cwd),
    ...grantEvents(cwd),
  ];

  const types = query.types && query.types.length > 0 ? new Set(query.types) : null;
  const taskId = query.taskId ? query.taskId.toUpperCase() : '';
  const source = query.source ? query.source.toLowerCase() : '';

  const filtered = all.filter((event) => {
    const at = parseTime(event.at);
    if (!Number.isFinite(at)) return false;
    if (Number.isFinite(sinceMs) && at < sinceMs) return false;
    if (Number.isFinite(untilMs) && at > untilMs) return false;
    if (types && !types.has(event.type)) return false;
    if (taskId && (event.taskId ?? '').toUpperCase() !== taskId) return false;
    if (source && (event.source ?? 'unknown') !== source) return false;
    return true;
  });

  // Обратная хронология: свежие сверху. При равном времени — стабильный
  // порядок по типу, чтобы страница не «прыгала» между запросами.
  filtered.sort((a, b) => {
    const diff = parseTime(b.at) - parseTime(a.at);
    if (diff !== 0) return diff;
    return a.type.localeCompare(b.type);
  });

  const total = filtered.length;
  const limit = Math.min(
    Math.max(1, query.limit ?? ACTIVITY_DEFAULT_LIMIT),
    ACTIVITY_MAX_LIMIT
  );
  const offset = Math.max(0, query.offset ?? 0);
  return { events: filtered.slice(offset, offset + limit), total };
}
