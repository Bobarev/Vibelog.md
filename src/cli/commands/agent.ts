/**
 * CLI-команда vibelog agent (VL-141, VL-158): интерактивный чат агента
 * и анализ сессии без бота.
 *
 * Подкоманды:
 * - без подкоманд / <task-id> — интерактивный TUI-чат (VL-158, перенесён
 *   из пустого запуска vibelog/VB по VL-102); с task-id задача добавляется
 *   в контекст чата;
 * - analyze — паритет бот-команды /analyze (VL-141): vibelog agent
 *   analyze <session-ref> спавнит фазу analyze через startAnalyze — тот же
 *   шаблон phase-analyze.md, та же статистика jsonl и рекомендации.
 */

import { startAnalyze } from '../../web/orchestrator.js';
import type { PhaseRun } from '../../web/orchestrator.js';
import { resolveDefaultAgent } from '../../bot/settings.js';
import { taskIdPattern } from '../../core/config.js';
import { printError } from '../ui.js';

/**
 * Обработать подкоманду agent.
 *
 * @param subcommand — подкоманда (analyze, <task-id> или пусто — чат)
 * @param positional — позиционные аргументы (session-ref для analyze)
 * @param flags — флаги CLI (не используются)
 * @param cwd — каталог проекта (там же backlog/ и .vibelog/)
 */
export async function runAgent(
  subcommand: string,
  positional: string[],
  _flags: Record<string, unknown>,
  cwd: string
): Promise<void> {
  // Интерактивный чат (VL-158): без подкоманды либо с <task-id>.
  // TTY-check ДО getTask: в скриптах/CI чат не запускается вовсе —
  // ошибка одинакова для несуществующей задачи и pipe-запуска
  if (subcommand === '' || taskIdPattern(cwd).test(subcommand)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      printError(
        'Интерактивному чату агента нужен терминал (TTY); в скриптах используйте vibelog-agent --headless'
      );
      process.exitCode = 1;
      return;
    }
    // Динамический импорт: ink/react не грузятся в headless-путях CLI
    // (паттерн router.ts) — чат тянет TUI-стек только по факту запуска
    const { runInteractiveAgent } = await import('../../agent/interactive.js');
    return runInteractiveAgent(subcommand ? { taskRef: subcommand } : {});
  }
  if (subcommand !== 'analyze') {
    printError(
      `Неизвестная подкоманда agent: ${subcommand} (доступны: analyze, <task-id>, чат без подкоманд)`
    );
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
