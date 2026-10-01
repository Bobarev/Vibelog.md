/**
 * Команда `vibelog browser` — запуск веб-интерфейса.
 *
 * Поднимает HTTP-сервер на 127.0.0.1 и открывает канбан в браузере.
 */

import { getFlag } from '../args.mjs';
import { startWebServer } from '../../web/server.mjs';
import { loadConfig } from '../../core/config.js';

/**
 * Выполняет команду browser.
 *
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runBrowser(positional, flags, cwd) {
  let port = 3030;
  if (flags.port) {
    port = parseInt(String(flags.port), 10);
  } else {
    try {
      const config = loadConfig(cwd);
      port = config.default_port || 3030;
    } catch { /* используем дефолт */ }
  }

  const openBrowser = !flags['no-open'] && !flags.nopen;

  startWebServer(cwd, port, openBrowser);
}
