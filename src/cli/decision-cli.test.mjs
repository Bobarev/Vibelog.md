/**
 * Тесты VL-14 — CLI vibelog decision (ADR).
 *
 * Проверяет:
 * - create: дефолтный статус proposed, -s accepted, ADR-секции в файле
 * - list: все решения + фильтр --status
 * - view: карточка + тело
 * - Ошибки: без заголовка, несуществующий id
 *
 * Паттерн draft-cli.test.mjs: testDir в /tmp, spawnSync со слиянием
 * stdout/stderr, проверка содержимого не exit code.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = '/tmp/vibelog-decision-cli-test';
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const decisionsDirPath = join(testDir, 'backlog', 'decisions');

function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  runCli('init', 'Decision CLI', '--prefix', 'dc');
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

function decisionFiles() {
  return existsSync(decisionsDirPath) ? readdirSync(decisionsDirPath).filter(f => f.endsWith('.md')) : [];
}

describe('VL-14 — CLI decision', () => {
  after(() => cleanup());

  it('create: дефолт proposed, -s accepted, ADR-секции в файле', () => {
    fresh();
    let out = runCli('decision', 'create', 'Перейти на pnpm', '--context', 'Зависимости', '--decision', 'Использовать pnpm');
    assert.ok(out.includes('decision-1') && out.includes('proposed'), `create: ${out}`);

    out = runCli('decision', 'create', 'Отказ от SQLite', '-s', 'accepted', '--consequences', 'Нет нативных зависимостей');
    assert.ok(out.includes('decision-2') && out.includes('accepted'), `create2: ${out}`);

    assert.equal(decisionFiles().length, 2);
    const content = readFileSync(join(decisionsDirPath, decisionFiles()[0]), 'utf-8');
    assert.ok(content.includes('status: proposed'), content.slice(0, 120));
    assert.ok(content.includes('## Context') && content.includes('Зависимости'), 'ADR-секции');
    assert.ok(content.includes('## Decision') && content.includes('Использовать pnpm'));
  });

  it('list: все решения + фильтр --status', () => {
    fresh();
    runCli('decision', 'create', 'Решение А', '-s', 'accepted');
    runCli('decision', 'create', 'Решение Б');

    let out = runCli('decision', 'list');
    assert.ok(out.includes('Решение А') && out.includes('Решение Б'), `list: ${out}`);

    out = runCli('decision', 'list', '--status', 'accepted');
    assert.ok(out.includes('Решение А') && !out.includes('Решение Б'), `list filter: ${out}`);

    out = runCli('decision', 'list', '--status', 'superseded');
    assert.ok(out.includes('нет'), `list empty: ${out}`);
  });

  it('view: карточка + ADR-тело', () => {
    fresh();
    runCli('decision', 'create', 'ADR-просмотр', '-s', 'accepted', '--context', 'Контекст X', '--decision', 'Решение Y');
    const out = runCli('decision', 'view', 'decision-1');
    assert.ok(out.includes('ADR-просмотр') && out.includes('accepted'), `view card: ${out}`);
    assert.ok(out.includes('## Context') && out.includes('Контекст X'), `view context: ${out}`);
    assert.ok(out.includes('## Decision') && out.includes('Решение Y'), `view decision: ${out}`);
  });

  it('ошибки: без заголовка, несуществующий id', () => {
    fresh();
    let out = runCli('decision', 'create');
    assert.ok(out.includes('Укажите заголовок'), `create: ${out}`);

    out = runCli('decision', 'view', 'decision-99');
    assert.ok(out.includes('не найдено'), `view: ${out}`);
  });

  it('help показывает decision-команды', () => {
    const out = runCli('decision', '--help');
    assert.ok(out.includes('proposed') && out.includes('--status'), `help: ${out}`);
  });
});
