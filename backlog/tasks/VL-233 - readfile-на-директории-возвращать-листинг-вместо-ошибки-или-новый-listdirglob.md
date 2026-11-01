---
id: VL-233
title: 'read_file на директории: возвращать листинг вместо ошибки (или новый list_dir/glob)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 00:49'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - agent
  - mcp
  - tools
  - web
dependencies: []
milestone: v1.11
references: []
priority: high
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - src/web/tool-policy.ts
  - src/web/tool-policy.test.mjs
  - README.md
  - templates/prompts/chat-system.md
lessons:
  - lesson-88
token_usage:
  input: 5475603
  output: 68081
  cache: 5153536
  total: 5539143
  requests: 104
  duration_ms: 1902697
  reasoning: 39107
  by_phase:
    plan:
      input: 1091913
      output: 22384
      cache: 994048
      requests: 27
    code:
      input: 4115383
      output: 39697
      cache: 3927040
      requests: 68
    Close:
      input: 268307
      output: 6000
      cache: 232448
      requests: 9
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Инструмент `read_file` при передаче пути к каталогу возвращает только текст ошибки: «Это директория, не файл: /…/src/agent» — без содержимого. Агент не может узнать структуру проекта и начинает **угадывать пути**: в чате-инциденте (сессия обсуждения VL-232) пошли в никуда `src/agent/orchestrator.ts`, `src/core/auto-runner.ts`, `src/core/orchestrator/index.ts`, `src/cli/orchestrator.ts`, `node_modules/@mixmark-io/domino/package.json` — 6+ холостых вызовов; реальный файл оказался `src/web/orchestrator.ts`. Точные пути удалось найти только косвенно, через `backlog_search` по `modified_files` задач.

Ни `list_dir`, ни `glob`, ни `grep` в наборе инструментов нет — единственный способ ориентироваться это `read_file` по угаданному пути. Это ~60% ходов в диагностических диалогах.

## Цель

Дать агенту дешёвый способ получить структуру каталога за один вызов, не угадывая имена файлов.

## Предлагаемое решение (выбрать в Plan)

Вариант A — расширить `read_file`: если путь — каталог, вернуть отсортированный листинг (файлы/подкаталоги, с суффиксом `/` у каталогов, лимит ~200 записей + пометка об усечении), а не ошибку. Обратная совместимость полная: строковый File-контент не меняется, ошибка «не найден» сохраняется.

Вариант B — отдельный read-only инструмент `list_dir(path, depth=1, glob?)` либо `glob(pattern)`.

Рекомендация: A + опциональный `glob` (второй волной), т.к. A не увеличивает число инструментов и не требует правок промптов о выборе инструмента.

## Места правки (проверить в Plan)

- `src/agent/tools.ts` — `listLocalTools` и реализация чтения файла/описания инструментов;
- `src/mcp/tools.ts` — если read-tools экспонируются через MCP-сервер Vibelog;
- ограничения безопасности: доступ только внутри корня проекта (текущее поведение чтения), symlink-выход за пределы — отклонять; каталоги `.git`, `node_modules`, `dist` — не разворачивать по умолчанию.

## Сопутствующий лог

Зафиксировать в диагностике (stderr/logTail) факт «листинг каталога» — чтобы в анализе сессий (`/analyze`) было видно, что агент ориент��руется, а не перебирает пути.

## Входные данные

Инцидент: обсуждение VL-232 (снятие turndown/turndown-plugin-gfm), где потребовалось найти `htmlToMarkdown()` и место создания LLM-клиента. Ожидаемый эффект: −4…−6 вызовов на один диагностический вопрос.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 read_file на каталоге возвращает отсортированный листинг (файлы и подкаталоги, каталоги с суффиксом /), а не текст ошибки
- [x] #2 Листинг ограничен по размеру (≈200 записей) с явной пометкой об усечении; .git/node_modules/dist не разворачиваются по умолчанию
- [x] #3 Доступ строго внутри корня проекта; выход за пределы (../, абсолютный путь наружу, symlink) отклоняется с прежней понятной ошибкой
- [x] #4 Поведение read_file для обычного файла не изменилось; ошибка «файл не найден» сохранена
- [x] #5 Добавлены тесты: листинг каталога, пустой каталог, усечение по лимиту, отказ на пути вне проекта
- [x] #6 Если инструмент экспонируется через MCP — описание в схеме обновлено и проверено на реальном MCP-вызове
- [x] #7 В документации инструментов (doc по MCP/агенту) отражено новое поведение
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение (выбран вариант A)

Расширяем существующий `read_file`: если путь — каталог, возвращается отсортированный листинг глубины 1, а не текст ошибки. Новых инструментов НЕ добавляем: в локальном наборе агента уже есть `glob` и `grep_search` (`src/agent/tools.ts:686`, `:621`), отдельный `list_dir` увеличил бы число инструментов и потребовал правок промптов о выборе инструмента. MCP-сервер Vibelog файловых read-инструментов не экспонирует (`src/mcp/tools.ts` — только `backlog_*`/`milestone_*`/`document_*`/`reference_*`/`lesson_*`), значит AC6 закрывается фиксацией этого факта, а не правкой схем.

## Файлы для изменения

| Файл | Что меняем |
|---|---|
| `src/agent/tools.ts` | новый экспортируемый хелпер `formatDirListing` + `DIR_LISTING_MAX`; `makeReadFile` (строки 150–178) и `readTextFile` (140–148) — ветка каталога; описание инструмента |
| `src/web/tool-policy.ts` | `makeReadFileTool` (108–150, дир-ошибка на строке 130) — та же ветка листинга через общий хелпер; описание |
| `src/agent/tools.test.mjs` | +6 тестов листинга (сейчас есть только «несуществующий файл», «../», «файл больше лимита») |
| `src/web/tool-policy.test.mjs` | +1 тест: `makeReadFileTool` на каталоге отдаёт листинг |
| `README.md` (≈строки 90–92, блок «`read_file`») | новое поведение: каталог → листинг |
| `templates/prompts/chat-system.md` (строка 7) | описание `read_file` в системном промпте чата |
| `backlog/docs/doc-10` (раздел 5, таблица «Локальные») | строка `read_file`: «файл → строки, каталог → листинг (лимит 200)» — правится через `document_update` в фазе Code/Close |

## Конкретные изменения

### 1. `src/agent/tools.ts`

Новые константы/хелперы рядом с `SKIP_DIRS` (строка 588) — переиспользуют `readdirSync`/`statSync`/`realpathSync` из уже импортированного `node:fs` (+ добавить `realpathSync`, `lstatSync` в импорт на строках 17–24):

- `export const DIR_LISTING_MAX = 200;`
- `const SERVICE_DIRS = new Set(['node_modules', '.git', 'dist']);` — служебные каталоги **показываются** в листинге (как записи с `/`), но сами **не разворачиваются**: вызов `read_file` на пути *внутри* служебного каталога возвращает отказ `Служебный каталог (<имя>) не разворачивается: <abs>`. `SKIP_DIRS` (используется `walkFiles` для glob/grep) **не трогаем** — иначе меняется поведение `glob`/`grep_search` вне рамок задачи.
- `export function formatDirListing(cwd: string, absDir: string): { ok: true; text: string } | { ok: false; error: string }`:
  - `readdirSync(absDir, { withFileTypes: true })`, отказ чтения → `Не удалось прочитать каталог: <msg>`;
  - каталоги (включая симлинк-каталоги через `dirent.isDirectory()`) — с суффиксом `/`;
  - сортировка по имени: сначала каталоги, затем файлы, внутри группы — `localeCompare` с `'en'` (детерминизм, без зависимости от локали машины);
  - обрезка до `DIR_LISTING_MAX` + маркер `…[листинг усечён: показано 200 из N записей; сузь путь]`;
  - пустой каталог → `Каталог пуст: <rel>/`;
  - шапка: `Листинг каталога <rel>/ (<N> записей)` — так факт листинга виден в jsonl-транскрипте и (в headless) в `logTail` через существующий лог `[инструмент] … → out.slice(0,200)` (`src/agent/cli.ts:617`). **Новый `console.error` в tools.ts не добавляем** — TUI рендерится в stderr через Ink, лишняя запись ломает кадр (зеркало мотива VL-215: «console-лог не используем — сломал бы рендер TUI»);
  - **symlink-граница**: перед `readdirSync` — `realpathSync(absDir)`; если `relative(cwd, real)` вне корня (`..`/абсолютный) → отказ `Путь выходит за пределы проекта (симлинк): <rawPath>`. Проверка только для листинга — поведение чтения файла не меняется (AC4);
  - выход за проект по `../`/абсолютному пути уже отсекает `resolveInProject`.
- `makeReadFile` (150–178):
  - `resolveInProject(cwd, path, { allowRoot: true })` — чтобы `path: '.'`/`''` давал листинг корня, а не «Путь должен указывать на файл» (последний текст остаётся для пустого пути через явный `rawPath === ''`);
  - после резолва: `statSync(abs).isDirectory()` → `formatDirListing(...)`; иначе прежний путь `readTextFile`.
- `readTextFile` (140–148): ветку `Это директория, не файл` убрать — она перекрывается проверкой в handler'е (ветка остаётся недостижимой; удаление ветки делает поток однозначным). Тест на текст ошибки отсутствует (`grep` по `src` — только 2 файла-источника).
- Описание `makeReadFile`: добавить «Если path — каталог, возвращается отсортированный листинг (каталоги с `/`, лимит 200 записей); offset/limit для листинга игнорируются».

### 2. `src/web/tool-policy.ts`

`makeReadFileTool` (108–150): после `resolveInProject(cwd, path, { allowRoot: true })` — `statSync(...).isDirectory()` → `formatDirListing` (импорт из `../agent/tools.js`, там уже импортируются `resolveInProject`/`truncateToolOutput`); убрать строку 130 (`Это директория, не файл`). Описание — то же дополнение про каталог. Остальное (read без approval) не меняется — `isWriteOperation('read_file')` остаётся `false` (маркер `read`).

### 3. Тесты

`src/agent/tools.test.mjs` (в `describe('read_file …')` + новый `describe('VL-233 — листинг каталога')`):
1. листинг сортирован, каталоги с `/`: создать `lst/b/`, `lst/a.txt`, `lst/z.txt` → `read_file({path:'lst'})` матчит `Листинг каталога lst/`, порядок `b/` раньше `a.txt`;
2. `path: '.'` → листинг корня проекта (AC1);
3. пустой каталог → `Каталог пуст`;
4. усечение: 205 файлов → ровно 200 строк-записей + `усечён`;
5. отказ на пути вне проекта: `../secrets` → `выходит за пределы проекта` (регрессия существующего теста строки 110 сохраняется);
6. symlink-выход: `symlinkSync(join(tmpdir(),'outside-dir'), join(TMP,'link'))` → отказ с `симлинк`;
7. служебный каталог: `read_file({path:'node_modules'})` → отказ `не разворачивается`;
8. регрессия AC4: обычный файл читается как раньше, `offset/limit` работают (существующие тесты 68–75 проходят без правок), `нет.txt` → `Файл не найден`.

`src/web/tool-policy.test.mjs`: `makeReadFileTool(TMP)` на каталоге отдаёт листинг с `/` (AC5: покрытие веб-пути).

### 4. Документация

- `README.md` (блок «**`read_file`**»): «каталог → отсортированный листинг (каталоги с `/`, лимит 200 записей, служебные `node_modules`/`.git`/`dist` не разворачиваются)».
- `templates/prompts/chat-system.md` стр. 7: то же одной фразой.
- `backlog/docs/doc-10` раздел 5 — через MCP `document_update` (не edit/worktree).
- `doc-8` (MCP-справочник) не трогаем: файловые инструменты через MCP не экспонируются (AC6 — зафиксировать в отчёте Code).

## Порядок действий

1. Хелперы + константы в `src/agent/tools.ts`, переключить `makeReadFile`.
2. Тесты `src/agent/tools.test.mjs` → `pnpm build && pnpm test:fast src/agent/tools.test.mjs`.
3. `src/web/tool-policy.ts` + его тест → `pnpm build && pnpm test:fast src/web/tool-policy.test.mjs src/web/chat.test.mjs` (чат-тесты на `read_file` не должны регрессировать).
4. Документация (README, `templates/prompts/chat-system.md`), затем полный `pnpm test`.
5. Ручная проверка на реальном проекте: `vibelog agent prompt` не нужен — достаточно вызова `read_file({path:'src/agent'})` в короткой headless-сессии или юнит-тестом на корне репозитория.

## Проверка

```bash
pnpm build && pnpm test:fast
pnpm test            # build + vitest run, полный набор
node -e "const {listLocalTools}=require('./dist/agent/tools.js')"   # sanity: модуль грузится
```

## Риски

- **`readTextFile` больше не возвращает «Это директория, не файл»** — если какой-то внешний код/тест ждёт этот текст: grep показал только 2 источника, тестов на текст нет; риск низкий.
- **`allowRoot: true` в read_file** меняет ответ на `path: '.'` (было «Путь должен указывать на файл») — это и есть цель AC1; `resolveInProject` для остальных инструментов не меняется.
- **`formatDirListing` синхронный readdir на огромных каталогах** (`node_modules` с 10k+ записей) — прикрыт лимитом 200 и отказом на служебных каталогах; листинг всё равно сначала читает dirent-ы целиком — на `node_modules` отказ срабатывает ДО `readdirSync`.
- **Симлинк-проверка только в листинге**: чтение файла через symlink наружу остаётся прежним поведением (AC4 «не изменилось»); если Code решит расширить проверку на файлы — нужен отдельный тест на macOS `/tmp → /private/tmp`, иначе сломается `read_file` в тестах с `mkdtemp` (там cwd = сам tmp-каталог, realpath совпадает — проверка безопасна, но требует явного решения).
- **Лог листинга в `logTail`** появляется только в headless (через существующий `[инструмент]` лог) и в jsonl; в TUI отдельной строки не будет — сознательно, чтобы не ломать Ink-рендер.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 01:24
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic) — план записан в задачу, дочерних задач не создавалось.
**Решение:** вариант A (расширить `read_file` листингом каталога) без нового `list_dir`; MCP-сервер Vibelog файловых read-инструментов не экспонирует (`src/mcp/tools.ts` — только backlog/milestone/document/reference/lesson) → AC6 закрывается фиксацией факта, без правки схем.
**Файлы плана (7):** `src/agent/tools.ts` (новый экспорт `formatDirListing` + `DIR_LISTING_MAX=200` + `SERVICE_DIRS`, ветка каталога в `makeReadFile`, удаление недостижимой ветки в `readTextFile`), `src/web/tool-policy.ts` (`makeReadFileTool` — та же ветка через общий хелпер), `src/agent/tools.test.mjs` (+6–8 тестов), `src/web/tool-policy.test.mjs` (+1), `README.md`, `templates/prompts/chat-system.md`, `backlog/docs/doc-10` (через `document_update`).
**Ключевые решения:** `allowRoot: true` в read_file (листинг корня по `path: '.'`); symlink-граница через `realpathSync` только для листинга (чтение файлов не меняется — AC4); `SKIP_DIRS` для glob/grep не трогаем, служебные `node_modules/.git/dist` показываются как записи, но не разворачиваются; лог факта листинга — шапка `Листинг каталога <rel>/` в самом выводе (в headless попадает в logTail через существующий `[инструмент]` лог, без нового `console.error` — иначе ломается Ink-рендер в stderr).
**Проверка:** `pnpm build && pnpm test:fast`, затем полный `pnpm test`.
**Риски:** исчезновение текста «Это директория, не файл» (тестов и потребителей нет — grep: 2 источника); чтение файла через symlink наружу остаётся прежним поведением (осознанно, AC4); синхронный readdir на больших каталогах прикрыт лимитом и отказом на служебных.
---
author: @agent
created: 2026-10-30 01:54
---
Фаза 3 (Code) выполнена. Коммит `a30a325` — feat: VL-233 — read_file возвращает листинг каталога вместо ошибки.
**Изменено:**
- `src/agent/tools.ts` — новый экспорт `DIR_LISTING_MAX = 200` и `formatDirListing(cwd, absDir)`: `readdirSync(withFileTypes)` → каталоги первыми с суффиксом `/`, внутри групп `localeCompare(…, 'en')`, обрезка до 200 с маркером `…[листинг усечён: показано 200 из N]`, пустой каталог → `Каталог пуст: <rel>/`, шапка `Листинг каталога <rel>/ (N записей, показано M)` (факт листинга виден в jsonl и в headless-logTail через существующий `[инструмент]`-лог, без нового `console.error` — Ink-рендер не ломается). Границы: `SERVICE_DIRS = node_modules/.git/dist` не разворачиваются (в т.ч. вложенные пути), `realpathSync(absDir)` vs `realpathSync(cwd)` отсекает симлинк наружу (сравнение realpath — не ломает `/tmp → /private/tmp`). `makeReadFile` резолвит с `allowRoot: true` (листинг корня по `path: '.'`), ветка каталога до `readTextFile`; из `readTextFile` удалена недостижимая ветка «Это директория, не файл»; описание инструмента дополнено. `SKIP_DIRS` для glob/grep не тронут.
- `src/web/tool-policy.ts` — `makeReadFileTool`: тот же листинг через общий `formatDirListing`, `allowRoot: true`, описание обновлено; read без approval сохранён (`isWriteOperation('read_file') === false`).
- `src/agent/tools.test.mjs` — новый `describe('VL-233 — листинг каталога')`: 9 тестов (сортировка с `/`, `path: '.'`, пустой каталог, усечение 205→200 + маркер, служебные каталоги и вложенные пути, `../`, симлинк наружу, регрессия файла/offset-limit/«не найден», пустой путь). Файл: 61 тест.
- `src/web/tool-policy.test.mjs` — +1 тест: `chatToolDefs(cwd)` read_file на каталоге отдаёт листинг (10 тестов).
- `README.md` — блок «`read_file`»: поведение каталога.
- `templates/prompts/chat-system.md` — описание `read_file`: каталог → листинг, ориентируйся вместо угадывания путей.
**Проверки:** `pnpm build` OK; `env -u VIBELOG_CWD pnpm test` — **85 файлов / 1591 тест зелёные, 4 skipped, 0 failed** (полный прогон, без исключений). Ручной smoke на реальном проекте: `read_file('src/agent')` → 22 записи с `/`, `read_file('node_modules')` → отказ «не разворачивается», `read_file('package.json', limit: 3)` → прежний JSON-фрагмент.
**Важно про прогон:** первые прогоны `pnpm test` в этой сессии падали (config-cli/create-flags/search-cli/batch-checklist — «Backlog-директория не найдена»/«задача не найдена», затем плавающие таймауты mcp-client/cli/v11). Причина не в коде: в окружении агентской сессии выставлен `VIBELOG_CWD` на главный репозиторий, его наследуют spawn-CLI тесты — часть файлов гоняется за чужой backlog. Повтор с `env -u VIBELOG_CWD` — полностью зелёный; те же файлы по отдельности проходят. Зафиксировано уроком `lesson-88` (связан с задачей).
**Что осталось (Close):** AC7/DoD2 — обновить `backlog/docs/doc-10` (раздел 5, таблица «Локальные»: `read_file` = «файл → строки, каталог → листинг, лимит 200, служебные не разворачиваются») и запись CHANGELOG. AC6 закрыт по факту: MCP-сервер Vibelog файловых read-инструментов не экспонирует (`src/mcp/tools.ts` — только `backlog_*`/`milestone_*`/`document_*`/`reference_*`/`lesson_*`), схему MCP править не требовалось; doc-8 (MCP-справочник) не затронут по этой же причине.
---
author: @agent
created: 2026-10-30 03:04
---
Фаза Close прервана: конфликт слияния vb/vl-233 → master (файлы: UU src/agent/tools.test.mjs; прочие файлы задачи слиты без конфликтов — M src/agent/tools.ts, M src/web/tool-policy.ts, M src/web/tool-policy.test.mjs, M README.md, M templates/prompts/chat-system.md). Конфликт в src/agent/tools.test.mjs возник из-за параллельной правки master в том же файле; конфликтные маркеры оставлены как есть, git merge --abort не выполнялся. Разреши конфликт вручную (сохранив оба набора тестов — существующие и новый describe «VL-233 — листинг каталога»), заверши merge-коммит и повтори Фазу Close. Статус и DoD не менялись.
---
author: @agent
created: 2026-10-30 03:10
---
Фаза Close выполнена. Ветка vb/vl-233 слита в master (1 коммит `a30a325` + merge-коммит `1fdd94d`), worktree `.vibelog/worktrees/vl-233` удалена (force — внутри были только untracked-симлинки `node_modules`/`backlog/references/data`), ветка `vb/vl-233` удалена.
**Конфликт слияния разрешён вручную:** `src/agent/tools.test.mjs` — обе стороны правили блок импортов (master — `mkdtempSync`/`tmpdir` для VL-241, ветка — `symlinkSync` для AC3). Объединённый импорт: `{ mkdirSync, rmSync, symlinkSync, writeFileSync, mkdtempSync }` + `tmpdir`. Заодно убран фиксированный путь `/tmp/vibelog-agent-tools-outside` в тесте симлинка — заменён на `mkdtempSync(join(tmpdir(), 'vibelog-agent-tools-outside-'))` по правилу AGENTS.md (VL-241, lesson-89: фиксированные пути в тестах запрещены).
**Проверки после merge (главный репо):** `pnpm build` OK; `env -u VIBELOG_CWD pnpm test` — **87 файлов / 1631 тест зелёные, 4 skipped, 0 failed** (полный прогон, без исключений).
**Документация (DoD2/AC7):** CHANGELOG.md — запись VL-233 в Unreleased/Добавлено; `backlog/docs/doc-10` §5 (таблица «Локальные») — строка `read_file` дополнена поведением каталога (правка через core `updateDocument`, не через worktree-копию; CLI `doc update` поддерживает только title/type/tags, тела — нет). README.md и `templates/prompts/chat-system.md` пришли в merge из ветки уже обновлёнными.
**DoD итог:** 1 «Тесты проходят» — ✓, 2 «Документация обновлена» — ✓ (CHANGELOG + doc-10 §5; README и prompt пришли в merge), 3 «Нет регрессий» — ✓.
**AC:** AC7 отмечен в этом вызове. AC6 закрыт по факту: MCP-сервер Vibelog файловых read-инструментов не экспонирует (`src/mcp/tools.ts` — только `backlog_*`/`milestone_*`/`document_*`/`reference_*`/`lesson_*`), схему MCP править не требовалось.
**Lessons:** профильный урок по задаче — `lesson-88` (прогон `pnpm test` в агентской сессии через `env -u VIBELOG_CWD`), уже связан с задачей в фазе Code. Новый урок не заводил: конфликт слияния — следствие параллельной работы, отдельного воспроизводимого правила сверх AGENTS.md (mkdtemp-изоляция) не выявил.
---
<!-- COMMENTS:END -->