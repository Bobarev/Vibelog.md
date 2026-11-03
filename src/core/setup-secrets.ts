/**
 * Запись секретов wizard-а настройки проекта (VL-210, VL-324, VL-329).
 *
 * Секреты (API-ключи LLM, токен Telegram-бота, прокси бота) после VL-329
 * живут в ДВУХ местах:
 *
 * - `system` (VL-324) — НИЧЕГО не писать: пользователь сам заводит
 *   переменные окружения (например в ~/.zshrc или через CI-secrets).
 *   Wizard только сообщает, какие имена ключей нужно завести;
 * - `.env` в корне проекта (gitignored) — рекомендуемый вариант.
 *
 * Секция `env` в `.vibelog/settings.json` больше НЕ поддерживается (VL-329):
 * settings.json коммитится в git (собственная политика `.vibelog/.gitignore`),
 * поэтому секретов в нём быть не должно. Значения `settings`/`both` в
 * `SECRETS_LOCATIONS` не входят, флаги и тела запросов с ними отвергаются.
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

/**
 * Куда писать секреты (шаг 3 wizard-а).
 *
 * `system` — не писать никуда (переменные окружения заводит пользователь).
 * VL-329: `settings`/`both` удалены — секция `env` в settings.json больше
 * не поддерживается.
 */
export type SecretsLocation = 'system' | 'env';

/** Все допустимые локации (валидация флагов и тела web-формы). */
export const SECRETS_LOCATIONS: SecretsLocation[] = ['system', 'env'];

/**
 * Локации, которые ПРЕДЛАГАЮТ wizard-ы (VL-328, AC5).
 *
 * VL-329: перечень совпадает с `SECRETS_LOCATIONS` — «принимаемые» и
 * «предлагаемые» схлопнулись, потому что секцию `env` settings.json убрали.
 * Один перечень для консольного wizard-а и веб-мастера `#/setup` (AC9) —
 * иначе фронты снова разъедутся.
 */
export const PROPOSED_SECRETS_LOCATIONS: ('system' | 'env')[] = ['system', 'env'];

/**
 * Подписи предлагаемых локаций (VL-328, AC5).
 *
 * Живут рядом с перечнем, чтобы консольный wizard и веб-мастер показывали
 * ОДИН текст: пользователь, настроивший проект в терминале, узнает те же
 * пункты в браузере. Формулировка «env (Приоритет: env → .env)» описывает не
 * место записи, а фактический порядок чтения (VL-143) — иначе кажется, что
 * пункт пишет в .env.
 */
export const SECRETS_LOCATION_LABELS: Record<'system' | 'env', string> = {
  system: 'env (Приоритет: env → .env)',
  env: '.env (файл в корне проекта)',
};

/** Шапка нового .env — объясняет, что файл не коммитится. */
const ENV_HEADER = [
  '# Vibelog: секреты проекта (не коммитить — .env в .gitignore)',
  '# Формат: KEY=value, по одному на строку. Приоритет: env → .env.',
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

  // VL-329: единственное место записи — .env (секция env settings.json убрана)
  return writeEnvFile(cwd, clean, opts);
}
