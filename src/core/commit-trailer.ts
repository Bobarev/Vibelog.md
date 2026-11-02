/**
 * Трейлер `Co-authored-by` в сообщениях коммитов (VL-302).
 *
 * Зачем: коммиты в проекте делает и framework (автокоммит файла задачи после
 * close, WIP-коммит прогресса фазы code), и сам агент по шагам шаблонов фаз
 * (`git commit -m "feat: ..."`). Чтобы в истории было видно, что коммит создан
 * агентом Vibelog, в сообщение добавляется трейлер `Co-authored-by` — отдельным
 * абзацем после пустой строки (формат git-трейлеров, его понимают GitHub,
 * GitVerse и `git log --format=%b`).
 *
 * Настройка: ключ `commit_coauthor` в `.vibelog/settings.json`. По умолчанию
 * ВКЛЮЧЕНО — отсутствие файла, ключа или битый JSON не должны молча выключать
 * функцию (паттерн lesson-117: битая настройка не отключает рабочий дефолт).
 * Выключение — только явное `false`.
 *
 * Модуль намеренно не зависит от bot/web: его импортируют и `src/agent/*`
 * (framework-коммиты), и `src/web/phase-prompt.ts` (подстановка в промпт).
 */

import { loadSettings } from './settings.js';

/** Строка трейлера — единый источник правды для кода и промптов. */
export const COMMIT_TRAILER = 'Co-authored-by: vibelog-agent <vb@xw2.ru>';

/**
 * Включён ли трейлер в настройках проекта.
 *
 * @param cwd — директория проекта (там, где лежит `.vibelog/settings.json`)
 * @returns false только при явном `commit_coauthor: false`; всё остальное
 *   (нет файла, нет ключа, битый JSON, мусор вроде `'no'`/`0`) → true
 */
export function resolveCommitCoauthor(cwd: string): boolean {
  return loadSettings(cwd).commit_coauthor !== false;
}

/**
 * Дописывает трейлер к сообщению коммита (чистая функция).
 *
 * Идемпотентность обязательна: framework амендит коммит, который агент уже
 * создал по шаблону с трейлером, — повторное добавление дало бы дубль.
 *
 * @param message — сообщение коммита (тема + тело)
 * @param enabled — включён ли трейлер (см. resolveCommitCoauthor)
 * @returns сообщение с трейлером отдельным абзацем либо без изменений
 */
export function appendCommitTrailer(message: string, enabled: boolean): string {
  const trimmed = message.trimEnd();
  if (!enabled) return trimmed;
  if (trimmed.includes(COMMIT_TRAILER)) return trimmed;
  return `${trimmed}\n\n${COMMIT_TRAILER}`;
}

/**
 * Готовые аргументы `git commit` с трейлером: `['-m', <сообщение>]`.
 *
 * Один `-m` с уже склеенным сообщением (а не два `-m`) — так трейлер
 * гарантированно идёт после пустой строки, независимо от того, есть ли у
 * сообщения собственное тело.
 *
 * @param cwd — директория проекта (для чтения настройки)
 * @param message — сообщение коммита
 */
export function commitMessageArgs(cwd: string, message: string): string[] {
  return ['-m', appendCommitTrailer(message, resolveCommitCoauthor(cwd))];
}
