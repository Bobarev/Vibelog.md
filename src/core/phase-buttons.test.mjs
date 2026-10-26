/**
 * Тесты VL-180/VL-188 — общий модуль представления фаз (phase-buttons).
 *
 * AC2 (VL-180): дублирование устранено — бот (rich.js) и веб
 * (web/src/lib/phase-buttons.ts) ре-экспортируют ОДИН источник
 * src/core/phase-buttons.ts. VL-188: маппинг «статус → фаза»
 * (nextPhaseForStatus) удалён — переходы считает core/workflow.ts;
 * здесь только эмодзи/подписи для кнопок.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { PHASE_EMOJI, PHASE_LABEL, phaseButtonLabel } from '../../dist/core/phase-buttons.js';
import { PHASE_EMOJI as richPhaseEmoji, phaseButtonLabel as richLabel } from '../../dist/bot/rich.js';
import {
  PHASE_EMOJI as webPhaseEmoji,
  phaseButtonLabel as webLabel,
} from '../../web/src/lib/phase-buttons';

describe('core/phase-buttons — представление фаз для кнопок (VL-180/188)', () => {
  it('ре-экспорт dist/bot/rich.js идентичен core', () => {
    assert.deepEqual(richPhaseEmoji, PHASE_EMOJI, 'PHASE_EMOJI rich.js === core');
    assert.equal(richLabel, phaseButtonLabel, 'rich.js ре-экспортирует ту же функцию');
    assert.equal(richPhaseEmoji, PHASE_EMOJI, 'rich.js ре-экспортирует ту же карту');
  });

  it('web-реэкспорт (web/src/lib/phase-buttons) идентичен core', () => {
    assert.deepEqual(webPhaseEmoji, PHASE_EMOJI, 'web PHASE_EMOJI === core');
    // Веб импортирует TS-исходник (vitest транспилирует отдельно от dist) —
    // ссылочная идентичность невозможна, сверяем поведение
    for (const phase of ['spec', 'plan', 'code', 'do', 'close', 'reject', 'custom']) {
      assert.equal(webLabel(phase), phaseButtonLabel(phase), `label «${phase}» web === core`);
    }
  });

  it('PHASE_EMOJI: все workflow-фазы покрыты (VL-188: +do/reject)', () => {
    assert.deepEqual(PHASE_EMOJI, { spec: '▶', plan: '📋', code: '💻', do: '⚡', close: '✅', reject: '✖' });
  });

  it('PHASE_LABEL и phaseButtonLabel: подпись «эмодзи Label», fallback — имя фазы', () => {
    assert.deepEqual(PHASE_LABEL, { spec: 'Spec', plan: 'Plan', code: 'Code', do: 'Do', close: 'Close', reject: 'Reject' });
    assert.equal(phaseButtonLabel('spec'), '▶ Spec');
    assert.equal(phaseButtonLabel('do'), '⚡ Do');
    assert.equal(phaseButtonLabel('reject'), '✖ Reject');
    assert.equal(phaseButtonLabel('custom'), 'custom');
    assert.equal(phaseButtonLabel(''), '');
  });
});
