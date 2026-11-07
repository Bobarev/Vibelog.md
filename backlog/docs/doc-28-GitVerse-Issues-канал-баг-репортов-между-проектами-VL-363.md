---
id: doc-28
title: 'GitVerse Issues: канал баг-репортов между проектами (VL-363)'
type: guide
created_date: 2026-11-07
tags:
  - gitverse
  - upstream
  - bug-report
  - mcp
  - cli
  - vl-363
---
# GitVerse Issues: канал баг-репортов между проектами (VL-363)

Документ описывает транспорт баг-репортов из дочерних проектов Vibelog (`Vibelog-md/ui`, `Vibelog-md/templates`) в родительский через Публичный API GitVerse. Реализовано в VL-363 (репорт); импорт и закрытие — следующая задача.

---

## 1. Зачем

Дочерние проекты — самостоятельные проекты Vibelog со своими `backlog/` и своими агентами. Инструменты агента ограничены корнем проекта:

- `resolveInProject` не пускает за пределы проекта;
- `ensureTaskWorktree` создаёт worktree только внутри проекта;
- `git_commit` отклоняет `cwd` вне проекта.

Поэтому агент `ui` физически не может завести задачу в `backlog/` родителя. Прежний обход — «сформулируй баг промптом, человек скопирует и передаст» — ручной шаг, который и устраняет этот канал.

GitVerse Issues выбран как транспорт, потому что он:

- работает между людьми, машинами и проектами (не требует общей файловой системы);
- даёт **номер issue как естественный ack** — дочерний агент сразу знает, что репорт принят;
- даёт **дедуп по номеру** — повторный репорт виден;
- симметричен: у `ui` могут быть свои баги, он читает их тем же механизмом.

---

## 2. Настройка

### 2.1. Токен

Токен кладётся в `.env` в корне проекта (файл в `.gitignore`, секреты только там — правило VL-329):

```
GITVERSE_TOKEN=<токен>
```

Создать: https://gitverse.ru/settings/tokens (показывается один раз). Права: **Запись** на репозиторий — для создания issues и меток; для чтения достаточно **Чтения**.

Приоритет чтения: shell env → `.env`. Имя переменной зафиксировано константой `GITVERSE_TOKEN_ENV` и переопределяется полем `token_env` в секции `upstream` (для нестандартных случаев — например, отдельный токен на другой репозиторий).

Токен **никогда** не попадает в текст ошибки или ack — маскируется функцией `maskToken`.

### 2.2. Секция `upstream` в `.vibelog/settings.json`

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

| Поле | Обязательно | Описание |
|---|---|---|
| `repo` | ✓ | Репозиторий-получатель в формате `owner/name` |
| `labels` | | Метки issue. По умолчанию `upstream` + `from-<prefix>`, где prefix — `task_prefix` из `backlog/config.yml` |
| `type` | | `task` \| `bug` \| `story` \| `epic`. По умолчанию `bug` |
| `token_env` | | Имя переменной с токеном. По умолчанию `GITVERSE_TOKEN` |
| `project_id` | | id проекта GitVerse (Kanban). Нужен для закрытия — следующая задача |
| `done_column` | | Имя колонки «Done». Нужен для закрытия — следующая задача |

Запись секции — read-modify-write через `saveSettingsPatch`: чужие секции (`chats`, `models`, `providers`, `components`) сохраняются байт-в-байт.

### 2.3. Куда репортить

Два варианта, выбор — при настройке:

- **В свой репозиторий** (`Vibelog-md/ui` → issues в `Vibelog-md/ui`): токен нужен только на запись в свой репозиторий, родитель читает оттуда. Безопаснее.
- **Напрямую в родительский** (`repo: bobarev/Vibelog.md`): проще, но токен с правом записи в чужой репозиторий лежит в каждом дочернем проекте.

Код поддерживает оба — разница только в значении `repo`.

---

## 3. MCP-инструмент `upstream_report_bug`

Write-инструмент (`TOOL_KINDS` → `write`), требует Allow/Deny в веб-чате.

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок issue, непустой |
| `body` | string | | Что произошло: описание, шаги, ожидаемое поведение |
| `severity` | string | | `low` \| `medium` \| `high` \| `critical` — попадает в «Окружение» |
| `area` | string | | `cli` \| `mcp` \| `web` \| `agent` \| `install` \| … — попадает в «Окружение» |
| `source_task` | string | | ID задачи проекта-источника (например `UI-12`) — секция «Источник» |
| `labels` | string[] | | Дополнительные метки поверх `upstream.labels` |

Ответ — JSON-ack по контракту VL-306:

```json
{ "ok": true, "applied": { "number": 42, "url": "https://gitverse.ru/…/issues/42", "labels": ["upstream","from-ui"] },
  "message": "Issue #42 создан: …" }
```

Ошибка:

```json
{ "ok": false, "error": "секция upstream не настроена — добавь в .vibelog/settings.json секцию upstream: …",
  "hint": "…" }
```

### Тело issue собирается детерминированно

Не отдаётся на волю модели — иначе формат поедет от вызова к вызову, и импорт на принимающей стороне не сможет разобрать секции. Функция `buildIssueBody` формирует фиксированные разделы:

```markdown
## Что произошло
<текст body или title>

## Воспроизведение
1. Открыть проект и выполнить действие, описанное выше.
2. Наблюдать поведение из раздела «Что произошло».

## Окружение
- severity: high
- area: mcp
- vibelog: 1.14.0

## Источник
- проект: Vibelog UI
- задача: UI-12
- отчёт создан автоматически (vibelog upstream report)
```

---

## 4. CLI `vibelog upstream report`

Тот же путь, что MCP-инструмент (общая функция `reportBug`) — формат тела и ack не расходятся. Нужен, когда в дочернем проекте глобальный пакет `vibelog` старой версии и MCP-инструмента ещё нет.

```
vibelog upstream report --title <t> [--body <b>|--body-file <f>] [--severity s] [--area a] [--source-task ID] [--label l] [--json]
```

| Флаг | Назначение |
|---|---|
| `--title <t>` | Заголовок issue (обязателен) |
| `--body <b>` | Что произошло |
| `--body-file <f>` | То же из файла (`--body` приоритетнее) |
| `--severity <s>` | `low` \| `medium` \| `high` \| `critical` |
| `--area <a>` | `cli` \| `mcp` \| `web` \| `agent` \| `install` \| … |
| `--source-task <ID>` | ID задачи проекта-источника |
| `--label <l>` | Дополнительная метка (можно повторять) |
| `--json` | ack как есть (контракт VL-306) |

Коды выхода: `0` — успех, `1` — использование, `2` — конфиг не настроен, `3` — сеть/данные, `4` — нет токена.

---

## 5. Публичный API GitVerse — что нужно знать

Полные конспекты — в reference: **ref-26** (общая информация), **ref-27** (issues и метки), **ref-28** (проекты и колонки).

### 5.1. База и заголовки

- Base URL: **`https://api.gitverse.ru`** — не `gitverse.ru`.
- `Authorization: Bearer <token>`
- `Accept: application/vnd.gitverse.object+json;version=1`
- `Content-Type: application/json` — для POST/PATCH.

### 5.2. Создание задачи

`POST /repos/{owner}/{repo}/issues`

```json
{ "title": "…", "body": "…", "type": "bug", "labels": ["upstream"] }
```

`title` обязателен. `type` ∈ `task|bug|story|epic`. **`labels` — массив строк, метки должны уже существовать в репозитории.**

### 5.3. Метки

`POST /repos/{owner}/{repo}/labels` — `{name, color, description, exclusive}`, `name` ≤ 20 символов, ответ `201`.
`GET /repos/{owner}/{repo}/labels` — список. Пагинация: `page`, **`limit`** (по умолчанию 30) и `sort`; параметра `per_page` у этого эндпоинта НЕТ — GitVerse отвечает `400 VALIDATION_ERROR` на неизвестный query-параметр (VL-367). У `GET /issues` — наоборот, `per_page`; имена параметров у эндпоинтов разные.

Перед созданием issue `ensureLabels` проверяет список и создаёт отсутствующие — идемпотентно, дублей не появляется.

### 5.4. Ошибки

Две формы, обе поддерживаются парсером:

```json
{ "error": { "code": "BAD_REQUEST", "message": "…", "documentation_url": "…", "status": 400 } }
```

```json
{ "message": "Not Found", "documentation_url": "…" }
```

Вторая встречается в разделе проектов. Ответы с ошибками не содержат диагностики — только машиночитаемый код и краткое сообщение.

### 5.5. Пагинация

Параметры `page` и `per_page` (максимум 100), навигация — заголовок `Link` с `rel="next"|"prev"|"first"|"last"`. Ходить по URL из `Link`, а не собирать параметры вручную.

---

## 6. Устойчивость

| Механизм | Поведение |
|---|---|
| Таймаут | 30 с через `AbortController`, таймер гасится в `finally` |
| Ретраи | Только 5xx и сетевые ошибки: 2 повтора, паузы 500/1500 мс. 4xx не повторяются |
| Лимит тела | 1 МБ — защита от подмены ответа |
| Маскирование | Токен вырезается из любого текста ошибки |
| Подмена базы | `VIBELOG_GITVERSE_API_BASE` — для тестов на локальном `node:http`-фикстуре |

---

## 7. Проверка

```bash
# 1. Токен жив и есть права
curl -s -H "Authorization: Bearer $(grep GITVERSE_TOKEN .env | cut -d= -f2)" \
  -H "Accept: application/vnd.gitverse.object+json;version=1" \
  "https://api.gitverse.ru/repos/bobarev/Vibelog.md/labels" | head -c 300

# 2. Реальный репорт
vibelog upstream report \
  --title "Проверка канала баг-репортов" \
  --body "Тестовый issue. Если видишь его — канал работает." \
  --severity low --area mcp --source-task VL-363

# 3. Тесты
pnpm test src/core/gitverse-issues.test.mjs src/mcp/upstream-tool.test.mjs src/cli/upstream.test.mjs
```

Ожидается: `Issue #N создан: …`, код выхода `0`, issue виден на `https://gitverse.ru/<owner>/<repo>/issues` с метками и разложенным по секциям телом.

---

## 8. Что дальше (следующая задача)

- **Импорт:** `GET /repos/{o}/{r}/issues?labels=upstream&state=open&per_page=100` → дедуп по номеру в локальном журнале → создание задачи Vibelog.
- **Ack:** `POST /repos/{o}/{r}/issues/{n}/comments` с номером созданной задачи — дочерний агент видит «принято как VL-N».
- **Закрытие:** `PATCH /repos/{o}/{r}/issues/{n}` с `{project_id, project_status_id}` колонки «Done». Поле `state` для задачи **игнорируется** — состояние определяется колонкой проекта (ref-28).
