/**
 * Автозагрузка .env для Telegram-бота (VL-37).
 *
 * Зачем: токен и прокси хранятся в .env корня проекта, но запускать бота
 * с `node --env-file=.env` неудобно — команда `vibelog bot` загружает
 * .env сама. Поведение как у dotenv: реальная окружение-переменная
 * приоритетнее значения из файла; комментарии и пустые строки пропускаются.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Читает <cwd>/.env и записывает пары KEY=VALUE в process.env.
 *
 * Уже заданные переменные окружения НЕ перезаписываются (стандарт dotenv).
 *
 * @param cwd — директория проекта (где лежит .env)
 */
export function loadDotEnv(cwd: string): void {
  const path = join(cwd, '.env');
  if (!existsSync(path)) return;

  const lines = readFileSync(path, 'utf-8').split('\n');
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
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
