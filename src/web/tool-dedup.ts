/**
 * Дедупликация и лимит tool-вызовов в веб-чате (VL-255).
 *
 * Инцидент VL-254: один ответ модели содержал ~50 tool-вызовов вместо 6 —
 * блок `read_file` / `backlog_view_task` / `backlog_search` дословно
 * повторялся ≈8 раз (те же name+args), часть вызовов била в несуществующие
 * пути. Агент-петля (`src/agent/loop.ts` + `repeat-tracker`, VL-229) такие
 * повторы отслеживает, а веб-чат — нет. Модуль закрывает разрыв минимальной
 * защитой:
 * 1. **Точный дубль не исполняется.** Ключ вызова — `name` + стабильная
 *    сериализация arguments (ключи объектов отсортированы рекурсивно).
 *    Такой ключ ловит именно «дословный» повтор — в отличие от грубого
 *    `repeatKey` из `repeat-tracker.ts`, который схлопывает все чтения
 *    одного файла в один ключ (независимо от offset/limit) и годится для
 *    предупреждений/метрики, но не для блокировки исполнения.
 * 2. **Лимит вызовов на один ответ модели.** Считается на ответ (`resp.
 *    toolCalls`), а не на весь POST: внутри одного запроса до 8 итераций
 *    LLM, и лимит «на запрос» ломал бы легитимное пакетное чтение.
 * 3. **Легитимный повтор после write разрешён.** Для каждого ресурса
 *    (`toolRepeatTarget`: файл для read/write/edit, pattern для поиска)
 *    хранится epoch. Write-вызов инкрементит epoch своего ресурса, поэтому
 *    чтение того же файла после записи проходит как новый вызов, а
 *    дословный повтор самой записи — блокируется.
 *
 * Модуль намеренно чистый (без fs и без MCP): тестируется в изоляции и
 * используется чатом внутри `executeTool` — единственной точки исполнения
 * инструментов, поэтому защита работает и в обычном цикле ответа, и в
 * resume-пути после approval, и в advanceToNextApproval.
 */

import { toolRepeatTarget } from '../agent/repeat-tracker.js';
import { loadSettings } from '../core/settings.js';
import { isWriteOperation } from './tool-policy.js';
import { isInteractiveTool } from '../core/tool-classify.js';

/**
 * Дефолтный лимит tool-вызовов на один ответ модели.
 *
 * 16 — компромисс: инцидент VL-254 дал ~50 вызовов в одном ответе, а
 * легитимное пакетное чтение редко превышает 8–12. Ключ конфига —
 * `chat_max_tool_calls` в `.vibelog/settings.json` (см.
 * `resolveChatMaxToolCalls` в `tool-policy.ts`).
 */
export const CHAT_MAX_TOOL_CALLS_DEFAULT = 16;

/** Максимально допустимое значение конфига (защита от «лимит = 100000»). */
export const CHAT_MAX_TOOL_CALLS_CEILING = 200;

/**
 * Стабильная сериализация значения для ключа вызова.
 *
 * Ключи объектов сортируются рекурсивно — `{a:1,b:2}` и `{b:2,a:1}` дают
 * одинаковую подпись (порядок ключей в JSON модели не стабилен).
 * `undefined`/функции/символы отбрасываются как отсутствующие — иначе
 * `{path:'x'}` и `{path:'x',limit:undefined}` считались бы разными вызовами.
 * BigInt сериализуется строкой: JSON.stringify на нём бросает исключение.
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`);
  if (typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    // undefined/функция/символ → undefined (ключ будет отброшен вызывающим)
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => stableSerialize(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(',')}}`;
}

/**
 * Служебные аргументы вызова, НЕ входящие в сигнатуру дедупликации (VL-326).
 *
 * `idempotencyKey` — маркер повтора, а не семантика вызова: он описывает «это
 * тот же самый вызов, что и раньше», а не «что именно делает вызов». Пока
 * ключ входил в сигнатуру, новый ключ на каждый повтор делал сигнатуры
 * разными, и guard возвращал `execute` вместо `duplicate` — дедупликация
 * обходилась сменой служебного поля (инцидент VL-324: модель 12 раз подряд
 * вызвала `backlog_update_task` с уже применёнными полями, каждый раз с новым
 * ключом).
 *
 * Список вынесен в одну константу: новое служебное поле добавляется здесь и
 * НЕ требует правок в `callSignature`/guard'е.
 */
export const NON_SEMANTIC_ARGS: readonly string[] = ['idempotencyKey'];

/**
 * Копия аргументов без служебных полей (входной объект модели не мутируется).
 *
 * Возвращает исходную ссылку, если служебных ключей нет — лишний объект на
 * каждый вызов не нужен. `undefined` пробрасывается как есть: `callSignature`
 * трактует его как пустой объект.
 */
function stripNonSemanticArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (args === undefined) return undefined;
  let hasNonSemantic = false;
  for (const key of NON_SEMANTIC_ARGS) {
    if (key in args) {
      hasNonSemantic = true;
      break;
    }
  }
  if (!hasNonSemantic) return args;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (NON_SEMANTIC_ARGS.includes(key)) continue;
    copy[key] = value;
  }
  return copy;
}

/**
 * Ключ вызова: имя инструмента + стабильная сериализация аргументов.
 *
 * VL-326: служебные аргументы (`NON_SEMANTIC_ARGS`, напр. `idempotencyKey`)
 * вырезаются ДО сериализации — два вызова с одинаковыми содержательными
 * аргументами и разными ключами идемпотентности дают одинаковую сигнатуру.
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 * @param args — аргументы вызова; undefined трактуется как пустой объект
 */
export function callSignature(name: string, args: Record<string, unknown> | undefined): string {
  return `${name}|${stableSerialize(stripNonSemanticArgs(args) ?? {})}`;
}

/** Вердикт guard'а для конкретного вызова. */
export type ToolCallVerdict =
  /** Исполнять — вызов первый в этом ходе либо ресурс изменён write'ом. */
  | 'execute'
  /** Дословный дубль уже исполненного вызова — не исполнять. */
  | 'duplicate'
  /** Лимит вызовов текущего ответа исчерпан — не исполнять. */
  | 'limit'
  /**
   * VL-326: серия вызовов, вернувших noop, исчерпала кап — не исполнять.
   *
   * Отдельный вердикт, а не `duplicate`: сигнатура может быть НОВОЙ (модель
   * меняет служебные аргументы или порядок полей), но ответ снова будет
   * «изменений нет» — смысла исполнять вызов нет, модели нужен другой сигнал.
   */
  | 'noop_repeat';

/**
 * VL-326: сколько подряд идущих noop-вызовов допускается до блокировки.
 *
 * По образцу `MAX_NOOP_REPEATS_PER_RUN` (`src/agent/loop.ts`): 3 — модели
 * хватает двух-трёх «изменений нет», чтобы понять «поля уже такие»; на
 * четвёртом ответ становится бесполезным шумом, и ход надо разворачивать
 * директивой, а не ждать лимита в 16 вызовов на ответ (лимит сбрасывается
 * `beginTurn()` на каждом ответе модели, поэтому вечный цикл ничто не
 * останавливало — инцидент VL-324).
 */
export const MAX_NOOP_REPEATS_PER_TURN = 3;

/** Счётчики guard'а для диагностики (пишутся в `<threadId>.repeat.json`). */
export interface ToolGuardStats {
  /** Реально исполненные вызовы (включая write, инкрементившие epoch). */
  executed: number;
  /** Заблокированные дословные дубли. */
  deduped: number;
  /** Заблокированные по лимиту вызовы на ответ. */
  limit_hits: number;
  /** VL-326: сколько исполненных вызовов вернули noop-ответ. */
  noop: number;
  /** VL-326: сколько вызовов заблокировано исчерпанием noop-серии. */
  noop_blocked: number;
}

/** Guard tool-вызовов одного хода веб-чата. */
export interface TurnToolGuard {
  /**
   * Начать новый ответ модели: сбросить счётчик вызовов ответа.
   * Карта исполненных сигнатур НЕ сбрасывается — дедупликация действует на
   * весь ход (все итерации одного POST), а лимит — на каждый ответ отдельно.
   */
  beginTurn(): void;
  /** Вердикт для вызова: исполнять / дубль / лимит / исчерпана noop-серия. */
  check(name: string, args: Record<string, unknown> | undefined): ToolCallVerdict;
  /**
   * Зафиксировать РЕАЛЬНО исполненный вызов: write инкрементит epoch своего
   * ресурса (последующее чтение после записи не считается дублем).
   */
  noteExecuted(name: string, args: Record<string, unknown> | undefined): void;
  /**
   * VL-326: зафиксировать noop-ответ исполненного вызова.
   *
   * Считается СЕРИЯ подряд идущих noop-вызовов (по сигнатуре, как в
   * `src/agent/loop.ts`): любой реально исполненный вызов, вернувший не-noop,
   * серию сбрасывает (`noteExecuted`). Возвращает true, если серия исчерпала
   * `MAX_NOOP_REPEATS_PER_TURN` — вызывающий отдаёт модели `noop_repeat`.
   */
  noteNoop(name: string, args: Record<string, unknown> | undefined): boolean;
  /** Текущие счётчики (копия — менять снаружи бесполезно). */
  stats(): ToolGuardStats;
  /** Лимит вызовов на ответ, с которым создан guard (для текста ошибки). */
  maxPerResponse(): number;
  /** VL-326: кап noop-серии, с которым создан guard (для текста ошибки). */
  maxNoopRepeats(): number;
}

/** Опции guard'а. */
export interface TurnToolGuardOptions {
  /** Лимит вызовов на один ответ модели (дефолт CHAT_MAX_TOOL_CALLS_DEFAULT). */
  maxPerResponse?: number;
  /** VL-326: кап подряд идущих noop-вызовов (дефолт MAX_NOOP_REPEATS_PER_TURN). */
  maxNoopRepeats?: number;
}

/**
 * Создаёт guard tool-вызовов для одного хода веб-чата.
 *
 * Стейт живёт в памяти `produce()` и умирает вместе с POST: межзапросный
 * дедуп потребовал бы персистентного состояния в jsonl треда (осознанно не
 * делаем — инцидент VL-254 был внутри одного ответа).
 */
export function createTurnToolGuard(options: TurnToolGuardOptions = {}): TurnToolGuard {
  const rawMax = options.maxPerResponse ?? CHAT_MAX_TOOL_CALLS_DEFAULT;
  const maxPerResponse =
    Number.isFinite(rawMax) && rawMax >= 1
      ? Math.min(Math.floor(rawMax), CHAT_MAX_TOOL_CALLS_CEILING)
      : CHAT_MAX_TOOL_CALLS_DEFAULT;
  // VL-326: кап noop-серии — терпимая валидация как у лимита вызовов
  // (мусор/0/дробное → дефолт): битая настройка не должна отключать защиту.
  const rawNoopMax = options.maxNoopRepeats ?? MAX_NOOP_REPEATS_PER_TURN;
  const maxNoopRepeats =
    Number.isFinite(rawNoopMax) && rawNoopMax >= 1
      ? Math.floor(rawNoopMax)
      : MAX_NOOP_REPEATS_PER_TURN;

  /** Исполненные сигнатуры → epoch ресурса на момент исполнения. */
  const executed = new Map<string, number>();
  /** Текущий epoch каждого ресурса (инкрементится write-вызовами). */
  const epochs = new Map<string, number>();
  /** Число вызовов в текущем ответе модели. */
  let responseCalls = 0;
  /** VL-326: длина текущей серии подряд идущих noop-вызовов. */
  let noopRepeatCount = 0;
  /** VL-326: имена инструментов, чей исполненный вызов вернул noop-ответ. */
  const noopTools = new Set<string>();
  /** VL-326: серия исчерпана — повторы известных noop-вызовов блокируются. */
  let noopExhausted = false;
  const counters: ToolGuardStats = { executed: 0, deduped: 0, limit_hits: 0, noop: 0, noop_blocked: 0 };

  const epochOf = (resource: string | null): number =>
    resource === null ? 0 : epochs.get(resource) ?? 0;

  return {
    beginTurn(): void {
      responseCalls = 0;
    },
    check(name: string, args: Record<string, unknown> | undefined): ToolCallVerdict {
      if (responseCalls >= maxPerResponse) {
        counters.limit_hits++;
        return 'limit';
      }
      // Валидный вызов тратит бюджет ответа даже если окажется дублем:
      // иначе повтор одной и той же пары не упирался бы в лимит никогда.
      responseCalls++;
      const signature = callSignature(name, args);
      // VL-330: вопрос нельзя схлопнуть как дословный повтор — два одинаковых
      // ask_user подряд обязаны дать две карточки (второй вопрос часто тот же
      // по тексту: «Продолжить?», «Ещё раз?»). Лимит ответа при этом действует.
      if (isInteractiveTool(name)) return 'execute';
      // VL-326: серия исчерпана — вызовы ТОГО ЖЕ инструмента не исполняем:
      // он уже отвечал «изменений нет», и смена аргументов на другой набор
      // уже применённых полей прогресса не даст (инцидент VL-324: модель
      // меняла только idempotencyKey/набор полей). Проверяется ДО дедупа,
      // чтобы модель получила noop_repeat с требованием сменить аргументы,
      // а не безликий duplicate. Выход из серии — ДРУГОЙ инструмент
      // (read_file/backlog_view_task/отчёт): он исполняется и сбрасывает
      // серию в noteExecuted.
      if (noopExhausted && noopTools.has(name)) {
        counters.noop_blocked++;
        return 'noop_repeat';
      }
      const recorded = executed.get(signature);
      if (recorded === undefined) return 'execute';
      const resource = toolRepeatTarget(name, (args ?? {}) as Record<string, unknown>);
      if (recorded !== epochOf(resource)) return 'execute'; // ресурс изменён write'ом
      counters.deduped++;
      return 'duplicate';
    },
    noteExecuted(name: string, args: Record<string, unknown> | undefined): void {
      const actual = (args ?? {}) as Record<string, unknown>;
      const resource = toolRepeatTarget(name, actual);
      // Write сначала поднимает epoch ресурса, потом фиксируется сигнатура:
      // повторное чтение после записи получит новый epoch и пройдёт как
      // новый вызов, а дословный повтор самой записи — нет.
      if (resource !== null && isWriteOperation(name)) {
        epochs.set(resource, epochOf(resource) + 1);
      }
      executed.set(callSignature(name, actual), epochOf(resource));
      counters.executed++;
      // VL-326: реально исполненный вызов, вернувший НЕ noop, сбрасывает
      // серию — модель продолжила работу, кап к ней больше не относится.
      noopRepeatCount = 0;
      noopExhausted = false;
      noopTools.clear();
    },
    noteNoop(name: string, args: Record<string, unknown> | undefined): boolean {
      counters.noop++;
      const actual = (args ?? {}) as Record<string, unknown>;
      // Сигнатуру тоже фиксируем: вызов ИСПОЛНЕН (инструмент отработал), просто
      // без изменений. Поэтому дословный повтор получает `duplicate`, а не
      // исполняется заново — иначе модель тратила бы бюджет ответа на те же
      // «изменений нет» (AC7: второй и последующие вызовы не исполняются).
      executed.set(callSignature(name, actual), epochOf(toolRepeatTarget(name, actual)));
      // Инструмент запоминается как noop-способный: после исчерпания серии
      // именно его вызовы блокируются вердиктом noop_repeat.
      noopTools.add(name);
      // noop-вызов — тоже исполнение (инструмент отработал, файл не изменён):
      // в диагностике он учитывается и как executed, и как noop.
      counters.executed++;
      // VL-326: серия считается по ФАКТУ noop-ответа, а не по сигнатуре.
      // Дедуп отсекает дословные повторы первым слоем; второй слой нужен для
      // обхода дедупа (модель меняет служебные аргументы, порядок полей или
      // передаёт другой набор уже применённых полей) — любой noop-ответ
      // означает «прогресса нет», и после капа ход надо разворачивать.
      noopRepeatCount++;
      if (noopRepeatCount > maxNoopRepeats) {
        noopExhausted = true;
        return true;
      }
      return false;
    },
    stats(): ToolGuardStats {
      return { ...counters };
    },
    maxPerResponse(): number {
      return maxPerResponse;
    },
    maxNoopRepeats(): number {
      return maxNoopRepeats;
    },
  };
}

/**
 * Лимит tool-вызовов на один ответ модели из конфига проекта.
 *
 * Ключ `.vibelog/settings.json` → `chat_max_tool_calls`. Валидация терпимая
 * (lesson-117): принимается только целое число 1..CHAT_MAX_TOOL_CALLS_CEILING;
 * отсутствие ключа, строка, дробное, 0, отрицательное, `null` и битый
 * settings.json (`loadSettings` возвращает `{}`) → CHAT_MAX_TOOL_CALLS_DEFAULT.
 * Битая настройка не должна отключать защиту и не должна ронять чат.
 */
export function resolveChatMaxToolCalls(cwd: string): number {
  const raw = loadSettings(cwd).chat_max_tool_calls;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return CHAT_MAX_TOOL_CALLS_DEFAULT;
  if (raw < 1 || raw > CHAT_MAX_TOOL_CALLS_CEILING) return CHAT_MAX_TOOL_CALLS_DEFAULT;
  return raw;
}

/** JSON-ответ модели на дословный дубль вызова (контракт VL-262: ok:false). */
export function duplicateCallResult(): string {
  return JSON.stringify({
    ok: false,
    duplicate: true,
    message: 'Идентичный вызов уже выполнен в этом ходе — используй полученный ранее результат.',
  });
}

/** JSON-ответ модели при исчерпании лимита вызовов на один ответ. */
export function limitCallResult(maxPerResponse: number): string {
  return JSON.stringify({
    ok: false,
    limit: true,
    message: `Лимит tool-вызовов на один ответ исчерпан (${maxPerResponse}) — заверши ход и продолжи следующим.`,
  });
}

/**
 * JSON-ответ модели при исчерпании noop-серии (VL-326).
 *
 * Инцидент VL-324: модель 12 раз подряд вызвала `backlog_update_task`,
 * передавая только уже применённые поля (`priority`, `type`). Инструмент
 * честно отвечал `noop`, но ответ слабыми моделями не взвешивался — а лимит
 * вызовов на ответ (16) сбрасывался `beginTurn()` на каждом новом ответе,
 * поэтому ничто не останавливало круг. Теперь на 4-м дословном noop-повторе
 * модели уходит этот ответ: он называет причину («поля уже такие») и требует
 * ИЗМЕНИТЬ аргументы, а не повторять вызов.
 */
export function noopRepeatCallResult(maxNoopRepeats: number): string {
  return JSON.stringify({
    ok: false,
    noop_repeat: true,
    message:
      `Подряд ${maxNoopRepeats} вызова вернули «Изменений нет» — передаваемые значения уже такие, повтор с теми же аргументами бесполезен. ` +
      'Передай недостающие поля в этом же вызове (например, description/acceptanceCriteria/plan) или переходи к отчёту.',
  });
}
