/**
 * Настройки проекта Vibelog (VL-44).
 *
 * Хранятся в .vibelog/settings.yml (gitignored — как bot.yml): git user.name
 * — машинная настройка, не должен коммититься в git и не должен спавнить
 * git-процесс при каждом комментарии (VL-35 вызывал getGitUserName на каждый
 * addComment). Кэш заполняется при `vibelog init` и `init --force`.
 *
 * Отдельно от backlog/config.yml: тот совместим с Backlog.md, сюда мы
 * сознательно кладём внутренние кэши Vibelog.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYaml, stringifyYaml } from './yaml.js';
import { getGitUserName } from './git.js';

/** Настройки проекта: сейчас — только кэш git user.name. */
export interface ProjectSettings {
  git_user_name?: string;
}

/** Путь к файлу настроек проекта в директории проекта. */
export function projectSettingsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'settings.yml');
}

/**
 * Читает настройки проекта.
 *
 * Отсутствующий файл или битый YAML → пустые настройки: кэш не должен
 * ронять addComment при любых проблемах с файлом (регрессия VL-35).
 */
export function loadProjectSettings(cwd: string): ProjectSettings {
  const path = projectSettingsPath(cwd);
  if (!existsSync(path)) return {};
  try {
    const raw = parseYaml(readFileSync(path, 'utf-8'));
    return {
      git_user_name: typeof raw.git_user_name === 'string' ? raw.git_user_name : undefined,
    };
  } catch {
    return {};
  }
}

/** Сохраняет настройки проекта (создаёт .vibelog/ при необходимости). */
export function saveProjectSettings(cwd: string, settings: ProjectSettings): void {
  const path = projectSettingsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  // Явный payload: ProjectSettings — интерфейс без index signature,
  // прямое приведение к Record<string, unknown> TS отклоняет
  const payload: Record<string, unknown> = {
    ...(settings.git_user_name ? { git_user_name: settings.git_user_name } : {}),
  };
  writeFileSync(path, stringifyYaml(payload), 'utf-8');
}

/**
 * Резолвит автора комментария: кэш git_user_name из .vibelog/settings.yml
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
