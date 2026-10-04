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
  /** Маппинг «тип задачи → стиль кнопки» rich-вывода /tasks (VL-82). */
  task_type_styles?: Record<string, string>;
}

/**
 * Стили кнопок, поддерживаемые Telegram Rich Messages (VL-82).
 * Больше значений нет — API отклонит или покажет дефолтный стиль.
 */
export const VALID_TASK_STYLES = ['danger', 'success', 'primary', 'link'];

/**
 * Дефолтный маппинг «тип задачи → стиль кнопки» (VL-82).
 * В bot.yml не записывается — пользователь переопределяет только нужное,
 * дефолты живут в коде (иначе файл засоряется при каждом save).
 */
export const DEFAULT_TASK_TYPE_STYLES: Record<string, string> = {
  bug: 'danger',
  feature: 'success',
  enhancement: 'primary',
  epic: 'primary',
};

/**
 * Извлекает пользовательские стили типов задач из YAML-значения (VL-82).
 *
 * Принимает только объект string→string; нестроки и стили вне
 * VALID_TASK_STYLES отбрасываются — в bot.yml не должны жить значения,
 * которые Telegram отклонит.
 */
function extractTaskTypeStyles(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [type, style] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof style === 'string' && VALID_TASK_STYLES.includes(style)) out[type] = style;
  }
  return out;
}

/** Путь к файлу настроек бота в директории проекта. */
export function botSettingsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'bot.yml');
}

/** Читает настройки бота; отсутствующий файл → пустые настройки + дефолты стилей. */
export function loadBotSettings(cwd: string): BotSettings {
  const path = botSettingsPath(cwd);
  if (!existsSync(path)) {
    return { chats: [], task_type_styles: { ...DEFAULT_TASK_TYPE_STYLES } };
  }
  const raw = parseYaml(readFileSync(path, 'utf-8'));
  const chats = Array.isArray(raw.chats) ? raw.chats : [];
  return {
    telegram_token: typeof raw.telegram_token === 'string' ? raw.telegram_token : undefined,
    telegram_proxy: typeof raw.telegram_proxy === 'string' ? raw.telegram_proxy : undefined,
    chats: chats.map(Number).filter((n) => Number.isFinite(n)),
    // Пользовательские записи перекрывают дефолты; поле всегда объект —
    // handlers не пишет ?? {} (VL-82)
    task_type_styles: { ...DEFAULT_TASK_TYPE_STYLES, ...extractTaskTypeStyles(raw.task_type_styles) },
  };
}

/** Сохраняет настройки бота (создаёт .vibelog/ при необходимости). */
export function saveBotSettings(cwd: string, settings: BotSettings): void {
  const path = botSettingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  // task_type_styles пишем только валидные пользовательские переопределения
  // (VL-82): дефолты в bot.yml не записываем — файл не засоряется
  const userStyles = extractTaskTypeStyles(settings.task_type_styles);
  // Явный payload: BotSettings — интерфейс без index signature,
  // прямое приведение к Record<string, unknown> TS отклоняет
  const payload: Record<string, unknown> = {
    ...(settings.telegram_token ? { telegram_token: settings.telegram_token } : {}),
    ...(settings.telegram_proxy ? { telegram_proxy: settings.telegram_proxy } : {}),
    chats: settings.chats,
    ...(Object.keys(userStyles).length > 0 ? { task_type_styles: userStyles } : {}),
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
