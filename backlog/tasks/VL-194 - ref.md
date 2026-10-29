---
id: VL-194
title: 'references: локальный кэш для doc/url'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 18:28'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - cli
dependencies: []
milestone: v1.10
references:
  - ref-17
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/reference-cache.ts
  - src/core/reference-cache.test.mjs
  - src/core/reference.ts
  - src/core/paths.ts
  - src/cli/commands/reference.ts
  - src/cli/router.ts
  - src/cli/reference-cli.test.mjs
  - src/mcp/tools.ts
  - src/mcp/reference-tools.test.mjs
  - src/types/turndown-plugin-gfm.d.ts
  - templates/phases/phase-plan.md
  - .gitignore
  - package.json
  - pnpm-lock.yaml
  - tsconfig.json
lessons:
  - lesson-51
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Локальный markdown-кэш для reference типа doc/url: скачивание → очистка HTML → markdown → сохранение, чтобы Plan-фаза не делала web_fetch при каждом чтении.

## Механика (Фаза 1)

- `download → очистка HTML (script/style/nav/footer/header) → Turndown → сохранение`
- Поля reference: `cached_path`, `cached_at`, `source_hash`
- Синхронизация: `reference sync ref-N` (перекачать с проверкой source_hash), `reference sync --all` (обновить устаревшие)
- `reference_view`: кэш → иначе fallback на URL (текущее поведение)

## Решения Фазы 2 (Plan)

- Флаг add: `--cache` (не --sync: `sync` уже занята подкомандой клонирования репо)
- Каталог кэша: `backlog/references/cache/<ref-id>.md` + строка в `.gitignore` (data/ не использовать — коллизия имени каталога с клоном репо «cache»)
- Конвертация: turndown + turndown-plugin-gfm (GFM-таблицы), как в ref-17
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-194 — Локальный кэш reference (doc/url) → markdown

## Архитектурные решения (Фаза 2)

1. **Флаг add — `--cache`** (не `--sync`): подкоманда `sync` уже занята клонированием репо; `--cache` однозначен — «скачай и закэшируй сейчас».
2. **Каталог — `backlog/references/cache/<ref-id>.md`** (не `data/`): в `data/` лежат клоны репо по имени каталога — коллизия, если у репо имя «cache». `cache/` добавляем в `.gitignore` (кэш — воспроизводимые данные, в git не идут; `listReferences` читает только файлы верхнего уровня `references/*.md`, подкаталог `cache/` не подхватится — проверено по `src/core/reference.ts:185-201`).
3. **Имена полей frontmatter**: `cached_path` (относительно backlog/), `cached_at` (ISO-8601 UTC), `source_hash` (sha256 сырого HTML). Совместимость: `backlog/references/` — расширение Vibelog (VL-152), Backlog.md этот каталог не читает → свободное именование; формат держим в стиле существующих полей.
4. **HTML→markdown**: `turndown@7.2.4` + `turndown-plugin-gfm@1.0.2` (GFM-таблицы/strikethrough/taskList), как в ref-17. Оба — чистый JS, без нативных модулей, Node 20 ✓.
5. **`reference_view`**: если кэш читается — поле `cached_markdown` (+`cached_at`, `source_hash`); иначе прежнее поведение (url в метаданных → fallback на web_fetch).
6. **`sync`**: без аргументов — прежнее поведение (клонирование, обратная совместимость); `sync <ref-id>` — перекачать кэш одного; `sync --all` — клоны + перекачать все url/doc-кэши со сравнением `source_hash`.

## Изменяемые файлы

### 1. `package.json` + `tsconfig.json` — зависимости
- `dependencies`: + `turndown: ^7.2.4`, `turndown-plugin-gfm: ^1.0.2`; `devDependencies`: + `@types/turndown: ^5.0.6`. Затем `pnpm install`.
- `tsconfig.json:7` (compilerOptions): + `"esModuleInterop": true` — @types/turndown использует `export =`, default-импорт невозможен без него; `import x = require()` запрещён в NodeNext-ESM. Emit в ESM не меняется → риск минимален, проверяем полным прогоном.
- **Новый** `src/types/turndown-plugin-gfm.d.ts`: `declare module 'turndown-plugin-gfm'` (types на npm нет — проверено `npm view @types/turndown-plugin-gfm` → 404). Включится через `include: ["src/**/*"]`.

### 2. `src/core/paths.ts` — каталог кэша
- После `referencesDataDir` (~строка 137): экспорт `referencesCacheDir(backlogDir)` → `join(backlogDir, 'references', 'cache')`.

### 3. `src/core/reference.ts` — поля кэша в модели
- `interface Reference` (строки 31-41): + `cached_path?: string; cached_at?: string; source_hash?: string`.
- `referenceToMarkdown` (128-143): сериализовать три поля, если заданы.
- `markdownToReference` (145-167): парсить три поля.
- **Критично — потеря полей**: `updateReference` (266-274) собирает `merged` вручную из известных полей → без правки `linkReferenceTask`/rename **сотрёт** кэш-поля. Добавить их в merge + в `UpdateReferenceInput` (239-248).
- Новый экспорт `referenceCachePath(backlogDir, ref)` → `referencesCacheDir/<ref-id>.md` (имя по id, не по title — rename title не ломает кэш).

### 4. **Новый** `src/core/reference-cache.ts` — ядро фичи
```
downloadHtml(url, fetchFn, timeoutMs=15000)  — fetch c AbortSignal.timeout; проверки: response.ok,
  content-type (text/html | text/* | markdown → без конвертации), лимит размера 5 МБ;
  fetchFn инжектируется (дефолт globalThis.fetch) — тесты без реальной сети (guard VL-132,
  см. src/test-setup.mjs:36 — не-loopback fetch в тестах отклоняется)
htmlToMarkdown(html)  — TurndownService({ headingStyle:'atx', codeBlockStyle:'fenced' }).
  remove(['script','style','nav','footer','header','aside','form','button','iframe','svg'])
  + .use(gfm) из turndown-plugin-gfm (table GFM, strikethrough, taskList);
  оставшееся (h1-h6, p, ul/ol, pre/code, table, blockquote, a, img) конвертируется дефолтными
  правилами turndown — как в ref-17 (backlog/references/data/ — Turndown, mixmark-io)
cacheReference(cwd, ref, deps?)  — download → sha256 (node:crypto) → htmlToMarkdown →
  запись cache/<id>.md → updateReference({ cached_path, cached_at, source_hash })
refreshReferenceCache(cwd, ref, deps?)  — перекачать, сравнить source_hash:
  совпал → {updated:false}; отличается → перезапись + обновление полей
readReferenceCache(cwd, ref) → string | null (existsSync + readFileSync, ошибки → null)
syncReferenceCaches(cwd, { ids? | all }, deps?)  — итог {updated, skipped, failed} по образцу
  SyncResult (reference.ts:62-67)
```
Порядок функций — download → htmlToMarkdown → cache → refresh → read → sync.

### 5. `src/cli/commands/reference.ts` — CLI
- `case 'sync'` (62-63): передать `positional, flags` → `referenceSync(positional, flags, cwd)`.
- `referenceAdd` (97-125): после клонирования (116-121) — `hasFlag(flags,'cache')` → для type∈{url,doc} с url вызвать `cacheReference`, успех/ошибка печатаются, `--cache` без url → `printError`. Обновить подсказку в строке 100 (добавить `[--cache]`).
- `referenceView` (127-141): после body — если `readReferenceCache` вернул строку, напечатать блок `Кэш (<cached_at>):\n<markdown>`; иначе ничего (fallback = url уже печатается строкой 137).
- `referenceSync` (203-210): без аргументов — прежний `syncReferenceRepos`; `positional[0]` — refresh одного (id валидируется, не найден → ошибка); `hasFlag(flags,'all')` — `syncReferenceRepos` + `syncReferenceCaches({all:true})`; печать итогов по образцу существующей (208).

### 6. `src/cli/router.ts` — справка (lesson-18/21: все точки входа)
- Блок help `reference` (242-256): строка `add` (249-250) → дополнить `--cache`; строка `sync` (256) → `sync [ref-id] [--all] — кэш кэшировать/обновить (без аргументов — как прежде, клоны)`.

### 7. `src/mcp/tools.ts` — MCP
- Схема `reference_add` (406-419): + `cache: { type:'boolean', description:'Скачать и закэшировать markdown сейчас (url/doc)' }`.
- Схема `reference_sync` (482-485): + свойства `id` (ref-N) и `all` (boolean); описание дополнить.
- `toolReferenceAdd` (1436-1452): `args.cache === true` → `cacheReference`, приписать результат к сообщению.
- `toolReferenceView` (1454-1462): `readReferenceCache` → в JSON добавить `cached_markdown`, `cached_at`, `source_hash` (из файла, не из метаданных — защита от рассинхрона).
- `toolReferenceSync` (1496-1501): расход по `args.id` / `args.all` / без аргументов (прежнее поведение), ответ JSON `{cloned?, skipped?, updated?, failed?}`.

### 8. `.gitignore` (строка 4, после `backlog/references/data/`): + `backlog/references/cache/`

### 9. `templates/phases/phase-plan.md` (строки 35-38): в шаг про references добавить: «если reference_view вернул `cached_markdown` — используй его, web_fetch/парсинг не нужен; иначе fallback на URL».

### 10. Тесты
- **Новый** `src/core/reference-cache.test.mjs`: `htmlToMarkdown` (чистка script/style/nav/footer/header, сохранение h1/p/list/table/blockquote/link/img, GFM-таблица); `cacheReference` со стабом fetchFn (200 HTML → файл + три поля в frontmatter через `getReference`); отклонения: non-200, non-html >5МБ, markdown content-type → сохранение как есть; `refreshReferenceCache`: hash совпал → updated:false, изменился → перезапись; **updateReference не теряет cached_*-поля** (link/rename — regression-тест); round-trip `cached_at` ISO-строки через yaml (`escapeScalar` цитирует `:` — проверить чтение обратно).
- `src/cli/reference-cli.test.mjs`: `add --cache` на loopback-сервере (`node:http` на 127.0.0.1 — guard пропускает loopback, см. LOOPBACK_HOSTS в test-setup.mjs); `sync` без аргументов = прежнее клонирование (не сломано); `sync <id>` / `sync --all`; **новый флаг доезжает до точки входа** (lesson-18).
- `src/mcp/reference-tools.test.mjs`: `reference_add{cache:true}` → `reference_view` содержит `cached_markdown`; `reference_sync{id}` / `{all}`.
- Существующие `src/core/reference.test.mjs` — не должны упасть (расширение модели).

## Порядок выполнения

1. Зависимости: package.json → `pnpm install` → tsconfig esModuleInterop → `src/types/turndown-plugin-gfm.d.ts` → `pnpm build` (быстрая проверка компиляции турндова).
2. `paths.ts` → `reference.ts` (модель + merge-поля) → сборка.
3. `reference-cache.ts` + юнит-тесты → сборка.
4. CLI (`commands/reference.ts` + `router.ts` help) + CLI-тесты.
5. MCP (`tools.ts`) + MCP-тесты.
6. `.gitignore` + `templates/phases/phase-plan.md`.
7. Финальная проверка: `pnpm build && pnpm test` (полный прогон).

## Как проверить

```bash
pnpm install && pnpm build          # компиляция + esModuleInterop
pnpm test                           # build + vitest (все файлы)
node scripts/npm-smoke.mjs          # если публикация планируется (VL-32)
# ручная проверка CLI:
vibelog reference add "Test doc" --type doc --url http://127.0.0.1:PORT/ --cache
vibelog reference view ref-N        # должен печатать «Кэш (...)»
vibelog reference sync ref-N        # перекачать; sync --all; sync — только клоны
```

## Риски

- **esModuleInterop** — глобальная правка tsconfig: минимизируется прогоном `pnpm test`; альтернатива (если что-то упадёт): `allowSyntheticDefaultImports: true` вместо полного interop.
- **turndown-plugin-gfm без типов** — локальный `.d.ts`; поведение плагина покрыто тестом на GFM-таблицу.
- **Потеря cached_*-полей в `updateReference`** — главный скрытый риск (ручной merge в 266-274): покрыть regression-тестом.
- **Сеть в тестах (VL-132)** — только инжекция fetchFn и loopback-серверы; реальный fetch запрещён guard'ом.
- **Большие/не-HTML ответы** — лимит 5 МБ + content-type; иначе fetch не начинаем читать тело без проверки.
- **Обратная совместимость** — `sync` без аргументов и `reference_view` без кэша не меняют поведение (нет кэша → прежний JSON).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 19:33
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: цель (локальный markdown-кэш для doc/url-референсов вместо повторного web_fetch в Plan-фазе), механика (download → очистка HTML script/style/nav/footer/header → Turndown → сохранение с полями cached_path/cached_at/source_hash), команды sync (ref-N и --all по source_hash), поведение reference_view (кэш → иначе fallback на URL). Открытые именования (--cache/--sync, каталог cache/ vs data/) отданы Фазе 2 Plan с приоритетом совместимости с Backlog.md. Labels: core, cli. References: ref-17 (Turndown). Вопросов нет.
---
author: @agent
created: 2026-10-26 20:12
---
Фаза 2 (Plan) выполнена. Тип: task (enhancement). План записан в Implementation Plan. Изучены: src/core/reference.ts (462 стр., модель + updateReference-merge), src/cli/commands/reference.ts, src/mcp/tools.ts (схемы/обработчики reference_*), src/core/paths.ts, src/test-setup.mjs (guard VL-132), ref-17 (Turndown). Архитектурные решения: (1) флаг add — --cache (--sync конфликтует с подкомандой sync); (2) каталог кэша backlog/references/cache/<ref-id>.md + .gitignore (data/ — коллизия с клонами репо); (3) поля cached_path/cached_at(ISO)/source_hash(sha256 HTML); (4) turndown@7.2.4 + turndown-plugin-gfm (GFM-таблицы), esModuleInterop в tsconfig + локальный .d.ts для плагина; (5) reference_view отдаёт cached_markdown при наличии, иначе прежний fallback на URL; (6) sync без аргументов — прежнее клонирование (обратная совместимость), sync ref-N / --all — перекачка кэша со сравнением source_hash. План: 10 файлов (новые: src/core/reference-cache.ts, src/types/turndown-plugin-gfm.d.ts, src/core/reference-cache.test.mjs), 7 шагов порядка, проверка pnpm build && pnpm test. Ключевые риски: глобальный esModuleInterop, потеря cached_*-полей в ручном merge updateReference (покрыть regression-тестом), сеть в тестах только через инжекцию fetchFn/loopback.
---
author: @agent
created: 2026-10-26 21:16
---
Фаза 3 (Code) выполнена. Изменено: src/core/reference-cache.ts (новый: downloadText с лимитом 5МБ/таймаутом/схемой, htmlToMarkdown на turndown+gfm с чисткой script/style/nav/footer/header/title/head/svg, cacheReference/refreshReferenceCache/readReferenceCache/syncReferenceCaches), src/core/reference.ts (поля cached_path/cached_at/source_hash в модели, сериализации, parse (ключи не создаются без значений — round-trip VL-152 сходится) и в merge updateReference — регрессия link/rename закрыта; referenceCachePath), src/core/paths.ts (referencesCacheDir), src/cli/commands/reference.ts (--cache при add, view печатает блок «Кэш», sync [ref-id] [--all]), src/cli/router.ts (справка), src/mcp/tools.ts (схема+обработчики: cache в reference_add, cached_markdown в view, id/all в reference_sync), .gitignore (backlog/references/cache/), templates/phases/phase-plan.md (cached_markdown → без web_fetch), tsconfig.json (esModuleInterop), package.json+lock (turndown@7.2.4, turndown-plugin-gfm@1.0.2, @types/turndown), src/types/turndown-plugin-gfm.d.ts (новый), тесты: src/core/reference-cache.test.mjs (29), src/cli/reference-cli.test.mjs (+5, loopback-сервер, async spawn), src/mcp/reference-tools.test.mjs (+6). Коммит 9dfd99b (15 файлов). Проверки: pnpm build ✓, pnpm lint ✓, pnpm test — 74 файла, 1333 passed / 4 skipped / 0 failed (в т.ч. все существующие reference/compat/regression без регрессий). DoD: тесты проходят ✓, документация (CLI-справка + шаблон phase-plan) ✓, нет регрессий ✓. Учтён урок lesson-18 (новый флаг --cache проведён через CLI router → core → MCP). Создан lesson-51 (spawnSync vs async spawn в CLI-тестах с loopback-сервером). Изменений в node_modules главного репо нет (в worktree поставлена локальная копия зависимостей). Что осталось: нет ручной проверки «живого» скачивания внешнего URL (все тесты — стабы/loopback по правилу VL-132); web-UI (POST /api/references/sync) не расширен — вне объёма плана.
---
author: @agent
created: 2026-10-26 21:21
---
Фаза Close выполнена. Ветка vb/vl-194 слита в master (1 коммит 9dfd99b, merge 8f4f56a, без конфликтов), pnpm install/build/test после merge — зелёные (74 файла, 0 failed). Worktree удалена (force — только untracked-симлинк data), ветка удалена. Docs-коммит: 9b23ac3 (CHANGELOG, запись Unreleased; backlog/docs не менялись — reference CLI/MCP там не описаны), refs/lessons-коммит: 3d8e3e7 (ref-17, lesson-51). DoD: 1 тесты проходят ✓ (pnpm test: 0 failed), 2 документация обновлена ✓ (CLI-справка router, шаблон phase-plan, CHANGELOG), 3 нет регрессий ✓ (существующие reference/compat-тесты зелёные). Lessons: lesson-51 связана с VL-194 (создана в Code). Осталось вне объёма: ручная проверка живого внешнего URL (тесты — стабы/loopback по VL-132), web-UI POST /api/references/sync не расширен.
---
<!-- COMMENTS:END -->