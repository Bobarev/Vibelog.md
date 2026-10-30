/**
 * Тесты карты проекта (VL-235).
 *
 * Фикстурный проект создаётся в mkdtemp (AGENTS.md: фиксированные пути
 * запрещены — параллельные прогоны в worktree затирают друг друга).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildProjectMap,
  PROJECT_MAP_MAX_BYTES,
  PROJECT_MAP_MODULE_LIMIT,
} from '../../dist/core/project-map.js';

const MODULE_A = `/**
 * Модуль A: первый агентский модуль.
 *
 * Подробности не попадают в карту — только первая строка.
 */
export function fa(): number {
  return 1;
}

export async function fb(): Promise<number> {
  return 2;
}
`;

const MODULE_B = `/**
 * Модуль B: ядро.
 */
export const KB = 1;
export interface ObjB { x: number }
export type TB = string;
export class CB {}

// Экспорт списком — осознанно не собирается (допущение модуля)
const hidden = 1;
export { hidden };
`;

const MODULE_C = `/**
 * Модуль C вложенного каталога.
 */
export function fc(): void {}
`;

let testRoot;

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-project-map-'));
  mkdirSync(join(testRoot, 'src', 'agent'), { recursive: true });
  mkdirSync(join(testRoot, 'src', 'core', 'deep'), { recursive: true });
  writeFileSync(join(testRoot, 'src', 'agent', 'a.ts'), MODULE_A, 'utf8');
  writeFileSync(join(testRoot, 'src', 'core', 'b.ts'), MODULE_B, 'utf8');
  writeFileSync(join(testRoot, 'src', 'core', 'deep', 'c.ts'), MODULE_C, 'utf8');
  // Шум: тесты и декларации в карту не попадают
  writeFileSync(join(testRoot, 'src', 'agent', 'a.test.mjs'), 'export const x = 1;\n', 'utf8');
  writeFileSync(join(testRoot, 'src', 'types.d.ts'), 'export type T = 1;\n', 'utf8');
  // Каталог-шум node_modules не разворачивается
  mkdirSync(join(testRoot, 'src', 'node_modules'), { recursive: true });
  writeFileSync(join(testRoot, 'src', 'node_modules', 'z.ts'), 'export const z = 1;\n', 'utf8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-235 — buildProjectMap', () => {
  it('карта: путь + назначение + экспорты, без тестов и .d.ts', () => {
    const res = buildProjectMap(testRoot);
    assert.equal(res.modules, 3, 'три .ts-модуля, шум исключён');
    assert.match(res.text, /src\/agent\//);
    assert.match(res.text, /src\/core\//);
    assert.match(res.text, /a\.ts — Модуль A: первый агентский модуль\./);
    assert.match(res.text, /b\.ts — Модуль B: ядро\./);
    assert.match(res.text, /\[fa, fb\]/, 'экспорты function собраны');
    assert.ok(res.text.includes('[KB, CB]'), 'const и class собраны, interface/type — нет');
    assert.ok(!res.text.includes('a.test.mjs'), 'test.mjs не попадает');
    assert.ok(!res.text.includes('types.d.ts'), '.d.ts не попадает');
    assert.ok(!res.text.includes('node_modules'), 'node_modules не разворачивается');
  });

  it('стабильный порядок: два вызова дают идентичный текст; каталоги отсортированы', () => {
    const first = buildProjectMap(testRoot).text;
    const second = buildProjectMap(testRoot).text;
    assert.equal(first, second, 'детерминизм');
    const agentIdx = first.indexOf('src/agent/');
    const coreIdx = first.indexOf('src/core/');
    assert.ok(agentIdx >= 0 && agentIdx < coreIdx, 'каталоги по алфавиту');
    // внутри каталога глубокий подкаталог идёт отдельной группой после файлов
    assert.ok(first.indexOf('src/core/deep/') > coreIdx);
  });

  it('усечение по limit: явный маркер', () => {
    const res = buildProjectMap(testRoot, { limit: 1 });
    assert.equal(res.shown, 1);
    assert.equal(res.modules, 3);
    assert.equal(res.truncated, true);
    assert.match(res.text, /карта усечена: показано 1 из 3 модулей/);
  });

  it('бюджет байтов: сжатие с маркером (AC4)', () => {
    const res = buildProjectMap(testRoot, { maxBytes: 120 });
    assert.ok(Buffer.byteLength(res.text, 'utf8') > 0);
    assert.ok(res.compacted > 0, 'сжатие включилось');
    assert.match(res.text, /карта сжата: уровень \d/);
  });

  it('по умолчанию бюджет не превышается на фикстуре', () => {
    const res = buildProjectMap(testRoot);
    assert.ok(Buffer.byteLength(res.text, 'utf8') <= PROJECT_MAP_MAX_BYTES);
    assert.equal(PROJECT_MAP_MODULE_LIMIT, 150);
  });

  it('query: узкая выборка с полными описаниями и экспортами', () => {
    const res = buildProjectMap(testRoot, { query: 'fa' });
    assert.equal(res.modules, 1);
    assert.match(res.text, /src\/agent\/a\.ts — Модуль A: первый агентский модуль\./);
    assert.match(res.text, /\[fa, fb\]/);
    const byDesc = buildProjectMap(testRoot, { query: 'ядро' });
    assert.match(byDesc.text, /b\.ts/);
    const none = buildProjectMap(testRoot, { query: 'нет-такого-модуля' });
    assert.equal(none.modules, 0);
    assert.match(none.text, /Совпадений не найдено/);
  });

  it('проект без src/ не падает', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vibelog-project-map-empty-'));
    try {
      const res = buildProjectMap(empty);
      assert.equal(res.modules, 0);
      assert.equal(res.shown, 0);
      assert.match(res.text, /не найден или не содержит/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('dir вне проекта отклоняется текстом (без throw)', () => {
    const res = buildProjectMap(testRoot, { dir: '../secret' });
    assert.equal(res.modules, 0);
    assert.match(res.text, /Недопустимый dir/);
  });

  it('dir "" — весь проект', () => {
    const res = buildProjectMap(testRoot, { dir: '' });
    assert.equal(res.modules, 3, 'модули src/ видны и от корня');
    assert.match(res.text, /^src\/agent\/$/m);
    assert.match(res.text, /^ {2}a\.ts — Модуль A/m);
  });

  it('exports: false — без списков экспортов', () => {
    const res = buildProjectMap(testRoot, { exports: false });
    assert.ok(!res.text.includes('[fa, fb]'));
    assert.match(res.text, /a\.ts — Модуль A/);
  });
});
