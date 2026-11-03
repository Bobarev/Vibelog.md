/**
 * Интерактивный слой CLI (VL-320): текстовый ввод, подтверждение, одиночный
 * и множественный выбор.
 *
 * Почему свой слой, а не `@clack/prompts` (ref-25): проект держит zero runtime
 * dependencies (см. src/cli/args.ts) — переносим только модель поведения
 * Svelte CLI: `initialValue`/`hint` у пунктов, отмена как исключение (аналог
 * `p.isCancel`), «флаг выключает промпт» реализует вызывающий код.
 *
 * Ключевое отличие от прежнего wizard-а (VL-210): НЕТ readline. Прежний код
 * держал один `readline.Interface` на всю сессию, а raw-mode список агентов
 * делал `stdin.pause()` на общем stdin и не возвращал поток readline — после
 * этого ввод стоял, event loop пустел и Node завершал процесс посреди
 * следующего вопроса (дефект 1 VL-320, «оборванный» промпт без стек-трейса).
 * Здесь весь ввод идёт через один raw-mode обработчик: никаких двух
 * конкурирующих потребителей stdin, никакого `setEncoding` (декодируем Buffer
 * сами — иначе readline/поток получают строки вместо байтов).
 *
 * Не-TTY (пайп, CI, тесты без forceInteractive): промпты не читают stdin и
 * возвращают дефолты — wizard не падает (AC7).
 */

/** Ошибка отмены: Ctrl+C (или Esc в списке) в любом промпте. */
export class PromptCancelledError extends Error {
  constructor(message = 'Отменено пользователем') {
    super(message);
    this.name = 'PromptCancelledError';
  }
}

/** Пункт списка выбора. */
export interface PromptOption<T> {
  value: T;
  label: string;
  /** Подсказка справа от подписи (аналог `hint` в ref-25). */
  hint?: string;
  /** Пункт виден, но не выбирается и пропускается навигацией. */
  disabled?: boolean;
}

/** Сессия интерактивных промптов. */
export interface PromptSession {
  /** Текстовый вопрос с дефолтом (Enter — оставить) и валидацией в цикле. */
  askText(question: string, def: string, validate?: (value: string) => string | null): Promise<string>;
  /** Вопрос да/нет. */
  askConfirm(question: string, def: boolean): Promise<boolean>;
  /** Одиночный выбор стрелками. */
  askSelect<T>(question: string, options: PromptOption<T>[], initialIndex?: number): Promise<T>;
  /** Множественный выбор: space — галочка, Enter — подтвердить. */
  askMultiselect<T>(question: string, options: PromptOption<T>[], initial: T[]): Promise<T[]>;
  /** Освобождает ресурсы (идемпотентно). */
  close(): void;
}

/** Минимальный контракт входного потока (stdin или PassThrough в тестах). */
type InputLike = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

/** Минимальный контракт выходного потока. */
type OutputLike = NodeJS.WritableStream & { isTTY?: boolean };

/** Опции сессии (потоки инъектируются в тестах). */
export interface PromptSessionOptions {
  input?: InputLike;
  output?: OutputLike;
  /** Тесты: включить интерактивную ветку на не-TTY потоках. */
  forceInteractive?: boolean;
}

/** Признак интерактивного терминала: оба потока — TTY. */
export function isInteractive(input?: InputLike, output?: OutputLike): boolean {
  const i = input ?? (process.stdin as unknown as InputLike);
  const o = output ?? (process.stdout as unknown as OutputLike);
  return i.isTTY === true && o.isTTY === true;
}

/** Управляющие последовательности терминала. */
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\r\x1b[2K';
const INVERSE = '\x1b[7m';
const RESET = '\x1b[0m';

/** Следующий доступный (не disabled) индекс по кругу. */
function stepIndex(options: PromptOption<unknown>[], from: number, dir: 1 | -1): number {
  const n = options.length;
  let idx = from;
  for (let k = 0; k < n; k++) {
    idx = (idx + dir + n) % n;
    if (!options[idx].disabled) return idx;
  }
  return from;
}

/** Приводит стартовый курсор к первому доступному пункту. */
function clampCursor(options: PromptOption<unknown>[], wanted: number): number {
  if (wanted >= 0 && wanted < options.length && !options[wanted].disabled) return wanted;
  const first = options.findIndex((o) => !o.disabled);
  return first === -1 ? 0 : first;
}

/**
 * Создаёт сессию промптов.
 *
 * @param opts — потоки и флаг принудительного интерактива (тесты)
 */
export function createPromptSession(opts: PromptSessionOptions = {}): PromptSession {
  const input = opts.input ?? (process.stdin as unknown as InputLike);
  const output = opts.output ?? (process.stdout as unknown as OutputLike);
  const interactive = opts.forceInteractive === true || isInteractive(input, output);

  /**
   * Выполняет `run` в raw-mode, отдавая ему установщик обработчика клавиш.
   * Восстановление режима — в `finally`: при отмене/исключении терминал не
   * остаётся в raw-mode (иначе после Ctrl+C ломается оболочка пользователя).
   */
  function rawScope<T>(
    run: (setHandler: (h: (chunk: string) => void) => void) => Promise<T>,
  ): Promise<T> {
    const wasRaw = input.isRaw === true;
    let handler: ((chunk: string) => void) | null = null;
    const onData = (chunk: Buffer | string): void => {
      handler?.(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    };
    if (typeof input.setRawMode === 'function') input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    const restore = (): void => {
      input.removeListener('data', onData);
      if (typeof input.setRawMode === 'function') input.setRawMode(wasRaw);
      input.pause();
    };
    return run((h) => {
      handler = h;
    }).finally(restore);
  }

  /** Текстовый ввод в raw-mode: печатаемые символы, backspace, Enter. */
  function readLine(question: string, def: string): Promise<string> {
    const suffix = def !== '' ? ` [${def}]` : '';
    const head = `${question}${suffix}: `;
    output.write(head);
    let buf = '';
    const redraw = (): void => {
      output.write(`${CLEAR_LINE}${head}${buf}`);
    };
    return rawScope(
      (setHandler) =>
        new Promise<string>((resolve, reject) => {
          setHandler((chunk) => {
            let i = 0;
            while (i < chunk.length) {
              const ch = chunk[i];
              if (ch === '\u0003') {
                output.write('\n');
                reject(new PromptCancelledError());
                return;
              }
              if (ch === '\r' || ch === '\n') {
                output.write('\n');
                resolve(buf.trim() === '' ? def : buf.trim());
                return;
              }
              if (ch === '\u007f' || ch === '\b') {
                buf = Array.from(buf).slice(0, -1).join('');
                redraw();
                i += 1;
                continue;
              }
              if (ch === '\u001b') {
                // Стрелки/Home/End в текстовом вводе игнорируем: отмена — только
                // Ctrl+C, иначе нажатие «влево» обрывало бы весь wizard.
                i += 3;
                continue;
              }
              const printable = ch.replace(/[\u0000-\u001f\u007f]/g, '');
              if (printable.length > 0) {
                buf += printable;
                redraw();
              }
              i += 1;
            }
          });
        }),
    );
  }

  /**
   * Общий движок списка: отрисовка блока из N строк, навигация, галочки.
   *
   * Отрисовка: заголовок печатается один раз, затем блок из N строк. Каждая
   * перерисовка поднимает курсор на N строк вверх (`\x1b[NA`) и перерисовывает
   * блок целиком — поэтому активная строка (инверсная, с `❯`) всегда совпадает
   * с состоянием курсора (дефект 3 VL-320: прежний код считал строки без
   * заголовка и мигал видимостью курсора на каждой итерации).
   */
  function runList<T>(
    question: string,
    options: PromptOption<T>[],
    initialCursor: number,
    initialSelected: number[],
    multi: boolean,
  ): Promise<{ cursor: number; selected: number[] }> {
    if (options.length === 0) return Promise.resolve({ cursor: 0, selected: [] });
    const selected = new Set<number>(initialSelected);
    let cursor = clampCursor(options as PromptOption<unknown>[], initialCursor);

    const frame = (): string[] =>
      options.map((opt, idx) => {
        const pointer = idx === cursor ? '❯' : ' ';
        const mark = multi ? `[${selected.has(idx) ? 'x' : ' '}] ` : '';
        const hint = opt.hint ? ` — ${opt.hint}` : '';
        const text = `${pointer} ${mark}${opt.label}${hint}`;
        return idx === cursor ? `${INVERSE}${text}${RESET}` : text;
      });

    const draw = (first: boolean): void => {
      const body = frame()
        .map((line) => `${CLEAR_LINE}${line}`)
        .join('\n');
      output.write(first ? `${body}\n` : `\x1b[${options.length}A${body}\n`);
    };

    output.write(`${question}\n`);
    output.write(HIDE_CURSOR);
    draw(true);

    return rawScope(
      (setHandler) =>
        new Promise<{ cursor: number; selected: number[] }>((resolve, reject) => {
          const done = (): void => {
            output.write(SHOW_CURSOR);
          };
          setHandler((chunk) => {
            let i = 0;
            while (i < chunk.length) {
              const ch = chunk[i];
              if (ch === '\u001b') {
                const seq = chunk.slice(i, i + 3);
                if (seq === '\u001b[A') {
                  cursor = stepIndex(options as PromptOption<unknown>[], cursor, -1);
                  draw(false);
                  i += 3;
                  continue;
                }
                if (seq === '\u001b[B') {
                  cursor = stepIndex(options as PromptOption<unknown>[], cursor, 1);
                  draw(false);
                  i += 3;
                  continue;
                }
                // Одиночный Esc — отмена (как p.cancel в ref-25)
                done();
                reject(new PromptCancelledError());
                return;
              }
              if (ch === '\u0003') {
                done();
                reject(new PromptCancelledError());
                return;
              }
              if (ch === ' ') {
                const opt = options[cursor];
                if (multi && opt && !opt.disabled) {
                  if (selected.has(cursor)) selected.delete(cursor);
                  else selected.add(cursor);
                  draw(false);
                }
                i += 1;
                continue;
              }
              if (ch === '\r' || ch === '\n') {
                done();
                resolve({ cursor, selected: [...selected].sort((a, b) => a - b) });
                return;
              }
              i += 1;
            }
          });
        }),
    );
  }

  return {
    async askText(question, def, validate) {
      if (!interactive) return def;
      for (;;) {
        const value = await readLine(question, def);
        const err = validate ? validate(value) : null;
        if (!err) return value;
        output.write(`${err}\n`);
      }
    },

    async askConfirm(question, def) {
      if (!interactive) return def;
      for (;;) {
        const raw = await readLine(`${question} (${def ? 'Y/n' : 'y/N'})`, '');
        const answer = raw.trim().toLowerCase();
        if (answer === '') return def;
        if (answer === 'y' || answer === 'yes' || answer === 'д' || answer === 'да') return true;
        if (answer === 'n' || answer === 'no' || answer === 'н' || answer === 'нет') return false;
        output.write('Ответьте y или n\n');
      }
    },

    async askSelect(question, options, initialIndex = 0) {
      if (options.length === 0) throw new Error('askSelect: пустой список вариантов');
      if (!interactive) {
        const idx = clampCursor(options as PromptOption<unknown>[], initialIndex);
        return options[idx].value;
      }
      const result = await runList(question, options, initialIndex, [], false);
      return options[result.cursor].value;
    },

    async askMultiselect(question, options, initial) {
      if (!interactive) {
        const allowed = new Set(options.filter((o) => !o.disabled).map((o) => o.value));
        return initial.filter((v) => allowed.has(v));
      }
      const initialSelected = options
        .map((opt, idx) => (initial.includes(opt.value) && !opt.disabled ? idx : -1))
        .filter((idx) => idx >= 0);
      const result = await runList(question, options, 0, initialSelected, true);
      return result.selected.map((idx) => options[idx].value);
    },

    close() {
      // Ресурсов вне промптов нет: raw-mode восстанавливается в rawScope.
    },
  };
}
