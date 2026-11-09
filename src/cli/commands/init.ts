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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { findBacklogDir } from '../../core/paths.js';
import { loadProjectEnv } from '../../bot/env.js';
import { resolveActiveModel } from '../../core/models.js';
import {
  applySetup,
  derivePrefix,
  formatSetupLog,
  readSetupState,
  SetupError,
} from '../../core/setup.js';
import type { SetupAnswers, SetupMode } from '../../core/setup.js';
import { answersFromFlags, runWizard } from './init-wizard.js';
import { PromptCancelledError } from '../prompt.js';
import { checkAgentBinary, checkTelegramToken, pingLlm } from '../../core/setup-check.js';
import { readCreateContext } from '../../core/env-markers.js';

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

  // VL-389: `init` вызван из `scripts.postCreate` внутри `vb create`?
  // Читаем один раз на входе: дальше по коду это влияет на две вещи —
  // предупреждение о git (репозиторий создаст сам `create`) и финальную
  // подсказку «Дальше: …» (её печатает итоговый блок `create`).
  const createContext = readCreateContext();

  // VL-336: --components и --no-components взаимоисключающие. Тихая победа
  // одного из них означала бы, что пользователь получил не то, что просил.
  if (flags.components === true && flags['no-components'] === true) {
    printError('Флаги --components и --no-components взаимоисключающие');
    process.exitCode = 1;
    return;
  }

  // VL-348: --git-init и --no-git-init взаимоисключающие (та же логика, что
  // у --components/--no-components): тихая победа одного из них означала бы,
  // что пользователь получил не то, что просил.
  if (flags['git-init'] === true && flags['no-git-init'] === true) {
    printError('Флаги --git-init и --no-git-init взаимоисключающие');
    process.exitCode = 1;
    return;
  }

  // VL-320: --web полностью выключает консольный wizard — сразу web-мастер
  // #/setup (как флаги в ref-25 выключают соответствующий промпт). Проверка
  // стоит до «уже инициализирован»: web-мастер сам разберётся с режимом.
  if (flags.web === true) {
    await runWebWizard(cwd, flags);
    return;
  }

  // Прежняя защита «уже инициализирован» остаётся для неинтерактивного
  // запуска без --force: без TTY wizard не может спросить, а молча
  // перезаписывать чужой проект нельзя. С TTY это штатный upgrade-режим.
  const interactive =
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    flags.yes !== true &&
    flags['no-wizard'] !== true &&
    flags.web !== true;

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
    if (getFlag(flags, 'prefix', '')) {
      answers.prefix = getFlag(flags, 'prefix', '');
    } else if (!interactive && answers.mode === 'fresh') {
      // VL-320: в non-interactive prefix выводим из имени проекта
      // (Vibelog Templates → VT); не выводится — остаётся текущий/`VL`.
      answers.prefix = derivePrefix(answers.projectName) ?? answers.prefix;
    }
  } catch (err) {
    // VL-320: отмена (Ctrl+C) — штатный выход, не ошибка и не стек-трейс
    if (err instanceof PromptCancelledError) {
      printInfo('Отменено. Настройки не изменены.');
      process.exitCode = 0;
      return;
    }
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

  // VL-327: перечитываем окружение ПОСЛЕ применения настроек. loadDotEnv
  // записывает только ОТСУТСТВУЮЩИЕ ключи, поэтому первый вызов (до wizard-а)
  // не видит того, что wizard только что дописал в .env — без этого проверки
  // ниже шли бы с пустым ROUTERAI_API_KEY (401) и без TELEGRAM_PROXY (timeout).
  loadProjectEnv(cwd);

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
  for (const path of result.skipped) {
    // VL-389: в контексте `vb create` «Пропущено: AGENTS.md (уже существует)»
    // читается как «что-то не сделалось», хотя шаблон просто принёс свой
    // AGENTS.md и перезаписывать его нельзя. Говорим нейтрально; прямой
    // запуск `init` сохраняет прежний текст (на него опирается VL-348).
    if (createContext.fromCreate && path.startsWith('AGENTS.md')) {
      printInfo('AGENTS.md из шаблона сохранён (существующий файл не перезаписывали)');
      continue;
    }
    printInfo(`Пропущено: ${path}`);
  }
  for (const warning of result.warnings) printError(warning);
  for (const path of result.written) {
    if (path === '.qwen/settings.json' || path === '.opencode/settings.json') {
      printSuccess(`MCP-сервер vibelog настроен: ${path} (перезапустите Qwen Code)`);
    }
  }
  console.log(formatSetupLog(answers, state, cwd));

  // VL-348: проект вне git и репозиторий не создавали — предупреждаем, что
  // `.env` с секретами ничем не защищён (AC10: код выхода при этом 0).
  //
  // VL-389: внутри `vb create` предупреждение ложно — репозиторий создаст сам
  // `create` сразу после `postCreate`. Подавляем только когда git действительно
  // будет: при `--no-git` (маркер `no-git`) пользователь правда остаётся без
  // репозитория, и предупреждение честное.
  if (!state.git.inRepo && answers.git?.init !== true && !createContext.gitWillBeInitialized) {
    printError(
      'Проект не в git: .env с секретами не защищён. Запустите vibelog init --git-init или git init вручную',
    );
  }

  // --- Проверки (шаг 7) ---
  await runChecks(cwd, answers, flags);

  // VL-389: финальную подсказку в контексте `postCreate` не печатаем — сразу за
  // ней идёт итоговый блок `vb create` со своим «Дальше: cd …». Две разные
  // «дальнейшие инструкции» подряд читаются как противоречие.
  if (!createContext.fromCreate) {
    printInfo('Дальше: vibelog task create "Название" — или vibelog browser для веб-интерфейса');
  }
}

/**
 * Запускает web-мастер настройки (`vibelog init --web`, VL-210/VL-320).
 *
 * Порт берётся из config.yml (default_port), хост — из --host/settings
 * (resolveWebHost). Сервер открывает браузер сразу на #/setup.
 */
async function runWebWizard(cwd: string, flags: FlagValues): Promise<void> {
  // VL-336: шага «компоненты» в веб-мастере нет — секция `components`
  // создаётся по дефолту (как при --yes). Об этом сообщаем, чтобы
  // --no-components рядом с --web не выглядел сработавшим.
  if (flags['no-components'] === true) {
    printInfo(
      'Шаг «компоненты» в веб-мастере не поддерживается: секция components будет создана по умолчанию',
    );
  }
  try {
    const { startWebServer } = await import('../../web/server.js');
    const { resolveWebHost } = await import('../../web/host-binding.js');
    const { loadSettings } = await import('../../core/settings.js');
    let port = 3030;
    try {
      const { loadConfig } = await import('../../core/config.js');
      port = (loadConfig(cwd).default_port as number) || 3030;
    } catch { /* дефолтный порт */ }
    // --port/--no-open — как у `vibelog browser`: нужны для тестов (port 0 —
    // эфемерный порт, без конфликта параллельных прогонов) и для CI
    const portFlag = getFlag(flags, 'port', '');
    if (portFlag !== '') {
      const parsed = Number(portFlag);
      if (Number.isFinite(parsed) && parsed >= 0) port = parsed;
    }
    let settings: Record<string, unknown> = {};
    try {
      settings = loadSettings(cwd);
    } catch { /* дефолтный хост */ }
    const host = resolveWebHost(flags, settings);
    const openBrowser = flags['no-open'] !== true;
    startWebServer(cwd, port, openBrowser, undefined, host, '#/setup');
    printInfo(`Веб-мастер настройки: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/#/setup`);
  } catch (err) {
    printError(`Не удалось запустить веб-мастер: ${(err as Error)?.message ?? String(err)}`);
    process.exitCode = 1;
  }
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
    // VL-327: прокси берём из окружения (после повторного loadProjectEnv там
    // уже значение из .env) — иначе прямой доступ к api.telegram.org не
    // проходит и проверка врёт таймаутом.
    const proxy = (process.env.TELEGRAM_PROXY ?? '').trim();
    const check = await checkTelegramToken(answers.bot.token, proxy !== '' ? { proxy } : {});
    if (check.ok) printSuccess(`Telegram OK: @${check.username ?? 'бот'}`);
    else printError(check.error ?? 'Токен невалиден');
  }

  // VL-348: `.env` должен быть невидим для git. Спрашиваем сам git
  // (`check-ignore`), а не парсим `.gitignore`: правила git регуляркой не
  // воспроизвести, а ошибка здесь означает утечку токенов.
  if (existsSync(join(cwd, '.env'))) {
    const res = spawnSync('git', ['check-ignore', '-q', '--', '.env'], { cwd, encoding: 'utf-8' });
    if (!res.error && res.status === 1) {
      printError('.env НЕ игнорируется git: токены и API-ключи могут уехать в репозиторий');
    } else if (!res.error && res.status === 0) {
      printSuccess('.env игнорируется git');
    }
  }
}
