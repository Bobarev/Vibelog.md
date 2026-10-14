/**
 * Тесты VL-161 — /web: парсер, spawn/stop дочернего процесса веб-сервера.
 *
 * Паттерн restart.test.mjs: stub-cli в mkdtemp печатает то же, что
 * server.ts, — строку «Веб-интерфейс Vibelog.md: <url>».
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseWebCommand,
  spawnWebServer,
  currentWebServer,
  stopWebServer,
  clearWebServer,
  webServerUrl,
} from '../../dist/bot/web.js';

describe('parseWebCommand (VL-161)', () => {
  it('пусто, пробелы и start → запуск без taskId', () => {
    for (const text of ['', '   ', 'start']) {
      assert.deepEqual(parseWebCommand(text), { action: 'start' }, `"${text}" → start`);
    }
  });

  it('start VL-N → запуск с taskId в верхнем регистре', () => {
    assert.deepEqual(parseWebCommand('start VL-107'), { action: 'start', taskId: 'VL-107' });
    assert.deepEqual(parseWebCommand('start vl-7'), { action: 'start', taskId: 'VL-7' });
    assert.deepEqual(parseWebCommand('  Start  vl-42  '), { action: 'start', taskId: 'VL-42' });
  });

  it('stop → остановка', () => {
    assert.deepEqual(parseWebCommand('stop'), { action: 'stop' });
    assert.deepEqual(parseWebCommand(' stop '), { action: 'stop' });
  });

  it('мусор → error с подсказкой синтаксиса', () => {
    for (const bad of ['VL-1', 'start VL-abc', 'stop now', 'start VL-1 extra', 'restart']) {
      const r = parseWebCommand(bad);
      assert.ok('error' in r, `"${bad}" → error`);
      assert.match(r.error, /Синтаксис: \/web start \[VL-N\] \| \/web stop/);
    }
  });
});

describe('spawnWebServer / stopWebServer (VL-161)', () => {
  /** Stub-cli: печатает строку URL как server.ts и завершается. */
  const makeStub = (dir) => {
    const stub = join(dir, 'stub.mjs');
    writeFileSync(
      stub,
      "console.log('Веб-интерфейс Vibelog.md: http://127.0.0.1:3999');\n" +
        // держимся живыми, пока не пришлют SIGTERM (проверка stop)
        'setInterval(() => {}, 1000);\n'
    );
    return stub;
  };

  it('событие spawn — процесс создаётся; stop убивает и сбрасывает синглтон', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-web-'));
    try {
      clearWebServer();
      const child = spawnWebServer(dir, makeStub(dir), 'pipe');
      const spawned = await new Promise((resolve, reject) => {
        child.once('spawn', () => resolve(true));
        child.once('error', reject);
      });
      assert.equal(spawned, true);
      assert.equal(currentWebServer(), child, 'синглтон указывает на запущенный процесс');

      assert.equal(stopWebServer(), true);
      assert.equal(currentWebServer(), null, 'stopWebServer сбрасывает синглтон');
      await new Promise((resolve) => child.once('exit', resolve));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('повторный spawn убивает старый процесс — один сервер, не два', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-web-'));
    try {
      clearWebServer();
      const stub = makeStub(dir);
      const first = spawnWebServer(dir, stub, 'pipe');
      await new Promise((resolve, reject) => {
        first.once('spawn', resolve);
        first.once('error', reject);
      });
      const second = spawnWebServer(dir, stub, 'pipe');
      await new Promise((resolve, reject) => {
        second.once('spawn', resolve);
        second.once('error', reject);
      });
      assert.equal(currentWebServer(), second, 'синглтон — новый процесс');
      assert.ok(first.killed || first.exitCode !== null, 'старый процесс убит');
      stopWebServer();
      await new Promise((resolve) => second.once('exit', resolve));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stopWebServer до запуска → false', () => {
    clearWebServer();
    assert.equal(stopWebServer(), false);
  });

  it('stdout дочернего содержит строку URL server.ts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibelog-web-'));
    try {
      clearWebServer();
      const child = spawnWebServer(dir, makeStub(dir), 'pipe');
      const out = await new Promise((resolve) => {
        let data = '';
        child.stdout.on('data', (chunk) => {
          data += chunk.toString();
          if (/Веб-интерфейс Vibelog\.md:/.test(data)) resolve(data);
        });
        child.once('exit', () => resolve(data));
      });
      assert.match(out, /Веб-интерфейс Vibelog\.md: http:\/\/127\.0\.0\.1:\d+/);
      stopWebServer();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('webServerUrl (VL-161)', () => {
  it('формирует localhost-URL', () => {
    assert.equal(webServerUrl(3030), 'http://127.0.0.1:3030');
    assert.equal(webServerUrl(8081), 'http://127.0.0.1:8081');
  });
});
