/**
 * Общий оркестратор установки элемента реестра вместе с его
 * `registryDependencies` (VL-390, doc-25 §4.1 шаг 12, §4.3).
 *
 * Зачем модуль. Последовательность «скачать элемент → план → зависимости
 * реестра → владение файлами → npm-зависимости → конфликты → одна транзакция
 * записи» нужна ДВУМ путям: `vb install` (команда пользователя) и
 * `vb create` (компоненты шаблона после `postCreate`). Раньше она жила только
 * в CLI, а `installTemplateComponents` имела сокращённую копию — и ровно на
 * пропущенном шаге `resolveRegistryDeps` проект получал `button.svelte` без
 * `utils.ts` (VL-390). Копии расходятся молча, поэтому здесь одна
 * последовательность, а различающиеся шаги передаются функциями:
 *
 * - `onConflict` — стратегия конфликтов (`vb install` спрашивает или решает по
 *   `--force`/`--yes`, `vb create` в свежем проекте просто пропускает);
 * - `deps.confirm` — спрашивать ли разрешение на установку пакетов;
 * - `deps.onUnresolved` — неустановленные пакеты это предупреждение
 *   (`vb install` продолжает) или ошибка элемента (`vb create`: без `clsx`
 *   компонент не соберётся, и «установлено: button» было бы ложью).
 *
 * Модуль НЕ печатает ничего: план, прогресс и итог — забота CLI (`vb create`
 * пишет только своё предупреждение о неудачном компоненте). Это жёсткое
 * требование задачи: иначе `create` получил бы в вывод чужой текст.
 */

import { resolve } from 'node:path';

import { readLock } from './components-config.js';
import type { ComponentsConfig, LockFile } from './components-config.js';
import {
  InstallError,
  applyInstallChain,
  buildInstallPlan,
  fetchInstallContents,
  fetchInstallItem,
  parseInstallPath,
  recomputeInstallPlan,
  skipAllConflicts,
} from './install.js';
import type {
  InstallApplyResult,
  InstallContext,
  InstallFetchOptions,
  InstallPlan,
} from './install.js';
import {
  detectPackageManager,
  installCommand,
  missingDeps,
  readProjectDeps,
  runDepsInstall,
} from './install-deps.js';
import type { DepsRunner, DepsRunResult, PackageManager } from './install-deps.js';
import {
  checkChainOwnership,
  resolveRegistryDeps,
  transferOwnership,
} from './install-registry-deps.js';
import type { OwnershipEntry, RegistryDepNote } from './install-registry-deps.js';
import type { RegistryItem } from './registry-fetch.js';

/**
 * Стратегия разрешения конфликтов файлов.
 *
 * Получает план и текущий lock и меняет `action` файлов плана (обычно через
 * `resolveConflicts`/`forceOverwrite`/`skipAllConflicts`). Может быть
 * асинхронной: интерактивный вопрос пользователю — это `await`.
 */
export type ConflictStrategy = (plan: InstallPlan, lock: LockFile) => void | Promise<void>;

/** Настройки сверки и установки npm-зависимостей. */
export interface InstallDepsOptions {
  /**
   * Пакетный менеджер. Передаётся явно там, где он уже определён
   * (`vb create` ставил зависимости через `pm install`), чтобы не зависеть от
   * lock-файла в только что скопированном каталоге.
   */
  pm?: PackageManager;
  /** Инъекция раннера пакетного менеджера (тесты). */
  runner?: DepsRunner;
  /**
   * Спросить разрешение на установку пакетов. Не задано — пакеты не
   * устанавливаются (только сообщаем список и команду).
   */
  confirm?: (missing: string[], command: string[]) => boolean | Promise<boolean>;
  /**
   * Что делать, если пакеты остались неустановленными: `warn` — сообщить
   * вызывающему (поле `deps.error`), `throw` — ошибка установки элемента.
   */
  onUnresolved?: 'warn' | 'throw';
}

/** Итог установки npm-зависимостей цепочки. */
export interface InstallDepsOutcome {
  /** Отсутствующие в проекте пакеты (объединение по всей цепочке). */
  missing: string[];
  /** Пакеты, установка которых подтверждена (попадут в lock). */
  confirmed: string[];
  pm: PackageManager;
  /** Готовая команда установки (`[bin, ...args]`). */
  command: string[];
  /** Фактический запуск пакетного менеджера (нет — не запускали). */
  run?: DepsRunResult;
  /** Причина, по которой пакеты не установлены. */
  error?: string;
}

/** Хуки прогресса: ядро не печатает, но CLI нужен момент «скачиваю …». */
export interface InstallChainHooks {
  /** Перед запросом манифеста элемента. */
  onBeforeItem?: (ref: string) => void;
  /** Перед загрузкой файлов элемента (манифест уже получен). */
  onBeforeContents?: (item: RegistryItem, isDependency: boolean) => void;
  /**
   * Планы готовы, конфликты разрешены — CLI печатает план и секцию
   * npm-зависимостей ДО того, как спросить про установку пакетов.
   */
  onPlanReady?: (info: InstallPlanReadyInfo) => void;
}

/** Данные для печати плана (см. `InstallChainHooks.onPlanReady`). */
export interface InstallPlanReadyInfo {
  item: RegistryItem;
  plans: InstallPlan[];
  depCount: number;
  reuses: OwnershipEntry[];
  alreadyInstalled: string[];
  warnings: RegistryDepNote[];
  missing: string[];
  command: string[];
  pm: PackageManager;
}

/** Опции установки элемента с зависимостями. */
export interface InstallWithDepsOptions {
  /** Корень проекта (НЕ git-корень: `vb create` не должен уходить в родителя). */
  root: string;
  config: ComponentsConfig;
  lock: LockFile;
  /** Ссылка `<alias>/<repo>/<name>`. */
  ref: string;
  /** Ветка (приоритетнее `registries[alias].branch`). */
  branch?: string;
  /** Опции сетевых вызовов (инъекция в тестах). */
  fetchOptions?: InstallFetchOptions;
  /** Стратегия конфликтов; по умолчанию все конфликты пропускаются. */
  onConflict?: ConflictStrategy;
  /** Сверка и установка npm-зависимостей. */
  deps?: InstallDepsOptions;
  /** Хуки прогресса для CLI-слоя. */
  hooks?: InstallChainHooks;
  /** Ничего не писать: только посчитать план и список зависимостей. */
  dryRun?: boolean;
}

/** Итог установки цепочки. */
export interface InstallChainOutcome {
  /** Скачанный манифест элемента. */
  item: RegistryItem;
  /** Планы в порядке применения: зависимости реестра, затем сам элемент. */
  plans: InstallPlan[];
  /** Сколько первых планов — зависимости реестра (`plans.length - 1` обычно). */
  depCount: number;
  /** Файлы, переиспользованные у других элементов. */
  reuses: OwnershipEntry[];
  /** Зависимости, уже стоявшие в lock (не переустанавливались). */
  alreadyInstalled: string[];
  /** Предупреждения разрешения зависимостей (циклы, второй уровень, версии). */
  warnings: RegistryDepNote[];
  /** Итог по npm-зависимостям. */
  deps: InstallDepsOutcome;
  /** Переданное владение файлами (`путь (было → стало)`). */
  transferred: string[];
  /** Результаты применения по каждому плану (пусто при `dryRun`). */
  results: InstallApplyResult[];
  /** Lock после установки — его и нужно передавать следующему элементу. */
  lock: LockFile;
}

/**
 * Устанавливает элемент реестра вместе с цепочкой его зависимостей.
 *
 * Порядок шагов совпадает с doc-25 §4.3 (шаги 3–11) и одинаков для `vb
 * install` и компонентов шаблона `vb create`:
 * манифест → файлы → план → `resolveRegistryDeps` → владение файлами →
 * npm-зависимости → конфликты → один `applyInstallChain`.
 *
 * Ошибка любого шага — исключение (`InstallError` с кодом из doc-25 §5.2):
 * частично применённая цепочка недопустима.
 */
export async function installWithDeps(
  options: InstallWithDepsOptions,
): Promise<InstallChainOutcome> {
  const { config, ref } = options;
  const dryRun = options.dryRun === true;
  const root = resolve(options.root);
  const { alias, repo, name } = parseInstallPath(ref);

  const registry = config.registries[alias];
  if (!registry) {
    const available = Object.keys(config.registries);
    throw new InstallError(
      available.length > 0
        ? `неизвестный реестр «${alias}»; доступны: ${available.join(', ')}`
        : `неизвестный реестр «${alias}»: в секции components нет ни одного реестра — выполните «vb init --components»`,
      2,
    );
  }
  const branch =
    options.branch !== undefined && options.branch.trim() !== ''
      ? options.branch.trim()
      : registry.branch;
  const ctx: InstallContext = {
    root,
    config,
    lock: options.lock,
    alias,
    repo,
    name,
    branch,
    registry,
    ref,
  };

  // --- Манифест и файлы элемента (сеть/данные — код 3) ---
  const fetchOptions = options.fetchOptions ?? {};
  options.hooks?.onBeforeItem?.(ref);
  const item = await fetchInstallItem(ctx, fetchOptions);
  options.hooks?.onBeforeContents?.(item, false);
  const contents = await fetchInstallContents(ctx, item, fetchOptions);
  const plan = buildInstallPlan(root, config, options.lock, item, contents, ref);

  // --- registryDependencies: один уровень, ДО самого элемента (шаг 5) ---
  const resolved = await resolveRegistryDeps(item, {
    root,
    config,
    lock: options.lock,
    ctx,
    fetchOptions,
  });
  const chain: InstallPlan[] = [...resolved.plans, plan];

  // --- Владение файлами (doc-25 §3.2): проверяется вся цепочка сразу ---
  const ownership = checkChainOwnership(options.lock, chain);

  // --- npm-зависимости: сверка с package.json (шаг 6) ---
  const projectDeps = readProjectDeps(root);
  const missing: string[] = [];
  for (const current of chain) {
    for (const dep of missingDeps(current.item, projectDeps)) {
      if (!missing.includes(dep)) missing.push(dep);
    }
  }
  const depsOptions = options.deps ?? {};
  const pm = depsOptions.pm ?? detectPackageManager(root);
  const depsOutcome: InstallDepsOutcome = {
    missing,
    confirmed: [],
    pm,
    command: installCommand(pm, missing),
  };

  // --- Разрешение конфликтов (doc-25 §4.3 шаг 8) ---
  // В dry-run конфликты НЕ разрешаются: план обязан показать их как есть.
  if (!dryRun) {
    const strategy = options.onConflict ?? skipAllConflicts;
    for (const current of chain) {
      if (current.conflicts.length === 0) continue;
      await strategy(current, options.lock);
    }
  }

  // Планы готовы — CLI печатает их и секцию npm-зависимостей ДО вопроса об
  // установке пакетов (порядок вывода `vb install` не должен измениться).
  options.hooks?.onPlanReady?.({
    item,
    plans: chain,
    depCount: resolved.plans.length,
    reuses: ownership.reuses,
    alreadyInstalled: resolved.alreadyInstalled,
    warnings: resolved.warnings,
    missing,
    command: depsOutcome.command,
    pm,
  });

  if (!dryRun && missing.length > 0) {
    const agreed = depsOptions.confirm
      ? await depsOptions.confirm(missing, depsOutcome.command)
      : false;
    if (agreed) {
      const run = runDepsInstall(pm, missing, root, depsOptions.runner);
      depsOutcome.run = run;
      if (run.ok) {
        // Код 0 — авторитетный признак установки: пакетные менеджеры пишут
        // package.json сами, а мок-раннер в тестах этого не делает, поэтому
        // состав берём из запроса, а не из повторного чтения файла.
        depsOutcome.confirmed = [...missing];
      } else {
        depsOutcome.error = run.error ?? 'ненулевой код выхода';
      }
    } else {
      depsOutcome.error = 'установка пакетов не подтверждена';
    }
  } else if (!dryRun && missing.length > 0) {
    depsOutcome.error = 'установка пакетов не подтверждена';
  }

  const unresolved = depsOutcome.missing.filter((dep) => !depsOutcome.confirmed.includes(dep));
  if (unresolved.length > 0 && depsOptions.onUnresolved === 'throw') {
    // Формулировка называет и элемент, и пакеты: вызывающий (`vb create`)
    // кладёт этот текст в `failed[]` и показывает пользователю.
    throw new InstallError(
      `элемент «${ref}»: не установлены npm-зависимости ${unresolved.join(', ')} (${depsOutcome.error ?? 'не подтверждено'}) — без них компонент не соберётся`,
      3,
    );
  }

  // --- Финальный пересчёт планов и передача владения ---
  let transferred: string[] = [];
  if (!dryRun) {
    const now = new Date().toISOString();
    for (const current of chain) {
      const own = current.item.dependencies.filter((dep) => depsOutcome.confirmed.includes(dep));
      // Пустой список не передаём: иначе повторная установка затрёт уже
      // записанные в lock зависимости (идемпотентность, AC8 VL-337).
      recomputeInstallPlan(current, options.lock, now, own.length > 0 ? own : undefined);
    }
    transferred = transferOwnership(chain, options.lock);
  }

  // --- Запись всей цепочки одной транзакцией ---
  let results: InstallApplyResult[] = [];
  let nextLock = options.lock;
  if (!dryRun) {
    results = applyInstallChain(root, config, options.lock, chain);
    // Lock перечитывается с диска: вызывающий может ставить несколько
    // элементов подряд, и второй обязан видеть записи первого (иначе `base`,
    // установленный как зависимость `button`, поставится ещё раз).
    nextLock = readLock(root, config);
  }

  return {
    item,
    plans: chain,
    depCount: resolved.plans.length,
    reuses: ownership.reuses,
    alreadyInstalled: resolved.alreadyInstalled,
    warnings: resolved.warnings,
    deps: depsOutcome,
    transferred,
    results,
    lock: nextLock,
  };
}
