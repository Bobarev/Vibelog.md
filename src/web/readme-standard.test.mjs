/**
 * Инвариант «README — витрина, не справочник» (VL-285).
 *
 * README уже один раз раздувался до 1057 строк: VL-193 привёл его к Standard
 * Readme (78 строк), но ни шаблоны фаз, ни AGENTS.md не запрещали дописывать
 * в него технические разделы, и следующие задачи снова превратили витрину в
 * справочник. Этот тест закрепляет границу механически, чтобы раздувание
 * ломалось на `pnpm test`, а не обнаруживалось через сотни коммитов.
 *
 * Проверяются два свойства — оба про Структуру, а не про текст:
 *  1) длина README не больше README_MAX_LINES;
 *  2) все H2 принадлежат белому списку README_H2_WHITELIST (и каждый пункт
 *     списка в README присутствует — иначе витрина теряет обязательный блок).
 *
 * Белый список меняется осознанно: правка списка = правка витрины. Добавление
 * технического раздела требует не расширения списка, а переноса деталей в
 * `backlog/docs/doc-*` (правило дублировано в AGENTS.md и шаблонах фаз).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Лимит строк README (Standard Readme, ref-16: витрина, а не справочник). */
const README_MAX_LINES = 150;

/**
 * Разрешённые H2 в порядке следования. Порядок проверяется тоже: витрина
 * читается сверху вниз, и «Лицензия» в середине — уже не Standard Readme.
 */
const README_H2_WHITELIST = [
  'Зачем',
  'Prerequisites',
  'Installation',
  'Usage',
  'Документация',
  'Contributing',
  'Совместимость с Backlog.md',
  'Лицензия',
];

const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));

/** Строки README без завершающего пустого «хвоста» — как их видит `wc -l`. */
function readmeLines() {
  return readFileSync(readmePath, 'utf-8').replace(/\n$/, '').split('\n');
}

/** Заголовки H2 в порядке появления (внутри ```-блоков не считаются). */
function h2Headings(lines) {
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.startsWith('## ')) headings.push(line.slice(3).trim());
  }
  return headings;
}

describe('README соответствует Standard Readme (VL-285)', () => {
  it(`длина README не больше ${README_MAX_LINES} строк`, () => {
    const count = readmeLines().length;
    assert.ok(
      count <= README_MAX_LINES,
      `README раздулся: ${count} строк (лимит ${README_MAX_LINES}). ` +
        'Технические детали переноси в backlog/docs/doc-* (doc-6 — пользовательское, ' +
        'doc-7 — CLI, doc-8 — MCP, doc-10 — агент, doc-19 — супервизор), ' +
        'а в README оставь только ссылку в таблице «Документация».',
    );
  });

  it('H2 только из белого списка и в зафиксированном порядке', () => {
    assert.deepEqual(h2Headings(readmeLines()), README_H2_WHITELIST);
  });

  it('документ начинается с H1 (badges идут сразу под ним)', () => {
    const lines = readmeLines();
    // H1 может быть markdown-заголовком или HTML-тегом: витрина использует
    // центрированный `<h1 align="center">` (лого-блок над ним — тоже HTML).
    // Проверяем наличие H1 в шапке, а не конкретный синтаксис.
    const head = lines.slice(0, 12).join('\n');
    assert.ok(
      /^# /m.test(head) || /<h1[\s>]/i.test(head),
      'README должен начинаться с H1',
    );
  });
});
