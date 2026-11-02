/**
 * Тесты VL-294 — модель экспериментов (backlog/experiments/exp-<id>.md).
 *
 * Временный каталог — mkdtemp (VL-241/lesson-89): фиксированные пути
 * при параллельных прогонах в разных worktree затирают друг друга.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SCHEMA_VERSION, EXPERIMENT_STATUSES,
  experimentFilename, createExperiment, parseExperimentMarkdown,
  experimentToMarkdown, nextExperimentId, listExperiments, getExperiment,
  writeExperiment, normalizeExperimentStatus,
  nextRunNumber, createRunDir, listRunNumbers, latestRunNumber, runDirFor,
  writeMetaJson, readMetaJson, detectStaleRun, recoverRun, syncExperimentStatus,
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

/* ── Прогоны (VL-296, doc-21 §8) ── */

describe('VL-296 — прогоны: номера и атомарное создание каталога', () => {
  it('nextRunNumber = max+1, непустые имена игнорируются', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-runs-next-'));
    try {
      const runsDir = join(root, 'exp-x');
      assert.equal(nextRunNumber(runsDir), 1, 'нет каталога → run-1');
      mkdirSync(join(runsDir, 'run-1'), { recursive: true });
      mkdirSync(join(runsDir, 'run-5'), { recursive: true });
      mkdirSync(join(runsDir, 'run-broken'), { recursive: true });
      mkdirSync(join(runsDir, 'datasets'), { recursive: true });
      writeFileSync(join(runsDir, 'README.md'), '# не каталог\n', 'utf-8');
      assert.deepEqual(listRunNumbers(runsDir), [1, 5]);
      assert.equal(nextRunNumber(runsDir), 6, 'max+1, а не count+1 (дырка run-2..4 не переиспользуется)');
      assert.equal(latestRunNumber(backlogDir, 'exp-no-runs'), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('createRunDir: первый run-1, второй run-2, каталоги раздельные', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-runs-create-'));
    try {
      const first = createRunDir(join(root, 'backlog'), 'exp-9');
      assert.equal(first.run, 1);
      assert.ok(existsSync(first.runDir));
      const second = createRunDir(join(root, 'backlog'), 'exp-9');
      assert.equal(second.run, 2);
      assert.notEqual(first.runDir, second.runDir);
      assert.ok(existsSync(join(root, 'backlog', 'experiments', 'exp-9', 'run-1')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('createRunDir под гонкой: занятый номер пропускается (EEXIST → N+1)', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-runs-race-'));
    try {
      const runsDir = join(root, 'backlog', 'experiments', 'exp-3');
      mkdirSync(join(runsDir, 'run-1'), { recursive: true });
      // Имитация гонки: «сосед» уже занял run-2 между nextRunNumber и mkdir
      mkdirSync(join(runsDir, 'run-2'), { recursive: true });
      const created = createRunDir(join(root, 'backlog'), 'exp-3');
      assert.equal(created.run, 3, 'занятые номера не переиспользуются');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('VL-296 — meta.json и stale running', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-runs-meta-'));
  const rootBacklog = join(root, 'backlog');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeMeta(overrides = {}) {
    return {
      schema_version: 1,
      exp_id: 'exp-1',
      run: 1,
      status: 'running',
      runner: 'manual',
      started_at: '2026-11-02T10:00:00.000Z',
      finished_at: null,
      pid: null,
      resolution: {},
      results_ignored: false,
      n: 0,
      dropped: 0,
      cost_total: null,
      pricing_missing: true,
      rerun_of: null,
      reason: null,
      ...overrides,
    };
  }

  it('writeMetaJson/readMetaJson: round-trip, без temp-файлов', () => {
    const { runDir } = createRunDir(rootBacklog, 'exp-1');
    writeMetaJson(runDir, makeMeta());
    const meta = readMetaJson(runDir);
    assert.equal(meta.status, 'running');
    assert.equal(meta.exp_id, 'exp-1');
    assert.deepEqual(readdirSync(runDir).filter(f => f.includes('.tmp')), []);
  });

  it('readMetaJson: битый meta → null (лечится --recover), отсутствующий → null', () => {
    const { runDir } = createRunDir(rootBacklog, 'exp-1');
    writeFileSync(join(runDir, 'meta.json'), '{битый', 'utf-8');
    assert.equal(readMetaJson(runDir), null);
    assert.equal(readMetaJson(join(root, 'нет-такого')), null);
  });

  it('detectStaleRun: manual-ран (pid null) не зависший', () => {
    assert.deepEqual(detectStaleRun(makeMeta()), { stale: false, reason: '' });
    assert.equal(detectStaleRun(null).stale, false);
  });

  it('detectStaleRun: не жив pid → stale с причиной; completed/finished_at — нет', () => {
    // PID 4194303 почти гарантированно не существует (за пределами max pid)
    const deadPid = 4194303;
    const stale = detectStaleRun(makeMeta({ pid: deadPid }));
    assert.equal(stale.stale, true);
    assert.match(stale.reason, new RegExp(`процесс ${deadPid} не жив`));

    assert.equal(
      detectStaleRun(makeMeta({ pid: deadPid, finished_at: '2026-11-02T11:00:00.000Z' })).stale,
      false
    );
    assert.equal(detectStaleRun(makeMeta({ pid: deadPid, status: 'failed' })).stale, false);
  });

  it('detectStaleRun: живой pid (собственный процесс теста) — не завис', () => {
    assert.equal(detectStaleRun(makeMeta({ pid: process.pid })).stale, false);
  });

  it('recoverRun: зависший ран → failed, частичные results.jsonl сохранены', () => {
    const { run, runDir } = createRunDir(rootBacklog, 'exp-2');
    writeMetaJson(runDir, makeMeta({ exp_id: 'exp-2', run, pid: 4194303 }));
    writeFileSync(join(runDir, 'results.jsonl'), '{"task_id":"t1","variant":"A","score":5}\n', 'utf-8');

    const recovered = recoverRun(rootBacklog, 'exp-2', run);
    assert.equal(recovered.status, 'failed');
    assert.ok(recovered.finished_at, 'finished_at дописан');
    assert.match(recovered.reason, /не жив/);
    // Частичные результаты остались нетронутыми
    assert.match(readFileSync(join(runDir, 'results.jsonl'), 'utf-8'), /"score":5/);
    assert.equal(readMetaJson(runDir).status, 'failed');
  });

  it('recoverRun: не-running ран и независший pid → ошибка', () => {
    const { run, runDir } = createRunDir(rootBacklog, 'exp-3');
    writeMetaJson(runDir, makeMeta({
      exp_id: 'exp-3', run, status: 'completed', finished_at: '2026-11-02T11:00:00.000Z',
    }));
    assert.throws(() => recoverRun(rootBacklog, 'exp-3', run), /не в статусе running/);

    const second = createRunDir(rootBacklog, 'exp-3');
    writeMetaJson(second.runDir, makeMeta({ exp_id: 'exp-3', run: second.run, pid: process.pid }));
    assert.throws(() => recoverRun(rootBacklog, 'exp-3', second.run), /не завис/);
  });

  it('syncExperimentStatus: draft → running → failed переписывает карточку', () => {
    const exp = writeExperiment(rootBacklog, {
      title: 'Статусы прогонов',
      dataset: 'ds',
      variants: { A: { prompt: 'builtin:spec' }, B: { prompt: 'builtin:plan' } },
    });
    assert.equal(syncExperimentStatus(rootBacklog, exp.id), 'draft', 'без прогонов — draft');

    const { run, runDir } = createRunDir(rootBacklog, exp.id);
    writeMetaJson(runDir, makeMeta({ exp_id: exp.id, run, pid: 4194303 }));
    assert.equal(syncExperimentStatus(rootBacklog, exp.id), 'running');
    assert.equal(getExperiment(rootBacklog, exp.id).experiment.status, 'running');

    recoverRun(rootBacklog, exp.id, run);
    assert.equal(syncExperimentStatus(rootBacklog, exp.id), 'failed');
    assert.equal(getExperiment(rootBacklog, exp.id).experiment.status, 'failed');
  });

  it('runDirFor: путь run-<N> внутри каталога эксперимента', () => {
    assert.equal(
      runDirFor(backlogDir, 'exp-1', 3),
      join(backlogDir, 'experiments', 'exp-1', 'run-3')
    );
  });
});
