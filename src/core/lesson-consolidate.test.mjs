/**
 * Тесты VL-400 — консолидация корпуса lessons (детерминированно, без LLM).
 *
 * Покрывает AC задачи:
 * - AC4: план (кластеры правил → строка AGENTS.md, пары дублей → supersede,
 *   пустые тела) и CLI `vibelog lesson consolidate` без записи;
 * - AC5: MCP `lesson_consolidate` — read-only по умолчанию, запись только по
 *   явным спискам ID/строк;
 * - AC7: dry-run/apply и идемпотентность повторного apply (дедуп строк
 *   AGENTS.md, повторный supersede не дублирует).
 *
 * Каталог теста — mkdtemp (lesson-89: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearPhaseEnv } from '../test-env.mjs';

import {
  createLesson, lessonToMarkdown, createLessonFile, getLesson,
} from '../../dist/core/lesson.js';
import {
  buildConsolidationPlan, applyConsolidation, isImperativeTitle,
  formatConsolidationMarkdown, AGENTS_MD_MARKER,
} from '../../dist/core/lesson-consolidate.js';
import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-lesson-consolidate-'));
const backlogDir = join(testRoot, 'backlog');
const lessonsPath = join(backlogDir, 'lessons');

/** Фазовый env агентской сессии на время файла (VL-374, in-process handleToolCall). */
let restorePhaseEnv;

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  mkdirSync(lessonsPath, { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Consolidate Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(testRoot, { recursive: true, force: true });
});

/** Пишет lesson-файл напрямую (тело — заполненный markdown). */
function writeLesson(id, fields, body) {
  const lesson = createLesson({
    id,
    title: fields.title || id,
    status: fields.status || 'active',
    tags: fields.tags || [],
    source_tasks: fields.source_tasks || [],
    linked_tasks: fields.linked_tasks || [],
    created_date: fields.created_date || '2026-01-01',
    updated_date: fields.updated_date || '2026-01-01',
    supersedes: fields.supersedes || '',
    last_verified: fields.last_verified || '',
    applies_to: fields.applies_to || [],
    kind: fields.kind ?? null,
  });
  writeFileSync(
    join(lessonsPath, `${id}.md`),
    lessonToMarkdown(lesson, body ?? `## Проблема\n\nшум ${id}\n\n## Решение\n\nшум ${id}\n`),
    'utf-8',
  );
  return lesson;
}

describe('VL-400 — эвристика императивного заголовка', () => {
  it('императив на «-й» и «Не …» распознаётся, существительное — нет', () => {
    assert.equal(isImperativeTitle('Проверяй git-политику по факту индексации'), true);
    assert.equal(isImperativeTitle('Не коммить симлинк node_modules'), true);
    assert.equal(isImperativeTitle('Модель задачи Vibelog.md'), false);
    assert.equal(isImperativeTitle(''), false);
  });
});

describe('VL-400 — план консолидации (AC4)', () => {
  it('кластер из дублей: канон — свежий, остальные в supersede; пустое тело видно', () => {
    // Два почти одинаковых урока-правила → finding duplicate_of
    writeLesson('lesson-701', {
      title: 'Проверяй git-политику по факту индексации, а не через check-ignore',
      tags: ['gitignore'], kind: 'rule', updated_date: '2026-01-01',
    });
    writeLesson('lesson-702', {
      title: 'Проверяй git-политику по факту индексации, а не через check-ignore',
      tags: ['gitignore'], kind: 'rule', updated_date: '2026-05-01',
    });
    // Урок-пустышка (тело-скелет)
    writeLesson('lesson-703', { title: 'Пустышка консолидации', tags: ['x'] }, '');

    const plan = buildConsolidationPlan(testRoot);
    assert.ok(plan.total >= 3, `всего уроков: ${plan.total}`);
    const cluster = plan.ruleClusters.find(c => c.lessons.includes('lesson-701'));
    assert.ok(cluster, `кластер с lesson-701 не найден: ${JSON.stringify(plan.ruleClusters)}`);
    assert.equal(cluster.canonical, 'lesson-702', 'канон — более свежий урок');
    assert.ok(cluster.supersede.includes('lesson-701'), 'старый урок — кандидат в supersede');
    assert.ok(cluster.proposedLine.length > 0, 'предложена строка для AGENTS.md');

    const pair = plan.duplicatePairs.find(p => p.a === 'lesson-701' || p.b === 'lesson-701');
    assert.ok(pair, 'пара дублей найдена');
    assert.equal(pair.canonical, 'lesson-702');
    assert.equal(pair.supersede, 'lesson-701');

    assert.ok(plan.emptyBodies.some(e => e.id === 'lesson-703'), 'пустое тело в плане');
    assert.ok(plan.summary.ruleClusters >= 1);
    assert.ok(plan.summary.duplicatePairs >= 1);
  });

  it('formatConsolidationMarkdown: сводка и подсказка про явное применение', () => {
    const text = formatConsolidationMarkdown(buildConsolidationPlan(testRoot));
    assert.match(text, /Консолидация lessons/);
    assert.match(text, /--apply-supersede/);
    assert.match(text, /Ничего не записано/);
  });

  it('план read-only: файлы уроков не меняются', () => {
    const before = readFileSync(join(lessonsPath, 'lesson-701.md'), 'utf-8');
    buildConsolidationPlan(testRoot);
    assert.equal(readFileSync(join(lessonsPath, 'lesson-701.md'), 'utf-8'), before);
  });
});

describe('VL-400 — применение по явным спискам (AC4, AC7)', () => {
  it('applyConsolidation: supersede по канону + строка в AGENTS.md, повтор идемпотентен', () => {
    const applied = applyConsolidation(testRoot, {
      supersede: ['lesson-702'],
      appendAgentsMd: ['Проверяй git-политику по факту индексации'],
    });
    assert.deepEqual(applied.superseded, [{ oldId: 'lesson-701', newId: 'lesson-702' }]);
    assert.equal(getLesson(testRoot, 'lesson-701').lesson.status, 'superseded');
    assert.equal(getLesson(testRoot, 'lesson-702').lesson.supersedes, 'lesson-701');
    assert.deepEqual(applied.appendedLines, ['Проверяй git-политику по факту индексации']);

    const agentsMd = readFileSync(join(testRoot, 'AGENTS.md'), 'utf-8');
    assert.ok(agentsMd.includes(AGENTS_MD_MARKER), 'секция-маркер создана');
    assert.ok(agentsMd.includes('- Проверяй git-политику по факту индексации'), 'строка добавлена буллетом');

    // Повтор: строка уже есть (дедуп), supersede уже применён
    const again = applyConsolidation(testRoot, {
      supersede: ['lesson-702'],
      appendAgentsMd: ['проверяй git-политику по факту индексации'],
    });
    assert.deepEqual(again.appendedLines, [], 'повтор не дублирует строку (нормализация регистра)');
    assert.deepEqual(again.skippedLines, ['проверяй git-политику по факту индексации']);
    const agentsMd2 = readFileSync(join(testRoot, 'AGENTS.md'), 'utf-8');
    assert.equal(
      agentsMd2.split('\n').filter(l => /проверяй git-политику/i.test(l)).length,
      1,
      'строка в AGENTS.md ровно одна',
    );
  });

  it('applyConsolidation: неизвестный ID попадает в notFound, ничего не пишется', () => {
    const res = applyConsolidation(testRoot, { supersede: ['lesson-999'] });
    assert.deepEqual(res.superseded, []);
    assert.deepEqual(res.notFound, ['lesson-999']);
  });

  it('applyConsolidation: не-канон уходит в superseded каноном кластера', () => {
    writeLesson('lesson-711', {
      title: 'Собирай env спавна в тестах через testSpawnEnv, он снимает VIBELOG_CWD',
      tags: ['env'], kind: 'rule', updated_date: '2026-01-01',
    });
    writeLesson('lesson-712', {
      title: 'Собирай env спавна в тестах через testSpawnEnv, он снимает VIBELOG_CWD',
      tags: ['env'], kind: 'rule', updated_date: '2026-06-01',
    });
    const res = applyConsolidation(testRoot, { supersede: ['lesson-711'] });
    assert.deepEqual(res.superseded, [{ oldId: 'lesson-711', newId: 'lesson-712' }]);
    assert.equal(getLesson(testRoot, 'lesson-711').lesson.status, 'superseded');
  });
});

describe('VL-400 — MCP lesson_consolidate (AC5)', () => {
  it('инструмент зарегистрирован и объявлен read', () => {
    assert.ok(listTools().some(t => t.name === 'lesson_consolidate'));
  });

  it('по умолчанию read-only: возвращает план, файлы не меняются', async () => {
    const before = readFileSync(join(lessonsPath, 'lesson-703.md'), 'utf-8');
    const raw = await handleToolCall('lesson_consolidate', {}, testRoot);
    const plan = JSON.parse(raw);
    assert.equal(typeof plan.total, 'number');
    assert.ok(Array.isArray(plan.ruleClusters));
    assert.ok(Array.isArray(plan.duplicatePairs));
    assert.ok(Array.isArray(plan.emptyBodies));
    assert.equal(plan.applied, undefined, 'без явных списков записи нет');
    assert.equal(readFileSync(join(lessonsPath, 'lesson-703.md'), 'utf-8'), before);
  });

  it('валидация аргументов на границе слоя', async () => {
    assert.match(await handleToolCall('lesson_consolidate', { threshold: 'много' }, testRoot), /threshold/);
    assert.match(await handleToolCall('lesson_consolidate', { threshold: 2 }, testRoot), /threshold/);
    assert.match(await handleToolCall('lesson_consolidate', { supersede: 'lesson-1' }, testRoot), /supersede/);
    assert.match(await handleToolCall('lesson_consolidate', { appendAgentsMd: 'x' }, testRoot), /appendAgentsMd/);
  });

  it('запись только по явному списку строк AGENTS.md', async () => {
    const raw = await handleToolCall('lesson_consolidate', {
      appendAgentsMd: ['Правило из MCP-консолидации'],
    }, testRoot);
    const res = JSON.parse(raw);
    assert.deepEqual(res.applied.appendedLines, ['Правило из MCP-консолидации']);
    assert.ok(existsSync(join(testRoot, 'AGENTS.md')));
  });
});

describe('VL-400 — CLI lesson consolidate', () => {
  it('подкоманда зарегистрирована в справке роутера', () => {
    const router = readFileSync(new URL('../../src/cli/router.ts', import.meta.url), 'utf-8');
    assert.match(router, /consolidate \[--dry-run\]/);
    assert.match(router, /--apply-supersede/);
  });
});
