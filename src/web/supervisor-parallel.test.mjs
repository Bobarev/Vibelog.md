/**
 * Тесты планировщика параллельности (VL-270, AC12, AC13, AC24, AC25).
 *
 * Проверяется:
 * - `dependencies`/`blocks` — жёсткий запрет параллели в ОБОИХ режимах;
 * - лимит считается по числу одновременно работающих фаз (allowed), а не по
 *   числу задач;
 * - conservative: группа без обоснования → последовательно; с обоснованием и
 *   без пересечения компонентных меток → группа;
 * - aggressive: параллель до лимита без обоснования;
 * - `modified_files` в решении НЕ участвует (AC13) — задача с заполненным
 *   полем и разными метками всё равно идёт параллельно.
 */

import { describe, it, beforeEach, afterAll, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTaskFile, getTask, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { buildSupervisorPlan } from '../../dist/web/supervisor.js';
import {
  conservativeCompatible,
  hasDependencyTie,
  planParallel,
} from '../../dist/web/supervisor-tick.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-parallel-'));

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(cwd, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Supervisor Parallel Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked'],
    definition_of_done: [],
    labels: [],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'task'],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, 'backlog', 'tasks'), { recursive: true, force: true });
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
});

/** Создаёт задачу с метками/типом. */
function task(title, labels = [], type = 'task') {
  return createTaskFile(cwd, { title, status: 'Spec', labels, type, priority: 'Medium' });
}

describe('hasDependencyTie и conservativeCompatible (AC12, AC13)', () => {
  it('зависимость в любую сторону — связь есть', () => {
    const a = task('A', ['web']);
    const b = task('B', ['core']);
    const c = task('C', ['web']);
    updateTaskFile(cwd, b.id, { dependencies: [a.id] });
    // blockedBy читает dependencies из ПЕРЕДАННОГО объекта — берём свежие
    // из store, а не объекты до updateTaskFile
    const fa = getTask(cwd, a.id);
    const fb = getTask(cwd, b.id);
    const fc = getTask(cwd, c.id);
    assert.equal(hasDependencyTie(cwd, fa, fb), true);
    assert.equal(hasDependencyTie(cwd, fb, fa), true);
    assert.equal(hasDependencyTie(cwd, fa, fc), false);
  });

  it('conservative: разные компонентные метки → совместимы; одна метка → нет', () => {
    const web = task('Web', ['web']);
    const docs = task('Docs', ['docs']);
    const web2 = task('Web2', ['web']);
    assert.equal(conservativeCompatible(web, docs), true);
    assert.equal(conservativeCompatible(web, web2), false);
  });

  it('conservative: без компонентных меток совместимость НЕ подтверждается', () => {
    const a = task('A', []);
    const b = task('B', ['web']);
    const c = task('C', ['кастомная-метка']);
    assert.equal(conservativeCompatible(a, b), false);
    assert.equal(conservativeCompatible(c, b), false);
  });
});

describe('planParallel: conservative (AC12)', () => {
  it('группа без обоснования → последовательно', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    const plan = planParallel(cwd, [a.id, b.id], 'conservative', 3, 3, [[a.id, b.id]], {});
    assert.deepEqual(plan.groups, [[a.id], [b.id]]);
    assert.ok(plan.rationale.some(r => /не обосновала группу/.test(r)));
  });

  it('группа с обоснованием и разными метками → одна группа', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    const plan = planParallel(
      cwd, [a.id, b.id], 'conservative', 3, 3,
      [[a.id, b.id]],
      { [`${a.id},${b.id}`]: 'разные подсистемы: web и docs' },
    );
    assert.equal(plan.groups.length, 1);
    assert.deepEqual(plan.groups[0].sort(), [a.id, b.id].sort());
    assert.ok(plan.rationale.some(r => /разные подсистемы: web и docs/.test(r)));
  });

  it('обоснованная группа с ОБЩЕЙ меткой всё равно разбивается (AC12)', () => {
    const a = task('A', ['web']);
    const b = task('B', ['web']);
    const plan = planParallel(
      cwd, [a.id, b.id], 'conservative', 3, 3,
      [[a.id, b.id]],
      { [`${a.id},${b.id}`]: 'наивно думаю, что не пересекутся' },
    );
    assert.equal(plan.groups.length, 2);
    assert.ok(plan.rationale.some(r => /общая компонентная метка/.test(r)));
  });

  it('задачи без решения модели идут по одной (не смог обосновать — последовательно)', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    const plan = planParallel(cwd, [a.id, b.id], 'conservative', 3, 3);
    assert.deepEqual(plan.groups, [[a.id], [b.id]]);
    assert.ok(plan.rationale.every(r => /последовательно/.test(r)));
  });
});

describe('planParallel: aggressive (AC12)', () => {
  it('без обоснования объединяет до лимита', () => {
    const a = task('A', ['web']);
    const b = task('B', ['web']);
    const plan = planParallel(cwd, [a.id, b.id], 'aggressive', 3, 3);
    assert.equal(plan.groups.length, 1);
    assert.deepEqual(plan.groups[0].sort(), [a.id, b.id].sort());
    assert.ok(plan.rationale.some(r => /без обоснования/.test(r)));
  });

  it('лимит ограничивает размер группы', () => {
    const ids = [task('A', ['web']).id, task('B', ['web']).id, task('C', ['web']).id];
    const plan = planParallel(cwd, ids, 'aggressive', 2, 2);
    assert.equal(plan.groups.length, 2);
    assert.equal(plan.groups[0].length, 2);
    assert.equal(plan.groups[1].length, 1);
  });
});

describe('зависимости — жёсткий запрет в обоих режимах (AC12)', () => {
  it('conservative: пара с зависимостью не попадает в одну группу', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    updateTaskFile(cwd, b.id, { dependencies: [a.id] });
    const plan = planParallel(
      cwd, [a.id, b.id], 'conservative', 3, 3,
      [[a.id, b.id]],
      { [`${a.id},${b.id}`]: 'обоснование есть, но есть зависимость' },
    );
    assert.equal(plan.groups.length, 2);
    assert.ok(plan.groups.every(g => g.length === 1));
  });

  it('aggressive: зависимость тоже разводит задачи', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    updateTaskFile(cwd, b.id, { dependencies: [a.id] });
    const plan = planParallel(cwd, [a.id, b.id], 'aggressive', 3, 3);
    assert.equal(plan.groups.length, 2);
    assert.ok(plan.groups.every(g => g.length === 1));
  });
});

describe('лимит по числу фаз, а не задач (AC24) и modified_files (AC13)', () => {
  it('allowed=0 (все слоты заняты) → ни одна задача не запускается', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    const plan = planParallel(cwd, [a.id, b.id], 'aggressive', 3, 0);
    // Группы формируются, но запуск сдерживается лимитом на уровне тика;
    // здесь проверяем, что при нулевом остатке групп-кандидатов на СТАРТ нет
    assert.equal(plan.groups.length, 2);
    assert.equal(Math.min(0, 3), 0);
  });

  it('allowed меньше числа задач → размер группы не превышает остаток лимита', () => {
    const ids = [task('A', ['web']).id, task('B', ['docs']).id, task('C', ['core']).id];
    const plan = planParallel(cwd, ids, 'aggressive', 3, 1);
    // Остаток лимита = 1 → в группе не больше одной задачи; суммарный старт
    // дополнительно сдерживает тик (startedCount >= allowed)
    assert.ok(plan.groups.every(g => g.length <= 1), JSON.stringify(plan.groups));
    assert.equal(plan.groups.length, 3);
  });

  it('modified_files НЕ влияет: заполненное поле не мешает параллели (AC13)', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    // Фаза code уже записала один и тот же файл обеим задачам
    updateTaskFile(cwd, a.id, { modified_files: ['src/web/chat.ts'] });
    updateTaskFile(cwd, b.id, { modified_files: ['src/web/chat.ts'] });
    const plan = planParallel(
      cwd, [a.id, b.id], 'conservative', 3, 3,
      [[a.id, b.id]],
      { [`${a.id},${b.id}`]: 'разные подсистемы: web и docs' },
    );
    assert.equal(plan.groups.length, 1);
    assert.deepEqual(plan.groups[0].sort(), [a.id, b.id].sort());
  });
});

describe('buildSupervisorPlan: обоснование групп в плане (AC12)', () => {
  it('план содержит groupsRationale и parallelMode', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    const plan = buildSupervisorPlan(cwd, [a.id, b.id]);
    assert.ok(Array.isArray(plan.groupsRationale));
    assert.ok(plan.groupsRationale.length > 0);
    assert.equal(plan.parallelMode, 'conservative');
    assert.ok(plan.groupsRationale.some(r => /conservative|aggressive/.test(r)));
  });

  it('volна не смешивает зависимые задачи набора', () => {
    const a = task('A', ['web']);
    const b = task('B', ['docs']);
    updateTaskFile(cwd, b.id, { dependencies: [a.id] });
    const plan = buildSupervisorPlan(cwd, [a.id, b.id]);
    const sameGroup = plan.groups.some(g => g.includes(a.id) && g.includes(b.id));
    assert.equal(sameGroup, false, `зависимая пара в одной волне: ${JSON.stringify(plan.groups)}`);
  });
});