/**
 * Команда `vibelog decision` — архитектурные решения (ADR).
 *
 * Подкоманды:
 * - create <title> — зафиксировать решение
 * - list — список решений
 * - view <id> — показать решение (карточка + ADR-тело)
 *
 * Файлы: backlog/decisions/<id>-<slug>.md
 * (фронтматтер id/title/date/status + секции Context/Decision/...).
 */

import { getFlag } from '../args.mjs';
import { printSuccess, printError, printInfo } from '../ui.mjs';
import { findBacklogDir } from '../../core/paths.js';
import {
  writeDecision, listDecisions, getDecision, DECISION_STATUSES,
} from '../../core/decision.js';

/**
 * Выполняет команду decision.
 *
 * @param {string} subcommand
 * @param {string[]} positional
 * @param {Record<string, unknown>} flags
 * @param {string} cwd
 */
export async function runDecision(subcommand, positional, flags, cwd) {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'create':
      return decisionCreate(positional, flags, backlogDir);
    case 'list':
      return decisionList(flags, backlogDir);
    case 'view':
      return decisionView(positional, backlogDir);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo(`Доступные: create, list, view (статусы: ${DECISION_STATUSES.join(', ')})`);
  }
}

function decisionCreate(positional, flags, backlogDir) {
  const title = positional[0];
  if (!title) {
    printError('Укажите заголовок: vibelog decision create <title> [-s status] [--context ...]');
    return;
  }
  const decision = writeDecision(backlogDir, {
    title,
    // Статус free-form (как в оригинале), дефолт proposed
    status: getFlag(flags, 'status', ''),
    context: getFlag(flags, 'context', ''),
    decision: getFlag(flags, 'decision', ''),
    consequences: getFlag(flags, 'consequences', ''),
    alternatives: getFlag(flags, 'alternatives', ''),
  });
  printSuccess(`Решение ${decision.id} создано: ${decision.title} (статус: ${decision.status})`);
}

function decisionList(flags, backlogDir) {
  const statusFilter = getFlag(flags, 'status', '');
  const entries = listDecisions(backlogDir, statusFilter ? { status: statusFilter } : {});
  if (entries.length === 0) {
    printInfo(statusFilter ? `Решений со статусом "${statusFilter}" нет.` : 'Решений нет.');
    return;
  }
  console.log('');
  for (const e of entries) {
    const d = e.decision;
    console.log(`  ${d.id}  ${d.title}  (${d.status}, ${d.date})`);
  }
  console.log(`\n  ${entries.length} решений`);
}

function decisionView(positional, backlogDir) {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog decision view <id>');
    return;
  }
  const entry = getDecision(backlogDir, id);
  if (!entry) {
    printError(`Решение ${id} не найдено.`);
    return;
  }
  const d = entry.decision;
  console.log(`\n${d.id}: ${d.title}`);
  console.log(`  статус: ${d.status} | дата: ${d.date}`);
  console.log(`  файл: ${entry.path}\n`);
  if (entry.body.trim()) {
    console.log(entry.body.trim());
  } else {
    printInfo('(тело пустое)');
  }
}
