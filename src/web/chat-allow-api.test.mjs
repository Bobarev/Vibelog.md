/**
 * Тесты VL-264 — REST API allow-list треда:
 * - GET    /api/chat/threads/:id/allow  → { tools };
 * - POST   /api/chat/threads/:id/allow  { tool } → { tools } (идемпотентно);
 * - DELETE /api/chat/threads/:id/allow?tool=<name> → { tools };
 * - 400 на отсутствующий/пустой tool;
 * - GET /api/chat/threads/:id несёт allowList (клиент помечает карточки).
 *
 * handleApi вызывается напрямую (как server.ts), без сети и LLM.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../../dist/web/api.js';

let cwd;

/** Записать jsonl-тред вручную (формат VL-204, без LLM). */
function writeThread(threadId) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${threadId}.jsonl`),
    `${JSON.stringify({ role: 'user', content: 'привет' })}\n`,
    'utf8',
  );
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-allow-api-'));
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('VL-264: /api/chat/threads/:id/allow', () => {
  it('пустой allow-list → { tools: [] }', () => {
    writeThread('chat-allow-a');
    const res = handleApi('GET', '/api/chat/threads/chat-allow-a/allow', null, cwd, '');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { tools: [] });
  });

  it('POST добавляет инструмент (идемпотентно), GET отдаёт список', () => {
    const post = handleApi(
      'POST',
      '/api/chat/threads/chat-allow-a/allow',
      { tool: 'backlog_create_task' },
      cwd,
      '',
    );
    assert.equal(post.status, 200);
    assert.deepEqual(post.body, { tools: ['backlog_create_task'] });

    const again = handleApi(
      'POST',
      '/api/chat/threads/chat-allow-a/allow',
      { tool: 'backlog_create_task' },
      cwd,
      '',
    );
    assert.deepEqual(again.body, { tools: ['backlog_create_task'] }, 'дубля нет');

    const get = handleApi('GET', '/api/chat/threads/chat-allow-a/allow', null, cwd, '');
    assert.deepEqual(get.body, { tools: ['backlog_create_task'] });
  });

  it('DELETE ?tool=... отзывает разрешение', () => {
    handleApi('POST', '/api/chat/threads/chat-allow-a/allow', { tool: 'write_file' }, cwd, '');
    const del = handleApi(
      'DELETE',
      '/api/chat/threads/chat-allow-a/allow',
      null,
      cwd,
      'tool=write_file',
    );
    assert.equal(del.status, 200);
    assert.deepEqual(del.body, { tools: ['backlog_create_task'] });
  });

  it('400 на отсутствующий tool (POST и DELETE)', () => {
    const post = handleApi('POST', '/api/chat/threads/chat-allow-a/allow', {}, cwd, '');
    assert.equal(post.status, 400);
    assert.ok(post.body.error);
    const del = handleApi('DELETE', '/api/chat/threads/chat-allow-a/allow', null, cwd, '');
    assert.equal(del.status, 400);
  });

  it('GET /api/chat/threads/:id отдаёт allowList', () => {
    const res = handleApi('GET', '/api/chat/threads/chat-allow-a', null, cwd, '');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.allowList, ['backlog_create_task']);
    assert.ok(Array.isArray(res.body.messages));
  });

  it('allow-list одного треда не виден в другом', () => {
    writeThread('chat-allow-b');
    const res = handleApi('GET', '/api/chat/threads/chat-allow-b/allow', null, cwd, '');
    assert.deepEqual(res.body, { tools: [] });
  });
});
