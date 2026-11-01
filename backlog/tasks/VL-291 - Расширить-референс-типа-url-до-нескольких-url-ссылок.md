---
id: VL-291
title: Расширить референс типа url до нескольких url ссылок
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 00:42'
updated_date: '2026-11-02 01:23'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/reference.ts
  - src/core/reference-cache.ts
  - src/cli/commands/reference.ts
  - src/mcp/tools.ts
  - src/core/reference.test.mjs
  - src/core/reference-cache.test.mjs
  - src/cli/reference-cli.test.mjs
  - src/mcp/reference-tools.test.mjs
  - MCP-SETUP.md
lessons:
  - lesson-162
  - lesson-163
token_usage:
  input: 12764299
  output: 82296
  cache: 12508160
  total: 12846595
  requests: 190
  duration_ms: 877714
  reasoning: 34790
  by_phase:
    spec:
      input: 497608
      output: 4491
      cache: 482304
      requests: 17
    plan:
      input: 1489534
      output: 15969
      cache: 1434112
      requests: 29
    code:
      input: 8027247
      output: 48000
      cache: 7901696
      requests: 93
    close:
      input: 2749910
      output: 13836
      cache: 2690048
      requests: 51
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Расширить референс типа url до нескольких url ссылок. Сейчас при создании такого типа референса можно передать только одну ссылку для кэширования. Необходима возможность передать несколько ссылок, а итоговым документом кэширования будет склеенный md файл
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В CLI и MCP можно создать/обновить референс типа url с массивом ссылок; обратная совместимость одиночного url сохраняется
- [x] #2 Кэш такого референса — единый md-файл со склеенными секциями по каждой ссылке (заголовок + содержимое), порядок ссылок сохранён
- [x] #3 Ошибка одной из ссылок не ломает кэш остальных: она фиксируется в md отдельной пометкой, а команда сообщает о частичном успехе
- [x] #4 Тесты (полный pnpm test) покрывают множественные url, частичный сбой и одиночную ссылку; документация по references обновлена
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Дать референсу типа url/doc/spec массив ссылок: `reference add --url A --url B`, MCP `reference_add{urls:[...]}`; кэш — один md-файл со склейкой секций в порядке ссылок; ошибка одной ссылки не ломает остальные (пометка в md + частичный успех в сообщении). Одиночный `url` остаётся как есть (обратная совместимость).

## Модель данных (решение)
Не менять смысл `url` (первая ссылка) — на него завязаны `cloneReferenceRepo`, `searchReferences`, web-PATCH. Добавить рядом **`urls?: string[]`** = ДОПОЛНИТЕЛЬНЫЕ ссылки (всё, что после первой). Инвариант: полный упорядоченный список = `[url, ...urls]`.
- Хелпер `referenceUrls(ref): string[]` в `src/core/reference.ts` — единственная точка получения списка (порядок = порядок склейки кэша).
- Frontmatter: `url` пишется как раньше; `urls` пишется только при непустом массиве → round-trip старых файлов не меняется вовсе (VL-152-инвариант «чистый frontmatter»).
- Парсинг: `urls` — массив строк (скалярная строка тоже принимается, как у `tags`), пустые/дубли отбрасываются.

## Файлы и точки правки
1. **src/core/reference.ts**
   - `Reference` (~стр. 33-46): `urls?: string[]` + комментарий-«почему» (доп. ссылки, порядок важен для кэша).
   - `ReferenceInput` (~стр. 49-58), `UpdateReferenceInput` (~стр. 244-265): `urls?: string[]`.
   - `createReference` (~стр. 108): нормализация `urls` (trim, непустые, дедуп по порядку).
   - `referenceToMarkdown` (~стр. 140-150): `if (ref.urls?.length) frontmatter.urls = ref.urls;`
   - `markdownToReference` (~стр. 163-176): чтение `urls` (array-of-strings | string | отсутствует → ключ не создаётся).
   - `updateReference` merge (~стр. 285-295): `urls: updates.urls !== undefined ? ... : entry.reference.urls` (иначе любой link/rename сотрёт — та же регрессия, что VL-194 с cached_*).
   - `searchReferences` (~стр. 340-360): учитывать элементы `urls`.
   - Новый экспорт `referenceUrls(ref): string[]` (+ JSDoc).
2. **src/core/reference-cache.ts**
   - Новая функция `mergeCachedSections(sections): string` — сборка единого md: для каждой ссылки `## <url>` + отбивка `> Источник: <url>` (или `---`), затем markdown содержимого; пустая строка-разделитель между секциями.
   - Секция с ошибкой: `## <url>` + `> ⚠ Ошибка загрузки: <сообщение>` — остальные секции пишутся.
   - `CacheResult` (стр. ~53): добавить `partial?: boolean` и `failed?: {url,error}[]`, сохранив `cached` = «хотя бы одна ссылка закэширована».
   - `cacheReference` (~стр. 130-190): итерировать `referenceUrls(ref)`; для каждой — `downloadText`+`classifyContentType`+`htmlToMarkdown` в try/catch. `source_hash` = sha256 от склейки raw-ответов с маркерами `url` (детерминированно → сравнение в sync работает); если НИ одна не удалась — `{cached:false}` и файл не пишем; при частичном успехе — `cached:true, partial:true`, сообщение вида «Reference ref-N: закэшировано 2 из 3 ссылок (ошибок: 1), 1 секция с пометкой об ошибке».
   - `refreshReferenceCache` (~стр. 200-232): та же склейка; сравнение `source_hash` целиком; вернуть `status: 'updated'|'skipped'|'partial'|'failed'` в результат, подстроки «без изменений»/«пропуск» в `message` СОХРАНИТЬ (на них завязаны `syncReferenceCaches` и MCP-обработчик).
   - `syncReferenceCaches` (~стр. 240+): классифицировать по новому `status` вместо `message.includes(...)` (хрупкость), `partial` → попадает в `failed` с текстом.
3. **src/cli/commands/reference.ts**
   - `referenceAdd` (~стр. 105-150): `const urls = getFlagArray(flags,'url')` → `url: urls[0]`, `urls: urls.slice(1)`; при `--cache` без url — прежняя ошибка; сообщение при `res.partial` — `printInfo`/`printError` соответственно (частичный успех → exitCode 1 + явный текст «частичный успех»).
   - `referenceView` (~стр. 152-180): печатать все ссылки (`url:`, затем `urls: a, b` либо строки `url[2]: ...`).
   - Справка/usage-строки в `referenceAdd` (~стр. 106) и `referenceSync` (~стр. 225-274): `--url` повторяемый, `--cache` для нескольких ссылок.
4. **src/mcp/tools.ts**
   - Схема `reference_add` (~стр. 504-521): параметр `urls: {type:'array', items:{type:'string'}, description:'Дополнительные URL (порядок = порядок склейки кэша); первый url можно передать в url или первым элементом urls'}`; описание инструмента — про склейку и частичный сбой.
   - `toolReferenceAdd` (~стр. 2251-2278): собрать список `[args.url, ...(args.urls||[])]`, нормализовать, `url: list[0]`, `urls: list.slice(1)`; при `cache:true` — сообщение с `partial`.
   - Схема `reference_update` (~стр. 553-566) + `toolReferenceUpdate` (~стр. 2306-2324): `url` и `urls` (полная замена набора; `urls: []` очищает доп. ссылки), ошибка «Не указаны поля…» дополняется `url, urls`.
   - `toolReferenceView` (~стр. 2280-2296): в JSON уже отдаётся `...entry.reference` — `urls` появится автоматически; дополнительно `urls_all: referenceUrls(...)` для однозначности.
   - Счётчик инструментов НЕ меняется (новых инструментов нет) — lesson-10 не применим.
5. **Тесты**
   - `src/core/reference.test.mjs`: round-trip `urls` (2 и 3 ссылки), одиночный `url` без `urls`, `updateReference({title})` не теряет `urls`, `urls: []` очищает, `referenceUrls` порядок.
   - `src/core/reference-cache.test.mjs`: склейка 2-3 ссылок (порядок секций = порядок url), частичный сбой (стаб fetch бросает на второй) → файл пишется, есть пометка `Ошибка загрузки`, `cached:true, partial:true`; все ссылки упали → `cached:false`, файла нет; одиночная ссылка — прежнее поведение и формат (регрессия); `refresh` multi: hash совпал → skipped, изменился → updated.
   - `src/cli/reference-cli.test.mjs`: `add --type url --url a --url b --cache` с loopback-сервером (асинхронный spawn, lesson-51) → единый кэш-файл, секции в порядке; частичный сбой (один путь отдаёт 500) → exitCode 1 + «частичный»; одиночный `--url` — прежний вывод.
   - `src/mcp/reference-tools.test.mjs`: `reference_add{urls:[...], cache:true}` → `reference_view.cached_markdown` содержит обе секции; `reference_update{urls:[...]}` заменяет набор; одиночный `url` — регрессия.
6. **Документация** (через MCP `document_update`, файлы backlog/ руками не править)
   - doc-6 (§References ~стр. 712-729): пример `--url A --url B`, описание склейки кэша и пометки об ошибке.
   - doc-7 (CLI-справочник): `reference add --url` повторяемый, `--cache` для нескольких ссылок.
   - doc-8 (MCP-справочник): `urls` в `reference_add`/`reference_update`, частичный успех.
   - `MCP-SETUP.md`: строки таблицы `reference_add` / `reference_update` — про массив `urls`.

## Порядок действий
1. `src/core/reference.ts` (модель + хелпер + сериализация/парсинг/merge) → `pnpm build`.
2. `src/core/reference-cache.ts` (склейка, partial, status в refresh/sync) → `pnpm build`.
3. CLI (`src/cli/commands/reference.ts`), затем MCP (`src/mcp/tools.ts`) → `pnpm build`.
4. Тесты 4 файла (`pnpm test:fast` для итераций).
5. Документация: doc-6/doc-7/doc-8 через `document_update`, `MCP-SETUP.md`, CHANGELOG.
6. Полный `pnpm build && pnpm test` (обязателен для DoD).

## Проверка
```bash
pnpm build && pnpm test          # полный прогон, DoD
# локальная проверка склейки (loopback или реальный url):
node bin/vibelog.mjs reference add "Док" --type url --url https://a/x --url https://b/y --cache
node bin/vibelog.mjs reference view ref-N
```

## Риски
- **Потеря `urls` в merge `updateReference`** (link/rename/tags) — та же регрессия, что VL-194 с cached_*; покрыть тестом до правок CLI/MCP.
- **Хрупкая классификация в `syncReferenceCaches`** по `message.includes('без изменений')` — при новых сообщениях сломается молча; перейти на явный `status` и сохранить подстроки.
- **Семантика `source_hash`** для нескольких ссылок: если хэшировать только конкатенацию markdown, порядок/маркеры ошибок повлияют; фиксируем формат «хэш по raw-ответам с маркерами url» и тестируем skipped/updated.
- **Тесты без сети** (VL-132): только стабы `deps.fetchFn` и loopback-сервер с асинхронным spawn (lesson-51); также `testSpawnEnv()` (VL-286).
- **Обратная совместимость**: `url`-только файлы должны round-trip'ить байт-в-байт (тест); `cloneReferenceRepo`/web-PATCH не трогаем (web `urls` — вне объёма).
- **Дубли ссылок** в CLI (`--url a --url a`) — дедуп в `createReference`, иначе вторая секция кэша перезапишет/задвоит.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 00:43
---
Фаза spec не удалась (код выхода 1): т, блокировок=0, payload последнего запроса=124428 байт (макс 124428), usage={"input_tokens":200721,"output_tokens":1598,"cache_read_input_tokens":194560,"total_tokens":202319,"reasoning_tokens":1218} — статус возвращён к To Do.
---
author: @agent
created: 2026-11-02 01:07
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен («Расширить референс типа url до нескольких url ссылок»). Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: цель — возможность передать несколько url ссылок при создании/обновлении референса типа url; кэш формируется как один склеенный md-файл по всем ссылкам; добавлены 4 проверяемых критерия приёмки (массив url с обратной совместимостью одиночного, единый md-кэш с секциями в порядке ссылок, частичный сбой одной ссылки не ломает остальные, полный прогон тестов + обновление документации). Labels: core, mcp. References: нет. Вопросов нет.
---
author: @agent
created: 2026-11-02 01:10
---
Фаза 2 (Plan) выполнена. Тип: task (enhancement). План записан в Implementation Plan; 8 файлов кода/тестов + 4 документа.
Изучено: `src/core/reference.ts` (модель, сериализация/парсинг, merge `updateReference`), `src/core/reference-cache.ts` (downloadText/cacheReference/refreshReferenceCache/syncReferenceCaches), `src/cli/commands/reference.ts` (add/view/sync), `src/mcp/tools.ts` (схемы + `toolReference*`), `src/cli/args.ts` (повторяющиеся флаги → `getFlagArray`), `src/web/api.ts` (PATCH /api/references — вне объёма), тест-файлы reference (`reference-cache.test.mjs`, `reference-tools.test.mjs`, `reference-cli.test.mjs`).
Ключевые архитектурные решения:
1. Смысл поля `url` НЕ меняется (первая ссылка) — на него завязаны `cloneReferenceRepo`, `searchReferences`, web-PATCH. Добавляется `urls?: string[]` = дополнительные ссылки; полный упорядоченный список = `[url, ...urls]`, единая точка — новый экспорт `referenceUrls(ref)`.
2. Frontmatter: `urls` пишется только при непустом массиве → старые `url`-файлы round-trip'ят без изменений (инвариант VL-152 «чистый frontmatter»).
3. Кэш: единый md — секция `## <url>` + пометка `> Источник: <url>` + содержимое, в порядке ссылок. Ошибка ссылки → секция с `> ⚠ Ошибка загрузки: …`, остальные пишутся; результат `{cached:true, partial:true, failed:[…]}`, ни одна не удалась → `cached:false` без записи файла.
4. `source_hash` для нескольких ссылок — sha256 от склейки raw-ответов с маркерами url (детерминированно, sync-сравнение работает).
5. `refreshReferenceCache` получает явный `status: updated|skipped|partial|failed`; подстроки «без изменений»/«пропуск» в message сохраняются, `syncReferenceCaches` переводится на классификацию по `status` (сейчас `message.includes(...)` — хрупко).
6. CLI: `--url` становится повторяемым (`getFlagArray` → `url[0]` + `urls.slice(1)`); MCP: `reference_add{urls}`, `reference_update{url, urls}`; новых инструментов нет → счётчики (`tools.length`, doctor `mcp_tools_count`) не меняются.
Порядок: core (модель+merge) → core кэш (склейка/partial) → CLI → MCP → 4 тест-файла → документация (doc-6/7/8 через `document_update`, MCP-SETUP.md, CHANGELOG) → полный `pnpm build && pnpm test`.
Риски: потеря `urls` в merge `updateReference` при link/rename (регрессия-тест до правок слоёв), хрупкая классификация sync по подстрокам, семантика `source_hash` при частичном сбое, сеть в тестах только через стабы `deps.fetchFn`/loopback + асинхронный spawn (lesson-51) и `testSpawnEnv()` (VL-286), дубли `--url` — дедуп в `createReference`.
Учтены lesson-10 (счётчики инструментов — не применим, новых инструментов нет), lesson-102 (описания/алиасы полей MCP-схем), lesson-147/135/161 не относятся к объёму.
---
author: @agent
created: 2026-11-02 01:18
---
Фаза 3 (Code) выполнена. Коммит 739a42b (9 файлов): `src/core/reference.ts`, `src/core/reference-cache.ts`, `src/cli/commands/reference.ts`, `src/mcp/tools.ts`, `MCP-SETUP.md` + 4 тест-файла.
**Реализовано**
1. **Модель (`src/core/reference.ts`)**: `Reference.urls?: string[]` = ДОПОЛНИТЕЛЬНЫЕ ссылки (`url` остаётся первой — clone/web-PATCH/search не тронуты). Новый экспорт `referenceUrls(ref)` — полный упорядоченный список `[url, ...urls]` (единственная точка правды, порядок = порядок секций кэша). `createReference` нормализует (trim, дедуп, продвижение первой ссылки из `urls` в `url`); `referenceToMarkdown` пишет `urls` только при непустом массиве (старые файлы round-trip'ят байт-в-байт); `markdownToReference` читает массив/скаляр, ключ без значений не создаёт; merge в `updateReference` сохраняет `urls` при link/rename/tags (регрессия VL-194 не повторилась — покрыто тестом) и снимает ключ при `urls: []`; `searchReferences` ищет и по `urls`.
2. **Кэш (`src/core/reference-cache.ts`)**: `mergeCachedSections` — единый md, секция = `## <url>` + `> Источник: <url>` + содержимое, разделитель `---`; упавшая ссылка → секция с `> ⚠ Ошибка загрузки: …`. `cacheReference` обходит все ссылки: ни одна не удалась → `{cached:false}` без записи файла; частичный сбой → `{cached:true, partial:true, failed:[…]}` + сообщение «частичный успех — закэшировано N из M ссылок». `refreshReferenceCache` возвращает явный `status: updated|skipped|partial|failed|none` (подстроки «без изменений»/«пропуск» сохранены), `syncReferenceCaches` классифицирует по `status`, partial → в `failed`. Обратная совместимость формата: **одна ссылка без ошибок → прежний формат кэша и `source_hash = sha256(raw)`** (не склейка) — иначе ломались существующие кэши и тесты VL-194.
3. **CLI**: `--url` повторяемый (`getFlagArray` → `url[0]` + `urls.slice(1)`), счётчик «ссылок: N» в сообщении, частичный сбой → `printError` + exitCode 1; `reference view` печатает доп. ссылки строками `url[2]: …`; `sync` переведён на явный `status`.
4. **MCP**: `reference_add` принимает `urls`, `reference_update` — `url`/`urls` (полная замена набора, `[]` очищает), `reference_view` отдаёт `urls_all`; описания схем и `MCP-SETUP.md` обновлены. Новых инструментов нет → счётчики (44) не менялись.
**Проверки**: `pnpm build` ✓; полный `pnpm test` — 129 файлов, 2448 passed / 4 skipped / 0 failed (в т.ч. новые: `reference.test.mjs` +6, `reference-cache.test.mjs` +5 (множественные url, частичный сбой, все упали, refresh multi, sync partial), `reference-cli.test.mjs` +3 (loopback + асинхронный spawn, lesson-51, `testSpawnEnv`), `reference-tools.test.mjs` +5). Прогон полный, исключённых файлов нет.
**Что осталось**: документация `backlog/docs/doc-6/7/8` не правилась — по правилам фазы Code её пишет Close после слияния (в задаче зафиксирован план правок: пример `--url A --url B`, склейка кэша и пометка об ошибке, `urls` в MCP-таблицах). Поэтому AC4 (документация + полный прогон) отмечаю только по тестовой части — пункт оставлен незакрытым до Close.
---
author: @agent
created: 2026-11-02 01:23
---
Фаза Close выполнена. Ветка vb/vl-291 слита в master (1 коммит кода 739a42b, merge --no-ff, конфликтов не было), worktree удалена (--force: в ней были только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-291 удалена (-d).
**Проверки в главном репо после merge**: `pnpm build` ✓; ранний точечный фильтр по diff'у — `src/core/reference.test.mjs`, `src/core/reference-cache.test.mjs`, `src/cli/reference-cli.test.mjs`, `src/mcp/reference-tools.test.mjs` — 4 файла, 109 passed ✓; полный `npx vitest run` — **130 файлов, 2456 passed / 4 skipped / 0 failed** (один полный прогон за фазу, повторов не было).
**Документация (дописана в Close, т.к. фаза Code её не трогает)**: doc-6 §13 — блок «Несколько ссылок у одного референса (VL-291)» и «Кэш нескольких ссылок» (пример `--url A --url B`, склейка секциями `## <url>` + `> Источник:`, пометка `⚠ Ошибка загрузки`, частичный успех с exitCode 1, семантика `sync` по общему `source_hash`); doc-7 — usage `add` с повторяемым `--url` и `--cache`, строки таблиц `add`/`view`/`sync`; doc-8 — параметры `urls` и `cache` в `reference_add`, `url`/`urls` в `reference_update` (полная замена, `[]` очищает), `urls_all` и описание частичного сбоя в `reference_view`, пример вызова с массивом `urls`; CHANGELOG.md — запись в Unreleased (раздел «Добавлено»). MCP-SETUP.md обновлён ещё в Code-фазе. README не расширялся (витрина, лимит 150 строк).
**Lessons**: lesson-162 (additive-поле `urls` + хелпер полного списка вместо смены смысла существующего поля; merge-ветка обязательна — регрессия VL-194) и lesson-163 (классификация по явному `status`, а не по `message.includes(...)`), обе связаны с задачей.
**Коммиты**: `docs(task): VL-291 — refs и lessons`; `docs: VL-291 — документация и CHANGELOG` (0012f7c).
DoD: 1) Тесты проходят — ✓ (полный прогон зелёный); 2) Документация обновлена — ✓ (doc-6/7/8 + CHANGELOG + MCP-SETUP); 3) Нет регрессий — ✓ (полный прогон без падений, обратная совместимость одиночного url покрыта тестами). AC4 отмечен: тесты покрывают множественные url, частичный сбой и одиночную ссылку, документация по references обновлена.
---
<!-- COMMENTS:END -->