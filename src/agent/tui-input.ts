/**
 * Ввод и подтверждения TUI агента на `@clack/prompts` / `@clack/core` (VL-321).
 *
 * Почему отдельный модуль: `tui.ts` отвечает за вывод (append-транскрипт и
 * статусная строка), а ввод — это clack-промпт со своей жизненной цикличностью
 * (readline, raw-mode, скрытие курсора). Держать их в одном файле значило бы
 * смешать два владельца stdin, что и было источником прошлых проблем
 * (lesson-195: readline + ручной raw-mode на одном потоке дают «тихое»
 * падение процесса).
 *
 * Почему свой промпт, а не готовый `text` из `@clack/prompts`: у чата две
 * особенности, которых нет у обычного вопроса: (1) история сообщений по
 * ↑/↓ — в `text` её нет; (2) выход по Ctrl+D, тогда как clack считает
 * cancel-клавишами только Ctrl+C и Esc. Обе добавляются поверх базового
 * `TextPrompt` из `@clack/core` — редактирование строки (стрелки, Home/End,
 * Backspace, Delete, вставка) и работу с шириной терминала библиотека уже
 * делает сама, дублировать их руками не нужно.
 *
 * Ctrl+C обрабатывается базовым Prompt (алиас `cancel` в `@clack/core`):
 * промпт завершается cancel-символом, а не аварийным завершением процесса —
 * `interactive.ts` получает управление и закрывает MCP без стектрейса.
 */
import { TextPrompt } from '@clack/core';
import { confirm as clackConfirm, isCancel } from '@clack/prompts';
import type { Readable, Writable } from 'node:stream';

/** Максимум символов в строке ввода (защита от гигантской вставки). */
export const INPUT_MAX_CHARS = 500;

/** Сколько последних сообщений помнить в истории (↑/↓). */
export const HISTORY_MAX = 50;

// ANSI-коды — свои, а не `styleText` из node:util: пакет @clack/core сам
// тянет styleText (нужен Node >= 20.12), но собственный код проекта не
// должен добавлять эту зависимость молча — цвета здесь косметика.
const GRAY = '\x1b[90m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Минимальный контракт входного потока (stdin или PassThrough в тестах). */
export interface InputLike extends Readable {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
}

/** Минимальный контракт выходного потока. */
export interface OutputLike extends Writable {
  isTTY?: boolean;
  columns?: number;
}

/** Параметры промпта ввода. */
export interface ChatPromptOptions {
  input: InputLike;
  output: OutputLike;
  /** Приглашение над строкой ввода. */
  message: string;
  /** История сообщений в хронологическом порядке (последнее — в конце). */
  history: string[];
  /** Отмена извне (unmount TUI): промпт резолвится отменой. */
  signal?: AbortSignal;
}

/**
 * Отрисовка блока промпта. Базовый Prompt сам делает diff кадров и
 * перерисовывает только этот блок — полного redraw экрана нет.
 */
function renderChatPrompt(prompt: ChatInputPrompt): string {
  const bar = `${GRAY}│${RESET}  `;
  const input = prompt.userInputWithCursor;
  switch (prompt.state) {
    case 'submit':
      return `${bar}${CYAN}>${RESET} ${prompt.userInput}\n`;
    case 'cancel':
      return `${bar}${DIM}${prompt.userInput}${RESET}\n`;
    case 'error':
      return `${bar}${CYAN}>${RESET} ${input}\n${bar}${YELLOW}${prompt.error}${RESET}\n`;
    default:
      return (
        `${bar}${CYAN}>${RESET} ${input}\n` +
        `${bar}${DIM}↑/↓ — история · Enter — отправить · Ctrl+C/Ctrl+D — выход${RESET}\n`
      );
  }
}

/**
 * Строка ввода чата: редактирование и навигация — средствами clack,
 * история сообщений — нативная история readline (↑/↓), Ctrl+D — отмена.
 */
export class ChatInputPrompt extends TextPrompt {
  /** История сообщений (хронологический порядок). */
  private readonly history: string[];

  /** Приглашение над строкой (рисуется в render). */
  readonly message: string;

  constructor(opts: ChatPromptOptions) {
    super({
      input: opts.input,
      output: opts.output,
      signal: opts.signal,
      // Лимит длины — через validate (clack показывает ошибку и не отправляет),
      // а не обрезкой: пользователь видит, что именно не так.
      validate: (value) => {
        if (typeof value === 'string' && Array.from(value).length > INPUT_MAX_CHARS) {
          return `Максимум ${INPUT_MAX_CHARS} символов`;
        }
        return undefined;
      },
      render() {
        return renderChatPrompt(this as unknown as ChatInputPrompt);
      },
    });
    this.history = opts.history;
    this.message = opts.message;
    // Ctrl+D (EOF) не входит в алиасы cancel у @clack/core — переводим в
    // cancel сами: базовый onKeypress после emit('key') увидит state==='cancel'
    // и закроет промпт отменой (никакого process.exit).
    this.on('key', (_char, key) => {
      if (key?.name === 'd' && key.ctrl === true) this.state = 'cancel';
    });
  }

  /**
   * Сидируем историю readline сообщениями чата: тогда ↑/↓ работают штатным
   * механизмом readline, и базовый Prompt подхватывает строку через rl.line
   * (свой перехват стрелок писал бы в обход трекинга и затирался на
   * следующем нажатии).
   *
   * `rl` — private-поле `@clack/core`, публичного хука на историю нет;
   * структурное приведение здесь осознанное: prompt() создаёт readline
   * синхронно, до первого await.
   */
  override prompt(): Promise<symbol | string | undefined> {
    const result = super.prompt();
    const rl = (this as unknown as { rl?: { history: string[] } }).rl;
    if (rl) {
      // У readline history[0] — самое свежее сообщение
      rl.history = [...this.history].slice(-HISTORY_MAX).reverse();
    }
    return result;
  }
}

/**
 * Показать промпт ввода и дождаться строки.
 *
 * @returns текст сообщения либо null — отмена (Ctrl+C / Ctrl+D / Esc /
 * abort signal); null обрабатывает вызывающий код (выход из чата).
 */
export async function createChatPrompt(opts: ChatPromptOptions): Promise<string | null> {
  const prompt = new ChatInputPrompt(opts);
  const result = await prompt.prompt();
  return typeof result === 'string' ? result : null;
}

/** Подмножество API `@clack/prompts`, нужное подтверждениям (seam для тестов). */
export interface ClackConfirmApi {
  confirm: typeof clackConfirm;
  isCancel: typeof isCancel;
}

/**
 * Подтверждение да/нет через `@clack/prompts` (единый стиль с остальным
 * интерактивом; задел под tool-approval, когда в loop появится этот поток).
 *
 * @returns true/false — ответ; null — пользователь отменил промпт
 * (Ctrl+C/Esc). Null не схлопывается в false: вызывающему коду важно
 * различить «нет» и «отменил вопрос».
 */
export async function createConfirmPrompt(
  message: string,
  initialValue: boolean,
  opts: {
    input?: InputLike;
    output?: OutputLike;
    /** Только тесты: подмена реализации clack (проверка маппинга параметров). */
    prompts?: ClackConfirmApi;
  } = {},
): Promise<boolean | null> {
  const p = opts.prompts ?? { confirm: clackConfirm, isCancel };
  const result = await p.confirm({
    message,
    initialValue,
    ...(opts.input !== undefined ? { input: opts.input } : {}),
    ...(opts.output !== undefined ? { output: opts.output } : {}),
  });
  if (p.isCancel(result)) return null;
  return result === true;
}
