---
id: VL-257
title: 'read_file при ENOENT: возвращать листинг ближайшего существующего каталога и fuzzy-подсказки похожих путей'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:11'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - tools
  - agent
  - bug
dependencies: []
milestone: v1.11
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/agent/search-files.ts
  - src/web/tool-policy.ts
  - src/agent/tools.test.mjs
  - src/agent/search-files.test.mjs
  - src/web/tool-policy.test.mjs
  - README.md
  - templates/agent-prompt.md
  - templates/prompts/chat-system.md
lessons:
  - lesson-103
token_usage:
  input: 8728315
  output: 58034
  cache: 8448000
  total: 8786349
  requests: 139
  duration_ms: 2038414
  reasoning: 34790
  by_phase:
    plan:
      input: 1456623
      output: 14134
      cache: 1373184
      requests: 27
    code:
      input: 5247855
      output: 33602
      cache: 5120512
      requests: 66
    close:
      input: 2023837
      output: 10298
      cache: 1954304
      requests: 46
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В разобранной сессии веб-чата агент трижды подряд угадывал путь к задаче: `backlog/tasks/VL-254.md`, `backlog/active/VL-254.md`, `backlog/VL-254.md`. Все три вызова вернули только текст:

```
Не удалось прочитать файл: ENOENT: no such file or directory, stat '.../backlog/tasks/VL-254.md'
```

Ответ не содержит ни листинга ближайшего существующего каталога, ни подсказки, где реально лежит задача, — поэтому агент пробует следующий вариант вслепую (и в паре с отсутствием дедупа/лимита вызовов это дало десятки холостых вызовов). Задачи в проекте хранятся не по предсказуемому пути (`backlog/tasks/<id>.md` не существует), и агент об этом из вывода не узнаёт.

## Цель

Один неудачный `read_file` должен быть самодостаточным: вернуть структуру ближайшего существующего каталога и кандидатов с похожими именами, чтобы второго-третьего угадывания не требовалось.

## Предлагаемое решение (уточнить в Plan)

1. При ENOENT в `read_file`: подняться до ближайшего существующего родительского каталога, вернуть его отсортированный листинг (переиспользовать существующий код листинга каталога, VL-233 — там уже есть лимит 200 записей и фильтры).
2. Добавить fuzzy-подсказки: если в листинге есть имена, близкие к запрошенному (по basename, без учёта регистра/расширения — например для `VL-254.md` найти `vl-254*.md` в поддереве или по индексу задач), вывести их отдельной строкой «Возможно, вы имели в виду: ...». Для путей, похожих на ID задачи (`VL-\d+`), подсказывать `backlog_view_task <id>` вместо чтения файла.
3. То же для `search_files`/read-операций с несуществующим `path`-аргументом — единая функция «подсказка при отсутствии пути».
4. Ограничить объём подсказки (лимит строк/байт), чтобы не раздувать tool-ответ.
5. Тест: несуществующий путь в существующем каталоге → листинг + подсказки; несуществующий каталог → листинг ближайшего существующего предка; путь вне проекта → прежняя ошибка без листинга.

## Связанное

VL-233 (листинг каталога в read_file), VL-252 и VL-250 (диапазоны и лимиты чтения), VL-255 (дедуп/лимит вызовов — снижает ущерб от угадывания, но не устраняет причину).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 read_file с несуществующим путём возвращает листинг ближайшего существующего каталога (переиспользуя formatDirListing, лимит 200) — первая строка ошибки «Файл не найден» сохраняется
- [x] #2 Для путей, похожих на ID задачи (VL-\d+), вывод содержит подсказку backlog_view_task <id> и относительный путь найденного файла задачи в backlog/tasks|completed|drafts
- [x] #3 Для прочих опечаток выводится секция «Возможно, вы имели в виду:» с похожими путями (без учёта регистра/расширения, не более 5 кандидатов)
- [x] #4 Объём подсказки ограничен (PATH_HINT_MAX_LINES/кандидаты + truncateToolOutput), ответ не превышает 8 КБ
- [x] #5 Путь вне проекта даёт прежнюю ошибку «Путь выходит за пределы проекта» без листинга; существующие тесты на «Файл не найден» проходят без правок
- [x] #6 Подсказка работает и в веб-чате (makeReadFileTool), и в search_files/grep_search при отсутствующем path-аргументе — одна общая функция formatMissingPathHint
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-257: ENOENT в read_file → листинг ближайшего каталога + fuzzy-подсказки

### Диагноз (по коду)

Сейчас при несуществующем пути:
- `src/agent/tools.ts:439` (`readTextFile`) → `Файл не найден: <абс. путь>` — только абсолютный путь, ни структуры, ни кандидатов;
- `src/web/tool-policy.ts:159` — то же для веб-чата;
- `src/agent/search-files.ts:~240` → `Не удалось прочитать путь: ENOENT…`;
- `formatDirListing` (`src/agent/tools.ts:366-448`) уже умеет листинг с лимитом `DIR_LISTING_MAX=200`, но вызывается ТОЛЬКО когда путь существует и является каталогом (`makeReadFile`, `makeReadFileTool`).

Отсюда инцидент: `backlog/tasks/VL-254.md` → `backlog/active/VL-254.md` → `backlog/VL-254.md` — три «слепых» угадывания, потому что вывод не сообщает ни где реально лежат задачи, ни что читать надо через MCP.

### Архитектура решения (lesson-37: одна реализация, две поверхности)

Новый экспорт `formatMissingPathHint` живёт в `src/agent/tools.ts` РЯДОМ с `formatDirListing` (не в новом модуле — иначе цикл `tools ↔ search-files ↔ path-hint`; `search-files.ts` уже импортирует `tools.ts`, обратного импорта нет).

**1. `src/agent/tools.ts` — новые экспорты (после `formatDirListing`, ~строка 449):**

- `export const PATH_HINT_MAX_LINES = 30;` — кап листинга в подсказке (весь блок ≤ ~1.5 КБ до `truncateToolOutput`).
- `export const PATH_HINT_MAX_CANDIDATES = 5;`
- `function nearestExistingDir(cwd: string, absTarget: string): string | null` — поднимаемся от `dirname(absTarget)` вверх, пока `statSync(p).isDirectory()` не true, останавливаемся на `cwd` включительно; ни один не существует → `null` (не должно случаться, cwd существует).
- `function fuzzyCandidates(cwd, nearestDir, rawPath): string[]` — кандидаты, в порядке приоритета, максимум `PATH_HINT_MAX_CANDIDATES`:
  1. **ID-задачи**: если `basename` матчит `/([A-Za-z]+-\d+)/` — ищем в существующих `backlog/tasks`, `backlog/completed`, `backlog/drafts` файлы, чьё имя начинается с `<ID> ` / `<ID>-` (без учёта регистра, `id` нормализуем в upper-case). Пути возвращаем относительные от cwd.
  2. **По имени в дереве ближайшего каталога**: `walkFiles(nearestDir, 5000)` (уже есть, `search-files.ts`), оставляем файлы, у которых `basename.toLowerCase()` (без расширения) равен/содержит stem запрошенного basename (stem = имя без расширения, lower-case) либо stem содержит их basename-без-расширения; сортировка `localeCompare(…,'en')`, дедуп, обрезка по лимиту. При `nearestDir === cwd` обход ограничен 5000 файлов — как в поиске, стоимость одна и та же.
  3. **По записям листинга** ближайшего каталога (case-insensitive включение stem) — быстро, ловит опечатки в одном уровне (`vl-254` vs `VL-254`).
- `export function formatMissingPathHint(cwd: string, rawPath: string): string | null`:
  - `abs = resolve(cwd, rawPath)`; если `relative(cwd, abs)` — `'..'`/начинается с `..<sep>`/абсолютный → **`null`** (вне проекта: прежняя ошибка без листинга, AC5);
  - `nearest = nearestExistingDir(...)`; листинг — `formatDirListing(cwd, nearest)` (переиспользование VL-233, без копии логики); если `!ok` → `null`;
  - берём первые `PATH_HINT_MAX_LINES` строк тела листинга (пропускаем его шапку «Листинг каталога …», свой заголовок формируем сами), хвост — маркер `…[подсказка усечена: показано 30 из N]`;
  - блок:
    ```
    Ближайший существующий каталог: <rel>/
    <до 30 записей, каталоги с "/">
    Возможно, вы имели в виду:
      <кандидат>
    ```
    (секция «Возможно…» — только если кандидаты есть; ID-кандидаты печатаются первыми);
  - если найден ID задачи — отдельная строка-инструкция: `Подсказка: задачи в Vibelog хранятся не по пути <id>.md — используй MCP-инструмент backlog_view_task {"id":"<ID>"}.` (снимает корень проблемы «как читать задачу»);
  - `null`, если ни листинга, ни кандидатов собрать нельзя (тогда поверхность печатает прежнюю ошибку).

**2. `src/agent/tools.ts` — точки вызова:**

- `makeReadFile` handler (~строки 483-500): после `const read = readTextFile(target.path); if (!read.ok)` — при `!existsSync(target.path)` возвращать `read.error + '\n\n' + hint`, иначе прежний текст. Порядок строк важен: `Файл не найден:` остаётся ПЕРВОЙ строкой (lesson-76 — существующие ассерты `tools.test.mjs:89,540,658` матчат `/Файл не найден/`, их не правим).
- Итог проходит через `truncateToolOutput` (единая точка капа, lesson-30): оборачиваем финальный `return` в ветке ошибки.
- `makeGrepSearch` / `makeSearchFiles` — не меняем схемы; их `path` при отсутствии обрабатывается в `search-files.ts` (п.3).
- Описание `read_file` (строки ~475-485): добавить одно предложение «если файл не найден, ответ содержит листинг ближайшего существующего каталога и похожие пути; задачи читаются через `backlog_view_task`».

**3. `src/agent/search-files.ts` — `searchProjectFiles` (~строки 220-242):**

- `if (!start.ok) return start.error;` — **не трогаем** (вне проекта, AC5);
- `try { startIsFile = !statSync(start.path).isDirectory() } catch` → сейчас `Не удалось прочитать путь: <ENOENT…>`; заменить на: `const hint = formatMissingPathHint(cwd, opts.path); return hint ? `Путь не найден: ${opts.path}\n\n${hint}` : <прежний текст>`. Импорт `formatMissingPathHint` из `./tools.js` (там уже импортируются `miniGlobToRegex`, `resolveInProject`, `truncateToolOutput`).
- Так подсказка автоматически работает и для `search_files`, и для `grep_search.path` (он ходит в свой handler — `grep_search` использует свой `statSync` в `src/agent/tools.ts:930`; там аналогичная правка: `try/catch` вокруг `statSync` + hint — иначе останется «Не удалось прочитать»).

**4. `src/web/tool-policy.ts` — `makeReadFileTool` (строки 147-165):**

- та же вставка hint в ветке `!existsSync(target.path)` (импорт `formatMissingPathHint` в строку 31 рядом с `formatDirListing`);
- `makeSearchFilesTool` правок не требует — работает через `searchProjectFiles`.

**5. Тесты:**

- `src/agent/tools.test.mjs` (+6, в `describe('read_file / write_file / edit')`):
  1. несуществующий файл в существующем каталоге (`'sub'` → `'sub/nope.ts'`) → ответ содержит `Файл не найден`, `Ближайший существующий каталог: sub/`, `b.ts`, `c.md`;
  2. несуществующий каталог (`'no-such-dir/inner/f.txt'`) → `Ближайший существующий каталог: ./` (или корень) + записи корня;
  3. fuzzy по регистру: `'sub/B.TS'` → `Возможно, вы имели в виду:` + `sub/b.ts`;
  4. ID задачи: в `TMP` создать `backlog/tasks/VL-254 - Тест.md`, `read_file {path:'backlog/active/VL-254.md'}` → есть `Возможно, вы имели в виду:` с `VL-254 - Тест.md` и строка `backlog_view_task`;
  5. путь вне проекта (`'../outside.txt'`) → `Путь выходит за пределы проекта` и **нет** подстрок `Ближайший существующий каталог` (AC5);
  6. кап: подсказка ≤ ~2×`PATH_HINT_MAX_LINES` строк + `truncateToolOutput` не превышает `TOOL_OUTPUT_MAX_CHARS`.
  Регрессия: существующие тесты 89/540/658 (`/Файл не найден/`) и 660 (`/Файл не найден|Некорректный диапазон/`) проходят без правок.
- `src/agent/search-files.test.mjs` (+2): `path: 'no-such'` → `Путь не найден` + `Ближайший существующий каталог`; `path: '../outside'` → прежний отказ без листинга.
- `src/web/tool-policy.test.mjs` (+1): `makeReadFileTool` на несуществующем пути → листинг + `Возможно, вы имели в виду`.
- Каталоги тестов — только `mkdtempSync` (VL-241), уборка в `afterAll` у уже существующих файлов.

**6. Документация (DoD-2):**

- `README.md` — блок `read_file`: «при отсутствии файла возвращает листинг ближайшего существующего каталога + похожие пути и подсказку про `backlog_view_task`»;
- `templates/prompts/chat-system.md` — 1 строка: не угадывать путь к задаче, читать через MCP;
- `templates/agent-prompt.md` — то же для агента;
- `backlog/docs/doc-10` — раздел про `read_file`/`search_files` (через `document_update` в Code/Close);
- `CHANGELOG.md` — запись VL-257.

### Порядок действий

1. `tools.ts`: `PATH_HINT_MAX_LINES`/`PATH_HINT_MAX_CANDIDATES`, `nearestExistingDir`, `fuzzyCandidates`, `formatMissingPathHint` (после `formatDirListing`); ветка hint в `makeReadFile` + `grep_search`.
2. `search-files.ts`: hint в `statSync`-catch `searchProjectFiles`.
3. `tool-policy.ts`: hint в `makeReadFileTool`.
4. Тесты (+6/+2/+1), затем документация.

### Проверка

```
pnpm build && npx vitest run src/agent/tools.test.mjs src/agent/search-files.test.mjs src/web/tool-policy.test.mjs
node -e "import('./dist/agent/tools.js').then(m=>{const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');})"  # ручной smoke —
```
Ручной smoke (после build):
```
node --input-type=module -e "import('./dist/agent/tools.js').then(async m=>{const t=m.listLocalTools(process.cwd()).find(x=>x.name==='read_file');console.log(await t.handler({path:'backlog/tasks/VL-254.md'}))})"
```
ожидаем: `Файл не найден…` + листинг `backlog/` + кандидаты `VL-254*` в `backlog/tasks/` + строка про `backlog_view_task`.
Полный `pnpm test` перед DoD (обязателен, AGENTS.md).

### Риски

- **Раздувание tool-ответа**: подсказка добавляет до ~1.5 КБ к каждой ошибке; закрыто `PATH_HINT_MAX_LINES=30`, `PATH_HINT_MAX_CANDIDATES=5` и `truncateToolOutput` (lesson-30). Тест на кап обязателен.
- **Стоимость обхода**: `walkFiles(nearestDir, 5000)` при `nearestDir === cwd` — тот же обход, что делает `search_files`; синхронно на проект ~100 файлов — миллисекунды. Обход выполняется только в ветке ошибки, не на успешном чтении.
- **Ломание существующих ассертов**: сохраняем `Файл не найден:` первой строкой и не меняем текст для «вне проекта» (lesson-76). Текст `Не удалось прочитать путь` в `search-files` меняется на `Путь не найден:` — проверить, что на него нет тестов (grep по `Не удалось прочитать путь` — совпадений в тестах нет).
- **Цикл импортов**: `formatMissingPathHint` остаётся в `tools.ts`, куда `search-files.ts` уже импортирует — новых рёбер графа импортов не появляется (кроме существующего `tools → search-files.walkFiles`).
- **Ложные fuzzy-кандидаты**: при общем stem (`f.txt`) кандидатов может быть много — ограничены лимитом 5 и сортировкой; секция печатается только при непустом списке, поведение успешного чтения не меняется.
- **Симлинк наружу / служебные каталоги**: `formatDirListing` уже отклоняет `node_modules/.git/dist` и симлинк за проект — при отказе hint `null`, ошибка прежняя.

Связанные задачи (VL-233 листинг, VL-252 диапазоны, VL-234 поиск, VL-255 дедуп вызовов) — контекст, отдельных подзадач не требуется: объём укладывается в одну задачу (1 новый экспорт + 3 точки вызова + тесты).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 12:36
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic). План записан в VL-257, добавлено 6 AC.
**Корень проблемы (по коду):** при несуществующем пути выводятся только абсолютный путь (`src/agent/tools.ts:439` readTextFile → «Файл не найден: <abs>», `src/web/tool-policy.ts:159`, `src/agent/search-files.ts` → «Не удалось прочитать путь: ENOENT…»). `formatDirListing` (VL-233, tools.ts:366-448, лимит DIR_LISTING_MAX=200) вызывается только когда путь уже существует и является каталогом — в ветке ошибки структура не сообщается, поэтому агент угадывает путь вслепую.
**Решение:** один новый экспорт `formatMissingPathHint(cwd, rawPath)` в `src/agent/tools.ts` рядом с `formatDirListing` (не в отдельном модуле — `search-files.ts` уже импортирует `tools.ts`, обратного ребра не добавляем, lesson-37). Внутри: `nearestExistingDir` (подъём до ближайшего существующего предка), листинг через существующий `formatDirListing`, fuzzy-кандидаты (ID задачи `VL-\d+` → файл в backlog/tasks|completed|drafts + подсказка `backlog_view_task`; иначе поиск по stem без учёта регистра/расширения в листинге и в `walkFiles(nearestDir, 5000)`), кап `PATH_HINT_MAX_LINES=30` + `PATH_HINT_MAX_CANDIDATES=5`. Возврат `null` для путей вне проекта и для служебных каталогов → прежняя ошибка без листинга.
**Точки вызова (3):** `makeReadFile` (tools.ts, ветка `!existsSync`) сохраняя `Файл не найден:` первой строкой (lesson-76 — существующие ассерты tools.test.mjs:89/540/658/660 не правим), `searchProjectFiles` (search-files.ts, catch вокруг `statSync` — покрывает и `search_files`, и `grep_search.path` при аналогичной правке catch в grep_search), `makeReadFileTool` (web/tool-policy.ts:159).
**Файлов к изменению: 9** — `src/agent/tools.ts`, `src/agent/search-files.ts`, `src/web/tool-policy.ts`, `src/agent/tools.test.mjs` (+6), `src/agent/search-files.test.mjs` (+2), `src/web/tool-policy.test.mjs` (+1), `README.md`, `templates/prompts/chat-system.md` + `templates/agent-prompt.md`, `CHANGELOG.md` (+ doc-10 через document_update). Все пути проверены `ls` — существуют.
**Риски:** раздувание tool-ответа (закрыто лимитами + `truncateToolOutput`, lesson-30, тест на кап); стоимость `walkFiles` только в ветке ошибки; смена текста «Не удалось прочитать путь» → «Путь не найден:» (grep по тестам — совпадений нет); ложные fuzzy-кандидаты ограничены лимитом 5. Подзадач/блокеров не требуется — объём укладывается в одну задачу. References: нет. Lessons учтены: 30 (единая точка капа), 37 (одна реализация на обе поверхности), 76 (маркерные подстроки сохраняем), 92 (явная следующая подсказка вместо нейтрального успеха).
---
author: @agent
created: 2026-10-30 12:54
---
Фаза 3 (Code) выполнена по плану. Коммит b7e7910 (ветка vb/vl-257), 9 файлов, +343/−11.
**Что сделано:**
- `src/agent/tools.ts` — новые экспорты `PATH_HINT_MAX_LINES=30`, `PATH_HINT_MAX_CANDIDATES=5`, `formatMissingPathHint(cwd, rawPath)` + приватные `nearestExistingDir` (подъём до ближайшего существующего предка, границы через `isInside`), `stemOf`, `collectTaskCandidates` (backlog/tasks|completed|drafts по ID `<VL-\d+>`, регистронезависимо, префиксы `<ID> `, `<ID>-`, `<ID>.`), `fuzzyCandidates` (сначала файлы задач по ID, затем `walkFiles(nearestDir, 5000)` по stem без регистра/расширения, затем записи самого каталога; дедуп, сортировка `localeCompare(…,'en')`, лимит 5). Листинг переиспользует `formatDirListing` (VL-233, лимит 200), в подсказке — первые 30 записей с маркером `…[подсказка усечена: показано 30 из N]`; для `<ID>.md` — строка «Подсказка: задачи Vibelog хранятся не по пути <ID>.md — используй MCP-инструмент backlog_view_task {"id":"<ID>"}». Путь вне проекта / служебный каталог / нечитаемый листинг → `null` (прежняя ошибка).
- `makeReadFile` (tools.ts) — при `!existsSync` ответ `${read.error}\n\n${hint}` через `truncateToolOutput`, строка «Файл не найден:» остаётся первой (lesson-76); описание инструмента дополнено.
- `makeGrepSearch` (tools.ts) — `statSync` обёрнут в try/catch: отсутствующий `path` → `Путь не найден: <path>` + hint (раньше исключение роняло handler).
- `src/agent/search-files.ts` — `searchProjectFiles`: catch вокруг `statSync` отдаёт тот же hint (покрывает `search_files`); импорт `formatMissingPathHint` из `./tools.js` (новых рёбер графа импортов нет).
- `src/web/tool-policy.ts` — `makeReadFileTool`: ветка `statSync`-catch (именно туда попадает ENOENT на macOS) отдаёт `Файл не найден: <abs>` + hint; путь вне проекта по-прежнему без листинга.
- Тесты: `src/agent/tools.test.mjs` +6 (новый describe VL-257: существующий каталог, отсутствующий каталог → предок, fuzzy по другом расширении — регистровый вариант на macOS-ФС недостижим, AC2 ID задачи + `backlog_view_task`, путь вне проекта без листинга, кап 30 строк + ≤8 КБ), `src/agent/search-files.test.mjs` +1 (отсутствующий path → листинг; вне проекта — без листинга), `src/web/tool-policy.test.mjs` +1 (веб-поверхность).
- Документация: README (блок `read_file`), `templates/prompts/chat-system.md`, `templates/agent-prompt.md` (правило «не угадывать путь после «Файл не найден»»).
**Проверки:** `pnpm build` — OK; точечно `npx vitest run src/agent/tools.test.mjs src/agent/search-files.test.mjs src/web/tool-policy.test.mjs` — 112/112; полный `pnpm test` — 92 файла / 1727 тестов зелёные (4 skipped — pre-existing в frontmatter), без исключений и --skip. Ручной smoke на реальном проекте: `read_file backlog/tasks/VL-254.md` → «Файл не найден» + листинг `backlog/tasks/` (30 из 200) + строка `backlog_view_task {"id":"VL-254"}`; `read_file backlog/active/VL-253.md` → листинг `backlog/` + кандидат `backlog/tasks/VL-253 - …md`.
**Что осталось (Фаза Close):** CHANGELOG.md и backlog/docs/doc-10 (раздел `read_file`/`search_files` про подсказку) — по правилам фазы Code не правятся; DoD-2 отмечен по README+шаблонам, doc-10 дополнить при Close. AC: 1–6 отмечены. DoD: 1 (полный прогон), 2, 3. References не использовались; lessons не создавались (применены существующие 30/37/76/92).
---
author: @agent
created: 2026-10-30 13:10
---
Фаза Close выполнена. Ветка vb/vl-257 слита в master (1 коммит b7e7910, merge --no-ff), worktree удалена с --force (в ней были только untracked node_modules-симлинк, backlog/references/data и dist — артефакты оркестратора/сборки, данные не потеряны), ветка vb/vl-257 удалена.
**Merge:** 9 файлов, +343/−11, конфликтов нет.
**Проверки после merge (в главном репо):** `pnpm build` — OK; ранний точечный фильтр по diff (src/agent/tools.test.mjs, src/agent/search-files.test.mjs, src/web/tool-policy.test.mjs) — 112/112 зелёные; полный `pnpm test` — 1735 passed, 4 skipped (pre-existing в frontmatter), без исключений и --skip. Повторных полных прогонов не было.
**DoD:** 1 (Тесты проходят) — полный прогон зелёный; 2 (Документация обновлена) — README + templates/agent-prompt.md + templates/prompts/chat-system.md в ветке, в Close дописаны CHANGELOG.md (запись VL-257 в «Исправлено») и backlog/docs/doc-10 (строки `read_file` и `search_files` про formatMissingPathHint); 3 (Нет регрессий) — полный прогон без падений, существующие ассерты «Файл не найден» не правились. Все три пункта отмечены.
**Lessons:** создан lesson-103 («В ошибке „файл не найден“ возвращай листинг ближайшего существующего каталога и подсказку MCP-инструмента») + двусторонняя связь с VL-257; закоммичен в 31bccaa вместе с файлом задачи. Похожих активных lessons по теме не нашлось (проверены поиски по «подсказка/листинг/read_file/каталог»), поэтому создан новый, а не обновление.
**Коммиты Close в главном репо:** 31bccaa `docs(task): VL-257 — refs и lessons`, 85f642b `docs: VL-257 — документация и CHANGELOG`.
References не использовались.
---
<!-- COMMENTS:END -->