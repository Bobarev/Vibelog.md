---
id: VL-400
title: 'lessons: recall по смыслу задачи вместо labels + консолидация правил в AGENTS.md'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 09:33'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies: []
milestone: v1.14
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/lesson.ts
  - src/core/lesson-consolidate.ts
  - src/core/lesson-consolidate.test.mjs
  - src/core/lesson.test.mjs
  - src/core/tool-kinds.ts
  - src/core/compat-full.test.mjs
  - src/cli/commands/lesson.ts
  - src/cli/commands/instructions.ts
  - src/cli/router.ts
  - src/cli/diagnostics.test.mjs
  - src/mcp/tools.ts
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-277
token_usage:
  input: 22722274
  output: 134834
  cache: 22245888
  total: 22857108
  requests: 213
  duration_ms: 2119841
  reasoning: 75046
  by_phase:
    code:
      input: 19944952
      output: 123811
      cache: 19531776
      requests: 164
    close:
      input: 2777322
      output: 11023
      cache: 2714112
      requests: 49
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (обсуждение roadmap 2026-11-09, пункт «Agent memory»).

Проблема 1 — recall по labels почти не работает. `loadLessonsForTask` (src/core/lesson.ts:566) матчит уроки только по `task.labels`; если у задачи нет labels — возвращает `[]`, и в промпт Plan/Code уходит `(нет)`. Labels расставляет только Spec (VL-154), старые задачи их не имеют. Итог: 274 урока в backlog/lessons/ накоплены, а подстановка в промпт срабатывает лишь на части задач. Второй дефект — top-N берётся по свежести (`sort` по last_verified/updated_date), а не по релевантности: при капе promptLimit=5 в промпт попадают «свежие», а не «про эту задачу».

Проблема 2 — накопленное не консолидируется. `lesson_audit` на текущем корпусе: 12 пар duplicate_of, 4 урока с пустым телом, 1 протухший. Правило, которое нарушают снова и снова, живёт в 3–4 дублях-уроках вместо одной строки в AGENTS.md (который инжектится в каждый ход каждой фазы, кап 8000 символов — src/agent/system-prompt.ts). `lesson_classify` уже умеет находить кластеры воркэраундов (clusterWorkarounds, src/core/lesson-classify.ts:411) и строить черновики задач техдолга, но шага «кластер правил → строка в AGENTS.md, дубли → supersede» нет.

Почему это вместо отдельного «agent memory»: третье хранилище знаний (`.vibelog/agent-memory/`) дало бы третий источник истины при том, что «как работать» уже дважды покрыто — AGENTS.md и lessons с kind=rule. Реальная дыра не в отсутствии памяти, а в recall и консолидации уже накопленного.

Цель: закрыть пункт roadmap «Agent memory» без новой сущности — recall по смыслу задачи + детерминированная консолидация поверх lessons.

Связанные: ROADMAP.md §«Agent memory (свой)», VL-153 (lessons), VL-279 (аудит), VL-280 (классификация), VL-364 (шаг уроков в Close).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 loadLessonsForTask подбирает уроки по смыслу задачи: токены из title + description + labels (переиспользован tokenizeQuery/stemToken из src/core/search.ts), а не только по labels; задача без labels получает релевантные уроки
- [x] #2 Ранжирование по релевантности (score по совпадениям в title/tags/applies_to), свежесть — tie-breaker; кап promptLimit сохранён
- [x] #3 Фильтр по applies_to: урок с applies_to, не пересекающимся с путями из плана/описания задачи, не подставляется (или помечается как менее релевантный — решение зафиксировать в плане)
- [x] #4 Новый CLI `vibelog lesson consolidate [--dry-run] [--json]`: кластеры kind=rule → предложение строки для AGENTS.md; пары duplicate_of → предложение supersede; ничего не пишет без явного --apply
- [x] #5 MCP-инструмент lesson_consolidate (read-only по умолчанию, запись только по явному списку ID — паттерн lesson_audit)
- [x] #6 На реальном корпусе (274 урока) consolidate выдаёт непустой отчёт: 12 пар дублей и кластеры правил из lesson_audit
- [x] #7 Тесты: recall по смыслу (задача без labels находит урок), кап и сортировка, applies_to-фильтр, consolidate dry-run/apply, идемпотентность повторного apply
- [x] #8 Документация: doc-7 (§lesson), doc-8 (§lesson_consolidate), doc-10 (recall в фазах), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `loadLessonsForTask` фильтрует только по `task.labels`, без labels → `[]` | `src/core/lesson.ts:566-580` (`taskTags.length === 0 → return []`) |
| Сортировка по свежести, затем `slice(0, promptLimit)` | `src/core/lesson.ts:596-601` |
| `promptLimit` дефолт 5, секция `lessons` settings | `src/core/lesson.ts:52-60`, `readLessonSettings` |
| Подстановка `{{taskLessons}}` в промпт фазы | `src/web/phase-prompt.ts` (`taskExtraVars`, ключ `taskLessons`) |
| Готовые токенизация и стемминг | `src/core/search.ts:67` (`tokenizeQuery`), `:82` (`stemToken`) |
| Кластеризация воркэраундов уже есть | `src/core/lesson-classify.ts:411` (`clusterWorkarounds`), `:503` (`buildTechDebtDraft`) |
| Аудит: дубли/пустые тела/протухание | `src/core/lesson-audit.ts` (`auditLessons`), MCP `lesson_audit` |
| AGENTS.md инжектится в каждый ход, кап 8000 | `src/agent/system-prompt.ts` (`AGENTS_MD_MAX_CHARS`) |
| Паттерн «read-only по умолчанию, запись по списку ID» | `lesson_audit` (`applyLessonAudit`), lesson-147 |

## Часть A. Recall по смыслу задачи

1. `src/core/lesson.ts` — новая функция `scoreLessonForTask(lesson, tokens)` (чистая, экспорт для тестов): вес по полям — `title` 3, `tags` 2, `applies_to` 2, `body` 1; И-логика не нужна (в отличие от `searchTasksRanked`), достаточно суммы: урок про «worktree» полезен задаче про worktree даже без совпадения всех токенов.
2. `loadLessonsForTask` (строка 566) — источник токенов: `tokenizeQuery(title + ' ' + description + ' ' + labels.join(' '))`, каждый токен через `stemToken`. Убрать ранний `return []` при пустых labels; оставить `return []` только если токенов нет вовсе (пустые title+description).
3. Сортировка: сначала `score` по убыванию, при равенстве — свежесть (текущий компаратор). Кап `promptLimit` сохранить.
4. `applies_to`-фильтр: если у урока `applies_to` непустой и ни один glob не пересекается с путями из `task.implementationPlan`/`modified_files` — понижать score (не отбрасывать: план на фазе Plan ещё пуст). Реализовать как множитель 0.5, а не как жёсткий фильтр — иначе на фазе Plan (плана нет) отвалится всё.
5. Формат строки подстановки расширить: `- [lesson-N] <title> (kind)` — `kind` помогает модели отличить правило от воркэраунда. Обратная совместимость: тест `phase-prompt.test.mjs` на `{{taskLessons}}` обновить.

## Часть B. Консолидация

6. Новый модуль `src/core/lesson-consolidate.ts` (по образцу `lesson-audit.ts`, без LLM и сети):
   - `buildConsolidationPlan(cwd)` → `{ ruleClusters[], duplicatePairs[], emptyBodies[], summary }`;
   - `ruleClusters` — группы активных уроков с `kind: 'rule'` (и `kind: null` с эвристикой «императивный заголовок»), сгруппированные по пересечению tags; для каждой — предлагаемая строка для AGENTS.md (заголовок самого свежего урока кластера) и список ID на supersede;
   - `duplicatePairs` — из `auditLessons().findings` типа `duplicate_of`, дедуплицированные по паре (a,b);
   - `emptyBodies` — из `empty_body`.
7. `applyConsolidation(cwd, { supersede: string[], appendAgentsMd: string[] })` — запись ТОЛЬКО по явным ID/строкам (паттерн `applyLessonAudit`, lesson-147). AGENTS.md дописывается в секцию-маркер `<!-- lessons:consolidated -->` (создаётся при отсутствии), повторный apply не дублирует строки (сравнение по нормализованному тексту).
8. CLI `vibelog lesson consolidate [--dry-run] [--json] [--apply-supersede id,…] [--apply-agents line,…]` — `src/cli/commands/lesson.ts` (рядом с `audit`), регистрация в `src/cli/router.ts` + строка справки.
9. MCP `lesson_consolidate` — `src/mcp/tools.ts` + обработчик: read-only по умолчанию, запись только по явным спискам. Обновить счётчик инструментов в `doctor` и в тестах (`compat-full`, `server`, `diagnostics`).
10. Проверка на реальном корпусе: `vibelog lesson consolidate --dry-run` должен показать 12 пар дублей и ≥1 кластер правил. Если кластеров 0 — эвристику `kind: null` не включать (не выдумывать правила).

## Порядок

A (1–5) → тесты → B (6–7) → CLI/MCP (8–9) → прогон на корпусе (10) → документация.

## Как проверить

- `pnpm build && pnpm test` (полный прогон, без `--exclude`).
- `vibelog lesson consolidate --dry-run` на этом репозитории — глазами сверить пары с выводом `lesson_audit`.
- Ручной кейс recall: взять задачу без labels (например старую из `backlog/completed/`), вызвать `loadLessonsForTask` через `node -e` на dist — должен вернуть непустой список.
- `vibelog lesson consolidate --apply-supersede lesson-211` на копии каталога — проверить, что `lesson-28` стал `superseded`, а `lesson-211` получил `supersedes`.

## Риски

- **Разбухание промпта.** Recall по смыслу даёт больше совпадений, чем по labels. Митигация: кап `promptLimit` не поднимать, формат строки компактный (id + title + kind).
- **Ложные пары дублей.** Порог 0.35 на реальном корпусе даёт пары вроде lesson-158/lesson-229 (0.37) — это разные уроки. Поэтому `apply` только по явному списку ID, никакого «применить всё».
- **AGENTS.md как цель записи.** Файл читается в каждый ход; дописывание мусора дороже, чем отсутствие правила. Митигация: секция-маркер, дедуп по тексту, dry-run по умолчанию.
- **Совместимость.** `loadLessonsForTask` — публичный экспорт, используется в `phase-prompt.ts`; сигнатура не меняется, меняется только содержимое результата. Тест `phase-prompt.test.mjs` на `{{taskLessons}}` обновить вместе с форматом строки.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 09:49
---
Фаза code не удалась (код выхода 1): окировок=2, payload последнего запроса=642354 байт (макс 642354), usage={"input_tokens":7999591,"output_tokens":52862,"cache_read_input_tokens":7851008,"total_tokens":8052453,"reasoning_tokens":33783} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 10:01
---
Фаза 3 (Code) выполнена. Коммит c79b11b.
**Часть A — recall по смыслу задачи** (`src/core/lesson.ts`)
- `loadLessonsForTask` больше не возвращает `[]` при пустых labels: токены берутся из `title + description + labels` через `tokenizeQuery`/`stemToken` из `src/core/search.ts` (переиспользование, не копия). Токены короче 3 символов отбрасываются, кроме явных labels («ci», «ui»).
- Новая чистая экспортируемая `scoreLessonForTask(lesson, tokens, body)`: веса title 3 / tags 2 / applies_to 2 / body 1, сумма (без И-логики — урок про worktree полезен задаче про worktree и без совпадения всех токенов).
- Сортировка: score по убыванию, свежесть — tie-breaker; кап `promptLimit` сохранён.
- `applies_to`: если непустой и не пересекается с путями из `implementationPlan`/`modified_files` задачи — множитель **0.5** (не отбрасывание: на фазе Plan план пуст). Добавлены экспортируемые `extractTaskPaths` и `globMatchesPath` (минимальный матчер `**`/`*`/`?` без зависимостей).
- Формат строки расширен до `- [lesson-N] <title> (kind)`; у уроков без kind скобок нет.
**Часть B — консолидация** (новый `src/core/lesson-consolidate.ts`, без LLM и сети)
- `buildConsolidationPlan(cwd)` → `{ruleClusters, duplicatePairs, emptyBodies, summary}`. Кластеры правил строятся из **компонент связности графа дублей** (`duplicate_of` из `auditLessons`) плюс связные tag-группы с проверкой смысловой близости заголовков (Jaccard ≥ 0.12, размер ≤ 4). Два отвергнутых подхода зафиксированы в комментариях: union-find по пересечению tags сливал весь корпус в один мега-кластер, а группировка по одному tag давала 81 «кластер» из несвязанных уроков (общая метка `тесты`/`docs` — область, а не правило).
- `applyConsolidation(cwd, {supersede, appendAgentsMd})` — запись только по явным ID/строкам (паттерн `applyLessonAudit`, lesson-147). AGENTS.md дописывается в секцию-маркер `<!-- lessons:consolidated -->` (создаётся при отсутствии), дедуп по нормализованному тексту (без маркера списка, регистр, пробелы).
- CLI `vibelog lesson consolidate [--dry-run] [--json] [--threshold N] [--apply-supersede id,…] [--apply-agents "строка,…"]` + строка справки в `router.ts`.
- MCP `lesson_consolidate` (read-only по умолчанию, валидация аргументов на границе слоя, кап вывода 20 КБ), объявлен `read` в `tool-kinds.ts`, добавлен в `instructions.ts` и фикстуру `diagnostics.test.mjs`.
**Проверки**
- `pnpm build` — чисто.
- **Полный `pnpm test`**: 210 файлов, **4071 passed**, 4 skipped (предсуществующие skip в `frontmatter.test.mjs`), 0 failed. Исключений/`--skip` не было.
- `vibelog lesson consolidate` на реальном корпусе (274 урока): **4 кластера правил** (tag:build ×2, tag:close, tag:assistant-ui), **6 уникальных пар дублей**, **11 пустых тел**. Сверено с `lesson_audit`: он даёт `duplicate_of: 12` — это те же 6 пар, каждая посчитана дважды (по находке на урок); план дедуплицирует по паре, как и требует план задачи.
- Ручной кейс recall: из 389 задач **152 без labels**; `loadLessonsForTask` на них возвращает непустые релевантные списки (VL-10, VL-100, VL-101 — проверено).
- Ручной кейс apply на копии каталога: `applyConsolidation({supersede:['lesson-211']})` → `lesson-28` стал `superseded`, `lesson-211` получил `supersedes: lesson-28` — ровно как в плане.
**Тесты (AC7)**: `src/core/lesson-consolidate.test.mjs` (12 тестов: эвристика императива, план, read-only, apply/идемпотентность/дедуп AGENTS.md, notFound, не-канон, MCP read-only + валидация + запись по списку, регистрация CLI) и 5 новых тестов в `src/core/lesson.test.mjs` (recall без labels, ранжирование title > body, кап, applies_to-множитель, формат с kind). `phase-prompt.test.mjs` дополнен кейсом recall без labels.
**Что осталось (не входит в Code)**: AC8 — документация (doc-7 §lesson, doc-8 §lesson_consolidate, doc-10 recall в фазах, CHANGELOG) — по правилам фазы Code документы backlog/docs и CHANGELOG не правятся, их пишет Фаза Close после merge. Поэтому AC8 и DoD «Документация обновлена» не отмечены.
---
author: @agent
created: 2026-11-10 10:13
---
Фаза Close выполнена. Ветка vb/vl-400 слита в master (1 коммит c79b11b, merge без конфликтов), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-400 удалена.
**Проверки после merge**
- `pnpm build` — чисто.
- Ранний точечный фильтр по diff (lesson, lesson-consolidate, phase-prompt, diagnostics, server, compat-full) — 6 файлов, 232 теста, все зелёные.
- **Полный `pnpm test`**: первый прогон — 1 флак в `src/core/report.test.mjs` (файл не менялся этим diff'ом, вне затронутых модулей); классификация: параллельного vitest не было, повторный полный прогон — **4078 passed, 4 skipped, 0 failed** (210 файлов). Регрессий нет.
**Документация (AC8, DoD 2)**
- doc-7 §lesson: строка `consolidate` в блоке команд + описание в таблице; обновлена фраза про `{{taskLessons}}` (recall по смыслу, веса, applies_to-множитель).
- doc-8: новая секция `lesson_consolidate` (параметры, состав плана, почему кластеры из графа дублей, идемпотентность, примеры вызовов).
- doc-30 §5: подстановка `{{taskLessons}}` — recall по смыслу задачи, ранжирование, кап, формат строки, отсылка к consolidate. (doc-10 помечен как устаревший — актуально в doc-30/doc-31, поэтому правился живой документ.)
- CHANGELOG.md: запись VL-400 в Unreleased → Добавлено.
- Коммит документации: e77a174.
**Уроки**: создан lesson-277 «Не кластеризуй уроки по пересечению tags — строй кластеры из графа дублей» (найденный в Code подход: union-find по tags дал мега-кластер, группировка по одной метке — 81 ложный кластер), связан с VL-400; коммит ee39e2d.
**DoD**: 1 «Тесты проходят» — да (полный прогон зелёный); 2 «Документация обновлена» — да (doc-7, doc-8, doc-30, CHANGELOG); 3 «Нет регрессий» — да.
---
<!-- COMMENTS:END -->