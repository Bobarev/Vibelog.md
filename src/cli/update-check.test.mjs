/**
 * Тесты VL-101 — проверка обновлений (уведомление без автоустановки).
 *
 * Все тесты на моках: exec/now/cachePath/readPackageInfo подменяются,
 * сеть не используется. Импорт — из dist/ (как в других тестах проекта).
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  compareVersions,
  fetchLatestVersion,
  shouldSkip,
  maybeNotifyUpdate,
  defaultCachePath,
} from '../../dist/cli/update-check.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PKG = { name: 'vibelog.md', version: '1.6.0' };

let cacheDir;
let cachePath;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'vibelog-uc-test-'));
  cachePath = join(cacheDir, 'cache.json');
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

/** Записывает кэш-файл вручную (для проверки TTL). */
function writeCache(entry) {
  writeFileSync(cachePath, JSON.stringify(entry), 'utf-8');
}

/** Мок console.error: собирает строки вместо вывода. */
function mockStderr() {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => {
    lines.push(args.join(' '));
  };
  return { lines, restore: () => { console.error = orig; } };
}

/** Мок exec: возвращает фиксированный stdout; фиксирует вызовы. */
function mockExec(stdout, opts = {}) {
  const calls = [];
  const fn = async (file, args) => {
    calls.push({ file, args });
    if (opts.reject) throw opts.reject;
    return { stdout, stderr: '' };
  };
  return { fn, calls };
}

describe('compareVersions — мини-semver', () => {
  it('равные версии → 0', () => {
    assert.equal(compareVersions('1.6.0', '1.6.0'), 0);
  });

  it('новее → >0', () => {
    assert.ok(compareVersions('1.7.0', '1.6.0') > 0);
    assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
    assert.ok(compareVersions('1.6.1', '1.6.0') > 0);
  });

  it('старее → <0', () => {
    assert.ok(compareVersions('1.5.0', '1.6.0') < 0);
    assert.ok(compareVersions('0.9.9', '1.0.0') < 0);
    assert.ok(compareVersions('1.6.0', '1.10.0') < 0);
  });

  it('prerelease старше релиза той же версии', () => {
    assert.ok(compareVersions('1.7.0-beta.1', '1.7.0') < 0);
    assert.ok(compareVersions('1.7.0', '1.7.0-beta.1') > 0);
  });

  it('prerelease сравнивается посимвольно', () => {
    assert.ok(compareVersions('1.7.0-beta', '1.7.0-alpha') > 0);
    assert.ok(compareVersions('1.7.0-rc.1', '1.7.0-rc.1') === 0);
  });

  it('кривой ввод → 0 (не новее, проверку не роняем)', () => {
    assert.equal(compareVersions('abc', '1.0.0'), 0);
    assert.equal(compareVersions('', '1.0.0'), 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  });
});

describe('fetchLatestVersion — парсинг npm view', () => {
  it('npm ≤11: голая JSON-строка', async () => {
    const exec = mockExec('"1.7.0"');
    const v = await fetchLatestVersion({ readPackageInfo: () => PKG, exec: exec.fn });
    assert.equal(v, '1.7.0');
    // Аргументы вызова: npm view vibelog.md version --json
    assert.equal(exec.calls[0].file, 'npm');
    assert.deepEqual(exec.calls[0].args, ['view', 'vibelog.md', 'version', '--json']);
  });

  it('npm 12+: массив с одним элементом', async () => {
    const v = await fetchLatestVersion({ readPackageInfo: () => PKG, exec: mockExec('["1.8.0"]').fn });
    assert.equal(v, '1.8.0');
  });

  it('пустой stdout → null', async () => {
    const v = await fetchLatestVersion({ readPackageInfo: () => PKG, exec: mockExec('').fn });
    assert.equal(v, null);
  });

  it('кривой JSON → null', async () => {
    const v1 = await fetchLatestVersion({ readPackageInfo: () => PKG, exec: mockExec('{oops').fn });
    assert.equal(v1, null);
    const v2 = await fetchLatestVersion({ readPackageInfo: () => PKG, exec: mockExec('["a","b"]').fn });
    assert.equal(v2, null);
  });

  it('ошибка exec → null (молча)', async () => {
    const v = await fetchLatestVersion({
      readPackageInfo: () => PKG,
      exec: mockExec('', { reject: new Error('ENOENT: npm not found') }).fn,
    });
    assert.equal(v, null);
  });
});

describe('shouldSkip — когда проверка пропускается', () => {
  it('env-гард true/1/yes', () => {
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }), true);
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: '1' }), true);
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'yes' }), true);
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'TRUE' }), true);
  });

  it('env-гард false/пусто → не пропускаем', () => {
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'false' }), false);
    assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: '' }), false);
    assert.equal(shouldSkip(['task', 'list'], {}), false);
  });

  it('долгоживущие команды mcp/browser/bot/qwen-debug', () => {
    assert.equal(shouldSkip(['mcp', 'start'], {}), true);
    assert.equal(shouldSkip(['browser'], {}), true);
    assert.equal(shouldSkip(['bot'], {}), true);
    assert.equal(shouldSkip(['qwen-debug'], {}), true);
    assert.equal(shouldSkip(['task', 'list'], {}), false);
  });

  it('флаги -v / --version (контракт Backlog.md)', () => {
    assert.equal(shouldSkip(['-v'], {}), true);
    assert.equal(shouldSkip(['--version'], {}), true);
  });
});

describe('maybeNotifyUpdate — TTL кэша 24 часа', () => {
  const NOW = 1_800_000_000_000; // фиксированное время для детерминизма

  it('свежий кэш (успех) → exec НЕ вызывается, уведомления нет', async () => {
    writeCache({ checkedAt: NOW - 60_000, latest: '1.6.0', current: '1.6.0' });
    const exec = mockExec('"9.9.9"'); // если бы вызвался — было бы уведомление
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, {
        exec: exec.fn, now: () => NOW, cachePath, readPackageInfo: () => PKG,
      });
    } finally {
      err.restore();
    }
    assert.equal(exec.calls.length, 0);
    assert.equal(err.lines.length, 0);
  });

  it('свежий кэш (ошибка) → exec НЕ вызывается, уведомления нет', async () => {
    writeCache({ checkedAt: NOW - 60_000, error: true });
    const exec = mockExec('"9.9.9"');
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, {
        exec: exec.fn, now: () => NOW, cachePath, readPackageInfo: () => PKG,
      });
    } finally {
      err.restore();
    }
    assert.equal(exec.calls.length, 0);
    assert.equal(err.lines.length, 0);
  });

  it('кэш старше 24 ч → exec вызывается', async () => {
    writeCache({ checkedAt: NOW - DAY_MS - 1, latest: '1.0.0', current: '1.0.0' });
    const exec = mockExec('"1.6.0"'); // версия не новее — уведомления нет
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, {
        exec: exec.fn, now: () => NOW, cachePath, readPackageInfo: () => PKG,
      });
    } finally {
      err.restore();
    }
    assert.equal(exec.calls.length, 1);
  });
});

describe('maybeNotifyUpdate — уведомление', () => {
  const NOW = 1_800_000_000_000;

  function baseDeps(execFn) {
    return { exec: execFn, now: () => NOW, cachePath, readPackageInfo: () => PKG };
  }

  it('новая версия → stderr с точным текстом', async () => {
    const exec = mockExec('"1.7.0"');
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, baseDeps(exec.fn));
    } finally {
      err.restore();
    }
    assert.equal(err.lines.length, 1);
    assert.ok(err.lines[0].includes('npm install -g vibelog.md'), err.lines[0]);
    assert.ok(err.lines[0].includes('1.6.0'), err.lines[0]);
    assert.ok(err.lines[0].includes('1.7.0'), err.lines[0]);
    // Кэш записан — повторная проверка сутки не идёт
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    assert.equal(cache.latest, '1.7.0');
  });

  it('версия не новее → без уведомления, кэш обновлён', async () => {
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, baseDeps(mockExec('"1.6.0"').fn));
    } finally {
      err.restore();
    }
    assert.equal(err.lines.length, 0);
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    assert.equal(cache.latest, '1.6.0');
  });

  it('при свежем кэше уведомление не показывается повторно', async () => {
    const exec = mockExec('"9.9.9"');
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, baseDeps(exec.fn)); // первый запуск
      await maybeNotifyUpdate(['task', 'list'], {}, baseDeps(exec.fn)); // второй, кэш свежий
    } finally {
      err.restore();
    }
    assert.equal(exec.calls.length, 1);
    assert.equal(err.lines.length, 1); // уведомление было только один раз
  });

  it('ошибка сети не показывается пользователю', async () => {
    const err = mockStderr();
    const failing = async () => {
      throw new Error('registry unreachable');
    };
    try {
      await maybeNotifyUpdate(['task', 'list'], {}, baseDeps(failing));
    } finally {
      err.restore();
    }
    assert.equal(err.lines.length, 0);
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    assert.equal(cache.error, true);
  });

  it('-v / --version → exec не вызывается', async () => {
    const exec = mockExec('"9.9.9"');
    const err = mockStderr();
    try {
      await maybeNotifyUpdate(['-v'], {}, baseDeps(exec.fn));
      await maybeNotifyUpdate(['--version'], {}, baseDeps(exec.fn));
    } finally {
      err.restore();
    }
    assert.equal(exec.calls.length, 0);
    assert.equal(err.lines.length, 0);
  });

  it('env-гард и команда mcp → exec не вызывается', async () => {
    const exec = mockExec('"9.9.9"');
    await maybeNotifyUpdate(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }, baseDeps(exec.fn));
    await maybeNotifyUpdate(['mcp', 'start'], {}, baseDeps(exec.fn));
    assert.equal(exec.calls.length, 0);
  });
});

describe('defaultCachePath', () => {
  it('лежит в tmpdir и называется vibelog-update-check.json', () => {
    assert.ok(defaultCachePath().endsWith('vibelog-update-check.json'));
    assert.ok(defaultCachePath().startsWith(tmpdir()));
  });
});
