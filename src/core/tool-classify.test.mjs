/**
 * Тесты VL-357 (шаг 2) — декларативный вид инструментов.
 *
 * Зачем: до VL-357 вид операции выводился из токенов имени (`manage` → write),
 * и чтение внутри write-инструмента классифицировалось как запись — веб-чат
 * требовал Allow/Deny на `backlog_manage_dod {action:'list'}`, а агентский
 * цикл считал ответ чтения «применённой записью» (VL-351). Теперь вид объявлен
 * в `src/core/tool-kinds.ts`, а тест сверяет таблицу с реестром: новый
 * инструмент без объявления роняет сборку.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { isWriteOperation, isInteractiveTool, declaredToolKind } from '../../dist/core/tool-classify.js';
import { TOOL_KINDS } from '../../dist/core/tool-kinds.js';
import { listTools } from '../../dist/mcp/tools.js';

describe('VL-357 — вид операции объявлен, а не выводится из имени', () => {
  it('каждый MCP-инструмент реестра имеет объявленный вид', () => {
    const missing = listTools()
      .map(t => t.name)
      .filter(name => TOOL_KINDS[name] === undefined);
    assert.deepEqual(missing, [], `инструменты без объявленного вида: ${missing.join(', ')}. Добавь строку в src/core/tool-kinds.ts.`);
  });

  it('backlog_manage_dod/ac: action:list — read, action:add — write', () => {
    for (const name of ['backlog_manage_ac', 'backlog_manage_dod']) {
      assert.equal(isWriteOperation(name, { action: 'list' }), false, `${name} {action:list} — чтение (VL-351)`);
      assert.equal(isWriteOperation(name, { action: 'add' }), true, `${name} {action:add} — запись`);
      assert.equal(isWriteOperation(name, { action: 'check' }), true);
      // Без аргументов — fail-safe write: подтверждение лучше молчаливой записи
      assert.equal(isWriteOperation(name), true, `${name} без аргументов — write`);
    }
  });

  it('локальные файловые инструменты классифицируются по объявлению', () => {
    for (const name of ['read_file', 'grep_search', 'glob', 'search_files', 'agent_session_outline']) {
      assert.equal(isWriteOperation(name), false, `${name} — read`);
      assert.equal(declaredToolKind(name), 'read');
    }
    for (const name of ['write_file', 'edit', 'run_shell_command']) {
      assert.equal(isWriteOperation(name), true, `${name} — write`);
    }
  });

  it('ask_user — интерактивный, не write', () => {
    assert.equal(isInteractiveTool('ask_user'), true);
    assert.equal(isWriteOperation('ask_user'), false);
  });

  it('неизвестное имя — write (fail-safe для внешних MCP-инструментов)', () => {
    assert.equal(declaredToolKind('chrome_devtools__click'), undefined);
    assert.equal(isWriteOperation('chrome_devtools__click'), true);
  });

  it('маркеры имени больше не участвуют: имя с токеном manage без объявления — write по fail-safe', () => {
    // Раньше `some_manage_thing` был write из-за маркера; теперь — тоже write,
    // но по fail-safe (имя вне декларации), а не из-за токена.
    assert.equal(isWriteOperation('some_manage_thing'), true);
    // А объявленный read с «write-токеном» в имени остаётся read
    assert.equal(isWriteOperation('milestone_list'), false);
  });
});
