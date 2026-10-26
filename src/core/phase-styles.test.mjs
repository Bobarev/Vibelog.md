/**
 * Тесты VL-195 — core/phase-styles.ts: подписи/эмодзи кнопок фаз из настроек.
 *
 * Фикстуры — settings.json во временных каталогах: дефолтный fallback без
 * settings, переопределения phase_labels/phase_emojis поверх хардкода,
 * битые значения/битый JSON → без падения; резолюция label через
 * phaseButtonLabel со стилями (settings > хардкод > имя фазы).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPhaseStyles } from '../../dist/core/phase-styles.js';
import { settingsPath } from '../../dist/core/settings.js';
import { phaseButtonLabel } from '../../dist/core/phase-buttons.js';

describe('phase-styles (VL-195)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-phase-styles-'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Каталог проекта с заданным содержимым settings.json. */
  function project(name, settings) {
    const dir = join(root, name);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');
    return dir;
  }

  it('нет settings.json → дефолтные карты phase-buttons (fallback default-фаз)', () => {
    const styles = loadPhaseStyles(join(root, 'nonexistent'));
    assert.equal(styles.labels.spec, 'Spec');
    assert.equal(styles.emojis.close, '✅');
    assert.equal(styles.labels.investigate, undefined, 'хардкода новых фаз нет');
  });

  it('settings поверх дефолтов: кастомные фазы и переопределение default', () => {
    const dir = project('overrides', {
      phase_labels: { investigate: 'Расследование', materialize: 'Создать задачи', spec: 'Уточнение' },
      phase_emojis: { investigate: '🔍', materialize: '📦' },
    });
    const styles = loadPhaseStyles(dir);
    assert.equal(styles.labels.investigate, 'Расследование');
    assert.equal(styles.labels.materialize, 'Создать задачи');
    assert.equal(styles.labels.spec, 'Уточнение', 'settings приоритетнее хардкода');
    assert.equal(styles.emojis.close, '✅', 'незатронутые дефолты сохраняются');
    assert.equal(styles.emojis.investigate, '🔍');
  });

  it('битые значения отбрасываются (не-строка/пустая строка/массив)', () => {
    const dir = project('broken-values', {
      phase_labels: { investigate: 42, materialize: '', spec: ['x'], plan: 'План' },
      phase_emojis: null,
    });
    const styles = loadPhaseStyles(dir);
    assert.equal(styles.labels.investigate, undefined);
    assert.equal(styles.labels.materialize, undefined);
    // битая запись НЕ перекрывает дефолт: spec остаётся 'Spec' из phase-buttons
    assert.equal(styles.labels.spec, 'Spec');
    assert.equal(styles.labels.plan, 'План', 'валидное значение проходит');
    assert.equal(styles.emojis.code, '💻', 'phase_emojis не-объект → дефолтная карта');
  });

  it('битый JSON settings → дефолты без падения', () => {
    const dir = join(root, 'broken-json');
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(settingsPath(dir), '{не json', 'utf-8');
    const styles = loadPhaseStyles(dir);
    assert.equal(styles.labels.spec, 'Spec');
  });

  it('phaseButtonLabel со styles: settings > хардкод > имя фазы', () => {
    const dir = project('labels', {
      phase_labels: { investigate: 'Расследование', close: 'Закрыть' },
      phase_emojis: { investigate: '🔍' },
    });
    const styles = loadPhaseStyles(dir);
    // settings для кастомной фазы
    assert.equal(phaseButtonLabel('investigate', styles), '🔍 Расследование');
    // переопределение label default-фазы, эмодзи — дефолтный
    assert.equal(phaseButtonLabel('close', styles), '✅ Закрыть');
    // без styles — прежнее поведение (регрессия не меняется)
    assert.equal(phaseButtonLabel('close'), '✅ Close');
    // неизвестная фаза без styles — имя; со styles — имя (нет записи)
    assert.equal(phaseButtonLabel('nope', styles), 'nope');
  });
});
