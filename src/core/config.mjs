/**
 * Загрузка и сохранение конфига проекта Vibelog.md / Backlog.md.
 *
 * Конфиг хранится в YAML и содержит настройки проекта:
 * имя, префикс ID, статусы, метки, DoD и т.д.
 *
 * Файл конфига: `backlog/config.yml` или `backlog.config.yml`.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseYaml, stringifyYaml } from './yaml.mjs';
import { configPath, findBacklogDir } from './paths.mjs';

/**
 * Конфиг по умолчанию для нового проекта Vibelog.md.
 *
 * @param {string} projectName — имя проекта
 * @param {string} prefix — префикс ID задач (например, "LB")
 * @returns {Record<string, unknown>}
 */
export function defaultConfig(projectName, prefix) {
  return {
    project_name: projectName,
    task_prefix: prefix,
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Review', 'Done', 'Blocked'],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    definition_of_done: [
      'Тесты проходят',
      'Документация обновлена',
      'Нет регрессий',
    ],
    date_format: 'yyyy-mm-dd hh:mm',
    default_editor: '',
    auto_open_browser: true,
    default_port: 6420,
    remote_operations: true,
    auto_commit: false,
    bypass_git_hooks: false,
    check_active_branches: true,
    active_branch_days: 30,
    max_column_width: 20,
  };
}

/**
 * Загружает конфиг проекта.
 *
 * Ищет файл конфига через findBacklogDir, затем читает и парсит YAML.
 *
 * @param {string} cwd — текущая рабочая директория
 * @returns {Record<string, unknown>} — объект конфига
 * @throws {Error} — если backlog-директория не найдена или конфиг не существует
 */
export function loadConfig(cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена. Выполните "vibelog init" для инициализации.');
  }

  const cfgPath = configPath(backlogDir);
  if (!existsSync(cfgPath)) {
    throw new Error(`Файл конфига не найден: ${cfgPath}`);
  }

  const content = readFileSync(cfgPath, 'utf-8');
  return parseYaml(content);
}

/**
 * Сохраняет конфиг проекта в YAML-файл.
 *
 * @param {string} cwd — текущая рабочая директория
 * @param {Record<string, unknown>} config — объект конфига
 * @throws {Error} — если backlog-директория не найдена
 */
export function saveConfig(cwd, config) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    throw new Error('Backlog-директория не найдена. Выполните "vibelog init" для инициализации.');
  }

  const cfgPath = configPath(backlogDir);
  const yaml = stringifyYaml(config);
  writeFileSync(cfgPath, yaml, 'utf-8');
}
