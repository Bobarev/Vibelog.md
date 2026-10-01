/**
 * Команда `vibelog draft` — черновики задач (быстрый захват идей).
 *
 * Подкоманды:
 * - create <title> — создать черновик
 * - list — список черновиков
 * - view <id> — показать черновик
 * - edit <id> — изменить черновик
 * - promote <id> — превратить в задачу (черновик удаляется)
 * - archive <id> — архивировать (перенос в completed/)
 *
 * Файлы: backlog/drafts/<id> - <slug>.md (task-shaped, статус Draft).
 */

import { getFlag, getFlagArray } from '../args.mjs';
import { printSuccess, printError, printInfo } from '../ui.mjs';
import { findBacklogDir } from '../../core/paths.js';
import { loadConfig } from '../../core/config.js';
import { createTaskFile } from '../../core/store.js';
import {
  writeDraft, listDrafts, getDraft, updateDraft,
  archiveDraft, removeDraftFile,
} from '../../core/draft.js';

/**
 * Выполняет команду draft.
 *
 * @param {string} subcommand
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runDraft(subcommand, positional, flags, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'create':
      return draftCreate(positional, flags, backlogDir, cwd);
    case 'list':
      return draftList(backlogDir);
    case 'view':
      return draftView(positional, backlogDir);
    case 'edit':
      return draftEdit(positional, flags, backlogDir);
    case 'promote':
      return draftPromote(positional, backlogDir, cwd);
    case 'archive':
      return draftArchive(positional, backlogDir);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: create, list, view, edit, promote, archive');
  }
}

/** Разбирает флаги labels: --labels a,b или повторные -l. */
function parseLabels(flags) {
  return getFlagArray(flags, 'labels')
    .flatMap(l => l.split(',').map(s => s.trim()).filter(Boolean));
}

function draftCreate(positional, flags, backlogDir, cwd) {
  const title = positional[0];
  if (!title) {
    printError('Укажите заголовок: vibelog draft create <title> [-d desc] [-l labels]');
    return;
  }
  const config = loadConfig(cwd);
  const draft = writeDraft(backlogDir, {
    title,
    description: getFlag(flags, 'description', ''),
    labels: parseLabels(flags),
  }, config);
  printSuccess(`Черновик ${draft.id} создан: ${draft.title}`);
}

function draftList(backlogDir) {
  const drafts = listDrafts(backlogDir);
  if (drafts.length === 0) {
    printInfo('Черновиков нет.');
    return;
  }
  console.log('');
  for (const e of drafts) {
    const labels = e.task.labels.length ? ` [${e.task.labels.join(', ')}]` : '';
    console.log(`  ${e.task.id}  ${e.task.title}${labels}`);
  }
  console.log(`\n  ${drafts.length} черновиков`);
}

function draftView(positional, backlogDir) {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog draft view <id>');
    return;
  }
  const entry = getDraft(backlogDir, id);
  if (!entry) {
    printError(`Черновик ${id} не найден.`);
    return;
  }
  const t = entry.task;
  console.log(`\n${t.id}: ${t.title}`);
  console.log(`  статус: ${t.status} | создан: ${t.created_date}${t.labels.length ? ` | метки: ${t.labels.join(', ')}` : ''}`);
  console.log(`  файл: ${entry.path}\n`);
  if (t.description && t.description.trim()) {
    console.log(t.description.trim());
  } else {
    printInfo('(описание пустое)');
  }
}

function draftEdit(positional, flags, backlogDir) {
  const id = positional[0];
  if (!id) {
    printError('Использование: vibelog draft edit <id> [--title ...] [-d desc] [-l labels]');
    return;
  }
  const updates = {};
  if (flags.title) updates.title = getFlag(flags, 'title');
  if (flags.description || flags.d) updates.description = getFlag(flags, 'description', '');
  if (flags.labels || flags.l) updates.labels = parseLabels(flags);

  if (Object.keys(updates).length === 0) {
    printError('Укажите поля: --title, -d/--description, -l/--labels');
    return;
  }
  const updated = updateDraft(backlogDir, id, updates);
  if (!updated) {
    printError(`Черновик ${id} не найден.`);
    return;
  }
  printSuccess(`Черновик ${updated.task.id} обновлён: ${updated.task.title}`);
}

function draftPromote(positional, backlogDir, cwd) {
  const id = positional[0];
  if (!id) {
    printError('Использование: vibelog draft promote <id>');
    return;
  }
  const entry = getDraft(backlogDir, id);
  if (!entry) {
    printError(`Черновик ${id} не найден.`);
    return;
  }

  const d = entry.task;
  // Задача: id генерируется из префикса конфига, статус — default_status
  const task = createTaskFile(cwd, {
    title: d.title,
    description: d.description,
    labels: d.labels,
    priority: d.priority,
    acceptanceCriteria: d.acceptanceCriteria,
  });
  // Черновик удаляем только после успешного создания задачи
  removeDraftFile(entry.path);
  printSuccess(`Черновик ${d.id} → задача ${task.id}: ${task.title}`);
}

function draftArchive(positional, backlogDir) {
  const id = positional[0];
  if (!id) {
    printError('Использование: vibelog draft archive <id>');
    return;
  }
  const moved = archiveDraft(backlogDir, id);
  if (!moved) {
    printError(`Черновик ${id} не найден.`);
    return;
  }
  printSuccess(`Черновик ${id} архивирован (completed/).`);
}
