/**
 * Команда `vibelog mcp start` — запуск MCP-сервера.
 *
 * Запускает JSON-RPC 2.0 сервер поверх stdin/stdout.
 * Предназначен для подключения к AI-агентам (Qwen Code).
 */

import { startMcpServer } from '../../mcp/server.mjs';
import { printInfo } from '../ui.mjs';

/**
 * Выполняет команду mcp.
 *
 * @param {string} subcommand — подкоманда (start)
 * @param {string[]} positional — позиционные аргументы
 * @param {Record<string, unknown>} flags — флаги
 * @param {string} cwd — текущая рабочая директория
 */
export async function runMcp(subcommand, positional, flags, cwd) {
  if (subcommand === 'start') {
    // В режиме MCP не выводим ничего в stderr — только JSON-RPC в stdout
    startMcpServer(cwd);
    // Сервер работает до закрытия stdin
  } else {
    printInfo('Использование: vibelog mcp start');
    printInfo('Запускает MCP-сервер для подключения к AI-агентам.');
  }
}
