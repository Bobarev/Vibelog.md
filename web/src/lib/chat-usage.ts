/**
 * Типы и форматирование расхода треда для панели (VL-313).
 *
 * Зеркало `ThreadUsageView` из `src/web/chat-usage.ts` (сервер считает суммы,
 * рубли и процент и отдаёт готовый view — клиент ничего не пересчитывает,
 * чтобы цифры в панели и в ответе API не расходились).
 *
 * Живёт в `lib/`, а не в компонентах: используется и рантаймом чата, и
 * панелью, и восстановлением треда (ChatPage).
 */

/** Разбивка стоимости по типам токенов (рубли). */
export interface UsageCost {
  input: number;
  output: number;
  cache: number;
  total: number;
}

/** Расход токенов треда — вид для панели (см. src/web/chat-usage.ts). */
export interface ThreadUsageView {
  /** Модель последнего запроса треда (null — неизвестна, env-fallback). */
  modelId: string | null;
  input: number;
  output: number;
  cache: number;
  reasoning: number;
  requests: number;
  /** Пик занятого контекста по запросам треда — основа процента (AC3). */
  peakContext: number;
  /** Стоимость: по тарифу модели, которой шли ходы (AC4). */
  cost: UsageCost;
  /** Окно модели треда; undefined — неизвестно (процент не показываем, AC6). */
  contextWindow?: number;
  /** Процент занятого контекста; undefined — окно неизвестно. */
  percent?: number;
}

/**
 * Рубли: до копеек при малых суммах, до десятых при крупных — компактно в
 * панели (`0.42 ₽`, `12.5 ₽`, `1 240 ₽`). Локаль не используется:
 * неразрывный пробел ru-RU ломает вёрстку мелкого чипа.
 */
export function formatRubles(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0 ₽";
  const rounded = amount >= 100 ? Math.round(amount) : Math.round(amount * 100) / 100;
  const text =
    rounded >= 1000
      ? `${Math.round(rounded)}`.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
      : `${rounded}`;
  return `${text} ₽`;
}
