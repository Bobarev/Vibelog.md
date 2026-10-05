# Агент Vibelog (vibelog-agent)

Собственный LLM-агент Vibelog — headless-замена Qwen Code в фазах оркестратора (spec / plan / code / close / comment / prompt) и интерактивный TUI-исполнитель для терминала.

Документ описывает **фактическое поведение кода** (`src/agent/*`, `bin/vibelog-agent.mjs`) на 2026-10-05 (VL-83..86, эпик VL-75).

## 1. Назначение и мотивация

Оригинальный оркестратор запускал headless-сессии **Qwen Code** (`@qwen-code/qwen-code` 0.24.7 — база агента, см. VL-77/doc-3 §12). Это работало, но расход токенов на типовых фазах был большим:

- Фаза Comment (обычный комментарий к задаче) — до **96k** токенов;
- Фаза Spec (разбор фичи на задачи) — до **935k** токенов.

Причины: полный CLI qwen со своей системной инструкцией, плагинами и MCP-обвязкой на каждую фазу. Агент Vibelog решает это минимальным tool-calling loop без «вагона» промпта.

**Зачем свой агент, а не просто `--model`:**

- Полный контроль над лимитами (tool-calls, wall-time) и loop detection — см. §6.
- Headless-контракт stdout совместим с `parseQwenResult` (`src/web/qwen-result.ts`) — оркестратор и бот не менялись (decision-5).
- LLM — любой OpenAI-совместимый endpoint (Cloud.ru по умолчанию) через свои env.
- Работает на macOS 10.15 Catalina: без нативных модулей (TUI — Ink 7.0.3, yoga-layout WASM).

**Решения по агенту** (backlog/decisions/, статус proposed на 2026-10-05):

| Решение | Суть |
|---|---|
| decision-1 | MCP-клиент минимальный самописный (без typescript-sdk) |
| decision-2 | TUI на Ink (кандидат — официальный 7.0.3, реализован в VL-86) |
| decision-3 | LLM-клиент Cloud.ru через fetch (undici-штатный Node 20), без openai-SDK |
| decision-4 | Loop detection + двойной предел (tool-calls / wall-time), дедупликация вызовов |
| decision-5 | Headless: stdout — JSON `type=result`, формат parseQwenResult; qwen-фолбэк сохранён |

## 2. Установка и настройка

### Требования

- **Node.js 20+** (нужен глобальный `fetch` для LLM-клиента).
- Собранный `dist/`: бинарь `bin/vibelog-agent.mjs` импортирует `dist/agent/cli.js`.

```bash
pnpm install
pnpm build
```

### LLM (Cloud.ru)

Агенту нужен доступ к LLM. Три переменные окружения:

| Переменная | Обязательна | Назначение |
|---|---|---|
| `VIBELOG_LLM_API_KEY` | да | API-ключ (без него агент отказывается стартовать) |
| `VIBELOG_LLM_MODEL` | да | Имя модели (без неё агент отказывается стартовать) |
| `VIBELOG_LLM_BASE_URL` | нет | Endpoint; дефолт — `https://foundation-models.api.cloud.ru/v1` (decision-3) |

Пример в shell:

```bash
export VIBELOG_LLM_BASE_URL="https://foundation-models.api.cloud.ru/v1"
export VIBELOG_LLM_API_KEY="sk-..."
export VIBELOG_LLM_MODEL="your-model-name"
```

Пример `.env` (загружается вручную или через оболочку, агент сам `.env` не читает):

```
VIBELOG_LLM_BASE_URL=https://foundation-models.api.cloud.ru/v1
VIBELOG_LLM_API_KEY=sk-...
VIBELOG_LLM_MODEL=your-model-name
```

## 3. Запуск

### Синтаксис

```bash
# Фаза: промпт собирается из шаблона templates/qwen-commands/phase-<N>.md
vibelog-agent <phase> <taskId> [--comment "<текст>"]

# Готовый промпт (qwen-совместимый сценарий: один позиционный аргумент)
vibelog-agent "<промпт целиком>"

# Справка
vibelog-agent --help
```

`<phase>` — spec | plan | code | close | comment | prompt. Шаблоны фаз лежат в `templates/qwen-commands/`; в них подставляются `{{taskId}}` и `{{comment}}` (пустая строка, если `--comment` не задан — в шаблонах есть инструкция об этом). Фаза `prompt` — шаблон промпта без требований к Vibelog MCP.

### Режимы

- **Интерактивный (TUI):** stdout — TTY, нет `--headless`/`--output-format json`, фаза ≠ `prompt`, нет `--no-tui`. TUI рендерится **на stderr** в альтернативном буфере терминала: посимвольный стриминг текста модели, карточки tool calls (имя, аргументы с обрезкой, статус ⏳/✅/❌, длительность), счётчики (ход, токены in/out/cache, время фазы), блок ошибок. Поведение stdout не меняется — контракт оркестратора сохраняется.
- **Headless:** `--headless`, либо `--output-format json` (qwen-совместимость), либо не-TTY stdout. В stdout — ровно одна JSON-строка (см. §4), прогресс/логи — в stderr.

### Флаги

| Флаг | Дефолт | Назначение |
|---|---|---|
| `--headless` | без TTY | JSON-результат в stdout |
| `--comment <текст>` | `""` | Комментарий пользователя к фазе (`{{comment}}`) |
| `--no-mcp` | выкл. | Не подключать MCP-инструменты Vibelog |
| `--no-tui` | выкл. | Отключить TUI в интерактивном режиме (отладка) |
| `--max-tool-calls <N>` | 100 | Лимит tool-calls фазы |
| `--max-wall-time <сек>` | 900 | Лимит времени фазы (wall-time) |
| `--resume <sessionId>` | — | Продолжить сохранённую сессию (VL-95; префикс `vb:` игнорируется) |
| `--continue` | — | Продолжить последнюю сессию текущего каталога (VL-95) |
| `--help` | — | Справка |

**Qwen-совместимые флаги** (принимаются и игнорируются либо приравниваются): `--approval-mode <...>`, `--output-format json` (приравнен к `--headless` — оркестратор шлёт этот флаг всем фазам), `--allowed-mcp-server-names <...>`. Это позволяет подставить агент вместо qwen без правок шаблонов фаз.

## 3.1. Сессии (VL-95)

Каждый запуск агента сохраняет транскрипт диалога в `.vibelog/agent-sessions/<sessionId>.jsonl` (каталог проекта, покрыт `.gitignore` через `.vibelog/`) — JSONL, по строке на сообщение. `session_id` в JSON-результате — **реальный идентификатор файла сессии** (формат `agent-<мс epoch>` — его же матчит `extractSessionRef` бота; менять формат нельзя, иначе бот определит сессию как qwen-сессию).

**Флаги:**

- `--resume <sessionId>` — загрузка транскрипта и продолжение loop с полной историей (старые сообщения + новый промпт). Работает **только с готовым промптом** — в режиме `<фаза> <taskId>` отклоняется (промпт собирается из шаблона, история не подставлялась бы). Бот передаёт sessionId с префиксом `vb:` — агент снимает его сам.
- `--continue` — то же, но сессия берётся автоматически: последний `*.jsonl` каталога по mtime. Нет сессий — ошибка «Нет сохранённых сессий» (exit 1).
- `--resume` и `--continue` одновременно — ошибка валидации.

**Ограничения:**

- Сохранение — после завершения loop; при SIGINT транскрипт теряется (v1).
- Ошибка записи сессии — предупреждение в stderr, фаза не роняется.
- Сессии qwen (UUID в `~/.qwen/projects/`) резюмируются штатным `--resume <UUID>` самого qwen — механизм агента к ним не относится.

## 4. Интеграция с оркестратором

Оркестратор (`src/web/orchestrator.ts`) берёт бинарь из переменной `VIBELOG_QWEN_BIN` (дефолт — `qwen` в PATH). Значение по умолчанию не менялось — qwen-фолбэк сохранён (decision-5).

```bash
VIBELOG_QWEN_BIN=$(pwd)/bin/vibelog-agent.mjs vibelog browser
```

Никаких правок кода оркестратора не требуется: агенту приходит тот же вызов `<bin> <phase> <taskId> [--comment ...] --output-format json`, что уходил qwen.

### Интеграция с Telegram-ботом (/prompt:vb и команды фаз, VL-92/94)

Команда `/prompt:vb <запрос>` Telegram-бота (VL-92) запускает встроенный агент вместо qwen без правок шаблонов: `startPrompt` оркестратора получает агента и спавнит `bin/vibelog-agent.mjs` (или `VIBELOG_AGENT_BIN`) с теми же qwen-совместимыми флагами `<промпт> --approval-mode yolo --output-format json`. Guard от двойного запуска (ключ `prompt`) общий для обоих агентов — одновременно активен только один `/prompt`. Переменные `VIBELOG_LLM_*` наследуются из process.env: бот загружает `.env` через `loadDotEnv` (VL-37); при отсутствии ключа агент печатает JSON-результат `is_error: true` — уходит в чат штатным механизмом фаз.

Команды фаз бота (`/spec`, `/plan`, `/code`, `/close`, `/comment`, VL-94) принимают тот же суффикс `:<agent>`: `startPhase` оркестратора получает агента опциональным параметром и спавнит `bin/vibelog-agent.mjs` вместо qwen — шаблоны фаз и JSON-контракт результата не меняются, guard-ключ фазы общий для обоих агентов. Агент по умолчанию задаётся командой `/set agent <qwen|vb>` (хранится в `.vibelog/bot.yml`, ключ `default_agent`): без суффикса запускают его все команды фаз и кнопки действий карточки задачи.

**Resume vb-сессии по reply (VL-95):** reply на информационное сообщение бота с `vb:<session_id>` возобновляет сессию агента — `startResume` оркестратора получает агента из `extractSessionRef` и спавнит `bin/vibelog-agent.mjs` с `--resume <sessionId>` (sessionId с префиксом `vb:` — strip делает CLI агента). Сессии хранятся JSONL в `.vibelog/agent-sessions/` (раздел 3.1); resume-запуск перезаписывает файл старыми + новыми сообщениями. Поведение qwen-resume не менялось (VL-93).

### Контракт stdout

Headless-агент печатает в stdout **ровно одну JSON-строку** формата `parseQwenResult` (`src/web/qwen-result.ts` — парсит последнюю валидную JSON-строку лога с `type=result`):

```json
{
  "type": "result",
  "result": "текст фазы (финальный ответ модели или partial + текст ошибки)",
  "is_error": false,
  "num_turns": 3,
  "duration_ms": 42100,
  "duration_api_ms": 42100,
  "session_id": "agent-1728000000000",
  "usage": {
    "input_tokens": 12000,
    "output_tokens": 3400,
    "cache_read_input_tokens": 8000,
    "total_tokens": 15400
  }
}
```

- `is_error: true` → exit code 1; иначе 0.
- Логи, предупреждения (например, MCP недоступен) — в stderr.
- `duration_api_ms` приравнен к `duration_ms` (агент не меряет API-время отдельно).
- Ошибки лимитов/loop detection не роняют процесс исключением: текст ошибки и partial-результат фазы идут в поле `result`, `is_error: true`.

## 5. Инструменты

### Локальные (6)

| Инструмент | Что делает |
|---|---|
| `read_file` | Читает файл проекта (offset/limit — строки) |
| `write_file` | Создаёт/перезаписывает файл (создаёт родительские директории) |
| `edit` | Точечная замена текста в файле (replace_all опционален) |
| `run_shell_command` | Запуск shell-команды |
| `grep_search` | Поиск по содержимому файлов |
| `glob` | Поиск файлов по шаблону |

### Vibelog MCP

Подключается автоматически (кроме фазы `prompt` и флага `--no-mcp`): **21 инструмент** — `backlog_*` (create/list/view/update status/update task/manage ac/manage dod/add comment/update dependencies/search/ready), `milestone_*` (list/add/rename/remove/archive), `document_*` (list/view/create/update/search). Схемы — в `docs/mcp-reference.md`.

**Отказ MCP не фатален:** если MCP-сервер недоступен, в stderr печатается предупреждение, и фаза продолжается без MCP-инструментов (локальные работают).

### Ограничения

- **Пути:** все файловые инструменты резолвят путь от cwd проекта и отказываются от выхода за его пределы (`Путь выходит за пределы проекта: ...`). Путь не может быть самим корнем-директорией (кроме `cwd` у shell).
- **Shell:** без `shell:true` на уровне Node; `cwd` команды — только внутри проекта.

## 6. Loop detection и лимиты

Двойной предел (decision-4), проверяется на каждой итерации tool-calling loop:

| Предел | Дефолт | Флаг | Поведение при срабатывании |
|---|---|---|---|
| Одинаковые вызовы подряд | 3 | — (константа) | `Loop detection: инструмент <имя> вызван 3 раза подряд с одинаковыми аргументами — фаза прервана...` |
| Всего tool-calls | 100 | `--max-tool-calls <N>` | `Превышен лимит --max-tool-calls (N) — фаза прервана.` |
| Wall-time фазы | 900 сек | `--max-wall-time <сек>` | `Превышен лимит --max-wall-time (N секунд) — фаза прервана.` |

- Сигнатура для loop detection — имя инструмента + JSON его аргументов; счётчик обнуляется при смене сигнатуры.
- Лимит tool-calls проверяется **до** выполнения вызова — лишний вызов не выполняется.
- При срабатывании любого предела: partial-накопленный текст модели + текст ошибки уходят в JSON-результат (`is_error: true`), TUI показывает блок ошибки. Исключений наружу loop не бросает.
- Ошибки выполнения отдельного инструмента фатальны только для вызова: текст ошибки уходит модели как tool-результат, фаза продолжается.

## 7. Сравнение расхода токенов с qwen

### Как замерить

- **Агент Vibelog:** usage уже есть в JSON-результате headless-режима (`usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` / `total_tokens`) и в счётчиках TUI. Сравнивать `total_tokens` + `duration_ms` + `num_turns` на одинаковых фазах.
- **Qwen Code:** `vibelog qwen-debug` — дебаг-прогон qwen (ping, stream-json) с логом сессии; usage-поля qwen в логе сопоставимы (input/output/cache_read/total).
- Замерять на **одних и тех же задачах/фазах** (одинаковый промпт шаблона), иначе сравнение бессмысленно.

### Таблица-шаблон (заполнить после первых замеров)

| Фаза | Задача | qwen: total_tokens | agent: total_tokens | qwen: duration | agent: duration | qwen: num_turns | agent: num_turns |
|---|---|---|---|---|---|---|---|
| Comment | | | | | | | |
| Plan | | | | | | | |
| Code | | | | | | | |
| Spec | | | | | | | |

> Замеры появятся после первого запуска на живом Cloud.ru-ключе (открытый вопрос VL-77/doc-4 §9). Строки — по факту; ожидаемый выигрыш — на порядок за счёт отсутствия системной обвязки qwen.

## Открытые вопросы (VL-77/doc-4 §9)

Решаются при реализации/эксплуатации, в коде зафиксировано следующее:

- **Streaming Cloud.ru** — клиент шлёт stream-запрос (SSE); формат Cloud.ru проверен probe-запросом, возможны отличия от OpenAI.
- **Дефолтная модель** — не задана намеренно: `VIBELOG_LLM_MODEL` обязательна (у каждого пользователя своя модель в Cloud.ru).
- **Версия Ink** — в коде ink 7.0.3 (VL-86, decision-2; yoga-layout WASM, нативных модулей нет).
