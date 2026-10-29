/**
 * Тесты VL-95 — хранение сессий vibelog-agent (src/agent/session.ts).
 *
 * JSONL roundtrip (сообщения с tool_calls), ошибки loadSession,
 * latestSession по mtime, формат файла (строка на сообщение).
 * Каталоги — mkdtemp в /tmp (изоляция тестов).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentSessionsDir,
  appendSessionMessage,
  createSessionId,
  findTaskPhaseSessionSync,
  latestSession,
  loadSession,
  loadSessionMetaSync,
  saveSession,
  saveSessionMeta,
  sumUsageFromJsonlSync,
  sumUsageFromMessages,
  countToolCallsInMessages,
  updateSessionMeta,
} from '../../dist/agent/session.js';

describe('session (VL-95)', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-session-'));
  });
  afterAll(() => {
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

  it('appendSessionMessage дописывает строки в конец (save→append→load roundtrip)', async () => {
    const messages = [
      { role: 'user', content: 'первый ход' },
      { role: 'assistant', content: 'ответ' },
    ];
    await saveSession(dir, 'agent-app1', messages);
    await appendSessionMessage(dir, 'agent-app1', { role: 'user', content: 'второй ход' });
    await appendSessionMessage(dir, 'agent-app1', { role: 'assistant', content: 'готово' });
    const loaded = await loadSession(dir, 'agent-app1');
    assert.equal(loaded.length, 4);
    assert.equal(loaded[2].content, 'второй ход');
    assert.equal(loaded[3].content, 'готово');
  });

  it('appendSessionMessage: path traversal sessionId → throw', async () => {
    await assert.rejects(appendSessionMessage(dir, '../escape', { role: 'user', content: 'x' }), (err) => {
      assert.match(err.message, /Недопустимый идентификатор сессии/);
      return true;
    });
  });

  it('appendSessionMessage: несуществующий каталог создаётся', async () => {
    const sub = join(dir, 'nested', 'deep');
    await appendSessionMessage(sub, 'agent-app2', { role: 'user', content: 'a' });
    const loaded = await loadSession(sub, 'agent-app2');
    assert.deepEqual(loaded, [{ role: 'user', content: 'a' }]);
  });
});

describe('метаданные сессии — meta.json (VL-110)', () => {
  let metaDir;
  beforeAll(() => {
    metaDir = mkdtempSync(join(tmpdir(), 'vibelog-session-meta-'));
  });
  afterAll(() => {
    rmSync(metaDir, { recursive: true, force: true });
  });

  it('save/load roundtrip: taskId, phase, cwd', async () => {
    await saveSessionMeta(metaDir, 'agent-1', { taskId: 'VL-77', phase: 'code', cwd: '/tmp/x' });
    const loaded = loadSessionMetaSync(metaDir, 'agent-1');
    // VL-198: saveSessionMeta дополнительно проставляет sessionId/startedAt
    assert.equal(loaded?.taskId, 'VL-77');
    assert.equal(loaded?.phase, 'code');
    assert.equal(loaded?.cwd, '/tmp/x');
    assert.equal(loaded?.sessionId, 'agent-1');
    assert.ok(loaded?.startedAt, 'startedAt проставляется при создании');
  });

  it('файла нет → null', () => {
    assert.equal(loadSessionMetaSync(metaDir, 'agent-missing'), null);
  });

  it('битый JSON → null, не исключение', async () => {
    await saveSessionMeta(metaDir, 'agent-2', { cwd: '/tmp/x' });
    writeFileSync(join(metaDir, 'agent-2.meta.json'), '{бито', 'utf-8');
    assert.equal(loadSessionMetaSync(metaDir, 'agent-2'), null);
  });

  it('небезопасный sessionId → null (path traversal)', () => {
    assert.equal(loadSessionMetaSync(metaDir, '../evil'), null);
  });

  it('latestSession не видит meta.json — только .jsonl', async () => {
    await saveSessionMeta(metaDir, 'agent-3', { cwd: '/tmp/y' });
    assert.equal(await latestSession(metaDir), null, 'jsonl нет — meta не считается сессией');
  });
});

describe('findTaskPhaseSessionSync (VL-147)', () => {
  let findDir;
  beforeAll(() => {
    findDir = mkdtempSync(join(tmpdir(), 'vibelog-session-find-'));
  });
  afterAll(() => {
    rmSync(findDir, { recursive: true, force: true });
  });

  it('находит сессию по taskId+phase; регистр taskId не важен', async () => {
    const dir = join(findDir, 'basic');
    await saveSessionMeta(dir, 'agent-p1', { taskId: 'VL-10', phase: 'plan', cwd: '/tmp/x' });
    assert.equal(findTaskPhaseSessionSync(dir, 'VL-10', 'plan'), 'agent-p1');
    assert.equal(findTaskPhaseSessionSync(dir, 'vl-10', 'plan'), 'agent-p1', 'регистронезависимо');
  });

  it('игнорирует чужую задачу и чужую фазу', async () => {
    const dir = join(findDir, 'foreign');
    await saveSessionMeta(dir, 'agent-other-task', { taskId: 'VL-99', phase: 'plan', cwd: '/tmp/x' });
    await saveSessionMeta(dir, 'agent-other-phase', { taskId: 'VL-10', phase: 'code', cwd: '/tmp/x' });
    // Чужая задача/фаза не находятся; своя (нет) — null
    assert.equal(findTaskPhaseSessionSync(dir, 'VL-10', 'plan'), null);
    assert.equal(findTaskPhaseSessionSync(dir, 'VL-99', 'code'), null);
  });

  it('нет совпадений / нет каталога / битая мета → null', async () => {
    const empty = join(findDir, 'empty');
    await saveSessionMeta(empty, 'agent-x', { cwd: '/tmp/x' }); // без taskId/phase
    assert.equal(findTaskPhaseSessionSync(empty, 'VL-1', 'plan'), null);
    assert.equal(findTaskPhaseSessionSync(join(findDir, 'no-such-dir'), 'VL-1', 'plan'), null);
    // Битая мета — не исключение, а пропуск
    const bad = join(findDir, 'bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'agent-bad.meta.json'), '{бито', 'utf-8');
    assert.equal(findTaskPhaseSessionSync(bad, 'VL-1', 'plan'), null);
  });

  it('при двух plan-сессиях выбирает последнюю по mtime jsonl', async () => {
    const dir = join(findDir, 'mtime');
    await saveSessionMeta(dir, 'agent-old', { taskId: 'VL-20', phase: 'plan', cwd: '/tmp/x' });
    await saveSessionMeta(dir, 'agent-new', { taskId: 'VL-20', phase: 'plan', cwd: '/tmp/x' });
    // mtime jsonl: у старой сессии отматываем в прошлое
    await saveSession(dir, 'agent-old', [{ role: 'user', content: 'старое' }]);
    await saveSession(dir, 'agent-new', [{ role: 'user', content: 'новое' }]);
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(dir, 'agent-old.jsonl'), past, past);
    assert.equal(findTaskPhaseSessionSync(dir, 'VL-20', 'plan'), 'agent-new');
  });

  it('без jsonl mtime берётся у meta-файла', async () => {
    const dir = join(findDir, 'meta-only');
    await saveSessionMeta(dir, 'agent-m1', { taskId: 'VL-30', phase: 'plan', cwd: '/tmp/x' });
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(dir, 'agent-m1.meta.json'), past, past);
    // jsonl нет — работает по mtime меты, сессия всё равно находится
    assert.equal(findTaskPhaseSessionSync(dir, 'VL-30', 'plan'), 'agent-m1');
  });
});

describe('учёт токенов сессии (VL-198)', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-usage-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const usageMsg = (u) => ({ role: 'assistant', content: 'текст', usage: u });

  it('sumUsageFromMessages: сумма по assistant + requests = число сообщений с usage', () => {
    const messages = [
      { role: 'user', content: 'вопрос' },
      usageMsg({ input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, total_tokens: 110, reasoning_tokens: 4 }),
      { role: 'tool', tool_call_id: 't1', content: 'результат' },
      usageMsg({ input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 0, total_tokens: 220, reasoning_tokens: 0 }),
      // финал fail-сообщение без usage — не считается
      { role: 'assistant', content: 'ошибка' },
    ];
    const sum = sumUsageFromMessages(messages);
    assert.equal(sum.input, 300);
    assert.equal(sum.output, 30);
    assert.equal(sum.cache, 50);
    assert.equal(sum.total, 330);
    assert.equal(sum.requests, 2);
    assert.equal(sum.reasoning, 4);
  });

  it('старые сообщения без usage → нули, не ошибка', () => {
    const sum = sumUsageFromMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'б' },
    ]);
    // нулевой reasoning убирается из агрегата (не засоряет фронтматтер)
    assert.deepEqual(sum, { input: 0, output: 0, cache: 0, total: 0, requests: 0 });
    assert.equal(sum.reasoning, undefined);
  });

  it('updateSessionMeta: merge не затирает taskId/phase, дописывает usage/finishedAt', async () => {
    await saveSessionMeta(dir, 'agent-42', { taskId: 'VL-9', phase: 'plan', cwd: '/wt' });
    const merged = updateSessionMeta(dir, 'agent-42', {
      finishedAt: '2026-10-27T01:00:00.000Z',
      durationMs: 1234,
      usage: { input: 10, output: 5, cache: 0, total: 15, requests: 2 },
      model: 'mimo-v2.6-pro',
      agent: 'vb',
    });
    // lesson-40: фаза/задача прошлых ранов живы
    assert.equal(merged.taskId, 'VL-9');
    assert.equal(merged.phase, 'plan');
    assert.equal(merged.cwd, '/wt');
    assert.equal(merged.sessionId, 'agent-42');
    assert.equal(merged.usage.total, 15);
    assert.equal(merged.model, 'mimo-v2.6-pro');
    const reloaded = loadSessionMetaSync(dir, 'agent-42');
    assert.equal(reloaded.usage_recorded, undefined);
    // usage_recorded — отдельной точечной записью
    updateSessionMeta(dir, 'agent-42', { usage_recorded: { input: 10, output: 5, cache: 0, total: 15, requests: 2 } });
    assert.equal(loadSessionMetaSync(dir, 'agent-42').usage_recorded.total, 15);
    assert.equal(loadSessionMetaSync(dir, 'agent-42').phase, 'plan');
  });

  it('updateSessionMeta: нет файла и нет cwd → throw; с cwd — создаёт', () => {
    assert.throws(() => updateSessionMeta(dir, 'agent-newmeta', { usage: { input: 1, output: 0, cache: 0, total: 1, requests: 1 } }));
    const created = updateSessionMeta(dir, 'agent-newmeta', { cwd: '/p', taskId: 'VL-1' });
    assert.equal(created.taskId, 'VL-1');
    assert.equal(loadSessionMetaSync(dir, 'agent-newmeta').cwd, '/p');
  });

  it('sumUsageFromJsonlSync: читает usage из jsonl; нет файла → null; битые строки пропускаются', async () => {
    const sessionId = 'agent-777';
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      [
        JSON.stringify({ role: 'user', content: 'x' }),
        JSON.stringify(usageMsg({ input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1, total_tokens: 10, reasoning_tokens: 0 })),
        '{битая строка',
        JSON.stringify(usageMsg({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, total_tokens: 2, reasoning_tokens: 0 })),
        '',
      ].join('\n'),
      'utf-8',
    );
    const sum = sumUsageFromJsonlSync(dir, sessionId);
    assert.equal(sum.input, 8);
    assert.equal(sum.total, 12);
    assert.equal(sum.requests, 2);
    assert.equal(sumUsageFromJsonlSync(dir, 'agent-missing-jsonl'), null);
  });
});

describe('countToolCallsInMessages (VL-223)', () => {
  it('пустой массив → 0', () => {
    assert.equal(countToolCallsInMessages([]), 0);
  });

  it('assistant с 2 валидными + 1 фантомом (name="") → 2', () => {
    const messages = [
      { role: 'assistant', content: null, tool_calls: [
        { id: 'c1', name: 'glob', arguments: {} },
        { id: 'c2', name: 'read_file', arguments: {} },
        { id: 'c3', name: '', arguments: {} }, // фантом VL-215 — не ест бюджет
      ] },
    ];
    assert.equal(countToolCallsInMessages(messages), 2);
  });

  it('mix system/user/tool/assistant без tool_calls → 0', () => {
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'просто текст' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ];
    assert.equal(countToolCallsInMessages(messages), 0);
  });

  it('несколько assistant-сообщений суммируются (история resume)', () => {
    const messages = [
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', name: 't', arguments: {} }] },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'c2', name: 't', arguments: {} },
        { id: '  ', name: 't', arguments: {} }, // фантом: пустой id
      ] },
    ];
    assert.equal(countToolCallsInMessages(messages), 2);
  });
});
