/**
 * Интерактивный режим агента (VL-102, перенесён в `vibelog agent` по VL-158):
 * multi-turn TUI-чат.
 *
 * Точка входа подкоманды agent без подкоманд/с <task-id> (роутер CLI, VL-158;
 * ранее — пустой запуск `vibelog`/`vb`): пользователь вводит сообщения строкой
 * ввода внизу TUI, каждый ход выполняется через runLoop с полным набором инструментов
 * (локальные + MCP Vibelog), ответ стримится в TUI, транскрипт сессии
 * сохраняется после каждого хода (VL-95). JSON-контракт оркестратора
 * (VL-63, main() в cli.ts) не задет — этот модуль отдельная точка входа
 * для чата; в headless-путях CLI не грузится (динамический импорт
 * роутера — ink/react не участвуют в контракте оркестратора).
 *
 * LLM-переменные VIBELOG_LLM_* читаются из окружения либо из .env проекта
 * (loadProjectEnv, VL-37/VL-189 — реальное окружение приоритетнее файла,
 * как у бота): чат запускается человеком напрямую, экспортировать ключи
 * руками неудобно.
 */

import { createLlmClient } from './llm.js';
import type { ChatMessage } from './llm.js';
import { runLoop } from './loop.js';
import { getTask } from '../core/store.js';
import { taskToMarkdown } from '../core/task.js';
import { agentSessionsDir, createSessionId, loadSession, saveSession } from './session.js';
// Загрузка env проекта (VL-37/VL-189) — общий модуль с ботом и браузером
import { loadProjectEnv } from '../bot/env.js';
import { ensureLlmEnv, loadApiMode } from './llm-env.js';
import { buildSystemPrompt } from './system-prompt.js';
import { listLocalTools } from './tools.js';
import type { ToolSpec } from './tools.js';
import { McpClient, toolsAsSpecs } from './mcp-client.js';
import { closeExternalMcpClients, connectExternalMcpServers } from './external-mcp.js';
import { renderInteractiveTui } from './tui.js';
import type { InteractiveTuiHandle } from './tui.js';

/**
 * Собирает messages одного хода чата: system + история + новое сообщение.
 *
 * История может случайно содержать system-сообщения (например, при загрузке
 * готового транскрипта) — дубли system ломают API части провайдеров,
 * поэтому вычищаются здесь: единственная точка сборки хода.
 */
export function composeTurnMessages(
  system: string,
  history: ChatMessage[],
  userText: string,
): ChatMessage[] {
  const cleaned = history.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: system }, ...cleaned, { role: 'user', content: userText }];
}

/**
 * Загружает сохранённую сессию для возобновления TUI-чата (VL-171).
 *
 * session-ref в том же формате, что у headless --resume (cli.ts) и бота:
 * префикс `vb:` срезается (файл сессии — <id>.jsonl), system-сообщения
 * истории вычищаются — свежий system собирается buildSystemPrompt на
 * каждом ходе (дубли system ломают часть LLM API, паттерн composeTurnMessages).
 *
 * @param sessionsDir — каталог хранения сессий (.vibelog/agent-sessions)
 * @param resumeRef — session-ref: vb:agent-XXX либо голый agent-XXX
 * @throws Error «Сессия <ref> не найдена …» (loadSession) либо «битая строка N»
 */
export async function loadResumeHistory(
  sessionsDir: string,
  resumeRef: string,
): Promise<{ sessionId: string; history: ChatMessage[] }> {
  // Бот передаёт sessionId с префиксом vb: — снимаем, как в parseArgs
  // headless-CLI (cli.ts) и startResume (orchestrator.ts)
  const sessionId = resumeRef.replace(/^vb:/, '');
  const messages = await loadSession(sessionsDir, sessionId);
  // system в истории не нужен: на каждом ходе свежий systemPrompt
  return { sessionId, history: messages.filter((m) => m.role !== 'system') };
}

/**
 * Точка входа интерактивного чата: env- проверки → TUI → цикл ходов.
 *
 * Ошибки до цикла — stderr + exit 1 (TUI ещё не нарисован); SIGINT —
 * unmount TUI + закрытие MCP + exit 130. Сессия сохраняется после каждого
 * хода — обрыв теряет только текущий незавершённый ход.
 *
 * options.taskRef (VL-158): id задачи — её карточка добавляется в system
 * prompt, чат стартует с задачей в контексте. Роутер проверил существование
 * задачи до вызова; здесь — страховка (stderr + exit 1).
 *
 * options.resume (VL-171): session-ref (vb:agent-XXX либо agent-XXX) —
 * TUI-чат продолжает сохранённую сессию: история загружается из jsonl,
 * новые ходы дописываются в тот же файл. Ошибка загрузки — stderr + exit 1
 * до рендера TUI (паттерн «ошибки до цикла»).
 */
export async function runInteractiveAgent(
  options: { taskRef?: string; resume?: string } = {},
): Promise<void> {
  const cwd = process.cwd();
  // .env проекта + секция env settings.json (VL-37/VL-143): чат запускается
  // человеком напрямую — VIBELOG_LLM_* обычно лежат в .env; реальное
  // окружение приоритетнее файла (dotenv). Общий хелпер loadProjectEnv
  // (VL-189) — тот же код в боте и браузере, повторный вызов идемпотентен
  loadProjectEnv(cwd);

  // Env-проверки ДО рендера TUI: ошибка не должна появиться в альтернативном буфере
  // (общая ensureLlmEnv, VL-189 — тексты ошибок дословно прежние)
  if (!ensureLlmEnv('чату с агентом')) {
    process.exitCode = 1;
    return;
  }
  // apiMode (VL-205): режим LLM API из settings.json api_mode (дефолт chat)
  const llm = createLlmClient({ apiMode: loadApiMode(cwd) });
  const tools: ToolSpec[] = listLocalTools(cwd);
  // VL-107 fix: как в cli.ts — при запуске из worktree сессии хранятся
  // в главном репо (VIBELOG_CWD от оркестратора), чтобы resume из бота
  // находил их; без env — прежний cwd (ручной запуск)
  const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);
  // VL-171: --resume продолжает сохранённую сессию (sessionId + история
  // из jsonl); без флага — новая сессия, как раньше. Ошибка загрузки —
  // stderr + exit 1 ДО рендера TUI (сессия не найдена / битый jsonl)
  let sessionId: string;
  let history: ChatMessage[] = [];
  if (options.resume !== undefined) {
    try {
      ({ sessionId, history } = await loadResumeHistory(sessionsDir, options.resume));
    } catch (err) {
      console.error(`Ошибка: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  } else {
    sessionId = createSessionId();
  }

  // MCP: отказ не роняет чат — продолжаем без vibelog-инструментов (паттерн cli.ts).
  // VL-149: mcpClients — встроенный + внешние серверы из settings.json mcpServers.
  const mcpClients: McpClient[] = [];
  let externalTools: ToolSpec[] = [];
  try {
    const mcp = await McpClient.create({ cwd });
    mcpClients.push(mcp);
    externalTools = toolsAsSpecs(mcp, await mcp.listTools());
  } catch (err) {
    console.error(
      `Предупреждение: MCP-инструменты недоступны — ${(err as Error).message}; чат продолжится без них`,
    );
  }
  // Внешние серверы (VL-149): каждый подключается независимо, отказ одного
  // не мешает остальным и не роняет чат (fail-safe внутри connect)
  try {
    const ext = await connectExternalMcpServers(cwd);
    mcpClients.push(...ext.clients);
    externalTools.push(...ext.specs);
  } catch (err) {
    console.error(
      `Предупреждение: внешние MCP-серверы недоступны — ${(err as Error).message}; чат продолжится без них`,
    );
  }

  const systemPrompt = buildSystemPrompt(cwd);
  // Контекст задачи (VL-158): vibelog agent <task-id> — карточка задачи
  // в system prompt, чат стартует с задачей в контексте
  if (options.taskRef) {
    const task = getTask(cwd, options.taskRef);
    if (!task) {
      console.error(`Ошибка: задача не найдена: ${options.taskRef}`);
      process.exitCode = 1;
      return;
    }
    systemPrompt.content += `\n\n# Контекст задачи (открыл пользователь)\n\n${taskToMarkdown(task)}`;
  }
  // История чата без system собирается на каждом ходе (VL-171: при --resume
  // history уже загружена из jsonl); растёт между ходами
  let busy = false;
  let finished = false;
  let tui: InteractiveTuiHandle | null = null;

  /** Закрыть MCP (если открыт) и завершить процесс. */
  const shutdown = async (code: number): Promise<void> => {
    // closeExternalMcpClients (VL-149): закрывает всех — встроенный и внешние
    await closeExternalMcpClients(mcpClients);
    process.exit(code);
  };

  // SIGINT (срабатывает, если ink не перехватил ввод): размонтировать TUI,
  // закрыть MCP, выйти — сервер-сирота не должен остаться висеть (паттерн cli.ts)
  const ac = new AbortController();
  process.on('SIGINT', () => {
    ac.abort();
    tui?.unmount();
    void shutdown(130);
  });

  /** Ход чата: setBusy → runLoop → история + сохранение сессии → setBusy(false). */
  const submitTurn = (text: string): void => {
    // Защита от двойного ввода: пока ход выполняется, новые сообщения не берём
    if (busy || finished) return;
    busy = true;
    tui?.setBusy(true);
    void (async () => {
      try {
        const messages = composeTurnMessages(systemPrompt.content, history, text);
        const result = await runLoop({
          llm,
          messages,
          tools,
          externalTools,
          onToken: (token: string) => tui?.onToken(token),
          onToolStart: (name, callArgs) => tui?.onToolStart(name, callArgs),
          onToolEnd: (name, out, isError) => tui?.onToolEnd(name, out, isError),
          onUsage: (usage, turn) => tui?.onUsage(usage, turn),
          onError: (errorText) => tui?.onError(errorText),
          signal: ac.signal,
        });
        // В историю — всё, кроме system: на следующий ход система собирается заново
        history = result.messages.filter((m) => m.role !== 'system');
        // Сохранение после каждого хода (VL-95): обрыв не теряет завершённые ходы.
        // Ошибка записи — предупреждение, чат продолжается.
        try {
          await saveSession(sessionsDir, sessionId, result.messages);
        } catch (err) {
          console.error(
            `Предупреждение: сессия ${sessionId} не сохранена — ${(err as Error).message}`,
          );
        }
      } catch (err) {
        // Неожиданная ошибка хода — показываем в блоке ошибок TUI, чат живёт
        tui?.onError(`Ошибка хода: ${(err as Error).message}`);
      } finally {
        // Финализация хода (VL-113): ответ переносится в ленту чата,
        // стрим/карточки сбрасываются — в т.ч. в ошибочном пути (частичный
        // текст не теряется, но и не приклеивается к следующему ходу)
        tui?.finishTurn();
        busy = false;
        tui?.setBusy(false);
      }
    })();
  };

  tui = renderInteractiveTui({
    sessionId,
    onSubmit: submitTurn,
    onExit: () => {
      // Повторный Ctrl+C/Ctrl+D во время shutdown — игнорируем
      if (finished) return;
      finished = true;
      tui?.unmount();
      void shutdown(0);
    },
  });
}
