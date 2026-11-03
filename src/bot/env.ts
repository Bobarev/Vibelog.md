/**
 * Автозагрузка .env для Telegram-бота (VL-37).
 *
 * Зачем: токен и прокси хранятся в .env корня проекта, но запускать бота
 * с `node --env-file=.env` неудобно — команда `vibelog bot` загружает
 * .env сама. Поведение как у dotenv: реальное окружение-переменная
 * приоритетнее значения из файла; комментарии и пустые строки пропускаются.
 *
 * VL-329: `.env` — ЕДИНСТВЕННЫЙ файловый источник секретов. Секция `env`
 * в `.vibelog/settings.json` больше не читается (приоритет: shell env →
 * `.env`); старые проекты получают одноразовое предупреждение при старте.
 * Там же живут привязки Telegram-чатов (`TELEGRAM_CHAT_IDS`), потому что
 * settings.json коммитится в git, а chat_id — личная привязка человека.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerFileEnvKeys, fileLoadedEnvKeys, detectLegacyEnvSection } from '../core/settings.js';
import { upsertDotEnv, parseChatIds, TELEGRAM_CHAT_IDS_KEY } from '../core/env-file.js';

// Re-export по плану VL-143: набор файловых ключей удобно брать из env.js
export { fileLoadedEnvKeys };
// VL-329: парсер списка chat_id и имя ключа живут в core/env-file.ts —
// их использует и ядро wizard-а (core/setup.ts), которому нельзя зависеть от bot/
export { parseChatIds, TELEGRAM_CHAT_IDS_KEY };

/**
 * Читает <cwd>/.env и записывает пары KEY=VALUE в process.env.
 *
 * Уже заданные переменные окружения НЕ перезаписываются (стандарт dotenv).
 * Каждый реально записанный ключ регистрируется как «файловый»
 * (VL-143): spawnReplacementBot спавнит замещающий процесс бота без таких
 * ключей, чтобы дочерний процесс перечитал .env свежо — иначе старые значения
 * из process.env родителя (их записал этот loadDotEnv) навсегда перекрывали
 * бы обновлённый файл (баг рестарта VL-143).
 *
 * @param cwd — директория проекта (где лежит .env)
 */
export function loadDotEnv(cwd: string): void {
  const path = join(cwd, '.env');
  if (!existsSync(path)) return;

  const lines = readFileSync(path, 'utf-8').split('\n');
  const written: string[] = [];
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Поддержка синтаксиса `export KEY=value`
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim();

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Снимаем окружающие кавычки
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    // Учёт только реально записанных ключей: не заданные в shell-окружении
    // не трогаются (их файловые значения не существуют — перекрывать нечего)
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      written.push(key);
    }
  }
  registerFileEnvKeys(written);
}

/** Признак «предупреждение о legacy-секции env уже напечатано» (VL-329). */
let legacyEnvWarned = false;

/**
 * Общая загрузка env проекта (VL-189): только `.env`.
 *
 * Единая точка входа для всех режимов, которым нужен env проекта при
 * старте: бот (`vibelog bot`), веб-интерфейс (`vibelog browser`) и CLI
 * агента (`vibelog agent`, включая `analyze`). Раньше пара вызовов
 * loadDotEnv + applySettingsEnv дублировалась в боте и чате и ОТСУТСТВОВАЛА
 * в браузере (баг VL-189): spawn фаз из browser шёл без VIBELOG_LLM_* из
 * .env и агент падал с «не задан VIBELOG_LLM_API_KEY».
 *
 * VL-329: секция `env` settings.json больше не читается — приоритет
 * «shell env → .env». Если в settings.json осталась непустая секция `env`,
 * печатаем ОДНО предупреждение за процесс (не падаем: старый проект должен
 * работать, просто без этих ключей).
 *
 * Вызов идемпотентен — повторная загрузка (например, runAgent +
 * runInteractiveAgent) ничего не перезаписывает (dotenv-семантика).
 *
 * @param cwd — директория проекта (там же лежит .env)
 */
export function loadProjectEnv(cwd: string): void {
  loadDotEnv(cwd);
  if (!legacyEnvWarned && detectLegacyEnvSection(cwd)) {
    legacyEnvWarned = true;
    console.error(
      '[vibelog] секция env в .vibelog/settings.json больше не читается — ' +
        'перенесите ключи в .env (файл в корне проекта, не коммитится)',
    );
  }
}

/**
 * Привязанные чаты бота из окружения (VL-329).
 *
 * Читает `process.env.TELEGRAM_CHAT_IDS` (его наполняет loadProjectEnv из
 * `.env`). Битое значение не роняет бота: невалидные элементы отбрасываются,
 * а при полностью нечитаемом значении печатается предупреждение — иначе
 * «бот не отвечает» выглядело бы как загадка.
 *
 * @returns список chat_id (пустой — бот ни к одному чату не привязан)
 */
export function readBotChats(): number[] {
  const raw = process.env[TELEGRAM_CHAT_IDS_KEY];
  const ids = parseChatIds(raw);
  if (raw !== undefined && raw.trim() !== '' && ids.length === 0) {
    console.error(
      `[vibelog] ${TELEGRAM_CHAT_IDS_KEY}: ожидается список id через запятую, получено ${JSON.stringify(raw)} — привязок нет`,
    );
  }
  return ids;
}

/**
 * Дописывает/обновляет `TELEGRAM_CHAT_IDS` в `.env` (VL-329).
 *
 * Используется авто-binding-ом при `/start`: chat_id — личная привязка,
 * её место рядом с токеном бота, а не в коммитимом settings.json.
 * Реализация upsert-а живёт в core/env-file.ts (атомарная запись,
 * сохранение комментариев и прочих переменных).
 *
 * @returns true, если файл изменён
 */
export function saveBotChats(cwd: string, ids: number[]): boolean {
  return upsertDotEnv(cwd, TELEGRAM_CHAT_IDS_KEY, ids.join(','), { overwrite: true });
}
