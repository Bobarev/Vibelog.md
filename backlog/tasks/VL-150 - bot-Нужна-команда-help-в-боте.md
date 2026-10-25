---
id: VL-150
title: '#bot Нужна команда help в боте'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 08:36'
updated_date: '2026-10-25 23:25'
due_date: ''
labels: []
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
  - src/bot/registry.ts
  - src/bot/handlers.ts
  - src/bot/registry.test.mjs
  - README.md
  - CHANGELOG.md
  - backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md
lessons:
  - lesson-8
  - lesson-9
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot Нужна команда help в боте. Список команд настолько разросся что уже невозможно вспомнить как пользоваться set например. Нужно выводить по help все доступные команды, объяснение и примеры.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan: команда /help в Telegram-боте (VL-150)

## Контекст

Реестр команд — `src/bot/registry.ts` (`BOT_COMMANDS`): единый источник правды для меню Telegram (`syncCommands` → `setMyCommands`) и help-строки `/start` (`commandsHelp()`). Обработчики — `src/bot/handlers.ts` (`bot.command(...)`). Строки registry статические, но содержат MarkdownV2-спецсимволы (`<`, `>`, `-`, `.`) — при выводе в MarkdownV2 их надо экранировать через `escapeMarkdownV2` (`src/bot/formatting.ts:25`; circular import нет — formatting не импортирует registry). Длинный текст режется на части через `chunkRich` (`src/bot/rich.ts:647`) с лимитом `TELEGRAM_TEXT_LIMIT` (паттерн уже используется в handlers.ts).

## Файлы для изменения

### 1. `src/bot/registry.ts`

- **Строка 14-23 (`interface RegistryCommand`)**: добавить необязательное поле `examples?: string[]` — примеры вызова для /help (JSDoc на русском: «Примеры для /help; не передаётся в setMyCommands»).
- **Строка 28 (`BOT_COMMANDS`, сразу после `start`)**: вставить `{ command: 'help', description: 'Все команды: описание и примеры (/help)' }` — /help идёт вторым в меню Telegram (порядок = порядок массива), в `commandsHelp()` (фильтрует только `start`) попадает автоматически.
- **Строки 29-50 (остальные записи `BOT_COMMANDS`)**: дополнить команды с аргументами полем `examples` (только для /help; в `setMyCommands` лишние поля не уходят — массив передаётся целиком, структурная совместимость уже заявлена в комментарии к интерфейсу):
  - `task`: `['/task VL-1']`
  - `doc`: `['/doc doc-1']`
  - `commits`: `['/commits 10']`
  - `status`: `['/status VL-1 In Progress']`
  - `set`: `['/set agent vb', '/set max-wall-time 1800', '/set branch-mode on', '/set compact off']` (полный синтаксис — в description/usage)
  - `comment`: `['/comment VL-1 добавь тесты', '/comment:vb VL-1 перепиши план']`
  - `spec`: `['/spec добавь экспорт задач в CSV']`
  - `plan`: `['/plan VL-12', '/plan:vb VL-12 учти замечания']`
  - `code`: `['/code VL-12', '/code:vb VL-12 продолжи']`
  - `close`: `['/close VL-12', '/close:vb VL-12']`
  - `prompt`: `['/prompt закоммить правки', '/prompt:vb сделай ревью']`
  - `analyze`: `['/analyze vb:agent-1a2b']`
  - `restart`: `['/restart', '/restart VL-12']`
  - `web`: `['/web start', '/web start VL-12', '/web stop']`
- **Строка 41**: вверх файла — `import { escapeMarkdownV2 } from './formatting.js';`.
- **После `commandsHelp()` (строка 63)**: новая функция `helpText(): string`:
  - Заголовок `*Команды Vibelog-бота*` + пустая строка.
  - Для каждой команды `BOT_COMMANDS` (включая `start`): строка `*<escaped(usage ?? '/'+command)>* — <escaped(description)>`; затем каждым примером отдельной строкой `пример: <escaped(example)>`.
  - Всё динамичное (usage, description, examples) — через `escapeMarkdownV2`; возврат — готовый MarkdownV2-текст.
  - Комментарий «почему»: текст собирается из реестра, а не хардкодится — новая команда автоматически появляется в /help (рассинхрон списков — историческая проблема VL-54).

### 2. `src/bot/handlers.ts`

- **Строка 41 (`import { commandsHelp } from './registry.js';`)**: добавить `helpText` в импорт.
- **После обработчика `/start` (строка 383), перед `bot.command('tasks')` (строка 385)**: вставить `bot.command('help', async (ctx) => {...})`:
  - **Без `requireBind`** — справка не содержит данных проекта, доступна до привязки чата (как `/start`).
  - Текст из `helpText()` режется `chunkRich(text, TELEGRAM_TEXT_LIMIT)` и каждая часть отправляется через `sendMd` (фолбэк plain на парс-ошибке MarkdownV2 — существующий паттерн).
- `/start` не меняем: help-строка привязанного чата (`commandsHelp()`) и меню Telegram обновятся автоматически из реестра.

### 3. `src/bot/registry.test.mjs`

- **Строка 13**: `BOT_COMMANDS.length` 20 → 21 (иначе тест падает — фиксированное число).
- **Строки 94-99 (`commandsHelp()`)**: обновить ожидаемую строку — `/help, ` добавляется первым (help в массиве сразу после start, start фильтруется).
- Новый `describe('helpText (VL-150)')`:
  - текст содержит `Команды Vibelog-бота` и `/help`;
  - для каждой команды из `BOT_COMMANDS` в тексте встречается её представление (`usage ?? '/'+command`);
  - `examples` у `set` присутствуют в тексте (проверять `escapeMarkdownV2('/set agent vb')` как подстроку);
  - длина каждой части после `chunkRich(text, TELEGRAM_TEXT_LIMIT)` ≤ 4096.

### 4. Документация

- **`README.md:233`** (перечисление команд бота): добавить `/help` в список: `..., /tasks`, `/task VL-1`, `/help`, `/board`, ...`.
- **`backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md`** (doc-6, раздел «11. Telegram-бот», после строки 303): абзац про `/help` — выводит все команды реестра с описанием и примерами, доступна до привязки чата, `/set`-примеры включены. **Править через MCP `document_update` (id=doc-6)** — файл живёт в backlog/ основного репозитория, worktree-копию не трогать.

## Порядок действий

1. registry.ts: поле `examples` → запись `help` в `BOT_COMMANDS` → примеры к командам → импорт `escapeMarkdownV2` → `helpText()`.
2. handlers.ts: импорт `helpText` → обработчик `/help`.
3. registry.test.mjs: 20→21, строка `commandsHelp()`, новый describe.
4. `pnpm build` — strict-компиляция.
5. `npx vitest run src/bot/registry.test.mjs src/bot/commands.test.mjs` — точечная проверка.
6. `pnpm test` — полный прогон (DoD «Тесты проходят», «Нет регрессий»).
7. README.md:233 → `document_update` doc-6 (DoD «Документация обновлена»).

## Как проверить

```bash
pnpm build
npx vitest run src/bot/registry.test.mjs src/bot/commands.test.mjs
pnpm test
```

Ручная smoke-проверка (по желанию): `vibelog bot` → в чате `/help` — одно или несколько сообщений со справкой, меню Telegram содержит /help.

## Риски

1. **`registry.test.mjs` фиксирует длину реестра (20) и точную строку `commandsHelp()`** — без правок тестов `pnpm test` упадёт; правки включены в план (шаг 3).
2. **MarkdownV2-спецсимволы** в статических строках (`<id>`, `on|off`, дефисы) — все через `escapeMarkdownV2`; фолбэк `sendMd` на plain защищает от 400 «can't parse entities».
3. **Длина сообщения** (21 команда + примеры ≈ 3-4 КБ, лимит Telegram 4096) — заранее режем `chunkRich(text, TELEGRAM_TEXT_LIMIT)` по границам строк.
4. **Изменение help-строки `/start`** (появится `/help`) — ожидаемое, покрыто обновлённым тестом; поведение привязки чата не меняется.
5. doc-6 — только через MCP `document_update`: worktree-копия backlog/ не является хранилищем.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 08:36
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Масштаб: task (одна фича — команда /help). Уточнено: тип задачи (task), добавлены критерии приёмки (полный список команд с описаниями и примерами, включая /set; доступность /help; DoD). Вопросов нет.
---
author: @agent
created: 2026-10-15 07:44
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: команда /help на основе реестра BOT_COMMANDS (src/bot/registry.ts — поле examples в RegistryCommand, запись help сразу после start, новая функция helpText() с экранированием MarkdownV2; src/bot/handlers.ts — обработчик bot.command('help') после /start, без requireBind, отправка частями chunkRich). 4 файла изменений: src/bot/registry.ts, src/bot/handlers.ts, src/bot/registry.test.mjs (20→21 команд, обновление ожидаемой строки commandsHelp + новый describe helpText), README.md:233; doc-6 — через MCP document_update. Риски: registry.test.mjs фиксирует длину реестра и точную строку commandsHelp (правки включены в план); MarkdownV2-спецсимволы — экранирование + фолбэк sendMd; длина сообщения — chunkRich с TELEGRAM_TEXT_LIMIT.
---
author: @agent
created: 2026-10-15 07:54
---
Фаза 3 (Code) выполнена. Изменено: src/bot/registry.ts (поле examples в RegistryCommand, запись help сразу после start — 21 команда, примеры к 14 командам, функция helpText() с экранированием MarkdownV2), src/bot/handlers.ts (обработчик bot.command('help') после /start: без requireBind, отправка chunkRich с лимитом TELEGRAM_TEXT_LIMIT через sendMd), src/bot/registry.test.mjs (20→21, обновлена строка commandsHelp, новый describe helpText — заголовок/все команды/примеры set/лимит частей), README.md (справка /help в перечислении команд бота). Коммит b98a638. Проверки: pnpm build (strict tsc), полный pnpm test — 63 файла/1104 теста passed, регрессий нет; точечный прогон registry+commands после правки теста. doc-6 не обновлял по правилу фазы (документы backlog/docs пишет Close) — добавить абзац про /help в раздел «11. Telegram-бот» при закрытии. AC в задаче нет; DoD: тесты проходят, README обновлён, регрессий нет.
---
author: @agent
created: 2026-10-15 08:20
---
Фаза Close выполнена. Ветка vb/vl-150 слита в master (1 коммит b98a638), worktree удалена (force — только untracked-ссылки оркестратора node_modules/refs), ветка удалена. После merge: pnpm build и полный pnpm test прошли (exit 0). Документация: doc-6 обновлён через document_update (раздел «11. Telegram-бот» — абзац про /help), CHANGELOG.md — запись в Unreleased; docs-коммит 3ea7ec6. Lessons: созданы lesson-8 (единый реестр BOT_COMMANDS для help/меню/справки) и lesson-9 (правки registry.test.mjs в той же итерации), связаны с задачей. DoD: тесты проходят, документация обновлена, нет регрессий — все 3 пункта выполнены.
---
<!-- COMMENTS:END -->