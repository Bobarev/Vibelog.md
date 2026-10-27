/**
 * Тесты VL-207 — REST API тредов чата: GET /api/chat/threads и
 * GET /api/chat/threads/:id (список для сайдбара + история для
 * восстановления треда при навигации).
 *
 * Контракт:
 * - список: метаданные (threadId/title/updatedAt/messageCount), свежие
 *   сверху, title — первая строка первого user-сообщения, обрезка 80;
 * - история: { threadId, messages } — jsonl как есть (user/assistant/tool);
 * - 404 на несуществующий тред и на невалидный id (path-traversal guard);
 * - пустой каталог chat-sessions → пустой список, не ошибка.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

/** GET через handleApi (5-й аргумент query — как отдаёт server.ts). */
function get(url) {
  return handleApi('GET', url, null, cwd, '');
}

/** Записать jsonl-тред вручную (без LLM — фикстура формата VL-204). */
function writeThread(threadId, messages) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${threadId}.jsonl`),
    messages.map(m => JSON.stringify(m)).join('\n') + '\n',
    'utf8',
  );
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-threads-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /api/chat/threads — список тредов', () => {
  it('пустой каталог → 200 с пустым массивом', () => {
    const res = get('/api/chat/threads');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('метаданные, сортировка по mtime (свежие сверху), title из первого user', () => {
    writeThread('chat-old', [
      { role: 'user', content: 'Старый вопрос\nвторая строка не в title' },
      { role: 'assistant', content: 'Ответ' },
    ]);
    writeThread('chat-new', [
      { role: 'user', content: 'Новый вопрос' },
      { role: 'assistant', content: 'Ответ' },
      { role: 'user', content: 'Уточнение' },
    ]);

    // mtime: chat-old старше
    const oldFile = join(cwd, '.vibelog', 'chat-sessions', 'chat-old.jsonl');
    const past = new Date(Date.now() - 60_000);
    utimesSync(oldFile, past, past);

    const res = get('/api/chat/threads');
    assert.equal(res.status, 200);
    const list = res.body;
    assert.equal(list.length, 2);
    assert.equal(list[0].threadId, 'chat-new');
    assert.equal(list[0].title, 'Новый вопрос');
    assert.equal(list[0].messageCount, 3);
    assert.equal(list[1].threadId, 'chat-old');
    // title — только первая строка
    assert.equal(list[1].title, 'Старый вопрос');
    // поля без тел сообщений
    assert.ok(!('messages' in list[0]));
    assert.ok(!('content' in list[0]));
    assert.ok(!Number.isNaN(Date.parse(list[0].updatedAt)));
  });

  it('title обрезается до 80 символов; тред без user → «Пустой тред»', () => {
    writeThread('chat-long', [{ role: 'user', content: 'х'.repeat(200) }]);
    writeThread('chat-empty', [{ role: 'assistant', content: 'привет' }]);

    const res = get('/api/chat/threads');
    assert.equal(res.status, 200);
    const long = res.body.find(t => t.threadId === 'chat-long');
    assert.equal(long.title.length, 80);
    const empty = res.body.find(t => t.threadId === 'chat-empty');
    assert.equal(empty.title, 'Пустой тред');
    assert.equal(empty.messageCount, 1);
  });

  it('мусорное имя файла в каталоге игнорируется (THREAD_ID_RE)', () => {
    writeFileSync(join(cwd, '.vibelog', 'chat-sessions', '..bad name.jsonl'), '{}\n', 'utf8');
    const res = get('/api/chat/threads');
    assert.equal(res.status, 200);
    assert.ok(res.body.every(t => /^[a-zA-Z0-9_-]+$/.test(t.threadId)));
  });
});

describe('GET /api/chat/threads/:id — история треда', () => {
  it('существующий тред → 200 { threadId, messages } с jsonl как есть', () => {
    const messages = [
      { role: 'user', content: 'Вопрос' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', name: 'backlog_search', arguments: { query: 'x' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '{"tasks":[]}' },
      { role: 'assistant', content: 'Итог' },
    ];
    writeThread('chat-hist', messages);

    const res = get('/api/chat/threads/chat-hist');
    assert.equal(res.status, 200);
    assert.equal(res.body.threadId, 'chat-hist');
    assert.deepEqual(res.body.messages, messages);
  });

  it('несуществующий тред → 404', () => {
    const res = get('/api/chat/threads/chat-missing');
    assert.equal(res.status, 404);
  });

  it('невалидный id (path-traversal, пробелы) → 404, без чтения наружу', () => {
    assert.equal(get('/api/chat/threads/..%2F..%2Fetc').status, 404);
    assert.equal(get('/api/chat/threads/..').status, 404);
    assert.equal(get('/api/chat/threads/a%20b').status, 404);
  });

  it('пустой (нулевой) тред → 200 с пустым массивом', () => {
    writeThread('chat-fresh', []);
    const res = get('/api/chat/threads/chat-fresh');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.messages, []);
  });
});
