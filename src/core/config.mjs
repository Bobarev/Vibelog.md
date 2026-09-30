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
export const DEFAULT_TASK_TYPES = ['bug', 'feature', 'enhancement', 'task', 'chore', 'docs', 'spike'];

export function defaultConfig(projectName, prefix) {
  return {
    project_name: projectName,
    task_prefix: prefix,
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Review', 'Done', 'Blocked'],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    types: [...DEFAULT_TASK_TYPES],
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
 * Нормализует тип задачи по списку types из конфига.
 *
 * Семантика оригинала Backlog.md: сравнение case-insensitive,
 * возвращается каноническое написание из конфига.
 * Если types в конфиге отсутствует — используется DEFAULT_TASK_TYPES.
 *
 * @param {Record<string, unknown>} config — объект конфига
 * @param {string} type — тип задачи (например "Bug")
 * @returns {string} — канонический тип ("bug") или '' если type пустой
 * @throws {Error} — если тип не входит в список
 */
export function normalizeTaskType(config, type) {
  if (!type) return '';
  const types = Array.isArray(config?.types) && config.types.length > 0
    ? config.types
    : DEFAULT_TASK_TYPES;
  const candidate = String(type).toLowerCase();
  const canonical = types.find(t => String(t).toLowerCase() === candidate);
  if (!canonical) {
    throw new Error(`Недопустимый тип "${type}". Допустимые: ${types.join(', ')}`);
  }
  return String(canonical);
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
