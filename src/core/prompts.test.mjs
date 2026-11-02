/**
 * Тесты VL-296 — резолв промптов вариантов (doc-21 §4, §6).
 *
 * Проверяется главное отличие от датасетов: `builtin:<phase>` в файловой
 * системе НЕ ищется, а отдаётся текстом шаблона фазы (с приоритетом
 * `.vibelog/prompts/phases/` проекта).
 *
 * Временный каталог — mkdtemp (VL-241/lesson-89).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolvePrompt, resolveVariantPrompts, isBuiltinPrompt, BUILTIN_PREFIX,
} from '../../dist/core/prompts.js';

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-prompts-'));
const backlogDir = join(testRoot, 'backlog');

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  mkdirSync(join(backlogDir, 'experiments', 'prompts'), { recursive: true });
  mkdirSync(join(backlogDir, 'experiments', 'exp-1', 'prompts'), { recursive: true });
  writeFileSync(join(backlogDir, 'experiments', 'prompts', 'variant-b.md'), '# общий variant-b\n', 'utf-8');
  writeFileSync(join(backlogDir, 'experiments', 'prompts', 'only-shared.md'), '# только общий\n', 'utf-8');
  writeFileSync(join(backlogDir, 'experiments', 'exp-1', 'prompts', 'variant-b.md'), '# частный variant-b\n', 'utf-8');
  writeFileSync(join(backlogDir, 'experiments', 'exp-1', 'prompts', 'only-private.md'), '# только частный\n', 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-296 — resolvePrompt: частный → общий', () => {
  it('частный файл побеждает общий и даёт warning с затенённым путём', () => {
    const res = resolvePrompt(backlogDir, 'exp-1', 'variant-b', { silent: true });
    assert.equal(res.kind, 'private');
    assert.equal(res.text, '# частный variant-b\n');
    assert.equal(res.resolution.chosen, 'private');
    assert.equal(res.resolution.shadowed, 'experiments/prompts/variant-b.md');
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /затеняет/);
  });

  it('только общий — без warning, chosen=shared', () => {
    const res = resolvePrompt(backlogDir, 'exp-1', 'only-shared', { silent: true });
    assert.equal(res.kind, 'shared');
    assert.deepEqual(res.warnings, []);
    assert.equal(res.resolution.chosen, 'shared');
  });

  it('только частный — без warning (штатное переопределение)', () => {
    const res = resolvePrompt(backlogDir, 'exp-1', 'only-private', { silent: true });
    assert.equal(res.kind, 'private');
    assert.deepEqual(res.warnings, []);
  });

  it('не найден нигде — ошибка с перечнем проверенных путей', () => {
    assert.throws(
      () => resolvePrompt(backlogDir, 'exp-1', 'nope', { silent: true }),
      /Проверены пути: .*exp-1\/prompts\/nope\.md.*experiments\/prompts\/nope\.md/s
    );
  });

  it('escape hatch --*-prompt-path перебивает резолв полностью', () => {
    const custom = join(testRoot, 'custom-prompt.md');
    writeFileSync(custom, '# escape hatch\n', 'utf-8');
    const res = resolvePrompt(backlogDir, 'exp-1', 'variant-b', { explicitPath: custom, silent: true });
    assert.equal(res.kind, 'explicit');
    assert.equal(res.text, '# escape hatch\n');
    assert.equal(res.resolution.chosen, 'explicit');
    // общий файл того же имени остался в тени — об этом warning
    assert.equal(res.warnings.length, 1);
    assert.match(res.warnings[0], /перебивает резолв/);
  });
});

describe('VL-296 — resolvePrompt: builtin:<phase>', () => {
  it('isBuiltinPrompt распознаёт префикс', () => {
    assert.equal(BUILTIN_PREFIX, 'builtin:');
    assert.equal(isBuiltinPrompt('builtin:spec'), true);
    assert.equal(isBuiltinPrompt('phase-spec'), false);
  });

  it('builtin:spec отдаёт текст шаблона фазы, ФС для имени не опрашивается', () => {
    const res = resolvePrompt(backlogDir, 'exp-1', 'builtin:spec', { silent: true });
    assert.equal(res.kind, 'builtin');
    assert.equal(res.phase, 'spec');
    assert.equal(res.resolution.chosen, 'builtin');
    assert.ok(res.text.length > 0, 'текст шаблона непустой');
    // Шаблон фазы содержит подстановку {{taskId}} — по ней видно, что это шаблон
    assert.match(res.text, /\{\{taskId\}\}/);
    assert.equal(res.absolutePath, undefined, 'файл в prompts/ не искался');
  });

  it('неизвестная фаза — ошибка со списком доступных', () => {
    assert.throws(
      () => resolvePrompt(backlogDir, 'exp-1', 'builtin:nope', { silent: true }),
      /Неизвестная фаза в builtin:nope\. Доступные фазы: spec, plan, code/
    );
  });

  it('пустая фаза builtin: — понятная ошибка', () => {
    assert.throws(() => resolvePrompt(backlogDir, 'exp-1', 'builtin:', { silent: true }), /Пустое имя фазы/);
  });

  it('переопределение проекта .vibelog/prompts/phases приоритетнее встроенного', () => {
    const overrideRoot = join(testRoot, 'proj-override');
    mkdirSync(join(overrideRoot, '.vibelog', 'prompts', 'phases'), { recursive: true });
    writeFileSync(
      join(overrideRoot, '.vibelog', 'prompts', 'phases', 'phase-spec.md'),
      '# проектный spec {{taskId}}\n',
      'utf-8'
    );
    const res = resolvePrompt(backlogDir, 'exp-1', 'builtin:spec', { silent: true, cwd: overrideRoot });
    assert.equal(res.kind, 'builtin');
    assert.equal(res.text, '# проектный spec {{taskId}}\n');
  });
});

describe('VL-296 — resolveVariantPrompts', () => {
  it('резолвит все варианты; ошибка одного не ломает остальные', () => {
    const out = resolveVariantPrompts(backlogDir, 'exp-1', {
      A: { prompt: 'builtin:spec' },
      B: { prompt: 'variant-b' },
      C: { prompt: 'nope' },
    }, { silent: true });
    assert.equal(out.A.resolved.kind, 'builtin');
    assert.equal(out.B.resolved.kind, 'private');
    assert.match(out.C.error, /не найден/);
  });
});
