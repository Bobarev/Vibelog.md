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
      return referenceSync(cwd);
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

function referenceAdd(positional: string[], flags: FlagValues, cwd: string): void {
  const title = positional.join(' ');
  if (!title) {
    printError('Укажите заголовок: vibelog reference add <title> [--type T] [--url ...] [--path ...] [--tags ...] [-d desc] [--no-clone]');
    return;
  }
  try {
    const tags = getFlagArray(flags, 'tags')
      .flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean);
    const ref = writeReference(cwd, {
      title,
      type: getFlag(flags, 'type', 'repo'),
      url: getFlag(flags, 'url', '') || undefined,
      path: getFlag(flags, 'path', '') || undefined,
      tags,
      content: getFlag(flags, 'description', '') || '',
    });
    printSuccess(`Reference ${ref.id} создан: ${ref.title} (${ref.type})`);
    // Клонирование: default=true для type=repo; --no-clone — только метаданные
    if (ref.type === 'repo' && ref.url && !hasFlag(flags, 'no-clone')) {
      const res = cloneReferenceRepo(cwd, ref);
      if (res.cloned) printSuccess(res.message);
      else printInfo(res.message);
    }
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
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
  if (r.path) console.log(`  path: ${r.path}`);
  console.log(`  linked_tasks: ${r.linked_tasks.length ? r.linked_tasks.join(', ') : '(нет)'}`);
  console.log(`  файл: ${entry.path}\n`);
  if (entry.body.trim()) {
    console.log(entry.body.trim());
  } else {
    printInfo('(описание пустое)');
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

function referenceSync(cwd: string): void {
  const result = syncReferenceRepos(cwd);
  for (const id of result.cloned) printSuccess(`Клонирован: ${id}`);
  for (const id of result.skipped) printInfo(`Уже клонирован (пропуск): ${id}`);
  for (const f of result.failed) printError(`Ошибка: ${f.id} — ${f.error}`);
  console.log(`\n  Клонировано: ${result.cloned.length}, пропущено: ${result.skipped.length}, ошибок: ${result.failed.length}`);
  if (result.failed.length > 0) process.exitCode = 1;
}

export { REFERENCE_TYPES };
