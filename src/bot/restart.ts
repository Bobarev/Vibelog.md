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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileLoadedEnvKeys } from '../core/settings.js';

/**
 * Абсолютный путь к CLI vibelog (bin/vibelog.mjs) из dist/bot/restart.js.
 * bin/vibelog.mjs импортирует dist/ — новый процесс исполняет свежую сборку.
 *
 * Внимание (VL-151): резолв идёт от location ТЕКУЩЕГО процесса — если бот
 * запущен из worktree (`/restart VL-N`), путь указывает на worktree CLI,
 * и пустой `/restart` «застревает» в worktree. Для возврата в main используй
 * rootCliPath(cwd): корневой CLI резолвится от cwd процесса, который у
 * перезапущенного через `/restart VL-N` бота остаётся главным репозиторием.
 */
export function vibelogCliPath(): string {
  return fileURLToPath(new URL('../../bin/vibelog.mjs', import.meta.url));
}

/**
 * Путь корневого CLI от cwd процесса: join(cwd, 'bin', 'vibelog.mjs').
 *
 * В отличие от vibelogCliPath (резолв от import.meta.url — при запуске
 * из worktree указывает на worktree CLI, баг VL-151) детерминирован:
 * у бота, перезапущенного через /restart VL-N, cwd остаётся главным
 * репозиторием — /restart без аргументов возвращает в main dist.
 */
export function rootCliPath(cwd: string): string {
  return join(cwd, 'bin', 'vibelog.mjs');
}

/**
 * Окружение замещающего процесса по умолчанию (VL-143).
 *
 * `process.env` родителя минус «файловые» ключи — те, что записали loadDotEnv
 * и applySettingsEnv при старте родителя. Без стриппинга дочерний loadDotEnv
 * по dotenv-семантике не перезаписывал бы унаследованные СТАРЫЕ значения —
 * изменения .env/settings.json не применялись даже при рестарте (баг VL-143).
 * Ключи, реально заданные в shell-окружении, не регистрируются файловыми
 * и наследуются как есть.
 */
function defaultReplacementEnv(): NodeJS.ProcessEnv {
  const strip = fileLoadedEnvKeys();
  if (strip.size === 0) return { ...process.env };
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !strip.has(key)) env[key] = value;
  }
  return env;
}

/**
 * Запускает замещающий процесс `vibelog bot`.
 *
 * @param cwd — рабочая директория проекта (токен, backlog/, .vibelog/ ищутся отсюда)
 * @param stdio — 'inherit' в проде (пин в текущем терминале), 'pipe' в тестах
 * @param cliPath — путь к bin/vibelog.mjs; по умолчанию — корневой dist (VL-70).
 *   VL-107: /restart VL-N передаёт worktreeCliPath — новый процесс исполняет
 *   dist ветки vb/vl-N, но cwd остаётся главным (токен/backlog — общие)
 * @param env — VL-140: явный env замещающего процесса; по умолчанию — env
 *   родителя БЕЗ файловых ключей (.env / env-секция settings.json), чтобы
 *   дочерний процесс перечитал оба файла свежо (фикс бага рестарта VL-143).
 *   Тесты передают объект без TELEGRAM_BOT_TOKEN вместо глобального delete
 *   из process.env — иначе fileParallelism давал бы гонки между файлами тестов.
 * @returns дочерний процесс; событие 'spawn' — успех, 'error' — сбой запуска
 */
export function spawnReplacementBot(
  cwd: string,
  stdio: 'inherit' | 'pipe' = 'inherit',
  cliPath: string = vibelogCliPath(),
  env?: NodeJS.ProcessEnv
): ChildProcess {
  const child = spawn(process.execPath, [cliPath, 'bot'], {
    cwd,
    stdio,
    detached: true,
    // VL-143: дефолт — process.env минус файловые ключи (см. defaultReplacementEnv);
    // явный env используется в тестах и не стриппируется
    env: env ?? defaultReplacementEnv(),
  });
  child.unref();
  return child;
}
