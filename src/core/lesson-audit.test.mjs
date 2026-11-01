/**
 * Тесты VL-279 — аудит актуальности lessons (механические проверки).
 *
 * Покрывает AC задачи:
 * - AC2: битые пути (missing_path) — тело урока и applies_to;
 * - AC3: висячие ссылки (dangling_task, broken_supersede, supersede_cycle);
 * - AC4: дубли (duplicate_of) с настраиваемым порогом;
 * - AC5: сироты и протухание (stale), superseded/outdated вне stale;
 * - AC6: additive-поля фронтматтера и их round-trip;
 * - AC7: статус needs-review в LESSON_STATUSES/normalizeLessonStatus;
 * - AC8: loadLessonsForTask отбрасывает needs-review/протухшие и держит кап;
 * - AC9: lesson_audit — read-only по умолчанию, записи только по явным ID;
 * - AC10: --write пишет backlog/lessons/AUDIT.md.
 *
 * Каталог теста — mkdtemp (lesson-89: фиксированные пути запрещены).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  LESSON_STATUSES, normalizeLessonStatus, createLesson, lessonToMarkdown,
  markdownToLesson, createLessonFile, listLessons, getLesson, loadLessonsForTask,
} from '../../dist/core/lesson.js';
import {
  auditLessons, applyLessonAudit, extractLessonPaths, formatLessonAuditMarkdown,
} from '../../dist/core/lesson-audit.js';
import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-lesson-audit-'));
const backlogDir = join(testRoot, 'backlog');
const lessonsPath = join(backlogDir, 'lessons');
const tasksPath = join(backlogDir, 'tasks');
const completedPath = join(backlogDir, 'completed');
/** «Сегодня» фиксируем: протухание не должно зависеть от даты прогона. */
const NOW = Date.parse('2026-06-01T00:00:00Z');

beforeAll(() => {
  mkdirSync(tasksPath, { recursive: true });
  mkdirSync(completedPath, { recursive: true });
  mkdirSync(lessonsPath, { recursive: true });
  mkdirSync(join(testRoot, 'src', 'core'), { recursive: true });
  mkdirSync(join(testRoot, 'templates'), { recursive: true });
  // Реальный файл, на который ссылается «живой» урок
  writeFileSync(join(testRoot, 'src', 'core', 'lesson.ts'), '// stub\n', 'utf-8');

  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'vl',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');

  // Открытая задача (не Done) — источник для «живого» урока
  writeFileSync(join(tasksPath, 'VL-1 - Открытая задача.md'), stringifyYaml({}) + '', 'utf-8');
  writeFileSync(join(tasksPath, 'VL-1 - Открытая задача.md'), [
    '---', 'id: VL-1', 'title: Открытая задача', 'status: In Progress',
    'created_date: 2026-01-01', 'updated_date: 2026-01-01', '---', '', '## Description', '', 'x', '',
  ].join('\n'), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** Создаёт lesson-файл напрямую (быстрее, чем через createLessonFile с id). */
function writeLesson(id, fields, body = '') {
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
  writeFileSync(join(lessonsPath, `${id}.md`), lessonToMarkdown(lesson, body), 'utf-8');
  return lesson;
}

describe('VL-279 — поля фронтматтера (AC6)', () => {
  it('round-trip новых полей: last_verified/verified_by/applies_to/kind', () => {
    const lesson = createLesson({
      id: 'lesson-900', title: 'Round trip', status: 'active',
      tags: ['audit'], source_tasks: ['VL-1'], linked_tasks: ['VL-1'],
      created_date: '2026-01-01', updated_date: '2026-01-02',
      last_verified: '2026-05-01', verified_by: 'agent',
      applies_to: ['src/core/lesson.ts'], kind: 'rule',
    });
    const parsed = markdownToLesson(lessonToMarkdown(lesson, 'тело'));
    assert.deepEqual(parsed.lesson, lesson);
    assert.equal(parsed.body, 'тело');
  });

  it('старый файл без новых полей читается с дефолтами', () => {
    const legacy = [
      '---', 'id: lesson-901', 'title: Старый урок', 'status: active',
      'tags: []', 'source_tasks: []', 'linked_tasks: []',
      'created_date: 2026-01-01', 'updated_date: 2026-01-01', "supersedes: ''",
      '---', '', 'тело', '',
    ].join('\n');
    const parsed = markdownToLesson(legacy);
    assert.equal(parsed.lesson.last_verified, '');
    assert.equal(parsed.lesson.verified_by, '');
    assert.deepEqual(parsed.lesson.applies_to, []);
    assert.equal(parsed.lesson.kind, null);
  });

  it('битый kind (вне rule|workaround|fact) → null, не падение', () => {
    const md = [
      '---', 'id: lesson-902', 'title: Битый kind', 'status: active',
      'kind: banana', '---', '',
    ].join('\n');
    assert.equal(markdownToLesson(md).lesson.kind, null);
  });
});

describe('VL-279 — статус needs-review (AC7)', () => {
  it('needs-review входит в LESSON_STATUSES и нормализуется', () => {
    assert.ok(LESSON_STATUSES.includes('needs-review'));
    assert.equal(normalizeLessonStatus('Needs-Review'), 'needs-review');
    assert.ok(LESSON_STATUSES.includes('active'));
    assert.ok(LESSON_STATUSES.includes('outdated'));
    assert.ok(LESSON_STATUSES.includes('superseded'));
    assert.throws(() => normalizeLessonStatus('banana'), /Недопустимый статус lesson/);
  });
});

describe('VL-279 — extractLessonPaths', () => {
  it('достаёт пути из обратных апостровов и префиксов, отбрасывает шаблоны', () => {
    const body = [
      'Правь `src/core/lesson.ts:396` и `templates/phases/phase-code.md`.',
      'Голый путь src/web/api.ts тоже виден.',
      'Шаблоны: `src/**/*.ts` и backlog/tasks/<id>.md — не проверяются.',
      'Обрезка каталога `src/web/` и пример `templates/phases/x.md` — тоже.',
    ].join(' ');
    const paths = extractLessonPaths(body);
    assert.ok(paths.includes('src/core/lesson.ts'), paths.join(','));
    assert.ok(paths.includes('templates/phases/phase-code.md'), paths.join(','));
    assert.ok(paths.includes('src/web/api.ts'), paths.join(','));
    assert.ok(!paths.some(p => p.includes('*')), 'шаблоны отброшены');
    assert.ok(!paths.includes('src/web/'), 'обрезка каталога отброшена');
  });
});

describe('VL-279 — auditLessons: четыре типа находок (AC2–AC5)', () => {
  it('фикстура: битый путь, висячий supersedes, дубль, протухший урок', () => {
    // Живой урок: путь существует, задача открыта, дата свежая
    writeLesson('lesson-801', {
      title: 'Правило про шаблоны промптов',
      tags: ['templates', 'prompts'],
      source_tasks: ['VL-1'],
      linked_tasks: ['VL-1'],
      updated_date: '2026-05-20',
      last_verified: '2026-05-20',
    }, 'Смотри `src/core/lesson.ts` и `templates/phases/phase-code.md`.');

    // 1) Битый путь: файла нет. Плюс висячий supersedes на несуществующий id.
    writeLesson('lesson-802', {
      title: 'Битый путь и висячая замена',
      tags: ['broken'],
      source_tasks: ['VL-1'],
      linked_tasks: ['VL-1'],
      updated_date: '2026-05-20',
      supersedes: 'lesson-999',
    }, 'Правь `src/core/nonexistent-module.ts`.');

    // 2) Дубль пары: почти одинаковые title+tags+тело
    writeLesson('lesson-803', {
      title: 'Не вставляй ID задач VL-N в шаблоны templates',
      tags: ['templates', 'prompts'],
      source_tasks: ['VL-1'],
      linked_tasks: ['VL-1'],
      updated_date: '2026-05-20',
    }, 'В шаблонах templates не должно быть внутренних ID задач.');
    writeLesson('lesson-804', {
      title: 'Не вставляй ID задач VL-N в шаблоны templates',
      tags: ['templates', 'prompts'],
      source_tasks: ['VL-1'],
      linked_tasks: ['VL-1'],
      updated_date: '2026-05-20',
    }, 'В шаблонах templates не должно быть внутренних ID задач.');

    // 3) Протухший: обновлялся давно
    writeLesson('lesson-805', {
      title: 'Давно не проверявшийся урок про базу',
      tags: ['db'],
      source_tasks: ['VL-1'],
      linked_tasks: ['VL-1'],
      updated_date: '2025-01-01',
    }, 'Про базу.');

    // 4) Висячая ссылка на задачу
    writeLesson('lesson-806', {
      title: 'Ссылка на несуществующую задачу',
      tags: ['xref'],
      source_tasks: ['VL-4242'],
      linked_tasks: ['VL-4242'],
      updated_date: '2026-05-20',
    }, 'Тело без путей.');

    const report = auditLessons(testRoot, { now: NOW, staleDays: 180, duplicateThreshold: 0.35 });
    const byType = (t) => report.findings.filter(f => f.type === t);

    const missing = byType('missing_path').filter(f => f.lessonId === 'lesson-802');
    assert.ok(missing.length > 0, 'missing_path для битого пути');
    assert.equal(missing[0].details.path, 'src/core/nonexistent-module.ts');

    const dangling = byType('dangling_task').filter(f => f.lessonId === 'lesson-806');
    assert.ok(dangling.some(f => f.details.task_id === 'VL-4242'), 'dangling_task по VL-4242');
    assert.ok(dangling.some(f => f.details.field === 'source_tasks'), 'поле source_tasks в деталях');

    const broken = byType('broken_supersede').filter(f => f.lessonId === 'lesson-802');
    assert.ok(broken.length > 0, 'broken_supersede на отсутствующий id');
    assert.equal(broken[0].details.reason, 'missing');

    const dup = byType('duplicate_of').filter(f => f.lessonId === 'lesson-803');
    assert.ok(dup.some(f => f.details.other === 'lesson-804'), 'пара дублей 803/804');
    assert.ok(duplicateReportSimilarity(dup) >= 0.35, 'указана степень похожести');

    const stale = byType('stale').filter(f => f.lessonId === 'lesson-805');
    assert.ok(stale.length > 0, 'stale для протухшего урока');

    // Сводка согласована с находками
    assert.equal(report.summary.missing_path, byType('missing_path').length);
    assert.equal(report.summary.duplicate_of, byType('duplicate_of').length);
    assert.equal(report.config.staleDays, 180);
    assert.equal(report.config.duplicateThreshold, 0.35);
  });

  it('живой урок без находок; superseded/outdated в stale не попадают', () => {
    writeLesson('lesson-807', {
      title: 'Заменённый старый урок',
      status: 'superseded',
      tags: ['old'],
      source_tasks: ['VL-1'],
      updated_date: '2020-01-01',
    }, 'старое');
    writeLesson('lesson-808', {
      title: 'Устаревший урок',
      status: 'outdated',
      tags: ['old'],
      source_tasks: ['VL-1'],
      updated_date: '2020-01-01',
    }, 'устарело');

    const report = auditLessons(testRoot, { now: NOW });
    assert.ok(!report.findings.some(f => f.lessonId === 'lesson-807'), 'superseded вне stale');
    assert.ok(!report.findings.some(f => f.lessonId === 'lesson-808'), 'outdated вне stale');
    assert.ok(!report.findings.some(f => f.lessonId === 'lesson-801'), 'живой урок без находок');
  });

  it('supersede_cycle: цепочка зациклена', () => {
    writeLesson('lesson-811', {
      title: 'Цикл A', tags: ['cycle'], source_tasks: ['VL-1'], updated_date: '2026-05-20',
      supersedes: 'lesson-812',
    });
    writeLesson('lesson-812', {
      title: 'Цикл B', tags: ['cycle'], source_tasks: ['VL-1'], updated_date: '2026-05-20',
      supersedes: 'lesson-811',
    });
    const report = auditLessons(testRoot, { now: NOW });
    const cycles = report.findings.filter(f => f.type === 'supersede_cycle');
    assert.ok(cycles.length > 0, 'цикл найден');
    assert.ok(cycles.some(f => f.lessonId === 'lesson-811'), 'цикл отмечен у lesson-811');
    assert.ok(Array.isArray(cycles[0].details.chain), 'цепочка в деталях');
  });

  it('broken_supersede: supersedes на самого себя', () => {
    writeLesson('lesson-813', {
      title: 'Сам себя', tags: ['self'], source_tasks: ['VL-1'],
      updated_date: '2026-05-20', supersedes: 'lesson-813',
    });
    const report = auditLessons(testRoot, { now: NOW });
    const self = report.findings.filter(f => f.type === 'broken_supersede' && f.lessonId === 'lesson-813');
    assert.ok(self.length > 0);
    assert.equal(self[0].details.reason, 'self');
  });

  it('порог дублей настраивается: высокий порог убирает пару', () => {
    const low = auditLessons(testRoot, { now: NOW, duplicateThreshold: 0.35 });
    const high = auditLessons(testRoot, { now: NOW, duplicateThreshold: 0.99 });
    const countLow = low.summary.duplicate_of;
    const countHigh = high.summary.duplicate_of;
    assert.ok(countLow > countHigh, `низкий порог даёт больше дублей (${countLow} > ${countHigh})`);
  });
});

/** Достаёт similarity из находки duplicate_of (для ассертов теста). */
function duplicateReportSimilarity(findings) {
  return Math.max(...findings.map(f => Number(f.details.similarity) || 0));
}

describe('VL-279 — loadLessonsForTask: фильтры и кап (AC8)', () => {
  it('needs-review/outdated/superseded и протухшие не подставляются, кап соблюдён', () => {
    writeLesson('lesson-821', {
      title: 'Свежий урок про промпты', tags: ['promptfilter'],
      source_tasks: ['VL-1'], linked_tasks: ['VL-1'],
      updated_date: '2026-05-25', last_verified: '2026-05-25',
    });
    writeLesson('lesson-822', {
      title: 'На проверке', status: 'needs-review', tags: ['promptfilter'],
      source_tasks: ['VL-1'], updated_date: '2026-05-25',
    });
    writeLesson('lesson-823', {
      title: 'Протухший про промпты', tags: ['promptfilter'],
      source_tasks: ['VL-1'], linked_tasks: ['VL-1'],
      last_verified: '2020-01-01', updated_date: '2020-01-01',
    });
    // Задача с labels promptfilter — подбор идёт по labels задачи
    createLessonFile(testRoot, { id: 'lesson-824', title: 'Активный второй', tags: ['promptfilter'] });

    const taskFile = join(tasksPath, 'VL-77 - Задача с меткой.md');
    writeFileSync(taskFile, [
      '---', 'id: VL-77', 'title: Задача с меткой', 'status: To Do',
      'labels:', '  - promptfilter', 'created_date: 2026-01-01', 'updated_date: 2026-01-01',
      '---', '', '## Description', '', 'x', '',
    ].join('\n'), 'utf-8');

    const picked = loadLessonsForTask(testRoot, 'VL-77');
    assert.ok(picked.some(l => l.includes('lesson-821')), 'свежий активный подставлен');
    assert.ok(!picked.some(l => l.includes('lesson-822')), 'needs-review не подставлен');
    assert.ok(!picked.some(l => l.includes('lesson-823')), 'протухший не подставлен');
    assert.ok(picked.length <= 5, `кап top-5 соблюдён (${picked.length})`);

    // Кап настраивается через .vibelog/settings.json
    mkdirSync(join(testRoot, '.vibelog'), { recursive: true });
    writeFileSync(join(testRoot, '.vibelog', 'settings.json'), JSON.stringify({
      lessons: { prompt_limit: 1, stale_days: 400 },
    }), 'utf-8');
    const capped = loadLessonsForTask(testRoot, 'VL-77');
    assert.equal(capped.length, 1, 'prompt_limit=1 из настроек');
    // stale_days=400 из настроек возвращает урок 2020 года? нет — он старше
    assert.ok(!capped.some(l => l.includes('lesson-823')));
    rmSync(join(testRoot, '.vibelog'), { recursive: true, force: true });
  });
});

describe('VL-279 — applyLessonAudit и отчёт (AC9, AC10)', () => {
  it('applyLessonAudit правит только переданные id', () => {
    writeLesson('lesson-831', { title: 'Отметить проверенным', tags: ['apply'], updated_date: '2020-01-01' });
    writeLesson('lesson-832', { title: 'Перевести на проверку', tags: ['apply'], updated_date: '2026-05-20' });
    writeLesson('lesson-833', { title: 'Не трогать', tags: ['apply'], updated_date: '2020-01-01' });

    const res = applyLessonAudit(testRoot, {
      verified: ['lesson-831'], needsReview: ['lesson-832'], date: '2026-06-01',
    });
    assert.deepEqual(res.verified, ['lesson-831']);
    assert.deepEqual(res.needsReview, ['lesson-832']);
    assert.deepEqual(res.notFound, []);

    assert.equal(getLesson(testRoot, 'lesson-831').lesson.last_verified, '2026-06-01');
    assert.equal(getLesson(testRoot, 'lesson-831').lesson.verified_by, 'auto');
    assert.equal(getLesson(testRoot, 'lesson-832').lesson.status, 'needs-review');
    assert.equal(getLesson(testRoot, 'lesson-833').lesson.last_verified, '', 'нетронутый урок не изменён');
    assert.equal(getLesson(testRoot, 'lesson-833').lesson.status, 'active');

    const missing = applyLessonAudit(testRoot, { verified: ['lesson-999'] });
    assert.deepEqual(missing.notFound, ['lesson-999']);
  });

  it('formatLessonAuditMarkdown: сводка по типам + таблица находок', () => {
    const report = auditLessons(testRoot, { now: NOW });
    const md = formatLessonAuditMarkdown(report);
    assert.match(md, /# Аудит lessons/);
    assert.match(md, /\| Тип \| Находок \|/);
    assert.match(md, /\| Lesson \| Тип \| Детали \|/);
    assert.match(md, /missing_path/);
    assert.ok(md.includes(report.total.toString()), 'число проверенных уроков');
  });
});

describe('VL-279 — MCP lesson_audit (AC1, AC9)', () => {
  it('инструмент зарегистрирован в listTools', () => {
    assert.ok(listTools().some(t => t.name === 'lesson_audit'));
  });

  it('read-only по умолчанию: отчёт без изменений файлов', async () => {
    writeLesson('lesson-841', { title: 'Аудит через MCP', tags: ['mcp'], updated_date: '2020-01-01' });
    const before = readFileSync(join(lessonsPath, 'lesson-841.md'), 'utf-8');
    const raw = await handleToolCall('lesson_audit', {}, testRoot);
    const report = JSON.parse(raw);
    assert.ok(Array.isArray(report.findings), 'findings — массив');
    assert.ok(report.summary && typeof report.summary.missing_path === 'number', 'сводка по типам');
    assert.ok(Array.isArray(report.byLesson), 'группировка по уроку');
    assert.equal(report.applied, undefined, 'без явных id записей нет');
    assert.equal(readFileSync(join(lessonsPath, 'lesson-841.md'), 'utf-8'), before, 'файл не изменён');
  });

  it('явные списки verified/needsReview — записи по конкретным id', async () => {
    writeLesson('lesson-842', { title: 'MCP проверить', tags: ['mcp'], updated_date: '2020-01-01' });
    const raw = await handleToolCall('lesson_audit', {
      verified: ['lesson-842'], needsReview: ['lesson-841'],
    }, testRoot);
    const report = JSON.parse(raw);
    assert.deepEqual(report.applied.verified, ['lesson-842']);
    assert.deepEqual(report.applied.needsReview, ['lesson-841']);
    assert.ok(getLesson(testRoot, 'lesson-842').lesson.last_verified, 'last_verified выставлен');
    assert.equal(getLesson(testRoot, 'lesson-841').lesson.status, 'needs-review');
  });

  it('write=true пишет backlog/lessons/AUDIT.md', async () => {
    const raw = await handleToolCall('lesson_audit', { write: true }, testRoot);
    const report = JSON.parse(raw);
    assert.ok(report.written_to, 'путь отчёта возвращён');
    assert.ok(existsSync(join(lessonsPath, 'AUDIT.md')), 'AUDIT.md создан');
    const content = readFileSync(join(lessonsPath, 'AUDIT.md'), 'utf-8');
    assert.match(content, /# Аудит lessons/);
  });

  it('невалидные аргументы → понятный текст вместо TypeError', async () => {
    const bad = await handleToolCall('lesson_audit', { threshold: 'много' }, testRoot);
    assert.match(bad, /threshold/);
    const bad2 = await handleToolCall('lesson_audit', { staleDays: -5 }, testRoot);
    assert.match(bad2, /staleDays/);
  });
});
