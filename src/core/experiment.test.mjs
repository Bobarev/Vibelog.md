/**
 * Тесты VL-294 — модель экспериментов (backlog/experiments/exp-<id>.md).
 *
 * Временный каталог — mkdtemp (VL-241/lesson-89): фиксированные пути
 * при параллельных прогонах в разных worktree затирают друг друга.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SCHEMA_VERSION, EXPERIMENT_STATUSES,
  experimentFilename, createExperiment, parseExperimentMarkdown,
  experimentToMarkdown, nextExperimentId, listExperiments, getExperiment,
  writeExperiment, normalizeExperimentStatus,
} from '../../dist/core/experiment.js';
import {
  experimentsDir, experimentsDatasetsDir, experimentsPromptsDir, experimentRunsDir,
} from '../../dist/core/paths.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-'));
const backlogDir = join(testRoot, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// ── Пути ──

describe('VL-294 — пути experiments', () => {
  it('experimentsDir / datasets / prompts / runs', () => {
    assert.equal(experimentsDir(backlogDir), join(backlogDir, 'experiments'));
    assert.equal(experimentsDatasetsDir(backlogDir), join(backlogDir, 'experiments', 'datasets'));
    assert.equal(experimentsPromptsDir(backlogDir), join(backlogDir, 'experiments', 'prompts'));
    assert.equal(experimentRunsDir(backlogDir, 'exp-1'), join(backlogDir, 'experiments', 'exp-1'));
  });
});

// ── Карточка: константы, id, filename ──

describe('VL-294 — карточка эксперимента', () => {
  it('SCHEMA_VERSION = 1, статусы из doc-21', () => {
    assert.equal(SCHEMA_VERSION, 1);
    assert.deepEqual(EXPERIMENT_STATUSES, ['draft', 'running', 'completed', 'failed']);
    assert.equal(normalizeExperimentStatus('COMPLETED'), 'completed');
    assert.throws(() => normalizeExperimentStatus('banana'), /Недопустимый статус эксперимента/);
  });

  it('experimentFilename: exp-<id>.md без slug', () => {
    assert.equal(experimentFilename('exp-1'), 'exp-1.md');
    assert.equal(experimentFilename('exp-42'), 'exp-42.md');
  });

  it('nextExperimentId: max+1, посторонние id игнорируются', () => {
    const entries = [
      { experiment: { id: 'exp-2' } },
      { experiment: { id: 'exp-10' } },
      { experiment: { id: 'notes' } },
      { experiment: { id: '' } },
    ];
    assert.equal(nextExperimentId(entries), 'exp-11');
    assert.equal(nextExperimentId([]), 'exp-1');
  });
});

// ── Round-trip ──

describe('VL-294 — round-trip frontmatter', () => {
  it('metrics и variants сохраняются без потери', () => {
    const exp = createExperiment({
      id: 'exp-1',
      title: 'Варианты промпта фазы architect',
      dataset: 'prompts-baseline',
      runner: 'manual',
      metrics: { score_field: 'quality', higher_is_better: false, baseline: 'B', custom: ['tokens', 'latency_ms'] },
      variants: {
        A: { label: 'текущий промпт', prompt: 'phase-architect' },
        B: { label: 'новый промпт', prompt: 'builtin:spec', model: 'prov/model-a', params: { temperature: 0.2 } },
      },
      created_date: '2026-11-02',
    });
    const md = experimentToMarkdown(exp, '# Описание\n');
    const parsed = parseExperimentMarkdown(md);

    assert.deepEqual(parsed.experiment.metrics, {
      score_field: 'quality',
      higher_is_better: false,
      baseline: 'B',
      custom: ['tokens', 'latency_ms'],
    });
    assert.deepEqual(parsed.experiment.variants.A, { prompt: 'phase-architect', label: 'текущий промпт' });
    assert.equal(parsed.experiment.variants.B.prompt, 'builtin:spec');
    assert.equal(parsed.experiment.variants.B.model, 'prov/model-a');
    assert.equal(parsed.experiment.variants.B.params.temperature, 0.2);
    assert.equal(parsed.experiment.status, 'draft');
    assert.equal(parsed.experiment.schema_version, 1);
    assert.equal(parsed.experiment.dataset, 'prompts-baseline');
    assert.equal(parsed.experiment.runner, 'manual');
    assert.equal(parsed.experiment.created_date, '2026-11-02');
    assert.equal(parsed.body, '# Описание\n');
  });

  it('judge сохраняется round-trip (схема фиксируется до VL-298)', () => {
    const exp = createExperiment({
      id: 'exp-2',
      title: 'С judge',
      created_date: '2026-11-02',
      judge: {
        enabled: true, model: 'prov/judge', prompt: 'judge-v1',
        scale: 'numeric', score_min: 1, score_max: 10,
      },
      variants: { A: { prompt: 'builtin:spec' }, B: { prompt: 'builtin:plan' } },
    });
    const parsed = parseExperimentMarkdown(experimentToMarkdown(exp));
    assert.deepEqual(parsed.experiment.judge, {
      enabled: true, model: 'prov/judge', prompt: 'judge-v1',
      scale: 'numeric', score_min: 1, score_max: 10,
    });
  });

  it('без judge ключ не пишется и не появляется при разборе', () => {
    const exp = createExperiment({ id: 'exp-3', title: 'Без judge', created_date: '2026-11-02' });
    const md = experimentToMarkdown(exp);
    assert.ok(!md.includes('judge:'));
    assert.equal(parseExperimentMarkdown(md).experiment.judge, undefined);
  });

  it('дефолты metrics/runner/status соответствуют doc-21 §4', () => {
    const exp = createExperiment({ title: 'Дефолты' });
    assert.equal(exp.status, 'draft');
    assert.equal(exp.runner, 'manual');
    assert.deepEqual(exp.metrics, { score_field: 'score', higher_is_better: true, baseline: 'A', custom: [] });
    assert.deepEqual(exp.variants, {});
  });

  it('pass_fail judge: score_max по умолчанию 1', () => {
    const exp = createExperiment({ title: 'pass_fail', judge: { enabled: true, scale: 'pass_fail' } });
    assert.equal(exp.judge.scale, 'pass_fail');
    assert.equal(exp.judge.score_min, 1);
    assert.equal(exp.judge.score_max, 1);
  });

  it('сокращённая запись варианта скаляром A: builtin:spec', () => {
    const content = [
      '---',
      'id: exp-9',
      'title: Скаляр',
      'status: draft',
      'schema_version: 1',
      'variants:',
      '  A: builtin:spec',
      'created_date: 2026-11-02',
      'updated_date: 2026-11-02',
      '---',
      '',
    ].join('\n');
    const parsed = parseExperimentMarkdown(content);
    assert.equal(parsed.experiment.variants.A.prompt, 'builtin:spec');
  });
});

// ── Файлы: list/get/write ──

describe('VL-294 — чтение и запись в backlog/experiments/', () => {
  it('writeExperiment → файл на месте, listExperiments находит, getExperiment по id', () => {
    const exp = writeExperiment(backlogDir, {
      title: 'Первый эксперимент',
      dataset: 'ds-1',
      variants: { A: { prompt: 'builtin:spec' }, B: { prompt: 'builtin:plan' } },
    });
    assert.equal(exp.id, 'exp-1');
    const path = join(backlogDir, 'experiments', 'exp-1.md');
    assert.ok(existsSync(path));
    const raw = readFileSync(path, 'utf-8');
    assert.ok(raw.startsWith('---\n'));
    assert.ok(raw.includes('id: exp-1'));

    const listed = listExperiments(backlogDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].experiment.title, 'Первый эксперимент');
    assert.deepEqual(getExperiment(backlogDir, 'EXP-1').experiment.variants.B, { prompt: 'builtin:plan' });
    assert.equal(getExperiment(backlogDir, 'exp-404'), null);
  });

  it('неэкспериментальные md в каталоге игнорируются (id-нумерация не сбивается)', () => {
    mkdirSync(join(backlogDir, 'experiments'), { recursive: true });
    writeFileSync(join(backlogDir, 'experiments', 'README.md'), '# Служебный файл\n', 'utf-8');
    writeFileSync(join(backlogDir, 'experiments', 'notes.md'), '---\ntitle: Заметки\n---\n', 'utf-8');
    const listed = listExperiments(backlogDir);
    assert.equal(listed.length, 1);
    const second = writeExperiment(backlogDir, { title: 'Второй' });
    assert.equal(second.id, 'exp-2');
    assert.deepEqual(listExperiments(backlogDir).map(e => e.experiment.id), ['exp-1', 'exp-2']);
  });

  it('listExperiments на отсутствующем каталоге → []', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'vibelog-experiment-empty-'));
    try {
      assert.deepEqual(listExperiments(join(emptyRoot, 'backlog')), []);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
