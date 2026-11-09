---
id: VL-358
title: 'Веб: Sync на #/references обновляет и кэш url/doc-референсов, плюс поштучный sync на странице референса'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 16:35'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - web
  - references
dependencies: []
milestone: v1.13
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/references-sync-api.ts
  - src/web/api.ts
  - src/web/server.ts
  - src/web/references-api.test.mjs
  - web/src/components/references/api.ts
  - web/src/components/references/references-page.tsx
  - web/src/components/references/reference-detail.tsx
  - web/dist/index.html
  - web/dist/assets/index-BpLFZ6qI.js
  - web/dist/assets/index-DCADnp00.js
lessons:
  - lesson-257
token_usage:
  input: 14124648
  output: 97015
  cache: 12665856
  total: 14221663
  requests: 153
  duration_ms: 2584764
  reasoning: 59172
  by_phase:
    plan:
      input: 2456177
      output: 34571
      cache: 2043904
      requests: 32
    code:
      input: 9647327
      output: 54582
      cache: 8841216
      requests: 83
    close:
      input: 2021144
      output: 7862
      cache: 1780736
      requests: 38
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: кнопка Sync на странице `#/references` вызывает `POST /api/references/sync` → `syncReferenceRepos(cwd)`, которая только клонирует отсутствующие каталоги для `type: repo`. Markdown-кэш url/doc-референсов (`refreshReferenceCache`/`syncReferenceCaches`, VL-194/VL-291) через веб недоступен вовсе — пользователь жмёт Sync, получает «клонировано: 0, пропущено: N, ошибок: 0» и решает, что кнопка сломана (в VL-194 явно записано «web-UI не расширен — вне объёма плана»). Обновить кэш сейчас можно только из CLI: `vibelog reference sync ref-N` / `--all`.

Цель: из веба можно синхронизировать и кэш, причём как всё сразу, так и один референс со страницы `#/reference/<id>`.

Что сделать:
1. API: `POST /api/references/sync` — расширить до общего sync (клоны репозиториев + кэши url/doc), тела запроса может не быть; ответ объединяет `{cloned, skipped, failed, cache: {updated, skipped, failed}}` (или отдельное поле `cached`), обратная совместимость формы `SyncResult` для существующего фронта сохраняется additive-полями.
2. API: `POST /api/references/:id/sync` — поштучный sync одного референса (repo → клон, url/doc → refresh кэша), ответ `{reference, cloned?, cache?}` с понятной ошибкой 404 для неизвестного id. Роут держать после точного `/api/references/sync`, порядок матчинга проверить тестом (инцидент transient-404 из VL-174, lesson-22).
3. Фронт `#/references`: кнопка Sync показывает оба итога (клоны + кэш) отдельными строками, а не общий «ошибок: 0»; при `cache.failed` — destructive-акцент с текстом ошибки по ref-id.
4. Фронт `#/reference/<id>`: кнопка «Синхронизировать» (иконка RefreshCw, состояние «Синхронизация…») — для url/doc обновляет кэш, для repo клонирует; после успеха перечитать детали (`cached_at`/`source_hash` в UI, если они отдаются) и показать итог inline, ошибки — inline, без console.
5. Сообщение о 429: ответ сервера отдаёт причину (сейчас `HTTP 429 Too Many Requests` от QRATOR GitVerse при анонимном raw-доступе); в UI показать человекочитаемую подсказку «лимит запросов GitVerse, повторите позже» и не терять остальные результаты.

Вне объёма: ретраи/backoff в `downloadText` (отдельная задача), поддержка токена для raw-доступа, изменение CLI-поведения sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/references/sync обновляет и клоны репозиториев, и markdown-кэши url/doc-референсов; ответ additive-совместим с прежним SyncResult и содержит итог по кэшу
- [x] #2 POST /api/references/:id/sync синхронизирует один референс (repo — клон, url/doc — кэш) и возвращает 404 с понятным сообщением для неизвестного id; роут не перехватывается :id-роутом
- [x] #3 Кнопка Sync на #/references показывает итог клонов и кэша отдельными строками, ошибки кэша — с ref-id и текстом
- [x] #4 На странице #/reference/<id> есть кнопка синхронизации этого референса: состояния «Синхронизация…/итог/ошибка» inline, после успеха данные перечитываются, ошибок в консоли браузера нет
- [x] #5 Ошибка HTTP 429 от GitVerse показывается человекочитаемо («лимит запросов, повторите позже»), остальные результаты синхронизации при этом не теряются
- [x] #6 Тесты: src/web/references-api.test.mjs дополнен кейсами общего и поштучного sync (успех, 404, частичная ошибка кэша); pnpm typecheck и pnpm test зелёные, web/dist пересобран
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Архитектурное решение

`handleApi` **синхронный** (`src/web/api.ts:135`), а обновление кэша url/doc требует сети (`downloadText` → `fetch`, `src/core/reference-cache.ts:86-106`) и async. Следовательно sync не может жить в `handleApi` — по прецеденту async-обработчиков делаем **отдельный async-модуль** `src/web/references-sync-api.ts` (образец — `src/web/catalog-api.ts:12-20,115` и его регистрация в server.ts **ДО** `handleApi`: `src/web/server.ts:209-229`), возвращающий `ApiResponse | null` (`null` = «URL не наш», дальше работает `handleApi`).

Роут sync **переносится** из `handleApi` в новый модуль (а не дублируется): иначе в проекте появились бы две семантики одного URL — async (клоны + кэш) для HTTP-сервера и синхронная «только клоны» для in-process вызовов. `syncReferenceRepos` остаётся в core без изменений.

## Файлы и конкретные места

### 1. `src/web/references-sync-api.ts` (новый)

```
export interface ReferencesSyncDeps { fetchFn?: typeof fetch }

export async function handleReferencesSyncApi(
  method: string, url: string, body: Record<string, unknown> | null,
  cwd: string, deps: ReferencesSyncDeps = {},
): Promise<ApiResponse | null>
```

Роутинг внутри (порядок строгий, комментарий «точное совпадение ДО :id» — как `src/web/api.ts:513-517`):
1. `method === 'POST' && url === '/api/references/sync'` — общий sync:
   - `repos = syncReferenceRepos(cwd)` (`src/core/reference.ts:526`);
   - `cache = await syncReferenceCaches(cwd, { all: true }, deps)` (`src/core/reference-cache.ts:466`);
   - `failed` кэша прогнать через `humanizeSyncError` (см. п.2), ответ `{ status: 200, body: { ...repos, cache } }` — поля `cloned/skipped/failed` остаются в корне (additive-совместимость с `SyncResult`, `src/core/reference.ts:74-78`).
2. `const m = url.match(/^\/api\/references\/([^/]+)\/sync$/)` и `method === 'POST'` — поштучный sync:
   - `const entry = getReference(cwd, decodeURIComponent(m[1]))`; нет → `{ status: 404, body: { error: 'Reference не найден' } }` (текст как в `src/web/api.ts:525`);
   - `type === 'repo'` → `cloneReferenceRepo(cwd, entry.reference)` (`src/core/reference.ts:492`) → `{ reference: <перечитанный getReference>, cloned: { ok: cloned, message } }`;
   - иначе → `refreshReferenceCache(cwd, entry.reference, deps)` (`src/core/reference-cache.ts:354`), затем `reference: getReference(cwd, id)?.reference` (обновлённые `cached_at`/`source_hash`/`cached_path`), `cache: { status, updated, message: humanize(...) }`;
   - на любой `status === 'failed'` кэша — HTTP остаётся 200 (UI показывает inline), но `cache.status = 'failed'` и текст с причиной.
3. Иначе — `return null`.

Плюс локальный helper `humanizeSyncError(text)`:
- содержит `HTTP 429` → `лимит запросов GitVerse (HTTP 429), повторите позже — <исходный текст>`;
- иначе текст как есть. Раскладка в web-слой выбрана намеренно: `downloadText` (`src/core/reference-cache.ts:91`) и его сообщения завязаны на тесты (`src/core/reference-cache.test.mjs:138-139` проверяет `/HTTP 404/`), менять core-тексты = риск регрессий.

Обновить шапку модуля (список эндпоинтов) и `src/web/api.ts:24-31` — убрать строки про sync из списка эндпоинтов `handleApi`, добавить комментарий-ссылку на новый модуль.

### 2. `src/web/api.ts`

- строка 48: убрать `syncReferenceRepos` из импорта `../core/reference.js` (больше не используется в файле);
- строки 513-519: **удалить** блок `POST /api/references/sync` (перенос в новый модуль) вместе с комментарием; оставить комментарий «sync живёт в references-sync-api.ts (async: кэш ходит в сеть), регистрация — server.ts до handleApi»;
- строка 28 (шапка): заменить описание эндпоинта.

### 3. `src/web/server.ts`

Вставить ветку **до** `const result = handleApi(...)` (`src/web/server.ts:231`), сразу после блока catalog (`:209-229`), тем же `.then/.catch` паттерном:

```ts
const syncMatch = url === '/api/references/sync' || /^\/api\/references\/[^/]+\/sync$/.test(url);
if (method === 'POST' && syncMatch) {
  handleReferencesSyncApi(method, url, parsed, cwd)
    .then((result) => { /* как catalog: null → 404, иначе writeHead(result.status) */ })
    .catch(...)
  return;
}
```

Комментарий-обоснование: async (сеть) ⇒ не может жить в синхронном `handleApi`; ветка до общего вызова.

### 4. `web/src/components/references/api.ts`

- `ReferenceMeta` (`:13`): добавить необязательные `cached_path?`, `cached_at?`, `source_hash?` (поля есть в модели — `src/core/reference.ts:37-46`, отдаются `GET /api/references/:id` как есть);
- добавить `export interface CacheSyncResult { updated: string[]; skipped: string[]; failed: { id: string; error: string }[] }` (зеркало `src/core/reference-cache.ts:47-51`);
- `SyncResult` (`:37-41`): additive-поле `cache?: CacheSyncResult`;
- `ReferenceSyncResult { reference: ReferenceMeta; cloned?: { ok: boolean; message: string }; cache?: { status: string; updated: boolean; message: string } }`;
- новая `syncReference(id)` → `POST /api/references/${encodeURIComponent(id)}/sync`, ошибки через существующий `errorMessage` (`:57-61`);
- обновить шапку (`:9`) и JSDoc `syncReferences` (`:86`): «клонирует отсутствующие репо И обновляет кэш url/doc».

### 5. `web/src/components/references/references-page.tsx`

- `formatSyncResult` (`:26-33`) → вернуть **две строки** (`string[]` или разметка): «Репозитории — клонировано N, пропущено M» и «Кэш — обновлено N, без изменений M, ошибок K»; при `cache.failed.length > 0` третья строка с `ref-id: текст` и классом `text-destructive` (сейчас единый `text-muted-foreground` на `:90`);
- `handleSync` (`:59-70`) — состояние `syncMessage` заменить на объект `{ repos: string; cache: string; cacheErrors: { id: string; error: string }[] } | null`;
- рендер (`:90`) — оба итога отдельными абзацами, ошибки кэша — `text-destructive`; title кнопки (`:83`) — «Sync: клоны репозиториев и кэш url/doc».

### 6. `web/src/components/references/reference-detail.tsx`

- импорт `RefreshCw` в дополнение к `ArrowLeft, Pencil` (`:13`);
- состояние `syncing`/`syncMessage`/`syncError`;
- `handleSync` по образцу `handleSave` (`:86-110`): `await syncReference(id)` → `setEntry({ ...entry, reference: result.reference })` (или повторный `fetchReference(id)` — перечитывание гарантирует `cached_at`/`source_hash`) → inline-сообщение `result.cloned?.message ?? result.cache?.message`; ошибка → `setSyncError`, без `console.*`;
- кнопка «Синхронизировать» (`RefreshCw`, `disabled={syncing}`, текст «Синхронизация…» во время запроса) рядом с «Редактировать» (`:138-140`);
- в блоке `dl` (`:187-190`) добавить строки «Кэш обновлён» → `ref.cached_at ?? '—'` и «Хеш источника» → `ref.source_hash?.slice(0, 12) ?? '—'`;
- обновить шапку модуля.

### 7. `src/web/references-api.test.mjs`

- существующий describe `POST /api/references/sync (VL-174)` (`:132-152`) перевести на `handleReferencesSyncApi` (импорт из `../../dist/web/references-sync-api.js`); кейс «sync не матчится как :id» сохранить, проверяя `status !== 404`;
- новые кейсы (сеть — только стаб `fetchFn`, правило VL-132):
  1. общий sync: repo с созданным каталогом клона → `skipped` содержит id; url-референс со стабом `text/html` → `cache.updated` содержит id, `cloned/skipped/failed` в корне присутствуют (additive-совместимость);
  2. поштучный sync url-референса → 200, `cache.status === 'updated'`, `reference.cached_at` заполнен, файл `backlog/references/cache/<id>.md` существует;
  3. поштучный sync неизвестного id → 404 и текст «Reference не найден»;
  4. частичная ошибка кэша: референс с двумя url (`urls`), один стаб отдаёт 500/429 → `cache.failed[0].id` = id, текст содержит подсказку про лимит (для 429) и общий sync при этом возвращает `updated`/прочие результаты;
  5. порядок матчинга: `POST /api/references/sync` не попадает в поштучный роут, а `POST /api/references/ref-1/sync` — попадает;
  6. `handleApi('POST','/api/references/sync',...)` → 404 (роут перенесён; фиксирует отсутствие второй семантики) — если решено оставить fallback, заменить на проверку редиректа документации.
- шапку файла (`:1-13`) обновить под новый контракт.

### 8. Документация

- `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md:511` — в абзаце про References: Sync на `#/references` клонирует отсутствующие репо **и** обновляет markdown-кэш url/doc-референсов; на `#/reference/<id>` — кнопка «Синхронизировать» (repo → клон, url/doc → кэш), итог и ошибки inline, 429 от GitVerse показывается подсказкой «лимит запросов, повторите позже»; `POST /api/references/:id/sync`.
- `CHANGELOG.md` — строку раздела VL-358 (по правилу проекта; если Close ведёт CHANGELOG — уточнить на месте, требование DoD «Документация обновлена» закрывается doc-6).

### 9. Сборка фронта

`cd web && pnpm install --frozen-lockfile` (lesson-6/lesson-231: в свежем worktree нет `web/node_modules`), затем `pnpm --dir web typecheck`, `pnpm web:build` — `web/dist` пересобрать и закоммитить (входит в npm `files`).

## Порядок действий

1. `src/web/references-sync-api.ts` (новый) + правки `src/web/api.ts` и `src/web/server.ts` → `pnpm build` (tsc).
2. Тесты `src/web/references-api.test.mjs` → `pnpm build && vitest run src/web/references-api.test.mjs`.
3. Фронт: `web/src/components/references/api.ts` → `references-page.tsx` → `reference-detail.tsx`; `pnpm --dir web typecheck`.
4. `cd web && pnpm install --frozen-lockfile && pnpm web:build` (из корня: `pnpm web:build`).
5. `pnpm typecheck && pnpm test` (полный прогон — DoD).
6. doc-6 (и CHANGELOG) правкой существующих абзацев.
7. Ручная проверка в браузере (chrome-devtools): `#/references` → Sync (две строки итога), `#/reference/<id>` → «Синхронизировать»; `list_console_messages` пуст.

## Как проверить

```bash
pnpm typecheck && pnpm build
cd web && pnpm install --frozen-lockfile && pnpm --dir web typecheck && cd .. && pnpm web:build
pnpm test
```
Критерий DoD закрывается только полным `pnpm test` (без `--exclude`/`--skip`).

## Риски

- **Порядок роутов** (инцидент transient-404 из VL-174, lesson-22): точный `/api/references/sync` обязан проверяться ДО regex `:id/sync`; покрыть тестом (п.7.5). Ветка в server.ts должна стоять ДО `handleApi`.
- **Двойная семантика**: если оставить sync-роут в `handleApi` — in-process вызовы получат «только клоны». План переносит роут; старый тест `src/web/references-api.test.mjs:143` обязательно править.
- **Блокировка event loop**: `git clone` — `spawnSync` (`src/core/reference.ts:517`), общий sync на нескольких repo заморозит сервер на время клонов; поведение унаследовано от VL-174, отмечено в комментарии, не переделываем (вне объёма).
- **Сеть в тестах**: реальный `fetch` запрещён guard'ом (`src/test-setup.mjs`, VL-132) — все кейсы через инжектированный `deps.fetchFn`; `handleReferencesSyncApi` обязан пробрасывать `deps` в `syncReferenceCaches`/`refreshReferenceCache` третьим аргументом (`CacheDeps`, `src/core/reference-cache.ts:38-41`).
- **429 в core-текстах**: не менять формулировки `downloadText`/`refreshReferenceCache` (на подстроках завязаны существующие тесты) — человекочитаемость вводится только в web-слое.
- **`web/dist` в git**: забытая пересборка → npm-пакет отдаст старый UI (lesson-28/211 — конфликты dist решаются пересборкой).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `handleApi` синхронный, принимает (method, url, body, cwd, queryString) | `src/web/api.ts:135-141` |
| Текущий роут `POST /api/references/sync` → `syncReferenceRepos(cwd)` и стоит ДО regex `:id` | `src/web/api.ts:513-519`, regex — `src/web/api.ts:522` |
| `syncReferenceRepos` клонирует только `type === 'repo'`, возвращает `{cloned, skipped, failed}` | `src/core/reference.ts:526-543`, интерфейс `src/core/reference.ts:74-78` |
| `cloneReferenceRepo` — spawnSync, идемпотентен, сообщение «уже клонирован» определяет skip | `src/core/reference.ts:492-524` |
| `refreshReferenceCache` async, статусы `updated/skipped/partial/failed/none`, пишет `cached_path/cached_at/source_hash` | `src/core/reference-cache.ts:337-427` (запись — `:405-412`) |
| `syncReferenceCaches(cwd, {ids|all}, deps)` async, `all` фильтрует `url/doc/spec` с непустыми ссылками, partial → failed | `src/core/reference-cache.ts:466-503` (фильтр `:486-489`) |
| `CacheSyncResult` = `{updated, skipped, failed[{id,error}]}` | `src/core/reference-cache.ts:47-51` |
| `downloadText` отдаёт ошибку текстом `HTTP <status> <statusText>` | `src/core/reference-cache.ts:91` |
| `CacheDeps` = `{fetchFn?, timeoutMs?}`, инжектится третьим аргументом | `src/core/reference-cache.ts:38-41`, `:354`, `:466` |
| Async-обработчик регистрируется в server.ts отдельной веткой ДО `handleApi`, `null` → 404 | `src/web/server.ts:209-229`, `handleApi` — `:231` |
| Прецедент async-модуля с `ApiResponse | null` и `deps.fetchFn` | `src/web/catalog-api.ts:12-20,115` |
| Модель `Reference` содержит `cached_path/cached_at/source_hash`, `markdownToReference` их читает | `src/core/reference.ts:37-46`, `:228-240` |
| `GET /api/references/:id` отдаёт запись целиком (`{reference, body, path}`) — кэш-поля дойдут до UI | `src/web/api.ts:522-527` |
| Фронт получает `SyncResult` только с cloned/skipped/failed | `web/src/components/references/api.ts:37-41`, `:87-92` |
| Итог Sync на странице — одна строка `formatSyncResult` | `web/src/components/references/references-page.tsx:26-33`, рендер `:90` |
| Кнопка Sync — `RefreshCw`, состояние `syncing`, `handleSync` | `references-page.tsx:59-70,82-90` |
| На детальной странице кнопок sync нет; шапка — `h1` + «Редактировать» по образцу `handleSave` | `web/src/components/references/reference-detail.tsx:86-110,132-141` |
| Существующий тест sync через `handleApi` доказывает приоритет роута | `src/web/references-api.test.mjs:132-152` |
| Тесты сети инжектят `fetchFn` стабом (guard VL-132) | `src/core/reference-cache.test.mjs:46-60`, `:138-139` |
| Скрипты: `pnpm typecheck`, `pnpm web:build`, `pnpm test` (build + два vitest-прогона) | `package.json:18-23` |

## Не проверено (предположения)

1. **`ReferenceMeta` на фронте без кэш-полей** — предположение, что добавление опциональных `cached_at/cached_path/source_hash` не сломает `web/src/components/references/*` typecheck. Проверить: `pnpm --dir web typecheck` шагом 3; при расхождении — добавить поля в `ReferenceMeta` явно (они и так в `Reference`) и поправить места сравнения объектов (deepEqual в тестах фронта, если есть).
2. **`handleApi` после удаления sync-роута** — предположение, что других потребителей `POST /api/references/sync` через `handleApi` нет. Проверить: `grep -rn "api/references/sync" src web backlog/docs` перед правкой; если найдётся in-process вызов — оставить fallback-роут с комментарием «только клоны, полный sync — async-модуль» и обновить тест иначе.
3. **Тело запроса `POST /api/references/sync` может отсутствовать** — предположение, что `parsed` = `null` при пустом теле и хендлер это терпит (не читает body). Проверить по `src/web/server.ts` (разбор тела) первым шагом Code; при `parsed === undefined` — не разыменовывать.
4. **`syncReferenceCaches({all:true})` в HTTP-запросе** — предположение, что последовательный обход всех url/doc-референсов укладывается в разумное время; при большом числе ссылок возможен таймаут браузера/прокси. Проверить на репозитории проекта (12+ references): замерить длительность `curl -X POST http://127.0.0.1:PORT/api/references/sync`; при >30 с рассмотреть последовательный поток с прогрессом (вне AC — зафиксировать, не расширять объём).
5. **429-ответ реального GitVerse** — предположение, что текст ошибки приходит как `HTTP 429 Too Many Requests` из `downloadText` (не JSON-тело). Проверить: `src/core/reference-cache.ts:88-92` (смотреть в Code); при ином виде — humanize по `includes('429')`.
6. **`getReference` после sync отдаёт обновлённые кэш-поля** — предположение, что `updateReference` пишет их до возврата (синхронная запись файла). Проверить чтением `updateReference` в `src/core/reference.ts`; при асинхронности — перечитать `getReference` после `await` (план уже это делает).
7. **Форма ответа поштучного sync** (`{reference, cloned?} / {reference, cache?}`) — предположение, что достаточно нового контракта без отдельного `GET`-режима; проверить, что AC2 не требует поля `cache.updated` в общем виде — иначе добавить `updated: boolean` внутрь `cache`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 16:53
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не эпик) — план записан в Implementation Plan.
Архитектурное решение: `handleApi` синхронный (`src/web/api.ts:135`), а refresh кэша url/doc требует сети (`downloadText` → fetch). Поэтому sync выносится в новый async-модуль `src/web/references-sync-api.ts` (прецедент — `src/web/catalog-api.ts:12-20,115`), регистрируется в `src/web/server.ts` ДО `handleApi` (как catalog, `:209-229`); роут `POST /api/references/sync` из `api.ts:513-519` переносится туда, второй семантики одного URL не остаётся. Человекочитаемость 429 — в web-слое (`humanizeSyncError`), тексты core не меняются (на них завязаны тесты `reference-cache.test.mjs:138-139`).
Файлы плана (10): `src/web/references-sync-api.ts` (новый), `src/web/api.ts`, `src/web/server.ts`, `web/src/components/references/{api.ts,references-page.tsx,reference-detail.tsx}`, `src/web/references-api.test.mjs`, `backlog/docs/doc-6`, `CHANGELOG.md`, пересборка `web/dist`. Тестовые кейсы: общий sync (клоны + кэш, additive-форма), поштучный sync (успех/404/частичная ошибка/429), приоритет точного роута над `:id`.
Риски: порядок роутов (transient-404 из VL-174, lesson-22) — покрыт тестом; двойная семантика при неполном переносе; синхронный `spawnSync` git clone блокирует event loop при общем sync (унаследовано от VL-174, вне объёма); сеть в тестах только через инжектированный `deps.fetchFn` (VL-132); забытая пересборка `web/dist` (lesson-28/211); `pnpm install` внутри `web/` перед `web:build` (lesson-6/231).
Обязательные разделы включены: «Проверено по коду» (21 строка с файл:строка) и «Не проверено (предположения)» (7 пунктов с способом проверки первым шагом Code).
---
author: @agent
created: 2026-11-08 17:26
---
Фаза 3 (Code) выполнена. Коммит 61f563f.
**Бэкенд.** Новый async-модуль `src/web/references-sync-api.ts` (`handleReferencesSyncApi` + `humanizeSyncError`) по прецеденту catalog-api:
- `POST /api/references/sync` → клоны (`syncReferenceRepos`) + кэш (`syncReferenceCaches({all:true}, deps)`); ответ `{cloned, skipped, failed, cache}` — прежние поля SyncResult в корне (additive-совместимость), тексты ошибок кэша прогнаны через `humanizeSyncError`;
- `POST /api/references/:id/sync` → repo: `cloneReferenceRepo` → `{reference, cloned:{ok,message}}`; url/doc/spec: `refreshReferenceCache` → `{reference, cache:{status,updated,message}}` со свежими `cached_at/source_hash` (getReference перечитывается после await); неизвестный id → 404 «Reference не найден»;
- точный `/sync` проверяется ДО regex `:id/sync` (lesson-22/VL-174).
- `humanizeSyncError`: `429` → «лимит запросов GitVerse (HTTP 429), повторите позже — <исходный текст>»; тексты core не менялись (AC5).
- Роут `POST /api/references/sync` удалён из `handleApi` (одна семантика URL), `syncReferenceRepos` убран из его импортов; регистрация async-ветки — `src/web/server.ts` ДО `handleApi` (как catalog, 404 при `null`).
**Фронт.** `web/src/components/references/api.ts`: кэш-поля в `ReferenceMeta`, `CacheSyncResult`, additive `SyncResult.cache`, `ReferenceSyncResult`, `syncReference(id)`. `references-page.tsx`: итог двумя строками («Репозитории — …», «Кэш — …»), ошибки кэша отдельными строками с ref-id в `text-destructive`. `reference-detail.tsx`: кнопка «Синхронизировать» (RefreshCw, «Синхронизация…»), итог/ошибка inline без console, после успеха — повторный `fetchReference`, строки «Кэш обновлён»/«Хеш источника» в карточке.
**Проверки:**
- `pnpm typecheck` + `pnpm build` — чисто; `pnpm --dir web typecheck` — чисто; `pnpm web:build` — ok, `web/dist` пересобран и закоммичен (lesson-6/231: `pnpm install --frozen-lockfile` внутри `web/` выполнен).
- `npx vitest run src/web/references-api.test.mjs` — 15 passed (новые кейсы: общий sync с кэшем и additive-формой, поштучный sync url (cached_at/source_hash + файл кэша), repo-клон, 404, порядок матчинга роутов, 429-частичный сбой с humanize — в изолированном mkdtemp-проекте).
- Полный `pnpm test` — 199 файлов / 3756 passed, 4 skipped, 0 failed. Важно: первый прогон дал 1-2 падения в `src/web/orchestrator.test.mjs` (VL-277/VL-352) из-за унаследованного env агентской сессии (`VIBELOG_PHASE_NAME`/`VIBELOG_SESSION_ID`/`VIBELOG_CWD` ломают autocommit-путь), при изолированном env (`env -u VIBELOG_SESSION_ID -u VIBELOG_CWD -u VIBELOG_PHASE_NAME -u VIBELOG_RUN_ID`) тот же файл зелёный (89/89) и полный прогон зелёный. Это известное поведение (lesson-88/113/120/254), к диффу задачи не относится — исключённых файлов в финальном прогоне нет.
**Что осталось (для Close):** документация — doc-6 (абзац про References: общий sync клоны+кэш, кнопка «Синхронизировать» на `#/reference/<id>`, подсказка про 429, `POST /api/references/:id/sync`) и CHANGELOG (в Code по правилам не трогаются). Ручная браузерная проверка (chrome-devtools: Sync на `#/references`, «Синхронизировать» на детальной, `list_console_messages` пуст) осталась невыполненной — запуск веб-сервера и браузера в фазе Code не делался; рекомендуется на ревью.
---
author: @agent
created: 2026-11-08 17:33
---
Фаза Close выполнена.
**Слияние.** Ветка `vb/vl-358` (1 коммит `61f563f`) слита в master через `--no-ff` (`9 файлов, +470/−62`) без конфликтов. Worktree `.vibelog/worktrees/vl-358` удалена (`--force`: оставался только untracked-симлинк `backlog/references/data`, данные не терялись), ветка `vb/vl-358` удалена (`was 61f563f`).
**Проверки после merge.** diff затронул `src/web/{api,server,references-sync-api,references-api.test.mjs}` и `web/src|dist`:
- `pnpm build` (tsc) — чисто;
- ранний точечный фильтр: `vitest run src/web/references-api.test.mjs` — 15/15 passed;
- **полный `pnpm test`** — 198 файлов / 3759 passed, 4 skipped, 0 failed (build + оба vitest-прогона, включая static.test на собранном `web/dist`). Исключённых/пропущенных по `--exclude`/`--skip` тест-файлов нет, повторных прогонов не было. Merge-интерференции не обнаружено.
**Документация (шаг 9, коммит `e1c1787`).** CHANGELOG.md — запись VL-358 в `[Unreleased] → Добавлено` (async-модуль перед синхронным `handleApi`, объединённый `/api/references/sync`, новый `POST /api/references/:id/sync`, humanize 429 в web-слое без правки core-текстов, две строки итога и кнопка «Синхронизировать»). `backlog/docs/doc-6` — абзац сайдбара References: Sync клонирует репо **и** обновляет кэш url/doc/spec, поштучный sync и подсказка про 429. README не расширялся.
**DoD.** 1. Тесты проходят — полный `pnpm test` зелёный. 2. Документация обновлена — doc-6 + CHANGELOG (`e1c1787`). 3. Нет регрессий — сборка и полный прогон после merge зелёные.
**Lessons.** Создан lesson-257 (в связке с задачей): async-эндпоинту нужен отдельный модуль перед синхронным `handleApi`, роут переносится (а не дублируется), точный путь проверяется до параметрического regex; коммит `ed66a8f`.
**Не выполнено (вне объёма Close).** Ручная браузерная проверка (chrome-devtools: Sync на `#/references`, «Синхронизировать» на `#/reference/<id>`, пустой `list_console_messages`) в фазе Code не выполнялась и в Close не повторялась — код не правится в Close; рекомендуется проверить на ревью или отдельной задачей.
---
<!-- COMMENTS:END -->