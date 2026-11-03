---
id: VL-327
title: 'init: проверки после wizard-а не видят только что записанный .env (LLM 401, Telegram timeout), обрезанный список моделей каталога, лишние пункты локации секретов'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 23:28'
updated_date: '2026-11-04 00:06'
due_date: ''
labels:
  - cli
  - init
  - wizard
  - bugfix
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/cli/commands/init.ts
  - src/cli/commands/init-wizard.ts
  - src/core/setup-check.ts
  - src/core/setup-check.test.mjs
  - src/cli/init-wizard.test.mjs
lessons:
  - lesson-206
  - lesson-207
token_usage:
  input: 6631072
  output: 42456
  cache: 5829888
  total: 6673528
  requests: 115
  duration_ms: 899955
  reasoning: 16072
  by_phase:
    code:
      input: 4695082
      output: 29478
      cache: 4028160
      requests: 70
    close:
      input: 1935990
      output: 12978
      cache: 1801728
      requests: 45
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

VL-324 (правки wizard-а `vibelog init`) выполнена, но ручной прогон в реальном проекте выявил три дефекта. Четвёртый пункт (Esc → предыдущий шаг) по решению пользователя НЕ делаем.

### 1. Проверки после wizard-а смотрят устаревшее окружение

`src/cli/commands/init.ts:85` вызывает `loadProjectEnv(cwd)` ДО wizard-а. `loadDotEnv` (`src/bot/env.ts`) пишет в `process.env` только отсутствующие ключи. `applySetup` затем дописывает `ROUTERAI_API_KEY`/`TELEGRAM_PROXY` в `.env`, но `process.env` не обновляется, поэтому:

- `resolveActiveModel` → `buildActiveModel` (`src/core/models.ts`) отдаёт `apiKey: (process.env[api_key_env]) || gateway.api_key || ''` → пустая строка → запрос без `Authorization` → **401 Unauthorized** (наблюдалось в прогоне);
- `checkTelegramToken` (`src/core/setup-check.ts`) ходит через `globalThis.fetch` **без прокси** → прямой доступ к `api.telegram.org` не проходит → **«Telegram не ответил за 10000 мс»** (наблюдалось).

При этом `vibelog bot` и агент потом работают: они вызывают `loadProjectEnv` заново и используют undici `ProxyAgent` (`src/cli/commands/bot.ts:62`).

### 2. В списке моделей каталога видно только первые 50

`src/cli/commands/init-wizard.ts:368` — `models.slice(0, CATALOG_SEARCH_LIMIT)` (50 из ~582 у RouterAI), порядок — как отдал каталог. Пользователь не находит нужную модель. Решение: двухступенчатый выбор — сначала автор модели (сегмент `id` до `/`: `deepseek`, `xiaomi`, …), затем модели этого автора (их десятки, обрезка не нужна).

### 3. В списке локаций секретов остались лишние пункты

`src/cli/commands/init-wizard.ts:455-460` всё ещё предлагает `.vibelog/settings.json (секция env)` и `оба места (.env + settings.json)`. По решению пользователя остаются только `env (Приоритет: env → .env)` и `.env (файл в корне проекта)`. Значения `'settings'`/`'both'` в `SecretsLocation` сохраняются ради старых проектов и флага `--secrets-location`, но wizard их не предлагает.

## Что меняем

- `src/cli/commands/init.ts` — повторный `loadProjectEnv(cwd)` после `applySetup` перед `runChecks`; передача прокси в проверку Telegram.
- `src/core/setup-check.ts` — `checkTelegramToken(token, { proxy })` с undici `ProxyAgent`; отдельное сообщение при пустом `apiKey` в `pingLlm`.
- `src/cli/commands/init-wizard.ts` — двухступенчатый выбор модели (автор → модели автора) в `pickFromCatalog`; удаление двух лишних пунктов из `secretsOptions`.
- Тесты + doc-6 + CHANGELOG.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: После `applySetup` и перед `runChecks` окружение перечитывается (`loadProjectEnv(cwd)`), поэтому только что записанные в `.env` ключи (`ROUTERAI_API_KEY`, `TELEGRAM_PROXY`, `TELEGRAM_BOT_TOKEN`) видны проверкам — LLM-ping уходит с непустым `Authorization`
- [x] #2 AC2: `checkTelegramToken` принимает опциональный прокси и при заданном `TELEGRAM_PROXY` ходит через undici `ProxyAgent` (как `src/cli/commands/bot.ts`); без прокси поведение прежнее
- [x] #3 AC3: Если ключ LLM не найден в окружении (пустой `apiKey`), проверка сообщает «ключ <ENV_NAME> не найден в окружении» вместо вводящего в заблуждение 401
- [x] #4 AC4: Выбор модели из каталога двухступенчатый: сначала автор модели (сегмент `id` до `/`), затем модели выбранного автора — без обрезки по `CATALOG_SEARCH_LIMIT`; при одном авторе шаг пропускается
- [x] #5 AC5: В списке моделей автора видны все модели этого автора с ценами (рубли за 1M токенов) в подписи; при недоступности каталога — прежний фолбэк в ручной ввод
- [x] #6 AC6: В вопросе «Где хранить API-ключи и токены» остаются ровно два пункта: `env (Приоритет: env → .env)` и `.env (файл в корне проекта)`; пункты `.vibelog/settings.json (секция env)` и `оба места` удалены
- [x] #7 AC7: Значение `SecretsLocation = 'settings' | 'both'` остаётся читаемым в `writeSecrets`/`readSettingsEnv` (старые проекты и `--secrets-location settings` не ломаются), но wizard их больше не предлагает
- [x] #8 AC8: `pnpm build` (tsc strict) чистый, `pnpm test` зелёный; обновлены doc-6 (этапы wizard-а) и CHANGELOG
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

1. **`src/cli/commands/init.ts`** (главная причина 401/timeout)
   - После `applySetup(cwd, answers)` и до `runChecks` — повторный `loadProjectEnv(cwd)`. Комментарий: `loadDotEnv` пишет только отсутствующие ключи, поэтому первый вызов (до wizard-а) не видит того, что wizard дописал в `.env`.
   - `runChecks`: прокси для Telegram брать из `process.env.TELEGRAM_PROXY` (после перечитывания он уже там) и передавать в `checkTelegramToken`.
2. **`src/core/setup-check.ts`**
   - `checkTelegramToken(token, opts)` — добавить `opts.proxy?: string`; при заданном прокси использовать `undici` `fetch` + `new ProxyAgent(proxy)` (тот же приём, что `src/cli/commands/bot.ts:62`), иначе `globalThis.fetch`. `undici` — чистый JS, ограничение «без нативных зависимостей» соблюдено.
   - `pingLlm`: если `active.apiKey === ''` — не ходить в сеть, вернуть `ok:false` с текстом «ключ <apiKeyEnv> не найден в окружении: проверьте .env или переменные окружения» (сейчас пользователь видит бесполезный 401).
3. **`src/cli/commands/init-wizard.ts`**
   - `pickFromCatalog`: двухступенчатый выбор. Шаг 1 — авторы: `Array.from(new Set(models.map(m => m.id.split('/')[0])))`, отсортировать, подпись — автор + число моделей. Шаг 2 — модели выбранного автора (фильтр по префиксу `author/`), без `slice`; подпись — остаток id + цены. Если автор один — шаг 1 пропускается. `CATALOG_SEARCH_LIMIT` в этом пути больше не применяется (импорт убрать, если не используется).
   - `secretsOptions`: оставить только `{ value: 'system', label: 'env (Приоритет: env → .env)' }` и `{ value: 'env', label: '.env (файл в корне проекта)' }`; дефолтный индекс — `.env` (1 → 0 после сокращения списка, проверить `askSelect(..., 1)` в двух местах).
4. **Тесты**
   - `src/core/setup-check.test.mjs`: `checkTelegramToken` с `proxy` использует инъектированный fetch (проверка, что прокси-ветка не падает и токен не попадает в текст ошибки); `pingLlm` с пустым `apiKey` → `ok:false` без сетевого вызова (fetch-мок не вызывается).
   - `src/cli/init-wizard.test.mjs` (или существующий файл тестов wizard-а): `pickFromCatalog` — авторы группируются, модели автора не обрезаны, один автор → шаг пропущен; `secretsOptions` содержит ровно два пункта.
   - `src/cli/init.test.mjs` (если есть): после `applySetup` ключ из `.env` виден в `process.env` (регресс на 401).
5. **Документация**: doc-6 (этапы wizard-а: локации секретов — два пункта, выбор модели — автор → модель), CHANGELOG (`Unreleased → Исправлено`).

## Проверка

- `pnpm build` (tsc strict) — чисто.
- `pnpm test` — зелёный (таргетно `setup-check`, `init-wizard`, `init`).
- Ручной прогон в проекте с прокси: `vibelog init` в upgrade-режиме → в конце «LLM OK» и «Telegram OK», а не 401/timeout.
- Ручной прогон выбора модели: список авторов → модели автора (например `deepseek` — все модели, не первые 50).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 23:33
---
Фаза code не удалась (код выхода 1): локировок=0, payload последнего запроса=308727 байт (макс 308727), usage={"input_tokens":1355011,"output_tokens":10250,"cache_read_input_tokens":1197056,"total_tokens":1365261,"reasoning_tokens":4270} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 23:51
---
Фаза 3 (Code) выполнена. Коммит fccadaf.
**Изменено (5 файлов):**
- `src/cli/commands/init.ts` — повторный `loadProjectEnv(cwd)` после `applySetup` перед `runChecks` (AC1) + прокси из `process.env.TELEGRAM_PROXY` передаётся в `checkTelegramToken` (AC2).
- `src/core/setup-check.ts` — `checkTelegramToken(token, { proxy })`: при заданном прокси undici `ProxyAgent` (как `bot.ts`), иначе прежний `globalThis.fetch`; `pingLlm` при пустом `apiKey` не ходит в сеть и возвращает «ключ <ENV_NAME> не найден в окружении…» (AC3).
- `src/cli/commands/init-wizard.ts` — `pickFromCatalog` двухступенчатый: автор (`modelAuthor`) → модели автора без `slice` (AC4), цены в подписи (AC5), при одном авторе шаг пропускается; `CATALOG_SEARCH_LIMIT` из импорта убран; `secretsLocationOptions()` — ровно два пункта, `settings`/`both` убраны из wizard-а, значения `SecretsLocation` и флаг `--secrets-location settings` по-прежнему работают (AC6, AC7).
- `src/core/setup-check.test.mjs` — +5 тестов: пустой `apiKey` → no-network и имя env (регресс на 401), фолбэк `VIBELOG_LLM_API_KEY`, proxy-ветка checkTelegramToken с инъектированным fetch (токен не течёт в ошибку), proxy + ok → username, без proxy — прежнее поведение.
- `src/cli/init-wizard.test.mjs` — +7 тестов: `modelAuthor`, `groupModelsByAuthor` (группировка/сортировка/без обрезки), 70 моделей одного автора не обрезаны, один автор → шаг пропущен, `secretsLocationOptions` ровно 2 пункта без settings/both, `--secrets-location settings` работает, и регресс AC1: ключ, записанный wizard-ом в `.env`, виден проверке LLM (base_url — закрытый локальный порт 127.0.0.1:1, внешней сети тест не касается).
**Проверки:** `pnpm build` (tsc strict) — чисто; таргетно `setup-check` + `init-wizard` — 44 теста зелёные; полный `pnpm test` — 163 файла / 3131 тест + 8 static зелёные (4 pre-existing skip, не связаны с задачей). Полный прогон без `--exclude`/`--skip`.
**Что осталось:** документация (doc-6: этапы wizard-а — две локации секретов, выбор модели автор → модель; CHANGELOG) — по правилам фазы Code не обновлялась, пишется в фазе Close. Ручной прогон `vibelog init` в проекте с прокси (ожидаемо «LLM OK» и «Telegram OK») — требует реального окружения, в агенте недоступен.
---
author: @agent
created: 2026-11-03 23:52
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Review
AC отмечено: 8 из 8
DoD отмечено: 2 из 3
DoD не отмечены (1): 2. Документация обновлена
Файлы (5): src/cli/commands/init.ts, src/cli/commands/init-wizard.ts, src/core/setup-check.ts, src/core/setup-check.test.mjs, src/cli/init-wizard.test.mjs
Фрагмент плана: ## Файлы и порядок шагов 1. **`src/cli/commands/init.ts`** (главная причина 401/timeout) - После `applySetup(cwd, answers)` и до `runChecks` — повторный `loadProjectEnv(cwd)`. Комментарий: `loadDotEnv` пишет только отсутствующие ключи, поэтому первый вызов (до wizard-а) не видит того, что wizard доп…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
---
author: @agent
created: 2026-11-03 23:57
---
Фаза close не удалась (код выхода 1): 3, блокировок=0, payload последнего запроса=189923 байт (макс 189923), usage={"input_tokens":544291,"output_tokens":3960,"cache_read_input_tokens":487680,"total_tokens":548251,"reasoning_tokens":1688} — статус возвращён к Review.
---
author: @agent
created: 2026-11-04 00:06
---
Фаза Close выполнена. Ветка vb/vl-327 (1 коммит fccadaf) слита в master merge-коммитом bc56cf0 без конфликтов; worktree .vibelog/worktrees/vl-327 удалена (в ней оставался только untracked-симлинк backlog/references/data от оркестратора — удаление с --force, данные целы), ветка vb/vl-327 удалена.
Проверка после merge: `pnpm build` (tsc strict) чистый; ранний точечный фильтр по diff merge (src/core/setup-check.test.mjs + src/cli/init-wizard.test.mjs, они же покрывают src/cli/commands/init.ts) — 44 теста зелёные; полный прогон `vitest run` — 164 файла / 3139 тестов passed, 4 skipped (пре-существующие skip), падений нет, повторов не требовалось. Код в фазе не правился.
DoD: 1. Тесты проходят — да (полный прогон); 2. Документация обновлена — да (doc-6: два пункта локации секретов, двухступенчатый выбор модели по автору, раздел про финальные проверки по свежему окружению; CHANGELOG Unreleased → Исправлено), коммит b76b4e1; 3. Нет регрессий — да.
Lessons: lesson-206 (перечитывай окружение после записи .env) и lesson-207 (не обрезай длинный список молча), коммит 3c2dbbc.
---
<!-- COMMENTS:END -->