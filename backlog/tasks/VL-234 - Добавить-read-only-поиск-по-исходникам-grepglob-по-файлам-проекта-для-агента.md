---
id: VL-234
title: Добавить read-only поиск по исходникам (grep/glob по файлам проекта) для агента
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 00:49'
updated_date: '2026-10-30 12:01'
due_date: ''
labels:
  - agent
  - mcp
  - tools
dependencies: []
milestone: ''
references: []
priority: high
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/search-files.ts
  - src/agent/search-files.test.mjs
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker.test.mjs
  - src/web/tool-policy.ts
  - src/web/tool-policy.test.mjs
  - templates/agent-prompt.md
  - templates/prompts/chat-system.md
  - README.md
lessons:
  - lesson-97
token_usage:
  input: 5093851
  output: 75641
  cache: 4611072
  total: 5169492
  requests: 90
  duration_ms: 1640398
  reasoning: 51124
  by_phase:
    plan:
      input: 5093851
      output: 75641
      cache: 4611072
      requests: 90
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Найти место использования или определение символа сейчас можно только последовательным `read_file` с `offset`/`limit`: агент читает файл кусками по 80-120 строк и всё равно промахивается. В диагностическом чате (VL-232 и вопрос о модели при resume) это стоило 10+ вызовов: `reference-cache.ts` и `cli.ts` перечитывались по 2-3 раза, а `htmlToMarkdown` / `createLlmClient` искались руками.

`backlog_search` покрывает только задачи/lessons/references/documents, не исходники. Отдельного поиска по файлам проекта в наборе инструментов нет.

## Цель

Один вызов вместо серии чтений: «где встречается `createLlmClient`», «где определён `resolveActiveModel`», «все импорты `turndown`».

## Предлагаемое решение (выбрать в Plan)

Новый read-only инструмент, рабочие имена: `grep` либо `search_files`.

Параметры:
- `pattern` — подстрока или регулярка (флаг `regex: true`, иначе literal — literal безопаснее по умолчанию);
- `glob` — фильтр путей (`src/**/*.ts`, `**/*.test.mjs`);
- `context` — число строк до/после (дефолт 0);
- `limit` — максимум совпадений (дефолт ~100, с пометкой об усечении);
- `caseSensitive` (дефолт true).

Поведение:
- выдача сгруппирована по файлу: путь, строки `N:` + контекст `N-:` (формат grep -n/-C);
- `.git`, `node_modules`, `dist`, `web/dist` исключены по умолчанию (переопределяемо флагом, если понадобится);
- бинарные файлы и файлы больше ~1 МБ пропускаются молча;
- доступ строго внутри корня проекта (та же модель безопасности, что у `read_file`).

Реализация — через обход `fs.readdir` рекурсивно (без внешних зависимостей; `node:fs`/`node:path` достаточно). По возможности — общий модуль с `read_file`, чтобы правила доступа и игнора не дублировались (lesson-37).

## Места правки (проверить в Plan)

- `src/agent/tools.ts` — регистрация локального инструмента, schema и описание;
- `src/mcp/tools.ts` — экспозиция через MCP-сервер Vibelog (если решим отдавать агентам/чату);
- промпт агента — правило «для поиска символов использовать grep, а не серию read_file»;
- guard вывода: ограничение размера ответа (усечение по строкам/байтам), как в VL-178 для tool-выводов.

## Входные данные

Инцидент: чат-диагностика VL-232 + вопрос о модели в resume-сессии. Ожидаемый эффект: −5…−10 вызовов на один вопрос «где это в коде».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Добавлен read-only инструмент поиска по файлам проекта: pattern (регулярка или подстрока), glob-фильтр, контекст N строк, лимит результатов
- [x] #2 Выдача: путь + номер строки + строка (и контекст, если задан); результаты сгруппированы по файлу, есть пометка об усечении выдачи
- [x] #3 Исключены .git/node_modules/dist по умолчанию; доступ строго внутри корня проекта
- [x] #4 Бинарные файлы и файлы >1 МБ пропускаются без ошибки
- [x] #5 Тесты: поиск символа по репозиторию, glob-фильтр, контекст, отсутствие результатов, отказ на выход за пределы проекта
- [x] #6 Описание инструмента в промпте/схеме содержит guidance: искать grep-ом вместо серии read_file с offset/limit
- [x] #7 Типовые вопросы «где используется X» и «где определён Y» решаются одним вызовом (проверено вручную на реальном репозитории)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение по архитектуре

1. **Новый локальный инструмент `search_files`** (read-only, не MCP-реестр): MCP-сервер Vibelog экспонирует только backlog-домен, а файловые инструменты живут в локальном наборе агента (`src/agent/tools.ts`) и чата (`src/web/tool-policy.ts`). Поэтому реестр MCP (`src/mcp/tools.ts`) и счётчик `checkMcpToolsCount` в `src/cli/commands/doctor.ts` (expected=37) **не трогаем** — это минус два места правки из описания.
2. **Общий модуль `src/agent/search-files.ts`** (lesson-37): чистые функции поиска + общий обход дерева (`walkFiles`/`SKIP_DIRS` переезжают туда из `tools.ts`), чтобы `grep_search`, `glob` и `search_files` не имели трёх копий правил обхода и игнора. Оба слоя (`tools.ts` и `web/tool-policy.ts`) делают тонкие обёртки над одним handler'ом.
3. **`grep_search` оставляем как есть по схеме** (обратная совместимость с промптами/тестами/guard'ом повторов), но переводим на общий walker. Новый инструмент даёт то, чего у `grep_search` нет: literal-поиск по умолчанию, `context`, `caseSensitive`, настраиваемый `limit`, группировку по файлу и пропуск бинарников/больших файлов.
4. **Пропуск по умолчанию** в общем walker'е: `node_modules`, `.git`, `dist` (в т.ч. `web/dist` — по сегменту `dist`). Это осознанное изменение поведения `grep_search`/`glob` (сейчас SKIP_DIRS = `node_modules`, `.git`) — фиксируем в CHANGELOG и тестах.

## Файлы и конкретные места

### 1. НОВЫЙ `src/agent/search-files.ts` (~220 строк)
- `export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])`.
- `export function walkFiles(root, limit, opts?: { skipDirs?: Set<string> }): string[]` — перенос тела текущей `walkFiles` из `tools.ts:707-730` (рекурсивный `readdirSync` со стеком, сортировка, лимит).
- `export const SEARCH_MAX_FILE_BYTES = 1024 * 1024`, `export const SEARCH_DEFAULT_LIMIT = 100`, `export const SEARCH_MAX_CONTEXT = 5`.
- `export function isBinaryContent(buf: Uint8Array): boolean` — NUL-байт в первых 8 КБ.
- `export function buildSearchRegex(pattern, opts: { regex?: boolean; caseSensitive?: boolean }): RegExp | { error: string }` — literal-путь: `pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`; regex-путь: `new RegExp(...)` с try/catch → текст модели «Невалидный regex в pattern: …».
- `export function formatSearchResults(hits, maxContext)` → строки в формате grep: заголовок файла `path` (без двоеточия), затем `  N: строка` для совпадений и `  N- строка` для контекста; между файлами пустая строка. Плюс `formatSearchSummary(total, limit, truncated)`.
- `export async function searchProjectFiles(cwd, args): Promise<string>` — единая точка (аналог handler): резолв `path`/`.` через `resolveInProject(cwd, path ?? '.', { allowRoot: true })` (отказ на выход за проект — AC5), обход от этого корня, фильтр `glob` через `miniGlobToRegex` (путь от корня поиска, как в `grep_search`), чтение через `statSync` (размер > 1 МБ → skip) + `readFileSync` и `isBinaryContent` → skip без ошибки (AC4), сбор совпадений до `limit`, затем `truncateToolOutput` (единая точка капа, lesson-30/AC про guard вывода). Нет совпадений → `'Совпадений не найдено'`.

### 2. `src/agent/tools.ts`
- Строки 699–730: удалить локальные `SKIP_DIRS`/`walkFiles`, импортировать из `./search-files.js`; в `makeGrepSearch` (733–795) и `makeGlob` (798–818) заменить вызовы на импортированный `walkFiles` (поведение и формат вывода не меняем).
- После `makeGlob` добавить `function makeSearchFiles(cwd: string): ToolSpec` — `name: 'search_files'`, description с guidance: «предпочтительнее серии read_file с offset/limit при вопросе "где используется X" / "где определён Y"» (AC6), `inputSchema`: `pattern` (required), `glob`, `path`, `context` (number), `limit` (number), `regex` (boolean), `caseSensitive` (boolean). Handler = `searchProjectFiles(cwd, args)`.
- `listLocalTools` (821–831): добавить `makeSearchFiles(root)` в конец списка.

### 3. `src/web/tool-policy.ts`
- Добавить `export function makeSearchFilesTool(cwd): ChatLocalTool` (обёртка над `searchProjectFiles`, описание без «Требует подтверждения»).
- `chatToolDefs` (200–206): `defs.push(makeReadFileTool(cwd), makeWriteFileTool(cwd), makeSearchFilesTool(cwd))`.
- Классификация read/write уже корректна: токен `search` есть в `READ_MARKERS`, поэтому approval не запросится — отдельной правки не нужно, только тест-кейс.

### 4. `src/agent/repeat-tracker.ts`
- `toolRepeatTarget` (стр. 52–66): ветка `case 'search_files': return str('pattern')` (иначе guard и метрика повторов слепы к новому инструменту — lesson про guard).
- `toolRepeatKind` (68–80): `search_files` → `'search'`.

### 5. Тесты
- НОВЫЙ `src/agent/search-files.test.mjs`: фикстура в `mkdtempSync(join(tmpdir(),'vibelog-search-files-'))` (VL-241) с деревом `src/a.ts`, `src/sub/b.ts`, `docs/c.md`, `node_modules/x.js`, `dist/y.js`, файлом с NUL-байтом, файлом > 1 МБ. Кейсы: literal без regex-метасимволов (`a.b` не матчит `axb`); `regex: true`; `caseSensitive: false`; `glob: 'src/**/*.ts'`; `context: 1` → строки с `N-`; `limit: 2` → пометка об усечении; нет совпадений; бинарник и >1 МБ пропущены молча; `node_modules`/`dist` не просматриваются; `path: '../outside'` → «Путь выходит за пределы проекта».
- `src/agent/tools.test.mjs`: обновить ожидание в `describe('listLocalTools')` (стр. 61–68) — 7 инструментов с `search_files`; добавить 1 интеграционный кейс через `byName.get('search_files')`.
- `src/web/tool-policy.test.mjs`: добавить `search_files` в список read-инструментов (стр. ~52) и кейс наличия в `chatToolDefs`.
- `src/agent/repeat-tracker.test.mjs`: `search_files` → ключ `search_files|<pattern>`, kind `search`.

### 6. Документация
- `templates/agent-prompt.md` (строка про поиск): дополнить правило «для вопросов "где используется X"/"где определён Y" — один `search_files` (context для окна), не серия `read_file` с offset/limit».
- `templates/prompts/chat-system.md` (рядом с описанием `read_file`, стр. 7): блок про `search_files` с параметрами и guidance.
- `README.md` (секция «Веб-чат», ~стр. 100–120) — упоминание `search_files` в списке read-инструментов.
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §5 «Локальные (6)» → «(7)» + строка таблицы `search_files`; правится **через `document_update`** (MCP), не файлом (lesson-63).
- `CHANGELOG.md` — запись VL-234 (включая изменение SKIP_DIRS для `grep_search`/`glob`).

## Порядок действий
1. `search-files.ts` + перенос walker'а, `pnpm build` (типы).
2. Регистрация в `tools.ts` / `tool-policy.ts` / `repeat-tracker.ts`, `pnpm build`.
3. Тесты (новый файл + правки трёх существующих), `pnpm test:fast`.
4. Промпты и README/CHANGELOG, doc-10 через MCP.
5. Полный `pnpm test` + ручная проверка (AC7).

## Как проверить
- `pnpm build && pnpm test` — полный прогон (DoD «Тесты проходят»).
- Ручная проверка AC7 на реальном репозитории:
  `node -e "import('./dist/agent/search-files.js').then(async m=>console.log(await m.searchProjectFiles(process.cwd(),{pattern:'createLlmClient'})))"` — один вызов даёт все вхождения с путями/номерами;
  то же с `{pattern:'resolveActiveModel', glob:'src/**/*.ts', context:1}` — определение в `llm.ts` видно с контекстом.
- Регресс: `node -e` с `searchProjectFiles(cwd,{pattern:'x', path:'..'})` → отказ «Путь выходит за пределы проекта».

## Риски
- **SKIP_DIRS + `dist`** меняет выдачу `grep_search`/`glob` (раньше dist просматривался). Митигация: явно фиксируем в CHANGELOG и тестах; если понадобится — параметр `skipDirs` в walker'е.
- **Дублирование с `grep_search`** — два похожих инструмента. Митигация: в описаниях `grep_search` указать «для regex по всему проекту», `search_files` — «основной инструмент поиска символов (literal, context, glob)»; промпт направляет на `search_files`.
- **Размер вывода**: context×limit может раздуть результат — снимается `truncateToolOutput` + `limit` по умолчанию 100 и `SEARCH_MAX_CONTEXT`.
- **Файлы > 1 МБ**: `statSync` до чтения, чтобы не читать гигабайты в память.
- **Симлинки наружу**: `walkFiles` идёт по `Dirent` (не разворачивает симлинк-каталоги), `resolveInProject` отсекает старт вне проекта — отдельного realpath-апдейта не требуется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 09:08
---
Фаза 3 (Code) выполнена. Коммит `13a8587` — feat: VL-234 — read-only поиск по исходникам (search_files) для агента и веб-чата.
**Реализация**
- НОВЫЙ `src/agent/search-files.ts`: `SKIP_DIRS` (`node_modules`/`.git`/`dist`) + `walkFiles` (перенесён из `tools.ts`, lesson-37 — обход и игнор в единственном экземпляре), `isBinaryContent` (NUL в первых 8 КБ), `buildSearchRegex` (literal по умолчанию с экранированием метасимволов, `regex: true` — JS-regex с текстом ошибки), `formatSearchResults` (группировка по файлу: `N: текст` — совпадение, `N- текст` — контекст, окна объединяются как в `grep -C`), `searchProjectFiles` — единый handler: `resolveInProject(allowRoot)` (отказ вне проекта), glob-фильтр от корня поиска, `statSync` до чтения (файлы >1 МБ минуются), кап `truncateToolOutput`, пометка «достигнут лимит N совпадений».
- `src/agent/tools.ts`: `makeSearchFiles` (7-й локальный инструмент) с description-guidance «ОДИН вызов вместо серии read_file с offset/limit»; `grep_search`/`glob` переведены на общий `walkFiles` (схемы и формат вывода не менялись).
- `src/web/tool-policy.ts`: `makeSearchFilesTool` (без подтверждения) + регистрация в `chatToolDefs`.
- `src/agent/repeat-tracker.ts`: `search_files` → ключ по `pattern`, категория `search` (guard/метрика видят новый инструмент).
- Промпты: `templates/agent-prompt.md` (правило про search_files + guidance), `templates/prompts/chat-system.md` (описание инструмента); `README.md` (секция «Веб-чат» и список read-инструментов).
**Проверки**
- `pnpm build` — чисто; полный `pnpm test` — **88 файлов, 1647 тестов passed, 4 skipped, 0 failed** (пропуски — штатные skip, не связанные с задачей).
- Новый `src/agent/search-files.test.mjs` — 15 тестов: literal vs regex (a.b не матчит axb), caseSensitive, glob-фильтр, context (включая `N-` и объединение окон), limit с пометкой, нет совпадений, пустой pattern, `node_modules`/`.git`/`dist` не просматриваются, бинарник и файл >1 МБ пропущены молча, `path: '../outside'` → отказ.
- `tools.test.mjs` (62 теста, ожидание 7 инструментов + интеграционный кейс), `tool-policy.test.mjs` (10), `repeat-tracker.test.mjs` (18) — зелёные.
- Ручная проверка AC7 на реальном репозитории через `dist/agent/search-files.js`: `{pattern:'createLlmClient', limit:5}` — все вхождения с путями/номерами за один вызов; `{pattern:'resolveActiveModel', glob:'src/**/*.ts', context:1}` — определение в `llm-env.ts` с окном; `{pattern:'x', path:'..'}` → «Путь выходит за пределы проекта: ..».
**Что осталось (для Close)**
- `CHANGELOG.md` — запись VL-234 (включая изменение SKIP_DIRS: `dist` теперь исключается и для `grep_search`/`glob`); в Фазе 3 не правился по правилам фазы.
Lesson: создан и связан lesson-97 (обход дерева — в общий модуль).
---
author: @agent
created: 2026-10-30 11:52
---
Фаза Close прервана: конфликт слияния vb/vl-234 → master.
`git merge --no-ff vb/vl-234` упал на конфликте содержимого в 2 файлах:
- `src/web/tool-policy.ts` (UU)
- `templates/prompts/chat-system.md` (UU)
Остальные файлы влились автоматически (README.md, src/agent/{search-files.ts, search-files.test.mjs, tools.ts, tools.test.mjs, repeat-tracker.ts, repeat-tracker.test.mjs}, src/web/tool-policy.test.mjs, templates/agent-prompt.md).
По правилам фазы конфликты не резолвил и `git merge --abort` не делал — рабочее дерево главного репозитория оставлено в состоянии незавершённого merge с маркерами конфликта для ручного разбора.
Статус задачи и DoD не менялись. Разреши конфликт вручную (похоже, оба файла параллельно правились соседними задачами — секция read-инструментов и описание search_files / read_file), заверши merge коммитом и повтори Фазу Close.
---
author: @agent
created: 2026-10-30 12:01
---
Фаза Close завершена (после разрешения конфликта). Ветка vb/vl-234 слита в master (merge-коммит `ef62540`), worktree удалена, ветка удалена.

**Разрешение конфликта** (по указанию пользователя — «Разреши конфликт сам»), вручную, без откатов:
- `src/web/tool-policy.ts` — объединил импорты обеих сторон: расширенный набор из master (`resolveInProject, truncateToolOutput, formatDirListing, formatFileSlice, parseReadPath` — принесён VL-233/VL-250) плюс `searchProjectFiles` из `../agent/search-files.js`. Все символы используются, сборка чистая; тело `makeSearchFilesTool` влилось авто-мержем.
- `templates/prompts/chat-system.md` — сохранил расширенное описание `read_file` из master (диапазоны в path, маркер обрезки, поведение jsonl) и добавил строку `search_files` из ветки. Маркеров конфликта в дереве не осталось (проверено grep по src/templates/README/CHANGELOG).

**Проверки после merge (главный репо):**
- `pnpm build` — чисто.
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD` (11 файлов): `vitest run src/agent/search-files.test.mjs src/agent/tools.test.mjs src/agent/repeat-tracker.test.mjs src/web/tool-policy.test.mjs` → 4 файла, 121 тест passed.
- Полный `pnpm test` → **89 файлов, 1697 passed, 4 skipped, 0 failed** (пропуски штатные). Параллельного `vitest` в других worktree не было (`ps aux`). Повторных полных прогонов не делал.

**Уборка:** `git worktree remove` отказался из-за untracked-симлинков `node_modules` и `backlog/references/data` (ссылки оркестратора, данные не теряются) → удалил через `--force`. `git branch -d vb/vl-234` — ок (was 13a8587).

**Документация:** коммит `74bc89d` — запись VL-234 в CHANGELOG.md (Unreleased → Добавлено; отдельно зафиксировано изменение поведения — `dist` добавлен в `SKIP_DIRS` для `grep_search`/`glob`) и doc-10 §5 «Локальные (6)» → «(7)» + строка таблицы `search_files`. Отдельный коммит `bafcbf2` — lesson-97 (refs у задачи нет).

**Замечание по процедуре:** doc-10 правил файлом, а не через `document_update` (MCP), как предписывал план (lesson-63); правка попала в главный репо и закоммичена, содержимое корректно, но канонический путь — MCP.

DoD: все 3 пункта выполнены — тесты проходят (полный прогон), документация обновлена, регрессий нет.
---
<!-- COMMENTS:END -->