/**
 * Тесты VL-255 — дедупликация и лимит tool-вызовов веб-чата
 * (src/web/tool-dedup.ts).
 *
 * Проверяет:
 * - callSignature: стабильность при разном порядке ключей (в т.ч. вложенных),
 *   порядок массивов значим, undefined/функции отбрасываются;
 * - guard: дословный повтор → duplicate, другие аргументы → execute;
 * - легитимный повтор после write к тому же ресурсу → execute;
 *   дословный повтор самого write → duplicate;
 * - лимит вызовов на ответ, сброс счётчика beginTurn (карта исполненных
 *   сохраняется), счётчики stats();
 * - resolveChatMaxToolCalls: конфиг chat_max_tool_calls (валидные значения,
 *   мусор, отсутствие файла → дефолт 16);
 * - тексты JSON-ответов duplicateCallResult/limitCallResult.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CHAT_MAX_TOOL_CALLS_DEFAULT,
  callSignature,
  createTurnToolGuard,
  duplicateCallResult,
  limitCallResult,
  resolveChatMaxToolCalls,
} from '../../dist/web/tool-dedup.js';

const tmpDirs = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/** Временный каталог проекта с settings.json (или без него). */
function makeProject(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'vibelog-tool-dedup-'));
  tmpDirs.push(dir);
  if (settings !== undefined) {
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify(settings), 'utf-8');
  }
  return dir;
}

describe('VL-255 — callSignature', () => {
  it('порядок ключей верхнего уровня не влияет на подпись', () => {
    assert.equal(
      callSignature('read_file', { path: 'a.ts', limit: 5 }),
      callSignature('read_file', { limit: 5, path: 'a.ts' }),
    );
  });

  it('порядок ключей вложенных объектов не влияет (рекурсивная сортировка)', () => {
    assert.equal(
      callSignature('backlog_update_task', { id: 'VL-1', patch: { plan: 'p', notes: 'n' } }),
      callSignature('backlog_update_task', { patch: { notes: 'n', plan: 'p' }, id: 'VL-1' }),
    );
  });

  it('порядок элементов массива значим (это разные вызовы)', () => {
    assert.notEqual(
      callSignature('tool', { fields: ['a', 'b'] }),
      callSignature('tool', { fields: ['b', 'a'] }),
    );
  });

  it('undefined-значения и пустой объект дают одинаковую подпись', () => {
    assert.equal(
      callSignature('read_file', { path: 'a.ts' }),
      callSignature('read_file', { path: 'a.ts', limit: undefined }),
    );
    assert.equal(callSignature('tool', undefined), callSignature('tool', {}));
  });

  it('разные имена инструментов → разные подписи при тех же аргументах', () => {
    assert.notEqual(callSignature('read_file', { path: 'a' }), callSignature('write_file', { path: 'a' }));
  });
});

describe('VL-255 — createTurnToolGuard: дедупликация', () => {
  it('первый вызов исполняется, дословный повтор → duplicate', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    assert.equal(guard.check('read_file', { path: 'README.md' }), 'execute');
    guard.noteExecuted('read_file', { path: 'README.md' });
    assert.equal(guard.check('read_file', { path: 'README.md' }), 'duplicate');
    assert.equal(guard.check('read_file', { path: 'README.md' }), 'duplicate');
    assert.deepEqual(guard.stats(), { executed: 1, deduped: 2, limit_hits: 0 });
  });

  it('другие аргументы того же инструмента → execute', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    guard.check('read_file', { path: 'a.ts' });
    guard.noteExecuted('read_file', { path: 'a.ts' });
    assert.equal(guard.check('read_file', { path: 'a.ts', offset: 10 }), 'execute');
  });

  it('дедуп действует на весь ход: beginTurn не забывает исполненные вызовы', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    guard.check('backlog_view_task', { id: 'VL-1' });
    guard.noteExecuted('backlog_view_task', { id: 'VL-1' });
    guard.beginTurn(); // новый ответ модели в том же POST
    assert.equal(guard.check('backlog_view_task', { id: 'VL-1' }), 'duplicate');
  });
});

describe('VL-255 — createTurnToolGuard: повтор после write', () => {
  it('чтение после записи того же файла разрешено', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    guard.check('read_file', { path: 'a.ts' });
    guard.noteExecuted('read_file', { path: 'a.ts' });
    // write к тому же ресурсу поднимает epoch
    guard.check('write_file', { path: 'a.ts', content: 'x' });
    guard.noteExecuted('write_file', { path: 'a.ts', content: 'x' });
    // повторное чтение — новый вызов, а не дубль
    assert.equal(guard.check('read_file', { path: 'a.ts' }), 'execute');
    assert.equal(guard.stats().deduped, 0);
  });

  it('дословный повтор самого write блокируется', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    guard.check('write_file', { path: 'a.ts', content: 'x' });
    guard.noteExecuted('write_file', { path: 'a.ts', content: 'x' });
    assert.equal(guard.check('write_file', { path: 'a.ts', content: 'x' }), 'duplicate');
  });

  it('write к другому файлу не разрешает дубль чтения первого', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 16 });
    guard.beginTurn();
    guard.check('read_file', { path: 'a.ts' });
    guard.noteExecuted('read_file', { path: 'a.ts' });
    guard.check('write_file', { path: 'b.ts', content: 'y' });
    guard.noteExecuted('write_file', { path: 'b.ts', content: 'y' });
    assert.equal(guard.check('read_file', { path: 'a.ts' }), 'duplicate');
  });
});

describe('VL-255 — createTurnToolGuard: лимит вызовов на ответ', () => {
  it('лимит N: первые N исполняются, остальные → limit', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 3 });
    guard.beginTurn();
    for (let i = 0; i < 3; i++) {
      assert.equal(guard.check('read_file', { path: `f${i}.ts` }), 'execute');
      guard.noteExecuted('read_file', { path: `f${i}.ts` });
    }
    assert.equal(guard.check('read_file', { path: 'f3.ts' }), 'limit');
    assert.equal(guard.check('read_file', { path: 'f4.ts' }), 'limit');
    assert.equal(guard.stats().limit_hits, 2);
    assert.equal(guard.stats().executed, 3);
  });

  it('beginTurn сбрасывает счётчик вызовов ответа', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 2 });
    guard.beginTurn();
    guard.check('t', { i: 1 });
    guard.check('t', { i: 2 });
    assert.equal(guard.check('t', { i: 3 }), 'limit');
    guard.beginTurn();
    assert.equal(guard.check('t', { i: 4 }), 'execute');
  });

  it('дубль тоже тратит бюджет ответа (модель не уходит в бесконечный повтор)', () => {
    const guard = createTurnToolGuard({ maxPerResponse: 2 });
    guard.beginTurn();
    guard.check('read_file', { path: 'a' });
    guard.noteExecuted('read_file', { path: 'a' });
    assert.equal(guard.check('read_file', { path: 'a' }), 'duplicate');
    assert.equal(guard.check('read_file', { path: 'a' }), 'limit');
  });

  it('maxPerResponse() возвращает лимит, дефолт — CHAT_MAX_TOOL_CALLS_DEFAULT', () => {
    assert.equal(createTurnToolGuard().maxPerResponse(), CHAT_MAX_TOOL_CALLS_DEFAULT);
    assert.equal(createTurnToolGuard({ maxPerResponse: 5 }).maxPerResponse(), 5);
  });

  it('мусорный лимит (0, NaN) → дефолт', () => {
    assert.equal(createTurnToolGuard({ maxPerResponse: 0 }).maxPerResponse(), CHAT_MAX_TOOL_CALLS_DEFAULT);
    assert.equal(createTurnToolGuard({ maxPerResponse: NaN }).maxPerResponse(), CHAT_MAX_TOOL_CALLS_DEFAULT);
  });
});

describe('VL-255 — resolveChatMaxToolCalls', () => {
  it('нет settings.json → дефолт 16', () => {
    assert.equal(resolveChatMaxToolCalls(makeProject()), CHAT_MAX_TOOL_CALLS_DEFAULT);
  });

  it('валидное значение из конфига используется', () => {
    assert.equal(resolveChatMaxToolCalls(makeProject({ chat_max_tool_calls: 3 })), 3);
  });

  it('мусор в конфиге → дефолт (без падения)', () => {
    for (const bad of ['abc', 0, -5, 2.5, 201, null, [], { a: 1 }, true]) {
      assert.equal(
        resolveChatMaxToolCalls(makeProject({ chat_max_tool_calls: bad })),
        CHAT_MAX_TOOL_CALLS_DEFAULT,
        `значение ${JSON.stringify(bad)} должно давать дефолт`,
      );
    }
  });

  it('битый settings.json → дефолт', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-tool-dedup-'));
    tmpDirs.push(dir);
    mkdirSync(join(dir, '.vibelog'), { recursive: true });
    writeFileSync(join(dir, '.vibelog', 'settings.json'), '{ битый json', 'utf-8');
    assert.equal(resolveChatMaxToolCalls(dir), CHAT_MAX_TOOL_CALLS_DEFAULT);
  });
});

describe('VL-255 — тексты ответов модели', () => {
  it('duplicateCallResult — ok:false, duplicate:true и следующий шаг', () => {
    const parsed = JSON.parse(duplicateCallResult());
    assert.equal(parsed.ok, false);
    assert.equal(parsed.duplicate, true);
    assert.match(parsed.message, /Идентичный вызов уже выполнен в этом ходе/);
    assert.match(parsed.message, /используй полученный ранее результат/);
  });

  it('limitCallResult — ok:false, limit:true, число лимита в тексте', () => {
    const parsed = JSON.parse(limitCallResult(16));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.limit, true);
    assert.match(parsed.message, /Лимит tool-вызовов на один ответ исчерпан \(16\)/);
    assert.match(parsed.message, /заверши ход и продолжи следующим/);
  });
});
