/**
 * Маппинг «статус → следующая фаза» для кнопок модалки (VL-172).
 *
 * КОПИЯ логики бота `src/bot/rich.ts` (nextPhaseForStatus + PHASE_EMOJI):
 * web — отдельное приложение со своим tsconfig и не импортирует src/ (там
 * node-код). Источник истины — rich.ts: при изменении маппинга в боте
 * синхронизировать и этот файл. Тексты/эмодзи должны совпадать с кнопками
 * карточки бота, чтобы веб-аналог был полным (AC2 VL-172).
 */

/** Следующая фаза workflow по статусу — label кнопки + эмодзи из PHASE_EMOJI бота. */
export interface NextPhaseButton {
  /** Имя фазы для POST /api/tasks/:id/trigger. */
  phase: 'spec' | 'plan' | 'code' | 'close';
  /** Подпись кнопки (без эмодзи). */
  label: string;
}

/**
 * Статус → кнопка следующего этапа. Done/Blocked/неизвестные → null:
 * кнопка фазы не показывается (как в rich.ts).
 */
export function nextPhaseForStatus(status: string): NextPhaseButton | null {
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

/** Эмодзи фазы для label кнопки — копия PHASE_EMOJI из src/bot/rich.ts. */
export const PHASE_EMOJI: Record<NextPhaseButton['phase'], string> = {
  spec: '▶',
  plan: '📋',
  code: '💻',
  close: '✅',
};
