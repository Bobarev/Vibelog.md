/**
 * CLI vibelog-agent (VL-85): headless-исполнитель фаз Vibelog.
 *
 * Заменяет headless-сессию qwen для оркестратора (decision-5): печатает
 * в stdout ОДНУ JSON-строку формата parseQwenResult (type=result) —
 * контракт оркестратора VL-63: parseQwenResult получает только stdout,
 * поэтому все логи/ошибки идут в stderr.
 *
 * Интеграция: VIBELOG_QWEN_BIN указывает на bin/vibelog-agent.mjs —
 * оркестратор спавнит агента с позиционным промптом и флагами
 * --approval-mode yolo --output-format json; флаги принимаются и
 * игнорируются (output=json приравнен к --headless), промпт берётся
 * из позиционного аргумента.
 *
 * Режимы вызова:
 * - vibelog-agent <phase> <taskId> — промпт собирается из шаблона фазы;
 * - vibelog-agent <промпт> — готовый промпт (qwen-совместимость).
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmClient } from './llm.js';
import type { ApiMode, ChatMessage } from './llm.js';
import { ensureLlmEnv, modelLogLine, resolveRunModel } from './llm-env.js';
import type { ResolvedRunModel } from './llm-env.js';
import { loadProjectEnv } from '../bot/env.js';
// VL-308: настройка reset_limits_on_resume — сброс лимитов loop detection при resume
import { resolveResetLimitsOnResume } from '../bot/settings.js';
import { runLoop } from './loop.js';
import type { LoopResult } from './loop.js';
import { agentSessionsDir, appendSessionMessage, appendSessionRun, countToolCallsInMessages, createSessionId, latestSession, loadSession, loadSessionMetaSync, saveSession, saveSessionMeta, sumUsageFromMessages, updateSessionMeta } from './session.js';
import type { SessionMeta } from './session.js';
import { analyzeToolRepeats } from './repeat-tracker.js';
import { appendCommitToProgress, commitProgressChanges } from './run-progress.js';
// VL-277: файл задачи коммитится после записи token_usage рана (перенос из шаблона close)
import { commitTaskFile, isTaskCommitPhase } from './task-commit.js';
import { writeAutoReportIfMissing } from './auto-report.js';
import { taskWorktreeDir } from '../core/worktree.js';
import { taskIdPattern } from '../core/config.js';
import { buildSystemPrompt } from './system-prompt.js';
import { listLocalTools } from './tools.js';
import { dedupeResumePrompt } from './prompt-dedup.js';
import type { ToolSpec } from './tools.js';
import { McpClient, toolsAsSpecs } from './mcp-client.js';
import { closeExternalMcpClients, connectExternalMcpServers } from './external-mcp.js';
import { renderPrompt, taskExtraVars } from '../web/phase-prompt.js';
import { addComment, addTaskTokenUsage, getTask } from '../core/store.js';
import { getWorkflowForTask, getStatusAfterPhase } from '../core/workflow.js';
import { hasUsageDelta, usageDelta } from '../core/analytics.js';
import type { TokenUsage } from '../core/analytics.js';
import { appendBilling, appendExperimentUsage, parseExperimentMarker, EXPERIMENT_ENV } from '../core/billing.js';
import type { TuiHandle } from './tui.js';

/** Результат агента: QwenResult + type=result (контракт parseQwenResult). */
interface AgentJsonResult {
  type: 'result';
  result: string;
  is_error: boolean;
  num_turns: number;
  /**
   * Tool-calls текущего рана (VL-221): счётчик вызовов инструментов за ран
   * (сбрасывается при resume) — рядом с num_turns/requests в диагностике;
   * поле новое, парсер parseQwenResult его не читает (не ломает контракт).
   */
  tool_calls_total: number;
  duration_ms: number;
  duration_api_ms: number;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    total_tokens: number;
    /** Reasoning-токены (VL-198); 0 у провайдеров без этого поля. */
    reasoning_tokens: number;
  };
}

/** Разобранные аргументы CLI. */
export interface CliOptions {
  /** Позиционные: [phase, taskId] либо [готовый промпт] (qwen-совместимость). */
  positionals: string[];
  /** --headless: JSON в stdout без прогресса в stderr (дефолт при не-TTY). */
  headless: boolean;
  /** --no-mcp: не подключать MCP-инструменты Vibelog. */
  noMcp: boolean;
  /** --no-tui: отключить TUI в интерактивном режиме (VL-86, отладка). */
  noTui: boolean;
  /** --comment: подстановка {{comment}}/{{prompt}} в шаблон фазы. */
  comment?: string;
  /** --max-tool-calls N: лимит tool-calls loop (дефолт 100, VL-83). */
  maxToolCalls?: number;
  /** --tool-calls-per-session N: кумулятивный лимит tool-calls сессии через resume-раны (VL-223; без флага — только per-run). */
  toolCallsPerSession?: number;
  /** --max-wall-time сек: лимит времени фазы (дефолт 900, VL-83). */
  maxWallTimeSec?: number;
  /** --max-requests N: лимит LLM-запросов фазы (ходов; без лимита, VL-104). */
  maxRequests?: number;
  /**
   * --idle-timeout сек: idle-таймаут фазы (VL-274) — максимум тишины без
   * токенов стрима и завершённых tool-вызовов; дефолт агента 600, `0` —
   * выключено (в отличие от остальных числовых лимитов 0 здесь не «сброс»).
   */
  idleTimeoutSec?: number;
  /**
   * --loop-detection-repeat N: сколько одинаковых подряд вызовов считать
   * зацикливанием (VL-306; дефолт агента 3). Поле LoopLimits существовало с
   * VL-83, но не прокидывалось — порог нельзя было изменить без правки кода.
   */
  loopDetectionRepeat?: number;
  /**
   * --reset-limits-on-resume / --no-reset-limits-on-resume (VL-308): сбрасывать
   * накопленные лимиты loop detection при resume. Дефолт — сброс включён
   * (per-run семантика, как у max-tool-calls и wall-time): сигнатуры из меты
   * сессии НЕ подаются в лимиты нового рана. `--no-reset-limits-on-resume`
   * возвращает прежнее поведение VL-251 (перенос сигнатур — защита от лупа
   * после «Продолжить»).
   */
  resetLimitsOnResume?: boolean;
  /** --compact-tail N: хвост истории для LLM-запроса при компакшне (VL-122, дефолт 50). */
  compactTail?: number;
  /** --compact-at-tokens N: порог компакшна по usage-токенам (VL-122, дефолт 850000). */
  compactAtTokens?: number;
  /** --no-compact: отключить компакшн истории (VL-122; по умолчанию включён). */
  noCompact?: boolean;
  /** --resume <sessionId>: продолжить сохранённую сессию (VL-95; vb: префикс снят). */
  resume?: string;
  /** --continue: продолжить последнюю сессию текущего каталога (VL-95). */
  continue?: boolean;
  /**
   * --api-mode chat|responses: режим LLM API (VL-205); приоритет над
   * settings.json api_mode; без флага — api_mode из settings (дефолт chat).
   */
  apiMode?: ApiMode;
  /**
   * --model <id>: разовое переопределение модели рана (VL-239). Без флага
   * resume идёт на модели, зафиксированной в мете сессии, а не на текущем
   * models.default.
   */
  model?: string;
  /**
   * --model-follow-settings: осознанно продолжить сессию на АКТИВНОЙ модели
   * из settings.json, игнорируя модель сессии (VL-239).
   */
  modelFollowSettings?: boolean;
  /** --help: показать справку. */
  help: boolean;
}

const USAGE = `Использование:
  vibelog-agent <фаза> <taskId> [флаги]   — выполнить фазу задачи
  vibelog-agent <промпт> [флаги]          — выполнить готовый промпт (qwen-совместимо)

Фазы: spec | plan | code | do | close | comment | prompt | analyze | reject | investigate | materialize
Флаги:
  --headless               — JSON-результат в stdout (дефолт без TTY)
  --no-mcp                 — не подключать MCP-инструменты Vibelog
  --no-tui                 — отключить TUI в интерактивном режиме (VL-86)
  --comment <текст>        — подстановка {{comment}}/{{prompt}} в шаблон фазы
  --max-tool-calls <N>     — лимит tool-calls loop (дефолт 100)
  --tool-calls-per-session <N> — кумулятивный лимит tool-calls сессии через resume-раны (VL-223; без флага — только per-run)
  --max-wall-time <сек>    — лимит времени фазы (дефолт 900)
  --max-requests <N>       — лимит LLM-запросов фазы (ходов; без лимита)
  --idle-timeout <сек>     — idle-таймаут фазы: максимум тишины (нет токенов/tool-вызовов; дефолт 600, 0 — выключено, VL-274)
  --loop-detection-repeat <N> — сколько одинаковых подряд вызовов считать зацикливанием (дефолт 3, VL-306)
  --reset-limits-on-resume — сбросить накопленные лимиты loop detection при resume (дефолт, VL-308)
  --no-reset-limits-on-resume — переносить blocked_signatures из меты сессии в новый ран (прежнее поведение VL-251)
  --compact-tail <N>       — компакшн истории: хвост LLM-запроса (дефолт 50, VL-122)
  --compact-at-tokens <N>  — компакшн истории: порог по usage-токенам (дефолт 850000, VL-122)
  --no-compact             — отключить компакшн истории (VL-122; по умолчанию включён)
  --resume <sessionId>     — продолжить сохранённую сессию (VL-95; префикс vb: игнорируется)
  --continue               — продолжить последнюю сессию текущего каталога (VL-95)
  --api-mode <chat|responses> — режим LLM API (VL-205; дефолт chat либо settings.json api_mode)
  --model <id>             — разовая модель рана из models.available (VL-239; дефолт — модель сессии)
  --model-follow-settings  — продолжить на активной модели settings, игнорируя модель сессии (VL-239)
  --help, -h               — эта справка
Qwen-совместимость: --approval-mode <...>, --output-format json (= --headless),
--allowed-mcp-server-names <...> — принимаются и игнорируются.
Env: VIBELOG_LLM_BASE_URL, VIBELOG_LLM_API_KEY, VIBELOG_LLM_MODEL.`;

/** Лог в stderr — stdout зарезервирован под единственную JSON-строку (VL-63). */
function log(message: string): void {
  console.error(`[vibelog-agent] ${message}`);
}

/**
 * Разбирает argv CLI: позиционные + флаги (включая qwen-совместимые).
 *
 * @throws Error при неизвестном флаге, отсутствующем значении или невалидном числе
 */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { positionals: [], headless: false, noMcp: false, noTui: false, help: false };
  /** Следующий аргумент как значение флага (или throw). */
  const takeValue = (flag: string, raw: string | undefined): string => {
    if (raw !== undefined) return raw;
    throw new Error(`Флаг ${flag} требует значение`);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--headless') {
      opts.headless = true;
    } else if (arg === '--no-mcp') {
      opts.noMcp = true;
    } else if (arg === '--no-tui') {
      opts.noTui = true;
    } else if (arg === '--comment') {
      opts.comment = takeValue(arg, argv[++i]);
    } else if (arg === '--max-tool-calls') {
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--max-tool-calls: ожидается положительное целое, получено: ${raw}`);
      }
      opts.maxToolCalls = n;
    } else if (arg === '--tool-calls-per-session') {
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--tool-calls-per-session: ожидается положительное целое, получено: ${raw}`);
      }
      opts.toolCallsPerSession = n;
    } else if (arg === '--max-wall-time') {
      const raw = takeValue(arg, argv[++i]);
      const sec = Number(raw);
      if (!Number.isFinite(sec) || sec <= 0) {
        throw new Error(`--max-wall-time: ожидается положительное число секунд, получено: ${raw}`);
      }
      opts.maxWallTimeSec = sec;
    } else if (arg === '--max-requests') {
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--max-requests: ожидается положительное целое, получено: ${raw}`);
      }
      opts.maxRequests = n;
    } else if (arg === '--idle-timeout') {
      // VL-274: 0 допустим и означает «выключено» (в отличие от --max-wall-time)
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`--idle-timeout: ожидается неотрицательное целое (0 — выключено), получено: ${raw}`);
      }
      opts.idleTimeoutSec = n;
    } else if (arg === '--loop-detection-repeat') {
      // VL-306: порог loop detection (положительное целое; 0 недопустим —
      // нулевой порог блокировал бы первый же вызов)
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--loop-detection-repeat: ожидается положительное целое, получено: ${raw}`);
      }
      opts.loopDetectionRepeat = n;
    } else if (arg === '--reset-limits-on-resume') {
      // VL-308: явное включение сброса лимитов при resume (дефолт и так true)
      opts.resetLimitsOnResume = true;
    } else if (arg === '--no-reset-limits-on-resume') {
      // VL-308: прежнее поведение VL-251 — blocked_signatures переносятся
      opts.resetLimitsOnResume = false;
    } else if (arg === '--compact-tail') {
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--compact-tail: ожидается положительное целое, получено: ${raw}`);
      }
      opts.compactTail = n;
    } else if (arg === '--compact-at-tokens') {
      const raw = takeValue(arg, argv[++i]);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--compact-at-tokens: ожидается положительное целое, получено: ${raw}`);
      }
      opts.compactAtTokens = n;
    } else if (arg === '--no-compact') {
      opts.noCompact = true;
    } else if (arg === '--resume') {
      // Бот передаёт sessionId с префиксом vb: (extractSessionRef) — снимаем:
      // файл сессии хранится как <id>.jsonl без префикса
      opts.resume = takeValue(arg, argv[++i]).replace(/^vb:/, '');
    } else if (arg === '--continue') {
      opts.continue = true;
    } else if (arg === '--api-mode') {
      // VL-205: валидация значения; флаг читается ниже в точке createLlmClient
      const raw = takeValue(arg, argv[++i]);
      if (raw !== 'chat' && raw !== 'responses') {
        throw new Error(`--api-mode: ожидается chat|responses, получено: ${raw}`);
      }
      opts.apiMode = raw;
    } else if (arg === '--model') {
      // VL-239: id из models.available; существование проверяет resolveRunModel
      // (там понятная ошибка «Неизвестная модель: …») — здесь только значение
      opts.model = takeValue(arg, argv[++i]);
    } else if (arg === '--model-follow-settings') {
      opts.modelFollowSettings = true;
    } else if (arg === '--approval-mode' || arg === '--allowed-mcp-server-names') {
      // qwen-совместимость: значение съедается и игнорируется (AC#4 VL-85)
      takeValue(arg, argv[++i]);
    } else if (arg === '--output-format') {
      // output=json приравнен к --headless — оркестратор шлёт этот флаг всем фазам
      if (takeValue(arg, argv[++i]) === 'json') opts.headless = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Неизвестный флаг: ${arg}`);
    } else {
      opts.positionals.push(arg);
    }
  }
  if (opts.resume !== undefined && opts.continue) {
    throw new Error('--resume и --continue несовместимы — укажи один флаг');
  }
  if (opts.model !== undefined && opts.modelFollowSettings) {
    throw new Error('--model и --model-follow-settings несовместимы — укажи один флаг');
  }
  if (!opts.help && opts.positionals.length === 0) {
    throw new Error('Не заданы позиционные аргументы: укажи <фаза> <taskId> либо готовый промпт');
  }
  if (opts.positionals.length > 2) {
    throw new Error(
      `Слишком много позиционных аргументов (${opts.positionals.length}): ожидается <фаза> <taskId> либо один промпт`
    );
  }
  return opts;
}

/**
 * Записывает прогресс оборвавшегося рана (VL-254, AC4).
 *
 * Делает три вещи, каждая в своём try/catch (обрыв уже случился — ни одна
 * ошибка записи не должна менять exit-код фазы):
 * 1. для фазы code — коммитит незакоммиченные изменения в текущую ветку
 *    (`commitProgressChanges`, файлы backlog/ исключаются);
 * 2. пишет блок «что сделано / что осталось» в мету сессии (`run_progress`);
 * 3. добавляет тот же блок комментарием в задачу (файлы задач живут в
 *    `VIBELOG_CWD` — в worktree-режиме это главный репозиторий).
 *
 * @returns true, если блок записан хотя бы куда-то (для тестов)
 */
export async function recordRunProgress(args: {
  loopResult: Pick<LoopResult, 'is_error' | 'progress'>;
  sessionsDir: string;
  sessionId: string;
  cwd: string;
  /** Явные taskId/phase (в проде определяются из меты/env) — для тестов. */
  taskId?: string;
  phase?: string;
}): Promise<boolean> {
  const progress = args.loopResult.progress;
  if (args.loopResult.is_error !== true || !progress) return false;
  const { sessionsDir, sessionId, cwd } = args;
  let anyWritten = false;
  // Фаза рана: явная → VIBELOG_RUN_PHASE (оркестратор знает фактическую фазу
  // resume-рана) → фаза сессии (lesson-40: she — фаза создания) → env.
  let phase = args.phase;
  let taskId = args.taskId;
  try {
    const meta = loadSessionMetaSync(sessionsDir, sessionId);
    phase = phase ?? process.env.VIBELOG_RUN_PHASE ?? meta?.lastRunPhase ?? meta?.phase ?? process.env.VIBELOG_PHASE_NAME;
    taskId = taskId ?? meta?.taskId ?? process.env.VIBELOG_PHASE_TASK_ID;
  } catch (err) {
    console.error(`Предупреждение: мета сессии ${sessionId} не прочитана для прогресса — ${(err as Error).message}`);
  }
  // taskCwd — где живут файлы задач (в branch-mode VIBELOG_CWD → главный репо)
  const taskCwd = process.env.VIBELOG_CWD ?? cwd;
  let current = progress;
  if (phase === 'code') {
    try {
      current = appendCommitToProgress(progress, commitProgressChanges(cwd, taskId ?? 'task', progress.reason));
    } catch (err) {
      console.error(`Предупреждение: WIP-коммит прогресса не создан — ${(err as Error).message}`);
    }
  }
  try {
    updateSessionMeta(sessionsDir, sessionId, {
      cwd,
      run_progress: {
        reason: current.reason,
        ...(phase ? { phase } : {}),
        finishedAt: new Date().toISOString(),
        text: current.text,
        done: current.done,
        pending: current.pending,
        commit: current.commit ?? null,
      },
    });
    anyWritten = true;
  } catch (err) {
    console.error(`Предупреждение: прогресс рана в мету ${sessionId} не записан — ${(err as Error).message}`);
  }
  if (taskId) {
    try {
      addComment(taskCwd, taskId, current.text, '@agent');
      anyWritten = true;
    } catch (err) {
      console.error(`Предупреждение: комментарий прогресса в задачу ${taskId} не добавлен — ${(err as Error).message}`);
    }
  }
  return anyWritten;
}

/**
 * Точка входа: разбор аргументов → промпт → loop → JSON в stdout.
 *
 * Ошибки до loop (валидация, нет LLM-ключа) — stderr + exit 1, stdout пуст.
 * Ошибки loop не кидаются наружу: is_error=true уходит в JSON-результат.
 */
export async function main(argv: string[]): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error((err as Error).message);
    console.error('\n' + USAGE);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const positionals = opts.positionals;
  // Два позиционных — режим фазы; один — готовый промпт (qwen-совместимость)
  const isPhaseMode = positionals.length === 2;
  const phase = isPhaseMode ? positionals[0] : undefined;

  // Resume/continue продолжают готовый промпт: в режиме фазы промпт
  // собирается из шаблона и история сессии не подставлялась бы (VL-95)
  if ((opts.resume !== undefined || opts.continue) && isPhaseMode) {
    console.error('--resume/--continue работают только с готовым промптом (без <фаза> <taskId>)');
    process.exitCode = 1;
    return;
  }

  // VL-141: analyze — не задачная фаза: шаблон phase-analyze.md подставляет
  // {{sessionId}}/{{sessionCwd}} из meta.json сессии, которые CLI в режиме
  // <фаза> <taskId> не заполняет — рендер дал бы неподставленные заглушки
  if (isPhaseMode && positionals[0] === 'analyze') {
    console.error('analyze запускается через vibelog agent analyze <session-ref>');
    process.exitCode = 1;
    return;
  }


  // Headless: явный флаг, --output-format json (qwen) или не-TTY stdout
  const headless = opts.headless || !process.stdout.isTTY;
  log(`фаза=${phase ?? '(готовый промпт)'} задача=${isPhaseMode ? positionals[1] : '-'} headless=${headless}`);

  const cwd = process.cwd();
  // VL-259: фактическое начало ЭТОГО рана. Оркестратор передаёт момент спавна
  // в VIBELOG_RUN_STARTED_AT (иначе у всех resume-ранов сессии в billing
  // оказывался один и тот же startedAt — начало сессии, журнал VL-235);
  // при прямом запуске CLI — старт процесса.
  const runStartedAt = process.env.VIBELOG_RUN_STARTED_AT ?? new Date().toISOString();
  // VL-209: settings.json (секции models/providers) в ГЛАВНОМ репо — в
  // branch-mode агент работает в worktree (паттерн строки loadApiMode)
  const settingsCwd = process.env.VIBELOG_CWD ?? cwd;
  // .env + env-секция settings.json ДО валидации LLM (lesson-44 / VL-143):
  // ключ api_key_env провайдера должен лежать в process.env к ensureLlmEnv;
  // вызов идемпотентен (dotenv-семантика, ставит только пустые ключи)
  loadProjectEnv(settingsCwd);
  // LLM (ensureLlmEnv, VL-189 + VL-209) проверяется НИЖЕ, в точке резолва
  // модели рана (VL-239): валидировать надо ту модель, на которой реально
  // пойдёт ран (модель сессии при resume), а не только models.default —
  // иначе сломанный default блокировал бы resume сессии, чья модель жива.
  // LLM всё равно создаётся после резолва sessionId (VL-198): клиенту нужен
  // sessionId для заголовка X-Session-Id (ref-18).

  // Промпт фазы собирается до инициализации сессий: ошибка шаблона завершает
  // CLI до создания jsonl. Блок объявлен после cwd (VL-112): выбор
  // close-worktree шаблона зависит от worktree задачи в этом cwd
  //
  // VL-137: поля задачи подставляются в промпт фазы теми же переменными, что
  // в оркестраторе ({{taskTitle}} и др.). Если задача не читается — фаза не
  // запускается: фолбэка «неподставленные {{...}} → прочитай через MCP» в
  // шаблонах нет (решение Pavel), пустой блок модель не исправит.
  const taskVars = isPhaseMode ? taskExtraVars(cwd, positionals[1]) : null;
  if (isPhaseMode && !taskVars) {
    console.error(`Задача не найдена или не читается: ${positionals[1]}`);
    process.exitCode = 1;
    return;
  }
  let prompt: string;
  try {
    // VL-188: статус после фазы из workflow — как в оркестраторе (шаблоны
    // фаз используют {{producesStatus}} вместо хардкода статуса).
    // Задача уже читалась через taskExtraVars — здесь второе чтение только
    // для статуса/типа (кэша getTask нет, цена — одно чтение файла).
    let producesStatus = '';
    if (isPhaseMode) {
      const wfTask = getTask(cwd, positionals[1]);
      if (wfTask) {
        producesStatus = getStatusAfterPhase(
          getWorkflowForTask(cwd, wfTask),
          wfTask.status,
          positionals[0]
        ) ?? '';
      }
    }
    prompt = isPhaseMode
      ? renderPrompt(
          positionals[0],
          positionals[1],
          {
            // VL-307: {{comment}} подставляется всегда — при отсутствии
            // комментария строкой «без комментария» (литерала в промпте нет)
            comment: opts.comment || 'без комментария',
            prompt: opts.comment ?? '',
            ...taskVars,
            producesStatus,
          },
          // VL-112: close задачи с worktree — тот же выбор шаблона, что в оркестраторе;
          // VL-188: cwd — переопределение шаблонов проектом
          {
            closeWorktree:
              positionals[0] === 'close' && existsSync(taskWorktreeDir(cwd, positionals[1])),
            cwd,
          }
        )
      : positionals[0];
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  // Сессии (VL-95): хранилище JSONL в .vibelog/agent-sessions.
  // VL-107 fix: в режиме веток оркестратор спавнит фазу в git-worktree
  // (cwd=worktree), но resume (reply бота) всегда идёт из главного cwd —
  // сессия должна лежать в ГЛАВНОМ репо, иначе resume её не находит
  // (инцидент agent-1791322227147: файл в worktree, поиск в главном).
  // VIBELOG_CWD задаёт оркестратор только при branch-mode (orchestrator.ts);
  // без него (ручной запуск) — прежний cwd.
  // --resume продолжает сохранённый транскрипт; --continue — последнюю
  // сессию каталога; без флагов — новая сессия. Бот передаёт sessionId
  // с префиксом vb: — parseArgs уже снял его.
  const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);
  let sessionId: string;
  let resumedMessages: ChatMessage[] = [];
  if (opts.resume !== undefined || opts.continue) {
    const wanted = opts.resume ?? (await latestSession(sessionsDir));
    if (!wanted) {
      console.error(`Нет сохранённых сессий в ${sessionsDir} — --continue невозможен`);
      process.exitCode = 1;
      return;
    }
    sessionId = wanted;
    // Ошибка «не найдена»/«битая строка» уходит через self-run catch в stderr + exit 1
    resumedMessages = await loadSession(sessionsDir, sessionId);
    log(`Сессия ${sessionId} возобновляется, сообщений в истории: ${resumedMessages.length}`);
  } else {
    sessionId = createSessionId();
  }
  // VL-251: сигнатуры, отклонённые loop detection в прошлых ранах сессии —
  // читаются из меты (MCP-процесс умирает вместе с фазой, мета переживает
  // resume). Повтор такого вызова блокируется без исполнения.
  // VL-239: та же мета — источник модели сессии (resolveRunModel ниже).
  const sessionMeta = (() => {
    try {
      return loadSessionMetaSync(sessionsDir, sessionId);
    } catch {
      return null; // битая мета — не повод ронять фазу
    }
  })();
  // VL-308: лимиты loop detection — PER-RUN, как max-tool-calls и wall-time.
  // Раньше blocked_signatures переносились из меты в новый ран (VL-251), и
  // первая же попытка повторить вызов из прошлого рана блокировалась без
  // исполнения, а вторая давала fail — «Продолжить» падало на ровном месте.
  // С VL-304/VL-306 корневая причина лупа устранена (модель получает
  // isError/noop и штатный выход), поэтому перенос стал страховкой, которая
  // мешает легитимной работе. Дефолт — сброс; `--no-reset-limits-on-resume`
  // или `reset_limits_on_resume: false` в settings.json возвращают VL-251.
  const resetLimitsOnResume = opts.resetLimitsOnResume ?? resolveResetLimitsOnResume(settingsCwd);
  const resumedBlockedSignatures = resetLimitsOnResume
    ? []
    : (sessionMeta?.blocked_signatures ?? []);
  if ((opts.resume !== undefined || opts.continue) && (sessionMeta?.blocked_signatures?.length ?? 0) > 0) {
    log(
      resetLimitsOnResume
        ? `Лимиты loop detection сброшены для нового рана (VL-308): ${sessionMeta?.blocked_signatures?.length} сигнатур из меты не переносятся`
        : `Лимиты loop detection перенесены из меты (VL-308, --no-reset-limits-on-resume): ${resumedBlockedSignatures.length} сигнатур`,
    );
  }

  // VL-239: модель ЭТОГО рана резолвится из меты сессии (фиксация модели на
  // сессии), а не из текущего models.default — иначе смена default между
  // фазами (VL-209 + code_same_session VL-147) незаметно меняла модель на
  // середине задачи. Приоритет флагов и fail-open — в resolveRunModel.
  let resolvedModel: ResolvedRunModel;
  try {
    resolvedModel = resolveRunModel(settingsCwd, sessionMeta, {
      ...(opts.model !== undefined ? { modelId: opts.model } : {}),
      ...(opts.modelFollowSettings === true ? { followSettings: true } : {}),
    });
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  // Валидация окружения по ФАКТИЧЕСКОЙ модели рана (VL-239): у модели сессии
  // может быть свой провайдер/ключ, отличный от models.default.
  if (!ensureLlmEnv('агенту', settingsCwd, resolvedModel.active ? { active: resolvedModel.active } : undefined)) {
    process.exitCode = 1;
    return;
  }
  // Предупреждение о расхождении меты и активной модели (logTail оркестратора)
  if (resolvedModel.warning) log(resolvedModel.warning);
  // Лог фактической модели с источником: «Модель: … — из сессии / из настроек»
  log(modelLogLine(resolvedModel));

  // LLM-клиент после резолва sessionId (VL-198): sessionId уходит в
  // заголовок X-Session-Id запросов (ref-18, группировка на дашборде RouterAI).
  // apiMode (VL-205): флаг --api-mode приоритетнее модели/настроек;
  // baseUrl/apiKey/model — из резолва (VL-239): у модели сессии свой провайдер.
  const llm = createLlmClient({
    sessionId,
    cwd: settingsCwd,
    ...(resolvedModel.baseUrl !== undefined ? { baseUrl: resolvedModel.baseUrl } : {}),
    ...(resolvedModel.apiKey !== undefined && resolvedModel.apiKey !== ''
      ? { apiKey: resolvedModel.apiKey }
      : {}),
    ...(resolvedModel.source !== 'env' ? { model: resolvedModel.model } : {}),
    // VL-315: апстрим модели сессии/настроек уходит структурно в теле запроса
    ...(resolvedModel.vendor !== undefined ? { vendor: resolvedModel.vendor } : {}),
    apiMode: opts.apiMode ?? resolvedModel.apiMode,
  });

  // Метаданные сессии (VL-110/114): два источника taskId/phase — позиционные
  // <фаза> <taskId> (прямой CLI-запуск, без фильтров — task_prefix
  // конфигурируем) и env оркестратора VIBELOG_PHASE_TASK_ID/NAME (боевой
  // путь: спавн готовым промптом, isPhaseMode=false). Resume/--continue
  // мету не перезаписывают: сессия продолжается, мета уже записана — по
  // ней startResume возобновляет задачу в её worktree (инцидент VL-98).
  const isNewSession = opts.resume === undefined && !opts.continue;
  if (isNewSession) {
    // VL-239: модель фиксируется в мете ДО первого запроса — resume возьмёт
    // её из меты, а не текущий models.default. Для env-пути id/провайдера нет
    // (их неоткуда взять) — закрепляем хотя бы wire-имя (model_name).
    const modelFields: Partial<SessionMeta> = {
      ...(resolvedModel.source !== 'env' && resolvedModel.gatewayId
        ? {
            model_id: resolvedModel.id,
            model_gateway: resolvedModel.gatewayId,
            model_name: resolvedModel.model,
          }
        : resolvedModel.model
          ? { model_name: resolvedModel.model }
          : {}),
      ...(resolvedModel.apiMode ? { api_mode: resolvedModel.apiMode } : {}),
    };
    try {
      if (isPhaseMode) {
        await saveSessionMeta(sessionsDir, sessionId, {
          taskId: positionals[1],
          phase,
          cwd,
          ...modelFields,
        });
      } else {
        // Env-путь (боевой спавн оркестратора): фильтруем мусор — только
        // id по префиксу конфига проекта (VL-118; дефолт VL без конфига)
        const envTaskId = process.env.VIBELOG_PHASE_TASK_ID;
        if (envTaskId && taskIdPattern(cwd).test(envTaskId)) {
          await saveSessionMeta(sessionsDir, sessionId, {
            taskId: envTaskId.toUpperCase(),
            phase: process.env.VIBELOG_PHASE_NAME,
            cwd,
            ...modelFields,
          });
        }
      }
    } catch (err) {
      // Ошибка меты не должна ронять фазу: resume просто пойдёт прежним путём
      console.error(`Предупреждение: метаданные сессии не записаны — ${(err as Error).message}`);
    }
  }

  const tools: ToolSpec[] = listLocalTools(cwd);

  // MCP: phase!=='prompt' (шаблон prompt не требует Vibelog MCP) и не --no-mcp.
  // В режиме готового промпта фаза неизвестна — MCP подключаем (оркестратор
  // шлёт сюда промпты фаз, которым MCP нужен); отказ не роняет фазу.
  // VL-149: mcpClients — все подключённые клиенты (встроенный + внешние из
  // .vibelog/settings.json mcpServers) — закрываются единым циклом.
  const mcpClients: McpClient[] = [];
  let externalTools: ToolSpec[] = [];
  const wantMcp = !opts.noMcp && phase !== 'prompt';
  if (wantMcp) {
    try {
      // VIBELOG_SESSION_ID/VIBELOG_PHASE_NAME (VL-198): finish_phase резолвит
      // сессию/фазу в toolFinishPhase — иначе fallback на JSONL невозможен
      const mcp = await McpClient.create({
        cwd,
        env: {
          ...process.env,
          VIBELOG_SESSION_ID: sessionId,
          ...(isPhaseMode && phase ? { VIBELOG_PHASE_NAME: phase } : {}),
        },
      });
      mcpClients.push(mcp);
      externalTools = toolsAsSpecs(mcp, await mcp.listTools());
      log(`MCP: подключено инструментов — ${externalTools.length}`);
    } catch (err) {
      console.error(
        `Предупреждение: MCP-инструменты недоступны — ${(err as Error).message}; фаза продолжится без них`
      );
    }
    // Внешние серверы (VL-149): подключаются после vibelog-MCP, отказ
    // одного сервера не роняет фазу и не мешает остальным (fail-safe внутри)
    try {
      const ext = await connectExternalMcpServers(cwd);
      mcpClients.push(...ext.clients);
      externalTools.push(...ext.specs);
      if (ext.clients.length > 0) {
        log(`MCP: внешних серверов подключено — ${ext.clients.length}, их инструментов — ${ext.specs.length}`);
      }
    } catch (err) {
      console.error(
        `Предупреждение: внешние MCP-серверы недоступны — ${(err as Error).message}; фаза продолжится без них`
      );
    }
  }

  // TUI (VL-86): создаётся ниже перед loop; здесь — для SIGINT-хэндлера
  let tui: TuiHandle | null = null;

  // Аборт цикла (VL-243: нужен и для SIGINT ниже)
  const ac = new AbortController();
  // SIGINT: закрыть MCP и выйти — сервер-сирота не должен остаться висеть.
  // VL-243: НЕ завершаем процесс через process.exit немедленно — иначе
  // пост-ран (billing/мета/JSON) не выполнится и ран пропадает из учёта
  // (именно так терялись прерванные раны). Вместо этого: abort → закрыть
  // MCP → выставить exitCode; основной поток доходит до пост-рана.
  // Аварийный выход — таймер на 5 с (не держит event loop: unref).
  process.on('SIGINT', () => {
    log('SIGINT — прерывание фазы');
    ac.abort();
    // Альтернативный буфер TUI нужно вернуть терминалу до exit (VL-86)
    tui?.unmount();
    void (async () => {
      // Закрыть всех MCP-клиентов (VL-149: встроенный + внешние)
      for (const c of mcpClients) {
        try {
          await c.close();
        } catch {
          // сервер уже завершился — закрывать нечего
        }
      }
      // Цикл после abort завершится своим ходом, пост-ран запишет учёт;
      // exitCode 130 сохраняет привычный контракт прерывания.
      process.exitCode = 130;
    })();
    // Страховка от зависания: если цикл/сеть не отпускают процесс
    setTimeout(() => process.exit(130), 5000).unref();
  });

  // TUI (VL-86): только интерактивно (stdout TTY, без --headless/--output-format
  // json), не в режиме готового промпта и без --no-tui. TUI рендерится на stderr
  // в альтернативном буфере — stdout остаётся под единственную JSON-строку
  // (контракт оркестратора VL-63 не меняется). Динамический импорт: в headless
  // ink/react не грузятся вообще. Fallback — текстовый прогресс в stderr.
  const interactive = !headless && phase !== 'prompt';
  if (interactive && !opts.noTui) {
    try {
      const { renderTui } = await import('./tui.js');
      tui = renderTui();
    } catch (err) {
      console.error(
        `Предупреждение: TUI недоступна — ${(err as Error).message}; текстовый прогресс в stderr`
      );
    }
  }
  // const-алиас: TS не сужает let внутри замыканий колбэков loop
  const tuiHandle = tui;

  // Системный промпт (VL-96): базовая часть + AGENTS.md проекта. При resume
  // сохранённый system заменяется свежесобранным — файл мог измениться между
  // запусками; при первом запуске — просто первое сообщение диалога
  const systemPrompt = buildSystemPrompt(cwd);
  log(
    `Системный промпт: ${systemPrompt.content.length} символов (AGENTS.md: ${systemPrompt.hasAgentsMd ? 'да' : 'нет'})`,
  );
  const history =
    resumedMessages[0]?.role === 'system' ? resumedMessages.slice(1) : resumedMessages;
  // VL-258: неизменный блок задачи в промпте resume-рана не дублируем —
  // заменяем ссылкой на строку транскрипта, где он уже есть. Сравнение идёт
  // по хэшу блока против user-сообщений истории; блок изменился (например,
  // план записан в фазе Plan) — промпт остаётся полным. Fail-open: любая
  // проблема (нет блока, нет истории) → исходный текст.
  let promptForRun = prompt;
  if ((opts.resume !== undefined || opts.continue) && resumedMessages.length > 0) {
    const dedup = dedupeResumePrompt(prompt, resumedMessages);
    promptForRun = dedup.text;
    if (dedup.hash !== null) {
      log(
        dedup.deduped
          ? `Промпт resume-рана: блок задачи без изменений (хэш ${dedup.hash}, строка ${dedup.fromLine}) — заменён ссылкой`
          : `Промпт resume-рана: блок задачи изменён (хэш ${dedup.hash}) — включён полностью`,
      );
    }
  }
  // При resume в диалог вливается сохранённая история перед новым промптом
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt.content },
    ...history,
    { role: 'user', content: promptForRun },
  ];
  // Инкрементальная запись jsonl (VL-103): файл сессии создаётся ДО запуска
  // loop — стартовый набор (system + история + новый промпт) уходит в файл
  // сразу, а не по завершении фазы. При обрыве процесса (SIGKILL/таймаут
  // оркестратора) транскрипт сохранён до последнего сообщения. Resume/
  // continue: история уже в файле — дописываем ТОЛЬКО новый user-промпт
  // (не переписываем файл и не дублируем system/history). Ошибка записи
  // не должна ронять фазу — предупреждение в stderr (паттерн saveSession).
  // Цепочка append'ов jsonl (VL-103): записи сериализуются и возвращаются
  // loop'у как awaitable onMessage — каждое сообщение дописано до следующего
  // шага цикла; перед saveSession цепочка дожидается хвоста (в т.ч. fail-
  // сообщения, дописанного без await в loop) — гонки append vs перезапись нет.
  let appendChain: Promise<void> = Promise.resolve();
  const appendQueued = (m: ChatMessage): Promise<void> => {
    appendChain = appendChain
      .then(() => appendSessionMessage(sessionsDir, sessionId, m))
      .catch((e) => {
        console.error(`Предупреждение: сообщение сессии не дописано — ${(e as Error).message}`);
      });
    return appendChain;
  };
  const wasResumed = opts.resume !== undefined || opts.continue;
  // Кумулятивный per-session лимит (VL-223): база считается по уже
  // загруженной resume-истории (повторное чтение jsonl не нужно); фиксируется
  // один раз до запуска loop — двойного счёта с toolCallsTotal нет
  const toolCallsSessionBase =
    opts.toolCallsPerSession !== undefined && wasResumed
      ? countToolCallsInMessages(resumedMessages)
      : 0;
  if (opts.toolCallsPerSession !== undefined) {
    log(
      `Кумулятивный лимит tool-calls: ${toolCallsSessionBase} из ${opts.toolCallsPerSession}${wasResumed ? ' (прошлые раны)' : ''}`,
    );
  }
  try {
    const startup: ChatMessage[] = wasResumed
      ? [{ role: 'user', content: promptForRun }]
      : messages;
    for (const m of startup) {
      await appendQueued(m);
    }
  } catch (err) {
    console.error(`Предупреждение: старт сессии ${sessionId} не записан в jsonl — ${(err as Error).message}`);
  }
  const loopResult = await runLoop({
    llm,
    messages,
    tools,
    externalTools,
    limits: {
      ...(opts.maxToolCalls !== undefined ? { maxToolCalls: opts.maxToolCalls } : {}),
      ...(opts.toolCallsPerSession !== undefined ? { maxToolCallsPerSession: opts.toolCallsPerSession } : {}),
      ...(toolCallsSessionBase > 0 ? { toolCallsUsedThisSession: toolCallsSessionBase } : {}),
      ...(opts.maxWallTimeSec !== undefined ? { maxWallTimeMs: opts.maxWallTimeSec * 1000 } : {}),
      ...(opts.idleTimeoutSec !== undefined ? { idleTimeoutMs: opts.idleTimeoutSec * 1000 } : {}),
      ...(opts.maxRequests !== undefined ? { maxRequests: opts.maxRequests } : {}),
      ...(opts.loopDetectionRepeat !== undefined ? { loopDetectionRepeat: opts.loopDetectionRepeat } : {}),
      ...(opts.compactTail !== undefined ? { compactTailMessages: opts.compactTail } : {}),
      ...(opts.compactAtTokens !== undefined ? { compactAtTokens: opts.compactAtTokens } : {}),
      ...(opts.noCompact ? { compactDisabled: true } : {}),
      ...(resumedBlockedSignatures.length > 0 ? { blockedSignatures: resumedBlockedSignatures } : {}),
    },
    onToken: tuiHandle
      ? (t: string) => { tuiHandle.onToken(t); }
      : interactive
        ? (t: string) => { process.stderr.write(t); }
        : undefined,
    onToolStart: tuiHandle
      ? (name: string, callArgs: Record<string, unknown>) => { tuiHandle.onToolStart(name, callArgs); }
      : (name: string, callArgs: Record<string, unknown>) => {
          if (interactive) {
            console.error(`\n[инструмент] ${name} ${JSON.stringify(callArgs).slice(0, 200)}`);
          } else {
            log(`инструмент: ${name}`);
          }
        },
    onToolEnd: tuiHandle
      ? (name: string, out: string, isError?: boolean) => { tuiHandle.onToolEnd(name, out, isError); }
      : interactive
        ? (name: string, out: string) => { console.error(`[инструмент] ${name} → ${out.slice(0, 200)}\n`); }
        : undefined,
    onUsage: tuiHandle ? (usage, turn) => { tuiHandle.onUsage(usage, turn); } : undefined,
    onError: tuiHandle ? (errorText: string) => { tuiHandle.onError(errorText); } : undefined,
    // Инкрементальная запись jsonl (VL-103): каждое сообщение цикла
    // дописывается в файл сессии сразу — при обрыве фазы транскрипт уже
    // содержит последнее доступное сообщение. Ошибка записи — предупреждение,
    // фаза продолжается (паттерн финального saveSession).
    // awaitable (loop ждёт): запись завершается до следующего шага цикла
    onMessage: (m) => appendQueued(m),
    signal: ac.signal,
  });

  // TUI размонтируется ДО печати JSON: альтернативный буфер закрывается,
  // stdout остаётся чистым (контракт parseQwenResult VL-63)
  tui?.unmount();

  if (mcpClients.length > 0) {
    // closeExternalMcpClients (VL-149): close идемпотентен, ошибки игнорируются
    await closeExternalMcpClients(mcpClients);
  }

  // Дожидаемся цепочки append'ов (VL-103): fail-сообщения дописываются в
  // loop без await — перезапись saveSession не должна гоняться с append'ом
  await appendChain;

  // Сохранение транскрипта сессии (VL-95): полная перезапись файла — при
  // resume старые сообщения уже включены в loopResult.messages. Ошибка
  // записи не должна ронять фазу — только предупреждение в stderr.
  try {
    await saveSession(sessionsDir, sessionId, loopResult.messages);
  } catch (err) {
    console.error(`Предупреждение: сессия ${sessionId} не сохранена — ${(err as Error).message}`);
  }

  // ── Post-run учёт токенов (VL-198) ─────────────────────────────────────
  // Три действия: мета сессии (usage/finishedAt/duration/model/agent) →
  // frontmatter-дельта задачи → billing. Каждое в своём try/catch с
  // предупреждением в stderr: запись учёта не должна менять exit-код
  // уже выполненной фазы. Prompt-режим/анализ без taskId — пропуск.
  try {
    const sum = sumUsageFromMessages(loopResult.messages);
    // VL-229 (AC1): метрика повторов по всему транскрипту сессии — в мету и
    // в итоговую диагностику. Считается до записи меты, чтобы обе точки
    // показывали одни и те же цифры.
    const repeatStats = analyzeToolRepeats(loopResult.messages);
    const sessionUsage: TokenUsage = {
      input: sum.input,
      output: sum.output,
      cache: sum.cache,
      total: sum.total,
      requests: sum.requests,
      ...(sum.reasoning !== undefined ? { reasoning: sum.reasoning } : {}),
    };
    const existing = loadSessionMetaSync(sessionsDir, sessionId);
    // taskCwd — где живут файлы задач: в branch-mode VIBELOG_CWD указывает
    // на главный репо (сессии/настройки там же, lesson-13)
    const taskCwd = process.env.VIBELOG_CWD ?? cwd;
    // VL-243: phaseName — фаза СЕССИИ (её знает мета, lesson-40), runPhase —
    // фаза ЭТОГО рана. В billing пишется фаза рана: у resume-рана
    // (code_same_session) запись раньше помечалась 'plan' и code-запись
    // «исчезала» из журнала VL-227.
    // VL-259: приоритет фазы рана — явная phase (CLI-режим <фаза> <taskId>) →
    // VIBELOG_RUN_PHASE (оркестратор знает фактическую фазу resume-рана) →
    // VIBELOG_PHASE_NAME (кроме служебного 'prompt') → фаза сессии.
    // by_phase задачи теперь тоже пишется фазой РАНА (AC3): 'prompt' туда
    // не попадает — служебная фаза не должна маскировать реальную работу.
    const phaseName = existing?.phase ?? (isPhaseMode ? phase : process.env.VIBELOG_PHASE_NAME);
    const envPhaseName = process.env.VIBELOG_PHASE_NAME;
    const envRunPhase =
      process.env.VIBELOG_RUN_PHASE ?? (envPhaseName && envPhaseName !== 'prompt' ? envPhaseName : undefined);
    const runPhase = phase ?? envRunPhase ?? phaseName;
    // env-taskId фильтруем по префиксу конфига (VL-118, как при создании меты):
    // чужой id не должен получить ни frontmatter, ни меты пост-фактум
    const envTaskId = process.env.VIBELOG_PHASE_TASK_ID;
    // VL-299: маркер эксперимента (exp-<id>/run-<N>) — при нём billing задачи
    // не пишется, usage уходит в <run-dir>/usage.json (doc-21 §13)
    const experimentMarker = parseExperimentMarker(process.env[EXPERIMENT_ENV]);
    const taskId = existing?.taskId
      ?? (isPhaseMode
        ? positionals[1]
        : envTaskId && taskIdPattern(cwd).test(envTaskId) ? envTaskId : undefined);
    if (!taskId) {
      // VL-243: ран задачи (env/позиционные дали задачу, а меты нет) не должен
      // молча теряться — явный след в stderr → logTail оркестратора.
      const hintedTask = isPhaseMode ? positionals[1] : envTaskId;
      // VL-299: ран эксперимента идёт БЕЗ backlog-задачи (task_id датасета —
      // не задача), поэтому предупреждение о billing для него бессмысленно
      if ((hintedTask || process.env.VIBELOG_PHASE_NAME) && !experimentMarker) {
        console.error(
          `Предупреждение: billing не записан — taskId не определён (фаза=${runPhase ?? '?'}, ` +
            `флаг/позиционный=${hintedTask ?? '-'}, env=${envTaskId ?? '-'})`
        );
      }
    }
    // VL-299 (doc-21 §13): ран эксперимента НЕ пишет billing задачи —
    // dataset-задачи (t1, t2, …) не являются backlog-задачами, и файлы
    // T1.json засоряли бы учёт (а реальные задачи получали бы чужие цифры
    // при совпадении id). usage уходит в <run-dir>/usage.json рана.
    // Блок стоит ДО `if (taskId)`: у эксперимента taskId нет вовсе.
    if (experimentMarker) {
      try {
        const runUsage: TokenUsage = {
          input: loopResult.usage.input_tokens,
          output: loopResult.usage.output_tokens,
          cache: loopResult.usage.cache_read_input_tokens,
          total: loopResult.usage.total_tokens,
          requests: loopResult.num_turns,
          ...(loopResult.usage.reasoning_tokens
            ? { reasoning: loopResult.usage.reasoning_tokens }
            : {}),
        };
        const usagePath = appendExperimentUsage(taskCwd, experimentMarker.expId, experimentMarker.run, {
          ...(process.env.VIBELOG_EXPERIMENT_TASK_ID
            ? { task_id: process.env.VIBELOG_EXPERIMENT_TASK_ID }
            : {}),
          ...(process.env.VIBELOG_EXPERIMENT_VARIANT
            ? { variant: process.env.VIBELOG_EXPERIMENT_VARIANT }
            : {}),
          sessionId,
          ...(runPhase ? { phase: runPhase } : {}),
          startedAt: runStartedAt,
          finishedAt: new Date().toISOString(),
          durationMs: loopResult.duration_ms,
          usage: runUsage,
          model: llm.model || undefined,
          agent: 'vb',
        });
        if (usagePath) {
          console.error(`Эксперимент ${process.env[EXPERIMENT_ENV]}: usage записан в ${usagePath} (billing не пишется)`);
        } else {
          console.error(
            `Предупреждение: эксперимент ${process.env[EXPERIMENT_ENV]}: backlog не найден — usage рана не сохранён`
          );
        }
        // Маркер «учёт сделан»: fallback оркестратора не должен дописать billing
        updateSessionMeta(sessionsDir, sessionId, {
          cwd,
          billing_recorded: { sessionId, finishedAt: new Date().toISOString() },
        });
      } catch (err) {
        console.error(`Предупреждение: usage эксперимента не записан — ${(err as Error).message}`);
      }
    }
    if (taskId && !experimentMarker) {
      // 1) Дельта в frontmatter (идемпотентно через usage_recorded: в ране
      // finish_phase уже мог дописать часть токенов)
      try {
        const delta = usageDelta(existing?.usage_recorded ?? {}, sessionUsage);
        if (hasUsageDelta(delta)) {
          // VL-259: by_phase — по фазе РАНА (раньше писали фазу сессии, и у
          // VL-235 в by_phase был только plan, хотя жгли Code-раны)
          addTaskTokenUsage(taskCwd, taskId, runPhase, delta, loopResult.duration_ms);
          updateSessionMeta(sessionsDir, sessionId, { cwd, usage_recorded: sessionUsage });
        } else if (existing && !existing.usage_recorded) {
          // дельта 0 (старый jsonl без usage в сообщениях) — отметку всё равно
          // ставим, чтобы finish_phase следующего рана не пытался переписать
          updateSessionMeta(sessionsDir, sessionId, { cwd, usage_recorded: sessionUsage });
        }
      } catch (err) {
        console.error(`Предупреждение: token_usage задачи ${taskId} не обновлён — ${(err as Error).message}`);
      }
      // 1.5) VL-277: файл задачи коммитится ПОСЛЕ записи usage — иначе
      // token_usage оставался единственной незакоммиченной правкой после
      // close (шаг 6 шаблона коммитил файл раньше, чем usage был известен).
      // Гейт по фазе: только close; git-ошибки глушит сам хелпер (риск R4).
      // VL-304: авто-отчёт пишется ДО коммита — иначе файл задачи остался бы
      // грязным после close (тест VL-277 AC1).
      try {
        writeAutoReportIfMissing({
          cwd,
          taskCwd,
          taskId,
          phase: runPhase ?? '',
          runStartedAt,
          isError: loopResult.is_error,
        });
      } catch (err) {
        console.error(`Предупреждение: авто-отчёт фазы не записан — ${(err as Error).message}`);
      }
      try {
        if (isTaskCommitPhase(runPhase)) {
          commitTaskFile(taskCwd, taskId, runPhase as string);
        }
      } catch (err) {
        console.error(`Предупреждение: коммит файла задачи ${taskId} не выполнен — ${(err as Error).message}`);
      }
      // 2) Billing — append-only источник правды (каждый ран = запись).
      // usage записи — ЗА РАН (loopResult.usage накапливает только ответы
      // этого запуска), а не кумулятив сессии: иначе resume-записи давали
      // бы двойной счёт при суммировании журнала
      try {
        const runUsage: TokenUsage = {
          input: loopResult.usage.input_tokens,
          output: loopResult.usage.output_tokens,
          cache: loopResult.usage.cache_read_input_tokens,
          total: loopResult.usage.total_tokens,
          requests: loopResult.num_turns,
          ...(loopResult.usage.reasoning_tokens
            ? { reasoning: loopResult.usage.reasoning_tokens }
            : {}),
        };
        const finishedAt = new Date().toISOString();
        appendBilling(taskCwd, taskId, {
          sessionId,
          phase: runPhase,
          // VL-243: фаза сессии — только если отличается от фазы рана
          ...(phaseName && phaseName !== runPhase ? { sessionPhase: phaseName } : {}),
          // VL-259: startedAt — фактическое начало рана (не время создания
          // сессии: иначе resume-раны неразличимы по журналу)
          startedAt: runStartedAt,
          startedAtKind: 'run',
          finishedAt,
          durationMs: loopResult.duration_ms,
          usage: runUsage,
          model: llm.model || undefined,
          agent: 'vb',
        });
        // VL-243: маркер «этот ран в billing записан» — finish() оркестратора
        // по нему не дописывает fallback-запись (защита от двойного учёта)
        updateSessionMeta(sessionsDir, sessionId, {
          cwd,
          billing_recorded: { sessionId, finishedAt },
        });
      } catch (err) {
        console.error(`Предупреждение: billing задачи ${taskId} не дополнен — ${(err as Error).message}`);
      }
    }
    // 3) Мета сессии — merge (lesson-40: taskId/phase resume-рана не затираются).
    // /prompt и интерактивные сессии без меты и без taskId — по-прежнему
    // без меты (поведение VL-110 не меняем: отсутствие меты — не ошибка)
    if (existing || taskId) {
      try {
        updateSessionMeta(sessionsDir, sessionId, {
          cwd,
          finishedAt: new Date().toISOString(),
          durationMs: loopResult.duration_ms,
          usage: sessionUsage,
          model: llm.model || undefined,
          agent: 'vb',
          // VL-203: wire-payload последнего/пикового запроса — JSONL-мета
          // фиксирует размер тела запроса для диагностики отказов
          ...(loopResult.last_payload_bytes !== undefined
            ? { last_payload_bytes: loopResult.last_payload_bytes }
            : {}),
          ...(loopResult.max_payload_bytes !== undefined
            ? { max_payload_bytes: loopResult.max_payload_bytes }
            : {}),
          // VL-229 (AC1): топ повторяющихся path|pattern + доля от всех
          // tool-вызовов сессии — мета становится источником для /analyze
          repeat_stats: repeatStats,
          // VL-251: накопленные сигнатуры блока — объединяем с прошлыми,
          // дедуплицируем и капуем (20), чтобы мета не пухла за тысячи ранов
          blocked_signatures: [
            ...new Set([...(existing?.blocked_signatures ?? []), ...(loopResult.blocked_signatures ?? [])]),
          ].slice(-20),
          // VL-253: исход рана — finish_phase не доверяет явному tokenUsage
          // после упавшей фазы (значения из сводки упавшего рана)
          last_run: { is_error: loopResult.is_error, finishedAt: new Date().toISOString() },
        });
        // VL-259: история ранов меты — аддитивно (phase/taskId не трогаются,
        // lesson-40/VL-147). По ней разбор восстанавливает число ранов, фазу
        // каждого и фактические времена (раньше видна была только фаза
        // создания сессии — отсюда неточность в разборе VL-254).
        if (runPhase) {
          appendSessionRun(sessionsDir, sessionId, {
            sessionId,
            phase: runPhase,
            ...(phaseName && phaseName !== runPhase ? { sessionPhase: phaseName } : {}),
            startedAt: runStartedAt,
            finishedAt: new Date().toISOString(),
            durationMs: loopResult.duration_ms,
            usage: sessionUsage,
            agent: 'vb',
            billing: 'run',
          });
        }
      } catch (err) {
        console.error(`Предупреждение: мета сессии ${sessionId} не дополнена — ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error(`Предупреждение: учёт токенов сессии не выполнен — ${(err as Error).message}`);
  }

  // ── VL-254: прогресс оборвавшегося рана ────────────────────────────────
  // Фаза code, убитая wall-time'ом, раньше не оставляла ни коммита, ни
  // отчёта: ветка vl-235 осталась с M-файлами, а транскрипт был единственным
  // источником правды. Теперь при обрыве пишем блок «что сделано / что
  // осталось» в мету сессии, коммитим WIP-изменения (только code) и
  // добавляем комментарий в задачу.
  await recordRunProgress({ loopResult, sessionsDir, sessionId, cwd });

  // VL-203 (AC1): итоговая диагностика фазы в stderr → logTail оркестратора
  // (хвост 50 строк): байты payload последнего запроса + usage по фазе —
  // по ним отличаем content-based отказ провайдера от размерного.
  // Печатается ПОСЛЕ tui.unmount() — альтернативный буфер закрыт, рендер цел.
  console.error(
    `[vibelog-agent] фаза: запросов=${loopResult.num_turns} (LLM-запросы/ходы модели), ` +
      `tool-calls=${loopResult.tool_calls_total} (лимит ${opts.maxToolCalls ?? 100}, счётчик рана — VL-221), ` +
      // VL-229 (AC1): доля повторов и топ-3 переиспользуемых ключей прямо в
      // диагностике — при разборе лога видно зацикливание без парсинга jsonl
      `повторов=${loopResult.repeat_stats.repeat_calls}/${loopResult.repeat_stats.tool_calls_total} ` +
      `(${Math.round(loopResult.repeat_stats.repeat_share * 100)}%), ` +
      // VL-254 (AC1): shell-вызовы отдельной строкой — в VL-235 они дали 65%
      // tool-calls, и в общей доле этот вклад не виден без разбивки
      `shell-повторов=${loopResult.repeat_stats.shell_repeat_calls}/${loopResult.repeat_stats.shell_tool_calls} ` +
      `(${Math.round(loopResult.repeat_stats.shell_share * 100)}%), ` +
      `топ-повторов=${loopResult.repeat_stats.top.slice(0, 3).map((e) => `${e.key}×${e.count}`).join(', ') || 'нет'}, ` +
      // VL-284: сколько вызовов guard заблокировал — видно, что фаза упиралась
      // в зацикливание, а не просто долго шла (инцидент close VL-280)
      `блокировок=${loopResult.repeat_blocked ?? 0}, ` +
      `payload последнего запроса=${loopResult.last_payload_bytes ?? 'н/д'} байт ` +
      `(макс ${loopResult.max_payload_bytes ?? 'н/д'}), usage=${JSON.stringify(loopResult.usage)}`,
  );

  // Единственная строка stdout — JSON type=result (контракт parseQwenResult).
  // duration_api_ms loop не меряет отдельно — приравнен к общему duration_ms.
  const output: AgentJsonResult = {
    type: 'result',
    result: loopResult.result,
    is_error: loopResult.is_error,
    num_turns: loopResult.num_turns,
    duration_ms: loopResult.duration_ms,
    duration_api_ms: loopResult.duration_ms,
    // VL-221: tool-calls текущего рана рядом с num_turns/requests (разные
    // счётчики: requests — LLM-ходы, tool-calls — вызовы инструментов).
    // parseQwenResult строит QwenResult из известных полей — лишнее поле
    // в JSON не ломает парсинг.
    tool_calls_total: loopResult.tool_calls_total,
    session_id: sessionId,
    usage: { ...loopResult.usage },
  };
  process.stdout.write(JSON.stringify(output) + '\n');
  process.exitCode = loopResult.is_error ? 1 : 0;
}

// Самозапуск при прямом исполнении (node dist/agent/cli.js …):
// bin-шим использует экспорт main и сюда не попадает. Сравнение через
// realpathSync — защита от симлинков (macOS /tmp → /private/tmp).
try {
  const invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : '';
  if (invoked && realpathSync(fileURLToPath(import.meta.url)) === invoked) {
    main(process.argv.slice(2)).catch((err) => {
      console.error(`Ошибка: ${(err as Error).message}`);
      process.exit(1);
    });
  }
} catch {
  // argv[1] не существует или не файл — это не прямой запуск, просто выходим
}
