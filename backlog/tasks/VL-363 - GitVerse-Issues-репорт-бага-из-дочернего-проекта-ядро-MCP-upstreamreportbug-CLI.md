---
id: VL-363
title: 'GitVerse Issues: репорт бага из дочернего проекта (ядро + MCP upstream_report_bug + CLI)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 20:11'
updated_date: '2026-11-07 21:43'
due_date: ''
labels:
  - gitverse
  - upstream
  - mcp
  - cli
  - bug-report
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
  - src/core/gitverse-issues.ts
  - src/core/gitverse-issues.test.mjs
  - src/core/tool-kinds.ts
  - src/mcp/tools.ts
  - src/mcp/upstream-tool.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/core/compat-full.test.mjs
  - src/cli/commands/upstream.ts
  - src/cli/upstream.test.mjs
  - src/cli/router.ts
  - src/cli/commands/doctor.ts
lessons: []
token_usage:
  input: 18222695
  output: 115019
  cache: 17907200
  total: 18337714
  requests: 192
  duration_ms: 1467435
  reasoning: 47577
  by_phase:
    code:
      input: 17306322
      output: 111724
      cache: 17039360
      requests: 170
    close:
      input: 916373
      output: 3295
      cache: 867840
      requests: 22
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Дочерние проекты Vibelog (`Vibelog-md/ui`, `Vibelog-md/templates`) — самостоятельные проекты со своими `backlog/` и своими агентами. Инструменты агента ограничены корнем проекта (`resolveInProject`, `ensureTaskWorktree`, `git_commit` отклоняет `cwd` вне проекта), поэтому дочерний агент физически не может завести задачу в родительском репозитории. Сейчас обход такой: агент дочернего проекта формулирует баг **промптом**, человек копирует его и передаёт в чат родительского проекта. Это ручной шаг, который надо убрать.

Решение — GitVerse Issues как транспорт. Работает между людьми, машинами и проектами, даёт номер issue как естественный ack и дедуп, симметрично в обе стороны (у `ui` могут быть свои баги — он читает их тем же механизмом).

Эта задача — **первая половина**: репорт (дочерний проект → issue). Импорт и закрытие — отдельной задачей.

## Что известно про API (проверено по документации, ref-26/ref-27/ref-28)

- Base URL: **`https://api.gitverse.ru`** (не `gitverse.ru`).
- Заголовки: `Authorization: Bearer <token>`, `Accept: application/vnd.gitverse.object+json;version=1`, для POST/PATCH ещё `Content-Type: application/json`.
- Создание: `POST /repos/{owner}/{repo}/issues`, тело `{title, body, type, labels[], assignees[], due_date, milestone, project_id, project_status_id}`. `title` обязателен, `type` ∈ `task|bug|story|epic`.
- **`labels` — массив строк, метки ДОЛЖНЫ уже существовать в репозитории**, иначе создание не сработает.
- Метки: `POST /repos/{owner}/{repo}/labels` `{name, color, description, exclusive}`, `name` ≤ 20 символов, ответ `201`. `GET /repos/{owner}/{repo}/labels` — список.
- Ошибки: общая форма `{"error": {code, message, documentation_url, status}}`; в разделе проектов встречается другая — `{"message": "...", "documentation_url": "..."}`. Парсер должен поддерживать обе.
- Токен: права **Запись** на репозиторий.

## Цель

Дочерний агент вызывает один MCP-инструмент и получает номер issue — копипаст промпта исчезает.

## Границы задачи

**Входит:** ядро HTTP-клиента, конфиг `upstream`, подготовка меток, MCP-инструмент репорта, CLI-команда, тесты, документация.

**Не входит:** импорт issues в задачи Vibelog, ack-комментарий, закрытие issue (перемещение в колонку Done) — отдельная задача.

## Затронутые файлы

- `src/core/gitverse-issues.ts` (новый) — HTTP-клиент.
- `src/core/tool-kinds.ts` — строка для нового инструмента (`write`), иначе упадёт тест паритета `tool-classify.test.mjs`.
- `src/mcp/tools.ts` — регистрация инструмента (счётчик реестра 45 → 46, обновить тесты `compat-full`/`server`/`reference-tools`/`documents`/`diagnostics`).
- `src/cli/commands/upstream.ts` (новый) + `src/cli/router.ts`.
- `src/core/settings.ts` — секция `upstream` (read-modify-write, чужие секции не трогать).
- `CHANGELOG.md`, doc-7 (CLI), doc-8 (MCP).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `src/core/gitverse-issues.ts` — HTTP-клиент: `createIssue(cfg, {title, body, type, labels})` → `{number, html_url, id}`; `listLabels(cfg)`; `ensureLabels(cfg, names)` (создаёт отсутствующие, идемпотентно); `listIssues(cfg, query)` (нужен следующей задаче, но закладывается сразу). Базовый URL `https://api.gitverse.ru`, заголовки `Authorization: Bearer`, `Accept: application/vnd.gitverse.object+json;version=1`, `Content-Type: application/json` для POST
- [x] #2 Ошибки: `GitverseError` с `code` (exit-код CLI), `kind` (`unauthorized|forbidden|not_found|bad_request|server|network|timeout|invalid_json`), `status`, `url`, `attempts`. Парсер понимает ОБЕ формы тела ошибки: `{error:{code,message,status}}` и `{message,documentation_url}`. Ретраи только на 5xx и сетевые ошибки (2 повтора, паузы 500/1500 мс), таймаут 30 с через `AbortController` с `clearTimeout` в `finally`
- [x] #3 Токен читается из `.env` в корне проекта по имени **`GITVERSE_TOKEN`** (приоритет shell env → `.env`, через существующий `loadDotEnv`). Имя зафиксировано константой `GITVERSE_TOKEN_ENV = 'GITVERSE_TOKEN'` и переопределяется полем `token_env` в секции `upstream` (для нестандартных случаев). Отсутствие токена → ошибка `kind:'no_token'` с подсказкой «добавь GITVERSE_TOKEN=<токен> в .env (создать: https://gitverse.ru/settings/tokens, права: Запись на репозиторий)»
- [x] #4 Токен НЕ попадает в сообщения об ошибках, логи и ack-ответ (маскирование через `maskToken`). Тест: текст ошибки с токеном внутри не содержит его после обработки
- [x] #5 Конфиг: секция `upstream` в `.vibelog/settings.json` — `{repo: "owner/name", token_env?: "GITVERSE_TOKEN", labels: [...], type: "bug", project_id?, done_column?}`. `token_env` опционален, дефолт `GITVERSE_TOKEN`. Чтение через `loadSettings`, запись — read-modify-write (чужие секции `chats`/`models`/`providers`/`components` сохраняются байт-в-байт). Отсутствие секции → понятная ошибка с подсказкой, как настроить
- [x] #6 MCP-инструмент `upstream_report_bug` (write): аргументы `title` (обязателен), `body`, `severity`, `area`, `source_task`, `labels?`. Возвращает JSON-ack по контракту VL-306: `{ok:true, applied:{number, url, labels}, message}` либо `{ok:false, error, hint}`. Строка добавлена в `TOOL_KINDS` как `write` (иначе падает тест паритета `tool-classify.test.mjs`)
- [x] #7 Метки подготавливаются автоматически: перед созданием issue `ensureLabels` проверяет `GET /labels` и создаёт отсутствующие (`upstream`, `from-<prefix>`). Повторный вызов не создаёт дублей и не падает на уже существующей метке
- [x] #8 CLI `vibelog upstream report --title <t> [--body <b>|--body-file <f>] [--severity s] [--area a] [--source-task ID] [--label l] [--json]` — тот же путь, что MCP-инструмент; коды выхода: `0` успех, `1` использование, `2` конфиг не настроен, `3` сеть/данные, `4` нет токена. Регистрация в `src/cli/router.ts` + строка в общей справке + `showCommandHelp('upstream')`
- [x] #9 Тесты `src/core/gitverse-issues.test.mjs` на локальном `node:http`-фикстуре (приём из `registry-fetch.test.mjs`): успешное создание issue, создание метки при отсутствии, отсутствие дубля метки, 401 → `unauthorized` без ретраев, 500 дважды затем 200 (проверка числа обращений), таймаут, обе формы тела ошибки, отсутствие токена (`GITVERSE_TOKEN` не задан), отсутствие секции `upstream`, маскирование токена в тексте ошибки
- [x] #10 Тест MCP-инструмента: `upstream_report_bug` зарегистрирован в `listTools()`, объявлен как `write` в `TOOL_KINDS`, успешный вызов возвращает `ok:true` с номером issue, ошибка конфига возвращает `ok:false` с подсказкой. Счётчик реестра MCP обновлён (45 → 46) во всех тестах, где он проверяется
- [ ] #11 `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md, doc-7 (раздел `upstream`), doc-8 (раздел `upstream_report_bug`) обновлены; в doc-6/doc-7 зафиксировано, что токен кладётся в `.env` как `GITVERSE_TOKEN`
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

### 0. Токен — `GITVERSE_TOKEN` в `.env`

Имя зафиксировано: **`GITVERSE_TOKEN`**. Кладётся в `.env` в корне проекта (файл в `.gitignore`, секреты только там — правило VL-329).

```
GITVERSE_TOKEN=<токен из https://gitverse.ru/settings/tokens>
```

Права токена: **Запись** на репозиторий (для создания issues и меток). Для чтения достаточно **Чтения**.

В коде:
- константа `GITVERSE_TOKEN_ENV = 'GITVERSE_TOKEN'` в `src/core/gitverse-issues.ts`;
- чтение — через существующий `loadDotEnv` (приоритет shell env → `.env`), как это делает `src/bot/env.ts`;
- поле `token_env` в секции `upstream` опционально и переопределяет имя (для нестандартных случаев, например отдельный токен на другой репозиторий);
- отсутствие токена → `kind:'no_token'`, текст: «добавь `GITVERSE_TOKEN=<токен>` в `.env` (создать: https://gitverse.ru/settings/tokens, права: Запись на репозиторий)»;
- токен маскируется в любом тексте ошибки (`maskToken`), в ack не попадает.

### 1. Ядро `src/core/gitverse-issues.ts` (новый)

По образцу `src/core/registry-fetch.ts` (VL-335), но с другим хостом и JSON-контрактом. **Не переиспользовать `registry-fetch` напрямую** — там `gitverse.ru/api/repos/.../raw/...`, `text/plain` и 400-вместо-404; общими остаются только приёмы.

```
DEFAULT_API_BASE = 'https://api.gitverse.ru'
API_BASE_ENV = 'VIBELOG_GITVERSE_API_BASE'   // подмена базы для тестов
GITVERSE_TOKEN_ENV = 'GITVERSE_TOKEN'
ACCEPT = 'application/vnd.gitverse.object+json;version=1'
REQUEST_TIMEOUT_MS = 30_000
RETRY_DELAYS_MS = [500, 1500]
```

Функции:
- `resolveUpstreamConfig(cwd)` → `{repo, owner, name, token, labels, type, projectId?, doneColumn?}`; читает секцию `upstream` из `loadSettings`, токен — из env по `token_env ?? GITVERSE_TOKEN_ENV` (через `loadDotEnv`). Ошибки: нет секции → `kind:'config'` с подсказкой; нет токена → `kind:'no_token'`.
- `createIssue(cfg, {title, body, type, labels})` → `{number, id, html_url}`.
- `listLabels(cfg)` → `string[]`.
- `ensureLabels(cfg, names)` → `{created: string[], existing: string[]}` — идемпотентно.
- `listIssues(cfg, query)` → `{issues, hasMore}` — закладывается сразу для следующей задачи (пагинация по `Link`).
- `parseGitverseError(status, bodyText)` — чистая функция, поддерживает обе формы (`{error:{...}}` и `{message,...}`), тестируется без сети.
- `maskToken(text, token)` — вырезает токен из любого текста ошибки.

Транспорт: `undici` `fetch` + `AbortController`, таймер гасится в `finally`; тело читается с лимитом (1 МБ достаточно для issues); ретраи только 5xx и сетевые.

### 2. Конфиг

Секция в `.vibelog/settings.json`:

```json
{
  "upstream": {
    "repo": "bobarev/Vibelog.md",
    "labels": ["upstream", "from-ui"],
    "type": "bug",
    "project_id": 42,
    "done_column": "Done"
  }
}
```

`token_env` не указан — используется `GITVERSE_TOKEN`. `project_id`/`done_column` в этой задаче только читаются и валидируются — используются следующей (закрытие). Запись секции — через `saveSettingsPatch` (read-modify-write, чужие секции не трогаются).

### 3. MCP-инструмент `upstream_report_bug`

В `src/mcp/tools.ts` рядом с `git_commit`. Схема: `title` (required), `body`, `severity`, `area`, `source_task`, `labels`. Тело issue собирается детерминированно из полей (секции «Что произошло», «Воспроизведение», «Окружение», «Источник»), а не отдаётся на волю модели — иначе формат поедет.

Ответ — JSON-ack по контракту VL-306 (`ackOk`/`ackError`).

**Обязательно:** строка `upstream_report_bug: 'write'` в `src/core/tool-kinds.ts` — иначе `tool-classify.test.mjs` упадёт на паритете.

### 4. CLI `vibelog upstream report`

`src/cli/commands/upstream.ts` + `case 'upstream'` в `router.ts` + строка справки + `showCommandHelp`. Коды: `0` успех, `1` использование, `2` конфиг, `3` сеть/данные, `4` нет токена. `--json` печатает ack как есть.

### 5. Тесты

`src/core/gitverse-issues.test.mjs` на локальном `node:http`-фикстуре (приём `registry-fetch.test.mjs`, 36 кейсов — образец). Обязательные кейсы перечислены в AC. Отдельно — тест паритета `tool-classify` (существующий, должен пройти после добавления строки) и тест реестра MCP (счётчик 45 → 46).

### 6. Документация

CHANGELOG, doc-7 (раздел `upstream`), doc-8 (раздел `upstream_report_bug`). В doc-7 — как положить `GITVERSE_TOKEN` в `.env` и какие права нужны токену.

### Проверка

`pnpm build && pnpm test` (полный прогон, AGENTS.md). Ручная проверка: положить `GITVERSE_TOKEN` в `.env`, выполнить `vibelog upstream report --title "тест" --body "..."` на реальном репозитории.

### Риски

- **Токен в дочернем проекте.** Если репортить напрямую в `bobarev/Vibelog.md`, токен с правом записи в чужой репозиторий лежит в каждом дочернем проекте. Безопаснее: репортить в **свой** репозиторий (`Vibelog-md/ui`), а родитель читает оттуда. Решение принимается при настройке (поле `repo`), код поддерживает оба варианта.
- **Версия `vibelog` в дочернем проекте.** Инструмент появится только после обновления глобального пакета — до этого работает CLI-фолбэк.
- **Сеть в фазе Code.** `upstream_report_bug` — сетевой write; в фазе должен быть разрешён явно, иначе агент упрётся в политику инструментов.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 21:27
---
Фаза code не удалась (код выхода 1): окировок=1, payload последнего запроса=544140 байт (макс 544140), usage={"input_tokens":7007813,"output_tokens":52126,"cache_read_input_tokens":6883840,"total_tokens":7059939,"reasoning_tokens":22710} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 21:35
---
Фаза 3 (Code) выполнена. Коммит a5fb41e.
**Ядро** `src/core/gitverse-issues.ts` (новый): `DEFAULT_API_BASE=https://api.gitverse.ru`, `ACCEPT=application/vnd.gitverse.object+json;version=1`, `GITVERSE_TOKEN_ENV`, `API_BASE_ENV` (подмена базы для тестов), таймаут 30 с через `AbortController` с `clearTimeout` в `finally`, ретраи только 5xx/сетевые (2 повтора, 500/1500 мс), лимит тела 1 МБ. Функции: `createIssue` → `{number, id, html_url}`, `listLabels`, `ensureLabels` (идемпотентно, лимит имени 20 символов), `listIssues` (пагинация по `Link`), `parseGitverseError` (обе формы тела: `{error:{...}}` и `{message,documentation_url}`), `maskToken`, `resolveUpstreamConfig`, `saveUpstreamConfig` (read-modify-write через `saveSettingsPatch`), `buildIssueBody` (детерминированные секции), `reportBug` (общий путь MCP+CLI).
**Ошибки**: `GitverseError` с `code` (2 — конфиг, 3 — сеть/данные, 4 — нет токена), `kind` (unauthorized|forbidden|not_found|bad_request|server|network|timeout|invalid_json|config|no_token), `status`, `url`, `attempts`. Токен маскируется во всех текстах ошибок и не попадает в ack.
**Токен**: `GITVERSE_TOKEN` из `.env` (приоритет shell env → `.env`, через `readEnvFile` из core — без затягивания bot-слоя), переопределяется полем `token_env`. Нет токена → `kind:'no_token'` с подсказкой про `.env` и https://gitverse.ru/settings/tokens.
**MCP** `upstream_report_bug` (write): аргументы `title` (required), `body`, `severity`, `area`, `source_task`, `labels?`; ответ — JSON-ack VL-306 (`ok:true` + `applied:{number,url,labels}` либо `ok:false` + `error`/`hint`). Строка `upstream_report_bug: 'write'` добавлена в `TOOL_KINDS`.
**CLI** `vibelog upstream report --title <t> [--body|--body-file] [--severity] [--area] [--source-task] [--label] [--json]` + `case 'upstream'` в router, строка общей справки, `showCommandHelp('upstream')`. Коды 0/1/2/3/4.
**Тесты**: `src/core/gitverse-issues.test.mjs` (34 кейса на `node:http`-фикстуре: создание issue, метки/идемпотентность, 401 без ретраев, 500×2→200 с проверкой числа обращений, таймаут, обе формы ошибки, нет токена, нет секции upstream, маскирование токена, listIssues+Link, reportBug), `src/mcp/upstream-tool.test.mjs` (6 кейсов: регистрация, write-вид, успех, ошибки конфига/токена/title), `src/cli/upstream.test.mjs` (6 кейсов: коды 0/1/2/4, --help). Счётчик реестра MCP обновлён 45 → 46 в `compat-full`/`server`/`reference-tools`/`documents`; `write-ack-contract` дополнен (covered/NOOP_NOT_APPLICABLE/PARTIAL_EXEMPT); в `doctor.ts` в `MCP_TOOL_PREFIXES` добавлен префикс `upstream_` (иначе падал инвариант реестра).
**Проверки**: `pnpm build` — чисто; `pnpm test` — полный прогон зелёный: 192 файла, 3594 passed, 4 skipped, 0 failed.
**Что осталось (вне границ задачи)**: CHANGELOG.md, doc-7 (раздел `upstream`), doc-8 (раздел `upstream_report_bug`) — по правилам фазы Code документацию пишет Close. Импорт issues в задачи Vibelog, ack-комментарий и закрытие issue — отдельная задача. Ручная проверка на реальном репозитории требует `GITVERSE_TOKEN` в `.env` (в фазе Code не выполнялась — сеть/секрет).
---
author: @agent
created: 2026-11-07 21:43
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 10 из 11
DoD отмечено: 2 из 3
AC не отмечены (1): 11. `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md, doc-7 (раздел `upstream`), doc-8 (раздел `upstream_report_bug`) обновлены; в doc-6/doc-7 зафиксировано, что токен кладётся в `.env` как `GITVERSE_TOKEN`
DoD не отмечены (1): 2. Документация обновлена
Файлы (14): src/core/gitverse-issues.ts, src/core/gitverse-issues.test.mjs, src/core/tool-kinds.ts, src/mcp/tools.ts, src/mcp/upstream-tool.test.mjs, src/mcp/write-ack-contract.test.mjs, src/mcp/documents.test.mjs, src/mcp/reference-tools.test.mjs, src/mcp/server.test.mjs, src/core/compat-full.test.mjs, …
Фрагмент плана: ## План ### 0. Токен — `GITVERSE_TOKEN` в `.env` Имя зафиксировано: **`GITVERSE_TOKEN`**. Кладётся в `.env` в корне проекта (файл в `.gitignore`, секреты только там — правило VL-329). ``` GITVERSE_TOKEN=<токен из https://gitverse.ru/settings/tokens> ``` Права токена: **Запись** на репозиторий (для с…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #11) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
<!-- COMMENTS:END -->