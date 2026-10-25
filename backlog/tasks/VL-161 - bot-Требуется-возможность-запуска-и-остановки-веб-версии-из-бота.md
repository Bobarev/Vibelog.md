---
id: VL-161
title: Требуется возможность запуска и остановки веб версии из бота
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 00:40'
updated_date: '2026-10-25 23:25'
due_date: ''
labels:
  - bot
  - web
dependencies: []
milestone: v1.9
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/web.ts
  - src/bot/web.test.mjs
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - README.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Требуется возможность запуска и остановки веб версии из бота. При чём запуск версии должен происходить из того окружения в котором сейчас запущен бот (restart <VL-N>)

Делается это для того чтобы можно было проверять что сделано в worktree для веб версии.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /web start [VL-N] запускает vibelog browser из CLI текущего окружения бота (после /restart VL-N — из worktree vb/vl-N; с аргументом VL-N — ensure+build worktree и запуск из него); URL сообщается в чат
- [x] #2 /web stop останавливает запущенный ботом веб-сервер; повторные /web start (уже запущен) и /web stop (не запущен) идемпотентны с понятными сообщениями
- [x] #3 Команда web есть в BOT_COMMANDS (меню Telegram + help /start), задокументирована в README; тесты парсера, web-модуля и реестра проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-161: запуск/остановка веб-версии из бота

## Контекст

- Бот уже умеет самоперезапуск из worktree: `/restart VL-N` (VL-70/107/151) — см. `src/bot/restart.ts`, хендлер в `src/bot/handlers.ts:987-1046`.
- Веб-сервер: `startWebServer(cwd, port, openBrowser)` в `src/web/server.ts:33` — слушает 127.0.0.1, печатает `Веб-интерфейс Vibelog.md: <url>` в stdout (строка 88), при EADDRINUSE пишет ошибку и `process.exit(1)` (строки 100-104). CLI-обёртка — `runBrowser` в `src/cli/commands/browser.ts`: порт из флага `--port` или `loadConfig(cwd).default_port || 3030`.
- Статика `web/dist` коммитится в git (VL-26, комментарий в `src/web/static.ts:9-11`) — worktree отдаёт UI из своей ветки автоматически, отдельная сборка web в worktree не требуется, если ветка не меняла web UI.

## Решение

Команда `/web` с подкомандами:

- `/web start [VL-N]` — запуск `vibelog browser` **дочерним процессом текущего бота**. CLI по умолчанию — `vibelogCliPath()` (резолв от import.meta.url текущего процесса): после `/restart VL-N` бот исполняет worktree-dist → веб тоже стартует из worktree. Это ровно требование задачи: «запуск из того окружения в котором сейчас запущен бот». С аргументом `VL-N` — ensure+build worktree (как в /restart) и запуск из `worktreeCliPath` (позволяет проверить веб ветки, не перезапуская бота).
- `/web stop` — kill дочернего процесса.

Состояние (текущий ChildProcess) — модульный синглтон в новом `src/bot/web.ts` (паттерн `activeRuns` в `src/web/orchestrator.ts`).

## Файлы

### 1. `src/bot/web.ts` (новый)

- `parseWebCommand(text: string): { action: 'start'; taskId?: string } | { action: 'stop' } | { error: string }` — пусто/`start` → start; `start VL-N` → start с taskId (нормализация к верхнему регистру, как `parseRestartCommand`, `src/bot/commands.ts:400-405`); `stop` → stop; иначе `{ error: 'Синтаксис: /web start [VL-N] | /web stop' }`.
- `spawnWebServer(cwd, cliPath, stdio = 'pipe', port?): ChildProcess` — `spawn(process.execPath, [cliPath, 'browser', '--no-open', ...(port ? ['--port', String(port)] : [])], { cwd, stdio })`. `--no-open`: бот запускает веб из чата, автозапуск браузера на серверной машине не нужен; URL шлём в чат. Держит модульную переменную `webChild`; при повторном spawn сначала `kill()` старого (перезапуск). Возвращает child.
- `currentWebServer(): ChildProcess | null`, `stopWebServer(): boolean` — kill + сброс синглтона; false, если не запущен.
- `webServerUrl(port: number): string` — `http://127.0.0.1:${port}` (для сообщения в чат; порт дефолтный 3030 или из config — хендлер вычисляет сам через `loadConfig`).

### 2. `src/bot/handlers.ts` (правки)

- Импорт: `parseWebCommand`, `spawnWebServer`, `stopWebServer` из `./web.js` (+ `vibelogCliPath` уже доступен через `./restart.js` — добавить в существующий импорт строки 45); `loadConfig` уже импортирован (строка 10).
- После хендлера `/restart` (после строки 1046) — `bot.command('web', ...)`:
  - `requireBind(ctx)`;
  - парсинг `parseWebCommand((ctx.match ?? '').toString())`, при error — sendMd;
  - `stop` → `stopWebServer()` ? «⏹ Веб-интерфейс остановлен» : «Веб-интерфейс не запущен»;
  - `start` → определить cliPath (см. Решение; ensure/build — теми же try/catch с sendMd ошибок, что `/restart`, строки 1003-1022);
  - если `currentWebServer()` не null и жив — сообщение «перезапускаю»;
  - `spawnWebServer(deps.cwd, cliPath)`, подписаться на stdout: первая строка `Веб-интерфейс Vibelog.md: <url>` → sendMd `🌐 <url>`; `exit` с кодом ≠0/без URL → sendMd «⚠️ Веб-интерфейс не запустился (порт занят? смотрите --port)» и сброс синглтона;
  - порт для дефолтного URL-сообщения: `loadConfig(deps.cwd).default_port || 3030` (фолбэк, если stdout не распарсился).

### 3. `src/bot/registry.ts` (правка)

- В `BOT_COMMANDS` после `restart` (строка 50): `{ command: 'web', description: 'Веб-интерфейс: /web start [VL-N] | /web stop', usage: '/web start [VL-N] | /web stop' }`.

### 4. Тесты

- `src/bot/web.test.mjs` (новый, паттерн `src/bot/restart.test.mjs`): parseWebCommand (все ветки + мусор → error); spawnWebServer со stub-cli (mkdtemp-файл `stub.mjs`, печатающий URL) — событие spawn, повторный spawn убивает старый; stopWebServer до запуска → false; реестр содержит web.
- `src/bot/commands.test.mjs` — parse-тесты парсера в web.test.mjs (здесь не дублируем).

### 5. `README.md` (документация)

- В список команд бота (строка 233) добавить `/web`; в раздел про `/restart` (строки 273-280) — абзац про `/web start [VL-N]`: запуск веб-версии из текущего окружения бота (worktree после /restart VL-N) и остановка через `/web stop`.

## Порядок действий

1. `src/bot/web.ts` + `src/bot/web.test.mjs`.
2. `src/bot/registry.ts` (команда web) + правка registry.test.mjs, если там есть снапшот списка.
3. `src/bot/handlers.ts` (хендлер /web).
4. README.md.
5. `pnpm build && pnpm test` — все тесты зелёные.

## Проверка

```bash
pnpm build
pnpm test        # vitest: web.test.mjs, registry.test.mjs, commands.test.mjs, handlers-смежные
```

Ручная (после /code): `vibelog bot` → `/web start` → в чате URL, `curl http://127.0.0.1:3030/` → 200; `/web stop` → сервер мёртв; `/restart VL-N` → `/web start` → URL отдаёт UI ветки.

## Риски

- **Порт занят** — дочерний процесс падает с EADDRINUSE (server.ts:100): бот сообщает об ошибку из stderr/exit-кода; повторный `/web start` перезапускает.
- **Два long-polling не мешают** — веб-процесс не трогает Telegram API, конфликта с ботом нет (в отличие от /restart, 409 Conflict).
- **worktree без web/dist** — если ветка не коммитила UI: статика отдаётся из worktree, но web/dist есть в git всегда; если ветка меняла web UI — нужен `pnpm install` в worktree/web + `pnpm web:build` (lesson-6); в плане Code это отдельным шагом не делается — отдаётся закоммиченный web/dist ветки.
- **Зомби-процесс при смерти бота** — SIGKILL бота не убьёт веб-ребёнка; принимаем (контролируемая остановка — `/web stop`), при желании позже можно добавить process.on('exit')-kill.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
Проверка AC через backlog_manage_ac: добавление массива текстом даёт склейку в один пункт — только по одному text за вызов.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 00:43
---
Фаза 1 (Spec) выполнена. Заголовок: очищен от ведущего тега #bot, смысл сохранён. Масштаб: task (одна фича — команды запуска/остановки веб-версии из бота). Уточнено: цель (команды бота для запуска и остановки веб-версии), ограничение (запуск из текущего окружения/worktree бота для задачи VL-N), добавлены 3 проверяемых AC. Labels: bot, web (тег #bot пользователя перенесён в labels). References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 01:11
---
Фаза 2 (Plan) выполнена. Тип: task. Изучены: src/bot/restart.ts (механика /restart VL-N, VL-70/107/151), src/bot/handlers.ts (хендлер /restart, строки 987-1046), src/web/server.ts (startWebServer, stdout-строка URL, EADDRINUSE), src/cli/commands/browser.ts, src/bot/registry.ts, src/core/worktree.ts. Решение: команда /web start [VL-N] | /web stop — дочерний процесс vibelog browser --no-open; CLI по умолчанию резолвится от текущего процесса бота (после /restart VL-N — worktree), с аргументом VL-N — ensure+build worktree. План записан: 3 файла правки (web.ts — новый модуль с парсером и синглтоном ChildProcess, handlers.ts — хендлер после /restart, registry.ts — команда web) + web.test.mjs + README. Учтён lesson-6 (web/dist собирается в worktree отдельно, если ветка меняла UI). Проверка: pnpm build && pnpm test. Риски: занятый порт, зомби-процесс при SIGKILL бота. AC добавлено 3 (по одному — массив в manage_ac склеивается в строку). References не потребовались.
---
author: @agent
created: 2026-10-15 01:21
---
Фаза 3 (Code) выполнена. Коммит 5bcb434 (ветка vb/vl-161). Реализовано по плану: новый модуль src/bot/web.ts (parseWebCommand, spawnWebServer с синглтоном ChildProcess, stopWebServer/clearWebServer, webServerUrl); хендлер /web в handlers.ts после /restart — start (CLI от import.meta.url текущего процесса → после /restart VL-N веб стартует из worktree; с аргументом VL-N — ensure+build worktree + worktreeCliPath) и stop (идемпотентны, повторный start = перезапуск), stdout парсится на строку server.ts «Веб-интерфейс Vibelog.md: <url>» → URL в чат, stderr/exit без URL → сообщение об ошибке (порт занят) + сброс синглтона с защитой от гонки со старым процессом; команда web в BOT_COMMANDS. Обновлены README (список команд + абзац про /web в разделе worktree/рестарта) и registry.test.mjs (19→20, help-строка, тест команды web). Тесты: src/bot/web.test.mjs — 9 новых (парсер, spawn/stop, повторный spawn убивает старый, stdout-строка URL). Проверки: pnpm build + pnpm test — 1107 passed/4 skipped, static.test.mjs отдельно 7 passed; регрессий нет. Ручная проверка в Telegram (живой бот + /web start → curl) остаётся за владельцем. Что осталось: ничего; DoD закрыт (тесты, доки, нет регрессий).
---
author: @agent
created: 2026-10-15 01:25
---
Фаза Close выполнена. Ветка vb/vl-161 слита в master (1 коммит 5bcb434, merge ec8a3ab~1), worktree удалена (untracked-симлинки node_modules/refs — через --force), ветка удалена. Сборка и тесты после merge: pnpm build + pnpm test — зелёные (без регрессий). DoD: все 3 пункта выполнены (тесты проходят — 1107 passed в Фазе 3 и после merge; документация обновлена — README в ветке + CHANGELOG Unreleased, docs-коммит ec8a3ab; регрессий нет). Lessons: похожих уроков нет, нечего фиксировать. Ручная проверка в Telegram (/web start → curl) остаётся за владельцем.
---
<!-- COMMENTS:END -->