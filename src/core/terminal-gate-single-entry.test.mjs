/**
 * Инвариант «один публичный вход в правило терминальности» (VL-378).
 *
 * История. VL-368 вынес правило VL-309 («нельзя ставить терминальный статус
 * при неотмеченных AC/DoD») в общую функцию `terminalStatusGate`, VL-370
 * добавил над ней `terminalStatusGateForTask`, который САМ считает неполноту из
 * `CompletenessMap` (workflow → фаза → сущность → поля), — но низкоуровневый
 * экспорт остался. Это лазейка: вызывающий может передать готовые номера
 * AC/DoD, обойти расчёт неполноты (правило `default.spec → description` и любое
 * кастомное из `.vibelog/settings.json`) и не учесть workflow задачи («в simple
 * AC/DoD нет вовсе — блокировать нечего»). Ровно так до VL-370 разъезжались
 * `writeAutoReportIfMissing` и `finalizePhaseStatus` — дефект VL-368.
 *
 * Поэтому низкоуровневая функция переименована в `terminalStatusGateCore` и
 * объявлена БЕЗ `export`. Тест держит это механически: нарушение ловится
 * сборкой тестов, а не дисциплиной ревью.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Корень проекта: тесты запускаются из него (vitest root). */
const ROOT = process.cwd();
/** Модуль, где живёт правило: единственное место, которому можно звать Core. */
const WORKFLOW_MODULE = join('src', 'core', 'workflow.ts');

/**
 * Рекурсивный список файлов исходников (`src/**`, `.ts` и `.mjs`).
 *
 * `node_modules`/`dist` внутри `src/` не встречаются, но исключение оставлено
 * на будущее; обход на `readdirSync` — без внешних зависимостей.
 */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/**
 * Убирает комментарии, чтобы инвариант не срабатывал на ДОКУМЕНТИРУЮЩИЕ
 * упоминания старого имени (JSDoc прямо объясняет, что `terminalStatusGate`
 * больше не экспортируется). Проверяется код, а не текст комментариев.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(join(ROOT, 'src'));

describe('VL-378 — единственный публичный вход в правило терминальности', () => {
  it('AC2: низкоуровневый гейт не вызывается нигде вне workflow.ts', () => {
    // Вхождение `terminalStatusGate(` без суффикса `ForTask` — прямой вызов
    // низкоуровневой версии (в комментариях он упоминаться может, поэтому
    // комментарии вырезаны).
    const offenders = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (rel === WORKFLOW_MODULE) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/(?<!For)\bterminalStatusGate\(/.test(code)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      `прямой вызов низкоуровневого гейта: ${offenders.join(', ')}. ` +
        'Верни правило в ядро: единственный вход — terminalStatusGateForTask (VL-378).',
    );
  });

  it('AC1: в workflow.ts нет экспорта низкоуровневого гейта', () => {
    const code = stripComments(readFileSync(join(ROOT, WORKFLOW_MODULE), 'utf8'));
    assert.equal(
      /\bexport\s+function\s+terminalStatusGate\s*\(/.test(code),
      false,
      'terminalStatusGate снова экспортирован: правило терминальности должно иметь один публичный вход — terminalStatusGateForTask (VL-378).',
    );
    assert.equal(
      /\bexport\s+function\s+terminalStatusGateCore\s*\(/.test(code),
      false,
      'terminalStatusGateCore экспортирован: он внутренний, снаружи зовут terminalStatusGateForTask (VL-378).',
    );
  });

  it('AC1: низкоуровневая функция объявлена приватно и используется обёрткой', () => {
    const code = stripComments(readFileSync(join(ROOT, WORKFLOW_MODULE), 'utf8'));
    assert.equal(
      /\nfunction\s+terminalStatusGateCore\s*\(/.test(code),
      true,
      'в workflow.ts нет приватного объявления terminalStatusGateCore — сборка текста причины исчезла (VL-378).',
    );
    assert.equal(
      /\bexport\s+function\s+terminalStatusGateForTask\s*\(/.test(code),
      true,
      'terminalStatusGateForTask должен остаться экспортированным: это единственный публичный вход правила (VL-378).',
    );
    assert.equal(
      /return\s+terminalStatusGateCore\s*\(/.test(code),
      true,
      'terminalStatusGateForTask обязан звать terminalStatusGateCore — иначе расчёт неполноты обходится (VL-378).',
    );
  });
});
