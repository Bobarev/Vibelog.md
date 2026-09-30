/**
 * Тесты совместимости с реальными файлами Backlog.md.
 *
 * Читает задачи из /Users/bob/Dev/ton/ai/Backlog.md/backlog/
 * и проверяет, что我们的 парсер корректно их обрабатывает.
 *
 * Статический тест — оригинал Backlog.md не запускается (Catalina).
 * Пропускается, если директория оригинала не найдена.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { markdownToTask, taskToMarkdown, taskFilename } from './task.mjs';
import { parseYaml, stringifyYaml } from './yaml.mjs';

const BACKLOG_ROOT = '/Users/bob/Dev/ton/ai/Backlog.md';
const TASKS_DIR = join(BACKLOG_ROOT, 'backlog', 'tasks');
const COMPLETED_DIR = join(BACKLOG_ROOT, 'backlog', 'completed');

// Пропускаем все тесты, если оригинал Backlog.md недоступен
const BACKLOG_EXISTS = existsSync(TASKS_DIR);

describe('Совместимость с Backlog.md — frontmatter', () => {
  if (!BACKLOG_EXISTS) {
    it.skip('Оригинал Backlog.md не найден', () => {});
    return;
  }

  const files = readdirSync(TASKS_DIR).filter(f => f.endsWith('.md')).slice(0, 10);

  for (const file of files) {
    it(`Парсинг ${file}`, () => {
      const content = readFileSync(join(TASKS_DIR, file), 'utf-8');
      const { data, body } = parseFrontmatter(content);

      // Проверяем обязательные поля
      assert.ok(data.id, `Поле id отсутствует в ${file}`);
      assert.ok(data.title, `Поле title отсутствует в ${file}`);
      assert.ok(data.status, `Поле status отсутствует в ${file}`);

      // Проверяем, что тело не пустое
      assert.ok(body.length > 0, `Тело пустое в ${file}`);

      // Проверяем, что тело содержит хотя бы один заголовок секции
      assert.ok(
        body.includes('## Description') || body.includes('## ') || body.includes('# '),
        `Тело не содержит заголовков в ${file}`
      );
    });
  }
});

describe('Совместимость с Backlog.md — completed задачи', () => {
  if (!BACKLOG_EXISTS) {
    it.skip('Оригинал Backlog.md не найден', () => {});
    return;
  }

  const files = readdirSync(COMPLETED_DIR).filter(f => f.endsWith('.md')).slice(0, 10);

  for (const file of files) {
    it(`Парсинг completed/${file}`, () => {
      const content = readFileSync(join(COMPLETED_DIR, file), 'utf-8');
      const { data } = parseFrontmatter(content);

      assert.ok(data.id, `Поле id отсутствует в ${file}`);
      assert.ok(data.status, `Поле status отсутствует в ${file}`);
      // Завершённые задачи должны иметь статус Done
      assert.ok(
        data.status === 'Done' || data.status === 'Completed',
        `Статус "${data.status}" не является завершённым в ${file}`
      );
    });
  }
});

describe('Совместимость с Backlog.md — round-trip', () => {
  if (!BACKLOG_EXISTS) {
    it.skip('Оригинал Backlog.md не найден', () => {});
    return;
  }

  // Берём 3 реальные задачи и проверяем round-trip
  const files = readdirSync(TASKS_DIR).filter(f => f.endsWith('.md')).slice(0, 3);

  for (const file of files) {
    it(`Round-trip ${file}: markdownToTask → taskToMarkdown`, () => {
      const content = readFileSync(join(TASKS_DIR, file), 'utf-8');
      const task = markdownToTask(content);

      // Проверяем, что задача распарсилась
      assert.ok(task.id, 'id пустой');
      assert.ok(task.title, 'title пустой');

      // Сериализуем обратно
      const serialized = taskToMarkdown(task);

      // Парсим заново
      const task2 = markdownToTask(serialized);

      // Сравниваем ключевые поля
      assert.equal(task.id, task2.id, 'id не совпадает после round-trip');
      assert.equal(task.title, task2.title, 'title не совпадает после round-trip');
      assert.equal(task.status, task2.status, 'status не совпадает после round-trip');
      assert.deepStrictEqual(task.labels, task2.labels, 'labels не совпадают');
      assert.deepStrictEqual(task.dependencies, task2.dependencies, 'dependencies не совпадают');
    });
  }
});

describe('Совместимость с Backlog.md — имя файла', () => {
  if (!BACKLOG_EXISTS) {
    it.skip('Оригинал Backlog.md не найден', () => {});
    return;
  }

  it('taskFilename генерирует имена в формате Backlog.md', () => {
    // Проверяем на нескольких реальных примерах
    const examples = [
      { id: 'back-100', title: 'Add embedded web server', expected: 'back-100 - Add-embedded-web-server.md' },
      { id: 'BACK-200', title: 'Add Claude Code integration', expected: 'BACK-200 - Add-Claude-Code-integration.md' },
    ];
    for (const { id, title, expected } of examples) {
      const name = taskFilename({ id, title });
      assert.equal(name, expected, `Имя файла для ${id} не совпадает`);
    }
  });
});

describe('Совместимость с Backlog.md — YAML-парсер', () => {
  if (!BACKLOG_EXISTS) {
    it.skip('Оригинал Backlog.md не найден', () => {});
    return;
  }

  it('Парсинг конфига backlog/config.yml', () => {
    const configPath = join(BACKLOG_ROOT, 'backlog', 'config.yml');
    if (!existsSync(configPath)) return;

    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content);

    assert.ok(config.project_name, 'project_name отсутствует');
    assert.ok(config.task_prefix, 'task_prefix отсутствует');
    assert.ok(Array.isArray(config.statuses), 'statuses не массив');
    assert.ok(config.statuses.length > 0, 'statuses пуст');
  });
});
