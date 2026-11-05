/**
 * Команда `vb install` (VL-337, doc-25 §2.3, §4.3): доставка файлов
 * компонента из реестра в проект.
 *
 * Команда — тонкая оболочка над `core/install.ts`: разбирает флаги, спрашивает
 * пользователя про конфликты, печатает план/итог и выставляет код выхода.
 * Вся логика (пути, конфликты, атомарная запись, lock) — в ядре, чтобы
 * `--dry-run` и реальная установка шли по одному коду.
 *
 * Коды выхода (doc-25 §5.2): 0 — успех и частичный успех, 1 — использование,
 * 2 — предусловие, 3 — сеть/данные, 4 — все файлы пропущены по конфликту,
 * 5 — отмена пользователем.
 */

import { readFileSync } from 'node:fs';

import { getFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { colorize, colors, printError, printInfo, printSuccess, printWarning } from '../ui.js';
import { createPromptSession, isInteractive, PromptCancelledError } from '../prompt.js';
import type { PromptSession } from '../prompt.js';
import {
  InstallError,
  applyInstallPlan,
  buildInstallPlan,
  diffLines,
  fetchInstallContents,
  fetchInstallItem,
  forceOverwrite,
  isAllConflictsSkipped,
  resolveConflicts,
  resolveInstallContext,
  skipAllConflicts,
} from '../../core/install.js';
import type { InstallContext, InstallPlan, InstallPlanFile } from '../../core/install.js';

/** Известные флаги команды: неизвестный флаг — ошибка использования (код 1). */
const KNOWN_FLAGS = new Set(['yes', 'force', 'dry-run', 'branch', 'help', 'h']);

/** Опции команды после разбора флагов. */
interface InstallOptions {
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  branch?: string;
}

/**
 * Разбирает флаги команды.
 *
 * Неизвестный флаг — код 1: молча проигнорированный `--forse` означал бы
 * «перезапиши», которого не случилось, и пользователь узнал бы об этом
 * только по неожиданному содержимому файлов.
 */
function parseOptions(flags: FlagValues): InstallOptions {
  for (const key of Object.keys(flags)) {
    if (!KNOWN_FLAGS.has(key)) {
      throw new InstallError(
        `неизвестный флаг «--${key}»; поддерживаются: --yes, --force, --dry-run, --branch <b>`,
        1,
      );
    }
  }
  const branch = getFlag(flags, 'branch', '');
  return {
    yes: flags.yes === true,
    force: flags.force === true,
    dryRun: flags['dry-run'] === true,
    ...(branch !== '' ? { branch } : {}),
  };
}

/** Печатает план установки (используется и в `--dry-run`, и перед записью). */
function printPlan(plan: InstallPlan, dryRun: boolean): void {
  const title = dryRun ? 'План установки (--dry-run)' : 'План установки';
  console.log(`\n${colorize(title, colors.bold)}: ${plan.ref} v${plan.item.version}`);
  for (const file of plan.files) {
    const mark =
      file.action === 'create' || file.action === 'overwrite'
        ? colorize('+', colors.green)
        : colorize('=', colors.dim);
    console.log(`  ${mark} ${file.relPath}  ${colorize(file.action, colors.dim)}`);
  }
  if (plan.item.dependencies.length > 0) {
    printInfo(`npm-зависимости: ${plan.item.dependencies.join(', ')}`);
  }
  if (plan.item.registryDependencies.length > 0) {
    printInfo(`зависимости реестра: ${plan.item.registryDependencies.join(', ')}`);
  }
}

/** Печатает построчный diff файла (без внешних зависимостей). */
function printDiff(file: InstallPlanFile): void {
  console.log(`\n${colorize(`diff: ${file.relPath}`, colors.bold)}`);
  const before = file.existing ? readTextSafe(file.absPath) : '';
  for (const line of diffLines(before, file.content)) console.log(line);
}

/** Читает файл, не падая на ошибке доступа (diff — диагностика, не запись). */
function readTextSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Спрашивает пользователя про каждый конфликт.
 *
 * Возвращает решения `relPath` → overwrite/skip. Отмена (Ctrl+C) —
 * `PromptCancelledError` наверх, CLI превращает её в код 5.
 */
async function askConflicts(
  plan: InstallPlan,
  prompts: PromptSession,
): Promise<Record<string, 'overwrite' | 'skip'>> {
  const decisions: Record<string, 'overwrite' | 'skip'> = {};
  for (const file of plan.conflicts) {
    for (;;) {
      const choice = await prompts.askSelect<'overwrite' | 'skip' | 'diff'>(
        `Файл ${file.relPath} уже существует и отличается. Что делать?`,
        [
          { value: 'overwrite', label: 'Перезаписать', hint: 'файл будет заменён версией из реестра' },
          { value: 'skip', label: 'Пропустить', hint: 'оставить текущий файл' },
          { value: 'diff', label: 'Показать diff' },
        ],
        0,
      );
      if (choice === 'diff') {
        printDiff(file);
        continue;
      }
      decisions[file.relPath] = choice;
      break;
    }
  }
  return decisions;
}

/**
 * Выполняет команду install.
 *
 * @param positional — позиционные аргументы (первый — `<alias>/<repo>/<name>`)
 * @param flags — флаги команды
 * @param cwd — текущая рабочая директория
 */
export async function runInstall(
  positional: string[],
  flags: FlagValues,
  cwd: string,
): Promise<void> {
  let options: InstallOptions;
  let ctx: InstallContext;
  try {
    options = parseOptions(flags);
    const rawPath = positional[0] ?? '';
    if (rawPath.trim() === '') {
      throw new InstallError(
        'не указан компонент: ожидалось «vb install <alias>/<repo>/<name>», например vibelog.md/ui/button',
        1,
      );
    }
    ctx = resolveInstallContext(cwd, rawPath, options.branch ? { branch: options.branch } : {});
  } catch (err) {
    return fail(err);
  }

  // --- Загрузка элемента и его файлов (сеть/данные — код 3) ---
  let plan: InstallPlan;
  try {
    const item = await fetchInstallItem(ctx);
    const contents = await fetchInstallContents(ctx, item);
    plan = buildInstallPlan(ctx.root, ctx.config, ctx.lock, item, contents, ctx.ref);
  } catch (err) {
    return fail(err);
  }

  // --- Разрешение конфликтов (doc-25 §4.3 шаг 8) ---
  // В --dry-run конфликты НЕ разрешаются: план должен показать их как есть,
  // иначе пользователь не увидит, что именно потребует решения.
  if (plan.conflicts.length > 0 && !options.dryRun) {
    if (options.force) {
      forceOverwrite(plan, ctx.lock);
    } else if (options.yes || !isInteractive()) {
      // --yes без --force и не-TTY: пропускаем, но предупреждаем — иначе
      // пользователь не заметит, что компонент не установился.
      skipAllConflicts(plan, ctx.lock);
    } else {
      const prompts = createPromptSession();
      try {
        const decisions = await askConflicts(plan, prompts);
        resolveConflicts(plan, decisions, ctx.lock);
      } catch (err) {
        if (err instanceof PromptCancelledError) {
          printInfo('Отменено. Файлы не изменены.');
          process.exitCode = 5;
          return;
        }
        return fail(err);
      } finally {
        prompts.close();
      }
    }
  }

  printPlan(plan, options.dryRun);

  if (options.dryRun) {
    // Ни temp-каталога, ни записи: план уже посчитан, выходим с 0.
    printInfo('Режим --dry-run: файлы не изменялись.');
    process.exitCode = 0;
    return;
  }

  // --- Запись (атомарно) ---
  let result;
  try {
    result = applyInstallPlan(ctx.root, ctx.config, ctx.lock, plan);
  } catch (err) {
    return fail(err);
  }

  // --- Итоговый блок (AC11) ---
  for (const path of result.written) printSuccess(`Записан: ${path}`);
  for (const file of plan.willSkip) {
    const reason =
      file.action === 'skip-identical'
        ? 'содержимое совпадает'
        : 'конфликт, файл не перезаписан (используйте --force)';
    printInfo(`Пропущен: ${file.relPath} — ${reason}`);
  }
  if (result.lockWritten) {
    printSuccess(`Обновлён lock: ${ctx.config.lockFile} (${plan.item.name} v${plan.item.version})`);
  } else {
    printInfo('installed.lock.json не изменён: запись уже актуальна');
  }

  if (result.written.length === 0 && plan.willSkip.length > 0) {
    if (isAllConflictsSkipped(plan)) {
      printWarning(
        `Пропущено файлов: ${plan.willSkip.length} — все файлы конфликтуют; используйте --force для перезаписи`,
      );
      process.exitCode = 4;
      return;
    }
    printInfo('Уже установлено, изменений нет.');
    process.exitCode = 0;
    return;
  }

  if (plan.willSkip.some((file) => file.action === 'skip-conflict')) {
    printWarning(
      `Пропущено файлов по конфликту: ${plan.willSkip.filter((f) => f.action === 'skip-conflict').length} — используйте --force для перезаписи`,
    );
  }
  process.exitCode = 0;
}

/** Печатает ошибку установки одной строкой и выставляет код выхода. */
function fail(err: unknown): void {
  if (err instanceof InstallError) {
    printError(err.message);
    process.exitCode = err.code;
    return;
  }
  printError((err as Error)?.message ?? String(err));
  process.exitCode = 3;
}
