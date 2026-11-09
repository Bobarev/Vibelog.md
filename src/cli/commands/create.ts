/**
 * Команда `vb create` (VL-339, doc-25 §2.1, §4.1): создание нового проекта из
 * шаблона.
 *
 * Команда — тонкая оболочка над `core/create.ts`: разбирает флаги, спрашивает
 * пакетный менеджер, печатает итог и выставляет код выхода. Вся
 * последовательность (клон подпапки, проверка манифеста, копирование,
 * зависимости, `postCreate`, компоненты, `git init`) — в ядре, чтобы её можно
 * было тестировать без CLI.
 *
 * Коды выхода (doc-25 §5.2): 0 — успех, 1 — использование (имя, флаги, путь
 * шаблона), 2 — каталог уже существует, 3 — клон/шаблон/зависимости/
 * `postCreate`, 5 — отмена промпта.
 */

import { getFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { colorize, colors, printError, printInfo, printSuccess, printWarning } from '../ui.js';
import { createPromptSession, isInteractive, PromptCancelledError } from '../prompt.js';
import { CreateError, createProject } from '../../core/create.js';
import type { CreateResult } from '../../core/create.js';
import { detectPackageManager } from '../../core/install-deps.js';
import type { PackageManager } from '../../core/install-deps.js';

/** Известные флаги команды: неизвестный флаг — ошибка использования (код 1). */
const KNOWN_FLAGS = new Set([
  'template',
  'branch',
  'package-manager',
  'no-install',
  'no-git',
  'yes',
  'help',
  'h',
]);

/** Поддерживаемые значения `--package-manager`. */
const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'bun', 'yarn'];

/** Опции команды после разбора флагов. */
interface CreateOptions {
  template: string;
  branch?: string;
  packageManager?: PackageManager;
  noInstall: boolean;
  noGit: boolean;
  yes: boolean;
}

/**
 * Разбирает флаги команды.
 *
 * Неизвестный флаг — код 1: молча проигнорированный `--no-gti` означал бы
 * «сделай git init», которого пользователь не хотел.
 */
function parseOptions(flags: FlagValues): CreateOptions {
  for (const key of Object.keys(flags)) {
    if (!KNOWN_FLAGS.has(key)) {
      throw new CreateError(
        `неизвестный флаг «--${key}»; поддерживаются: --template <p>, --branch <b>, --package-manager <npm|pnpm|bun|yarn>, --no-install, --no-git, --yes`,
        1,
      );
    }
  }
  const template = getFlag(flags, 'template', '').trim();
  if (template === '') {
    throw new CreateError(
      'не указан шаблон: ожидалось «vb create <name> --template <alias>/<repo>/<template>», например vibelog.md/templates/svelte-minimal',
      1,
    );
  }
  const branch = getFlag(flags, 'branch', '').trim();
  const pmRaw = getFlag(flags, 'package-manager', '').trim();
  let packageManager: PackageManager | undefined;
  if (pmRaw !== '') {
    if (!(PACKAGE_MANAGERS as readonly string[]).includes(pmRaw)) {
      throw new CreateError(
        `неизвестный пакетный менеджер «${pmRaw}»; поддерживаются: ${PACKAGE_MANAGERS.join(', ')}`,
        1,
      );
    }
    packageManager = pmRaw as PackageManager;
  }
  return {
    template,
    ...(branch !== '' ? { branch } : {}),
    ...(packageManager !== undefined ? { packageManager } : {}),
    noInstall: flags['no-install'] === true,
    noGit: flags['no-git'] === true,
    yes: flags.yes === true,
  };
}

/**
 * Спрашивает пакетный менеджер.
 *
 * Дефолт — детект по lock-файлу шаблона (он уже скопирован), иначе `npm`:
 * шаблон с `pnpm-lock.yaml` почти наверняка рассчитан на pnpm, и предлагать
 * npm значило бы гарантированно получить второй lock-файл.
 */
async function askPackageManager(templateDir: string, yes: boolean): Promise<PackageManager> {
  const detected = detectPackageManager(templateDir);
  if (yes || !isInteractive()) return detected;
  const prompts = createPromptSession();
  try {
    const options = PACKAGE_MANAGERS.map((pm) => ({
      value: pm,
      label: pm,
      ...(pm === detected ? { hint: 'определён по lock-файлу шаблона' } : {}),
    }));
    const initial = Math.max(0, PACKAGE_MANAGERS.indexOf(detected));
    return await prompts.askSelect<PackageManager>('Пакетный менеджер?', options, initial);
  } finally {
    prompts.close();
  }
}

/** Печатает итоговый блок созданного проекта. */
function printResult(result: CreateResult): void {
  console.log(`\n${colorize('Проект создан', colors.bold)}: ${result.targetDir}`);
  printInfo(`Шаблон: ${result.ref} (ветка ${result.branch})`);
  printInfo(
    result.packageManager === null
      ? 'Зависимости: не устанавливались (--no-install)'
      : `Пакетный менеджер: ${result.packageManager}`,
  );
  if (result.scriptsRun.length > 0) {
    printInfo(`Скрипты шаблона: ${result.scriptsRun.join(', ')}`);
  }
  if (result.installedComponents.length > 0) {
    printSuccess(`Установлены компоненты: ${result.installedComponents.join(', ')}`);
  }
  if (result.failedComponents.length > 0) {
    printWarning(
      `Не установлены компоненты: ${result.failedComponents.map((f) => f.path).join(', ')} — проект рабочий, установите их вручную через «vb install»`,
    );
    // VL-386: самая частая причина отказа — отсутствие секции `components`,
    // а её создаёт `vb init --components` внутри `postCreate`. Если ошибка
    // указывает именно на секцию, говорим про рассинхрон версий CLI прямо:
    // иначе пользователь видит «секция не найдена» и не знает, что делать.
    if (result.failedComponents.some((f) => /components/i.test(f.error))) {
      printInfo(
        'Подсказка: секцию components создаёт «vb init --components» в scripts.postCreate шаблона. Если её нет — шаблон вызвал устаревший «vb» из PATH: обновите vibelog.md (либо задайте VIBELOG_BIN путём к актуальному CLI) и выполните «vb init --components» в проекте.',
      );
    }
  }
  if (result.setupCancelled) {
    printWarning(
      'Настройка отменена: проект создан и работает, но агент, модель и MCP не настроены.',
    );
    printInfo(`Дальше: cd ${result.targetDir} && vibelog init`);
    return;
  }
  if (result.packageManager === null) {
    // VL-392: `--no-install` не выполняет `postCreate`, а именно он проводит
    // настройку проекта — молчать об этом нельзя, иначе пользователь ищет
    // настройки там, где их нет.
    printInfo('Настройка не выполнялась: без зависимостей scripts.postCreate не запускается — выполните «vibelog init» в проекте');
  }
  if (result.git === 'initialized') {
    printSuccess('Git: репозиторий инициализирован, создан первый коммит');
  } else if (result.git === 'skipped') {
    printInfo('Git: пропущен (--no-git)');
  } else {
    printWarning('Git: репозиторий не инициализирован — выполните «git init» вручную');
  }
  for (const warning of result.warnings) printWarning(warning);
  printInfo(`Дальше: cd ${result.targetDir}`);
}

/**
 * Выполняет команду create.
 *
 * @param positional — позиционные аргументы (первый — имя проекта)
 * @param flags — флаги команды
 * @param cwd — текущая рабочая директория (в ней создаётся `./<name>`)
 */
export async function runCreate(
  positional: string[],
  flags: FlagValues,
  cwd: string,
): Promise<void> {
  let options: CreateOptions;
  try {
    options = parseOptions(flags);
  } catch (err) {
    return fail(err);
  }

  const name = (positional[0] ?? '').trim();
  if (name === '') {
    printError(
      'не указано имя проекта: ожидалось «vb create <name> --template <alias>/<repo>/<template>»',
    );
    process.exitCode = 1;
    return;
  }

  // VL-392: режим настройки. Без нового флага: `--yes` уже означает «без
  // вопросов, дефолты» (как в `vibelog init`, VL-336), а его отсутствие в TTY —
  // полный wizard. В не-TTY wizard невозможен, поэтому дефолты принудительно,
  // и пользователь получает одну строку-пояснение (один раз, не в цикле).
  const tty = isInteractive();
  const interactive = tty && !options.yes;
  if (!tty && !options.yes) {
    printInfo(
      'не-TTY: использую дефолты, полная настройка недоступна — запустите «vibelog init» интерактивно',
    );
  }

  try {
    const result = await createProject({
      cwd,
      name,
      template: options.template,
      ...(options.branch !== undefined ? { branch: options.branch } : {}),
      ...(options.packageManager !== undefined ? { packageManager: options.packageManager } : {}),
      ...(options.noInstall ? { noInstall: true } : {}),
      ...(options.noGit ? { noGit: true } : {}),
      ...(interactive ? { interactive: true } : {}),
      resolvePackageManager: (templateDir) => askPackageManager(templateDir, options.yes),
      onWarning: (message) => printWarning(message),
    });
    printResult(result);
    // VL-392: отмена wizard-а внутри postCreate — проект создан, настройка нет.
    // Код 5 тот же, что у `vibelog init` при отмене промпта (doc-25 §5.2).
    process.exitCode = result.setupCancelled ? 5 : 0;
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      printInfo('Отменено. Проект не создан.');
      process.exitCode = 5;
      return;
    }
    return fail(err);
  }
}

/** Печатает ошибку создания одной строкой и выставляет код выхода. */
function fail(err: unknown): void {
  if (err instanceof CreateError) {
    printError(err.message);
    process.exitCode = err.code;
    return;
  }
  printError((err as Error)?.message ?? String(err));
  process.exitCode = 3;
}
