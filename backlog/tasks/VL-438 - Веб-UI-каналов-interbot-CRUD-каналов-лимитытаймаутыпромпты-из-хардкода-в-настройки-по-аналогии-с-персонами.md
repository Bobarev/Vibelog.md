---
id: VL-438
title: 'Веб-UI каналов interbot: CRUD каналов + лимиты/таймауты/промпты из хардкода в настройки (по аналогии с персонами)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 18:02'
updated_date: '2026-11-19 19:34'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/comms.ts
  - src/core/interbot-prompts.ts
  - src/bot/interbot.ts
  - src/bot/gate.ts
  - src/bot/handlers.ts
  - src/web/api.ts
  - src/web/comms-api.ts
  - templates/prompts/interbot/incoming.md
  - templates/prompts/interbot/gate.md
  - web/src/lib/use-hash-route.ts
  - web/src/App.tsx
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/channels/api.ts
  - web/src/components/channels/channels-page.tsx
  - web/src/components/channels/channel-detail.tsx
  - src/web/comms-api.test.mjs
  - src/web/channels-page-ui.test.mjs
  - src/core/interbot-config.test.mjs
lessons: []
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 160
  duration_ms: 4013466
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 39
    code:
      input: 0
      output: 0
      cache: 0
      requests: 104
    close:
      input: 0
      output: 0
      cache: 0
      requests: 17
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Запрос: веб-UI для создания и редактирования interbot-каналов + вынос «захаркоженных» параметров (секунды, лимиты ходов, промпты) в настройки, видимые и правимые из UI. По аналогии со страницей «Персоны» (VL-403).

ЧТО ЕСТЬ СЕЙЧАС (проверено):
- web-API для comms НЕТ (в src/web нет ни одного упоминания comms) — CRUD каналов только руками в .vibelog/comms.yaml;
- CommsChannel (src/core/comms.ts:28): id, label, transport, group_id, addressing, approval, admin_chat?; CommsConfig: chats, channels, default_channel, sync_timeout_sec; поле limits канала из doc-32 §2 ЗАДУМАНО, но в интерфейсе ОТСУТСТВУЕТ;
- хардкод: DEFAULT_LIMITS (src/bot/interbot.ts:32: dedupTtlMs 10 мин, botRatePerMin 10, humanRatePerMin 5, globalRunsPerHour 20, maxDepth 2), GATE_TIMEOUT_MS (src/bot/gate.ts), тексты промптов — buildIncomingPrompt (interbot.ts) и промпт гейта (gate.ts) вшиты в код;
- секреты bot_token/proxy лежат в том же comms.yaml рядом с каналами — в UI отдавать НЕЛЬЗЯ.

ОБРАЗЕЦ (VL-403 персоны): отдельный модуль src/web/personas-api.ts + handlePersonasApi в api.ts; роуты web/src/lib/use-hash-route.ts (список точным совпадением ДО детального префикса); сайдбар nav-main.tsx (группа «Настройки»); страницы web/src/components/personas/personas-page.tsx + persona-detail.tsx; промпты — markdown-файлы (шаблоны пакета + проектные), тесты-инварианты по исходникам (personas-page-ui.test).

РЕШЕНИЯ ПО ХРАНЕНИЮ (зафиксировать при реализации):
1. Каналы и глобальные параметры — comms.yaml (секция interbot_limits/params: sync_timeout_sec уже там, default_channel там же; лимиты и gateTimeoutSec — НОВАЯ секция, перекрывает дефолты кода). Зачем там: это конфиг канала-связи, рядом с секретами и группами; readComms уже читается на каждое сообщение → горячее применение бесплатно.
2. Промпты — markdown-файлы .vibelog/prompts/interbot/{incoming,gate}.md (паттерн персон), дефолты — templates/prompts/interbot/ в пакете; плейсхолдеры {channel} и служебные подстановки (цитата/контекст ветки) заменяются сервером при сборке — в файле только шаблон текста.
3. Per-channel limits (doc-32 §2) — доделать: поле CommsChannel.limits с теми же ключами, поверх глобальных.

ГРАНИЦЫ v1: секреты не редактируются из UI (только статус «настроен»); служебные тексты-ответы («Цепочка слишком длинная…», «⏳ Вопрос отправлен…», карточки approval) остаются в коде — их вынос отдельным шагом; approval-кнопки/тикеты не трогаем.

Риски: запись в comms.yaml из веб-процесса при живом боте — файл читается на каждое сообщение, атомарная запись (temp+rename, паттерн tickets.json) исключает порчу; удаление default_channel — guard с предупреждением.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 API: src/web/comms-api.ts (handleCommsApi, паттерн personas-api) — GET/POST/PUT/DELETE /api/comms/channels (CRUD полей id/label/group_id/addressing/approval/admin_chat) + GET/PUT /api/comms/settings (sync_timeout_sec, default_channel, лимиты и таймауты) + GET/PUT /api/comms/prompts; валидация ДО записи, чужие секции comms.yaml/settings.json целы; секреты (bot_token/proxy) НИКОГДА не отдаются в ответах — только признак «настроен»
- [x] #2 Лимиты и таймауты вынесены из хардкода и читаются конфигом: DEFAULT_LIMITS (dedupTtlSec, botRatePerMin, humanRatePerMin, globalRunsPerHour, maxDepth) и GATE_TIMEOUT_MS — из секции comms.yaml (дефолты кода сохраняются при отсутствии секции); поле limits канала (per-channel override, doc-32 §2) — реализовано и применяется поверх глобальных
- [x] #3 Промпты вынесены в markdown-файлы (паттерн промптов персон): .vibelog/prompts/interbot/incoming.md (входящий ран, плейсхолдеры {channel}/{text}/цитата) и gate.md (гейт), дефолты — из шаблонов пакета templates/prompts/interbot/; buildIncomingPrompt и runGate читают файл (fallback на дефолт при отсутствии); настройки применяются горячо (читаются на каждый вызов, без перезапуска бота)
- [x] #4 Фронт: маршрут #/channels (список: id, label, group_id, addressing, approval, admin_chat, признак секретов) и #/channel/<id> (поля + секция «Лимиты и таймауты» + секция «Промпты» с редактированием текста и сбросом на дефолт); порядок маршрутов — «список точным совпадением ДО детального префикса» (паттерн lessons/personas); пункт в сайдбаре в группе «Настройки»
- [x] #5 Секреты: bot_token/proxy не редактируются из UI (только статус «настроен» + подсказка править comms.yaml руками); предупреждение при удалении канала, который является default_channel
- [x] #6 Тесты: comms-api.test.mjs по образцу personas-api.test (CRUD, валидация 400, чужие секции целы, секреты не в ответе), юнит чтения лимитов/промптов с fallback, инварианты фронта по образцу personas-page-ui.test; pnpm test зелёный; живая проверка: создать канал в UI, поменять лимит/таймаут/промпт — бот подхватывает без перезапуска
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-438: Веб-UI каналов interbot + вынос лимитов/таймаутов/промптов из хардкода

Тип: обычная задача (не epic) — план в эту задачу.

## Файлы для изменения

| Файл | Что делаем |
|---|---|
| `src/core/comms.ts` | `CommsChannel.limits?` (per-channel override), `CommsConfig.interbot_limits?` (новая секция comms.yaml: dedup_ttl_sec/bot_rate_per_min/human_rate_per_min/global_runs_per_hour/max_depth/gate_timeout_sec), парсинг в `readChannel`/`readComms`, сериализация в `writeComms` |
| `src/web/comms-api.ts` (новый) | `handleCommsApi(method, url, body, cwd)` — паттерн `personas-api.ts` |
| `src/web/api.ts` | регистрация `handleCommsApi` после ветки персон (`api.ts:561-562`, паттерн `handlePersonasApi`) |
| `src/bot/interbot.ts` | `createDedupCache`/`check(id, ttlMs?)` (сейчас TTL захардкожен `10*60*1000` в `interbot.ts:84`); `dispatchIncoming` передаёт `limits.dedupTtlMs`; `buildIncomingPrompt` + `opts.cwd` и чтение шаблона |
| `src/bot/gate.ts` | `runGate`: таймаут из конфига (`opts.timeoutMs ?? readComms(...).interbot_limits.gate_timeout_sec*1000 ?? GATE_TIMEOUT_MS`, `gate.ts:114`); чтение промпта гейта из файла |
| `src/bot/handlers.ts` | `handlers.ts:1031` `limits: DEFAULT_LIMITS` → мерж конфига: `DEFAULT_LIMITS` ← глобальная секция ← `channel.limits` (cfg уже читается на каждое сообщение в `:961` — горячее применение бесплатно); `:1057` — передать таймаут гейта; `:1107` — передать `cwd` в `buildIncomingPrompt` |
| `templates/prompts/interbot/incoming.md`, `gate.md` (новые) | дефолтные шаблоны пакета (без VL-N id — lesson-140) |
| `web/src/lib/use-hash-route.ts` | Route `'channels' \| 'channel'`; `path === 'channels'` точным совпадением ДО `startsWith('channel/')` (порядок по паттерну `personas`, строки 73/79); `useChannelId()` (паттерн `usePersonaId`, :184) |
| `web/src/App.tsx` | рендер `ChannelsPage`/`ChannelDetail` (паттерн `App.tsx:126-129`) |
| `web/src/components/layout/app-sidebar.tsx` | пункт «Каналы» в группе «Настройки» (`:92-108`, рядом с «Персоны»), `activeWhen: ["channels", "channel"]` |
| `web/src/components/channels/api.ts`, `channels-page.tsx`, `channel-detail.tsx` (новые) | слой данных + список + детальная страница (паттерн `web/src/components/personas/*`) |
| `src/web/comms-api.test.mjs`, `src/web/channels-page-ui.test.mjs` (новые) + юнит в `src/bot/interbot.test.mjs`/`src/bot/gate.test.mjs`/`src/core/comms.test.mjs` | тесты по AC6 |
| doc-32 (документ) | описать новую секцию comms.yaml, промпты-файлы, веб-API |

## Порядок действий

1. **core/comms.ts**: поля `limits` (канал) и `interbot_limits` (глобальная секция) → чтение+валидация (positive-int, enum-ключи; битые ключи — warn и отбрасывание, как `readChannel`) + сериализация в `writeComms`. Плюс экспорт `resolveInterbotLimits(cwd, channel)` = мерж DEFAULT_LIMITS ← конфиг ← channel.limits (lesson-208: константы в core).
2. **bot**: dedup TTL из лимитов (`check(messageId, ttlMs)` — hot, т.к. limits берутся из свежего cfg на каждое сообщение); `dispatchIncoming` — `limits.dedupTtlMs`; `handlers.ts:1031` — мерж-лимиты вместо `DEFAULT_LIMITS`; `runGate` — таймаут из конфига (fallback `GATE_TIMEOUT_MS=8000`); `buildIncomingPrompt(question, channel, {cwd, ...})` и `runGate` читают шаблон: проектный `.vibelog/prompts/interbot/<name>.md` → пакетный `templates/prompts/interbot/<name>.md` (резолв через `new URL('../../templates/prompts/interbot/', import.meta.url)` — паттерн `personas.ts:213`) → встроенный текст (текущие строки кода — fallback для тестов без cwd). Плейсхолдеры `{channel}`, `{text}` (вопрос), `{quote}`/`{context}`/`{history}` — подстановка сервером; пустая опциональная секция → блок (заголовок+плейсхолдер) удаляется. **Якоря тестов сохранить** (lesson-3): `<no_answer>`, `[DECISION]`, `backlog/`, `.env`, `Вопрос:\n<текст>`, порядок «цитата < Вопрос:», отсутствие секций без opts; гейт: `read_only`/`react`/`ТОЛЬКО одно слово`/`@автор` (gate.test.mjs:128-137).
3. **src/web/comms-api.ts** (регистрация в `api.ts` после `:562`):
   - `GET/POST /api/comms/channels`, `GET/PUT/DELETE /api/comms/channels/:id` — CRUD id/label/group_id/addressing/approval/admin_chat/limits. Валидация ДО записи (id-regex как `PERSONA_ID_RE`, group_id integer≠0, enums mention|all и auto|admin) → 400.
   - `GET/PUT /api/comms/settings` — sync_timeout_sec, default_channel, interbot_limits (лимиты+gate_timeout_sec).
   - `GET/PUT /api/comms/prompts` — чтение/запись `.vibelog/prompts/interbot/{incoming,gate}.md`; DELETE-сброс на дефолт (удаление проектного файла, fallback на пакетный).
   - Секреты: в ответах только `secrets: {bot_token: bool, proxy: bool}` («настроен»), значения НИКОГДА.
   - Запись comms.yaml: **не** слепой `writeComms` (он сериализует только известные поля, `comms.ts:157-186` — чужие top-level секции упали бы), а read-modify-write сырого YAML: `parseYaml` всего файла → мутация только целевых ключей → `stringifyYaml` → атомарно temp+rename mode 0600 (паттерн `writeComms`/`writeTextAtomic`). Секреты при этом нетронуты.
   - default_channel guard: PUT settings требует существования канала; DELETE канала=default → 409 с предупреждением (фронт показывает подтверждение).
4. **Фронт**: маршруты → `web/src/components/channels/*` (список: id, label, group_id, addressing, approval, admin_chat, бейдж секретов; клик → детальная: поля + секция «Лимиты и таймауты» + секция «Промпты» с редактированием и сбросом на дефолт; правка секретов — только подсказка «правится в .vibelog/comms.yaml»).
5. **Тесты**: comms-api.test.mjs (CRUD, 400-валидация, чужие секции comms.yaml целы, секреты не в ответах, 409 на default-канал), channels-page-ui.test.mjs (инварианты по исходникам — паттерн personas-page-ui.test.mjs), юнит мержа лимитов и fallback промптов (cwd без файла → пакетный → встроенный).
6. **Документация**: doc-32 — секция `interbot_limits`, per-channel `limits`, промпты-файлы, веб-страница «Каналы».

## Как проверять

- `pnpm build && pnpm test` (полный прогон — DoD); для фронта перед живой проверкой `pnpm web:build`.
- Живая проверка (AC6): создать канал в UI → поменять лимит/таймаут/промпт → убедиться, что бот подхватывает без перезапуска (cfg читается на каждое сообщение `handlers.ts:961`; промпт/таймаут гейта — на каждый вызов).

## Риски

- **Запись в comms.yaml при живом боте**: атомарный temp+rename (читатель не видит полузаписанный файл); read-modify-write по сырому YAML сохраняет чужие секции и секреты (writeComms этого не гарантирует).
- **Комментарии в comms.yaml** при перезаписи теряются (мини-парсер `yaml.ts` их пропускает) — как и у существующего writeComms; зафиксировать в doc-32.
- **Dedup TTL не подключён к limits** сейчас (хардкод в `createDedupCache`) — легко пропустить (lesson-281: проверить, что настройка доходит до точки применения — юнит «конфиг → check()»).
- **Якоря промптов** (lesson-3/278): новые шаблоны не должны ломать interbot.test/gate.test; пустые опциональные секции не должны оставлять голые заголовки.
- Секреты в UI-состоянии: аккуратно — в ответах API только булевы флаги.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `CommsChannel` без поля limits; CommsConfig: chats/channels/default_channel/sync_timeout_sec | `src/core/comms.ts:28-47` |
| `writeComms` пишет только известные поля (чужие секции потерял бы) | `src/core/comms.ts:157-186` |
| `DEFAULT_LIMITS` (dedupTtlMs 10мин и др.) | `src/bot/interbot.ts:32-39` |
| TTL dedup захардкожен в `check()` независимо от limits | `src/bot/interbot.ts:84` |
| `GATE_TIMEOUT_MS=8000`, дефолт таймаута в runGate | `src/bot/gate.ts:43`, `:114` |
| `limits: DEFAULT_LIMITS` в dispatch | `src/bot/handlers.ts:1031` |
| cfg= readComms на каждое сообщение (горячее чтение) | `src/bot/handlers.ts:961` |
| вызовы гейта/промпта: `runGate(deps.cwd, …, {})`, `buildIncomingPrompt(text, channel, …)` | `src/bot/handlers.ts:1057`, `:1107` |
| `buildIncomingPrompt` собирает parts, «Вопрос:» в конце | `src/bot/interbot.ts:402-448` |
| `buildGatePrompt` — встроенный текст | `src/bot/gate.ts:65-86` |
| регистрация persona-API (образец для comms-API) | `src/web/api.ts:549-562` |
| `handlePersonasApi`, валидация до записи, атомарная запись файлов | `src/web/personas-api.ts:91-114`, `:331+` |
| шаблон-резолв проект→пакет через `new URL('…templates/prompts/personas/')` | `src/web/personas.ts:213-215`, `:449-462` |
| порядок роутов список-до-детального | `web/src/lib/use-hash-route.ts:73` до `:79`; Route union `:40-41` |
| группа «Настройки» сайдбара с персонами | `web/src/components/layout/app-sidebar.tsx:92-108` |
| рендер страниц персон в App | `web/src/App.tsx:126-129` |
| промпты проекта коммитятся (`!prompts/**`) | `src/core/gitignore.ts:99-101` |
| `stringifyYaml` умеет вложенные объекты/массивы-объекты | `src/core/yaml.ts:268-330` |
| web-API для comms отсутствует | grep `/api/comms` и `comms` в web/src — 0 совпадений |
| тест-инварианты фронта читают исходники (без DOM) | `src/web/personas-page-ui.test.mjs:1-15` |

## Не проверено (предположения) — проверить первым шагом Code

1. **Атомарная запись + чужие секции**: гипотеза, что read-modify-write сырого YAML через `parseYaml`/`stringifyYaml` сохраняет неизвестные top-level ключи. Проверить: юнит «файл с лишней секцией → PUT settings → секция цела». Расхождение → писать мутацию текстово или расширить writeComms опцией preserve.
2. **Dedup TTL**: предполагаю, что `dispatchIncoming` может передать `limits.dedupTtlMs` в `check()` без ломки сигнатуры (optional-параметр). Проверить грепом всех вызовов `dedup.check` и тестов `interbot.test.mjs`; если тесты зовут `check(id)` — optional-параметр безопасен, иначе адаптировать тесты.
3. **CORS server.ts:84 не содержит PUT** — предполагаю, не страшно (same-origin запросы без preflight; персоны уже работают на PUT). Проверить: PUT /api/comms/settings из UI доводится до хендлера (иначе дописать PUT в Allow-Methods).
4. **.vibelog/prompts/interbot/** — предполагаю, попадает под `!prompts/**` без новых правок gitignore. Проверить: `git check-ignore .vibelog/prompts/interbot/incoming.md` → должен НЕ игнорироваться (как helper.md).
5. **Форма ответа GET /api/comms/prompts**: предполагаю `{incoming: {text, source}, gate: {…}}`; уточнить по факту удобства фронта, не ломая AC.
6. **Первый прогон**: `pnpm build && pnpm test:fast` на изменённых файлах до полного прогона.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 18:40
---
Фаза 2 (Plan) выполнена. Тип: обычная задача (не epic). План записан в Implementation Plan: ~16 файлов (4 новых модуля: src/web/comms-api.ts, web/src/components/channels/* (3 файла), templates/prompts/interbot/{incoming,gate}.md; 2 новых тест-файла), из них правки — src/core/comms.ts, src/bot/{interbot,gate,handlers}.ts, src/web/api.ts, web/src/lib/use-hash-route.ts, App.tsx, app-sidebar.tsx, doc-32. Ключевые решения: (1) comms.yaml пишется read-modify-write сырого YAML (parseYaml→мутация целевых ключей→stringifyYaml, temp+rename 0600) — writeComms сериализует только известные поля и потерял бы чужие секции/секреты; (2) лимиты мержатся DEFAULT_LIMITS ← секция interbot_limits ← channel.limits на каждое сообщение (cfg уже читается в handlers.ts:961 — горячее применение бесплатно); (3) промпты: проектный .vibelog/prompts/interbot/ → пакетный templates/prompts/interbot/ → встроенный текст (fallback для тестов), якоря interbot.test/gate.test сохраняются; (4) секреты в API — только булевы флаги «настроен». Проверено по коду: таблица 15 утверждений с файл:строка; предположений 6 (первый шаг Code: юнит сохранности чужих секций, подключение dedupTtlMs к check(), PUT в CORS Allow-Methods server.ts:84, gitignore prompts/interbot). Риски: запись comms.yaml при живом боте (атомарность), потеря комментариев YAML при перезаписи, дрейф якорей промптов. DoD-пункты не отмечались (фаза планирования).
---
author: @agent
created: 2026-11-19 19:11
---
Фаза 3 (Code) выполнена. Изменено 18 файлов, коммит edd8160.
Реализация по плану:
1) core/comms.ts: секция interbot_limits + per-channel limits (readChannel/readComms/writeComms с валидацией), mergeInterbotLimits (DEFAULT ← глобальная ← канал, dedup_ttl_sec→мс), gateTimeoutMs, patchCommsRaw — атомарный read-modify-write СЫРОГО YAML (temp+rename 0600), сохраняющий чужие top-level секции и secrets (предположение 1 плана подтверждено юнитом: custom_section c nested переживает PUT).
2) core/interbot-prompts.ts (отдельный модуль — существующий prompts.ts принадлежит экспериментам VL-296): цепочка проект → пакет → встроенная строка, рендер плейсхолдеров, пустые секции удаляют строку. Шаблоны templates/prompts/interbot/{incoming,gate}.md; антидрейф файл↔строка закрыт тестом.
3) bot: dedup TTL из конфига (check(id, ttlMs) — необязательный параметр, все прежние вызовы без изменений; предположение 2 подтверждено), buildIncomingPrompt/buildGatePrompt читают шаблон на каждый вызов (handlers передаёт cwd), runGate — таймаут из comms.yaml с fallback GATE_TIMEOUT_MS, handlers:1031 — мерж лимитов из уже прочитанного cfg (горячо).
4) web/comms-api.ts + регистрация в api.ts: CRUD каналов, settings, prompts; валидация ДО записи (400), секреты только булевыми признаки (PUT молча игнорирует токены из тела), 409-guard default-канала → force=1 после предупреждения.
5) Фронт: маршруты channels/channel (список точным совпадением ДО префикса), сайдбар «Настройки», страницы со секциями «Лимиты и таймауты» и «Промпты» (правка+сброс), статус секретов без полей ввода.
Проверки: pnpm build зелёный; web typecheck (tsc --noEmit) чистый; полный pnpm test — 4676 тестов, зелёный. В первом полном прогоне один флаки (chat-thread-persona.test.mjs, общий state при isolate:false) — после классификации (изолированно 14/14) повторный полный прогон зелёный; исключённых тест-файлов НЕТ. Новые тесты: comms-api.test (26), interbot-config.test (17), channels-page-ui.test (15). Предположение 4 (gitignore prompts/interbot) подтверждено: файл не игнорируется. Предположение 3 (CORS PUT) — не требовало правки: same-origin запросы без preflight, PUT доходит (покрыто тестами handleApi).
AC отмечены 1-5. AC6 отмечен частично НЕ отмечен: юнит и инварианты написаны, полный прогон зелёный, но «живая проверка» (создать канал в UI при работающем боте и убедиться в горячем подхвате) требует запущенного бота и сделана не была — осталось для Close/ручной проверки. DoD «Тесты проходят» и «Нет регрессий» отмечены; DoD «Документация обновлена» НЕ отмечен — doc-32 по правилам фазы не обновляется (пишет Close).
---
author: @agent
created: 2026-11-19 19:34
---
Фаза Close выполнена. Статус: Done. Коммиты: feat edd8160 (18 файлов — весь код Фазы 3 уже в master, остатков не было), docs 03c3c3a (CHANGELOG.md + doc-32). Не закоммичено: нет — подзадач нет (parentTaskId: []), refs/lessons отсутствуют, файл задачи коммитит framework.
Проверки после коммита: pnpm build зелёный; полный pnpm test — зелёный (exit 0), исключённых тест-файлов НЕТ, повторных полных прогонов не требовалось; ранний точечный фильтр до полного прогона — 58/58 (comms-api 26, interbot-config 17, channels-page-ui 15). Рабочий процесс параллельного агента (VL-178) не пересекался с файлами VL-438 — коммит остатков не потребовался.
Документация: запись VL-438 в CHANGELOG (Unreleased → Добавлено); doc-32 обновлён: §2 — строка limits помечена «реализовано», §3 — пример comms.yaml дополнен секциями interbot_limits и per-channel limits + новая подсекция «Лимиты, таймауты и промпты из конфига (VL-438)» (ключи, мерж, горячее применение, цепочка промптов проект→пакет→код, веб-API/страницы, запрет секретов в UI, атомарный patchCommsRaw и потеря комментариев при перезаписи), §8 — «доска каналов» зачёркнута как выполненная (кнопки approval в веб-чате остались в будущих шагах).
AC6: отмечен частично — юниты и инварианты написаны, полный прогон зелёный, но живая проверка (создать канал в UI при работающем боте и убедиться в горячем подхвате лимита/таймаута/промпта) не выполнялась — остаётся внешней проверкой владельца (прецеденты: AC8 VL-433, AC6 VL-436). Уроки не зафиксированы: нового знания сверх диффа и коммитов нет — все предположения плана (patchCommsRaw, optional ttlMs, CORS PUT, gitignore prompts) подтверждены и описаны в отчёте Фазы 3 и коде.
---
<!-- COMMENTS:END -->