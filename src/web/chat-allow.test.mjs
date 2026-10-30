/**
 * Тесты VL-264 — «Always allow» (allow-list треда) в веб-чате.
 *
 * Проверяем серверную семантику: разрешение, сохранённое в
 * `.vibelog/chat-sessions/<threadId>.allow.json`, снимает паузу approval для
 * этого инструмента В ЭТОМ треде; write-инструмент, которого нет в списке,
 * по-прежнему требует подтверждения; разрешение не перетекает в другой тред.
 *
 * Без сети (fakeLlm, паттерн chat.test.mjs) и с tmp-фикстурой backlog.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runChat,
  loadThreadAllowList,
  addThreadAllow,
  removeThreadAllow,
} from '../../dist/web/chat.js';
import { listTasks } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

let cwd;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'vibelog-chat-allow-'));
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Allow Test',
    task_prefix: 'al',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Фейковый LLM: очередь ответов {text?, toolCalls?} (сигнатура как в chat.test.mjs). */
function fakeLlm(script) {
  const state = { calls: 0, tools: [] };
  const llm = {
    async streamChat(messages, tools, opts) {
      state.tools = tools;
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      const tokens = step.tokens ?? (step.text ? step.text.split(/(?<=\s)/) : []);
      for (const t of tokens) opts?.onToken?.(t);
      return {
        text: step.text ?? tokens.join(''),
        toolCalls: step.toolCalls ?? [],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    },
  };
  return { llm, state };
}

async function collect(body, deps) {
  const events = [];
  for await (const ev of runChat(body, cwd, deps)) events.push(ev);
  return events;
}

describe('VL-264: allow-list треда', () => {
  it('always:true → второй вызов того же инструмента идёт без паузы (tool_start.auto)', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-alw-1', name: 'backlog_create_task', arguments: { title: 'Первая ALW' } }] },
      { text: 'Создал.' },
      { toolCalls: [{ id: 'tc-alw-2', name: 'backlog_create_task', arguments: { title: 'Вторая ALW' } }] },
      { text: 'И вторую.' },
    ]);

    // ход 1: пауза на approval
    const ev1 = await collect({ message: 'создай', threadId: 't-alw' }, { llm });
    assert.ok(ev1.some(e => e.type === 'approval'), 'первый вызов спрашивает подтверждение');

    // resume с always → разрешение сохраняется в allow-list треда
    const ev2 = await collect(
      { threadId: 't-alw', approval: { toolCallId: 'tc-alw-1', approved: true, always: true } },
      { llm },
    );
    assert.ok(!ev2.some(e => e.type === 'approval'), 'после always паузы быть не должно');
    assert.ok(listTasks(cwd, {}).some(t => t.title === 'Первая ALW'), 'первый вызов исполнен');
    assert.deepEqual(loadThreadAllowList(cwd, 't-alw'), ['backlog_create_task']);

    // новый ход в том же треде: allow-list читается с диска, паузы нет
    const ev3 = await collect({ message: 'ещё', threadId: 't-alw' }, { llm });
    const start3 = ev3.find(e => e.type === 'tool_start' && e.name === 'backlog_create_task');
    assert.ok(start3, 'вызов пришёл');
    assert.equal(start3.auto, true, 'событие помечено auto');
    assert.ok(!ev3.some(e => e.type === 'approval'), 'allow-list переживает новый POST');
    assert.ok(listTasks(cwd, {}).some(t => t.title === 'Вторая ALW'));
  });

  it('always для одного инструмента не разрешает другой write', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-a-1', name: 'backlog_create_task', arguments: { title: 'A' } }] },
      { text: 'ok' },
      { toolCalls: [{ id: 'tc-b-1', name: 'write_file', arguments: { path: 'x.txt', content: 'y' } }] },
      { text: 'ok2' },
    ]);
    await collect({ message: 'go', threadId: 't-alw2' }, { llm });
    await collect({ threadId: 't-alw2', approval: { toolCallId: 'tc-a-1', approved: true, always: true } }, { llm });
    const ev = await collect({ message: 'ещё', threadId: 't-alw2' }, { llm });
    const approval = ev.find(e => e.type === 'approval');
    assert.ok(approval, 'write_file не разрешён — пауза');
    assert.equal(approval.name, 'write_file');
  });

  it('allow-list не протекает в другой тред', async () => {
    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-c-1', name: 'backlog_create_task', arguments: { title: 'C' } }] },
      { text: 'ok' },
      { toolCalls: [{ id: 'tc-c-2', name: 'backlog_create_task', arguments: { title: 'D' } }] },
      { text: 'ok2' },
    ]);
    await collect({ message: 'go', threadId: 't-alw3' }, { llm });
    await collect({ threadId: 't-alw3', approval: { toolCallId: 'tc-c-1', approved: true, always: true } }, { llm });
    const other = await collect({ message: 'другой тред', threadId: 't-other' }, { llm });
    assert.ok(other.some(e => e.type === 'approval'), 'в другом треде confirm снова спрашивается');
    assert.deepEqual(loadThreadAllowList(cwd, 't-other'), []);
  });

  it('два write-вызова в одном ходе при готовом allow-list идут без пауз', async () => {
    addThreadAllow(cwd, 't-alw5', 'backlog_create_task');
    const { llm } = fakeLlm([
      {
        toolCalls: [
          { id: 'tc-x-1', name: 'backlog_create_task', arguments: { title: 'X1' } },
          { id: 'tc-x-2', name: 'backlog_create_task', arguments: { title: 'X2' } },
        ],
      },
      { text: 'Создал обе.' },
    ]);
    const ev = await collect({ message: 'создай две', threadId: 't-alw5' }, { llm });
    assert.ok(!ev.some(e => e.type === 'approval'), 'allow-list снимает паузу для обоих');
    const starts = ev.filter(e => e.type === 'tool_start');
    assert.equal(starts.length, 2);
    assert.ok(starts.every(s => s.auto === true));
    const titles = listTasks(cwd, {}).map(t => t.title);
    assert.ok(titles.includes('X1') && titles.includes('X2'));
  });

  it('снятие разрешения (removeThreadAllow) возвращает паузу', async () => {
    addThreadAllow(cwd, 't-alw4', 'backlog_create_task');
    assert.deepEqual(loadThreadAllowList(cwd, 't-alw4'), ['backlog_create_task']);
    assert.deepEqual(removeThreadAllow(cwd, 't-alw4', 'backlog_create_task'), []);
    assert.deepEqual(loadThreadAllowList(cwd, 't-alw4'), []);

    const { llm } = fakeLlm([
      { toolCalls: [{ id: 'tc-d-1', name: 'backlog_create_task', arguments: { title: 'E' } }] },
      { text: 'ok' },
    ]);
    const ev = await collect({ message: 'go', threadId: 't-alw4' }, { llm });
    assert.ok(ev.some(e => e.type === 'approval'), 'после отзыва снова спрашиваем');
  });

  it('невалидный threadId не создаёт файл разрешений', () => {
    addThreadAllow(cwd, '../evil', 'backlog_create_task');
    assert.deepEqual(loadThreadAllowList(cwd, '../evil'), []);
  });
});
