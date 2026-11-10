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

import { REPEAT_LIMITS, callSignature, toolRepeatTarget } from '../agent/repeat-tracker.js';
import { loadSettings } from '../core/settings.js';
import { serializeAck } from '../mcp/tool-result.js';
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
 * VL-357: ключ вызова и список служебных аргументов живут в ОДНОМ месте —
 * `src/agent/repeat-tracker.ts` (`callSignature`, `NON_SEMANTIC_ARGS`).
 * Раньше здесь была вторая реализация `stableSerialize`/`stripNonSemanticArgs`:
 * правка в одной копии (VL-326 вырезал `idempotencyKey`) не доезжала до
 * другой, и детекторы расходились в поведении. Реэкспорт сохраняет публичный
 * API модуля (тесты и чат импортируют `callSignature`/\`NON_SEMANTIC_ARGS` отсюда).
 */
export { NON_SEMANTIC_ARGS, callSignature } from '../agent/repeat-tracker.js';

/** Вердикт guard'а для конкретного вызова. */
export type ToolCallVerdict =
  /** Исполнять — вызов первый в этом ходе либо ресурс изменён write'ом. */
  | 'execute'
  /** Дословный дубль уже исполненного вызова — не исполнять. */
  | 'duplicate'
  /** Лимит вызовов текущего ответа исчерпан — не исполнять. */
  | 'limit'
  /**
   * VL-326/VL-413: серия вызовов, вернувших `unchanged` (неизменяющая
   * запись), исчерпала кап — не исполнять.
   *
   * Отдельный вердикт, а не `duplicate`: сигнатура может быть НОВОЙ (модель
   * меняет служебные аргументы или порядок полей), но ответ снова будет
   * «изменений нет» — смысла исполнять вызов нет, модели нужен другой сигнал.
   */
  | 'unchanged_repeat';

/**
 * VL-326/VL-413: сколько подряд идущих вызовов с `unchanged` допускается до
 * блокировки.
 *
 * VL-357: значение берётся из единого `REPEAT_LIMITS.unchanged`
 * (`src/agent/repeat-tracker.ts`), а не объявляется здесь заново: раньше
 * веб-чат и агентский цикл держали по своей константе, и порог расходился
 * при правке одной из них. 3 — модели хватает двух-трёх «изменений нет»,
 * чтобы понять «поля уже такие»; на четвёртом ответ становится бесполезным
 * шумом, и ход надо разворачивать директивой, а не ждать лимита в 16 вызовов
 * на ответ (лимит сбрасывается `beginTurn()` на каждом ответе модели,
 * поэтому вечный цикл ничто не останавливало — инцидент VL-324).
 */
export const MAX_UNCHANGED_REPEATS_PER_TURN = REPEAT_LIMITS.unchanged;

/** Счётчики guard'а для диагностики (пишутся в `<threadId>.repeat.json`). */
export interface ToolGuardStats {
  /** Реально исполненные вызовы (включая write, инкрементившие epoch). */
  executed: number;
  /** Заблокированные дословные дубли. */
  deduped: number;
  /** Заблокированные по лимиту вызовы на ответ. */
  limit_hits: number;
  /** VL-326/VL-413: сколько исполненных вызовов вернули `unchanged`. */
  unchanged: number;
  /** VL-326/VL-413: сколько вызовов заблокировано исчерпанием серии. */
  unchanged_blocked: number;
}

/** Guard tool-вызовов одного хода веб-чата. */
export interface TurnToolGuard {
  /**
   * Начать новый ответ модели: сбросить счётчик вызовов ответа.
   * Карта исполненных сигнатур НЕ сбрасывается — дедупликация действует на
   * весь ход (все итерации одного POST), а лимит — на каждый ответ отдельно.
   */
  beginTurn(): void;
  /** Вердикт для вызова: исполнять / дубль / лимит / исчерпана серия unchanged. */
  check(name: string, args: Record<string, unknown> | undefined): ToolCallVerdict;
  /**
   * Зафиксировать РЕАЛЬНО исполненный вызов: write инкрементит epoch своего
   * ресурса (последующее чтение после записи не считается дублем).
   */
  noteExecuted(name: string, args: Record<string, unknown> | undefined): void;
  /**
   * VL-326/VL-413: зафиксировать ответ `unchanged` исполненного вызова.
   *
   * Считается СЕРИЯ подряд идущих вызовов с `unchanged` (по сигнатуре, как в
   * `src/agent/loop.ts`): любой реально исполненный вызов, изменивший
   * состояние, серию сбрасывает (`noteExecuted`). Возвращает true, если серия
   * исчерпала `MAX_UNCHANGED_REPEATS_PER_TURN` — вызывающий отдаёт модели
   * `unchanged_repeat`.
   */
  noteUnchanged(name: string, args: Record<string, unknown> | undefined): boolean;
  /** Текущие счётчики (копия — менять снаружи бесполезно). */
  stats(): ToolGuardStats;
  /** Лимит вызовов на ответ, с которым создан guard (для текста ошибки). */
  maxPerResponse(): number;
  /** VL-326/VL-413: кап серии unchanged, с которым создан guard. */
  maxUnchangedRepeats(): number;
}

/** Опции guard'а. */
export interface TurnToolGuardOptions {
  /** Лимит вызовов на один ответ модели (дефолт CHAT_MAX_TOOL_CALLS_DEFAULT). */
  maxPerResponse?: number;
  /** VL-326/VL-413: кап подряд идущих вызовов с unchanged. */
  maxUnchangedRepeats?: number;
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
  // VL-326/VL-413: кап серии unchanged — терпимая валидация как у лимита
  // вызовов (мусор/0/дробное → дефолт): битая настройка не должна отключать
  // защиту.
  const rawUnchangedMax = options.maxUnchangedRepeats ?? MAX_UNCHANGED_REPEATS_PER_TURN;
  const maxUnchangedRepeats =
    Number.isFinite(rawUnchangedMax) && rawUnchangedMax >= 1
      ? Math.floor(rawUnchangedMax)
      : MAX_UNCHANGED_REPEATS_PER_TURN;

  /** Исполненные сигнатуры → epoch ресурса на момент исполнения. */
  const executed = new Map<string, number>();
  /** Текущий epoch каждого ресурса (инкрементится write-вызовами). */
  const epochs = new Map<string, number>();
  /** Число вызовов в текущем ответе модели. */
  let responseCalls = 0;
  /** VL-326/VL-413: длина текущей серии подряд идущих вызовов с unchanged. */
  let unchangedRepeatCount = 0;
  /** VL-326/VL-413: имена инструментов, вернувших unchanged. */
  const unchangedTools = new Set<string>();
  /** VL-326/VL-413: серия исчерпана — повторы известных вызовов блокируются. */
  let unchangedExhausted = false;
  const counters: ToolGuardStats = {
    executed: 0,
    deduped: 0,
    limit_hits: 0,
    unchanged: 0,
    unchanged_blocked: 0,
  };

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
      // VL-326/VL-413: серия исчерпана — вызовы ТОГО ЖЕ инструмента не
      // исполняем: он уже отвечал «изменений нет», и смена аргументов на
      // другой набор уже применённых полей прогресса не даст (инцидент
      // VL-324: модель меняла только idempotencyKey/набор полей).
      // Проверяется ДО дедупа, чтобы модель получила unchanged_repeat с
      // требованием сменить аргументы, а не безликий duplicate. Выход из
      // серии — ДРУГОЙ инструмент (read_file/backlog_view_task/отчёт): он
      // исполняется и сбрасывает серию в noteExecuted.
      if (unchangedExhausted && unchangedTools.has(name)) {
        counters.unchanged_blocked++;
        return 'unchanged_repeat';
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
      // VL-357: вид операции читается из декларации; для mixed нужны аргументы.
      if (resource !== null && isWriteOperation(name, args)) {
        epochs.set(resource, epochOf(resource) + 1);
      }
      executed.set(callSignature(name, actual), epochOf(resource));
      counters.executed++;
      // VL-326/VL-413: реально исполненный вызов, изменивший состояние,
      // сбрасывает серию — модель продолжила работу, кап к ней больше не
      // относится.
      unchangedRepeatCount = 0;
      unchangedExhausted = false;
      unchangedTools.clear();
    },
    noteUnchanged(name: string, args: Record<string, unknown> | undefined): boolean {
      counters.unchanged++;
      const actual = (args ?? {}) as Record<string, unknown>;
      // Сигнатуру тоже фиксируем: вызов ИСПОЛНЕН (инструмент отработал), просто
      // без изменений. Поэтому дословный повтор получает `duplicate`, а не
      // исполняется заново — иначе модель тратила бы бюджет ответа на те же
      // «изменений нет» (AC7: второй и последующие вызовы не исполняются).
      executed.set(callSignature(name, actual), epochOf(toolRepeatTarget(name, actual)));
      // Инструмент запоминается как «неизменяющий»: после исчерпания серии
      // именно его вызовы блокируются вердиктом unchanged_repeat.
      unchangedTools.add(name);
      // Вызов с unchanged — тоже исполнение (инструмент отработал, файл не
      // изменён): в диагностике он учитывается и как executed, и как unchanged.
      counters.executed++;
      // VL-326/VL-413: серия считается по ФАКТУ ответа с unchanged, а не по
      // сигнатуре. Дедуп отсекает дословные повторы первым слоем; второй слой
      // нужен для обхода дедупа (модель меняет служебные аргументы, порядок
      // полей или передаёт другой набор уже применённых полей) — любой такой
      // ответ означает «прогресса нет», и после капа ход надо разворачивать.
      unchangedRepeatCount++;
      if (unchangedRepeatCount > maxUnchangedRepeats) {
        unchangedExhausted = true;
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
    maxUnchangedRepeats(): number {
      return maxUnchangedRepeats;
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

/**
 * JSON-ответ модели на дословный дубль вызова (контракт VL-262: ok:false).
 *
 * VL-359: ответ идёт через `serializeAck` (протокол v2) — модель в веб-чате
 * видит ОДИН формат ответа, а не два. `outcome: 'rejected'` даёт `ok:false`,
 * флаг `duplicate` едет в `extra` (машиночитаемо для модели и тестов).
 */
export function duplicateCallResult(): string {
  return serializeAck({
    outcome: 'rejected',
    reason: 'duplicate',
    message: 'Идентичный вызов уже выполнен в этом ходе — используй полученный ранее результат.',
    extra: { duplicate: true },
  });
}

/**
 * JSON-ответ модели при исчерпании лимита вызовов на один ответ.
 *
 * VL-359: через `serializeAck` (протокол v2), флаг `limit` — в `extra`.
 */
export function limitCallResult(maxPerResponse: number): string {
  return serializeAck({
    outcome: 'rejected',
    reason: 'limit',
    message: `Лимит tool-вызовов на один ответ исчерпан (${maxPerResponse}) — заверши ход и продолжи следующим.`,
    extra: { limit: true },
  });
}

/**
 * JSON-ответ модели при исчерпании серии вызовов с `unchanged` (VL-326/VL-413).
 *
 * Инцидент VL-324: модель 12 раз подряд вызвала `backlog_update_task`,
 * передавая только уже применённые поля (`priority`, `type`). Инструмент
 * честно отвечал «изменений нет», но ответ слабыми моделями не взвешивался —
 * а лимит вызовов на ответ (16) сбрасывался `beginTurn()` на каждом новом
 * ответе, поэтому ничто не останавливало круг. Теперь на 4-м дословном
 * повторе модели уходит этот ответ: он называет причину («поля уже такие») и
 * требует ИЗМЕНИТЬ аргументы, а не повторять вызов.
 *
 * VL-413: исход — `rejected` (это guard-отказ, а не запись), флаг
 * `unchanged_repeat` — в `extra`.
 */
export function unchangedRepeatCallResult(maxUnchangedRepeats: number): string {
  return serializeAck({
    outcome: 'rejected',
    reason: 'unchanged_repeat',
    message:
      `Подряд ${maxUnchangedRepeats} вызова вернули «Изменений нет» — передаваемые значения уже такие, повтор с теми же аргументами бесполезен. ` +
      'Передай недостающие поля в этом же вызове (например, description/acceptanceCriteria/plan) или переходи к отчёту.',
    extra: { unchanged_repeat: true },
  });
}
