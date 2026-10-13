/**
 * Настройки проекта Vibelog (VL-44).
 *
 * Хранятся в едином .vibelog/settings.json (VL-143, gitignored — как bot.yml
 * до унификации): git user.name — машинная настройка, не должен коммититься
 * в git и не должен спавнить git-процесс при каждом комментарии
 * (VL-35 вызывал getGitUserName на каждый addComment). Кэш заполняется при
 * `vibelog init` и `init --force`.
 *
 * Отдельно от backlog/config.yml: тот совместим с Backlog.md, сюда мы
 * сознательно кладём внутренние кэши Vibelog. Бэкенд — общий core-модуль
 * settings.js (общий файл с настройками бота, env-секция и legacy-миграция).
 */

import { getGitUserName } from './git.js';
import { loadSettings, saveSettingsPatch, settingsPath } from './settings.js';

/** Настройки проекта: сейчас — только кэш git user.name. */
export interface ProjectSettings {
  git_user_name?: string;
}

/** Путь к файлу настроек проекта (общий settings.json, VL-143). */
export function projectSettingsPath(cwd: string): string {
  return settingsPath(cwd);
}

/**
 * Читает настройки проекта.
 *
 * Отсутствующий файл или битый JSON → пустые настройки: кэш не должен
 * ронять addComment при любых проблемах с файлом (регрессия VL-35).
 */
export function loadProjectSettings(cwd: string): ProjectSettings {
  const name = loadSettings(cwd).git_user_name;
  // Не строка (нет файла/ключа, битый JSON) → пустой объект, как раньше
  // при отсутствии settings.yml — deepEqual-тесты ожидают {}
  return typeof name === 'string' ? { git_user_name: name } : {};
}

/** Сохраняет настройки проекта (создаёт .vibelog/ при необходимости). */
export function saveProjectSettings(cwd: string, settings: ProjectSettings): void {
  // Явный патч: ProjectSettings — интерфейс без index signature,
  // прямое приведение к Record<string, unknown> TS отклоняет.
  // saveSettingsPatch — read-modify-write: бот-поля и env-секция сохраняются
  saveSettingsPatch(cwd, {
    git_user_name: settings.git_user_name ? settings.git_user_name : undefined,
  });
}

/**
 * Резолвит автора комментария: кэш git_user_name из .vibelog/settings.json
 * приоритетнее, чем спавн git-процесса.
 *
 * @param cwd — директория проекта
 * @param env — окружение для fallback-вызова git (в тестах — изоляция)
 * @returns имя автора или '@agent', если git недоступен
 */
export function resolveGitUserName(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const cached = loadProjectSettings(cwd).git_user_name;
  if (cached && cached.trim() !== '') return cached.trim();
  // Fallback: текущее поведение без регрессий (git config каскад → '@agent')
  return getGitUserName(cwd, env);
}
