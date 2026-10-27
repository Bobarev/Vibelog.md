/**
 * Команда `vibelog bot` — Telegram-бот на grammy (VL-34).
 *
 * Запускает long-polling процесс: генерирует пин-код привязки (печатается
 * только в консоль), регистрирует обработчики команд, слушает Telegram API.
 */

import { Bot } from 'grammy';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { resolveProxy, resolveToken } from '../../bot/settings.js';
import { loadProjectEnv } from '../../bot/env.js';
import { generatePin } from '../../bot/pin.js';
import { registerHandlers } from '../../bot/handlers.js';
import { syncCommands } from '../../bot/registry.js';
import { recoverStalePhaseStatuses } from '../../core/phase-transient.js';

/**
 * Выполняет команду bot.
 *
 * @param _positional — позиционные аргументы (не используются)
 * @param _flags — флаги (не используются)
 * @param cwd — рабочая директория проекта (backlog/ и .vibelog/ ищутся отсюда)
 */
export async function runBot(
  _positional: string[],
  _flags: Record<string, unknown>,
  cwd: string
): Promise<void> {
  // .env корня проекта + секция env settings.json загружаются сами — запуск
  // просто "vibelog bot", без node --env-file (VL-37, просьба Pavel);
  // общий хелпер loadProjectEnv (VL-189) — тот же код в браузере и чате
  loadProjectEnv(cwd);
  // VL-196: recovery «зависших» транзиентных In Progress после рестарта
  // процесса (AC3) — бот так же долго живёт и запускает фазы, как и веб
  try {
    recoverStalePhaseStatuses(cwd);
  } catch (err) {
    console.log(`[phase-transient] recovery при старте бота не удалась: ${(err as Error).message}`);
  }
  const token = resolveToken(cwd);
  if (!token) {
    console.error(
      'Токен Telegram-бота не найден. Задайте TELEGRAM_BOT_TOKEN в .env или в секции env .vibelog/settings.json'
    );
    return;
  }

  const pin = generatePin();
  console.log(`Код привязки: ${pin}`);
  console.log('Введите его в Telegram командой /start. Ctrl+C — остановить бота.');

  // Прокси нужен там, где api.telegram.org заблокирован напрямую
  // (VL-37): Node fetch и grammy системный прокси macOS не читают.
  const proxy = resolveProxy(cwd);
  // Каст через any: типы Request/Headers у grammy (shim) и undici несовместимы
  // на уровне итераторов, runtime-контракт fetch — полная совместимость
  const bot = proxy
    ? new Bot(token, {
        client: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fetch: ((input: any, init?: any) =>
            undiciFetch(input, { ...init, dispatcher: new ProxyAgent(proxy) })) as any,
        },
      })
    : new Bot(token);
  if (proxy) console.log('Прокси:', proxy);
  registerHandlers(bot, { cwd, getPin: () => pin });
  // Меню команд в Telegram: ошибки API логируются, polling продолжается (VL-54)
  await syncCommands(bot);

  bot.catch((err) => {
    // grammy переживает сетевые сбои polling сам; логируем для диагностики
    console.error('Ошибка бота:', err.message);
  });

  try {
    // Long polling; grammy автоматически переподключается при сбоях сети
    await bot.start();
  } catch (err) {
    // Невалидный токен / нет сети — понятная ошибка вместо стектрейса
    console.error('Бот не запустился:', err instanceof Error ? err.message : String(err));
  }
}
