/**
 * Тесты VL-13 — CLI vibelog draft.
 *
 * Проверяет:
 * - create/list/view/edit: черновики в backlog/drafts/ (id draft-N, статус Draft)
 * - promote: задача в backlog/tasks/ с префиксом конфига, черновик удалён
 * - archive: перенос в completed/
 * - Ошибки: без заголовка, несуществующий id
 *
 * Паттерн config-cli.test.mjs: testDir в /tmp, spawnSync со слиянием
 * stdout/stderr, проверка содержимого не exit code.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-draft-cli-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const draftsDirPath = join(testDir, 'backlog', 'drafts');
const tasksDirPath = join(testDir, 'backlog', 'tasks');
const completedDirPath = join(testDir, 'backlog', 'completed');

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  runCli('init', 'Draft CLI', '--prefix', 'dr');
}

function cleanup() {
  rmSync(testDir, { recursive: true, force: true });
}

function runCli(...args) {
  // spawnSync + слияние stdout/stderr (ошибки CLI в stderr при exit 0)
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir, encoding: 'utf-8', timeout: 5000,
  });
  return (r.stdout || '') + (r.stderr || '');
}

/** Файлы черновиков с id из имени. */
function draftFiles() {
  return existsSync(draftsDirPath) ? readdirSync(draftsDirPath).filter(f => f.endsWith('.md')) : [];
}

describe('VL-13 — CLI draft', () => {
  after(() => cleanup());

  it('create/list/view/edit', () => {
    fresh();
    let out = runCli('draft', 'create', 'Идея фичи', '-d', 'Описание идеи', '-l', 'idea,backlog');
    assert.ok(out.includes('draft-1') && out.includes('создан'), `create: ${out}`);
    assert.equal(draftFiles().length, 1);

    out = runCli('draft', 'list');
    assert.ok(out.includes('draft-1') && out.includes('Идея фичи'), `list: ${out}`);

    out = runCli('draft', 'view', 'draft-1');
    assert.ok(out.includes('Draft') && out.includes('Описание идеи') && out.includes('idea, backlog'), `view: ${out}`);

    out = runCli('draft', 'edit', 'draft-1', '--title', 'Идея (уточнена)', '-d', 'Новое описание');
    assert.ok(out.includes('обновлён'), `edit: ${out}`);
    out = runCli('draft', 'view', 'draft-1');
    assert.ok(out.includes('Идея (уточнена)') && out.includes('Новое описание'), `view2: ${out}`);
  });

  it('promote: задача в tasks/, черновик удалён', () => {
    fresh();
    runCli('draft', 'create', 'Промо-идея', '-d', 'Описание');
    let out = runCli('draft', 'promote', 'draft-1');
    assert.ok(out.includes('dr-1') && out.includes('задача'), `promote: ${out}`);

    // Задача создана с префиксом конфига и default_status
    const taskFiles = readdirSync(tasksDirPath).filter(f => f.endsWith('.md'));
    assert.equal(taskFiles.length, 1);
    const content = readFileSync(join(tasksDirPath, taskFiles[0]), 'utf-8');
    assert.ok(content.includes('id: dr-1'), content.slice(0, 120));
    assert.ok(content.includes('Промо-идея'));

    // Черновик удалён
    assert.equal(draftFiles().length, 0, 'черновик должен быть удалён');
  });

  it('archive: перенос в completed/', () => {
    fresh();
    runCli('draft', 'create', 'Архивная идея');
    const out = runCli('draft', 'archive', 'draft-1');
    assert.ok(out.includes('архивирован'), `archive: ${out}`);
    assert.equal(draftFiles().length, 0);
    const doneFiles = readdirSync(completedDirPath).filter(f => f.endsWith('.md'));
    assert.equal(doneFiles.length, 1);
    assert.ok(doneFiles[0].includes('draft-1'), doneFiles[0]);
  });

  it('ошибки: без заголовка, несуществующий id', () => {
    fresh();
    let out = runCli('draft', 'create');
    assert.ok(out.includes('Укажите заголовок'), `create без заголовка: ${out}`);

    out = runCli('draft', 'view', 'draft-99');
    assert.ok(out.includes('не найден'), `view: ${out}`);

    out = runCli('draft', 'promote', 'draft-99');
    assert.ok(out.includes('не найден'), `promote: ${out}`);

    out = runCli('draft', 'archive', 'draft-99');
    assert.ok(out.includes('не найден'), `archive: ${out}`);
  });

  it('help показывает draft-команды', () => {
    const out = runCli('draft', '--help');
    assert.ok(out.includes('promote') && out.includes('archive'), `help: ${out}`);
  });
});
