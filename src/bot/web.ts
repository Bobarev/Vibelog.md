/**
 * Запуск/остановка веб-интерфейса из бота — команда /web (VL-161).
 *
 * Сценарий: бот запущен из worktree (после /restart VL-N) — нужен способ
 * проверить веб-версию ветки прямо из чата: /web start поднимает
 * `vibelog browser` дочерним процессом, /web stop его гасит.
 *
 * CLI дочернего процесса по умолчанию — vibelogCliPath() от import.meta.url
 * ТЕКУЩЕГО процесса: после /restart VL-N бот исполняет worktree-dist, и веб
 * стартует из того же worktree (требование VL-161: «из окружения, в котором
 * сейчас запущен бот»). С аргументом /web start VL-N хендлер ensure+build'ит
 * worktree и передаёт worktreeCliPath — можно проверить ветку, не перезапуская
 * бота (паттерн /restart, handlers.ts).
 *
 * Состояние — модульный синглтон: два /web start из чата не должны плодить
 * параллельные серверы (паттерн activeRuns в web/orchestrator.ts).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { loadConfig } from '../core/config.js';

/** Текущий дочерний процесс веб-сервера (синглтон модуля). */
let webChild: ChildProcess | null = null;

/**
 * Ответ на /web в режиме `vb up` (VL-427, AC5): сервер работает в этом же
 * процессе — дочерний `browser` спавнить нельзя (второй сервер на том же
 * порту), а /web stop не может убить сервер: kill дочернего процесса здесь
 * неприменим.
 *
 * Порт берётся из маркера VIBELOG_UP_PORT (up пишет фактический порт после
 * listen), fallback — default_port из config; рассинхрон --port у up и конфига
 * задокументирован в doc-7.
 *
 * @param action — разобранное действие /web
 * @param cwd — рабочая директория проекта (config)
 * @param env — окружение (для тестов — явный объект вместо process.env)
 * @returns текст ответа или null, если режим up не активен
 */
export function upWebReply(
  action: 'start' | 'stop',
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.VIBELOG_UP !== '1') return null;
  if (action === 'stop') {
    return '⏹ Веб-сервер работает в режиме vb up (один процесс с ботом) — остановите его Ctrl+C в терминале';
  }
  let port = parseInt(env.VIBELOG_UP_PORT ?? '', 10);
  if (!Number.isFinite(port) || port <= 0) {
    try {
      port = (loadConfig(cwd).default_port as number) || 3030;
    } catch { port = 3030; }
  }
  return `🌐 Веб уже запущен в этом процессе: ${webServerUrl(port)}`;
}

/**
 * Разбирает аргументы /web: пусто/`start` → запуск; `start VL-N` → запуск
 * из worktree ветки; `stop` → остановка. ID нормализуется к верхнему регистру
 * (как parseRestartCommand в commands.ts).
 *
 * @param text — аргументы команды (без слова /web)
 */
export function parseWebCommand(
  text: string
): { action: 'start'; taskId?: string } | { action: 'stop' } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'start') return { action: 'start' };
  if (trimmed === 'stop') return { action: 'stop' };
  const withTask = /^start\s+(vl-\d+)$/i.exec(trimmed);
  if (withTask) return { action: 'start', taskId: withTask[1].toUpperCase() };
  return { error: 'Синтаксис: /web start [VL-N] | /web stop' };
}

/**
 * Запускает `vibelog browser` дочерним процессом и подменяет синглтон.
 *
 * Старый процесс (если жив) убивается первым — повторный /web start =
 * перезапуск, а не второй сервер. `--no-open`: бот стартует веб из чата,
 * автозапуск браузера на машине пользователя из фонового процесса не нужен
 * (URL шлём в чат).
 *
 * @param cwd — рабочая директория проекта (config, backlog/, .vibelog/)
 * @param cliPath — путь к bin/vibelog.mjs (корневой, текущего dist или worktree)
 * @param stdio — 'pipe' в проде/тестах: stdout парсится на URL для чата
 * @param port — порт (--port); без него сервер берёт default_port из config
 */
export function spawnWebServer(
  cwd: string,
  cliPath: string,
  stdio: 'pipe' | 'inherit' = 'pipe',
  port?: number
): ChildProcess {
  if (webChild && webChild.exitCode === null && !webChild.killed) {
    webChild.kill();
  }
  const args = [cliPath, 'browser', '--no-open'];
  if (port !== undefined) args.push('--port', String(port));
  const child = spawn(process.execPath, args, { cwd, stdio });
  webChild = child;
  return child;
}

/** Текущий дочерний процесс веб-сервера или null (для идемпотентных ответов). */
export function currentWebServer(): ChildProcess | null {
  return webChild;
}

/**
 * Останавливает веб-сервер: kill дочернего процесса + сброс синглтона.
 *
 * @returns true, если процесс был запущен и остановлен; false — не запущен
 */
export function stopWebServer(): boolean {
  if (!webChild) return false;
  webChild.kill();
  webChild = null;
  return true;
}

/** Сброс синглтона без kill — для тестов и обработки exit дочернего процесса. */
export function clearWebServer(): void {
  webChild = null;
}

/** URL веб-сервера для сообщения в чат. */
export function webServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
