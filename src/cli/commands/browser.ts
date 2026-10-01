/**
 * Команда `vibelog browser` — запуск веб-интерфейса.
 *
 * Поднимает HTTP-сервер на 127.0.0.1 и открывает канбан в браузере.
 */

import { startWebServer } from '../../web/server.js';
import { loadConfig } from '../../core/config.js';
import type { FlagValues } from '../args.js';

/**
 * Выполняет команду browser.
 */
export async function runBrowser(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
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

  startWebServer(cwd, port, openBrowser);
}
