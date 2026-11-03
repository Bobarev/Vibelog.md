/**
 * Запись секретов wizard-а настройки проекта (VL-210, VL-324).
 *
 * Секреты (API-ключи LLM, токен Telegram-бота, прокси бота) можно хранить в
 * трёх местах (VL-143 — приоритет чтения: реальный env → .env → секция `env`
 * settings.json):
 *
 * - `system` (VL-324) — НИЧЕГО не писать: пользователь сам заводит
 *   переменные окружения (например в ~/.zshrc или через CI-secrets).
 *   Wizard только сообщает, какие имена ключей нужно завести;
 * - `.env` в корне проекта (gitignored) — рекомендуемый вариант;
 * - секция `env` в `.vibelog/settings.json` (тоже gitignored) — удобно,
 *   если .env в проекте не используется;
 * - оба — .env как основной источник, settings.json как fallback.
 *
 * Значение `'env'` сохраняет прежний смысл «писать в .env» (переименования
 * нет — на него завязаны флаги `--secrets-location env` и web-форма).
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

/**
 * Куда писать секреты (шаг 3 wizard-а).
 *
 * `system` — не писать никуда (переменные окружения заводит пользователь).
 */
export type SecretsLocation = 'system' | 'env' | 'settings' | 'both';

/** Все допустимые локации (валидация флагов и тела web-формы). */
export const SECRETS_LOCATIONS: SecretsLocation[] = ['system', 'env', 'settings', 'both'];

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
 * ключ пользователя. Явная перезапись — только по подтверждению
 * пользователя (`opts.overwrite`, VL-324): тогда строка ключа заменяется
 * на месте, а не дописывается второй раз (иначе парсер прочитал бы первое
 * значение и новый ключ «не применился»).
 *
 * @returns written — имена записанных ключей, skipped — уже существовавших
 */
function writeEnvFile(
  cwd: string,
  secrets: Record<string, string>,
  opts: { overwrite?: boolean } = {},
): { written: string[]; skipped: string[] } {
  const path = join(cwd, '.env');
  const existing = readEnvFile(cwd);
  const written: string[] = [];
  const skipped: string[] = [];
  const lines: string[] = [];
  /** Ключи, которые надо заменить в существующем содержимом. */
  const replace = new Map<string, string>();

  for (const [key, value] of Object.entries(secrets)) {
    if (key === '') continue;
    if (existing[key] !== undefined) {
      if (opts.overwrite !== true) {
        skipped.push(key);
        continue;
      }
      replace.set(key, value);
      written.push(key);
      continue;
    }
    lines.push(`${key}=${formatEnvValue(value)}`);
    written.push(key);
  }

  if (lines.length === 0 && replace.size === 0) return { written, skipped };

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

  // Замена существующих строк: идём по строкам и подменяем значение у
  // совпавшего ключа (учитывая `export ` и кавычки — их снимает readEnvFile).
  if (replace.size > 0) {
    const out: string[] = [];
    for (const line of content.split('\n')) {
      let trimmed = line.trim();
      const exported = trimmed.startsWith('export ');
      if (exported) trimmed = trimmed.slice(7).trim();
      const eq = trimmed.indexOf('=');
      const key = eq === -1 ? '' : trimmed.slice(0, eq).trim();
      if (key !== '' && replace.has(key)) {
        out.push(`${exported ? 'export ' : ''}${key}=${formatEnvValue(replace.get(key) as string)}`);
        replace.delete(key);
        continue;
      }
      out.push(line);
    }
    content = out.join('\n');
  }

  if (lines.length > 0) {
    // Гарантируем перевод строки перед дописыванием (файл мог не заканчиваться им)
    if (content !== '' && !content.endsWith('\n')) content += '\n';
    content += `${lines.join('\n')}\n`;
  }
  writeFileSync(path, content, 'utf-8');
  return { written, skipped };
}

/**
 * Сохраняет секреты в выбранное место.
 *
 * @param cwd — директория проекта
 * @param secrets — пары ключ→значение (пустые значения игнорируются)
 * @param loc — system (ничего не писать) | .env | settings.json env | оба
 * @param opts.overwrite — заменять существующие значения (по подтверждению
 *   пользователя, VL-324); без него существующие ключи попадают в skipped
 * @returns имена записанных и пропущенных (уже существующих) ключей
 */
export function writeSecrets(
  cwd: string,
  secrets: Record<string, string>,
  loc: SecretsLocation,
  opts: { overwrite?: boolean } = {},
): { written: string[]; skipped: string[] } {
  // Пустые значения не пишем: пустой ключ в .env сломал бы приоритет
  // (loadDotEnv записал бы пустую строку в process.env и перекрыл settings.json)
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    if (key !== '' && typeof value === 'string' && value !== '') clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { written: [], skipped: [] };

  // system: пользователь заводит переменные окружения сам — на диск не пишем
  // ничего (AC2). Имена ключей вызывающий код сообщает пользователю.
  if (loc === 'system') return { written: [], skipped: [] };

  const written: string[] = [];
  const skipped: string[] = [];

  if (loc === 'env' || loc === 'both') {
    const res = writeEnvFile(cwd, clean, opts);
    written.push(...res.written);
    skipped.push(...res.skipped);
  }

  if (loc === 'settings' || loc === 'both') {
    const current = readSettingsEnv(cwd);
    const next: Record<string, string> = { ...current };
    for (const [key, value] of Object.entries(clean)) {
      if (current[key] !== undefined) {
        if (opts.overwrite === true) {
          next[key] = value;
          if (!written.includes(key)) written.push(key);
          continue;
        }
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
