/**
 * Внешние MCP-серверы vibelog-агента (VL-149).
 *
 * Пользователь добавляет любые stdio MCP-серверы в секцию `mcpServers`
 * `.vibelog/settings.json` — в формате Qwen Code (command/args/env/enabled/
 * timeoutMs), без правки кода. Первичный сценарий — веб-тестирование через
 * chrome-devtools MCP.
 *
 * Секция mcpServers — внутренняя настройка Vibelog (не трогает backlog/
 * config.yml — там строгая совместимость хранения с Backlog.md). Файл
 * gitignored; секреты серверов — в env-записи сервера или в окружении
 * родителя (наследуется по умолчанию).
 *
 * Инструменты внешнего сервера получают префикс «<имя>__» (дефисы →
 * подчёркивания), чтобы не конфликтовать между серверами и с vibelog-
 * инструментами; в сервер уходит имя без префикса (toolsAsSpecs VL-149).
 *
 * Отказ одного сервера (нет бинарника, таймаут handshake) — предупреждение
 * в stderr и подключение остальных: внешние инструменты не должны ронять
 * фазу (паттерн cli.ts: отказ MCP не фатален).
 */

import { loadSettings } from '../core/settings.js';
import { McpClient, toolsAsSpecs } from './mcp-client.js';
import type { ToolSpec } from './tools.js';

/** Запись сервера в секции mcpServers settings.json. */
export interface ExternalMcpServer {
  /** Имя сервера (ключ в mcpServers); используется как префикс инструментов. */
  name: string;
  /** Команда запуска (бинарник или npx). */
  command: string;
  /** Аргументы команды. */
  args: string[];
  /** Доп. окружение сервера; накладывается поверх окружения родителя. */
  env?: Record<string, string>;
  /** false — сервер не подключается (конфиг остаётся в файле). */
  enabled?: boolean;
  /** Таймаут одного JSON-RPC запроса, мс (handshake/listTools/callTool). */
  timeoutMs?: number;
}

/** Результат подключения: клиенты (для close) и инструменты для loop. */
export interface ExternalMcpConnections {
  clients: McpClient[];
  specs: ToolSpec[];
}

/**
 * Читает и валидирует внешние серверы из settings.json.
 *
 * Битая запись — предупреждение в stderr + пропуск (не throw): конфиг
 * пользователя не должен ронять агент. Нет файла/ключа — пустой список.
 */
export function loadExternalMcpServers(cwd: string): ExternalMcpServer[] {
  const raw = loadSettings(cwd).mcpServers;
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('Предупреждение: mcpServers в settings.json — не объект, серверы не подключены');
    return [];
  }
  const servers: ExternalMcpServer[] = [];
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    // Формат Qwen Code: запись — объект с command/args/env; пустое имя — битый ключ
    if (name.trim() === '' || typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      console.error(`Предупреждение: mcpServers.${name} — не объект, запись пропущена`);
      continue;
    }
    const rec = entry as Record<string, unknown>;
    if (typeof rec.command !== 'string' || rec.command.trim() === '') {
      console.error(`Предупреждение: mcpServers.${name}.command — не непустая строка, запись пропущена`);
      continue;
    }
    let args: string[] = [];
    if (rec.args !== undefined) {
      if (!Array.isArray(rec.args) || rec.args.some((a) => typeof a !== 'string')) {
        console.error(`Предупреждение: mcpServers.${name}.args — не массив строк, запись пропущена`);
        continue;
      }
      args = rec.args as string[];
    }
    let env: Record<string, string> | undefined;
    if (rec.env !== undefined) {
      if (typeof rec.env !== 'object' || rec.env === null || Array.isArray(rec.env)) {
        console.error(`Предупреждение: mcpServers.${name}.env — не объект, запись пропущена`);
        continue;
      }
      const entries = Object.entries(rec.env as Record<string, unknown>);
      if (entries.some(([, v]) => typeof v !== 'string')) {
        console.error(`Предупреждение: mcpServers.${name}.env — значение не строка, запись пропущена`);
        continue;
      }
      // entries уже проверены на string values (выше) — приведение безопасно
      env = Object.fromEntries(entries) as Record<string, string>;
    }
    let timeoutMs: number | undefined;
    if (rec.timeoutMs !== undefined) {
      if (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs) || rec.timeoutMs <= 0) {
        console.error(`Предупреждение: mcpServers.${name}.timeoutMs — не положительное число, запись пропущена`);
        continue;
      }
      timeoutMs = rec.timeoutMs;
    }
    const server: ExternalMcpServer = { name, command: rec.command.trim(), args };
    if (env !== undefined) server.env = env;
    // enabled: false — явное отключение; всё остальное (включая отсутствие) — включено
    if (rec.enabled === false) server.enabled = false;
    if (timeoutMs !== undefined) server.timeoutMs = timeoutMs;
    servers.push(server);
  }
  return servers;
}

/** Префикс имени инструментов сервера: дефисы → _, к имени добавляется «__». */
export function toolPrefixFor(serverName: string): string {
  return `${serverName.replace(/-/g, '_')}__`;
}

/**
 * Подключает все enabled внешние серверы: спавн + handshake + listTools.
 *
 * Отказ одного сервера — предупреждение в stderr, остальные подключаются.
 * Уже подключённые клиенты при падении следующего НЕ закрываются — caller
 * получает их в clients и закрывает единым циклом (close идемпотентен).
 */
export async function connectExternalMcpServers(cwd: string): Promise<ExternalMcpConnections> {
  const clients: McpClient[] = [];
  const specs: ToolSpec[] = [];
  for (const server of loadExternalMcpServers(cwd)) {
    if (server.enabled === false) continue;
    try {
      const client = await McpClient.create({
        command: server.command,
        commandArgs: server.args,
        cwd,
        // Окружение родителя наследуется (env: {...process.env}); запись env
        // сервера накладывается поверх — ключи сервера приоритетнее
        env: { ...process.env, ...server.env },
        ...(server.timeoutMs !== undefined ? { requestTimeoutMs: server.timeoutMs } : {}),
      });
      const tools = await client.listTools();
      clients.push(client);
      specs.push(...toolsAsSpecs(client, tools, toolPrefixFor(server.name)));
      console.error(`[external-mcp] сервер «${server.name}»: подключено инструментов — ${tools.length}`);
    } catch (err) {
      console.error(
        `Предупреждение: внешний MCP-сервер «${server.name}» недоступен — ${(err as Error).message}; продолжаем без него`,
      );
    }
  }
  return { clients, specs };
}

/** Закрывает всех клиентов (close идемпотентен); ошибки закрытия игнорируются. */
export async function closeExternalMcpClients(clients: McpClient[]): Promise<void> {
  await Promise.all(
    clients.map((c) =>
      c.close().catch(() => {
        // сервер уже завершился — закрывать нечего
      }),
    ),
  );
}
