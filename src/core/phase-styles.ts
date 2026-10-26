/**
 * Стили кнопок фаз — подписи и эмодзи из .vibelog/settings.json (VL-195).
 *
 * Кастомные workflow (investigation и др.) вводят СВОИ фазы, поэтому их
 * подписи/эмодзи не могут жить в хардкоде core/phase-buttons.ts (там — только
 * fallback для фаз default-воркфлоу). Источник настроек:
 *
 *   "phase_labels": { "investigate": "Расследование", "materialize": "Создать задачи" },
 *   "phase_emojis": { "investigate": "🔍", "materialize": "📦" }
 *
 * Приоритет: settings > дефолтный хардкод (PHASE_LABEL/PHASE_EMOJI) > сырое
 * имя фазы (fallback внутри phaseButtonLabel). Нестрогая валидация — паттерн
 * loadWorkflows (core/workflow.ts): битые записи выпадают, не роняют бота/веб.
 *
 * Модуль fs-ный (импортирует settings.js) — НЕ импортируется web-бандлом:
 * веб получает готовые поля phaseLabels/phaseEmojis из enrich GET /api/tasks/:id,
 * бот грузит здесь и передаёт в renderTaskRich через opts.
 */

import { loadSettings } from './settings.js';
import { PHASE_EMOJI, PHASE_LABEL } from './phase-buttons.js';

/** Подписи и эмодзи фаз: имя фазы → значение (после merge settings поверх дефолтов). */
export interface PhaseStyles {
  /** Подпись кнопки фазы: settings.phase_labels поверх PHASE_LABEL. */
  labels: Record<string, string>;
  /** Эмодзи кнопки фазы: settings.phase_emojis поверх PHASE_EMOJI. */
  emojis: Record<string, string>;
}

/**
 * Отбирает валидные строковые записи из сырого значения настроек:
 * не-объект/массив/null → {}; значение не-строка или пустая строка → ключ пропускается.
 */
function pickStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [phase, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v !== '') out[phase] = v;
  }
  return out;
}

/**
 * Стили фаз проекта: дефолтные карты phase-buttons + переопределения из
 * settings.json (phase_labels/phase_emojis).
 *
 * @param cwd — директория проекта (там же .vibelog/settings.json)
 */
export function loadPhaseStyles(cwd: string): PhaseStyles {
  const settings = loadSettings(cwd);
  return {
    labels: { ...PHASE_LABEL, ...pickStringMap(settings.phase_labels) },
    emojis: { ...PHASE_EMOJI, ...pickStringMap(settings.phase_emojis) },
  };
}
