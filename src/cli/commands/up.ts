/**
 * Команда `vb up` (VL-427) — веб-интерфейс и Telegram-бот в ОДНОМ процессе.
 *
 * Зачем: пользователь держит 3–4 проекта и вынужден открывать по 2 вкладки
 * терминала на проект (vb bot + vb browser) = 6–8 вкладок. `vb up` запускает
 * обе части одной командой.
 *
 * Техническая основа: long-polling grammy не блокирует event loop
 * (bot.start() асинхронен), веб — обычный HTTP-сервер; сосуществуют.
 *
 * Побочный плюс режима (AC4): в ОДНОМ процессе src/web/orchestrator.ts —
 * ОДИН activeRuns: фаза, запущенная из бота, видна веб-API с первой секунды,
 * а не только через файлы состояния (в двух процессах состояние делилось
 * только по файлам).
 *
 * Гарантии (AC3): сбой одной части не роняет другую —
 *   нет токена → runBot печатает ошибку и возвращается, веб живёт;
 *   занятый порт → сервер печатает ошибку и НЕ делает process.exit
 *   (режим up, см. server.ts), бот стартует отдельно.
 *
 * Маркеры режима (читают /web в handlers.ts и /restart в restart.ts):
 *   VIBELOG_UP='1'      — процесс запущен через up;
 *   VIBELOG_UP_PORT=... — фактический порт веб-части (для ответа /web).
 */

import type { Server } from 'node:http';
import type { FlagValues } from '../args.js';
import { loadConfig } from '../../core/config.js';
import { runBrowser } from './browser.js';
import { runBot } from './bot.js';

/** Сервер с меткой сбоя старта (её ставит обработчик error в server.ts). */
type ServerWithStartupError = Server & { startupError?: Error };

/**
 * Ждёт первое событие listening/error сервера.
 *
 * startWebServer возвращает сервер ДО фактического listen — без ожидания
 * «порт занят» напечатался бы уже после старта бота (и наоборот бот-ошибка
 * обогнала бы печать веба). Ошибка могла всплыть до наших подписок (server.ts
 * печатает её и фиксирует startupError при старте) — поэтому сначала
 * синхронно проверяем состояние сервера, и только потом подписываемся.
 *
 * @returns true — сервер слушает; false — listen упал
 */
function waitWebReady(server: Server): Promise<boolean> {
  const s = server as ServerWithStartupError;
  if (s.startupError) return Promise.resolve(false);
  if (server.listening) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    server.once('listening', () => resolve(true));
    server.once('error', () => resolve(false));
  });
}

/**
 * Выполняет команду up: веб-сервер первым, затем Telegram-бот.
 *
 * @param positional — позиционные аргументы (у веба не используются)
 * @param flags — флаги веб-части: port, host, no-open (ботовых флагов нет —
 *   токен по-прежнему из .env, как у команды bot)
 * @param cwd — рабочая директория проекта (backlog/ и .vibelog/ ищутся отсюда)
 */
export async function runUp(
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  // Единый маркер режима (AC5/AC6) — ДО запуска веба: обработчик error в
  // server.ts в режиме up не гасит процесс при занятом порте (AC3), а /web
  // и /restart читают тот же маркер в этом же процессе
  process.env.VIBELOG_UP = '1';

  // Порт для ответа /web — той же логикой, что в runBrowser; после
  // фактического listen уточняется ниже (эфемерный порт при --port 0)
  let port = 3030;
  if (flags.port) {
    port = parseInt(String(flags.port), 10);
  } else {
    try {
      port = (loadConfig(cwd).default_port as number) || 3030;
    } catch { /* дефолт */ }
  }
  process.env.VIBELOG_UP_PORT = String(port);

  // ── 1. Веб первым ──
  let server: Server | null = null;
  let webUp = false;
  try {
    server = await runBrowser(positional, flags, cwd);
    webUp = await waitWebReady(server);
  } catch (err) {
    console.error(
      `Веб-интерфейс не запустился: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (webUp && server) {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      port = addr.port;
      process.env.VIBELOG_UP_PORT = String(port);
    }
  } else {
    // Конкретную причину («Порт N уже занят…») уже напечатал server.ts —
    // здесь только фиксируем, что команда продолжает работу (AC3)
    console.error('Веб-интерфейс не поднялся — команда продолжает работу: бот стартует отдельно.');
  }

  // ── 2. Бот вторым ──
  // INVARIANT AC4: один процесс = один activeRuns (src/web/orchestrator.ts):
  // startTaskPhase бота пишет в тот же реестр, что и веб-API, — фаза из
  // чата видна на канбане с первой секунды (подтверждается ручной проверкой;
  // активировать ран из бота в юнит-тесте CLI непропорционально).
  // runBot сам печатает пин, грузит env (повторный loadProjectEnv идемпотентен)
  // и ловит свои ошибки внутри.
  await runBot(positional, flags, cwd);

  // ── 3. Итог: runBot возвращается ТОЛЬКО при раннем выходе (нет токена /
  // бот не запустился) — при успехе bot.start() держит процесс до Ctrl+C ──
  if (webUp) {
    console.error(
      `Веб-интерфейс работает на http://127.0.0.1:${port}; бот не запущен — подробности выше.`
    );
  } else {
    console.error('Бот не запущен, веб-интерфейс не поднялся — подробности выше.');
    process.exitCode = 1; // обе части легли — честный код выхода
  }
}
