---
id: VL-375
title: 'Git-транспорт баг-репортов: общий репозиторий-инбокс с mesh-маршрутизацией и контролем доступа (свои — push, внешние — PR)'
status: Review
assignee: []
reporter: ''
created_date: '2026-11-08 12:07'
updated_date: '2026-11-08 17:39'
due_date: ''
labels:
  - upstream
  - git
  - transport
  - access-control
  - feature
dependencies: []
milestone: ''
references:
  - ref-26
  - ref-27
  - ref-28
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/upstream-git.ts
  - src/core/upstream-git.test.mjs
  - src/core/gitverse-issues.ts
  - src/mcp/server.ts
  - src/mcp/tools.ts
  - src/mcp/upstream-tool.test.mjs
  - src/cli/commands/upstream.ts
  - src/cli/upstream.test.mjs
  - src/web/tool-policy.ts
  - CHANGELOG.md
  - backlog/docs/doc-28-GitVerse-Issues-канал-баг-репортов-между-проектами-VL-363.md
  - src/core/gitverse-issues.test.mjs
  - src/mcp/server.test.mjs
  - src/cli/router.ts
  - src/web/tool-policy.test.mjs
  - src/core/gitignore.ts
  - src/core/gitignore.test.mjs
  - .vibelog/.gitignore
  - src/core/fixtures/reports/vl/2026-11-08-VL-375-example.md
lessons: []
token_usage:
  input: 21879631
  output: 167215
  cache: 20129280
  total: 22046846
  requests: 207
  duration_ms: 2267636
  reasoning: 89696
  by_phase:
    code:
      input: 21614643
      output: 165610
      cache: 19937280
      requests: 200
    close:
      input: 264988
      output: 1605
      cache: 192000
      requests: 7
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Транспорт баг-репортов через GitVerse Issues **не работает**: `GET /issues` и `POST /issues` отдают `403` при том, что `GET /repos/...` и `GET /labels` с тем же токеном дают `200`, у токена `permissions.push: true` и `role_name: admin`. Без токена тот же путь отвечает `401 UNAUTHORIZED` — значит аутентификация проходит, а гейт стоит на фиче. Это API уровня «Задачи 2.0» (раздел документации `pull-and-issues_2`), доступ к которому у аккаунта не выдан. Код VL-363 остаётся (включится при появлении доступа), но основной транспорт нужен другой.

Ранее отвергнутые варианты:
- **«у себя + reference-клон»** — не масштабируется на 20 проектов: 19 клонов, `reference sync` по всем, нет единой точки сборки;
- **issue-трекер любого вида** — упирается в тот же закрытый доступ.

## Цель

Общий репозиторий-инбокс как разделяемое состояние для mesh-топологии «многие ко многим» (до 20 проектов), с контролем доступа: **свои — прямой push, внешние — fork + PR**.

## Модель доступа (выбрана пользователем)

В git нет прав на подкаталог — права даются на репозиторий целиком. Поэтому контроль строится тремя независимыми слоями:

1. **Права репозитория:** Write — только своим проектам и их агентам; внешние — без Write, только fork + PR.
2. **Branch protection на `main`:** прямой push запрещён всем, кроме бота-мейнтейнера; изменения — через PR.
3. **CI-валидация путей:** workflow проверяет, что изменённые файлы принадлежат префиксу автора (`reports/<prefix>/**`), а в чужих файлах разрешено менять только `status`/`accepted_as` (ack). Не прошло — красный статус, merge блокируется.

Третий слой — главный: он ловит типовые аварии агентов (`git add -A` с мусором, force-push, коммит чужих файлов), от которых внутри своего проекта защищает `git_commit` с явными путями.

## Архитектурное ограничение

**Агент не может пушить в инбокс сам**: `resolveInProject`, `ensureTaskWorktree`, `git_commit` ограничены корнем своего проекта. Поэтому:

- клон инбокса живёт **внутри проекта-источника** (`.vibelog/upstream-inbox/`, в `.gitignore`);
- пишет и пушит **CLI** `vibelog upstream report` (запускается процессом пользователя/оркестратора — файловые границы агента на него не действуют);
- агент вызывает CLI через `run_shell_command` — одна команда, никаких обходов.

## Схема данных

```
reports/
  ui/2026-11-08-UI-12-git_commit-кириллица.md
  tpl/2026-11-08-TPL-3-шаблон-не-собирается.md
```

Каталог верхнего уровня — префикс проекта-источника (per-directory контроль через CI).

Фронтматтер отчёта:

```yaml
---
report_id: <sha1(source_project + source_task + title)>   # дедуп
source_project: Vibelog UI
source_prefix: UI
source_task: UI-12
target: Vibelog.md          # КОМУ адресован — маршрутизация «многие ко многим»
severity: high
area: mcp
created: 2026-11-08
status: open                # open → accepted → done
accepted_as: ""             # заполняет получатель: VL-367
---
```

Поле `target` — ключевое: отчёт адресуется конкретному получателю, а не «в родителя». `ui` может писать `templates`, `templates` — в `ui`, оба — в `Vibelog.md`.

## Затронутые файлы

- `src/core/upstream-git.ts` (новый) — git-транспорт: клон/пул инбокса, запись отчёта, чтение входящих, ack.
- `src/cli/commands/upstream.ts` — подкоманда `report` получает git-путь; добавить `pull` и `ack`.
- `src/core/gitverse-issues.ts` — остаётся, выбор транспорта через конфиг.
- `.vibelog/settings.json` — секция `upstream` расширяется полями `mode`, `inbox`, `prefix`.
- `templates/` или репозиторий инбокса — CI-workflow валидации путей (вне этого репо).
- `CHANGELOG.md`, doc-28.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/core/upstream-git.ts` (новый) — git-транспорт: `ensureInboxClone` (клон в `.vibelog/upstream-inbox/` при отсутствии, `pull --rebase` при наличии; ошибки сети/прав → `UpstreamGitError` с `kind`), `writeReport` (файл `reports/<prefix>/<дата>-<source_task>-<slug>.md` + `git add` ТОЛЬКО этого файла + commit + push), `listIncoming(cwd, targetPrefix)` (фильтр по `target` и `status: open`), `ackReport` (правка только `status`/`accepted_as`), `parseReport`/`serializeReport`/`slugify`/`reportId` — чистые функции
- [x] #2 `slugify` даёт только латиницу `[a-z0-9-]` (кириллица транслитерируется): не-ASCII имена файлов ломали сравнение путей в git-инструментах (VL-360). `reportId` = sha1 от `source_project + source_task + title` — повторный `writeReport` с теми же данными не создаёт второй файл (идемпотентность)
- [x] #3 `git add` в инбоксе — только явным путём файла отчёта. Никогда `-A`, `.`, маски — тот же инвариант, что у `git_commit` (VL-311/VL-360)
- [x] #4 Конфиг `upstream` — discriminated union по `mode`: `git` (дефолт; требует `inbox`, + опциональный `prefix`, дефолт из `task_prefix`) и `api` (требует `repo`; + `labels`, `type`, `token_env`). Поле `mode` отсутствует → `git`. `resolveUpstreamConfig` валидирует и возвращает union; невалидная комбинация → понятная ошибка с указанием, какого поля не хватает
- [x] #5 CLI: `vibelog upstream report` работает в обоих режимах (`--target` — получатель, дефолт для `git` — префикс получателя); новые подкоманды `upstream pull [--json]` (входящие для своего префикса) и `upstream ack <report_id> --as VL-N`. Коды выхода сохраняются: `0` успех, `1` использование, `2` конфиг, `3` сеть/git, `4` нет токена/доступа
- [x] #6 MCP `upstream_report_bug` остаётся в реестре и ветвится по `mode`: `git` → ядро `upstream-git.ts`, `api` → существующий `gitverse-issues.ts`. `TOOL_KINDS` не меняется (`write`)
- [x] #7 Условная видимость: `handleToolsList(id, cwd, send)` в `src/mcp/server.ts` фильтрует `upstream_report_bug` по `isUpstreamConfigured(cwd)`; без валидной секции `upstream` инструмент НЕ попадает в `tools/list`. `listTools()` остаётся без параметров (реестр = возможности системы), поэтому тесты паритета и счётчик не затрагиваются. Веб-чат (`chatToolDefs`) фильтрует тем же предикатом
- [x] #8 `isUpstreamConfigured(cwd)` — новый экспорт в `src/core/gitverse-issues.ts`: `true` только при валидной секции (`git` + `inbox`, либо `api` + `repo`); ошибки чтения и невалидные данные → `false` (fail-closed). Прямой `tools/call` скрытого инструмента возвращает `ackError` с подсказкой про `.vibelog/settings.json`, а не «Неизвестный инструмент»
- [x] #9 Тесты `src/core/upstream-git.test.mjs` на локальном git-фикстуре (приём `git-commit.test.mjs`): создание отчёта и коммит; идемпотентность по `report_id`; `listIncoming` фильтрует по `target`; `ackReport` меняет только `status`/`accepted_as` (остальное тело байт-в-байт); `ensureInboxClone` создаёт клон; `git add` берёт только файл отчёта. Плюс чистые функции: `slugify` (кириллица → латиница), `parseReport`/`serializeReport` round-trip
- [x] #10 Тест-паритет формата отчёта: образец `reports/vl/2026-11-08-VL-375-example.md` парсится `parseReport` без потери полей — код и README инбокса не разъезжаются молча (выбранный вариант «источник истины — код + паритет»)
- [x] #11 Тесты MCP: без секции `upstream` → `tools/list` не содержит `upstream_report_bug`; с валидной секцией (`git`+`inbox`) → содержит; с невалидной (нет `inbox`) → не содержит; прямой вызов без секции → `ok:false` с подсказкой. Тесты CLI: `report` в `mode: git`, `pull`, `ack`, `mode: api` без токена → код `4`
- [ ] #12 `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md и doc-28 (раздел «git-транспорт»: схема, маршрутизация, модель доступа, CI, порядок полей конфига, условная видимость инструмента) обновлены
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План

> Статус: **инфраструктура готова** (инбокс + CI проверены на реальном GitVerse, см. комментарий «Инбокс и CI готовы»). Ниже — оставшаяся часть: код транспорта.

### 1. Ядро `src/core/upstream-git.ts` (новый)

Без сети и без HTTP — git через `spawnSync('git', args, { cwd })` (приём `src/mcp/git-commit.ts`), плюс чтение/запись markdown.

```
INBOX_DIR = '.vibelog/upstream-inbox'      // внутри проекта, в .gitignore
REPORTS_DIR = 'reports'
```

Функции:
- `inboxPath(cwd)` → абсолютный путь клона инбокса;
- `ensureInboxClone(cwd, cfg)` → клон (при отсутствии) + `pull --rebase` (при наличии). Ошибки сети/прав → `UpstreamGitError` с `kind: 'network'|'auth'|'conflict'`;
- `slugify(title)` → **только латиница `[a-z0-9-]`**, кириллица транслитерируется или заменяется на `report` (не-ASCII имена ломали сравнение путей — VL-360);
- `reportId(report)` → sha1 от `source_project + source_task + title`;
- `writeReport(cwd, report)` → `reports/<prefix>/<YYYY-MM-DD>-<source_task>-<slug>.md`; если отчёт с таким `report_id` уже есть — `{ created: false, path }` (идемпотентность); иначе запись + `git add -- <path>` + commit + push;
- `parseReport(text)` / `serializeReport(report)` → чистые функции фронтматтера (тестируются без git);
- `listIncoming(cwd, targetPrefix)` → обход `reports/*/*.md`, фильтр `target === targetPrefix && status === 'open'`, сортировка по `created`;
- `ackReport(cwd, reportId, acceptedAs)` → найти файл по `report_id`, заменить **только** `status: accepted` и `accepted_as`, commit, push.

**Критично:** `git add` только явным путём файла отчёта. Никогда `-A`, `.`, маски.

**Источник истины формата — код** (`serializeReport`/`parseReport`). Тест-паритет парсит образец `reports/vl/2026-11-08-VL-375-example.md` и падает при расхождении полей — README инбокса и код не разъедутся молча. JSON Schema сознательно НЕ вводим (bash-CI её всё равно не распарсит).

### 2. Конфиг — discriminated union по `mode`

```json
{
  "upstream": {
    "mode": "git",
    "inbox": "git@gitverse.ru:Vibelog-md/upstream-reports.git",
    "prefix": "vl",
    "repo": "bobarev/Vibelog.md",
    "labels": ["upstream", "from-vl"],
    "type": "bug",
    "token_env": "GITVERSE_TOKEN"
  }
}
```

- `mode` отсутствует → `git` (API Задач 2.0 закрыт, см. doc-29).
- `git`: обязателен `inbox`; `prefix` опционален (дефолт из `task_prefix`).
- `api`: обязателен `repo`; читаются `labels`/`type`/`token_env`.
- `resolveUpstreamConfig` возвращает union; невалидная комбинация → ошибка с указанием недостающего поля.

**Оба транспорта живут рядом** (решение пользователя): `upstream_report_bug` не удаляется, ветвится по `mode`.

### 3. Условная видимость инструмента

```
src/mcp/server.ts
  handleToolsList(id, cwd, send)                 ← сигнатура получает cwd
    tools = listTools().filter(
      t => t.name !== 'upstream_report_bug' || isUpstreamConfigured(cwd)
    )
```

- `listTools()` **остаётся без параметров** — реестр описывает возможности системы (нужен доктору, тестам паритета, валидации персон). Менять сигнатуру = ломать 4 вызова и тесты.
- `isUpstreamConfigured(cwd)` — новый экспорт в `src/core/gitverse-issues.ts`: `true` только при валидной секции (`git`+`inbox` либо `api`+`repo`); ошибки чтения и невалидные данные → `false` (fail-closed).
- `handleToolCall` для скрытого инструмента → `ackError` с подсказкой про `.vibelog/settings.json`, а не «Неизвестный инструмент» (закрывает устаревший кэш списка у клиента).
- `chatToolDefs()` (`src/web/tool-policy.ts`) фильтрует тем же предикатом.

### 4. CLI `src/cli/commands/upstream.ts`

`report` ветвится по `mode`, получает `--target` (получатель; для `git` — префикс получателя). Новые подкоманды (регистрация по `positional[0]`, сейчас `void positional`):
- `vibelog upstream pull [--json]` — входящие для своего префикса;
- `vibelog upstream ack <report_id> --as VL-N`.

Коды выхода без изменений: `0`/`1`/`2`/`3`/`4`.

### 5. Тесты

`src/core/upstream-git.test.mjs` на локальном git-фикстуре (приём `git-commit.test.mjs`): создание+коммит, идемпотентность по `report_id`, `listIncoming` по `target`, `ackReport` меняет только два поля, `ensureInboxClone`, `git add` только файла. Плюс чистые: `slugify` (кириллица → латиница), `parseReport`/`serializeReport` round-trip, тест-паритет с образцом.

`src/mcp/upstream-tool.test.mjs`: видимость при трёх состояниях конфига + прямой вызов без секции.

`src/cli/upstream.test.mjs`: `report` в `mode: git`, `pull`, `ack`, `mode: api` без токена → код `4`.

Тесты паритета (`tool-classify`, счётчик реестра, `write-ack-contract`) **не трогаются** — они зовут `listTools()` без `cwd`.

### 6. Документация

doc-28: раздел «git-транспорт» (схема отчёта, маршрутизация `target`, три слоя доступа, CI, условная видимость инструмента, оба режима конфига). CHANGELOG — запись.

### Проверка

```bash
pnpm build && pnpm test
```

Ручная: локальный bare-репозиторий как инбокс → `upstream report --title "тест"` → файл+коммит; `upstream pull` → отчёт виден; `upstream ack <id> --as VL-999` → поля обновлены. Плюс: без секции `upstream` в `tools/list` инструмента нет.

### Риски

- **Не-ASCII в именах файлов.** Slug строго латиницей (VL-360).
- **Конфликты при параллельном push.** Разные файлы — конфликтов нет; один файл правят двое (источник + ack) → `pull --rebase`, при конфликте понятная ошибка «разреши вручную в `.vibelog/upstream-inbox/`».
- **Устаревший кэш списка инструментов у клиента** — закрыт actionable-ошибкой в `handleToolCall`.
- **Внешние репортеры (fork+PR)** — путь ручной: PR-API GitVerse в том же закрытом разделе. Осознанное ограничение.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 13:46
---
## Инбокс и CI созданы и работают
Репозиторий: `git@gitverse.ru:Vibelog-md/upstream-reports.git` (приватный, ветка `master`).
### Что закоммичено
| Файл | Назначение |
|---|---|
| `.gitverse/workflows/validate-paths.yml` | workflow на `push`/`pull_request` в master; `actions/checkout@v4` с `fetch-depth: 0`; диагностический шаг `toJson(gitverse)`; вызов скрипта с `ACTOR`/`BASE_SHA`/`HEAD_SHA` |
| `.gitverse/scripts/validate-paths.sh` | логика валидации (5 инвариантов) |
| `prefixes.yml` | маппинг «логин → префиксы», сейчас `bobarev: vl` |
| `README.md` | схема, формат отчёта, жизненный цикл, три слоя доступа |
| `reports/vl/2026-11-08-VL-375-example.md` | рабочий образец |
| `.gitignore` | служебный мусор |
### Проверено на реальном GitVerse
**Прогон 1** (run_id 2040601) — упал: скрипт проверял все изменённые файлы, включая служебные (`.gitignore`, `README.md`, `prefixes.yml`, `.gitverse/**`), которые в схему `reports/` не входят. Первый же push репозитория валил сам себя.
**Прогон 2** (run_id 2040625) — упал: синтаксическая ошибка `;;;` вместо `;;` в `case` внутри `is_zero_sha`; плюс ветка «первый push» была недостижима (проверка нулевого SHA стояла после `git cat-file -e`, а нулевого объекта в базе нет).
**Прогон 3** — **success**.
### Подтверждённые факты о CI GitVerse (были гипотезой)
- Директория workflow: **`.gitverse/workflows/`**, YAML.
- Синтаксис совместим с GitHub Actions: `actions/checkout@v4` отработал без адаптации.
- Раннер: `ubuntu-latest` → `gitverse.ru/gitverse/runner-image:ubuntu-latest`, git 2.43.0, bash с `-e -o pipefail`.
- **Контекст** (из лога `toJson(gitverse)`):
  - `gitverse.actor` — `bobarev`
  - `gitverse.sha` — SHA head-коммита
  - `gitverse.event.before` — SHA до пуша; при первом push — `0000...0`
  - `gitverse.event_name` — `push` / `pull_request`
  - `gitverse.ref_name` — `master`, `gitverse.ref` — `refs/heads/master`
  - `gitverse.event.commits[]` — массив с `added` / `modified` / `removed` / `author` / `message`
  - `github.*` — алиас `gitverse.*` (видно в post-шагах checkout)
- `::error::<текст>` в выводе скрипта подхватывается как аннотация ошибки.
### Пять инвариантов валидации (реализовано)
1. Файл под `reports/` обязан лежать в `reports/<prefix>/<файл>.md`.
2. Новый отчёт: поле `source_prefix` совпадает с каталогом.
3. Автор из `prefixes.yml` пишет только в разрешённые префиксы.
4. Изменение чужого отчёта — только `status:` и `accepted_as:` (ack).
5. `prefixes.yml` и корневую документацию меняет только мейнтейнер (список `MAINTAINERS` захардкожен в скрипте — файл, определяющий права, не может определять сам себя).
### Что осталось по инбоксу
- [ ] Включить защиту ветки `master`: запрет прямого push (кроме мейнтейнера), запрет force-push, требование прохождения CI.
- [ ] **Негативный тест:** отчёт от имени не-мейнтейнера в чужой префикс → CI должен упасть. Сейчас проверен только «зелёный» путь.
- [ ] Добавить соавторов с Write для дочерних проектов, когда появятся их логины.
### Что осталось по VL-375 (код)
- `src/core/upstream-git.ts` — транспорт не написан.
- CLI `upstream report` в `mode: git`, подкоманды `pull` и `ack`.
- Расширение конфига: `upstream.mode`, `upstream.inbox`, `upstream.prefix`.
- Тесты на локальном git-фикстуре.
---
author: @agent
created: 2026-11-08 14:03
---
## Негативный тест пройден — валидация реально блокирует
Ручная проверка 2026-11-08 на реальном репозитории `Vibelog-md/upstream-reports`.
**Что сделано:** в `reports/ui/` положен отчёт с `source_prefix: vl` (каталог и поле не совпадают), запушен в `master`.
**Результат CI (run на коммите 6016cd5):**
```
[validate-paths] сравнение 077837e...6016cd5
Изменённые файлы:
A	reports/ui/2026-11-08-UI-1-negative-test.md
[validate-paths] автор «bobarev», разрешённые префиксы: vl
::error::source_prefix «vl» не совпадает с каталогом reports/ui/: reports/ui/2026-11-08-UI-1-negative-test.md
##[error]Process completed with exit code 1.
```
Job failed — как и требовалось. Откат сделан: `git revert --no-edit HEAD && git push` (коммит c54c30b).
### Важное подтверждение порядка проверок
Несогласованность `source_prefix` поймана **раньше**, чем проверка «мейнтейнер проходит без ограничений». То есть даже `bobarev` (мейнтейнер, есть в `MAINTAINERS`) не может положить отчёт в чужой каталог — структурные инварианты действуют на всех, привилегия мейнтейнера касается только выбора префикса.
Это ровно то поведение, которое нужно: привилегия не отменяет корректность данных.
### Что теперь проверено на практике
| Проверка | Как проверена |
|---|---|
| Workflow запускается на push | 5 прогонов (2040601, 2040625, + негативный, + revert, + первый) |
| `actions/checkout@v4` работает | лог checkout зелёный |
| Контекст `gitverse.*` читается | `ACTOR`/`BASE_SHA`/`HEAD_SHA` приходят в env |
| Валидация не падает на корректных данных | прогон 3 — success |
| Валидация ловит нарушение | негативный тест — failed с точным сообщением |
| Откат восстанавливает зелёное состояние | revert запушен (прогон на c54c30b) |
### Что осталось по инбоксу
- [ ] Убедиться, что прогон на revert-коммите `c54c30b` зелёный (последнее состояние `master` должно быть валидным).
- [ ] Включить защиту ветки `master` по рекомендации: белый список на push и merge (`bobarev`), запрет force-push и удаления ветки, обязательный CI `Validate report paths`, запрет слияния отстающих веток.
- [ ] Добавить логины дочерних проектов в `prefixes.yml` и как соавторов с Write — когда появятся.
- [ ] Проверить ветку `pull_request`: негативный тест гонялся только через push, PR-путь пока не проверен.
---
author: @agent
created: 2026-11-08 14:48
---
## Инбокс и CI готовы и проверены — этап инфраструктуры закрыт
Все проверки пройдены на реальном GitVerse. Дальше остаётся только код транспорта.
### Проверки защиты ветки (все успешны)
| Проверка | Команда | Результат |
|---|---|---|
| Force-push запрещён | `git push --force` | `remote: GitVerse: branch master is protected from force push` → `[remote rejected]` |
| Удаление ветки запрещено | `git push origin --delete master` | `remote: GitVerse: branch master is the default branch and cannot be deleted` → `[remote rejected]` |
| Негативный тест через push | отчёт в `reports/ui/` с `source_prefix: vl` | CI failed с `::error::source_prefix «vl» не совпадает с каталогом reports/ui/` |
| Негативный тест через PR | то же в ветке `test/pr-negative` | CI запустился (`event: pull_request`), failed с тем же сообщением |
| Откат восстанавливает зелёное | `git revert` + push | прогон на revert-коммите зелёный |
**Важно:** force-push блокируется pre-receive hook'ом для ВСЕХ, включая мейнтейнера. Историю отчётов нельзя переписать никому.
### Вскрытый и исправленный дефект: база сравнения в PR
PR-прогон (run_id 2041113) показал, что в контексте `pull_request` поле `gitverse.event.before` **не приходит вообще** (пустая строка), а не «нулевой SHA»:
```
env:
  ACTOR: bobarev
  BASE_SHA:                      ← пусто
  HEAD_SHA: 95367cd...
[validate-paths] первый push (base нулевой) — все файлы коммита 95367cd...
```
Последствие: в PR с несколькими коммитами проверился бы **только последний**, остальные прошли бы мимо валидации; проверка ack (`только status/accepted_as`) не работала бы вовсе.
**Исправление (закоммичено):** workflow передаёт вторую переменную `PR_BASE_SHA: ${{ gitverse.event.pull_request.base.sha }}`; скрипт выбирает непустую базу (`EFFECTIVE_BASE`), отдавая приоритет ненулевой.
### Полная карта контекста GitVerse (проверена на двух триггерах)
**push:**
- `gitverse.actor` — инициатор
- `gitverse.sha` — head-коммит
- `gitverse.event.before` — SHA до пуша; первый push → `0000...0`
- `gitverse.ref_name` — `master`
**pull_request:**
- `gitverse.actor` — инициатор (sender)
- `gitverse.sha` — head-ветка PR
- `gitverse.event.before` — **отсутствует**
- `gitverse.ref_name` — **номер PR** (`"1"`), не имя ветки
- `gitverse.head_ref` / `gitverse.base_ref` — ветки источника и цели
- `gitverse.event.pull_request.base.sha` — база
- `gitverse.event.pull_request.head.sha` — head
- `gitverse.event.pull_request.merge_base` — общий предок
**Общее:** `github.*` — алиас `gitverse.*`; `::error::<текст>` подхватывается как аннотация; раннер `ubuntu-latest` = `gitverse.ru/gitverse/runner-image:ubuntu-latest`, git 2.43.0, bash `-e -o pipefail`.
### Итоговое состояние инбокса
```
.gitverse/workflows/validate-paths.yml    # push + pull_request, база из двух полей
.gitverse/scripts/validate-paths.sh       # 5 инвариантов
prefixes.yml                              # bobarev: vl
README.md                                 # схема, формат, доступы
reports/vl/2026-11-08-VL-375-example.md   # образец
.gitignore
```
Защита ветки включена: белый список на push и merge, запрет force-push, запрет удаления, обязательный CI, запрет слияния отстающих.
### Что осталось (уже код, не инфраструктура)
- [ ] `src/core/upstream-git.ts` — транспорт: `ensureInboxClone`, `writeReport`, `listIncoming`, `ackReport`, `parseReport`/`serializeReport`, `slugify`, `reportId`
- [ ] CLI: `upstream report` в `mode: git`, подкоманды `pull` и `ack`
- [ ] Конфиг: `upstream.mode` / `upstream.inbox` / `upstream.prefix`
- [ ] Тесты на локальном git-фикстуре
- [ ] Добавить логины дочерних проектов в `prefixes.yml`, когда появятся
---
author: @agent
created: 2026-11-08 14:54
---
## Решения по реализации (приняты пользователем 2026-11-08)
### 1. Оба транспорта живут рядом, выбор — в конфиге
`mode: "git"` (дефолт) и `mode: "api"` остаются **оба**. `upstream_report_bug` (MCP-инструмент) не удаляется и уважает `mode`: при `git` идёт через ядро git-транспорта, при `api` — через существующий `gitverse-issues.ts`. Один инструмент, два бэкенда, переключение — полем конфига, без правки кода.
Секция `upstream` получает полный набор полей:
```json
{
  "upstream": {
    "mode": "git",
    "inbox": "git@gitverse.ru:Vibelog-md/upstream-reports.git",
    "prefix": "vl",
    "repo": "bobarev/Vibelog.md",
    "labels": ["upstream", "from-vl"],
    "type": "bug",
    "token_env": "GITVERSE_TOKEN"
  }
}
```
- `mode` отсутствует → `git` (работает сегодня; API Задач 2.0 закрыт, см. doc-29).
- Поля `repo`/`labels`/`type`/`token_env` читаются только при `mode: api`.
- Поля `inbox`/`prefix` — только при `mode: git`.
- Валидация `resolveUpstreamConfig` возвращает discriminated union: при `git` требует `inbox`, при `api` требует `repo`.
### 2. Источник истины формата отчёта — код
Выбран вариант **A + тест-паритет**:
- формат задаёт `serializeReport`/`parseReport` в `src/core/upstream-git.ts`;
- тест-паритет читает образец `reports/vl/2026-11-08-VL-375-example.md` из инбокса (или его копию в тест-фикстуре), парсит нашим `parseReport` и падает при расхождении полей — так README и код не разъедутся молча;
- JSON Schema (`report-schema.json`) **сознательно не вводим**: CI в инбоксе на bash проверяет только `source_prefix`, парсить JSON Schema на bash — неоправданная сложность. Апгрейд до схемы имеет смысл лишь если формат начнёт часто меняться или CI понадобится проверять структуру полей, а не один инвариант.
### Что из этого меняется в плане VL-375
- `resolveUpstreamConfig` — union-тип с `mode` (уже было в плане, теперь зафиксирован состав полей).
- `upstream_report_bug` в `src/mcp/tools.ts` — остаётся, тело обработчика ветвится по `mode`.
- В `src/core/upstream-git.test.mjs` добавляется тест-паритет формата с README/образцом.
- `src/core/gitverse-issues.ts` не трогается, кроме выноса общего `ReportBugInput` (если понадобится).
---
author: @agent
created: 2026-11-08 15:03
---
## Условная видимость `upstream_report_bug` (решение 2026-11-08)
Пользователь: если `upstream` не настроен, MCP-сервер **не должен показывать существование** инструмента.
### Техническое препятствие (проверено по коду)
`handleToolsList(id, send)` в `src/mcp/server.ts:189` не получает `cwd` — только `send`. При этом `cwd` доступен в `startMcpServer(cwd)` и уже передаётся в `handleToolsCall`. То есть для фильтрации его надо протащить в обработчик `tools/list`.
`listTools()` вызывается в 6 местах `src/`:
| Место | Роль вызова |
|---|---|
| `src/mcp/server.ts:192` | список для MCP-клиента ← фильтровать надо здесь |
| `src/cli/commands/doctor.ts:291` | диагностика (нужен полный набор) |
| `src/web/personas.ts:208` | валидация `allow_tools` персон (полный набор) |
| `src/web/tool-policy.ts:303` | `chatToolDefs()` — инструменты веб-чата |
| `src/core/tool-kinds.ts` | только в комментариях |
| тесты | паритет `tool-classify`, счётчик реестра, `write-ack-contract` |
### Выбранный вариант: фильтр в сервере, не в реестре
Рассмотрены три варианта:
- **A.** `listTools(cwd?)` — без аргумента всё, с аргументом фильтр. Обратно совместимо, но два поведения у одной функции.
- **B.** `listTools(cwd)` обязательный + `allTools()`. Явно, но ломает 4 вызова и все тесты паритета.
- **C. (выбран)** фильтр в `handleToolsList`, реестр не меняется.
**Почему C:** `listTools()` — это «что умеет система» (доктор, тесты, валидация персон, веб-чат). Видимость для конкретного проекта — политика сервера. Смешивать не стоит, и цена минимальна: одна строка в обработчике + предикат `isUpstreamConfigured(cwd)`.
### Что реализовать
1. `handleToolsList(id, cwd, send)` — сигнатура получает `cwd`; вызов в `startMcpServer` передаёт его.
2. Внутри:
   ```ts
   const tools = listTools().filter(
     (t) => t.name !== 'upstream_report_bug' || isUpstreamConfigured(cwd),
   );
   ```
3. `isUpstreamConfigured(cwd)` — новый экспорт (кладём в `src/core/gitverse-issues.ts` рядом с `resolveUpstreamConfig`): читает `loadSettings(cwd).upstream`, возвращает `true`, если секция есть и в ней валидный `mode` (`git` требует `inbox`, `api` требует `repo`). Ошибки чтения → `false` (fail-closed: не показывать инструмент, который всё равно не сработает).
4. `handleToolCall` для `upstream_report_bug` при ненастроенном `upstream` возвращает **не** «неизвестный инструмент», а `ackError` с actionable-подсказкой: «upstream не настроен — добавь секцию `upstream` в `.vibelog/settings.json` (`mode: git` + `inbox`, либо `mode: api` + `repo`)». Это закрывает случай устаревшего кэша списка инструментов у клиента.
5. Веб-чат (`chatToolDefs`) — тоже фильтрует по тому же предикату: в чате ненастроенный инструмент так же бессмысленен.
### Тесты
- MCP-клиент без секции `upstream` → `tools/list` **не содержит** `upstream_report_bug`.
- С валидной секцией (`mode: git` + `inbox`) → содержит.
- С невалидной секцией (нет `inbox` при `mode: git`) → не содержит (fail-closed).
- Прямой `tools/call` без секции → `ok:false` с подсказкой про `.vibelog/settings.json`, а не «Неизвестный инструмент».
- Тесты паритета (`tool-classify`, счётчик реестра, `write-ack-contract`) **не меняются** — они вызывают `listTools()` без `cwd` и видят полный реестр.
- `isUpstreamConfigured` — юнит-тесты на пустой проект, битый JSON, `mode: git` без `inbox`, `mode: api` без `repo`, валидные обе схемы.
### Влияние на план
Добавляется пункт в раздел 2 (конфиг) и в раздел 5 (тесты); правка `src/mcp/server.ts` — новая строка в «Затронутые файлы».
---
author: @agent
created: 2026-11-08 17:00
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/upstream-git.ts
- src/core/gitverse-issues.ts
- src/mcp/tools.ts
- src/mcp/server.ts
- src/web/tool-policy.ts
- src/cli/commands/upstream.ts
- src/cli/router.ts
- src/core/fixtures/reports/vl/2026-11-08-VL-375-example.md
- src/core/upstream-git.test.mjs
- src/mcp/upstream-tool.test.mjs
- I'll start by orienting in the project and checking the current state.
Now I'll write the core git transport module.
Now update reportBug to branch by mode:
Now server.ts — handleToolsList with cwd:
Now web tool-policy filter:
Now build to catch type errors.
Now update existing tests that assumed ap…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 825 с, payload 551723 байт_
Незакоммиченные изменения сохранены в ветку: коммит `48f215a`.
---
author: @agent
created: 2026-11-08 17:00
---
Фаза code не удалась (код выхода 1): окировок=2, payload последнего запроса=551723 байт (макс 551723), usage={"input_tokens":7893172,"output_tokens":77395,"cache_read_input_tokens":7118336,"total_tokens":7970567,"reasoning_tokens":43192} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-08 17:24
---
Фаза 3 (Code) выполнена. Коммит `66377ff` — feat: VL-375 — git-транспорт баг-репортов.
## Что сделано
**Ядро `src/core/upstream-git.ts` (новый, ~620 строк):**
- `ensureInboxClone` — клон в `.vibelog/upstream-inbox/` при отсутствии, `pull --rebase` при наличии; ошибки классифицируются (`config|network|auth|conflict|git`) в `UpstreamGitError` с `code` для CLI;
- `writeReport` — `reports/<prefix>/<дата>-<source_task>-<slug>.md`, `git add -- <путь>` ТОЛЬКО явным путём (есть `assertExplicitPath`: флаги, маски, `..` отсекаются), commit и push; идемпотентность по `report_id` (найден существующий → `created: false`);
- `listIncoming(cwd, targetPrefix)` — фильтр `target` + `status: open`, сортировка по `created`;
- `ackReport` — `replaceAckFields` меняет ровно две строки фронтматтера (`status`, `accepted_as`), остальное байт-в-байт; коммит одним явным путём;
- чистые функции: `slugify` (транслитерация кириллицы, результат строго `[a-z0-9-]`, пусто → `report`), `reportId` = sha1(source_project+source_task+title), `parseReport`/`serializeReport`, `reportRelPath`, `targetMatches`, `replaceAckFields`.
**Конфиг (`src/core/gitverse-issues.ts`):** `resolveUpstreamConfig` → discriminated union по `mode` (`git` по умолчанию требует `inbox`, `prefix` дефолтится из `task_prefix`; `api` требует `repo` + токен). Новый `isUpstreamConfigured(cwd)` — fail-closed. `reportBug` ветвится по `mode` и возвращает `{mode:'git'|'api', …}`.
**Условная видимость:** `handleToolsList(id, cwd, send)` фильтрует `upstream_report_bug`; `chatToolDefs` — тем же предикатом; прямой `tools/call` без секции → `ackError` с подсказкой про `.vibelog/settings.json`. `listTools()` не менялся — тесты паритета и счётчик реестра не тронуты (46 инструментов в реестре).
**CLI (`src/cli/commands/upstream.ts`, `src/cli/router.ts`):** `report` в обоих режимах с `--target`, новые `pull [--json] [--no-fetch]` и `ack <report_id> --as VL-N`. Коды выхода 0/1/2/3/4 сохранены, справка команды переписана под оба режима.
**Git-политика:** `.vibelog/.gitignore` и шаблон в `src/core/gitignore.ts` — добавлено `upstream-inbox/` (вложенный git-репозиторий, иначе виден untracked целиком).
## Тесты
- новый `src/core/upstream-git.test.mjs` (14 тестов) на локальном bare-репозитории: создание+коммит+push, «мусор в клоне не попадает в коммит», идемпотентность, `listIncoming`, ack меняет только два поля, клон/ошибка клона, slugify/reportId/round-trip, тест-паритет с образцом `src/core/fixtures/reports/vl/2026-11-08-VL-375-example.md`;
- `src/mcp/upstream-tool.test.mjs` — 5 кейсов видимости в `tools/list` (нет секции / git+inbox / api+repo / git без inbox / битый JSON) + вызов в mode git с реальной записью отчёта;
- `src/cli/upstream.test.mjs` — сквозной сценарий report→pull→ack на bare-инбоксе, mode api без токена → 4, pull без конфига → 2, ack без `--as` → 1;
- `src/core/gitverse-issues.test.mjs` — 7 новых кейсов union-конфига и `isUpstreamConfigured`;
- поправлены ожидания смежных тестов: `src/mcp/server.test.mjs` (счётчик tools/list), `src/web/tool-policy.test.mjs` (паритет chatToolDefs), `src/core/gitignore.test.mjs`.
**Полный прогон `pnpm build && pnpm test`: 199 файлов, 3753 passed, 4 skipped, 0 failed** (ничего не исключалось).
## Что осталось (не в этой фазе)
- AC12 в части документации: `CHANGELOG.md` и doc-28 — по правилам Фазы 3 не трогаются, пишет Фаза Close.
- Ручной CI-workflow валидации путей живёт в репозитории инбокса (вне этого репо) — по плану инфраструктура уже проверена.
- Не-ASCII в путях и конфликты параллельного push закрыты slugify-ом латиницей и текстом ошибки «разреши вручную в `.vibelog/upstream-inbox/`».
---
author: @agent
created: 2026-11-08 17:39
---
Фаза Close прервана: конфликт слияния vb/vl-375 → master в файле `src/mcp/upstream-tool.test.mjs` (UU, 1 блок конфликта в строках 27–35: master добавил `import { clearPhaseEnv } from '../test-env.mjs'` (VL-374), ветка VL-375 добавила `import { INBOX_DIR } from '../../dist/core/upstream-git.js'` + `import { testSpawnEnv } from '../test-env.mjs'` + `__dirname`/`cliPath`). Путь вне разрешённого множества (`CHANGELOG.md`, `backlog/docs/*`), поэтому резолв силами Close запрещён — правка тестового кода требует фазы Code.
Состояние: merge НЕ прерван (`git merge --abort` не выполнялся), главный репозиторий в состоянии незавершённого merge, конфликт UU в `src/mcp/upstream-tool.test.mjs`. Остальные 17 файлов ветки слиты автоматически без конфликтов.
Что нужно сделать, чтобы повторить Close: в главном репозитории разрешить конфликт в `src/mcp/upstream-tool.test.mjs`, оставив ОБА набора импортов и хелперов (из master — `clearPhaseEnv` для изоляции in-process `handleToolCall` по VL-374; из ветки — `INBOX_DIR`, `testSpawnEnv`, `__dirname`/`cliPath` для сквозных CLI-кейсов VL-375), затем `git add -- src/mcp/upstream-tool.test.mjs && git commit --no-edit`, прогнать `pnpm build && pnpm test` и запустить Фазу Close заново. Если конфликт требует содержательной переработки теста — сначала фаза Code в ветке vb/vl-375, затем повторный Close.
DoD, статус и документация не трогались (шаги 6–11 не выполнялись).
---
author: @agent
created: 2026-11-08 17:39
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-375 → master в файле `src/mcp/upstream-tool.test.mjs` (UU, 1 блок конфликта в строках 27–35: master добавил `import { clearPhaseEnv } from '../test-env.mjs'` (VL-374), ветка VL-375 добавила `import { INBOX_DIR } from '../../dist/core/upstream-git.js'` + `import { testSpawnEnv } from '../test-env.mjs'` + `__dirname`/`cliPath`). Путь вне разрешённого множества (`CHANGELOG.md`, `backlog/docs/*`), поэтому резолв силами Close запрещён — правка тестового код — статус возвращён к Review.
---
<!-- COMMENTS:END -->