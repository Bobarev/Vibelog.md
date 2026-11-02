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
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPrompt, PHASES, taskBlockText, taskExtraVars } from './phase-prompt.js';
import type { Phase } from './phase-prompt.js';
import { addComment, addTaskTokenUsage, getTask, rejectTaskFile, wasInCode } from '../core/store.js';
// VL-277: файл задачи коммитится после записи token_usage рана (qwen — основной путь close)
import { commitTaskFile, isTaskCommitPhase } from '../agent/task-commit.js';
import type { Task } from '../core/task.js';
import { ensureTaskWorktree, shouldEnsureWorktree, taskBranchName, taskWorktreeDir } from '../core/worktree.js';
import { explainQwenParse, parseQwenResult } from './qwen-result.js';
import type { QwenResult } from './qwen-result.js';
import {
  loadBotSettings,
  resolveBranchMode,
  resolveCodeSameSession,
  // VL-180: единый резолв агента по умолчанию — бот и веб читают
  // default_agent из .vibelog/settings.json, а не хардкодят 'qwen'
  resolveDefaultAgent,
} from '../bot/settings.js';
import { taskIdPattern } from '../core/config.js';
// VL-246: предпроверка незавершённого merge в главном репозитории перед close
import { getMergeState } from '../core/git.js';
import { getWorkflowForTask, getStatusAfterPhase, isPhaseAllowed } from '../core/workflow.js';
// VL-196: транзиентный In Progress на время workflow-фазы — mark после спавна,
// finalize в finish() до onExit (единая точка spawnQwenRun для всех запусков)
import { markPhaseStarted, finalizePhaseStatus, readPhaseTransient } from '../core/phase-transient.js';
import { agentSessionsDir, analyzeToolRepeatsFromJsonlSync, appendSessionRun, findTaskPhaseSessionSync, listTaskSessionMetas, loadSessionMetaSync, saveSessionMeta, updateSessionMeta } from '../agent/session.js';
import { hasUsageDelta, usageDelta } from '../core/analytics.js';
import type { TokenUsage } from '../core/analytics.js';
import { appendBilling } from '../core/billing.js';
// VL-276: живость процесса фазы — reap залипших локов (см. reapStaleRuns);
// функция уже написана для супервизора, дублировать логику process.kill нельзя
import { isPidAlive } from '../core/supervisor-state.js';

// Реэкспорт для обратной совместимости (VL-85): renderPrompt/Phase вынесены
// в phase-prompt.ts — общий модуль оркестратора и CLI vibelog-agent.
export { renderPrompt };
export type { Phase };

/** Сколько строк лога хранить в хвосте. */
const LOG_TAIL_LINES = 50;

/**
 * VL-276: окно ожидания события `close` после `exit` дочернего процесса.
 *
 * Node эмитит `close` не по смерти процесса, а после закрытия его stdio-потоков.
 * Если stdout-пайп удерживает живой потомок (MCP-сервер агента, node/npx-обёртка),
 * `close` не приходит никогда, хотя процесс давно вышел — и запись `activeRuns`
 * живёт вечно: задача получает «Запуск уже выполняется» и не двигается с места
 * (инцидент VL-248 → баг VL-276). Поэтому по `exit` заводим таймер: не дождались
 * `close` — завершаем ран сами (данные рана при этом сохраняются: `tailBuf`
 * досыпается в `finish`, парсер получает накопленный stdout).
 */
const RUN_CLOSE_GRACE_MS = 2000;

/**
 * Тестовый шов VL-140/VL-276: переопределяет grace-период (null — прод-значение).
 * Нужен, чтобы тест «потомок держит stdout» не ждал 2 секунды: с прокидкой 150 мс
 * кейс остаётся быстрым и не становится флаковым.
 */
let runCloseGraceMsOverride: number | null = null;

/** Задаёт grace-период завершения рана по `exit` (только для тестов). */
export function setRunCloseGraceMsForTests(ms: number | null): void {
  runCloseGraceMsOverride = ms;
}

/** Действующий grace-период: тестовый шов либо прод-константа. */
function runCloseGraceMs(): number {
  return runCloseGraceMsOverride ?? RUN_CLOSE_GRACE_MS;
}

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
  /**
   * VL-289: фаза сама сообщила аварийное завершение (`aborted: true` в
   * backlog_finish_phase). Признак НЕ влияет на `exitCode` (0 остаётся 0 —
   * на код смотрят автоочередь и боты) и живёт отдельным полем, чтобы
   * супервизор видел «агент попросил человека» вместо «нет прогресса».
   */
  aborted?: boolean;
  /** VL-289: дословный текст отчёта фазы при aborted (обрезка 500). */
  abortedReason?: string;
  /** VL-289: итог рана — ok (статус применён) / aborted / failed / skipped. */
  phaseResult?: 'ok' | 'aborted' | 'failed' | 'skipped';
  /** VL-146: queued=true — close ждёт в очереди branch-mode (состояние getRun). */
  queued?: boolean;
}

/** Результат startPhase: успех или ошибка валидации/guard. */
export type StartResult =
  | {
      started: true;
      pid: number;
      /** VL-146: close поставлен в очередь branch-mode — процесс ещё не создан (pid 0). */
      queued?: boolean;
      /**
       * VL-246: какая задача держит текущий close (канонический ключ, напр.
       * 'VL-212') — для сообщения «встанет после завершения close VL-N».
       * Поле additive: вне очереди отсутствует.
       */
      queuedBehind?: string;
      /**
       * VL-187: статус продолжения plan-сессии фазой code (только phase==='code'):
       * applied — настройка/флаг включены и план-сессия найдена (--resume передан);
       * no-plan-session — включены, но мета план-сессии не найдена (новая сессия);
       * off — настройка выключена; override-off — явный --no-same-session/sameSession:false.
       * Поле additive: API отдаёт StartResult целиком (202), бот показывает в сообщении.
       */
      sameSession?: 'applied' | 'no-plan-session' | 'off' | 'override-off';
    }
  | { error: string };

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
  /**
   * VL-276: код выхода из события `exit` (null/undefined — процесс ещё жив или
   * exit не приходил). Нужен reap'у и проверке живости: `exitCode !== null`
   * означает «процесса нет», даже если `close` так и не пришёл.
   */
  exitCode?: number | null;
  /** VL-276: сигнал из события `exit` (SIGTERM/SIGKILL и т.п.). */
  signalCode?: string | null;
  /**
   * VL-276: замыкание на `finish()` этого рана — единая точка корректного
   * завершения (закрыть probe тишины, досыпать буферы, разобрать результат,
   * записать lastRuns, вызвать onExit). Reap обязан идти через него, а не
   * удалять запись напрямую: иначе теряются logTail/учёт/уведомление.
   */
  finalize?: (code?: number | null) => void;
}

/** Задача → активный запуск (guard от двойного запуска). */
const activeRuns = new Map<string, ActiveRun>();
/** Задача → последний завершённый запуск (для getRun после close). */
const lastRuns = new Map<string, PhaseRun>();
/**
 * Счётчик авто-resume после отказа провайдера «high risk» (VL-178):
 * максимум 1 перезапуск на runKey — защита от цикла «упал → resume → упал».
 */
const highRiskAutoRetries = new Map<string, number>();

/** Элемент очереди close-фаз (VL-146): полный запрос на запуск, ждущий освобождения. */
interface QueuedClose {
  cwd: string;
  taskId: string;
  onExit?: PhaseExitCallback;
  extraVars?: Record<string, string>;
  agent: 'qwen' | 'vb';
  /** VL-200: --resume retry-рана — иначе close в очереди branch-mode теряет флаг */
  extraArgs?: string[];
}

/**
 * Очередь close-фаз branch-mode (VL-146): в режиме веток merge в главном
 * репозитории требует эксклюзивного доступа — параллельные close разных
 * задач конфликтуют по git. Очередь живёт в процессе оркестратора (бот/
 * vibelog browser) и общая для агентов qwen/vb. Ограничение (задокументировано
 * в README): рестарт процесса теряет ожидающие элементы — known limitation.
 */
const closeQueue: QueuedClose[] = [];
/** true ⇔ close-фаза активна или стартует из очереди (guard очереди, VL-146). */
let closeActive = false;
/**
 * VL-246: канонический ключ задачи активного close (null — нет активного).
 * Нужен только для сообщения «удерживает очередь VL-N»: сама сериализация
 * по-прежнему на closeActive. Сбрасывается в единственных точках выхода
 * очереди (drainCloseQueue), чтобы подсказка не устаревала.
 */
let closeOwner: string | null = null;

/**
 * Тестовый шов VL-140: заменяет process.env как базу env спавна фаз.
 * null — прод-режим (baseEnv() === process.env). Тесты передают явный
 * объект, чтобы спавны не зависели от глобальных мутаций process.env
 * (включая переопределение VIBELOG_CWD/VIBELOG_PHASE_* — регрессия VL-125).
 */
let spawnEnvBaseOverride: NodeJS.ProcessEnv | null = null;

/**
 * Тестовый шов VL-140: задаёт базу env для spawn фаз оркестратора.
 * null — вернуть прод-режим (process.env). Вызывать строго из тестов.
 */
export function setSpawnEnvBaseForTests(env: NodeJS.ProcessEnv | null): void {
  spawnEnvBaseOverride = env;
}

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
 * @param opts — VL-147: sameSession — явное переопределение настройки
 *   code_same_session для фазы code (продолжение plan-сессии через --resume);
 *   undefined — брать настройку из settings.json.
 *   VL-200: extraArgs — доп. флаги в argv спавна (['--resume', sessionId] при
 *   retry автоочереди); при наличии --resume резолв план-сессии (sameSession)
 *   пропускается — retry-сессия приоритетнее, дубль флага запрещён (lesson-18)
 */
export function startPhase(
  cwd: string,
  taskId: string,
  phase: string,
  onExit?: PhaseExitCallback,
  extraVars?: Record<string, string>,
  agent: 'qwen' | 'vb' = resolveDefaultAgent(cwd),
  opts?: { sameSession?: boolean; extraArgs?: string[] }
): StartResult {
  // Защита HTTP-границы (VL-66): api.ts пропускает произвольный phase из
  // POST-body — без guard'а qwen получил бы шаблон prompt.md с неподставленным
  // {{prompt}}. Фаза prompt не привязана к задаче и живёт в startPrompt.
  if (phase === 'prompt') {
    return { error: 'Фаза prompt запускается через startPrompt' };
  }
  // VL-141: analyze не привязан к задаче и берёт контекст из meta.json сессии
  // — отдельным if (текст prompt-гарда не менять: orchestrator.test матчит
  // /startPrompt/). Закрывает HTTP API (api.ts передаёт произвольный phase).
  if (phase === 'analyze') {
    return { error: 'Фаза analyze запускается через startAnalyze' };
  }
  // VL-137: поля задачи (title/type/описание/план/AC/DoD/статус/файлы/последний
  // комментарий) подставляются в промпт один раз через getTask — агенту не нужен
  // первый backlog_view_task. Решение (Pavel): если задача не читается — фаза
  // НЕ запускается: пустой блок {{...}} модель не исправит (фолбэк-инструкции
  // в шаблонах нет), а незапущенная фаза не тратит ходы и не правит файлы вслепую.
  const taskVars = taskExtraVars(cwd, taskId);
  if (!taskVars) {
    return { error: `Задача не найдена или не читается: ${taskId}` };
  }
  // VL-188: workflow-фазы проверяются по переходам статуса задачи.
  // Служебные фазы (comment/prompt/analyze/resume) пропускаются без
  // проверки — они статуса не меняют и в transitions не участвуют.
  // Отдельно getTask читается заодно с taskExtraVars (один и тот же файл,
  // кэша нет — цена одного чтения мала).
  const wfTask = getTask(cwd, taskId);
  const workflow = wfTask ? getWorkflowForTask(cwd, wfTask) : null;
  const taskStatus = wfTask?.status ?? '';
  // Известность фазы проверяется ДО workflow: неизвестная фаза (deploy и т.п.)
  // должна падать с прежней ошибкой «Неизвестная фаза» из renderPrompt,
  // а не с «недопустима из статуса» (контракт тестов VL-66)
  if (workflow && PHASES.includes(phase as Phase) && !isPhaseAllowed(workflow, taskStatus, phase)) {
    return { error: `Фаза ${phase} недопустима из статуса ${taskStatus}` };
  }
  // {{producesStatus}} — статус после фазы из workflow (VL-188): шаблоны
  // фаз больше не хардкодят "Spec"/"Planned"/"Review"/"Done".
  // null (нет перехода — служебная фаза/до- workflow статус) → '' —
  // в шаблонах служебных фаз {{producesStatus}} не используется.
  const producesStatus = workflow ? (getStatusAfterPhase(workflow, taskStatus, phase) ?? '') : '';
  let prompt: string;
  try {
    prompt = renderPrompt(
      phase,
      taskId,
      {
        // VL-137: подстановки полей задачи — после {{comment}} (контракт VL-80
        // не трогаем: подстановки только новыми переменными, порядок merge сохранён)
        ...extraVars,
        // VL-307: {{comment}} подставляется ВСЕГДА — при отсутствии комментария
        // строкой «без комментария». Литерала {{comment}} в промпте не бывает
        // никогда, поэтому фолбэк-строка «остался неподставленный {{comment}}»
        // из шаблонов удалена. Явный комментарий (extraVars) имеет приоритет;
        // пустая строка трактуется как отсутствие (||, не ??).
        comment: extraVars?.comment || 'без комментария',
        ...taskVars,
        // VL-188: статус после фазы — после taskVars, чтобы workflow-переход
        // имел приоритет ({{taskStatus}} — исходный статус, {{producesStatus}} — целевой)
        producesStatus,
        // VL-112: {{branch}}/{{worktreeDir}} — подстановки для close-worktree шаблона
        branch: taskBranchName(taskId),
        worktreeDir: `.vibelog/worktrees/${taskId.toLowerCase()}`,
      },
      // VL-112: close задачи с worktree — отдельный шаблон; VL-188: cwd —
      // переопределение шаблонов проектом (.vibelog/prompts/phases/)
      { closeWorktree: phase === 'close' && existsSync(taskWorktreeDir(cwd, taskId)), cwd }
    );
  } catch (err) {
    return { error: (err as Error).message };
  }
  // VL-147: фаза code может продолжать plan-сессию агента (--resume) —
  // экономия входных токенов за счёт кэша большого контекста. Включение —
  // настройка code_same_session (дефолт off); явный флаг команды/API
  // (opts.sameSession) переопределяет её в обе стороны. Источник sessionId —
  // меты .vibelog/agent-sessions/*.meta.json (пишет CLI при старте задачной
  // сессии; для qwen дополнительно дописывает оркестратор в finish, VL-147).
  // VL-200: extraArgs из opts — стартовое значение (retry автоочереди приносит
  // ['--resume', sid] упавшей фазы); без него — [], как раньше.
  let extraArgs: string[] = opts?.extraArgs ?? [];
  const sameSession = opts?.sameSession ?? resolveCodeSameSession(cwd);
  // VL-187: статус продолжения plan-сессии — считается ТОЛЬКО здесь (общий
  // модуль бота и веба) и возвращается в StartResult: API-ответ 202 и
  // сообщения бота показывают, что реально произошло при запуске code.
  // Вне фазы code поле не добавляется (undefined).
  let sameSessionStatus: 'applied' | 'no-plan-session' | 'off' | 'override-off' | undefined;
  if (phase === 'code') {
    sameSessionStatus = opts?.sameSession === false ? 'override-off' : 'off';
    // VL-200: явный --resume из extraArgs (retry автоочереди продолжает
    // УПАВШУЮ code-сессию) приоритетнее plan-сессии — резолв пропускаем,
    // sameSessionStatus остаётся 'off' (дубль --resume запрещён, lesson-18)
    if (sameSession && !extraArgs.includes('--resume')) {
      // Основной каталог меты — главный репо; фолбэк (VL-187, ветка B) —
      // каталог сессий worktree задачи: мета план-сессии могла попасть туда
      // при запуске плана из worktree без VIBELOG_CWD/со старым dist.
      const mainDir = agentSessionsDir(cwd);
      const wtDir = agentSessionsDir(taskWorktreeDir(cwd, taskId));
      let planSessionId = findTaskPhaseSessionSync(mainDir, taskId, 'plan');
      if (!planSessionId) {
        planSessionId = findTaskPhaseSessionSync(wtDir, taskId, 'plan');
      }
      if (planSessionId) {
        extraArgs = ['--resume', planSessionId];
        sameSessionStatus = 'applied';
        prompt +=
          '\n\nСессия продолжает фазу plan, контекст планирования уже в истории.';
      } else {
        // Fallback: план-сессия не найдена (задача планировалась до VL-147,
        // меты нет / сессия удалена) — обычный новый запуск, регрессий нет.
        // VL-187: лог расширен — каталоги поиска и меты задачи, иначе причина
        // fallback нечитаема из лога оркестратора (инцидент VL-185).
        sameSessionStatus = 'no-plan-session';
        const metas = [mainDir, wtDir]
          .map((dir) => listTaskSessionMetas(dir, taskId))
          .filter(Boolean)
          .join('; ');
        console.log(
          `[phase ${taskId}] VL-147: план-сессия не найдена — code запускается в новой сессии. ` +
            `Каталоги поиска: ${mainDir}, ${wtDir}. ` +
            `Меты задачи: ${metas || 'нет'}`
        );
      }
    }
  }
  // VL-146: в branch-mode close сериализуется — merge ветки в главном репо
  // требует эксклюзивного доступа к git, параллельные close разных задач
  // конфликтуют. Guard общий для агентов qwen/vb; вне branch-mode — прежний путь.
  if (phase === 'close' && resolveBranchMode(cwd)) {
    // Канонический ключ задачи — как в spawnQwenRun (VL-145)
    const canon = taskIdPattern(cwd).test(taskId) ? taskId.toUpperCase() : taskId;
    // Активный запуск задачи (любой фазы) → в очередь не ставим: guard
    // activeRuns в spawnQwenRun вернул бы ту же ошибу и при dequeue — раньше
    // и понятнее для вызывающего
    // VL-276: залипший лок снимаем ДО проверки — иначе мёртвый ран блокирует close
    if (activeRuns.has(canon)) reapStaleRun(canon);
    if (activeRuns.has(canon)) {
      return {
        error: 'Запуск уже выполняется' + (taskIdPattern(cwd).test(canon) ? ` (${canon})` : ''),
      };
    }
    // VL-246: предпроверка git-состояния ПЕРЕД очередью и спавном. Если в
    // главном репо висит незавершённый merge (чужой close упал/прерван),
    // `git merge` нашей ветки упадёт с «unmerged files» — агент потратит ран
    // впустую (инцидент VL-212/VL-219, lesson-82). Guard стоит до
    // closeActive/spawnQwenRun → статус задачи не меняется (транзиент
    // In Progress ставится только при успешном спавне, VL-196).
    const merge = getMergeState(cwd);
    if (merge.inProgress) {
      const conflicts = merge.unmerged.length
        ? `, конфликты: ${merge.unmerged.slice(0, 5).join(', ')}` +
          (merge.unmerged.length > 5 ? ` и ещё ${merge.unmerged.length - 5}` : '')
        : '';
      return {
        error:
          'Close не может начать слияние: в главном репозитории идёт незавершённый merge' +
          (merge.head ? ` (MERGE_HEAD ${merge.head.slice(0, 7)})` : '') +
          conflicts +
          '. Заверши или отмени чужое слияние и повтори close (lesson-82)',
      };
    }
    // Двойной /close одной задачи: она уже ждёт в очереди — дубликат не добавляем
    if (closeQueue.some((e) => e.taskId.toUpperCase() === canon)) {
      return { error: `Close уже в очереди: ${canon}` };
    }
    // VL-276: close-очередь залипала навсегда, если флаг closeActive остался
    // от рана, который завершился без onExit (close не пришёл — stdio держал
    // потомок). Живого close-рана нет → флаг фиктивный: снимаем и разгребаем
    // очередь, иначе ни один следующий close не стартует.
    if (closeActive && !hasLiveCloseRun()) {
      console.log(`[phase ${canon}] VL-276: снят залипший closeActive — живого close-рана нет`);
      closeActive = false;
      closeOwner = null;
      drainCloseQueue();
    }
    if (closeActive) {
      closeQueue.push({ cwd, taskId, onExit, extraVars, agent, extraArgs: opts?.extraArgs });
      // VL-246: сообщаем, чей close удерживает очередь (подсказка в боте/вебе)
      return { started: true, pid: 0, queued: true, queuedBehind: closeOwner ?? undefined };
    }
    closeActive = true;
    closeOwner = canon;
    // Drain обязателен при ЛЮБОМ исходе фазы (finally — на случай ошибки
    // в onExit вызывающего): иначе очередь зависнет навсегда
    const wrappedExit: PhaseExitCallback = (run) => {
      try {
        onExit?.(run);
      } finally {
        drainCloseQueue();
      }
    };
    const res = spawnQwenRun(cwd, taskId, phase as Phase, prompt, wrappedExit, agent, extraArgs);
    if ('error' in res) {
      // Спавн не состоялся (guard и т.п.) — флаг снимается, очередь разгребается
      closeActive = false;
      closeOwner = null;
      drainCloseQueue();
    }
    return res;
  }
  const res = spawnQwenRun(cwd, taskId, phase as Phase, prompt, onExit, agent, extraArgs);
  // VL-187: статус sameSession добавляем только к успеху и только для code
  // (вне code sameSessionStatus === undefined — возвращаем как раньше)
  if ('error' in res || sameSessionStatus === undefined) return res;
  return { ...res, sameSession: sameSessionStatus };
}

/**
 * Общий запуск фазы задачи для бота и веб-API (VL-180).
 *
 * Единая точка «комментарий → фаза» (раньше дублировалась в api.ts trigger
 * и в commitComment//plan//code бота): сначала addComment в задачу — ДО
 * старта, чтобы taskExtraVars(startPhase) перечитал файл и {{taskLastComment}}
 * close-промпта уже содержал его (VL-60/порядок как раньше); исключение
 * addComment пробрасывается вызывающему (api → 500, бот → «Ошибка: …»).
 *
 * Агент: явный opts.agent → default_agent из .vibelog/settings.json
 * (VL-180: веб больше не хардкодит 'qwen' — браузер и бот идентичны).
 *
 * Пустой/отсутствующий комментарий НЕ создаёт extraVars и НЕ пишется в задачу;
 * в промпт при этом подставляется строка «без комментария» (VL-307) — литерала
 * {{comment}} в промпте не бывает никогда, фолбэк-строки в шаблонах нет.
 *
 * @param cwd — рабочая директория проекта (backlog/, .vibelog/settings.json)
 * @param taskId — ID задачи
 * @param phase — spec | plan | code | close | comment | reject
 * @param opts — comment: текст комментария (непустой после trim → addComment
 *   до старта); onExit: колбэк завершения фазы; agent: явный агент
 *   (перекрывает default_agent); sameSession: переопределение настройки
 *   code_same_session для фазы code (VL-147);
 *   extraArgs: доп. флаги argv спавна — VL-200: retry автоочереди передаёт
 *   ['--resume', sessionId] упавшей фазы (проброс в startPhase)
 * @returns StartResult — вызывающий по opts.comment сам знает, писался ли
 *   комментарий (нужно для 409-текста api и «⚠️»-сообщений бота)
 */
export function startTaskPhase(
  cwd: string,
  taskId: string,
  phase: string,
  opts?: {
    comment?: string;
    onExit?: PhaseExitCallback;
    agent?: 'qwen' | 'vb';
    sameSession?: boolean;
    extraArgs?: string[];
  }
): StartResult {
  // VL-180: агент — явный параметр либо default_agent проекта (fallback qwen)
  const agent = opts?.agent ?? resolveDefaultAgent(cwd);
  // Trim-пустой комментарий считается отсутствующим: не пишем в задачу
  // (в промпт startPhase подставит «без комментария», VL-307)
  const comment = opts?.comment?.trim();
  if (comment) {
    addComment(cwd, taskId, comment);
  }
  return startPhase(cwd, taskId, phase, opts?.onExit, comment ? { comment } : undefined, agent, {
    sameSession: opts?.sameSession,
    extraArgs: opts?.extraArgs,
  });
}

/**
 * Запускает следующий close из очереди branch-mode (VL-146).
 *
 * Вызывается из wrappedExit завершившейся close-фазы. Флаг closeActive
 * снимается ДО запуска — startPhase выставит его заново при успехе (иначе
 * ветка очереди снова поставила бы элемент в очередь). Ошибка dequeue'а
 * (задача удалена и т.п.) — колбэку элемента с logTail-причиной и переход
 * к следующему; рекурсия ограничена размером очереди.
 */
function drainCloseQueue(): void {
  const next = closeQueue.shift();
  if (!next) {
    closeActive = false;
    // VL-246: активного close больше нет — подсказка «удерживает VL-N» устареет
    closeOwner = null;
    return;
  }
  closeActive = false;
  closeOwner = null;
  const res = startPhase(next.cwd, next.taskId, 'close', next.onExit, next.extraVars, next.agent, {
    extraArgs: next.extraArgs,
  });
  if ('error' in res) {
    next.onExit?.({ running: false, phase: 'close', exitCode: 1, logTail: res.error });
    drainCloseQueue();
  }
}

/**
 * Отклоняет задачу (VL-144): статус Rejected + архив в backlog/completed/.
 *
 * Механика и LLM разделены:
 * - задача НИКОГДА не бывшая в Code (wasInCode === false) — откатывать нечего,
 *   rejectTaskFile выполняется синхронно, LLM не запускается;
 * - бывшая хотя бы раз в Code — запускается фаза reject (LLM-откат начатых
 *   незакоммиченных изменений), механика (статус+архив) выполняется в onExit
 *   завершения фазы: файл задачи должен существовать, пока агент его читает.
 *
 * @param cwd — рабочая директория проекта
 * @param id — ID задачи
 * @param comment — причина отказа (комментарий в задачу + {{comment}} промпта)
 * @param opts — onExit: вызывается после завершения LLM-фазы (и НЕ вызывается
 *   на синхронном механическом пути — там задача уже отклонена к возврату);
 *   agent — агент LLM-пути
 * @returns { rejected: true, task } — механика выполнена синхронно;
 *   StartResult — LLM-путь запущен (202) либо ошибка (не найдена/занята)
 */
export function rejectTask(
  cwd: string,
  id: string,
  comment?: string,
  opts?: { onExit?: PhaseExitCallback; agent?: 'qwen' | 'vb' }
): { rejected: true; task: Task } | StartResult {
  const task = getTask(cwd, id);
  if (!task) {
    return { error: `Задача не найдена: ${id}` };
  }
  // Никогда не была в Code → чистая механика, LLM не нужен (решение Phase 1)
  if (!wasInCode(task)) {
    return { rejected: true, task: rejectTaskFile(cwd, id, comment) };
  }
  // Была в Code → LLM-откат начатых изменений, механика — в onExit
  return startPhase(
    cwd,
    id,
    'reject',
    (run) => {
      rejectTaskFile(cwd, id, comment);
      opts?.onExit?.(run);
    },
    { comment: comment ?? '' },
    // VL-180: без явного агента — default_agent проекта (как у бота)
    opts?.agent ?? resolveDefaultAgent(cwd)
  );
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
 * @param agent — агент-исполнитель: дефолт — default_agent проекта (VL-180),
 *   fallback 'qwen'; встроенный vibelog-agent
 */
export function startPrompt(
  cwd: string,
  promptText: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = resolveDefaultAgent(cwd)
): StartResult {
  let prompt: string;
  try {
    // Шаблон prompt.md не содержит {{taskId}} — taskId пустой, важен только {{prompt}}
    // VL-188: cwd — переопределение шаблона проектом (.vibelog/prompts/phases/)
    prompt = renderPrompt('prompt', '', { prompt: promptText }, { cwd });
  } catch (err) {
    return { error: (err as Error).message };
  }
  return spawnQwenRun(cwd, 'prompt', 'prompt', prompt, onExit, agent);
}

/**
 * Запускает headless-разбор сессии агента по session-ref (VL-141, /analyze).
 *
 * Фаза analyze — без задачи (как prompt): контекст (задача/фаза/cwd) берётся
 * из meta.json сессии (VL-114), runKey — 'analyze-<sessionId>'. Работает
 * только для сессий vibelog-agent (jsonl-транскрипт): qwen-UUID отклоняется —
 * транскрипта для разбора нет.
 *
 * runKey не матчит taskIdPattern → worktree не трогается, запуск идёт из
 * главного cwd — это корректно: jsonl сессии лежит в главном репозитории
 * (VL-107-fix: веточный запуск не нашёл бы транскрипт worktree-сессии).
 *
 * @param cwd — рабочая директория проекта
 * @param sessionRef — session-ref бота: vb:agent-XXX либо голый agent-XXX
 * @param onExit — колбэк завершения (бот шлёт информационное сообщение)
 * @param agent — агент-исполнитель: qwen (дефолт) либо встроенный vibelog-agent
 * @param comment — необязательный комментарий пользователя (VL-169) → {{comment}} промпта
 */
export function startAnalyze(
  cwd: string,
  sessionRef: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = resolveDefaultAgent(cwd),
  comment?: string
): StartResult {
  // Нормализация: бот присылает vb:agent-XXX (префикс vb: снимает resume);
  // CLI может передать голый agent-XXX
  const bare = sessionRef.replace(/^vb:/, '');
  if (!/^agent-\d+$/.test(bare)) {
    // qwen-UUID не пускаем: jsonl-транскрипта у qwen-сессий нет
    return {
      error: `Некорректный session-ref: ${sessionRef} (ожидается vb:agent-XXX или agent-XXX; анализ только для сессий vibelog-agent)`,
    };
  }
  if (!existsSync(join(agentSessionsDir(cwd), bare + '.jsonl'))) {
    return { error: `Сессия не найдена: ${sessionRef}` };
  }
  // Мета опциональна: отсутствие (старые сессии, /prompt) — не ошибка,
  // подстановки получают заглушки
  const meta = loadSessionMetaSync(agentSessionsDir(cwd), bare);
  // VL-229 (AC3): топ повторов считается ЗДЕСЬ (синхронно, из jsonl) — иначе
  // агент тратил бы ход на пересчёт того, что детерминированно вычисляется.
  // Ошибка/отсутствие данных не роняет запуск: подстановки → «нет данных».
  let repeatSummary = 'нет данных';
  let repeatTop = '(нет данных)';
  try {
    const stats = analyzeToolRepeatsFromJsonlSync(agentSessionsDir(cwd), bare);
    if (stats && stats.tool_calls_total > 0) {
      const pct = Math.round(stats.repeat_share * 100);
      repeatSummary =
        `tool-вызовов всего ${stats.tool_calls_total}, из них повторных ${stats.repeat_calls} ` +
        `(${pct}% — доля от всех tool-вызовов сессии)`;
      repeatTop =
        stats.top.length === 0
          ? '(повторов не найдено)'
          : stats.top.map((e, i) => `${i + 1}. ${e.key} — ${e.count} обращений`).join('\n');
    }
  } catch {
    // Битый jsonl/нечитаемый каталог — блок остаётся «нет данных»
  }
  let prompt: string;
  try {
    prompt = renderPrompt(
      'analyze',
      meta?.taskId ?? '',
      {
        sessionId: bare,
        sessionPhase: meta?.phase ?? '(неизвестна)',
        sessionCwd: meta?.cwd ?? '(неизвестен)',
        sessionPath: `.vibelog/agent-sessions/${bare}.jsonl`,
        // VL-229 (AC3): готовый топ перечитываемых файлов и повторяющихся
        // запросов — отчёт показывает их без дополнительных ходов
        repeatSummary,
        repeatTop,
        // VL-169: подставляем всегда (пустая строка без комментария) —
        // иначе агент увидит literal {{comment}} в шаблоне
        comment: comment ?? '',
      },
      // VL-188: переопределение шаблона проектом
      { cwd }
    );
  } catch (err) {
    return { error: (err as Error).message };
  }
  // Компакт-блок задачи-владельца — для вердикта «объём задачи vs тупик»;
  // задача не найдена → блок '' (analyze не должен падать из-за пропажи файла)
  if (meta?.taskId) {
    const taskBlock = taskBlockText(cwd, meta.taskId);
    if (taskBlock) prompt += `\n\n${taskBlock}`;
  }
  return spawnQwenRun(cwd, `analyze-${bare}`, 'analyze', prompt, onExit, agent);
}

/**
 * Продолжает существующую сессию агента по reply-сообщению бота (VL-93/95).
 *
 * Отличие от startPrompt: шаблон phase-prompt НЕ используется — позиционный
 * промпт = сырой текст пользователя; флаг `--resume <sessionId>` продолжает
 * ту же сессию (без --fork-session — по описанию фичи). VL-145: runKey =
 * ID задачи из меты сессии (глобальный guard той же задачи — параллельные
 * resume РАЗНЫХ задач разрешены) либо `resume:<sessionId>`, если меты нет;
 * getRun по тому же ключу доступен.
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
  agent: 'qwen' | 'vb' = resolveDefaultAgent(cwd)
): StartResult {
  // Фаза 'prompt' — вне жизненного цикла задачи, шаблон не подставляется;
  // resume поддержан для обоих агентов (VL-95: vb хранит сессии JSONL).
  //
  // VL-110: если сессия принадлежит задаче (мета <id>.meta.json, пишет CLI
  // при создании задачной сессии) — resume возобновляется в worktree её
  // задачи: инцидент VL-98 — reply «Продолжи» шёл из главного cwd (runKey
  // 'resume' вне /^VL-\d+$/i) и патч-скрипт правил главный репозиторий
  // вместо worktree vb/vl-N. Меты нет (/prompt, старые сессии) — прежний путь.
  let worktreeTaskId: string | undefined;
  let note = '';
  // Бот передаёт sessionId с префиксом vb: — для поиска меты снимаем его
  const meta = loadSessionMetaSync(agentSessionsDir(cwd), sessionId.replace(/^vb:/, ''));
  // VL-118: taskId проверяется по префиксу конфига проекта, не хардкодом VL
  // VL-243: сессия фазы close теперь пишется в мету (учёт), но её resume
  // ОСТАЁТСЯ в главном репо — закрытие (merge ветки + docs-коммит backlog)
  // допустимо только здесь (VL-112). Гард явный, а не через env: иначе
  // «Продолжи» на close-сообщении увёл бы закрытие в worktree.
  if (
    meta?.taskId &&
    taskIdPattern(cwd).test(meta.taskId) &&
    meta.phase !== 'close' &&
    resolveBranchMode(cwd)
  ) {
    worktreeTaskId = meta.taskId.toUpperCase();
  } else if (meta?.cwd && meta.cwd !== cwd) {
    // Сессия создавалась в другом каталоге (worktree), а resume идёт вне
    // режима веток — предупреждаем модель: правки уйдут не в ту копию кода
    note =
      `\n\nВнимание (VL-110): сессия создавалась из каталога ${meta.cwd}, ` +
      `возобновление идёт из ${cwd} (branch-mode выключен). ` +
      'Прежде чем править файлы — проверь git status и git diff рабочего каталога.';
  }
  // VL-137: задачная сессия получает компактный блок состояния задачи
  // (заголовок/тип/статус/последний комментарий) — «Продолжи» не тратит
  // MCP-вызов на восстановление контекста. Задача не найдена → блок ''.
  const taskBlock = worktreeTaskId ? taskBlockText(cwd, worktreeTaskId) : '';
  // VL-145: resume привязывается к задаче, если мета её знает; иначе — к сессии.
  // Раньше ключ был глобальной строкой 'resume' — второй resume ЛЮБОЙ задачи
  // получал guard «Запуск уже выполняется», хотя это разные задачи (инцидент:
  // параллельное продолжение прерванных сессий у второй задачи из бота).
  const taskKey =
    meta?.taskId && taskIdPattern(cwd).test(meta.taskId) ? meta.taskId.toUpperCase() : '';
  const runKey = taskKey !== '' ? taskKey : `resume:${sessionId}`;
  // Фаза 'prompt' — шаблон не подставляется; промпт — сырой текст + примечание
  // VL-243: close-resume идёт в главном репо (noWorktree) — учёт при этом есть
  return spawnQwenRun(
    cwd,
    runKey,
    'prompt',
    promptText + (taskBlock ? `\n\n${taskBlock}` : '') + note,
    onExit,
    agent,
    ['--resume', sessionId],
    worktreeTaskId,
    meta?.phase === 'close'
  );
}

/**
 * Флаги лимитов фазы из settings.json (VL-104/122/274): --max-wall-time, --max-requests,
 * --idle-timeout и --no-compact (компакшн истории выключен через /set compact off),
 * если настройки заданы. Только для агента vb — qwen эти флаги не поддерживает.
 * Отсутствие/битый settings.json — пустой массив (норма: настройки не заданы,
 * флаги не передаются, поведение прежнее).
 */
function spawnLimitFlags(cwd: string): string[] {
  const flags: string[] = [];
  try {
    const s = loadBotSettings(cwd);
    if (s.max_wall_time !== undefined) flags.push('--max-wall-time', String(s.max_wall_time));
    if (s.max_requests !== undefined) flags.push('--max-requests', String(s.max_requests));
    // VL-306: порог loop detection (поле LoopLimits было мёртвым — не читалось)
    if (s.loop_detection_repeat !== undefined) {
      flags.push('--loop-detection-repeat', String(s.loop_detection_repeat));
    }
    // VL-274: idle-таймаут (0 — явное выключение watchdog: флаг передаём как есть)
    if (s.idle_timeout_seconds !== undefined) {
      flags.push('--idle-timeout', String(s.idle_timeout_seconds));
    }
    // VL-122: компакшн включён по умолчанию — --no-compact только при явном off
    if (s.compact === false) flags.push('--no-compact');
  } catch {
    // битый settings.json не должен ронять запуск фазы — флаги просто не добавляются
  }
  return flags;
}

/**
 * Спавнит процесс агента с готовым промптом и ведёт его жизненный цикл.
 *
 * Общий хелпер startPhase/startPrompt (VL-66): guard от двойного запуска,
 * лог, probe тишины, парсер JSON-результата, onExit. runKey — ID задачи
 * (канонизируется в UPPER, VL-145), 'prompt' либо 'resume:<sessionId>'
 * (ключи общих activeRuns/lastRuns).
 *
 * @param agent — VL-92: qwen (дефолт) либо встроенный vibelog-agent
 * @param extraArgs — VL-93: доп. флаги сразу после промпта (--resume <id>)
 * @param worktreeTaskId — VL-110: ID задачи для worktree при resume (мета
 *   сессии); runKey задач ('VL-N') определяет worktree сам по себе.
 *   VL-114: задачным фазам в spawnEnv кладутся
 *   VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME — по ним CLI пишет мету
 *   сессии при спавне готовым промптом (isPhaseMode=false).
 *   VL-243: close тоже получает env (учёт меты/billing); из worktree он
 *   по-прежнему исключён (VL-112, через branchTask и гард startResume)
 * @param noWorktree — VL-243: запрет worktree независимо от ключа задачи.
 *   Нужен close-resume: ключ рана задачный (guard по задаче, VL-145), но
 *   закрытие обязано идти в главном репо (VL-112) — иначе «Продолжи» на
 *   close-сообщении уводит merge ветки в worktree. Учёт (env) при этом
 *   остаётся: taskId рану известен.
 */
function spawnQwenRun(
  cwd: string,
  runKey: string,
  phase: Phase,
  prompt: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = 'qwen',
  extraArgs: string[] = [],
  worktreeTaskId?: string,
  noWorktree = false
): StartResult {
  // VL-145: канонический ключ — задачные ключи в верхнем регистре,
  // чтобы resume (ключ из верхнего регистра меты) и фаза (raw task.id,
  // например 'ot-5' при meta 'OT-5') совпадали в guard'е; prompt и
  // resume:<sessionId> регистр не меняют.
  const key = taskIdPattern(cwd).test(runKey) ? runKey.toUpperCase() : runKey;
  // VL-276: перед отказом снимаем залипший лок — запись, чей процесс уже вышел
  // (exit пришёл, close нет: stdio держит потомок). Иначе задача навсегда
  // получает «Запуск уже выполняется» при том, что фаза давно доработала.
  if (activeRuns.has(key)) reapStaleRun(key);
  if (activeRuns.has(key)) {
    // VL-145: подсказка, какая задача занята (строка «Запуск уже выполняется»
    // сохранена как есть — существующие тесты матчат её подстрокой)
    const hint = taskIdPattern(cwd).test(key) ? ` (${key})` : '';
    return { error: 'Запуск уже выполняется' + hint };
  }

  // VL-107: режим параллельной разработки — фаза задачи спавнится в git
  // worktree ветки vb/vl-N. Ключи задач всегда вида 'VL-N' (в canonical-регистре);
  // prompt/resume без меты задачи (не привязаны к задаче) остаются в главном
  // cwd — регрессий нет. Resume с метой задачи (VL-145) имеет задачный ключ
  // и живёт по общим с фазами правилам worktree.
  // ensure до спавна: ошибка (не git-репо, конфликт ветки) → фаза не
  // стартует, сообщение уходит в чат/api как { error }.
  let runCwd = cwd;
  let spawnEnv: NodeJS.ProcessEnv | undefined;
  // Тестовый шов VL-140: база env спавна — process.env либо явный объект
  // из setSpawnEnvBaseForTests (тесты больше не полагаются на глобал).
  const baseEnv = (): NodeJS.ProcessEnv => spawnEnvBaseOverride ?? process.env;
  // VL-110: источник taskId для worktree — задачный ключ (канонический, VL-145)
  // либо мета resume-сессии.
  // VL-112: close исключён из WORKTREE — закрытие идёт в главном репо: merge
  // ветки и docs(task)-коммит backlog возможны только здесь
  // (см. phase-close-worktree.md). Исключение — только про worktree.
  // VL-118: «задачная» проверка — по task_prefix конфига проекта
  const branchTask =
    !noWorktree && taskIdPattern(cwd).test(key) && phase !== 'close' ? key : (noWorktree ? '' : (worktreeTaskId ?? ''));
  // VL-114/243: задачный env нужен фазам задач независимо от worktree: CLI
  // пишет по нему мету сессии даже когда промпт пришёл готовым (isPhaseMode=false).
  // VL-243: close больше НЕ исключён из env — раньше исключение close жило в
  // этом же выражении, и учёт close (мета + billing) терялся целиком на обоих
  // путях (vb: CLI-пост-ран, qwen: finish оркестратора). Worktree-исключение
  // close обеспечивает branchTask выше и гард в startResume.
  // У resume taskId берётся из worktreeTaskId (мета VL-110) — без меты resume
  // остаётся на прежнем пути без env.
  const phaseTaskId =
    taskIdPattern(cwd).test(key) ? key.toUpperCase() : (worktreeTaskId ?? '');
  // VL-259: момент старта рана — фактическое начало ЭТОГО запуска. Уходит в
  // env (CLI/post-run пишут его в billing/мету) и используется finish()'ом
  // для проверки маркера billing_recorded (маркер >= старта = запись этого рана).
  const runStartedAt = new Date().toISOString();
  // VL-259: фаза РАНА для учёта (billing.phase, by_phase). У resume-рана
  // (startResume) phase='prompt' — служебная фаза, которая не должна попадать
  // в by_phase: фактическая фаза рана берётся из меты сессии (продолжение
  // план-сессии — это работа plan-фазы). Мету не прочитать — undefined,
  // ниже срабатывает фолбэк на фазу сессии (прежнее поведение).
  const runPhase = (() => {
    if (phase !== 'prompt') return phase;
    const idx = extraArgs.indexOf('--resume');
    const sid = idx >= 0 ? extraArgs[idx + 1]?.replace(/^vb:/, '') : undefined;
    if (!sid) return undefined;
    try {
      return loadSessionMetaSync(agentSessionsDir(cwd), sid)?.phase;
    } catch {
      return undefined; // битая мета — фаза рана неизвестна, деградируем молча
    }
  })();
  if (phaseTaskId !== '') {
    spawnEnv = {
      ...baseEnv(),
      VIBELOG_PHASE_TASK_ID: phaseTaskId,
      VIBELOG_PHASE_NAME: phase,
      // VL-259: учёт фазы/времени РАНА наследуется и MCP-сервером агента
      // (VIBELOG_RUN_PHASE → by_phase в finish_phase, VIBELOG_RUN_STARTED_AT
      // → billing.startedAt в CLI пост-ране)
      ...(runPhase ? { VIBELOG_RUN_PHASE: runPhase } : {}),
      VIBELOG_RUN_STARTED_AT: runStartedAt,
    };
  }
  if (resolveBranchMode(cwd) && branchTask !== '') {
    // VL-107/VL-134/VL-188/VL-278: нужно ли worktree — решает ОДИН общий
    // хелпер core/worktree (тот же, что использует путь создания задачи):
    // готовый worktree используется всегда, впервые создаётся на фазе plan
    // (или do — VL-188: в simple workflow фазы plan нет), для epic — никогда.
    // Дубль условия здесь запрещён — иначе пути «фаза» и «чат» разъедутся.
    // Вход в блок: готовый worktree либо первое создание (plan/do, не epic).
    // Иначе блок пропускается целиком: runCwd = главный cwd, VIBELOG_CWD не
    // задаётся, «Режим параллельной разработки» не добавляется в промпт.
    if (shouldEnsureWorktree(cwd, branchTask, { kind: 'phase', phase })) {
      let runDir: string;
      try {
        runDir = ensureTaskWorktree(cwd, branchTask);
      } catch (err) {
        return { error: (err as Error).message };
      }
      runCwd = runDir;
      // MCP-сервер агента наследует cwd worktree, но backlog пишет в главный
      // репозиторий через VIBELOG_CWD (см. cli/commands/mcp.ts)
      spawnEnv = { ...(spawnEnv ?? baseEnv()), VIBELOG_CWD: cwd };
      prompt +=
        `\n\nРежим параллельной разработки: работаешь в git worktree ветки ${taskBranchName(branchTask)}` +
        ` (директория ${runDir}). Backlog живёт в основном репозитории — MCP уже настроен на него.` +
        ' Код коммить в текущую ветку; файлы backlog/ не коммить.';
    }
  }

  // VL-92: выбор бинаря по агенту. qwen — прежний путь без регрессий;
  // vb — встроенный vibelog-agent: VIBELOG_AGENT_BIN либо bin/vibelog-agent.mjs
  // относительно dist/web/ (import.meta.url). Флаги спавна не меняются —
  // агент qwen-совместим по CLI (VL-85). LLM env (VIBELOG_LLM_*) наследуются
  // из process.env: бот И браузер загружают .env/settings-env через общий
  // loadProjectEnv при старте (VL-37, фикс browser-режима VL-189), доп.
  // настройка не нужна; при отсутствии ключа агент сам печатает is_error JSON.
  const bin =
    agent === 'vb'
      ? baseEnv().VIBELOG_AGENT_BIN ||
        fileURLToPath(new URL('../../bin/vibelog-agent.mjs', import.meta.url))
      : baseEnv().VIBELOG_QWEN_BIN || 'qwen';
  // Промпт — позиционный аргумент: флаг -p/--prompt у qwen deprecated
  // («Use the positional prompt instead»).
  // Диагностика VL-58 (таймлайн, probe тишины) остаётся.
  // Корневая причина задержки устранена настройками памяти qwen (VL-58);
  // stream-json и VIBELOG_QWEN_EXTRA_ARGS откачены. Дебаг: vibelog qwen-debug.
  // --output-format json — для ВСЕХ фаз; --allowed-mcp-server-names vibelog —
  // только для не-кодовых фаз (spec/plan/analyze/reject/investigate/materialize,
  // VL-195): чужие серверы (chrome-devtools и др.) для планирования,
  // расследования и материализации не нужны; backlog-MCP нужен для
  // рекомендаций/документов (VL-141; у vb флаг игнорируется — безвреден).
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
    phase === 'spec' ||
    phase === 'plan' ||
    phase === 'analyze' ||
    phase === 'reject' ||
    phase === 'investigate' ||
    phase === 'materialize'
      ? ['--allowed-mcp-server-names', 'vibelog']
      : [];
  // VL-93: extraArgs сразу после позиционного промпта (--resume <sessionId>);
  // порядок флагов для qwen не значим, промпт обязан быть первым
  // VL-104: лимиты фаз из settings.json — только для vb; qwen флаги не поддерживает
  const limitFlags = agent === 'vb' ? spawnLimitFlags(cwd) : [];
  const child = spawn(bin, [prompt, ...extraArgs, ...limitFlags, '--approval-mode', 'yolo', '--output-format', 'json', ...phaseFlags], {
    // VL-107: runCwd — worktree ветки при branch_mode, иначе главный cwd;
    // spawnEnv: задачный env меты сессии (VL-114) и/или VIBELOG_CWD (branch-mode)
    cwd: runCwd,
    stdio: 'pipe',
    // VL-140: spawn ВСЕГДА получает явный env-объект (база baseEnv()), чтобы
    // спавн не зависел от process.env в момент fork — условный spread убран.
    env: spawnEnv ?? baseEnv(),
  });

  // VL-276: запись актива создаём до finish() (сам finish объявлен ниже) —
  // ссылка на объект нужна, чтобы позже положить в неё finalize (reap из
  // внешнего гарда обязан завершать ран через штатный finish, а не удалять
  // запись напрямую: иначе теряются logTail/учёт/уведомление onExit).
  const activeEntry: ActiveRun = { phase, child, onExit, agent };
  activeRuns.set(key, activeEntry);
  // VL-243/259: runStartedAt посчитан ДО спавна (он уходит в env рана) —
  // по нему finish() решает, оставил ли CLI пост-ран свою billing-запись
  // (маркер billing_recorded.finishedAt >= старта).
  lastRuns.delete(key);
  // VL-196: транзиентный In Progress — задачные workflow-фазы после успешного
  // спавна (гарды до этого места уже прошли — при ошибке запуска статус не
  // меняется, откат ретраям не нужен); служебные фазы внутри — выход без действий
  markPhaseStarted(cwd, key, phase, child.pid);

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
          console.log(`[phase ${key}] ${ts()} err| ${line.trim().slice(0, 120)}`);
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
        console.log(`[phase ${key}] ${ts()} | ${line.trim().slice(0, 120)}`);
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
        `[phase ${key}] ${ts()} probe(тишина ${quietSec}с):\n` + (lines.join('\n') || '    (процесс уже завершился)')
      );
    });
  }, 60_000);
  // Завершение запуска. Node НЕ гарантирует close после error (ENOENT при
  // отсутствии бинаря) — cleanup выполняется из обоих событий, один раз.
  let finished = false;
  const finish = (code: number | null = null) => {
    if (finished) return;
    finished = true;
    clearInterval(probe);
    activeRuns.delete(key);
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
    // VL-147: оркестратор дописывает мету сессии для ВСЕХ агентов по
    // result.session_id — у qwen CLI меты не пишет (пишет только наш CLI
    // vibelog-agent), иначе plan-сессии qwen недоступны findTaskPhaseSessionSync.
    // У vb мета уже записана CLI при старте — перезапись идемпотентна
    // (та же taskId/phase; cwd приводится к realpath, как process.cwd() child'а
    // — иначе symlink /var→/private/var в macOS tmpdir менял бы мету, регрессия
    // E2E VL-114).
    // VL-187: resume-ран (--resume в extraArgs: reply-«Продолжить» из бота идёт
    // с phase='prompt') НЕ перезаписывает СУЩЕСТВУЮЩУЮ мету сессии — иначе
    // фаза плана/кода затирается на 'prompt' и findTaskPhaseSessionSync больше
    // не находит план-сессию (инцидент VL-185: plan-сессия продолжена reply'ом
    // → мета стала 'prompt' → code запустился в новой сессии при включённом
    // code_same_session). Мета resume-сессии уже записана при её создании
    // (CLI) либо прежним раном; без меты — пишем как раньше (восстановление).
    // Fire-and-forget: ошибка записи не роняет фазу.
    if (result?.session_id && phaseTaskId !== '') {
      let metaCwd = cwd;
      try {
        metaCwd = realpathSync(cwd);
      } catch {
        // каталог исчез между спавном и завершением — оставляем исходный путь
      }
      const isResumeRun = extraArgs.includes('--resume');
      const existing = isResumeRun
        ? loadSessionMetaSync(agentSessionsDir(cwd), result.session_id)
        : null;
      // metaWrite — промис записи базовой меты: блок учёта токенов ниже
      // ждёт его, иначе две перезаписи одного файла гоняются (учёт затёрт
      // бы saveSessionMeta либо наоборот)
      let metaWrite: Promise<unknown> = Promise.resolve();
      if (existing?.taskId && existing?.phase) {
        // Resume-ран с записанной метой: исходная фаза/задача сохраняются как
        // есть (cwd тоже не трогаем — сессия создавалась в нём же)
        console.log(
          `[phase ${key}] ${ts()} мета сессии ${result.session_id} сохранена без перезаписи (resume-ран, фаза '${existing.phase}')`
        );
      } else {
        metaWrite = saveSessionMeta(agentSessionsDir(cwd), result.session_id, {
          taskId: phaseTaskId,
          phase,
          cwd: metaCwd,
        }).catch((err) => {
          console.log(`[phase ${key}] ${ts()} мета сессии не записана: ${(err as Error).message}`);
        });
      }
      // ── Учёт токенов (VL-198): для qwen-ранов это ОСНОВНОЙ путь ────────
      // У qwen нет нашего jsonl с usage → finish_phase не резолвит usage →
      // frontmatter/billing/meta пишем здесь из result (parseQwenResult).
      // Для vb всё уже записал cli post-run: блок идемпотентен (дельта от
      // usage_recorded ≈ 0), но подстраховывает vb-раны, где cli упал.
      // Все шаги fail-safe: учёт не должен ломать завершение фазы.
      if (result && agent === 'qwen') {
        metaWrite
          .then(() => {
            const sessionsDir = agentSessionsDir(cwd);
            const metaNow = loadSessionMetaSync(sessionsDir, result.session_id);
            const runUsage: TokenUsage = {
              input: result.usage.input_tokens,
              output: result.usage.output_tokens,
              cache: result.usage.cache_read_input_tokens,
              total: result.usage.total_tokens,
              requests: result.num_turns,
              ...(result.usage.reasoning_tokens ? { reasoning: result.usage.reasoning_tokens } : {}),
            };
            // Кумулятив сессии = прошлые раны (мета) + этот ран (result)
            const usage: TokenUsage = { ...runUsage };
            if (metaNow?.usage) {
              usage.input += metaNow.usage.input;
              usage.output += metaNow.usage.output;
              usage.cache += metaNow.usage.cache;
              usage.total += metaNow.usage.total;
              usage.requests += metaNow.usage.requests;
              if (metaNow.usage.reasoning || runUsage.reasoning) {
                usage.reasoning = (metaNow.usage.reasoning ?? 0) + (runUsage.reasoning ?? 0);
              }
            }
            // VL-259: фаза для by_phase — фаза РАНА (runPhase: у resume-рана
            // фазой служебного 'prompt' не подменяем); usagePhase остаётся
            // фазой СЕССИИ для аддитивного sessionPhase записи billing.
            const usagePhase = metaNow?.phase ?? phase;
            const byPhaseKey = runPhase ?? phase;
            const delta = usageDelta(metaNow?.usage_recorded ?? {}, usage);
            if (hasUsageDelta(delta)) {
              addTaskTokenUsage(cwd, phaseTaskId, byPhaseKey, delta, result.duration_ms);
            }
            const finishedAt = new Date().toISOString();
            // VL-243: в billing — фаза ЭТОГО рана (resume-ран code в plan-сессии
            // раньше маркировался 'plan' и code-запись «терялась»), фаза сессии —
            // в sessionPhase. VL-259: startedAt — фактическое начало рана.
            appendBilling(cwd, phaseTaskId, {
              sessionId: result.session_id,
              phase: byPhaseKey,
              ...(usagePhase && usagePhase !== byPhaseKey ? { sessionPhase: usagePhase } : {}),
              startedAt: runStartedAt,
              startedAtKind: 'run',
              finishedAt,
              durationMs: result.duration_ms,
              usage: runUsage,
              agent: 'qwen',
            });
            updateSessionMeta(sessionsDir, result.session_id, {
              cwd: metaCwd,
              finishedAt: new Date().toISOString(),
              durationMs: result.duration_ms,
              usage,
              usage_recorded: usage,
              agent: 'qwen',
              // VL-243: маркер записи в billing (паритет с CLI-путём)
              billing_recorded: { sessionId: result.session_id, finishedAt },
              // VL-253: исход рана — finish_phase не доверяет явному tokenUsage
              // после упавшей фазы (паритет с CLI-путём)
              last_run: { is_error: result.is_error === true, finishedAt: new Date().toISOString() },
            });
            // VL-259: история ранов в мете — по ней разбор восстанавливает
            // «сколько ранов, в какой фазе, когда начался» (раньше была видна
            // только фаза создания сессии — источник неточности VL-254)
            appendSessionRun(sessionsDir, result.session_id, {
              sessionId: result.session_id,
              phase: byPhaseKey,
              ...(usagePhase && usagePhase !== byPhaseKey ? { sessionPhase: usagePhase } : {}),
              startedAt: runStartedAt,
              finishedAt,
              durationMs: result.duration_ms,
              usage,
              agent: 'qwen',
              billing: 'run',
            });
            // VL-277: файл задачи коммитится ПОСЛЕ записи usage (в т.ч. после
            // маркера billing_recorded выше) — иначе token_usage оставался
            // единственной незакоммиченной правкой после close. В branch-mode
            // cwd — главный репо (файлы задач живут там, VL-112: close идёт
            // без worktree). Гейт по фазе + внутренний try/catch хелпера:
            // git не может отменить уже записанный учёт (риск R4).
            if (isTaskCommitPhase(byPhaseKey)) {
              commitTaskFile(cwd, phaseTaskId, byPhaseKey);
            }
          })
          .catch((err) => {
            console.log(`[phase ${key}] ${ts()} учёт токенов не записан: ${(err as Error).message}`);
          });
      }
      // VL-243: vb-раны — fallback-учёт. Штатно всё пишет CLI-пост-ран, но
      // при жёстком kill/падении до учёта запись терялась целиком (инвариант
      // «каждый ран → запись billing»). Проверяем маркер billing_recorded в
      // мете: если за этот ран его нет — дописываем сами с fallback: true
      // (двойного учёта нет: маркер ставят оба писателя, lesson-58-паттерн).
      if (result && agent === 'vb') {
        metaWrite
          .then(() => {
            const sessionsDir = agentSessionsDir(cwd);
            const metaNow = loadSessionMetaSync(sessionsDir, result.session_id);
            const recorded = metaNow?.billing_recorded;
            const alreadyRecorded =
              recorded?.sessionId === result.session_id &&
              typeof recorded.finishedAt === 'string' &&
              recorded.finishedAt >= runStartedAt;
            if (alreadyRecorded) return;
            const runUsage: TokenUsage = {
              input: result.usage.input_tokens,
              output: result.usage.output_tokens,
              cache: result.usage.cache_read_input_tokens,
              total: result.usage.total_tokens,
              requests: result.num_turns,
              ...(result.usage.reasoning_tokens ? { reasoning: result.usage.reasoning_tokens } : {}),
            };
            const finishedAt = new Date().toISOString();
            // VL-259: фаза рана (не служебный 'prompt' resume'а), startedAt —
            // фактическое начало рана (прежнее значение = время создания сессии)
            const vbRunPhase = runPhase ?? phase;
            appendBilling(cwd, phaseTaskId, {
              sessionId: result.session_id,
              phase: vbRunPhase,
              ...(metaNow?.phase && metaNow.phase !== vbRunPhase ? { sessionPhase: metaNow.phase } : {}),
              startedAt: runStartedAt,
              startedAtKind: 'run',
              finishedAt,
              durationMs: result.duration_ms,
              usage: runUsage,
              agent: 'vb',
              fallback: true,
            });
            updateSessionMeta(sessionsDir, result.session_id, {
              cwd: metaCwd,
              billing_recorded: { sessionId: result.session_id, finishedAt },
            });
            // VL-259: fallback-ран тоже попадает в историю ранов меты —
            // иначе в runs[] были бы «дыры» и разбор не восстановил бы число ранов
            appendSessionRun(sessionsDir, result.session_id, {
              sessionId: result.session_id,
              phase: vbRunPhase,
              ...(metaNow?.phase && metaNow.phase !== vbRunPhase ? { sessionPhase: metaNow.phase } : {}),
              startedAt: runStartedAt,
              finishedAt,
              durationMs: result.duration_ms,
              usage: runUsage,
              agent: 'vb',
              billing: 'fallback',
            });
            console.log(
              `[phase ${key}] ${ts()} billing дописан оркестратором (fallback: CLI-пост-ран не записал)`
            );
          })
          .catch((err) => {
            console.log(`[phase ${key}] ${ts()} fallback-учёт не записан: ${(err as Error).message}`);
          });
      }
    }
    if (!result) {
      const outLines = log.split('\n').filter((l) => l.trim());
      const diag =
        `stdout: ${log.length} б, строк: ${outLines.length}; stderr: ${stderrLog.length} б; ` +
        explainQwenParse(log);
      console.log(`[phase ${key}] ${ts()} parseQwenResult: ${diag}`);
      if (outLines.length > 0) {
        console.log(`[phase ${key}] ${ts()} stdout-хвост: …${log.slice(-400)}`);
      }
      if (stderrLog.trim()) {
        console.log(`[phase ${key}] ${ts()} stderr-хвост: …${stderrLog.slice(-300)}`);
      }
      // Дебаг-дамп полного stdout на диск (запрос Pavel, VL-63 reopen):
      // --json-file у qwen в headless не работает (флаг игнорируется), поэтому
      // сырой JSON сохраняем сами — в .vibelog/qwen-debug/ (gitignored),
      // чтобы видеть точный формат вывода без перезапуска фазы.
      if (log.trim()) {
        try {
          const dumpDir = join(cwd, '.vibelog', 'qwen-debug');
          mkdirSync(dumpDir, { recursive: true });
          const dumpPath = join(dumpDir, `${key}-${Date.now()}.log`);
          writeFileSync(dumpPath, log, 'utf-8');
          console.log(`[phase ${key}] ${ts()} дамп stdout: ${dumpPath}`);
        } catch (err) {
          console.log(`[phase ${key}] ${ts()} дамп stdout не удался: ${(err as Error).message}`);
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
    // VL-289: снимаем транзиент ДО финализации — она удаляет запись кэша, и
    // после неё признак aborted доступен только разбором текста комментария.
    // Сигнал живёт отдельным полем: exitCode остаётся прежним (на него смотрят
    // автоочередь и боты), а супервизор получает «агент попросил человека».
    const transient = readPhaseTransient(cwd, key);
    if (transient?.aborted === true) {
      record.aborted = true;
      if (transient.abortedReason !== undefined) record.abortedReason = transient.abortedReason;
    }
    lastRuns.set(key, record);
    // VL-178: авто-resume при отказе провайдера «high risk» — страховка вместо
    // ручного «Продолжить» (основной повтор — в LLM-клиенте, здесь ловим случай,
    // когда исчерпаны shrink-уровни и фаза всё же упала). Счётчик 1 на runKey —
    // цикл исключён; текущий (упавший) вызов onExit пропускается — уведомление
    // уйдёт по финальному record нового запуска (тот же onExit).
    const highRiskText = `${result?.result ?? ''} ${record.logTail}`;
    const isHighRisk =
      record.result?.is_error === true &&
      /high\s*risk|rejected\s+because\s+it\s+was\s+considered/i.test(highRiskText);
    if (isHighRisk && result?.session_id) {
      const retries = highRiskAutoRetries.get(key) ?? 0;
      if (retries < 1) {
        highRiskAutoRetries.set(key, retries + 1);
        console.log(`[phase ${key}] ${ts()} авто-resume после high-risk (VL-178), session ${result.session_id}`);
        // Дубль --resume не добавляем (lesson-18: флаг не должен прийти дважды)
        const resumeArgs = extraArgs.includes('--resume')
          ? extraArgs
          : [...extraArgs, '--resume', result.session_id];
        spawnQwenRun(
          cwd,
          key,
          phase,
          'Продолжи с текущего места — автоматический повтор после отказа провайдера (VL-178).',
          onExit,
          agent,
          resumeArgs,
          worktreeTaskId
        );
        return; // текущий record в lastRuns остался; onExit уйдёт по финальному
      }
    }
    // VL-196: финализация транзиентного In Progress ДО onExit — авто-очередь
    // (progressed по статусу) и rejectTask-onExit видят уже финальный статус;
    // high-risk авто-resume выше делает return — на время повтора транзиент жив
    // VL-289: исход финализации дописываем в уже опубликованную запись
    // (lastRuns хранит её по ссылке) — getRun отдаёт phaseResult рядом с
    // running/phase/exitCode. aborted/abortedReason сняты до финализации.
    const outcome = finalizePhaseStatus(cwd, key, phase, record);
    if (outcome !== null) record.phaseResult = outcome.outcome;
    // VL-48: уведомление о завершении (бот). Fire-and-forget в try/catch:
    // сетевые ошибки Telegram не должны ронять polling оркестратора.
    try {
      onExit?.(record);
    } catch (err) {
      console.error('onExit-колбэк фазы упал:', err);
    }
  };

  // VL-276: публикуем finalize для reap'а — внешний гард сможет корректно
  // завершить залипший ран (см. ActiveRun.finalize) вместо простого удаления.
  activeEntry.finalize = finish;
  // VL-276: таймер завершения по exit, если close не придёт (потомок держит stdio)
  let closeGraceTimer: NodeJS.Timeout | null = null;

  child.on('exit', (code, signal) => {
    console.log(`[phase ${key}] ${ts()} exit: code=${code} signal=${signal}`);
    // VL-276: факт выхода фиксируем в записи — по нему reap отличает мёртвый
    // ран от живого, даже когда close не пришёл вовсе
    activeEntry.exitCode = code;
    activeEntry.signalCode = signal;
    const grace = runCloseGraceMs();
    if (finished || closeGraceTimer !== null) return;
    closeGraceTimer = setTimeout(() => {
      closeGraceTimer = null;
      if (finished) return;
      console.log(
        `[phase ${key}] ${ts()} close не пришёл за ${grace} мс — завершаю ран по exit (потомок держит stdio)`
      );
      finish(code);
    }, grace);
    closeGraceTimer.unref?.();
  });
  child.on('error', (err) => {
    log += `${log ? '\n' : ''}Ошибка запуска: ${err.message}`;
    console.log(`[phase ${key}] ${ts()} error: ${err.message}`);
    if (closeGraceTimer !== null) {
      clearTimeout(closeGraceTimer);
      closeGraceTimer = null;
    }
    finish(null);
  });
  child.on('close', (code) => {
    console.log(`[phase ${key}] ${ts()} close: code=${code}`);
    if (closeGraceTimer !== null) {
      clearTimeout(closeGraceTimer);
      closeGraceTimer = null;
    }
    finish(code);
  });

  return { started: true, pid: child.pid ?? -1 };
}

/**
 * Регистронезависимый lookup для карт запусков (VL-145): задачные ключи
 * хранятся канонически (UPPER), а вызов getRun/taskId из API и бота может
 * прийти в любом регистре (task.id пишется в нижнем). Прямое совпадение —
 * затем линейный поиск по toUpperCase: карты содержат единицы записей.
 */
function lookupCI<V>(map: Map<string, V>, k: string): V | undefined {
  const direct = map.get(k);
  if (direct !== undefined) return direct;
  const up = k.toUpperCase();
  for (const [mk, mv] of map) if (mk.toUpperCase() === up) return mv;
  return undefined;
}

/**
 * VL-276: снимает лок одного рана, если процесс уже мёртв.
 *
 * Признак смерти: пришло событие `exit` (exitCode/signalCode установлены —
 * `close` мог не прийти, если stdout-пайп держит потомок) либо pid не отвечает
 * на `process.kill(pid, 0)`. Завершение идёт через `finalize` (штатный
 * `finish`): состояние рана (logTail, lastRuns, транзиентный In Progress,
 * onExit-уведомление) сохраняется — иначе бот/автоочередь не узнали бы об
 * окончании фазы. `finalize` отсутствует только в окне между `spawn` и
 * объявлением `finish` — там запись снимаем минимально.
 *
 * @returns true ⇔ запись удалена (лок снят)
 */
function reapStaleRun(key: string): boolean {
  const entry = lookupCI(activeRuns, key);
  if (!entry) return false;
  const exited = entry.exitCode !== undefined || entry.signalCode !== undefined;
  // Живой процесс не трогаем: снимаем только заведомо мёртвые записи.
  // `pid === undefined` — процесс ещё не получил pid (ошибка спавна ENOENT
  // приходит событием `error`, а не мёртвым pid) — такой ран НЕ наш случай.
  const pid = entry.child.pid;
  const pidDead = typeof pid === 'number' && pid > 0 && !isPidAlive(pid);
  if (!exited && !pidDead) return false;
  console.log(
    `[phase ${key}] VL-276: лок снят — процесс не найден (exit code ${entry.exitCode ?? '—'}` +
      `${entry.signalCode ? `, signal ${entry.signalCode}` : ''}); close так и не пришёл`
  );
  if (entry.finalize) {
    entry.finalize(entry.exitCode ?? null);
    return true;
  }
  // Фолбэк: успеть до объявления finish — запись убираем сами (ран без данных)
  activeRuns.delete(key);
  lastRuns.set(key, {
    running: false,
    phase: entry.phase,
    agent: entry.agent,
    exitCode: entry.exitCode ?? null,
    finishedAt: new Date().toISOString(),
  });
  return true;
}

/**
 * VL-276: снимает все залипшие локи (см. reapStaleRun).
 *
 * @returns число снятых записей (диагностика/тесты)
 */
export function reapStaleRuns(): number {
  let reaped = 0;
  for (const key of [...activeRuns.keys()]) {
    if (reapStaleRun(key)) reaped += 1;
  }
  return reaped;
}

/**
 * VL-276: есть ли живой close-ран (флаг closeActive обязан ему соответствовать).
 *
 * Нужен сбросу залипшего closeActive в startPhase: если все close-записи
 * оказались мёртвыми, флаг фиктивен и очередь close никогда не разгребётся.
 */
function hasLiveCloseRun(): boolean {
  for (const entry of activeRuns.values()) {
    if (entry.phase !== 'close') continue;
    const exited = entry.exitCode !== undefined || entry.signalCode !== undefined;
    if (!exited && isPidAlive(entry.child.pid)) return true;
  }
  return false;
}

/**
 * Сколько фаз запущено прямо сейчас (VL-268).
 *
 * Нужно лимиту `max_parallel_phases` супервизора: перед запуском новой фазы
 * проверяется, что одновременно работающих фаз меньше лимита. Ограничение
 * честно документировано: `activeRuns` живёт в памяти процесса, после рестарта
 * счётчик обнуляется (полноценный планировщик — VL-269).
 *
 * VL-276: залипшие записи (процесс вышел, close не пришёл) снимаются перед
 * подсчётом — мёртвый ран не должен занимать слот и блокировать запуск.
 */
export function countActiveRuns(): number {
  reapStaleRuns();
  return activeRuns.size;
}

/**
 * Состояние запуска фазы задачи.
 *
 * @param taskId — ID задачи (регистр любым: ключи канонизируются, VL-145)
 * @returns текущий или последний запуск, либо null если запусков не было
 */
export function getRun(taskId: string): PhaseRun | null {
  // VL-276: мёртвый ран не должен выглядеть как running:true — сначала reap,
  // затем обычный lookup (finalize положит завершившийся ран в lastRuns)
  reapStaleRuns();
  const active = lookupCI(activeRuns, taskId);
  if (active) {
    return { running: true, phase: active.phase, pid: active.child.pid, agent: active.agent };
  }
  // VL-146: задача ждёт в очереди close (branch-mode) — отдельное состояние
  const up = taskId.toUpperCase();
  if (closeQueue.some((e) => e.taskId.toUpperCase() === up)) {
    return { running: false, queued: true, phase: 'close' };
  }
  return lookupCI(lastRuns, taskId) ?? null;
}
