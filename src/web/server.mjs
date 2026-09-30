/**
 * HTTP-сервер веб-интерфейса Vibelog.md.
 *
 * Слушает только на 127.0.0.1 (не 0.0.0.0) — безопасно по умолчанию.
 * Обслуживает:
 * - Статический HTML (index) на /
 * - REST API на /api/*
 *
 * Все ассеты inline — без CDN, без внешних зависимостей.
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { handleApi } from './api.mjs';
import { getAssetsHtml } from './assets.mjs';

/**
 * Запускает HTTP-сервер веб-интерфейса.
 *
 * @param {string} cwd — рабочая директория проекта
 * @param {number} [port=3030] — порт для прослушивания
 * @param {boolean} [openBrowser=true] — открывать ли браузер автоматически
 */
export function startWebServer(cwd, port = 3030, openBrowser = true) {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;

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
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = null;
        if (body) {
          try { parsed = JSON.parse(body); } catch { /* ignore */ }
        }

        const result = handleApi(method, url, parsed, cwd);
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.body));
      });
      return;
    }

    // Главная страница — inline HTML
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
    if (err.code === 'EADDRINUSE') {
      console.error(`Порт ${port} уже занят. Попробуйте другой: vibelog browser --port ${port + 1}`);
    } else {
      console.error(`Ошибка сервера: ${err.message}`);
    }
    process.exit(1);
  });

  return server;
}
