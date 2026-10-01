/**
 * HTTP-сервер веб-интерфейса Vibelog.md.
 *
 * Слушает только на 127.0.0.1 (не 0.0.0.0) — безопасно по умолчанию.
 * Обслуживает:
 * - Статику React-приложения (web/dist) на / и /assets/*
 * - REST API на /api/*
 * - Inline HTML (assets.ts) — фолбэк, если web/dist не собран
 *
 * Все ассеты inline — без CDN, без внешних зависимостей.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { getAssetsHtml } from './assets.js';
import { serveStatic } from './static.js';

// Путь к собранному React UI. Вычисляется от расположения этого модуля
// (dist/web/server.js → ../../web/dist), а не от cwd: команда vibelog browser
// запускается в репозитории пользователя, а не в корне пакета Vibelog.md.
const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Запускает HTTP-сервер веб-интерфейса.
 *
 * @param cwd — рабочая директория проекта
 * @param port — порт для прослушивания
 * @param openBrowser — открывать ли браузер автоматически
 */
export function startWebServer(cwd: string, port = 3030, openBrowser = true, staticDir: string = webDistDir): Server {
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    // '' не совпадает ни с одним эндпоинтом — тот же 404, что и у undefined
    const method = req.method || '';

    // CORS-заголовки (для локальной разработки)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API-маршруты
    if (url.startsWith('/api/')) {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let parsed: Record<string, unknown> | null = null;
        if (body) {
          try { parsed = JSON.parse(body); } catch { /* ignore */ }
        }

        const result = handleApi(method, url, parsed, cwd);
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.body));
      });
      return;
    }

    // Статика React-приложения (web/dist): index.html на /, ассеты по путям
    if ((method === 'GET' || method === 'HEAD') && serveStatic(res, staticDir, url)) {
      return;
    }

    // Фолбэк: web/dist не собран (например, npm-установка без web/) —
    // прежний inline HTML из assets.ts, чтобы доска осталась рабочей
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getAssetsHtml());
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Веб-интерфейс Vibelog.md: ${url}`);

    if (openBrowser) {
      // Открываем браузер на macOS / Linux
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      exec(`${cmd} ${url}`, () => {});
    }
  });

  server.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`Порт ${port} уже занят. Попробуйте другой: vibelog browser --port ${port + 1}`);
    } else {
      console.error(`Ошибка сервера: ${err.message}`);
    }
    process.exit(1);
  });

  return server;
}
