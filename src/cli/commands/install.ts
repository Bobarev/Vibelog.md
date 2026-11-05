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
  applyInstallChain,
  buildInstallPlan,
  diffLines,
  fetchInstallContents,
  fetchInstallItem,
  forceOverwrite,
  isAllConflictsSkipped,
  recomputeInstallPlan,
  resolveConflicts,
  resolveInstallContext,
  skipAllConflicts,
} from '../../core/install.js';
import type { InstallContext, InstallPlan, InstallPlanFile } from '../../core/install.js';
import {
  detectPackageManager,
  formatCommand,
  installCommand,
  missingDeps,
  readProjectDeps,
  runDepsInstall,
} from '../../core/install-deps.js';
import type { DepsRunner } from '../../core/install-deps.js';
import {
  checkChainOwnership,
  resolveRegistryDeps,
  transferOwnership,
} from '../../core/install-registry-deps.js';
import type { OwnershipEntry, RegistryDepNote } from '../../core/install-registry-deps.js';

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
function printPlan(plan: InstallPlan, dryRun: boolean, reuses: OwnershipEntry[] = []): void {
  const title = dryRun ? 'План установки (--dry-run)' : 'План установки';
  console.log(`\n${colorize(title, colors.bold)}: ${plan.ref} v${plan.item.version}`);
  for (const file of plan.files) {
    const mark =
      file.action === 'create' || file.action === 'overwrite'
        ? colorize('+', colors.green)
        : colorize('=', colors.dim);
    const reuse = reuses.find((entry) => entry.relPath === file.relPath);
    const note = reuse ? colorize(`  (переиспользован из ${reuse.owner})`, colors.dim) : '';
    console.log(`  ${mark} ${file.relPath}  ${colorize(file.action, colors.dim)}${note}`);
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
 * @param deps — инъекция раннера пакетного менеджера (тесты)
 */
export async function runInstall(
  positional: string[],
  flags: FlagValues,
  cwd: string,
  deps: { runner?: DepsRunner } = {},
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
  let depPlans: InstallPlan[] = [];
  let depWarnings: RegistryDepNote[] = [];
  let alreadyInstalled: string[] = [];
  try {
    const item = await fetchInstallItem(ctx);
    const contents = await fetchInstallContents(ctx, item);
    plan = buildInstallPlan(ctx.root, ctx.config, ctx.lock, item, contents, ctx.ref);

    // --- registryDependencies: один уровень, до самого элемента (шаг 5) ---
    const resolved = await resolveRegistryDeps(item, {
      root: ctx.root,
      config: ctx.config,
      lock: ctx.lock,
      ctx,
    });
    depPlans = resolved.plans;
    depWarnings = resolved.warnings;
    alreadyInstalled = resolved.alreadyInstalled;
  } catch (err) {
    return fail(err);
  }

  const chain: InstallPlan[] = [...depPlans, plan];

  // --- Владение файлами (doc-25 §3.2): reuse или конфликт ---
  // Проверяется вся цепочка сразу: `base` ещё не в lock, но его `utils.ts`
  // уже запланирован, и `card` обязан увидеть его владельцем.
  const ownership = checkChainOwnership(ctx.lock, chain);
  const reuses = ownership.reuses;

  // --- npm-зависимости: сверка с package.json (шаг 6) ---
  const projectDeps = readProjectDeps(ctx.root);
  const missing: string[] = [];
  for (const current of chain) {
    for (const name of missingDeps(current.item, projectDeps)) {
      if (!missing.includes(name)) missing.push(name);
    }
  }
  const pm = detectPackageManager(ctx.root);
  const command = installCommand(pm, missing);

  // --- Разрешение конфликтов (doc-25 §4.3 шаг 8) ---
  // В --dry-run конфликты НЕ разрешаются: план должен показать их как есть,
  // иначе пользователь не увидит, что именно потребует решения.
  if (!options.dryRun) {
    for (const current of chain) {
      if (current.conflicts.length === 0) continue;
      if (options.force) {
        forceOverwrite(current, ctx.lock);
      } else if (options.yes || !isInteractive()) {
        // --yes без --force и не-TTY: пропускаем, но предупреждаем — иначе
        // пользователь не заметит, что компонент не установился.
        skipAllConflicts(current, ctx.lock);
      } else {
        const prompts = createPromptSession();
        try {
          const decisions = await askConflicts(current, prompts);
          resolveConflicts(current, decisions, ctx.lock);
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
  }

  // --- Планы: зависимости реестра первыми, затем сам элемент ---
  for (const current of depPlans) {
    printPlan(current, options.dryRun, reuses);
  }
  printPlan(plan, options.dryRun, reuses);

  for (const note of depWarnings) printWarning(note.message);
  for (const name of alreadyInstalled) {
    printInfo(`Зависимость реестра «${name}» уже установлена — не переустанавливаем`);
  }

  // --- Секция npm-зависимостей ---
  let confirmedDeps: string[] = [];
  if (missing.length > 0) {
    printInfo(
      `Зависимости: отсутствуют ${missing.length} (${missing.join(', ')}), команда: ${formatCommand(command)}`,
    );
    if (options.dryRun) {
      printInfo('Режим --dry-run: пакеты не устанавливаются.');
    } else if (options.yes || !isInteractive()) {
      // --yes означает «без вопросов», а не «правь package.json»: молчаливая
      // установка зависимостей недопустима (решение задачи).
      printWarning(
        `Зависимости не установлены (--yes/не-TTY): выполните вручную «${formatCommand(command)}» — без них компонент может не работать`,
      );
    } else {
      const prompts = createPromptSession();
      let agreed = false;
      try {
        agreed = await prompts.askConfirm(
          `Установить отсутствующие пакеты (${missing.length})?`,
          true,
        );
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
      if (!agreed) {
        printWarning(
          `Зависимости не установлены: выполните вручную «${formatCommand(command)}» — без них компонент может не работать`,
        );
      } else {
        const run = runDepsInstall(pm, missing, ctx.root, deps.runner);
        if (run.fallbackFrom) {
          printWarning(
            `Пакетный менеджер «${run.fallbackFrom}» не найден — использован npm`,
          );
        }
        if (run.ok) {
          // Перечитываем package.json: в lock попадают только подтверждённо
          // установленные пакеты (doc-25 §3.2).
          const after = readProjectDeps(ctx.root);
          confirmedDeps = missing.filter((name) => after.has(name));
          printSuccess(`Установлены пакеты: ${confirmedDeps.join(', ')}`);
        } else {
          printWarning(
            `Зависимости не установлены (${run.error ?? 'ненулевой код выхода'}): компонент может не работать`,
          );
        }
      }
    }
  }

  if (options.dryRun) {
    // Ни temp-каталога, ни записи: план уже посчитан, выходим с 0.
    printInfo('Режим --dry-run: файлы не изменялись.');
    process.exitCode = 0;
    return;
  }

  // --- Финальный пересчёт планов: зависимости в lock + переиспользование ---
  const now = new Date().toISOString();
  for (const current of chain) {
    const own = current.item.dependencies.filter((name) => confirmedDeps.includes(name));
    // Пустой список не передаём: иначе повторная установка затрёт уже
    // записанные в lock зависимости (идемпотентность, AC8 VL-337).
    recomputeInstallPlan(current, ctx.lock, now, own.length > 0 ? own : undefined);
  }
  const transferred = transferOwnership(chain, ctx.lock);

  // --- Запись всей цепочки одной транзакцией ---
  let results;
  try {
    results = applyInstallChain(ctx.root, ctx.config, ctx.lock, chain);
  } catch (err) {
    return fail(err);
  }

  // --- Итоговый блок ---
  for (let i = 0; i < chain.length; i += 1) {
    const current = chain[i];
    const isDep = i < depPlans.length;
    if (isDep) printSuccess(`Установлена зависимость реестра: ${current.ref} v${current.item.version}`);
    for (const path of results[i].written) printSuccess(`Записан: ${path}`);
    for (const file of current.willSkip) {
      const reason =
        file.action === 'skip-identical'
          ? 'содержимое совпадает'
          : 'конфликт, файл не перезаписан (используйте --force)';
      printInfo(`Пропущен: ${file.relPath} — ${reason}`);
    }
  }
  for (const entry of reuses) {
    printInfo(`Файл переиспользован из «${entry.owner}»: ${entry.relPath}`);
  }
  for (const item of transferred) {
    printInfo(`Владение файлом передано: ${item}`);
  }
  if (results.some((result) => result.lockWritten)) {
    printSuccess(
      `Обновлён lock: ${ctx.config.lockFile} (${chain.map((c) => `${c.item.name} v${c.item.version}`).join(', ')})`,
    );
  } else {
    printInfo('installed.lock.json не изменён: запись уже актуальна');
  }

  const writtenTotal = results.reduce((sum, result) => sum + result.written.length, 0);
  const skippedTotal = chain.reduce((sum, current) => sum + current.willSkip.length, 0);

  if (writtenTotal === 0 && skippedTotal > 0) {
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

  const conflictSkips = chain.reduce(
    (sum, current) => sum + current.willSkip.filter((f) => f.action === 'skip-conflict').length,
    0,
  );
  if (conflictSkips > 0) {
    printWarning(
      `Пропущено файлов по конфликту: ${conflictSkips} — используйте --force для перезаписи`,
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
