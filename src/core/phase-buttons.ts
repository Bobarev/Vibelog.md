/**
 * Общий маппинг «статус → следующая фаза» для кнопок (VL-72/VL-78, VL-180).
 *
 * Источник истины для бота (rich-карточка, кнопка «next:») и веб-интерфейса
 * (кнопка модалки задачи). Вынесен из src/bot/rich.ts, чтобы устранить
 * дублирование: раньше web/src/lib/phase-buttons.ts держал копию логики
 * бота и мог разойтись с ней (AC2 VL-180).
 *
 * Модуль намеренно чистый TS: без node-импортов, enum и не-стираемого
 * синтаксиса — web-проект собирает его с verbatimModuleSyntax/erasableSyntaxOnly
 * (только функции, const и export type).
 */

/** Следующая фаза workflow для статуса задачи (VL-72). */
export type NextPhase = { phase: 'spec' | 'plan' | 'code' | 'close'; label: string };

/**
 * Маппинг статус → следующая фаза workflow (VL-72).
 *
 * Статусы по умолчанию из config.ts; Done/Blocked/неизвестные → null —
 * фаза не запускается, кнопка в карточке не показывается.
 */
export function nextPhaseForStatus(status: string): NextPhase | null {
  switch (status) {
    case 'To Do':
      return { phase: 'spec', label: 'Spec' };
    case 'Spec':
      return { phase: 'plan', label: 'Plan' };
    case 'Planned':
    case 'In Progress':
      return { phase: 'code', label: 'Code' };
    case 'Review':
      return { phase: 'close', label: 'Close' };
    default:
      return null;
  }
}

/**
 * Эмодзи фазы для label кнопки следующего этапа (VL-78).
 *
 * Карта — ТОЛЬКО для кнопки rich-рендера: nextPhaseForStatus() не меняется,
 * иначе сломаются тексты уведомлений («Фаза Plan запускается…») и тесты.
 */
export const PHASE_EMOJI: Record<NextPhase['phase'], string> = {
  spec: '▶',
  plan: '📋',
  code: '💻',
  close: '✅',
};
