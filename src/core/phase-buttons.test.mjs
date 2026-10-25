/**
 * Тесты VL-180 — общий модуль «статус → следующая фаза» (phase-buttons).
 *
 * AC2: дублирование устранено — бот (rich.js) и веб (web/src/lib/phase-buttons.ts)
 * ре-экспортируют ОДИН источник src/core/phase-buttons.ts. Тест держит паритет
 * трёх точек доступа: core ↔ ре-экспорт rich.js ↔ ре-экспорт web (vitest
 * транспилирует TS-исходник web напрямую).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { nextPhaseForStatus, PHASE_EMOJI } from '../../dist/core/phase-buttons.js';
import { nextPhaseForStatus as richNextPhaseForStatus, PHASE_EMOJI as richPhaseEmoji } from '../../dist/bot/rich.js';
import {
  nextPhaseForStatus as webNextPhaseForStatus,
  PHASE_EMOJI as webPhaseEmoji,
} from '../../web/src/lib/phase-buttons';

/** Все статусы конфига по умолчанию + пограничные/мусорные значения. */
const STATUSES = ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked', 'QA', ''];

describe('core/phase-buttons — общий маппинг бота и веба (VL-180)', () => {
  it('ре-экспорт dist/bot/rich.js идентичен core для всех статусов', () => {
    for (const status of STATUSES) {
      assert.deepEqual(
        richNextPhaseForStatus(status),
        nextPhaseForStatus(status),
        `расхождение для статуса «${status}»`
      );
    }
    assert.deepEqual(richPhaseEmoji, PHASE_EMOJI, 'PHASE_EMOJI rich.js === core');
    // Ре-экспорт — те же биндинги, а не копии
    assert.equal(richNextPhaseForStatus, nextPhaseForStatus, 'rich.js ре-экспортирует ту же функцию');
    assert.equal(richPhaseEmoji, PHASE_EMOJI, 'rich.js ре-экспортирует ту же карту');
  });

  it('web-реэкспорт (web/src/lib/phase-buttons) идентичен core для всех статусов', () => {
    for (const status of STATUSES) {
      assert.deepEqual(
        webNextPhaseForStatus(status),
        nextPhaseForStatus(status),
        `расхождение web ↔ core для статуса «${status}»`
      );
    }
    assert.deepEqual(webPhaseEmoji, PHASE_EMOJI, 'web PHASE_EMOJI === core');
  });

  it('сам маппинг: фазы по статусам и null для Done/Blocked/мусора', () => {
    assert.deepEqual(nextPhaseForStatus('To Do'), { phase: 'spec', label: 'Spec' });
    assert.deepEqual(nextPhaseForStatus('Spec'), { phase: 'plan', label: 'Plan' });
    assert.deepEqual(nextPhaseForStatus('Planned'), { phase: 'code', label: 'Code' });
    assert.deepEqual(nextPhaseForStatus('In Progress'), { phase: 'code', label: 'Code' });
    assert.deepEqual(nextPhaseForStatus('Review'), { phase: 'close', label: 'Close' });
    assert.equal(nextPhaseForStatus('Done'), null);
    assert.equal(nextPhaseForStatus('Blocked'), null);
    assert.equal(nextPhaseForStatus('мусор'), null);
    assert.deepEqual(PHASE_EMOJI, { spec: '▶', plan: '📋', code: '💻', close: '✅' });
  });
});
