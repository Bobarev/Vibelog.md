/**
 * Тесты VL-219 — политика инструментов веб-чата (src/web/tool-policy.ts).
 *
 * Проверяет:
 * - isWriteOperation: write-маркеры → true, read-маркеры → false,
 *   неизвестное имя → true (fail-safe), локальные файловые инструменты;
 * - chatToolDefs: все MCP-инструменты минус CHAT_DISALLOWED_TOOLS + read_file
 *   + write_file; схемы совпадают с реестром listTools();
 * - loadChatSystemTemplate: переопределение проектом имеет приоритет,
 *   удаление обоих файлов → понятная ошибка;
 * - встроенный шаблон содержит описания read_file/write_file/
 *   backlog_update_task/backlog_create_task.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isWriteOperation,
  chatToolDefs,
  loadChatSystemTemplate,
  CHAT_DISALLOWED_TOOLS,
} from '../../dist/web/tool-policy.js';
import { listTools } from '../../dist/mcp/tools.js';

const bundledPath = fileURLToPath(new URL('../../templates/prompts/chat-system.md', import.meta.url));

const tmpDirs = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('VL-219 — isWriteOperation (по природе операции)', () => {
  it('write-маркеры → true', () => {
    for (const name of [
      'write_file', 'edit', 'run_shell_command',
      'backlog_create_task', 'backlog_update_task', 'backlog_update_status',
      'backlog_manage_ac', 'backlog_add_comment', 'backlog_finish_phase',
      'milestone_add', 'milestone_remove', 'milestone_rename', 'milestone_archive',
      'document_create', 'document_update',
      'reference_add', 'reference_update', 'reference_remove', 'reference_sync',
      'lesson_create', 'lesson_update', 'lesson_supersede', 'reference_link',
    ]) {
      assert.equal(isWriteOperation(name), true, `${name} должен быть write`);
    }
  });

  it('read-маркеры → false (выполняются без подтверждения)', () => {
    for (const name of [
      'read_file', 'grep_search', 'glob',
      'backlog_search', 'backlog_view_task', 'backlog_list_tasks', 'backlog_ready',
      'milestone_list', 'document_list', 'document_view', 'document_search',
      'reference_list', 'reference_view', 'reference_search',
      'lesson_list', 'lesson_view', 'lesson_search_lessons',
    ]) {
      assert.equal(isWriteOperation(name), false, `${name} должен быть read`);
    }
  });

  it('неизвестное имя → true (fail-safe: подтверждение лучше молчаливой записи)', () => {
    assert.equal(isWriteOperation('some_future_tool'), true);
    assert.equal(isWriteOperation('new_mcp_thing'), true);
  });
});

describe('VL-219 — chatToolDefs', () => {
  it('содержит все MCP-инструменты кроме CHAT_DISALLOWED_TOOLS + read_file + write_file', () => {
    const defs = chatToolDefs('/tmp/vl219-nonexistent-cwd');
    const names = defs.map(d => d.name);

    // Запрещённые отсутствуют (технический фильтр, вариант (c))
    for (const dis of CHAT_DISALLOWED_TOOLS) {
      assert.ok(!names.includes(dis), `${dis} не должен попасть в инструменты чата`);
    }

    // read_file/write_file присутствуют
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));

    // Остальные MCP-инструменты присутствуют
    for (const t of listTools()) {
      if (CHAT_DISALLOWED_TOOLS.includes(t.name)) continue;
      assert.ok(names.includes(t.name), `${t.name} должен быть в инструментах чата`);
    }

    // Схемы совпадают с реестром (дублирования нет)
    const readDef = defs.find(d => d.name === 'read_file');
    assert.ok(readDef.inputSchema.required.includes('path'), 'read_file: path обязателен');
    const writeDef = defs.find(d => d.name === 'write_file');
    assert.ok(writeDef.inputSchema.required.includes('content'), 'write_file: content обязателен');
  });

  it('read_file — read (без подтверждения), write_file — write (с подтверждением)', () => {
    assert.equal(isWriteOperation('read_file'), false);
    assert.equal(isWriteOperation('write_file'), true);
  });

  // VL-233: листинг каталога отдаётся и через веб-путь чата (общий хелпер).
  it('VL-233: makeReadFileTool на каталоге → листинг с «/», а не ошибка', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl233-read-'));
    tmpDirs.push(cwd);
    mkdirSync(join(cwd, 'src', 'agent'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'a.txt'), 'x\n', 'utf8');
    const tool = chatToolDefs(cwd).find(d => d.name === 'read_file');
    const out = await tool.handler({ path: 'src' });
    assert.match(out, /Листинг каталога src\//);
    assert.ok(out.includes('agent/'), 'подкаталог с суффиксом /');
    assert.ok(out.includes('a.txt'));
    const root = await tool.handler({ path: '.' });
    assert.match(root, /Листинг каталога \.\//);
  });
});

describe('VL-219 — loadChatSystemTemplate', () => {
  it('переопределение проектом имеет приоритет над встроенным', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl219-chat-sys-'));
    tmpDirs.push(cwd);
    mkdirSync(join(cwd, '.vibelog', 'prompts'), { recursive: true });
    writeFileSync(
      join(cwd, '.vibelog', 'prompts', 'chat-system.md'),
      'ПРОЕКТНЫЙ ШАБЛОН ЧАТА',
      'utf8',
    );
    const text = loadChatSystemTemplate(cwd);
    assert.equal(text, 'ПРОЕКТНЫЙ ШАБЛОН ЧАТА');
    // Встроенный шаблон существует, но проектный приоритетнее
    assert.ok(existsSync(bundledPath), 'встроенный шаблон должен существовать');
  });

  it('без переопределения — встроенный шаблон', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl219-chat-sys-'));
    tmpDirs.push(cwd);
    const text = loadChatSystemTemplate(cwd);
    assert.equal(text, readFileSync(bundledPath, 'utf8').trimEnd());
  });

  it('удаление обоих файлов → понятная ошибка «Шаблон chat-system.md не найден»', () => {
    // Временный каталог проекта + подмена пути встроенного шаблона невозможна
    // извне (путь фиксирован относительно модуля) — поэтому проверяем, что
    // отсутствие ТОЛЬКО проектного файла не падает (встроенный есть),
    // а fail-closed срабатывает, когда нет ни того, ни другого. Для второго
    // случая переименовываем встроенный шаблон временно.
    const cwd = mkdtempSync(join(tmpdir(), 'vl219-chat-sys-'));
    tmpDirs.push(cwd);
    const backup = `${bundledPath}.vl219-backup`;
    renameSync(bundledPath, backup);
    try {
      assert.throws(
        () => loadChatSystemTemplate(cwd),
        /Шаблон chat-system\.md не найден/,
        'fail-closed ошибка при отсутствии обоих файлов',
      );
    } finally {
      renameSync(backup, bundledPath);
    }
  });

  it('встроенный шаблон содержит описания 4 инструментов (AC8)', () => {
    const text = readFileSync(bundledPath, 'utf8');
    assert.ok(text.includes('read_file'), 'описание read_file');
    assert.ok(text.includes('write_file'), 'описание write_file');
    assert.ok(text.includes('backlog_update_task'), 'описание backlog_update_task');
    assert.ok(text.includes('backlog_create_task'), 'описание backlog_create_task');
    // Общее правило read-сразу / write-с-подтверждением
    assert.ok(text.includes('подтверждени'), 'правило подтверждения write-операций');
    // Текст запрета destructive-операций (вариант (c))
    assert.ok(text.includes('Запрещены в чате'), 'текст запрета CHAT_DISALLOWED_TOOLS');
  });
});