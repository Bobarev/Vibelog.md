/**
 * Расход контекста: типы, проценты, цвета и разбивка (VL-313).
 *
 * Порт `elements/utils/context-usage.ts` из assistant-ui Elements (ref-23,
 * registry `@assistant-ui/context-display`, стиль radix-nova). Файл лежит в
 * проекте исходником, потому что элемент ставится вручную: `pnpm dlx shadcn
 * add @assistant-ui/context-display` требует registry (прокси/VPN), а
 * `@assistant-ui/react@0.15.31` элемент не экспортирует.
 *
 * Отличия от оригинала (осознанные, документированы в doc-24):
 * - добавлен `costRow` в разбивку (оригинал знает только Input/Cached
 *   input/Output/Reasoning) — AC9 VL-313 требует строку стоимости в рублях;
 * - `getUsagePercent` возвращает `undefined`, когда размер окна неизвестен:
 *   модель без `context_window` не должна показывать «0%» (AC6).
 */

export type TokenUsage = {
  totalTokens?: number | undefined;
  inputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
};

/**
 * Процент занятого контекста 0..100; `undefined` — окно модели неизвестно.
 *
 * 0% при неизвестном окне читался бы как «контекст свободен», поэтому
 * вызывающий (панель) просто не рисует процент (AC6 VL-313).
 */
export const getUsagePercent = (
  totalTokens: number | undefined,
  modelContextWindow: number | undefined,
): number | undefined => {
  if (!modelContextWindow || modelContextWindow <= 0) return undefined;
  if (!totalTokens) return 0;
  return Math.min((totalTokens / modelContextWindow) * 100, 100);
};

type UsageSeverity = "normal" | "warning" | "critical";

const getUsageSeverity = (percent: number): UsageSeverity => {
  if (percent > 85) return "critical";
  if (percent >= 65) return "warning";
  return "normal";
};

export const getStrokeColor = (percent: number): string => {
  const severity = getUsageSeverity(percent);
  if (severity === "critical") return "stroke-red-500";
  if (severity === "warning") return "stroke-amber-500";
  return "stroke-foreground";
};

export const getBarColor = (percent: number): string => {
  const severity = getUsageSeverity(percent);
  if (severity === "critical") return "bg-red-500";
  if (severity === "warning") return "bg-amber-500";
  return "bg-foreground";
};

export const getPercentColor = (percent: number): string => {
  const severity = getUsageSeverity(percent);
  if (severity === "critical") return "text-red-500";
  if (severity === "warning") return "text-amber-500";
  return "text-muted-foreground";
};

type ContextSegment = {
  label: string;
  tokens: number;
};

// Провайдеры считают кэш и reasoning по-разному (OpenAI: cached_tokens — часть
// prompt_tokens; Anthropic: cache_read — отдельно). Поэтому сегменты
// показываются ровно теми числами, что пришли, и ни одному не даётся доля
// полосы: полоса — единственное чтение, которое всегда верно, «свой total
// провайдера против окна».
export const getContextSegments = (
  usage: TokenUsage | undefined,
): ContextSegment[] => {
  if (!usage) return [];
  return [
    { label: "Входящие", tokens: usage.inputTokens ?? 0 },
    { label: "Кэш", tokens: usage.cachedInputTokens ?? 0 },
    { label: "Исходящие", tokens: usage.outputTokens ?? 0 },
    { label: "Reasoning", tokens: usage.reasoningTokens ?? 0 },
  ].filter((segment) => segment.tokens > 0);
};
