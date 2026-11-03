/**
 * Интерактивный слой CLI (VL-320, переписан на `@clack/prompts` в VL-322):
 * текстовый ввод, подтверждение, одиночный и множественный выбор.
 *
 * Почему обёртка, а не прямой вызов clack в wizard-е: `init-wizard.ts` знает
 * только контракт `PromptSession` (`askText`/`askConfirm`/`askSelect`/
 * `askMultiselect`/`close`) и не должен зависеть от API сторонней библиотеки —
 * при смене TUI-движка правится один этот файл.
 *
 * Почему clack (ref-25, Svelte CLI): ширина символов (CJK/эмодзи), resize
 * терминала, Windows-консоль, скролл длинных списков и инверсия активной
 * строки уже решены там. Прежний самописный слой (VL-320) держал raw-mode и
 * ANSI-отрисовку вручную — каждую из этих проблем пришлось бы доводить
 * самостоятельно. Ограничение проекта — «никаких нативных зависимостей»
 * (README:27) — соблюдено: clack и его транзитивные пакеты (`@clack/core`,
 * `fast-string-width`, `fast-wrap-ansi`, `sisteransi`) это чистый JS.
 *
 * Про stdin (lesson-195): общего readline-инстанса больше нет — clack создаёт
 * и закрывает свой readline на каждый промпт, поэтому ручной lifecycle
 * (`setRawMode`, `pause`/`resume`, скрытие курсора) не нужен и не дублируется.
 *
 * Не-TTY (пайп, CI, тесты без forceInteractive): промпты не читают stdin и
 * возвращают дефолты — wizard не падает (AC7 VL-320).
 */

import { confirm, isCancel, multiselect, password, select, text } from '@clack/prompts';
import type { Option } from '@clack/prompts';
import type { Readable, Writable } from 'node:stream';

/** Ошибка отмены: Ctrl+C (или Esc) в любом промпте. */
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
  /**
   * Ввод секрета с маскировкой (VL-324): символы не отображаются.
   * Enter без ввода — пустая строка (или `def`), то есть «пропустить».
   */
  askPassword(question: string, def: string): Promise<string>;
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

/**
 * Подмножество API `@clack/prompts`, которое использует обёртка.
 * Отдельный тип (а не `typeof import(...)`) — чтобы тесты могли подставить
 * фейковую реализацию и проверить маппинг параметров без реального TTY.
 */
export interface ClackPrompts {
  text: typeof text;
  confirm: typeof confirm;
  select: typeof select;
  multiselect: typeof multiselect;
  password: typeof password;
  isCancel: typeof isCancel;
}

/** Опции сессии (потоки инъектируются в тестах). */
export interface PromptSessionOptions {
  input?: InputLike;
  output?: OutputLike;
  /** Тесты: включить интерактивную ветку на не-TTY потоках. */
  forceInteractive?: boolean;
  /** Только тесты: подмена реализации clack (проверка маппинга параметров). */
  prompts?: ClackPrompts;
}

/** Признак интерактивного терминала: оба потока — TTY. */
export function isInteractive(input?: InputLike, output?: OutputLike): boolean {
  const i = input ?? (process.stdin as unknown as InputLike);
  const o = output ?? (process.stdout as unknown as OutputLike);
  return i.isTTY === true && o.isTTY === true;
}

/**
 * Индекс стартового пункта: `wanted`, если он доступен, иначе первый
 * не-disabled. Нужен для маппинга `initialIndex` → `initialValue` у `select`
 * (clack сам переезжает с disabled-пункта, но нам важно совпасть с прежним
 * поведением `clampCursor` и в не-TTY-ветке).
 */
function firstEnabledIndex<T>(options: PromptOption<T>[], wanted: number): number {
  if (wanted >= 0 && wanted < options.length && !options[wanted].disabled) return wanted;
  const first = options.findIndex((o) => !o.disabled);
  return first === -1 ? 0 : first;
}

/** Пункты для clack: отбрасываем `undefined`-поля, чтобы не затирать дефолты. */
function toClackOptions<T>(options: PromptOption<T>[]): Option<T>[] {
  return options.map((o) => ({
    value: o.value,
    label: o.label,
    ...(o.hint !== undefined ? { hint: o.hint } : {}),
    ...(o.disabled !== undefined ? { disabled: o.disabled } : {}),
  })) as Option<T>[];
}

/**
 * Создаёт сессию промптов.
 *
 * @param opts — потоки, флаг принудительного интерактива и seam для тестов
 */
export function createPromptSession(opts: PromptSessionOptions = {}): PromptSession {
  const input = opts.input ?? (process.stdin as unknown as InputLike);
  const output = opts.output ?? (process.stdout as unknown as OutputLike);
  const interactive = opts.forceInteractive === true || isInteractive(input, output);
  const p: ClackPrompts = opts.prompts ?? { text, confirm, select, multiselect, password, isCancel };
  // clack ждёт node-потоки (`Readable`/`Writable`), а в тестах передаётся
  // `PassThrough` — по контракту это они и есть; приводим тип один раз здесь,
  // чтобы не повторять приведение в каждом промпте.
  const promptInput = input as unknown as Readable;
  const promptOutput = output as unknown as Writable;

  /**
   * Резолвит результат промпта clack: отмена (Ctrl+C или Esc — оба алиаса
   * `cancel` в `@clack/core`) приходит символом `CANCEL_SYMBOL`, а не
   * исключением, поэтому превращаем её в `PromptCancelledError` — наверх
   * wizard пробрасывает её, а `init.ts` печатает «Отменено…» с кодом 0.
   */
  function orCancel<T>(result: T | symbol): T {
    if (p.isCancel(result)) throw new PromptCancelledError();
    return result as T;
  }

  return {
    async askText(question, def, validate) {
      if (!interactive) return def;
      const raw = orCancel(
        await p.text({
          message: question,
          input: promptInput,
          output: promptOutput,
          ...(def !== '' ? { placeholder: `Enter — оставить «${def}»`, defaultValue: def } : {}),
          // Валидация — на итоговом значении (пустой ввод = дефолт), как в
          // прежнем слое; clack сам переспрашивает, пока не вернём undefined.
          validate: (value) => {
            const resolved = (value ?? '').trim() || def;
            const err = validate ? validate(resolved) : null;
            return err ?? undefined;
          },
        }),
      );
      return String(raw ?? '').trim() || def;
    },

    async askPassword(question, def) {
      // Не-TTY: секрет не читаем — возвращаем дефолт (обычно пустая строка,
      // то есть «пропустить»), wizard не падает (AC10).
      if (!interactive) return def;
      const raw = orCancel(
        await p.password({
          message: question,
          input: promptInput,
          output: promptOutput,
        }),
      );
      // Значение секрета НЕ обрезаем по краям агрессивно: пробелы в ключе
      // почти наверняка случайны, но trim безопасен (ключи их не содержат).
      return String(raw ?? '').trim() || def;
    },

    async askConfirm(question, def) {
      if (!interactive) return def;
      return orCancel(
        await p.confirm({
          message: question,
          initialValue: def,
          input: promptInput,
          output: promptOutput,
        }),
      );
    },

    async askSelect(question, options, initialIndex = 0) {
      if (options.length === 0) throw new Error('askSelect: пустой список вариантов');
      const start = firstEnabledIndex(options, initialIndex);
      if (!interactive) return options[start].value;
      return orCancel(
        await p.select({
          message: question,
          options: toClackOptions(options),
          initialValue: options[start].value,
          input: promptInput,
          output: promptOutput,
        }),
      );
    },

    async askMultiselect(question, options, initial) {
      const allowed = new Set(options.filter((o) => !o.disabled).map((o) => o.value));
      const initialValues = initial.filter((v) => allowed.has(v));
      if (!interactive) return initialValues;
      return orCancel(
        await p.multiselect({
          message: question,
          options: toClackOptions(options),
          initialValues,
          // Пустой выбор допустим (можно снять все галочки, например «без
          // агентов»): у clack по умолчанию требуется хотя бы один пункт.
          required: false,
          input: promptInput,
          output: promptOutput,
        }),
      );
    },

    close() {
      // Ресурсов вне промптов нет: clack создаёт и закрывает свой readline на
      // каждый промпт, общего инстанса для освобождения не остаётся.
    },
  };
}
