---
id: VL-237
title: 'backlog_search: ранжирование по релевантности и токенизация вместо одного substring'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 00:49'
updated_date: '2026-10-30 08:52'
due_date: ''
labels:
  - mcp
  - search
  - ergonomics
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/search.ts
  - src/core/search-rank.test.mjs
  - src/mcp/tools.ts
  - src/mcp/search-filters.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/lesson-tools.test.mjs
  - MCP-SETUP.md
  - CHANGELOG.md
  - backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md
  - backlog/docs/doc-7-CLI-справочник-Vibelogmd.md
  - backlog/docs/doc-8-MCP-справочник-Vibelogmd.md
lessons:
  - lesson-96
token_usage:
  input: 3811231
  output: 52972
  cache: 3710464
  total: 3864203
  requests: 81
  duration_ms: 1799412
  reasoning: 35027
  by_phase:
    plan:
      input: 802228
      output: 16955
      cache: 769536
      requests: 23
    code:
      input: 3009003
      output: 36017
      cache: 2940928
      requests: 58
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В чате поиск задачи про зависимости/модели по кириллице дал нерелевантную выдачу: запрос `«модель»` вернул VL-11, VL-13, VL-14, VL-26, VL-75 — совпадения по случайным подстрокам, а нужная задача VL-209 («core: управление LLM-моделями и провайдерами») в выдачу не попала. Аналогично `«зависимости»` вернуло VL-133 (vitest), VL-191 (auto-runner), VL-20 (best-practices) — при релевантном VL-232/package.json.

Причина: сейчас поиск — substring по `id/title/description/labels` без ранжирования, результат в порядке чтения каталога. Одно попадание в 8-тысячный description весит столько же, сколько точное совпадение в title.

## Цель

Сделать первичную выдачу пригодной для агента: первая страница должна содержать то, за чем пришли, чтобы не приходилось переформулировать запрос и искать обходными путями (в инциденте — через фильтр `modified_files`).

## Предлагаемое решение

1. **Ранжирование с весами**: id (точное совпадение) » title » labels » description. Порядок при равных весах — стабильный детерминированный (по id/created_date), не порядок файлов.
2. **Токенизация**: разбить запрос по пробелам/пунктуации, привести к нижнему регистру, требовать вхождения **всех** токенов (И-логика) где-либо в полях. Для однословного запроса поведение ≈ текущему (substring).
3. **Морфология минимальная** (опционально, обсудить в Plan): отсечение типовых русских окончаний (‑и, ‑ями, ‑ов) — иначе «модель» не найдёт «моделями». Достаточно усечения до первых N символов основы; полноценный стеммер не нужен.
4. **Сообщать о полноте**: при `limit`-усечении отдавать `found: N` в ответе.

## Места правки (проверить в Plan)

- `src/mcp/tools.ts` — `toolSearch` (вызов `searchTasks`), добавление `found`;
- `src/core/search.ts` — если поиск живёт там: веса, токенизация, стабильная сортировка;
- CLI `vibelog search` — использует тот же core-поиск, получит улучшение бесплатно (проверить, что порядок не сломал документацию/тесты).

## Риски

- Изменение порядка выдачи может сломать тесты, ожидающие конкретный порядок, — прогнать `pnpm test`, при необходимости обновить ожидания (не ослабляя проверки).
- Токенизация с И-логикой строже substring: запрос-фраза «кеш reference» перестанет находить документы с одним словом. Это желаемое поведение, но зафиксировать в описании инструмента и в doc.

## Входные данные

Инцидент: два нерелевантных `backlog_search` подряд (кириллица), релевантные задачи найдены только через `modified_files`/прямое чтение.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение (архитектурные выборы)

1. **Разделение API core**: `searchTasks` сохраняет сигнатуру `(cwd, filters) => Task[]` (её используют CLI `src/cli/commands/search.ts:48`, `globalSearch` `src/core/search.ts:199`, веб через globalSearch, тесты). Рядом экспортируется `searchTasksRanked(cwd, filters) => { tasks: Task[]; found: number }` — MCP берёт `found` оттуда. `searchTasks` = обёртка `searchTasksRanked(...).tasks`, дублирования логики нет.
2. **Ответ MCP `backlog_search` меняется с массива на объект** `{ found, returned, tasks }`: полноту иначе не сообщить (JSON-array не даёт места для метаданных). Формат — внутренний MCP-API (совместимость с Backlog.md строгая только по хранению данных), поэтому допустимо; надо обновить доку doc-8 и ожидания двух тестов (не ослабляя проверки: `data.length` → `data.tasks.length`, добавляется проверка `found`).
3. **Морфология** — усечение основы: для токенов длиной ≥6 символов сравниваем префикс из первых 5 символов (`модель`/`моделями` → `модел`, `зависимости`/`зависимостями` → `завис`, `search`/`searching` → `searc`). Полноценный стеммер не нужен; ложные срабатывания на коротких основах приемлемы и документируются.
4. **И-логика по токенам**: токен обязателен, если он встретился хоть в одном поле; для однословного запроса поведение ≈ текущему substring (плюс усечение основы).
5. **Детерминированный порядок**: score desc → `created_date` desc → `id` asc.

## Файлы и конкретные места

### 1. `src/core/search.ts` (основная правка)
- Строки 1–11: обновить шапку-комментарий (описать токенизацию/веса/морфологию вместо «substring-поиск»).
- Строки 20–31 (`SearchFilters`): без изменений (новых параметров не вводим).
- Строки 42–106 (`searchTasks`, блок текстового фильтра 55–65 и хвост с `limit` 102–104): выделить внутренний движок и вынести ранжирование.
  - Новые приватные хелперы перед `searchTasks`:
    - `tokenizeQuery(query: string): string[]` — lowercase, split по `/[^\p{L}\p{N}\-_]+/u` (дефис сохраняем, иначе `VL-237` и `deps.ts` разваливаются), отбросить пустые;
    - `stemToken(token: string, prefixLen = 5): string` — усечение до 5 символов для токенов длиной ≥6;
    - `scoreTask(task, tokens): number` — сумма по токенам: id точное совпадение `1000`, id содержит `500`, title `100`, labels `50` (каждая метка, макс. один раз на токен), description `10`; токен, не найденный ни в одном поле, обнуляет задачу (И-логика, возврат `-1`).
    - `FIELD_WEIGHTS` — именованные константы рядом с функциями (без магических чисел в коде).
  - `searchTasksRanked(cwd, filters)`: собрать `listTasks(cwd)` → отфильтровать по score при непустом query (сортировка по score/`created_date`/`id`) → применить поля-фильтры (`status/type/priority/project/modifiedFiles/hasLessons`, строки 67–101) → `found = tasks.length` → применить `limit` (строки 102–104) → вернуть `{ tasks, found }`.
  - `searchTasks(cwd, filters | string)` — оставить строковую нормализацию (42–50) и вернуть `.tasks` из `searchTasksRanked`.
- Строки 120–137, 175–205 (`globalSearch`): только комментарий (задачи теперь идут ранжированными) — код не меняется, `searchTasks` уже отдаёт порядок по релевантности.

### 2. `src/mcp/tools.ts`
- Строки 238–252 (schema `backlog_search`): переписать `description` инструмента и описание `query` — «токены через пробел/пунктуацию, требуется вхождение ВСЕХ (И), учитывается усечение основы (первые 5 символов), ранжирование id > title > labels > description; `limit` усекает, полное число совпадений — в `found`». `required` не добавлять (lesson-94: query опционален, как в оригинале).
- `import` (строка 22): добавить `searchTasksRanked` (использовать его в `toolSearch`, `searchTasks` в файле больше не нужен — проверить прочие вхождения).
- Строки 1545–1565 (`toolSearch`): вызвать `searchTasksRanked(cwd, {...})`, вернуть `JSON.stringify({ found, returned: tasks.length, tasks: simplified }, null, 2)`.

### 3. Тесты
- Новый файл `src/core/search-rank.test.mjs` (mkdtemp + `createTaskFile`, как в `src/mcp/search-filters.test.mjs`):
  1. совпадение в title ранжируется выше совпадения в description (задача с «модель» в title выше задачи, где искомое слово тонет в 8 КБ description);
  2. точное совпадение id — первым; `limit: 1` при этом отдаёт именно её;
  3. многословный запрос — И-логика: задача с одним из токенов не попадает; задача со всеми — попадает;
  4. морфология: запрос «модель» находит задачу с «моделями» (усечение основы);
  5. детерминированность: два совпадения с равным score при двух вызовах дают одинаковый порядок (`created_date` desc → `id` asc);
  6. `searchTasksRanked`: `found` = общее число совпадений, `returned`/длина = после `limit`;
  7. `searchTasks` (старый API) на тех же данных возвращает `Task[]` и тот же порядок.
- `src/mcp/search-filters.test.mjs`: блок `VL-8 — backlog_search (MCP)` (строки 125–157) — `JSON.parse(res)` теперь объект: заменить `data.length` → `data.tasks.length`, `data[0]` → `data.tasks[0]`, добавить проверку `data.found === data.tasks.length` и кейс «`limit: 1` при 2 совпадениях → `found === 2`, `returned === 1`».
- `src/core/core.test.mjs` (строки 231–269) и `src/core/compat-full.test.mjs` (строки 252–263) — проверить, что не ломаются (core-API и схема не меняются; правок не ожидается, но прогнать).

### 4. Документация
- `MCP-SETUP.md:21` — описание `backlog_search` (ранжирование + `found`) — обычный файл репозитория, править `edit`.
- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md:129–137` — таблица параметров `backlog_search` + абзац о ранжировании, И-логике и форме ответа `{ found, returned, tasks }`. Правка ТОЛЬКО через `document_update` (файл в backlog/), предварительно прочитав актуальное содержимое `read_file` чанками; тело документа большое — править аккуратно, не теряя секции (lesson-63).
- `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md:134–138` — раздел `vibelog search`: добавить, что запрос трактуется как набор токенов (И), выдача — по релевантности; тоже через `document_update`.
- `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` (упоминает `backlog_search`) — только если в тексте прямо описан старый substring-поиск; проверить `grep` и поправить одну строку.

## Порядок действий
1. `src/core/search.ts`: хелперы токенизации/стемминга/скора + `searchTasksRanked`; `searchTasks` — обёртка. `pnpm build`.
2. Быстрый ручной прогон на реальном backlog: `node -e "import('./dist/core/search.js').then(m=>console.log(m.searchTasksRanked(process.cwd(),{query:'модель',limit:5}).tasks.map(t=>t.id+':'+t.title), ))"` — ожидается VL-209 в первой пятёрке.
3. `src/mcp/tools.ts`: schema-описания + `toolSearch` на `{found, returned, tasks}`.
4. Тесты: новый `src/core/search-rank.test.mjs`, правка `src/mcp/search-filters.test.mjs`.
5. Документация (MCP-SETUP.md через `edit`, doc-7/doc-8/doc-6 через `document_update`).
6. Полный `pnpm test` (build + vitest) — DoD «Тесты проходят» закрывается только полным прогоном.

## Проверка
```bash
pnpm build
node scripts/… # не требуется
pnpm test:fast        # быстрый цикл после сборки
pnpm test             # финальный полный прогон (build + vitest run)
```
Ручные проверки после сборки:
- `node -e` по `searchTasksRanked` с запросами «модель», «зависимости» — релевантные задачи (VL-209, VL-232) в топе, случайные подстрочные совпадения ниже;
- MCP через `handleToolCall('backlog_search', {query:'модель', limit:3}, cwd)` — в ответе `found > returned`.

## Риски
- **Порядок выдачи меняется** — тесты, ожидающие порядок каталога, могут упасть (известные: `src/mcp/search-filters.test.mjs` — только форма ответа; `core.test.mjs` — по одному совпадению на запрос). Правки ожиданий — без ослабления проверок; при неожиданных падениях других файлов смотреть `searchTasks`-зависимые тесты.
- **И-логика строже substring**: фраза «кеш reference» перестанет находить документы с одним словом — зафиксировать в описании инструмента и в doc-8/doc-7.
- **Морфология-префикс 5 символов** даёт ложные совпадения на коротких основах (`тест`~`тесто`); приемлемо, задокументировать; при жалобах — поднять/понизить `PREFIX_LEN` константой.
- **Смена формы ответа MCP** ломает агентские промпты/шаблоны, ожидающие массив: проверить `templates/prompts/chat-system.md` и `templates/phases/*` на разбор результата (grep `backlog_search`), поправить текст при необходимости.
- Правка больших документов в backlog/ через `document_update` — риск обрезки/потери секций (lesson-63): читать актуальное тело чанками и заменять только изменяемые абзацы.
- Производительность: скор считается по каждому кандидату (description до 8 КБ) — на тысячах задач линейно, ок; при необходимости предфильтр по первому токену.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 08:05
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача).
**Изучено:** `src/core/search.ts` (searchTasks 42–106, globalSearch 175–205), `src/mcp/tools.ts` (schema 238–252, toolSearch 1545–1565), `src/cli/commands/search.ts`, `src/mcp/search-filters.test.mjs`, `src/core/core.test.mjs` (231–269), `src/core/compat-full.test.mjs` (252–263), документация `MCP-SETUP.md`, `backlog/docs/doc-7`, `doc-8`, `templates/prompts/chat-system.md`.
**Ключевые решения плана:**
- Новый core-API `searchTasksRanked(cwd, filters) => { tasks, found }`; `searchTasks` остаётся обёрткой `(cwd, filters) => Task[]` — CLI, globalSearch, веб и тесты не ломаются.
- Ранжирование: веса id (точное 1000 / подстрока 500) > title (100) > labels (50) > description (10); детерминированный порядок score desc → created_date desc → id asc.
- Токенизация запроса с И-логикой (split по не-буквам/цифрам, дефис сохраняется — иначе `VL-237`), минимальная морфология — усечение основы до 5 символов для токенов ≥6.
- Ответ MCP `backlog_search` меняется на объект `{ found, returned, tasks }` — единственный способ сообщить полноту при limit; форма ответа задокументирована.
**Файлы в плане (существование проверено):** `src/core/search.ts`, `src/mcp/tools.ts`, новый `src/core/search-rank.test.mjs`, правка `src/mcp/search-filters.test.mjs`, `MCP-SETUP.md`, `backlog/docs/doc-7`, `doc-8`, при необходимости `doc-6`.
**Риски:** изменение порядка выдачи (обновить ожидания без ослабления проверок); И-логика строже substring — зафиксировать в описании инструмента и доках; префиксное усечение даёт ложные совпадения на коротких основах; смена формы ответа MCP может затронуть шаблоны промптов (проверить `backlog_search` в templates); правка больших документов backlog через `document_update` — осторожно (lesson-63).
---
author: @agent
created: 2026-10-30 08:27
---
Фаза 3 (Code) выполнена. Коммит: 3a62f18 «feat: VL-237 — ранжирование и токенизация поиска задач, found в backlog_search».
**Изменено:**
- `src/core/search.ts` — токенизация (`tokenizeQuery`, дефис/подчёркивание сохраняются), основа (`stemToken`, PREFIX_LEN=5, только для слов без дефиса — иначе `findme-desc`/`findme-label` неразличимы), `scoreTask` (веса idExact 1000 / idPartial 500 / title 100 / labels 50 / description 10, И-логика по токенам), новый экспорт `searchTasksRanked(cwd, filters) => { tasks, found }` с детерминированной сортировкой score desc → created_date desc → id asc; `searchTasks` — тонкая обёртка (CLI/globalSearch/веб получили ранжирование бесплатно, сигнатура не изменилась).
- `src/mcp/tools.ts` — описания инструмента и `query` переписаны (токены + И-логика + ранжирование + found); `toolSearch` возвращает `{ found, returned, tasks }`.
- Тесты: новый `src/core/search-rank.test.mjs` (10 кейсов: токенизация, стемминг, title > description, точный id первым при limit 1, И-логика, морфология «модель»→«моделями», детерминированный порядок по created_date, found до усечения, обратная совместимость `searchTasks`, фильтры+ранжирование). Обновлены ожидания формы ответа (без ослабления) в `src/mcp/search-filters.test.mjs`, `src/mcp/server.test.mjs`, `src/mcp/lesson-tools.test.mjs` — это вынужденная адаптация к `{found, returned, tasks}`, проверок стало больше (добавлена проверка `found`/`returned`).
- `MCP-SETUP.md` — строка `backlog_search` описывает токены/ранжирование/форму ответа.
**Проверки:**
- `pnpm build` — ok;
- полный `pnpm test` (build + vitest run, без --exclude/--skip) — 88 файлов зелёные;
- ручной прогон на реальном backlog: `модель` → found=36, в топ-5 VL-209; `зависимости` → found=40, в топе VL-232 (раньше нужные задачи в первую страницу не попадали); `кеш reference` → 1 (И-логика, как задумано).
**Что осталось (Фаза Close):** обновить `backlog/docs/doc-8` (таблица параметров + ранжирование/форма ответа) и `doc-7` (раздел `vibelog search`); по правилам Фазы 3 документы backlog/docs здесь не правятся. `templates/` менять не потребовалось — разбора результата `backlog_search` в шаблонах нет.
Lessons: создан lesson-96 (не усекать основу токенов с дефисом), связан с задачей.
---
author: @agent
created: 2026-10-30 08:52
---
Фаза Close выполнена. Ветка vb/vl-237 слита в master (1 коммит: 3a62f18 + merge), worktree удалена, ветка удалена. Проверки в главном репо после merge: `pnpm build` — ok, полный `pnpm test` — 1669 passed / 4 skipped (без --exclude/--skip). DoD: 1 (тесты) — выполнен полным прогоном; 2 (документация) — выполнена: MCP-SETUP.md (Фаза 3), doc-8 (таблица `backlog_search` + абзацы о токенизации/весах/морфологии и форме ответа `{found, returned, tasks}`), doc-7 (раздел `vibelog search` — токены/И-логика/ранжирование), doc-6 (строка примера `vibelog search`), CHANGELOG.md (Unreleased → Изменено); 3 (нет регрессий) — все тесты зелёные, включая обновлённые ожидания формы ответа в search-filters/server/lesson-tools. Коммиты: merge vb/vl-237, ac88b5f (lesson-96), 21b74fb (docs: документация и CHANGELOG). Lessons: lesson-96 (не усекать основу токенов с дефисом) создан ранее в Фазе 3 и связан с задачей. Примечание: содержимое doc-8 отвечало на массиве — переведено в форму объекта в этой фазе; замечаний по коду нет.
---
<!-- COMMENTS:END -->