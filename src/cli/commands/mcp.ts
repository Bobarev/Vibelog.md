/**
 * Команда `vibelog mcp start` — запуск MCP-сервера.
 *
 * Запускает JSON-RPC 2.0 сервер поверх stdin/stdout.
 * Предназначен для подключения к AI-агентам (Qwen Code).
 */

import { startMcpServer } from '../../mcp/server.js';
import { printInfo } from '../ui.js';
import type { FlagValues } from '../args.js';

/**
 * Выполняет команду mcp.
 *
 * @param subcommand — подкоманда (start)
 * @param positional — позиционные аргументы
 * @param flags — флаги
 * @param cwd — текущая рабочая директория
 */
export async function runMcp(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  if (subcommand === 'start') {
    // В режиме MCP не выводим ничего в stderr — только JSON-RPC в stdout
    startMcpServer(cwd);
    // Сервер работает до закрытия stdin
  } else {
    printInfo('Использование: vibelog mcp start');
    printInfo('Запускает MCP-сервер для подключения к AI-агентам.');
  }
}
