---
id: VL-349
title: 'lesson_update без content при теле-скелете уходит в noop: Close падает по капу повторов (рецидив VL-319, сессия agent-1794045441657)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 13:12'
updated_date: '2026-11-08 01:47'
due_date: ''
labels:
  - agent
  - mcp
  - lessons
  - noop
  - bug
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
  - src/core/lesson.ts
  - src/core/lesson-audit.ts
  - src/mcp/tools.ts
  - src/core/lesson.test.mjs
  - src/core/lesson-audit.test.mjs
  - src/mcp/lesson-tools.test.mjs
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/agent/loop.test.mjs
lessons:
  - lesson-233
token_usage:
  input: 12649267
  output: 78196
  cache: 11981312
  total: 12727463
  requests: 185
  duration_ms: 728785
  reasoning: 35459
  by_phase:
    code:
      input: 11232312
      output: 71829
      cache: 10611200
      requests: 156
    close:
      input: 1416955
      output: 6367
      cache: 1370112
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Close VL-346 упал кодом 1 (сессия `agent-1794045441657`, ошибка qwen): «Модель 4 раз повторила вызов `lesson_update`, вернувший «изменений нет», — вызов не исполнялся, фаза прервана». Работа при этом была сделана полностью: merge в master (`8e3eec8`), `pnpm build` и полный `pnpm test` (184 файла, 3455 тестов) прошли, worktree убран. Упало только на шаге lessons.

## Точная последовательность (транскрипт)

1. `lesson-232` существует, тело = `## Проблема\n\n## Решение\n\n## Пример\n` — **скелет**, не пустая строка.
2. Модель: `lesson_update {id:"lesson-232", title, tags, sourceTasks, verifiedBy}` — **без `content`** (намеревалась «заполнить тело»).
3. Ответ: `{ok:false, noop:true, reason:"noop", message:"Изменений нет: title, tags, source_tasks, verified_by уже имеют эти значения…", hint:"Переходи к следующему шагу фазы"}` — **`missing` отсутствует**.
4. Модель повторила тот же вызов 4 раза → `MAX_NOOP_REPEATS_PER_RUN` → `fail()` → код 1.

## Корень: VL-319 обезврежен собственным скелетом

Защита VL-319 в `toolLessonUpdate` (`src/mcp/tools.ts:2686`) срабатывает по условию `updates.content === undefined && current.body.trim() === ''`. Скелет `LESSON_BODY_SKELETON` (`src/core/lesson.ts:352`) — непустая строка, поэтому:

- ветка «тело пустое → `ackErrorDetailed` с `missing: content`» не срабатывает;
- вызов уходит в обычную noop-сверку, и `missing` остаётся пустым (там та же проверка `trim() === ''`);
- модель получает `hint: «Переходи к следующему шагу»`, хотя единственное, чего не хватает, — `content` в аргументах.

VL-319 вылечил «пустое тело», но скелет создал новое состояние — «тело есть, но это дефолтная заглушка», и ни один инструмент его не распознаёт. `lesson_audit` finding `empty_body` (`src/core/lesson-audit.ts:326`) тоже проверяет только `trim() === ''` — склад уроков-скелетов невидим.

Второй дефект: `lesson_create` без `content` молча подставляет скелет и отвечает `ackOk` — MCP-путь сам производит такие уроки.

## Почему resume не помогает

Resume перезапускает Close с нуля: тот же урок-скелет, тот же вызов без `content`, та же noop-директива. Состояние не изменилось — исход детерминирован. Это восьмой рецидив семейства VL-303/304/309/310/318/319/323, и все предыдущие фиксы правили **текст директивы**, а не условие, по которому вызов попадает в noop.

## Цель

Сделать состояние «тело-скелет» распознаваемым механически и превратить вызов `lesson_update` без `content` в ошибку (не noop), чтобы модель видела причину и не крутилась на повторах.

## План

1. **`src/core/lesson.ts`** — новый экспортируемый предикат `isLessonBodyUnfilled(body: string): boolean`: `trim() === ''` **или** нормализованное тело равно `LESSON_BODY_SKELETON`. Одна точка правды для всех потребителей.
2. **`src/mcp/tools.ts` (`toolLessonUpdate`, ~:2686 и ~:2718)** — заменить обе проверки `current.body.trim() === ''` на `isLessonBodyUnfilled(current.body)`. Тогда вызов без `content` при теле-скелете даёт `ackErrorDetailed` (`ok:false`, **без** `noop:true`) → сигнатура не попадает в `noopSignatures` → повтор **исполняется** и снова отдаёт текст «передай `content`».
3. **`src/mcp/tools.ts` (`toolLessonCreate`, ~:2607)** — при отсутствии/пустом `content` в MCP-пути отвечать `ackErrorDetailed`; CLI `vibelog lesson create` (`src/cli/commands/lesson.ts`) оставить со скелетом (там интерактивный пользователь).
4. **`src/core/lesson-audit.ts`** — finding `empty_body` расширить на тело-скелет, в `details` флаг `skeleton: true`; `summary`/`byLesson`/`formatLessonAuditMarkdown` согласованы.
5. **Тесты**:
   - `src/mcp/write-ack.test.mjs` — тело-скелет + вызов без `content` → `ok:false` без `noop`, повтор исполняется, `missing`+`hint` заполнены;
   - `src/core/lesson-audit.test.mjs` — скелет → `empty_body` с `skeleton: true`;
   - `src/mcp/lesson-tools.test.mjs` — create без `content` через MCP → ошибка, через CLI → скелет;
   - `src/agent/loop.test.mjs` — регресс `agent-1794045441657`: 4 дословных повтора не упираются в `MAX_NOOP_REPEATS_PER_RUN`;
   - `src/web/phase-prompt.test.mjs` — инвариант: каждый `lesson_create` в `templates/phases/*.md` содержит `content` (уже есть, проверить, что не сломан).
6. **Документация**: doc-8 (поведение `lesson_update`/`lesson_create` на теле-скелете, `missing`/`hint`), doc-10 §6 (разбор инцидента), CHANGELOG.md.

## Риски

- `isLessonBodyUnfilled` считает «незаполненным» и урок, где автор осознанно оставил ровно скелет — но такой урок и есть пустышка, это желаемое поведение.
- `toolLessonCreate` с ошибкой вместо скелета меняет контракт MCP-инструмента: проверить, что шаблоны фаз (`phase-close.md`, `phase-close-worktree.md`, `phase-code.md`) уже передают `content` — они передают, регресса быть не должно.
- Отдельный вопрос (вне этой задачи): должен ли шаг lessons в Close ронять фазу, когда вся работа сделана. Сейчас `MAX_NOOP_REPEATS_PER_RUN` → `fail()` → откат статуса, хотя коммит и тесты на месте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В `src/core/lesson.ts` есть экспортируемый предикат `isLessonBodyUnfilled(body)` — true для пустого/пробельного тела И для тела, равного `LESSON_BODY_SKELETON` после нормализации; используется как единственная точка проверки
- [x] #2 `toolLessonUpdate` (`src/mcp/tools.ts`): вызов без `content` при теле-скелете отвечает `ackErrorDetailed` (`ok:false`, БЕЗ `noop:true`) с `missing: [{field:'content', ...}]` и `hint`; сигнатура не попадает в `noopSignatures`, повтор исполняется и снова отдаёт текст ошибки
- [x] #3 `toolLessonUpdate`: noop-ответ при теле-скелете заполняет `missing` с `field:'content'` (сейчас `missing` пуст, потому что проверка `trim() === ''` не видит скелет)
- [x] #4 `toolLessonCreate` (MCP-путь) при отсутствии/пустом `content` отвечает `ackErrorDetailed` — урок-скелет через MCP больше не создаётся; CLI `vibelog lesson create` без `-d` по-прежнему подставляет скелет
- [x] #5 `lesson_audit` finding `empty_body` срабатывает и на тело-скелет (в `details` флаг `skeleton: true`), накопленные уроки-заглушки видны в отчёте
- [x] #6 Регресс-тест `src/agent/loop.test.mjs` на сессию `agent-1794045441657`: 4 дословных повтора `lesson_update` без `content` при теле-скелете НЕ упираются в `MAX_NOOP_REPEATS_PER_RUN` (вызов не noop), модель получает текст ошибки с требованием `content`
- [x] #7 Тесты: `src/mcp/write-ack.test.mjs` (тело-скелет + вызов без `content` → `ok:false` без `noop`, повтор исполняется; `missing`+`hint`), `src/core/lesson-audit.test.mjs` (скелет → `empty_body`), `src/mcp/lesson-tools.test.mjs` (create без `content` через MCP → ошибка, через CLI → скелет)
- [x] #8 `pnpm build && pnpm test` проходят без регрессий
- [x] #9 Документация обновлена: doc-8 (поведение `lesson_update`/`lesson_create` на теле-скелете, `missing`/`hint`), doc-10 §6 (разбор инцидента `agent-1794045441657`), CHANGELOG.md
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

- `src/core/lesson.ts` — предикат `isLessonBodyUnfilled`.
- `src/mcp/tools.ts` — `toolLessonUpdate` (2 проверки), `toolLessonCreate`.
- `src/core/lesson-audit.ts` — finding `empty_body` на скелет.
- `src/cli/commands/lesson.ts` — проверить, что CLI-путь не затронут (скелет остаётся).
- Тесты: `src/mcp/write-ack.test.mjs`, `src/core/lesson-audit.test.mjs`, `src/mcp/lesson-tools.test.mjs`, `src/agent/loop.test.mjs`, `src/web/phase-prompt.test.mjs`.
- Документация: `backlog/docs/doc-8`, `backlog/docs/doc-10` §6, `CHANGELOG.md`.

## Шаг 1. `src/core/lesson.ts` — единый предикат «тело не заполнено»

Рядом с `LESSON_BODY_SKELETON` (:352) добавить:

```ts
/**
 * Тело урока не заполнено по смыслу (VL-349).
 *
 * Два состояния: пусто/пробелы И тело, равное скелету `LESSON_BODY_SKELETON`.
 * Второе появилось после VL-319: `createLessonFile` подставляет скелет, и
 * урок-заглушка перестал отличаться от заполненного по проверке `trim() === ''`.
 * Из-за этого `lesson_update` без `content` уходил в noop вместо ошибки
 * (сессия agent-1794045441657: 4 повтора → кап → fail).
 */
export function isLessonBodyUnfilled(body: string | undefined | null): boolean {
  const text = String(body ?? '').trim();
  if (text === '') return true;
  return text === LESSON_BODY_SKELETON.trim();
}
```

Нормализация: сравнивать `trim()` обеих сторон — скелет оканчивается `\n`, файл может быть перезаписан без него.

## Шаг 2. `src/mcp/tools.ts` — `toolLessonUpdate` (~:2686, ~:2718)

Заменить обе проверки `current.body.trim() === ''` на `isLessonBodyUnfilled(current.body)`:

- **ветка ошибки** (~:2686): `updates.content === undefined && isLessonBodyUnfilled(current.body)` → `ackErrorDetailed` с `missing: [{field:'content', reason:'тело урока не заполнено (пустое или скелет)'}]`. `ok:false` **без** `noop:true` — сигнатура не попадает в `noopSignatures`, повтор исполняется и снова отдаёт текст ошибки (механика VL-319, теперь срабатывает и на скелет).
- **ветка noop** (~:2718): `if (isLessonBodyUnfilled(current.body)) missing.push({field:'content', ...})` — noop обязан назвать недостающее поле.

Импорт `isLessonBodyUnfilled` из `../core/lesson.js` рядом с существующим импортом `LESSON_BODY_SKELETON`/`getLesson`.

## Шаг 3. `src/mcp/tools.ts` — `toolLessonCreate` (~:2607)

До вызова `createLessonFile`: если `content` не передан или пустой/пробельный → `ackErrorDetailed` («Урок без тела не создаётся: передай `content` с markdown Проблема/Решение/Пример»), `missing: [{field:'content', ...}]`, `hint`. Файл не создаётся.

CLI-путь (`src/cli/commands/lesson.ts`) не трогать: `vibelog lesson create` без `-d` по-прежнему даёт скелет — там интерактивный пользователь, а не модель.

## Шаг 4. `src/core/lesson-audit.ts` — finding `empty_body` на скелет

В цикле по урокам (~:326) заменить `String(entry.body || '').trim() === ''` на `isLessonBodyUnfilled(entry.body)`; в `details` добавить `skeleton: true`, когда тело непустое (то есть это именно скелет). `message` уточнить: «тело урока не заполнено — пустое или дефолтный скелет». `summary.empty_body`, `byLesson` и `formatLessonAuditMarkdown` согласуются автоматически (считаются из `findings`).

## Шаг 5. Тесты

- `src/mcp/write-ack.test.mjs`: урок с телом-скелетом + `lesson_update {id, title, tags}` без `content` → `ok:false`, **нет** `noop:true`, `missing` содержит `content`, `hint` непустой; повтор того же вызова исполняется заново (handler вызван дважды), файл не перезаписан.
- `src/core/lesson-audit.test.mjs`: урок с телом `LESSON_BODY_SKELETON` → finding `empty_body` с `details.skeleton === true`; пустое тело → `skeleton` отсутствует/false.
- `src/mcp/lesson-tools.test.mjs`: `lesson_create` без `content` через MCP → `ok:false`, файл не создан; через CLI (`createLessonFile` напрямую) → скелет (существующий кейс VL-319 сохраняется).
- `src/agent/loop.test.mjs`: регресс `agent-1794045441657` — заглушка `lesson_update` возвращает `ackError` (не noop) 4 раза подряд → ран НЕ падает по `MAX_NOOP_REPEATS_PER_RUN`, в tool-результатах виден текст про `content`, `res.result` не содержит «вернувший «изменений нет»».
- `src/web/phase-prompt.test.mjs`: инвариант VL-319 (каждый `lesson_create` в `templates/phases/*.md` содержит `content`) должен остаться зелёным — он и есть защита от рецидива на уровне шаблонов.

## Шаг 6. Проверка и документация

- `pnpm build && pnpm test` — полный прогон, без регрессий.
- `backlog/docs/doc-8`: контракт `lesson_update`/`lesson_create` — состояние «тело-скелет», `missing`/`hint`, разница MCP vs CLI.
- `backlog/docs/doc-10` §6: разбор инцидента `agent-1794045441657` — почему VL-319 не покрыл скелет.
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Ложное срабатывание**: урок, где автор осознанно оставил ровно скелет, будет считаться незаполненным. Это желаемое поведение — такой урок и есть пустышка.
- **Смена контракта `lesson_create`**: MCP-вызов без `content` теперь ошибка. Шаблоны фаз уже передают `content` (VL-319), регресса быть не должно — проверяется инвариантом в `phase-prompt.test.mjs`.
- **Накопленные уроки-скелеты**: после шага 4 `lesson_audit` покажет их пачкой. Это диагностика, а не поломка; чистить отдельной задачей, если объём большой.
- **Вне этой задачи**: шаг lessons в Close роняет фазу с откатом статуса, даже когда merge/build/тесты прошли. Кандидат в отдельную задачу «нефатальный шаг lessons при выполненной работе».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 13:21
---
Фаза code не удалась (код выхода 1): окировок=4, payload последнего запроса=423950 байт (макс 423950), usage={"input_tokens":5076803,"output_tokens":34273,"cache_read_input_tokens":4772352,"total_tokens":5111076,"reasoning_tokens":17091} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 13:24
---
Фаза 3 (Code) выполнена. Коммит d58e7f7 в ветке vb/vl-349.
**Что сделано:**
1. `src/core/lesson.ts` — добавлен экспортируемый предикат `isLessonBodyUnfilled(body)`: `trim() === ''` ИЛИ нормализованное (trim) тело равно `LESSON_BODY_SKELETON`. Единственная точка проверки для всех потребителей.
2. `src/mcp/tools.ts` (`toolLessonUpdate`) — обе проверки `current.body.trim() === ''` заменены на `isLessonBodyUnfilled(current.body)`: ветка ошибки (~:2716) отдаёт `ackErrorDetailed` (`ok:false`, БЕЗ `noop:true`, `missing:[{field:'content'}]` + `hint`) → сигнатура не попадает в `noopSignatures`, повтор исполняется; ветка noop (~:2760) заполняет `missing` полем `content` с различением «пустое» / «дефолтный скелет».
3. `src/mcp/tools.ts` (`toolLessonCreate`) — MCP-путь при отсутствии/пустом/пробельном `content` отвечает `ackErrorDetailed` с `missing:[{field:'content'}]` + `hint`, файл НЕ создаётся. CLI-путь (`src/cli/commands/lesson.ts` → `createLessonFile`) не тронут, скелет остаётся.
4. `src/core/lesson-audit.ts` — finding `empty_body` расширен на тело-скелет через `isLessonBodyUnfilled`; `details.skeleton: true` для скелета, у пустого тела флага нет; `message` уточнён («дефолтный скелет» / «пустое»). `summary`/`byLesson`/`formatLessonAuditMarkdown` согласованы автоматически.
5. Тесты: `src/core/lesson.test.mjs` (+3 кейса предиката: пусто/пробелы/null, скелет с нормализацией, заполненное тело), `src/mcp/write-ack.test.mjs` (+3 кейса нового describe VL-349: ошибка без noop + повтор исполняется + файл не перезаписан, дополнение скелета через content, noop с missing), `src/core/lesson-audit.test.mjs` (+1 кейс: скелет с `skeleton:true`, скелет без хвостового `\n`, пустое тело без флага; фикстура `writeLesson` по умолчанию получила заполненное тело — иначе скелет-находки раздували payload), `src/mcp/lesson-tools.test.mjs` (кейс VL-319 переписан: MCP без content → ошибка + файл не создан, ядро/CLI → скелет), `src/agent/loop.test.mjs` (регресс `agent-1794045441657`: 4 дословных повтора `lesson_update` без `content` → ран НЕ падает по `MAX_NOOP_REPEATS_PER_RUN`, все вызовы исполнены, в результатах текст отказа с требованием `content`, нет «Изменений нет»; учтена механика VL-323 — повторы получают директиву с причиной).
6. `src/mcp/write-ack-contract.test.mjs` — фикстуры `lesson_update`-noop переведены на уроки с заполненным телом (иначе noop-кейс стал бы ошибкой).
**Проверки:** `pnpm build` — успешно; полный `pnpm test:fast` (dist собран) — **185 файлов, 3471 passed, 4 skipped, 0 failed**, без `--exclude`/`--skip`.
**Что осталось (Phase Close):** документация — doc-8 (контракт `lesson_update`/`lesson_create` на теле-скелете, `missing`/`hint`, разница MCP vs CLI), doc-10 §6 (разбор инцидента `agent-1794045441657`: почему VL-319 не покрыл скелет), `CHANGELOG.md`. По инструкции фазы Code документация и CHANGELOG не правятся — AC9 остаётся открытым. `src/web/phase-prompt.test.mjs` (инвариант «каждый `lesson_create` в шаблонах фаз содержит `content`») не менялся и зелёный в полном прогоне.
Урок: lesson-233 (проверку «поле пустое» писать через предикат состояния, а не через `trim() === ''`).
---
author: @agent
created: 2026-11-07 13:28
---
Фаза Close выполнена. Ветка vb/vl-349 слита в master (1 коммит d58e7f7, merge --no-ff без конфликтов), worktree удалена (force — только untracked backlog/references/data), ветка vb/vl-349 удалена.
**Проверки после merge:** `pnpm build` — успешно; ранний точечный фильтр по diff'у (src/core/lesson.test.mjs, src/core/lesson-audit.test.mjs, src/mcp/lesson-tools.test.mjs, src/mcp/write-ack.test.mjs, src/mcp/write-ack-contract.test.mjs, src/agent/loop.test.mjs) — 6 файлов, 219 passed; полный `npx vitest run` — **185 файлов, 3471 passed, 4 skipped, 0 failed**, без --exclude/--skip. Повторных полных прогонов не было.
**Документация (AC9, DoD2):** doc-8 — контракт `lesson_create` (MCP без `content` → ошибка, CLI → скелет), `lesson_update` (три отказа вместо noop на теле-скелете, `missing`/`hint`, разбор почему скелет — отдельное состояние), `lesson_audit` finding `empty_body` с `details.skeleton`; doc-10 §6 — разбор инцидента `agent-1794045441657` (почему VL-319 не покрыл скелет, лечение через условие попадания в noop, а не текст директивы); CHANGELOG.md → Unreleased/Исправлено. Коммит документации: 0b7e983.
**Lessons:** lesson-233 (проверку «поле пустое» писать через предикат состояния, а не через `trim() === ''`) — создан в фазе Code, связан с VL-349; коммит refs/lessons: d961393.
**DoD:** 1. Тесты проходят — да (полный прогон зелёный); 2. Документация обновлена — да (doc-8, doc-10 §6, CHANGELOG); 3. Нет регрессий — да. AC9 отмечен.
---
author: @agent
created: 2026-11-08 01:47
---
## Пометка при аудите: критерий приёмки отменён последующей задачей

**Что отменено.** Критерий приёмки №4 этой задачи требует: «`toolLessonCreate` (MCP-путь) при отсутствии/пустом `content` отвечает `ackErrorDetailed` — урок-скелет через MCP больше не создаётся». Критерий отмечен выполненным, задача в статусе Done.

**Чем отменено.** Задача **VL-356** (Done) осознанно вернула противоположное поведение: `lesson_create` без `content` создаёт урок со скелетом и отвечает `ok:true` + `missing: [{field:'content'}]` + `hint`. Причина отмены зафиксирована в описании VL-356: жёсткий отказ давал **замкнутый** тупик — урок не создан, привязать нечего, модель повторяла вызов дословно 6 раз и упиралась в `MAX_ERROR_REPEATS_PER_RUN` (сессия `agent-1794054631174`, Close VL-355).

**Действующее поведение на текущий момент.** `lesson_create` без `content` → урок создаётся со скелетом, ответ `ok:true` с `missing`/`hint`/`retryWith`. Дополнительно VL-362 добавила в `retryWith` готовый каркас тела.

**Планируемое изменение.** По решению от 2026-11-08 (обсуждение рефакторинга) действующее поведение признано **неверным**: создание урока без тела — это ошибка, но отказ должен нести готовый вызов с каркасом тела, а не быть пустым. Тупик был не из-за отказа, а из-за отказа **без выхода**. Реализация — в **VL-369** (общий пайплайн write-инструментов, инвариант «неполнота не даёт отказа, но отказ всегда несёт следующий шаг»).

**Что это значит для этой задачи.** Задача остаётся Done (история не переписывается), но критерий №4 **не следует считать действующим требованием**. Ссылка на него как на обоснование текущего поведения некорректна.
---
<!-- COMMENTS:END -->