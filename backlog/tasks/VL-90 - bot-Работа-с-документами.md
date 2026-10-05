---
id: VL-90
title: '#bot Команда commits <X=10>'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 18:31'
updated_date: '2026-10-05 21:30'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Команда Telegram-бота `/commits [X]` (по умолчанию X=10) — таблица последних X коммитов git-репозитория проекта, по аналогии с `/tasks`. Read-only: только чтение git log, ничего не коммитится.

Реализация по паттернам VL-88 (/diff):

- **Реестр**: `src/bot/registry.ts` — запись `{ command: 'commits', usage: '/commits [N]' }` (меню Telegram + help /start).
- **Парсер**: `src/bot/commands.ts` — `parseCommitsCommand`: пусто → 10; положительное целое → N; иначе `{error}` с подсказкой синтаксиса. Юнит-тесты парсера.
- **Core**: `getGitLog(cwd, count)` в **объединённом** `src/core/git.ts` — git.ts + git-user.ts + git-status.ts сливаются в один модуль (решение Pavel 2026-10-05, комментарий к запуску Фазы 2: отдельный git-log.ts НЕ создаётся; в оригинале Backlog.md git тоже в одном модуле src/git/operations.ts): spawnSync git, чистый парсер `parseGitLog(stdout)` — тестируется без git: массив коммитов `{hash (короткий), author, date, subject}` через `git log -n <count>` с машиночитаемым форматом (%h/%an/%ad/%s, разделитель \x1f). Git-сбой / не-git-репозиторий — ошибка наружу, хендлер шлёт сообщение в чат, бот не падает (паттерн /diff); пустой репозиторий без коммитов — пустой массив (отличать через rev-parse, не через stderr — локализация git).
- **Хендлер**: `src/bot/handlers.ts` — requireBind → парсер → getGitLog → rich-таблица `renderCommitsRich` (`src/bot/rich.ts`, паттерн renderDiffRich) с фолбэком MarkdownV2 (`formatCommitsList` в formatting.ts, паттерн formatDiffList). Пустой лог (нет коммитов) — короткое сообщение, таблица не строится (как пустой /tasks).
- **Документация**: `docs/user-guide.md`, раздел бота — subsection аналогичный /diff (строка ~355, перед «Документы в боте (VL-89)»).

Исследование 2026-10-05: хендлер /diff (handlers.ts:397) — ближайший аналог; git-status.ts (183 стр.) — образец core-модуля с spawnSync и чистым парсером; парсеры commands.ts — чистые функции с {error}-подсказками; rich.ts — HTML-таблицы <table bordered striped compact>.

**Комментарий Pavel 2026-10-05 (корректирует Core-пункт):** git-модули core объединяются в один `src/core/git.ts` (git.ts + git-user.ts + git-status.ts + новый getGitLog); отдельного git-log.ts не создаётся. AC#1 поправлен соответствующим образом.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /commits зарегистрирована в src/bot/registry.ts (меню Telegram + help /start) и обработана в handlers.ts с requireBind; parseCommitsCommand в commands.ts покрыт юнит-тестами (пусто → 10, число → N, мусор → {error}); getGitLog — в src/core/git.ts (объединённый git-модуль: git.ts + git-user.ts + git-status.ts слиты в один по комментарию Pavel 2026-10-05, отдельного git-log.ts нет) — тестируется чистым парсером parseGitLog stdout без git
- [x] #2 /commits выводит таблицу последних X коммитов (хеш, автор, дата, тема) через rich-таблицу renderCommitsRich с фолбэком MarkdownV2; без параметра — 10 коммитов, /commits 5 — ровно 5; git-сбой или не-git-репозиторий — сообщение об ошибке без падения бота, пустой лог — короткое сообщение без таблицы
- [x] #3 Тесты бота проходят (pnpm test), docs/user-guide.md обновлён описанием команды /commits (раздел бота, аналог /diff)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-90 — /commits [X] (Фаза 2: Plan)

### Ключевое решение (комментарий Pavel 2026-10-05)
Новый модуль `git-log.ts` НЕ создаётся. Три git-файла core объединяются в один `src/core/git.ts`:
- `git.ts` (31 стр., `findGitRoot`) — остаётся основой файла;
- `git-user.ts` (29 стр., `getGitUserName`) — переносится в git.ts, файл удаляется;
- `git-status.ts` (183 стр., `getGitStatus`/`parsePorcelain`/`parseNumstat`/`DiffFile`/`GitStatus`) — переносится в git.ts, файл удаляется;
- новый `getGitLog`/`parseGitLog`/`GitCommit` — сразу в git.ts.
В оригинале Backlog.md git тоже один модуль (`src/git/operations.ts`) — слияние соответствует референсу.

### Файлы для изменения

**1. `src/core/git.ts` (31 → ~330 стр.) — единый git-модуль:**
- Шапка-комментарий обновить: «Единый git-модуль Vibelog: корень репозитория, имя автора, статус /diff (VL-88), log /commits (VL-90)».
- Сохранить `findGitRoot` (строки 20–31) без изменений.
- Перенести из git-user.ts: `getGitUserName` (JSDoc + функция, строки 14–29).
- Перенести из git-status.ts: `STATUS_MAP` (16–25), `DiffFile` (27–41), `GitStatus` (43–55), `unquotePath` (57–…), `parsePorcelain` (75–…), `parseNumstat` (129–…), `getGitStatus` (160–183) — в том же порядке, с JSDoc.
- Добавить (VL-90):
  - `export interface GitCommit { hash: string; author: string; date: string; subject: string; }` — короткий хеш, автор, дата, тема.
  - `export function parseGitLog(stdout: string): GitCommit[]` — чистый парсер: split по `\n`, пропуск пустых строк, split по `\x1f` (unit separator), первые 3 поля + join остатка как subject (защита от \x1f в теме).
  - `export function getGitLog(cwd: string, count: number, env: NodeJS.ProcessEnv = process.env): GitCommit[]`:
    1) `git rev-parse --is-inside-work-tree` → status!==0 → throw `'Git недоступен или это не git-репозиторий'` (та же формулировка, что в getGitStatus);
    2) `git rev-parse --verify HEAD` → status!==0 → return `[]` (пустой репозиторий без коммитов — локаль-независимо, stderr НЕ парсим);
    3) `git log -n <count> --format=%h%x1f%an%x1f%ad%x1f%s --date=format-local:%Y-%m-%d %H:%M` → `parseGitLog(stdout)`.
  - Импорт `spawnSync` добавить (в git.ts его сейчас нет).

**2. `src/core/git-user.ts`** — удалить (содержимое перенесено).

**3. `src/core/git-status.ts`** — удалить (содержимое перенесено).

**4. Импорты (5 файлов, точные строки):**
- `src/core/project-settings.ts:16` — `'./git-user.js'` → `'./git.js'`
- `src/cli/commands/init.ts:24` — `'../../core/git-user.js'` → `'../../core/git.js'`
- `src/bot/handlers.ts:13` — `import { getGitStatus }` → `import { getGitLog, getGitStatus } from '../core/git.js'`
- `src/bot/handlers.ts:14` — `import type { DiffFile, GitStatus }` → `import type { DiffFile, GitStatus, GitCommit } from '../core/git.js'`
- `src/bot/rich.ts:17` — `'../core/git-status.js'` → `'../core/git.js'`; в type-импорт добавить `GitCommit`
- `src/bot/formatting.ts:13` — `'../core/git-status.js'` → `'../core/git.js'`; в type-импорт добавить `GitCommit`
- `src/core/paths.ts:16` — БЕЗ изменений (уже `'./git.js'`, findGitRoot остаётся на месте)
Контроль: `grep -rn "git-status\|git-user" src/` → 0 совпадений (CHANGELOG-упоминания VL-88 — исторические, не трогать).

**5. `src/bot/commands.ts` (237 стр.):**
- Интерфейс после `PromptCommand` (строки 53–55): `export interface CommitsCommand { count: number; }`
- Функция вконце файла (после parsePromptCommand, строка 237): `parseCommitsCommand(text: string): CommitsCommand | { error: string }` — trim; пусто → `{count:10}`; `/^\d+$/` && Number>0 → `{count:Number}`; иначе `{error:'Синтаксис: /commits [N]'}` (0, отрицательные, дробные, буквы → error).

**6. `src/bot/registry.ts` (69 стр.):**
- После строки 33 (`diff`): `{ command: 'commits', description: 'Последние коммиты git (log)', usage: '/commits [N]' }`. Порядок критичен — registry.test.mjs сверяет порядок с bot.command в handlers.ts (deepEqual).

**7. `src/bot/rich.ts` (585 стр.):**
- После `renderDiffRich` (конец ~строки 515, перед JSDoc renderPhaseResultRich): `export function renderCommitsRich(commits: GitCommit[]): string` — паттерн renderDiffRich: `if (commits.length === 0) return '';`; header `<tr><th>Хеш</th><th>Автор</th><th>Дата</th><th>Тема</th></tr>`; строки `<tr><td><code>${cellSafe(c.hash)}</code></td><td>${cellSafe(c.author)}</td><td>${cellSafe(c.date)}</td><td>${cellSafe(c.subject)}</td></tr>`; сборка `<table bordered striped compact>`; заголовок `# 📜 Последние коммиты`. Без кнопок (как у /diff).

**8. `src/bot/formatting.ts` (229 стр.):**
- После `formatDiffList` (~строка 111, перед JSDoc formatPhaseRun): `export function formatCommitsList(commits: GitCommit[]): string` — MarkdownV2-фолбэк, паттерн formatDiffList: строки `*${escapeMarkdownV2(c.hash)}* — ${escapeMarkdownV2(c.author)} \\(${escapeMarkdownV2(c.date)}\\): ${escapeMarkdownV2(c.subject)}`, join по `\n`.

**9. `src/bot/handlers.ts` (857 стр.):**
- Импорты: блок `'./commands.js'` (заканчивается строкой 53) — добавить `parseCommitsCommand`; блок `'./rich.js'` (29–38) — `renderCommitsRich`; блок `'./formatting.js'` (15–28) — `formatCommitsList`; git.js — см. п.4.
- `async function sendCommitsView(bot, chatId, commits)` — вставить после `sendDiffView` (строки 184–198, после `}` на 198): try `chunkRich(renderCommitsRich(commits))` → `sendRichMessage`; catch → `sendText(formatCommitsList(commits))` — 1-в-1 паттерн sendDiffView.
- `bot.command('commits', ...)` — вставить после хендлера diff (после `});` на строке 411, ДО комментария «── Управление задачами (VL-35)» на строке 413): `requireBind` → guard chatId → `parseCommitsCommand((ctx.match ?? '').toString())` → `'error' in parsed` → `sendMd(parsed.error)` → try `getGitLog(deps.cwd, parsed.count)` catch → `sendMd(err.message)` (git-сбой не роняет бота) → `commits.length === 0` → `sendMd('Коммитов нет')` → `sendCommitsView(bot, chatId, commits)`.

**10. Тесты:**
- `src/core/git-status.test.mjs` → переименовать в `src/core/git.test.mjs` (mv); импорт `'../../dist/core/git.js'`. Существующие describe (parsePorcelain/parseNumstat/getGitStatus-интеграция) остаются. Добавить:
  - `describe('parseGitLog (VL-90)')`: stdout с \x1f-полями (2–3 коммита) → порядок и поля; пустая строка → `[]`; subject с \x1f → join остатка.
  - `describe('getGitLog — интеграция с реальным git (VL-90)')` (паттерн getGitStatus-блока: mkdtemp /tmp, ISO_ENV с GIT_CONFIG_GLOBAL=/dev/null): repo с 3 коммитами → `getGitLog(root, 2, ISO_ENV)` длина 2, `[0].subject` = последний коммит, hash непустой; пустой репо (только git init) → `[]`; не-git-директория → throw `/Git недоступен/`.
- `src/bot/commands.test.mjs` (210 стр., вконец): `describe('parseCommitsCommand (VL-90)')`: `''` и `'   '` → `{count:10}`; `'5'` → 5; `' 7 '` → 7; `'0'` → error; `'-3'` → error; `'3.5'` → error; `'abc'` → error; error содержит «Синтаксис» и `/commits`.
- `src/bot/registry.test.mjs` (69 стр.): строка 13 — `BOT_COMMANDS.length` 16 → 17; строки 45–48 — commandsHelp(): в хардкод после `/diff` вставить `/commits [N]`. Тест «реестр покрывает все bot.command из handlers.ts (имена и порядок)» пройдёт сам при совпадении позиции (commits сразу после diff в обоих файлах).
- `src/bot/rich.test.mjs` (676 стр., вконец): `describe('renderCommitsRich (VL-90)')`: заголовок `# 📜 Последние коммиты`, колонки таблицы, экранирование (subject с `<` → cellSafe, сырых тегов нет), пустой массив → `''`.
- `src/bot/formatting.test.mjs` (303 стр., вконец): `describe('formatCommitsList (VL-90)')`: спецсимволы экранированы (escapeMarkdownV2), формат строки `*hash* — author (date): subject`.

**11. Документация:**
- `docs/user-guide.md`: новый subsection после блока /diff (строка 355), перед `### Документы в боте (VL-89)` (строка 357): «### Команды git — /commits (VL-90)»: read-only команда, таблица колонок Хеш/Автор/Дата/Тема, дефолт 10, `/commits 5` — ровно 5, пустой лог → «Коммитов нет», git-сбой/не-git-репозиторий → ошибка в чат без падения, rich + фолбэк MarkdownV2 (`formatCommitsList`), сбор — `getGitLog(cwd, count)` в `src/core/git.ts` (объединённый git-модуль). Плюс строка 355: `src/core/git-status.ts` → `src/core/git.ts`.
- `CHANGELOG.md`: в [Unreleased] → «Добавлено» — запись VL-90 (команда /commits; в записи упомянуть слияние git-модулей core в один git.ts).

### Порядок действий
1. Слияние core: собрать новый `src/core/git.ts` (findGitRoot + getGitUserName + git-status-блок + git-log-блок); удалить `git-user.ts`, `git-status.ts`; обновить 5 импортов; `mv src/core/git-status.test.mjs src/core/git.test.mjs` + правка импорта в нём.
2. `commands.ts`: CommitsCommand + parseCommitsCommand.
3. `registry.ts`: запись commits после diff.
4. `rich.ts`: renderCommitsRich; `formatting.ts`: formatCommitsList.
5. `handlers.ts`: импорты → sendCommitsView → bot.command('commits').
6. Тесты: git.test.mjs (parseGitLog + getGitLog-интеграция), commands.test.mjs, registry.test.mjs (17 + help), rich.test.mjs, formatting.test.mjs.
7. Документация: user-guide.md + CHANGELOG.md.

### Проверка
```bash
pnpm build && pnpm test
grep -rn "git-status\|git-user" src/   # должно быть пусто
```
`pnpm test` = build + `node --test src`. Примечание: одиночный «# fail 1» после параллельного smoke — известная флакость smoke-теста, смотреть полный вывод (падают ли конкретные describe).
Правки файлов — патч-скриптами на Node.js (правило проекта), якоря брать дословно из файла (sed), не угадывать.

### Риски
- Слияние модулей затрагивает импорты в 5 файлах + 1 тест; пропущенный импорт — падение tsc (build ловит сразу).
- Пустой репозиторий: `git log` падает с exit 128 и ЛОКАЛИЗОВАННЫМ stderr — не парсить stderr; различать через `rev-parse --is-inside-work-tree` (→ throw) и `rev-parse --verify HEAD` (→ `[]`).
- `registry.test.mjs` хардкодит длину реестра (16) и help-строку — обязательно обновить оба, иначе pnpm test падает.
- Порядок BOT_COMMANDS должен совпадать с порядком bot.command в handlers.ts (тест deepEqual) — commits сразу после diff в обоих файлах.
- `--date=format-local:` требует git ≥ 2.6 (на Catalina системный git новее — ок); при отказе git — ошибка в чат, бот не падает.
- dist пересобирается начисто (build делает rmSync dist) — застарелых git-status.js/git-user.js в dist не будет.
- CHANGELOG-запись VL-88 упоминает src/core/git-status.ts — историческая, не переписывать.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 18:35
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича — две команды Telegram-бота `/docs` (список документов backlog/docs/) и `/doc <id>` (карточка документа: метаданные + тело), строго по аналогии с существующими `/tasks` и `/task`.
Исследование:
- `src/bot/registry.ts` — реестр BOT_COMMANDS (меню Telegram + help /start); новые команды добавляются сюда.
- `src/bot/handlers.ts` (752 стр.) — паттерн хендлеров: requireBind → парсер → core-функция → sendMd/sendTasksView/sendTaskView с rich-фолбэком MarkdownV2.
- `src/bot/commands.ts` (237 стр.) — чистые парсеры (parseStatusCommand/parseCommentCommand как образец для parseDocCommand).
- `src/core/document.ts` (252 стр.) — listDocuments/getDocument уже реализованы (использует CLI `vibelog doc`), боту достаточно их импортировать.
- `docs/user-guide.md` — раздел бота (строки ~287-365), туда дописать /docs и /doc.
Масштаб: одна задача (две команды по готовым паттернам, core-слой не меняется). Установлен type=task, добавлены 3 AC.
---
author: @agent
created: 2026-10-05 18:50
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича — одна команда Telegram-бота `/commits [X]` (по умолчанию X=10) — таблица последних X коммитов git-репозитория проекта, по аналогии с `/tasks`; read-only, ничего не коммитится.
Исследование:
- `src/bot/registry.ts` (69 стр.) — реестр BOT_COMMANDS (меню Telegram + help /start); новая команда добавляется сюда с usage `/commits [N]`.
- `src/bot/handlers.ts` (752 стр.) — хендлер `/diff` (строка 314) — ближайший аналог: requireBind → core-функция в try/catch → rich-таблица с фолбэком MarkdownV2; git-сбой/не-git-репозиторий → сообщение в чат, бот не падает; пустой результат → короткое сообщение без таблицы.
- `src/core/git-status.ts` (183 стр.) — образец core-модуля для git (spawnSync, core.quotepath=false для кириллицы, чистый парсер stdout тестируется без git). Новый модуль `src/core/git-log.ts` — по этому же паттерну: getGitLog(cwd, count) → {hash, author, date, subject}.
- `src/bot/commands.ts` (237 стр.) — чистые парсеры с {error}-подсказками (parseCloseCommand/parsePlanCommand — образец для parseCommitsCommand: пусто → 10, число → N, мусор → error).
- `src/bot/rich.ts` — renderDiffRich/renderTasksRich — паттерн HTML-таблицы <table bordered striped compact> для renderCommitsRich.
- `docs/user-guide.md` — раздел бота, subsection /diff (строка ~343) — аналогичный блок для /commits.
Важно: прежние AC в задаче относились к командам /docs и /doc (скопированы из VL-89) — удалены, добавлены 3 критерия под /commits. Декомпозиция не требуется — одна команда по готовым паттернам, core-слой не меняется (кроме нового git-log.ts).
---
author: Pavel Bobarev
created: 2026-10-05 19:16
---
Мне кажется стоит объединить уже созданные в core файлы работы с git в один и писать туда, а не создавать ещё один.
---
author: @agent
created: 2026-10-05 19:45
---
Фаза 2 (Plan) выполнена.
**Тип:** task — план записан в задачу (VL-90), дочерние задачи не создавались.
**Комментарий учтён:** отдельный `src/core/git-log.ts` не создаётся — git-модули core объединяются в один `src/core/git.ts` (git.ts + git-user.ts + git-status.ts, все импорты обновляются: project-settings.ts, init.ts, handlers.ts, rich.ts, formatting.ts; paths.ts уже импортирует из git.js). AC#1 поправлен на объединённый модуль (добавлен новый критерий #1 вместо упоминания git-log.ts, #2/#3 пересозданы без изменений сути).
**План (кратко):**
1. Слияние core: git.ts расширяется до ~330 стр. (findGitRoot + getGitUserName + git-status-блок + новые GitCommit/parseGitLog/getGitLog); git-user.ts и git-status.ts удаляются; git-status.test.mjs → git.test.mjs + тесты parseGitLog/getGitLog (интеграция с реальным git в /tmp).
2. getGitLog: `git log -n <count> --format=%h%x1f%an%x1f%ad%x1f%s`; пустой репозиторий различается через `rev-parse --verify HEAD` (→ []), не-git — через `rev-parse --is-inside-work-tree` (→ throw).
3. Бот по паттернам VL-88: parseCommitsCommand (пусто→10, N→N, мусор→error) в commands.ts; запись в registry.ts после diff; renderCommitsRich (rich.ts) + formatCommitsList (formatting.ts); хендлер + sendCommitsView в handlers.ts; registry.test.mjs — 16→17 и help-строка.
4. Доки: docs/user-guide.md — раздел «Команды git — /commits» после /diff; CHANGELOG.md — запись VL-90.
**Проверка:** `pnpm build && pnpm test`; `grep -rn "git-status\|git-user" src/` — пусто.
Статус → Planned.
---
author: @agent
created: 2026-10-05 21:03
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `src/core/git.ts` — единый git-модуль: слиты `git-user.ts` (getGitUserName) и `git-status.ts` (STATUS_MAP/DiffFile/GitStatus/unquotePath/parsePorcelain/parseNumstat/getGitStatus) + новые `GitCommit`/`parseGitLog`/`getGitLog` (VL-90); `git-user.ts` и `git-status.ts` удалены (решение Pavel 2026-10-05, комментарий к Фазе 2).
- Импорты обновлены: `src/core/project-settings.ts`, `src/cli/commands/init.ts`, `src/bot/handlers.ts`, `src/bot/rich.ts`, `src/bot/formatting.ts` (все → `../core/git.js`; `paths.ts` уже импортировал из git.js).
- `src/bot/commands.ts` — `CommitsCommand` + `parseCommitsCommand` (пусто → 10, положительное целое → N, иначе {error} «Синтаксис: /commits [N]»).
- `src/bot/registry.ts` — запись `{command: 'commits', usage: '/commits [N]'}` сразу после diff.
- `src/bot/rich.ts` — `renderCommitsRich` (таблица «Хеш | Автор | Дата | Тема», cellSafe, без кнопок; пустой вход → '').
- `src/bot/formatting.ts` — `formatCommitsList` (MarkdownV2-фолбэк, паттерн formatDiffList).
- `src/bot/handlers.ts` — `sendCommitsView` (паттерн sendDiffView) + `bot.command('commits')`: requireBind → парсер → getGitLog → ошибка в чат без падения / «Коммитов нет» / таблица.
**Тесты:** `src/core/git-status.test.mjs` → `git.test.mjs` (+ parseGitLog: \x1f-поля, пустой stdout, subject с \x1f; getGitLog-интеграция: реальный git в /tmp, count=2 → ровно 2, пустой репо → [], не-git → throw); `commands.test.mjs` (+parseCommitsCommand); `registry.test.mjs` (16→17, help-строка); `rich.test.mjs` (+renderCommitsRich: заголовок/колонки, cellSafe, пустой вход); `formatting.test.mjs` (+formatCommitsList: формат, экранирование, join).
**Проверки:** `pnpm build` OK; `pnpm test` — **617/617, 0 fail** (в т.ч. интеграционные с реальным git); `grep -rn "git-status\|git-user" src/` — только историческое упоминание в шапке git.ts.
**Документация:** `docs/user-guide.md` — раздел «Команды git — /commits (VL-90)» после /diff + путь getGitStatus → `src/core/git.ts`; `CHANGELOG.md` — запись VL-90 в [Unreleased] (упомянуто слияние git-модулей).
**Нюансы реализации:** пустой репозиторий различается через `rev-parse --verify HEAD` → `[]` (stderr не парсим — локализация git); не-git — `rev-parse --is-inside-work-tree` → throw с той же формулировкой, что у getGitStatus. В тестах учтено, что escapeMarkdownV2 экранирует дефисы (дата → `2026\-10\-05`) и cellSafe экранирует `<` как `&#60;`.
**Что осталось:** git commit/push не выполнялись (правила фазы). Живой прогон в Telegram не делался — покрытие логики через юнит- и интеграционные тесты (паттерн VL-88).
---
author: Pavel Bobarev
created: 2026-10-05 21:16
---
Сделай колонку Тема первой, потом дата, потом автор, потом хеш
---
author: @agent
created: 2026-10-05 21:21
---
Фаза Comment выполнена: порядок колонок /commits изменён на Тема → Дата → Автор → Хеш (запрос Pavel 2026-10-05 21:16).
**Изменено:**
- `src/bot/rich.ts` — `renderCommitsRich`: header `<tr><th>Тема</th><th>Дата</th><th>Автор</th><th>Хеш</th></tr>`, ячейки в новом порядке (тема, дата, автор, хеш — хеш остался в `<code>`); JSDoc обновлён.
- `src/bot/formatting.ts` — `formatCommitsList` (MarkdownV2-фолбэк): формат строки `subject (date) — author *hash*` — порядок полей согласован с rich-таблицей; JSDoc обновлён.
- `src/bot/rich.test.mjs` — тест колонок проверяет точный порядок header и порядок ячеек первой строки данных.
- `src/bot/formatting.test.mjs` — тест формат-строки обновлён под новый порядок.
- `docs/user-guide.md` — колонки в описании /commits: «Тема | Дата | Автор | Хеш».
- `CHANGELOG.md` — запись VL-90: тот же порядок колонок.
**Проверки:** `pnpm build` OK; `pnpm test` — **617/617, 0 fail**; grep по старому порядку («Хеш | Автор…») — пусто.
Статус не менялся (в комментарии просьбы о смене не было).
---
author:  @agent
created: 2026-10-05 21:30
---
Фаза Close выполнена. Статус: Done. Коммит feat: 2156708 — команда /commits (git log в Telegram-боте), слияние git-модулей core в git.ts; плюс незакоммиченный код VL-91 (пометка 🔄 активной фазы в /tasks) — он оказался в тех же файлах (handlers.ts/rich.ts/formatting.ts/user-guide.md), фаза Close VL-91 не сделала feat-коммит, поэтому закоммичен в этом же feat-коммите. Не закоммичено (чужие задачи): docs/cli-reference.md (VL-85/86), backlog/tasks/VL-75, backlog/docs/doc-5 (VL-85), backlog/tasks/VL-92.
---
<!-- COMMENTS:END -->