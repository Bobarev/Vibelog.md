/**
 * Тесты VL-295 — датасеты экспериментов (doc-21 §5–§6).
 *
 * Временный каталог — mkdtemp (VL-241/lesson-89): фиксированные пути при
 * параллельных прогонах в разных worktree затирают друг друга.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseDatasetJsonl, readDatasetFile, resolveDataset, resolveShadowing,
  datasetFromCompleted, listDatasets, writeSharedDataset, serializeDatasetJsonl,
  DEFAULT_COMPLETED_LIMIT, DATASET_ROW_TEMPLATE,
} from '../../dist/core/dataset.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-dataset-'));
const backlogDir = join(testRoot, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // Фикстуры задач для datasetFromCompleted: одна Done, одна In Progress
  writeFileSync(join(backlogDir, 'tasks', 'tst-1 - Готовая задача.md'), [
    '---',
    'id: tst-1',
    'title: Готовая задача',
    'status: Done',
    'priority: High',
    'type: feature',
    "created_date: '2026-01-01 10:00'",
    "updated_date: '2026-01-02 10:00'",
    '---',
    '',
    '## Description',
    '<!-- SECTION:DESCRIPTION:BEGIN -->',
    'Описание готовой задачи',
    '<!-- SECTION:DESCRIPTION:END -->',
    '',
    '## Acceptance Criteria',
    '<!-- AC:BEGIN -->',
    '- [x] #1 Первый критерий',
    '- [ ] #2 Второй критерий',
    '<!-- AC:END -->',
  ].join('\n'), 'utf-8');
  writeFileSync(join(backlogDir, 'tasks', 'tst-3 - Ещё готовая.md'), [
    '---',
    'id: tst-3',
    'title: Ещё готовая задача',
    'status: Done',
    'priority: Medium',
    'type: bug',
    "created_date: '2026-01-01 10:00'",
    "updated_date: '2026-01-01 10:00'",
    '---',
    '',
    '## Description',
    '<!-- SECTION:DESCRIPTION:BEGIN -->',
    'Второе описание',
    '<!-- SECTION:DESCRIPTION:END -->',
    '',
    '## Acceptance Criteria',
    '<!-- AC:BEGIN -->',
    '- [x] #1 Критерий второй задачи',
    '<!-- AC:END -->',
  ].join('\n'), 'utf-8');
  writeFileSync(join(backlogDir, 'tasks', 'tst-2 - В работе.md'), [
    '---',
    'id: tst-2',
    'title: В работе',
    'status: In Progress',
    'priority: Low',
    'type: bug',
    "created_date: '2026-01-01 10:00'",
    "updated_date: '2026-01-03 10:00'",
    '---',
    '',
    '## Description',
    'Незавершённая задача',
  ].join('\n'), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** Пишет файл, создавая каталоги. */
function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

// ── Парсинг и валидация (doc-21 §5) ──

describe('VL-295 — parseDatasetJsonl', () => {
  it('читает все поля строки: task_id, expected_ac, input, custom, meta', () => {
    const text = [
      '{"task_id": "t1", "expected_ac": "Функция возвращает []", "input": "текст", "custom": {"language": "ts"}, "meta": {"k": 1}}',
    ].join('\n');
    const parsed = parseDatasetJsonl(text);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.warnings.length, 0);
    assert.deepEqual(parsed.rows, [{
      task_id: 't1',
      expected_ac: 'Функция возвращает []',
      input: 'текст',
      custom: { language: 'ts' },
      meta: { k: 1 },
    }]);
  });

  it('payload читается как структурированное значение', () => {
    const parsed = parseDatasetJsonl('{"task_id": "t3", "payload": {"url": "/pricing"}}');
    assert.equal(parsed.errors.length, 0);
    assert.deepEqual(parsed.rows[0].payload, { url: '/pricing' });
    assert.equal(parsed.rows[0].input, undefined);
  });

  it('expected — синоним expected_ac, но даёт warning; канон выигрывает', () => {
    const synonymOnly = parseDatasetJsonl('{"task_id": "a", "expected": "старый"}');
    assert.equal(synonymOnly.rows[0].expected_ac, 'старый');
    assert.equal(synonymOnly.warnings.length, 1);
    assert.equal(synonymOnly.warnings[0].kind, 'expected-synonym');
    assert.match(synonymOnly.warnings[0].message, /expected_ac/);

    const both = parseDatasetJsonl('{"task_id": "b", "expected": "старый", "expected_ac": "новый"}');
    assert.equal(both.rows[0].expected_ac, 'новый');
    assert.equal(both.warnings[0].kind, 'expected-synonym');
  });

  it('input + payload одновременно: warning, выигрывает payload', () => {
    const parsed = parseDatasetJsonl('{"task_id": "c", "input": "txt", "payload": {"a": 1}}');
    assert.equal(parsed.errors.length, 0);
    assert.deepEqual(parsed.rows[0].payload, { a: 1 });
    assert.equal(parsed.rows[0].input, undefined);
    assert.equal(parsed.warnings[0].kind, 'input-payload-conflict');
  });

  it('битые JSON-строки и объекты не той формы попадают в errors, не бросают', () => {
    const text = ['{"task_id": "ok"}', 'не json', '[1,2]', '', '{"task_id": "ok2"}'].join('\n');
    const parsed = parseDatasetJsonl(text);
    assert.equal(parsed.rows.length, 2, 'валидные строки прочитаны');
    assert.equal(parsed.errors.length, 2, 'битый JSON и массив — ошибки');
    assert.deepEqual(parsed.errors.map(e => e.line), [2, 3], 'номера строк 1-based, пустая строка пропущена');
    assert.ok(parsed.errors.every(e => e.kind === 'json'));
  });

  it('отсутствие task_id — ошибка строки', () => {
    const parsed = parseDatasetJsonl('{"expected_ac": "без ключа"}');
    assert.equal(parsed.rows.length, 0);
    assert.equal(parsed.errors[0].kind, 'task_id-missing');
  });

  it('дубликат task_id — ошибка, действует первая строка', () => {
    const text = [
      '{"task_id": "dup", "expected_ac": "первая"}',
      '{"task_id": "dup", "expected_ac": "вторая"}',
    ].join('\n');
    const parsed = parseDatasetJsonl(text);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].expected_ac, 'первая');
    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.errors[0].kind, 'task_id-duplicate');
    assert.equal(parsed.errors[0].line, 2);
  });

  it('пустой текст и текст из одних переводов строк — пустой датасет', () => {
    assert.deepEqual(parseDatasetJsonl('').rows, []);
    assert.deepEqual(parseDatasetJsonl('\n\n').errors, []);
  });

  it('serializeDatasetJsonl → parseDatasetJsonl: round-trip', () => {
    const rows = [{ task_id: 'r1', expected_ac: 'x', custom: { a: 1 } }];
    const parsed = parseDatasetJsonl(serializeDatasetJsonl(rows));
    assert.deepEqual(parsed.rows, rows);
    assert.equal(parsed.errors.length, 0);
  });

  it('DATASET_ROW_TEMPLATE — валидная строка с task_id', () => {
    const parsed = parseDatasetJsonl(DATASET_ROW_TEMPLATE);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.rows[0].task_id, 't1');
  });
});

// ── Резолв частный → общий (doc-21 §6) ──

describe('VL-295 — resolveDataset', () => {
  it('только частный файл: chosen=private, без warning', () => {
    const path = join(backlogDir, 'experiments', 'exp-p1', 'datasets', 'only-private.jsonl');
    writeFile(path, '{"task_id": "p1"}');
    const res = resolveDataset(backlogDir, 'exp-p1', 'only-private', { silent: true });
    assert.equal(res.resolution.chosen, 'private');
    assert.equal(res.resolution.path, 'experiments/exp-p1/datasets/only-private.jsonl');
    assert.equal(res.resolution.shadowed, undefined);
    assert.equal(res.warnings.length, 0);
  });

  it('только общий файл: chosen=shared, без warning', () => {
    const path = join(backlogDir, 'experiments', 'datasets', 'only-shared.jsonl');
    writeFile(path, '{"task_id": "s1"}');
    const res = resolveDataset(backlogDir, 'exp-1', 'only-shared', { silent: true });
    assert.equal(res.resolution.chosen, 'shared');
    assert.equal(res.resolution.path, 'experiments/datasets/only-shared.jsonl');
    assert.equal(res.warnings.length, 0);
  });

  it('оба файла: выигрывает частный, warning про затенение + structure для meta', () => {
    writeFile(join(backlogDir, 'experiments', 'datasets', 'both.jsonl'), '{"task_id": "shared-1"}');
    writeFile(join(backlogDir, 'experiments', 'exp-both', 'datasets', 'both.jsonl'), '{"task_id": "private-1"}');
    const res = resolveDataset(backlogDir, 'exp-both', 'both', { silent: true });
    assert.equal(res.resolution.chosen, 'private');
    assert.equal(res.resolution.path, 'experiments/exp-both/datasets/both.jsonl');
    assert.equal(res.resolution.shadowed, 'experiments/datasets/both.jsonl');
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /затеняет/);
  });

  it('warning про затенение печатается в stderr (не глотается)', () => {
    // silent не задан — перехватываем console.error: warning обязан дойти до канала
    const original = console.error;
    const lines = [];
    console.error = (msg) => lines.push(String(msg));
    try {
      resolveDataset(backlogDir, 'exp-both', 'both');
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Предупреждение: .*затеняет/);
  });

  it('ни одного файла: ошибка с перечнем проверенных путей', () => {
    assert.throws(
      () => resolveDataset(backlogDir, 'exp-none', 'missing', { silent: true }),
      /не найден.*Проверены пути: .*exp-none\/datasets\/missing\.jsonl.*datasets\/missing\.jsonl/s
    );
  });

  it('имя с расширением и без — один и тот же файл', () => {
    const withExt = resolveDataset(backlogDir, 'exp-1', 'only-shared.jsonl', { silent: true });
    const withoutExt = resolveDataset(backlogDir, 'exp-1', 'only-shared', { silent: true });
    assert.equal(withExt.absolutePath, withoutExt.absolutePath);
  });

  it('имя с путём отклоняется (не выходим за каталог)', () => {
    assert.throws(() => resolveDataset(backlogDir, 'exp-1', '../evil', { silent: true }), /не должно содержать путь/);
  });

  it('--dataset-path перебивает резолв, даже если частный/общий есть', () => {
    const custom = join(testRoot, 'custom.jsonl');
    writeFileSync(custom, '{"task_id": "custom-1"}', 'utf-8');
    const res = resolveDataset(backlogDir, 'exp-both', 'both', { explicitPath: custom, silent: true });
    assert.equal(res.resolution.chosen, 'explicit');
    assert.equal(res.absolutePath, custom);
    const parsed = readDatasetFile(res.absolutePath);
    assert.equal(parsed.rows[0].task_id, 'custom-1');
  });

  it('--dataset-path на несуществующий файл — ошибка', () => {
    assert.throws(
      () => resolveDataset(backlogDir, 'exp-1', 'x', { explicitPath: join(testRoot, 'nope.jsonl'), silent: true }),
      /не найден/
    );
  });

  it('resolveShadowing: тот же порядок для prompts (.md)', () => {
    writeFile(join(backlogDir, 'experiments', 'prompts', 'variant-b.md'), 'общий');
    writeFile(join(backlogDir, 'experiments', 'exp-pr', 'prompts', 'variant-b.md'), 'частный');
    const found = resolveShadowing(backlogDir, 'exp-pr', 'prompt', 'variant-b');
    assert.equal(found.chosen, 'private');
    assert.equal(found.relativePath, 'experiments/exp-pr/prompts/variant-b.md');
    assert.equal(found.shadowed, 'experiments/prompts/variant-b.md');
    assert.equal(resolveShadowing(backlogDir, 'exp-1', 'prompt', 'variant-b').chosen, 'shared');
    assert.equal(resolveShadowing(backlogDir, 'exp-1', 'prompt', 'nope'), null);
  });
});

// ── Сборка из завершённых задач ──

describe('VL-295 — datasetFromCompleted', () => {
  it('собирает Done-задачи: task_id/title+description→input/AC→expected_ac/type+priority→custom', () => {
    const res = datasetFromCompleted(backlogDir, { limit: 5 });
    const row = res.rows.find(r => r.task_id === 'tst-1');
    assert.ok(row, `tst-1 должен попасть в выборку, получено: ${res.taskIds.join(', ')}`);
    assert.match(row.input, /Готовая задача/);
    assert.match(row.input, /Описание готовой задачи/);
    assert.match(row.expected_ac, /Первый критерий/);
    assert.match(row.expected_ac, /Второй критерий/);
    assert.equal(row.custom.type, 'feature');
    assert.equal(row.custom.priority, 'High');
  });

  it('не-Done задачи не попадают в датасет', () => {
    const res = datasetFromCompleted(backlogDir, { limit: 50 });
    assert.ok(!res.taskIds.includes('tst-2'), 'In Progress не включается');
  });

  it('--limit ограничивает число строк, total показывает полное', () => {
    const all = datasetFromCompleted(backlogDir, { limit: 50 });
    const limited = datasetFromCompleted(backlogDir, { limit: 1 });
    assert.equal(limited.rows.length, 1);
    assert.equal(limited.total, all.total);
    assert.ok(all.total >= 2);
  });

  it('по умолчанию лимит = DEFAULT_COMPLETED_LIMIT (20)', () => {
    const res = datasetFromCompleted(backlogDir);
    assert.ok(res.rows.length <= DEFAULT_COMPLETED_LIMIT);
  });
});

// ── Список и запись общих датасетов ──

describe('VL-295 — listDatasets / writeSharedDataset', () => {
  it('listDatasets помечает происхождение (общий/частный) и считает строки', () => {
    const items = listDatasets(backlogDir);
    const shared = items.find(i => i.name === 'only-shared');
    assert.equal(shared.origin, 'shared');
    assert.equal(shared.rows, 1);
    const priv = items.find(i => i.name === 'only-private');
    assert.equal(priv.origin, 'private');
    assert.equal(priv.expId, 'exp-p1');
  });

  it('listDatasets с expId ограничивает частные одним экспериментом', () => {
    const items = listDatasets(backlogDir, 'exp-p1');
    assert.ok(items.every(i => i.origin === 'shared' || i.expId === 'exp-p1'));
    // Общий 'both' виден всегда, частный другого эксперимента (exp-both) — нет
    const bothItems = items.filter(i => i.name === 'both');
    assert.ok(bothItems.every(i => i.origin === 'shared'));
    assert.ok(!items.some(i => i.name === 'both' && i.expId === 'exp-both'));
  });

  it('writeSharedDataset создаёт файл, повтор без --force отклоняется', () => {
    const res = writeSharedDataset(backlogDir, 'written', [{ task_id: 'w1' }]);
    assert.ok(existsSync(res.path));
    assert.equal(res.created, true);
    assert.match(readFileSync(res.path, 'utf-8'), /"task_id":"w1"/);
    assert.throws(() => writeSharedDataset(backlogDir, 'written', []), /уже существует/);
    const forced = writeSharedDataset(backlogDir, 'written', [{ task_id: 'w2' }], { force: true });
    assert.equal(forced.created, false);
    assert.match(readFileSync(forced.path, 'utf-8'), /"task_id":"w2"/);
  });
});
