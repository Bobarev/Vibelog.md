/**
 * Тесты VL-237 — ранжирование и токенизация поиска задач.
 *
 * Проверяет:
 * - ранжирование: id (точное/подстрока) > title > labels > description;
 * - И-логику по токенам запроса;
 * - минимальную морфологию (усечение основы: «модель» → «моделями»);
 * - детерминированный порядок при равном score;
 * - searchTasksRanked: found — до усечения по limit, tasks — после;
 * - обратную совместимость searchTasks (Task[] с тем же порядком).
 *
 * Временный каталог — только mkdtemp (AGENTS.md, VL-241): параллельные
 * прогоны в разных worktree не должны затирать друг друга.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { searchTasks, searchTasksRanked, tokenizeQuery, stemToken } from '../../dist/core/search.js';
import { createTaskFile } from '../../dist/core/store.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-search-rank-'));
const backlogDir = join(testDir, 'backlog');
const tasksDir = join(backlogDir, 'tasks');

function setup() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Search Rank Test',
    task_prefix: 'sr',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
}

describe('VL-237 — токенизация и основа', () => {
  it('токенизация: пунктуация — разделитель, дефис сохраняется', () => {
    assert.deepEqual(tokenizeQuery('VL-237: поиск, моделями!'), ['vl-237', 'поиск', 'моделями']);
    assert.deepEqual(tokenizeQuery('   '), []);
    assert.deepEqual(tokenizeQuery('deps.ts'), ['deps', 'ts']);
  });

  it('основа: длинные слова усекаются до 5 символов, короткие — нет', () => {
    assert.equal(stemToken('модель'), 'модел');
    assert.equal(stemToken('моделями'), 'модел');
    assert.equal(stemToken('поиск'), 'поиск');
    assert.equal(stemToken('bug'), 'bug');
  });
});

describe('VL-237 — ранжирование поиска задач', () => {
  beforeAll(() => setup());
  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  beforeEach(() => {
    setup();
    // description-совпадение: искомое слово тонет в большом описании
    createTaskFile(testDir, {
      title: 'Случайная задача про кеш',
      status: 'To Do',
      priority: 'Low',
      description: 'длинное описание. '.repeat(200) + ' здесь один раз упомянута модель провайдера',
      created_date: '2026-02-01',
    });
    // title-совпадение
    createTaskFile(testDir, {
      title: 'Управление LLM-моделями и провайдерами',
      status: 'To Do',
      priority: 'High',
      description: '',
      created_date: '2026-01-01',
    });
    // точное совпадение id + морфологическая форма «моделями»
    createTaskFile(testDir, {
      id: 'sr-209',
      title: 'core: модели',
      status: 'To Do',
      priority: 'Medium',
      description: '',
      created_date: '2026-01-15',
    });
  });

  it('совпадение в title ранжируется выше совпадения в description', () => {
    const { tasks } = searchTasksRanked(testDir, { query: 'модель' });
    const titles = tasks.map(t => t.title);
    const titleIdx = titles.indexOf('Управление LLM-моделями и провайдерами');
    const descIdx = titles.indexOf('Случайная задача про кеш');
    assert.ok(titleIdx >= 0 && descIdx >= 0, `оба варианта должны найтись: ${titles.join(' | ')}`);
    assert.ok(titleIdx < descIdx, 'title должен идти раньше description');
  });

  it('точное совпадение id — первым, limit: 1 отдаёт именно её', () => {
    const { tasks, found } = searchTasksRanked(testDir, { query: 'sr-209', limit: 1 });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, 'sr-209');
    assert.ok(found >= 1);
  });

  it('И-логика: задача с одним из токенов не попадает', () => {
    // «модель» есть в title у двух задач, «провайдерами» — только у одной:
    // вторая задача с «провайдера» (основа «прова») тоже подходит, поэтому
    // точную границу проверяем на заведомо несовместимом наборе токенов.
    const none = searchTasksRanked(testDir, { query: 'модель несуществующееслово' });
    assert.equal(none.tasks.length, 0);
    assert.equal(none.found, 0);

    // оба токена в одной задаче — попадает
    const both = searchTasksRanked(testDir, { query: 'модель провайдерами' });
    assert.ok(
      both.tasks.some(t => t.title === 'Управление LLM-моделями и провайдерами'),
      'задача с обоими токенами должна найтись'
    );
    // а задача без второго токена — нет
    assert.ok(!both.tasks.some(t => t.title === 'core: модели'));
  });

  it('морфология: «модель» находит «моделями» через основу', () => {
    const { tasks } = searchTasksRanked(testDir, { query: 'модель' });
    assert.ok(
      tasks.some(t => t.title === 'Управление LLM-моделями и провайдерами'),
      'форма «моделями» должна совпасть с запросом «модель»'
    );
  });

  it('детерминированный порядок при равном score (created_date desc)', () => {
    setup();
    createTaskFile(testDir, {
      title: 'Поиск задач старый', status: 'To Do', priority: 'Low', created_date: '2026-01-01',
    });
    createTaskFile(testDir, {
      title: 'Поиск задач новый', status: 'To Do', priority: 'Low', created_date: '2026-03-01',
    });
    const first = searchTasksRanked(testDir, { query: 'поиск' }).tasks;
    const second = searchTasksRanked(testDir, { query: 'поиск' }).tasks;
    assert.deepEqual(first.map(t => t.id), second.map(t => t.id), 'повторный вызов даёт тот же порядок');
    assert.equal(first.length, 2);
    // при равном score побеждает более свежий created_date
    assert.equal(first[0].title, 'Поиск задач новый');
    assert.equal(first[1].title, 'Поиск задач старый');
  });

  it('found — до усечения по limit, tasks — после', () => {
    const all = searchTasksRanked(testDir, { query: 'модель' });
    const limited = searchTasksRanked(testDir, { query: 'модель', limit: 1 });
    assert.ok(all.found >= 2, `ожидалось ≥2 совпадений, получено ${all.found}`);
    assert.equal(limited.found, all.found);
    assert.equal(limited.tasks.length, 1);
  });

  it('searchTasks (старый API) возвращает Task[] в том же порядке', () => {
    const ranked = searchTasksRanked(testDir, { query: 'модель' }).tasks.map(t => t.id);
    const legacy = searchTasks(testDir, { query: 'модель' }).map(t => t.id);
    assert.deepEqual(legacy, ranked);
  });

  it('фильтры полей продолжают работать вместе с ранжированием', () => {
    const { tasks } = searchTasksRanked(testDir, { query: 'модель', priority: 'High' });
    assert.ok(tasks.every(t => t.priority === 'High'));
  });
});
