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

import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, getFlag } from '../args.mjs';
import { printSuccess, printInfo, printError } from '../ui.mjs';
import { defaultConfig } from '../../core/config.js';
import { stringifyYaml } from '../../core/yaml.js';
import { findBacklogDir } from '../../core/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', '..', '..', 'templates', 'qwen-commands');

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
  const force = flags.force === true;
  if (existing && !force) {
    // Пишем в stdout (console.log), чтобы сообщение было видно при любом способе чтения вывода
    console.log(`✗ Проект уже инициализирован: ${existing}`);
    console.log('  Используйте --force для перезаписи или удалите папку backlog/ вручную.');
    process.exitCode = 1;
    return;
  }

  if (!existing) {
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

  // --- Команды Qwen Code (--skills) ---
  handleSkills(flags, cwd);

  // --- MCP-сервер Qwen Code (по умолчанию включён) ---
  handleMcpSetup(flags, cwd);
}

/**
 * Обрабатывает флаг --skills: создаёт команды /vibelog:* в .qwen/commands/.
 *
 * @param {Record<string, unknown>} flags — флаги CLI
 * @param {string} cwd — текущая рабочая директория
 */
function handleSkills(flags, cwd) {
  // --no-skills — отключает, даже если default изменится
  if (flags['no-skills']) return;

  // --skills: boolean (true = qwen) или строка (--skills=qwen)
  const skillsFlag = flags.skills;
  if (skillsFlag === undefined) return;

  const agent = skillsFlag === true ? 'qwen' : String(skillsFlag);

  // Заглушка на будущее
  if (agent !== 'qwen') {
    printError(`Агент "${agent}" пока не поддерживается. Доступен: qwen`);
    process.exitCode = 1;
    return;
  }

  const commandsDir = join(cwd, '.qwen', 'commands', 'vibelog');
  const templates = ['spec.md', 'plan.md', 'code.md'];
  const force = flags.force === true;

  // Идемпотентность
  if (existsSync(commandsDir) && !force) {
    printInfo('Команды /vibelog:* уже существуют. Пропускаю.');
    printInfo('Используйте --force для перезаписи.');
    return;
  }

  // Создаём директории и копируем шаблоны
  mkdirSync(commandsDir, { recursive: true });
  for (const tpl of templates) {
    const src = join(templatesDir, tpl);
    const dest = join(commandsDir, tpl);
    if (existsSync(src)) {
      copyFileSync(src, dest);
    }
  }
  printSuccess(`Команды /vibelog:* созданы: ${commandsDir}`);

  // Обновляем AGENTS.md
  updateAgentsMd(cwd);
}

/**
 * Настраивает MCP-сервер Vibelog в .qwen/settings.json.
 *
 * По умолчанию init добавляет секцию mcpServers.vibelog, чтобы Qwen Code
 * подхватил сервер без ручной настройки. Отключение: --no-mcp.
 * Merge, а не replace: чужие ключи (ui, $version, другие mcpServers) сохраняются.
 *
 * @param {Record<string, unknown>} flags — флаги командной строки
 * @param {string} cwd — текущая рабочая директория
 */
function handleMcpSetup(flags, cwd) {
  // --no-mcp — отключает автонастройку
  if (flags['no-mcp']) return;

  const settingsPath = join(cwd, '.qwen', 'settings.json');
  let settings = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Не роняем init из-за битого settings.json — сообщаем и выходим
      printError(`Не удалось разобрать ${settingsPath} (некорректный JSON). MCP-секция не добавлена.`);
      return;
    }
  }

  // Merge: добавляем/перезаписываем только vibelog-секцию
  if (!settings.mcpServers || typeof settings.mcpServers !== 'object') {
    settings.mcpServers = {};
  }
  settings.mcpServers.vibelog = {
    command: 'vibelog',
    args: ['mcp', 'start'],
    trust: true,
  };

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  printSuccess('MCP-сервер vibelog настроен: .qwen/settings.json (перезапустите Qwen Code)');
}

/**
 * Дописывает секцию VIBELOG:SKILLS в AGENTS.md (если её ещё нет).
 *
 * @param {string} cwd — текущая рабочая директория
 */
function updateAgentsMd(cwd) {
  const agentsPath = join(cwd, 'AGENTS.md');
  const section = `<!-- VIBELOG:SKILLS:BEGIN -->
## Команды Vibelog

В этом проекте доступны команды Qwen Code:

- \`/vibelog:spec <описание>\` — разбить фичу на задачи (Фаза 1)
- \`/vibelog:plan <ID>\` — составить план для задачи (Фаза 2)
- \`/vibelog:code <ID>\` — реализовать задачу (Фаза 3)

Workflow: spec → plan → code. На каждой фазе ждать подтверждения.
<!-- VIBELOG:SKILLS:END -->`;

  let content = '';
  if (existsSync(agentsPath)) {
    content = readFileSync(agentsPath, 'utf-8');
    if (content.includes('VIBELOG:SKILLS:BEGIN')) {
      printInfo('Секция VIBELOG:SKILLS уже есть в AGENTS.md. Не дублирую.');
      return;
    }
  }

  // Дописываем в конец
  const separator = content && !content.endsWith('\n') ? '\n\n' : '\n';
  writeFileSync(agentsPath, content + separator + section + '\n', 'utf-8');
  printSuccess('AGENTS.md дополнен секцией «Команды Vibelog».');
}
