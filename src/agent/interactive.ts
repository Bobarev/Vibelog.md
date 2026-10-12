/**
 * Интерактивный режим vibelog-agent (VL-102): multi-turn TUI-чат.
 *
 * Точка входа для пустого запуска `vibelog`/`vb` в интерактивном TTY
 * (роутер CLI): пользователь вводит сообщения строкой ввода внизу TUI,
 * каждый ход выполняется через runLoop с полным набором инструментов
 * (локальные + MCP Vibelog), ответ стримится в TUI, транскрипт сессии
 * сохраняется после каждого хода (VL-95). JSON-контракт оркестратора
 * (VL-63, main() в cli.ts) не задет — этот модуль отдельная точка входа
 * для чата; в headless-путях CLI не грузится (динамический импорт
 * роутера — ink/react не участвуют в контракте оркестратора).
 *
 * LLM-переменные VIBELOG_LLM_* читаются из окружения либо из .env проекта
 * (loadDotEnv, VL-37 — реальное окружение приоритетнее файла, как у бота):
 * чат запускается человеком напрямую, экспортировать ключи руками неудобно.
 */

import { createLlmClient } from './llm.js';
import type { ChatMessage } from './llm.js';
import { runLoop } from './loop.js';
import { agentSessionsDir, createSessionId, saveSession } from './session.js';
// Загрузка .env проекта (VL-37) — общий модуль с ботом, только node:fs/path
import { loadDotEnv } from '../bot/env.js';
import { buildSystemPrompt } from './system-prompt.js';
import { listLocalTools } from './tools.js';
import type { ToolSpec } from './tools.js';
import { McpClient, toolsAsSpecs } from './mcp-client.js';
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
 * Точка входа интерактивного чата: env-проверки → TUI → цикл ходов.
 *
 * Ошибки до цикла — stderr + exit 1 (TUI ещё не нарисован); SIGINT —
 * unmount TUI + закрытие MCP + exit 130. Сессия сохраняется после каждого
 * хода — обрыв теряет только текущий незавершённый ход.
 */
export async function runInteractiveAgent(): Promise<void> {
  const cwd = process.cwd();
  // .env проекта (VL-37): чат запускается человеком напрямую — VIBELOG_LLM_*
  // обычно лежат в .env. Реальное окружение приоритетнее файла (dotenv).
  loadDotEnv(cwd);

  // Env-проверки ДО рендера TUI: ошибка не должна появиться в альтернативном буфере
  if (!process.env.VIBELOG_LLM_API_KEY) {
    console.error(
      'Ошибка: не задан VIBELOG_LLM_API_KEY — чату с агентом нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)',
    );
    process.exitCode = 1;
    return;
  }
  if (!process.env.VIBELOG_LLM_MODEL) {
    console.error('Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна');
    process.exitCode = 1;
    return;
  }
  const llm = createLlmClient();
  const tools: ToolSpec[] = listLocalTools(cwd);
  // VL-107 fix: как в cli.ts — при запуске из worktree сессии хранятся
  // в главном репо (VIBELOG_CWD от оркестратора), чтобы resume из бота
  // находил их; без env — прежний cwd (ручной запуск)
  const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);
  const sessionId = createSessionId();

  // MCP: отказ не роняет чат — продолжаем без vibelog-инструментов (паттерн cli.ts)
  let mcp: McpClient | null = null;
  let externalTools: ToolSpec[] = [];
  try {
    mcp = await McpClient.create({ cwd });
    externalTools = toolsAsSpecs(mcp, await mcp.listTools());
  } catch (err) {
    console.error(
      `Предупреждение: MCP-инструменты недоступны — ${(err as Error).message}; чат продолжится без них`,
    );
    mcp = null;
  }

  const systemPrompt = buildSystemPrompt(cwd);
  // История чата (без system — собирается на каждом ходе): растёт между ходами
  let history: ChatMessage[] = [];
  let busy = false;
  let finished = false;
  let tui: InteractiveTuiHandle | null = null;

  /** Закрыть MCP (если открыт) и завершить процесс. */
  const shutdown = async (code: number): Promise<void> => {
    if (mcp) {
      try {
        await mcp.close();
      } catch {
        // сервер уже завершился — закрывать нечего
      }
    }
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
