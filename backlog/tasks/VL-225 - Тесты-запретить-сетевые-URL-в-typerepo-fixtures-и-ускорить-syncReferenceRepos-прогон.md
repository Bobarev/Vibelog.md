---
id: VL-225
title: 'Тесты: запретить сетевые URL в type=repo fixtures и ускорить syncReferenceRepos-прогон'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 20:54'
updated_date: '2026-10-29 21:13'
due_date: ''
labels: []
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
  - src/core/reference.test.mjs
  - src/core/reference.ts
lessons:
  - lesson-52
token_usage:
  input: 1078611
  output: 21066
  cache: 903168
  total: 1099677
  requests: 21
  duration_ms: 215203
  by_phase:
    spec:
      input: 45894
      output: 181
      cache: 41088
      requests: 2
    plan:
      input: 1032717
      output: 20885
      cache: 862080
      requests: 19
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-224. src/core/reference.test.mjs оставляет в общем testRoot type=repo references с внешними URL (https://x.example/a.git L92, https://github.com/BloopAI/vibe-kanban.git L133); syncReferenceRepos (L261) пытается их клонировать через spawnSync('git','clone') и зависает в офлайн-DNS до 120 с (падение Test timed out in 120000ms в сессии agent-1793292869113). Привести fixtures к file:///*.invalid-хостам либо удалять repo-fixtures перед sync-тестом; проверить, что полный pnpm test проходит без доступа к интернету за разумное время.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В src/core/reference.test.mjs не остаётся type=repo записей с внешним https:// URL к моменту вызова syncReferenceRepos.
- [x] #2 pnpm test:fast с отключённой сетью (например, HTTPS_PROXY=http://127.0.0.1:9 / отсутствующий DNS) завершается без Test timed out в reference.test.mjs.
- [x] #3 Длительность полного прогона не содержит «висячих» ~120 с на этом файле (замер до/после).
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Plan VL-225 — запрет сетевых URL в repo-fixtures и ускорение syncReferenceRepos-прогона

## Диагноз (что именно висит)

`src/core/reference.test.mjs` (282 строки) живёт в **общем** `testRoot` (`mkdtempSync` L25) для всех describe-блоков. К моменту запуска sync-теста (describe L215) в `refsDir` уже лежат:
- `ref-1` — type=repo, `url: https://x.example/a.git` (L92, CRUD-тест);
- `ref-10` — type=repo, `url: https://github.com/BloopAI/vibe-kanban.git` (L133, поиск-тест).

`syncReferenceRepos(testRoot, gitEnv)` (L262, повторно L273) вызывает `cloneReferenceRepo` → `spawnSync('git', ['clone', '--depth', '1', ref.url, ...])` (src/core/reference.ts L428) **без таймаута**. git пытается резолвить внешний хост → офлайн-DNS виснет → `testTimeout: 120_000` (vitest.config.mts L37) → «Test timed out in 120000ms». fetch-guard VL-132 (src/test-setup.mjs) глобальный fetch не спасает — git clone идёт мимо fetch.

AC требует: **на момент вызова syncReferenceRepos в refsDir не должно быть type=repo записей с внешним https:// URL**; замер длительности до/после; прогон без сети.

## Файлы для изменения

1. **`src/core/reference.test.mjs`** — правки fixtures + страховочный фильтр в sync-beforeAll.
2. **`src/core/reference.ts`** — defensive timeout в cloneReferenceRepo (багпродукта: зависает при офлайн-DNS).

## Конкретные правки (по местам)

### A. Заменить сетевые https:// URL у type=repo fixtures

1. **L70** (round-trip `createReference`, type=repo): `url: 'https://example.com/x.git'` → `url: 'file:///nonexistent/x.invalid.git'`. Тест — только сериализация, URL не проверяется; убираем https из файла в принципе.
2. **L92** (CRUD «writeReference: id ref-N…», type=repo): `url: 'https://x.example/a.git'` → `url: 'file:///nonexistent/a.invalid.git'`. Тест не клонирует ref-1 и URL не матчит — безопасно; `ref-1-First.md` создаётся как раньше.
3. **L133** (поиск ref-10, type=repo): `url: 'https://github.com/BloopAI/vibe-kanban.git'` → `url: 'file:///nonexistent/vibe-kanban.invalid.git'`.
   - L143 `searchReferences('kanban')` — матчит title+tag, не url → работает.
   - **L144 `searchReferences('nodejs.org')`** ищет url **ref-11** — ref-11 это **type=url** (`https://nodejs.org/api/fs.html`, L136-138). type=url не участвует в clone/sync (проверка «только для type=repo», тест L255-256) → **ref-11 и L144 НЕ трогаем**, AC говорит только про type=repo.
4. **L99** (type=url `https://x.example/b`) — не трогаем.
5. sync-фикстуры (L233-258): ref-20/ref-24 — локальный `file://` remote; ref-21 — `file:///nonexistent` (быстрый fail); ref-23 — без url. Уже офлайн-безопасны.

После правок: `grep -n "type: 'repo'" src/core/reference.test.mjs` — у каждой repo-записи URL не `https://`.

### B. Страховочный фильтр в beforeAll sync-describe (гарантия AC-1)

В `describe('VL-152 — cloneReferenceRepo / syncReferenceRepos')`, **beforeAll (L220)**, в начало:

```js
// VL-225: к моменту sync в refsDir не должно остаться type=repo записей
// с внешними https:// URL (AC-1). Фикстуры CRUD/поиска уже не https,
// но фильтр гарантирует AC независимо от будущих тестов выше по файлу.
for (const entry of listReferences(testRoot)) {
  if (entry.reference.type === 'repo' && /^https?:\/\//.test(entry.reference.url || '')) {
    removeReference(testRoot, entry.reference.id);
  }
}
```

После A цикл ничего не находит (ничего не удалит) — чистая страховка.

### C. Таймаут в cloneReferenceRepo (src/core/reference.ts L428)

```ts
const res = spawnSync('git', ['clone', '--depth', '1', ref.url, target], { encoding: 'utf-8', env });
```
→ добавить `timeout: 15_000`:
```ts
const res = spawnSync('git', ['clone', '--depth', '1', ref.url, target], { encoding: 'utf-8', env, timeout: 15_000 });
```
15 с достаточно для локального `file:// --depth 1` clone; мгновенно убивает любой сетевой висячий clone (продуктовый баг: `vibelog reference sync` зависает при офлайн-DNS). При таймауте spawnSync возвращает status≠0 с stderr → существующая ветка «ошибка клонирования» (L430+) обрабатывает, тест L246-251 не затронут (там ошибка мгновенная). Сигнал kill — дефолтный SIGKILL.

### D. Замер длительности до/после (AC-3)

- **До**: `time HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 npx vitest run src/core/reference.test.mjs` (если без прокси висячие 120 с не воспроизводятся — прокси форсирует висячий http-коннект на закрытый порт; либо фиксируем цифру 120 с из инцидента agent-1793292869113 как «до»).
- **После**: та же команда → ожидаем секунды, без «Test timed out».
- Полный прогон: `time HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 pnpm test`.
- Обе цифры «до → после» вписать в финальный отчёт (AC-3).

## Порядок действий

1. Замер «до» (команда D).
2. Правки A (L70, L92, L133) в `src/core/reference.test.mjs`.
3. Правка B (beforeAll sync-describe L220+).
4. Правка C (`src/core/reference.ts` L428).
5. Замер «после» одиночного файла.
6. Полный прогон: `time HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 pnpm test` (build + vitest внутри).
7. Заметки о длительности — в финальный отчёт фазы Code.

## Как проверить

```bash
# одиночный файл офлайн
HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 npx vitest run src/core/reference.test.mjs

# AC-1: у type=repo нет https://
grep -n "type: 'repo'" src/core/reference.test.mjs

# полный прогон + замер (pnpm test = build + vitest run)
time HTTPS_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 pnpm test
```

## Риски

- **Правка core (C)**: реальный clone >15 с (гигантский репозиторий) теперь упадёт по таймауту. `--depth 1` покрывает типовые случаи; при замере проблем — поднять до 30_000 (решение в Code).
- **L144 (`'nodejs.org'`)**: если по ошибке тронуть ref-11 — поиск сломается; в плане явно исключён.
- **`isolate: false` (VL-139)**: правки не создают межфайлового state (testRoot — mkdtemp per-file) — риск нулевой.
- Замер «до» может не воспроизвести висячие 120 с при живом DNS → используем HTTPS_PROXY-форс либо цифру из инцидента.

## Соответствие AC

1. Правки A + фильтр B: на момент L262/L273 у type=repo нет внешних https:// URL. ✔
2. `pnpm test:fast`/`npx vitest run` с `HTTPS_PROXY=http://127.0.0.1:9` без «Test timed out» в reference.test.mjs. ✔
3. Замер до/после одной командой, разница — в отчёте (зависание устранено: ~120 с → секунды). ✔
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 20:56
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: bug. Масштаб: task. Приоритет: Medium. Уточнено: AC приведены к конкретной проверяемой форме (запрет внешних https:// URL в repo-fixtures к моменту syncReferenceRepos, прогон pnpm test:fast без сети без таймаутов, замер длительности до/после). Labels: core. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 20:57
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан, 2 файла: src/core/reference.test.mjs (https→file:// у type=repo fixtures L70/L92/L133 + страховочный фильтр removeReference в beforeAll sync-describe L220) и src/core/reference.ts (timeout: 15_000 в spawnSync git clone L428 — продуктовый баг зависания sync при офлайн-DNS). ref-11 (type=url, nodejs.org) исключён из правок — не участвует в clone. Риски: таймаут 15 с для реальных больших клонов (можно поднять до 30 с), замер «до» может требовать HTTPS_PROXY=http://127.0.0.1:9 для воспроизведения висячих 120 с. Проверка: офлайн-прогон vitest + time-замер до/после + полный pnpm test.
---
author: @agent
created: 2026-10-29 21:00
---
Фаза code не удалась (код выхода 1): ] фаза: запросов=4, payload последнего запроса=308977 байт (макс 308977), usage={"input_tokens":280932,"output_tokens":5542,"cache_read_input_tokens":197632,"total_tokens":286474,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 21:00
---
Фаза 3 (Code) выполнена (продолжение после лимита ходов). Изменено: src/core/reference.test.mjs (type=repo fixtures L70/L92/L133 переведены на file:///nonexistent/*.invalid.git; страховочный фильтр в beforeAll sync-describe удаляет type=repo с http(s):// URL к моменту sync), src/core/reference.ts (timeout: 15_000 в spawnSync git clone — продуктовая защита от зависания при офлайн-DNS). Коммит ec19599 (ветка vb/vl-225). Проверки: pnpm build OK; одиночный прогон reference.test.mjs офлайн (HTTPS_PROXY=http://127.0.0.1:9): 22 passed, ~0.8 с (было ~120 с таймаут); полный pnpm test офлайн: всё зелёное, ~1m16s, без Test timed out; grep: у type=repo не осталось https:// URL (L69/L132 — url на следующей строке в multiline-литерале, проверено: file:///*.invalid), type=url fixtures (nodejs.org L138, x.example/b L99) не тронуты — не участвуют в clone. DoD: 1 (тесты) и 3 (регрессий нет, полный прогон зелёный) выполнены; 2 (документация) — не выполнялось, документацию пишет Close.
---
author: @agent
created: 2026-10-29 21:08
---
Фаза close не удалась (код выхода 1):  фаза: запросов=13, payload последнего запроса=216112 байт (макс 216112), usage={"input_tokens":439333,"output_tokens":6633,"cache_read_input_tokens":367360,"total_tokens":445966,"reasoning_tokens":0} — статус возвращён к Review.
---
author: @agent
created: 2026-10-29 21:13
---
Фаза Close выполнена. Ветка vb/vl-225 слита в master (1 коммит ec19599, merge 17337b2), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. Проверки после merge: pnpm build OK; pnpm test — 1500 passed, падают только 24 теста src/agent/llm.test.mjs — ПРЕДСУЩЕСТВУЮЩАЯ environmental-проблема (не регрессия VL-225): createLlmClient без cwd резолвит .vibelog/settings.json главного репо с api_mode=responses → тестовые мок-fetch получают Responses-wire вместо chat (зафиксировано в lesson-78; vl-225 вообще не менял src/agent/). Сам файл задачи reference.test.mjs зелёный офлайн. Замер AC-3: до — зависание ~120 с (Test timed out, инцидент agent-1793292869113); после — одиночный прогон офлайн ~0,8 с (22 passed), полный pnpm test офлайн ~1m16s без Test timed out. DoD честно: 1 (тесты) — выполнено для затронутого файла (reference.test мгновенно зелёный; llm.test — environmental, отмечен), 3 (регрессий нет от VL-225) — выполнено; 2 (документация) — выполняется этой фазой (CHANGELOG-запись + lesson-52 обновлён). Отмечены AC 1-3.
---
<!-- COMMENTS:END -->