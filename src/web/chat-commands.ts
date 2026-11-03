/**
 * Слэш-команды веб-чата (VL-314).
 *
 * До этой задачи слэш-команд в веб-чате не было вообще: текст `/compact`
 * уходил в LLM как обычное сообщение. Точка перехвата одна — `produce()` в
 * `src/web/chat.ts`, ДО `history.push({role:'user'})` и до LLM-цикла; ответ
 * команды отдаётся обычными SSE-событиями `text` + `done`, поэтому клиент
 * рендерит его как сообщение ассистента без правок в `chat-runtime.tsx`.
 *
 * Реестр — по образцу `src/bot/registry.ts` (там он уже кормит `/help`):
 * единый источник правды для справки, для `GET /api/chat/commands` (позже
 * пригодится ComposerMenu) и для парсера. Справка собирается ИЗ реестра, а
 * не хардкодится — новая команда автоматически появляется в `/help`
 * (рассинхрон захардкоженных списков — историческая проблема VL-54).
 *
 * Команды недоступны во время стриминга и в approval-паузе: проверка живёт
 * в `chat.ts` (там известно состояние хода), реестр только описывает команды.
 */

/** Контекст исполнения команды: всё, что нужно обработчику. */
export interface ChatCommandContext {
  /** Каталог проекта (backlog/, .vibelog/). */
  cwd: string;
  /** id треда (валидирован вызывающим). */
  threadId: string;
  /** Аргументы после имени команды (уже разбитые по пробелам). */
  args: string[];
  /** Полная история треда (jsonl) — команды её НЕ меняют. */
  history: readonly unknown[];
}

/** Результат исполнения команды: текст ответа ассистента. */
export interface ChatCommandResult {
  /** Текст, который уйдёт в SSE-событие `text` (рендерится как ответ). */
  text: string;
  /** true — команда завершилась ошибкой (клиент покажет как ошибку). */
  isError?: boolean;
}

/** Описание одной слэш-команды чата. */
export interface ChatCommand {
  /** Имя без слэша (например `compact`). */
  name: string;
  /** Русское описание в одну строку. */
  description: string;
  /** Представление в справке: `/trim [off]`. */
  usage: string;
  /** Примеры вызова для `/help`. */
  examples?: string[];
  /**
   * Обработчик. Может быть асинхронным (LLM-саммари у `/compact`).
   * Отсутствие обработчика — команда только для справки (не используется).
   */
  run?: (ctx: ChatCommandContext) => Promise<ChatCommandResult> | ChatCommandResult;
}

/**
 * Разобранная слэш-команда: имя + аргументы.
 *
 * `null` — строка не является командой (обычное сообщение в LLM).
 * Строка вида `/` без имени тоже не команда: пользователь мог начать печатать.
 */
export interface ParsedCommand {
  name: string;
  args: string[];
}

/**
 * Разобрать сообщение как слэш-команду.
 *
 * Команда — только если сообщение НАЧИНАЕТСЯ со слэша и имя непустое.
 * `/compact` в середине текста командой не считается (это обычный текст).
 * Имя приводится к нижнему регистру: `/HELP` работает как `/help`.
 */
export function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).split(/\s+/).filter(p => p !== '');
  const name = parts[0];
  if (name === undefined || name === '') return null;
  return { name: name.toLowerCase(), args: parts.slice(1) };
}

/**
 * Текст справки `/help`: собирается из реестра (AC2), а не хардкодится.
 *
 * Формат — markdown-список: имя с usage, описание, примеры. Клиент рендерит
 * ответ ассистента как markdown, поэтому разметка читаемая.
 */
export function helpText(commands: readonly ChatCommand[] = CHAT_COMMANDS): string {
  const lines: string[] = ['**Команды веб-чата**', ''];
  for (const c of commands) {
    lines.push(`- \`${c.usage}\` — ${c.description}`);
    for (const ex of c.examples ?? []) lines.push(`  пример: \`${ex}\``);
  }
  lines.push('');
  lines.push('Команды не отправляются в модель: они исполняются на сервере.');
  return lines.join('\n');
}

/**
 * Текст ошибки «неизвестная команда» со списком доступных (AC3).
 *
 * Список берётся из реестра — добавленная команда сразу попадает в подсказку.
 */
export function unknownCommandText(name: string, commands: readonly ChatCommand[] = CHAT_COMMANDS): string {
  const names = commands.map(c => `/${c.name}`).join(', ');
  return `Неизвестная команда: /${name}. Доступные команды: ${names}. Справка — /help.`;
}

/**
 * Реестр команд веб-чата.
 *
 * Обработчики `/trim` и `/compact` подключаются в `chat.ts` (там есть LLM,
 * учёт usage и состояние хода) — здесь только метаданные и справка, чтобы
 * `GET /api/chat/commands` отдавал реестр БЕЗ исполнения (AC1).
 */
export const CHAT_COMMANDS: ChatCommand[] = [
  {
    name: 'help',
    description: 'Справка по всем командам чата',
    usage: '/help',
    examples: ['/help'],
  },
  {
    name: 'trim',
    description:
      'Сжать контекст детерминированно (0 ₽): в модель уходит только хвост диалога. ' +
      'История в ленте не меняется. `/trim off` — сбросить сжатие',
    usage: '/trim [off]',
    examples: ['/trim', '/trim off'],
  },
  {
    name: 'compact',
    description:
      'Сжать контекст через LLM-саммари: старые сообщения пересказываются, ' +
      'хвост остаётся дословно. `/compact reset` — сбросить сжатие',
    usage: '/compact [reset]',
    examples: ['/compact', '/compact reset'],
  },
];

/** Найти команду по имени (регистр не важен); null — команды нет. */
export function findCommand(
  name: string,
  commands: readonly ChatCommand[] = CHAT_COMMANDS,
): ChatCommand | null {
  const lower = name.toLowerCase();
  return commands.find(c => c.name === lower) ?? null;
}

/**
 * Реестр для `GET /api/chat/commands`: только метаданные, без обработчиков
 * (функции не сериализуются в JSON и не должны утекать в ответ).
 */
export function commandsView(
  commands: readonly ChatCommand[] = CHAT_COMMANDS,
): { name: string; description: string; usage: string; examples: string[] }[] {
  return commands.map(c => ({
    name: c.name,
    description: c.description,
    usage: c.usage,
    examples: [...(c.examples ?? [])],
  }));
}
