---
id: VL-328
title: 'init --web: привести веб-мастер настройки #/setup к возможностям CLI-wizard (VL-324/327) — пресеты шлюзов, каталог моделей с вендорами, TELEGRAM_PROXY, локации секретов, api_mode=responses'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 23:33'
updated_date: '2026-11-04 00:47'
due_date: 2026-03-31
labels:
  - web
  - init
  - wizard
  - ui
  - feature
dependencies:
  - VL-327
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/llm-presets.ts
  - src/core/llm-presets.test.mjs
  - src/core/setup-secrets.ts
  - src/core/setup-check.ts
  - src/core/provider-catalog.ts
  - src/cli/commands/init-wizard.ts
  - src/web/setup-api.ts
  - src/web/setup-api.test.mjs
  - src/web/setup-page-parity.test.mjs
  - src/web/catalog-api.ts
  - web/src/components/setup/api.ts
  - web/src/components/setup/setup-page.tsx
  - web/dist/index.html
  - web/dist/assets/index-DBRNwANH.css
  - web/dist/assets/index-PYUvZz7L.js
lessons:
  - lesson-208
token_usage:
  input: 12702430
  output: 91436
  cache: 11990528
  total: 12793866
  requests: 159
  duration_ms: 1486824
  reasoning: 41150
  by_phase:
    code:
      input: 11320242
      output: 84086
      cache: 10756608
      requests: 126
    close:
      input: 1382188
      output: 7350
      cache: 1233920
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Веб-мастер настройки проекта (`vibelog init --web` → `#/setup`) реализован в VL-210 и с тех пор не менялся, тогда как консольный wizard прошёл VL-320 (переписан на clack), VL-322, VL-324 (хардкод-шлюзы, каталог моделей с вендорами, `api_mode=responses`, дефолт `api_key_env`, ввод ключа с маскировкой, `TELEGRAM_PROXY`, локации секретов `env`/`.env`) и VL-327 (перечитывание env перед проверками, прокси в проверке бота, двухступенчатый выбор модели, чистка локаций). Веб-форма осталась на старом поведении: сырые текстовые поля и устаревшие дефолты.

Ядро (`src/core/setup.ts`, `setup-secrets.ts`, `setup-check.ts`) общее — расходится только фронт (`src/web/setup-api.ts` + `web/src/components/setup/*`).

## Что расходится сейчас

| Возможность CLI-wizard (VL-324/327) | Веб-мастер `#/setup` |
|---|---|
| Шлюз выбирается из трёх хардкод-вариантов | текстовые поля «Провайдер (id)» + «base_url» (`setup-page.tsx:434-448`) |
| `api_key_env` подставляется по шлюзу | пустое поле, вводится руками |
| Модель — автор → модели автора с ценами из каталога | текстовое поле «Модель (id)», каталог не используется |
| `api_mode` по умолчанию `responses` | дефолт `chat` |
| Вендор модели — выбор с ценами или «без вендора» | поля вендора нет вообще (`SetupAnswersPayload.model.vendor` есть, UI не заполняет) |
| Секреты: `env` / `.env` | radio с `env`/`settings`/`both` (`api.ts:66`) |
| `TELEGRAM_PROXY` (пустое не писать) | поля нет |
| Ключ вводится с маскировкой + подтверждение перезаписи | поле есть, подтверждения перезаписи нет |
| Проверки на свежем env, прокси для getMe (VL-327) | POST → ping/getMe могут дать ложный 401/timeout |

## Что делаем

- **Вынести общие константы в ядро** (обязательное условие, иначе фронты снова разъедутся): `LLM_GATEWAY_PRESETS` (routerai / selectel_router / custom), `deriveGatewayId(baseUrl)`, `deriveApiKeyEnv(gatewayId)` — в `src/core/llm-presets.ts` (или дополнение `src/core/setup.ts`); `SECRETS_LOCATIONS` уже в `setup-secrets.ts`. CLI-wizard (`init-wizard.ts`) и веб (`setup-api.ts`, `setup-page.tsx`) импортируют одно и то же.
- **`src/web/setup-api.ts`**: GET отдаёт `gatewayPresets`, `secretsLocations` (только предлагаемые), `bot.proxySet` (факт, без значения), `models.defaultApiMode: 'responses'`; POST принимает `bot.proxy`, `model.vendor`, `secretsOverwrite`, валидирует `gateway.base_url` по пресету (или домену для custom).
- **`web/src/components/setup/setup-page.tsx` + `api.ts`**: заменить текстовые поля шлюза на Select из пресетов (+ поля base_url/gateway для «openai-совместимого»), добавить двухступенчатый дропдаун модели (автор → модели автора) с ценами из `/api/catalog/models` и `/api/catalog/vendors`, поле вендора с «без вендора», `api_mode` дефолт `responses`, поле `TELEGRAM_PROXY`, подтверждение перезаписи ключа, radio секретов из двух пунктов.
- **Проверки**: после `applySetup` в POST `/api/setup` перечитывать `loadProjectEnv(cwd)` (совместно с VL-327 — тогда `handleSetupPing`/`handleSetupCheckBot` видят свежие ключи); `handleSetupCheckBot` передаёт прокси, если задан.
- Тесты API + рендера, doc-6 §1, CHANGELOG.

## Связь с другими задачами

- Зависит от **VL-324** и **VL-327** (ядро, константы, перечитывание env, прокси) — обе должны быть влиты до старта code-фазы, иначе часть правок придётся делать дважды.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: Веб-мастер `#/setup` предлагает те же три хардкод-шлюза, что CLI-wizard: RouterAI (`https://routerai.ru/api/v1`, gateway `routerai`), Selectel ИИ-роутер (`https://api.selectel.ru/aig/v1`, gateway `selectel_router`), OpenAI-совместимый (пользователь вводит base_url, gateway выводится из домена) — вместо свободных текстовых полей «Провайдер (id)» / «base_url»
- [x] #2 AC2: `api_key_env` подставляется автоматически по выбранному шлюзу (`ROUTERAI_API_KEY`, `SELECTEL_ROUTER_API_KEY`, иначе `<GATEWAY_UPPER>_API_KEY`) и остаётся редактируемым
- [x] #3 AC3: Выбор модели — двухступенчатый: сначала автор (сегмент id до `/`), затем модели автора с ценами из каталога (эндпоинты `/api/catalog/models` и `/api/catalog/vendors`, VL-316); обрезка по `CATALOG_SEARCH_LIMIT` не применяется; есть ручной ввод модели и вариант «без вендора»
- [x] #4 AC4: `api_mode` по умолчанию `responses` (сейчас `chat`)
- [x] #5 AC5: В секции секретов остаются ровно два варианта: `env (Приоритет: env → .env)` и `.env (файл в корне проекта)`; значения `settings`/`both` в API остаются принимаемыми для совместимости, но не предлагаются в UI
- [x] #6 AC6: Появился ввод `TELEGRAM_PROXY`: пустое значение не пишется в `.env`; GET `/api/setup` отдаёт факт наличия прокси (без значения), POST принимает `bot.proxy`
- [x] #7 AC7: Ввод ключа LLM записывается в выбранную локацию с явным подтверждением перезаписи (`secretsOverwrite` в UI: если ключ уже задан, спрашиваем), значение нигде не отдаётся наружу кроме `keySet`
- [x] #8 AC8: Проверки в веб-мастере работают на актуальном окружении: после POST `/api/setup` сервер перечитывает env, поэтому «Проверить» (ping LLM, getMe) не даёт ложный 401/timeout; при `TELEGRAM_PROXY` проверка бота идёт через прокси (совместно с VL-327)
- [x] #9 AC9: Веб-форма и CLI-wizard используют одно ядро и один перечень шлюзов/локаций: константы (`LLM_GATEWAY_PRESETS`, `SECRETS_LOCATIONS`, `deriveGatewayId`) живут в `src/core/*` и импортируются обоими фронтами — дублирования нет
- [x] #10 AC10: `pnpm build` чистый (tsc strict + vite build), `pnpm test` зелёный (включая `src/web/setup-api.test.mjs`); обновлены doc-6 (§1 мастер настройки) и CHANGELOG
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

1. **`src/core/llm-presets.ts` (новый)** — единый источник пресетов для обоих фронтов:
   - `LLM_GATEWAY_PRESETS`: `[{ id: 'routerai', label: 'RouterAI (агрегатор моделей)', base_url: 'https://routerai.ru/api/v1', api_key_env: 'ROUTERAI_API_KEY' }, { id: 'selectel_router', label: 'Selectel ИИ-роутер', base_url: 'https://api.selectel.ru/aig/v1', api_key_env: 'SELECTEL_ROUTER_API_KEY' }]` + вариант `custom` (пустые base_url/api_key_env).
   - `deriveGatewayId(baseUrl)` — slug по домену (`api.cloud.ru` → `cloud_ru`), проверка на коллизию с существующими `gateways`.
   - `deriveApiKeyEnv(gatewayId)` — `ROUTERAI_API_KEY` / `SELECTEL_ROUTER_API_KEY` / `<UPPER>_API_KEY`.
   - Сюда же перенести хардкод из `init-wizard.ts` (VL-324) — CLI-wizard начинает импортировать отсюда; поведение не меняется (регресс покрыт тестами VL-324).
2. **`src/web/setup-api.ts`**
   - GET: добавить `gatewayPresets` (из ядра), `secretsLocations` (предлагаемые: `system`, `env` — из `SECRETS_LOCATIONS`, но отфильтрованные от устаревших `settings`/`both`), `bot.proxySet` (факт наличия `TELEGRAM_PROXY`, без значения), дефолт `api_mode` для новой модели — `'responses'`.
   - POST: принять `bot.proxy`, `model.vendor`, `secretsOverwrite`; валидировать `gateway.base_url` (пресет либо, для custom, непустой http(s)); при `custom` — вычислить `gateway.id` через `deriveGatewayId`, если id не передан.
   - `handleSetupCheckBot`: передавать прокси (`process.env.TELEGRAM_PROXY`) в `checkTelegramToken` (общая правка с VL-327).
3. **`web/src/components/setup/api.ts`** — типы: `gatewayPresets`, `secretsLocations: ('system'|'env')[]`, `bot.proxySet`, `bot.proxy`, `secretsOverwrite`, `model.vendor`.
4. **`web/src/components/setup/setup-page.tsx`**
   - Секреты: radio из `state.secretsLocations` (два пункта).
   - Бот: поле `TELEGRAM_PROXY` (`proxy`, placeholder «Enter — не задавать»), подсказка про прокси для getMe.
   - LLM: `Select` шлюза из пресетов; для `custom` — поля `base_url` и `gateway` (id подставляется из домена, редактируем); `api_key_env` подставляется по шлюзу и редактируется; модель — двухступенчатый `Select` (автор → модели автора, подписи с ценами из `/api/catalog/models`), кнопка «ввести вручную», вендор — `Select` из `/api/catalog/vendors` + «без вендора»; `api_mode` дефолт `responses`.
   - Ключ: `Input type=password` + чекбокс «перезаписать существующий ключ» → `secretsOverwrite`.
5. **Проверки** — после успешного POST `/api/setup` сервер вызывает `loadProjectEnv(cwd)`, чтобы последующий `ping`/`check-bot` видел свежие значения (совместно с VL-327).
6. **Тесты**
   - `src/core/llm-presets.test.mjs` (новый): пресеты, `deriveGatewayId` (домены, IP, порт, коллизия), `deriveApiKeyEnv`.
   - `src/web/setup-api.test.mjs`: GET отдаёт пресеты и только два места секретов; POST с `bot.proxy`/`model.vendor`/`secretsOverwrite`; `custom` шлюз с base_url и выведенным id; валидация пустого/битого base_url → 400.
   - `web/src/components/setup/*.test.*` (если есть рендер-тесты; иначе — инвариант через API-тесты).
7. **Документация**: doc-6 §1 (мастер настройки — веб-часть описана наравне с CLI), CHANGELOG (`Unreleased → Добавлено`).

## Проверка

- `pnpm build` (tsc strict + сборка web) — чисто.
- `pnpm test` — зелёный (таргетно `llm-presets`, `setup-api`, `init-wizard` — регресс после переноса констант).
- Ручной прогон: `vibelog init --web` → `#/setup`: выбрать RouterAI → каталог → автор `deepseek` → модель → вендор `baidu` → `api_mode` `responses` → ключ → «Проверить» → «LLM OK»; бот с прокси → «Telegram OK».
- Сверка паритета: один и тот же набор вариантов и дефолтов в CLI (`vibelog init`) и в веб-мастере.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 23:49
---
Фаза code не удалась (код выхода 1): ×2, блокировок=0, payload последнего запроса=273858 байт (макс 273858), usage={"input_tokens":817003,"output_tokens":2337,"cache_read_input_tokens":733696,"total_tokens":819340,"reasoning_tokens":562} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-04 00:22
---
Фаза 3 (Code) выполнена. Коммит d2cb513.
## Что сделано
**Общее ядро (AC9).** Новый `src/core/llm-presets.ts`: `LLM_GATEWAY_PRESETS` (routerai / selectel_router / openai_compatible), `deriveGatewayId`, `deriveApiKeyEnv`, `findGatewayPreset`, `CUSTOM_GATEWAY_PRESET_ID`. Хардкод из `init-wizard.ts` удалён — CLI-wizard импортирует ядро, прежние имена (`gatewayIdFromUrl`, `defaultApiKeyEnv`, `LLM_GATEWAYS`) оставлены тонкими алиасами, чтобы не ломать тесты VL-324. В `core/setup-secrets.ts` добавлены `PROPOSED_SECRETS_LOCATIONS` (system, env) и `SECRETS_LOCATION_LABELS` — один текст пунктов для обоих фронтов; `SECRETS_LOCATIONS` (полный перечень) остался для валидации.
**API (`src/web/setup-api.ts`).** GET отдаёт `gatewayPresets`, `secretsLocations` (только два пункта), `bot.proxySet` (факт, без значения). POST принимает `bot.proxy`, `model.vendor`, `secretsOverwrite`, `gateway.preset`; валидирует base_url (пресет либо непустой http(s) для custom), выводит id custom-шлюза из домена, ловит коллизию с существующим шлюзом. После `applySetup` вызывается `reloadProjectEnv` — снимает ключи, пришедшие из файлов (`fileLoadedEnvKeys`), и грузит заново, иначе dotenv-семантика VL-143 не дала бы обновить уже загруженное значение (AC8). `handleSetupCheckBot` передаёт прокси в `checkTelegramToken`.
**Проверка бота (`src/core/setup-check.ts`).** `checkTelegramToken(token, { proxy })` — при заданном прокси запрос идёт через undici `ProxyAgent` (тот же путь, что у `vibelog bot`).
**Каталог.** `listCatalogModels` получил флаг `full` (без обрезки по `CATALOG_SEARCH_LIMIT`), `/api/catalog/models?full=1` его прокидывает; `resolveGateway` с `allowPreset` отдаёт каталог по пресету ядра, пока шлюз не записан в settings.json (fresh-проект), а `listCatalogModels`/`listCatalogVendors` принимают `gatewayConfig` снаружи.
**UI (`web/src/components/setup/`).** `api.ts`: типы `GatewayPreset`, `SecretsLocationOption`, `bot.proxySet`, `secretsOverwrite`, `model.vendor`, `fetchCatalogModels`/`fetchCatalogVendors`. `setup-page.tsx`: Select шлюза из пресетов (для custom — base_url и редактируемый id), `api_key_env` подставляется по шлюзу и редактируется, двухступенчатый выбор модели (автор → модели автора с ценами), вендор с «без вендора», ручной ввод как фолбэк, `api_mode` по умолчанию `responses`, поле `TELEGRAM_PROXY` (пустое не отправляется), чекбокс «перезаписать существующие секреты», radio секретов из двух пунктов.
## Проверки
- `pnpm build` (tsc strict) — чисто; `pnpm --dir web build` (tsc -b + vite) — чисто, бандл пересобран и закоммичен (web/dist в репозитории, VL-26).
- `pnpm test` — **полный прогон**: 165 файлов, 3148 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`), 0 failed. Исключений/`--skip` не было.
- Новые тесты: `src/core/llm-presets.test.mjs` (6), `src/web/setup-api.test.mjs` (+16 кейсов VL-328: пресеты в GET, две локации, legacy settings/both принимаются, proxySet без значения, bot.proxy и пустой прокси, пресет/custom/битый base_url, vendor, secretsOverwrite, перечитывание env), `src/web/setup-page-parity.test.mjs` (8 статических инвариантов UI — рендер-тестов в проекте нет).
- Регресс CLI-wizard: `src/cli/init-wizard.test.mjs` + `src/core/setup.test.mjs` — 46 passed после переноса констант.
## Что осталось
- **AC10 закрыт частично**: сборка и тесты выполнены, но doc-6 (§1 мастер настройки) и CHANGELOG в фазе Code не обновлялись — по правилам фазы их пишет Close после слияния. Поэтому AC10 не отмечен.
- DoD «Документация обновлена» не отмечен по той же причине (задача Close).
- Ручной прогон в браузере (`vibelog init --web` → выбор RouterAI → каталог → вендор → «Проверить») не выполнялся: требует живого ключа RouterAI и сети, в фазе Code недоступен.
---
author: Pavel Bobarev
created: 2026-11-04 00:28
---
Сверка цены (pricing_guard): Цена вендора выросла у morph (routerai/deepseek/deepseek-v4.1-flash@morph): ввод 5.08 → 4.05 (-20.2%), вывод 44 → 36.47 (-17.1%), кэш 0.46 → 0.69 (+51%). Альтернатива: baidu (-83.4% к текущему тарифу)
---
author: Pavel Bobarev
created: 2026-11-04 00:29
---
Сверка цены (pricing_guard): Цена вендора выросла у morph (routerai/deepseek/deepseek-v4.1-flash@morph): ввод 5.08 → 4.05 (-20.2%), вывод 44 → 36.47 (-17.1%), кэш 0.46 → 0.69 (+51%). Альтернатива: baidu (-83.4% к текущему тарифу)
---
author: @agent
created: 2026-11-04 00:32
---
Фаза Close прервана: конфликт слияния vb/vl-328 → master. `git merge --no-ff vb/vl-328` остановился на CONFLICT (content) в двух файлах:
- UU src/cli/commands/init-wizard.ts
- UU src/core/setup-check.ts
Остальные файлы ветки слиты автоматически (src/core/llm-presets.ts, src/core/llm-presets.test.mjs, src/core/provider-catalog.ts, src/core/setup-secrets.ts, src/web/setup-api.ts, src/web/setup-api.test.mjs, src/web/setup-page-parity.test.mjs, src/web/catalog-api.ts, web/src/components/setup/api.ts, web/src/components/setup/setup-page.tsx, web/dist/*).
Конфликты НЕ резолвились и merge НЕ откатывался (по регламенту фазы) — рабочее дерево главного репозитория остаётся в состоянии незавершённого merge, конфликтные файлы с маркерами на месте.
Что нужно сделать человеку/следующей фазе Code: конфликт возник из-за пересечения правок VL-328 с уже влитыми VL-324/VL-327 в тех же функциях init-wizard.ts (хардкод-пресеты шлюзов) и setup-check.ts (перечитывание env/прокси). Нужно вручную разрешить оба UU-файла, сохранив общее ядро из src/core/llm-presets.ts (импорт констант вместо локального хардкода) и правки VL-327 в setup-check.ts, затем `git add src/cli/commands/init-wizard.ts src/core/setup-check.ts && git commit` (сообщение merge) и повторить Фазу Close. DoD и статус задачи не менялись.
---
author: @agent
created: 2026-11-04 00:32
---
Фаза Close прервана: конфликт слияния vb/vl-328 → master. `git merge --no-ff vb/vl-328` остановился на CONFLICT (content) в двух файлах:
- UU src/cli/commands/init-wizard.ts
- UU src/core/setup-check.ts
Остальные файлы ветки слиты автоматически (src/core/llm-presets.ts, src/core/llm-presets.test.mjs, src/core/provider-catalog.ts, src/core/setup-secrets.ts, src/web/setup-api.ts, src/web/setup-api.test.mjs, src/web/setup-page-parity.test.mjs, src/web/catalog-api.ts, web/src/components/setup/api.ts, web/src/components/setup/setup-page.tsx, web/dist/*).
Конфликты НЕ резолвились и merge НЕ откатывался (по регламенту фазы) — рабочее дерево главного репозитория остаётся в состоянии незавершённого merge, конфликтные файлы с маркерами на месте.
Что нужно сделать человеку/следующей фазе Code: конфликт возник из-за пересечения правок VL-328 с уже влитыми VL-324/VL-327 в тех же функциях init-wizard.ts (хардкод-пресеты шлюзов) и setup-check.ts (перечитывание env/прокси). Нужно вручную разрешить оба UU-файла, сохранив общее ядро из src/core/llm-presets.ts (импорт констант вместо локального хардкода) и правки VL-327 в setup-check.ts, затем `git add src/cli/commands/init-wizard.ts src/core/setup-check.ts && git commit` (сообщение merge) и повторить Фазу Close. DoD и статус задачи не менялись.
---
author: @agent
created: 2026-11-04 00:32
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-328 → master. `git merge --no-ff vb/vl-328` остановился на CONFLICT (content) в двух файлах:
- UU src/cli/commands/init-wizard.ts
- UU src/core/setup-check.ts
Остальные файлы ветки слиты автоматически (src/core/llm-presets.ts, src/core/llm-presets.test.mjs, src/core/provider-catalog.ts, src/core/setup-secrets.ts, src/web/setup-api.ts, src/web/setup-api.test.mjs, src/web/setup-page-parity.test.mjs, src/web/catalog-api.ts, web/src/components/setup/api.t — статус возвращён к Review.
---
author: @agent
created: 2026-11-04 00:47
---
Фаза Close выполнена.
**Merge.** Ветка `vb/vl-328` (2 коммита: d2cb513 feat + dccd2dc merge-резолв конфликтов) уже влита в master — конфликты в `src/cli/commands/init-wizard.ts` и `src/core/setup-check.ts` разрешены коммитом dccd2dc, повторное слияние не потребовалось (`git log master..vb/vl-328` пуст, `MERGE_HEAD` отсутствует).
**Проверки после merge.**
- `pnpm build` — чистый (tsc strict).
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD`: `src/core/llm-presets.test.mjs`, `src/web/setup-api.test.mjs`, `src/web/setup-page-parity.test.mjs` — 44 теста зелёные.
- Полный `pnpm test` — 165 файлов / 3177 тестов passed, 4 skipped, 0 fail (полный прогон один, повторов не было; параллельных vitest не обнаружено).
**Уборка.** Worktree `.vibelog/worktrees/vl-328` удалён (потребовался `--force`: внутри были только untracked `backlog/references/data` — gitignored каталог клона refs, данные не теряются), ветка `vb/vl-328` удалена (`-d`, была слита), `git worktree prune` выполнен.
**DoD:** 1 (Тесты проходят) ✓, 2 (Документация обновлена) ✓ — doc-6 §1 «Мастер настройки» дополнен разделом про паритет веб-мастера с CLI-wizard, CHANGELOG `Unreleased → Добавлено` получил запись VL-328, коммит **46b7c66**; 3 (Нет регрессий) ✓.
**AC10** закрыт: build чистый, тесты зелёные, doc-6 и CHANGELOG обновлены.
**Lessons:** создан lesson-208 («Выноси константы настройки в src/core до правки второго фронта…»), связан с задачей, закоммичен — **c1e523e**.
Примечание: в главном репо остался untracked файл задачи `VL-329` (не подзадача VL-328) — не коммитил.
---
<!-- COMMENTS:END -->