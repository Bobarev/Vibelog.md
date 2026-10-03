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

import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTask } from '../core/store.js';
import { explainQwenParse, parseQwenResult } from './qwen-result.js';
import type { QwenResult } from './qwen-result.js';

/** Допустимые фазы. */
const PHASES = ['spec', 'plan', 'code', 'close', 'comment'] as const;
export type Phase = (typeof PHASES)[number];

/** Шаблон промпта для каждой фазы. */
const PHASE_FILES: Record<Phase, string> = {
  spec: 'phase-1.md',
  plan: 'phase-2.md',
  code: 'phase-3.md',
  close: 'phase-close.md',
  comment: 'phase-comment.md',
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
  /** Разобранный JSON-результат qwen (type=result); null-фолбэк — без данных. */
  result?: QwenResult;
}

/** Результат startPhase: успех или ошибка валидации/guard. */
export type StartResult = { started: true; pid: number } | { error: string };

/**
 * Колбэк завершения фазы (VL-48): вызывается ровно один раз при close/error
 * с готовым PhaseRun (exitCode, logTail). Ошибки колбэка не роняют polling.
 */
export type PhaseExitCallback = (run: PhaseRun) => void;

/** Активный запуск: фаза + живой процесс + колбэк завершения. */
interface ActiveRun {
  phase: Phase;
  child: ChildProcess;
  onExit?: PhaseExitCallback;
}

/** Задача → активный запуск (guard от двойного запуска). */
const activeRuns = new Map<string, ActiveRun>();
/** Задача → последний завершённый запуск (для getRun после close). */
const lastRuns = new Map<string, PhaseRun>();

/**
 * Собирает промпт фазы: шаблон + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code | close | comment
 * @param taskId — ID задачи, например VL-28
 * @param extraVars — доп. подстановки {{key}} -> value ({{comment}} для фазы comment)
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(
  phase: string,
  taskId: string,
  extraVars?: Record<string, string>
): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается spec|plan|code|close|comment)`);
  }
  const templatePath = join(templatesDir, PHASE_FILES[phase as Phase]);
  let template: string;
  try {
    template = readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Шаблон промпта не найден: ${templatePath}`);
  }
  let prompt = template.replaceAll('{{taskId}}', taskId);
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      prompt = prompt.replaceAll('{{' + key + '}}', value);
    }
  }
  return prompt;
}

/**
 * Запускает фазу для задачи (spawn qwen, fire-and-forget).
 *
 * @param cwd — рабочая директория проекта (там же лежит backlog/ и .qwen/)
 * @param taskId — ID задачи
 * @param phase — spec | plan | code | close | comment
 * @param onExit — колбэк завершения фазы (VL-48)
 * @param extraVars — доп. подстановки промпта ({{comment}} для фазы comment)
 */
export function startPhase(
  cwd: string,
  taskId: string,
  phase: string,
  onExit?: PhaseExitCallback,
  extraVars?: Record<string, string>
): StartResult {
  if (activeRuns.has(taskId)) {
    return { error: 'Фаза для этой задачи уже выполняется' };
  }
  let prompt: string;
  try {
    prompt = renderPrompt(phase, taskId, extraVars);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const bin = process.env.VIBELOG_QWEN_BIN || 'qwen';
  // Промпт — позиционный аргумент: флаг -p/--prompt у qwen deprecated
  // («Use the positional prompt instead»).
  // Диагностика VL-58 (таймлайн, probe тишины) остаётся.
  // Корневая причина задержки устранена настройками памяти qwen (VL-58);
  // stream-json и VIBELOG_QWEN_EXTRA_ARGS откачены. Дебаг: vibelog qwen-debug.
  // --output-format json — для ВСЕХ фаз; --allowed-mcp-server-names vibelog —
  // только для spec/plan: чужие серверы (chrome-devtools и др.) для планирования не нужны.
  const phaseFlags =
    phase === 'spec' || phase === 'plan'
      ? ['--allowed-mcp-server-names', 'vibelog']
      : [];
  const child = spawn(bin, [prompt, '--approval-mode', 'yolo', '--output-format', 'json', ...phaseFlags], {
    cwd,
    stdio: 'pipe',
  });

  activeRuns.set(taskId, { phase: phase as Phase, child, onExit });
  lastRuns.delete(taskId);

  let log = '';
  // VL-58 (диагностика): таймлайн фазы в консоль — когда qwen напечатал строку
  // (в т.ч. «Готово»), когда exit, когда close. Отвечает на вопрос «задержка
  // в выводе qwen или в завершении процесса?». Хвост незавершённой строки
  // копим в tailBuf — печатаем только завершённые строки.
  const ts = () => new Date().toTimeString().slice(0, 8);
  let tailBuf = '';
  let lastOutputAt = Date.now();
  const appendLog = (chunk: Buffer | string) => {
    lastOutputAt = Date.now();
    const text = chunk.toString();
    tailBuf += text;
    const parts = tailBuf.split('\n');
    tailBuf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) {
        console.log(`[phase ${taskId}] ${ts()} | ${line.trim().slice(0, 120)}`);
      }
    }
    log += text;
    const lines = log.split('\n');
    if (lines.length > LOG_TAIL_LINES) {
      log = lines.slice(-LOG_TAIL_LINES).join('\n');
    }
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);

  // VL-58 (диагностика): самописец тишины — если qwen молчит дольше 60с,
  // каждые 60с логируем ps-состояние процесса и его потомков (CPU/state/etime):
  // видно, чем занят хвост — генерация (100% CPU), teardown MCP или ожидание.
  const probe = setInterval(() => {
    const quietSec = Math.round((Date.now() - lastOutputAt) / 1000);
    if (quietSec < 60) return;
    execFile('ps', ['-axo', 'pid,ppid,%cpu,state,etime,command'], (err, out) => {
      if (err) return;
      const own = String(child.pid);
      // Все потомки рекурсивно: MCP-сервер qwen — ВНУК (ребёнок движка),
      // прямая фильтрация по ppid обёртки его не показывала
      const rows = new Map<string, string>();
      const byParent = new Map<string, string[]>();
      for (const l of out.split('\n')) {
        const t = l.trim();
        if (!t) continue;
        const cols = t.split(/\s+/);
        rows.set(cols[0], t);
        const siblings = byParent.get(cols[1]) ?? [];
        siblings.push(cols[0]);
        byParent.set(cols[1], siblings);
      }
      const all = new Set<string>([own]);
      const queue = [own];
      while (queue.length > 0) {
        const pid = queue.pop() as string;
        for (const desc of byParent.get(pid) ?? []) {
          if (!all.has(desc)) {
            all.add(desc);
            queue.push(desc);
          }
        }
      }
      const lines = [...all]
        .map((pid) => rows.get(pid))
        .filter((t): t is string => Boolean(t))
        .map((t) => '    ' + t.trim().slice(0, 110));
      console.log(
        `[phase ${taskId}] ${ts()} probe(тишина ${quietSec}с):\n` + (lines.join('\n') || '    (процесс уже завершился)')
      );
    });
  }, 60_000);
  // Завершение запуска. Node НЕ гарантирует close после error (ENOENT при
  // отсутствии бинаря) — cleanup выполняется из обоих событий, один раз.
  let finished = false;
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    clearInterval(probe);
    activeRuns.delete(taskId);
    // Последняя строка stdout без завершающего \n живёт в tailBuf и не
    // попадает в log через appendLog — дозаписываем перед парсингом
    if (tailBuf) {
      log += tailBuf;
      tailBuf = '';
    }
    // VL-64/VL-63 (дебаг): результат сессии qwen из JSON type=result —
    // как строка-объект (NDJSON), так и строка-массив `[{…}]` (json-адаптер
    // qwen 0.24.x). Если result не распознан, но JSON в логе есть — печатаем
    // сводку парсера, чтобы видеть, на каком формате падает обработка.
    const result = parseQwenResult(log) ?? undefined;
    if (!result && /[{[]/.test(log)) {
      console.log(`[phase ${taskId}] ${ts()} parseQwenResult: ${explainQwenParse(log)}`);
    }
    const record: PhaseRun = {
      running: false,
      phase,
      exitCode: code,
      finishedAt: new Date().toISOString(),
      logTail: log.trim(),
      result,
    };
    lastRuns.set(taskId, record);
    // VL-48: уведомление о завершении (бот). Fire-and-forget в try/catch:
    // сетевые ошибки Telegram не должны ронять polling оркестратора.
    try {
      onExit?.(record);
    } catch (err) {
      console.error('onExit-колбэк фазы упал:', err);
    }
  };

  child.on('exit', (code, signal) => {
    console.log(`[phase ${taskId}] ${ts()} exit: code=${code} signal=${signal}`);
  });
  child.on('error', (err) => {
    log += `${log ? '\n' : ''}Ошибка запуска: ${err.message}`;
    console.log(`[phase ${taskId}] ${ts()} error: ${err.message}`);
    finish(null);
  });
  child.on('close', (code) => {
    console.log(`[phase ${taskId}] ${ts()} close: code=${code}`);
    finish(code);
  });

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
