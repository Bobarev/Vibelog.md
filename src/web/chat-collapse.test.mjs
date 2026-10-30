/**
 * Тесты VL-271 — механизм раскрытия панелей чата (ToolCall / ToolGroup).
 *
 * Баг: `collapsePanel` фиксировал высоту по `--radix-collapsible-content-height`
 * (Radix пишет туда высоту содержимого НА МОМЕНТ ОТКРЫТИЯ) плюс `overflow-hidden`.
 * Всё, что вырастало позже — перенос длинного Result по строкам, раскрытие
 * вложенного ToolCall внутри ToolGroup — срезалось: панель «разворачивалась в
 * невидимую область».
 *
 * Проверки статические (читают исходники как текст): регрессия здесь — это
 * возврат к фиксации высоты, а не поведение JS, поэтому текст исходника и есть
 * контракт. Поведение проверяется в браузере (AC1, AC2, AC7).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const chatDir = join(here, '../../web/src/components/chat');

const surfaces = readFileSync(join(chatDir, 'surfaces.tsx'), 'utf8');
const toolCall = readFileSync(join(chatDir, 'tool-call.tsx'), 'utf8');

describe('раскрытие панелей чата (VL-271)', () => {
  it('не фиксирует высоту по Radix-переменной', () => {
    // Извлекаем само значение collapsePanel: комментарии могут (и должны)
    // объяснять, почему переменная больше не используется.
    const panel = /export const collapsePanel\s*=\s*\n?\s*"([^"]+)"/.exec(surfaces)?.[1] ?? '';
    assert.ok(panel.length > 0, 'collapsePanel найден');
    assert.equal(
      panel.includes('radix-collapsible-content-height'),
      false,
      'классы панели не должны опираться на --radix-collapsible-content-height',
    );
    assert.equal(toolCall.includes('radix-collapsible-content-height'), false);
  });

  it('collapsePanel анимирует grid-template-rows 0fr ↔ 1fr', () => {
    assert.ok(surfaces.includes('collapse-panel'), 'панель использует класс .collapse-panel');
    // Классы живут в index.css — там и проверяем сам механизм
    const css = readFileSync(join(here, '../../web/src/index.css'), 'utf8');
    assert.ok(css.includes('.collapse-panel {'), 'класс панели объявлен');
    assert.ok(css.includes('grid-template-rows: 1fr'), 'открытое состояние — 1fr');
    assert.ok(css.includes('grid-template-rows: 0fr'), 'закрытое состояние — 0fr');
    assert.ok(css.includes('vl-collapse-down') && css.includes('vl-collapse-up'),
      'анимация в обе стороны через keyframes (transition по grid-rows на React-пути не стартует)');
    assert.ok(css.includes('prefers-reduced-motion'), 'motion-reduce уважается');
    assert.equal(/transition-\[height\]/.test(surfaces), false);
  });

  it('CollapseContent монтирует панель постоянно (forceMount) и держит a11y', () => {
    assert.ok(surfaces.includes('export function CollapseContent'), 'компонент экспортирован');
    assert.ok(surfaces.includes('forceMount'), 'forceMount: иначе закрытие теряет анимацию');
    assert.ok(surfaces.includes('collapse-panel-inner'), 'внутренняя обёртка grid-строки (min-height: 0)');
    assert.ok(surfaces.includes('inert'), 'скрытый контент не должен ловить Tab');
    assert.ok(surfaces.includes('aria-hidden'), 'скрытый контент не должен читаться скринридером');
    assert.ok(surfaces.includes('scrollIntoView'), 'AC8: раскрытая панель докручивается в viewport');
  });

  it('обе панели чата (ToolCall и ToolGroup) идут через CollapseContent', () => {
    // Панелей ровно две: раскрытие вызова и раскрытие группы.
    const opened = toolCall.match(/<CollapseContent/g) ?? [];
    assert.equal(opened.length, 2, 'ToolCall и ToolGroup используют CollapseContent');
    assert.equal(toolCall.includes('collapsePanel'), false, 'прямых использований collapsePanel не осталось');
    assert.equal(toolCall.includes('<CollapsibleContent'), false, 'голый CollapsibleContent обходит forceMount');
  });
});
