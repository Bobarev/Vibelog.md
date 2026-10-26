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

/** Одна запись сессии в billing (самодостаточна для сверки с провайдером). */
export interface BillingSession {
  /** ID сессии агента (sessionId jsonl/meta). */
  sessionId: string;
  /** Фаза сессии (spec/plan/code/close/comment/prompt). */
  phase?: string;
  /** Начало сессии (ISO). */
  startedAt?: string;
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
