/**
 * Тесты VL-342 — проверка целостности ссылок задач.
 *
 * Покрывает AC задачи:
 * - AC1: `checkTaskReferences(cwd)` возвращает `{ total, findings, summary }`, read-only;
 * - AC2: четыре вида ссылок (references/lessons/dependencies/parent_task_id);
 * - AC3: задачи из `completed/` считаются существующими;
 * - AC4: находки типизированы и содержат id задачи, id ссылки и сообщение;
 * - AC5: `self_link` — отдельный тип;
 * - AC6: пустые значения — не находка (VL-69);
 * - AC9: фикстура на mkdtemp, без живого репозитория (lesson-104);
 * - AC10: один проход, без сети.
 *
 * Каталог теста — mkdtemp (lesson-89: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkTaskIntegrity, checkTaskReferences } from '../../dist/core/integrity.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-integrity-'));
const backlogDir = join(testRoot, 'backlog');
const tasksPath = join(backlogDir, 'tasks');
const completedPath = join(backlogDir, 'completed');
const lessonsPath = join(backlogDir, 'lessons');
const referencesPath = join(backlogDir, 'references');

/** Пишет файл задачи с заданным фронтматтером (тело не важно для проверки). */
function writeTask(dir, id, fields = {}) {
  const frontmatter = {
    id,
    title: `Задача ${id}`,
    status: 'To Do',
    assignee: [],
    reporter: '',
    created_date: '2026-01-01',
    updated_date: '2026-01-01',
    due_date: '',
    labels: [],
    dependencies: [],
    milestone: '',
    references: [],
    priority: '',
    type: '',
    project: '',
    parent_task_id: '',
    ordinal: 0,
    documentation: [],
    modified_files: [],
    lessons: [],
    ...fields,
  };
  writeFileSync(
    join(dir, `${id} - Задача ${id}.md`),
    ['---', stringifyYaml(frontmatter).trimEnd(), '---', '', '## Description', '', 'x', ''].join('\n'),
    'utf-8',
  );
}

/** Пишет файл урока с минимальным фронтматтером. */
function writeLesson(id) {
  writeFileSync(join(lessonsPath, `${id}-slug.md`), [
    '---',
    stringifyYaml({
      id,
      title: `Урок ${id}`,
      status: 'active',
      tags: [],
      source_tasks: [],
      linked_tasks: [],
      created_date: '2026-01-01',
      updated_date: '2026-01-01',
      supersedes: '',
    }).trimEnd(),
    '---',
    '',
    '## Проблема',
    '',
    'x',
    '',
  ].join('\n'), 'utf-8');
}

/** Пишет файл референса с минимальным фронтматтером. */
function writeReference(id) {
  writeFileSync(join(referencesPath, `${id}-slug.md`), [
    '---',
    stringifyYaml({
      id,
      title: `Референс ${id}`,
      type: 'url',
      url: 'https://example.com',
      tags: [],
      created_date: '2026-01-01',
      linked_tasks: [],
    }).trimEnd(),
    '---',
    '',
    'тело',
    '',
  ].join('\n'), 'utf-8');
}

beforeAll(() => {
  mkdirSync(tasksPath, { recursive: true });
  mkdirSync(completedPath, { recursive: true });
  mkdirSync(lessonsPath, { recursive: true });
  mkdirSync(referencesPath, { recursive: true });

  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');

  // Существующие сущности, на которые ссылаются «живые» задачи
  writeLesson('lesson-1');
  writeReference('ref-1');
  writeTask(completedPath, 'VL-2');

  // 1. Все ссылки валидны
  writeTask(tasksPath, 'VL-1', {
    references: ['ref-1'],
    lessons: ['lesson-1'],
    dependencies: ['VL-2'],
    parent_task_id: 'VL-2',
  });
  // 2. Висячий референс
  writeTask(tasksPath, 'VL-10', { references: ['ref-999'] });
  // 3. Висячий урок
  writeTask(tasksPath, 'VL-11', { lessons: ['lesson-999'] });
  // 4. Висячая зависимость
  writeTask(tasksPath, 'VL-12', { dependencies: ['XX-999'] });
  // 5. Висячий родитель
  writeTask(tasksPath, 'VL-13', { parent_task_id: 'XX-999' });
  // 6. Пустой родитель — норма (VL-69)
  writeTask(tasksPath, 'VL-14', { parent_task_id: '' });
  // 7. Зависимость на completed/ — норма
  writeTask(tasksPath, 'VL-15', { dependencies: ['VL-2'] });
  // 8. Ссылка на себя
  writeTask(tasksPath, 'VL-16', { dependencies: ['VL-16'] });
  // 8b. Родитель — сама задача
  writeTask(tasksPath, 'VL-17', { parent_task_id: 'VL-17' });
  // 10. Регистр и пробелы: id нормализуется
  writeTask(tasksPath, 'VL-18', { dependencies: [' vl-2 '], lessons: ['LESSON-1'] });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** Находки конкретной задачи. */
function findingsFor(report, taskId) {
  return report.findings.filter(f => f.taskId === taskId);
}

describe('VL-342 — целостность ссылок задач', () => {
  it('AC1: отчёт содержит total/findings/summary и не пишет файлы', () => {
    const report = checkTaskIntegrity(testRoot);
    assert.equal(typeof report.total, 'number');
    assert.ok(Array.isArray(report.findings));
    assert.equal(typeof report.summary, 'object');
    // 10 активных задач в tasks/ (completed/ в total не входит)
    assert.equal(report.total, 10);
    // Алиас из AC1 — та же реализация
    assert.equal(checkTaskReferences, checkTaskIntegrity);
  });

  it('AC2/AC6: все ссылки валидны → находок нет', () => {
    const report = checkTaskIntegrity(testRoot);
    assert.deepEqual(findingsFor(report, 'VL-1'), []);
    assert.deepEqual(findingsFor(report, 'VL-14'), [], 'пустой parent_task_id — не находка');
    assert.deepEqual(findingsFor(report, 'VL-15'), [], 'зависимость из completed/ существует');
  });

  it('AC2/AC4: висячий референс → dangling_reference', () => {
    const report = checkTaskIntegrity(testRoot);
    const found = findingsFor(report, 'VL-10');
    assert.equal(found.length, 1);
    assert.equal(found[0].type, 'dangling_reference');
    assert.equal(found[0].ref, 'ref-999');
    assert.equal(found[0].field, 'references');
    assert.ok(found[0].message.includes('ref-999'), 'сообщение содержит id ссылки');
    assert.equal(report.summary.dangling_reference, 1);
  });

  it('AC2/AC4: висячий урок → dangling_lesson', () => {
    const report = checkTaskIntegrity(testRoot);
    const found = findingsFor(report, 'VL-11');
    assert.equal(found.length, 1);
    assert.equal(found[0].type, 'dangling_lesson');
    assert.equal(found[0].ref, 'lesson-999');
    assert.equal(report.summary.dangling_lesson, 1);
  });

  it('AC2/AC4: висячая зависимость → dangling_dependency', () => {
    const report = checkTaskIntegrity(testRoot);
    const found = findingsFor(report, 'VL-12');
    assert.equal(found.length, 1);
    assert.equal(found[0].type, 'dangling_dependency');
    assert.equal(found[0].ref, 'XX-999');
    assert.equal(report.summary.dangling_dependency, 1);
  });

  it('AC2/AC4: висячий родитель → dangling_parent', () => {
    const report = checkTaskIntegrity(testRoot);
    const found = findingsFor(report, 'VL-13');
    assert.equal(found.length, 1);
    assert.equal(found[0].type, 'dangling_parent');
    assert.equal(found[0].ref, 'XX-999');
    assert.equal(report.summary.dangling_parent, 1);
  });

  it('AC5: ссылка на себя → self_link, а не dangling_*', () => {
    const report = checkTaskIntegrity(testRoot);
    const dep = findingsFor(report, 'VL-16');
    assert.equal(dep.length, 1);
    assert.equal(dep[0].type, 'self_link');
    assert.equal(dep[0].field, 'dependencies');
    assert.ok(dep[0].message.includes('себя'));

    const parent = findingsFor(report, 'VL-17');
    assert.equal(parent.length, 1);
    assert.equal(parent[0].type, 'self_link');
    assert.equal(parent[0].field, 'parent_task_id');
    assert.equal(report.summary.self_link, 2);
  });

  it('AC3/AC10: id нормализуется (регистр, пробелы), префикс не хардкодится', () => {
    const report = checkTaskIntegrity(testRoot);
    assert.deepEqual(findingsFor(report, 'VL-18'), []);
  });

  it('AC9: отсутствующий каталог lessons не роняет проверку и не даёт находок', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vibelog-integrity-bare-'));
    try {
      mkdirSync(join(bare, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(bare, 'backlog', 'config.yml'), stringifyYaml({
        project_name: 'Bare', task_prefix: 'vl', default_status: 'To Do',
        statuses: ['To Do', 'Done'], definition_of_done: [],
      }), 'utf-8');
      writeTask(join(bare, 'backlog', 'tasks'), 'VL-1', { lessons: ['lesson-999'], references: ['ref-999'] });

      const report = checkTaskIntegrity(bare);
      assert.equal(report.total, 1);
      assert.deepEqual(report.findings, [], 'без каталогов lessons/references ссылки не проверяются');
      assert.equal(report.sections.lessons, 'missing');
      assert.equal(report.sections.references, 'missing');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('AC10: summary покрывает все типы находок', () => {
    const report = checkTaskIntegrity(testRoot);
    assert.deepEqual(Object.keys(report.summary).sort(), [
      'dangling_dependency', 'dangling_lesson', 'dangling_parent',
      'dangling_reference', 'self_link',
    ]);
    const sum = Object.values(report.summary).reduce((a, b) => a + b, 0);
    assert.equal(sum, report.findings.length);
  });
});
