/**
 * Форматирование количества токенов (VL-313) — порт
 * `elements/utils/tokens.ts` из assistant-ui Elements (ref-23).
 *
 * Элемент `context-display` ставится в проект исходником (registry
 * `@assistant-ui/context-display`, стиль radix-nova), поэтому его утилиты
 * живут рядом, а не в npm-пакете: `@assistant-ui/react@0.15.31` этот элемент
 * не экспортирует.
 */

const UNITS = [
  { size: 1_000, suffix: "k" },
  { size: 1_000_000, suffix: "M" },
  { size: 1_000_000_000, suffix: "B" },
  { size: 1_000_000_000_000, suffix: "T" },
] as const;

const tenths = (value: number) => Math.round(value * 10) / 10;

/**
 * Токены в компактном виде: `950`, `48.2k`, `912.5M`.
 *
 * Одна десятая в первой единице, которая держит значение меньше тысячи, —
 * чтобы `999_950` читалось как `1M`, а не `1000k`.
 */
export function formatTokenCount(tokens: number): string {
  if (!(tokens >= 1_000)) return `${Math.round(tokens)}`;
  let label = "";
  for (const { size, suffix } of UNITS) {
    const value = tenths(tokens / size);
    label = `${value}${suffix}`;
    if (value < 1_000) break;
  }
  return label;
}
