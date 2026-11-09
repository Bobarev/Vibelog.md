---
id: VL-380
title: 'vb install: 429 от GitVerse — токен GITVERSE_TOKEN для реестра, ретраи с Retry-After, вынос общего транспорта из дублей с VL-363'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 09:45'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - gitverse
  - registry
  - network
  - refactor
  - bug
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/gitverse-http.ts
  - src/core/gitverse-auth.ts
  - src/core/gitverse-http.test.mjs
  - src/core/registry-fetch.ts
  - src/core/registry-fetch.test.mjs
  - src/core/gitverse-issues.ts
  - src/core/install.ts
lessons:
  - lesson-261
token_usage:
  input: 17435376
  output: 134381
  cache: 16015360
  total: 17569757
  requests: 218
  duration_ms: 1316993
  reasoning: 55245
  by_phase:
    code:
      input: 14998037
      output: 122194
      cache: 13800960
      requests: 172
    close:
      input: 2437339
      output: 12187
      cache: 2214400
      requests: 46
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Реестр компонентов (`vb install`) ходит на GitVerse **без токена** — анонимные запросы жёстко лимитируются. Первый же реальный прогон (`vb install vibelog.md/ui/base` в чистом проекте) упал с HTTP 429 и HTML-страницей «Unauthenticated requests rate-limit exceeded», которую CLI обрезал до 200 символов и показал пользователю как «проверьте доступ к реестру».

**Два дефекта:**

1. **429 не ретраится.** В `registry-fetch.ts` (`fetchTextWithRetries`) ретраи применяются только к 5xx и сетевым ошибкам; 429 попадает в «прочие 4xx» → `kind: 'server'` → сразу ошибка. Но 429 по определению означает «повтори позже», это самый ретраибельный код из всех. Плюс сервер присылает `Retry-After`, который сейчас игнорируется.

2. **Сообщение бесполезно.** `extractErrorMessage` обрезает HTML до 200 символов вместо объяснения причины и действия.

**Корень — отсутствие авторизации.** GitVerse лимитирует неаутентифицированные запросы; токен лимит существенно повышает. При этом механизм токена в проекте **уже есть** (VL-363, `src/core/gitverse-issues.ts`): `GITVERSE_TOKEN` из shell env → `.env` через `readToken`, маскирование через `maskToken`, класс ошибки с кодами выхода. `registry-fetch` его просто не использует.

**Вторая часть — дублирование.** VL-363 создал `gitverse-issues.ts` со своим транспортом, `registry-fetch.ts` (VL-335) — со своим. Сейчас в двух модулях почти построчно повторяются: резолв базового URL с валидацией, класс ошибки, `fetchOnce` с `AbortController`/`clearTimeout`, `readBodyLimited` с лимитом байт, цикл ретраев, `parseJson`, `extractErrorMessage`, `networkErrorCode`, набор ретраибельных кодов. Общими остаются только домен и приёмы — а код скопирован. Любая правка политики ретраев или формата ошибки теперь требует синхронной правки в двух местах, и расхождение проявится как трудноуловимый баг.

**Что нужно:** один общий транспорт GitVerse, в котором различия (хост, заголовки, семантика статусов) параметризованы, и оба клиента — тонкие адаптеры над ним. Плюс токен и корректная обработка 429 в реестре.

**Границы.** Задача не меняет поведение Issues-API (VL-363) и не добавляет новые возможности `vb install`. Не реализует кэш скачанных JSON (вне v1 по doc-25 §1.2). Не создаёт новых env-переменных — используется существующий `GITVERSE_TOKEN`.

**Связанное:** VL-335 (registry-fetch), VL-363 (gitverse-issues, токен, маскирование), ref-26 (Публичный API GitVerse: `Authorization: Bearer`, `Accept: application/vnd.gitverse.object+json;version=1`, формат ошибок), doc-25 §4.3 шаг 3, §5.1, §9.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Создан общий модуль `src/core/gitverse-http.ts` — транспорт GitVerse: резолв базового URL, класс ошибки с `code`/`kind`/`status`/`url`/`attempts`, `fetchOnce` с `AbortController` и `clearTimeout` в `finally`, `readBodyLimited` (лимит по байтам), цикл ретраев, `parseJson`, `extractErrorMessage`, `networkErrorCode`, `maskToken`
- [x] #2 `src/core/registry-fetch.ts` и `src/core/gitverse-issues.ts` переведены на общий транспорт: в них не осталось дублей цикла ретраев, таймаута, чтения тела с лимитом и разбора тела ошибки
- [x] #3 Различия вынесены в параметры/хуки, а не в копии кода: базовый URL и имя env-переменной, набор заголовков (включая `Accept`), метод и тело запроса, функция классификации статуса `classifyStatus(status, text)` → `{kind, message}`
- [x] #4 `registry-fetch` использует токен через существующий `readToken(cwd)` из `gitverse-issues.ts` (переменная `GITVERSE_TOKEN`, приоритет shell env → `.env`); нового имени переменной не появляется
- [x] #5 Заголовок `Authorization: Bearer <token>` отправляется только если токен найден; без токена запрос идёт как раньше (анонимно), поведение не ломается
- [x] #6 Токен нигде не попадает в текст ошибок, логи и итоговый вывод: все сообщения `registry-fetch` проходят через `maskToken`
- [x] #7 HTTP 429 обрабатывается как `kind: 'rate_limited'` и РЕТРАИТСЯ: пауза берётся из заголовка `Retry-After` (секунды или HTTP-дата), при его отсутствии — дефолтная пауза для rate-limit (60 с), число попыток для 429 больше, чем для 5xx
- [x] #8 Сообщение при 429 человекочитаемое, без обрезки HTML: «GitVerse ограничил запросы (HTTP 429), следующая попытка через N с; задай GITVERSE_TOKEN в .env — авторизованные запросы лимитируются выше»
- [x] #9 Прочие 4xx (401, 403) дают отдельные `kind` (`unauthorized`/`forbidden`) с подсказкой проверить токен, а не общее «проверьте доступ к реестру»
- [x] #10 Поведение существующих тестов не изменилось: `registry-fetch.test.mjs` и `gitverse-issues.test.mjs` проходят без правок логики (допустимы только правки импортов/констант)
- [x] #11 Новые тесты: заголовок `Authorization` отправляется при наличии токена и отсутствует без него; 429 с `Retry-After: 2` ретраится через 2 с; 429 без `Retry-After` использует дефолт; исчерпание попыток на 429 даёт `kind: 'rate_limited'` с числом попыток; токен замаскирован в тексте ошибки
- [ ] #12 doc-25 §5.1 обновлён: токен `GITVERSE_TOKEN`, поведение при 429 с `Retry-After`, повышение лимита при авторизации; §9 — риск rate-limit закрыт ссылкой на токен
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Стратегия.** Сначала вынести транспорт, потом добавить токен и 429 — иначе правки придётся делать дважды (в копиях). Порядок шагов отражает это.

**Файлы.** Новый `src/core/gitverse-http.ts` (общий транспорт) + `gitverse-http.test.mjs`; правки `src/core/registry-fetch.ts`, `src/core/gitverse-issues.ts`; тесты обоих модулей; `backlog/docs/doc-25-*` (§5.1, §9).

**Шаг 1. Что именно дублируется (сверить перед выносом).**

1. Сравнить `registry-fetch.ts` и `gitverse-issues.ts` и зафиксировать список общих частей: резолв базы с валидацией http(s), класс ошибки (код/kind/status/url/attempts), `fetchOnce` + `AbortController` + `clearTimeout` в `finally`, `readBodyLimited` (чанки, лимит байт, отмена reader), цикл ретраев, `sleep`, `parseJson`, `extractErrorMessage`, `networkErrorCode`/`RETRYABLE_NETWORK_CODES`, `isSocketHangUp`.
2. Зафиксировать различия: база (`gitverse.ru` vs `api.gitverse.ru`), env-переменная (`VIBELOG_REGISTRY_BASE_URL` vs `VIBELOG_GITVERSE_API_BASE`), заголовки (реестр: `accept` общий; issues: `Accept: application/vnd.gitverse.object+json;version=1`, `Content-Type` для POST), метод (`GET` vs `GET/POST/PATCH`), семантика статусов (реестр: 400 = не найдено; issues: 404 = не найдено), тело ошибки (`{code,message}` vs `{error:{code,message,status}}` и `{message}`), лимит тела (5 МБ vs 1 МБ).

**Шаг 2. Общий транспорт `gitverse-http.ts`.**

3. `GitverseHttpError` — базовый класс с `code` (exit-код), `kind`, `status?`, `url`, `attempts`. Виды (`kind`) — объединение используемых: `unauthorized | forbidden | not_found | bad_request | rate_limited | server | network | timeout | too_large | invalid_json`. Каждый клиент маппит свои kind → свои коды выхода (реестр: всё в 3; issues: `no_token` → 4, `config` → 2).
4. `resolveBase(env, envName, defaultBase)` — общая валидация http(s) и снятие трейлинга `/`. Оба клиента вызывают со своими значениями.
5. `buildUrl(base, path)` — склейка без двойных слэшей; кодирование сегментов оставить в клиентах (у реестра своя логика с сохранением `/` в path).
6. `fetchOnce({ url, method, headers, body, timeoutMs, maxBodyBytes, mask })` — один запрос: `AbortController`, `setTimeout` + `clearTimeout` в `finally`, стриминг тела с подсчётом байт, `mask` применяется ко всем текстам.
7. `requestWithRetries({ ..., classify, retryDelaysMs, rateLimitDelaysMs })` — цикл: попытка → `classify(status, text)` → `{kind, retryable, delayFromHeader?}` → повтор либо ошибка. `classify` — функция, которую передаёт клиент: это единственное место, где живёт семантика статусов, и она остаётся в своём модуле.
8. Общие утилиты: `parseJson(text, url, mask)`, `extractMessage(text)` (с поддержкой обеих форм тела ошибки и заменой HTML на текст-заглушку), `networkErrorCode`, `RETRYABLE_NETWORK_CODES`, `isSocketHangUp`, `sleep`, `maskText`.
9. `maskText` — тонкая обёртка над `maskToken`; токен необязателен (реестр может работать без него).

**Шаг 3. Rate-limit и Retry-After (общая механика).**

10. `parseRetryAfter(headers: Headers): number | null` — поддерживает и секунды, и HTTP-дату (`Retry-After: 120` / `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`); невалидное значение → `null` (используется дефолт).
11. Политика для 429: паузы `[retryAfter ?? 60_000]` и **более длинный список попыток**, чем для 5xx (предложение: 3 попытки с паузами `[retryAfter ?? 60, retryAfter ?? 60]`). Важно: суммарное ожидание не должно быть бесконечным — верхний предел общего времени (например, 3 минуты), после которого ошибка с подсказкой про токен.
12. Политика для 5xx/сетевых — как сейчас: `[500, 1500]`, 2 повтора.

**Шаг 4. Реестр: токен и 429.**

13. `fetchRegistryItem`/`fetchRegistryFile` принимают `cwd` (или `token` опционально) и читают токен через `readToken(cwd)` из `gitverse-issues.ts` — **импорт, не копия**. Токен необязателен: пустая строка → запрос без `Authorization`.
14. Заголовки: `authorization: Bearer <token>` только при непустом токене; `accept` оставить текущий.
15. `classifyStatus` реестра: `400`/`404` → `not_found` (без ретраев); `401` → `unauthorized`, `403` → `forbidden` (подсказка проверить токен); `429` → `rate_limited` (ретраибельно, пауза из `Retry-After`); `5xx` → `server` (ретраибельно); прочие `4xx` → `bad_request`.
16. Сообщение 429: «GitVerse ограничил запросы (HTTP 429), следующая попытка через N с; задай GITVERSE_TOKEN в `.env` — авторизованные запросы лимитируются выше (https://gitverse.ru/settings/tokens)».
17. Все тексты ошибок прогонять через `maskText(text, token)`.

**Шаг 5. Issues: перевод на общий транспорт.**

18. `gitverse-issues.ts` сохраняет публичный API (`GitverseError`, `readToken`, `tokenHint`, `maskToken`, `createIssue`, `listLabels`, `ensureLabels`, `listIssues`) — внешние импортёры (`src/cli/commands/upstream.ts`, `src/mcp/tools.ts`, тесты) не меняются.
19. `GitverseError` становится наследником общегo класса либо алиасом — так, чтобы `kind`/`code`/`status` остались прежними (иначе упадут тесты).
20. Свои различия (Accept, Content-Type, POST/PATCH, формы тела ошибки) передаются в общий транспорт параметрами; собственный цикл ретраев, `fetchOnce`, `readBodyLimited` удаляются.

**Шаг 6. Тесты.**

21. `gitverse-http.test.mjs` (локальный `node:http`-фикстур): таймаут гасит таймер (нет висящего хендла); лимит байт прерывает загрузку; `parseRetryAfter` для секунд, HTTP-даты и мусора; цикл ретраев считает попытки; `maskText` скрывает токен; `extractMessage` для обеих форм тела ошибки и для HTML.
22. `registry-fetch.test.mjs`: `Authorization` отправляется при токене (фикстур проверяет заголовок) и отсутствует без токена; 429 + `Retry-After: 1` → одна пауза 1 с и успех (инъекция пауз, чтобы тест шёл быстро); 429 без `Retry-After` → дефолтная пауза (инъекция); исчерпание попыток на 429 → `kind: 'rate_limited'`, в тексте число попыток и подсказка про токен; токен отсутствует в тексте ошибки.
23. `gitverse-issues.test.mjs`: существующие кейсы проходят без правок логики (только импорты/константы, если понадобится).
24. Проверка отсутствия дублей: grep по репозиторию на `readBodyLimited`, `networkErrorCode`, `RETRYABLE_NETWORK_CODES`, `extractErrorMessage` — каждое имя определено ровно в одном месте.

**Шаг 7. Документация.**

25. doc-25 §5.1: строка про `Authorization: Bearer` из `GITVERSE_TOKEN`, поведение при 429 (`Retry-After`, число попыток, суммарный предел), таблица ответов дополняется строкой 429.
26. doc-25 §9: риск rate-limit закрыт — «токен существенно повышает лимит, без токена возможны 429; CLI ретраит с `Retry-After`».
27. При необходимости — reference на раздел публичного API про лимиты (проверить наличие `ref-26`/`ref-27`/`ref-28`, при отсутствии раздела создать новый).

**Риски.**
- Вынос транспорта — рефакторинг с двумя живыми клиентами; ошибка ломает **и** установку компонентов, **и** баг-репорты. Защита: сначала общий модуль + тесты, затем по одному клиенту с прогоном его тестов, затем удаление дублей.
- `GitverseError` экспортируется наружу (`upstream.ts`, `tools.ts`, тесты) — нельзя терять поля `code`/`kind`/`status`; при наследовании проверить `instanceof` в существующих тестах.
- `readToken` находится в `gitverse-issues.ts`, который тянет `upstream-git.ts`, `settings.ts`, `config.ts` — импорт в `registry-fetch` может создать нежелательную связь. Если цикл/тяжесть мешает — вынести `readToken`/`maskToken`/`tokenHint` в общий модуль (например `gitverse-auth.ts`) и реэкспортировать из `gitverse-issues.ts` для совместимости.
- Rate-limit ретраи могут сделать `vb install` очень медленным при жёстком лимите: нужен верхний предел общего времени и понятное сообщение, иначе команда «висит» минутами без объяснения.
- `Retry-After` в секундах может быть большим (сотни секунд) — обрезать разумным потолком (например 120 с) и сообщать, что ожидание сокращено.
- Тесты с реальными паузами замедлят прогон: паузы обязательно инъектируемые (как `retryDelaysMs` сейчас).

**Проверка.** `pnpm typecheck && pnpm test`; grep-проверка отсутствия дублей; ручной прогон `vb install vibelog.md/ui/base` в чистом проекте **без токена** (ожидается 429 с понятным сообщением) и **с `GITVERSE_TOKEN` в `.env`** (ожидается успешная установка).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 10:01
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/gitverse-http.ts
- src/core/gitverse-auth.ts
- src/core/registry-fetch.ts
- src/core/gitverse-issues.ts
- .vibelog/tmp/vl380-patch.mjs
- .vibelog/tmp/vl380-patch2.mjs
- src/core/registry-fetch.test.mjs
- src/core/gitverse-http.test.mjs
- src/core/install.ts
- I'll start by orienting in the project and reading the two modules to be refactored.
Now I have the full picture. Creating the shared transport module first.
Now updating the transport with a retry-hint hook, then rewriting `registry-fetch.ts`.
Now rewriting `gitverse-issues.ts`'s transport: replace…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 658 с, payload 479342 байт_
Незакоммиченные изменения сохранены в ветку: коммит `d992bbb`.
---
author: @agent
created: 2026-11-09 10:01
---
Фаза code не удалась (код выхода 1): окировок=1, payload последнего запроса=479342 байт (макс 479342), usage={"input_tokens":6778347,"output_tokens":58936,"cache_read_input_tokens":6202368,"total_tokens":6837283,"reasoning_tokens":25044} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-09 10:21
---
Фаза 3 (Code) выполнена. Коммит c343eeb.
**Изменённые файлы:**
- `src/core/gitverse-http.ts` (новый) — общий транспорт GitVerse: `GitverseHttpError` (code/kind/status/url/attempts, вид параметризован строкой, чтобы клиенты сохраняли свои словари), `resolveBase` (валидация http(s), снятие трейлинга `/`, вид ошибки задаёт клиентская фабрика `fail`), `buildUrl`, `fetchOnce` (`AbortController`, `clearTimeout` в `finally`, стриминг тела), `readBodyLimited` (лимит по байтам, отмена reader), `requestWithRetries` (цикл + политики пауз), `parseJson`, `extractErrorMessage` (обе формы тела + снятие HTML-тегов), `parseRetryAfter`, `maskText`, `networkErrorCode`, `RETRYABLE_NETWORK_CODES`, `isSocketHangUp`, `sleep`.
- `src/core/gitverse-auth.ts` (новый) — `GITVERSE_TOKEN_ENV`, `maskToken`, `readToken` (shell env → `.env`), `tokenHint`. Вынесено из `gitverse-issues.ts`, чтобы `registry-fetch` не тянул `upstream-git`/`settings`/`config` (риск из плана снят).
- `src/core/registry-fetch.ts` — тонкий адаптер: `classifyRegistryStatus` (400/404 → `not_found`; 401 → `unauthorized`; 403 → `forbidden`; 429 → `rate_limited` с паузой из `Retry-After` и подсказкой про `GITVERSE_TOKEN`; 5xx → `server`; прочие 4xx → `bad_request`). `Authorization: Bearer` только при непустом токене (`readToken(cwd)`/`token`), заголовок `accept` прежний. Все тексты проходят через `maskToken`. Собственные `fetchOnce`/`readBodyLimited`/цикл ретраев/`networkErrorCode`/`extractErrorMessage` удалены.
- `src/core/gitverse-issues.ts` — публичный API сохранён (`GitverseError` теперь наследник `GitverseHttpError` с прежними kind/code/status; `readToken`/`maskToken`/`tokenHint`/`GITVERSE_TOKEN_ENV` реэкспортированы из `gitverse-auth`). Собственный транспорт удалён, остались `classifyIssueStatus` (в т.ч. 429 → `rate_limited`) и `request` как адаптер (заголовки Accept/Content-Type, POST/PATCH, тело).
- `src/core/install.ts` — `fetchInstallItem`/`fetchInstallContents` передают `cwd: ctx.root`, чтобы реальный `vb install` брал токен из проекта-получателя; `InstallFetchOptions` дополнен `rateLimitDelaysMs`/`rateLimitBudgetMs`/`sleepFn`/`token`.
- `src/core/gitverse-http.test.mjs` (новый, 28 тестов), `src/core/registry-fetch.test.mjs` (+12 тестов VL-380).
**Политика 429:** пауза из `Retry-After` (секунды или HTTP-дата), потолок `MAX_RETRY_AFTER_MS` = 120 с; без заголовка — `DEFAULT_RATE_LIMIT_DELAYS_MS` = [60с, 60с, 60с] (длиннее, чем [500, 1500] для 5xx); суммарный бюджет `RATE_LIMIT_BUDGET_MS` = 180 с, после исчерпания — ошибка `rate_limited` с текстом «GitVerse ограничил запросы (HTTP 429) … следующая попытка через N с; задай GITVERSE_TOKEN в .env — авторизованные запросы лимитируются выше (…/settings/tokens)». HTML-страница rate-limit больше не обрезается до тегов: `extractErrorMessage` снимает разметку.
**Проверки:**
- `pnpm build` (tsc) — чисто.
- `pnpm test` — полный прогон: 201 файл, 3839 тестов passed, 4 skipped (пропуски предсуществующие, в `src/core/frontmatter.test.mjs`, к задаче не относятся). Исключений/`--skip` не было.
- Точечно: `gitverse-http.test.mjs` (28), `registry-fetch.test.mjs` (42), `gitverse-issues.test.mjs` (45), `install*.test.mjs`/`create.test.mjs` (53).
- Проверка отсутствия дублей: `readBodyLimited`, `networkErrorCode`, `RETRYABLE_NETWORK_CODES`, `extractErrorMessage`, `isSocketHangUp` определены ровно в одном файле — `src/core/gitverse-http.ts` (в `registry-fetch.ts` — только реэкспорт `export { extractErrorMessage }` для совместимости тестов VL-335).
- `gitverse-issues.test.mjs` прошёл без правок логики; в `registry-fetch.test.mjs` изменён один кейс: 403 теперь ожидает `kind: 'forbidden'` вместо `'server'` — это целевое поведение AC9, а не регрессия.
**Что осталось (не входит в Фазу 3):** AC12 — обновление `backlog/docs/doc-25-*` §5.1 (токен, 429/`Retry-After`, повышение лимита) и §9 (риск rate-limit закрыт) — по правилам фазы документация пишется в Close. Ручной прогон `vb install vibelog.md/ui/base` без токена (ожидается 429 с понятным сообщением) и с `GITVERSE_TOKEN` (успешная установка) требует реального GitVerse — не выполнялся в worktree.
---
author: @agent
created: 2026-11-09 10:33
---
Фаза Close выполнена. Ветка vb/vl-380 слита в master (2 коммита: c343eeb — транспорт/токен/429, d992bbb — wip-прогресс; merge-коммит --no-ff без конфликтов), worktree удалена (force — единственным untracked был симлинк backlog/references/data, который кладёт оркестратор), ветка vb/vl-380 удалена (была c343eeb).
**Проверка после merge:**
- `pnpm build` (tsc) — чисто (одна сборка за фазу).
- `pnpm test:fast` — полный прогон: 202 файла, 3847 passed, 4 skipped (пропуски предсуществующие — `src/core/frontmatter.test.mjs`, к задаче не относятся). Повторных прогонов не было, падений не было.
- Ранний точечный фильтр по diff: `gitverse-http.test.mjs`, `registry-fetch.test.mjs`, `gitverse-issues.test.mjs` — зелёные.
**Документация (коммит 17e116d):**
- doc-25 §5.1 — строка про `Authorization: Bearer` из `GITVERSE_TOKEN` (shell env → `.env` проекта-получателя, новых переменных нет, токен маскируется), политика ретраев: `429` → пауза из `Retry-After` (секунды/HTTP-дата, потолок 120 с), без заголовка 60 с, до 3 попыток против `[500, 1500]` у `5xx`, суммарный бюджет 180 с; `401`/`403` → отдельные виды с подсказкой проверить токен; добавлена строка `429` в таблицу ответов; отмечено, что транспорт общий с Issues-API (`src/core/gitverse-http.ts`), а HTML-страница ошибки снимается до текста, а не обрезается по 200 символов.
- doc-25 §9 — риск rate-limit закрыт: токен существенно повышает лимит, `429` ретраится с `Retry-After`.
- doc-25 — запись v1.4 в истории версий и пометка в статусе документа.
- CHANGELOG.md (Unreleased → Исправлено) — запись VL-380.
- ref-26 — добавлен тег `rate-limit` (документация Публичного API GitVerse как источник по авторизации/формату ошибок).
**AC:** все 12 закрыты, включая AC12 (документация) — доделан в этой фазе.
**DoD:** 1 «Тесты проходят» — да, полный `pnpm test` зелёный; 2 «Документация обновлена» — да (doc-25 §5.1/§9, v1.4, CHANGELOG, ref-26); 3 «Нет регрессий» — да, единственное изменённое ожидание в `registry-fetch.test.mjs` (403 → `kind: 'forbidden'`) — целевое поведение AC9, отмечено ещё в Фазе 3.
**Lessons:** создан lesson-261 «Считай HTTP 429 ретраибельным кодом с паузой из Retry-After, а не „прочим 4xx“», связан с VL-380 (коммит 7d0477c). Похожих активных уроков про rate-limit не было; lesson-217 (инъектируемый таймаут + `clearTimeout` в `finally`) учтён в реализации, но не дублирован.
**Не выполнено в этой фазе:** ручной прогон `vb install vibelog.md/ui/base` в чистом проекте без токена (ожидается 429 с понятным сообщением) и с `GITVERSE_TOKEN` (ожидается установка) — требует реального GitVerse и сети; в рамках Close не запускался. Код фазы Close не правился.
Файл задачи коммитит framework после записи token_usage рана.
---
<!-- COMMENTS:END -->