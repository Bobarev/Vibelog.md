/**
 * Автозагрузка .env для Telegram-бота (VL-37).
 *
 * Зачем: токен и прокси хранятся в .env корня проекта, но запускать бота
 * с `node --env-file=.env` неудобно — команда `vibelog bot` загружает
 * .env сама. Поведение как у dotenv: реальная окружение-переменная
 * приоритетнее значения из файла; комментарии и пустые строки пропускаются.
 *
 * VL-143: приоритет секретов — реальный env → .env → секция `env`
 * settings.json. Обе функции-загрузчика (loadDotEnv и applySettingsEnv)
 * записывают только пустые ключи, поэтому строгое порядок вызова
 * loadDotEnv → applySettingsEnv даёт .env приоритет над settings.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerFileEnvKeys, fileLoadedEnvKeys, applySettingsEnv } from '../core/settings.js';

// Re-export по плану VL-143: набор файловых ключей удобно брать из env.js
export { fileLoadedEnvKeys };

/**
 * Читает <cwd>/.env и записывает пары KEY=VALUE в process.env.
 *
 * Уже заданные переменные окружения НЕ перезаписываются (стандарт dotenv).
 * Каждый реально записанный ключ регистрируется как «файловый»
 * (VL-143): spawnReplacementBot спавнит замещающий процесс бота без таких
 * ключей, чтобы дочерний процесс перечитал .env/settings.json свежо —
 * иначе старые значения из process.env родителя (их записал этот loadDotEnv)
 * навсегда перекрывали бы обновлённый файл (баг рестарта VL-143).
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

/**
 * Общая загрузка env проекта (VL-189): .env → секция `env` settings.json.
 *
 * Единая точка входа для всех режимов, которым нужен env проекта при
 * старте: бот (`vibelog bot`), веб-интерфейс (`vibelog browser`) и CLI
 * агента (`vibelog agent`, включая `analyze`). Раньше пара вызовов
 * loadDotEnv + applySettingsEnv дублировалась в боте и чате и ОТСУТСТВОВАЛА
 * в браузере (баг VL-189): spawn фаз из browser шёл без VIBELOG_LLM_* из
 * .env и агент падал с «не задан VIBELOG_LLM_API_KEY».
 *
 * Порядок критичен (VL-143): обе функции записывают только пустые ключи,
 * поэтому строгое чередование loadDotEnv → applySettingsEnv даёт приоритет
 * реальный env → .env → секция `env` settings.json. Вызов идемпотентен —
 * повторная загрузка (например, runAgent + runInteractiveAgent) ничего
 * не перезаписывает (dotenv-семантика).
 *
 * @param cwd — директория проекта (там же лежат .env и .vibelog/settings.json)
 */
export function loadProjectEnv(cwd: string): void {
  loadDotEnv(cwd);
  applySettingsEnv(cwd);
}
