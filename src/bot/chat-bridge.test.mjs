/**
 * Тесты VL-408 — мост «Telegram-бот ↔ веб-чат» (src/bot/chat-bridge.ts).
 *
 * Без сети: подменный LLM (паттерн src/web/chat.test.mjs) и tmp-каталог
 * проекта (правило AGENTS.md: только mkdtemp, фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearAllChatBridges,
  clearChatBridge,
  forwardChatMessage,
  getChatBridge,
  lastAssistantText,
  setChatBridge,
} from '../../dist/bot/chat-bridge.js';
import { loadChatHistory } from '../../dist/web/chat.js';
import { writeTurnState } from '../../dist/web/chat-runs.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-bridge-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(
    join(cwd, 'backlog', 'config.yml'),
    stringifyYaml({
      project_name: 'Chat Bridge Test',
      task_prefix: 'cb',
      default_status: 'To Do',
      statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
      definition_of_done: [],
    }),
    'utf-8',
  );
});

afterAll(() => {
  clearAllChatBridges();
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  clearAllChatBridges();
});

/** Фейковый LLM: один шаг — текст, разбитый на дельты. */
function fakeLlm(script) {
  const state = { calls: 0 };
  return {
    state,
    async streamChat(_messages, _tools, opts) {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      for (const token of step.tokens ?? []) opts?.onToken?.(token);
      return {
        text: step.text ?? '',
        toolCalls: step.toolCalls ?? [],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          total_tokens: 2,
          reasoning_tokens: 0,
        },
        payloadBytes: 0,
        shrinkLevel: 0,
      };
    },
  };
}

/** Создать файл истории треда (чтобы getChatThread не вернул null). */
function seedThread(threadId, messages) {
  const dir = join(cwd, '.vibelog', 'chat-sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${threadId}.jsonl`),
    messages.map((m) => JSON.stringify(m)).join('\n') + '\n',
    'utf-8',
  );
}

describe('режим пересылки (VL-408)', () => {
  it('set/get/clear', () => {
    assert.equal(getChatBridge(1), null);
    setChatBridge(1, 'chat-a');
    assert.equal(getChatBridge(1), 'chat-a');
    // повторный /chat перезаписывает тред
    setChatBridge(1, 'chat-b');
    assert.equal(getChatBridge(1), 'chat-b');
    assert.equal(clearChatBridge(1), true);
    assert.equal(getChatBridge(1), null);
    assert.equal(clearChatBridge(1), false);
  });
});

describe('lastAssistantText (VL-408)', () => {
  it('берёт последнее непустое assistant-сообщение', () => {
    const history = [
      { role: 'user', content: 'вопрос' },
      { role: 'assistant', content: 'первый ответ' },
      { role: 'user', content: 'ещё' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'assistant', content: 'второй ответ' },
    ];
    assert.equal(lastAssistantText(history), 'второй ответ');
  });

  it('нет ответов — пустая строка', () => {
    assert.equal(lastAssistantText([{ role: 'user', content: 'привет' }]), '');
    assert.equal(lastAssistantText([]), '');
  });
});

describe('forwardChatMessage (VL-408)', () => {
  it('сообщение уходит в тред, ответ персоны возвращается', async () => {
    const threadId = 'chat-fwd-1';
    seedThread(threadId, [{ role: 'user', content: 'старое' }]);
    const llm = fakeLlm([{ text: 'ответ персоны', tokens: ['ответ ', 'персоны'] }]);
    const result = await forwardChatMessage(cwd, threadId, 'новый вопрос', { llm });
    assert.deepEqual(result, { text: 'ответ персоны' });
    const history = loadChatHistory(cwd, threadId);
    assert.ok(
      history.some((m) => m.role === 'user' && m.content === 'новый вопрос'),
      'сообщение пользователя не записано в jsonl треда',
    );
    assert.ok(
      history.some((m) => m.role === 'assistant' && m.content === 'ответ персоны'),
      'ответ персоны не записан в jsonl треда',
    );
  });

  it('несуществующий тред — ошибка без создания файла', async () => {
    const result = await forwardChatMessage(cwd, 'chat-missing-xyz', 'привет', {
      llm: fakeLlm([{ text: 'не должно вызваться' }]),
    });
    assert.ok('error' in result);
    assert.match(result.error, /не найден/);
  });

  it('идущий ход (свежий running в sidecar) — отказ без запуска LLM', async () => {
    const threadId = 'chat-busy';
    seedThread(threadId, [{ role: 'user', content: 'старое' }]);
    writeTurnState(cwd, threadId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    });
    const llm = fakeLlm([{ text: 'не должно вызваться' }]);
    const result = await forwardChatMessage(cwd, threadId, 'привет', { llm });
    assert.ok('error' in result);
    assert.match(result.error, /уже идёт ход/);
    assert.equal(llm.state.calls, 0, 'LLM не должен вызываться при идущем ходе');
  });

  it('пауза на approval — прогон отменяется, пользователь получает подсказку про веб', async () => {
    const threadId = 'chat-approval';
    seedThread(threadId, [{ role: 'user', content: 'старое' }]);
    const llm = fakeLlm([
      {
        text: '',
        toolCalls: [
          {
            id: 'tc-1',
            name: 'backlog_create_task',
            arguments: { title: 'Задача' },
          },
        ],
      },
    ]);
    const result = await forwardChatMessage(cwd, threadId, 'создай задачу', { llm });
    assert.ok('needsWeb' in result, `ожидался needsWeb, получено: ${JSON.stringify(result)}`);
    assert.match(result.needsWeb, /веб-интерфейс/);
  });
});
