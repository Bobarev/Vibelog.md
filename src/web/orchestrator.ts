/**
 * Оркестратор фаз Qwen Code (VL-28).
 *
 * Запускает headless-сессию qwen (`qwen -p <промпт> --approval-mode yolo`)
 * с промптом из templates/qwen-commands/phase-N.md. Сам оркестратор файлы
 * задач не трогает: комментарии и статусы пишет qwen через Vibelog MCP.
 *
 * Синхронность: startPhase только спавнит процесс и сразу возвращает —
 * HTTP-хендлер (api.ts) остаётся синхронным. Состояние запусков хранится
 * в памяти процесса vibelog browser: рестарт теряет поллинг (доска не
 * обновится сама, но qwen доработает и запишет файл) — known limitation.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTask } from '../core/store.js';

/** Допустимые фазы. */
const PHASES = ['spec', 'plan', 'code'] as const;
export type Phase = (typeof PHASES)[number];

/** Шаблон промпта для каждой фазы. */
const PHASE_FILES: Record<Phase, string> = {
  spec: 'phase-1.md',
  plan: 'phase-2.md',
  code: 'phase-3.md',
};

/**
 * Путь к headless-промптам. Вычисляется от расположения модуля
 * (dist/web/orchestrator.js → ../../templates/qwen-commands/), как webDistDir:
 * команда vibelog browser запускается в репозитории пользователя.
 */
const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/** Сколько строк лога хранить в хвосте. */
const LOG_TAIL_LINES = 50;

/** Состояние запуска фазы для API. */
export interface PhaseRun {
  running: boolean;
  phase?: string;
  pid?: number;
  exitCode?: number | null;
  finishedAt?: string;
  logTail?: string;
}

/** Результат startPhase: успех или ошибка валидации/guard. */
export type StartResult = { started: true; pid: number } | { error: string };

/** Активный запуск: фаза + живой процесс. */
interface ActiveRun {
  phase: Phase;
  child: ChildProcess;
}

/** Задача → активный запуск (guard от двойного запуска). */
const activeRuns = new Map<string, ActiveRun>();
/** Задача → последний завершённый запуск (для getRun после close). */
const lastRuns = new Map<string, PhaseRun>();

/**
 * Собирает промпт фазы: шаблон + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code
 * @param taskId — ID задачи, например VL-28
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(phase: string, taskId: string): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается spec|plan|code)`);
  }
  const templatePath = join(templatesDir, PHASE_FILES[phase as Phase]);
  let template: string;
  try {
    template = readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Шаблон промпта не найден: ${templatePath}`);
  }
  return template.replaceAll('{{taskId}}', taskId);
}

/**
 * Запускает фазу для задачи (spawn qwen, fire-and-forget).
 *
 * @param cwd — рабочая директория проекта (там же лежит backlog/ и .qwen/)
 * @param taskId — ID задачи
 * @param phase — spec | plan | code
 */
export function startPhase(cwd: string, taskId: string, phase: string): StartResult {
  if (activeRuns.has(taskId)) {
    return { error: 'Фаза для этой задачи уже выполняется' };
  }
  let prompt: string;
  try {
    prompt = renderPrompt(phase, taskId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const bin = process.env.VIBELOG_QWEN_BIN || 'qwen';
  // Промпт — позиционный аргумент: флаг -p/--prompt у qwen deprecated
  // («Use the positional prompt instead»).
  const child = spawn(bin, [prompt, '--approval-mode', 'yolo'], {
    cwd,
    stdio: 'pipe',
  });

  activeRuns.set(taskId, { phase: phase as Phase, child });
  lastRuns.delete(taskId);

  let log = '';
  const appendLog = (chunk: Buffer | string) => {
    log += chunk.toString();
    const lines = log.split('\n');
    if (lines.length > LOG_TAIL_LINES) {
      log = lines.slice(-LOG_TAIL_LINES).join('\n');
    }
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);

  // Завершение запуска. Node НЕ гарантирует close после error (ENOENT при
  // отсутствии бинаря) — cleanup выполняется из обоих событий, один раз.
  let finished = false;
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    activeRuns.delete(taskId);
    lastRuns.set(taskId, {
      running: false,
      phase,
      exitCode: code,
      finishedAt: new Date().toISOString(),
      logTail: log.trim(),
    });
  };

  child.on('error', (err) => {
    log += `${log ? '\n' : ''}Ошибка запуска: ${err.message}`;
    finish(null);
  });
  child.on('close', (code) => finish(code));

  return { started: true, pid: child.pid ?? -1 };
}

/**
 * Состояние запуска фазы задачи.
 *
 * @param taskId — ID задачи
 * @returns текущий или последний запуск, либо null если запусков не было
 */
export function getRun(taskId: string): PhaseRun | null {
  const active = activeRuns.get(taskId);
  if (active) {
    return { running: true, phase: active.phase, pid: active.child.pid };
  }
  return lastRuns.get(taskId) ?? null;
}
