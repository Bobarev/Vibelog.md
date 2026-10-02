/**
 * Настройки Telegram-бота (VL-34).
 *
 * Хранятся в .vibelog/bot.yml (gitignored) — отдельно от backlog/config.yml:
 * (1) токен не должен коммититься в git, (2) config.yml остаётся совместимым
 * с Backlog.md: оригинал читает конфиг switch-ом по известным ключам и
 * вычищает неизвестные поля при записи (saveConfig) — хранить токен там нельзя.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml, stringifyYaml } from '../core/yaml.js';

/** Настройки бота: токен, прокси (приоритет у env) и привязанные чаты. */
export interface BotSettings {
  telegram_token?: string;
  telegram_proxy?: string;
  chats: number[];
}

/** Путь к файлу настроек бота в директории проекта. */
export function botSettingsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'bot.yml');
}

/** Читает настройки бота; отсутствующий файл → пустые настройки. */
export function loadBotSettings(cwd: string): BotSettings {
  const path = botSettingsPath(cwd);
  if (!existsSync(path)) return { chats: [] };
  const raw = parseYaml(readFileSync(path, 'utf-8'));
  const chats = Array.isArray(raw.chats) ? raw.chats : [];
  return {
    telegram_token: typeof raw.telegram_token === 'string' ? raw.telegram_token : undefined,
    telegram_proxy: typeof raw.telegram_proxy === 'string' ? raw.telegram_proxy : undefined,
    chats: chats.map(Number).filter((n) => Number.isFinite(n)),
  };
}

/** Сохраняет настройки бота (создаёт .vibelog/ при необходимости). */
export function saveBotSettings(cwd: string, settings: BotSettings): void {
  const path = botSettingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  // Явный payload: BotSettings — интерфейс без index signature,
  // прямое приведение к Record<string, unknown> TS отклоняет
  const payload: Record<string, unknown> = {
    ...(settings.telegram_token ? { telegram_token: settings.telegram_token } : {}),
    ...(settings.telegram_proxy ? { telegram_proxy: settings.telegram_proxy } : {}),
    chats: settings.chats,
  };
  writeFileSync(path, stringifyYaml(payload), 'utf-8');
}

/**
 * Разрешает токен бота: env TELEGRAM_BOT_TOKEN → .vibelog/bot.yml.
 *
 * @returns токен или null, если нигде не задан
 */
export function resolveToken(cwd: string): string | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;
  return loadBotSettings(cwd).telegram_token ?? null;
}

/**
 * Разрешает прокси для Telegram API: env TELEGRAM_PROXY → .vibelog/bot.yml.
 *
 * Нужен там, где api.telegram.org заблокирован напрямую (например, системный
 * прокси macOS на 127.0.0.1:7070): Node fetch и grammy системный прокси не
 * читают сами. Формат URL: http://host:port.
 *
 * @returns URL прокси или null, если прокси не задан
 */
export function resolveProxy(cwd: string): string | null {
  const envProxy = process.env.TELEGRAM_PROXY;
  if (envProxy) return envProxy;
  return loadBotSettings(cwd).telegram_proxy ?? null;
}
