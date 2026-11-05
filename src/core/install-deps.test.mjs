/**
 * Тесты сверки npm-зависимостей (VL-338, doc-25 §4.3 шаг 6).
 *
 * Модуль чистый (файлы + инъекция раннера), поэтому тесты не спавнят CLI и не
 * ходят в сеть: пакетный менеджер подменяется функцией-раннером, а проект —
 * mkdtemp-каталогом (VL-241: фиксированные пути запрещены).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectPackageManager,
  formatCommand,
  installCommand,
  missingDeps,
  readProjectDeps,
  runDepsInstall,
} from '../../dist/core/install-deps.js';

const testDir = mkdtempSync(join(tmpdir(), 'vibelog-install-deps-'));

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Кладёт файл в тестовый проект. */
function touch(name, content = '') {
  writeFileSync(join(testDir, name), content, 'utf-8');
}

describe('detectPackageManager', () => {
  it('определяет менеджер по каждому lock-файлу', () => {
    const cases = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['package-lock.json', 'npm'],
      ['bun.lockb', 'bun'],
      ['bun.lock', 'bun'],
      ['yarn.lock', 'yarn'],
    ];
    for (const [file, pm] of cases) {
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(testDir, { recursive: true });
      touch(file);
      assert.equal(detectPackageManager(testDir), pm, file);
    }
  });

  it('несколько lock-файлов — приоритет pnpm → bun → yarn → npm', () => {
    touch('package-lock.json');
    touch('yarn.lock');
    assert.equal(detectPackageManager(testDir), 'yarn');
    touch('bun.lockb');
    assert.equal(detectPackageManager(testDir), 'bun');
    touch('pnpm-lock.yaml');
    assert.equal(detectPackageManager(testDir), 'pnpm');
  });

  it('ни одного lock-файла — npm', () => {
    assert.equal(detectPackageManager(testDir), 'npm');
  });
});

describe('installCommand', () => {
  it('строит массив аргументов для каждого менеджера', () => {
    assert.deepEqual(installCommand('pnpm', ['clsx']), ['pnpm', 'add', 'clsx']);
    assert.deepEqual(installCommand('npm', ['clsx', 'tailwind-merge']), [
      'npm',
      'install',
      'clsx',
      'tailwind-merge',
    ]);
    assert.deepEqual(installCommand('bun', ['clsx']), ['bun', 'add', 'clsx']);
    assert.deepEqual(installCommand('yarn', ['clsx']), ['yarn', 'add', 'clsx']);
    assert.equal(formatCommand(['pnpm', 'add', 'clsx']), 'pnpm add clsx');
  });
});

describe('readProjectDeps / missingDeps', () => {
  it('объединяет dependencies и devDependencies', () => {
    touch(
      'package.json',
      JSON.stringify({ dependencies: { clsx: '^2.0.0' }, devDependencies: { vitest: '^1.0.0' } }),
    );
    const deps = readProjectDeps(testDir);
    assert.ok(deps.has('clsx'));
    assert.ok(deps.has('vitest'));
    assert.equal(deps.size, 2);
  });

  it('package.json без dependencies — пустое множество', () => {
    touch('package.json', JSON.stringify({ name: 'x' }));
    assert.equal(readProjectDeps(testDir).size, 0);
  });

  it('package.json отсутствует — пустое множество, не ошибка', () => {
    assert.equal(readProjectDeps(testDir).size, 0);
  });

  it('битый package.json — пустое множество (не падаем)', () => {
    touch('package.json', '{ не json');
    assert.equal(readProjectDeps(testDir).size, 0);
  });

  it('missingDeps: все отсутствуют, часть есть, порядок объявления сохранён', () => {
    const item = { dependencies: ['clsx', 'tailwind-merge', 'zod'] };
    assert.deepEqual(missingDeps(item, new Set()), ['clsx', 'tailwind-merge', 'zod']);
    assert.deepEqual(missingDeps(item, new Set(['tailwind-merge'])), ['clsx', 'zod']);
    assert.deepEqual(missingDeps(item, new Set(['clsx', 'tailwind-merge', 'zod'])), []);
  });
});

describe('runDepsInstall', () => {  it('успешный запуск: команда и менеджер в результате', () => {
    const calls = [];
    const runner = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return { status: 0 };
    };
    const res = runDepsInstall('pnpm', ['clsx'], testDir, runner);
    assert.equal(res.ok, true);
    assert.equal(res.pm, 'pnpm');
    assert.deepEqual(res.command, ['pnpm', 'add', 'clsx']);
    assert.deepEqual(calls, [{ command: 'pnpm', args: ['add', 'clsx'], cwd: testDir }]);
  });

  it('ненулевой код — ok:false, ошибка не бросается', () => {
    const res = runDepsInstall('npm', ['clsx'], testDir, () => ({ status: 1 }));
    assert.equal(res.ok, false);
    assert.equal(res.pm, 'npm');
  });

  it('ENOENT — fallback на npm с пометкой fallbackFrom', () => {
    const seen = [];
    const runner = (command, args) => {
      seen.push(command);
      if (command === 'pnpm') {
        const err = new Error('spawn pnpm ENOENT');
        err.code = 'ENOENT';
        return { status: null, error: err };
      }
      return { status: 0 };
    };
    const res = runDepsInstall('pnpm', ['clsx'], testDir, runner);
    assert.equal(res.ok, true);
    assert.equal(res.pm, 'npm');
    assert.equal(res.fallbackFrom, 'pnpm');
    assert.deepEqual(res.command, ['npm', 'install', 'clsx']);
    assert.deepEqual(seen, ['pnpm', 'npm']);
  });
});
