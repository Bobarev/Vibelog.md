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
  extractSessionRef,
  richToText,
  parsePlanCommand,
  parsePromptCommand,
  parseSetCommand,
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

describe('parsePromptCommand (VL-66/92)', () => {
  it('текст с пробелами → {text} без agent (дефолт — из настроек, VL-94)', () => {
    assert.deepEqual(parsePromptCommand('сделай коммиты для всех файлов'), {
      text: 'сделай коммиты для всех файлов',
    });
  });

  it('кавычки значимы — не снимаются (запрос естественный)', () => {
    assert.deepEqual(parsePromptCommand('внеси "странный" текст', 'prompt'), {
      text: 'внеси "странный" текст',
    });
  });

  it('суффикс :vb в слове команды → agent vb (VL-92)', () => {
    assert.deepEqual(parsePromptCommand('сделай коммиты', 'prompt:vb'), {
      text: 'сделай коммиты',
      agent: 'vb',
    });
  });

  it('суффикс :qwen — явный agent qwen; без суффикса — без ключа (VL-92/94)', () => {
    assert.deepEqual(parsePromptCommand('запрос', 'prompt:qwen'), {
      text: 'запрос',
      agent: 'qwen',
    });
    assert.deepEqual(parsePromptCommand('запрос', 'prompt'), {
      text: 'запрос',
    });
  });

  it('суффикс в начале ctx.match (entity без двоеточия) — срезается (VL-92)', () => {
    assert.deepEqual(parsePromptCommand(':vb сделай коммиты', 'prompt'), {
      text: 'сделай коммиты',
      agent: 'vb',
    });
  });

  it('двойная доставка суффикса (commandWord + match) — срезается один раз (VL-92)', () => {
    assert.deepEqual(parsePromptCommand(':vb сделай коммиты', 'prompt:vb'), {
      text: 'сделай коммиты',
      agent: 'vb',
    });
  });

  it('неизвестный агент → error с подсказкой, без спавна (VL-92)', () => {
    const e = parsePromptCommand('сделай коммиты', 'prompt:foo');
    assert.ok('error' in e);
    assert.match(e.error, /Синтаксис/);
    assert.match(e.error, /qwen/);
    assert.match(e.error, /vb/);
  });

  it('ведущий :токен в тексте без известного агента — просто текст (VL-92)', () => {
    assert.deepEqual(parsePromptCommand(':сделай что-то', 'prompt'), {
      text: ':сделай что-то',
    });
  });

  it('пустая строка, пробелы и пустой текст с агентом → error (VL-66/92)', () => {
    const e1 = parsePromptCommand('');
    const e2 = parsePromptCommand('   ');
    const e3 = parsePromptCommand('', 'prompt:vb');
    for (const e of [e1, e2, e3]) {
      assert.ok('error' in e);
      assert.match(e.error, /Синтаксис/);
      assert.match(e.error, /\/prompt/);
    }
  });
});

describe('суффикс :<agent> команд фаз (VL-94)', () => {
  it('spec:vb → agent vb; spec без суффикса — без ключа', () => {
    assert.deepEqual(parseSpecCommand('добавить фичу', 'spec:vb'), {
      description: 'добавить фичу',
      agent: 'vb',
    });
    assert.deepEqual(parseSpecCommand('добавить фичу', 'spec'), { description: 'добавить фичу' });
    assert.deepEqual(parseSpecCommand('добавить фичу', 'spec:qwen'), {
      description: 'добавить фичу',
      agent: 'qwen',
    });
  });

  it('plan:vb с комментарием → {id, comment, agent}', () => {
    assert.deepEqual(parsePlanCommand('VL-1 делай по плану', 'plan:vb'), {
      id: 'VL-1',
      comment: 'делай по плану',
      agent: 'vb',
    });
  });

  it('code:vb → agent vb; close:vb → agent vb', () => {
    assert.deepEqual(parseCodeCommand('VL-2', 'code:vb'), { id: 'VL-2', agent: 'vb' });
    assert.deepEqual(parseCloseCommand('VL-3', 'close:vb'), { id: 'VL-3', agent: 'vb' });
  });

  it('comment:vb → {id, text, agent}; без суффикса — без ключа', () => {
    assert.deepEqual(parseCommentCommand('VL-4 продолжай', 'comment:vb'), {
      id: 'VL-4',
      text: 'продолжай',
      agent: 'vb',
    });
    assert.deepEqual(parseCommentCommand('VL-4 продолжай', 'comment'), {
      id: 'VL-4',
      text: 'продолжай',
    });
  });

  it('двойная доставка суффикса (commandWord + match) — срезается один раз', () => {
    assert.deepEqual(parseCommentCommand(':vb VL-4 текст', 'comment:vb'), {
      id: 'VL-4',
      text: 'текст',
      agent: 'vb',
    });
  });

  it('неизвестный агент → error с подсказкой у всех пяти команд', () => {
    for (const r of [
      parseSpecCommand('фича', 'spec:foo'),
      parsePlanCommand('VL-1', 'plan:foo'),
      parseCodeCommand('VL-1', 'code:foo'),
      parseCloseCommand('VL-1', 'close:foo'),
      parseCommentCommand('VL-1 текст', 'comment:foo'),
    ]) {
      assert.ok('error' in r);
      assert.match(r.error, /Синтаксис/);
      assert.match(r.error, /qwen/);
      assert.match(r.error, /vb/);
    }
  });
});

describe('parseSetCommand (VL-94)', () => {
  it('agent vb / agent qwen → {key, value}', () => {
    assert.deepEqual(parseSetCommand('agent vb'), { key: 'agent', value: 'vb' });
    assert.deepEqual(parseSetCommand('agent qwen'), { key: 'agent', value: 'qwen' });
  });

  it('регистр значения не важен', () => {
    assert.deepEqual(parseSetCommand('agent VB'), { key: 'agent', value: 'vb' });
  });

  it('пусто, без значения, мусор, чужой параметр → error с подсказкой', () => {
    for (const bad of ['', 'agent', 'agent foo', 'foo vb']) {
      const r = parseSetCommand(bad);
      assert.ok('error' in r, '"' + bad + '" → error');
      assert.match(r.error, /Синтаксис/);
    }
  });

  it('неизвестный параметр — подсказка с перечнем', () => {
    const r = parseSetCommand('token abc');
    assert.ok('error' in r);
    assert.match(r.error, /Неизвестный параметр/);
    assert.match(r.error, /agent/);
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

describe('extractSessionRef (VL-93)', () => {
  it('backtick-UUID последней строкой → qwen-сессия', () => {
    const text = '# Фаза code: завершена (код 0)\nпонг\n\n**Всего токенов:** 10\n\n`a470c7dd-2ca8-4510-9d81-b184f932af76`';
    assert.deepEqual(extractSessionRef(text), {
      agent: 'qwen',
      sessionId: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    });
  });

  it('backtick vb:agent-<N> → vb-сессия (VL-92)', () => {
    const text = '# Фаза prompt: завершена (код 0)\nответ\n\n`vb:agent-123`';
    assert.deepEqual(extractSessionRef(text), { agent: 'vb', sessionId: 'vb:agent-123' });
  });

  it('голый UUID без backticks — фолбэк Telegram entities', () => {
    const text = '# Фаза code: завершена (код 0)\nответ\na470c7dd-2ca8-4510-9d81-b184f932af76';
    assert.deepEqual(extractSessionRef(text), {
      agent: 'qwen',
      sessionId: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    });
  });

  it('голый agent-<N> → vb-сессия с префиксом vb:', () => {
    assert.deepEqual(extractSessionRef('ответ\nagent-456'), { agent: 'vb', sessionId: 'vb:agent-456' });
  });

  it('backtick qwen:<UUID> — единый формат вывода (VL-93)', () => {
    const text = '# Фаза code: завершена (код 0)\nответ\n\n`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`';
    // --resume нужен голый UUID — префикс qwen: отбрасывается
    assert.deepEqual(extractSessionRef(text), {
      agent: 'qwen',
      sessionId: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    });
  });

  it('голый qwen:<UUID> без backticks — фолбэк Telegram entities (VL-93)', () => {
    const text = '# Фаза code: завершена (код 0)\nответ\nqwen:a470c7dd-2ca8-4510-9d81-b184f932af76';
    assert.deepEqual(extractSessionRef(text), {
      agent: 'qwen',
      sessionId: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    });
  });

  it('без токена, пустой текст и токен не в хвосте → null', () => {
    assert.equal(extractSessionRef('# Фаза code: завершена (код 0)\nпросто текст'), null);
    assert.equal(extractSessionRef(''), null);
    // UUID в середине текста (не в последних двух строках) не берётся
    const mid = '`a470c7dd-2ca8-4510-9d81-b184f932af76`\nстрока 1\nстрока 2\nстрока 3';
    assert.equal(extractSessionRef(mid), null);
  });
});

describe('richToText (VL-93 fix: rich_message без поля text)', () => {
  it('blocks rich-сообщения фазы → плоский текст с токеном сессии', () => {
    // Структура reply_to_message.rich_message после sendRichMessage:
    // paragraph с heading/bold/code-фрагментами; `` `uuid` `` → code
    const rich = {
      blocks: [
        { type: 'heading', text: [{ type: 'bold', text: 'Фаза prompt: завершена' }], size: 1 },
        { type: 'paragraph', text: 'понг' },
        { type: 'paragraph', text: [{ type: 'bold', text: 'Всего токенов:' }, ' 10'] },
        { type: 'paragraph', text: [{ type: 'code', text: 'qwen:a470c7dd-2ca8-4510-9d81-b184f932af76' }] },
      ],
    };
    const flat = richToText(rich);
    assert.match(flat, /qwen:a470c7dd-2ca8-4510-9d81-b184f932af76$/);
    // Извлечение сессии из плоского текста работает (голый токен, без backticks)
    assert.deepEqual(extractSessionRef(flat), {
      agent: 'qwen',
      sessionId: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
    });
  });

  it('строка, массив, пустой/неизвестный вход — без исключений', () => {
    assert.equal(richToText('просто строка'), 'просто строка');
    assert.equal(richToText(['a', 'b']), 'ab');
    assert.equal(richToText(null), '');
    assert.equal(richToText(undefined), '');
    assert.equal(richToText(42), '');
  });

  it('custom_emoji → alternative_text; блоки разделены переводом строки', () => {
    const rich = {
      blocks: [
        { type: 'paragraph', text: [{ type: 'custom_emoji', custom_emoji_id: '1', alternative_text: '👍' }] },
        { type: 'paragraph', text: 'второй блок' },
      ],
    };
    assert.equal(richToText(rich), '👍\nвторой блок');
  });
});
