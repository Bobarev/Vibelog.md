/**
 * Тесты глобальных guard'ов от реальной сети (VL-132 fetch, VL-226 spawn)
 * и env-гардов CLI.
 *
 * Файл сам импортирует '../test-setup.mjs', поэтому проверки работают
 * и при прямом запуске `node --test src/core/no-network.test.mjs`
 * без флага --import (guard идемпотентен — повторный import безопасен).
 */

import '../test-setup.mjs';
import { test } from 'vitest';
import assert from 'node:assert';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync, mkdtempSync } from 'node:fs';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
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
// Spawn-guard (VL-226): сетевые git-команды падают за секунды
// ============================================================

test("spawnGuard: git clone на внешний https-хост падает с [VL-226] за секунды", () => {
  // Без guard'а spawnSync зависал на офлайн-DNS до testTimeout 120 с
  // (инцидент VL-225). Засекаем время — fail-fast должен уложиться в секунды.
  const t0 = performance.now();
  assert.throws(
    () => spawnSync('git', ['clone', 'https://vl226-external.example/repo.git'], { encoding: 'utf-8' }),
    (err) => {
      assert.match(err.message, /VL-226/, `ожидали ошибку spawn-guard'а, получили: ${err.message}`);
      assert.match(err.message, /vl226-external\.example/);
      return true;
    },
  );
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 5000, `fail-fast должен занять секунды, заняло ${elapsed.toFixed(0)} мс`);
});

test("spawnGuard: scp-синтаксис git@host:path тоже отклоняется", () => {
  assert.throws(
    () => spawnSync('git', ['clone', 'git@vl226-host.example:owner/repo.git'], { encoding: 'utf-8' }),
    /VL-226/,
  );
});

test('spawnGuard: loopback-URL проходит мимо guard\'а (ECONNREFUSED, не VL-226)', () => {
  // Порт 1 на loopback закрыт — git упадёт сетевой ошибкой быстро,
  // но НЕ с ошибкой guard'а: loopback разрешён для мок-серверов (AC-3)
  const res = spawnSync('git', ['ls-remote', 'http://127.0.0.1:1/repo.git'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const out = `${res.stderr || ''}${res.error ? res.error.message : ''}`;
  assert.ok(!out.includes('VL-226'), `loopback должен проходить мимо guard'а, получили: ${out}`);
});

test('spawnGuard: локальные git-команды (init, file://-URL) не затронуты (AC-3)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vl226-'));
  try {
    const init = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(init.status, 0, `git init не должен падать guard'ом: ${init.stderr}`);
    // file:// не матчит http/https/git@ — клон (даже неудачный) идёт мимо guard'а
    const res = spawnSync('git', ['clone', 'file:///nonexistent/vl226', join(dir, 'x')], {
      encoding: 'utf-8',
      timeout: 10_000,
    });
    const out = `${res.stderr || ''}${res.error ? res.error.message : ''}`;
    assert.ok(!out.includes('VL-226'), `file://-клон не должен ловиться guard'ом, получили: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spawnGuard: async-функции НЕ превращают результат в Promise (регресс VL-226)', () => {
  // Инцидент: первая версия guard'а обернула spawn/exec в async-функцию и
  // spawn стал возвращать Promise вместо ChildProcess — упало 130 тестов
  // web/agent/bot ('child.kill is not a function', `.stdout` undefined).
  // Контракт: для локальной команды guard возвращает ровно то, что вернул
  // node:child_process — ChildProcess с .on/.kill/.stdout/.pid.
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  try {
    assert.ok(typeof child.on === 'function', 'spawn должен вернуть ChildProcess, а не Promise');
    assert.ok(typeof child.kill === 'function', 'у ChildProcess должен быть метод kill');
    assert.equal(typeof child.pid, 'number');
  } finally {
    child.kill('SIGKILL');
  }
});

test('spawnGuard: exec с командной строкой (git clone https://…) тоже отклоняется', () => {
  // exec/execSync первым аргументом получают всю командную строку —
  // сканируем её (иначе сетевой git проходил бы мимо guard'а)
  assert.throws(
    () => execSync('git clone https://vl226-exec.example/repo.git', { encoding: 'utf-8' }),
    /VL-226/,
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
