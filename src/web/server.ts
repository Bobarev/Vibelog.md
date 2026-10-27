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
import { runChat } from './chat.js';
import { getAssetsHtml } from './assets.js';
import { serveStatic } from './static.js';
import { recoverStalePhaseStatuses } from '../core/phase-transient.js';

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
  // VL-196: recovery «зависших» транзиентных In Progress после рестарта
  // процесса (AC3) — сбой recovery не должен мешать подъёму сервера
  try {
    recoverStalePhaseStatuses(cwd);
  } catch (err) {
    console.log(`[phase-transient] recovery при старте web не удалась: ${(err as Error).message}`);
  }
  const server = createServer((req, res) => {
    // Сырой URL сохраняем ДО отрезки '?': handleApi получает query string
    // отдельным 5-м параметром (VL-185 — GET /api/search?q=...)
    const rawUrl = req.url ?? '';
    const url = rawUrl.split('?')[0];
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

        const queryString = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';

        // POST /api/chat — SSE-стриминг чата (VL-204): ответ не JSON,
        // поэтому ветка ДО handleApi (он синхронный и всегда отдаёт JSON).
        if (method === 'POST' && url === '/api/chat') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          (async () => {
            try {
              const events = runChat(parsed ?? {}, cwd);
              for await (const ev of events) {
                // Клиент отключился — прерываем генератор (finally в runChat
                // дожидается продюсера, чтобы LLM-вызов не завис)
                if (res.destroyed || res.writableEnded) break;
                res.write(`data: ${JSON.stringify(ev)}\n\n`);
              }
            } catch (err) {
              if (!res.destroyed && !res.writableEnded) {
                res.write(
                  `data: ${JSON.stringify({
                    type: 'error',
                    message: err instanceof Error ? err.message : String(err),
                  })}\n\n`,
                );
              }
            } finally {
              if (!res.destroyed && !res.writableEnded) res.end();
            }
          })();
          return;
        }

        const result = handleApi(method, url, parsed, cwd, queryString);
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
