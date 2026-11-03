/**
 * Billing — append-only журнал сессий задач (VL-198, уровень 3 из трёх).
 *
 * Файл `.vibelog/billing/<taskId>.json` — ИСТОЧНИК ПРАВДЫ по использованию
 * токенов: каждая завершённая сессия-ран дописывается записью (без мержа
 * по sessionId — resume-ран это отдельная запись со своим startedAt).
 * Frontmatter задачи — агрегат для показа, billing — для сверки с провайдером
 * и аналитики. Файл лежит в gitignored `.vibelog/` (как settings.json).
 *
 * Деньги здесь НЕ хранятся — только токены/время (см. analytics.calculateCost).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TokenUsage } from './analytics.js';
import { findBacklogDir, experimentRunsDir } from './paths.js';

/** Одна запись сессии в billing (самодостаточна для сверки с провайдером). */
export interface BillingSession {
  /** ID сессии агента (sessionId jsonl/meta). */
  sessionId: string;
  /**
   * Фаза РАНА (spec/plan/code/close/comment/prompt) — VL-243: именно фаза
   * этого запуска, а не фаза сессии. У resume-ранов (code_same_session)
   * сессия принадлежит plan, а ран относится к code — раньше запись
   * маркировалась 'plan' и code-запись в журнале «пропадала».
   */
  phase?: string;
  /**
   * Фаза СЕССИИ (VL-243): заполняется, только когда отличается от `phase`
   * (resume-ран). По ней видно, к какой фазе относится накопленный контекст.
   */
  sessionPhase?: string;
  /**
   * VL-243: запись дописана оркестратором «по факту» (fallback) — CLI-пост-ран
   * не оставил своей записи (ран убит сигналом/упал до учёта). Поле нужно,
   * чтобы такие записи были отличимы от штатных при сверке с провайдером.
   */
  fallback?: boolean;
  /**
   * Начало рана (ISO). VL-259: именно фактическое начало ЭТОГО рана, а не
   * время создания сессии — иначе у всех resume-ранов сессии startedAt был
   * одинаковый (журнал VL-235: 4 записи с одним startedAt и разными
   * finishedAt — длительность и «первый/последний ран» не восстановить).
   */
  startedAt?: string;
  /**
   * VL-259: происхождение `startedAt`. 'run' — фактический старт рана (новые
   * записи), у старых записей поле отсутствует и `startedAt` ненадёжен
   * (это время создания сессии) — начало восстанавливается через
   * {@link billingRunStart}.
   */
  startedAtKind?: 'run' | 'session';
  /** Окончание рана (ISO). */
  finishedAt?: string;
  /** Длительность рана (мс). */
  durationMs?: number;
  /** Использование токенов (кумулятив по сессии). */
  usage: TokenUsage;
  /** Модель LLM (если известна). */
  model?: string;
  /** Агент: 'vb' | 'qwen'. */
  agent?: string;
}

/** Файл billing задачи: массив сессий. */
export interface BillingRecord {
  taskId: string;
  sessions: BillingSession[];
}

/** Путь к файлу billing задачи: `.vibelog/billing/<taskId>.json`. */
export function billingPath(cwd: string, taskId: string): string {
  return join(cwd, '.vibelog', 'billing', `${taskId.toUpperCase()}.json`);
}

/**
 * Читает billing задачи.
 *
 * Отсутствие файла → пустой record; битый JSON → Error (молчаливая
 * перезапись потеряла бы источник правды — лучше пусть вызывающий
 * решит: appendBilling ниже при битом файле падает с предупреждением).
 */
export function readBilling(cwd: string, taskId: string): BillingRecord {
  const path = billingPath(cwd, taskId);
  if (!existsSync(path)) return { taskId: taskId.toUpperCase(), sessions: [] };
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`billing ${path}: ожидается объект {taskId, sessions}`);
  }
  const rec = parsed as Partial<BillingRecord>;
  return {
    taskId: typeof rec.taskId === 'string' && rec.taskId ? rec.taskId : taskId.toUpperCase(),
    sessions: Array.isArray(rec.sessions) ? (rec.sessions as BillingSession[]) : [],
  };
}

/**
 * Дописывает сессию в billing задачи (append-only).
 *
 * Создаёт файл/каталог при отсутствии; запись — одним writeFileSync
 * (малый объём, атомарность достаточно). Вызывается из cli post-run
 * и finish-блока оркестратора — сбой не должен ронять фазу (вызывающий
 * ловит и предупреждает).
 *
 * @throws Error при битом существующем файле (не перезаписываем источник правды)
 */
export function appendBilling(cwd: string, taskId: string, session: BillingSession): BillingRecord {
  const record = readBilling(cwd, taskId);
  record.sessions.push(session);
  const path = billingPath(cwd, taskId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  return record;
}

/**
 * Восстанавливает фактическое начало рана из записи billing (VL-259).
 *
 * Новые записи пишут `startedAt` = старт рана и `startedAtKind: 'run'` — их
 * значение достоверно. У старых записей (VL-198…VL-243) `startedAt` — время
 * СОЗДАНИЯ сессии, поэтому у resume-ранов он совпадает; для них начало
 * восстанавливается как `finishedAt − durationMs`. Ничего нет — undefined.
 *
 * Функция НЕ бросает: журнал может содержать записи любых версий, и разбор
 * не должен падать на старых данных.
 */
export function billingRunStart(session: BillingSession): string | undefined {
  if (session.startedAtKind === 'run' && session.startedAt) return session.startedAt;
  const finished = typeof session.finishedAt === 'string' ? Date.parse(session.finishedAt) : NaN;
  if (Number.isFinite(finished)) {
    const dur = typeof session.durationMs === 'number' && session.durationMs > 0 ? session.durationMs : 0;
    // Без durationMs восстановить нельзя — отдаём finishedAt (лучше, чем ничего)
    return new Date(finished - dur).toISOString();
  }
  return typeof session.startedAt === 'string' ? session.startedAt : undefined;
}

// ── Эксперименты: подавление billing и usage рана (VL-299, doc-21 §13) ──

/** Префикс env-маркера эксперимента: `VIBELOG_EXPERIMENT=exp-<id>/run-<N>`. */
export const EXPERIMENT_ENV = 'VIBELOG_EXPERIMENT';

/** Разобранный env-маркер эксперимента. */
export interface ExperimentMarker {
  /** id эксперимента (`exp-N`). */
  expId: string;
  /** Номер прогона. */
  run: number;
}

/**
 * Разбирает значение `VIBELOG_EXPERIMENT` (`exp-<id>/run-<N>`).
 *
 * Формат фиксирован спецификацией (doc-21 §13): id эксперимента и номер
 * прогона нужны, чтобы положить usage в каталог ИМЕННО этого рана. Кривое
 * значение → null (маркер не действует: лучше записать billing, чем потерять
 * учёт токенов из-за опечатки в env).
 *
 * @param value — сырое значение переменной (обычно process.env.VIBELOG_EXPERIMENT)
 */
export function parseExperimentMarker(value?: string | null): ExperimentMarker | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const m = /^(exp-[A-Za-z0-9_-]+)\/run-(\d+)$/.exec(raw);
  if (!m) return null;
  const run = Number.parseInt(m[2], 10);
  if (!Number.isFinite(run) || run <= 0) return null;
  return { expId: m[1], run };
}

/**
 * Подавлен ли billing задачи (VL-299, doc-21 §13).
 *
 * Dataset-задачи эксперимента (`t1`, `t2`, …) не являются backlog-задачами:
 * файлы `.vibelog/billing/T1.json` засоряют учёт, а реальные задачи получают
 * чужие цифры при совпадении id. Поэтому при живом env-маркере
 * `VIBELOG_EXPERIMENT` billing НЕ пишется — usage уходит в `usage.json` рана.
 *
 * Проверка стоит на стороне ПИСАТЕЛЯ (а не только раннера): забытый путь
 * записи не должен просочиться в журнал.
 *
 * @param env — окружение процесса (по умолчанию process.env)
 */
export function billingSuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseExperimentMarker(env[EXPERIMENT_ENV]) !== null;
}

/**
 * Путь к `usage.json` рана эксперимента: `<backlog>/experiments/exp-<id>/run-<N>/usage.json`.
 *
 * @param cwd — корень проекта (backlog ищется вверх по дереву)
 * @param expId — id эксперимента
 * @param runN — номер прогона
 * @returns абсолютный путь либо null, если backlog в проекте не найден
 */
export function experimentUsagePath(cwd: string, expId: string, runN: number): string | null {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return null;
  return join(experimentRunsDir(backlogDir, expId), `run-${runN}`, 'usage.json');
}

/** Одна запись usage рана эксперимента (append-массив в usage.json). */
export interface ExperimentUsageEntry {
  /** Строка датасета (task_id), к которой относится ран. */
  task_id?: string;
  /** Ключ варианта (A/B/…). */
  variant?: string;
  /** ID сессии агента. */
  sessionId?: string;
  /** Фаза рана. */
  phase?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  usage: TokenUsage;
  model?: string;
  agent?: string;
}

/**
 * Дописывает запись usage в `usage.json` рана эксперимента (VL-299).
 *
 * Формат — JSON-массив записей (append-семантика, как billing): ран может
 * состоять из десятков задач × вариантов, и каждая запись самодостаточна.
 * Битый файл → начинаем заново с предупреждением вызывающего (учёт рана
 * важнее сохранности испорченного файла: он производный).
 *
 * @returns путь записанного файла либо null (backlog не найден)
 */
export function appendExperimentUsage(
  cwd: string,
  expId: string,
  runN: number,
  entry: ExperimentUsageEntry
): string | null {
  const path = experimentUsagePath(cwd, expId, runN);
  if (!path) return null;
  let entries: ExperimentUsageEntry[] = [];
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      if (Array.isArray(parsed)) entries = parsed as ExperimentUsageEntry[];
    } catch {
      // Битый usage.json — производный файл, перезаписываем с нуля
      entries = [];
    }
  }
  entries.push(entry);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  return path;
}
