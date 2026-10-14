/**
 * Тесты совместимости с реальными файлами Backlog.md.
 *
 * Читает задачи из backlog/references/data/Backlog.md/backlog/
 * и проверяет, что наш парсер корректно их обрабатывает.
 *
 * Дублирующие проверки парсинга tasks/, round-trip и конфига удалены
 * (аудит VL-131): они покрыты строже в compat-full.test.mjs
 * (все задачи вместо slice(0,10), больший набор полей round-trip,
 * полный набор ключей конфига). Здесь — только уникальные кейсы:
 * completed/ задачи и имя файла в формате оригинала.
 *
 * Статический тест — оригинал Backlog.md не запускается (Catalina).
 * Пропускается, если директория оригинала не найдена.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter } from '../../dist/core/frontmatter.js';
import { taskFilename } from '../../dist/core/task.js';

const BACKLOG_ROOT = 'backlog/references/data/Backlog.md';
const TASKS_DIR = join(BACKLOG_ROOT, 'backlog', 'tasks');
const COMPLETED_DIR = join(BACKLOG_ROOT, 'backlog', 'completed');

// Пропускаем все тесты, если оригинал Backlog.md недоступен
const BACKLOG_EXISTS = existsSync(TASKS_DIR);

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
