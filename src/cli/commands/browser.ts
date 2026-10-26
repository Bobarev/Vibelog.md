/**
 * Команда `vibelog browser` — запуск веб-интерфейса.
 *
 * Поднимает HTTP-сервер на 127.0.0.1 и открывает канбан в браузере.
 */

import { startWebServer } from '../../web/server.js';
import { loadProjectEnv } from '../../bot/env.js';
import { loadConfig } from '../../core/config.js';
import type { FlagValues } from '../args.js';
import type { Server } from 'node:http';

/**
 * Выполняет команду browser.
 *
 * @param positional — позиционные аргументы (не используются)
 * @param flags — флаги: port, no-open
 * @param cwd — рабочая директория проекта (backlog/ и .vibelog/ ищутся отсюда)
 * @returns HTTP-сервер веб-интерфейса — вызывающий/тесты могут закрыть его
 *   через server.close() (VL-189: возврат нужен для проверки загрузки env)
 */
export async function runBrowser(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<Server> {
  let port = 3030;
  if (flags.port) {
    port = parseInt(String(flags.port), 10);
  } else {
    try {
      const config = loadConfig(cwd);
      port = (config.default_port as number) || 3030;
    } catch { /* используем дефолт */ }
  }

  const openBrowser = !flags['no-open'] && !flags.nopen;

  // VL-189: как у бота — .env/settings-env читаются при старте, иначе spawn
  // фаз наследует process.env без VIBELOG_LLM_* и агент падает с
  // «не задан VIBELOG_LLM_API_KEY» (общий хелпер loadProjectEnv)
  loadProjectEnv(cwd);

  return startWebServer(cwd, port, openBrowser);
}
