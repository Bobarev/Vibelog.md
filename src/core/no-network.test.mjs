/**
 * Тесты глобального guard'а от реальной сети и env-гардов CLI (VL-132).
 *
 * Файл сам импортирует '../test-setup.mjs', поэтому проверки работают
 * и при прямом запуске `node --test src/core/no-network.test.mjs`
 * без флага --import (guard идемпотентен — повторный import безопасен).
 */

import '../test-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { shouldSkip, fetchLatestVersion, maybeNotifyUpdate } from '../../dist/cli/update-check.js';

// ============================================================
// Глобальный fetch-guard (патч в test-setup.mjs)
// ============================================================

test("fetch к не-loopback хосту отклоняется guard'ом (fail-fast)", async () => {
  await assert.rejects(
    () => fetch('https://example.com/'),
    (err) => {
      assert.match(err.message, /VL-132/, `ожидали ошибку guard'а, получили: ${err.message}`);
      assert.match(err.message, /example\.com/);
      return true;
    },
  );
});

test("fetch к loopback проходит мимо guard'а (сетевая ошибка, не наша)", async () => {
  // Порт 1 на loopback всегда закрыт: ожидаем ECONNREFUSED от стека Node,
  // а НЕ ошибку guard'а — доказываем, что loopback не блокируется
  await assert.rejects(
    () => fetch('http://127.0.0.1:1/'),
    (err) => {
      assert.ok(
        !String(err.message).includes('VL-132'),
        `loopback должен проходить мимо guard'а, получили: ${err.message}`,
      );
      return true;
    },
  );
});

test('guard идемпотентен: двойной import не ломает обёртку', async () => {
  // Повторный import того же модуля не выполняется ES-модулями повторно,
  // но проверяем контракт напрямую: после --import + import в файле
  // fetch всё ещё кидает ошибку guard'а, а не работают вложенные обёртки
  await assert.rejects(
    () => fetch('http://example.org/'),
    (err) => {
      assert.match(err.message, /VL-132/);
      return true;
    },
  );
});

// ============================================================
// Env-гарды update-check: реальный npm view в тестах не запускается
// ============================================================

test('shouldSkip: VIBELOG_SKIP_UPDATE_CHECK отключает проверку обновлений', () => {
  // Команды, реально спавнимые тестами через bin/vibelog.mjs:
  assert.equal(shouldSkip(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }), true);
  assert.equal(shouldSkip(['task', 'create', 'x'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }), true);
  assert.equal(shouldSkip(['init', 'P'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }), true);
  // mcp — в SKIP_COMMANDS независимо от env (JSON-RPC по stdout)
  assert.equal(shouldSkip(['mcp', 'start'], {}), true);
});

test('maybeNotifyUpdate с VIBELOG_SKIP_UPDATE_CHECK — exec (npm view) не вызывается', async () => {
  const calls = [];
  await maybeNotifyUpdate(['task', 'list'], { VIBELOG_SKIP_UPDATE_CHECK: 'true' }, {
    // Если бы гард не сработал, exec вызвался бы — фиксируем вызовы
    exec: async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: '"1.0.0"', stderr: '' };
    },
    cachePath: join(tmpdir(), `vl132-skip-${process.pid}.json`),
    readPackageInfo: () => ({ name: 'vibelog.md', version: '1.0.0' }),
  });
  assert.equal(calls.length, 0, `exec не должен вызываться при env-гарде, вызовы: ${JSON.stringify(calls)}`);
});

test('контроль: без гарда maybeNotifyUpdate зовёт exec (npm view) — доказательство риска', async () => {
  const calls = [];
  const cachePath = join(tmpdir(), `vl132-noguard-${process.pid}.json`);
  try {
    await maybeNotifyUpdate(['task', 'list'], {}, {
      exec: async (file, args) => {
        calls.push([file, ...args]);
        // Версия равна текущей — уведомление не печатается, stderr чистый
        return { stdout: '"1.0.0"', stderr: '' };
      },
      cachePath,
      // Фиксированное «время» + пустой кэш → проверка точно произойдёт
      now: () => 1_000_000,
      readPackageInfo: () => ({ name: 'vibelog.md', version: '1.0.0' }),
    });
  } finally {
    rmSync(cachePath, { force: true });
  }
  assert.equal(calls.length, 1, 'без гарда должна уйти одна команда npm view');
  assert.equal(calls[0][0], 'npm');
  assert.deepEqual(calls[0].slice(1, 4), ['view', 'vibelog.md', 'version']);
});

test('fetchLatestVersion: сбой exec (нет сети/npm) → null без исключения', async () => {
  const version = await fetchLatestVersion({
    exec: async () => {
      throw new Error('ENOTFOUND registry.npmjs.org');
    },
    readPackageInfo: () => ({ name: 'vibelog.md', version: '1.0.0' }),
  });
  assert.equal(version, null);
});
