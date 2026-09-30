/**
 * Роутер CLI-команд Vibelog.md.
 *
 * Задача: разобрать аргументы командной строки и вызвать нужную команду.
 * На этом этапе (PLAN-01) — заглушка, которая просто выводит help.
 *
 * В PLAN-04 здесь будет полноценный роутер с поддержкой всех команд:
 * init, task, board, browser, milestone, search, ready, instructions, mcp, config.
 */

/**
 * Обработать аргументы командной строки и вызвать соответствующую команду.
 *
 * @param {string[]} args — аргументы командной строки (без node и пути к скрипту).
 * @returns {Promise<void>}
 */
export async function route(args) {
  // На этапе скаффолда — выводим справку
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log('Vibelog.md — markdown-нативный таск-менеджер');
    console.log('');
    console.log('Команды:');
    console.log('  init [name]          Инициализировать backlog');
    console.log('  task create <title>  Создать задачу');
    console.log('  board                Открыть доску задач');
    console.log('  browser              Открыть kanban в браузере');
    console.log('');
    console.log('Подробности: vibelog <command> --help');
    return;
  }

  throw new Error(`Неизвестная команда: ${args[0]}. Выполните "vibelog help" для списка команд.`);
}
