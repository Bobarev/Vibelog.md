/**
 * Интеграционные тесты git-шага `vibelog init` (VL-348).
 *
 * Спавнит реальный CLI в mkdtemp-каталоге (env только через `testSpawnEnv()` —
 * VL-286: иначе `VIBELOG_CWD` агентской сессии уводит CLI на главный
 * репозиторий). Проверяется главное обещание задачи: после `init --git-init`
 * репозиторий есть, коммит один, а `.env` в индексе отсутствует.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-init-git-'));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/** Чистая директория теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Запуск CLI в тестовом каталоге: { out, code }. */
function runCli(...args) {
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 60000,
    env: testSpawnEnv(),
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

/** Запуск git в тестовом каталоге: { status, stdout }. */
function git(...args) {
  const res = spawnSync('git', args, { cwd: testDir, encoding: 'utf-8' });
  return { status: res.status, stdout: (res.stdout ?? '').trim() };
}

describe('VL-348 — git-шаг vibelog init', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC1/AC3/AC5/AC6: init --yes --git-init создаёт репозиторий, один коммит без .env', () => {
    const { out, code } = runCli('init', 'GitProj', '--prefix', 'gp', '--yes', '--git-init');
    assert.equal(code, 0, out);

    // Репозиторий и ветка main
    assert.equal(git('rev-parse', '--is-inside-work-tree').stdout, 'true');
    assert.equal(git('symbolic-ref', '--short', 'HEAD').stdout, 'main');
    // Ровно один коммит
    assert.equal(git('rev-list', '--count', 'HEAD').stdout, '1');

    // Политика на месте
    assert.ok(existsSync(join(testDir, '.gitignore')), 'корневой .gitignore создан');
    assert.ok(existsSync(join(testDir, '.vibelog', '.gitignore')), '.vibelog/.gitignore создан');

    // Отслеживаются нужные файлы, .env — нет
    const tracked = git('ls-files').stdout.split('\n').filter((l) => l !== '');
    assert.ok(tracked.includes('AGENTS.md'), tracked.join(','));
    assert.ok(tracked.includes('.vibelog/settings.json'), tracked.join(','));
    assert.ok(tracked.includes('.vibelog/.gitignore'), tracked.join(','));
    assert.ok(tracked.some((p) => p.startsWith('backlog/')), tracked.join(','));
    assert.ok(!tracked.includes('.env'), '.env не должен попасть в коммит');

    // Вывод сообщает о git-шаге
    assert.ok(out.includes('репозиторий инициализирован'), out);
    assert.ok(out.includes('первый коммит'), out);
  });

  it('AC6: .env с секретом не попадает в индекс даже при наличии файла', () => {
    writeFileSync(join(testDir, '.env'), 'TELEGRAM_BOT_TOKEN=secret\n', 'utf-8');
    const { code } = runCli('init', 'EnvProj', '--prefix', 'ep', '--yes', '--git-init');
    assert.equal(code, 0);
    const tracked = git('ls-files').stdout.split('\n');
    assert.ok(!tracked.includes('.env'), 'секрет не должен попасть в коммит');
    // Файл на месте (init его не удаляет)
    assert.ok(existsSync(join(testDir, '.env')));
  });

  it('AC7: --git-remote добавляет origin', () => {
    const { code } = runCli(
      'init',
      'RemoteProj',
      '--prefix',
      'rp',
      '--yes',
      '--git-init',
      '--git-remote',
      'git@localhost:a/b.git',
    );
    assert.equal(code, 0);
    assert.ok(git('remote', '-v').stdout.includes('git@localhost:a/b.git'));
  });

  it('AC9: --git-init и --no-git-init взаимоисключающие → код 1', () => {
    const { out, code } = runCli(
      'init',
      'BothProj',
      '--prefix',
      'bp',
      '--yes',
      '--git-init',
      '--no-git-init',
    );
    assert.equal(code, 1, out);
    assert.ok(out.includes('взаимоисключающие'), out);
    assert.ok(!existsSync(join(testDir, '.git')), 'репозиторий не создан');
  });

  it('AC9: --no-git-init не инициализирует репозиторий', () => {
    const { code } = runCli('init', 'NoGit', '--prefix', 'ng', '--yes', '--no-git-init');
    assert.equal(code, 0);
    assert.ok(!existsSync(join(testDir, '.git')), 'репозиторий не создан');
    // Политика при этом записана — она не зависит от git-шага
    assert.ok(existsSync(join(testDir, '.gitignore')));
  });

  it('AC10: --yes без --git-init вне git — предупреждение и код 0', () => {
    const { out, code } = runCli('init', 'PlainProj', '--prefix', 'pp', '--yes');
    assert.equal(code, 0, out);
    assert.ok(!existsSync(join(testDir, '.git')), 'репозиторий не создан');
    assert.ok(out.includes('не в git'), out);
    assert.ok(out.includes('.env'), out);
  });

  it('AC8: внутри существующего репозитория git-шаг не выполняется', () => {
    spawnSync('git', ['init', '-q'], { cwd: testDir, stdio: 'ignore' });
    const { out, code } = runCli('init', 'InRepo', '--prefix', 'ir', '--yes', '--git-init');
    assert.equal(code, 0, out);
    // Коммита нет: репозиторий уже был, add -A в чужой истории не делаем
    assert.equal(git('rev-list', '--count', 'HEAD').status, 128, 'коммитов быть не должно');
    assert.ok(out.includes('уже существует'), out);
  });

  it('AC12: doctor на созданном проекте зелёный по git-политике', () => {
    runCli('init', 'DocProj', '--prefix', 'dp', '--yes', '--git-init');
    const { out } = runCli('doctor', '--json');
    const json = JSON.parse(out.slice(out.indexOf('{')));
    const byName = new Map(json.checks.map((c) => [c.name, c]));
    assert.equal(byName.get('root_gitignore_exists').ok, true, 'корневой .gitignore есть');
    assert.equal(byName.get('vibelog_gitignore').ok, true, '.vibelog/.gitignore есть');
    assert.equal(byName.get('env_ignored').ok, true, '.env игнорируется');
    assert.equal(byName.get('vibelog_settings_tracked').ok, true, 'settings.json в git');
  });

  it('AC2: повторный init не меняет .gitignore байт-в-байт', () => {
    runCli('init', 'IdemProj', '--prefix', 'ip', '--yes', '--git-init');
    const first = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    runCli('init', '--mode', 'upgrade', '--yes', '--agents', '', '--git-init');
    assert.equal(readFileSync(join(testDir, '.gitignore'), 'utf-8'), first);
  });
});
