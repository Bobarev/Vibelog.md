/**
 * Тесты VL-278 — общий хелпер «нужен ли worktree» и подъём worktree на пути
 * СОЗДАНИЯ задачи.
 *
 * Проверяем расхождение, из-за которого задача, созданная сразу в статусе
 * Planned через чат, оставалась без ветки vb/<id> и worktree (инцидент
 * VL-277: code шёл в главном дереве, close — без merge-шага):
 *
 * - `shouldEnsureWorktree` — единое условие и для оркестратора, и для создания;
 * - `ensureWorktreeOnCreate` — тот же набор шагов, что у запуска plan
 *   (worktree + симлинки), fail-open при ошибке git.
 *
 * Тестовые каталоги — mkdtemp (VL-241), реальный git изолирован ISO_ENV
 * (паттерн worktree.test.mjs / git.test.mjs).
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureWorktreeOnCreate,
  shouldEnsureWorktree,
  taskBranchName,
  taskWorktreeDir,
} from '../../dist/core/worktree.js';
import { createTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';

// GIT_CONFIG_GLOBAL=/dev/null изолирует тесты от глобального git-конфига
const ISO_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

const repos = [];
afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

/** Пишет backlog/config.yml (минимальный валидный конфиг проекта). */
function writeConfig(root) {
  mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
  const config = {
    project_name: 'Worktree Trigger Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore', 'epic'],
    definition_of_done: ['Тесты проходят'],
  };
  writeFileSync(join(root, 'backlog', 'config.yml'), stringifyYaml(config), 'utf-8');
}

/** Пишет .vibelog/settings.json с включённым/выключенным branch_mode. */
function writeBranchMode(root, enabled) {
  mkdirSync(join(root, '.vibelog'), { recursive: true });
  writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ branch_mode: enabled }), 'utf-8');
}

/** Temp git-репо с одним коммитом и backlog (HEAD обязателен для worktree add). */
function makeRepo(prefix, { branchMode = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  repos.push(root);
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: ISO_ENV });
  git('init');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'README.md'), 'init\n', 'utf-8');
  // .vibelog/ в .gitignore — как в реальном проекте
  writeFileSync(join(root, '.gitignore'), '.vibelog/\n', 'utf-8');
  git('add', '-A');
  git('commit', '-m', 'init');
  writeConfig(root);
  writeBranchMode(root, branchMode);
  return { root, git };
}

describe('shouldEnsureWorktree — единое условие (VL-278)', () => {
  it('AC1: статус Planned + branch-mode + фаза create → worktree нужен', () => {
    const { root } = makeRepo('vibelog-wt-trigger-planned-');
    const task = createTaskFile(root, { id: 'VL-1', title: 'Planned-задача', status: 'Planned' });
    assert.equal(task.status, 'Planned');
    assert.equal(shouldEnsureWorktree(root, 'VL-1', { kind: 'create', status: 'Planned' }), true);
  });

  it('AC2: branch-mode выключен → worktree не нужен ни на create, ни на фазе plan', () => {
    const { root } = makeRepo('vibelog-wt-trigger-off-', { branchMode: false });
    createTaskFile(root, { id: 'VL-2', title: 'Без режима веток', status: 'Planned' });
    assert.equal(shouldEnsureWorktree(root, 'VL-2', { kind: 'create', status: 'Planned' }), false);
    assert.equal(shouldEnsureWorktree(root, 'VL-2', { kind: 'phase', phase: 'plan' }), false);
  });

  it('AC3: epic в Planned → worktree не создаётся (как и на фазе plan)', () => {
    const { root } = makeRepo('vibelog-wt-trigger-epic-');
    createTaskFile(root, { id: 'VL-3', title: 'Эпик', status: 'Planned', type: 'epic' });
    assert.equal(shouldEnsureWorktree(root, 'VL-3', { kind: 'create', status: 'Planned' }), false);
    assert.equal(shouldEnsureWorktree(root, 'VL-3', { kind: 'phase', phase: 'plan' }), false);
  });

  it('фаза plan/do → нужен, прочие фазы без готового worktree → нет', () => {
    const { root } = makeRepo('vibelog-wt-trigger-phases-');
    createTaskFile(root, { id: 'VL-4', title: 'Обычная задача', status: 'Spec' });
    assert.equal(shouldEnsureWorktree(root, 'VL-4', { kind: 'phase', phase: 'plan' }), true);
    assert.equal(shouldEnsureWorktree(root, 'VL-4', { kind: 'phase', phase: 'do' }), true);
    assert.equal(shouldEnsureWorktree(root, 'VL-4', { kind: 'phase', phase: 'code' }), false);
    assert.equal(shouldEnsureWorktree(root, 'VL-4', { kind: 'phase', phase: 'spec' }), false);
  });

  it('статус из середины цепочки (Spec/To Do) при создании worktree не поднимает', () => {
    const { root } = makeRepo('vibelog-wt-trigger-spec-');
    createTaskFile(root, { id: 'VL-5', title: 'Spec-задача', status: 'Spec' });
    assert.equal(shouldEnsureWorktree(root, 'VL-5', { kind: 'create', status: 'Spec' }), false);
    createTaskFile(root, { id: 'VL-6', title: 'To Do-задача' });
    assert.equal(shouldEnsureWorktree(root, 'VL-6', { kind: 'create', status: 'To Do' }), false);
  });
});

describe('ensureWorktreeOnCreate — fail-open подъём worktree (VL-278)', () => {
  it('AC1/AC5: создаёт ветку vb/<id>, worktree и симлинки dev-зависимостей', () => {
    const { root, git } = makeRepo('vibelog-wt-create-ok-');
    // dev-каталоги главного репо, которые должны появиться симлинками
    mkdirSync(join(root, 'node_modules', 'dummy-pkg'), { recursive: true });
    mkdirSync(join(root, 'backlog', 'references', 'data', 'Backlog.md'), { recursive: true });

    createTaskFile(root, { id: 'VL-7', title: 'Planned сразу', status: 'Planned' });
    const res = ensureWorktreeOnCreate(root, 'VL-7', 'Planned');

    const dir = taskWorktreeDir(root, 'VL-7');
    assert.equal(res.worktreePath, dir);
    assert.equal(res.warning, undefined);
    assert.ok(existsSync(join(dir, '.git')), 'worktree создан');
    const branch = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf-8', env: ISO_ENV });
    assert.equal(branch.stdout.trim(), taskBranchName('VL-7'));
    // AC5: симлинки dev-зависимостей на месте
    for (const name of ['node_modules', join('backlog', 'references', 'data')]) {
      const link = join(dir, name);
      assert.ok(lstatSync(link).isSymbolicLink(), `${name} — симлинк в свежем worktree`);
      assert.equal(readlinkSync(link), join(root, name));
    }
    // ветка зарегистрирована в главном репо
    assert.equal(git('rev-parse', '--verify', '--quiet', 'refs/heads/vb/vl-7').status, 0);
  });

  it('AC2: branch-mode выключен → ни ветки, ни worktree', () => {
    const { root, git } = makeRepo('vibelog-wt-create-off-', { branchMode: false });
    createTaskFile(root, { id: 'VL-8', title: 'Без ветки', status: 'Planned' });
    const res = ensureWorktreeOnCreate(root, 'VL-8', 'Planned');
    assert.equal(res.worktreePath, null);
    assert.equal(res.warning, undefined);
    assert.ok(!existsSync(taskWorktreeDir(root, 'VL-8')));
    assert.notEqual(git('rev-parse', '--verify', '--quiet', 'refs/heads/vb/vl-8').status, 0);
  });

  it('AC3: epic → worktree не создаётся', () => {
    const { root } = makeRepo('vibelog-wt-create-epic-');
    createTaskFile(root, { id: 'VL-9', title: 'Эпик', status: 'Planned', type: 'epic' });
    const res = ensureWorktreeOnCreate(root, 'VL-9', 'Planned');
    assert.equal(res.worktreePath, null);
    assert.ok(!existsSync(taskWorktreeDir(root, 'VL-9')));
  });

  it('AC6: ошибка git (не git-репозиторий) → warning, исключения нет', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-wt-create-nogit-'));
    repos.push(root);
    writeConfig(root);
    writeBranchMode(root, true);
    createTaskFile(root, { id: 'VL-10', title: 'Плана без git', status: 'Planned' });
    const res = ensureWorktreeOnCreate(root, 'VL-10', 'Planned');
    assert.equal(res.worktreePath, null);
    assert.match(res.warning ?? '', /worktree для неё не создан/);
    // задача при этом жива — fail-open
    assert.ok(existsSync(join(root, 'backlog', 'tasks')));
  });
});

describe('backlog_create_task поднимает worktree (VL-278, AC7)', () => {
  it('AC1/AC7: создание в Planned при branch-mode → ветка vb/<id>, worktree в ответе', async () => {
    const { root, git } = makeRepo('vibelog-wt-mcp-create-');
    const out = await handleToolCall('backlog_create_task', { title: 'Planned из чата', status: 'Planned' }, root);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true);
    assert.match(ack.message, /создана/);
    const id = ack.applied.id;
    const dir = taskWorktreeDir(root, id);
    assert.equal(ack.applied.worktree, dir, 'ответ сообщает путь worktree');
    assert.ok(existsSync(join(dir, '.git')), 'worktree существует');
    const branch = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf-8', env: ISO_ENV });
    assert.equal(branch.stdout.trim(), taskBranchName(id));
    assert.equal(git('rev-parse', '--verify', '--quiet', `refs/heads/${taskBranchName(id)}`).status, 0);
  });

  it('AC2: создание в Planned без branch-mode → worktree нет, поле worktree отсутствует', async () => {
    const { root } = makeRepo('vibelog-wt-mcp-off-', { branchMode: false });
    const out = await handleToolCall('backlog_create_task', { title: 'Без режима', status: 'Planned' }, root);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.worktree, undefined);
    assert.ok(!existsSync(taskWorktreeDir(root, ack.applied.id)));
  });

  it('AC6: ошибка git не роняет создание задачи — предупреждение в сообщении', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vibelog-wt-mcp-nogit-'));
    repos.push(root);
    writeConfig(root);
    writeBranchMode(root, true);
    const out = await handleToolCall('backlog_create_task', { title: 'Без git', status: 'Planned' }, root);
    const ack = JSON.parse(out);
    assert.equal(ack.ok, true);
    assert.match(ack.message, /worktree для неё не создан/);
    assert.match(ack.message, /создана/);
    assert.ok(!existsSync(taskWorktreeDir(root, ack.applied.id)));
  });
});
