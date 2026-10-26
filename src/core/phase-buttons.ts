/**
 * Эмодзи и подписи фаз для кнопок (VL-72/VL-78, VL-180, VL-188).
 *
 * Источник истины для переходов — core/workflow.ts (VL-188): маппинг
 * «статус → следующая фаза» nextPhaseForStatus удалён — бот и веб считают
 * фазы через getAvailablePhases/getNextPhase по workflow проекта. Здесь
 * остаётся только представление (эмодзи/подпись) для рендера кнопок.
 *
 * Модуль намеренно чистый TS: без node-импортов и не-стираемого
 * синтаксиса — web-проект собирает его с verbatimModuleSyntax/
 * erasableSyntaxOnly (только функции, const и export type).
 */

/** Подписи фаз для кнопок (label в rich-рендере и модалке веба). */
export const PHASE_LABEL: Record<string, string> = {
  spec: 'Spec',
  plan: 'Plan',
  code: 'Code',
  do: 'Do',
  close: 'Close',
  reject: 'Reject',
};

/**
 * Эмодзи фазы для label кнопки (VL-78; do/reject — VL-188).
 *
 * Карта расширена 'do'/'reject': бот-кнопки рендерятся по getAvailablePhases
 * (workflow может ветвить: To Do → spec ИЛИ reject).
 */
export const PHASE_EMOJI: Record<string, string> = {
  spec: '▶',
  plan: '📋',
  code: '💻',
  do: '⚡',
  close: '✅',
  reject: '✖',
};

/**
 * Переопределения стилей кнопок фаз из настроек (VL-195).
 *
 * Значения приходят из .vibelog/settings.json (core/phase-styles.ts):
 * бот передаёт их в renderTaskRich через opts, веб — из полей задачи
 * phaseLabels/phaseEmojis (серверный enrich GET /api/tasks/:id).
 */
export interface PhaseButtonStyles {
  /** Подписи фаз (settings.phase_labels). */
  labels?: Record<string, string>;
  /** Эмодзи фаз (settings.phase_emojis). */
  emojis?: Record<string, string>;
}

/**
 * Label кнопки фазы: «эмодзи Подпись»; неизвестная фаза — просто имя.
 *
 * @param phase — имя фазы из workflow (spec/plan/code/do/close/reject/…)
 * @param styles — стили из настроек (VL-195): settings > хардкод > имя фазы
 */
export function phaseButtonLabel(phase: string, styles?: PhaseButtonStyles): string {
  const emoji = styles?.emojis?.[phase] ?? PHASE_EMOJI[phase];
  const label = styles?.labels?.[phase] ?? PHASE_LABEL[phase] ?? phase;
  return emoji ? `${emoji} ${label}` : label;
}
