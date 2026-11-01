---
id: VL-279
title: 'Аудит lessons: механические проверки актуальности (битые пути, дубли, висячие ссылки, протухание)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 19:55'
updated_date: '2026-11-01 20:27'
due_date: ''
labels:
  - lessons
  - cli
  - mcp
  - tech-debt
  - audit
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/lesson-audit.ts
  - src/core/lesson-audit.test.mjs
  - src/core/lesson.ts
  - src/core/lesson.test.mjs
  - src/cli/commands/lesson.ts
  - src/cli/commands/doctor.ts
  - src/cli/router.ts
  - src/cli/diagnostics.test.mjs
  - src/mcp/tools.ts
  - src/web/tool-policy.ts
  - src/core/compat-full.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/server.test.mjs
lessons:
  - lesson-146
  - lesson-147
token_usage:
  input: 17870931
  output: 144500
  cache: 17497600
  total: 18015431
  requests: 236
  duration_ms: 1477446
  reasoning: 69040
  by_phase:
    code:
      input: 16107538
      output: 133032
      cache: 15784960
      requests: 199
    close:
      input: 1763393
      output: 11468
      cache: 1712640
      requests: 37
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В `backlog/lessons/` 141 файл. Механизма проверки актуальности нет: статусы `active | outdated | superseded` (`src/core/lesson.ts:38`) меняются только вручную через `lesson supersede`, за всю историю это делалось единицы раз. При этом `src/web/phase-prompt.ts:225-233` подставляет уроки по tags задачи прямо в промпт фазы Plan/Code — устаревший урок не просто мусор, а неверная инструкция модели.

Проблема, которую решает задача: не «почистить один раз», а получить дешёвый детерминированный аудит (без LLM), который можно гонять в CI и который даёт основу для следующих шагов (LLM-классификация workaround → задачи, санитарный проход по текущим 141).

## Объём (эта задача — только уровень 1)

Механические проверки, не требующие модели:

1. **Битые пути** — пути, упомянутые в теле урока, не существуют в репо (`src/…`, `templates/…`, `backlog/…`, пути в обратных апострофах).
2. **Висячие ссылки** — `source_tasks`/`linked_tasks` на несуществующие задачи; `supersedes` на несуществующий ID, на себя, циклы.
3. **Дубли** — нормализованный заголовок + пересечение tags/тела; на текущем корпусе должны ловиться три урока про «не вставляй VL-N в templates» (lesson-107, lesson-140, lesson-29).
4. **Сироты и протухание** — нет `linked_tasks` и source-задачи закрыты, ИЛИ `updated_date`/`last_verified` старше порога.

## Модель данных (additive)

Новые поля фронтматтера: `last_verified` (YYYY-MM-DD), `verified_by` (`auto|agent|human`), `applies_to` (string[] — glob путей/имена символов, то, что валидируется механически), `kind` (`rule|workaround|fact`). Новый статус `needs-review`.

`loadLessonsForTask` фильтрует: `active` только, `last_verified` не старше N дней (дефолт 180, настройка), кап top-N (дефолт 5).

## Поверхности

- CLI: `vibelog lesson audit [--write] [--threshold N] [--json]` (по образцу `src/cli/commands/lesson.ts`).
- MCP: `lesson_audit` — read-only по умолчанию (`apply=false`); единичные записи (`last_verified`, перевод в `needs-review`) только по явному запросу на конкретные ID.

## Связь с будущими задачами

Уровень 2 (LLM-классификация, `kind=workaround` → черновики задач техдолга) и уровень 3 (санитарный проход по 141 уроку: свести дубли, отметить outdated, из workaround-уроков народить задачи) создаются отдельными задачами и зависят от этой.

## Открытые вопросы

- Порог схожести для дублей — подобрать на текущем корпусе (начать с Jaccard ≥ 0.5 по нормализованным токенам body+tags, уточнить по результату).
- Где хранить настройки порога/капа: секция `lessons` в `.vibelog/settings.json` (по умолчанию — захардкоженные значения).
- Нужен ли авто-перевод в `needs-review` при missing_path или только finding (по умолчанию — только finding: путь мог исчезнуть из-за рефакторинга, урок при этом остаётся верным по смыслу).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Есть `vibelog lesson audit` (CLI) и MCP-инструмент `lesson_audit` (read-only по умолчанию), возвращающие структурированный отчёт: по каждому lesson — findings[] с типом и деталями, плюс сводка по типам
- [x] #2 Проверка битых путей: пути/файлы, упомянутые в теле урока (обратный апостроф или `src/…`, `templates/…`, `backlog/…`), проверяются на существование; отсутствующие помечаются finding типа missing_path
- [x] #3 Проверка ссылок: source_tasks/linked_tasks на несуществующие задачи и supersedes на несуществующий/самого себя/циклы → findings dangling_task, broken_supersede, supersede_cycle
- [x] #4 Проверка дублей: кандидаты на объединение по нормализованному заголовку и пересечению tags/тела (порог настраиваемый) → finding duplicate_of с указанием пары и степени похожести; на текущих 141 уроке детектируются как минимум пары про «не вставляй ID задач в templates» (lesson-107/lesson-140/lesson-29)
- [x] #5 Проверка сирот и протухания: linked_tasks пуст И source-задачи все Done/нет, ИЛИ updated_date/last_verified старше порога (настройка, дефолт 180 дней) → finding stale; уроки с status=superseded/outdated в stale не попадают
- [x] #6 Новые поля фронтматтера lesson: last_verified (дата), verified_by (auto|agent|human), applies_to (string[]: glob путей и/или имена символов), kind (rule|workaround|fact|null); поля additive — старые файлы без них читаются и не падают
- [x] #7 Новый статус needs-review добавлен в LESSON_STATUSES и поддержан в normalizeLessonStatus, CLI list --status, MCP-фильтрах; supersede-логика не ломается
- [x] #8 loadLessonsForTask (src/core/lesson.ts:396) НЕ подставляет в промпт уроки со status needs-review/outdated/superseded и уроки со staler-than-N-дней last_verified (порог из настроек), с явным капом top-N (дефолт 5) — устаревшие инструкции не попадают в Plan/Code
- [x] #9 MCP-инструмент lesson_audit поддерживает apply=false (только отчёт) и явные действия только по запросу: пометка finding применённым (verified_by=auto, last_verified=today) либо перевод в needs-review — массовые изменения без флага не выполняются
- [x] #10 Отчёт аудита пишется в backlog/lessons/AUDIT.md (markdown: сводка по типам, таблица находок с ID/типом/деталями) при явном флаге --write, без флага — только вывод в stdout
- [x] #11 Тесты: фикстура с битым путём, висячим supersedes, дублем и протухшим уроком → все четыре finding'а; loadLessonsForTask отфильтровывает needs-review/stale и соблюдает кап; round-trip новых полей фронтматтера; CLI list --status needs-review
- [x] #12 Документация: README/док backlog (раздел про lessons) — описание audit, новых полей и статуса; CHANGELOG.md запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 20:07
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/lesson.ts
- src/core/lesson-audit.ts
- src/cli/commands/lesson.ts
- src/cli/router.ts
- src/mcp/tools.ts
- src/cli/commands/doctor.ts
- src/web/tool-policy.ts
- src/core/lesson-audit.test.mjs
- I'll start by orienting in the project structure and reading the relevant files.
Now I'll implement. Starting with core/lesson.ts changes:
Now implementing. First, core model changes in `src/core/lesson.ts`:
Now the model changes:
Now the input interface, serialization, and deserialization:
Now impo…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 643 с, payload 419570 байт_
Незакоммиченные изменения сохранены в ветку: коммит `ed669a3`.
---
author: @agent
created: 2026-11-01 20:07
---
Фаза code не удалась (код выхода 1): tools.ts×5, payload последнего запроса=419570 байт (макс 419570), usage={"input_tokens":5789519,"output_tokens":61048,"cache_read_input_tokens":5684736,"total_tokens":5850567,"reasoning_tokens":30466} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-01 20:17
---
Фаза 3 (Code) выполнена. Коммиты: `1a959f5` (feat: аудит lessons) + `a1e677d` (test: CLI-фильтр needs-review).
Что сделано:
- `src/core/lesson-audit.ts` (новый): `auditLessons()` — read-only механический аудит (missing_path по телу урока и `applies_to`, dangling_task, broken_supersede, supersede_cycle, duplicate_of с настраиваемым порогом, stale с исключением superseded/outdated), `applyLessonAudit()` (записи только по явному списку id), `formatLessonAuditMarkdown()` (AUDIT.md), `extractLessonPaths()`.
- `src/core/lesson.ts`: статус `needs-review` в `LESSON_STATUSES`; additive-поля `last_verified`/`verified_by`/`applies_to`/`kind` (round-trip, старые файлы читаются с дефолтами); `LESSON_DEFAULTS` + `readLessonSettings()` (секция `lessons` в `.vibelog/settings.json`: `duplicate_threshold`, `stale_days`, `prompt_limit`); `loadLessonsForTask` отбрасывает needs-review/outdated/superseded и протухшие (last_verified/updated_date старше stale_days), сортирует по свежести и капит top-N.
- CLI: `vibelog lesson audit [--write] [--threshold N] [--stale-days N] [--json] [--verify id,…] [--needs-review id,…]` (+ справка в router.ts).
- MCP: `lesson_audit` (read-only по умолчанию; `verified`/`needsReview` — только явные id; `write` — AUDIT.md; валидация аргументов на границе слоя); `lesson_update` расширен полями `lastVerified`/`verifiedBy`/`appliesTo`/`kind`; enum статуса и фильтр включают needs-review. `src/web/tool-policy.ts`: `audit` — read-маркер.
- Реестр инструментов 42 → 43 (doctor.ts + тесты compat-full/reference-tools/documents/server/diagnostics).
Проверки: полный `pnpm test` — 124 файла, 2348 passed, 4 skipped (предсуществующие условные skip фикстур Backlog.md в frontmatter.test.mjs/compat-full.test.mjs/compat.test.mjs — пропускаются при отсутствии оригинала), падений нет. CLI-прогон на реальном корпусе: 145 уроков, 14 находок при пороге 0.35 (8 duplicate_of, 5 missing_path, 1 broken_supersede... итого по сводке), пары lesson-107/lesson-140/lesson-29 детектируются (0.52/0.39/0.36); при `--threshold 0.5` остаются только истинные дубли.
Что осталось: AC12 (README/док + CHANGELOG) — по правилам фазы Code документацию пишет Close; DoD «Документация обновлена» не отмечен. Порог дублей подобран на корпусе: 0.35 (веса 0.4 title / 0.4 tags / 0.2 body), дефолт протухания 180 дней, кап подстановки 5.
---
author: @agent
created: 2026-11-01 20:27
---
Фаза Close выполнена. Статус: Done.
Коммиты:
- feat/test `1a959f5` + `a1e677d` (аудит lessons + CLI-фильтр needs-review) — сделаны в фазе Code; незакоммиченного кода не осталось (`git status --porcelain -- src/ templates/ package.json tsconfig.json vitest.config.mts` пуст).
- docs `029e71b` — «документация и CHANGELOG»: CHANGELOG.md (запись VL-279 в Unreleased/Добавлено), doc-7 (§lesson: подкоманда `audit` с флагами и табличной строкой), doc-8 (§Lessons learned: новые поля фронтматтера, статус `needs-review`, настройки секции `lessons`, поведение `loadLessonsForTask`, новый раздел `lesson_audit` с типами находок, расширенный `lesson_update`).
- docs(task) `21a539e` — refs и lessons: lesson-146 (новый), lesson-147 (новый), lesson-10 обновлён (linked_tasks += VL-279).
Проверки: `pnpm build` — успешно (tsc, dist собран); полный `pnpm test:fast` после сборки — 125 файлов, 2356 passed, 4 skipped (предсуществующие условные skip фикстур Backlog.md в frontmatter/compat), падений нет — регрессий не выявлено. Полный прогон выполнен один раз; повторных прогонов не потребовалось.
AC12 закрыт этой фазой (документация по правилам фазы Code пишется в Close). DoD отмечены: тесты проходят, документация обновлена, регрессий нет.
Не закоммичено: нет (файлы задач VL-280/281/282/283 в `backlog/tasks/` — чужие, не этой задачи, оставлены как есть).
---
<!-- COMMENTS:END -->