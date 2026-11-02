/**
 * Команда `vibelog init` — инициализация backlog-а и wizard настройки (VL-210).
 *
 * Два режима (автоопределение по наличию backlog/, override — `--mode`):
 * - fresh — backlog/ нет: создаём структуру, config.yml, AGENTS.md, .env;
 * - upgrade — backlog/ уже есть: показываем текущие значения как дефолты,
 *   дополняем недостающее, НЕ трогая задачи/docs/lessons/references/
 *   decisions/milestones/completed.
 *
 * Сбор ответов — `init-wizard.ts` (интерактив на readline либо флаги при
 * `--yes`), применение — `core/setup.ts` (общее ядро с web `/setup`).
 * Проверки (ping LLM, which qwen/opencode, getMe) — `core/setup-check.ts`.
 */

import { getFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printInfo, printError } from '../ui.js';
import { findBacklogDir } from '../../core/paths.js';
import { loadProjectEnv } from '../../bot/env.js';
import { resolveActiveModel } from '../../core/models.js';
import {
  applySetup,
  formatSetupLog,
  readSetupState,
  SetupError,
} from '../../core/setup.js';
import type { SetupAnswers, SetupMode } from '../../core/setup.js';
import { answersFromFlags, runWizard } from './init-wizard.js';
import { checkAgentBinary, checkTelegramToken, pingLlm } from '../../core/setup-check.js';

/**
 * Выполняет команду init.
 *
 * @param args — позиционные аргументы (после "init")
 * @param flags — флаги
 * @param cwd — текущая рабочая директория
 */
export async function runInit(args: string[], flags: FlagValues, cwd: string): Promise<void> {
  // Имя проекта — всё до первого флага (args уже не содержит "init")
  const nameParts: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) break;
    nameParts.push(arg);
  }
  const positionalName = nameParts.join(' ');

  // Режим: --mode приоритетнее автоопределения по backlog/
  const modeFlag = getFlag(flags, 'mode', '');
  const modeOverride: SetupMode | undefined =
    modeFlag === 'fresh' || modeFlag === 'upgrade' ? modeFlag : undefined;

  const existing = findBacklogDir(cwd);
  const force = flags.force === true;

  // Прежняя защита «уже инициализирован» остаётся для неинтерактивного
  // запуска без --force: без TTY wizard не может спросить, а молча
  // перезаписывать чужой проект нельзя. С TTY это штатный upgrade-режим.
  const interactive =
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    flags.yes !== true &&
    flags['no-wizard'] !== true;

  if (existing && !force && !interactive && modeOverride !== 'upgrade') {
    console.log(`✗ Проект уже инициализирован: ${existing}`);
    console.log('  Используйте --force для перезаписи, --mode upgrade для дополнения настроек');
    console.log('  или запустите интерактивно: vibelog init');
    process.exitCode = 1;
    return;
  }

  // .env/settings-env нужны до чтения состояния: ключи провайдеров и токен
  // бота читаются из окружения (VL-143/VL-189)
  loadProjectEnv(cwd);

  const state = readSetupState(cwd, modeOverride);
  if (state.configError) {
    printError(state.configError);
    if (!force) {
      process.exitCode = 1;
      return;
    }
  }

  let answers: SetupAnswers;
  try {
    if (interactive) {
      printInfo(
        state.mode === 'upgrade'
          ? 'Режим: upgrade (backlog/ найден). Текущие значения — дефолты, Enter — оставить.'
          : 'Режим: fresh. Настройка нового проекта Vibelog.md.',
      );
      answers = await runWizard(cwd, flags, state);
    } else {
      answers = answersFromFlags(flags, state, cwd);
    }
    // Позиционное имя проекта (совместимость с `vibelog init "My Project"`)
    if (positionalName && !getFlag(flags, 'project-name', '')) {
      answers.projectName = positionalName;
    }
    if (getFlag(flags, 'prefix', '')) answers.prefix = getFlag(flags, 'prefix', '');
  } catch (err) {
    printError((err as Error)?.message ?? String(err));
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = applySetup(cwd, answers);
  } catch (err) {
    if (err instanceof SetupError) {
      printError(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  // Отчёт: что записано/пропущено (без значений секретов).
  // Легаси-строки («Создана директория…», «Создан конфиг…», «MCP-сервер
  // vibelog настроен…») сохранены дословно: на них опираются интеграционные
  // тесты VL-6/VL-44 и привычный вывод пользователю — wizard их не отменяет.
  if (answers.mode === 'fresh') {
    const dirs = result.written
      .filter((p) => p.startsWith('backlog/') && p.endsWith('/'))
      .map((p) => p.slice('backlog/'.length, -1));
    if (dirs.length > 0) {
      printSuccess(`Создана директория backlog/ с подпапками: ${dirs.join(', ')}`);
    }
    if (result.written.includes('backlog/config.yml')) {
      printSuccess('Создан конфиг: backlog/config.yml');
    }
  }
  for (const path of result.written) printSuccess(`Записано: ${path}`);
  for (const path of result.skipped) printInfo(`Пропущено: ${path}`);
  for (const warning of result.warnings) printError(warning);
  for (const path of result.written) {
    if (path === '.qwen/settings.json' || path === '.opencode/settings.json') {
      printSuccess(`MCP-сервер vibelog настроен: ${path} (перезапустите Qwen Code)`);
    }
  }
  console.log(formatSetupLog(answers, state, cwd));

  // --- Проверки (шаг 7) ---
  await runChecks(cwd, answers, flags);

  // --- Web wizard (VL-210): --web открывает браузер на #/setup ---
  if (flags.web === true) {
    try {
      const { startWebServer } = await import('../../web/server.js');
      const { resolveWebHost } = await import('../../web/host-binding.js');
      const { loadSettings } = await import('../../core/settings.js');
      let port = 3030;
      try {
        const { loadConfig } = await import('../../core/config.js');
        port = (loadConfig(cwd).default_port as number) || 3030;
      } catch { /* дефолтный порт */ }
      let settings: Record<string, unknown> = {};
      try {
        settings = loadSettings(cwd);
      } catch { /* дефолтный хост */ }
      const host = resolveWebHost(flags, settings);
      startWebServer(cwd, port, true, undefined, host, '#/setup');
      printInfo(`Веб-мастер настройки: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/#/setup`);
      return;
    } catch (err) {
      printError(`Не удалось запустить веб-мастер: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  printInfo('Дальше: vibelog task create "Название" — или vibelog browser для веб-интерфейса');
}

/**
 * Выполняет проверки окружения после применения настроек.
 *
 * Ошибки не меняют exit code: wizard уже записал настройки, а проверка —
 * диагностика с подсказкой, что исправить.
 */
async function runChecks(cwd: string, answers: SetupAnswers, flags: FlagValues): Promise<void> {
  // LLM ping — только если выбран vb и не отключён флагом
  if (answers.agents.includes('vb') && flags['skip-llm-check'] !== true) {
    const active = resolveActiveModel(cwd);
    if (active === null) {
      printError('LLM не настроен: нет models.default в .vibelog/settings.json и VIBELOG_LLM_MODEL');
    } else {
      const ping = await pingLlm(active);
      if (ping.ok) {
        const usage = ping.usage
          ? `, usage: ${ping.usage.input}/${ping.usage.output}/${ping.usage.total}`
          : '';
        printSuccess(`LLM OK: ${ping.model}, ${ping.latencyMs} мс${usage}`);
      } else {
        printError(`LLM: ${ping.error ?? 'неизвестная ошибка'}`);
        if (ping.bodySnippet) printInfo(`Ответ: ${ping.bodySnippet}`);
      }
    }
  }

  // Внешние агенты — наличие в PATH и версия
  for (const agent of answers.agents) {
    if (agent !== 'qwen' && agent !== 'opencode') continue;
    const check = checkAgentBinary(agent);
    if (check.found && !check.error) {
      printSuccess(`${agent} OK: ${check.path ?? ''}${check.version ? ` (${check.version})` : ''}`);
    } else {
      printError(check.error ?? `${agent} не найден`);
    }
  }

  // Бот — getMe
  if (answers.bot?.token && flags['skip-bot-check'] !== true) {
    const check = await checkTelegramToken(answers.bot.token);
    if (check.ok) printSuccess(`Telegram OK: @${check.username ?? 'бот'}`);
    else printError(check.error ?? 'Токен невалиден');
  }
}
