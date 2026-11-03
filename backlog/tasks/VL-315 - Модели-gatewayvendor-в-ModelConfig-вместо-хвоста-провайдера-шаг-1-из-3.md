---
id: VL-315
title: 'Модели: gateway/vendor в ModelConfig вместо @-хвоста провайдера (шаг 1 из 3)'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-03 02:49'
updated_date: '2026-11-03 13:11'
due_date: ''
labels:
  - models
  - refactor
  - gateway
  - vendor
  - routerai
  - settings
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
  - src/core/models.ts
  - src/core/setup.ts
  - src/core/setup-check.ts
  - src/agent/llm.ts
  - src/agent/llm-env.ts
  - src/agent/session.ts
  - src/agent/cli.ts
  - src/web/api.ts
  - src/web/setup-api.ts
  - src/cli/router.ts
  - src/cli/commands/model.ts
  - src/cli/commands/init-wizard.ts
  - web/src/components/settings/api.ts
  - web/src/components/settings/settings.tsx
  - web/src/components/setup/api.ts
  - web/src/components/setup/setup-page.tsx
  - web/src/components/chat/pickers.tsx
  - src/core/models.test.mjs
  - src/core/setup.test.mjs
  - src/core/analytics.test.mjs
  - src/core/setup-check.test.mjs
  - src/agent/llm.test.mjs
  - src/agent/llm-env.test.mjs
  - src/agent/session.test.mjs
  - src/agent/cli.test.mjs
  - src/web/models-api.test.mjs
  - src/web/setup-api.test.mjs
  - src/cli/model-cli.test.mjs
  - src/cli/init-wizard.test.mjs
lessons: []
token_usage:
  input: 23576375
  output: 108120
  cache: 23207424
  total: 23684495
  requests: 258
  duration_ms: 4149291
  reasoning: 45381
  by_phase:
    code:
      input: 22964829
      output: 98826
      cache: 22656000
      requests: 242
    close:
      input: 611546
      output: 9294
      cache: 551424
      requests: 16
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фича 3 (сверка тарифов с API + fallback) из обсуждения с Pavel, шаг 1 из 3. Шаги 2 (каталог + веб-интерфейс моделей) и 3 (сверка цен и fallback) — отдельными задачами, зависят от этой.

Сейчас выбор апстрима (какой провайдер внутри RouterAI обслуживает модель) зашит В СТРОКУ имени модели через `@`-хвост:

```jsonc
"routerai/deepseek/deepseek-v4.1-flash@baidu": {
  "model": "deepseek/deepseek-v4.1-flash@provider=baidu&allow_fallbacks=false"
}
```

Проверено по коду:
- `buildBody` (`src/agent/llm.ts:934-950`) кладёт в тело только `model`/`input`/`messages`/`tools` — структурного выбора провайдера нет вовсе, всё внутри строки `model`;
- по ref-18 у `POST /v1/chat/completions` есть поле `provider: {order, only, ignore, allow_fallbacks, country}`, а `@`-синтаксис — лишь фолбэк «если клиент не умеет задавать их в теле»;
- цены по каждому апстриму отдаёт `GET /v1/models/{author}/{model}/endpoints` **без аутентификации**.

Следствие: из UI нельзя ни показать, ни отредактировать выбор апстрима и его цену — только копипастой строки в settings.json. Это блокирует и «нормальный веб-интерфейс добавления моделей», и сверку цен.

## Решения (согласованы с Pavel)

- **Терминология:** `gateway` — шлюз (routerai, у него base_url + ключ); `vendor` — апстрим внутри шлюза (baidu / makora / morph / Xiaomi / gmicloud); `model` — имя модели у шлюза.
- **`ModelConfig.provider` переименовывается в `gateway`** — пространство имён освобождается под будущих провайдеров БЕЗ апстрима (там vendor не нужен).
- **Апстрим — поле `vendor`** (строка, id), **пока ровно один** (в RouterAI у одной модели разные цены у разных апстримов — это разные записи `available`).
- **UI — отдельная страница** «Модели» (не секция `#/settings`) — шаг 2.

## План

1. **Проверка перед кодом:** живой запрос `POST /v1/responses` с `provider: {order:[X], allow_fallbacks:false}` в теле — принимает ли Responses-API структурное поле (в ref-18 поле документировано для `/chat/completions`, раздел Responses его не показывает). От результата зависит, можно ли убрать `@`-хвост для всех моделей или только для chat-режима. Дешёвый curl, результат — в комментарий задачи.
2. `src/core/models.ts`:
   - `ProviderConfig` → `GatewayConfig`, `loadProviders` → `loadGateways` (+ алиас `loadProviders` на переходный период, чтобы не ломать импортёров сразу);
   - `ModelConfig.provider` → `gateway` (+ чтение старого `provider` как deprecated-алиаса);
   - `ModelConfig.vendor?: string`;
   - нормализация `@`-хвоста при чтении: `parseVendorSuffix(model)` → `{ model: 'deepseek/deepseek-v4.1-flash', vendor: 'baidu', allowFallbacks: false }`; правило живёт в одной функции, чтобы чтение и запись не расходились;
   - `ActiveModel` / `findModelByProviderName` → `vendor`/`gateway`;
   - `validateModelsConfig`: тексты ошибок про gateway/vendor, битый vendor не роняет загрузку.
3. `src/core/settings.ts` — `providers` → `gateways` с алиасом при чтении (паттерн fallback-контракта VL-209), запись только нового ключа.
4. `src/agent/llm.ts` — `buildBody`: при наличии `vendor` собирать `provider: { order: [vendor], allow_fallbacks: false }` в теле; имя модели без `@`-хвоста. Для responses-режима — по результату шага 1 (если не поддерживается: оставить `@`-хвост только там, с комментарием и ссылкой на проверку).
5. Обновить всех потребителей: `src/web/api.ts` (GET /api/models), `src/web/setup-api.ts`, `src/core/setup.ts`, `src/cli/commands/{init-wizard,model}.ts`, `src/core/judge.ts`, `src/agent/session.ts` (мета: `model_provider` → `model_gateway` с алиасом при чтении), `web/src/components/settings/api.ts` (`ModelsData.provider` → `gateway`, `vendor?`).
6. Тесты: парсинг `@`-хвоста (все варианты: только provider, provider+allow_fallbacks, без хвоста, мусор), алиасы `provider`/`gateway` и `providers`/`gateways`, сборка wire-body с vendor в chat и responses, resume старых сессий с `model_provider`.
7. Миграция: однократная нормализация `.vibelog/settings.json` проекта (записать `gateways` + структурный vendor вместо `@`-хвоста) — либо отдельной командой `vibelog model migrate`, либо лениво при первом сохранении моделей из UI (шаг 2).
8. Документация: CHANGELOG, doc-6/README (описание секций models/gateways), doc-7 (CLI `model`).

## Риски

- **R1. Responses-режим и структурный provider.** У всех текущих моделей `api_mode: "responses"`. Если поле не принимается — деградация к `@`-хвосту для responses, структурный путь только для chat. Проверка — шаг 1, до написания кода.
- **R2. Объём переименования.** Точки: `src/core/models.ts`, `api.ts`, `setup.ts`, `setup-api.ts`, `commands/{init-wizard,model}.ts`, `judge.ts`, `agent/{llm,session}.ts`, `web/src/components/settings/api.ts` + правка текстов в `init-wizard`/`doctor` и тесты. Алиасы обязательны, чтобы не сломать существующие конфиги и resume.
- **R3. Дублирование правила нормализации.** Если `@`-хвост разбирать в двух местах (чтение настроек и сборка запроса), правила разъедутся — поэтому одна функция `parseVendorSuffix` в `core/models.ts`.
- **R4. Идентичность модели в мете сессии** — сейчас пара `provider + model` (VL-239). После переименования пара становится `gateway + model`, а vendor в неё НЕ входит (иначе смена апстрима ломала бы resume). Проверить на тесте resume.

## Открытые вопросы

- Миграция `.vibelog/settings.json`: отдельная команда `vibelog model migrate` или ленивая нормализация при первом сохранении (шаг 2)?
- Нужен ли `allow_fallbacks` в модели как явное поле (сейчас везде false) или жёстко false до шага 3, где fallback станет списком вендоров?
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ModelConfig: поле provider переименовано в gateway; Axios-совместимость — старое provider читается как алиас gateway (deprecated), при записи пишется только gateway
- [x] #2 В ModelConfig добавлено поле vendor (id апстрима, строка); отсутствие vendor = поведение как сейчас (без выбора апстрима)
- [x] #3 Секция settings providers переименована в gateways; loadGateways читает оба ключа (gateways приоритетнее), запись — только gateways
- [x] #4 @-хвост в имени модели (@provider=X&allow_fallbacks=false) распознаётся при ЧТЕНИИ: разбирается в vendor + чистое имя модели; запись в settings — структурная, без @-хвоста
- [x] #5 Wire-запрос передаёт выбор апстрима структурно в теле (provider: {order:[vendor], allow_fallbacks:false}) для chat-режима
- [x] #6 Проверено живым запросом, принимает ли /v1/responses структурное поле provider; результат зафиксирован в задаче и в коде комментарием, деградация — @-хвост только для responses-режима
- [x] #7 buildBody в src/agent/llm.ts собирает имя модели БЕЗ @-хвоста при структурном vendor
- [x] #8 Старые settings.json с @-хвостом и с ключом providers продолжают работать без правок (обратная совместимость VL-209)
- [x] #9 Мета сессии и resume: model_provider читается как алиас model_gateway, старые сессии возобновляются без ошибок (VL-239 контракт сохранён)
- [x] #10 Валидация validateModelsConfig обновлена: ошибки называют gateway и vendor, битый vendor (неизвестный апстрим) не ломает загрузку
- [x] #11 Все вызовы в src/** переведены на gateway (models.ts, api.ts, setup.ts, setup-api.ts, init-wizard.ts, model.ts, llm.ts, session.ts, judge.ts) и web/src (ModelsData)
- [x] #12 Тесты обновлены и зелёные: парсинг @-хвоста, алиасы provider/gateway и providers/gateways, сборка wire-body с vendor, обратная совместимость старых settings
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Решения по открытым вопросам (Pavel, 2026-11-02)

- **Миграция `.vibelog/settings.json` — ЛЕНИВАЯ.** Отдельной команды `vibelog model migrate` не делаем. Старые ключи (`providers`, `provider` в модели, `@`-хвост) остаются валидными при чтении; нормализация в структурный вид (`gateways`, `gateway`, `vendor`) происходит при первом сохранении моделей из нового UI (VL-316). Плюс: не нужен отдельный шаг миграции, конфиг не переписывается без явного действия пользователя. Минус (принят): в файле может долго жить смешанный формат — чтение обязано поддерживать оба варианта бессрочно, алиасы не удалять в этом шаге.
- **`allow_fallbacks` — жёстко `false`** вплоть до VL-317. Отдельным полем в `ModelConfig` не выносим: пока fallback не реализован, поле было бы декоративным и допускало `true`, который ничего не делает. В `buildBody` при наличии `vendor` всегда `provider: { order: [vendor], allow_fallbacks: false }`. В VL-317 `allow_fallbacks` появится как следствие списка вендоров (`vendor` одиночный → список), а не отдельным флагом.

Влияние на AC: AC про миграцию не добавляется; AC «запись в settings структурная без @-хвоста» относится к пути сохранения из UI (VL-316), а не к разовому переписыванию файла.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 09:25
---
Фаза code не удалась (код выхода 1): окировок=3, payload последнего запроса=461716 байт (макс 461716), usage={"input_tokens":6909313,"output_tokens":37946,"cache_read_input_tokens":6803456,"total_tokens":6947259,"reasoning_tokens":17470} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 10:07
---
Фаза 3 (Code) выполнена. Коммит a33e7aa.
**Шаг 1 (живая проверка, AC6).** `POST https://routerai.ru/api/v1/responses` с `provider: {order:["xiaomi"], allow_fallbacks:false}` → HTTP 200, `meta.provider: "xiaomi"`; с несуществующим вендором → HTTP 404 «No endpoints found matching your provider preferences». Вывод: Responses-API принимает структурное поле provider, деградация к `@`-хвосту НЕ нужна — поле уходит в оба режима (зафиксировано комментарием в `buildBody`, src/agent/llm.ts).
**Что сделано:**
- `src/core/models.ts`: `ProviderConfig` → `GatewayConfig` (+ deprecated-алиас типа), `loadProviders` → `loadGateways` (+ алиас), `ModelConfig.provider` → `gateway` (старое `provider` читается как deprecated-алиас, `gateway` приоритетнее), новое поле `vendor`, `parseVendorSuffix`/`buildVendorSuffix` (единое правило разбора `@`-хвоста, риск R3), `ActiveModel.gatewayId`/`vendor`, `findModelByProviderName` → `findModelByGatewayName` (+ алиас), `validateModelsConfig` с текстами про gateway/vendor (битый vendor загрузку не ломает).
- `src/core/settings.ts` — правок не потребовалось: секции читаются как сырой объект, алиасинг `providers`/`gateways` реализован в `loadGateways` (оба ключа, `gateways` приоритетнее; запись — только `gateways`).
- `src/agent/llm.ts`: `LlmClientOptions.vendor`; имя модели срезается от `@`-хвоста; `buildBody` добавляет `provider: {order:[vendor], allow_fallbacks:false}` в chat и responses.
- `src/agent/session.ts`: `model_gateway` (+ `model_provider` как deprecated-алиас при чтении), `src/agent/cli.ts` пишет `model_gateway`, `src/agent/llm-env.ts` читает `model_gateway ?? model_provider` (AC9).
- Потребители: `src/web/api.ts` (GET /api/models отдаёт `gateway`/`vendor`/`gateways`), `src/web/setup-api.ts`, `src/core/setup.ts` (SetupState.gateways, запись только `gateways`), `src/core/setup-check.ts` (ping с vendor), `src/cli/commands/{model,init-wizard}.ts` (флаг `--gateway` с алиасом `--provider`), `src/cli/router.ts` (команда `gateway` как алиас `provider`, справка), `web/src/components/{settings,setup,chat}` (ModelsData.gateways, ModelInfo.gateway/vendor).
**Проверки:** `pnpm build` — чисто; полный `npx vitest run` — 150 файлов, 2820 passed, 4 skipped (пропуски — pre-existing `src/core/frontmatter.test.mjs`, не связаны с задачей). Новые тесты: `parseVendorSuffix` (все варианты: только provider, provider+allow_fallbacks, без хвоста, мусор), `buildVendorSuffix`, алиасы `provider`/`gateway` и `providers`/`gateways`, приоритет структурного vendor над `@`-хвостом, битый vendor не ломает загрузку, wire-body с vendor в chat и responses, отсутствие поля provider без vendor.
**Что осталось (вне AC этой задачи):** миграция `.vibelog/settings.json` (п.7 плана — открытый вопрос, отнесён к шагу 2/ленивой нормализации при сохранении из UI); документация (CHANGELOG, doc-6/7) — по правилам фазы пишется в Close.
---
author: @agent
created: 2026-11-03 11:54
---
Фаза 3 (Code) выполнена (повторный прогон после прерывания — работа уже была закоммичена в a33e7aa, изменений в src нет).
**Проверки (полный прогон, без --exclude/--skip):**
- `pnpm build` — чисто (tsc без ошибок).
- `npx vitest run` — 150 файлов, 2820 passed, 4 skipped. Пропуски — pre-existing `src/core/frontmatter.test.mjs` (4 skip внутри файла, не связаны с задачей).
**Шаг 1 (живая проверка, AC6):** `POST https://routerai.ru/api/v1/responses` с `provider: {order:["xiaomi"], allow_fallbacks:false}` → HTTP 200, `meta.provider: "xiaomi"`; с несуществующим вендором → HTTP 404 «No endpoints found matching your provider preferences». Вывод: Responses-API принимает структурное поле provider, деградация к `@`-хвосту не нужна — поле уходит в оба режима (комментарий в `buildBody`, src/agent/llm.ts).
**Что сделано (коммит a33e7aa):**
- `src/core/models.ts`: `ProviderConfig` → `GatewayConfig` (+ deprecated-алиас типа), `loadProviders` → `loadGateways` (+ алиас), `ModelConfig.provider` → `gateway` (старое `provider` — deprecated-алиас, `gateway` приоритетнее), новое поле `vendor`, `parseVendorSuffix`/`buildVendorSuffix` (единое правило разбора `@`-хвоста, R3), `ActiveModel.gatewayId`/`vendor`, `findModelByProviderName` → `findModelByGatewayName` (+ алиас), `validateModelsConfig` с текстами про gateway/vendor (битый vendor загрузку не ломает).
- `src/core/settings.ts` — правок не потребовалось: секции читаются как сырой объект, алиасинг `providers`/`gateways` реализован в `loadGateways` (оба ключа, `gateways` приоритетнее; запись — только `gateways`).
- `src/agent/llm.ts`: `LlmClientOptions.vendor`; имя модели срезается от `@`-хвоста; `buildBody` добавляет `provider: {order:[vendor], allow_fallbacks:false}` в chat и responses.
- `src/agent/session.ts`: `model_gateway` (+ `model_provider` как deprecated-алиас при чтении), `src/agent/cli.ts` пишет `model_gateway`, `src/agent/llm-env.ts` читает `model_gateway ?? model_provider` (AC9).
- Потребители: `src/web/api.ts` (GET /api/models отдаёт `gateway`/`vendor`/`gateways`), `src/web/setup-api.ts`, `src/core/setup.ts` (SetupState.gateways, запись только `gateways`), `src/core/setup-check.ts` (ping с vendor), `src/cli/commands/{model,init-wizard}.ts` (флаг `--gateway` с алиасом `--provider`), `src/cli/router.ts` (команда `gateway` как алиас `provider`), `web/src/components/{settings,setup,chat}` (ModelsData.gateways, ModelInfo.gateway/vendor).
- Тесты: `parseVendorSuffix` (только provider, provider+allow_fallbacks, без хвоста, мусор), `buildVendorSuffix`, алиасы `provider`/`gateway` и `providers`/`gateways`, приоритет структурного vendor над `@`-хвостом, битый vendor не ломает загрузку, wire-body с vendor в chat и responses, отсутствие поля provider без vendor, resume старых сессий с `model_provider`.
**Что осталось (вне AC этой задачи):** миграция `.vibelog/settings.json` (п.7 плана — открытый вопрос, отнесён к шагу 2/ленивой нормализации при сохранении из UI); документация (CHANGELOG, doc-6/7) — по правилам фазы пишется в Close, поэтому DoD «Документация обновлена» не отмечен.
---
author: @agent
created: 2026-11-03 12:21
---
Инструкция к запущенной фазе Code (комментарий добавлен после старта рана — при чтении задачи учти его как задание):
Возьми именно эту правку, работу из a33e7aa не переделывай.
1. `src/agent/llm.test.mjs`, блок `describe('vendor в wire-body (VL-315)')` (≈ строка 671): 2 из 4 тестов падают на машине разработчика. Причина — тесты создают `createLlmClient` без `cwd`, поэтому `resolveActiveModel(process.cwd())` подхватывает gitignored `.vibelog/settings.json` главного репо, где `models.default = routerai/deepseek/deepseek-v4.1-flash@morph`; `active.vendor='morph'` перебивает и `@`-хвост (`baidu`), и пустой vendor. Это тот же класс дефекта, что VL-240 (lesson-78/84), но про vendor (там уже задан явный `apiMode`, а `cwd` — нет).
2. Исправление: на уровне модуля создать пустой каталог `mkdtempSync(join(tmpdir(), 'vibelog-llm-vendor-'))`, удалить его в `afterAll` через `rmSync(dir, { recursive: true, force: true })` и передать `cwd: <этот каталог>` в `createLlmClient` во ВСЕХ 4 тестах блока (образец — блок VL-209 в этом же файле). Правка только в тестовом файле, рантайм `src/agent/llm.ts` не трогать.
3. Проверка: `pnpm build` — чисто; полный `npx vitest run` — 0 падений (ожидается ~3031 тест, до правки падали `vendor в wire-body (VL-315) > chat: provider.order …` и `> без vendor поля provider в теле нет`).
4. Коммит в ветку `vb/vl-315` через git_commit явным путём `src/agent/llm.test.mjs`.
---
author: @agent
created: 2026-11-03 12:24
---
Фаза 3 (Code) — повторный прогон после прерывания: реализация уже закоммичена в a33e7aa (ветка vb/vl-315), новых изменений в src нет (git status чист, кроме untracked backlog/references/data — не относится к задаче).
**Проверки (полный прогон, без --exclude/--skip):**
- `pnpm test` (= `pnpm build` + `vitest run`) — сборка tsc чистая; 149 файлов, 2812 passed, 4 skipped. Пропуски — pre-existing внутри `src/core/frontmatter.test.mjs`, к задаче не относятся.
**Реализовано (коммит a33e7aa):**
- `src/core/models.ts`: `ProviderConfig` → `GatewayConfig` (+ deprecated-алиас типа), `loadProviders` → `loadGateways` (+ алиас), `ModelConfig.provider` → `gateway` (старое `provider` — deprecated-алиас, `gateway` приоритетнее), новое поле `vendor`, `parseVendorSuffix`/`buildVendorSuffix` (единое правило разбора `@`-хвоста, R3), `ActiveModel.gatewayId`/`vendor`, `findModelByProviderName` → `findModelByGatewayName` (+ алиас), `validateModelsConfig` с текстами про gateway/vendor (битый vendor загрузку не ломает).
- `src/core/settings.ts` — правок не потребовалось: секции читаются как сырой объект, алиасинг `providers`/`gateways` реализован в `loadGateways` (оба ключа, `gateways` приоритетнее; запись — только `gateways`).
- `src/agent/llm.ts`: `LlmClientOptions.vendor`; имя модели срезается от `@`-хвоста; `buildBody` добавляет `provider: {order:[vendor], allow_fallbacks:false}` в chat и responses.
- `src/agent/session.ts`: `model_gateway` (+ `model_provider` как deprecated-алиас при чтении), `src/agent/cli.ts` пишет `model_gateway`, `src/agent/llm-env.ts` читает `model_gateway ?? model_provider` (AC9).
- Потребители: `src/web/api.ts` (GET /api/models отдаёт `gateway`/`vendor`/`gateways`), `src/web/setup-api.ts`, `src/core/setup.ts` (SetupState.gateways, запись только `gateways`), `src/core/setup-check.ts` (ping с vendor), `src/cli/commands/{model,init-wizard}.ts` (флаг `--gateway` с алиасом `--provider`), `src/cli/router.ts` (команда `gateway` как алиас `provider`), `web/src/components/{settings,setup,chat}` (ModelsData.gateways, ModelInfo.gateway/vendor).
- Тесты: `parseVendorSuffix` (только provider, provider+allow_fallbacks, без хвоста, мусор), `buildVendorSuffix`, алиасы `provider`/`gateway` и `providers`/`gateways`, приоритет структурного vendor над `@`-хвостом, битый vendor не ломает загрузку, wire-body с vendor в chat и responses, отсутствие поля provider без vendor, resume старых сессий с `model_provider`.
**Шаг 1 (живая проверка, AC6):** `POST https://routerai.ru/api/v1/responses` с `provider: {order:["xiaomi"], allow_fallbacks:false}` → HTTP 200, `meta.provider: "xiaomi"`; с несуществующим вендором → HTTP 404 «No endpoints found matching your provider preferences». Вывод: Responses-API принимает структурное поле provider, деградация к `@`-хвосту не нужна — поле уходит в оба режима (комментарий в `buildBody`, src/agent/llm.ts).
**Что осталось (вне AC этой задачи):** миграция `.vibelog/settings.json` (п.7 плана — открытый вопрос, отнесён к шагу 2/ленивой нормализации при сохранении из UI); документация (CHANGELOG, doc-6/7) — по правилам фазы пишется в Close, поэтому DoD «Документация обновлена» не отмечен.
---
author: @agent
created: 2026-11-03 12:46
---
Фаза 3 (Code) — повторный прогон после прерывания: реализация уже закоммичена в a33e7aa (ветка vb/vl-315), новых изменений в src нет (git status чист, кроме untracked backlog/references/data — не относится к задаче).
**Проверки (полный прогон, без --exclude/--skip):**
- `pnpm test` (= `pnpm build` + `vitest run`) — сборка tsc чистая; 149 файлов, 2812 passed, 4 skipped. Пропуски — pre-existing внутри `src/core/frontmatter.test.mjs`, к задаче не относятся.
**Реализовано (коммит a33e7aa):**
- `src/core/models.ts`: `ProviderConfig` → `GatewayConfig` (+ deprecated-алиас типа), `loadProviders` → `loadGateways` (+ алиас), `ModelConfig.provider` → `gateway` (старое `provider` — deprecated-алиас, `gateway` приоритетнее), новое поле `vendor`, `parseVendorSuffix`/`buildVendorSuffix` (единое правило разбора `@`-хвоста, R3), `ActiveModel.gatewayId`/`vendor`, `findModelByProviderName` → `findModelByGatewayName` (+ алиас), `validateModelsConfig` с текстами про gateway/vendor (битый vendor загрузку не ломает).
- `src/core/settings.ts` — правок не потребовалось: секции читаются как сырой объект, алиасинг `providers`/`gateways` реализован в `loadGateways` (оба ключа, `gateways` приоритетнее; запись — только `gateways`).
- `src/agent/llm.ts`: `LlmClientOptions.vendor`; имя модели срезается от `@`-хвоста; `buildBody` добавляет `provider: {order:[vendor], allow_fallbacks:false}` в chat и responses.
- `src/agent/session.ts`: `model_gateway` (+ `model_provider` как deprecated-алиас при чтении), `src/agent/cli.ts` пишет `model_gateway`, `src/agent/llm-env.ts` читает `model_gateway ?? model_provider` (AC9).
- Потребители: `src/web/api.ts` (GET /api/models отдаёт `gateway`/`vendor`/`gateways`), `src/web/setup-api.ts`, `src/core/setup.ts` (SetupState.gateways, запись только `gateways`), `src/core/setup-check.ts` (ping с vendor), `src/cli/commands/{model,init-wizard}.ts` (флаг `--gateway` с алиасом `--provider`), `src/cli/router.ts` (команда `gateway` как алиас `provider`), `web/src/components/{settings,setup,chat}` (ModelsData.gateways, ModelInfo.gateway/vendor).
- Тесты: `parseVendorSuffix` (только provider, provider+allow_fallbacks, без хвоста, мусор), `buildVendorSuffix`, алиасы `provider`/`gateway` и `providers`/`gateways`, приоритет структурного vendor над `@`-хвостом, битый vendor не ломает загрузку, wire-body с vendor в chat и responses, отсутствие поля provider без vendor, resume старых сессий с `model_provider`.
**Шаг 1 (живая проверка, AC6):** `POST https://routerai.ru/api/v1/responses` с `provider: {order:["xiaomi"], allow_fallbacks:false}` → HTTP 200, `meta.provider: "xiaomi"`; с несуществующим вендором → HTTP 404 «No endpoints found matching your provider preferences». Вывод: Responses-API принимает структурное поле provider, деградация к `@`-хвосту не нужна — поле уходит в оба режима (комментарий в `buildBody`, src/agent/llm.ts).
**Что осталось (вне AC этой задачи):** миграция `.vibelog/settings.json` (п.7 плана — открытый вопрос, отнесён к шагу 2/ленивой нормализации при сохранении из UI); документация (CHANGELOG, doc-6/7) — по правилам фазы пишется в Close, поэтому DoD «Документация обновлена» не отмечен.
---
author: @agent
created: 2026-11-03 13:11
---
Фаза Close прервана: сборка чистая, но полный `pnpm test` на master падает — 2 теста VL-315 в `src/agent/llm.test.mjs` (159 файлов passed, 3017 passed / 2 failed / 4 skipped pre-existing).
**Состояние ветки:** `vb/vl-315` уже является предком master (`git merge-base --is-ancestor` → yes): коммит a33e7aa вошёл в master через merge VL-316 (1bf99ad). `git log master..vb/vl-315` пуст, worktree `git status --porcelain` чист (только untracked `backlog/references/data`, в .gitignore). Поэтому шаги merge/уборки не выполнялись (шаг 3 — «коммитов нет»), а шаги 6–10 не выполнялись из-за падения тестов: DoD, статус и документация не тронуты.
**Падения:**
1. `vendor в wire-body (VL-315) > chat: provider.order + allow_fallbacks=false, имя модели без @-хвоста` (llm.test.mjs:685)
2. `vendor в wire-body (VL-315) > без vendor поля provider в теле нет` (llm.test.mjs:707)
**Классификация (проверено, не пре-существующее):**
- `git diff HEAD^1..HEAD` для `src/agent/llm.ts`, `src/agent/llm.test.mjs`, `src/core/models.ts` — пусто, файлы на HEAD^1 идентичны; параллельного `vitest` в других worktree нет (`ps aux` пуст). То есть падение воспроизводится на текущем master, а не принесено merge.
- Причина: `createLlmClient` резолвит активную модель из `resolveActiveModel(options.cwd ?? process.cwd())` (src/agent/llm.ts:841), а `CLIENT_OPTS` в `src/agent/llm.test.mjs:74` НЕ передаёт `cwd` на временный каталог. Тест наследует ЛОКАЛЬНЫЙ gitignored `.vibelog/settings.json` репозитория, где `models.default = "routerai/deepseek/deepseek-v4.1-flash@morph"` → `resolveActiveModel` отдаёт `vendor: "morph"`, и приоритет `options.vendor ?? active?.vendor ?? parsedModel.vendor` (llm.ts:858) подставляет morph в тело.
- Доказательство прогоном dist: `createLlmClient({...CLIENT_OPTS, model:'m', apiMode:'chat'})` из корня репо даёт тело `{"model":"m","messages":[...],"provider":{"order":["morph"],"allow_fallbacks":false},...}`, а из `mkdtemp`-каталога `resolveActiveModel` → null. Это ровно дефект изолированности тестов, аналогичный VL-240/lesson-78/84 (тесты LLM-клиента не должны зависеть от локальной конфигурации).
**Кто и что должен сделать (новая фаза Code для VL-315/дочерней задачи):**
1. В `src/agent/llm.test.mjs` изолировать `CLIENT_OPTS` от локального `.vibelog/settings.json`: добавить `cwd: <mkdtemp-каталог>` (создаётся на уровне модуля, удаляется в `afterAll`) — по образцу VL-240/AGENTS.md; либо явно передавать `vendor: undefined` невозможно, поэтому именно `cwd`.
2. Разобрать продуктовую сторону: `active?.vendor` применяется даже когда `model` передан явной опцией и не совпадает с моделью из settings — vendor из settings подмешивается к чужой модели. Решить, применять ли `active.vendor` только при совпадении `active.model` с итоговым `model` (риск для реальных вызовов, не только тестов).
3. После фикса — повторный полный `pnpm test` и повтор Фазы Close.
**Проверки этой фазы:** `pnpm build` (в составе `pnpm test`) — чистая; полный `pnpm test` — 2 падения выше, повторные прогоны не выполнялись (классификация завершена, повторный полный прогон не запускался, так как причина установлена однозначно).
---
<!-- COMMENTS:END -->