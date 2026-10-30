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
 * Ключ вызова: имя инструмента + стабильная сериализация аргументов.
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 * @param args — аргументы вызова; undefined трактуется как пустой объект
 */
export function callSignature(name: string, args: Record<string, unknown> | undefined): string {
  return `${name}|${stableSerialize(args ?? {})}`;
}

/** Вердикт guard'а для конкретного вызова. */
export type ToolCallVerdict =
  /** Исполнять — вызов первый в этом ходе либо ресурс изменён write'ом. */
  | 'execute'
  /** Дословный дубль уже исполненного вызова — не исполнять. */
  | 'duplicate'
  /** Лимит вызовов текущего ответа исчерпан — не исполнять. */
  | 'limit';

/** Счётчики guard'а для диагностики (пишутся в `<threadId>.repeat.json`). */
export interface ToolGuardStats {
  /** Реально исполненные вызовы (включая write, инкрементившие epoch). */
  executed: number;
  /** Заблокированные дословные дубли. */
  deduped: number;
  /** Заблокированные по лимиту вызовы на ответ. */
  limit_hits: number;
}

/** Guard tool-вызовов одного хода веб-чата. */
export interface TurnToolGuard {
  /**
   * Начать новый ответ модели: сбросить счётчик вызовов ответа.
   * Карта исполненных сигнатур НЕ сбрасывается — дедупликация действует на
   * весь ход (все итерации одного POST), а лимит — на каждый ответ отдельно.
   */
  beginTurn(): void;
  /** Вердикт для вызова: исполнять / дубль / лимит. */
  check(name: string, args: Record<string, unknown> | undefined): ToolCallVerdict;
  /**
   * Зафиксировать РЕАЛЬНО исполненный вызов: write инкрементит epoch своего
   * ресурса (последующее чтение после записи не считается дублем).
   */
  noteExecuted(name: string, args: Record<string, unknown> | undefined): void;
  /** Текущие счётчики (копия — менять снаружи бесполезно). */
  stats(): ToolGuardStats;
  /** Лимит вызовов на ответ, с которым создан guard (для текста ошибки). */
  maxPerResponse(): number;
}

/** Опции guard'а. */
export interface TurnToolGuardOptions {
  /** Лимит вызовов на один ответ модели (дефолт CHAT_MAX_TOOL_CALLS_DEFAULT). */
  maxPerResponse?: number;
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

  /** Исполненные сигнатуры → epoch ресурса на момент исполнения. */
  const executed = new Map<string, number>();
  /** Текущий epoch каждого ресурса (инкрементится write-вызовами). */
  const epochs = new Map<string, number>();
  /** Число вызовов в текущем ответе модели. */
  let responseCalls = 0;
  const counters: ToolGuardStats = { executed: 0, deduped: 0, limit_hits: 0 };

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
    },
    stats(): ToolGuardStats {
      return { ...counters };
    },
    maxPerResponse(): number {
      return maxPerResponse;
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
