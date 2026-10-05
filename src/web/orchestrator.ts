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
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrompt } from './phase-prompt.js';
import type { Phase } from './phase-prompt.js';
import { getTask } from '../core/store.js';
import { explainQwenParse, parseQwenResult } from './qwen-result.js';
import type { QwenResult } from './qwen-result.js';

// Реэкспорт для обратной совместимости (VL-85): renderPrompt/Phase вынесены
// в phase-prompt.ts — общий модуль оркестратора и CLI vibelog-agent.
export { renderPrompt };
export type { Phase };

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
  /** Агент запуска (VL-93): 'qwen' по умолчанию, 'vb' — встроенный агент. */
  agent?: string;
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
  /** Агент запуска (VL-93) — попадает в PhaseRun для рендера session_id. */
  agent: string;
}

/** Задача → активный запуск (guard от двойного запуска). */
const activeRuns = new Map<string, ActiveRun>();
/** Задача → последний завершённый запуск (для getRun после close). */
const lastRuns = new Map<string, PhaseRun>();

/**
 * Запускает фазу для задачи (spawn qwen, fire-and-forget).
 *
 * @param cwd — рабочая директория проекта (там же лежит backlog/ и .qwen/)
 * @param taskId — ID задачи
 * @param phase — spec | plan | code | close | comment
 * @param onExit — колбэк завершения фазы (VL-48)
 * @param extraVars — доп. подстановки промпта ({{comment}} для фазы comment)
 * @param agent — агент-исполнитель (VL-94): qwen (дефолт) либо встроенный
 *   vibelog-agent; выбор бинаря — в spawnQwenRun (VL-92), guard-ключ фазы
 *   общий для обоих агентов — одновременно активен только один запуск фазы
 */
export function startPhase(
  cwd: string,
  taskId: string,
  phase: string,
  onExit?: PhaseExitCallback,
  extraVars?: Record<string, string>,
  agent: 'qwen' | 'vb' = 'qwen'
): StartResult {
  // Защита HTTP-границы (VL-66): api.ts пропускает произвольный phase из
  // POST-body — без guard'а qwen получил бы шаблон prompt.md с неподставленным
  // {{prompt}}. Фаза prompt не привязана к задаче и живёт в startPrompt.
  if (phase === 'prompt') {
    return { error: 'Фаза prompt запускается через startPrompt' };
  }
  let prompt: string;
  try {
    prompt = renderPrompt(phase, taskId, extraVars);
  } catch (err) {
    return { error: (err as Error).message };
  }
  return spawnQwenRun(cwd, taskId, phase as Phase, prompt, onExit, agent);
}

/**
 * Запускает произвольный промпт через агент без задачи (VL-66/67/92, /prompt).
 *
 * Ключ запуска — строка 'prompt' в общих activeRuns/lastRuns: guard от
 * двойного запуска и getRun('prompt') достаются без новых map. Guard общий
 * для обоих агентов (VL-92): одновременно активен только один /prompt.
 *
 * @param cwd — рабочая директория проекта
 * @param promptText — текст запроса пользователя (подставляется в {{prompt}})
 * @param onExit — колбэк завершения (бот шлёт информационное сообщение без карточки)
 * @param agent — агент-исполнитель: qwen (дефолт) либо встроенный vibelog-agent
 */
export function startPrompt(
  cwd: string,
  promptText: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = 'qwen'
): StartResult {
  let prompt: string;
  try {
    // Шаблон prompt.md не содержит {{taskId}} — taskId пустой, важен только {{prompt}}
    prompt = renderPrompt('prompt', '', { prompt: promptText });
  } catch (err) {
    return { error: (err as Error).message };
  }
  return spawnQwenRun(cwd, 'prompt', 'prompt', prompt, onExit, agent);
}

/**
 * Продолжает существующую сессию агента по reply-сообщению бота (VL-93/95).
 *
 * Отличие от startPrompt: шаблон phase-prompt НЕ используется — позиционный
 * промпт = сырой текст пользователя; флаг `--resume <sessionId>` продолжает
 * ту же сессию (без --fork-session — по описанию фичи). runKey 'resume' —
 * guard от двойного запуска в общих activeRuns, getRun('resume') доступен.
 * Результат парсится штатным parseQwenResult (JSON type=result) — бот шлёт
 * информационное сообщение паттерном sendPhaseResult.
 *
 * @param cwd — рабочая директория проекта
 * @param sessionId — идентификатор сессии из сообщения бота (у vb — с префиксом vb:)
 * @param promptText — текст пользователя (reply-сообщение)
 * @param onExit — колбэк завершения (бот шлёт информационное сообщение)
 * @param agent — VL-95: qwen (дефолт) либо встроенный vibelog-agent; у vb
 *   есть --resume и JSONL-хранилище сессий, префикс vb: снимает CLI агента
 */
export function startResume(
  cwd: string,
  sessionId: string,
  promptText: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = 'qwen'
): StartResult {
  // Фаза 'prompt' — вне жизненного цикла задачи, шаблон не подставляется;
  // resume поддержан для обоих агентов (VL-95: vb хранит сессии JSONL)
  return spawnQwenRun(cwd, 'resume', 'prompt', promptText, onExit, agent, ['--resume', sessionId]);
}

/**
 * Спавнит процесс агента с готовым промптом и ведёт его жизненный цикл.
 *
 * Общий хелпер startPhase/startPrompt (VL-66): guard от двойного запуска,
 * лог, probe тишины, парсер JSON-результата, onExit. runKey — ID задачи
 * либо 'prompt' (ключи общих activeRuns/lastRuns).
 *
 * @param agent — VL-92: qwen (дефолт) либо встроенный vibelog-agent
 * @param extraArgs — VL-93: доп. флаги сразу после промпта (--resume <id>)
 */
function spawnQwenRun(
  cwd: string,
  runKey: string,
  phase: Phase,
  prompt: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = 'qwen',
  extraArgs: string[] = []
): StartResult {
  if (activeRuns.has(runKey)) {
    // Сообщение генерализовано (VL-66): подходит и фазе задачи, и /prompt
    return { error: 'Запуск уже выполняется' };
  }

  // VL-92: выбор бинаря по агенту. qwen — прежний путь без регрессий;
  // vb — встроенный vibelog-agent: VIBELOG_AGENT_BIN либо bin/vibelog-agent.mjs
  // относительно dist/web/ (import.meta.url). Флаги спавна не меняются —
  // агент qwen-совместим по CLI (VL-85). LLM env (VIBELOG_LLM_*) наследуются
  // из process.env: бот кладёт туда .env через loadDotEnv (VL-37), доп.
  // настройка не нужна; при отсутствии ключа агент сам печатает is_error JSON.
  const bin =
    agent === 'vb'
      ? process.env.VIBELOG_AGENT_BIN ||
        fileURLToPath(new URL('../../bin/vibelog-agent.mjs', import.meta.url))
      : process.env.VIBELOG_QWEN_BIN || 'qwen';
  // Промпт — позиционный аргумент: флаг -p/--prompt у qwen deprecated
  // («Use the positional prompt instead»).
  // Диагностика VL-58 (таймлайн, probe тишины) остаётся.
  // Корневая причина задержки устранена настройками памяти qwen (VL-58);
  // stream-json и VIBELOG_QWEN_EXTRA_ARGS откачены. Дебаг: vibelog qwen-debug.
  // --output-format json — для ВСЕХ фаз; --allowed-mcp-server-names vibelog —
  // только для spec/plan: чужие серверы (chrome-devtools и др.) для планирования не нужны.
  // Для prompt флагов нет (как у comment) — шаблон не требует Vibelog MCP.
  //
  // VL-63 (reopen): --json-file/--json-fd НЕ используем — в headless-режиме
  // (позиционный промпт, без TUI) qwen 0.24.x эти флаги игнорирует: файл
  // остаётся пустым/не создаётся, JSON идёт как раньше через --output-format
  // в stdout (проверено scripts/qwen-json-probe.mjs). Надёжный путь — держать
  // stdout и stderr раздельно (см. ниже): раньше stderr-строка (Warning, лог
  // MCP-сервера), пришедшая между частями гигантской JSON-строки stdout,
  // вклинивалась в её середину и result терялся «в половине случаев».
  const phaseFlags =
    phase === 'spec' || phase === 'plan'
      ? ['--allowed-mcp-server-names', 'vibelog']
      : [];
  // VL-93: extraArgs сразу после позиционного промпта (--resume <sessionId>);
  // порядок флагов для qwen не значим, промпт обязан быть первым
  const child = spawn(bin, [prompt, ...extraArgs, '--approval-mode', 'yolo', '--output-format', 'json', ...phaseFlags], {
    cwd,
    stdio: 'pipe',
  });

  activeRuns.set(runKey, { phase, child, onExit, agent });
  lastRuns.delete(runKey);

  // VL-63 (reopen): два независимых буфера. `log` — ТОЛЬКО stdout (источник
  // для parseQwenResult), `stderrLog` — только stderr (диагностика/фолбэк).
  // Разделение устраняет гонку вклинивания stderr в незавершённую
  // JSON-строку stdout (см. комментарий про --json-file выше).
  let log = '';
  let stderrLog = '';
  // VL-58 (диагностика): таймлайн фазы в консоль — когда qwen напечатал строку
  // (в т.ч. «Готово»), когда exit, когда close. Отвечает на вопрос «задержка
  // в выводе qwen или в завершении процесса?». Хвост незавершённой строки
  // копим в отдельный tailBuf на ПОТОК — печатаем только завершённые строки.
  const ts = () => new Date().toTimeString().slice(0, 8);
  let tailBuf = '';
  let stderrTailBuf = '';
  let lastOutputAt = Date.now();
  /** Копит текст потока в его буфер и печатает завершённые строки в таймлайн. */
  const appendTo = (which: 'stdout' | 'stderr') => (chunk: Buffer | string) => {
    lastOutputAt = Date.now();
    const text = chunk.toString();
    if (which === 'stderr') {
      stderrTailBuf += text;
      const parts = stderrTailBuf.split('\n');
      stderrTailBuf = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim()) {
          console.log(`[phase ${runKey}] ${ts()} err| ${line.trim().slice(0, 120)}`);
        }
      }
      stderrLog += text;
      const lines = stderrLog.split('\n');
      if (lines.length > LOG_TAIL_LINES) {
        stderrLog = lines.slice(-LOG_TAIL_LINES).join('\n');
      }
      return;
    }
    tailBuf += text;
    const parts = tailBuf.split('\n');
    tailBuf = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) {
        console.log(`[phase ${runKey}] ${ts()} | ${line.trim().slice(0, 120)}`);
      }
    }
    log += text;
    const lines = log.split('\n');
    if (lines.length > LOG_TAIL_LINES) {
      log = lines.slice(-LOG_TAIL_LINES).join('\n');
    }
  };
  child.stdout?.on('data', appendTo('stdout'));
  child.stderr?.on('data', appendTo('stderr'));

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
        `[phase ${runKey}] ${ts()} probe(тишина ${quietSec}с):\n` + (lines.join('\n') || '    (процесс уже завершился)')
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
    activeRuns.delete(runKey);
    // Последние незавершённые строки (без \n) живут в tailBuf и не попадают
    // в буферы через appendTo — дозаписываем оба потока перед парсингом
    if (tailBuf) {
      log += tailBuf;
      tailBuf = '';
    }
    if (stderrTailBuf) {
      stderrLog += stderrTailBuf;
      stderrTailBuf = '';
    }
    // VL-64/VL-63: результат сессии qwen из JSON type=result — как
    // строка-объект (NDJSON), так и строка-массив `[{…}]` (json-адаптер
    // qwen 0.24.x). Парсим ТОЛЬКО stdout: stderr (Warning, логи MCP) в
    // JSON-разбор не подмешивается (reopen VL-63 — гонка вклинивания).
    // Если result не распознан — печатаем расширенную диагностику: сводку
    // парсера по stdout, размеры обоих потоков, хвосты и ПОЛНЫЙ stdout
    // (первая/последняя строка, ≥300 символов каждого края) — чтобы видеть,
    // на каком формате падает обработка без перезапуска фазы.
    const result = parseQwenResult(log) ?? undefined;
    if (!result) {
      const outLines = log.split('\n').filter((l) => l.trim());
      const diag =
        `stdout: ${log.length} б, строк: ${outLines.length}; stderr: ${stderrLog.length} б; ` +
        explainQwenParse(log);
      console.log(`[phase ${runKey}] ${ts()} parseQwenResult: ${diag}`);
      if (outLines.length > 0) {
        console.log(`[phase ${runKey}] ${ts()} stdout-хвост: …${log.slice(-400)}`);
      }
      if (stderrLog.trim()) {
        console.log(`[phase ${runKey}] ${ts()} stderr-хвост: …${stderrLog.slice(-300)}`);
      }
      // Дебаг-дамп полного stdout на диск (запрос Pavel, VL-63 reopen):
      // --json-file у qwen в headless не работает (флаг игнорируется), поэтому
      // сырой JSON сохраняем сами — в .vibelog/qwen-debug/ (gitignored),
      // чтобы видеть точный формат вывода без перезапуска фазы.
      if (log.trim()) {
        try {
          const dumpDir = join(cwd, '.vibelog', 'qwen-debug');
          mkdirSync(dumpDir, { recursive: true });
          const dumpPath = join(dumpDir, `${runKey}-${Date.now()}.log`);
          writeFileSync(dumpPath, log, 'utf-8');
          console.log(`[phase ${runKey}] ${ts()} дамп stdout: ${dumpPath}`);
        } catch (err) {
          console.log(`[phase ${runKey}] ${ts()} дамп stdout не удался: ${(err as Error).message}`);
        }
      }
    }
    const record: PhaseRun = {
      running: false,
      phase,
      agent,
      exitCode: code,
      finishedAt: new Date().toISOString(),
      // Фолбэк-хвост для бота/доски: оба потока, stdout первым
      logTail: [log.trim(), stderrLog.trim()].filter(Boolean).join('\n'),
      result,
    };
    lastRuns.set(runKey, record);
    // VL-48: уведомление о завершении (бот). Fire-and-forget в try/catch:
    // сетевые ошибки Telegram не должны ронять polling оркестратора.
    try {
      onExit?.(record);
    } catch (err) {
      console.error('onExit-колбэк фазы упал:', err);
    }
  };

  child.on('exit', (code, signal) => {
    console.log(`[phase ${runKey}] ${ts()} exit: code=${code} signal=${signal}`);
  });
  child.on('error', (err) => {
    log += `${log ? '\n' : ''}Ошибка запуска: ${err.message}`;
    console.log(`[phase ${runKey}] ${ts()} error: ${err.message}`);
    finish(null);
  });
  child.on('close', (code) => {
    console.log(`[phase ${runKey}] ${ts()} close: code=${code}`);
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
    return { running: true, phase: active.phase, pid: active.child.pid, agent: active.agent };
  }
  return lastRuns.get(taskId) ?? null;
}
