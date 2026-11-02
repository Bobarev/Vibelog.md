/**
 * Тесты VL-296 — results.jsonl (doc-21 §7): upsert по (task_id, variant)
 * и атомарная перезапись файла.
 *
 * Временный каталог — mkdtemp (VL-241/lesson-89): фиксированные пути при
 * параллельных прогонах в разных worktree затирают друг друга.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseResultsJsonl, readResultsFile, upsertResult, serializeResultsJsonl,
  rewriteResultsJsonl, appendResultsJsonl, resultKey, resultsPath,
  normalizeResultRow, RESULT_ERROR_KINDS,
} from '../../dist/core/results.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-results-'));
const runDir = join(testRoot, 'run-1');

beforeAll(() => {
  mkdirSync(runDir, { recursive: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-296 — разбор results.jsonl', () => {
  it('валидные строки читаются, пустые строки пропускаются', () => {
    const text = [
      '{"task_id":"t1","variant":"A","score":7}',
      '',
      '{"task_id":"t1","variant":"B","score":null,"error":"timeout 120s","error_kind":"timeout","duration_ms":120000}',
      '',
    ].join('\n');
    const parsed = parseResultsJsonl(text);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].score, 7);
    assert.equal(parsed.rows[1].score, null);
    assert.equal(parsed.rows[1].error_kind, 'timeout');
    assert.equal(parsed.rows[1].duration_ms, 120000);
  });

  it('битый JSON и отсутствие обязательных полей — ошибки, не исключение', () => {
    const text = [
      '{битый',
      '{"variant":"A","score":1}',
      '{"task_id":"t2","score":1}',
      '{"task_id":"t3","variant":"A","score":"abc"}',
      '{"task_id":"t4","variant":"A","score":3}',
    ].join('\n');
    const parsed = parseResultsJsonl(text);
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.errors.map(e => e.kind), ['json', 'task_id-missing', 'variant-missing', 'score-type']);
  });

  it('дубликат пары (task_id, variant) — побеждает последняя строка', () => {
    const text = [
      '{"task_id":"t1","variant":"A","score":1}',
      '{"task_id":"t1","variant":"A","score":9}',
    ].join('\n');
    const parsed = parseResultsJsonl(text);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].score, 9);
  });

  it('usage/tool_calls/cost/custom сохраняются', () => {
    const text = '{"task_id":"t1","variant":"A","score":1,"tool_calls":23,"usage":{"input":12000,"total":12800,"requests":4},"cost":0.0123,"custom":{"language":"ts"}}';
    const row = parseResultsJsonl(text).rows[0];
    assert.equal(row.tool_calls, 23);
    assert.equal(row.usage.total, 12800);
    assert.equal(row.cost, 0.0123);
    assert.deepEqual(row.custom, { language: 'ts' });
  });

  it('RESULT_ERROR_KINDS соответствует doc-21 §7', () => {
    assert.deepEqual([...RESULT_ERROR_KINDS], ['timeout', 'api', 'runner', 'judge', 'interrupted']);
  });

  it('normalizeResultRow: пустой score → null, лишние поля отбрасываются молча', () => {
    const ok = normalizeResultRow({ task_id: 't1', variant: 'A', unknown: 'x' });
    assert.ok('row' in ok);
    assert.equal(ok.row.score, null);
    assert.equal(ok.row.unknown, undefined);
    const bad = normalizeResultRow({ variant: 'A' });
    assert.ok('error' in bad);
    assert.equal(bad.error.kind, 'task_id-missing');
  });
});

describe('VL-296 — upsert и атомарная перезапись', () => {
  it('upsertResult: новая строка добавляется, повторная — перезаписывает на месте', () => {
    let rows = [];
    rows = upsertResult(rows, { task_id: 't1', variant: 'A', score: 5 });
    rows = upsertResult(rows, { task_id: 't1', variant: 'B', score: 6 });
    rows = upsertResult(rows, { task_id: 't2', variant: 'A', score: 7 });
    assert.equal(rows.length, 3);
    rows = upsertResult(rows, { task_id: 't1', variant: 'A', score: 9 });
    assert.equal(rows.length, 3, 'upsert не дублирует пару');
    assert.equal(rows[0].score, 9, 'перезапись на прежней позиции (диффы точечные)');
    assert.equal(resultKey(rows[1]), resultKey({ task_id: 't1', variant: 'B' }));
  });

  it('upsertResult не мутирует входной массив', () => {
    const original = [{ task_id: 't1', variant: 'A', score: 1 }];
    const next = upsertResult(original, { task_id: 't2', variant: 'A', score: 2 });
    assert.equal(original.length, 1);
    assert.equal(next.length, 2);
  });

  it('rewriteResultsJsonl: файл перезаписан целиком, temp-файлов не осталось', () => {
    const path = resultsPath(runDir);
    const rows = [
      { task_id: 't1', variant: 'A', score: 1 },
      { task_id: 't1', variant: 'B', score: 2 },
    ];
    rewriteResultsJsonl(path, rows);
    const content = readFileSync(path, 'utf-8');
    assert.equal(content.split('\n').filter(l => l !== '').length, 2);
    assert.deepEqual(readResultsFile(path).rows, rows);
    // temp-файл лежит в том же каталоге и должен быть переименован, а не оставлен
    const leftovers = readdirSync(runDir).filter(f => f.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  });

  it('rewrite пустого набора очищает файл (не оставляет битую строку)', () => {
    const path = resultsPath(runDir);
    rewriteResultsJsonl(path, []);
    assert.equal(readFileSync(path, 'utf-8'), '');
    assert.deepEqual(readResultsFile(path).rows, []);
  });

  it('appendResultsJsonl дописывает строку; readResultsFile отсутствующего файла — пусто', () => {
    const path = join(testRoot, 'run-append', 'results.jsonl');
    mkdirSync(join(testRoot, 'run-append'), { recursive: true });
    assert.deepEqual(readResultsFile(path).rows, []);
    appendResultsJsonl(path, { task_id: 't1', variant: 'A', score: 1 });
    appendResultsJsonl(path, { task_id: 't2', variant: 'A', score: 2 });
    assert.equal(readResultsFile(path).rows.length, 2);
  });

  it('serializeResultsJsonl: по строке на запись, перевод строки в конце', () => {
    const text = serializeResultsJsonl([{ task_id: 't1', variant: 'A', score: 1 }]);
    assert.ok(text.endsWith('\n'));
    assert.equal(text.trimEnd().split('\n').length, 1);
    assert.equal(serializeResultsJsonl([]), '');
  });

  it('перезапись после ручного append-мусора: битые строки теряются, валидные остаются', () => {
    const path = join(testRoot, 'run-dirty', 'results.jsonl');
    mkdirSync(join(testRoot, 'run-dirty'), { recursive: true });
    writeFileSync(path, '{"task_id":"t1","variant":"A","score":1}\n{битый\n', 'utf-8');
    const existing = readResultsFile(path);
    assert.equal(existing.rows.length, 1);
    assert.equal(existing.errors.length, 1);
    rewriteResultsJsonl(path, existing.rows);
    assert.equal(readResultsFile(path).errors.length, 0);
  });
});
