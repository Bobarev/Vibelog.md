/**
 * Учёт токенов консультаций субагентов (VL-409).
 *
 * Почему отдельный sidecar, а не `recordThreadUsage` (VL-313): тот агрегирует
 * по МОДЕЛЯМ, а консультация идёт той же моделью, что и основной ход — токены
 * слились бы, и «сколько стоило мнение Психолога» стало бы не видно. Здесь
 * ключ — роль консультанта, поэтому суммы основного хода и консультаций не
 * смешиваются (AC10).
 *
 * Файл `<cwd>/.vibelog/chat-sessions/<threadId>.subagents.json` лежит рядом с
 * историей; имя содержит точку, поэтому `listChatThreads` (фильтр `.jsonl`)
 * его тредом не считает (lesson-151). Сбой записи не рвёт диалог (паттерн
 * `recordChatToolStats`): учёт — не причина терять ответ консультанта.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LlmUsage } from '../agent/llm.js';

/** threadId попадает в имя файла — защита от path-traversal (как в chat.ts). */
const THREAD_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Суммы консультаций по ролям (sidecar `<threadId>.subagents.json`). */
export interface SubagentUsageRecord {
  /** id роли-консультанта → суммы её консультаций в треде. */
  byPersona: Record<string, { input: number; output: number; total: number; calls: number }>;
  updatedAt: string;
}

/** Путь к sidecar учёта консультаций треда. */
function subagentUsageFile(cwd: string, threadId: string): string {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.subagents.json`);
}

/**
 * Учитывает токены одной консультации с пометкой роли-консультанта.
 *
 * @param cwd — каталог проекта
 * @param threadId — тред (невалидный id — учёт пропускается)
 * @param personaId — id роли-консультанта
 * @param usage — usage вложенного запроса
 */
export function recordSubagentUsage(
  cwd: string,
  threadId: string,
  personaId: string,
  usage: LlmUsage,
): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  const record = loadSubagentUsage(cwd, threadId) ?? { byPersona: {}, updatedAt: '' };
  const prev = record.byPersona[personaId] ?? { input: 0, output: 0, total: 0, calls: 0 };
  record.byPersona[personaId] = {
    input: prev.input + Math.max(0, usage.input_tokens),
    output: prev.output + Math.max(0, usage.output_tokens),
    total: prev.total + Math.max(0, usage.total_tokens),
    calls: prev.calls + 1,
  };
  record.updatedAt = new Date().toISOString();
  try {
    mkdirSync(join(cwd, '.vibelog', 'chat-sessions'), { recursive: true });
    writeFileSync(subagentUsageFile(cwd, threadId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  } catch {
    // сбой учёта не должен рвать текущий ход
  }
}

/** Чтение учёта консультаций треда (null — учёта нет или файл битый). */
export function loadSubagentUsage(cwd: string, threadId: string): SubagentUsageRecord | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(subagentUsageFile(cwd, threadId), 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const byPersona = (raw as { byPersona?: unknown }).byPersona;
    if (typeof byPersona !== 'object' || byPersona === null || Array.isArray(byPersona)) return null;
    const updatedAt = (raw as { updatedAt?: unknown }).updatedAt;
    return {
      byPersona: byPersona as SubagentUsageRecord['byPersona'],
      updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
    };
  } catch {
    return null;
  }
}
