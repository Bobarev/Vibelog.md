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
import { renderPrompt, taskBlockText, taskExtraVars } from './phase-prompt.js';
import type { Phase } from './phase-prompt.js';
import { getTask } from '../core/store.js';
import { ensureTaskWorktree, taskBranchName, taskWorktreeDir } from '../core/worktree.js';
import { explainQwenParse, parseQwenResult } from './qwen-result.js';
import type { QwenResult } from './qwen-result.js';
import { loadBotSettings, resolveBranchMode, resolveCodeSameSession } from '../bot/settings.js';
import { taskIdPattern } from '../core/config.js';
import { agentSessionsDir, findTaskPhaseSessionSync, loadSessionMetaSync, saveSessionMeta } from '../agent/session.js';

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
 *   undefined — брать настройку из settings.json
 */
export function startPhase(
  cwd: string,
  taskId: string,
  phase: string,
  onExit?: PhaseExitCallback,
  extraVars?: Record<string, string>,
  agent: 'qwen' | 'vb' = 'qwen',
  opts?: { sameSession?: boolean }
): StartResult {
  // Защита HTTP-границы (VL-66): api.ts пропускает произвольный phase из
  // POST-body — без guard'а qwen получил бы шаблон prompt.md с неподставленным
  // {{prompt}}. Фаза prompt не привязана к задаче и живёт в startPrompt.
  if (phase === 'prompt') {
    return { error: 'Фаза prompt запускается через startPrompt' };
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
  let prompt: string;
  try {
    prompt = renderPrompt(
      phase,
      taskId,
      {
        // VL-137: подстановки полей задачи — после {{comment}} (контракт VL-80
        // не трогаем: подстановки только новыми переменными, порядок merge сохранён)
        ...extraVars,
        ...taskVars,
        // VL-112: {{branch}}/{{worktreeDir}} — подстановки для close-worktree шаблона
        branch: taskBranchName(taskId),
        worktreeDir: `.vibelog/worktrees/${taskId.toLowerCase()}`,
      },
      // VL-112: close задачи с worktree — отдельный шаблон с merge-шагом
      { closeWorktree: phase === 'close' && existsSync(taskWorktreeDir(cwd, taskId)) }
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
  let extraArgs: string[] = [];
  const sameSession = opts?.sameSession ?? resolveCodeSameSession(cwd);
  if (phase === 'code' && sameSession) {
    const planSessionId = findTaskPhaseSessionSync(agentSessionsDir(cwd), taskId, 'plan');
    if (planSessionId) {
      extraArgs = ['--resume', planSessionId];
      prompt +=
        '\n\nСессия продолжает фазу plan (VL-147), контекст планирования уже в истории.';
    } else {
      // Fallback: план-сессия не найдена (задача планировалась до VL-147,
      // меты нет / сессия удалена) — обычный новый запуск, регрессий нет
      console.log(
        `[phase ${taskId}] VL-147: план-сессия не найдена — code запускается в новой сессии`
      );
    }
  }
  return spawnQwenRun(cwd, taskId, phase as Phase, prompt, onExit, agent, extraArgs);
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
  agent: 'qwen' | 'vb' = 'qwen'
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
  if (meta?.taskId && taskIdPattern(cwd).test(meta.taskId) && resolveBranchMode(cwd)) {
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
  return spawnQwenRun(
    cwd,
    runKey,
    'prompt',
    promptText + (taskBlock ? `\n\n${taskBlock}` : '') + note,
    onExit,
    agent,
    ['--resume', sessionId],
    worktreeTaskId
  );
}

/**
 * Флаги лимитов фазы из settings.json (VL-104/122): --max-wall-time, --max-requests
 * и --no-compact (компакшн истории выключен через /set compact off), если
 * настройки заданы. Только для агента vb — qwen эти флаги не поддерживает.
 * Отсутствие/битый settings.json — пустой массив (норма: настройки не заданы,
 * флаги не передаются, поведение прежнее).
 */
function spawnLimitFlags(cwd: string): string[] {
  const flags: string[] = [];
  try {
    const s = loadBotSettings(cwd);
    if (s.max_wall_time !== undefined) flags.push('--max-wall-time', String(s.max_wall_time));
    if (s.max_requests !== undefined) flags.push('--max-requests', String(s.max_requests));
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
 *   VL-114: задачным фазам (кроме close) в spawnEnv кладутся
 *   VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME — по ним CLI пишет мету
 *   сессии при спавне готовым промптом (isPhaseMode=false)
 */
function spawnQwenRun(
  cwd: string,
  runKey: string,
  phase: Phase,
  prompt: string,
  onExit?: PhaseExitCallback,
  agent: 'qwen' | 'vb' = 'qwen',
  extraArgs: string[] = [],
  worktreeTaskId?: string
): StartResult {
  // VL-145: канонический ключ — задачные ключи в верхнем регистре,
  // чтобы resume (ключ из верхнего регистра меты) и фаза (raw task.id,
  // например 'ot-5' при meta 'OT-5') совпадали в guard'е; prompt и
  // resume:<sessionId> регистр не меняют.
  const key = taskIdPattern(cwd).test(runKey) ? runKey.toUpperCase() : runKey;
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
  // VL-112: close исключён — закрытие идёт в главном репо: merge ветки и
  // docs(task)-коммит backlog возможны только здесь (см. phase-close-worktree.md)
  // VL-118: «задачная» проверка — по task_prefix конфига проекта
  const branchTask = taskIdPattern(cwd).test(key) && phase !== 'close' ? key : (worktreeTaskId ?? '');
  // VL-114: задачный env нужен фазам задач независимо от worktree: CLI пишет
  // по нему мету сессии даже когда промпт пришёл готовым (isPhaseMode=false).
  // Close исключён (VL-112: закрытие в главном репо, его resume не должен
  // уходить в worktree); у resume taskId берётся из worktreeTaskId (мета
  // VL-110) — без меты resume остаётся на прежнем пути без env.
  const phaseTaskId =
    taskIdPattern(cwd).test(key) && phase !== 'close' ? key.toUpperCase() : (worktreeTaskId ?? '');
  if (phaseTaskId !== '') {
    spawnEnv = {
      ...baseEnv(),
      VIBELOG_PHASE_TASK_ID: phaseTaskId,
      VIBELOG_PHASE_NAME: phase,
    };
  }
  if (resolveBranchMode(cwd) && branchTask !== '') {
    // VL-134: worktree создаётся впервые только на фазе plan; для epic — никогда.
    // Остальные фазы (spec/code/comment/resume) используют worktree ТОЛЬКО если
    // он уже существует (ensure идемпотентен); иначе — главный cwd.
    const wtDir = taskWorktreeDir(cwd, branchTask);
    const wtExists = existsSync(wtDir);
    const taskType = (getTask(cwd, branchTask)?.type ?? '').toLowerCase();
    // Вход в блок: готовый worktree либо первое создание (plan, не epic).
    // Иначе блок пропускается целиком: runCwd = главный cwd, VIBELOG_CWD не
    // задаётся, «Режим параллельной разработки» не добавляется в промпт.
    if (wtExists || (phase === 'plan' && taskType !== 'epic')) {
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
  // из process.env: бот кладёт туда .env через loadDotEnv (VL-37), доп.
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

  activeRuns.set(key, { phase, child, onExit, agent });
  lastRuns.delete(key);

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
  const finish = (code: number | null) => {
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
    // E2E VL-114). При --resume CLI мету не перезаписывает (isNewSession=false) —
    // мета остаётся phase='plan', это корректно: возобновлённые code-запуски
    // продолжают ту же план-сессию. Fire-and-forget: ошибка записи не роняет фазу.
    if (result?.session_id && phaseTaskId !== '') {
      let metaCwd = cwd;
      try {
        metaCwd = realpathSync(cwd);
      } catch {
        // каталог исчез между спавном и завершением — оставляем исходный путь
      }
      saveSessionMeta(agentSessionsDir(cwd), result.session_id, {
        taskId: phaseTaskId,
        phase,
        cwd: metaCwd,
      }).catch((err) => {
        console.log(`[phase ${key}] ${ts()} мета сессии не записана: ${(err as Error).message}`);
      });
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
    lastRuns.set(key, record);
    // VL-48: уведомление о завершении (бот). Fire-and-forget в try/catch:
    // сетевые ошибки Telegram не должны ронять polling оркестратора.
    try {
      onExit?.(record);
    } catch (err) {
      console.error('onExit-колбэк фазы упал:', err);
    }
  };

  child.on('exit', (code, signal) => {
    console.log(`[phase ${key}] ${ts()} exit: code=${code} signal=${signal}`);
  });
  child.on('error', (err) => {
    log += `${log ? '\n' : ''}Ошибка запуска: ${err.message}`;
    console.log(`[phase ${key}] ${ts()} error: ${err.message}`);
    finish(null);
  });
  child.on('close', (code) => {
    console.log(`[phase ${key}] ${ts()} close: code=${code}`);
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
 * Состояние запуска фазы задачи.
 *
 * @param taskId — ID задачи (регистр любым: ключи канонизируются, VL-145)
 * @returns текущий или последний запуск, либо null если запусков не было
 */
export function getRun(taskId: string): PhaseRun | null {
  const active = lookupCI(activeRuns, taskId);
  if (active) {
    return { running: true, phase: active.phase, pid: active.child.pid, agent: active.agent };
  }
  return lookupCI(lastRuns, taskId) ?? null;
}
