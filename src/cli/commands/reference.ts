/**
 * Команда `vibelog reference` — управление внешними источниками знаний (VL-152).
 *
 * Подкоманды:
 * - list — список references (фильтры --type, --tags)
 * - add <title> — добавить reference (для type=repo клонирует, --no-clone — без)
 * - view <id> — показать reference
 * - search <query> — поиск по references
 * - link <refId> <taskId> — двусторонняя связь с задачей (--remove — отвязать)
 * - remove <id> — удалить reference (клон в data/ сохраняется)
 * - sync — доклонировать отсутствующие репозитории (type=repo)
 *
 * Файлы: backlog/references/<id>-<slug>.md (YAML-фронтматтер + markdown).
 * Клоны: backlog/references/data/<dir> (в .gitignore).
 */

import { getFlag, getFlagArray, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { findBacklogDir } from '../../core/paths.js';
import {
  listReferences, getReference, writeReference,
  removeReference, searchReferences,
  cloneReferenceRepo, syncReferenceRepos, linkReferenceTask,
  REFERENCE_TYPES,
} from '../../core/reference.js';
import {
  cacheReference, refreshReferenceCache, readReferenceCache, syncReferenceCaches,
} from '../../core/reference-cache.js';

/**
 * Выполняет команду reference.
 *
 * @param subcommand — подкоманда (list/add/view/search/link/remove/sync)
 * @param positional — позиционные аргументы
 * @param flags — флаги CLI
 * @param cwd — рабочая директория (core-функции сами найдут backlog)
 */
export async function runReference(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list':
      return referenceList(flags, cwd);
    case 'add':
      return referenceAdd(positional, flags, cwd);
    case 'view':
      return referenceView(positional, cwd);
    case 'search':
      return referenceSearch(positional, cwd);
    case 'link':
      return referenceLink(positional, flags, cwd);
    case 'remove':
      return referenceRemove(positional, cwd);
    case 'sync':
      return referenceSync(positional, flags, cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: list, add, view, search, link, remove, sync');
  }
}

function referenceList(flags: FlagValues, cwd: string): void {
  let entries = listReferences(cwd);
  const typeFilter = getFlag(flags, 'type', '');
  if (typeFilter) {
    entries = entries.filter(e => e.reference.type === typeFilter.toLowerCase());
  }
  const tags = getFlagArray(flags, 'tags')
    .flatMap(t => t.split(',')).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (tags.length > 0) {
    entries = entries.filter(e =>
      tags.every(t => e.reference.tags.some(rt => String(rt).toLowerCase() === t))
    );
  }
  if (entries.length === 0) {
    printInfo('References нет.');
    return;
  }
  console.log('');
  for (const e of entries) {
    const r = e.reference;
    const tags2 = r.tags.length ? ` [${r.tags.join(', ')}]` : '';
    const linked = r.linked_tasks.length ? ` → ${r.linked_tasks.join(', ')}` : '';
    console.log(`  ${r.id}  ${r.title}  (${r.type}, ${r.created_date})${tags2}${linked}`);
  }
  console.log(`\n  ${entries.length} references`);
}

function referenceAdd(positional: string[], flags: FlagValues, cwd: string): Promise<void> {
  const title = positional.join(' ');
  if (!title) {
    printError('Укажите заголовок: vibelog reference add <title> [--type T] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone] [--cache] (--url можно повторять: ссылки кэшируются в один md-файл)');
    return Promise.resolve();
  }
  try {
    // VL-291: --url повторяемый — первая ссылка становится url, остальные urls
    const urls = getFlagArray(flags, 'url').map(u => u.trim()).filter(Boolean);
    const tags = getFlagArray(flags, 'tags')
      .flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean);
    const ref = writeReference(cwd, {
      title,
      type: getFlag(flags, 'type', 'repo'),
      url: urls[0],
      urls,
      path: getFlag(flags, 'path', '') || undefined,
      tags,
      content: getFlag(flags, 'description', '') || '',
    });
    const linksInfo = urls.length > 1 ? ` (ссылок: ${urls.length})` : '';
    printSuccess(`Reference ${ref.id} создан: ${ref.title} (${ref.type})${linksInfo}`);
    // Клонирование: default=true для type=repo; --no-clone — только метаданные
    if (ref.type === 'repo' && ref.url && !hasFlag(flags, 'no-clone')) {
      const res = cloneReferenceRepo(cwd, ref);
      if (res.cloned) printSuccess(res.message);
      else printInfo(res.message);
    }
    // Кэш (VL-194): --cache скачивает и конвертирует url/doc прямо при add;
    // VL-291: ссылок может быть несколько — кэш склеивается в один файл
    if (hasFlag(flags, 'cache')) {
      if (!ref.url) {
        printError('Для --cache нужен --url (или --type repo клонируется сам).');
        process.exitCode = 1;
        return Promise.resolve();
      }
      return cacheReference(cwd, ref).then(res => {
        if (res.cached && res.partial) {
          // частичный успех: кэш записан, но часть ссылок не скачалась
          printError(res.message);
          process.exitCode = 1;
        } else if (res.cached) {
          printSuccess(res.message);
        } else {
          printError(res.message);
          process.exitCode = 1;
        }
      });
    }
    return Promise.resolve();
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
    return Promise.resolve();
  }
}

function referenceView(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog reference view <id>');
    return;
  }
  const entry = getReference(cwd, id);
  if (!entry) {
    printError(`Reference ${id} не найден.`);
    process.exitCode = 1;
    return;
  }
  const r = entry.reference;
  console.log(`\n${r.id}: ${r.title}`);
  console.log(`  тип: ${r.type} | создан: ${r.created_date}${r.tags.length ? ` | теги: ${r.tags.join(', ')}` : ''}`);
  if (r.url) console.log(`  url: ${r.url}`);
  // VL-291: дополнительные ссылки печатаем отдельными строками (порядок кэша)
  (r.urls || []).forEach((u, i) => console.log(`  url[${i + 2}]: ${u}`));
  if (r.path) console.log(`  path: ${r.path}`);
  console.log(`  linked_tasks: ${r.linked_tasks.length ? r.linked_tasks.join(', ') : '(нет)'}`);
  if (r.cached_path) console.log(`  кэш: ${r.cached_path} (${r.cached_at || '?'})`);
  console.log(`  файл: ${entry.path}\n`);
  if (entry.body.trim()) {
    console.log(entry.body.trim());
  } else {
    printInfo('(описание пустое)');
  }
  // Локальный markdown-кэш (VL-194): Plan-фаза читает его вместо web_fetch;
  // без кэша печатается только url выше — вызывающий фолбэчит сам
  const cached = readReferenceCache(cwd, r);
  if (cached) {
    console.log(`\n--- Кэш (${r.cached_at || 'без даты'}) ---\n`);
    console.log(cached);
  }
}

function referenceSearch(positional: string[], cwd: string): void {
  const query = positional.join(' ');
  if (!query) {
    printError('Укажите запрос: vibelog reference search <query>');
    return;
  }
  const entries = searchReferences(cwd, query);
  if (entries.length === 0) {
    printInfo(`По запросу "${query}" references не найдено.`);
    return;
  }
  console.log(`\nРезультаты поиска "${query}":\n`);
  for (const e of entries) {
    console.log(`  ${e.reference.id}  ${e.reference.title}  (${e.reference.type})`);
  }
  console.log(`\n  ${entries.length} references`);
}

function referenceLink(positional: string[], flags: FlagValues, cwd: string): void {
  const [refId, taskId] = positional;
  if (!refId || !taskId) {
    printError('Укажите ID: vibelog reference link <refId> <taskId> [--remove]');
    return;
  }
  try {
    const action = hasFlag(flags, 'remove') ? 'remove' : 'add';
    linkReferenceTask(cwd, refId, taskId, action);
    printSuccess(action === 'add'
      ? `Reference ${refId} связан с задачей ${taskId}.`
      : `Связь Reference ${refId} ↔ задача ${taskId} удалена.`);
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

function referenceRemove(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog reference remove <id>');
    return;
  }
  const ok = removeReference(cwd, id);
  if (!ok) {
    printError(`Reference ${id} не найден.`);
    return;
  }
  printSuccess(`Reference ${id} удалён (клон в data/ сохранён).`);
}

/**
 * sync — синхронизация references (VL-152 клоны + VL-194 markdown-кэш).
 *
 * - `sync` — прежнее поведение: доклонировать отсутствующие репозитории;
 * - `sync <ref-id>` — перекачать кэш одного reference (сверка source_hash);
 * - `sync --all` — клоны + перекачать кэши всех url/doc/spec.
 */
async function referenceSync(positional: string[], flags: FlagValues, cwd: string): Promise<void> {
  const id = positional[0];
  const wantAll = hasFlag(flags, 'all');

  // Клоны репозиториев: всегда (как и прежде), при --all — тоже
  const cloneResult = syncReferenceRepos(cwd);
  for (const cid of cloneResult.cloned) printSuccess(`Клонирован: ${cid}`);
  for (const cid of cloneResult.skipped) printInfo(`Уже клонирован (пропуск): ${cid}`);
  for (const f of cloneResult.failed) printError(`Ошибка: ${f.id} — ${f.error}`);

  // Кэш (VL-194): id → один; --all → все url/doc/spec; иначе — ничего
  let cacheResult = { updated: [] as string[], skipped: [] as string[], failed: [] as { id: string; error: string }[] };
  if (id) {
    const entry = getReference(cwd, id);
    if (!entry) {
      printError(`Reference ${id} не найден.`);
      process.exitCode = 1;
      return;
    }
    const res = await refreshReferenceCache(cwd, entry.reference);
    // VL-291: классификация по явному status, а не по подстрокам сообщения
    if (res.status === 'updated') { printSuccess(res.message); cacheResult.updated.push(entry.reference.id); }
    else if (res.status === 'skipped' || res.status === 'none') { printInfo(res.message); cacheResult.skipped.push(entry.reference.id); }
    else { printError(res.message); cacheResult.failed.push({ id: entry.reference.id, error: res.message }); }
  } else if (wantAll) {
    cacheResult = await syncReferenceCaches(cwd, { all: true });
    for (const cid of cacheResult.updated) printSuccess(`Кэш обновлён: ${cid}`);
    for (const cid of cacheResult.skipped) printInfo(`Кэш без изменений: ${cid}`);
    for (const f of cacheResult.failed) printError(`Ошибка кэша: ${f.id} — ${f.error}`);
  }

  console.log(`\n  Клонировано: ${cloneResult.cloned.length}, пропущено: ${cloneResult.skipped.length}, ошибок: ${cloneResult.failed.length}`);
  if (id || wantAll) {
    console.log(`  Кэш обновлено: ${cacheResult.updated.length}, без изменений: ${cacheResult.skipped.length}, ошибок: ${cacheResult.failed.length}`);
  }
  if (cloneResult.failed.length > 0 || cacheResult.failed.length > 0) process.exitCode = 1;
}

export { REFERENCE_TYPES };
