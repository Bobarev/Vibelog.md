---
id: VL-324
title: 'init (CLI): правки wizard-а — vb по умолчанию, локация секретов env/.env, TELEGRAM_PROXY, выбор шлюза из хардкода с каталогом моделей/вендоров, api_mode=responses, дефолт api_key_env, ввод ключа в .env'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 22:20'
updated_date: '2026-11-03 22:53'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/cli/commands/init-wizard.ts
  - src/cli/init-wizard.test.mjs
  - src/cli/prompt.ts
  - src/cli/prompt.test.mjs
  - src/cli/router.ts
  - src/core/setup.ts
  - src/core/setup.test.mjs
  - src/core/setup-secrets.ts
  - src/core/setup-secrets.test.mjs
  - src/web/setup-api.ts
lessons:
  - lesson-203
  - lesson-204
token_usage:
  input: 8705885
  output: 57032
  cache: 8168448
  total: 8762917
  requests: 123
  duration_ms: 1228657
  reasoning: 21842
  by_phase:
    code:
      input: 6527973
      output: 46498
      cache: 6239744
      requests: 76
    close:
      input: 2177912
      output: 10534
      cache: 1928704
      requests: 47
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`vibelog init` (CLI-режим) — интерактивный wizard настройки проекта: `src/cli/commands/init-wizard.ts` (сбор ответов, VL-320/322, интерактив на `@clack/prompts` через обёртку `src/cli/prompt.ts`), `src/core/setup.ts` (состояние + применение, общее ядро с web `/setup`), `src/core/setup-secrets.ts` (запись секретов). Схема LLM-настроек уже переехала на VL-315: `gateways: { id: { base_url, api_key_env } }` + `models.available[id] = { gateway, vendor?, model, api_mode, pricing }` (без `@`-хвоста в имени модели). Каталог моделей/вендоров с ценами уже есть — `src/core/provider-catalog.ts` (`listCatalogModels`, `listVendors`, `normalizePricing` → рубли за 1M токенов, кэш с TTL).

Пользователь прошёл wizard и зафиксировал список правок по этапам.

## Что меняем

1. **Агенты.** Сейчас `vb` в состоянии `enabled: false` → в чекбоксе не отмечен. Должен быть отмечен по умолчанию (сценарий «других агентов нет»). Сценарий «другие агенты есть» — без изменений.
2. **Где хранить API-ключи.** Пункт `.vibelog/settings.json (секция env)` заменить на `env (Приоритет: env → .env)` — то есть вариант «ничего не писать, пользователь сам заводит переменные окружения»; чтение и так идёт env → .env. От секции `env` в settings.json избавимся позже, когда `.vibelog` уйдёт из `.gitignore`; сейчас старые ключи должны остаться читаемыми.
3. **Telegram.** После токена — новый этап «Прокси бота (TELEGRAM_PROXY)»; пустое значение не записывать (прокси живёт в `.env`).
4. **Шлюз LLM.** Вместо ввода id шлюза текстом — хардкод-список из трёх вариантов:
   - RouterAI — `base_url: https://routerai.ru/api/v1`, `gateway: routerai`;
   - Selectel ИИ-роутер — `base_url: https://api.selectel.ru/aig/v1`, `gateway: selectel_router`;
   - OpenAI-совместимый — пользователь вводит `base_url`, `gateway` выводим из домена (напр. `https://api.cloud.ru/aig/v1` → `cloud_ru`), модель вводит сам.
   Развилка для RouterAI: «загрузить список моделей из каталога» (выбор модели, затем выбор вендора — с ценами) / «ввести вручную» (модель + вендор) / «по умолчанию» (без поля `vendor`). Selectel — модель вручную.
5. **api_mode.** Дефолт `responses` (сейчас `chat`). Рантайм-фолбэк `api_mode ?? 'chat'` в `models.ts`/`llm.ts` НЕ меняем — иначе поедут legacy-проекты и тесты (lesson-78).
6. **Имя env-переменной с ключом.** Дефолт собирать из выбранного шлюза: `ROUTERAI_API_KEY`, `SELECTEL_ROUTER_API_KEY`, иначе `<GATEWAY_UPPER>_API_KEY`.
7. **Ввод ключа.** Если выбрана файловая локация (`.env`) — новый этап: ввод ключа с маскировкой (в clack есть `password`), Enter — пропустить; введённое значение записывается в `.env`. Если ключ уже есть — спросить про перезапись (сейчас `writeEnvFile` молча скипает).

## Ограничения

- Инвариант upgrade-режима сохраняется: wizard не трогает `backlog/tasks/`, `completed/`, `docs/`, `lessons/`, `references/`, `decisions/`, `milestones/`; существующий `gateways.<id>` без `--force` не перезаписывается.
- Не-TTY (пайп, CI, `--yes`) — промпты возвращают дефолты, wizard не падает.
- Никаких нативных зависимостей (README:27) — только чистый JS.
- Значения секретов не попадают в отчёт/лог wizard-а (только имена ключей).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: В чекбоксе агентов `vb` отмечен по умолчанию (сценарий «других агентов нет»); при наличии `.qwen`/`.opencode`/`.claude` поведение прежнее — vb не навязывается поверх выбранных внешних агентов
- [x] #2 AC2: В вопросе «Где хранить API-ключи» пункт `.vibelog/settings.json (секция env)` заменён на `env (Приоритет: env → .env)`; выбор этого пункта не пишет секреты на диск, а только сообщает, какие переменные нужно завести; старые ключи из секции `env` settings.json по-прежнему читаются
- [x] #3 AC3: После токена бота wizard спрашивает `TELEGRAM_PROXY`; непустое значение пишется в выбранную локацию секретов, пустое — не пишется вовсе (ключа нет в `.env`/settings.json)
- [x] #4 AC4: Этап «Шлюз LLM» — выбор из трёх хардкод-вариантов: RouterAI (`https://routerai.ru/api/v1`, gateway `routerai`), Selectel ИИ-роутер (`https://api.selectel.ru/aig/v1`, gateway `selectel_router`), OpenAI-совместимый (base_url вводит пользователь, gateway выводится из домена, напр. `api.cloud.ru` → `cloud_ru`)
- [x] #5 AC5: Для RouterAI развилка работает: «загрузить из каталога» → выбор модели из `listCatalogModels` и вендора из `listVendors` с отображением цен (рубли за 1M токенов); «вручную» → ввод модели и вендора; «по умолчанию» → запись модели без поля `vendor`. При недоступности каталога — понятное сообщение и фолбэк в ручной ввод, wizard не падает
- [x] #6 AC6: `api_mode` по умолчанию `responses` (и в интерактиве, и в `answersFromFlags` при отсутствии флага); рантайм-фолбэк `api_mode ?? 'chat'` в `src/core/models.ts`/`src/agent/llm.ts` не изменён
- [x] #7 AC7: Дефолт имени env-переменной с ключом выводится из шлюза: `ROUTERAI_API_KEY`, `SELECTEL_ROUTER_API_KEY`, иначе `<GATEWAY_UPPER>_API_KEY`; пользователь может его изменить
- [x] #8 AC8: При файловой локации секретов есть этап ввода ключа с маскировкой (clack `password`), Enter — пропустить; введённое значение записывается в `.env`; если ключ уже есть — wizard спрашивает про перезапись и без подтверждения существующее значение не меняет
- [x] #9 AC9: Записанная конфигурация валидна по схеме VL-315: `gateways.<id> = { base_url, api_key_env }`, `models.available[<id>] = { gateway, vendor?, model, api_mode }` без `@`-хвоста в `model`; `resolveModelById` находит созданную модель
- [x] #10 AC10: Не-TTY прогон (`vibelog init --yes` в пустом каталоге) не задаёт вопросов, завершается с кодом 0 и создаёт рабочую конфигурацию; upgrade-режим без `--force` не перезаписывает существующий `gateways.<id>`
- [x] #11 AC11: `pnpm build` (tsc strict) чистый, `pnpm test` зелёный; обновлены doc-6 (раздел `vibelog init`) и CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы и порядок шагов

1. **`src/cli/prompt.ts`** — расширить `PromptSession`: `askPassword(question, def)` на `password` из `@clack/prompts` (в не-TTY — возврат `def`/пустой строки). Clack остаётся изолирован в обёртке.
2. **`src/core/setup.ts`**
   - `readSetupState`: vb → `{ id: 'vb', available: true, enabled: true }`; остальные без изменений.
   - `SetupAnswers.bot`: добавить `proxy?: string`.
   - `SetupAnswers.model`: поля уже соответствуют VL-315 (`gateway`, `vendor`, `model`, `api_mode`) — не меняем.
   - `applySetup`: секреты бота — `TELEGRAM_PROXY` из `answers.bot.proxy` (пустое → не пишем); ключ LLM — писать с учётом перезаписи; `secretsLabel` — новый текст для локации `system`.
   - `formatSetupLog` — отразить локацию `system` и вендора модели.
3. **`src/core/setup-secrets.ts`**
   - `SecretsLocation = 'system' | 'env' | 'settings' | 'both'` (значение `'env'` сохраняет прежний смысл `.env`, переименования нет).
   - `writeSecrets(cwd, secrets, loc, opts?: { overwrite?: boolean })`; `writeEnvFile` при `overwrite` заменяет строку ключа вместо скипа.
   - Шапка `.env` — приоритет `env → .env`.
4. **`src/cli/commands/init-wizard.ts`** — основные правки:
   - Агенты: список опций из `state.agents` (vb теперь `enabled: true` → отмечен).
   - Секреты: опции `env (системные переменные, приоритет env → .env)` / `.env (файл в корне)` / `.vibelog/settings.json (секция env)` / `оба места`; убрать старую подпись.
   - Бот: `askText` токен → `askText('Прокси бота (TELEGRAM_PROXY, Enter — не задавать)', …)` → `chat_id`.
   - LLM: хардкод-список `LLM_GATEWAYS` (routerai / selectel_router / openai-совместимый с полями base_url, gateway, api_key_env по умолчанию).
     - RouterAI → `askSelect('Откуда модель:', ['Загрузить из каталога', 'Ввести вручную', 'По умолчанию (без вендора)'])`; загрузка через `listCatalogModels(cwd, 'routerai')`, затем `listVendors(modelId)` с ценами; при ошибке сети — фолбэк в ручной ввод с сообщением.
     - Selectel → модель вручную.
     - OpenAI-совместимый → `base_url` → gateway из домена (slug: `cloud.ru` → `cloud_ru`) → проверка коллизии с существующим `gateways[id]` → модель вручную.
   - `api_mode`: дефолт в вопросе — `responses`; в `answersFromFlags` при отсутствии флага — тоже `responses`.
   - `api_mode`/`api_key_env` дефолты: `ROUTERAI_API_KEY`, `SELECTEL_ROUTER_API_KEY`, иначе `<GATEWAY_UPPER>_API_KEY`.
   - Шаг ключа (если локация включает файл/систему): `askPassword('API-ключ <ENV_NAME> (Enter — пропустить)')`; если ключ уже есть в `.env` — `askConfirm('Перезаписать?')` → `overwrite: true`.
5. **`answersFromFlags`** — новые флаги `--bot-proxy`, `--vendor`, `--api-key`, `--secrets-location system`; дефолт `api_mode=responses`.
6. **Тесты**: `src/core/setup.test.mjs` (vb enabled, локации, proxy, overwrite, api_key_env дефолты), тесты `src/cli/prompt` (askPassword: маппинг на clack.password, не-TTY → дефолт), тесты wizard-а (`init-wizard`), интеграционный прогон `vibelog init --yes` в temp-каталоге. `provider-catalog.test.mjs` не трогаем.
7. **Документация**: doc-6 (раздел `vibelog init` — все этапы и дефолты), CHANGELOG `Unreleased → Добавлено`.

## Проверка

- `pnpm build` (tsc strict) — чисто.
- `pnpm test` — зелёный; при локальном `models.default` с `api_mode: responses` учитывать lesson-78 (тесты `llm.test.mjs` могут падать по окружению).
- Ручной прогон в TTY на пустом каталоге (fresh) и в этом репозитории (upgrade: `gateways.routerai` есть → скип без `--force`).
- Non-TTY: `vibelog init --yes` не задаёт вопросов, exit 0.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 22:39
---
Фаза 3 (Code) выполнена. Коммит 35b19e1 (ветка vb/vl-324).
Изменено:
- `src/cli/prompt.ts` — в `PromptSession` добавлен `askPassword` (clack `password`, маскировка), не-TTY → дефолт; `password` в seam `ClackPrompts` для тестов.
- `src/core/setup-secrets.ts` — `SecretsLocation = 'system' | 'env' | 'settings' | 'both'` (значение `'env'` сохранило смысл `.env`), экспорт `SECRETS_LOCATIONS`; `writeSecrets(..., opts?: {overwrite})`; `writeEnvFile` при overwrite заменяет строку ключа на месте (не дописывает второй), шапка `.env` — «Приоритет: env → .env»; локация `system` не пишет на диск.
- `src/core/setup.ts` — `readSetupState`: vb `enabled: !hasExternal` (.qwen/.opencode/.claude), т.е. отмечен по умолчанию только когда других агентов нет (AC1); `SetupAnswers.bot.proxy?`, `SetupAnswers.secretsOverwrite?`; `applySetup` пишет `TELEGRAM_PROXY` (пустое — не пишет) и передаёт overwrite; для `system` — предупреждение с именами переменных и никакой записи; `secretsLabel`/`formatSetupLog` — новый текст локации system и вендор модели.
- `src/cli/commands/init-wizard.ts` — `LLM_GATEWAYS` (routerai / selectel_router / openai_compatible), `gatewayIdFromUrl` (`https://api.cloud.ru/aig/v1` → `cloud_ru`), `defaultApiKeyEnv` (`ROUTERAI_API_KEY`, `SELECTEL_ROUTER_API_KEY`, `<GATEWAY_UPPER>_API_KEY`); этап секретов: 4 пункта, первым `env (Приоритет: env → .env)` (ничего не писать); бот: вопрос `TELEGRAM_PROXY` после токена; LLM: выбор шлюза списком, для RouterAI развилка «каталог / вручную / без вендора» через `pickFromCatalog` (адаптер каталога с ценами ₽/1M, при недоступности — сообщение и фолбэк в ручной ввод), для прочих — модель вручную, для OpenAI-совместимого — base_url + вывод gateway из домена + проверка коллизии без `--force`; этап ввода ключа `askPassword` с подтверждением перезаписи; `api_mode` дефолт `responses` (рантайм-фолбэк `?? 'chat'` в models.ts/llm.ts НЕ менялся); `answersFromFlags`: новые `--bot-proxy`, `--vendor`, `--api-key`, `--secrets-overwrite`, `--secrets-location system`, дефолт `api_mode=responses`, api_key_env из шлюза, срез `@`-хвоста у id и model.
- `src/web/setup-api.ts` — общий `SECRETS_LOCATIONS` (добавлена `system`), `bot.proxy`, `secretsOverwrite`.
- `src/cli/router.ts` — help `init` (новые флаги и дефолт responses).
- Тесты: `src/core/setup.test.mjs` (vb enabled/не навязывается при .qwen, локация system, proxy, overwrite, лог с вендором), `src/core/setup-secrets.test.mjs` (system, overwrite в .env и settings), `src/cli/prompt.test.mjs` (askPassword: маппинг на clack.password, не-TTY-дефолт, отмена), `src/cli/init-wizard.test.mjs` (api_mode=responses + api_key_env из шлюза + resolveModelById, vendor и срез `@`-хвоста, --bot-proxy, --secrets-location system, gatewayIdFromUrl/defaultApiKeyEnv, состав LLM_GATEWAYS).
Проверки: `pnpm build` (tsc strict) — чисто; полный `pnpm test` — 163 файла, 3119 passed, 4 skipped (предсуществующие skip в frontmatter.test.mjs), прогон без --exclude/--skip.
Что осталось: AC11 в части документации — doc-6 (раздел `vibelog init`) и CHANGELOG по правилам фазы 3 не обновляются, их пишет фаза Close; сборка и тесты из AC11 зелёные. Ручной TTY-прогон wizard-а в фазе Code не выполнялся (интерактив недоступен в неинтерактивной сессии) — проверять при Close/приёмке.
---
author: @agent
created: 2026-11-03 22:53
---
Фаза Close выполнена. Ветка vb/vl-324 слита в master (1 коммит: 35b19e1 → merge 5587998), worktree .vibelog/worktrees/vl-324 удалена (--force: внутри был только untracked симлинк backlog/references/data на главный репо), ветка vb/vl-324 удалена.
Проверки после merge (все по правилам AGENTS.md):
- `pnpm build` (tsc strict) — чисто, один прогон.
- Ранний точечный фильтр по diff merge (10 файлов, все src/): `vitest run src/cli/init-wizard.test.mjs src/cli/prompt.test.mjs src/core/setup.test.mjs src/core/setup-secrets.test.mjs` — 4 файла, 66 тестов passed.
- Полный `pnpm test` — 163 файла passed, 3119 passed, 4 skipped (предсуществующие skip в frontmatter.test.mjs), без --exclude/--skip. Проверено отсутствие параллельного vitest в других worktree перед прогоном.
Уборка/артефакты:
- Lessons: lesson-203 (дефолт api_mode меняется в wizard/flags, но не рантайм-фолбэк `?? 'chat'`), lesson-204 (локация секретов `system` только сообщает имена переменных) — созданы и связаны с VL-324, закоммичены в 7dd194d.
- Документация: doc-6 (раздел «Мастер настройки» — локации секретов, шлюзы LLM, TELEGRAM_PROXY, ввод ключа, ответвление RouterAI), doc-7 (раздел `init` — сигнатура, таблица флагов, новые `--bot-proxy/--vendor/--api-key/--secrets-overwrite/--secrets-location system`, дефолт responses), CHANGELOG (Unreleased → Добавлено) — коммит 6483a54.
- Ручной TTY-прогон wizard-а не выполнялся (в автоматической сессии нет интерактива); не-TTY-путь (`--yes`) покрыт spawn-тестами и зелёный — сценарий оставлен на пользовательскую приёмку, кодом ошибок не выявлено.
DoD: 3/3 — тесты проходят, документация обновлена, регрессий нет. AC: все 11 отмечены (AC11 закрыт этим коммитом документации при зелёных build/test).
---
<!-- COMMENTS:END -->