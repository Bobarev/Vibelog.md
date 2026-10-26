---
id: VL-192
title: ROADMAP.md — стратегический roadmap проекта
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 17:16'
updated_date: '2026-10-26 17:53'
due_date: ''
labels:
  - docs
dependencies: []
milestone: ''
references: []
priority: medium
type: docs
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - ROADMAP.md
  - AGENTS.md
lessons:
  - lesson-49
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Нужен ROADMAP.md в корне проекта: стратегический план, который читают и люди, и агент (ссылка в AGENTS.md). Отделён от CHANGELOG.md (история) и backlog/ (задачи).

## Структура

```
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
- **Зачем:** новый пользователь должен настроить проект за 2 минуты.
- **Уверенность:** High
- **Статус:** planned

### OpenCode adapter
- **Зачем:** не только qwen/vb — больше агентов.
- **Уверенность:** Medium
- **Статус:** future gate

### References cache
- **Зачем:** Plan не должен каждый раз ходить в интернет.
- **Уверенность:** High
- **Статус:** planned

## Будущее (v1.+)

### Agent memory (свой)
- **Зачем:** контроль над памятью агента.
- **Уверенность:** Medium
- **Статус:** future gate

### Multi-tenant (VPS)
- **Зачем:** доступ из поездок, семья.
- **Уверенность:** Low (зависит от времени)
- **Статус:** future gate

## Передумали (Changed our mind)

- **Decisions в workflow** — решили не добавлять: перегружает промпты, пока не используется. Если понадобится — вернёмся.
- **TSID (multi-author)** — отложено: нет соавторов. Вернёмся, когда появятся.

## Не сейчас (Not now)

- Milestones в workflow — когда будет много релизных задач.
- Аналитика (дашборд) — nice-to-have, после billing.
- TSID — когда появятся контрибьюторы.
```

## Интеграция

- Упоминание в AGENTS.md.
- Агент если это необходимо видит приоритеты и контекст, не предлагает отвергнутое.
- создать lesson по работе с ROADMAP
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ROADMAP.md создан в корне проекта со структурой из описания (Сейчас / Дальше / Будущее / Передумали / Не сейчас), включая пункты из комментария Pavel (init wizard, web wizard, OpenCode, references cache, agent memory, subagents, VPS, multi-tenant, TSID, аналитика)
- [x] #2 AGENTS.md содержит ссылку на ROADMAP.md, чтобы агент видел приоритеты и не предлагал отвергнутое
- [x] #3 Создан lesson по работе с ROADMAP и связан с задачей
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План: ROADMAP.md + интеграция (type=docs, масштаб task)

Файлы (проверены ls): `ROADMAP.md` — НЕ существует (создать), `AGENTS.md` — есть, `CHANGELOG.md` — есть (не трогаем).

### Файлы для изменения
1. **ROADMAP.md** (новый, корень проекта)
2. **AGENTS.md** (2 точки вставки)

### 1. Создать ROADMAP.md

Структура — строго по описанию задачи (блок ``` в описании), с доработками из комментария Pavel:

**Шапка:** Текущая версия 1.9.0, Активный горизонт v1.10.0 — v1.11.0, Последнее обновление 2026-10-26, Связанные документы: CHANGELOG.md, backlog/ (задачи), doc-6 (настройки).

**Секция «Как читать этот roadmap»** — из описания, дословно.

**«Сейчас (v1.10.0)»** — 3 подраздела из описания:
- Web UI — довести до ума (VL-191, VL-XXX web wizard)
- Auto-runner (VL-191)
- Billing (VL-XXX)

**«Дальше (v1.11.0)»** — из описания + пункты Pavel:
- Init wizard (консольный + web) — **расширить по комментарию Pavel**: проблема — `vibelog init` не настраивает VIBELOG_LLM_MODEL / агента (vb|qwen) / VIBELOG_LLM_API_KEY / VIBELOG_LLM_BASE_URL / workflow / MCP-серверы / Telegram-бота; что — интерактивный wizard + флаги для non-interactive.
- **Web wizard (/setup) — отдельный пункт** (AC требует пункт web wizard): проблема — консольный wizard «прошлый век», уже есть web-UI; что — при `vibelog init` открывается браузер на `/setup`, форма (имя проекта, prefix, агент, модель, API-ключ, base URL, workflow, MCP, Telegram), сохранение в settings.json + backlog/config.yml, проверка LLM (ping) и MCP. Уверенность High, статус planned.
- OpenCode adapter — **дополнить**: абстракция AgentAdapter, реализации Vibelog/Qwen/OpenCode, `default_agent` в settings.json, выбор в web wizard. Уверенность Medium.
- References cache — **дополнить**: `reference add --cache` (скачивание, очистка script/style/nav/footer, Turndown → markdown), кэш в `backlog/references/cache/<slug>.md`, `reference_view` отдаёт кэш, `reference sync`. Уверенность High.

**«Будущее (v1.+)»**:
- Agent memory (свой) — дополнить по Pavel: `.vibelog/agent-memory/` (preferences/patterns/facts), auto-extract из сессий при завершении фазы, recall в system prompt, dream-замена (чистка дублей раз в неделю). Medium.
- **Subagents (роли) — НОВЫЙ пункт** (нет в структуре описания, но требуется AC): проблема — один агент на всё; что — `.vibelog/agents/frontend.md|backend.md|tester.md` (системные промпты), делегирование подзадач, выбор субагента по label/типу задачи. Уверенность Medium, статус future gate.
- **VPS-деплой (Уровень 1) — НОВЫЙ пункт** (Pavel разделяет VPS и multi-tenant): личный сервер, Basic Auth, HTTPS, systemd. Уверенность Low, future gate.
- **Multi-tenant (Уровень 2)** — переименовать из «Multi-tenant (VPS)» и дополнить: VPS + PostgreSQL + JWT + монорепо (@vibelog/core, @vibelog/server, @vibelog/web). Low, future gate.
- TSID (multi-author) — **перенести только в «Передумали»** (Pavel: отложено, вернёмся когда появятся соавторы), из «Не сейчас» убрать дубль AC; оставить в «Не сейчас» Milestones и Аналитика.

Итог по AC1 — все 10 пунктов Pavel присутствуют: init wizard ✓, web wizard ✓, OpenCode ✓, references cache ✓, agent memory ✓, subagents ✓, VPS ✓, multi-tenant ✓, TSID ✓ («Передумали»), аналитика ✓ («Не сейчас»).

Пункты «Сейчас/Дальше» ссылаются на задачи (VL-191, VL-XXX) — заглушки VL-XXX оставить как в описании (задач billing/web wizard в backlog пока нет — при реализации подставить реальные ID, если они появятся).

### 2. AGENTS.md — ссылка на ROADMAP (2 точки)

- **Строка 50 «## Работа через Vibelog»**, после первого абзаца («Проект реализован; …»): добавить абзац:
  `Стратегические приоритеты — ROADMAP.md (корень): читай при планировании, чтобы видеть горизонт (Сейчас/Дальше/Будущее) и не предлагать отвергнутое из секций «Передумали»/«Не сейчас».`
- **Строка 85 «## Ссылки»**: добавить строку `- Roadmap: ROADMAP.md`.

(Номера строк — до вставки; при патче искать точные якоря-заголовки `## Работа через Vibelog` и `## Ссылки`, вставлять относительно них.)

### 3. Lesson (AC3) — выполняется в фазе Close, НЕ в Plan

По правилам workflow lesson_create/lesson_link делаются в фазе Close (шаг 6.5). Здесь только заложить в план:
- `lesson_create {"title": "Читай ROADMAP.md перед планированием и не предлагай отвергнутое", "content": "Проблема: агент при генерации идей не знает стратегический контекст и предлагает уже отклонённые направления (Decisions, TSID). Решение: перед фазой Plan читай ROADMAP.md — секции «Сейчас/Дальше/Будущее» задают приоритеты, «Передумали/Не сейчас» — запреты. Пример: задача про TSID должна быть отклонена со ссылкой на «Передумали».", "tags": ["workflow", "docs"], "sourceTasks": ["VL-192"]}`
- `lesson_link {"lessonId": "<новый>", "taskId": "VL-192"}` (для AC3).

### Порядок действий
1. Создать ROADMAP.md (write_file).
2. Патч AGENTS.md в 2 места (edit, якоря-заголовки).
3. Проверить AC1/AC2 (grep ROADMAP.md в AGENTS.md; grep секций в ROADMAP.md).
4. Фаза Code: `pnpm test` (документы код не задевают — тесты должны пройти без изменений).
5. Фаза Close: lesson_create + lesson_link (AC3), отметить AC 1-3, DoD 1-3.

### Как проверить
- `grep -n "ROADMAP" AGENTS.md` — есть упоминание.
- `grep -n "^## " ROADMAP.md` — секции: Сейчас / Дальше / Будущее / Передумали / Не сейчас.
- `grep -c "Subagents\|Web wizard\|VPS-деплой" ROADMAP.md` — новые пункты на месте.
- `pnpm test` — build + vitest (нет регрессий, документы не влияют на код).

### Риски
- Номера строк AGENTS.md могут сдвинуться — искать по заголовкам-якорям, не по номерам.
- VL-XXX — заглушки: если параллельно создадутся задачи billing/web wizard — подставить реальные ID при ближайшем обновлении.
- Не продублировать TSID в «Не сейчас» и «Передумали» (AC — TSID в «Передумали»).
- Дата/версия в шапке — вычислять на дату создания, не хардкодить при будущих правках (обновлять «Последнее обновление»).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: Pavel Bobarev
created: 2026-10-26 17:24
---
Надо добавить в ROADMAP
### Init wizard
**Проблема:** `vibelog init` создаёт только `backlog/` и `settings.json`. Не настраивает:
- Модель агента (`VIBELOG_LLM_MODEL`).
- Агента (`vb` или `qwen`).
- API-ключ (`VIBELOG_LLM_API_KEY`).
- Base URL (`VIBELOG_LLM_BASE_URL`).
- Workflow.
- MCP-серверы.
- Telegram-бота.
**Что:** интерактивный wizard + флаги для non-interactive.
### Web wizard (лучше консольного)
**Проблема:** консольный wizard — это **прошлый век**. Ты **уже** имеешь **web-UI**. Логичнее — **web-страница** `/setup` при **первом** **запуске**.
**Что:**
- При `vibelog init` — **открывается** **браузер** на `/setup`.
- Форма: имя проекта, prefix, агент (vb/qwen), модель, API-ключ, base URL, workflow (default/simple/bugfix), MCP-серверы, Telegram-бот.
- **Сохраняет** в `settings.json` + `backlog/config.yml`.
- **Проверяет** подключение к LLM (ping).
- **Проверяет** MCP-серверы.
### Поддержка OpenCode (и других агентов)
**Проблема:** сейчас **только** `vb` и `qwen`. **Хочется** **opencode**, **cline**, **gemini-cli** (если **запустятся**).
**Что:**
- **Абстракция** `AgentAdapter` — интерфейс для **любого** агента.
- **Реализации**: `VibelogAgentAdapter`, `QwenAgentAdapter`, `OpenCodeAgentAdapter`.
- **Настройка** в `settings.json`: `default_agent: "vb" | "qwen" | "opencode"`.
- **Web wizard** — **выбор** агента **из** **списка**.
### References — локальный кэш
**Проблема:** `reference` **типа** `url`/`doc` — **только** **ссылка**. Plan **каждый** **раз** **делает** **web_fetch**.
**Что:**
- `reference add --cache` — **скачать**, **очистить** (script/style/nav/footer), **конвертировать** **в** **markdown** (Turndown).
- **Кэш** в `backlog/references/cache/<slug>.md`.
- `reference_view` **возвращает** **кэш**.
- `reference sync` — **обновить** **кэш**.
### Agent memory (свой, не Qwen)
**Проблема:** Qwen auto-memory — **неконтролируемо**. Lessons — **привязаны** **к** **задачам**, **не** **к** **агенту**.
**Что:**
- `.vibelog/agent-memory/` — **markdown** **файлы** (**preferences**, **patterns**, **facts**).
- **Auto-extract** **из** **сессий** (**при** **завершении** **фазы**).
- **Recall** **при** **старте** **агента** (**в** **system** **prompt**).
- **Dream** **замена** — **чистка** **дублей** **раз** **в** **неделю**.
### Subagents (роли)
**Проблема:** один **агент** **для** **всего**. **Разные** **задачи** — **разные** **роли**.
**Что:**
- `.vibelog/agents/frontend.md`, `backend.md`, `tester.md` — **системные** **промпты**.
- **Делегирование** **подзадач** **субагентам**.
- **Выбор** **субагента** **по** **label** **или** **типу** **задачи**.
### VPS-деплой (Уровень 1)
**Что:** личный **сервер** **с** **Basic Auth**, **HTTPS**, **systemd**.
### Multi-tenant (Уровень 2)
**Что:** VPS + PostgreSQL + JWT + монорепо (`@vibelog/core`, `@vibelog/server`, `@vibelog/web`).
### TSID (multi-author)
**Что:** Time-Sorted ID **вместо** sequential. **Переключатель** **в** `settings.json`.
### Аналитика (дашборд)
**Что:** `#/analytics` — **графики** **по** **периоду**, **токены**, **деньги**.
---
author: @agent
created: 2026-10-26 17:39
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: docs. Масштаб: task. Приоритет: Medium. Уточнено: критерии приёмки — ROADMAP.md в корне по структуре из описания (с учётом пунктов из комментария Pavel), ссылка в AGENTS.md, lesson по работе с ROADMAP; тип docs, labels docs. Внешние источники в описании/комментарии не упомянуты — references: нет. Вопросов нет.
---
author: @agent
created: 2026-10-26 17:42
---
Фаза 2 (Plan) выполнена. Тип: docs (не epic — план записан в задачу). Изучены: описание задачи, комментарий Pavel (10 пунктов), AGENTS.md (якоря-заголовки «## Работа через Vibelog» стр. 50, «## Ссылки» стр. 85), наличие файлов — ROADMAP.md отсутствует (создать), AGENTS.md/CHANGELOG.md есть; references нет; задач billing/web wizard в backlog нет (заглушки VL-XXX). План: 2 файла (ROADMAP.md — новый по структуре описания + пункты Pavel: web wizard, subagents, VPS-деплой отдельно от multi-tenant, расширения init wizard/opencode/refs-cache/agent-memory; AGENTS.md — 2 точки вставки), порядок действий, проверки (grep + pnpm test), риски. Lesson (AC3) заложен в фазу Close — в Plan по правилам workflow не создаётся. Подзадачи не создавались (масштаб task).
---
author: @agent
created: 2026-10-26 17:49
---
Фаза 3 (Code) выполнена. Изменено: ROADMAP.md (новый, 110 строк), AGENTS.md (2 вставки: абзац про ROADMAP в «Работа через Vibelog», строка в «Ссылки»), коммит 6ef5fe8. Проверки: grep — все 6 секций на месте (Сейчас/Дальше/Будущее/Передумали/Не сейчас + «Как читать»); все 10 пунктов Pavel присутствуют (init wizard, web wizard — отдельный пункт, OpenCode, references cache, agent memory, subagents, VPS-деплой Уровень 1, multi-tenant Уровень 2, TSID только в «Передумали», аналитика в «Не сейчас»); ссылка ROADMAP.md в AGENTS.md ×2. Тесты: первый прогон pnpm test — 6 падений в src/web/orchestrator.test.mjs (флейк под параллелизмом, файл из VL-140); повторные прогоны — 73 файла/1292 теста зелёные (exit 0), регрессий нет (изменены только markdown-документы). AC3: создан lesson-49 «Читай ROADMAP.md перед планированием и не предлагай отвергнутое», связан с задачей. References не использовались. CHANGELOG.md не трогал — пишет Close.
---
author: @agent
created: 2026-10-26 17:53
---
Фаза Close выполнена. Ветка vb/vl-192 слита в master (1 коммит 6ef5fe8, merge без конфликтов), worktree удалена (force — только untracked-симлинки node_modules/refs), ветка удалена. Сборка и тесты после merge: pnpm build + pnpm test — зелёные (регрессий нет, изменены только markdown-документы). DoD: все 3 пункта отмечены — тесты проходят, документация обновлена (CHANGELOG.md, запись в Unreleased), нет регрессий. Коммиты: docs(task) 6950515 (lesson-49), docs(fca073b) CHANGELOG. AC3 — lesson-49 создан и связан с задачей (список lessons задачи содержит lesson-49). References задачи не использовались.
---
<!-- COMMENTS:END -->