/**
 * Юнит-тесты интерактивного чата агента (VL-102).
 *
 * Проверяют чистый помощник composeTurnMessages: порядок сообщений хода
 * (system → история → user) и отсутствие system-дублей в истории.
 * Полный цикл чата (LLM + TUI) автотестами не покрывается — TTY недоступен;
 * см. ручной чек-лист в implementationPlan VL-102.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeTurnMessages, loadResumeHistory } from '../../dist/agent/interactive.js';

describe('interactive — composeTurnMessages', () => {
  it('без истории — system + user', () => {
    const msgs = composeTurnMessages('SYS', [], 'Привет');
    assert.deepEqual(msgs, [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Привет' },
    ]);
  });

  it('с историей — system → история → user (порядок сохраняется)', () => {
    const history = [
      { role: 'user', content: 'Первый вопрос' },
      { role: 'assistant', content: 'Первый ответ' },
    ];
    const msgs = composeTurnMessages('SYS', history, 'Второй вопрос');
    assert.deepEqual(msgs, [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Первый вопрос' },
      { role: 'assistant', content: 'Первый ответ' },
      { role: 'user', content: 'Второй вопрос' },
    ]);
  });

  it('история с system-сообщениями — system в ходе ровно один (первый)', () => {
    // Транскрипт сессии хранит system первым сообщением — если историю не
    // отфильтровать, в запрос попали бы дубли system (ломает часть LLM API)
    const history = [
      { role: 'system', content: 'СТАРЫЙ SYSTEM' },
      { role: 'user', content: 'Вопрос' },
      { role: 'assistant', content: 'Ответ' },
      { role: 'system', content: 'ЕЩЁ ОДИН SYSTEM' },
    ];
    const msgs = composeTurnMessages('СВЕЖИЙ SYSTEM', history, 'Новый вопрос');
    const systemCount = msgs.filter((m) => m.role === 'system').length;
    assert.equal(systemCount, 1);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[0].content, 'СВЕЖИЙ SYSTEM');
    assert.equal(msgs[msgs.length - 1].content, 'Новый вопрос');
  });

  it('исходная история не мутируется', () => {
    const history = [{ role: 'user', content: 'Вопрос' }];
    composeTurnMessages('SYS', history, 'Ещё вопрос');
    assert.deepEqual(history, [{ role: 'user', content: 'Вопрос' }]);
  });
});

describe('loadResumeHistory (VL-171)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vb-vl171-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Транскрипт в формате session.ts: JSONL, system первым сообщением
  writeFileSync(
    join(dir, 'agent-1792057147372.jsonl'),
    [
      { role: 'system', content: 'СТАРЫЙ SYSTEM' },
      { role: 'user', content: 'Привет' },
      { role: 'assistant', content: 'Здравствуй' },
    ]
      .map((m) => JSON.stringify(m))
      .join('\n') + '\n',
    'utf-8'
  );

  it('возобновление: sessionId и история без system', async () => {
    const { sessionId, history } = await loadResumeHistory(dir, 'agent-1792057147372');
    assert.equal(sessionId, 'agent-1792057147372');
    // system вычищен — свежий systemPrompt собирается на каждом ходе
    assert.deepEqual(history, [
      { role: 'user', content: 'Привет' },
      { role: 'assistant', content: 'Здравствуй' },
    ]);
  });

  it('префикс vb: срезается (формат session-ref бота)', async () => {
    const { sessionId, history } = await loadResumeHistory(dir, 'vb:agent-1792057147372');
    assert.equal(sessionId, 'agent-1792057147372');
    assert.equal(history.length, 2);
  });

  it('несуществующая сессия → throw «не найдена»', async () => {
    await assert.rejects(loadResumeHistory(dir, 'vb:agent-404'), /не найдена/);
  });
});
