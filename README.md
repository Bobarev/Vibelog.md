# Vibelog.md

[![npm version](https://img.shields.io/npm/v/vibelog.md.svg)](https://www.npmjs.com/package/vibelog.md)
[![license](https://img.shields.io/badge/license-Unlicense-blue)](http://unlicense.org)
[![Node.js 20+](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)](https://nodejs.org)

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с [Backlog.md](https://github.com/MrLesk/Backlog.md) и работающий на чистом Node.js 20+.

Репозиторий: [https://gitverse.ru/bobarev/Vibelog.md](https://gitverse.ru/bobarev/Vibelog.md)

## Зачем

Оригинальный Backlog.md написан на Bun и не работает на macOS 10.15 Catalina. Vibelog.md — совместимая замена на Node.js:

- **Node.js 20+**, никаких нативных зависимостей
- **Формат данных идентичен** Backlog.md — при апгрейде macOS можно переключиться на оригинал
- **Работает с Qwen Code** через CLI и MCP
- **Минимум зависимостей** — runtime-зависимость только grammy (Telegram-бот)

## Prerequisites

- [Node.js](https://nodejs.org) 20 или новее

## Installation

```bash
npm install -g vibelog.md
```

В пакете уже собраны CLI (`dist/`) и веб-интерфейс (`web/dist`) — ничего компилировать не нужно. Одноразовый запуск без установки: `npx vibelog.md`.

Доступны два имени CLI: `vibelog` и алиас `vb` — один и тот же бинарь, поведение идентично. Запуск без аргументов показывает справку; `vibelog agent` открывает TUI-чат с LLM-агентом (см. [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md)).

## Usage

```bash
# Инициализация backlog-а в текущем git-репозитории
vibelog init "Мой проект"

# Создание задачи
vibelog task create "Добавить авторизацию" -d "Реализовать JWT" --ac "Токен создаётся"

# Доска задач в терминале
vibelog board

# Веб-интерфейс (kanban с drag-and-drop)
vibelog browser
```

Остальные команды, флаги и диагностика — в [CLI-справочнике](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md).

### Лимиты агента (vibelog-agent)

Лимиты tool-calling loop фаз (подробнее — [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md)):

- `--max-tool-calls <N>` — лимит tool-calls одного рана (дефолт 100);
  сбрасывается при каждом resume.
- `--tool-calls-per-session <N>` — **опциональный** кумулятивный лимит
  tool-calls сессии (VL-223): при resume счётчик восстанавливается из
  jsonl-истории прошлых ранов, превышение прерывает фазу до выполнения
  вызова. Без флага действует только per-run лимит (поведение прежнее).

## Веб-чат (#/chat)

Чат с LLM прямо в веб-интерфейсе (`vibelog browser` → пункт «Чат» в
сайдбаре или `#/chat`): обсуждение проекта, вопросы по задачам и создание
задач через tool-calling (VL-204, на базе assistant-ui).

- **Env**: обычно лежат в `.env` проекта —
  `VIBELOG_LLM_BASE_URL` / `VIBELOG_LLM_API_KEY` / `VIBELOG_LLM_MODEL`.
  Основной путь (VL-209) — секции `providers`/`models` в
  `.vibelog/settings.json` (см. «Модели и провайдеры»): модель выбирается
  в `#/settings` или переключателем в сайдбаре чата, без правки `.env`.
  Без секций models действует fallback на env; без них обоих чат ответит
  событием error.
- **Инструменты модели** (VL-219): чат получает **все** MCP-инструменты
  Vibelog (задачи, вехи, документы, references, lessons, конфиги) плюс
  локальные `read_file`/`write_file`. Схемы не дублируются —
  `chatToolDefs()` берёт их из реестра MCP, поэтому новые инструменты
  подключаются автоматически.
  - **Правило read/write — по природе операции, не по списку имён**
    (`isWriteOperation` в `src/web/tool-policy.ts`): read-операции
    (`list`/`view`/`search`/`get`/`ready`/`read`, локальные `read_file`,
    `grep_search`, `glob`) выполняются сразу; write-операции
    (`create`/`update`/`add`/`remove`/`manage`/`link`/`sync`/…, локальные
    `write_file`, `edit`) — **только с подтверждением**: ассистент
    показывает карточку «Выполнить операцию?» с кнопками
    «Разрешить»/«Отклонить» (human-in-the-loop). Неизвестное имя инструмента
    трактуется как write (fail-safe: подтверждение лучше молчаливой записи).
  - **`read_file`** (`path`, опционально `offset`/`limit`) — чтение любого
    файла проекта без подтверждения. Если `path` — каталог (VL-233),
    возвращается отсортированный листинг: каталоги с суффиксом `/`, лимит
    200 записей с пометкой об усечении, служебные `node_modules`/`.git`/`dist`
    показываются, но не разворачиваются; `path: "."` — листинг корня проекта.
  - **`write_file`** (`path`, `content`) — создание/перезапись файла внутри
    проекта; без Allow запись не выполняется (после Deny диалог
    продолжается без изменений). Задачи, lessons, references и documents
    правь MCP-инструментами, не через `write_file`.
  - **Статус Spec** (VL-219): задачи, созданные через чат
    (`backlog_create_task`), попадают сразу в статус **Spec** — ассистент
    выполняет фазу spec: в `description` попадает контекст/цель/входные
    данные из диалога, `acceptanceCriteria` заполняются на том же шаге,
    если данные есть. Явно указанный пользователем статус приоритетнее.
  - **`backlog_update_task`** — редактирование существующих задач с
    подтверждением (в т.ч. новое поле `acceptanceCriteria`, полная замена
    чеклиста); несуществующий id → понятная ошибка «Задача … не найдена».
  - **Пределы проекта**: `../` и абсолютные пути наружу отклоняются для
    обоих файловых инструментов (`resolveInProject`).
  - **Технически недоступны в чате** (`CHAT_DISALLOWED_TOOLS`):
    `backlog_finish_phase`, `reference_sync`, `milestone_remove` —
    destructive-операции, которые выполняет рабочий процесс Vibelog,
    а не чат.
- **Системная инструкция** — `templates/prompts/chat-system.md`
  (переопределение проектом: `.vibelog/prompts/chat-system.md`); описывает
  все инструменты, правило read/write, границы проекта и запрет фаз/релиза.
  Динамический контекст (результаты глобального поиска) добавляется поверх
  шаблона на каждом ходе.
- **История**: `<проект>/.vibelog/chat-sessions/<threadId>.jsonl`
  (по строке на сообщение; каталог в `.gitignore`).
- **Треды и навигация** (VL-207): активный тред закреплён в hash-роуте —
  `#/chat/<threadId>` (localStorage не используется). При входе на `#/chat`
  подгружается последний тред с сервера, история не теряется при уходе
  на другие страницы; список тредов — в сайдбаре **справа** (слева занят
  сайдбаром приложения), там же кнопка «Новый» и переключение тредов.
- **API тредов**: `GET /api/chat/threads` — список тредов (id, title,
  updatedAt, messageCount) без тел сообщений; `GET /api/chat/threads/:id` —
  история треда для восстановления.
- **Протокол**: `POST /api/chat` — SSE (`text/event-stream`), события
  `text`/`tool_start`/`tool_end`/`approval`/`done`/`error`.
- Замечание для `pnpm dev` в `web/`: dev-прокси `/api` → :3030 пропускает
  SSE стримом; при подозрении на буферизацию проверяй через `vibelog browser`.

## Учёт токенов (billing)

Сколько LLM-токенов потрачено на задачу и по фазам — три уровня хранения
(деньги НЕ хранятся: тариф меняется, стоимость считается на лету):

1. **Мета сессии** `.vibelog/agent-sessions/<sessionId>.meta.json` —
   `usage {input, output, cache, total, requests}`, `startedAt/finishedAt/durationMs`,
   `model`, `agent` (vb/qwen) — самодостаточно для сверки с провайдером.
2. **Frontmatter задачи** `token_usage` — агрегат по всем сессиям:
   totals + `duration_ms` + `by_phase: {spec/plan/…: {input, output, cache, requests}}`.
   Показывается в карточке (web-таб «Токены», `/task` в боте, `task view` в CLI).
3. **`.vibelog/billing/<taskId>.json`** — append-only журнал сессий
   (источник правды: одна запись на ран).

Записывают все три писателя с дельта-идемпотентностью (отметка
`usage_recorded` в мете): `backlog_finish_phase` (поле `tokenUsage`,
fallback — мета сессии → её jsonl), CLI-пост-ран и finish-блок
оркестратора (основной путь для qwen-ранов). Requests/usage в JSONL
сессии дописывает loop в каждое assistant-сообщение.

**`requests` — это LLM-запросы (ходы модели), НЕ tool-calls (VL-221):**
лимит `--max-tool-calls` считает tool-calls текущего рана (счётчик
сбрасывается при resume) — разные независимые счётчики; в диагностике
фазы они выводятся рядом (`запросов=N`, `tool-calls=M/лимит`).

Стоимость — только в аналитике: `calculateCost(usage, pricing)`, тарифы —
`pricing` активной модели в секции `models.available`
`.vibelog/settings.json` (VL-209, см. `getActiveModelPricing`); для конфигов
до VL-209 поддерживается legacy-секция `pricing` (модель → тариф):

```json
{
  "pricing": {
    "mimo-v2.6-pro": { "input_per_1m": 1.2, "output_per_1m": 6, "cache_per_1m": 0.3 }
  }
}
```

`reasoning_tokens` хранится отдельно (из `completion_tokens_details`, ref-19) —
для аналитики, не вычитается из output. Запросы LLM несут заголовок
`X-Session-Id` (ref-18) — группировка сессии на дашборде RouterAI.

## Модели и провайдеры (VL-209)

Реестр LLM-моделей и провайдеров — секции `providers`/`models` в
`.vibelog/settings.json`. Переключение модели — CLI, ботом или вебом,
без правки `.env`. Без секции `models` всё работает как раньше
(env `VIBELOG_LLM_*`, полный fallback).

```json
{
  "providers": {
    "routerai": { "base_url": "https://routerai.ru/api/v1", "api_key_env": "ROUTERAI_API_KEY" },
    "cloudru": { "base_url": "https://foundation-models.api.cloud.ru/v1", "api_key_env": "CLOUDRU_API_KEY" }
  },
  "models": {
    "default": "routerai/xiaomi/mimo-v2.6-pro",
    "available": {
      "routerai/xiaomi/mimo-v2.6-pro": {
        "label": "MiMo v2.6 Pro",
        "provider": "routerai",
        "model": "xiaomi/mimo-v2.6-pro",
        "api_mode": "chat",
        "pricing": { "input_per_1m": 1.2, "output_per_1m": 6, "cache_per_1m": 0.3 }
      }
    }
  }
}
```

- **id модели** — строка `provider/model`; **provider** — ссылка на
  `providers[<id>]`; **model** — wire-имя у провайдера;
- **api_mode** — `chat` | `responses` (VL-205); флаг `--api-mode` остаётся
  приоритетным разовым переопределением;
- **api_key_env** — имя переменной с ключом (не сам ключ): читается из
  env → `.env` → env-секции settings.json (приоритет VL-143). `api_key`
  напрямую — fallback для не-секретных случаев, не рекомендуется;
- **pricing** — тарифы для billing (секция выше);
- валидация при старте фазы: `model.provider` обязан существовать в
  `providers`, `api_key_env` — быть заданным; иначе понятная ошибка в
  stderr (→ logTail). В stderr фазы пишется лог
  `Модель: <label> (<id>), api_mode: <chat|responses>`.

Способы переключения:

```bash
vibelog model list       # список с маркером * у активной
vibelog model use <id>   # переключить models.default
vibelog model current    # активная модель
vibelog provider list    # base_url + статус ключа (значения не выводятся)
```

Бот: `/model` — список, `/set model <id>` — переключение.
Веб: `#/settings` — селект активной модели; в чате (`#/chat`) — переключатель
в сайдбаре тредов (переопределение для чата, default не меняется).

## /auto — автоочередь фаз

Telegram-бот умеет последовательно прогонять фазы задач из очереди
`.vibelog/auto-queue.json` (`/auto add <VL-N>…`, `/auto start|stop|status`;
подробности — в [руководстве пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md)).

Статусы элемента очереди: `pending`, `running`, `done`, `failed`,
**`failed_permanent`** — провал с исчерпанными ретраями (`attempts >
max_retries`). Такой элемент терминален:

- ретраев больше не будет, а причина провала лежит в `fail_reason` и видна
  в `/auto status` (`VL-9 — failed_permanent, причина: …`);
- в stderr бота пишется строка
  `[auto VL-228] VL-9 → failed_permanent: фаза code, попыток 2 из 1, причина: …; сессия: <sessionId>`
  — по ссылке на сессию видно, где искать контекст агента;
- следующий цикл очереди его не трогает и не выбирает (`pending`-задачей он
  не считается), `/auto add` **не реанимирует** такой элемент автоматически.
  Ручная реанимация — удалить запись из `.vibelog/auto-queue.json` и добавить
  задачу заново (`/auto add VL-N`) — новый элемент создаётся с `attempts: 0`.

Застрявшие элементы старых очередей (`failed` при `attempts > max_retries`)
мигрируются в `failed_permanent` автоматически при ближайшем `sweep`
(перед выбором следующей задачи), с заполнением причины.

## Документация

| Документ | Для чего |
|---|---|
| [Руководство пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md) | Полный обзор: команды, веб-интерфейс, Telegram-бот, форматы файлов |
| [CLI-справочник](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md) | Все команды, подкоманды, флаги, диагностика |
| [MCP-справочник](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md) | Все MCP-инструменты: параметры и примеры вызовов |
| [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md) | Собственный LLM-агент: TUI, headless-фазы, лимиты |
| [MCP-подключение](MCP-SETUP.md) | Подключение Vibelog MCP к Qwen Code |
| [Best practices](backlog/docs/doc-9-Best-practices-и-производительность-Vibelogmd.md) | Workflow с Qwen Code, dogfooding, производительность |

## Contributing

Отдельного CONTRIBUTING.md нет — правила разработки описаны в [AGENTS.md](AGENTS.md). Кратко: исходники на TypeScript (`.ts` → `tsc` → `dist/`, ESM), для разработки:

```bash
pnpm install && pnpm build   # сборка обязательна: bin/vibelog.mjs импортирует dist/
pnpm test                    # build + Vitest; pnpm test:fast — только Vitest
```

## Совместимость с Backlog.md

Формат файлов задач и frontmatter идентичен Backlog.md (round-trip проверен на реальных задачах) — каталог `backlog/` совместим без миграции. Подробности — в [руководстве пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md).

## Лицензия

[Unlicense](http://unlicense.org) (public domain)
