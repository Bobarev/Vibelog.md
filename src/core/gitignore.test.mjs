/**
 * Тесты git-политики проекта (VL-348): корневой `.gitignore` и
 * `.vibelog/.gitignore`.
 *
 * Проверяется главное свойство — идемпотентность и сохранность чужого
 * контента: `vb init` не имеет права переписывать чужой `.gitignore`, а
 * повторный прогон не должен менять файл ни на байт.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  GITIGNORE_BLOCK_END,
  GITIGNORE_BLOCK_START,
  ROOT_GITIGNORE_TEMPLATE,
  VIBELOG_GITIGNORE_TEMPLATE,
  mergeGitignore,
  vibelogGitignoreDiffers,
  writeRootGitignore,
  writeVibelogGitignore,
} from '../../dist/core/gitignore.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-gitignore-'));

/** Чистая директория теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** `git check-ignore -q <path>` в тестовом каталоге. */

describe('VL-348 — git-политика проекта', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC1: нет .gitignore → создаётся целиком с минимальным набором', () => {
    assert.equal(writeRootGitignore(testDir), 'created');
    const text = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    assert.equal(text, ROOT_GITIGNORE_TEMPLATE);
    for (const rule of [
      'node_modules/',
      'dist/',
      'backlog/references/data/',
      'backlog/references/cache/',
      '.env',
      '.DS_Store',
      '*.log',
    ]) {
      assert.ok(text.split('\n').includes(rule), `правило ${rule} отсутствует`);
    }
  });

  it('AC2: чужой .gitignore — дописаны только недостающие правила в блоке', () => {
    const foreign = '# мой файл\nbuild/\n.env\n';
    writeFileSync(join(testDir, '.gitignore'), foreign, 'utf-8');
    assert.equal(writeRootGitignore(testDir), 'updated');
    const text = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // Посторонние строки сохранены
    assert.ok(text.startsWith('# мой файл\nbuild/\n.env\n'), text);
    // Блок с маркерами есть, в нём только недостающие правила
    assert.ok(text.includes(GITIGNORE_BLOCK_START), text);
    assert.ok(text.includes(GITIGNORE_BLOCK_END), text);
    const block = text.slice(
      text.indexOf(GITIGNORE_BLOCK_START),
      text.indexOf(GITIGNORE_BLOCK_END),
    );
    assert.ok(block.includes('node_modules/'), block);
    assert.ok(block.includes('backlog/references/data/'), block);
    // `.env` уже был — не дублируется
    assert.equal(text.split('\n').filter((l) => l.trim() === '.env').length, 1, text);
    // Личные правила в чужой файл не навязываются
    assert.ok(!text.includes('.DS_Store'), text);
    assert.ok(!text.includes('*.log'), text);
  });

  it('AC2: повторный прогон идемпотентен байт-в-байт', () => {
    writeFileSync(join(testDir, '.gitignore'), 'build/\n', 'utf-8');
    writeRootGitignore(testDir);
    const first = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    assert.equal(writeRootGitignore(testDir), 'unchanged');
    assert.equal(readFileSync(join(testDir, '.gitignore'), 'utf-8'), first);
  });

  it('AC2: существующий блок дополняется на месте, порядок строк сохраняется', () => {
    const existing = `build/\n\n${GITIGNORE_BLOCK_START}\nnode_modules/\n${GITIGNORE_BLOCK_END}\n`;
    writeFileSync(join(testDir, '.gitignore'), existing, 'utf-8');
    writeRootGitignore(testDir);
    const text = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    assert.ok(text.startsWith('build/\n'), text);
    assert.ok(text.indexOf('node_modules/') < text.indexOf('dist/'), text);
    assert.equal(text.split(GITIGNORE_BLOCK_START).length, 2, 'блок не размножился');
  });

  it('mergeGitignore: пустой файл → правила без маркеров', () => {
    assert.equal(mergeGitignore('', ['a', 'b']), 'a\nb\n');
    assert.equal(mergeGitignore('', []), '');
  });

  it('AC3: .vibelog/.gitignore создаётся с политикой VL-329', () => {
    assert.equal(writeVibelogGitignore(testDir), 'created');
    const text = readFileSync(join(testDir, '.vibelog', '.gitignore'), 'utf-8');
    assert.equal(text, VIBELOG_GITIGNORE_TEMPLATE);
    for (const rule of [
      '*',
      '!*/',
      'worktrees/',
      'upstream-inbox/',
      '!.gitignore',
      '!config.json',
      '!installed.lock.json',
      '!settings.json',
      '!prompts/',
      '!prompts/**',
      '!billing/',
      '!billing/**',
    ]) {
      assert.ok(text.split('\n').includes(rule), `правило ${rule} отсутствует`);
    }
  });

  it('AC3: существующий .vibelog/.gitignore не перезаписывается', () => {
    mkdirSync(join(testDir, '.vibelog'), { recursive: true });
    writeFileSync(join(testDir, '.vibelog', '.gitignore'), '*\n!settings.json\n', 'utf-8');
    assert.equal(writeVibelogGitignore(testDir), 'exists');
    assert.equal(readFileSync(join(testDir, '.vibelog', '.gitignore'), 'utf-8'), '*\n!settings.json\n');
    // Расхождение с политикой видно вызывающему коду (предупреждение)
    assert.equal(vibelogGitignoreDiffers(testDir), true);
  });

  it('AC3: файл политики, совпадающий по правилам, расхождением не считается', () => {
    writeVibelogGitignore(testDir);
    assert.equal(vibelogGitignoreDiffers(testDir), false);
  });

  it('AC4: после init .env и клоны references вне git, settings.json и billing/ — в git', () => {
    spawnSync('git', ['init', '-q'], { cwd: testDir, stdio: 'ignore' });
    writeRootGitignore(testDir);
    writeVibelogGitignore(testDir);
    mkdirSync(join(testDir, '.vibelog', 'billing'), { recursive: true });
    writeFileSync(join(testDir, '.vibelog', 'billing', 'x.json'), '{}', 'utf-8');
    writeFileSync(join(testDir, '.vibelog', 'settings.json'), '{}', 'utf-8');
    mkdirSync(join(testDir, 'backlog', 'references', 'data'), { recursive: true });
    writeFileSync(join(testDir, 'backlog', 'references', 'data', 'x'), 'x', 'utf-8');
    writeFileSync(join(testDir, '.env'), 'A=1\n', 'utf-8');

    // `git check-ignore` сообщает и о совпадении с `!`-правилом, поэтому
    // политику проверяем по факту индексации — ровно то, что делает первый
    // коммит init (`git add -A`).
    spawnSync('git', ['add', '-A'], { cwd: testDir, stdio: 'ignore' });
    const tracked = spawnSync('git', ['ls-files'], { cwd: testDir, encoding: 'utf-8' })
      .stdout.split('\n')
      .filter((l) => l !== '');

    assert.ok(!tracked.includes('.env'), '.env не должен попасть в индекс');
    assert.ok(
      !tracked.includes('backlog/references/data/x'),
      'клоны references не должны попадать в индекс',
    );
    assert.ok(tracked.includes('.vibelog/settings.json'), 'settings.json должен быть в git');
    assert.ok(tracked.includes('.vibelog/billing/x.json'), 'billing/ должен быть в git');
    assert.ok(tracked.includes('.vibelog/.gitignore'), 'файл политики должен быть в git');
    assert.equal(existsSync(join(testDir, '.vibelog', '.gitignore')), true);
  });
});
