/**
 * Тесты VL-229 — метрика повторов в metе сессии и вывод /analyze.
 *
 * Проверяет: roundtrip `repeat_stats` через updateSessionMeta (merge не
 * затирает taskId/phase — lesson-40) и sync-парсер метрики из jsonl
 * (analyzeToolRepeatsFromJsonlSync): фикстура с зацикленным grep-паттерном
 * (AC3), отсутствие файла → null, битая строка не роняет разбор.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentSessionsDir,
  analyzeToolRepeatsFromJsonlSync,
  loadSessionMetaSync,
  saveSessionMeta,
  updateSessionMeta,
} from '../../dist/agent/session.js';

/** jsonl-строка assistant с одним tool_call. */
function callLine(id, name, args) {
  return JSON.stringify({ role: 'assistant', content: null, tool_calls: [{ id, name, arguments: args }] });
}

describe('session: repeat_stats в мете и sync-парсер (VL-229)', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-repeat-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateSessionMeta merge не затирает taskId/phase при записи repeat_stats', async () => {
    const sdir = agentSessionsDir(dir);
    await saveSessionMeta(sdir, 'agent-1', { taskId: 'VL-229', phase: 'code', cwd: dir });
    updateSessionMeta(sdir, 'agent-1', {
      cwd: dir,
      repeat_stats: { tool_calls_total: 10, repeat_calls: 3, repeat_share: 0.3, top: [{ key: 'read_file|a.ts', count: 4 }] },
    });
    const meta = loadSessionMetaSync(sdir, 'agent-1');
    assert.equal(meta.taskId, 'VL-229');
    assert.equal(meta.phase, 'code');
    assert.equal(meta.repeat_stats.tool_calls_total, 10);
    assert.equal(meta.repeat_stats.top[0].count, 4);
  });

  it('AC3: фикстура jsonl с зацикленным grep → топ и доля из файла', () => {
    const sdir = agentSessionsDir(dir);
    mkdirSync(sdir, { recursive: true });
    const lines = [];
    for (let i = 0; i < 12; i++) lines.push(callLine(`g${i}`, 'grep_search', { pattern: 'loop.ts' }));
    for (let i = 0; i < 8; i++) lines.push(callLine(`r${i}`, 'read_file', { path: `src/f${i}.ts` }));
    writeFileSync(join(sdir, 'agent-repeat.jsonl'), lines.join('\n') + '\n', 'utf-8');
    const stats = analyzeToolRepeatsFromJsonlSync(sdir, 'agent-repeat');
    assert.ok(stats);
    assert.equal(stats.tool_calls_total, 20);
    assert.equal(stats.repeat_calls, 11);
    assert.equal(stats.repeat_share, 0.55);
    assert.deepEqual(stats.top[0], { key: 'grep_search|loop.ts', count: 12 });
  });

  it('битая строка jsonl пропускается, метрика по остальным считается', () => {
    const sdir = agentSessionsDir(dir);
    mkdirSync(sdir, { recursive: true });
    const body = [
      callLine('a1', 'read_file', { path: 'x.ts' }),
      '{"role": "assistant"', // обрыв записи в середине файла
      callLine('a2', 'read_file', { path: 'x.ts' }),
    ].join('\n');
    writeFileSync(join(sdir, 'agent-broken.jsonl'), body, 'utf-8');
    const stats = analyzeToolRepeatsFromJsonlSync(sdir, 'agent-broken');
    assert.equal(stats.tool_calls_total, 2);
    assert.equal(stats.repeat_calls, 1);
  });

  it('нет файла сессии → null (вызывающий подставляет «нет данных»)', () => {
    assert.equal(analyzeToolRepeatsFromJsonlSync(agentSessionsDir(dir), 'agent-404'), null);
  });
});