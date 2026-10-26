# Roadmap — Vibelog.md

**Текущая версия:** 1.9.0
**Активный горизонт:** v1.10.0 — v1.11.0
**Последнее обновление:** 2026-10-26
**Связанные документы:** CHANGELOG.md, backlog/ (задачи), doc-6 (настройки)

## Как читать этот roadmap

Это стратегический план. Детали реализации — в задачах backlog/.
Уверенность: High (точно сделаем), Medium (скорее да), Low (идея).
Каждый пункт ссылается на задачу или milestone.

## Сейчас (v1.10.0)

### Web UI — довести до ума
- **Зачем:** полноценная работа с задачами без CLI.
- **Уверенность:** High
- **Задачи:** VL-191 (auto-runner), VL-XXX (web wizard)
- **Статус:** в работе

### Auto-runner
- **Зачем:** автоматическое прохождение фаз для мелких задач.
- **Уверенность:** High
- **Задачи:** VL-191
- **Статус:** Spec

### Billing (учёт токенов)
- **Зачем:** понимать, сколько стоит каждая задача.
- **Уверенность:** High
- **Задачи:** VL-XXX (billing)
- **Статус:** To Do

## Дальше (v1.11.0)

### Init wizard (консольный + web)
- **Проблема:** `vibelog init` создаёт только `backlog/` и `settings.json`. Не настраивает:
  модель агента (`VIBELOG_LLM_MODEL`), агента (`vb` или `qwen`), API-ключ
  (`VIBELOG_LLM_API_KEY`), base URL (`VIBELOG_LLM_BASE_URL`), workflow,
  MCP-серверы, Telegram-бота.
- **Что:** интерактивный wizard + флаги для non-interactive.
- **Уверенность:** High
- **Статус:** planned

### Web wizard (/setup)
- **Проблема:** консольный wizard — это прошлый век. Уже есть web-UI; логичнее
  web-страница `/setup` при первом запуске.
- **Что:** при `vibelog init` открывается браузер на `/setup`. Форма: имя проекта,
  prefix, агент (vb/qwen), модель, API-ключ, base URL, workflow
  (default/simple/bugfix), MCP-серверы, Telegram-бот. Сохраняет в `settings.json` +
  `backlog/config.yml`. Проверяет подключение к LLM (ping) и MCP-серверы.
- **Уверенность:** High
- **Статус:** planned

### OpenCode adapter
- **Проблема:** сейчас только `vb` и `qwen`. Хочется opencode, cline, gemini-cli
  (если запустятся).
- **Что:** абстракция `AgentAdapter` — интерфейс для любого агента. Реализации:
  `VibelogAgentAdapter`, `QwenAgentAdapter`, `OpenCodeAgentAdapter`. Настройка
  в `settings.json`: `default_agent: "vb" | "qwen" | "opencode"`. Web wizard —
  выбор агента из списка.
- **Уверенность:** Medium
- **Статус:** future gate

### References cache
- **Проблема:** `reference` типа `url`/`doc` — только ссылка. Plan каждый раз
  делает web_fetch.
- **Что:** `reference add --cache` — скачать, очистить (script/style/nav/footer),
  конвертировать в markdown (Turndown). Кэш в `backlog/references/cache/<slug>.md`.
  `reference_view` возвращает кэш. `reference sync` — обновить кэш.
- **Уверенность:** High
- **Статус:** planned

## Будущее (v1.+)

### Agent memory (свой)
- **Проблема:** Qwen auto-memory неконтролируемо. Lessons привязаны к задачам,
  не к агенту.
- **Что:** `.vibelog/agent-memory/` — markdown-файлы (preferences, patterns, facts).
  Auto-extract из сессий (при завершении фазы). Recall при старте агента (в system
  prompt). Dream-замена — чистка дублей раз в неделю.
- **Уверенность:** Medium
- **Статус:** future gate

### Subagents (роли)
- **Проблема:** один агент для всего. Разные задачи — разные роли.
- **Что:** `.vibelog/agents/frontend.md`, `backend.md`, `tester.md` — системные
  промпты. Делегирование подзадач субагентам. Выбор субагента по label или типу
  задачи.
- **Уверенность:** Medium
- **Статус:** future gate

### VPS-деплой (Уровень 1)
- **Что:** личный сервер с Basic Auth, HTTPS, systemd.
- **Уверенность:** Low (зависит от времени)
- **Статус:** future gate

### Multi-tenant (Уровень 2)
- **Что:** VPS + PostgreSQL + JWT + монорепо (`@vibelog/core`, `@vibelog/server`,
  `@vibelog/web`).
- **Зачем:** доступ из поездок, семья.
- **Уверенность:** Low (зависит от времени)
- **Статус:** future gate

## Передумали (Changed our mind)

- **Decisions в workflow** — решили не добавлять: перегружает промпты, пока не используется. Если понадобится — вернёмся.
- **TSID (multi-author)** — отложено: нет соавторов. Вернёмся, когда появятся.

## Не сейчас (Not now)

- Milestones в workflow — когда будет много релизных задач.
- Аналитика (дашборд) — nice-to-have, после billing.
