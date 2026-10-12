/**
 * Команда `vibelog mcp start` — запуск MCP-сервера.
 *
 * Запускает JSON-RPC 2.0 сервер поверх stdin/stdout.
 * Предназначен для подключения к AI-агентам (Qwen Code).
 */

import { resolve } from 'node:path';
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
    // VIBELOG_CWD (VL-107): оркестратор задаёт env при запуске фазы в git
    // worktree ветки vb/vl-N — MCP-сервер наследует cwd агента (worktree),
    // но backlog и задачи читает/пишет в ГЛАВНОМ репозитории. Без override
    // worktree-копия backlog осталась бы нетронутой, статусы потерялись бы.
    const root = process.env.VIBELOG_CWD ? resolve(process.env.VIBELOG_CWD) : cwd;
    // В режиме MCP не выводим ничего в stderr — только JSON-RPC в stdout
    startMcpServer(root);
    // Сервер работает до закрытия stdin
  } else {
    printInfo('Использование: vibelog mcp start');
    printInfo('Запускает MCP-сервер для подключения к AI-агентам.');
  }
}
