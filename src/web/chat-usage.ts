/**
 * Учёт расхода токенов треда веб-чата (VL-313).
 *
 * `LlmUsage` возвращается из `streamChat`, но до появления этого модуля
 * никуда не сохранялся: клиент не видел ни токенов, ни стоимости, ни того,
 * насколько близок тред к лимиту контекстного окна. Здесь — чистый учёт по
 * треду (без React, без LLM): агрегаты, персист в sidecar-файл рядом с
 * историей и «view» для панели (токены + рубли + процент контекста).
 *
 * Ключевые решения (из решения по VL-313, doc-24):
 *
 * 1. **Процент контекста — ПИК, а не сумма.** usage каждого запроса УЖЕ
 *    содержит весь промпт (system + история + tool-результаты), поэтому сумма
 *    input по ходам на 2–3-м ходу превысила бы окно и ринг упёрся бы в 100%.
 *    Знаменатель — размер контекстного окна модели треда (`context_window`
 *    из models.available, VL-313); окна нет — процента тоже нет (0% читался
 *    бы как «контекст свободен»).
 * 2. **Кэш — ПОДмножество input у OpenAI-совместимых провайдеров.** В
 *    Responses API `input_tokens_details.cached_tokens` (и
 *    `prompt_tokens_details.cached_tokens` у Cloud.ru) входят в input, у
 *    Anthropic-стиля — нет. Безопасное приближение: `cache <= input` →
 *    считаем кэш частью input; иначе (кэш больше «чистого» input) —
 *    складываем (см. `contextTokens`).
 * 3. **Деньги — по тарифу модели, которой шёл ход.** Агрегаты хранятся по
 *    моделям (`byModel`), поэтому смена модели в пикере не пересчитывает
 *    прошлые ходы по чужому тарифу (AC4): каждая модель считается через
 *    `pricingForModelId(cwd, id)`.
 * 4. **Reasoning — отдельной строкой** и НЕ вычитается из output (AC5,
 *    решение VL-198: провайдеры ведут себя по-разному, вычитание врёт).
 *
 * Хранение: `<cwd>/.vibelog/chat-sessions/<threadId>.usage.json` (каталог
 * `.vibelog/` gitignored). Имя содержит точку, поэтому `listChatThreads`
 * (фильтр `.jsonl`) файл не видит — фантомных тредов не появляется
 * (lesson-151). Образец — `recordChatToolStats` (VL-255): сбой диагностики
 * не должен рвать диалог, поэтому все операции молча глотают ошибки fs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { calculateCost, pricingForModelId, type CostBreakdown, type ModelPricing } from '../core/analytics.js';
import { resolveModelById } from '../core/models.js';

/** threadId попадает в имя файла — защита от path-traversal (как в chat.ts). */
const THREAD_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Каталог сессий чата. Дублируем строку, а не импортируем `chatSessionsDir`
 * из `chat.ts`: тот будет импортировать ЭТОТ модуль, и циклическая
 * зависимость ESM (пусть и рабочая) мешала бы изолированным unit-тестам.
 * Значение закреплено тестом (`chat-usage.test.mjs`).
 */
function chatSessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'chat-sessions');
}

/** Суммы по одной модели треда. */
export interface ModelUsageTotals {
  input: number;
  output: number;
  cache: number;
  /** Reasoning-токены: отдельное поле, из output НЕ вычитаются (VL-198). */
  reasoning: number;
  /** Число запросов к модели в треде. */
  requests: number;
}

/** Учёт расхода треда (персист в `<threadId>.usage.json`). */
export interface ThreadUsage {
  /** Модель ПОСЛЕДНЕГО запроса треда: её окно — знаменатель процента. */
  modelId?: string;
  /**
   * Пик «занятого контекста» по запросам треда, токены: максимум
   * (input + кэш по правилу `contextTokens`) — не сумма по ходам.
   */
  peakContext: number;
  /** Агрегаты по моделям: смена модели в пикере не искажает старые ходы. */
  byModel: Record<string, ModelUsageTotals>;
  /** Момент последнего обновления (ISO). */
  updatedAt: string;
}

/** Один запрос модели — вход для накопления. */
export interface UsageEntry {
  /** id модели из models.available; undefined — модель неизвестна. */
  modelId?: string;
  input: number;
  output: number;
  cache: number;
  reasoning?: number;
  /**
   * Считать ли запрос в счётчике `requests` (VL-314, AC12): вызов саммари
   * `/compact` — обычный расход (токены и ₽ входят в панель), но НЕ запрос
   * хода, поэтому счётчик хода он не увеличивает. Дефолт — считать.
   */
  countRequest?: boolean;
}

/** Итоговый вид для панели (то, что уходит клиенту в SSE и GET истории). */
export interface ThreadUsageView {
  /** Модель последнего запроса (null — неизвестна). */
  modelId: string | null;
  /** Кумулятивные суммы по треду (все модели). */
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  requests: number;
  /** Пик занятого контекста по запросам треда (основа процента). */
  peakContext: number;
  /** Стоимость в рублях: сумма по моделям по их тарифам. */
  cost: CostBreakdown;
  /** Контекстное окно модели треда; undefined — неизвестно (нет процента). */
  contextWindow?: number;
  /** Процент занятого контекста 0..100; undefined — окно неизвестно. */
  percent?: number;
}

/** Нулевые суммы. */
function zeroTotals(): ModelUsageTotals {
  return { input: 0, output: 0, cache: 0, reasoning: 0, requests: 0 };
}

/**
 * Занятый контекст ОДНОГО запроса по правилу «кэш — подмножество input».
 *
 * У OpenAI-совместимых провайдеров cached_tokens входит в prompt_tokens:
 * `input + cache` завысило бы процент (риск R1 плана VL-313). Признак
 * «кэш отдельно» — кэша больше, чем input (Anthropic-стиль с исключённым
 * кэшем даёт маленький input и большой cache_read).
 */
export function contextTokens(input: number, cache: number): number {
  const i = Math.max(0, input);
  const c = Math.max(0, cache);
  if (c === 0) return i;
  if (c <= i) return i; // кэш — подмножество input (OpenAI/Cloud.ru)
  return i + c; // кэш учтён отдельно (Anthropic-стиль)
}

/** Накопление одного запроса в агрегат треда (чистая функция). */
export function accumulateThreadUsage(usage: ThreadUsage | null, entry: UsageEntry): ThreadUsage {
  const base: ThreadUsage = usage ?? { peakContext: 0, byModel: {}, updatedAt: '' };
  const modelId = entry.modelId ?? base.modelId ?? 'unknown';
  const prev = base.byModel[modelId] ?? zeroTotals();
  const totals: ModelUsageTotals = {
    input: prev.input + Math.max(0, entry.input),
    output: prev.output + Math.max(0, entry.output),
    cache: prev.cache + Math.max(0, entry.cache),
    reasoning: prev.reasoning + Math.max(0, entry.reasoning ?? 0),
    requests: prev.requests + (entry.countRequest === false ? 0 : 1),
  };
  return {
    ...(entry.modelId ? { modelId: entry.modelId } : base.modelId ? { modelId: base.modelId } : {}),
    peakContext: Math.max(base.peakContext, contextTokens(entry.input, entry.cache)),
    byModel: { ...base.byModel, [modelId]: totals },
    updatedAt: new Date().toISOString(),
  };
}

/** Файл учёта треда (вызывается только с валидным threadId). */
function usageFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.usage.json`);
}

/** Чтение учёта треда; нет файла / битый JSON / чужой threadId → null. */
export function loadThreadUsage(cwd: string, threadId: string): ThreadUsage | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const file = usageFile(cwd, threadId);
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    const byModel: Record<string, ModelUsageTotals> = {};
    const rawByModel =
      typeof v.byModel === 'object' && v.byModel !== null && !Array.isArray(v.byModel)
        ? (v.byModel as Record<string, unknown>)
        : {};
    const num = (x: unknown): number =>
      typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
    for (const [id, val] of Object.entries(rawByModel)) {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
      const t = val as Record<string, unknown>;
      byModel[id] = {
        input: num(t.input),
        output: num(t.output),
        cache: num(t.cache),
        reasoning: num(t.reasoning),
        requests: num(t.requests),
      };
    }
    return {
      ...(typeof v.modelId === 'string' && v.modelId !== '' ? { modelId: v.modelId } : {}),
      peakContext: num(v.peakContext),
      byModel,
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
    };
  } catch {
    return null; // битый файл учёта — просто нет данных
  }
}

/** Запись учёта треда (тихая: сбой учёта не рвёт диалог). */
function saveThreadUsage(cwd: string, threadId: string, usage: ThreadUsage): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    mkdirSync(chatSessionsDir(cwd), { recursive: true });
    writeFileSync(usageFile(cwd, threadId), JSON.stringify(usage, null, 2) + '\n', 'utf8');
  } catch {
    // сбой записи учёта не должен рвать текущий ход
  }
}

/**
 * Учесть один запрос модели в треде: прочитать агрегат, накопить, записать.
 *
 * @returns обновлённый агрегат (null — невалидный threadId).
 */
export function recordThreadUsage(cwd: string, threadId: string, entry: UsageEntry): ThreadUsage | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const next = accumulateThreadUsage(loadThreadUsage(cwd, threadId), entry);
  saveThreadUsage(cwd, threadId, next);
  return next;
}

/** Контекстное окно модели треда (undefined — поля нет в settings.json). */
export function resolveContextWindow(cwd: string, modelId?: string | null): number | undefined {
  if (!modelId) return undefined;
  const active = resolveModelById(cwd, modelId);
  const window = active?.contextWindow;
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : undefined;
}

/**
 * Вид учёта для панели: суммы, рубли по тарифам моделей и процент контекста.
 *
 * @param usage — агрегат треда (null → null: пустой тред панель не показывает)
 */
export function describeThreadUsage(cwd: string, usage: ThreadUsage | null): ThreadUsageView | null {
  if (!usage) return null;
  const totals = zeroTotals();
  const cost: CostBreakdown = { input: 0, output: 0, cache: 0, total: 0 };
  for (const [modelId, m] of Object.entries(usage.byModel)) {
    totals.input += m.input;
    totals.output += m.output;
    totals.cache += m.cache;
    totals.reasoning += m.reasoning;
    totals.requests += m.requests;
    // Тариф — ТОЙ модели, что дала эти токены (AC4)
    const pricing: ModelPricing | undefined = pricingForModelId(cwd, modelId === 'unknown' ? null : modelId);
    const part = calculateCost({ input: m.input, output: m.output, cache: m.cache }, pricing);
    cost.input += part.input;
    cost.output += part.output;
    cost.cache += part.cache;
    cost.total += part.total;
  }
  cost.input = Math.round(cost.input * 1e6) / 1e6;
  cost.output = Math.round(cost.output * 1e6) / 1e6;
  cost.cache = Math.round(cost.cache * 1e6) / 1e6;
  cost.total = Math.round((cost.input + cost.output + cost.cache) * 1e6) / 1e6;

  const modelId = usage.modelId ?? null;
  const contextWindow = resolveContextWindow(cwd, modelId);
  const percent =
    contextWindow !== undefined && usage.peakContext > 0
      ? Math.min(100, Math.round((usage.peakContext / contextWindow) * 1000) / 10)
      : undefined;

  return {
    modelId,
    input: totals.input,
    output: totals.output,
    cache: totals.cache,
    reasoning: totals.reasoning,
    requests: totals.requests,
    peakContext: usage.peakContext,
    cost,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(percent !== undefined ? { percent } : {}),
  };
}

/** Вид учёта по threadId (null — учёта нет: пустой тред или старый jsonl). */
export function threadUsageView(cwd: string, threadId: string): ThreadUsageView | null {
  return describeThreadUsage(cwd, loadThreadUsage(cwd, threadId));
}
