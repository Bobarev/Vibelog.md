/**
 * Разрешение `registryDependencies` элемента реестра (VL-338, doc-25 §1.2,
 * §3.3, §4.3 шаг 5) и правило владения файлами (§3.2).
 *
 * Элемент может ссылаться на другие элементы (`["vibelog.md/ui/base"]`).
 * Отсутствующие в `installed.lock.json` устанавливаются ДО самого элемента —
 * иначе компонент окажется в проекте без `utils.ts`, на который ссылается.
 *
 * Почему ровно один уровень (doc-25 §1.2). Полное рекурсивное разрешение —
 * это обход графа с обнаружением циклов и топологической сортировкой. Для
 * первой версии (четыре компонента, все зависят от `base`) это избыточно, а
 * цена ошибки в сортировке — неверный порядок записи файлов. Ограничение
 * явное: если у зависимости есть свои `registryDependencies`, выводится
 * предупреждение, а не тихая установка «полурабочего» набора.
 *
 * Почему владение файлами вынесено сюда. `base` содержит `utils.ts`, на
 * который ссылаются все компоненты. Без правила «файл принадлежит ровно
 * одному элементу» lock получил бы двух владельцев одного пути, и `vb update`
 * (будущий) не смог бы понять, чью версию обновлять. Совпадающий хеш —
 * переиспользование (запись не дублируется), расхождение — конфликт по
 * правилам VL-337.
 */

import { InstallError, buildInstallPlan, fetchInstallContents, fetchInstallItem } from './install.js';
import type { InstallContext, InstallFetchOptions, InstallPlan } from './install.js';
import type { ComponentsConfig, LockFile } from './components-config.js';

/** Разобранная ссылка на элемент реестра. */
export interface RegistryRef {
  alias: string;
  repo: string;
  name: string;
}

/** Предупреждение/пропуск при разрешении зависимостей. */
export interface RegistryDepNote {
  /** Ссылка, к которой относится сообщение. */
  ref: string;
  /** Текст для вывода. */
  message: string;
}

/** Результат разрешения `registryDependencies`. */
export interface RegistryDepsResult {
  /** Планы зависимостей в порядке объявления (применяются до самого элемента). */
  plans: InstallPlan[];
  /** Уже установленные зависимости (не переустанавливаются). */
  alreadyInstalled: string[];
  /** Предупреждения: второй уровень, циклы, расхождение версий. */
  warnings: RegistryDepNote[];
}

/** Опции разрешения зависимостей. */
export interface RegistryDepsOptions {
  /** Корень проекта. */
  root: string;
  config: ComponentsConfig;
  lock: LockFile;
  /** Контекст элемента-источника: alias/repo/branch/registry. */
  ctx: InstallContext;
  /** Опции сетевых вызовов (инъекция в тестах). */
  fetchOptions?: InstallFetchOptions;
  /** Текущая глубина: 0 — зависимости самого элемента. */
  depth?: number;
}

/**
 * Разбирает ссылку `<alias>/<repo>/<name>`.
 *
 * Ошибка содержит элемент-источник: без него пользователь видит «неверный
 * формат пути» и не понимает, чей это манифест.
 */
export function parseRegistryRef(ref: string, sourceRef = ''): RegistryRef {
  const value = String(ref ?? '').trim();
  const parts = value.split('/');
  const where = sourceRef === '' ? '' : ` в элементе «${sourceRef}»`;
  if (parts.length !== 3 || parts.some((part) => part.trim() === '')) {
    throw new InstallError(
      `неверная ссылка на зависимость «${value}»${where}: ожидалось <alias>/<repo>/<name>, например vibelog.md/ui/base`,
      3,
    );
  }
  return { alias: parts[0], repo: parts[1], name: parts[2] };
}

/**
 * Разрешает `registryDependencies` элемента на один уровень.
 *
 * Для каждой ссылки:
 * - уже в lock → не переустанавливаем; версию сверяем с реестром и при
 *   расхождении предупреждаем (обновление — задача `vb update`);
 * - нет в lock → скачиваем элемент и его файлы, строим план (VL-337);
 * - `depth >= 1` → дальше не идём: у зависимости с собственными
 *   `registryDependencies` выводим предупреждение;
 * - повторное имя в пределах вызова → предупреждение о цикле, без рекурсии.
 */
export async function resolveRegistryDeps(
  item: { name: string; registryDependencies: string[] },
  options: RegistryDepsOptions,
): Promise<RegistryDepsResult> {
  const { root, config, lock, ctx } = options;
  const depth = options.depth ?? 0;
  const result: RegistryDepsResult = { plans: [], alreadyInstalled: [], warnings: [] };

  // Второй уровень не разрешается (doc-25 §1.2): у зависимости с собственными
  // зависимостями предупреждаем и останавливаемся.
  if (depth >= 1) return result;

  const visited = new Set<string>([item.name]);

  for (const rawRef of item.registryDependencies) {
    const ref = parseRegistryRef(rawRef, ctx.ref);
    // v1: только элементы того же реестра. Ссылка на чужой репозиторий
    // означала бы другой owner/branch — это отдельный механизм, которого нет.
    if (ref.alias !== ctx.alias) {
      throw new InstallError(
        `зависимость «${rawRef}» элемента «${ctx.ref}» указывает на другой реестр «${ref.alias}»: в v1 разрешены только элементы реестра «${ctx.alias}»`,
        3,
      );
    }
    if (visited.has(ref.name)) {
      result.warnings.push({
        ref: rawRef,
        message: `циклическая ссылка ${item.name} → ${ref.name} → ${item.name}: второй уровень не разрешается (v1)`,
      });
      continue;
    }
    visited.add(ref.name);

    const depCtx: InstallContext = {
      ...ctx,
      repo: ref.repo,
      name: ref.name,
      ref: `${ref.alias}/${ref.repo}/${ref.name}`,
    };

    const locked = lock.components[ref.name];
    if (locked) {
      result.alreadyInstalled.push(ref.name);
      // Версию сверяем только если манифест доступен: сетевой сбой не должен
      // отменять установку уже стоящего элемента.
      try {
        const depItem = await fetchInstallItem(depCtx, options.fetchOptions ?? {});
        if (depItem.version !== locked.version) {
          result.warnings.push({
            ref: rawRef,
            message: `зависимость «${ref.name}» установлена в версии ${locked.version}, в реестре ${depItem.version}: не переустанавливаем (обновление — vb update)`,
          });
        }
      } catch {
        result.warnings.push({
          ref: rawRef,
          message: `не удалось проверить версию зависимости «${ref.name}» в реестре: оставляем установленную ${locked.version}`,
        });
      }
      continue;
    }

    const depItem = await fetchInstallItem(depCtx, options.fetchOptions ?? {});
    if (depItem.registryDependencies.length > 0) {
      // Цикл A → B → A: зависимость ссылается обратно на элемент из цепочки.
      // Отдельное сообщение важнее общего «второй уровень»: пользователь
      // должен понять, что граф замкнут, а не просто «глубоко вложен».
      const backRefs = depItem.registryDependencies.filter((raw) => {
        try {
          return visited.has(parseRegistryRef(raw, depCtx.ref).name);
        } catch {
          return false;
        }
      });
      if (backRefs.length > 0) {
        const back = parseRegistryRef(backRefs[0], depCtx.ref).name;
        result.warnings.push({
          ref: rawRef,
          message: `циклическая ссылка ${item.name} → ${ref.name} → ${back}: второй уровень не разрешается (v1)`,
        });
      } else {
        result.warnings.push({
          ref: rawRef,
          message: `у зависимости «${ref.name}» есть свои registryDependencies (${depItem.registryDependencies.join(', ')}): зависимости второго уровня не разрешаются (v1)`,
        });
      }
    }
    const contents = await fetchInstallContents(depCtx, depItem, options.fetchOptions ?? {});
    result.plans.push(buildInstallPlan(root, config, lock, depItem, contents, depCtx.ref));
  }

  return result;
}

/** Вид связи файла с уже установленным элементом. */
export type OwnershipKind = 'reuse' | 'conflict';

/** Запись о владении файлом. */
export interface OwnershipEntry {
  /** Относительный путь файла. */
  relPath: string;
  kind: OwnershipKind;
  /** Элемент, который уже владеет файлом. */
  owner: string;
  /** Хеш файла у текущего владельца. */
  ownerHash: string;
  /** Хеш файла в плане нового элемента. */
  planHash: string;
}

/** Результат проверки владения. */
export interface OwnershipResult {
  /** Файлы, переиспользуемые у другого элемента (запись не дублируется). */
  reuses: OwnershipEntry[];
  /** Файлы с расхождением хешей — требуют решения по правилам VL-337. */
  conflicts: OwnershipEntry[];
}

/**
 * Проверяет, не принадлежат ли файлы плана другому элементу.
 *
 * Совпадающий хеш — переиспользование: файл не перезаписывается, запись
 * остаётся у первого владельца, в lock нового элемента путь НЕ попадает
 * (doc-25 §3.2: файл принадлежит ровно одному элементу).
 *
 * Расхождение — конфликт: файл помечается `conflict` и попадает в
 * `plan.conflicts`, дальше работает обычное разрешение VL-337 (`--force`,
 * вопрос, пропуск).
 */
export function checkFileOwnership(lock: LockFile, plan: InstallPlan): OwnershipResult {
  const result: OwnershipResult = { reuses: [], conflicts: [] };
  const owners = new Map<string, { owner: string; hash: string }>();
  for (const [name, entry] of Object.entries(lock.components)) {
    if (name === plan.item.name) continue;
    for (const [relPath, file] of Object.entries(entry.files)) {
      owners.set(relPath, { owner: name, hash: file.hash });
    }
  }

  for (const file of plan.files) {
    const owner = owners.get(file.relPath);
    if (!owner) continue;
    const entry: OwnershipEntry = {
      relPath: file.relPath,
      kind: owner.hash === file.contentHash ? 'reuse' : 'conflict',
      owner: owner.owner,
      ownerHash: owner.hash,
      planHash: file.contentHash,
    };
    if (entry.kind === 'reuse') {
      result.reuses.push(entry);
      // Запись родителя не создаётся: владелец файла — первый элемент.
      file.reusedFrom = owner.owner;
      // Файл на диске уже совпадает — писать нечего. Если файла нет (его
      // удалили), план остаётся `create`: восстановим содержимое, но
      // владельцем по-прежнему останется первый элемент.
      if (file.action === 'conflict') file.action = 'skip-identical';
      continue;
    }
    result.conflicts.push(entry);
    if (file.action !== 'conflict') file.action = 'conflict';
  }

  plan.conflicts = plan.files.filter((file) => file.action === 'conflict');
  return result;
}

/**
 * Проверяет владение файлами для всей цепочки планов (VL-338).
 *
 * Отличие от `checkFileOwnership` в том, что учитываются не только записи
 * `installed.lock.json`, но и планы, идущие РАНЬШЕ в цепочке: `base` ещё не
 * в lock, но его `utils.ts` уже запланирован, и `card` обязан увидеть его
 * владельцем. Иначе один и тот же путь попал бы в два плана, и второй
 * `rename` упал бы на отсутствующем staged-файле.
 */
export function checkChainOwnership(lock: LockFile, chain: InstallPlan[]): OwnershipResult {
  const result: OwnershipResult = { reuses: [], conflicts: [] };
  const virtual: LockFile = {
    schemaVersion: lock.schemaVersion,
    components: { ...lock.components },
  };
  const planned = new Map<string, string>();

  for (const plan of chain) {
    const own = checkFileOwnership(virtual, plan);
    result.reuses.push(...own.reuses);
    result.conflicts.push(...own.conflicts);

    // Дубли внутри цепочки: файл уже запланирован другим элементом.
    for (const file of plan.files) {
      const earlier = planned.get(file.relPath);
      if (earlier === undefined || earlier === plan.item.name) continue;
      file.reusedFrom = earlier;
      if (file.action === 'create' || file.action === 'overwrite') file.action = 'skip-identical';
    }
    for (const file of plan.files) {
      if (file.reusedFrom) continue;
      planned.set(file.relPath, plan.item.name);
    }
    virtual.components[plan.item.name] = plan.lockEntry;
  }

  return result;
}

/**
 * Передаёт владение файлами, которые были перезаписаны (`--force`/выбор
 * пользователя).
 *
 * Инвариант «файл принадлежит ровно одному элементу» важнее истории: если
 * новый элемент перезаписал файл, прежний владелец больше не может за него
 * отвечать, иначе `vb update` обновлял бы чужое содержимое. Учитываются и
 * записи lock, и планы той же цепочки (зависимость могла объявить тот же
 * файл раньше).
 */
export function transferOwnership(plans: InstallPlan[], lock: LockFile): string[] {
  const transferred: string[] = [];
  for (const plan of plans) {
    for (const file of plan.files) {
      if (file.action !== 'overwrite') continue;
      for (const [name, entry] of Object.entries(lock.components)) {
        if (name === plan.item.name) continue;
        if (!(file.relPath in entry.files)) continue;
        delete entry.files[file.relPath];
        transferred.push(`${file.relPath} (${name} → ${plan.item.name})`);
      }
      for (const other of plans) {
        if (other.item.name === plan.item.name) continue;
        if (!(file.relPath in other.lockEntry.files)) continue;
        delete other.lockEntry.files[file.relPath];
        transferred.push(`${file.relPath} (${other.item.name} → ${plan.item.name})`);
      }
    }
  }
  return transferred;
}
