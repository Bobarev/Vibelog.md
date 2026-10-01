/**
 * Команда `vibelog doc` — управление документами (спецификации, гайды).
 *
 * Подкоманды:
 * - create <title> — создать документ
 * - list — список документов
 * - view <id> — показать документ
 * - update <id> — обновить документ
 * - search <query> — поиск по документам
 *
 * Файлы: backlog/docs/<id>-<slug>.md (YAML-фронтматтер + markdown).
 */

import { getFlag, getFlagArray } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { findBacklogDir } from '../../core/paths.js';
import {
  writeDocument, listDocuments, getDocument,
  updateDocument, searchDocuments, DOCUMENT_TYPES,
} from '../../core/document.js';
import type { UpdateDocumentInput } from '../../core/document.js';

/**
 * Выполняет команду doc.
 */
export async function runDoc(
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
    case 'create':
      return docCreate(positional, flags, backlogDir);
    case 'list':
      return docList(flags, backlogDir);
    case 'view':
      return docView(positional, backlogDir);
    case 'update':
      return docUpdate(positional, flags, backlogDir);
    case 'search':
      return docSearch(positional, backlogDir);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: create, list, view, update, search');
  }
}

function docCreate(positional: string[], flags: FlagValues, backlogDir: string): void {
  const title = positional[0];
  if (!title) {
    printError('Укажите заголовок: vibelog doc create <title> [--type T] [--tags a,b]');
    return;
  }
  try {
    const tags = getFlagArray(flags, 'tags').flatMap(t => t.split(',').map(s => s.trim()).filter(Boolean));
    const doc = writeDocument(backlogDir, {
      title,
      type: getFlag(flags, 'type', ''),
      tags,
      content: '',
    });
    printSuccess(`Документ ${doc.id} создан: ${doc.title} (тип: ${doc.type})`);
  } catch (err) {
    printError((err as Error).message);
  }
}

function docList(flags: FlagValues, backlogDir: string): void {
  let entries = listDocuments(backlogDir);
  const typeFilter = getFlag(flags, 'type', '');
  if (typeFilter) {
    entries = entries.filter(e => e.document.type === typeFilter.toLowerCase());
  }
  if (entries.length === 0) {
    printInfo('Документов нет.');
    return;
  }
  console.log('');
  for (const e of entries) {
    const tags = e.document.tags.length ? ` [${e.document.tags.join(', ')}]` : '';
    console.log(`  ${e.document.id}  ${e.document.title}  (${e.document.type}, ${e.document.created_date})${tags}`);
  }
  console.log(`\n  ${entries.length} документов`);
}

function docView(positional: string[], backlogDir: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog doc view <id>');
    return;
  }
  const entry = getDocument(backlogDir, id);
  if (!entry) {
    printError(`Документ ${id} не найден.`);
    return;
  }
  const d = entry.document;
  console.log(`\n${d.id}: ${d.title}`);
  console.log(`  тип: ${d.type} | создан: ${d.created_date}${d.tags.length ? ` | теги: ${d.tags.join(', ')}` : ''}`);
  console.log(`  файл: ${entry.path}\n`);
  if (entry.body.trim()) {
    console.log(entry.body.trim());
  } else {
    printInfo('(тело пустое)');
  }
}

function docUpdate(positional: string[], flags: FlagValues, backlogDir: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog doc update <id> [--title ...] [--type ...] [--tags ...]');
    return;
  }
  const updates: UpdateDocumentInput = {};
  if (flags.title) updates.title = getFlag(flags, 'title');
  if (flags.type) updates.type = getFlag(flags, 'type');
  if (flags.tags) {
    updates.tags = getFlagArray(flags, 'tags').flatMap(t => t.split(',').map(s => s.trim()).filter(Boolean));
  }
  if (Object.keys(updates).length === 0) {
    printError('Укажите поля для обновления: --title, --type, --tags');
    return;
  }
  try {
    const updated = updateDocument(backlogDir, id, updates);
    if (!updated) {
      printError(`Документ ${id} не найден.`);
      return;
    }
    printSuccess(`Документ ${updated.document.id} обновлён: ${updated.document.title}`);
  } catch (err) {
    printError((err as Error).message);
  }
}

function docSearch(positional: string[], backlogDir: string): void {
  const query = positional.join(' ');
  if (!query) {
    printError('Укажите запрос: vibelog doc search <query>');
    return;
  }
  const entries = searchDocuments(backlogDir, query);
  if (entries.length === 0) {
    printInfo(`По запросу "${query}" документов не найдено.`);
    return;
  }
  console.log(`\nРезультаты поиска "${query}":\n`);
  for (const e of entries) {
    console.log(`  ${e.document.id}  ${e.document.title}  (${e.document.type})`);
  }
  console.log(`\n  ${entries.length} документов`);
}

export { DOCUMENT_TYPES };
