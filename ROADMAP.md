# Roadmap — Vibelog.md

**Текущая версия:** 1.11.0
**Активный горизонт:** v1.12.0 — v1.14.0
**Последнее обновление:** 2026-11-03 (добавлен горизонт UI Kit / `vb` CLI)
**Связанные документы:** CHANGELOG.md, backlog/ (задачи), doc-6 (настройки), doc-21 (спецификация экспериментов), doc-25 (спецификация `vb` CLI, реестра UI и шаблонов), decisions decision-6…decision-11

## Как читать этот roadmap

Это стратегический план. Детали реализации — в задачах backlog/.
Уверенность: High (точно сделаем), Medium (скорее да), Low (идея).
Каждый пункт ссылается на задачу или milestone.

## Состояние на момент обновления

- **v1.10 закрыт** (VL-188…VL-208): веб-чат, Responses API, billing, auto-runner, transient In Progress, references cache, investigation-workflow.
- **v1.11 закрыт** (VL-209…VL-290): супервизор и авто-лечение фаз, стабильный env тестов, guard повторов, инструменты агента (search_files, project_map, read_file на директориях), веб-чат и global search, релиз 1.11.0.
- **Эпик A/B-экспериментов:** спецификация VL-293 Done (doc-21), MVP VL-294–VL-298 Done (артефакт `backlog/experiments/`, dataset JSONL, manual runner + record, report/compare, LLM-judge). Осталось v2 — VL-299, VL-300, VL-301.
- **Открытые задачи:** VL-210 (init wizard, Spec), VL-299/VL-300 (Planned), VL-301 (Spec), VL-124 (To Do).
- **Новое направление:** UI Kit для Svelte и `vb` CLI — спецификация doc-25 готова, ADR decision-6…decision-11 приняты, задачи ещё не созданы.

## Сейчас (v1.12.0)

### Experiments v2 — довести эпик до конца
- **Зачем:** MVP покрывает manual-прогон и оценку; без ai-phase runner эксперименты не автоматизируются, без gc каталог прогонов растёт бесконтрольно.
- **Что:**
  - **VL-299** (Planned, Medium) — ai-phase runner с изоляцией: worktree, `VIBELOG_EXPERIMENT`, timeout, cost варианта.
  - **VL-300** (Planned, Low) — external runner (`--runner-cmd`) и `run --rerun N --yes`.
  - **VL-301** (Spec, Low) — `experiment gc` (.gitignore-политика >10 MB) и связь lesson ↔ эксперимент.
- **Зависимости:** VL-299 → VL-296 (runner/record, Done), VL-297 (report, Done). VL-301 независим.
- **Уверенность:** High (VL-299), Medium (VL-300/301)
- **Статус:** VL-299 — Planned, VL-300 — Planned, VL-301 — Spec

### Init wizard (консольный + web /setup)
- **Проблема:** `vibelog init` создаёт только `backlog/` и `settings.json` с дефолтами. Не настраивает агента(ов), LLM (провайдер, модель), где хранить ключи, Telegram-бота, MCP. Новый пользователь не понимает, что делать дальше.
- **Что:** интерактивный wizard (readline) + web-страница `/setup`; два режима — fresh (нет `backlog/`) и upgrade (дополнить недостающее, не перезаписывая задачи/docs/lessons/references/decisions/milestones/completed). Агенты — галочки (vb/qwen/opencode, проект без агента — валидный сценарий), секреты — `.env` | `settings.json` | оба, ping LLM и getMe бота, флаги для non-interactive.
- **Зависимости:** VL-209 (управление LLM-моделями и провайдерами) — Done, блокеров нет.
- **Уверенность:** High
- **Задачи:** VL-210 (Spec, дизайн детально расписан)
- **Статус:** Spec → Plan

### Переносимый `.vibelog/` + `vibelog doctor`
- **Проблема:** `.vibelog/` содержит и переносимое (settings.json без секретов, billing/), и локальное (agent-sessions/, chat-sessions/, .env, tmp/, worktrees/). Без `.vibelog/.gitignore` в git уедут сессии и ключи.
- **Что:** `.vibelog/.gitignore` создаётся при init; `billing/` и `settings.json` — в git; `vibelog doctor` проверяет `.vibelog/.gitignore`, `settings.json` не в gitignore, `billing/` не в gitignore, `.env` в gitignore, предупреждает если `.vibelog/` целиком в корневом gitignore. Миграция для существующих проектов.
- **Зависимости:** предусловие для VPS-деплоя (F1). Приоритет env — VL-143 (env → .env → settings.env).
- **Уверенность:** High
- **Задачи:** не создана
- **Статус:** planned

## Дальше (v1.13.0)

### Аналитика (дашборд)
- **Проблема:** billing (VL-198) собирает токены по задачам и фазам, но визуализации нет.
- **Что:** `#/analytics` — задачи по статусам (bar), создано/закрыто за период (line), токены по фазам (bar), распределение по типам (pie). API `/api/analytics/summary|tasks|sessions` с since/until. Период: 7 дней / 30 дней / всё время.
- **MVP-скоуп:** 2 графика (статусы + создано/закрыто), токены по фазам — вторым шагом. Стоимость в рублях — только при наличии `pricing` в settings.json.
- **Зависимости:** VL-198 (billing) — Done; `src/core/analytics.ts` уже существует.
- **Уверенность:** High
- **Задачи:** не создана
- **Статус:** planned

### VPS-деплой (Уровень 1)
- **Проблема:** локальная машина недоступна в поездках.
- **Что:** VPS + Caddy + Basic Auth + HTTPS (Let's Encrypt) + systemd. `scripts/deploy-vps.sh`, `docs/deploy-vps.md` (выбор VPS, DNS, Caddy, systemd, обновление, секреты). Markdown-нативность и git сохраняются: репо клонируется на VPS, агент работает там же.
- **Зависимости:** переносимый `.vibelog/` (B3) — иначе на сервер уедут сессии и ключи.
- **Уверенность:** Medium
- **Задачи:** не создана
- **Статус:** planned

## Горизонт v1.14.0 — UI Kit для Svelte и `vb` CLI

- **Зачем:** нужны тестовые проекты, пригодные одновременно как реальная работа. Первый кейс — UI Kit для мессенджера MAX Mini App на Svelte. Попутно проверяется агент на менее знакомом стеке (Svelte) и появляется инфраструктура распространения кода.
- **Спецификация:** doc-25. Решения: decision-6 (Svelte 5 Runes + Tailwind), decision-7 (микро-shadcn, zero runtime dependencies), decision-8 (реестр на GitVerse, алиас `vibelog.md`, формат shadcn), decision-9 (три команды, служебное в `.vibelog/`), decision-10 (версионирование хешами в `installed.lock.json`), decision-11 (шаблоны: монорепозиторий, метаданные в `package.json`, `sparse-checkout`).
- **Что (первая версия):**
  1. Репозиторий `Vibelog-md/templates` + шаблон `svelte-minimal` (`package.json` с `vibelog.type`, `postCreate`, файл правил агента `CLAUDE.md` «только Svelte 5 Runes + только Tailwind»).
  2. `vb create`: `sparse-checkout` + `--filter=blob:none`, копирование, пакетный менеджер, зависимости, `postCreate`, `git init`; fallback при отсутствии поддержки фильтрации на сервере.
  3. Репозиторий `Vibelog-md/ui`: `registry.json`, сборка в `public/r/*.json`, корневой элемент `vibelog.md/ui` (`utils.ts`, `cn`, CSS-переменные).
  4. `vb install`: скачивание по API-форме URL GitVerse, проверка `dependencies` из JSON реестра, `registryDependencies` одного уровня, разрешение конфликтов, атомарная запись, хеши в `.vibelog/installed.lock.json`.
  5. Компоненты по порядку: `Button` (веб, порт с React-эталона) → `Input` + `Label` → `Card` (мультифайловый).
- **Вне первой версии:** `vb update`, полная рекурсивная резолюция зависимостей, MAX Bridge (`window.WebApp`, `HapticFeedback`), компоненты на `bits-ui`, синтаксис `host/owner/repo`.
- **Зависимости:** нет блокеров в текущем backlog. `vb` — алиас существующего бинаря `vibelog`, отдельного пакета не появляется.
- **Уверенность:** Medium (инфраструктура `vb`), High (Svelte-шаблон и первый компонент)
- **Задачи:** не созданы (план по шагам — §7 doc-25)
- **Риски:** частичное клонирование может не поддерживаться GitVerse (закрыто fallback); агент может выдавать синтаксис Svelte 4 (закрыто файлом правил и `ai-tools`); `vb update` без манифеста затирал бы правки агента (закрыто хешами, собираются с первого дня).

## Будущее (v1.+)

### Subagents (роли в агенте)
- **Проблема:** один агент для всего; разным фазам нужна разная специализация.
- **Что:** `.vibelog/agents/frontend.md`, `backend.md`, `tester.md` — системные промпты; делегирование подзадач; выбор субагента по label/типу/фазе; ограничение вложенности.
- **Открытый вопрос:** роли в чате (VL-267, personas) уже покрывают «роли-создатели задач» — subagents оправданы только для фаз. Не дублируем ли?
- **Уверенность:** Medium
- **Статус:** future gate (до появления реальной боли специализации)

### Agent memory (свой)
- **Проблема:** Qwen auto-memory неконтролируем; lessons привязаны к задачам, не к агенту.
- **Что:** `.vibelog/agent-memory/` — markdown (preferences, patterns, facts), auto-extract при завершении фазы, recall в system prompt.
- **Открытый вопрос:** Qwen auto-memory + lessons уже есть — не дублирование ли? Граница: memory — «как работать», lessons — «что узнали из задачи».
- **Уверенность:** Low
- **Статус:** future gate

### Multi-tenant (Уровень 2)
- **Что:** VPS + PostgreSQL (только users/projects/project_users) + JWT + монорепо (`@vibelog/core`, `@vibelog/server`, `@vibelog/web`). Данные проектов — по-прежнему в git, каждый проект = отдельный репозиторий на VPS.
- **Почему отложено:** ломает markdown-нативность, ставит под вопрос Backlog.md-совместимость, месяцы работы. Боль — доступ из поездок, а не многопользовательскость; её закрывает F1.
- **Уверенность:** Low
- **Статус:** future gate

### TSID (multi-author)
- **Что:** Time-Sorted ID вместо sequential (`<prefix>-<13 Crockford base32>`), переключатель `id_format: sequential | tsid` в settings.json, старые ID читаются, миграции нет.
- **Почему отложено:** sequential ломается только при параллельной работе двух авторов. Соавторов нет.
- **Критерий включения:** появился второй контрибьютор.
- **Уверенность:** Low
- **Статус:** future gate

### Guard reasoning-петли
- **Проблема:** DeepSeek V4.1 Flash зацикливается в reasoning-канале до первого tool-call («Now. Emit. Go.» по кругу). Loop detection (VL-251, VL-229) ловит повторы tool-вызовов и промежуточных текстов, но не reasoning.
- **Что:** счётчик повторов одной фразы в reasoning подряд + инъекция «продолжай действие, не рассуждай».
- **Альтернатива (дешевле):** задокументировать «DeepSeek V4.1 Flash не использовать для tool-calling фаз».
- **Уверенность:** Low
- **Статус:** обсуждается

## Передумали (Changed our mind)

- **Decisions в workflow** — решили не добавлять: перегружает промпты, пока не используется. Если понадобится — вернёмся.
- **TSID (multi-author)** — отложено: нет соавторов. Вернёмся, когда появятся.
- **Отдельный `<VL-NN>.meta.json`** — отказались в пользу `.vibelog/billing/<taskId>.json` (append-only массив сессий) при реализации VL-198.
- **`manifest.json` для lock-файла UI Kit** — отказались в пользу `.vibelog/installed.lock.json` (decision-9/10): «manifest» — опись пакета, а здесь фиксируется состояние установки.
- **Отдельный бинарь для `vb`** — отказались: `vb` остаётся алиасом `vibelog`, команды добавляются в существующий CLI.
- **Проверка Tailwind в `vb init`** — отказались: `vb init` универсален и не знает про стек проекта; зависимости проверяет `vb install` по декларации `dependencies` в JSON реестра.
- **Отдельные репозитории на каждый шаблон** — отказались в пользу монорепозитория `Vibelog-md/templates` + `sparse-checkout`.

## Не сейчас (Not now)

- Milestones в workflow — когда будет много релизных задач.
- OpenCode adapter — ждёт готовности внешнего агента; в wizard пункт показывается disabled.
- Claude adapter — «Скоро», в wizard disabled.
- `vb update` для UI Kit — после того как `installed.lock.json` накопит данные в реальных проектах.
- Компоненты на `bits-ui` (Dialog, DropdownMenu) и MAX Bridge — после того как веб-`Button` пройдёт всю цепочку установки.
