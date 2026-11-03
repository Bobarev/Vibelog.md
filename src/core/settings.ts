/**
 * Единый файл настроек проекта `.vibelog/settings.json` (VL-143).
 *
 * До VL-143 настройки были разнесены по двум YAML-файлам: `.vibelog/bot.yml`
 * (Telegram-бот) и `.vibelog/settings.yml` (кэш git user.name). Теперь —
 * один JSON-файл:
 *
 * - несекретные настройки — топ-уровневые snake_case-ключи (совместимость
 *   с прежним bot.yml — минимальные изменения для пользователей и docs);
 * - SECRETS — только `.env` в корне проекта и реальное окружение (VL-329):
 *   приоритет «shell env → .env». Секция `env` в settings.json больше НЕ
 *   читается (старые проекты получают одноразовое предупреждение, см.
 *   detectLegacyEnvSection) и не пишется — settings.json коммитится в git;
 * - личные привязки (chat_id бота) — тоже `.env` (TELEGRAM_CHAT_IDS, VL-329);
 * - legacy-файлы bot.yml/settings.yml мигрируются лениво при первом чтении
 *   отсутствующего settings.json и удаляются ТОЛЬКО после успешной записи
 *   и контрольного перечитывания (риск-параграф плана VL-143).
 *
 * Файл лежит в `.vibelog/` и коммитится в git (VL-329): секретов в нём
 * не остаётся.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml } from './yaml.js';
import { upsertDotEnv } from './env-file.js';

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
  /** Секреты из bot.yml — переезжают в `.env` (VL-329), не в settings.json. */
  const secrets: Record<string, string> = {};
  /** Привязки чатов из bot.yml — тоже в `.env` (VL-329). */
  let chats: number[] = [];
  for (const [key, value] of Object.entries(bot)) {
    // Секреты — только в .env; топ-уровневые telegram_* больше не читаются
    if (key === 'telegram_token') {
      if (typeof value === 'string' && value !== '') secrets.TELEGRAM_BOT_TOKEN = value;
      continue;
    }
    if (key === 'telegram_proxy') {
      if (typeof value === 'string' && value !== '') secrets.TELEGRAM_PROXY = value;
      continue;
    }
    // VL-329: chat_id — личная привязка, ей место рядом с токеном в .env
    if (key === 'chats') {
      if (Array.isArray(value)) {
        chats = value.map(Number).filter((n) => Number.isFinite(n));
      }
      continue;
    }
    out[key] = value;
  }
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

  // Секреты и чаты — в .env. Существующие значения .env не перезаписываем
  // (пользователь мог задать их вручную свежее, чем старый bot.yml).
  // Если запись в .env не удалась — legacy bot.yml НЕ удаляем: там остался
  // единственный экземпляр токена, и «потерять» его нельзя (fail-safe).
  let envWriteOk = true;
  if (chats.length > 0) {
    try {
      upsertDotEnv(cwd, 'TELEGRAM_CHAT_IDS', chats.join(','));
    } catch {
      envWriteOk = false;
    }
  }
  for (const [key, value] of Object.entries(secrets)) {
    try {
      upsertDotEnv(cwd, key, value);
    } catch {
      envWriteOk = false;
    }
  }

  // Контроль пройден — legacy можно удалять (сбой удаления не критичен:
  // миграция идемпотентна, наличие legacy при существующем settings.json
  // игнорируется при чтении).
  // bot.yml удаляем только если секреты реально легли в .env (fail-safe:
  // единственный экземпляр токена не должен исчезнуть из-за ошибки записи).
  if (hasBot && !envWriteOk) return true;
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
 * Признак «старый проект с секцией `env` в settings.json» (VL-329).
 *
 * Секция `env` больше не читается: единственный источник секретов — `.env`
 * и реальное окружение. Но молча терять токены нельзя, поэтому при старте
 * (loadProjectEnv) печатается одноразовое предупреждение с просьбой перенести
 * ключи. Функция только читает файл — ничего не мигрирует автоматически:
 * settings.json мог быть скопирован в другой проект, и «умный» перенос мог бы
 * размножить чужие секреты.
 *
 * @returns true, если секция `env` есть и содержит хотя бы один ключ
 */
export function detectLegacyEnvSection(cwd: string): boolean {
  return Object.keys(readSettingsEnv(cwd)).length > 0;
}

/**
 * Ключи, записанные в process.env из `.env` — в отличие от переменных,
 * заданных в реальном shell-окружении. Нужны для фикса бага рестарта
 * (VL-143): `spawnReplacementBot` спавнит дочерний процесс без этих ключей,
 * чтобы тот перечитал `.env` и подхватил новые значения.
 *
 * VL-329: учитываются ТОЛЬКО ключи из `.env` — секция `env` settings.json
 * больше не читается.
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
 * @deprecated VL-329: секция `env` settings.json больше не читается —
 * секреты живут только в `.env` и реальном окружении. Функция оставлена
 * no-op ради внешних вызовов: пишет в stderr одноразовое предупреждение.
 *
 * @returns пустой набор (ничего не записано)
 */
export function applySettingsEnv(cwd: string): Set<string> {
  void cwd;
  return new Set<string>();
}
