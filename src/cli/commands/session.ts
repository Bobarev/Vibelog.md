/**
 * CLI-команда `vibelog session summary` (VL-261), алиас `agent-session`.
 *
 * Разбор сессии начинался с ручного чтения JSONL (VL-235, VL-254): эта
 * команда печатает готовую сводку — раны, фазы, tool-calls, payload, правки
 * файлов. Вся арифметика — в чистом модуле `src/agent/session-summary.ts`
 * (одна реализация на CLI и будущий `/analyze`); здесь только чтение файлов
 * и вывод.
 *
 * Источники данных:
 * - транскрипт `<cwd>/.vibelog/agent-sessions/<id>.jsonl` (строки как есть,
 *   битые строки пропускаются — как в sumUsageFromJsonlSync: разбор не
 *   должен падать на оборванном транскрипте);
 * - мета `<id>.meta.json` (фаза сессии, taskId, cwd, тайминги, VL-198/243);
 * - billing задачи `.vibelog/billing/<taskId>.json` (фазы и тайминги ранов,
 *   VL-243) — пишется только для задачных ранов, поэтому его отсутствие
 *   не ошибка.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFlag, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printError } from '../ui.js';
import { agentSessionsDir, findLatestTaskSessionSync, loadSessionMetaSync } from '../../agent/session.js';
import { buildSessionSummary, formatSessionSummary } from '../../agent/session-summary.js';
import { billingPath, readBilling } from '../../core/billing.js';
import type { BillingSession } from '../../core/billing.js';
import type { ChatMessage } from '../../agent/llm.js';

/** Справка команды: печатается при неизвестной подкоманде. */
const USAGE = `vibelog session summary <sessionId|--task VL-N> [--json]

Печатает сводку сессии агента: раны (фазы, строки, токены, payload),
tool-calls по инструментам, топ shell-команд и топ правок файлов.
  <sessionId>   — id сессии (agent-…); префикс vb:/qwen: снимается
  --task VL-N   — взять последнюю сессию задачи из меты
  --json        — стабильная схема (schemaVersion) для /analyze и тестов

Алиас: vibelog agent-session summary ...`;

/**
 * Выполняет команду session.
 *
 * @param subcommand — подкоманда (поддерживается `summary`)
 * @param positional — позиционные аргументы (sessionId)
 * @param flags — флаги (--task, --json)
 * @param cwd — каталог проекта (там же .vibelog/)
 */
export async function runSession(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string,
): Promise<void> {
  if (subcommand !== 'summary') {
    printError(`Неизвестная подкоманда session: ${subcommand || '(пусто)'}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  // Каталог сессий — как у агента: в режиме worktree/оркестратора транскрипты
  // живут в главном репозитории (VIBELOG_CWD), иначе в cwd проекта
  const sessionsDir = agentSessionsDir(process.env.VIBELOG_CWD ?? cwd);

  const taskFlag = getFlag(flags, 'task', '');
  // sessionId может прийти как vb:agent-… / qwen:agent-… — префикс агента
  // не часть имени файла (extractSessionRef бота делает то же самое)
  const rawId = positional[0]?.trim() ?? '';
  const sessionId = rawId.replace(/^(vb|qwen):/, '');

  let resolved = sessionId;
  if (!resolved && taskFlag) {
    const found = findLatestTaskSessionSync(sessionsDir, taskFlag);
    if (!found) {
      printError(`Сессий задачи ${taskFlag} не найдено в ${sessionsDir}`);
      process.exitCode = 1;
      return;
    }
    resolved = found;
  }
  if (!resolved) {
    printError(`Укажите sessionId либо --task VL-N\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }

  const jsonlPath = join(sessionsDir, `${resolved}.jsonl`);
  if (!existsSync(jsonlPath)) {
    printError(`Сессия ${resolved} не найдена: ${jsonlPath}`);
    process.exitCode = 1;
    return;
  }

  const messages = parseJsonlSafe(jsonlPath);
  const meta = loadSessionMetaSync(sessionsDir, resolved);
  const billingSessions = loadBillingSessions(cwd, meta?.cwd ?? null, meta?.taskId ?? null, resolved);

  const summary = buildSessionSummary({
    messages,
    sessionId: resolved,
    path: jsonlPath,
    meta,
    billingSessions,
  });

  if (hasFlag(flags, 'json')) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(formatSessionSummary(summary));
}

/**
 * Читает jsonl-транскрипт, пропуская битые строки (паттерн
 * sumUsageFromJsonlSync): сводка не должна падать на оборванном файле.
 */
function parseJsonlSafe(path: string): ChatMessage[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const messages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
    } catch {
      // битая строка — пропуск: остальные сообщения учтены
    }
  }
  return messages;
}

/**
 * Записи billing по сессии (AC1: тайминги/фазы ранов).
 *
 * Каталог billing ищется в двух местах: cwd запуска (сводка из worktree) и
 * cwd создания сессии из меты (транскрипт мог создаваться в главном репо).
 * Нет файла/битый JSON — пустой список: billing не обязателен (пишется
 * только для задачных ранов), фазы тогда берутся из маркеров промптов.
 */
function loadBillingSessions(
  cwd: string,
  metaCwd: string | null,
  taskId: string | null,
  sessionId: string,
): BillingSession[] {
  if (!taskId) return [];
  const candidates = [cwd, ...(metaCwd && metaCwd !== cwd ? [metaCwd] : [])];
  for (const dir of candidates) {
    if (!existsSync(billingPath(dir, taskId))) continue;
    try {
      const record = readBilling(dir, taskId);
      return record.sessions
        .filter((s) => s.sessionId === sessionId)
        // Порядок ранов — по завершению: append-only журнал уже в порядке
        // записи, но resume-раны могут дописываться асинхронно
        .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
    } catch (err) {
      console.error(`Предупреждение: billing ${taskId} не прочитан — ${(err as Error).message}`);
      return [];
    }
  }
  return [];
}
