/**
 * Тесты VL-95 — хранение сессий vibelog-agent (src/agent/session.ts).
 *
 * JSONL roundtrip (сообщения с tool_calls), ошибки loadSession,
 * latestSession по mtime, формат файла (строка на сообщение).
 * Каталоги — mkdtemp в /tmp (изоляция тестов).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentSessionsDir,
  createSessionId,
  latestSession,
  loadSession,
  saveSession,
} from '../../dist/agent/session.js';

describe('session (VL-95)', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-session-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('agentSessionsDir — <cwd>/.vibelog/agent-sessions', () => {
    assert.equal(agentSessionsDir('/proj'), join('/proj', '.vibelog', 'agent-sessions'));
  });

  it('createSessionId — формат agent-<число>', () => {
    assert.match(createSessionId(), /^agent-\d+$/);
  });

  it('save→load roundtrip: сообщения с tool_calls восстанавливаются', async () => {
    const messages = [
      { role: 'user', content: 'сделай' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 'echo', arguments: { x: 1 } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'assistant', content: 'готово' },
    ];
    await saveSession(dir, 'agent-1', messages);
    const loaded = await loadSession(dir, 'agent-1');
    assert.deepEqual(loaded, messages);
  });

  it('JSONL: по строке на сообщение', async () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];
    await saveSession(dir, 'agent-2', messages);
    const raw = readFileSync(join(dir, 'agent-2.jsonl'), 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), messages[0]);
    assert.deepEqual(JSON.parse(lines[1]), messages[1]);
  });

  it('save перезаписывает файл полностью (resume: старые+новые)', async () => {
    await saveSession(dir, 'agent-3', [{ role: 'user', content: 'старое' }]);
    await saveSession(dir, 'agent-3', [
      { role: 'user', content: 'старое' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'user', content: 'новое' },
    ]);
    const loaded = await loadSession(dir, 'agent-3');
    assert.equal(loaded.length, 3);
    assert.equal(loaded[2].content, 'новое');
  });

  it('load несуществующей сессии → throw «не найдена»', async () => {
    await assert.rejects(loadSession(dir, 'agent-nope'), (err) => {
      assert.match(err.message, /не найдена/);
      return true;
    });
  });

  it('load битого JSONL → throw с номером строки', async () => {
    writeFileSync(join(dir, 'agent-bad.jsonl'), '{"role":"user","content":"ок"}\nне-json\n', 'utf-8');
    await assert.rejects(loadSession(dir, 'agent-bad'), (err) => {
      assert.match(err.message, /битая строка 2/);
      return true;
    });
  });

  it('недопустимый sessionId (path traversal) → throw', async () => {
    await assert.rejects(loadSession(dir, '../escape'), (err) => {
      assert.match(err.message, /Недопустимый идентификатор сессии/);
      return true;
    });
    await assert.rejects(saveSession(dir, 'a/b', []), (err) => {
      assert.match(err.message, /Недопустимый идентификатор сессии/);
      return true;
    });
  });

  it('latestSession — файл с максимальным mtime', async () => {
    const sdir = join(dir, 'latest');
    mkdirSync(sdir);
    writeFileSync(join(sdir, 'agent-old.jsonl'), '{"role":"user","content":"a"}\n', 'utf-8');
    writeFileSync(join(sdir, 'agent-new.jsonl'), '{"role":"user","content":"b"}\n', 'utf-8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(sdir, 'agent-old.jsonl'), past, past);
    assert.equal(await latestSession(sdir), 'agent-new');
  });

  it('latestSession: пусто → null; нет каталога → null', async () => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    assert.equal(await latestSession(empty), null);
    assert.equal(await latestSession(join(dir, 'no-such-dir')), null);
  });
});
