/**
 * HTTP-сервер веб-интерфейса Vibelog.md.
 *
 * Слушает адрес из параметра host — по умолчанию 127.0.0.1 (безопасно:
 * доска открыта только на этой машине). VL-266: `--host 0.0.0.0` открывает
 * доступ из локальной сети; при этом в консоль печатаются и локальный URL,
 * и LAN-адреса машины.
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
import { handleSetupCheckBot, handleSetupPing } from './setup-api.js';
import { handleCatalogApi } from './catalog-api.js';
import { handleReferencesSyncApi } from './references-sync-api.js';
import { runChat, resetOrphanedChatRuns, streamChatRun } from './chat.js';
import { cancelChatRun, getChatRun } from './chat-runs.js';
import { getAssetsHtml } from './assets.js';
import { serveStatic } from './static.js';
import { recoverStalePhaseStatuses } from '../core/phase-transient.js';
import { DEFAULT_WEB_HOST, lanAddresses, startupLines, startupUrls } from './host-binding.js';
import { startSupervisorTimer, stopSupervisorTimer } from './supervisor-tick.js';

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
 * @param staticDir — каталог статики React UI
 * @param host — адрес прослушивания (VL-266): '127.0.0.1' по умолчанию,
 *   '0.0.0.0' — доступ из локальной сети
 * @param openHash — хеш-маршрут, который открыть в браузере (VL-210:
 *   `#/setup` при `vibelog init --web`); undefined — корень (канбан)
 */
export function startWebServer(
  cwd: string,
  port = 3030,
  openBrowser = true,
  staticDir: string = webDistDir,
  host: string = DEFAULT_WEB_HOST,
  openHash?: string,
): Server {
  // VL-196: recovery «зависших» транзиентных In Progress после рестарта
  // процесса (AC3) — сбой recovery не должен мешать подъёму сервера
  try {
    recoverStalePhaseStatuses(cwd);
  } catch (err) {
    console.log(`[phase-transient] recovery при старте web не удалась: ${(err as Error).message}`);
  }
  // VL-332: ходы, прерванные перезапуском сервера, честно помечаются
  // interrupted — иначе UI показывал бы вечный индикатор «выполняется».
  try {
    resetOrphanedChatRuns(cwd);
  } catch (err) {
    console.log(`[chat-runs] recovery при старте web не удалась: ${(err as Error).message}`);
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

        // Async-эндпоинты wizard-а (VL-210): ping LLM и getMe Telegram ходят
        // в сеть, поэтому не могут жить в синхронном handleApi. Ветка ДО
        // общего вызова — иначе POST /api/setup/ping ушёл бы в handleApi.
        if (method === 'POST' && (url === '/api/setup/ping' || url === '/api/setup/check-bot')) {
          const handler = url === '/api/setup/ping' ? handleSetupPing : handleSetupCheckBot;
          handler(parsed, cwd)
            .then((result) => {
              if (res.destroyed || res.writableEnded) return;
              res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify(result.body));
            })
            .catch((err) => {
              if (res.destroyed || res.writableEnded) return;
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: (err as Error)?.message ?? String(err) }));
            });
          return;
        }

        // POST /api/chat — SSE-стриминг чата (VL-204): ответ не JSON,
        // поэтому ветка ДО handleApi (он синхронный и всегда отдаёт JSON).
        // VL-332: ход отвязан от запроса — `runChat` подписывается на прогон
        // из реестра, обрыв SSE (переключение треда, F5) его не убивает;
        // повторный POST по тому же треду джойнится к идущему ходу.
        if (method === 'POST' && url === '/api/chat') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          const since =
            typeof (parsed as { since?: unknown } | null)?.since === 'number'
              ? ((parsed as { since: number }).since as number)
              : 0;
          (async () => {
            try {
              const events = runChat(parsed ?? {}, cwd, {}, Number.isFinite(since) ? since : 0);
              for await (const ev of events) {
                // Клиент отключился — просто отписываемся: прогон продолжает
                // работать и дописывает jsonl (VL-332, AC1/AC2)
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

        // GET /api/chat/threads/:id/stream?since=N — переподключение к идущему
        // ходу (VL-332, AC4): возврат в тред или F5 не теряют стрим. 404 —
        // живого прогона нет, клиент просто грузит историю из jsonl.
        const chatStreamMatch = url.match(/^\/api\/chat\/threads\/([^/]+)\/stream$/);
        if (method === 'GET' && chatStreamMatch) {
          const streamThreadId = chatStreamMatch[1]!;
          const liveRun = getChatRun(streamThreadId);
          // Живого прогона нет — отдаём 404 через handleApi ниже (клиент
          // просто загрузит историю из jsonl)
          if (liveRun !== null && !liveRun.done) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const sinceParam = Number(new URLSearchParams(queryString).get('since') ?? '0');
            (async () => {
              try {
                for await (const ev of streamChatRun(
                  streamThreadId,
                  Number.isFinite(sinceParam) ? sinceParam : 0,
                )) {
                  if (res.destroyed || res.writableEnded) break;
                  res.write(`data: ${JSON.stringify(ev)}\n\n`);
                }
              } catch {
                // поток закрыт — не ошибка сервера
              } finally {
                if (!res.destroyed && !res.writableEnded) res.end();
              }
            })();
            return;
          }
        }

        // POST /api/chat/threads/:id/cancel — явная остановка хода (VL-332):
        // абортит текущий LLM-вызов, sidecar получает статус `cancelled`.
        const chatCancelMatch = url.match(/^\/api\/chat\/threads\/([^/]+)\/cancel$/);
        if (method === 'POST' && chatCancelMatch) {
          const cancelled = cancelChatRun(chatCancelMatch[1]!);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, cancelled }));
          return;
        }

        // Async-эндпоинты каталога моделей (VL-316): ходят в сеть, поэтому не
        // могут жить в синхронном handleApi. Ветка ДО общего вызова — иначе
        // GET /api/catalog/models ушёл бы в handleApi и получил 404.
        // VL-317: сверка цен (/api/pricing/*) живёт в том же async-обработчике
        if (url.startsWith('/api/catalog/') || url.startsWith('/api/pricing/')) {
          handleCatalogApi(method, url, parsed, cwd, queryString)
            .then((result) => {
              if (res.destroyed || res.writableEnded) return;
              if (result === null) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
              }
              res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify(result.body));
            })
            .catch((err) => {
              if (res.destroyed || res.writableEnded) return;
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: (err as Error)?.message ?? String(err) }));
            });
          return;
        }

        // Async-эндпоинты синхронизации references (VL-358): обновление
        // markdown-кэша url/doc ходит в сеть, поэтому не может жить в
        // синхронном handleApi. Ветка ДО общего вызова — иначе
        // POST /api/references/sync получил бы 404 от handleApi.
        const refSyncMatch =
          url === '/api/references/sync' || /^\/api\/references\/[^/]+\/sync$/.test(url);
        if (method === 'POST' && refSyncMatch) {
          handleReferencesSyncApi(method, url, parsed, cwd)
            .then((result) => {
              if (res.destroyed || res.writableEnded) return;
              if (result === null) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Not found' }));
                return;
              }
              res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify(result.body));
            })
            .catch((err) => {
              if (res.destroyed || res.writableEnded) return;
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: (err as Error)?.message ?? String(err) }));
            });
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

  server.listen(port, host, () => {
    // VL-266: фактический порт берём у сокета: при port=0 (тесты) в
    // параметре остался бы 0, а не выданный ОС эфемерный порт
    const addr = server.address();
    const actualPort = addr && typeof addr === 'object' ? addr.port : port;

    // VL-266: первая строка — local-URL в прежнем формате (контракт /web start
    // бота, VL-161); при wildcard-хосте ниже добавляются LAN-адреса машины
    const addresses = lanAddresses();
    const { local } = startupUrls(host, actualPort, addresses);
    for (const line of startupLines(host, actualPort, addresses)) console.log(line);

    if (openBrowser) {
      // Открываем браузер на macOS / Linux — всегда local-URL:
      // `open http://0.0.0.0:3030` на части систем не срабатывает
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
      // VL-210: openHash — открыть конкретный хеш-маршрут (#/setup при init --web)
      exec(`${cmd} ${local}${openHash ?? ''}`, () => {});
    }

    // VL-270 (doc-19 §5): тик супервизора живёт в процессе vibelog browser.
    // Таймер заводится только при активном grant'е (без прогона наблюдать
    // нечего, а лишний LLM-вызов стоит денег) и не держит процесс — unref.
    // Ошибка старта таймера не должна мешать подъёму доски.
    try {
      startSupervisorTimer(cwd);
    } catch (err) {
      console.error(`[supervisor] таймер не запущен: ${(err as Error).message}`);
    }
  });

  server.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`Порт ${port} уже занят. Попробуйте другой: vibelog browser --port ${port + 1}`);
    } else {
      console.error(`Ошибка сервера: ${err.message}`);
    }
    stopSupervisorTimer();
    process.exit(1);
  });

  // VL-270: сервер закрыли (тест, /web stop) — тик обязан остановиться вместе
  // с ним: иначе таймер продолжит считать по закрытому проекту, а в тестах
  // оставит воркеру незавершённую работу.
  server.on('close', () => {
    stopSupervisorTimer();
  });

  return server;
}
