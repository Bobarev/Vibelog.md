---
id: VL-367
title: 'upstream: listLabels шлёт per_page вместо limit — GitVerse отвечает 400, репорт бага не работает'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 22:30'
updated_date: '2026-11-08 01:03'
due_date: ''
labels:
  - upstream
  - gitverse
  - bug
  - api
dependencies: []
milestone: ''
references:
  - ref-27
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/gitverse-issues.ts
  - src/core/gitverse-issues.test.mjs
  - src/cli/upstream.test.mjs
lessons:
  - lesson-249
token_usage:
  input: 4014542
  output: 27600
  cache: 3767808
  total: 4042142
  requests: 95
  duration_ms: 1241829
  reasoning: 12493
  by_phase:
    code:
      input: 1354524
      output: 9444
      cache: 1252864
      requests: 31
    close:
      input: 2660018
      output: 18156
      cache: 2514944
      requests: 64
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Симптом

Ручная проверка VL-363 на реальном GitVerse упала на первом же шаге:

```
$ vibelog upstream report --title "Проверка канала баг-репортов" --body "..." --severity low --area mcp --source-task VL-363

Ошибка: GitVerse ответил ошибкой 400 [VALIDATION_ERROR]: Invalid request
(https://api.gitverse.ru/repos/bobarev/Vibelog.md/labels?per_page=100);
проверь поля запроса (title непустой, метки существуют в репозитории)
```

## Корень

`GET /repos/{owner}/{repo}/labels` в GitVerse принимает **`limit`**, а не `per_page`. Это отличие от `GET /issues`, где параметр действительно `per_page`.

Документация (ref-27, секция `api-get-repos-labels`):

| Параметр | Где | Тип | Описание |
|---|---|---|---|
| `page` | query | integer | Номер страницы, по умолчанию 1 |
| `limit` | query | integer | **Количество меток на странице**, по умолчанию 30 |
| `sort` | query | string | Сортировка |

Пример из документации: `curl ".../labels?limit=50&page=1"`.

В коде `src/core/gitverse-issues.ts:794-796`:

```ts
export async function listLabels(cfg: UpstreamConfig, opts: RequestOptions = {}): Promise<string[]> {
  const url = buildUrl(cfg.apiBase, labelsPath(cfg), { per_page: 100 });
  const result = await request(cfg, 'GET', labelsPath(cfg), { query: { per_page: 100 }, ...opts });
```

GitVerse видит неизвестный query-параметр и отвечает `400 VALIDATION_ERROR`. Падение происходит в `ensureLabels` → `listLabels`, то есть **до** создания issue — репорт не работает вообще.

`listIssues` (строка 883) использует `per_page` — и это **правильно**, там параметр именно такой. Ошибка только в `listLabels`.

## Почему тесты не поймали

`src/core/gitverse-issues.test.mjs` идёт на локальном `node:http`-фикстуре, который принимает любой query и отвечает `200`. Фикстура не валидирует имена параметров — расхождение с реальным API прошло незамеченным. Тест `listLabels возвращает имена` (строка 231) проверяет только разбор ответа, не запрос.

## Цель

`vibelog upstream report` работает на реальном GitVerse: метки читаются, отсутствующие создаются, issue создаётся.

## Затронутые файлы

- `src/core/gitverse-issues.ts` — `listLabels` (строки 794-796).
- `src/core/gitverse-issues.test.mjs` — фикстура + регрессионный тест.
- `CHANGELOG.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `listLabels` (`src/core/gitverse-issues.ts`) шлёт `limit=100`, а не `per_page=100` — и в `buildUrl`, и в `request({query})`. Комментарий в шапке функции объясняет, почему `limit` (у `/labels` параметр называется иначе, чем у `/issues`), чтобы следующий не «исправил» обратно
- [x] #2 `listIssues` НЕ тронут — там `per_page` корректен (документация ref-27, секция `api-get-issues`). Регрессионный тест подтверждает, что `/issues` по-прежнему получает `per_page`
- [x] #3 Фикстура в `src/core/gitverse-issues.test.mjs` валидирует query-параметры: запрос к `/labels` с `per_page` → ответ `400 VALIDATION_ERROR` (как реальный GitVerse), запрос с `limit` → `200`. Это закрывает класс ошибок «фикстура принимает что угодно»
- [x] #4 Регрессионный тест: `listLabels` на фикстуре, отвергающей `per_page`, возвращает имена меток (падал бы на старом коде)
- [ ] #5 Ручная проверка на реальном GitVerse: `vibelog upstream report --title "Проверка канала" --body "..." --severity low --area mcp` → код `0`, issue создан, метки `upstream`/`from-vl` навешены (или созданы автоматически)
- [x] #6 `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md обновлён
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План

### 1. Фикс `listLabels` — `src/core/gitverse-issues.ts:794-796`

```ts
// было
const url = buildUrl(cfg.apiBase, labelsPath(cfg), { per_page: 100 });
const result = await request(cfg, 'GET', labelsPath(cfg), { query: { per_page: 100 }, ...opts });

// станет
const url = buildUrl(cfg.apiBase, labelsPath(cfg), { limit: 100 });
const result = await request(cfg, 'GET', labelsPath(cfg), { query: { limit: 100 }, ...opts });
```

Обновить шапку функции — сейчас там написано «`per_page=100` покрывает реальный случай». Заменить на объяснение:

```
 * Пагинация не разворачивается: меток в репозитории единицы, а `limit=100`
 * покрывает реальный случай. ВАЖНО: у `/labels` параметр называется `limit`,
 * а не `per_page` (у `/issues` — наоборот, см. `listIssues`). GitVerse
 * отвечает 400 VALIDATION_ERROR на неизвестный query-параметр (VL-367).
```

### 2. `listIssues` — не трогать

Строка 883 (`per_page: query.perPage`) корректна: документация ref-27, секция `api-get-issues`, параметр `per_page` (макс. 100, дефолт 30). Добавить в шапку `listIssues` одну строку-предупреждение, чтобы связь между двумя функциями была видна:

```
 * ВНИМАНИЕ: здесь `per_page` (как в документации `/issues`), а в `listLabels` —
 * `limit`. Параметры у эндпоинтов разные, перепутать легко (VL-367).
```

### 3. Фикстура — валидировать query

В `src/core/gitverse-issues.test.mjs` добавить хелпер, который проверяет допустимые query-параметры по пути:

```js
/** Допустимые query-параметры по пути (как в реальном GitVerse). */
const ALLOWED_QUERY = {
  labels: ['page', 'limit', 'sort'],
  issues: ['state', 'q', 'labels', 'milestones', 'created_by', 'assigned_by',
           'mentioned_by', 'type', 'sort', 'direction', 'since', 'before',
           'per_page', 'page'],
};

/** Отвечает 400 VALIDATION_ERROR, если query-параметр не из белого списка. */
function rejectUnknownQuery(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const kind = url.pathname.endsWith('/labels') ? 'labels'
             : url.pathname.endsWith('/issues') ? 'issues' : null;
  if (kind === null) return false;
  const allowed = ALLOWED_QUERY[kind];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', status: 400 } }));
      return true;
    }
  }
  return false;
}
```

Применить в `beforeEach`-обёртке `handler` (или в самом `createServer` до вызова `handler`) — тогда **все** существующие тесты начнут проверять контракт, а не только новый.

**Риск:** если какой-то существующий тест шлёт параметр вне списка, он упадёт — это и есть цель (найдёт ещё расхождения). Список `ALLOWED_QUERY` взят из ref-27, при падении сверить с документацией, а не расширять список наугад.

### 4. Регрессионный тест

```js
it('listLabels шлёт limit, а не per_page (VL-367)', async () => {
  handler = json(200, [{ name: 'upstream' }]);
  await listLabels(cfg(), opts());
  assert.match(paths[0], /[?&]limit=100/);
  assert.doesNotMatch(paths[0], /per_page/);
});

it('listIssues шлёт per_page, а не limit (регрессия)', async () => {
  handler = json(200, []);
  await listIssues(cfg(), { perPage: 50 }, opts());
  assert.match(paths[0], /[?&]per_page=50/);
  assert.doesNotMatch(paths[0], /[?&]limit=/);
});
```

### 5. Проверка

```bash
pnpm build && pnpm test src/core/gitverse-issues.test.mjs
# затем полный прогон
pnpm test
# и ручная проверка на реальном GitVerse
vibelog upstream report --title "Проверка канала" --body "..." --severity low --area mcp
```

### Риски

- **Фикстура с валидацией может уронить существующие тесты.** Это ожидаемо и полезно: каждый упавший тест — либо реальное расхождение с API, либо параметр, которого нет в документации. Разбирать по одному, не расширять белый список «чтобы прошло».
- **`limit` в `/labels` — не единственное возможное расхождение.** После фикса стоит прогнать ручную проверку полного цикла (создание issue, комментарий, закрытие) — следующая задача всё равно это сделает.
- **Тело issue и метки.** Если после фикса упадёт `POST /issues` с 400 — смотреть, какие поля уходят; возможно, `type: "bug"` требует настройки типов в организации (документация предупреждает: «доступные типы определяются настройками организации»).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 00:12
---
Фаза 3 (Code) выполнена. Коммит b0da92c.
Изменено:
- `src/core/gitverse-issues.ts` — `listLabels` шлёт `limit=100` (и в `buildUrl`, и в `request({query})`); шапка функции объясняет, почему у `/labels` параметр `limit`, а у `/issues` — `per_page`. В шапку `listIssues` добавлено предупреждение о различии параметров. Логика `listIssues` не тронута.
- `src/core/gitverse-issues.test.mjs` — фикстура теперь валидирует query-параметры: `ALLOWED_QUERY` по эндпоинтам (`labels`: page/limit/sort; `issues`: полный список из ref-27), `rejectUnknownQuery` отвечает `400 VALIDATION_ERROR` на неизвестный параметр (проверка стоит в `createServer` до `handler`, поэтому контракт проверяют ВСЕ тесты файла). Добавлены регрессионные тесты: `listLabels` шлёт `limit=100` и не шлёт `per_page`; `listIssues` шлёт `per_page=50` и не шлёт `limit`; отдельный тест на сам контракт фикстуры (`/labels?per_page=100` → 400 VALIDATION_ERROR).
- `src/cli/upstream.test.mjs` — вне списка файлов задачи, но правка была необходима: тест «нет токена → код 4» падал (получал 3), потому что `testSpawnEnv` наследует `GITVERSE_TOKEN` из окружения агентской сессии, а CLI читает shell env раньше `.env`. Теперь `runCli` явно удаляет `GITVERSE_TOKEN` из env спавна — тест видит только токен, который сам положил в `.env`.
Проверки:
- `pnpm build && npx vitest run src/core/gitverse-issues.test.mjs` — 37 тестов зелёные.
- Полный `pnpm test` — 195 файлов / 3643 теста passed, 4 skipped, 0 failed (лог: `.vibelog/tmp/vl367-test2.log`). Исключённых/пропущенных файлов нет; 4 skipped — штатные `it.skip` в существующих файлах, не связанные с задачей.
- Ручная проверка на реальном GitVerse (AC5) — частично: прямыми запросами к `https://api.gitverse.ru/repos/bobarev/Vibelog.md/labels` подтверждено, что `?per_page=100` даёт `400 VALIDATION_ERROR` (исходный баг), а `?limit=100` — уже не 400, а `403 FORBIDDEN "Access denied"`. То есть параметр принят API, но у токена из окружения нет прав на чтение меток этого репозитория. Полный цикл `vibelog upstream report` (создание issue + навешивание меток) на реальном GitVerse выполнить не удалось — упирается в права токена (нужен токен с правом «Запись» на `bobarev/Vibelog.md`), это внешнее ограничение, а не дефект кода. AC5 оставлен незакрытым.
Что осталось: AC5 (ручная проверка полного цикла на реальном GitVerse с токеном, имеющим права записи) и AC6 в части «CHANGELOG.md обновлён» — CHANGELOG по правилам фазы 3 не правится, его пишет фаза Close.
---
author: @agent
created: 2026-11-08 00:13
---
Фаза Close прервана: конфликт слияния vb/vl-367 → master в файле `src/cli/upstream.test.mjs` (UU). Это путь вне разрешённого для авторезолва множества (`CHANGELOG.md`, `backlog/docs/*`), поэтому резолв не выполнялся, `git merge --abort` не делался — merge оставлен в состоянии разрешения конфликта.
Состояние: ветка vb/vl-367 содержит 1 коммит (b0da92c «fix: VL-367 — listLabels шлёт limit вместо per_page (GitVerse 400)»), worktree `.vibelog/worktrees/vl-367` чист (только untracked `backlog/references/data`), worktree и ветка НЕ удалены.
Суть конфликта (git status --porcelain: `UU src/cli/upstream.test.mjs`): в master уже есть правка того же места в `runCli` — снятие `GITVERSE_TOKEN` из env спавна с комментарием «Токен из shell-окружения снимается: тесты проверяют приоритет `.env` и кейс «нет токена»…» (строки 58–62, сторона HEAD), а в ветке VL-367 то же место правилось иначе (строка 64, сторона vb/vl-367). Обе стороны решают одну задачу — изоляция теста от унаследованного `GITVERSE_TOKEN`; нужно оставить один вариант (вероятно, вариант master с комментарием, если он эквивалентен по поведению) и убедиться, что тест «нет токена → код 4» проходит.
Что нужно сделать, чтобы повторить Close: в главном репозитории разрешить конфликт `UU src/cli/upstream.test.mjs` (оставить корректный вариант снятия `GITVERSE_TOKEN` из env спавна), выполнить `git add src/cli/upstream.test.mjs && git commit --no-edit`, затем запустить Фазу Close заново. Дополнительно учесть: в рабочем дереве главного репо лежат незакоммиченные untracked-файлы других задач (backlog/docs/doc-28, ref-26/27/28, lesson-244/246/247, backlog/tasks/VL-358) — их не трогать.
---
author: @agent
created: 2026-11-08 00:13
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-367 → master в файле `src/cli/upstream.test.mjs` (UU). Это путь вне разрешённого для авторезолва множества (`CHANGELOG.md`, `backlog/docs/*`), поэтому резолв не выполнялся, `git merge --abort` не делался — merge оставлен в состоянии разрешения конфликта.
Состояние: ветка vb/vl-367 содержит 1 коммит (b0da92c «fix: VL-367 — listLabels шлёт limit вместо per_page (GitVerse 400)»), worktree `.vibelog/worktrees/vl-367` чист (только untracked `backlog/refere — статус возвращён к Review.
---
author: @agent
created: 2026-11-08 00:20
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 4 из 6
DoD отмечено: 2 из 3
AC не отмечены (2): 5. Ручная проверка на реальном GitVerse: `vibelog upstream report --title "Проверка канала" --body "..." --severity low --area mcp` → код `0`, issue создан, метки `upstream`/`from-vl` навешены (или созданы автоматически); 6. `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md обновлён
DoD не отмечены (1): 2. Документация обновлена
Файлы (3): src/core/gitverse-issues.ts, src/core/gitverse-issues.test.mjs, src/cli/upstream.test.mjs
Фрагмент плана: ## План ### 1. Фикс `listLabels` — `src/core/gitverse-issues.ts:794-796` ```ts // было const url = buildUrl(cfg.apiBase, labelsPath(cfg), { per_page: 100 }); const result = await request(cfg, 'GET', labelsPath(cfg), { query: { per_page: 100 }, ...opts }); // станет const url = buildUrl(cfg.apiBase, …
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #5, #6) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
author: @agent
created: 2026-11-08 00:22
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 4 из 6
DoD отмечено: 2 из 3
AC не отмечены (2): 5. Ручная проверка на реальном GitVerse: `vibelog upstream report --title "Проверка канала" --body "..." --severity low --area mcp` → код `0`, issue создан, метки `upstream`/`from-vl` навешены (или созданы автоматически); 6. `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md обновлён
DoD не отмечены (1): 2. Документация обновлена
Файлы (3): src/core/gitverse-issues.ts, src/core/gitverse-issues.test.mjs, src/cli/upstream.test.mjs
Фрагмент плана: ## План ### 1. Фикс `listLabels` — `src/core/gitverse-issues.ts:794-796` ```ts // было const url = buildUrl(cfg.apiBase, labelsPath(cfg), { per_page: 100 }); const result = await request(cfg, 'GET', labelsPath(cfg), { query: { per_page: 100 }, ...opts }); // станет const url = buildUrl(cfg.apiBase, …
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #5, #6) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
author: @agent
created: 2026-11-08 00:24
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 4 из 6
DoD отмечено: 2 из 3
AC не отмечены (2): 5. Ручная проверка на реальном GitVerse: `vibelog upstream report --title "Проверка канала" --body "..." --severity low --area mcp` → код `0`, issue создан, метки `upstream`/`from-vl` навешены (или созданы автоматически); 6. `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md обновлён
DoD не отмечены (1): 2. Документация обновлена
Файлы (3): src/core/gitverse-issues.ts, src/core/gitverse-issues.test.mjs, src/cli/upstream.test.mjs
Фрагмент плана: ## План ### 1. Фикс `listLabels` — `src/core/gitverse-issues.ts:794-796` ```ts // было const url = buildUrl(cfg.apiBase, labelsPath(cfg), { per_page: 100 }); const result = await request(cfg, 'GET', labelsPath(cfg), { query: { per_page: 100 }, ...opts }); // станет const url = buildUrl(cfg.apiBase, …
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #5, #6) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
author: @agent
created: 2026-11-08 01:03
---
Фаза Close выполнена. Статус: Done.
Коммиты: feat — не требовался (код VL-367 уже закоммичен ранее: `fix: VL-367 — listLabels шлёт limit вместо per_page (GitVerse 400)` b0da92c + merge 0bffcc4); docs c1818e5 (doc-28 §5.3 — пагинация `/labels` — `page|limit|sort`, `per_page` у `/labels` нет, плюс запись в CHANGELOG Unreleased/«Исправлено»); lesson/ref 280e359 (lesson-249 тело + ref-27).
Проверки после merge: `pnpm build` — успешно (один раз); точечно `src/core/gitverse-issues.test.mjs` (37) + `src/cli/upstream.test.mjs` (6) — зелёные; полный прогон `pnpm test` — 195 файлов, 3667 тестов passed, 4 skipped, падений нет (повторных прогонов не требовалось).
Lessons: lesson-249 (валидация query-параметров в HTTP-фикстуре по белому списку эндпоинта) — записано тело «Проблема/Решение/Пример», связан с VL-367, список lessons задачи обновлён.
Не закоммичено: ref-26/ref-27/ref-28 (untracked, созданы в рамках VL-363) — вне этой задачи; lesson-244/246/247 (untracked, VL-363) — вне этой задачи; файл задачи VL-367 и VL-358 — коммитит framework/чужая фаза.
Остался невыполненным AC #5 (ручная проверка на реальном GitVerse с созданием issue): требует боевого `GITVERSE_TOKEN` и создаёт реальный issue в родительском репозитории — не выполнялось автоматической фазой Close. Сам дефект закрыт в юнит-уровне: фикстура теперь отвечает 400 на `per_page`, `listLabels` шлёт `limit=100`; полный цикл проверяется при первом реальном репорте.
---
<!-- COMMENTS:END -->