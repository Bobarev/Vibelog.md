/**
 * Запись секретов wizard-а настройки проекта (VL-210).
 *
 * Секреты (API-ключи LLM, токен Telegram-бота) можно хранить в двух местах
 * (VL-143 — приоритет чтения: реальный env → .env → секция `env`
 * settings.json):
 *
 * - `.env` в корне проекта (gitignored) — рекомендуемый вариант;
 * - секция `env` в `.vibelog/settings.json` (тоже gitignored) — удобно,
 *   если .env в проекте не используется;
 * - оба — .env как основной источник, settings.json как fallback.
 *
 * Модуль намеренно НЕ пишет в process.env: wizard только сохраняет значения
 * на диск, а загрузка в окружение — задача loadProjectEnv (src/bot/env.ts)
 * при следующем запуске CLI/бота/веба.
 *
 * Значения секретов НИКОГДА не возвращаются наружу: результат содержит
 * только имена ключей (written/skipped) — иначе они попадут в лог wizard-а
 * и в отчёт фазы.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSettingsEnv, saveSettingsPatch } from './settings.js';

/** Куда писать секреты (шаг 3 wizard-а). */
export type SecretsLocation = 'env' | 'settings' | 'both';

/** Шапка нового .env — объясняет, что файл не коммитится. */
const ENV_HEADER = [
  '# Vibelog: секреты проекта (не коммитить — .env в .gitignore)',
  '# Формат: KEY=value, по одному на строку. Приоритет: env → .env → settings.json env.',
].join('\n');

/**
 * Читает `.env` проекта как пары ключ→значение (без побочных эффектов).
 *
 * Парсер повторяет правила loadDotEnv (src/bot/env.ts): комментарии и пустые
 * строки пропускаются, поддерживается `export KEY=value`, снимаются
 * окружающие кавычки. В отличие от loadDotEnv значения НЕ пишутся в
 * process.env — wizard-у нужен только состав ключей и текущие значения.
 *
 * @param cwd — директория проекта
 * @returns пары ключ→значение; отсутствие файла → {}
 */
export function readEnvFile(cwd: string): Record<string, string> {
  const path = join(cwd, '.env');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    // Нечитаемый .env не должен ронять wizard — считаем пустым
    return {};
  }
  for (const line of content.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Значение для .env: значения с пробелами/кавычками/решёткой оборачиваются
 * в двойные кавычки, иначе парсер прочитает их неверно.
 */
function formatEnvValue(value: string): string {
  if (value === '') return '';
  if (/[\s"'#]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

/**
 * Дописывает секреты в `.env`, не перезаписывая существующие ключи.
 *
 * Файл создаётся с шапкой-комментарием, если его нет. Существующие ключи
 * остаются как есть (в skipped) — wizard не должен молча менять рабочий
 * ключ пользователя; явная перезапись — только через --force на уровне
 * вызывающего кода (он передаёт новое значение под другим ключом либо
 * удаляет строку вручную).
 *
 * @returns written — имена дописанных ключей, skipped — уже существовавших
 */
function writeEnvFile(
  cwd: string,
  secrets: Record<string, string>,
): { written: string[]; skipped: string[] } {
  const path = join(cwd, '.env');
  const existing = readEnvFile(cwd);
  const written: string[] = [];
  const skipped: string[] = [];
  const lines: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    if (key === '') continue;
    if (existing[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    lines.push(`${key}=${formatEnvValue(value)}`);
    written.push(key);
  }

  if (lines.length === 0) return { written, skipped };

  let content = '';
  if (existsSync(path)) {
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      content = '';
    }
  } else {
    content = `${ENV_HEADER}\n`;
  }
  // Гарантируем перевод строки перед дописыванием (файл мог не заканчиваться им)
  if (content !== '' && !content.endsWith('\n')) content += '\n';
  content += `${lines.join('\n')}\n`;
  writeFileSync(path, content, 'utf-8');
  return { written, skipped };
}

/**
 * Сохраняет секреты в выбранное место.
 *
 * @param cwd — директория проекта
 * @param secrets — пары ключ→значение (пустые значения игнорируются)
 * @param loc — .env | settings.json env | оба
 * @returns имена записанных и пропущенных (уже существующих) ключей
 */
export function writeSecrets(
  cwd: string,
  secrets: Record<string, string>,
  loc: SecretsLocation,
): { written: string[]; skipped: string[] } {
  // Пустые значения не пишем: пустой ключ в .env сломал бы приоритет
  // (loadDotEnv записал бы пустую строку в process.env и перекрыл settings.json)
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (key !== '' && typeof value === 'string' && value !== '') clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { written: [], skipped: [] };

  const written: string[] = [];
  const skipped: string[] = [];

  if (loc === 'env' || loc === 'both') {
    const res = writeEnvFile(cwd, clean);
    written.push(...res.written);
    skipped.push(...res.skipped);
  }

  if (loc === 'settings' || loc === 'both') {
    const current = readSettingsEnv(cwd);
    const next: Record<string, string> = { ...current };
    for (const [key, value] of Object.entries(clean)) {
      if (current[key] !== undefined) {
        // В режиме both ключ уже мог быть записан в .env — это не «пропуск»,
        // а штатное дублирование (fallback VL-143)
        if (!skipped.includes(key) && loc === 'settings') skipped.push(key);
        continue;
      }
      next[key] = value;
      if (!written.includes(key)) written.push(key);
    }
    saveSettingsPatch(cwd, { env: next });
  }

  return { written, skipped };
}
