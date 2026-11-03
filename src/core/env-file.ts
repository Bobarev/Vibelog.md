/**
 * Точечная запись в `.env` проекта (VL-329).
 *
 * Зачем отдельный модуль: `.env` — единственный источник секретов после
 * VL-329, и его правят сразу несколько мест (wizard, setup-ядро, авто-binding
 * Telegram-чата при `/start`, миграция legacy bot.yml). Всем им нужен один и
 * тот же upsert: заменить/дописать ОДНУ строку, сохранив остальные строки и
 * комментарии пользователя байт-в-байт.
 *
 * Риски (VL-329): файл содержит секреты, поэтому ошибка форматирования =
 * потеря ключей. Отсюда: (1) правка построчная, без пересборки содержимого;
 * (2) запись атомарная (временный файл + rename) — при сбое старый .env
 * остаётся целым; (3) при ошибке записи функция бросает исключение, а не
 * возвращает «тихий успех».
 *
 * Вынесено в core (а не в bot/env.ts), чтобы core/settings.ts мог мигрировать
 * legacy-секреты в `.env` без циклического импорта: bot/env.ts импортирует
 * core/settings.ts.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Ключ .env с привязанными chat_id бота (VL-329). */
export const TELEGRAM_CHAT_IDS_KEY = 'TELEGRAM_CHAT_IDS';

/**
 * Разбирает список chat_id из значения `TELEGRAM_CHAT_IDS` (VL-329).
 *
 * Формат: id через запятую, пробелы вокруг допускаются. Мусор (нечисло,
 * 0, отрицательное, дробное) отбрасывается; дубли схлопываются — иначе бот
 * дважды обработал бы одно сообщение.
 *
 * @param raw — строка из .env/окружения (может быть undefined)
 * @returns уникальные id в порядке появления
 */
export function parseChatIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') return [];
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n === 0) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Значение для .env: спецсимволы и пробелы → двойные кавычки. */
export function formatEnvValue(value: string): string {
  if (value === '') return '';
  if (/[\s"'#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

/** Ключ строки .env (с учётом синтаксиса `export KEY=value`); иначе null. */
function lineKey(line: string): { key: string; exported: boolean } | null {
  let trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const exported = trimmed.startsWith('export ');
  if (exported) trimmed = trimmed.slice(7).trim();
  const eq = trimmed.indexOf('=');
  if (eq === -1) return null;
  const key = trimmed.slice(0, eq).trim();
  return key === '' ? null : { key, exported };
}

/**
 * Вставляет или обновляет одну переменную в `.env` проекта.
 *
 * Поведение:
 * - ключ уже есть и `overwrite !== true` → файл не меняется, вернётся false
 *   (значения пользователя молча не перезаписываем);
 * - ключ есть и `overwrite === true` → заменяется ТОЛЬКО эта строка,
 *   префикс `export ` и позиция сохраняются;
 * - ключа нет → строка дописывается в конец файла;
 * - прочие строки и комментарии остаются байт-в-байт;
 * - запись атомарная: временный файл рядом + rename (сбой на любом шаге
 *   оставляет прежний .env нетронутым);
 * - после записи значение кладётся в `process.env` (VL-329: авто-binding
 *   чата должен immediately работать без перезапуска процесса).
 *
 * @param cwd — директория проекта (там лежит .env)
 * @param key — имя переменной
 * @param value — значение (форматируется при необходимости)
 * @param opts.overwrite — заменять существующее значение
 * @returns true, если файл был изменён
 */
export function upsertDotEnv(
  cwd: string,
  key: string,
  value: string,
  opts: { overwrite?: boolean } = {},
): boolean {
  const path = join(cwd, '.env');
  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf-8');

  const lines = content === '' ? [] : content.split('\n');
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    const parsed = lineKey(line);
    if (parsed !== null && parsed.key === key) {
      if (replaced) {
        // Дубль того же ключа: оставляем только одну строку — иначе парсер
        // прочитает первое (старое) значение, и запись «не применится».
        continue;
      }
      if (opts.overwrite !== true) {
        // Ключ уже задан — ничего не пишем и не трогаем остальное содержимое
        return false;
      }
      out.push(`${parsed.exported ? 'export ' : ''}${key}=${formatEnvValue(value)}`);
      replaced = true;
      continue;
    }
    out.push(line);
  }

  if (!replaced) {
    // Убираем хвостовую пустую строку, чтобы не копить пустые строки
    if (out.length > 0 && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${formatEnvValue(value)}`);
  }

  const next = `${out.join('\n')}\n`;
  // Атомарная запись: temp рядом с целевым файлом (тот же диск → rename
  // атомарен), при сбое temp убираем, .env остаётся прежним.
  const tmp = `${path}.vibelog-tmp`;
  try {
    writeFileSync(tmp, next, { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // временного файла может не быть — чистить нечего
    }
    throw new Error(`не удалось записать ${key} в .env: ${(err as Error).message}`);
  }

  process.env[key] = value;
  return true;
}
