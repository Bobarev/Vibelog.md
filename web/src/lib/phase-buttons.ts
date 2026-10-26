/**
 * Ре-экспорт представления фаз для кнопок модалки (VL-172, VL-188).
 *
 * VL-180: общий модуль src/core/phase-buttons.ts — раньше здесь была копия
 * логики бота, которая могла разойтись с источником. VL-188: маппинг
 * «статус → фаза» (nextPhaseForStatus) удалён — фазы приходят с сервера
 * (availablePhases из GET /api/tasks/:id, считаются по workflow на бэкенде,
 * т.к. core/workflow.ts читает fs и не импортируется в веб-бандл).
 *
 * Импорт вне web/ разрешён tsc (модуль чистый TS: функции + export type,
 * без node-импортов) и vite (server.fs.allow в vite.config.ts).
 */

export { PHASE_EMOJI, PHASE_LABEL, phaseButtonLabel } from '../../../src/core/phase-buttons';
