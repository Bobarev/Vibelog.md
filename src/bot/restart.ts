/**
 * Самоперезапуск Telegram-бота по команде /restart (VL-70).
 *
 * Сценарий: после pnpm build запущенный бот исполняет старый dist/.
 * Бот рестартует сам себя — останавливает polling и поднимает новый
 * `vibelog bot` в том же терминале. CLI `vibelog restart` с pid-файлом
 * отменён: он заменял только Ctrl+C (комментарий Pavel к VL-70).
 *
 * Ключевые свойства spawn:
 * - stdio: 'inherit' — stdout/stderr/stdin наследуются от текущего процесса,
 *   поэтому пин-код нового запуска печатается в терминале, где был запущен
 *   старый бот (пользователь видит его без переключения);
 * - detached: true + unref() — новый процесс в отдельной процесс-группе
 *   и не блокирует выход родителя: после process.exit(0) он продолжает жить.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Абсолютный путь к CLI vibelog (bin/vibelog.mjs) из dist/bot/restart.js.
 * bin/vibelog.mjs импортирует dist/ — новый процесс исполняет свежую сборку.
 */
export function vibelogCliPath(): string {
  return fileURLToPath(new URL('../../bin/vibelog.mjs', import.meta.url));
}

/**
 * Запускает замещающий процесс `vibelog bot`.
 *
 * @param cwd — рабочая директория проекта (токен, backlog/, .vibelog/ ищутся отсюда)
 * @param stdio — 'inherit' в проде (пин в текущем терминале), 'pipe' в тестах
 * @returns дочерний процесс; событие 'spawn' — успех, 'error' — сбой запуска
 */
export function spawnReplacementBot(cwd: string, stdio: 'inherit' | 'pipe' = 'inherit'): ChildProcess {
  const child = spawn(process.execPath, [vibelogCliPath(), 'bot'], {
    cwd,
    stdio,
    detached: true,
  });
  child.unref();
  return child;
}
