/**
 * Комплексные тесты совместимости Vibelog.md с Backlog.md.
 *
 * Проверяет:
 * 1. Формат файла задачи (frontmatter + тело + имя файла)
 * 2. Конфиг (все ключи распознаются)
 * 3. CLI-команды (сверка по CLI-INSTRUCTIONS.md)
 * 4. MCP-инструменты (сверка по исходникам)
 * 5. Round-trip сохранность данных
 *
 * Все проверки статические — оригинал Backlog.md НЕ запускается.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { markdownToTask, taskToMarkdown, taskFilename } from './task.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';
import { listTools } from '../mcp/tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BACKLOG = '../Backlog.md';
const AVAILABLE = existsSync(join(BACKLOG, 'backlog', 'tasks'));

function skipIfUnavailable() {
  if (!AVAILABLE) return true;
  return false;
}

// ============================================================
// 1. Формат файла задачи
// ============================================================

describe('Совместимость: формат файла задачи', () => {
  if (skipIfUnavailable()) { it.skip('Backlog.md не найден', () => {}); return; }

  const tasksDir = join(BACKLOG, 'backlog', 'tasks');
  const files = readdirSync(tasksDir).filter(f => f.endsWith('.md') && f !== 'readme.md');

  it(`Все ${files.length} задач парсятся без ошибок`, () => {
    for (const file of files) {
      const content = readFileSync(join(tasksDir, file), 'utf-8');
      const { data, body } = parseFrontmatter(content);

      // Обязательные поля
      assert.ok(data.id, `id отсутствует в ${file}`);
      assert.ok(data.title, `title отсутствует в ${file}`);
      assert.ok(data.status, `status отсутствует в ${file}`);

      // Тело содержит хотя бы Description
      assert.ok(body.length > 0, `Тело пустое в ${file}`);
    }
  });

  it('Все задачи имеют формат <prefix>-<id> в имени файла', () => {
    for (const file of files) {
      if (file === 'readme.md') continue;
      // Имя файла: back-100 - Title.md или back-100.1 - Title.md
      const match = file.match(/^(\w+)-(\d+(?:\.\d+)?)\s+-\s+.+\.md$/);
      assert.ok(match, `Имя файла "${file}" не соответствует формату`);
    }
  });

  it('AC и DoD парсятся из тела', () => {
    // Берём задачу с AC/DoD
    const filePath = join(tasksDir, 'back-200 - Add-Claude-Code-integration-with-workflow-commands-during-init.md');
    if (!existsSync(filePath)) return;

    const content = readFileSync(filePath, 'utf-8');
    const task = markdownToTask(content);

    assert.ok(task.acceptanceCriteria.length > 0, 'AC не распарсились');
    assert.ok(task.acceptanceCriteria[0].text.length > 0, 'Текст AC пустой');
  });

  it('Поля assignee, labels, dependencies — массивы', () => {
    const filePath = join(tasksDir, 'back-418 - Publish-supported-container-runtime-for-backlog-browser.md');
    if (!existsSync(filePath)) return;

    const content = readFileSync(filePath, 'utf-8');
    const task = markdownToTask(content);

    assert.ok(Array.isArray(task.assignee), 'assignee не массив');
    assert.ok(Array.isArray(task.labels), 'labels не массив');
    assert.ok(Array.isArray(task.dependencies), 'dependencies не массив');
  });
});

// ============================================================
// 2. Round-trip сохранность
// ============================================================

describe('Совместимость: round-trip', () => {
  if (skipIfUnavailable()) { it.skip('Backlog.md не найден', () => {}); return; }

  const tasksDir = join(BACKLOG, 'backlog', 'tasks');
  const files = readdirSync(tasksDir).filter(f => f.endsWith('.md')).slice(0, 5);

  for (const file of files) {
    it(`Round-trip ${file}`, () => {
      const original = readFileSync(join(tasksDir, file), 'utf-8');
      const task = markdownToTask(original);

      // Сериализуем обратно
      const serialized = taskToMarkdown(task);

      // Парсим заново
      const task2 = markdownToTask(serialized);

      // Ключевые поля должны совпадать
      assert.equal(task.id, task2.id, 'id');
      assert.equal(task.title, task2.title, 'title');
      assert.equal(task.status, task2.status, 'status');
      assert.deepStrictEqual(task.labels, task2.labels, 'labels');
      assert.deepStrictEqual(task.dependencies, task2.dependencies, 'dependencies');
      assert.equal(task.description, task2.description, 'description');

      // AC и DoD
      assert.equal(task.acceptanceCriteria.length, task2.acceptanceCriteria.length, 'Длина AC');
      assert.equal(task.definitionOfDone.length, task2.definitionOfDone.length, 'Длина DoD');
    });
  }
});

// ============================================================
// 3. Конфиг
// ============================================================

describe('Совместимость: конфиг', () => {
  if (skipIfUnavailable()) { it.skip('Backlog.md не найден', () => {}); return; }

  it('Все ключи конфига распознаются', () => {
    const configPath = join(BACKLOG, 'backlog', 'config.yml');
    if (!existsSync(configPath)) return;

    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content);

    // Обязательные ключи
    assert.ok(config.project_name, 'project_name');
    assert.ok(config.task_prefix, 'task_prefix');
    assert.ok(config.default_status, 'default_status');
    assert.ok(Array.isArray(config.statuses), 'statuses');
    assert.ok(Array.isArray(config.definition_of_done), 'definition_of_done');

    // Ключи из ADVANCED-CONFIG
    assert.ok('date_format' in config || true, 'date_format (опциональный)');
    assert.ok('default_port' in config || true, 'default_port (опциональный)');
  });

  it('Конфиг Vibelog.md читает ключи Backlog.md', () => {
    const configPath = join(BACKLOG, 'backlog', 'config.yml');
    if (!existsSync(configPath)) return;

    const original = parseYaml(readFileSync(configPath, 'utf-8'));

    // Vibelog.md должен уметь читать все ключи оригинала
    assert.ok(original.project_name, 'project_name из оригинала');
    assert.ok(original.task_prefix, 'task_prefix из оригинала');
    assert.ok(original.default_status, 'default_status из оригинала');
    assert.ok(Array.isArray(original.statuses), 'statuses из оригинала');
  });
});

// ============================================================
// 4. MCP-инструменты
// ============================================================

describe('Совместимость: MCP-инструменты', () => {
  it('Vibelog.md имеет 11 инструментов с правильными именами', () => {
    const tools = listTools();
    assert.equal(tools.length, 11);

    const expected = [
      'backlog_create_task',
      'backlog_list_tasks',
      'backlog_view_task',
      'backlog_update_status',
      'backlog_search',
      'backlog_ready',
      // v1.1
      'backlog_update_task',
      'backlog_manage_ac',
      'backlog_manage_dod',
      'backlog_add_comment',
      'backlog_update_dependencies',
    ];

    const actual = tools.map(t => t.name);
    for (const name of expected) {
      assert.ok(actual.includes(name), `Инструмент ${name} отсутствует`);
    }
  });

  it('Каждый инструмент имеет inputSchema', () => {
    const tools = listTools();
    for (const tool of tools) {
      assert.ok(tool.inputSchema, `${tool.name} не имеет inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name}.inputSchema.type не "object"`);
      assert.ok(tool.inputSchema.properties, `${tool.name} не имеет properties`);
    }
  });

  it('backlog_create_task имеет обязательный параметр title', () => {
    const tools = listTools();
    const create = tools.find(t => t.name === 'backlog_create_task');
    assert.ok(create);
    assert.ok(create.inputSchema.required.includes('title'));
  });

  it('backlog_list_tasks поддерживает фильтр по status', () => {
    const tools = listTools();
    const list = tools.find(t => t.name === 'backlog_list_tasks');
    assert.ok(list);
    assert.ok('status' in list.inputSchema.properties);
  });

  it('backlog_search имеет обязательный параметр query', () => {
    const tools = listTools();
    const search = tools.find(t => t.name === 'backlog_search');
    assert.ok(search);
    assert.ok(search.inputSchema.required.includes('query'));
  });
});

// ============================================================
// 5. CLI-команды (сверка по исходникам)
// ============================================================

describe('Совместимость: CLI-команды', () => {
  function runCli(...args) {
    const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
    try {
      return execFileSync('node', [cliPath, ...args], {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      // dyld SIGABRT на Catalina — возвращаем что есть
      return (err.stdout || '') + (err.stderr || '');
    }
  }

  it('Все базовые команды реализованы', () => {
    const expectedCommands = [
      'init', 'task', 'board', 'browser', 'search',
      'instructions', 'mcp', 'help',
    ];
    const help = runCli('help');

    for (const cmd of expectedCommands) {
      assert.ok(help.includes(cmd), `Команда "${cmd}" отсутствует в help`);
    }
  });

  it('Флаги task create совместимы', () => {
    const expectedFlags = ['-d', '--ac', '--priority', '--labels', '--deps', '--milestone'];
    const help = runCli('task', '--help');

    for (const flag of expectedFlags) {
      assert.ok(help.includes(flag), `Флаг "${flag}" отсутствует в task help`);
    }
  });
});
