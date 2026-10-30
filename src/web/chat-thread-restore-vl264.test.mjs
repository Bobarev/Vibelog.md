/**
 * Тесты VL-264 — восстановление истории треда под новый рендер tool-вызовов:
 * - висящий approval восстанавливается для ЛЮБОГО write-инструмента
 *   (не только backlog_create_task) — иначе кнопки карточки после
 *   перезагрузки молча не срабатывали;
 * - allow-list треда помечает разрешённые заранее вызовы
 *   (`providerMetadata.vibelog.auto`) — карточка показывает «разрешено заранее»;
 * - клиентский fallback-классификатор `isWriteTool` совпадает с серверным
 *   `isWriteOperation` на выборке имён (риск R3 плана: расхождение списков
 *   маркеров превратило бы write-карточку в read-строку).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { historyToMessages } from '../../web/src/lib/chat-threads.ts';
import { isWriteTool, primaryArg, formatResult, toolLabel } from '../../web/src/components/chat/tool-meta.ts';
import { isWriteOperation } from '../../dist/web/tool-policy.js';

/** Достаёт tool-call part'ы из восстановленных сообщений. */
function parts(out) {
  const result = [];
  for (const message of out) {
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) if (part.type === 'tool-call') result.push(part);
  }
  return result;
}

describe('historyToMessages + allow-list (VL-264)', () => {
  it('висящий approval восстанавливается для write_file (не только create)', () => {
    const out = historyToMessages([
      { role: 'user', content: 'запиши' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-w1', name: 'write_file', arguments: { path: 'a.txt' } }] },
    ]);
    const [part] = parts(out);
    assert.ok(part, 'tool-call part восстановлен');
    assert.deepEqual(part.approval, { id: 'tc-w1' });
  });

  it('висящий approval восстанавливается для backlog_update_task', () => {
    const out = historyToMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-u1', name: 'backlog_update_task', arguments: { id: 'VL-1' } }] },
    ]);
    const [part] = parts(out);
    assert.deepEqual(part.approval, { id: 'tc-u1' });
  });

  it('read-инструмент без результата approval НЕ получает (строка «Прервано»)', () => {
    const out = historyToMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-r1', name: 'read_file', arguments: { path: 'a.txt' } }] },
    ]);
    const [part] = parts(out);
    assert.equal(part.approval, undefined);
  });

  it('allowList помечает часть как auto (пометка «разрешено заранее»)', () => {
    const out = historyToMessages(
      [
        { role: 'assistant', content: null, tool_calls: [{ id: 'tc-w2', name: 'write_file', arguments: { path: 'b.txt' } }] },
        { role: 'tool', tool_call_id: 'tc-w2', content: JSON.stringify({ ok: true, applied: ['path'] }) },
      ],
      { allowList: ['write_file'] },
    );
    const [part] = parts(out);
    assert.deepEqual(part.providerMetadata, { vibelog: { auto: true } });
    assert.equal(part.isError, undefined);
  });

  it('без allowList пометки auto нет', () => {
    const out = historyToMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-w3', name: 'write_file', arguments: { path: 'c.txt' } }] },
      { role: 'tool', tool_call_id: 'tc-w3', content: JSON.stringify({ ok: true }) },
    ]);
    const [part] = parts(out);
    assert.equal(part.providerMetadata, undefined);
  });

  it('{ok:false} контракта VL-262 → isError', () => {
    const out = historyToMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc-w4', name: 'write_file', arguments: { path: 'd.txt' } }] },
      { role: 'tool', tool_call_id: 'tc-w4', content: JSON.stringify({ ok: false, denied: true }) },
    ]);
    const [part] = parts(out);
    assert.equal(part.isError, true);
  });
});

describe('isWriteTool — паритет с серверным isWriteOperation (R3)', () => {
  const names = [
    'read_file', 'write_file', 'search_files', 'grep_search', 'glob', 'project_map',
    'backlog_search', 'backlog_view_task', 'backlog_list_tasks', 'backlog_ready',
    'backlog_create_task', 'backlog_update_task', 'backlog_add_comment',
    'backlog_manage_ac', 'backlog_manage_dod', 'backlog_update_status',
    'backlog_update_dependencies', 'backlog_finish_phase', 'document_create',
    'document_update', 'milestone_add', 'milestone_rename', 'milestone_remove',
    'reference_add', 'reference_sync', 'lesson_create', 'lesson_update',
  ];

  it('решения совпадают на всех известных инструментах', () => {
    for (const name of names) {
      assert.equal(isWriteTool(name), isWriteOperation(name), `расхождение по ${name}`);
    }
  });
});

describe('tool-meta: подписи, чипы, форматирование', () => {
  it('primaryArg берёт первый непустой ключевой аргумент', () => {
    assert.equal(primaryArg({ query: 'поиск' }), 'поиск');
    assert.equal(primaryArg({ path: 'src/a.ts', query: '' }), 'src/a.ts');
    assert.equal(primaryArg({ id: 'VL-1' }), 'VL-1');
    assert.equal(primaryArg({}), '');
    assert.equal(primaryArg(null), '');
  });

  it('formatResult: контракт applied/skipped, error, строка', () => {
    assert.equal(formatResult(JSON.stringify({})), '{}');
    assert.ok(formatResult({ ok: true, applied: ['path'], skipped: ['content'] }).includes('применено: path'));
    assert.equal(formatResult({ error: 'нет файла' }), 'нет файла');
    assert.equal(formatResult('просто текст'), 'просто текст');
  });

  it('toolLabel знает write-инструменты, незнакомый отдаёт имя', () => {
    assert.equal(toolLabel('backlog_create_task'), 'Создал задачу');
    assert.equal(toolLabel('unknown_tool'), 'unknown_tool');
  });
});
