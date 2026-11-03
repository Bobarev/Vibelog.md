---
id: VL-319
title: 'noop-ответ lesson_update не называет недостающее поле: Close создаёт урок с пустым телом и ран падает по капу noop-повторов (рецидив VL-303/304/309/310/318)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 17:02'
updated_date: '2026-11-03 22:31'
due_date: ''
labels:
  - core
  - mcp
dependencies: []
milestone: v1.12
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/core/lesson.ts
  - src/core/lesson-audit.ts
  - src/core/lesson-audit.test.mjs
  - src/mcp/tool-result.ts
  - src/mcp/tools.ts
  - src/mcp/write-ack.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/lesson-tools.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - templates/phases/phase-code.md
lessons:
  - lesson-192
token_usage:
  input: 16853793
  output: 95553
  cache: 16595968
  total: 16949346
  requests: 223
  duration_ms: 1640792
  reasoning: 45550
  by_phase:
    code:
      input: 15102816
      output: 86322
      cache: 14892544
      requests: 188
    close:
      input: 1750977
      output: 9231
      cache: 1703424
      requests: 35
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сессия `agent-1793712738536` (Close VL-318) упала кодом 1 с текстом «Модель 4 раз повторила вызов lesson_update, вернувший «изменений нет»». Транскрипт показывает точную последовательность:

```
lesson_update {id:lesson-191, title, tags, sourceTasks, verifiedBy:"agent"}   ← БЕЗ content
  → noop: "title, tags, source_tasks, verified_by уже имеют эти значения"
lesson_view → body: ""
lesson_update — ДОСЛОВНО те же аргументы ×4
  → fail() на 4-м повторе → is_error:true → откат статуса → авто-resume с нуля
```

Это **рецидив** семейства VL-303/304/309/310/318: кап `MAX_NOOP_REPEATS_PER_RUN` работает как задумано, но лечит симптом. Каждый `fail()` откатывает статус, авто-resume перезапускает фазу, урок снова с пустым телом — цикл повторяется из задачи в задачу («непобедимая ошибка»).

## Три причины (все установлены по коду)

1. **`src/agent/loop.ts:423-427` (`noopRepeatDirective`) сообщает неверный факт**: «вызов `lesson_update` с теми же аргументами **уже был выполнен** и ничего не изменил». Он НИКОГДА не исполнялся — с первого раза ответ был noop. Модель читает «не выполнен» → повторяет.
2. **`src/mcp/tools.ts:2673-2680`**: в noop-ответе `applied` заполнен переданными полями (`title/tags/source_tasks/verified_by`), которые читаются как «применено», а отсутствующее в вызове поле (`content`) не названо НИГДЕ. Модели неоткуда узнать, чего не хватает.
3. **Корень: шаблоны Close создают уроки с пустым телом.** `templates/phases/phase-close.md:55` и `templates/phases/phase-close-worktree.md:53` вызывают `lesson_create {"title","tags","sourceTasks"}` без `content`, а `createLessonFile` (`src/core/lesson.ts:363`) пишет `input.content || ''`. Так рождается lesson-191 с `body:""`.

## Цель

Убрать условия рецидива на двух уровнях: (а) noop-ответ обязан называть, ЧЕГО в вызове не хватает, если у сущности есть незаполненное обязательное по смыслу поле; (б) урок без тела не должен создаваться шаблоном Close.

## Вне рамок

Пересмотр капа `MAX_NOOP_REPEATS_PER_RUN` и механики авто-resume — отдельная задача, если потребуется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `lesson_update` для урока с ПУСТЫМ телом, в аргументах которого нет `content`, отвечает `ok:false` + `error` (не `noop`), и текст прямо называет: тело пустое, передай непустой `content` (Проблема/Решение/Пример)
- [x] #2 `lesson_update` с явно переданным пустым `content` (`""` или только пробелы) → `ok:false` + `error` с подсказкой; тело урока не может быть пустым, файл не перезаписывается
- [x] #3 noop-ответ `lesson_update` содержит поле `missing` (список полей, которые по смыслу обязательны и не заполнены — в частности пустое `body`) и `hint` со следующим шагом; `applied` содержит только переданные поля
- [x] #4 `noopRepeatDirective` (src/agent/loop.ts) не утверждает «вызов уже был выполнен»: текст говорит, что вызов НЕ исполнен, называет имя инструмента и рекомендует прочитать актуальное состояние или сменить аргумент
- [x] #5 `lesson_create` без непустого `content` отвечает `ok:false` + `error` (или `createLessonFile` подставляет шаблон «Проблема/Решение/Пример» — выбранный вариант зафиксирован тестом), урок с пустым телом больше не создаётся
- [x] #6 Шаблоны `templates/phases/phase-close.md` и `templates/phases/phase-close-worktree.md` передают `content` в `lesson_create`; инвариантный тест в `src/web/phase-prompt.test.mjs` падает, если у `lesson_create` в Close-шаблонах нет `content`
- [x] #7 Регресс-тест в `src/agent/loop.test.mjs` на сессию `agent-1793712738536`: noop → повтор noop-вызова → текст директивы содержит имя инструмента и не содержит формулировку «уже был выполнен»; кап noop-повторов по-прежнему срабатывает на 4-й серии
- [x] #8 `lesson_audit` сообщает новый finding `empty_body` для уроков с пустым телом (backlog/lessons, включая lesson-191) — накопленный склад пустых уроков виден механически
- [ ] #9 Тесты и проверки: `pnpm test` зелёный; документация обновлена — doc-8 (контракт ack `lesson_update`/`lesson_create`, поле `missing`), doc-10 §6 (директива noop-повтора), CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Порядок шагов

### 1. Контракт ack: поле `missing` (src/mcp/tool-result.ts)
- Расширить `NoopAck`: добавить опциональное `missing?: SkippedField[]` и `hint?: string`.
- Новый хелпер `ackNoopDetailed(message, applied, missing, hint)` — `ackNoop` оставить как обёртку (совместимость с 9 инструментами из `NOOP_SCENARIOS` в `write-ack-contract.test.mjs`).
- `isNoopAck` не меняется (признак `noop: true`).

### 2. `toolLessonUpdate` (src/mcp/tools.ts:2644-2680)
- До noop-сверки: если `content === undefined` И `current.body.trim() === ''` → `ackError`: «Тело урока `<id>` пустое — в вызове нет `content`. Передай непустой markdown (Проблема / Решение / Пример)». Сигнатура такого ответа НЕ попадёт в `noopSignatures` (в `loop.ts:1320-1373` `ok:false` без `noop:true` → `failed`, не `noop`) — модель увидит текст ошибки, а повтор исполнится заново.
- Если `content !== undefined` и `content.trim() === ''` → `ackError`: «Пустое тело урока недопустимо: `content` пустой. Передай Проблему/Решение/Пример».
- В обычном noop-ответе заполнять `missing`: `[{field:'content', reason:'тело урока пустое — не заполнено'}]`. `applied` оставить строго по переданным полям.

### 3. Директива повтора (src/agent/loop.ts:423-427)
- Переписать `noopRepeatDirective`: «Вызов `<name>` НЕ исполнен: первый ответ — «изменений нет» (…поля уже имели эти значения). Повтор с теми же аргументами результат не изменит. Следующий шаг: `lesson_view`/`backlog_view_task` — прочитай актуальное состояние, поменяй аргументы (например, добавь отсутствующее поле) или переходи к следующему шагу фазы». Убрать формулировку «уже был выполнен».
- Держать текст < 400 байт (инвариант теста VL-310 на размер директив).

### 4. `toolLessonCreate` (src/mcp/tools.ts:2607) + `createLessonFile` (src/core/lesson.ts:347)
- Выбрать один вариант и зафиксировать тестом. Рекомендую: `createLessonFile` подставляет скелет `## Проблема\n\n## Решение\n\n## Пример` при пустом `content` — тогда CLI `vibelog lesson create` без `--description` тоже даёт осмысленный урок, а не пустышку. `toolLessonCreate` дополнительно отдаёт `ackOk` с `applied.content` длиной скелета.

### 5. Шаблоны Close
- `templates/phases/phase-close.md:55` и `templates/phases/phase-close-worktree.md:53`: `lesson_create` получает `"content": "## Проблема\n\n…\n\n## Решение\n\n…\n\n## Пример\n\n…"` как обязательный аргумент шага (модель заполняет по факту задачи).
- `phase-code.md:41`: та же правка (там тоже `lesson_create` без `content`).

### 6. `lesson_audit` (src/core/lesson-audit.ts)
- Новый finding `empty_body` (`tier: 'orphan'` или отдельный тип): тело урока пустое/только пробелы. Попадает в `formatLessonAuditMarkdown` и в MCP-ответ. Порог/настройки не нужны — детерминированно.

### 7. Тесты
- `src/mcp/write-ack.test.mjs`: `lesson_update` на уроке с пустым телом без `content` → `ok:false`, `error`, НЕ `noop`; с `content:''` → `ok:false`, тело файла не изменилось; noop-ответ содержит `missing[0].field === 'content'`.
- `src/mcp/write-ack-contract.test.mjs`: `NOOP_SCENARIOS` для `lesson_update` расширяется кейсом с `missing`; инвариант «noop-ответ обязан заполнять `missing`, если у сущности есть незаполненное по смыслу поле» — только для уроков, чтобы не ломать остальные 8 инструментов.
- `src/agent/loop.test.mjs`: регресс на `agent-1793712738536` — 5 ходов, noop → 4 дословных повтора; проверить, что директива содержит `lesson_update` и НЕ содержит «уже был выполнен»; кап срабатывает на 4-й серии, `is_error:true`.
- `src/web/phase-prompt.test.mjs`: инвариант — каждый `lesson_create` в `templates/phases/*.md` содержит `content`.
- `src/core/lesson-audit.test.mjs`: урок с пустым телом → finding `empty_body`.
- `src/mcp/lesson-tools.test.mjs`: `lesson_create` без `content` создаёт файл со скелетом (тело непустое).

### 8. Документация
- `backlog/docs/doc-8-*` — контракт ack: `missing`, поведение `lesson_update`/`lesson_create` на пустом теле.
- `backlog/docs/doc-10-*` §6 — директива noop-повтора (не утверждает «выполнен»), разбор инцидента.
- `CHANGELOG.md` — запись VL-319 в `## [Unreleased]`.

### 9. Проверки
`pnpm test` (полный), `pnpm build`, `npx tsc --noEmit`. Commit через `git_commit` явными путями.

## Риски
- `missing` в `NoopAck` — аддитивное поле; старые потребители (`isNoopAck`, веб-чат) читают только `noop`/`message` — совместимо.
- `ackError` вместо `noop` для пустого тела: модель может повторять вызов, но теперь повтор ИСПОЛНЯЕТСЯ (не блокируется) и каждый раз возвращает текст ошибки — цикл «noop → кап → fail → авто-resume» рвётся, а обычный loop detection добивает дословные повторы штатно.
- Скелет в `createLessonFile` меняет поведение CLI — затрагивает `src/cli/commands/lesson.ts:113`; тест `lesson-cli.test.mjs` проверить на ожидания пустого тела.
- `modified_files`: только `src/`, `templates/`, `backlog/docs/`, `CHANGELOG.md`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 17:22
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/mcp/tool-result.ts
- src/mcp/tools.ts
- src/core/lesson.ts
- src/agent/loop.ts
- templates/phases/phase-close.md
- templates/phases/phase-close-worktree.md
- templates/phases/phase-code.md
- src/core/lesson-audit.ts
- src/mcp/write-ack.test.mjs
- I'll start by orienting in the project and reading the key files from the plan.
Now I'll implement. Starting with the ack contract:
Now `toolLessonUpdate`:
Now templates:
Now `lesson_audit` — add `empty_body` finding:
Good. Now build and run targeted tests:
Превышен лимит --max-requests (80) — фаза…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 846 с, payload 402791 байт_
Незакоммиченные изменения сохранены в ветку: коммит `2fcb0a5`.
---
author: @agent
created: 2026-11-03 17:22
---
Фаза code не удалась (код выхода 1): окировок=1, payload последнего запроса=402791 байт (макс 402791), usage={"input_tokens":6046971,"output_tokens":38294,"cache_read_input_tokens":5954560,"total_tokens":6085265,"reasoning_tokens":21450} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 17:29
---
Фаза 3 (Code) выполнена. Коммит 8bd2f32.
**Что сделано (по плану):**
1. `src/mcp/tool-result.ts` — контракт ack расширен: `NoopAck.missing?: SkippedField[]` + `hint?: string`; новые хелперы `ackNoopDetailed(message, applied, missing, hint)` и `ackErrorDetailed(message, {missing, hint, applied})`; `ackNoop`/`ackError` остались обёртками (совместимость с 9 инструментами `NOOP_SCENARIOS`).
2. `src/mcp/tools.ts` (`toolLessonUpdate`) — до noop-сверки: `content === undefined` И пустое тело → `ackErrorDetailed` (ok:false, БЕЗ `noop:true` → сигнатура не попадает в `noopSignatures`, повтор исполняется заново и снова отдаёт текст ошибки); `content` пустой/пробельный → `ackErrorDetailed`, файл не перезаписывается. В обычном noop-ответе заполняются `missing: [{field:'content', reason:'тело урока пустое — не заполнено'}]` и `hint`; `applied` — строго переданные поля.
3. `src/agent/loop.ts` (`noopRepeatDirective`) — текст переписан: «вызов `<name>` НЕ исполнен (поля уже такие). Повтор ничего не изменит. Следующий шаг: прочитай состояние (lesson_view) или смени аргумент — добавь отсутствующее поле». Формулировка «уже был выполнен» удалена; длина директивы 190 байт (< 400, инвариант VL-310).
4. `src/core/lesson.ts` — выбран вариант «скелет»: `LESSON_BODY_SKELETON = '## Проблема\n\n## Решение\n\n## Пример\n'`, `createLessonFile` подставляет его при пустом/пробельном `content` (CLI `vibelog lesson create` без `-d` тоже даёт осмысленный урок). `toolLessonCreate` теперь отдаёт `ackOk` с `applied.content` = длина фактического тела.
5. Шаблоны: `phase-close.md`, `phase-close-worktree.md`, `phase-code.md` — `lesson_create` получает обязательный `"content"` со структурой Проблема/Решение/Пример.
6. `src/core/lesson-audit.ts` — новый finding `empty_body` (детерминированно, без порогов): тело пустое/только пробелы; попадает в `summary`, `byLesson` и `formatLessonAuditMarkdown`. Дополнительно: `byLesson` в MCP-ответе компактится (без `message`), иначе новые находки раздували payload и группировка выпадала из ответа целиком; пары дублей для уроков с пустым телом не считаются (ложные пары по tags).
**Тесты (новые):** `write-ack.test.mjs` (AC1/AC2/AC3 — ошибка вместо noop, пустой content, missing+hint), `write-ack-contract.test.mjs` (инвариант `missing` для lesson_update), `loop.test.mjs` (регресс agent-1793712738536: директива содержит имя инструмента, «НЕ исполнен», не содержит «уже был выполнен», < 400 байт; кап noop-повторов по-прежнему срабатывает), `phase-prompt.test.mjs` (инвариант: каждый `lesson_create` в `templates/phases/*.md` содержит `content`), `lesson-audit.test.mjs` (empty_body для пустого тела и тела из пробелов), `lesson-tools.test.mjs` (create без content → скелет).
**Проверки:** `pnpm build` — ок; `npx tsc --noEmit` — ок; **полный `pnpm test`** — 160 файлов, 3032 passed, 4 skipped (предсуществующие skip в `frontmatter.test.mjs`, не связаны с задачей), 0 failed. Исключений/`--skip` не было.
**Что осталось (для фазы Close):** AC9 в части документации — `backlog/docs/doc-8-*` (контракт ack: `missing`, поведение `lesson_update`/`lesson_create` на пустом теле), `doc-10-*` §6 (директива noop-повтора, разбор инцидента), `CHANGELOG.md` — по правилам фазы Code документация пишется в Close. Поэтому AC9 и DoD «Документация обновлена» не отмечены.
---
author: @agent
created: 2026-11-03 17:39
---
Фаза Close выполнена. Ветка vb/vl-319 слита в master (2 коммита: 8bd2f32 + wip 2fcb0a5), merge-коммит без конфликтов; worktree удалена (force — только untracked-симлинк `backlog/references/data`), ветка vb/vl-319 удалена, `git worktree prune` выполнен.
**Проверки после merge:** `pnpm build` — ок; ранний точечный фильтр по diff'у (loop, lesson-audit, write-ack, write-ack-contract, lesson-tools, phase-prompt) — 6 файлов / 275 тестов зелёные; **полный `npx vitest run`** — 161 файл, 3040 passed, 4 skipped (предсуществующие skip в `frontmatter.test.mjs`), 0 failed. Исключений и `--skip` не было, повторных полных прогонов не потребовалось.
**Документация (AC9, DoD2):** коммит 7b9e313 — `backlog/docs/doc-8` (контракт ack: аддитивные `missing`/`hint`, поведение `lesson_update` на пустом теле — `ok:false` вместо noop, скелет в `lesson_create`, finding `empty_body` в `lesson_audit`), `backlog/docs/doc-10` §6 (директива noop-повтора больше не утверждает «выполнено», разбор инцидента `agent-1793712738536`), `CHANGELOG.md` (запись VL-319 в `## [Unreleased]` → «Исправлено»).
**Lessons:** создан lesson-192 «Называй в noop-ответе недостающее поле и не утверждай в директиве «выполнено» — иначе модель повторяет вызов до капа» (sourceTasks/linkedTasks VL-319), закоммичен в 301d5bb вместе с файлом задачи-связи. Похожих активных уроков с этим содержанием не было (lesson-173 superseded, lesson-174/175/176/191 — про другие аспекты классификации ответов).
**DoD:** 1 «Тесты проходят» — полный прогон зелёный; 2 «Документация обновлена» — doc-8, doc-10 §6, CHANGELOG; 3 «Нет регрессий» — полный прогон без падений, 4 предсуществующих skip не связаны с задачей. Все три пункта отмечены.
**Замечание вне рамок задачи:** в главном репо остаётся untracked `backlog/lessons/lesson-191-…` (урок VL-318, не закоммичен той задачей) — к VL-319 не относится, не трогал.
---
<!-- COMMENTS:END -->