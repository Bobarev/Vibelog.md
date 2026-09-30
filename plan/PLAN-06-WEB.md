# PLAN-06: Веб-интерфейс

## Задача

Локальный веб-интерфейс: канбан с drag-and-drop, формы, тёмная/светлая тема.

## Перед началом

**Изучи оригинал:**
- `src/web/` в Backlog.md — какие эндпоинты, какие фичи UI.
- Формат API (REST? JSON-RPC?).
- Какие настройки в конфиге влияют на веб (`defaultPort`, `autoOpenBrowser`).

Если найдешь расхождения — правь план.

## Файлы

### `src/web/server.mjs`

- `http.createServer` на `127.0.0.1:<port>` (не `0.0.0.0`)
- Роутинг:
  - `GET /` → HTML
  - `GET /api/tasks` → JSON
  - `POST /api/tasks` → create
  - `PATCH /api/tasks/:id` → update
  - `DELETE /api/tasks/:id` → archive
  - `GET /api/config` → конфиг
- Открытие браузера: `child_process.exec('open ...')` на macOS

### `src/web/api.mjs`

REST-хендлеры над `store.mjs`.

### `src/web/assets.mjs`

Один HTML-шаблон строкой. Inline `<style>` и `<script>`:
- Vanilla JS: fetch `/api/*`
- HTML5 drag-and-drop
- Тёмная/светлая тема
- Модалка создания/редактирования
- Редактор AC

**Весь UI — на русском.**

### `src/cli/commands/browser.mjs`

- `browser [--port 3030] [--no-open]`

## Без CDN

Все ассеты inline.

## Acceptance Criteria

- [ ] Сервер слушает только `127.0.0.1`
- [ ] Канбан рендерится с колонками
- [ ] Drag-and-drop меняет статус
- [ ] Форма создания работает
- [ ] Редактор AC работает
- [ ] Тёмная/светлая тема переключается
- [ ] UI на русском
- [ ] Комментарии в коде на русском

## Definition of Done

- [ ] `node bin/vibelog.mjs browser` открывает `http://127.0.0.1:3030`
- [ ] Канбан работает
- [ ] Если расхождения — план обновлён