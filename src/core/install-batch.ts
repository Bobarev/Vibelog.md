/**
 * Пакетная установка нескольких компонентов одной командой (VL-424,
 * doc-25 §2.3): валидация рефов ДО сети, последовательный оркестратор
 * батча с тредингом lock, стоп на первой ошибке и агрегация кодов выхода.
 *
 * Зачем модуль. `vb install` читал только `positional[0]` и НЕ проверял их
 * число: второй аргумент молча игнорировался, и пользователь получал ложное
 * «оба установились» — та же семантика, что чинили в parseOptions
 * (молчаливо проигнорированный `--forse`). Здесь цикл по образцу
 * `installTemplateComponents` (create.ts), но со стратегией `vb install`.
 *
 * Почему ядро, а не CLI (решение при проектировании): только здесь есть
 * тестовая инфраструктура с HTTP-фикстур-сервером; CLI остаётся
 * печатью/вопросами/кодами выхода.
 *
 * Стоп на ошибке ≠ continue у `installTemplateComponents` — ОСОЗНАННОЕ
 * расхождение семантик, не унифицировать: там проект уже создан и ошибка
 * одного компонента не должна его «уронить», здесь ненулевой код =
 * «что-то не так» (предсказуемо для скриптов), сводка показывает, что
 * установлено, повтор добирает.
 *
 * Батч-атомарности (всё или ничего) НЕТ: каждый элемент — отдельная
 * транзакция `applyInstallChain` (файлы элемента k+1 планируются против
 * lock после элемента k), повтор идемпотентен.
 */

import type { ComponentsConfig, LockFile } from './components-config.js';
import {
  InstallError,
  isAllConflictsSkipped,
  parseInstallPath,
  resolveInstallContext,
} from './install.js';
import type { InstallContext, InstallFetchOptions } from './install.js';
import { installWithDeps } from './install-chain.js';
import type {
  ConflictStrategy,
  InstallChainHooks,
  InstallChainOutcome,
  InstallDepsOptions,
} from './install-chain.js';

/** Результат валидации списка рефов (вызывается ДО сетевых запросов). */
export interface ValidatedInstallRefs {
  /** Уникальные рефы в порядке аргументов командной строки. */
  refs: string[];
  /** Повторяющиеся рефы (в порядке появления) — CLI печатает предупреждение. */
  duplicates: string[];
  /** Корень проекта (git-корень, иначе cwd). */
  root: string;
  config: ComponentsConfig;
  lock: LockFile;
}

/** Опции валидации рефов. */
export interface ValidateInstallRefsOptions {
  /** Ветка (`--branch`) — одна на весь батч. */
  branch?: string;
}

/**
 * Валидирует все рефы батча до первого сетевого вызова.
 *
 * По каждому рефу: `parseInstallPath` (код 1, с номером проблемного
 * аргумента) → `resolveInstallContext` (код 2: нет секции components,
 * неизвестный alias — там уже есть список доступных). Ни одна из операций
 * не трогает сеть, поэтому опечатка в последнем аргументе не даёт частичной
 * установки (AC2). Дубликаты дедуплицируются с сохранением порядка.
 */
export function validateInstallRefs(
  cwd: string,
  rawRefs: string[],
  options: ValidateInstallRefsOptions = {},
): ValidatedInstallRefs {
  // Пустой список — ошибка использования с подсказкой формата в
  // множественной форме (рефов может быть несколько). Пустая строка внутри
  // списка не отфильтровывается молча: parseInstallPath отклонит её с кодом 1
  // и номером аргумента — иначе «vb install '' base» установил бы base,
  // «забыв» про пустой аргумент.
  if (rawRefs.length === 0) {
    throw new InstallError(
      'не указаны компоненты: ожидалось «vb install <alias>/<repo>/<name> [<alias>/<repo>/<name>…]», например vibelog.md/ui/base vibelog.md/ui/button',
      1,
    );
  }

  const refs: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  let context: InstallContext | undefined;

  for (let i = 0; i < rawRefs.length; i += 1) {
    const raw = rawRefs[i];
    const label = `компонент ${i + 1} («${raw}»)`;
    let normalized: string;
    try {
      const { alias, repo, name } = parseInstallPath(raw);
      normalized = `${alias}/${repo}/${name}`;
    } catch (err) {
      if (err instanceof InstallError && err.code === 1) {
        // Номер аргумента обязателен: в батче из трёх рефов «неверный формат
        // пути» без позиции не говорит, какой именно реф битый (AC2).
        throw new InstallError(
          `${label}: ожидалось <alias>/<repo>/<name>, например vibelog.md/ui/button`,
          1,
        );
      }
      throw err;
    }
    // Дедупликация после парса, до контекста: второй раз не выполняется —
    // и дубликат, и оригинал приводят к одному и тому же установщику.
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }
    try {
      const current = resolveInstallContext(
        cwd,
        raw,
        options.branch !== undefined ? { branch: options.branch } : {},
      );
      context ??= current;
      seen.add(normalized);
      refs.push(normalized);
    } catch (err) {
      if (err instanceof InstallError) {
        throw new InstallError(`${label}: ${err.message}`, err.code);
      }
      throw err;
    }
  }

  // context определён: candidates непуст, первый реф всегда уникален
  // (seen пуст) и дошёл до resolveInstallContext.
  const { root, config, lock } = context as InstallContext;
  return { refs, duplicates, root, config, lock };
}

/** Хуки батча: прогресс-хуки элемента + поэлементный итог. */
export interface InstallBatchHooks extends InstallChainHooks {
  /**
   * Элемент установлен (или посчитан в dry-run) — CLI печатает поэлементный
   * итог («Записан: …», «Пропущен: …», строка lock) в привычном месте,
   * поэтому вывод одиночной установки побайтово прежний.
   */
  onElementDone?: (ref: string, outcome: InstallChainOutcome) => void;
}

/** Опции пакетной установки. */
export interface InstallBatchOptions {
  /** Корень проекта (НЕ git-корень: `vb create` не должен уходить в родителя). */
  root: string;
  config: ComponentsConfig;
  lock: LockFile;
  /** Рефы батча (после `validateInstallRefs`, порядок сохранён). */
  refs: string[];
  /** Ветка (`--branch`) — одна на весь батч. */
  branch?: string;
  /** Опции сетевых вызовов (инъекция в тестах). */
  fetchOptions?: InstallFetchOptions;
  /** Стратегия конфликтов; по умолчанию все конфликты пропускаются. */
  onConflict?: ConflictStrategy;
  /** Сверка и установка npm-зависимостей (одно замыкание на весь батч). */
  deps?: InstallDepsOptions;
  /** Хуки прогресса для CLI-слоя. */
  hooks?: InstallBatchHooks;
  /** Ничего не писать: только посчитать планы всех элементов. */
  dryRun?: boolean;
}

/** Итог установки одного элемента батча. */
export interface InstallBatchElement {
  ref: string;
  outcome: InstallChainOutcome;
}

/** Итог батча: либо все элементы установлены, либо стоп на первой ошибке. */
export interface InstallBatchResult {
  /** Успешно установленные элементы (порядок батча). */
  results: InstallBatchElement[];
  /** Первый элемент, на котором случилась InstallError (стоп). */
  failed?: { ref: string; error: InstallError };
  /** Lock после установки (при стопе — после последнего успешного элемента). */
  lock: LockFile;
}

/**
 * Устанавливает элементы батча последовательно, тредя lock между итерациями.
 *
 * Каждый элемент — отдельная транзакция `applyInstallChain`: `base`,
 * поставленный зависимостью `button`, виден следующему элементу и не
 * переустанавливается (механика проверена тестами VL-390).
 *
 * Стоп на первой `InstallError`: уже записанные элементы НЕ откатываются
 * (повтор идемпотентен и добирает). Любая другая ошибка (включая
 * `PromptCancelledError` из стратегии конфликтов) пробрасывается наружу —
 * CLI превращает отмену в код 5, а не в «failed».
 */
export async function installBatch(
  options: InstallBatchOptions,
): Promise<InstallBatchResult> {
  const { root, config, refs } = options;
  let lock = options.lock;
  const results: InstallBatchElement[] = [];
  // onElementDone вызывается зДЕСЬ (после успешного элемента), остальные
  // хуки форвардятся каждому installWithDeps как есть.
  const { onElementDone, ...chainHooks } = options.hooks ?? {};

  for (const ref of refs) {
    let outcome: InstallChainOutcome;
    try {
      outcome = await installWithDeps({
        root,
        config,
        lock,
        ref,
        ...(options.branch !== undefined ? { branch: options.branch } : {}),
        ...(options.fetchOptions !== undefined
          ? { fetchOptions: options.fetchOptions }
          : {}),
        ...(options.onConflict !== undefined
          ? { onConflict: options.onConflict }
          : {}),
        ...(options.deps !== undefined ? { deps: options.deps } : {}),
        ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        hooks: chainHooks,
      });
    } catch (err) {
      if (err instanceof InstallError) {
        // Стоп: частично установленные элементы не откатываем — сводка
        // показывает, что сделано, повтор добирает остаток (AC4).
        return { results, failed: { ref, error: err }, lock };
      }
      // Не-InstallError (PromptCancelledError и прочее) — наружу.
      throw err;
    }
    // Перечитываемый lock: `base`, установленный как зависимость `button`,
    // обязан быть виден следующему элементу (иначе он поставится дважды).
    lock = outcome.lock;
    results.push({ ref, outcome });
    onElementDone?.(ref, outcome);
  }

  return { results, lock };
}

/**
 * Агрегированный код выхода батча (doc-25 §5.2).
 *
 * Та же логика, что в конце `runInstall`, но по всем элементам:
 * - записан хоть один файл → 0 (успех, в том числе частичный);
 * - ничего не записано, файлы пропускались, и у КАЖДОГО элемента все файлы
 *   пропущены по конфликту → 4;
 * - иначе 0 («Уже установлено» / пусто).
 *
 * Вынесена в core ради теста: в CLI остаётся `process.exitCode = batchExitCode(...)`.
 */
export function batchExitCode(results: InstallBatchElement[]): 0 | 4 {
  let writtenTotal = 0;
  let skippedTotal = 0;
  for (const { outcome } of results) {
    for (const apply of outcome.results) writtenTotal += apply.written.length;
    for (const plan of outcome.plans) skippedTotal += plan.willSkip.length;
  }
  if (writtenTotal > 0) return 0;
  if (skippedTotal === 0) return 0;
  // Код 4 — только когда у каждого элемента последний план цепочки
  // (сам элемент) полностью пропущен по конфликту.
  for (const { outcome } of results) {
    const chain = outcome.plans;
    if (!isAllConflictsSkipped(chain[chain.length - 1])) return 0;
  }
  return 4;
}
