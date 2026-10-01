---
id: VL-26
title: 'Vibelog Web: каркас Vite+React приложения и статическая раздача из vibelog browser'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 11:35'
updated_date: '2026-10-01 12:15'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Поднять отдельное Vite+React+TypeScript приложение в папке web/ корня проекта (НЕ src/web/ — чтобы tsc-сборка CLI/MCP, где rootDir=src, не ломалась). vibelog browser (src/web/server.ts) при наличии web/dist отдаёт статику React-приложения (index.html + assets), API /api/* не меняется. Если web/dist отсутствует — фолбэк на текущий inline HTML. Структура web/: package.json (отдельный), vite.config.ts, src/main.tsx, src/App.tsx. Допустимы dev-зависимости React/Vite/Tailwind — они не попадают в runtime CLI/MCP (zero runtime deps сохраняется для bin/vibelog.mjs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В папке web/ создано Vite+React приложение; команда pnpm build в web/ генерирует web/dist/index.html
- [x] #2 vibelog browser отдаёт React-приложение из web/dist; существующие эндпоинты /api/* работают без изменений (регрессии нет)
- [x] #3 При отсутствии web/dist сервер отдаёт прежний inline HTML из assets.ts (фолбэк)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты из исследования
- Стартовый Vite+React+shadcn проект УЖЕ скопирован в web/ (package.json name=vibelog-web, build: `tsc -b && vite build`), web/dist уже собран (index.html, assets/*.js|css|woff2).
- Сервер: src/web/server.ts (94 строки). Маршрутизация: OPTIONS→204; /api/*→handleApi; `/`|`/index.html`→inline HTML из assets.ts (getAssetsHtml()); иначе 404. Слушает 127.0.0.1.
- CLI: src/cli/commands/browser.ts → startWebServer(cwd, port, openBrowser); порт из --port или default_port конфига.
- Сборка CLI: tsc rootDir=src → dist/. dist/web/server.js — точка отсчёта для пути к web/dist.
- Тестов web-слоя нет. Существующие тесты — *.test.mjs, импортируют dist/.
- .gitignore корня содержит `dist/` — покрывает и web/dist (паттерн без ведущего слэша). web/dist в git не попадёт — ок, т.к. есть фолбэк.

## Изменяемые файлы

### 1. НОВЫЙ src/web/static.ts — раздача статики
- MIME-карта: .html→text/html; .js→text/javascript; .css→text/css; .svg→image/svg+xml; .woff2→font/woff2; .png→image/png; .json→application/json; .ico→image/x-icon; fallback→application/octet-stream.
- Экспорт serveStatic(res, rootDir, url): boolean — true если файл отдан.
  - `const clean = decodeURIComponent(url.split('?')[0])` ; нормализовать `/` → `index.html`.
  - Защита от path traversal: resolve и проверка startsWith(rootDir + sep).
  - GET/HEAD → readFileSync + writeHead(200, Content-Type, Cache-Control: no-cache) + end(buffer); иначе false (вызывающий решает 404).
- Почему отдельный модуль: server.ts остаётся чистой маршрутизацией (паттерн api.ts/assets.ts).

### 2. src/web/server.ts — подмена inline-страницы на статику
- Импорты: fileURLToPath из node:url, serveStatic из ./static.js.
- Строка ~21 (после импортов): `const webDistDir = fileURLToPath(new URL('../../web/dist', import.meta.url));` — ../../ от dist/web/server.js = корень пакета → web/dist. Работает при любой установке (npm link, node_modules, локально), НЕ зависит от cwd пользователя.
- Заменить блок строк 60-65 («Главная страница — inline HTML»):
  ```ts
  if ((method === 'GET' || method === 'HEAD') && serveStatic(res, webDistDir, url)) return;
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getAssetsHtml()); // фолбэк: web/dist не собран
    return;
  }
  ```
- 404 и API не трогаем.

### 3. web/vite.config.ts — proxy для dev-режима
- Добавить: `server: { proxy: { '/api': 'http://127.0.0.1:3030' } }` — чтобы `pnpm dev` в web/ видел работающий API. Production не затрагивает.

### 4. src/web/static.test.mjs — тесты (новый)
- Тест 1 (unit): tmp-директория с index.html и assets/app.js → serveStatic отдаёт оба, Content-Type корректен; `/` → index.html; `../` traversal → false.
- Тест 2 (интеграционный): startWebServer(tmpCwd, 0, false) — порт 0 = эфемерный; через fetch: GET / → 200 (React-разметка если web/dist существует, иначе inline-фолбэк — проверяем по наличию dist в тесте), GET /api/tasks → 200 JSON. Закрыть сервер в finally.

### 5. package.json (корень) — convenience-скрипт
- scripts += `"web:build": "pnpm --dir web build"` — сборка UI одной командой из корня.

### 6. Документация
- README.md: в разделе про vibelog browser указать, что UI — React-приложение из web/dist (сборка: pnpm web:build), при отсутствии сборки работает прежний inline UI.
- CHANGELOG.md: запись под [Unreleased] — «web: vibelog browser отдаёт React UI из web/dist с фолбэком на inline HTML».

## Порядок действий
1. static.ts + static.test.mjs (unit-часть)
2. server.ts (роутинг + fallback)
3. Интеграционный тест
4. vite.config.ts proxy
5. package.json web:build
6. README + CHANGELOG
7. Верификация

## Верификация
- `pnpm build` — tsc корня без ошибок.
- `pnpm --dir web build` — появляется web/dist/index.html (если web/dist удалён).
- `pnpm test` — build + node --test src, включая новые тесты.
- Ручной прогон: `node bin/vibelog.mjs browser --no-open --port 3031` в тестовом каталоге → `curl -s localhost:3031/` содержит `<div id="root">` (React), `curl -s localhost:3031/api/tasks` → JSON. Затем `mv web/dist /tmp/wd` → `/` отдаёт прежний inline HTML → вернуть `mv`.

## Риски
1. **Публикация npm**: в пакет web/dist не попадёт (.gitignore → npm pack исключает). Fallback на inline HTML спасает, но React UI у npm-пользователей не будет. Решение: в будущем добавить prepack-сборку или files-поле — вне рамок VL-26.
2. **Node-версия для Vite 8**: требует Node ^20.19 — на машине v20.19.0, впритык. Если появятся проблемы при сборке web/ — зафиксировать vite@^7.
3. **Порт в dev-proxy захардкожен 3030** — при --port другом прокси не сработает. Acceptable для dev; можно позже вынести в env.
4. **Path traversal** в статике — закрывается проверкой resolve+startsWith в static.ts (тест покрывает).
5. **Двойной импорт TS-типов**: web/ использует свой typescript (~6.0.2) — независим от корневого 7.x, конфликтов нет (разные node_modules).
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
Корректировка плана от пользователя (2026-10-01, Фаза 3): web/dist ИСКЛЮЧАЕТСЯ из .gitignore и коммитится в репозиторий (проще, чем prepack-сборка; свежий clone сразу получает React UI). Правки: корневой .gitignore (дополнить negation `!web/dist/` к паттерну `dist/`) и web/.gitignore (убрать строку `dist`). Риск npm-пакета снят: npm pack включает web/dist, т.к. он не игнорируется.
<!-- SECTION:NOTES:END -->