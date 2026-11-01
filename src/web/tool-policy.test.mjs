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
  makeReadFileTool,
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
      // VL-268: супервизор — запуск фаз/очереди/прогона меняет состояние
      'backlog_trigger_phase', 'backlog_auto_queue', 'backlog_supervisor',
    ]) {
      assert.equal(isWriteOperation(name), true, `${name} должен быть write`);
    }
  });

  it('read-маркеры → false (выполняются без подтверждения)', () => {
    for (const name of [
      'read_file', 'grep_search', 'glob', 'search_files',
      'backlog_search', 'backlog_view_task', 'backlog_list_tasks', 'backlog_ready',
      'milestone_list', 'document_list', 'document_view', 'document_search',
      'reference_list', 'reference_view', 'reference_search',
      'lesson_list', 'lesson_view', 'lesson_search_lessons',
      'project_map', // VL-235: карта проекта — read-only
      'backlog_phase_status', // VL-268: состояние запуска — чистый read
    ]) {
      assert.equal(isWriteOperation(name), false, `${name} должен быть read`);
    }
  });

  it('VL-268: backlog_finish_phase остаётся в CHAT_DISALLOWED_TOOLS', () => {
    assert.ok(CHAT_DISALLOWED_TOOLS.includes('backlog_finish_phase'));
    // Новые инструменты супервизора НЕ открывают обходного пути к завершению фазы
    for (const name of ['backlog_trigger_phase', 'backlog_supervisor']) {
      assert.ok(!CHAT_DISALLOWED_TOOLS.includes(name), `${name} не должен быть запрещён технически`);
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

    // read_file/write_file/search_files присутствуют
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('search_files'), 'search_files (VL-234) должен быть в инструментах чата');
    // search_files — read-операция: без approval-гейта (VL-234)
    assert.equal(isWriteOperation('search_files'), false);

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

  it('VL-257: makeReadFileTool на отсутствующем пути → листинг + похожие пути', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl257-read-'));
    tmpDirs.push(cwd);
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'main.ts'), 'x\n', 'utf8');
    const tool = makeReadFileTool(cwd);
    // Целевой каталог не существует (на macOS ФС регистронезависима, поэтому
    // fuzzy проверяем через отсутствующий подкаталог, а не через другой регистр).
    const out = await tool.handler({ path: 'src/nested/main.ts' });
    assert.match(out.split('\n')[0], /Файл не найден/);
    assert.match(out, /Ближайший существующий каталог: src\//);
    assert.match(out, /Возможно, вы имели в виду:/);
    assert.ok(out.includes('main.ts'), out);
    // Вне проекта — прежняя ошибка без листинга.
    const outside = await tool.handler({ path: '../outside.txt' });
    assert.match(outside, /выходит за пределы проекта/);
    assert.ok(!outside.includes('Ближайший существующий каталог'));
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

  // VL-238: поведенческие правила чата проверяем по коротким устойчивым
  // токенам и лимиту строк, а не по дословной формулировке (принцип VL-130).
  it('VL-238: chat-system.md содержит блок «ответ раньше полноты / тайм-бокс / «Продолжи» = результат»', () => {
    const text = readFileSync(bundledPath, 'utf8');
    assert.match(text, /Режим ответа/, 'заголовок блока правил чата');
    assert.match(text, /Продолжи/, 'правило про «Продолжи» как запрос результата');
    assert.match(text, /не проверено/, 'пометка непроверенного при исчерпании тайм-бокса');
    assert.match(text, /8–10 вызовов/, 'ориентир тайм-бокса');
    // Блок ограничен по размеру: от заголовка до раздела «Инструменты:» ≤ 10 непустых строк
    const lines = text.split('\n');
    const start = lines.findIndex(l => /Режим ответа/.test(l));
    const end = lines.findIndex((l, i) => i > start && /^Инструменты:$/.test(l));
    assert.ok(start >= 0 && end > start, 'блок правил должен идти перед разделом «Инструменты:»');
    const blockLines = lines.slice(start, end).filter(l => l.trim().length > 0);
    assert.ok(blockLines.length <= 11, `блок правил чата должен быть компактным (${blockLines.length} строк)`);
  });
});

describe('VL-250 — read_file веб-чата на JSONL с длинными строками', () => {
  it('offset=1 отдаёт вторую запись, ответ ≤ 8 КБ', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl250-chat-read-'));
    tmpDirs.push(cwd);
    const line = (tag) => tag + ': ' + tag.repeat(9000);
    writeFileSync(
      join(cwd, 's.jsonl'),
      [line('first'), line('second'), line('third')].join('\n'),
      'utf-8',
    );
    const tool = makeReadFileTool(cwd);
    const second = await tool.handler({ path: 's.jsonl', offset: 1, limit: 1 });
    assert.ok(second.startsWith('second:'), `ожидалась вторая запись, получено: ${second.slice(0, 30)}`);
    assert.ok(second.length <= 8192, `длина ${second.length}`);

    // Все три записи достижимы по offset — файл читаем по диапазонам.
    for (const [i, prefix] of ['first:', 'second:', 'third:'].entries()) {
      const out = await tool.handler({ path: 's.jsonl', offset: i, limit: 1 });
      assert.ok(out.startsWith(prefix), `offset=${i}`);
      assert.ok(out.length <= 8192, `длина offset=${i}: ${out.length}`);
    }

    // Обычный файл — прежнее поведение.
    writeFileSync(join(cwd, 'a.txt'), 'alpha\nbeta\nalpha\n', 'utf-8');
    assert.equal(await tool.handler({ path: 'a.txt' }), 'alpha\nbeta\nalpha\n');
    assert.equal(await tool.handler({ path: 'a.txt', offset: 1, limit: 1 }), 'beta');
  });
});

describe('VL-252 — диапазон строк в path для read_file веб-чата', () => {
  // Тот же общий хелпер parseReadPath, что и у агента (AC5): поведение обязано совпадать.
  const line = (tag) => tag + ': ' + tag.repeat(9000);

  it('AC1/AC2: path="файл:1-2" и "файл:2" дают нужные записи, ответ ≤ 8 КБ', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl252-chat-range-'));
    tmpDirs.push(cwd);
    // Короткие записи: проверяем именно выбор диапазона, а не бюджет.
    const rec = (tag) => tag + ': value';
    writeFileSync(
      join(cwd, 'r.jsonl'),
      [rec('first'), rec('second'), rec('third')].join('\n'),
      'utf-8',
    );
    const tool = makeReadFileTool(cwd);
    const two = await tool.handler({ path: 'r.jsonl:1-2' });
    assert.ok(two.startsWith('first:'), `получено: ${two.slice(0, 30)}`);
    assert.ok(two.includes('second:'), 'вторая запись тоже в диапазоне');
    assert.ok(!two.includes('third:'), 'третья запись вне диапазона');
    assert.ok(two.length <= 8192, `длина ${two.length}`);

    const fromSecond = await tool.handler({ path: 'r.jsonl:2' });
    assert.ok(fromSecond.startsWith('second:'), `получено: ${fromSecond.slice(0, 30)}`);
    assert.ok(fromSecond.includes('third:'), 'до конца файла');
    assert.ok(fromSecond.length <= 8192, `длина ${fromSecond.length}`);
  });

  it('AC3: маркер обрезки содержит копируемый path="s.jsonl:…-…"', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl252-chat-tail-'));
    tmpDirs.push(cwd);
    writeFileSync(
      join(cwd, 's.jsonl'),
      Array.from({ length: 40 }, (_, i) => line(`rec${i}`)).join('\n'),
      'utf-8',
    );
    const out = await makeReadFileTool(cwd).handler({ path: 's.jsonl' });
    assert.match(out, /…\[вывод обрезан/);
    assert.match(out, /path="s\.jsonl:\d+-\d+"/);
    assert.ok(!out.includes(cwd), 'путь в маркере относительный');
    assert.ok(out.length <= 8192, `длина ${out.length}`);
  });

  it('AC6: некорректный диапазон — понятная ошибка', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vl252-chat-bad-'));
    tmpDirs.push(cwd);
    writeFileSync(join(cwd, 's.jsonl'), 'one\ntwo\n', 'utf-8');
    const out = await makeReadFileTool(cwd).handler({ path: 's.jsonl:10-5' });
    assert.match(out, /Некорректный диапазон строк/);
  });
});
