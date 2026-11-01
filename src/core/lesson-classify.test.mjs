/**
 * Тесты VL-280 — классификация lessons и техдолг из уроков-обходов.
 *
 * Покрывает AC:
 * - AC1: MCP `lesson_classify` — ids[] либо фильтр (status/tags/limit),
 *   возвращает kind + обоснование;
 * - AC2: findings аудита VL-279 попадают в промпт как факты;
 * - AC3: kind пишется только по подтверждению (apply/confirmIds);
 * - AC4: кластеризация workaround по tags + путям → черновики задач;
 * - AC5: задачи создаются только по createClusters и не более N за вызов;
 * - AC6: двусторонняя связь с уроками;
 * - AC7: раздел «Устранение» в теле урока со ссылкой на задачу;
 * - AC8: идемпотентность — повторный вызов не создаёт дубль;
 * - AC9: ошибка LLM по уроку не пишет файлы, остальные обрабатываются.
 *
 * Каталог теста — mkdtemp (lesson-89: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLesson, lessonToMarkdown, getLesson, listLessons } from '../../dist/core/lesson.js';
import {
  clusterWorkarounds, buildTechDebtDraft, appendRemediationSection,
  parseClassifyResponse, buildClassifyPrompt, selectLessonsForClassify,
  classifyLessons, createTechDebtTasks, findExistingTechDebtTask,
  LESSON_CLASSIFY_KINDS,
} from '../../dist/core/lesson-classify.js';
import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-lesson-classify-'));
const backlogDir = join(testRoot, 'backlog');
const lessonsPath = join(backlogDir, 'lessons');
const tasksPath = join(backlogDir, 'tasks');

beforeAll(() => {
  mkdirSync(lessonsPath, { recursive: true });
  mkdirSync(tasksPath, { recursive: true });
  mkdirSync(join(testRoot, 'src', 'core'), { recursive: true });
  // Реальный путь — чтобы у «живого» урока не было missing_path
  writeFileSync(join(testRoot, 'src', 'core', 'lesson.ts'), '// stub\n', 'utf-8');
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** Пишет lesson-файл напрямую (id = имя файла — предсказуемо для тестов). */
function writeLesson(id, fields = {}, body = '') {
  const lesson = createLesson({
    id,
    title: fields.title || `Урок ${id}`,
    status: fields.status || 'active',
    tags: fields.tags || [],
    source_tasks: fields.source_tasks || [],
    linked_tasks: fields.linked_tasks || [],
    created_date: '2026-01-01',
    updated_date: fields.updated_date || '2026-01-01',
    applies_to: fields.applies_to || [],
    kind: fields.kind ?? null,
  });
  writeFileSync(join(lessonsPath, `${id}.md`), lessonToMarkdown(lesson, body), 'utf-8');
  return lesson;
}

/** Мок LLM: отвечает по карте id → {kind, reason} либо бросает. */
function mockClassify(map, calls = []) {
  return async (prompt) => {
    calls.push(prompt);
    const first = prompt.user.split('\n')[0];
    const id = first.replace(/^Урок\s+/, '').split(':')[0].trim();
    const answer = map[id];
    if (answer instanceof Error) throw answer;
    return JSON.stringify(answer);
  };
}

describe('VL-280 — регистрация и валидация аргументов (AC1)', () => {
  it('lesson_classify есть в listTools', () => {
    assert.ok(listTools().some(t => t.name === 'lesson_classify'));
  });

  it('валидация: limit/maxTasks/массивы', async () => {
    assert.match(await handleToolCall('lesson_classify', { limit: 'много' }, testRoot), /limit/);
    assert.match(await handleToolCall('lesson_classify', { maxTasks: -1 }, testRoot), /maxTasks/);
    assert.match(await handleToolCall('lesson_classify', { ids: 'lesson-1' }, testRoot), /ids/);
    assert.match(await handleToolCall('lesson_classify', { createClusters: 'x' }, testRoot), /createClusters/);
  });

  it('парсер ответа: JSON в обёртке и отказ на недопустимом kind', () => {
    assert.deepEqual(
      parseClassifyResponse('```json\n{"kind":"workaround","reason":"обход"}\n```'),
      { kind: 'workaround', reason: 'обход' },
    );
    assert.throws(() => parseClassifyResponse('{"kind":"nonsense","reason":"x"}'), /недопустимый kind/);
    assert.throws(() => parseClassifyResponse('не json'), /нет JSON-объекта/);
  });

  it('LESSON_CLASSIFY_KINDS включает все четыре значения AC1', () => {
    assert.deepEqual([...LESSON_CLASSIFY_KINDS], ['rule', 'workaround', 'fact', 'stale']);
  });
});

describe('VL-280 — findings аудита в промпте (AC2)', () => {
  beforeAll(() => {
    writeLesson('lesson-1', { title: 'Снимать VIBELOG_* через env -u', tags: ['tests', 'env'] },
      'Проблема: переменные ломают тесты.\nРешение: запускай с `env -u VIBELOG_CWD pnpm test`.');
  });

  it('buildClassifyPrompt передаёт findings как факты', () => {
    const entry = listLessons(testRoot).find(e => e.lesson.id === 'lesson-1');
    const prompt = buildClassifyPrompt(entry, [{
      type: 'missing_path', lessonId: 'lesson-1',
      details: { path: 'src/gone.ts' }, message: 'путь не найден: src/gone.ts',
    }]);
    assert.match(prompt.user, /missing_path/);
    assert.match(prompt.user, /src\/gone\.ts/);
    assert.match(prompt.system, /stale/);
  });

  it('наш finding доходит до промпта через classifyLessons', async () => {
    writeLesson('lesson-2', { title: 'Битый путь', tags: ['env'] },
      'Решение: правь `src/nonexistent/file.ts`.');
    const calls = [];
    const report = await classifyLessons(testRoot, { ids: ['lesson-2'] },
      mockClassify({ 'lesson-2': { kind: 'stale', reason: 'файла нет' } }, calls));
    assert.equal(report.classifications[0].kind, 'stale');
    assert.match(calls[0].user, /missing_path/);
  });
});

describe('VL-280 — запись kind только по подтверждению (AC3)', () => {
  it('apply=false не меняет файлы, apply=true пишет kind', async () => {
    writeLesson('lesson-3', { title: 'Правило', tags: ['style'], kind: 'workaround' });
    const before = readFileSync(join(lessonsPath, 'lesson-3.md'), 'utf-8');

    await classifyLessons(testRoot, { ids: ['lesson-3'] },
      mockClassify({ 'lesson-3': { kind: 'rule', reason: 'это правило' } }));
    assert.equal(readFileSync(join(lessonsPath, 'lesson-3.md'), 'utf-8'), before, 'без apply файл не меняется');

    const report = await classifyLessons(testRoot, { ids: ['lesson-3'], apply: true },
      mockClassify({ 'lesson-3': { kind: 'rule', reason: 'это правило' } }));
    assert.deepEqual(report.applied, ['lesson-3']);
    assert.equal(getLesson(testRoot, 'lesson-3').lesson.kind, 'rule');
  });

  it('confirmIds пишет только перечисленные уроки', async () => {
    writeLesson('lesson-4', { title: 'Обход', tags: ['git'] });
    writeLesson('lesson-5', { title: 'Факт', tags: ['git'] });
    const report = await classifyLessons(testRoot, {
      ids: ['lesson-4', 'lesson-5'], confirmIds: ['lesson-4'],
    }, mockClassify({
      'lesson-4': { kind: 'workaround', reason: 'обход' },
      'lesson-5': { kind: 'fact', reason: 'факт' },
    }));
    assert.deepEqual(report.applied, ['lesson-4']);
    assert.equal(getLesson(testRoot, 'lesson-4').lesson.kind, 'workaround');
    assert.equal(getLesson(testRoot, 'lesson-5').lesson.kind, null);

    // stale никогда не пишется в kind
    const report2 = await classifyLessons(testRoot, { ids: ['lesson-5'], apply: true },
      mockClassify({ 'lesson-5': { kind: 'stale', reason: 'устарел' } }));
    assert.equal(report2.applied.length, 0);
    assert.match(report2.classifications[0].skippedReason, /stale/);
  });
});

describe('VL-280 — кластеризация workaround (AC4)', () => {
  it('уроки с общим путём и специфичным тегом объединяются в кластер', () => {
    const a = {
      lesson: createLesson({ id: 'lesson-10', title: 'env -u перед тестами', tags: ['env-ritual'],
        applies_to: ['src/agent/cli.ts'] }),
      body: 'Решение: `src/agent/cli.ts` запускай с `env -u VIBELOG_CWD`.', path: '',
    };
    const b = {
      lesson: createLesson({ id: 'lesson-11', title: 'env-переменные ломают прогон', tags: ['env-ritual'],
        applies_to: ['src/agent/cli.ts'] }),
      body: 'Обход: `env -u VIBELOG_PHASE pnpm test`.', path: '',
    };
    const c = {
      lesson: createLesson({ id: 'lesson-12', title: 'Не коммить симлинк', tags: ['worktree'] }),
      body: 'Обход: не коммить `node_modules` в ветку worktree.', path: '',
    };
    const clusters = clusterWorkarounds([a, b, c]);
    const envCluster = clusters.find(cl => cl.lessons.includes('lesson-10'));
    assert.ok(envCluster.lessons.includes('lesson-11'), 'общий путь/тег → тот же кластер');
    const worktreeCluster = clusters.find(cl => cl.lessons.includes('lesson-12'));
    assert.deepEqual(worktreeCluster.lessons, ['lesson-12'], 'другая тема — отдельный кластер');
    assert.ok(envCluster.id.startsWith('tag:') || envCluster.id.startsWith('path:'));
  });

  it('buildTechDebtDraft содержит цитаты, ID уроков и критерий «workaround больше не нужен»', () => {
    const entry = {
      lesson: createLesson({ id: 'lesson-13', title: 'Откат копией файла', tags: ['git'] }),
      body: 'Проблема: git checkout сносит чужие правки.\nРешение: копируй файл вручную.',
      path: '',
    };
    const [cluster] = clusterWorkarounds([entry]);
    const draft = buildTechDebtDraft(cluster, new Map([['lesson-13', entry]]));
    assert.match(draft.description, /Причина обхода/);
    assert.match(draft.description, /lesson-13/);
    assert.match(draft.description, /копируй файл вручную/);
    assert.match(draft.description, /workaround больше не нужен/);
    assert.ok(draft.labels.includes('tech-debt'));
  });

  it('appendRemediationSection дописывает и обновляет раздел один раз', () => {
    const once = appendRemediationSection('Тело урока.', ['VL-100'], '2026-06-01');
    assert.match(once, /## Устранение/);
    assert.match(once, /VL-100/);
    const twice = appendRemediationSection(once, ['VL-101'], '2026-06-02');
    assert.equal((twice.match(/## Устранение/g) || []).length, 1, 'раздел не дублируется');
    assert.match(twice, /VL-101/);
  });
});

describe('VL-280 — создание задач техдолга (AC5–AC8)', () => {
  it('без createClusters ничего не создаётся; лимит N соблюдается', async () => {
    writeLesson('lesson-20', { title: 'Обход тестов', tags: ['ritual-a'] }, 'Решение: env -u.');
    writeLesson('lesson-21', { title: 'Обход сборки', tags: ['ritual-b'] }, 'Решение: копия файла.');

    const dry = await classifyLessons(testRoot, { ids: ['lesson-20', 'lesson-21'] }, mockClassify({
      'lesson-20': { kind: 'workaround', reason: 'обход' },
      'lesson-21': { kind: 'workaround', reason: 'обход' },
    }));
    assert.equal(dry.creation, undefined, 'без createClusters задач нет');
    assert.equal(listLessons(testRoot).filter(e => e.lesson.id === 'lesson-20').length, 1);

    const clusterIds = dry.clusters.map(c => c.id);
    const created = await classifyLessons(testRoot, {
      ids: ['lesson-20', 'lesson-21'], createClusters: clusterIds, maxTasks: 1,
    }, mockClassify({
      'lesson-20': { kind: 'workaround', reason: 'обход' },
      'lesson-21': { kind: 'workaround', reason: 'обход' },
    }));
    assert.equal(created.creation.created.length, 1, 'не более 1 задачи за вызов');
    assert.equal(created.creation.limited.length, 1);

    const taskId = created.creation.created[0].taskId;
    const lessonId = created.creation.created[0].lessons[0];
    // AC6: двусторонняя связь
    const lesson = getLesson(testRoot, lessonId);
    assert.ok(lesson.lesson.linked_tasks.includes(taskId), 'lesson.linked_tasks += задача');
    // AC7: раздел «Устранение» в теле
    assert.match(lesson.body, /## Устранение/);
    assert.match(lesson.body, new RegExp(taskId));

    // AC8: повторный вызов не создаёт дубль
    const again = await classifyLessons(testRoot, {
      ids: [lessonId], createClusters: created.clusters.filter(c => c.lessons.includes(lessonId)).map(c => c.id),
    }, mockClassify({ [lessonId]: { kind: 'workaround', reason: 'обход' } }));
    assert.equal(again.creation.created.length, 0);
    assert.equal(again.creation.skipped.length, 1);
    assert.equal(again.creation.skipped[0].taskId, taskId);
  });

  it('findExistingTechDebtTask находит задачу по label tech-debt и ID урока', async () => {
    writeLesson('lesson-30', { title: 'Обход X', tags: ['z'] });
    const draft = buildTechDebtDraft(
      clusterWorkarounds([listLessons(testRoot).find(e => e.lesson.id === 'lesson-30')])[0],
      new Map(),
    );
    assert.equal(findExistingTechDebtTask(testRoot, ['lesson-30']), null);
    const result = createTechDebtTasks(testRoot, [draft], { clusters: [draft.clusterId] });
    assert.equal(result.created.length, 1);
    const found = findExistingTechDebtTask(testRoot, ['lesson-30']);
    assert.equal(found.id, result.created[0].taskId);
  });
});

describe('VL-280 — ошибки LLM не пишут файлы (AC9)', () => {
  it('сбой по одному уроку: остальные обрабатываются, файл не меняется', async () => {
    writeLesson('lesson-40', { title: 'Сбойная', tags: ['err'] });
    writeLesson('lesson-41', { title: 'Нормальная', tags: ['err'] });
    const before = readFileSync(join(lessonsPath, 'lesson-40.md'), 'utf-8');

    const report = await classifyLessons(testRoot, {
      ids: ['lesson-40', 'lesson-41'], apply: true,
    }, mockClassify({
      'lesson-40': new Error('таймаут LLM'),
      'lesson-41': { kind: 'rule', reason: 'правило' },
    }));

    const failed = report.classifications.find(c => c.id === 'lesson-40');
    assert.match(failed.error, /таймаут/);
    assert.equal(failed.applied, undefined);
    assert.equal(readFileSync(join(lessonsPath, 'lesson-40.md'), 'utf-8'), before, 'файл не тронут');
    const ok = report.classifications.find(c => c.id === 'lesson-41');
    assert.equal(ok.applied, true);
    assert.equal(report.summary.error, 1);
    assert.equal(report.summary.rule, 1);
  });

  it('невалидный JSON ответа — ошибка по уроку, ничего не пишется', async () => {
    writeLesson('lesson-42', { title: 'Кривой ответ', tags: ['err2'] });
    const report = await classifyLessons(testRoot, { ids: ['lesson-42'], apply: true },
      async () => 'не json вовсе');
    assert.match(report.classifications[0].error, /JSON/);
    assert.equal(getLesson(testRoot, 'lesson-42').lesson.kind, null);
  });
});

describe('VL-280 — выборка по фильтру (AC1)', () => {
  it('status/tags/limit ограничивают выборку', () => {
    const byTags = selectLessonsForClassify(testRoot, { tags: ['err2'] });
    assert.deepEqual(byTags.map(e => e.lesson.id), ['lesson-42']);
    const limited = selectLessonsForClassify(testRoot, { limit: 2 });
    assert.equal(limited.length, 2);
    const byStatus = selectLessonsForClassify(testRoot, { status: 'needs-review' });
    assert.deepEqual(byStatus, []);
  });
});
