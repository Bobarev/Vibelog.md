/**
 * Локальная декларация типа для turndown-plugin-gfm (VL-194).
 *
 * Пакет не поставляет types, @types/turndown-plugin-gfm на npm отсутствует
 * (проверено: 404) — объявляем экспорт вручную, чтобы strict-TS компилировал
 * `import { gfm } from 'turndown-plugin-gfm'`.
 *
 * Плагин — чистый JS (CJS main), типы ниже покрывают ровно то, что используем:
 * пре-сборку gfm (tables/strikethrough/taskList) и отдельные плагины.
 */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  /** GFM-набор: таблицы, зачёркивание, задачи-чеклисты. */
  export const gfm: (service: TurndownService) => void;
  /** Только GFM-таблицы. */
  export const tables: (service: TurndownService) => void;
  /** Только зачёркивание (~~text~~). */
  export const strikethrough: (service: TurndownService) => void;
  /** Только задачи-чеклисты (- [ ]). */
  export const taskListItems: (service: TurndownService) => void;
}
