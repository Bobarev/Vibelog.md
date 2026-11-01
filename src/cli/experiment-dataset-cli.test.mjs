/**
 * Тесты VL-295 — CLI `vibelog experiment dataset` (create / list / view / резолв).
 *
 * Спавнят реальный CLI (bin/vibelog.mjs) в mkdtemp-каталоге с backlog/;
 * env собирается через testSpawnEnv (VL-286), иначе наследуется
 * VIBELOG_CWD агентской сессии и CLI уходит на главный репозиторий.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-dataset-cli-'));
const backlogDir = join(testRoot, 'backlog');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8', env: testSpawnEnv(),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  writeFileSync(join(backlogDir, 'tasks', 'tst-1 - Готовая.md'), [
    '---',
    'id: tst-1',
    'title: Готовая задача',
    'status: Done',
    'priority: High',
    'type: feature',
    "created_date: '2026-01-01 10:00'",
    "updated_date: '2026-01-05 10:00'",
    '---',
    '',
    '## Description',
    '<!-- SECTION:DESCRIPTION:BEGIN -->',
    'Описание готовой задачи',
    '<!-- SECTION:DESCRIPTION:END -->',
    '',
    '## Acceptance Criteria',
    '<!-- AC:BEGIN -->',
    '- [x] #1 Критерий готовой задачи',
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
    "updated_date: '2026-01-06 10:00'",
    '---',
    '',
    '## Description',
    'Незавершённая',
  ].join('\n'), 'utf-8');
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-295 — CLI experiment dataset create', () => {
  it('create без флагов: пустой общий файл + печать шаблона строки', () => {
    const res = runCli(['experiment', 'dataset', 'create', 'manual-one']);
    assert.equal(res.status, 0, res.stderr);
    const path = join(backlogDir, 'experiments', 'datasets', 'manual-one.jsonl');
    assert.ok(existsSync(path), 'файл создан');
    assert.equal(readFileSync(path, 'utf-8'), '');
    assert.match(res.stdout, /task_id/, 'напечатан шаблон строки');
  });

  it('create существующего файла: отказ без --force, перезапись с --force', () => {
    const res = runCli(['experiment', 'dataset', 'create', 'manual-one']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /уже существует/);
    const forced = runCli(['experiment', 'dataset', 'create', 'manual-one', '--force']);
    assert.equal(forced.status, 0, forced.stderr);
  });

  it('create --from-completed: строки из Done-задач, task_id/title→input/AC→expected_ac', () => {
    const res = runCli(['experiment', 'dataset', 'create', 'from-done', '--from-completed']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /Собрано строк/);
    const path = join(backlogDir, 'experiments', 'datasets', 'from-done.jsonl');
    const lines = readFileSync(path, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 1, 'только Done-задача попала в датасет');
    assert.equal(lines[0].task_id, 'tst-1');
    assert.match(lines[0].input, /Готовая задача/);
    assert.match(lines[0].expected_ac, /Критерий готовой задачи/);
    assert.equal(lines[0].custom.priority, 'High');
  });

  it('create --from-completed --limit 1: одна строка', () => {
    const res = runCli(['experiment', 'dataset', 'create', 'limited', '--from-completed', '--limit', '1']);
    assert.equal(res.status, 0, res.stderr);
    const raw = readFileSync(join(backlogDir, 'experiments', 'datasets', 'limited.jsonl'), 'utf-8');
    assert.equal(raw.trim().split('\n').length, 1);
  });

  it('create --from-completed при отсутствии Done-задач: ошибка', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'vibelog-dataset-cli-empty-'));
    try {
      mkdirSync(join(emptyRoot, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(emptyRoot, 'backlog', 'config.yml'), stringifyYaml({
        project_name: 'E', task_prefix: 'e', default_status: 'To Do',
        statuses: ['To Do', 'Done'], definition_of_done: [],
      }), 'utf-8');
      const res = spawnSync('node', [cliPath, 'experiment', 'dataset', 'create', 'x', '--from-completed'], {
        cwd: emptyRoot, encoding: 'utf-8', env: testSpawnEnv(),
      });
      assert.equal(res.status, 1);
      assert.match(res.stderr ?? '', /Завершённых задач/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('VL-295 — CLI experiment dataset list / view', () => {
  it('list: показывает общий датасет с пометкой происхождения', () => {
    const res = runCli(['experiment', 'dataset', 'list']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /from-done/);
    assert.match(res.stdout, /общий/);
    assert.match(res.stdout, /датасетов:/);
  });

  it('list: частный датасет помечен экспериментом', () => {
    const privPath = join(backlogDir, 'experiments', 'exp-1', 'datasets', 'private-one.jsonl');
    mkdirSync(join(privPath, '..'), { recursive: true });
    writeFileSync(privPath, '{"task_id": "p1", "expected_ac": "частный"}\n', 'utf-8');
    const res = runCli(['experiment', 'dataset', 'list']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /private-one/);
    assert.match(res.stdout, /частный exp-1/);
  });

  it('view: валидный датасет — число строк и task_id, exit 0', () => {
    const res = runCli(['experiment', 'dataset', 'view', 'from-done']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /валидных строк 1, ошибок 0/);
    assert.match(res.stdout, /task_id: tst-1/);
  });

  it('view: битые строки и дубликат — в stderr, exit 1', () => {
    const path = join(backlogDir, 'experiments', 'datasets', 'broken.jsonl');
    writeFileSync(path, [
      '{"task_id": "a"}',
      'битая строка',
      '{"task_id": "a"}',
      '{"expected_ac": "без ключа"}',
      '{"task_id": "b", "expected": "синоним"}',
    ].join('\n'), 'utf-8');
    const res = runCli(['experiment', 'dataset', 'view', 'broken']);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /валидных строк 2, ошибок 3/);
    assert.match(res.stderr, /битый JSON/);
    assert.match(res.stderr, /дубликат task_id "a"/);
    assert.match(res.stderr, /expected устарело/);
  });

  it('view несуществующего датасета: понятная ошибка', () => {
    const res = runCli(['experiment', 'dataset', 'view', 'nope']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /не найден/);
  });

  it('view --exp: берёт частный датасет эксперимента', () => {
    const res = runCli(['experiment', 'dataset', 'view', 'private-one', '--exp', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /task_id: p1/);
  });
});

describe('VL-295 — CLI experiment dataset <exp-id> (резолв)', () => {
  it('резолв частного датасета по dataset из карточки эксперимента', () => {
    const create = runCli(['experiment', 'create', 'Датасетный', '--dataset', 'private-one']);
    assert.equal(create.status, 0, create.stderr);
    const res = runCli(['experiment', 'dataset', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /выбран: private/);
    assert.match(res.stdout, /resolution: \{"dataset":\{"chosen":"private"/);
    assert.match(res.stdout, /task_id: p1/);
  });

  it('коллизия частный/общий: warning в stderr и shadowed в выводе', () => {
    // Общий файл с тем же именем — частный его затеняет
    writeFileSync(
      join(backlogDir, 'experiments', 'datasets', 'private-one.jsonl'),
      '{"task_id": "shared-p1"}\n',
      'utf-8'
    );
    const res = runCli(['experiment', 'dataset', 'exp-1']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /затенён: experiments\/datasets\/private-one\.jsonl/);
    assert.match(res.stderr, /затеняет общий/);
  });

  it('--dataset-path перебивает резолв', () => {
    const custom = join(testRoot, 'custom-path.jsonl');
    writeFileSync(custom, '{"task_id": "explicit-1"}\n', 'utf-8');
    const res = runCli(['experiment', 'dataset', 'exp-1', '--dataset-path', custom]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /выбран: explicit/);
    assert.match(res.stdout, /task_id: explicit-1/);
  });

  it('эксперимент без dataset: подсказка, exit 1', () => {
    runCli(['experiment', 'create', 'Без датасета']);
    const res = runCli(['experiment', 'dataset', 'exp-2']);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /не указан dataset/);
  });
});
