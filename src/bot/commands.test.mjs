/**
 * Тесты VL-35 — парсеры Telegram-команд бота.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCreateCommand,
  parseStatusCommand,
  parseCommentCommand,
  parseCloseCommand,
  parseCodeCommand,
  parseCommitsCommand,
  parsePlanCommand,
  parsePromptCommand,
  parseSpecCommand,
} from '../../dist/bot/commands.js';

describe('parseCreateCommand (VL-35)', () => {
  it('заголовок без флагов', () => {
    const r = parseCreateCommand('Новая фича');
    assert.deepEqual(r, { title: 'Новая фича' });
  });

  it('с -d и --priority', () => {
    const r = parseCreateCommand('Заголовок -d Описание фичи --priority High');
    assert.deepEqual(r, { title: 'Заголовок', description: 'Описание фичи', priority: 'High' });
  });

  it('описание в кавычках снимается', () => {
    const r = parseCreateCommand('Тест -d "текст с пробелами" --priority Low');
    assert.deepEqual(r, { title: 'Тест', description: 'текст с пробелами', priority: 'Low' });
  });

  it('без заголовка → error', () => {
    assert.ok('error' in parseCreateCommand(''));
    assert.ok('error' in parseCreateCommand('-d только описание'));
  });

  it('невалидный приоритет → error', () => {
    const r = parseCreateCommand('Тест --priority Critical');
    assert.ok('error' in r);
    assert.match(r.error, /Невалидный приоритет/);
  });
});

describe('parseStatusCommand (VL-35)', () => {
  it('статус с пробелом: «VL-1 To Do»', () => {
    assert.deepEqual(parseStatusCommand('VL-1 To Do'), { id: 'VL-1', status: 'To Do' });
  });

  it('статус одним словом', () => {
    assert.deepEqual(parseStatusCommand('VL-2 Done'), { id: 'VL-2', status: 'Done' });
  });

  it('без статуса → error', () => {
    assert.ok('error' in parseStatusCommand('VL-1'));
    assert.ok('error' in parseStatusCommand(''));
  });
});

describe('parseCommentCommand (VL-35)', () => {
  it('id + текст с пробелами', () => {
    assert.deepEqual(parseCommentCommand('VL-3 текст комментария'), {
      id: 'VL-3',
      text: 'текст комментария',
    });
  });

  it('только id → error', () => {
    assert.ok('error' in parseCommentCommand('VL-3'));
    assert.ok('error' in parseCommentCommand(''));
  });
});

describe('parseSpecCommand (VL-41)', () => {
  it('обычный текст → description', () => {
    assert.deepEqual(parseSpecCommand('добавить экспорт в PDF'), {
      description: 'добавить экспорт в PDF',
    });
  });

  it('текст в кавычках — кавычки снимаются', () => {
    assert.deepEqual(parseSpecCommand('"фича в кавычках"'), { description: 'фича в кавычках' });
  });

  it('пустая строка и пробелы → error с подсказкой', () => {
    const e1 = parseSpecCommand('');
    const e2 = parseSpecCommand('   ');
    assert.ok('error' in e1);
    assert.ok('error' in e2);
    assert.match(e1.error, /Синтаксис/);
  });
});

describe('parsePlanCommand (VL-50)', () => {
  it('корректный ID → {id}', () => {
    assert.deepEqual(parsePlanCommand('VL-49'), { id: 'VL-49' });
  });

  it('окружающие пробелы снимаются', () => {
    assert.deepEqual(parsePlanCommand('  VL-49  '), { id: 'VL-49' });
  });

  it('хвостовой текст становится комментарием (VL-80)', () => {
    assert.deepEqual(parsePlanCommand('VL-49 ещё что-то'), { id: 'VL-49', comment: 'ещё что-то' });
  });

  it('комментарий из нескольких слов целиком (VL-80)', () => {
    assert.deepEqual(parsePlanCommand('VL-49 учти риски и тесты'), {
      id: 'VL-49',
      comment: 'учти риски и тесты',
    });
  });

  it('хвост только из пробелов → без ключа comment (VL-80)', () => {
    assert.deepEqual(parsePlanCommand('VL-49   '), { id: 'VL-49' });
  });

  it('пустая строка и пробелы → error с подсказкой', () => {
    const e1 = parsePlanCommand('');
    const e2 = parsePlanCommand('   ');
    assert.ok('error' in e1);
    assert.ok('error' in e2);
    assert.match(e1.error, /Синтаксис/);
    assert.match(e1.error, /\/plan/);
    assert.match(e1.error, /\[комментарий\]/);
  });
});

describe('parseCodeCommand (VL-53)', () => {
  it('корректный ID → {id}', () => {
    assert.deepEqual(parseCodeCommand('VL-50'), { id: 'VL-50' });
  });

  it('окружающие пробелы снимаются', () => {
    assert.deepEqual(parseCodeCommand('  VL-50  '), { id: 'VL-50' });
  });

  it('хвостовой текст становится комментарием (VL-80)', () => {
    assert.deepEqual(parseCodeCommand('VL-50 ещё что-то'), { id: 'VL-50', comment: 'ещё что-то' });
  });

  it('комментарий из нескольких слов целиком (VL-80)', () => {
    assert.deepEqual(parseCodeCommand('VL-50 делай по плану без рефакторинга'), {
      id: 'VL-50',
      comment: 'делай по плану без рефакторинга',
    });
  });

  it('хвост только из пробелов → без ключа comment (VL-80)', () => {
    assert.deepEqual(parseCodeCommand('VL-50   '), { id: 'VL-50' });
  });

  it('пустая строка и пробелы → error с подсказкой', () => {
    const e1 = parseCodeCommand('');
    const e2 = parseCodeCommand('   ');
    assert.ok('error' in e1);
    assert.ok('error' in e2);
    assert.match(e1.error, /Синтаксис/);
    assert.match(e1.error, /\/code/);
    assert.match(e1.error, /\[комментарий\]/);
  });
});

describe('parseCloseCommand (VL-55)', () => {
  it('корректный ID → {id}', () => {
    assert.deepEqual(parseCloseCommand('VL-55'), { id: 'VL-55' });
  });

  it('окружающие пробелы снимаются', () => {
    assert.deepEqual(parseCloseCommand('  VL-55  '), { id: 'VL-55' });
  });

  it('хвостовой текст игнорируется (первое слово)', () => {
    assert.deepEqual(parseCloseCommand('VL-55 ещё что-то'), { id: 'VL-55' });
  });

  it('пустая строка и пробелы → error с подсказкой', () => {
    const e1 = parseCloseCommand('');
    const e2 = parseCloseCommand('   ');
    assert.ok('error' in e1);
    assert.ok('error' in e2);
    assert.match(e1.error, /Синтаксис/);
    assert.match(e1.error, /\/close/);
  });
});

describe('parsePromptCommand (VL-66)', () => {
  it('текст с пробелами → {text}', () => {
    assert.deepEqual(parsePromptCommand('сделай коммиты для всех файлов'), {
      text: 'сделай коммиты для всех файлов',
    });
  });

  it('кавычки значимы — не снимаются (запрос естественный)', () => {
    assert.deepEqual(parsePromptCommand('внеси "странный" текст'), {
      text: 'внеси "странный" текст',
    });
  });

  it('пустая строка и пробелы → error с подсказкой', () => {
    const e1 = parsePromptCommand('');
    const e2 = parsePromptCommand('   ');
    assert.ok('error' in e1);
    assert.ok('error' in e2);
    assert.match(e1.error, /Синтаксис/);
    assert.match(e1.error, /\/prompt/);
  });
});

describe('parseCommitsCommand (VL-90)', () => {
  it('пусто и пробелы → count=10 (дефолт)', () => {
    assert.deepEqual(parseCommitsCommand(''), { count: 10 });
    assert.deepEqual(parseCommitsCommand('   '), { count: 10 });
  });

  it('число → count=N', () => {
    assert.deepEqual(parseCommitsCommand('5'), { count: 5 });
    assert.deepEqual(parseCommitsCommand(' 7 '), { count: 7 });
  });

  it('мусор → error с подсказкой', () => {
    for (const bad of ['0', '-3', '3.5', 'abc']) {
      const r = parseCommitsCommand(bad);
      assert.ok('error' in r, '"' + bad + '" → error');
      assert.match(r.error, /Синтаксис/);
      assert.match(r.error, /\/commits/);
    }
  });
});
