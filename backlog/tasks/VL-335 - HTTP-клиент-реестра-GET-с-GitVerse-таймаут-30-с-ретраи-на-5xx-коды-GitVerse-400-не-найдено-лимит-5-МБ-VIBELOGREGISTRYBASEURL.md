---
id: VL-335
title: 'HTTP-клиент реестра: GET с GitVerse, таймаут 30 с, ретраи на 5xx, коды GitVerse (400 = не найдено), лимит 5 МБ, VIBELOG_REGISTRY_BASE_URL'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 01:50'
updated_date: '2026-11-05 02:24'
due_date: ''
labels:
  - vb-cli
  - registry
  - network
  - core
dependencies:
  - VL-333
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/registry-fetch.ts
  - src/core/registry-fetch.test.mjs
lessons:
  - lesson-217
token_usage:
  input: 5260230
  output: 47453
  cache: 4749312
  total: 5307683
  requests: 109
  duration_ms: 1087240
  reasoning: 14889
  by_phase:
    code:
      input: 1395028
      output: 26798
      cache: 1191424
      requests: 26
    close:
      input: 3865202
      output: 20655
      cache: 3557888
      requests: 83
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Вторая задача реализации doc-25 (v1.2, §4.3 шаг 3–4, §5.1). Сетевой слой для `vb install` (и в будущем `vb create`): скачивание JSON элемента реестра с GitVerse.

**Зачем отдельная задача.** Поведение HTTP здесь непривычное и проверено спайком (doc-25 §10). Если зашивать это в `vb install` по ходу, каждая особенность (400 вместо 404, `text/plain` вместо `application/json`, запрет HEAD) будет открываться заново и обрастёт частными обработками. Модуль небольшой, легко тестируется на локальном фикстуре.

**Поведение GitVerse (проверено, doc-25 §10):**

| Ситуация | HTTP | Content-Type | Тело |
|---|---|---|---|
| файл есть | `200` | `text/plain; charset=utf-8` | содержимое файла |
| файла нет | `400` | `application/json;charset=utf-8` | `{"code":4305,"message":"File: <path> not found"}` |
| HEAD-запрос | `403` | `text/html` | — |

Ветка по умолчанию — `master`.

**Границы.** Задача не пишет файлы, не разбирает `alias/repo/name` (это `vb install`) и не валидирует схему элемента по полям бизнес-логики — только «это JSON ожидаемой формы». Не реализует кэш (явно вне v1) и офлайн-режим.

**Почему нужен `VIBELOG_REGISTRY_BASE_URL`.** Шаблон URL зашит в CLI, кэша нет — без подмены базы e2e и юнит-тесты невозможны. Переменная игнорируется в обычной работе и не документируется в `--help`.

**Связанные решения:** doc-25 §5.1 (таблица ответов, ретраи, лимит 5 МБ), §4.3 шаги 3–4, §8 п.9, §10 (спайк); VL-333 (схемы — их валидация вызывается после загрузки).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `fetchRegistryItem(baseUrl, owner, repo, branch, name)` выполняет GET `{base}/api/repos/{owner}/{repo}/raw/branch/{branch}/public/r/{name}.json` и возвращает распарсенный JSON
- [x] #2 Используется только метод GET; HEAD не вызывается ни на одном пути (сервер отвечает 403 — проверено спайком)
- [x] #3 Таймаут запроса — 30 с через `AbortController`; по истечении — ошибка с кодом 3 и текстом про таймаут
- [x] #4 Ретраи: до 2 повторов с паузами 500 мс и 1500 мс только на сетевые ошибки (ECONNRESET, ETIMEDOUT, DNS) и статусы 5xx; на 4xx ретраев нет (тест: 3 попытки при 500, 1 попытка при 400)
- [x] #5 Статус 400 трактуется как «элемент не найден»: в ошибку попадает `message` из тела ответа (`{"code":4305,"message":"File: ... not found"}`), а не сырой HTML
- [x] #6 Валидация ответа выполняется парсингом тела, а не по `content-type`: успешный ответ приходит как `text/plain`, поэтому тип заголовка игнорируется
- [x] #7 Тело ответа > 5 МБ отклоняется до парсинга с понятной ошибкой (защита от подмены реестра)
- [x] #8 Невалидный JSON или несоответствие схеме элемента (обязательные поля) → код 3 с указанием, что именно не прошло валидацию
- [x] #9 `VIBELOG_REGISTRY_BASE_URL` подменяет `https://gitverse.ru` целиком (включая схему и хост); в обычной работе переменная игнорируется и не показывается в `--help`
- [x] #10 Сетевой слой не зависит от домена `gitverse.ru` в коде вызова: базовый URL передаётся параметром/из конфига, нигде не захардкожен второй раз
- [x] #11 Тесты на локальном HTTP-фикстуре (node:http на свободном порту, base URL через env): успех, 400 с телом, 404, 500 с ретраями, таймаут, превышение 5 МБ, невалидный JSON
- [x] #12 Ошибки сети не роняют процесс стектрейсом: сообщение одной строкой с подсказкой действия и корректным кодом выхода
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** Новый модуль `src/core/registry-fetch.ts` + `src/core/registry-fetch.test.mjs` (тест на локальном `node:http`-фикстуре). Переиспользовать: `undici` (уже в `dependencies`, decision-3 — не тащить `node-fetch`), `src/core/components-config.ts` из VL-333 для валидации схемы элемента.

**Шаг 1. Базовый URL и константы.**

1. `DEFAULT_REGISTRY_BASE = 'https://gitverse.ru'`; `resolveRegistryBase(env = process.env): string` — возвращает `env.VIBELOG_REGISTRY_BASE_URL`, если задан и является валидным http(s)-URL (снять трейлинг `/`), иначе дефолт. Невалидное значение → явная ошибка (лучше упасть в тесте, чем молча ходить не туда).
2. Константы: `REQUEST_TIMEOUT_MS = 30_000`, `MAX_BODY_BYTES = 5 * 1024 * 1024`, `RETRY_DELAYS_MS = [500, 1500]`.
3. `buildRawUrl(base, owner, repo, branch, path)` — `{base}/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}` с `encodeURIComponent` на сегментах (owner/repo/branch) и сохранением `/` в `path`.

**Шаг 2. Ошибки.**

4. Класс `RegistryFetchError extends Error` с полями `code: 3`, `kind: 'not_found' | 'timeout' | 'server' | 'network' | 'too_large' | 'invalid_json' | 'invalid_schema'`, `status?: number`, `url: string`. CLI печатает `message` одной строкой с подсказкой.
5. Различать `not_found` (HTTP 400 от GitVerse, либо 404 на других хостах — принимать оба как «не найдено») и `server` (5xx) — от этого зависит, ретраить или нет.

**Шаг 3. Запрос с таймаутом и ретраями.**

6. `fetchOnce(url)` — `undici.request`/`fetch` с `AbortController` и `setTimeout(30_000)`, `signal` в опциях; по `AbortError` → `kind: 'timeout'`. В `finally` — `clearTimeout` (иначе таймер держит процесс).
7. Стриминг тела с подсчётом байт: читать чанками, при превышении `MAX_BODY_BYTES` — прервать чтение и выбросить `kind: 'too_large'` (не буферизовать 5 МБ+, чтобы лимит был реальной защитой).
8. `fetchRegistryItem({ baseUrl, owner, repo, branch, name })` — цикл: попытка → классификация результата:
   - `2xx` → читаем тело, парсим JSON (при ошибке парсинга `kind: 'invalid_json'`), валидируем форму, возвращаем;
   - `400`/`404` → `not_found`, **без ретраев**, текст берётся из `message` тела (`{"code":4305,...}`), если тело парсится; иначе — сырой текст, обрезанный до 200 символов;
   - `4xx` прочие → сразу ошибка, без ретраев;
   - `5xx` / сетевая ошибка (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `socket hang up`) → если есть следующая пауза из `RETRY_DELAYS_MS`, ждём и повторяем; исчерпали — ошибка `kind: 'server' | 'network'`.
9. Никаких HEAD-запросов: в модуле не должно быть вызовов с `method: 'HEAD'` (тест-страховка `expect(source).not.toMatch(/method:\s*['"]HEAD/)`).

**Шаг 4. Валидация формы элемента.**

10. `validateRegistryItem(raw): RegistryItem` — обязательные поля: `name` (строка, совпадает с запрошенным — расхождение считать ошибкой, это признак подмены/опечатки в реестре), `type` (строка из известного набора `registry:ui|registry:lib|registry:hook|registry:component`), `version` (`X.Y.Z`), `dependencies` (массив строк, может быть пустым), `registryDependencies` (массив строк, `<alias>/<repo>/<name>`), `files` (непустой массив `{path, target, type}`).
11. Проверка `target` на выход за корень переносится на этап установки (VL-333/`resolveAliasPath`), здесь только форма: непустая строка, не абсолютный путь, без `..`.
12. Ошибка валидации → `kind: 'invalid_schema'` с перечнем полей, которые не прошли.

**Шаг 5. Тесты (`src/core/registry-fetch.test.mjs`).**

13. Фикстура: `http.createServer` на `port 0`, в тесте — `VIBELOG_REGISTRY_BASE_URL=http://127.0.0.1:<port>`, восстановление env в `afterEach`.
14. Кейсы: успех (200, `text/plain`, валидный JSON) → объект; 400 с телом `{"code":4305,"message":"File: x.json not found"}` → `not_found` + `message` в тексте; 404 → `not_found`; 500 дважды затем 200 → успех после 2 ретраев (проверить и число обращений к серверу); 500 трижды → `server`; 400 → ровно 1 обращение (нет ретраев); таймаут (сервер не отвечает 30 с — заменить константу через инъекцию `timeoutMs` в опциях, иначе тест идёт полминуты); тело > 5 МБ → `too_large` без полной загрузки; невалидный JSON → `invalid_json`; JSON без `files` → `invalid_schema`; `name` не совпадает с запрошенным → `invalid_schema`.
15. Проверить, что `buildRawUrl` корректно кодирует owner/repo с нестандартными символами и не ломает `/` в `path`.

**Риски.**
- Таймаут 30 с в тестах неприемлем — параметр `timeoutMs` должен быть инъектируемым (дефолт 30 000), иначе тест на таймаут идёт полминуты.
- `undici` уже в зависимостях, но `fetch` из Node 20 тоже доступен — выбрать одно и не смешивать; при выборе нативного `fetch` остаётся вопрос лимита байт (нужно читать `response.body` ридером).
- Таймер таймаута без `clearTimeout` держит процесс и ломает `vitest` (висящий хендл) — обязательно `finally`.
- Ошибка `400 = not found` специфична для GitVerse; на локальном фикстуре проверять оба кода, чтобы не завязаться на один.
- Ретраи на 5xx могут маскировать реальную поломку реестра в CI — в сообщении финальной ошибки указывать число попыток.

**Проверка.** `pnpm typecheck && pnpm test`; отдельно — прогон против реального GitVerse публичного репозитория (`bobarev/Vibelog.md`, ветка `master`, путь `package.json`) с проверкой кодов 200 и 400 на несуществующем файле (ручной смоук, не в CI).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 02:05
---
Фаза 3 (Code) выполнена.
**Изменено:** новый модуль `src/core/registry-fetch.ts` + `src/core/registry-fetch.test.mjs` (36 тестов на локальном `node:http`-фикстуре). Коммит `0558b8f`.
**Реализация (doc-25 §4.3 шаги 3–4, §5.1):**
- `DEFAULT_REGISTRY_BASE` / `resolveRegistryBase(env)` — `VIBELOG_REGISTRY_BASE_URL` подменяет базу целиком (валидируется как http(s), трейлинг `/` снимается; невалидное значение → явная ошибка, а не тихий поход не туда);
- константы `REQUEST_TIMEOUT_MS = 30_000`, `MAX_BODY_BYTES = 5 МБ`, `RETRY_DELAYS_MS = [500, 1500]`, `DEFAULT_REGISTRY_BRANCH = 'master'`;
- `buildRawUrl` / `buildRegistryItemUrl` — `{base}/api/repos/{owner}/{repo}/raw/branch/{branch}/public/r/{name}.json`, `encodeURIComponent` на сегментах, `/` в path сохраняется;
- `RegistryFetchError` с `code: 3`, `kind` (`not_found|timeout|server|network|too_large|invalid_json|invalid_schema`), `status`, `url`, `attempts`;
- `fetchOnce` — только GET (undici `fetch`), `AbortController` + таймер, `clearTimeout` в `finally`; тело читается ридером чанками с подсчётом байт, при превышении — `reader.cancel()` и `too_large` (реальная защита, не буферизация 5 МБ+);
- `fetchRegistryItem` — 400 и 404 → `not_found` без ретраев (текст из `message` тела `{"code":4305,...}`, иначе обрезка сырого текста до 200 симв.), прочие 4xx → сразу ошибка, 5xx/сеть → 2 повтора, в финальном тексте число попыток;
- `validateRegistryItem(raw, expectedName)` — проверка формы (name совпадает с запрошенным, type из `registry:ui|lib|hook|component`, version `X.Y.Z`, массивы dependencies/registryDependencies, непустой files с path/target/type, target без абсолюта и `..`), в ошибке перечень всех непрошедших полей;
- `content-type` нигде не читается: успешный ответ GitVerse приходит как `text/plain` — валидация только парсингом тела.
**Проверки:**
- `pnpm typecheck` — чисто;
- `pnpm test` — полный прогон: 173 файла, 3314 тестов passed, 4 skipped (pre-existing), падений нет; исключений/`--exclude` сверх штатного скрипта проекта не было;
- ручной смоук по реальному GitVerse (`bobarev/Vibelog.md`, ветка `master`): GET raw `package.json` → 200 `text/plain; charset=utf-8`, тело — валидный JSON; запрос несуществующего `public/r/nope.json` → 400 с `{"code":4305,"message":"File: public/r/nope.json not found"}`, модуль классифицирует как `not_found` и печатает `message` GitVerse одной строкой. HEAD не используется (тест-страховка `expect(source).not.toMatch(/method:\s*['"]HEAD/)`).
**Что осталось:** DoD «Документация обновлена» не отмечен — по регламенту фазы Code документация (doc-25/CHANGELOG/README) пишется в фазе Close. Потребители модуля (`vb install`, `vb create`) — следующие задачи эпика.
---
author: @agent
created: 2026-11-05 02:10
---
Фаза close не удалась (код выхода 1): блокировок=0, payload последнего запроса=212376 байт (макс 212376), usage={"input_tokens":1397019,"output_tokens":7866,"cache_read_input_tokens":1292288,"total_tokens":1404885,"reasoning_tokens":2629} — статус возвращён к Review.
---
author: @agent
created: 2026-11-05 02:23
---
Фаза Close выполнена. Ветка vb/vl-335 слита в master (1 коммит `0558b8f`, merge `adeac0b`), worktree удалена, ветка удалена.
**Проверки после merge:** `pnpm build` — чисто; ранний точечный прогон `src/core/registry-fetch.test.mjs` — 36/36 passed; полный `pnpm test` — 173 файла, 3314 passed, 4 skipped (pre-existing), падений нет; повторных полных прогонов не было, параллельного vitest в других worktree не обнаружено.
**Документация (DoD п.2):** doc-25 §5.1 — добавлена отметка о реализованном модуле (`src/core/registry-fetch.ts`: база/URL, `RegistryFetchError` с `kind`, таймаут с инъекцией `timeoutMs`, стриминговый лимит 5 МБ, ретраи только на 5xx/сеть, `400`/`404` → `not_found`, `validateRegistryItem`); CHANGELOG.md — запись в Unreleased. Коммиты `71356c0` (docs) и `62294d4` (удаление устаревшего doc-25 v1.1 — актуальна v1.2).
**Lessons:** создан `lesson-217` (таймаут HTTP инъектируемым + `clearTimeout` в `finally`; лимит тела только стримингом; классификация по статусу и `JSON.parse`, не по `content-type`), связан с задачей; коммит `85a149a`.
**DoD:** все три пункта выполнены — тесты проходят, документация обновлена, регрессий нет.
---
<!-- COMMENTS:END -->