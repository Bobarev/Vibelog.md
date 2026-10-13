/**
 * CLI-команда vibelog agent (VL-141): анализ сессии агента без бота.
 *
 * Паритет бот-команды /analyze: vibelog agent analyze <session-ref> спавнит
 * фазу analyze через startAnalyze — тот же шаблон phase-analyze.md, та же
 * статистика jsonl и рекомендации, что в Telegram.
 */

import { startAnalyze } from '../../web/orchestrator.js';
import type { PhaseRun } from '../../web/orchestrator.js';
import { resolveDefaultAgent } from '../../bot/settings.js';
import { printError } from '../ui.js';

/**
 * Обработать подкоманду agent.
 *
 * @param subcommand — подкоманда (пока только analyze)
 * @param positional — позиционные аргументы (session-ref)
 * @param flags — флаги CLI (не используются)
 * @param cwd — каталог проекта (там же backlog/ и .vibelog/)
 */
export async function runAgent(
  subcommand: string,
  positional: string[],
  _flags: Record<string, unknown>,
  cwd: string
): Promise<void> {
  if (subcommand !== 'analyze') {
    printError(`Неизвестная подкоманда agent: ${subcommand || '(нет)'} (доступна: analyze)`);
    process.exitCode = 1;
    return;
  }
  const ref = positional[0];
  if (!ref) {
    printError('Синтаксис: vibelog agent analyze <session-ref>');
    process.exitCode = 1;
    return;
  }
  // Агент-исполнитель — из настроек проекта (/set agent), как у бота
  const agent = resolveDefaultAgent(cwd);
  // Ждём onExit: без await процесс CLI завершится раньше агента
  await new Promise<void>((resolve) => {
    const onExit = (run: PhaseRun): void => {
      // Отчёт: результат сессии (JSON type=result) либо хвост лога —
      // как фолбэк бота (sendPhaseResult), только текстом в терминал
      const report = run.result?.result ?? run.logTail ?? '(пусто)';
      console.log(`\n📊 Анализ завершён (exit=${run.exitCode ?? '-'}):\n${report}`);
      resolve();
    };
    const res = startAnalyze(cwd, ref, onExit, agent);
    if ('error' in res) {
      printError(res.error);
      process.exitCode = 1;
      resolve();
      return;
    }
    console.log(`🚀 Фаза analyze запущена, PID ${res.pid}`);
  });
}
