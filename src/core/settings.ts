/**
 * Единый файл настроек проекта `.vibelog/settings.json` (VL-143).
 *
 * До VL-143 настройки были разнесены по двум YAML-файлам: `.vibelog/bot.yml`
 * (Telegram-бот) и `.vibelog/settings.yml` (кэш git user.name). Теперь —
 * один JSON-файл (секция `env` по образцу settings.json Qwen Code):
 *
 * - несекретные настройки — топ-уровневые snake_case-ключи (совместимость
 *   с прежним bot.yml — минимальные изменения для пользователей и docs);
 * - секреты (токены, API-ключи) — в секции `env`; переменная окружения
 *   и `.env` приоритетнее секции `env` (см. runBot: loadDotEnv →
 *   applySettingsEnv — обе функции записывают только пустые ключи);
 * - legacy-файлы bot.yml/settings.yml мигрируются лениво при первом чтении
 *   отсутствующего settings.json и удаляются ТОЛЬКО после успешной записи
 *   и контрольного перечитывания (риск-параграф плана VL-143).
 *
 * Файл лежит в gitignored `.vibelog/` — env-секция содержит секреты
 * и не должна коммититься.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml } from './yaml.js';

/**
 * Записывает объект в settings.json (создаёт .vibelog/ при необходимости).
 * Формат: JSON с отступом 2 + завершающий перевод строки.
 */
function writeSettingsFile(cwd: string, data: Record<string, unknown>): void {
  const path = settingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

/** Путь к единому файлу настроек в директории проекта. */
export function settingsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'settings.json');
}

/**
 * Читает settings.json как сырой объект.
 *
 * Отсутствие файла → ленивая миграция legacy-конфигурации (bot.yml +
 * settings.yml → settings.json); если и после неё файла нет — дефолты.
 * Битый JSON / массив / null → дефолты: настройки не должны ронять бота.
 */
export function loadSettings(cwd: string): Record<string, unknown> {
  const path = settingsPath(cwd);
  if (!existsSync(path)) {
    migrateLegacyConfig(cwd);
    if (!existsSync(path)) return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Мигрирует legacy-конфигурацию (.vibelog/bot.yml + .vibelog/settings.yml)
 * в единый settings.json (VL-143).
 *
 * Секреты bot.yml (`telegram_token`, `telegram_proxy`) переезжают в секцию
 * `env` (TELEGRAM_BOT_TOKEN / TELEGRAM_PROXY); остальные ключи копируются
 * как есть; `git_user_name` берётся из settings.yml.
 *
 * @returns true, если миграция записала settings.json
 *
 * Безопасность удаления: legacy-файлы удаляются ТОЛЬКО после успешной
 * записи settings.json и контрольного перечитывания (JSON.parse).
 * При сбое — старые файлы остаются, битый settings.json удаляется,
 * чтобы следующая загрузка повторила мигацию.
 */
export function migrateLegacyConfig(cwd: string): boolean {
  const target = settingsPath(cwd);
  // Уже мигрировано / файл создан вручную — не затираем
  if (existsSync(target)) return false;

  const botLegacy = join(cwd, '.vibelog', 'bot.yml');
  const projLegacy = join(cwd, '.vibelog', 'settings.yml');
  const hasBot = existsSync(botLegacy);
  const hasProj = existsSync(projLegacy);
  if (!hasBot && !hasProj) return false; // нечего мигрировать

  // Битый YAML не должен ронять миграцию: parseYaml может бросить —
  // тогда legacy-файл считается пустым (его содержимое нечитаемо)
  const readYaml = (p: string): Record<string, unknown> => {
    try {
      return parseYaml(readFileSync(p, 'utf-8'));
    } catch {
      return {};
    }
  };
  const bot = hasBot ? readYaml(botLegacy) : {};
  const proj = hasProj ? readYaml(projLegacy) : {};

  const out: Record<string, unknown> = {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(bot)) {
    // Секреты — только в env-секцию; топ-уровневые telegram_* больше не читаются
    if (key === 'telegram_token') {
      if (typeof value === 'string' && value !== '') env.TELEGRAM_BOT_TOKEN = value;
      continue;
    }
    if (key === 'telegram_proxy') {
      if (typeof value === 'string' && value !== '') env.TELEGRAM_PROXY = value;
      continue;
    }
    out[key] = value;
  }
  if (Object.keys(env).length > 0) out.env = env;
  if (typeof proj.git_user_name === 'string') out.git_user_name = proj.git_user_name;

  // Запись + контрольное перечитывание; при сбое — чистим битый вывод
  // и оставляем legacy-файлы (следующая загрузка повторит миграцию)
  try {
    writeSettingsFile(cwd, out);
    const check = JSON.parse(readFileSync(target, 'utf-8'));
    if (check === null || typeof check !== 'object' || Array.isArray(check)) {
      throw new Error('контрольное перечитывание не прошло');
    }
  } catch {
    try {
      unlinkSync(target);
    } catch {
      // файла может и не быть — тогда и чистить нечего
    }
    return false;
  }

  // Контроль пройден — legacy можно удалять (сбой удаления не критичен:
  // миграция идемпотентна, наличие legacy при существующем settings.json
  // игнорируется при чтении)
  if (hasBot) {
    try {
      unlinkSync(botLegacy);
    } catch {
      // уже удалён вручную — не ошибка
    }
  }
  if (hasProj) {
    try {
      unlinkSync(projLegacy);
    } catch {
      // уже удалён вручную — не ошибка
    }
  }
  return true;
}

/**
 * Read-modify-write патч settings.json: читает текущие настройки, применяет
 * патч и записывает обратно.
 *
 * Значение `undefined` в патче УДАЛЯЕТ ключ (нужно для сброса опций вроде
 * max_wall_time через /set). Ключи, не упомянутые в патче (env-секция,
 * git_user_name), сохраняются как есть — запись бот-полей не теряет секреты.
 */
export function saveSettingsPatch(cwd: string, patch: Record<string, unknown>): void {
  const next = { ...loadSettings(cwd) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  writeSettingsFile(cwd, next);
}

/**
 * Секция `env` settings.json: только строковые пары (битые значения
 * нестрокового типа отбрасываются).
 */
export function readSettingsEnv(cwd: string): Record<string, string> {
  const raw = loadSettings(cwd).env;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key !== '' && typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Ключи, записанные в process.env из ФАЙЛОВЫХ источников (.env и секция
 * `env` settings.json) — в отличие от переменных, заданных в реальном
 * shell-окружении. Нужны для фикса бага рестарта (VL-143):
 * `spawnReplacementBot` спавнит дочерний процесс без этих ключей, чтобы тот
 * перечитал .env/settings.json и подхватил новые значения.
 */
const fileEnvKeys = new Set<string>();

/** Регистрирует ключи, записанные в process.env из файлов. */
export function registerFileEnvKeys(keys: Iterable<string>): void {
  for (const key of keys) fileEnvKeys.add(key);
}

/** Только прочитаемый набор файловых ключей (для стриппинга при спавне). */
export function fileLoadedEnvKeys(): ReadonlySet<string> {
  return fileEnvKeys;
}

/**
 * Заполняет пустые ключи process.env из секции `env` settings.json
 * (приоритет: реальный env → .env → секция `env` — обе функции-загрузчика
 * ставят только пустые значения, поэтому порядок вызова loadDotEnv →
 * applySettingsEnv гарантирует приоритет .env).
 *
 * @returns ключи, реально записанные в process.env (записываются и в учёт
 *   файловых ключей — см. fileLoadedEnvKeys)
 */
export function applySettingsEnv(cwd: string): Set<string> {
  const written = new Set<string>();
  const section = readSettingsEnv(cwd);
  for (const [key, value] of Object.entries(section)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      written.add(key);
    }
  }
  registerFileEnvKeys(written);
  return written;
}
