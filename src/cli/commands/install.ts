/**
 * Команда `vb install` (VL-337, doc-25 §2.3, §4.3): доставка файлов
 * компонента из реестра в проект.
 *
 * Команда — тонкая оболочка над `core/install-chain.ts` (VL-390): разбирает
 * флаги, спрашивает пользователя про конфликты, печатает план/итог и
 * выставляет код выхода. Вся последовательность установки (включая
 * `registryDependencies` и единую транзакцию записи) живёт в ядре — тем же
 * оркестратором пользуется `vb create` для компонентов шаблона, поэтому
 * расхождение путей невозможно.
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
  diffLines,
  forceOverwrite,
  isAllConflictsSkipped,
  resolveConflicts,
  resolveInstallContext,
  skipAllConflicts,
} from '../../core/install.js';
import type { InstallContext, InstallPlan, InstallPlanFile } from '../../core/install.js';
import { formatCommand } from '../../core/install-deps.js';
import type { DepsRunner } from '../../core/install-deps.js';
import { installWithDeps } from '../../core/install-chain.js';
import type { ConflictStrategy, InstallChainOutcome } from '../../core/install-chain.js';
import type { OwnershipEntry } from '../../core/install-registry-deps.js';
import { RATE_LIMIT_BUDGET_MS } from '../../core/gitverse-http.js';
import type { ProgressCallback, ProgressEvent } from '../../core/gitverse-http.js';
import { readTokenWithSource } from '../../core/gitverse-auth.js';

/** Известные флаги команды: неизвестный флаг — ошибка использования (код 1). */
const KNOWN_FLAGS = new Set(['yes', 'force', 'dry-run', 'branch', 'verbose', 'help', 'h']);

/** Опции команды после разбора флагов. */
interface InstallOptions {
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  branch?: string;
  /** `--verbose`: URL, статус, попытка и причина повтора (VL-381). */
  verbose: boolean;
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
        `неизвестный флаг «--${key}»; поддерживаются: --yes, --force, --dry-run, --branch <b>, --verbose`,
        1,
      );
    }
  }
  const branch = getFlag(flags, 'branch', '');
  // Алиас -v НЕ вводим: в роутере `-v` перехватывается как --version ещё до
  // команды, поэтому такой «алиас» молча печатал бы версию вместо прогресса.
  return {
    yes: flags.yes === true,
    force: flags.force === true,
    dryRun: flags['dry-run'] === true,
    verbose: flags.verbose === true,
    ...(branch !== '' ? { branch } : {}),
  };
}

/** Печатает строку прогресса в stderr: stdout остаётся машиночитаемым (AC7). */
function writeProgressLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Источник токена словами (для `--verbose`). */
function tokenSourceLabel(source: 'env' | 'file' | 'none'): string {
  if (source === 'env') return 'из окружения';
  if (source === 'file') return 'из .env';
  return 'нет';
}

/** Опции печати прогресса `vb install` (VL-381). */
export interface InstallProgressOptions {
  /** `--verbose`: URL, статусы, причины повторов. */
  verbose: boolean;
  /** Есть ли токен GitVerse (для диагностики 429). */
  hasToken: boolean;
  /** Суммарный бюджет ожидания на 429, мс — попадает в оценку «суммарно до N с». */
  rateLimitBudgetMs?: number;
  /** Куда писать (по умолчанию — stderr; инъекция для тестов). */
  write?: (line: string) => void;
}

/**
 * Создаёт обработчик прогресса сетевых операций (VL-381).
 *
 * Зачем отдельная функция: одинаковые события транспорта должны выглядеть
 * по-разному в обычном и `--verbose`-режиме, а предупреждение про 429 —
 * выйти РОВНО ОДИН раз на весь запуск (иначе три паузы дают три копии текста).
 *
 * Жёсткие инварианты:
 * - только stderr: `--dry-run` парсится скриптами, а stdout занят планом;
 * - токен не печатается никогда — максимум «из .env»/«из окружения»/«нет»;
 * - без `--verbose` на одну сетевую операцию приходится одна строка
 *   («скачиваю …» печатает вызывающий код), плюс строки ожидания при повторе.
 */
export function createProgressPrinter(options: InstallProgressOptions): ProgressCallback {
  const write = options.write ?? writeProgressLine;
  const budgetSeconds = Math.round((options.rateLimitBudgetMs ?? RATE_LIMIT_BUDGET_MS) / 1000);
  let warnedRateLimit = false;

  return (event: ProgressEvent): void => {
    if (event.kind === 'request') {
      if (options.verbose) {
        write(`→ GET ${event.url} (попытка ${event.attempt}/${event.attemptsMax})`);
      }
      return;
    }

    if (event.kind === 'response') {
      if (options.verbose) {
        const size = event.bytes === undefined ? '' : ` (${event.bytes} байт)`;
        write(`← ${event.status ?? '?'}${size}`);
      }
      return;
    }

    if (event.kind === 'error') {
      if (options.verbose) write(`⚠ ${event.message ?? 'ошибка запроса'}`);
      return;
    }

    // kind === 'waiting' — начинается пауза перед повтором.
    const delaySeconds = Math.round((event.delayMs ?? 0) / 1000);
    const attemptInfo = `попытка ${event.attempt}/${event.attemptsMax}`;

    if (event.reason === 'rate_limited') {
      if (!warnedRateLimit) {
        warnedRateLimit = true;
        // Диагностика СРАЗУ, а не после исчерпания попыток: иначе пользователь
        // три минуты не знает, помог бы токен (AC4/AC5).
        const cause = options.hasToken
          ? '⚠ GitVerse ограничивает запросы даже с токеном (429).'
          : '⚠ GitVerse ограничил анонимные запросы (429). Добавь GITVERSE_TOKEN в .env — авторизованные запросы лимитируются выше (https://gitverse.ru/settings/tokens).';
        write(
          `${cause} Жду ${delaySeconds} с (${attemptInfo}, суммарно до ${budgetSeconds} с).`,
        );
      }
      write(`→ жду ${delaySeconds} с (429, ${attemptInfo})…`);
      return;
    }

    if (options.verbose) {
      const reason = event.reason === 'server' ? '5xx' : 'сеть';
      write(`→ жду ${delaySeconds} с (${reason}, ${attemptInfo})…`);
    }
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
 * Вся последовательность установки (манифест → план → `registryDependencies`
 * → владение файлами → npm-зависимости → конфликты → одна транзакция) живёт
 * в `core/install-chain.ts` (VL-390): тем же оркестратором пользуется
 * `vb create` для компонентов шаблона. Здесь остаётся CLI-слой: флаги,
 * вопросы пользователю, печать плана и итога, код выхода.
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

  // VL-381: прогресс сетевых шагов идёт в stderr — stdout остаётся планом.
  const tokenInfo = readTokenWithSource(ctx.root);
  const progress = createProgressPrinter({
    verbose: options.verbose,
    hasToken: tokenInfo.token !== '',
  });
  if (options.verbose) {
    writeProgressLine(`токен: ${tokenSourceLabel(tokenInfo.source)}`);
  }

  // Печать плана — до вопроса про пакеты: пользователь должен видеть, что
  // именно ставится, прежде чем соглашаться на правку package.json.
  let plansPrinted = false;
  let depsDryRunMessage = false;

  const conflictStrategy: ConflictStrategy = async (plan, lock) => {
    if (options.force) {
      forceOverwrite(plan, lock);
      return;
    }
    if (options.yes || !isInteractive()) {
      // --yes без --force и не-TTY: пропускаем — иначе пользователь не
      // заметит, что компонент не установился.
      skipAllConflicts(plan, lock);
      return;
    }
    const prompts = createPromptSession();
    try {
      const decisions = await askConflicts(plan, prompts);
      resolveConflicts(plan, decisions, lock);
    } finally {
      prompts.close();
    }
  };

  let outcome: InstallChainOutcome;
  try {
    outcome = await installWithDeps({
      root: ctx.root,
      config: ctx.config,
      lock: ctx.lock,
      ref: ctx.ref,
      ...(options.branch ? { branch: options.branch } : {}),
      fetchOptions: { onProgress: progress },
      dryRun: options.dryRun,
      onConflict: conflictStrategy,
      hooks: {
        onBeforeItem: (ref) => writeProgressLine(`→ скачиваю ${ref}…`),
        onBeforeContents: (item) => writeProgressLine(`→ скачиваю файлы (${item.files.length})…`),
        onPlanReady: (info) => {
          for (let i = 0; i < info.plans.length; i += 1) {
            printPlan(info.plans[i], options.dryRun, info.reuses);
          }
          for (const note of info.warnings) printWarning(note.message);
          for (const name of info.alreadyInstalled) {
            printInfo(`Зависимость реестра «${name}» уже установлена — не переустанавливаем`);
          }
          plansPrinted = true;
          if (info.missing.length === 0) return;
          printInfo(
            `Зависимости: отсутствуют ${info.missing.length} (${info.missing.join(', ')}), команда: ${formatCommand(info.command)}`,
          );
          if (options.dryRun) {
            depsDryRunMessage = true;
            printInfo('Режим --dry-run: пакеты не устанавливаются.');
          }
        },
      },
      deps: {
        ...(deps.runner !== undefined ? { runner: deps.runner } : {}),
        confirm: async (missing) => {
          // --yes означает «без вопросов», а не «правь package.json»:
          // молчаливая установка зависимостей недопустима (решение задачи).
          if (options.dryRun || options.yes || !isInteractive()) return false;
          const prompts = createPromptSession();
          try {
            return await prompts.askConfirm(`Установить отсутствующие пакеты (${missing.length})?`, true);
          } finally {
            prompts.close();
          }
        },
      },
    });
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      printInfo('Отменено. Файлы не изменены.');
      process.exitCode = 5;
      return;
    }
    return fail(err);
  }

  // --- Секция npm-зависимостей: итог после попытки установки ---
  const depsOutcome = outcome.deps;
  if (depsOutcome.run !== undefined) {
    const run = depsOutcome.run;
    if (run.fallbackFrom) {
      printWarning(`Пакетный менеджер «${run.fallbackFrom}» не найден — использован npm`);
    }
    if (run.ok) {
      printSuccess(`Установлены пакеты: ${depsOutcome.confirmed.join(', ')}`);
    } else {
      printWarning(
        `Зависимости не установлены (${run.error ?? 'ненулевой код выхода'}): компонент может не работать`,
      );
    }
  } else if (depsOutcome.missing.length > 0 && !depsDryRunMessage) {
    if (options.yes || !isInteractive()) {
      printWarning(
        `Зависимости не установлены (--yes/не-TTY): выполните вручную «${formatCommand(depsOutcome.command)}» — без них компонент может не работать`,
      );
    } else {
      printWarning(
        `Зависимости не установлены: выполните вручную «${formatCommand(depsOutcome.command)}» — без них компонент может не работать`,
      );
    }
  }

  const chain = outcome.plans;
  const depPlans = chain.slice(0, outcome.depCount);
  const plan = chain[chain.length - 1];
  if (!plansPrinted) return fail(new InstallError('план установки не построен', 3));

  if (options.dryRun) {
    // Ни temp-каталога, ни записи: план уже посчитан, выходим с 0.
    printInfo('Режим --dry-run: файлы не изменялись.');
    process.exitCode = 0;
    return;
  }

  // --- Итоговый блок ---
  const results = outcome.results;
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
  for (const entry of outcome.reuses) {
    printInfo(`Файл переиспользован из «${entry.owner}»: ${entry.relPath}`);
  }
  for (const item of outcome.transferred) {
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
