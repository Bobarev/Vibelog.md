/**
 * Токен GitVerse и его маскирование (VL-380, выделено из `gitverse-issues.ts`).
 *
 * Зачем отдельно. Токен нужен ДВУМ клиентам — Issues-API (`gitverse-issues.ts`,
 * VL-363) и реестру компонентов (`registry-fetch.ts`): анонимные запросы
 * GitVerse жёстко лимитирует, и первый же реальный `vb install` упал на 429.
 * Импорт `registry-fetch` → `gitverse-issues` тянул бы за собой `upstream-git`,
 * `settings` и `config` (git-операции и настройки реестру не нужны), поэтому
 * авторизация вынесена в самостоятельный маленький модуль, а
 * `gitverse-issues.ts` реэкспортирует эти имена для совместимости.
 *
 * Инварианты:
 * - имя переменной зафиксировано (`GITVERSE_TOKEN`), новых имён не появляется;
 * - приоритет — shell env, затем `.env` (VL-329);
 * - токен никогда не печатается: наружу — только через `maskToken`.
 */

import { readEnvFile } from './setup-secrets.js';

/** Имя переменной `.env` с токеном GitVerse (зафиксировано, VL-363). */
export const GITVERSE_TOKEN_ENV = 'GITVERSE_TOKEN';

/**
 * Вырезает токен из произвольного текста.
 *
 * Токен может попасть в текст ошибки двумя путями: сервер вернул его в теле
 * (маловероятно, но бывает в эхе запроса) или мы сами вставили URL с query.
 * Маскирование — последняя линия: даже если кто-то забудет вызвать функцию,
 * текст уже прошёл через транспорт с `mask`.
 */
export function maskToken(text: string, token: string): string {
  if (!token || token.length < 4) return text;
  return text.split(token).join('***');
}

/** Откуда взят токен (для `--verbose` в `vb install`, VL-381). */
export type TokenSource = 'env' | 'file' | 'none';

/**
 * Читает токен вместе с источником.
 *
 * Отдельно от `readToken`: для диагностики 429 пользователю важно ЗНАТЬ, откуда
 * взят токен («из .env» или «из окружения») — иначе непонятно, куда вписывать
 * новый (VL-381).
 */
export function readTokenWithSource(
  cwd: string,
  envName: string = GITVERSE_TOKEN_ENV,
): { token: string; source: TokenSource } {
  const fromShell = process.env[envName];
  if (typeof fromShell === 'string' && fromShell.trim() !== '') {
    return { token: fromShell.trim(), source: 'env' };
  }
  const fromFile = readEnvFile(cwd)[envName];
  if (typeof fromFile === 'string' && fromFile.trim() !== '') {
    return { token: fromFile.trim(), source: 'file' };
  }
  return { token: '', source: 'none' };
}

/**
 * Читает токен: приоритет shell env → `.env` (VL-329).
 *
 * Используется `readEnvFile` из core, а не `loadDotEnv` из `bot/env.ts`:
 * последний пишет в `process.env` и тянет за собой bot-слой, которому в core
 * не место. Парсер тот же (комментарии, `export KEY=`, кавычки).
 */
export function readToken(cwd: string, envName: string = GITVERSE_TOKEN_ENV): string {
  return readTokenWithSource(cwd, envName).token;
}

/** Подсказка «как завести токен» — единый текст для CLI и MCP. */
export function tokenHint(envName: string = GITVERSE_TOKEN_ENV): string {
  return (
    `добавь ${envName}=<токен> в .env (создать: https://gitverse.ru/settings/tokens, ` +
    'права: Запись на репозиторий)'
  );
}
