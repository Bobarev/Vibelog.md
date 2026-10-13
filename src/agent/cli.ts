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
import type { ChatMessage } from './llm.js';
import { runLoop } from './loop.js';
import { agentSessionsDir, appendSessionMessage, createSessionId, latestSession, loadSession, saveSession, saveSessionMeta } from './session.js';
import { taskWorktreeDir } from '../core/worktree.js';
import { taskIdPattern } from '../core/config.js';
import { buildSystemPrompt } from './system-prompt.js';
import { listLocalTools } from './tools.js';
import type { ToolSpec } from './tools.js';
import { McpClient, toolsAsSpecs } from './mcp-client.js';
import { renderPrompt } from '../web/phase-prompt.js';
import type { TuiHandle } from './tui.js';

/** Результат агента: QwenResult + type=result (контракт parseQwenResult). */
interface AgentJsonResult {
  type: 'result';
  result: string;
  is_error: boolean;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  session_id: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    total_tokens: number;
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
  /** --max-wall-time сек: лимит времени фазы (дефолт 900, VL-83). */
  maxWallTimeSec?: number;
  /** --max-requests N: лимит LLM-запросов фазы (ходов; без лимита, VL-104). */
  maxRequests?: number;
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
  /** --help: показать справку. */
  help: boolean;
}

const USAGE = `Использование:
  vibelog-agent <фаза> <taskId> [флаги]   — выполнить фазу задачи
  vibelog-agent <промпт> [флаги]          — выполнить готовый промпт (qwen-совместимо)

Фазы: spec | plan | code | close | comment | prompt
Флаги:
  --headless               — JSON-результат в stdout (дефолт без TTY)
  --no-mcp                 — не подключать MCP-инструменты Vibelog
  --no-tui                 — отключить TUI в интерактивном режиме (VL-86)
  --comment <текст>        — подстановка {{comment}}/{{prompt}} в шаблон фазы
  --max-tool-calls <N>     — лимит tool-calls loop (дефолт 100)
  --max-wall-time <сек>    — лимит времени фазы (дефолт 900)
  --max-requests <N>       — лимит LLM-запросов фазы (ходов; без лимита)
  --compact-tail <N>       — компакшн истории: хвост LLM-запроса (дефолт 50, VL-122)
  --compact-at-tokens <N>  — компакшн истории: порог по usage-токенам (дефолт 850000, VL-122)
  --no-compact             — отключить компакшн истории (VL-122; по умолчанию включён)
  --resume <sessionId>     — продолжить сохранённую сессию (VL-95; префикс vb: игнорируется)
  --continue               — продолжить последнюю сессию текущего каталога (VL-95)
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


  // Headless: явный флаг, --output-format json (qwen) или не-TTY stdout
  const headless = opts.headless || !process.stdout.isTTY;
  log(`фаза=${phase ?? '(готовый промпт)'} задача=${isPhaseMode ? positionals[1] : '-'} headless=${headless}`);

  // LLM из env: VIBELOG_LLM_BASE_URL / VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL
  if (!process.env.VIBELOG_LLM_API_KEY) {
    console.error(
      'Ошибка: не задан VIBELOG_LLM_API_KEY — агенту нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)'
    );
    process.exitCode = 1;
    return;
  }
  if (!process.env.VIBELOG_LLM_MODEL) {
    console.error('Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна');
    process.exitCode = 1;
    return;
  }
  // Оба ключа env проверены — createLlmClient не бросит (падает только без модели)
  const llm = createLlmClient();

  const cwd = process.cwd();

  // Промпт фазы собирается до инициализации сессий: ошибка шаблона завершает
  // CLI до создания jsonl. Блок объявлен после cwd (VL-112): выбор
  // close-worktree шаблона зависит от worktree задачи в этом cwd
  let prompt: string;
  try {
    prompt = isPhaseMode
      ? renderPrompt(
          positionals[0],
          positionals[1],
          {
            comment: opts.comment ?? '',
            prompt: opts.comment ?? '',
          },
          // VL-112: close задачи с worktree — тот же выбор шаблона, что в оркестраторе
          {
            closeWorktree:
              positionals[0] === 'close' && existsSync(taskWorktreeDir(cwd, positionals[1])),
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

  // Метаданные сессии (VL-110/114): два источника taskId/phase — позиционные
  // <фаза> <taskId> (прямой CLI-запуск, без фильтров — task_prefix
  // конфигурируем) и env оркестратора VIBELOG_PHASE_TASK_ID/NAME (боевой
  // путь: спавн готовым промптом, isPhaseMode=false). Resume/--continue
  // мету не перезаписывают: сессия продолжается, мета уже записана — по
  // ней startResume возобновляет задачу в её worktree (инцидент VL-98).
  const isNewSession = opts.resume === undefined && !opts.continue;
  if (isNewSession) {
    try {
      if (isPhaseMode) {
        await saveSessionMeta(sessionsDir, sessionId, { taskId: positionals[1], phase, cwd });
      } else {
        // Env-путь (боевой спавн оркестратора): фильтруем мусор — только
        // id по префиксу конфига проекта (VL-118; дефолт VL без конфига)
        const envTaskId = process.env.VIBELOG_PHASE_TASK_ID;
        if (envTaskId && taskIdPattern(cwd).test(envTaskId)) {
          await saveSessionMeta(sessionsDir, sessionId, {
            taskId: envTaskId.toUpperCase(),
            phase: process.env.VIBELOG_PHASE_NAME,
            cwd,
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
  let mcp: McpClient | null = null;
  let externalTools: ToolSpec[] = [];
  const wantMcp = !opts.noMcp && phase !== 'prompt';
  if (wantMcp) {
    try {
      mcp = await McpClient.create({ cwd });
      externalTools = toolsAsSpecs(mcp, await mcp.listTools());
      log(`MCP: подключено инструментов — ${externalTools.length}`);
    } catch (err) {
      console.error(
        `Предупреждение: MCP-инструменты недоступны — ${(err as Error).message}; фаза продолжится без них`
      );
      mcp = null;
    }
  }

  // TUI (VL-86): создаётся ниже перед loop; здесь — для SIGINT-хэндлера
  let tui: TuiHandle | null = null;

  // SIGINT: закрыть MCP и выйти — сервер-сирота не должен остаться висеть
  const ac = new AbortController();
  process.on('SIGINT', () => {
    log('SIGINT — прерывание фазы');
    ac.abort();
    // Альтернативный буфер TUI нужно вернуть терминалу до exit (VL-86)
    tui?.unmount();
    void (async () => {
      if (mcp) {
        try {
          await mcp.close();
        } catch {
          // сервер уже завершился — закрывать нечего
        }
      }
      process.exit(130);
    })();
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
  // При resume в диалог вливается сохранённая история перед новым промптом
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt.content },
    ...history,
    { role: 'user', content: prompt },
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
  try {
    const startup: ChatMessage[] = wasResumed
      ? [{ role: 'user', content: prompt }]
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
      ...(opts.maxWallTimeSec !== undefined ? { maxWallTimeMs: opts.maxWallTimeSec * 1000 } : {}),
      ...(opts.maxRequests !== undefined ? { maxRequests: opts.maxRequests } : {}),
      ...(opts.compactTail !== undefined ? { compactTailMessages: opts.compactTail } : {}),
      ...(opts.compactAtTokens !== undefined ? { compactAtTokens: opts.compactAtTokens } : {}),
      ...(opts.noCompact ? { compactDisabled: true } : {}),
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

  if (mcp) {
    try {
      await mcp.close();
    } catch {
      // фаза уже отработала — ошибка закрытия не должна ломать вывод
    }
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

  // Единственная строка stdout — JSON type=result (контракт parseQwenResult).
  // duration_api_ms loop не меряет отдельно — приравнен к общему duration_ms.
  const output: AgentJsonResult = {
    type: 'result',
    result: loopResult.result,
    is_error: loopResult.is_error,
    num_turns: loopResult.num_turns,
    duration_ms: loopResult.duration_ms,
    duration_api_ms: loopResult.duration_ms,
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
