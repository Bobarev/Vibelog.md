/**
 * Раздача статических файлов React-приложения (web/dist).
 *
 * Почему отдельный модуль: server.ts остаётся чистой маршрутизацией
 * (паттерн слоёв как в api.ts / assets.ts — по модулю на ответственность).
 *
 * Статика коммитится в git (web/dist исключён из .gitignore по решению
 * VL-26), поэтому свежий clone сразу отдаёт React UI без сборки.
 * Фолбэк на inline HTML в server.ts остаётся на случай отсутствия
 * каталога (npm-пакет, ручное удаление).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

/** MIME-типы по расширениям файлов Vite-сборки. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Отдаёт файл из rootDir, если он существует.
 *
 * @param res — HTTP-ответ
 * @param rootDir — корневая директория статики (web/dist)
 * @param url — путь запроса без query-строки
 * @returns true, если файл отправлен; false — файл не найден
 *          (вызывающий код решает: фолбэк или 404)
 */
export function serveStatic(res: ServerResponse, rootDir: string, url: string): boolean {
  // decodeURIComponent: имена ассетов Vite могут содержать %-последовательности;
  // ошибка декодирования = битый запрос, отвечаем «не найдено»
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }

  // `/` — точка входа SPA, отдаём index.html
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');

  // Защита от path traversal: после resolve путь не должен выходить за rootDir.
  // Запрос вида /../../etc/passwd молча отклоняется как «не найдено».
  const rootResolved = resolve(rootDir);
  const filePath = resolve(rootResolved, relative);
  if (!filePath.startsWith(rootResolved + sep)) {
    return false;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const body = readFileSync(filePath);

  res.writeHead(200, {
    'Content-Type': contentType,
    // Ассеты версионируются по хешу в имени — их кэшировать можно, но
    // index.html меняется при пересборке, поэтому no-cache для всего:
    // браузер всегда сверяется с сервером и не подхватит устаревшие ссылки
    'Cache-Control': 'no-cache',
  });
  res.end(body);
  return true;
}
