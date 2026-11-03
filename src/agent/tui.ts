/**
 * TUI агента (VL-321): append-вывод + статусная строка, интерактив на clack.
 *
 * История: VL-86 — Ink/React; VL-155 — собственный ANSI-рендер на чистом
 * Node.js; VL-321 — интерактивные элементы переведены на `@clack/prompts`
 * (`intro`/`outro`/`log.*`/`spinner`), ввод чата — промпт на `@clack/core`
 * (`tui-input.ts`), а вывод перестал быть «кадром».
 *
 * Почему без полного redraw: прежняя модель рисовала ВЕСЬ экран заново
 * (`\x1b[2J\x1b[H`) на каждом событии и на тике раз в секунду — отсюда
 * мигание, «прыгающий» курсор и потерянный скролл. Теперь вывод append-only
 * (как в обычном терминале): шапка один раз, токены и карточки дописываются
 * в конец, а обновляется только нижняя строка счётчиков (`\r\x1b[2K`) —
 * она не мешает уже выведенному тексту и не стирает его.
 *
 * Контракт вывода (унаследован от VL-86/VL-155) не меняется: TUI рендерится
 * ТОЛЬКО в интерактивном режиме (cli.ts: stdout.isTTY, без --headless/
 * --output-format json/--no-tui) и живёт на stderr в альтернативном буфере —
 * stdout остаётся под единственную JSON-строку результата (контракт
 * оркестратора VL-63). `TuiHandle`, `renderTui`, `renderInteractiveTui` и
 * `InteractiveTuiHandle.setBusy` сохранены дословно — cli.ts и interactive.ts
 * не переписываются.
 */
import { intro, log, outro, spinner } from '@clack/prompts';
import type { LlmUsage } from './llm.js';
import {
  formatCounters,
  formatToolCard,
  formatUserMessage,
  type ToolCallView,
} from './tui-format.js';
import { createChatPrompt, createConfirmPrompt } from './tui-input.js';

// ANSI-цвета для тех мест, где clack не красит сам (стрим, карточки).
// Только при stderr.isTTY: в pipe управпоследовательности — мусор.
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Обернуть текст ANSI-цветом (вне TTY — вернуть как есть). */
function paint(color: string, text: string, useColor: boolean): string {
  return useColor ? color + text + RESET : text;
}

/** Состояние TUI: только то, что нужно для нижней строки счётчиков. */
interface TuiState {
  /** Накопленный usage модели (onUsage). */
  usage: LlmUsage | null;
  /** Номер текущего хода. */
  turn: number;
  /** Момент старта TUI — для счётчика времени фазы. */
  startedAt: number;
  /** Идёт ли ход чата (интерактивный чат). */
  busy: boolean;
}

/**
 * Мини-store: колбэки loop пишут состояние через update(); перерисовка
 * статусной строки — отдельным шагом (её вызывает тик и сами колбэки).
 */
function createStore(): {
  get: () => TuiState;
  update: (patch: Partial<TuiState>) => void;
} {
  let state: TuiState = {
    usage: null,
    turn: 0,
    startedAt: Date.now(),
    busy: false,
  };
  return {
    get: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
  };
}

type Store = ReturnType<typeof createStore>;

/** Аппендер: единственная точка записи в поток TUI. */
interface Appender {
  /** Дописать токен стрима (без перерисовки чего-либо ранее выведенного). */
  appendStream(token: string): void;
  /** Закрыть незавершённую строку стрима (перевод строки, если её нет). */
  endLine(): void;
  /** Дописать цельный блок (карточка, ошибка, реплика) отдельной строкой. */
  appendBlock(text: string): void;
  /** Нарисовать/перерисовать нижнюю строку (только она, без очистки экрана). */
  drawStatus(text: string): void;
  /** Убрать нарисованную нижнюю строку (перед append-выводом). */
  clearStatus(): void;
}

/**
 * Append-аппендер. Ключевой инвариант: перед любой дописью снятая «живая»
 * строка очищается (`\r\x1b[2K`), а статус не рисуется, пока открыта
 * частичная строка стрима — иначе счётчики затирали бы текст модели.
 */
function createAppender(options: {
  out: NodeJS.WriteStream;
  useColor: boolean;
}): Appender {
  const { out, useColor } = options;
  /** Открыта ли частичная строка (стрим без завершающего \n). */
  let lineOpen = false;
  /** Нарисована ли сейчас нижняя статусная строка. */
  let statusDrawn = false;

  const clearStatus = (): void => {
    if (!statusDrawn) return;
    out.write('\r\x1b[2K');
    statusDrawn = false;
  };
  const endLine = (): void => {
    if (!lineOpen) return;
    out.write('\n');
    lineOpen = false;
  };

  return {
    appendStream(token: string): void {
      if (token.length === 0) return;
      clearStatus();
      out.write(paint(CYAN, token, useColor));
      lineOpen = !token.endsWith('\n');
    },
    endLine,
    appendBlock(text: string): void {
      clearStatus();
      endLine();
      out.write(text.endsWith('\n') ? text : text + '\n');
    },
    drawStatus(text: string): void {
      // Не-TTY (pipe/файл): статусную строку не рисуем — \r там мусор
      if (!out.isTTY) return;
      // Открытая частичная строка стрима: счётчики не должны её затирать
      if (lineOpen) return;
      out.write('\r\x1b[2K' + text);
      statusDrawn = true;
    },
    clearStatus,
  };
}

/**
 * Публичный handle TUI: колбэки loop (VL-83) + завершение.
 * Сигнатуры не менялись с Ink-версии — cli.ts/interactive.ts не переписаны.
 */
export interface TuiHandle {
  onToken(token: string): void;
  onToolStart(name: string, args: Record<string, unknown>): void;
  onToolEnd(name: string, output: string, isError?: boolean): void;
  onUsage(usage: LlmUsage, turn: number): void;
  onError(text: string): void;
  /**
   * Завершить ход чата (VL-113): ответ уже выведен стримом — закрываем
   * только открытую строку и сбрасываем «pending»-состояние.
   */
  finishTurn(): void;
  /** Размонтировать TUI: остановить тик, выйти из альтернативного буфера. */
  unmount(): void;
}

/** Внутренний результат сборки: handle + управление «занятостью» ввода. */
interface BuiltTui {
  store: Store;
  handle: TuiHandle;
  /** Идёт ли ход чата: спиннер «модель думает…» / статусная строка. */
  setBusy(busy: boolean): void;
}

/**
 * Сборка TUI: альтернативный буфер, аппендер, тик счётчиков и handle
 * колбэков loop. Общий каркас для renderTui/renderInteractiveTui.
 */
function buildTui(options: { header?: string; interactive: boolean }): BuiltTui {
  const store = createStore();
  const out = process.stderr;
  const useColor = Boolean(out.isTTY);
  const interactive = options.interactive;
  // Альтернативный буфер: скролл основного буфера не засоряется выводом TUI
  // (сохранено с VL-155; при unmount возвращаемся в основной буфер).
  const useAltBuffer = useColor;
  if (useAltBuffer) out.write('\u001b[?1049h');
  const app = createAppender({ out, useColor });

  const counters = (): string => {
    const state = store.get();
    return formatCounters({
      turn: state.turn,
      inputTokens: state.usage?.input_tokens ?? 0,
      outputTokens: state.usage?.output_tokens ?? 0,
      cacheTokens: state.usage?.cache_read_input_tokens ?? 0,
      elapsedMs: Date.now() - state.startedAt,
    });
  };

  // Шапка — один раз за сессию (только интерактивный чат); в оркестраторном
  // режиме её нет — там stderr уходит в logTail и лишние строки мешают.
  if (options.header !== undefined) intro(options.header, { output: out });

  /** Имя → момент onToolStart (последний вызов имени — задержки редки). */
  const started = new Map<string, number>();
  /** Pending-инструмент: показывается в нижней строке, пока вызов идёт. */
  let pendingTool: string | null = null;

  /**
   * Спиннер «модель думает…» (clack): живёт между началом хода и первым
   * токеном/карточкой. Как только пошёл стрим — снимается и уступает место
   * обычной дописи текста и статусной строке со счётчиками.
   */
  let spin: ReturnType<typeof spinner> | null = null;
  const stopSpinner = (): void => {
    if (!spin) return;
    // clear() убирает строку спиннера, не оставляя сообщения о завершении
    spin.clear();
    spin = null;
  };
  const beginThinking = (): void => {
    if (!interactive || spin) return;
    app.clearStatus();
    app.endLine();
    spin = spinner({ output: out, delay: 100 });
    spin.start('модель думает…');
  };

  const showStatus = (): void => {
    if (spin) {
      // Пока виден спиннер — обновляем его подпись, отдельная строка не нужна
      spin.message(`${pendingTool !== null ? `⏳ ${pendingTool} · ` : ''}${counters()}`);
      return;
    }
    const pending = pendingTool !== null ? `⏳ ${pendingTool} · ` : '';
    app.drawStatus(paint(YELLOW, pending, useColor) + counters());
  };

  // Тик раз в секунду: время фазы и pending-длительность обновляются live.
  // Обновляется ТОЛЬКО нижняя строка (никаких \x1b[2J).
  const timer = setInterval(showStatus, 1000);

  let cardSeq = 0;
  const handle: TuiHandle = {
    onToken(token: string): void {
      // Первый токен хода — спиннер уступает место стриму
      stopSpinner();
      app.appendStream(token);
    },
    onToolStart(name: string, _args: Record<string, unknown>): void {
      stopSpinner();
      app.endLine();
      started.set(name, Date.now());
      pendingTool = name;
      showStatus();
    },
    onToolEnd(name: string, _output: string, isError?: boolean): void {
      const startAt = started.get(name);
      started.delete(name);
      const durationMs = startAt !== undefined ? Date.now() - startAt : undefined;
      const view: ToolCallView = {
        name,
        status: isError === true ? 'error' : 'ok',
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
      cardSeq++;
      app.endLine();
      // Карточка — append по завершении вызова (не перерисовка кадра).
      // log.message сохраняет наши иконки ✅/❌ из formatToolCard.
      log.message(paint(isError === true ? '\x1b[31m' : '\x1b[32m', formatToolCard(view), useColor), {
        output: out,
      });
      if (pendingTool === name) pendingTool = null;
      showStatus();
    },
    onUsage(usage: LlmUsage, turn: number): void {
      store.update({ usage, turn });
      showStatus();
    },
    onError(text: string): void {
      stopSpinner();
      app.endLine();
      log.error(text, { output: out });
    },
    finishTurn(): void {
      stopSpinner();
      pendingTool = null;
      app.endLine();
      showStatus();
    },
    unmount(): void {
      clearInterval(timer);
      stopSpinner();
      app.clearStatus();
      app.endLine();
      // Итоговая строка счётчиков — один раз, в лог фазы (видна в logTail)
      log.message(counters(), { output: out });
      if (interactive) outro('выход', { output: out });
      if (useAltBuffer) out.write('\u001b[?1049l');
    },
  };
  // Первый кадр статуса — сразу при сборке
  showStatus();
  return {
    store,
    handle,
    setBusy(busy: boolean): void {
      store.update({ busy });
      if (busy) {
        // Ход начался: пока нет токенов, индикатор — спиннер clack
        beginThinking();
      } else {
        stopSpinner();
        showStatus();
      }
    },
  };
}

/**
 * Запускает TUI на stderr (альтернативный буфер) и возвращает колбэки loop.
 * Вызывается cli.ts только в интерактивном режиме; в headless не грузится
 * (динамический импорт) — TUI не участвует в контракте оркестратора.
 */
export function renderTui(): TuiHandle {
  // Ввод TUI не нужен: Ctrl+C обрабатывает cli (SIGINT → abort loop).
  return buildTui({ interactive: false }).handle;
}

/** Handle интерактивного TUI (VL-102): колбэки loop + управление строкой ввода. */
export interface InteractiveTuiHandle extends TuiHandle {
  /** Идёт ли ход чата: строка ввода блокируется, показывается спиннер. */
  setBusy(busy: boolean): void;
}

/**
 * Интерактивный TUI чата (VL-102/VL-321): шапка с sessionId, ввод на clack.
 *
 * Ввод — промпт `ChatInputPrompt` на `@clack/core` (tui-input.ts): clack
 * владеет readline и raw-mode целиком (lesson-195 — один владелец stdin),
 * редактирование строки, история по ↑/↓, Ctrl+C и Ctrl+D — отмена промпта.
 * Отмена = выход из чата через существующий onExit (interactive.ts закрывает
 * MCP и завершает процесс без стектрейса).
 *
 * Промпт открывается только когда ход не идёт (`busy === false`): во время
 * выполнения ввод не принимается, как и раньше (VL-102).
 */
export function renderInteractiveTui(options: {
  /** Отправить текст пользователя в чат (Enter). */
  onSubmit: (text: string) => void;
  /** Выйти из чата (Ctrl+C/Ctrl+D). */
  onExit: () => void;
  /** Идентификатор сессии — в шапке TUI. */
  sessionId: string;
}): InteractiveTuiHandle {
  const built = buildTui({
    header: `vibelog-agent · сессия ${options.sessionId}`,
    interactive: true,
  });
  const out = process.stderr;
  const stdin = process.stdin as unknown as import('./tui-input.js').InputLike;
  // Вне TTY (pipe/файл) raw mode недоступен — ввод не подключаем (как раньше)
  const useStdin = Boolean(stdin.isTTY);
  const useColor = Boolean(out.isTTY);

  /** Отправленные сообщения — история ↑/↓ (последнее в конце). */
  const history: string[] = [];
  /** Отмена промпта при unmount: открытый ввод резолвится отменой. */
  const inputAbort = new AbortController();
  let exited = false;
  /** Резолвер ожидания конца хода (ввод не открывается во время хода). */
  let busyResolve: (() => void) | null = null;
  let busy = false;

  const waitIdle = (): Promise<void> =>
    busy ? new Promise<void>((resolve) => (busyResolve = resolve)) : Promise.resolve();

  /** Реплика пользователя остаётся в транскрипте (VL-113) — append-выводом. */
  const echoUserMessage = (text: string): void => {
    if (!useColor) return;
    // Печатается до промпта: сам ввод в clack-промпте, поэтому реплику
    // дописываем блоком, чтобы она осталась в прокрутке.
    process.stderr.write(paint(CYAN, formatUserMessage(text), true) + '\n');
  };

  const inputLoop = async (): Promise<void> => {
    while (!exited) {
      if (!useStdin) return;
      const text = await createChatPrompt({
        input: stdin,
        output: out,
        message: 'сообщение',
        history,
        signal: inputAbort.signal,
      });
      if (text === null) {
        // Ctrl+C / Ctrl+D / Esc / unmount — выход из чата (onExit)
        if (!exited) {
          exited = true;
          options.onExit();
        }
        return;
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) continue;
      history.push(trimmed);
      if (history.length > 50) history.shift();
      echoUserMessage(trimmed);
      options.onSubmit(trimmed);
      await waitIdle();
    }
  };

  void inputLoop();

  return {
    ...built.handle,
    setBusy(next: boolean): void {
      busy = next;
      built.setBusy(next);
      if (!next && busyResolve) {
        const resolve = busyResolve;
        busyResolve = null;
        resolve();
      }
    },
    unmount(): void {
      exited = true;
      inputAbort.abort();
      built.handle.unmount();
    },
  };
}

/**
 * Подтверждение да/нет в стиле TUI агента (clack confirm).
 *
 * Экспортируется как готовая точка для tool-approval: у loop пока нет
 * потока подтверждений (инструменты выполняются без согласования), поэтому
 * сегодня обёртка используется тестами и будущими интерактивными ветками,
 * а не самим TUI — см. doc-10.
 */
export { createConfirmPrompt };
