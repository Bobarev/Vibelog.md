/**
 * Тесты VL-258 — дедупликация неизменного блока задачи в промпте resume-рана
 * (src/agent/prompt-dedup.ts). Модуль чистый: фикстуры — строки промптов,
 * никаких файлов.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  DEDUP_MARKER,
  TASK_BLOCK_HEADING,
  dedupeResumePrompt,
  findTaskBlock,
  hashBlock,
} from '../../dist/agent/prompt-dedup.js';

/** Промпт фазы в форме templates/phases/*.md (блок задачи + «## Шаги»). */
function phasePrompt(description, plan = '(нет)') {
  return [
    'Ты — автоматический исполнитель Vibelog (Фаза 3: Code) для задачи VL-9.',
    '',
    'Задача (подставлена автоматически):',
    'ID: VL-9; тип: enhancement; статус: Planned',
    'Заголовок: Тестовая задача',
    '',
    `Описание: ${description}`,
    `План: ${plan}`,
    'Критерии приёмки (AC): (нет)',
    'Definition of Done (DoD): 1. [ ] Тесты проходят',
    '',
    '## Шаги',
    '',
    '1. Реализуй план.',
  ].join('\n');
}

describe('findTaskBlock (VL-258)', () => {
  it('находит блок от заголовка до следующей секции «## »', () => {
    const prompt = phasePrompt('Текст описания');
    const found = findTaskBlock(prompt);
    assert.ok(found, 'блок найден');
    assert.ok(found.block.startsWith(TASK_BLOCK_HEADING));
    assert.match(found.block, /Описание: Текст описания/);
    assert.ok(!found.block.includes('## Шаги'), 'секция шагов в блок не входит');
    // Остаток промпта после блока начинается с «## Шаги»
    assert.match(prompt.slice(found.end), /^\n+## Шаги/);
  });

  it('промпт без блока задачи → null', () => {
    assert.equal(findTaskBlock('Продолжи с текущего места'), null);
    assert.equal(findTaskBlock(''), null);
  });

  it('заголовок внутри строки (не отдельной) → null', () => {
    assert.equal(findTaskBlock(`Текст: ${TASK_BLOCK_HEADING} Описание: x`), null);
  });
});

describe('hashBlock (VL-258)', () => {
  it('детерминирован и различает разные тексты', () => {
    assert.equal(hashBlock('abc'), hashBlock('abc'));
    assert.match(hashBlock('abc'), /^[0-9a-f]{8}$/);
    assert.notEqual(hashBlock('abc'), hashBlock('abd'));
  });
});

describe('dedupeResumePrompt (VL-258)', () => {
  it('неизменный блок → заменён ссылкой, тело блока в тексте отсутствует', () => {
    const longDescription = `${'очень длинное описание '.repeat(1000)}`;
    const first = phasePrompt(longDescription);
    const previous = [
      { role: 'system', content: 'system' },
      { role: 'user', content: first },
      { role: 'assistant', content: 'готово' },
    ];
    const next = phasePrompt(longDescription);
    const result = dedupeResumePrompt(next, previous);
    assert.equal(result.deduped, true);
    assert.equal(result.fromLine, 2, 'ссылка указывает на строку прошлого промпта');
    assert.match(result.text, new RegExp(DEDUP_MARKER));
    assert.match(result.text, /хэш [0-9a-f]{8}/);
    assert.ok(
      !result.text.includes('очень длинное описание'),
      'тело блока не дублируется',
    );
    // Хвост промпта (шаги) сохранён — ссылка не съедает остальной текст.
    assert.match(result.text, /## Шаги/);
  });

  it('изменённый блок (план дописан) → полный текст без изменений', () => {
    const first = phasePrompt('Описание', '(нет)');
    const previous = [{ role: 'user', content: first }];
    const next = phasePrompt('Описание', 'Шаг 1: сделать');
    const result = dedupeResumePrompt(next, previous);
    assert.equal(result.deduped, false);
    assert.equal(result.fromLine, null);
    assert.equal(result.text, next, 'текст возвращён как есть');
    assert.match(result.text, /План: Шаг 1: сделать/);
  });

  it('история без user-промпта с блоком → исходный текст', () => {
    const prompt = phasePrompt('Описание');
    const result = dedupeResumePrompt(prompt, [{ role: 'assistant', content: 'привет' }]);
    assert.equal(result.deduped, false);
    assert.equal(result.text, prompt);
  });

  it('промпт без блока задачи (resume бота) → исходный текст, hash null', () => {
    const result = dedupeResumePrompt('Продолжи с текущего места', [
      { role: 'user', content: phasePrompt('Описание') },
    ]);
    assert.equal(result.deduped, false);
    assert.equal(result.hash, null);
    assert.equal(result.text, 'Продолжи с текущего места');
  });

  it('не трогает пары tool_calls↔tool: длина истории и роли не меняются', () => {
    const prompt = phasePrompt('Описание');
    const previous = [
      { role: 'user', content: prompt },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'x', name: 'read_file', arguments: { path: 'a' } }],
      },
      { role: 'tool', tool_call_id: 'x', content: 'a' },
    ];
    const snapshot = JSON.stringify(previous);
    const result = dedupeResumePrompt(prompt, previous);
    assert.equal(result.deduped, true);
    assert.equal(JSON.stringify(previous), snapshot, 'входные сообщения не мутируются');
  });
});
