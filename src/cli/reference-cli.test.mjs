/**
 * Тесты VL-152 — CLI vibelog reference (все подкоманды).
 *
 * Спавнят CLI (bin/vibelog.mjs) во временном каталоге с backlog/.
 * Clone/sync — только локальный file://-репозиторий (без сети).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-reference-test-'));
const backlogDir = join(testRoot, 'backlog');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const remoteDir = join(testRoot, 'remote-src');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args, env = {}) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8',
    env: { ...gitEnv, VIBELOG_SKIP_UPDATE_CHECK: 'true', ...env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // Минимальный конфиг — нужен task create (тесты link)
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  mkdirSync(remoteDir, { recursive: true });
  writeFileSync(join(remoteDir, 'data.txt'), 'x\n');
  const git = (args) => {
    const res = spawnSync('git', args, { cwd: remoteDir, encoding: 'utf-8', env: gitEnv });
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  };
  git(['init']);
  git(['add', '.']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '--no-gpg-sign']);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-152 CLI — add/view/list/search', () => {
  it('add: без backlog → ошибка', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vl152-empty-'));
    try {
      const res = spawnSync('node', [cliPath, 'reference', 'list'], {
        cwd: empty, encoding: 'utf-8',
        env: { ...gitEnv, VIBELOG_SKIP_UPDATE_CHECK: 'true' },
      });
      assert.notEqual(res.status, 0);
      assert.match((res.stdout ?? '') + (res.stderr ?? ''), /Backlog не найден/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('add url-reference → view → list → search', () => {
    const add = runCli(['reference', 'add', 'Node fs API', '--type', 'url', '--url', 'https://nodejs.org/api/fs.html', '--tags', 'node,docs', '-d', 'Документация fs']);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /Reference ref-1 создан/);

    const view = runCli(['reference', 'view', 'ref-1']);
    assert.equal(view.status, 0);
    assert.match(view.stdout, /Node fs API/);
    assert.match(view.stdout, /url: https:\/\/nodejs\.org/);
    assert.match(view.stdout, /Документация fs/);

    const list = runCli(['reference', 'list']);
    assert.match(list.stdout, /ref-1\s+Node fs API/);

    const search = runCli(['reference', 'search', 'nodejs']);
    assert.match(search.stdout, /ref-1/);
  });

  it('list --type фильтрует; view несуществующего → exit 1', () => {
    runCli(['reference', 'add', 'Spec doc', '--type', 'spec', '--path', 'docs/spec.md']);
    const list = runCli(['reference', 'list', '--type', 'spec']);
    assert.match(list.stdout, /Spec doc/);
    assert.doesNotMatch(list.stdout, /Node fs API/);

    const missing = runCli(['reference', 'view', 'ref-999']);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout + missing.stderr, /не найден/);
  });

  it('add с невалидным типом → exit 1', () => {
    const res = runCli(['reference', 'add', 'Bad', '--type', 'nope']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /Недопустимый тип reference/);
  });
});

describe('VL-152 CLI — clone (add --type repo) и sync', () => {
  const url = 'file://' + remoteDir;

  it('add --type repo сам клонирует; --no-clone пропускает', () => {
    const add = runCli(['reference', 'add', 'Local repo', '--type', 'repo', '--url', url, '--path', 'data/cli-repo']);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /клонирован/);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-repo', 'data.txt')));

    const add2 = runCli(['reference', 'add', 'No clone repo', '--type', 'repo', '--url', url, '--path', 'data/cli-no-clone', '--no-clone']);
    assert.equal(add2.status, 0, add2.stderr);
    assert.ok(!existsSync(join(backlogDir, 'references', 'data', 'cli-no-clone')), 'клон не создан');
  });

  it('sync доклонировал отсутствующий и пропустил существующий', () => {
    const sync = runCli(['reference', 'sync']);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, /Клонировано: 1, пропущено: 1, ошибок: 0/);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-no-clone', 'data.txt')));
  });

  it('повторный add идемпотентен (уже клонирован → пропуск)', () => {
    const add = runCli(['reference', 'add', 'Local repo again', '--type', 'repo', '--url', url, '--path', 'data/cli-repo']);
    assert.equal(add.status, 0);
    assert.match(add.stdout, /уже клонирован/);
  });
});

describe('VL-152 CLI — link и remove', () => {
  it('link: двусторонняя связь с задачей; --remove отвязывает', () => {
    runCli(['task', 'create', 'Задача CLI-связи']);
    const list = runCli(['task', 'list', '--json']);
    const tasks = JSON.parse(list.stdout).data;
    const taskId = tasks[0].id;

    const link = runCli(['reference', 'link', 'ref-1', taskId]);
    assert.equal(link.status, 0, link.stderr);
    assert.match(link.stdout, /связан/);

    const view = runCli(['reference', 'view', 'ref-1']);
    assert.match(view.stdout, new RegExp(`linked_tasks: ${taskId}`));

    const unlink = runCli(['reference', 'link', 'ref-1', taskId, '--remove']);
    assert.equal(unlink.status, 0);
    const view2 = runCli(['reference', 'view', 'ref-1']);
    assert.match(view2.stdout, /linked_tasks: \(нет\)/);
  });

  it('link несуществующего reference → exit 1', () => {
    const res = runCli(['reference', 'link', 'ref-999', 'VL-1']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /не найден/);
  });

  it('remove: удаляет метаданные, клон в data/ сохраняется', () => {
    const rm = runCli(['reference', 'remove', 'ref-2']);
    assert.equal(rm.status, 0, rm.stderr);
    const view = runCli(['reference', 'view', 'ref-2']);
    assert.equal(view.status, 1);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-repo', 'data.txt')), 'клон сохранён');
  });
});
