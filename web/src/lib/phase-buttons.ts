/**
 * Маппинг «статус → следующая фаза» для кнопок модалки (VL-172).
 *
 * VL-180: ре-экспорт общего модуля src/core/phase-buttons.ts — раньше здесь
 * была копия логики бота (rich.ts), которая могла разойтись с источником.
 * Теперь бот и веб используют один и тот же код; импорт вне web/ разрешён
 * tsc (модуль чистый TS: функции + export type, без node-импортов) и vite
 * (server.fs.allow в vite.config.ts — для dev-сервера).
 *
 * Имена сохранены: task-modal.tsx импортирует nextPhaseForStatus/PHASE_EMOJI,
 * NextPhaseButton — прежнее имя типа (NextPhase из core).
 */

export { nextPhaseForStatus, PHASE_EMOJI } from '../../../src/core/phase-buttons';
export type { NextPhase as NextPhaseButton } from '../../../src/core/phase-buttons';
