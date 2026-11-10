/**
 * Команда `vibelog workflow` — конструктор workflow проекта (VL-398).
 *
 * Тонкая обёртка над `src/core/workflow-config.ts`: вся логика (описание,
 * валидация, запись) живёт в ядре, потому что те же три операции отдаёт
 * MCP-инструмент `workflow_get`/`workflow_apply`. Дублирования нет — так же
 * устроены `vibelog map` (VL-235) и `vibelog capabilities` (VL-394).
 *
 * Подкоманды:
 * - `show [--json]` — эффективный workflow и его источник (дефолт в коде или
 *   settings.json);
 * - `validate [--json]` — диагностика переходов; exit code 1 при ошибках
 *   (warning'и не роняют — как проверка `completeness_config` в doctor);
 * - `apply <file|-> [--dry-run] [--sync-statuses]` — запись секций
 *   workflows/task_workflows/completeness с валидацией ДО записи.
 */

import { readFileSync } from 'node:fs';
import { printError, printInfo, printSuccess, printWarning } from '../ui.js';
import { hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import {
  applyWorkflowConfig,
  describeWorkflow,
  parseWorkflowInput,
  validateWorkflowConfig,
} from '../../core/workflow-config.js';
import type { WorkflowFinding } from '../../core/workflow-config.js';
import type { Transition } from '../../core/workflow.js';

/** Компактная строка перехода: `To Do --spec--> Spec`. */
function transitionLine(t: Transition): string {
  if (t.phase === null) return `${t.status} — финальный статус`;
  return `${t.status} --${t.phase}--> ${t.produces_status ?? t.status}`;
}

/** Печать находок валидации: ошибки и предупреждения раздельно. */
function printFindings(findings: WorkflowFinding[]): void {
  for (const f of findings) {
    const line = `${f.path}: ${f.message}`;
    if (f.severity === 'error') printError(line);
    else printWarning(line);
  }
}

/** `workflow show`: эффективная схема. */
function showWorkflow(cwd: string, flags: FlagValues): void {
  const data = describeWorkflow(cwd);
  if (flags.json) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'workflow', data }, null, 2));
    return;
  }
  console.log(`# Workflow: ${data.name}`);
  console.log('');
  console.log(data.note);
  console.log(`Стартовый статус: ${data.initial_status}`);
  console.log('');
  console.log('## Переходы');
  for (const t of data.transitions) console.log(`  ${transitionLine(t)}`);
  console.log('');
  const taskEntries = Object.entries(data.task_workflows);
  console.log('## task_workflows');
  if (taskEntries.length === 0) console.log('  —');
  for (const [type, name] of taskEntries) console.log(`  ${type} → ${name}`);
  console.log('');
  console.log('## completeness');
  for (const [wf, phases] of Object.entries(data.completeness)) {
    for (const [phase, entities] of Object.entries(phases)) {
      const parts = Object.entries(entities).map(([entity, fields]) => `${entity}: ${fields.join(', ')}`);
      console.log(`  ${wf} / ${phase === '*' ? 'любая фаза' : phase} → ${parts.join('; ')}`);
    }
  }
  console.log('');
  console.log(`Статусы backlog/config.yml: ${data.statuses.length > 0 ? data.statuses.join(', ') : '— (конфиг недоступен)'}`);
  printInfo('Машиночитаемая форма: vibelog workflow show --json');
}

/** `workflow validate`: диагностика. */
function validateWorkflow(cwd: string, flags: FlagValues): void {
  const findings = validateWorkflowConfig(cwd);
  const errors = findings.filter((f) => f.severity === 'error');
  if (flags.json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: 'workflow-validate',
      data: { ok: errors.length === 0, findings },
    }, null, 2));
  } else if (findings.length === 0) {
    printSuccess('Конфигурация workflow согласована: переходы, фазы, ссылки и правила неполноты в порядке');
  } else {
    printFindings(findings);
    printInfo(`Находок: ${findings.length} (ошибок: ${errors.length}, предупреждений: ${findings.length - errors.length})`);
  }
  if (errors.length > 0) process.exitCode = 1;
}

/** `workflow apply`: чтение входа и запись. */
function applyWorkflow(cwd: string, positional: string[], flags: FlagValues): void {
  const source = positional[0];
  if (!source) {
    printError('Укажите файл с конфигурацией или «-» для чтения stdin: vibelog workflow apply <file|->');
    process.exitCode = 1;
    return;
  }
  let text: string;
  try {
    // fd 0 — stdin: `vibelog workflow apply -` читает пайп (Node 20, синхронно)
    text = source === '-' ? readFileSync(0, 'utf-8') : readFileSync(source, 'utf-8');
  } catch (err) {
    printError(`Не удалось прочитать ${source === '-' ? 'stdin' : source}: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const parsed = parseWorkflowInput(text);
  if ('error' in parsed) {
    printError(parsed.error);
    process.exitCode = 1;
    return;
  }

  const dryRun = hasFlag(flags, 'dry-run');
  const syncStatuses = hasFlag(flags, 'sync-statuses');
  const result = applyWorkflowConfig(cwd, parsed.patch, { dryRun, syncStatuses });

  if (result.warnings && result.warnings.length > 0) printFindings(result.warnings);
  if (result.skipped && result.skipped.length > 0) {
    for (const s of result.skipped) printWarning(`${s.field}: ${s.reason}`);
  }

  if (!result.ok) {
    for (const error of result.errors ?? ['неизвестная ошибка']) printError(error);
    printInfo('Файл .vibelog/settings.json не изменён');
    process.exitCode = 1;
    return;
  }

  if (result.noop) {
    printInfo('Изменений нет: конфигурация уже совпадает с переданной (settings.json не тронут)');
    return;
  }
  if (result.dryRun) {
    printInfo('--dry-run: файл не изменён. Было бы записано:');
    console.log(JSON.stringify(result.applied, null, 2));
    return;
  }
  if (result.statusesAdded && result.statusesAdded.length > 0) {
    printSuccess(`Статусы дописаны в backlog/config.yml: ${result.statusesAdded.join(', ')}`);
  }
  printSuccess(`Workflow записан в .vibelog/settings.json: ${Object.keys(result.applied ?? {}).join(', ')}`);
  printInfo('Проверка: vibelog workflow validate');
}

/**
 * Выполняет команду workflow.
 *
 * @param subcommand — show | validate | apply (первый позиционный аргумент)
 * @param positional — остальные позиционные (для apply — путь к файлу)
 * @param flags — --json, --dry-run, --sync-statuses
 * @param cwd — корень проекта
 */
export async function runWorkflow(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  switch (subcommand) {
    case 'show':
      showWorkflow(cwd, flags);
      return;
    case 'validate':
      validateWorkflow(cwd, flags);
      return;
    case 'apply':
      applyWorkflow(cwd, positional, flags);
      return;
    case '':
      printError('Подкоманда не указана. Доступно: show | validate | apply');
      process.exitCode = 1;
      return;
    default:
      printError(`Неизвестная подкоманда workflow: ${subcommand}. Доступно: show | validate | apply`);
      process.exitCode = 1;
  }
}
