/**
 * CLI-команда vibelog agent (VL-141, VL-158): интерактивный чат агента
 * и анализ сессии без бота.
 *
 * Подкоманды:
 * - без подкоманд / <task-id> — интерактивный TUI-чат (VL-158, перенесён
 *   из пустого запуска vibelog/VB по VL-102); с task-id задача добавляется
 *   в контекст чата; флаг --resume <session-ref> (VL-171) продолжает
 *   сохранённую сессию чата из jsonl-хранилища;
 * - run <фаза> <task-id> [флаги] (VL-305) — headless-запуск фазы тем же
 *   CLI, что спавнит оркестратор (dist/agent/cli.js): удобный UX-путь для
 *   человека вместо отдельного бинаря vibelog-agent;
 * - analyze — паритет бот-команды /analyze (VL-141, VL-169): vibelog agent
 *   analyze <session-ref> [комментарий] спавнит фазу analyze через startAnalyze —
 *   тот же шаблон phase-analyze.md, та же статистика jsonl и рекомендации;
 *   комментарий подставляется в {{comment}} промпта.
 */

import { startAnalyze } from '../../web/orchestrator.js';
import type { PhaseRun } from '../../web/orchestrator.js';
import { PHASES } from '../../web/phase-prompt.js';
import { resolveDefaultAgent } from '../../bot/settings.js';
import { loadProjectEnv } from '../../bot/env.js';
import { taskIdPattern } from '../../core/config.js';
import { printError } from '../ui.js';

/**
 * Справка подкоманды run (VL-305).
 *
 * Фазы берутся из PHASES (общий реестр с шаблонами фаз), чтобы список не
 * разъезжался с реально поддерживаемыми фазами агента.
 */
function printRunHelp(): void {
  console.log(`
vibelog agent run <фаза> <task-id> [флаги агента]

Запускает headless-фазу задачи тем же CLI, что спавнит оркестратор
(vibelog-agent): промпт собирается из шаблона фазы, в stdout — JSON type=result.
Флаги передаются агенту как есть — парсер vibelog их не переинтерпретирует.

Фазы: ${PHASES.join(' | ')}

Флаги агента:
  --model <id>              — модель рана (VL-239)
  --headless                — JSON-результат в stdout (дефолт без TTY)
  --comment <текст>         — подстановка {{comment}} в шаблон фазы
  --max-tool-calls <N>      — лимит tool-calls loop
  --max-wall-time <сек>     — лимит времени фазы
  --max-requests <N>        — лимит LLM-запросов фазы
  --resume <sessionId>      — продолжить сохранённую сессию
  --no-mcp                  — без MCP-инструментов Vibelog

Полная справка агента (все флаги): vibelog-agent --help

Примеры:
  vibelog agent run plan VL-111 --model routerai/openai/gpt-5 --headless
  vibelog agent run code VL-111 --comment "правь только src/cli"`);
}

/**
 * Обработать подкоманду agent.
 *
 * @param subcommand — подкоманда (run, analyze, <task-id> или пусто — чат)
 * @param positional — позиционные аргументы (session-ref для analyze)
 * @param flags — флаги CLI; `resume` (VL-171) — session-ref для возобновления
 *   TUI-чата сохранённой сессии (vb:agent-XXX либо agent-XXX)
 * @param cwd — каталог проекта (там же backlog/ и .vibelog/)
 * @param rawArgs — сырой argv процесса (без node и пути к скрипту). Нужен
 *   подкоманде run (VL-305): флаги фазы передаются агенту БЕЗ переинтерпретации
 *   парсером vibelog (src/cli/args.ts) — иначе теряются значения с пробелами,
 *   порядок и флаги, похожие на переключатели
 */
export async function runAgent(
  subcommand: string,
  positional: string[],
  flags: Record<string, unknown>,
  cwd: string,
  rawArgs: string[] = []
): Promise<void> {
  // VL-189: env проекта (.env + секция env settings.json) — analyze спавнит
  // агента из этого процесса (без загрузки — VIBELOG_LLM_* не долетают);
  // для чата двойная загрузка идемпотентна — dotenv-семантика (вызов
  // повторится в runInteractiveAgent)
  loadProjectEnv(cwd);
  // VL-305: run <фаза> <task-id> [флаги] — headless-запуск фазы тем же CLI,
  // что спавнит оркестратор. Ветка идёт ДО чата: 'run' не похож на task-id,
  // но и в «неизвестную подкоманду» попадать не должен.
  if (subcommand === 'run') {
    // Сырой argv после 'run' — флаги фазы уходят агенту как есть.
    // Обычный случай: rawArgs = ['agent', 'run', <фаза>, <task-id>, ...флаги];
    // если флаги vibelog стоят до подкоманды (--help и т.п.), ищем 'run'
    // в остатке — parseArgs уже подтвердил, что подкоманда именно run.
    const runIdx = rawArgs[0] === 'agent' && rawArgs[1] === 'run' ? 1 : rawArgs.indexOf('run', 1);
    const agentArgv = runIdx >= 0 ? rawArgs.slice(runIdx + 1) : [];
    // --help/-h первым аргументом — справка run (exit 0)
    if (agentArgv[0] === '--help' || agentArgv[0] === '-h') {
      printRunHelp();
      return;
    }
    // Без аргументов (AC3) либо с одним позиционным (агент принял бы его за
    // готовый промпт — qwen-совместимость) — справка и exit 1
    if (agentArgv.length < 2 || agentArgv[0].startsWith('-')) {
      printRunHelp();
      process.exitCode = 1;
      return;
    }
    // Динамический импорт: агентский CLI тянет LLM/MCP-стек — грузим только
    // по факту запуска фазы (паттерн чата ниже)
    const { main } = await import('../../agent/cli.js');
    try {
      // main сам выставляет process.exitCode (0/1/130) и печатает JSON
      // в stdout — exit code возвращается процессу как есть (AC1)
      await main(agentArgv);
    } catch (err) {
      printError((err as Error).message);
      process.exitCode = 1;
    }
    return;
  }
  // Интерактивный чат (VL-158): без подкоманды либо с <task-id>.
  // TTY-check ДО getTask: в скриптах/CI чат не запускается вовсе —
  // ошибка одинакова для несуществующей задачи и pipe-запуска
  if (subcommand === '' || taskIdPattern(cwd).test(subcommand)) {
    // VL-171: --resume <session-ref> возобновляет сохранённую сессию чата.
    // Значение флага проверяем ДО TTY-check: boolean (флаг без значения)
    // означает, что sessionId не задан — явная ошибка вместо тихого старта
    // новой сессии
    const resumeFlag = flags.resume;
    let resume: string | undefined;
    if (resumeFlag !== undefined) {
      if (typeof resumeFlag !== 'string' || !resumeFlag.trim()) {
        printError('--resume требует session-ref: vibelog agent --resume vb:agent-XXX');
        process.exitCode = 1;
        return;
      }
      resume = resumeFlag.trim();
    }
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
    return runInteractiveAgent({
      ...(subcommand ? { taskRef: subcommand } : {}),
      ...(resume !== undefined ? { resume } : {}),
    });
  }
  if (subcommand !== 'analyze') {
    printError(
      `Неизвестная подкоманда agent: ${subcommand} (доступны: run <фаза> <task-id>, analyze, <task-id>, чат без подкоманд)`
    );
    process.exitCode = 1;
    return;
  }
  // --resume с analyze — явная ошибка: analyze запускает headless-фазу
  // разбора jsonl, возобновление к ней неприменимо
  if (flags.resume !== undefined) {
    printError('--resume поддерживается только в интерактивном чате (без подкоманды analyze)');
    process.exitCode = 1;
    return;
  }
  const ref = positional[0];
  if (!ref) {
    printError('Синтаксис: vibelog agent analyze <session-ref> [комментарий]');
    process.exitCode = 1;
    return;
  }
  // VL-169: необязательный комментарий — хвост после session-ref (как у бота)
  const comment = positional.slice(1).join(' ').trim() || undefined;
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
    const res = startAnalyze(cwd, ref, onExit, agent, comment);
    if ('error' in res) {
      printError(res.error);
      process.exitCode = 1;
      resolve();
      return;
    }
    console.log(`🚀 Фаза analyze запущена, PID ${res.pid}`);
  });
}
