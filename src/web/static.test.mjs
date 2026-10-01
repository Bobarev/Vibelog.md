/**
 * Тесты VL-26 — статическая раздача React UI (web/dist).
 *
 * Проверяет:
 * - serveStatic: отдача index.html и ассетов, MIME-типы, защита от path traversal
 * - Сервер: GET / отдаёт React UI из подменяемого staticDir
 * - Фолбэк: при отсутствии каталога статики отдаётся inline HTML из assets.ts
 * - API не пострадал: GET /api/tasks работает как раньше
 *
 * staticDir передаётся четвёртым аргументом startWebServer — тесты не трогают
 * настоящий web/dist репозитория.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveStatic } from '../../dist/web/static.js';
import { startWebServer } from '../../dist/web/server.js';

// Временный каталог — в /tmp, а не в репозитории: findBacklogDir поднимается
// вверх по дереву, и каталог внутри проекта «находит» настоящий backlog/
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-web-test-'));
// Заглушка ServerResponse: записываем статус/заголовки/тело для проверок
function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
      return this;
    },
    end(body) {
      this.body = body;
    },
  };
}

describe('serveStatic (VL-26)', () => {
  const distDir = join(testRoot, 'dist');

  before(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');
    // Файл ВНЕ корня статики — цель для проверки path traversal
    writeFileSync(join(testRoot, 'secret.txt'), 'секрет');
  });

  after(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('отдаёт index.html по пути /', () => {
    const res = mockRes();
    assert.equal(serveStatic(res, distDir, '/'), true);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/html/);
    assert.match(res.body.toString(), /id="root"/);
  });

  it('отдаёт ассет с корректным Content-Type', () => {
    const res = mockRes();
    assert.equal(serveStatic(res, distDir, '/assets/app.js'), true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/javascript; charset=utf-8');
  });

  it('возвращает false для несуществующего файла', () => {
    const res = mockRes();
    assert.equal(serveStatic(res, distDir, '/assets/missing.js'), false);
    assert.equal(res.statusCode, 0); // ответ не отправлялся
  });

  it('блокирует path traversal', () => {
    const res = mockRes();
    assert.equal(serveStatic(res, distDir, '/../secret.txt'), false);
    const res2 = mockRes();
    assert.equal(serveStatic(res2, distDir, '/%2e%2e/secret.txt'), false);
  });
});

describe('vibelog browser + web/dist (VL-26)', () => {
  const cwd = join(testRoot, 'project'); // каталог без backlog — список задач пуст
  const reactDist = join(testRoot, 'react-dist');

  before(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(reactDist, 'assets'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(reactDist, 'index.html'), '<!doctype html><div id="root"></div>');
    writeFileSync(join(reactDist, 'assets', 'app.js'), 'console.log(1)');
  });

  after(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('GET / отдаёт React UI, ассеты — с MIME, /api/tasks — JSON', async () => {
    // Порт 0 = эфемерный, не конфликтует с другими тестами
    const server = startWebServer(cwd, 0, false, reactDist);
    await new Promise(resolve => server.on('listening', resolve));
    const { port } = server.address();
    try {
      const index = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(index.status, 200);
      assert.match(index.headers.get('content-type'), /text\/html/);
      assert.match(await index.text(), /id="root"/);

      const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get('content-type'), /javascript/);

      const api = await fetch(`http://127.0.0.1:${port}/api/tasks`);
      assert.equal(api.status, 200);
      assert.deepEqual(await api.json(), []); // backlog отсутствует → пустой список
    } finally {
      server.close();
    }
  });

  it('фолбэк: без каталога статики отдаётся inline HTML', async () => {
    const server = startWebServer(cwd, 0, false, join(testRoot, 'no-dist'));
    await new Promise(resolve => server.on('listening', resolve));
    const { port } = server.address();
    try {
      const index = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(index.status, 200);
      assert.match(index.headers.get('content-type'), /text\/html/);
      // Маркер inline-доски из assets.ts — React-маркер id="root" отсутствует
      const html = await index.text();
      assert.match(html, /Vibelog\.md/);
      assert.doesNotMatch(html, /id="root"/);
    } finally {
      server.close();
    }
  });
});
