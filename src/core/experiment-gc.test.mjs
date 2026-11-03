/**
 * Тесты VL-301 — git-политика экспериментов (`src/core/experiment-gc.ts`).
 *
 * Проверяют порог «> 10 MB» (строгий `>`), сборку блока `.gitignore` с
 * маркерами по exp-id и идемпотентность применения: повторный `--apply` с тем
 * же набором кандидатов не меняет файл ни на байт (doc-21 §15).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findGcCandidates, buildGitignoreBlock, applyGitignoreBlock,
  gitignorePathFor, RESULTS_SIZE_LIMIT_BYTES,
} from '../../dist/core/experiment-gc.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-gc-'));
const backlogDir = join(testRoot, 'backlog');

/** Создаёт `results.jsonl` рана заданного размера (байт). */
function writeResults(expId, run, sizeBytes) {
  const dir = join(backlogDir, 'experiments', expId, `run-${run}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.jsonl'), 'x'.repeat(sizeBytes), 'utf-8');
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'experiments'), { recursive: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-301 — findGcCandidates', () => {
  it('порог строгий: файл ровно limit — не кандидат, limit+1 — кандидат', () => {
    writeResults('exp-1', 1, 100);
    writeResults('exp-1', 2, 101);
    const got = findGcCandidates(backlogDir, 'exp-1', 100);
    assert.equal(got.length, 1);
    assert.equal(got[0].run, 2);
    assert.equal(got[0].sizeBytes, 101);
  });

  it('путь и строка .gitignore в posix-виде, строка — каталог рана', () => {
    const got = findGcCandidates(backlogDir, 'exp-1', 100);
    assert.equal(got[0].relativePath, 'backlog/experiments/exp-1/run-2/results.jsonl');
    assert.equal(got[0].entry, 'backlog/experiments/exp-1/run-2/');
  });

  it('ран без results.jsonl и несуществующий эксперимент — пусто, без исключений', () => {
    mkdirSync(join(backlogDir, 'experiments', 'exp-1', 'run-3'), { recursive: true });
    assert.deepEqual(findGcCandidates(backlogDir, 'exp-1', 100).map(c => c.run), [2]);
    assert.deepEqual(findGcCandidates(backlogDir, 'exp-99'), []);
  });

  it('кандидаты отсортированы по номеру рана (стабильный порядок блока)', () => {
    writeResults('exp-2', 2, 200);
    writeResults('exp-2', 1, 200);
    const runs = findGcCandidates(backlogDir, 'exp-2', 100).map(c => c.run);
    assert.deepEqual(runs, [1, 2]);
  });

  it('дефолтный порог — 10 MB (константа из report.ts)', () => {
    assert.equal(RESULTS_SIZE_LIMIT_BYTES, 10 * 1024 * 1024);
    writeResults('exp-3', 1, RESULTS_SIZE_LIMIT_BYTES);
    assert.deepEqual(findGcCandidates(backlogDir, 'exp-3'), [], 'ровно 10 MB — не кандидат');
    writeResults('exp-3', 2, RESULTS_SIZE_LIMIT_BYTES + 1);
    assert.deepEqual(findGcCandidates(backlogDir, 'exp-3').map(c => c.run), [2]);
  });
});

describe('VL-301 — buildGitignoreBlock', () => {
  it('содержит маркеры с exp-id и строки кандидатов', () => {
    const block = buildGitignoreBlock('exp-7', ['backlog/experiments/exp-7/run-1/']);
    assert.match(block, /^# vibelog experiment exp-7: results\.jsonl > 10 MB/m);
    assert.match(block, /^backlog\/experiments\/exp-7\/run-1\/$/m);
    assert.match(block, /^# \/vibelog experiment exp-7$/m);
    assert.ok(block.endsWith('\n'));
  });

  it('пустой список даёт явную пометку вместо пустого блока', () => {
    assert.match(buildGitignoreBlock('exp-7', []), /# кандидатов нет/);
  });
});

describe('VL-301 — applyGitignoreBlock', () => {
  it('создаёт .gitignore, если файла нет', () => {
    const path = join(testRoot, 'case1', '.gitignore');
    mkdirSync(join(testRoot, 'case1'), { recursive: true });
    const res = applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-2/']);
    assert.deepEqual([res.ok, res.changed], [true, true]);
    const text = readFileSync(path, 'utf-8');
    assert.match(text, /exp-1\/run-2\//);
  });

  it('повторный вызов с тем же набором — changed: false, файл байт-в-байт', () => {
    const path = join(testRoot, 'case2', '.gitignore');
    mkdirSync(join(testRoot, 'case2'), { recursive: true });
    writeFileSync(path, 'node_modules\ndist\n', 'utf-8');
    const entries = ['backlog/experiments/exp-1/run-2/'];
    applyGitignoreBlock(path, 'exp-1', entries);
    const first = readFileSync(path, 'utf-8');
    const res = applyGitignoreBlock(path, 'exp-1', entries);
    assert.equal(res.changed, false, 'строки не должны дублироваться (AC2)');
    assert.equal(readFileSync(path, 'utf-8'), first);
    // Посторонние правила сохранены
    assert.match(first, /^node_modules$/m);
    assert.match(first, /^dist$/m);
    assert.equal(first.match(/run-2\//g).length, 1);
  });

  it('новый кандидат заменяет блок, старые строки не остаются', () => {
    const path = join(testRoot, 'case3', '.gitignore');
    mkdirSync(join(testRoot, 'case3'), { recursive: true });
    applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-2/']);
    const res = applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-4/']);
    assert.equal(res.changed, true);
    const text = readFileSync(path, 'utf-8');
    assert.doesNotMatch(text, /run-2\//);
    assert.match(text, /run-4\//);
  });

  it('кандидатов больше нет — устаревший блок удаляется, остальное сохраняется', () => {
    const path = join(testRoot, 'case4', '.gitignore');
    mkdirSync(join(testRoot, 'case4'), { recursive: true });
    writeFileSync(path, 'node_modules\n', 'utf-8');
    applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-2/']);
    const res = applyGitignoreBlock(path, 'exp-1', []);
    assert.deepEqual([res.ok, res.changed], [true, true]);
    assert.equal(readFileSync(path, 'utf-8'), 'node_modules\n');
  });

  it('два эксперимента — два независимых блока в одном файле', () => {
    const path = join(testRoot, 'case5', '.gitignore');
    mkdirSync(join(testRoot, 'case5'), { recursive: true });
    applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-1/']);
    applyGitignoreBlock(path, 'exp-2', ['backlog/experiments/exp-2/run-5/']);
    const text = readFileSync(path, 'utf-8');
    assert.match(text, /exp-1\/run-1\//);
    assert.match(text, /exp-2\/run-5\//);
    // Повторное применение первого блока не затирает второй
    const res = applyGitignoreBlock(path, 'exp-1', ['backlog/experiments/exp-1/run-1/']);
    assert.equal(res.changed, false);
    assert.match(readFileSync(path, 'utf-8'), /exp-2\/run-5\//);
  });

  it('gitignorePathFor — .gitignore рядом с backlog/, без подъёма по дереву', () => {
    assert.equal(gitignorePathFor('/project/backlog'), '/project/.gitignore');
    assert.equal(existsSync(gitignorePathFor(backlogDir)), false);
  });
});
