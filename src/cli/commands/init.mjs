/**
 * Команда `vibelog init` — инициализация backlog-а.
 *
 * Создаёт структуру директорий и конфиг-файл:
 * - backlog/
 * - backlog/config.yml
 * - backlog/tasks/
 * - backlog/completed/
 * - backlog/drafts/
 * - backlog/docs/
 * - backlog/decisions/
 * - backlog/milestones/
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, getFlag } from '../args.mjs';
import { printSuccess, printInfo, printError } from '../ui.mjs';
import { defaultConfig } from '../../core/config.mjs';
import { stringifyYaml } from '../../core/yaml.mjs';
import { findBacklogDir } from '../../core/paths.mjs';

/**
 * Выполняет команду init.
 *
 * @param {string[]} args — позиционные аргументы (после "init")
 * @param {Record<string, unknown>} flags — флаги
 * @param {string} cwd — текущая рабочая директория
 */
export async function runInit(args, flags, cwd) {
  // Имя проекта — всё до первого флага (args уже不含 "init")
  const nameParts = [];
  for (const arg of args) {
    if (arg.startsWith('-')) break;
    nameParts.push(arg);
  }
  const projectName = nameParts.join(' ') || 'My Project';
  const prefix = getFlag(flags, 'prefix', 'LB');

  // Проверяем, не инициализирован ли уже
  const existing = findBacklogDir(cwd);
  if (existing) {
    // Пишем в stdout (console.log), чтобы сообщение было видно при любом способе чтения вывода
    console.log(`✗ Проект уже инициализирован: ${existing}`);
    console.log('  Используйте --force для перезаписи или удалите папку backlog/ вручную.');
    process.exitCode = 1;
    return;
  }

  printInfo(`Инициализация backlog-а "${projectName}" (prefix: ${prefix})...`);

  // Создаём структуру директорий
  const backlogDir = join(cwd, 'backlog');
  const dirs = ['tasks', 'completed', 'drafts', 'docs', 'decisions', 'milestones'];
  for (const dir of dirs) {
    mkdirSync(join(backlogDir, dir), { recursive: true });
  }

  // Создаём конфиг
  const config = defaultConfig(projectName, prefix);
  const configYaml = stringifyYaml(config);
  writeFileSync(join(backlogDir, 'config.yml'), configYaml, 'utf-8');

  printSuccess(`Создана директория backlog/ с подпапками: ${dirs.join(', ')}`);
  printSuccess(`Создан конфиг: backlog/config.yml`);
  printInfo('Теперь вы можете создавать задачи: vibelog task create "Название"');
}
