---
id: VL-344
title: 'reference cache: text/plain конвертируется как HTML — markdown-документ превращается в кашу (экранирование, потеря переводов строк, выброшенные &lt;tag&gt;)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 16:03'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - reference
  - cache
  - bug
  - core
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
  - src/core/reference-cache.ts
  - src/core/reference-cache.test.mjs
lessons:
  - lesson-227
token_usage:
  input: 3420237
  output: 23102
  cache: 3236864
  total: 3443339
  requests: 69
  duration_ms: 1152129
  reasoning: 6372
  by_phase:
    code:
      input: 1624954
      output: 13664
      cache: 1503744
      requests: 30
    close:
      input: 1795283
      output: 9438
      cache: 1733120
      requests: 39
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено пользователем при создании нового репозитория: reference на raw-URL GitVerse (`.../api/repos/bobarev/Vibelog.md/raw/branch/master/backlog/docs/doc-25-...md`) дал в кэше нечитаемую кашу (образец — `.vibelog/tmp/ref-1.md`).

**Причина.** `src/core/reference-cache.ts:117` — `classifyContentType` знает только два класса:

```ts
if (ct.includes('markdown')) return 'markdown';
if (ct.startsWith('text/') || ct.includes('html') || ct === '') return 'html';
```

GitVerse raw отдаёт `text/plain` (подтверждено в VL-335: «успешный ответ приходит как `text/plain`»), поэтому **markdown-файл уходит в `htmlToMarkdown()`**. Конвертер работает по спецификации, но на markdown-входе он:

- экранирует markdown-синтаксис: `---` → `\---`, `**жирный**` → `\*\*жирный\*\*`, `[0]` → `\[0\]`;
- выбрасывает `<name>`, `<alias>`, `<repo>`, `<template>` как неизвестные HTML-теги (в doc-25 это плейсхолдеры в примерах команд) — строка `vb create <name> --template <alias>/<repo>/<template>` превращается в `vb create \--template // \[флаги\]`;
- схлопывает все переводы строк в один пробел (правило collapse-whitespace) — весь документ становится одной строкой, заголовки `#` перестают быть заголовками.

Это **не регресс VL-232**: собственный конвертер корректен, ошибка в классификации content-type. `text/plain` — «неизвестный текст», а не HTML.

**Дополнительный риск.** `source_hash` считается от сырого ответа, а не от markdown, поэтому уже испорченные кэши `reference sync` не перезапишет (хэш не изменится) — нужен явный путь перезаписи.

**Образец порчи:** `.vibelog/tmp/ref-1.md` (4 строки, весь документ в одну строку).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `classifyContentType` возвращает три класса: `'markdown' | 'html' | 'text'`; `text/plain` и прочие `text/*` без `html` → `'text'` (сохранять как есть, без конвертации)
- [x] #2 `text/html`, `application/xhtml+xml` и пустой content-type → `'html'` (конвертировать), бинарные типы по-прежнему отклоняются ошибкой
- [x] #3 Добавлена эвристика `looksLikeHtml(text)`: при `'html'` без HTML-тегов в первых ~2 КБ содержимое сохраняется как есть; при `'text'` с явными HTML-тегами — конвертируется
- [x] #4 `fetchMarkdown` использует новую классификацию: markdown и text сохраняются байт-в-байт (с завершающим переводом строки), html — через `htmlToMarkdown`
- [x] #5 Регрессионный тест на реальном кейсе: markdown-документ, отданный как `text/plain`, сохраняется без экранирования (`---`, `**`, `[0]`), с сохранёнными переводами строк и без потери `<name>`/`<template>`
- [x] #6 Тест: `text/plain` с HTML-содержимым конвертируется в markdown (эвристика срабатывает)
- [x] #7 Тест: `text/html` без HTML-тегов сохраняется как есть (обратная эвристика)
- [x] #8 Существующий тест `assert.equal(classifyContentType('text/plain'), 'html')` обновлён — он закреплял именно этот баг
- [x] #9 Проверено, что `source_hash` не мешает перезаписи испорченных кэшей: либо `reference sync` перезаписывает при смене конвертации, либо добавлен явный способ перезаписи (`--force`/ручная чистка) — решение зафиксировано в Implementation Notes
- [x] #10 Ручная проверка на живом URL `https://gitverse.ru/api/repos/bobarev/Vibelog.md/raw/branch/master/backlog/docs/doc-25-...md` — кэш читаемый, markdown не экранирован
- [x] #11 CHANGELOG.md обновлён, doc-6/doc-7 (раздел `reference --cache`/`sync`) уточнены про обработку `text/plain`
- [x] #12 `pnpm build && pnpm test` зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/core/reference-cache.ts` — `classifyContentType`, `fetchMarkdown`, новый `looksLikeHtml`.
- `src/core/reference-cache.test.mjs` — тесты (сейчас строка 99: `assert.equal(classifyContentType('text/plain'), 'html')` — закрепляет баг).
- `doc-6`, `doc-7` — уточнение поведения `--cache`/`sync`.
- `CHANGELOG.md`.

## Шаг 1. Три класса вместо двух

```ts
export type ContentKind = 'markdown' | 'html' | 'text';

export function classifyContentType(contentType: string): ContentKind {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (ct === '' ) return 'html';                       // прежнее поведение: пусто → html (эвристика ниже решит)
  if (ct.includes('markdown')) return 'markdown';
  if (ct === 'text/html' || ct === 'application/xhtml+xml' || ct.includes('html')) return 'html';
  if (ct.startsWith('text/')) return 'text';           // ← text/plain, text/x-markdown без слова markdown и т.п.
  throw new Error(`неподдерживаемый content-type: ${contentType || '(пусто)'}`);
}
```

Важно: `text/x-markdown`, `text/plain; charset=utf-8` — параметры отрезаются до сравнения (сейчас `includes('markdown')` спасает случайно).

## Шаг 2. Эвристика по содержимому

```ts
/** Признаки HTML в первых 2 КБ: doctype, корневые теги, типичные блочные/ссылочные теги. */
export function looksLikeHtml(text: string): boolean;
```

Проверка по `text.slice(0, 2048)`, регистронезависимо: `<!doctype html`, `<html`, `<head`, `<body`, `<div`, `<p `, `<table`, `<a href`, `<ul`, `<h1`. Порог — **два разных признака** (одного `<p ` мало: в markdown-тексте может встретиться пример HTML).

## Шаг 3. `fetchMarkdown`

```ts
const kind = classifyContentType(contentType);
const useHtml = kind === 'html' ? looksLikeHtml(text) : (kind === 'text' && looksLikeHtml(text));
const markdown = useHtml ? htmlToMarkdown(text) : text.trim() + '\n';
```

То есть: `markdown` → как есть; `text` → как есть, **кроме** случая явных HTML-признаков; `html` → конвертация, **кроме** случая, когда признаков нет (сервер соврал в content-type).

## Шаг 4. Тесты

`src/core/reference-cache.test.mjs`:
1. обновить `classifyContentType`: `text/plain` → `'text'`, `text/html` → `'html'`, `text/markdown` → `'markdown'`, `application/xhtml+xml` → `'html'`, `image/png` → throws;
2. **регрессия на реальном кейсе**: markdown-строка с `---`, `**жирный**`, `[0]`, `vb create <name> --template <alias>/<repo>/<template>`, отданная как `text/plain` → в кэше байт-в-байт исходник (плюс завершающий `\n`), ни одного `\*`/`\[`/`\---`, переводы строк на месте;
3. `text/plain` с `<!doctype html><html><body><h1>T</h1>` → конвертируется в `# T`;
4. `text/html` с markdown-содержимым без тегов → сохраняется как есть;
5. `looksLikeHtml` юнит-кейсы: markdown-документ → false, HTML-страница → true, текст с одним `<p ` → false (порог два признака).

## Шаг 5. Испорченные кэши

Проверить `backlog/references/cache/*.md` на признаки порчи (наличие `\*\*`, `\---`, отсутствие переводов строк при длине > 1 КБ). Решение зафиксировать в Implementation Notes:
- вариант A: `reference sync --force` (перезапись без сверки `source_hash`);
- вариант B: `source_hash` дополнить версией конвертера (`sha256(raw + converterVersion)`) — тогда после фикса все кэши обновятся сами при следующем `sync`. Предпочтительно B: не требует ручных действий и защищает от будущих изменений конвертера.

## Шаг 6. Проверка

`pnpm build && pnpm test`; вручную `vibelog reference add "doc-25" --type url --url <URL> --cache` в тестовом каталоге → кэш читаемый; `vibelog reference sync --all` в этом репозитории → испорченные кэши перезаписаны.

## Риски

- **Ложная эвристика.** HTML, отданный как `text/plain` без явных тегов в первых 2 КБ (например, страница начинается с длинного `<style>`) — останется как есть. Приемлемо: лучше нечитаемый HTML, чем испорченный markdown.
- **Смена `source_hash` (вариант B)** инвалидирует все существующие кэши — это желаемое поведение, но упомянуть в CHANGELOG.
- **`text/plain` с HTML внутри** (редко) — конвертируется, что и нужно.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 16:47
---
Фаза 3 (Code) выполнена. Коммит 5586e85.
**Изменено:**
- `src/core/reference-cache.ts`:
  - `classifyContentType` → три класса `ContentKind = 'markdown' | 'html' | 'text'`; параметры (`; charset=utf-8`) отрезаются ДО сравнения; пустой → `html`; `text/html`/`application/xhtml+xml`/`*html*` → `html`; прочие `text/*` (в т.ч. `text/plain`, `text/x-markdown`) → `text`; бинари → прежняя ошибка.
  - новый `looksLikeHtml(text)` — 10 регистронезависимых признаков в первых 2 КБ, порог ДВА разных признака.
  - `fetchMarkdown`: `kind === 'markdown'` → как есть; иначе конвертация только при `looksLikeHtml(text)`. Т.е. markdown никогда не проходит через `htmlToMarkdown`, `text` — только при явных HTML-тегах, `html` — с обратной эвристикой (сервер соврал в content-type).
  - **Испорченные кэши (вариант B из плана):** `CONVERTER_VERSION = '2'` + `rawSourceHash(raw) = sha256(raw + '\0' + CONVERTER_VERSION)`, используется и в `buildCacheOutput`, и в `sectionsHash`. После фикса хэши всех существующих кэшей расходятся → `reference sync` перезаписывает их сам, без `--force` и ручной чистки. Комментарий в коде фиксирует правило «меняешь конвертер — увеличивай версию».
- `src/core/reference-cache.test.mjs`: обновлён тест `classifyContentType` (был `text/plain → 'html'` — закреплял баг); добавлены `looksLikeHtml` (markdown → false, HTML → true, один `<p ` → false); регрессия на реальном кейсе (markdown `---`/`**жирный**`/`[0]`/`vb create <name> --template <alias>/<repo>/<template>` отдан как `text/plain` → кэш байт-в-байт, без `\*`/`\[`/`\---`, переводы строк и `<...>` на месте); `text/plain` с настоящим HTML → `# T`; `text/html` с markdown → как есть; перезапись испорченного кэша с legacy-хэшем (обновление `source_hash`-ожиданий на `rawSourceHash`).
**Проверки:**
- `pnpm build && npx vitest run src/core/reference-cache.test.mjs` → 39/39 зелёные.
- Полный `pnpm test` (build + vitest, 178 файлов) — **все зелёные** (178 passed, 3404+8 passed). Первый прогон дал 1 падение в `src/web/orchestrator.test.mjs` (VL-114, `Unexpected end of JSON input` при чтении meta.json) — не связано с правкой: файл изолированно 88/88 зелёный, повторный полный прогон чистый → флейк параллельного прогона/сессии, а не регрессия.
- Ручная проверка на живом GitVerse raw: кэш читаемый — `doc-6-Руководство-пользователя-Vibelogmd.md` → 87 293 байта / 874 строки, `\*`/`\---`/`\[` отсутствуют, frontmatter и `# Руководство` целы. Указанный в задаче URL `doc-25-...v13.md` вернул **HTTP 400 `{"code":4305,...File ... not found"}`** — файл с таким именем в ветке master не находится через raw-API (кириллица в имени); проверка выполнена на другом живом документе того же репозитория, механика идентична.
- Испорченных кэшей в `backlog/references/cache/` этого worktree нет (каталог отсутствует; у ref-18/19/20 кэш не записан, только `source_hash` в метаданных) — перезапись после смены версии конвертера запустится при следующем `sync`, что покрыто тестом.
**Что осталось:** AC11 (CHANGELOG.md, doc-6, doc-7) — по правилам фазы Code документация пишется в фазе Close после merge.
**Implementation Notes:** реализован вариант B плана (версия конвертера в `source_hash`), `--force` для `sync` не добавлялся.
---
author: @agent
created: 2026-11-05 17:15
---
Фаза close не удалась (код выхода 1): ет, блокировок=0, payload последнего запроса=168854 байт (макс 168854), usage={"input_tokens":694057,"output_tokens":2700,"cache_read_input_tokens":672768,"total_tokens":696757,"reasoning_tokens":612} — статус возвращён к Review.
---
author: @agent
created: 2026-11-05 17:23
---
Фаза Close выполнена. Статус: Done.
**Коммиты:**
- feat — не требовался: код задачи уже закоммичен в фазе Code (`5586e85 fix: VL-344 — text/plain не конвертируется как HTML`) и слит в master (`fa749ce merge: VL-344`); `git status` по `src/core/reference-cache.ts` и `src/core/reference-cache.test.mjs` чист.
- docs `d0d279b` — CHANGELOG.md (запись в Unreleased → «Исправлено»), doc-6 §13 (новый абзац «Как содержимое превращается в markdown»), doc-7 раздел `reference` (новый абзац «Классификация content-type при кэшировании»).
- docs(task) `c7c48e1` — lesson-227 (refs и lessons).
**Проверки после merge:**
- `pnpm build` — успешно (tsc без ошибок).
- Ранний точечный фильтр: `npx vitest run src/core/reference-cache.test.mjs` — 39/39 зелёные.
- Полный прогон `pnpm test:fast` (dist собран шагом выше) — **181 файл, 3426 passed, 4 skipped, 0 failed**. Повторных прогонов не было.
**Документация:** AC11 закрыт — CHANGELOG и оба документа обновлены (три класса content-type, эвристика `looksLikeHtml`, версия конвертера в `source_hash` → `sync` перезаписывает кэши без `--force`). DoD «Документация обновлена» отмечен.
**Lessons:** lesson-227 (создан в фазе Code с пустым телом) наполнен содержанием — проблема, решение (три класса + эвристика + версия конвертера в хэше) и пример кода с тестом-регрессией; связан с VL-344 (`linked_tasks` ↔ `task.lessons`).
**Не закоммичено:** нет. Файл задачи VL-344 коммитит framework после записи token_usage. Посторонние изменения в рабочем каталоге (`.vibelog/settings.json`, удаление doc-25 v12, файлы VL-342/343/345, `web/public/vibelog.svg`, billing) к этой задаче не относятся и не трогались.
---
<!-- COMMENTS:END -->