/**
 * Дебаг-режим qwen (VL-58): ping-прогон с stream-json, только vibelog-MCP
 * и --debug. Именно эта инвокация помогла найти первопричину задержки
 * уведомлений бота (утечка памяти в настройках qwen).
 *
 * Запуск: vibelog qwen-debug (из каталога проекта с backlog/).
 * stdio наследуется — события видны в терминале напрямую.
 */

import { spawn } from 'node:child_process';
import { printHeader } from '../ui.js';

/** Промпт и флаги дебаг-прогона (точная инвокация из расследования VL-58). */
const DEBUG_PROMPT = 'Пинг, просто ответь понг.';
const DEBUG_ARGS = [
  '--output-format',
  'stream-json',
  '--allowed-mcp-server-names',
  'vibelog',
  '--debug',
];

/**
 * Запускает дебаг-прогон qwen и наследует stdio (события видны в терминале).
 *
 * @param cwd — каталог проекта (там же backlog/ и .qwen/)
 */
export async function runQwenDebug(cwd: string): Promise<void> {
  printHeader('Vibelog.md — дебаг-режим qwen (ping)');
  const bin = process.env.VIBELOG_QWEN_BIN || 'qwen';
  const child = spawn(bin, [DEBUG_PROMPT, ...DEBUG_ARGS], {
    cwd,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`Не удалось запустить ${bin}: ${err.message}`);
    console.error('Проверь установку qwen или задай VIBELOG_QWEN_BIN');
    process.exit(1);
  });
  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}
