---
id: VL-123
title: static.test.mjs флак «Unable to deserialize cloned data» — диагностика и стабилизация
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-14 00:29'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: low
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - package.json
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
static.test.mjs периодически падает на file-level в полных прогонах pnpm test с внутренней ошибкой «Unable to deserialize cloned data due to invalid or unsupported version» (IPC/V8-артефакт test-runner на macOS). В одиночных прогонах зелёный (проверено: 2-3 из 3 проходов — флак). Засвечен многократно 2026-10-08..12, каждый раз подтверждался одиночным прогоном — реальных падений теста нет.

План: (1) собрать статистику — 5 полных прогонов, частота; (2) попробовать стабилизацию: изоляцию файла (отдельный процесс), снижение параллелизма (node --test --test-concurrency) или уменьшение общих ресурсов прогона; (3) если флак не лечится — документально принять (известная особенность в комментарии static.test.mjs + память проекта), чтобы будущие прогоны не считали его регрессией.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 статистика: 5 полных pnpm test — частота флака в комментарии задачи
- [x] #2 фикс (изоляция файла, --test-concurrency, уменьшение общих ресурсов) ЛИБО документальное принятие: пометка об известном флаке в комментарии задачи и комментарии в static.test.mjs
- [x] #3 3 последовательных полных pnpm test без file-level fail по static.test
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

Стабилизировать флак `src/web/static.test.mjs` (file-level fail «Unable to deserialize cloned data due to invalid or unsupported version» — IPC/V8-артефакт vitest-worker на macOS) ИЛИ документально принять его как известную особенность, чтобы будущие прогоны не считались регрессией.

## Файлы для изменения

- `vitest.config.mts` — блок `test:` (строки 16–37): рядом с `fileParallelism: true` (стр. 23) добавить `maxWorkers: 4` — ограничение параллелизма (вариант A); при необходимости `pool`/`poolOptions`.
- `package.json` — `scripts.test` («pnpm build && vitest run») — изоляция static.test в отдельный запуск (вариант B): `pnpm build && vitest run --exclude src/web/static.test.mjs && vitest run src/web/static.test.mjs`.
- `src/web/static.test.mjs` — JSDoc-шапка (строки 1–13): абзац «Известный флак VL-123» с симптомом, статистикой и пометкой «не регрессия» (только при документальном принятии).
- backlog-документ (MCP `document_create`) — «Известные флаки тестов», память проекта (только при документальном принятии).

Фактически меняется 1–2 файла (A или B) либо только комментарии (D).

## Шаг 1 — статистика (AC1)

5 полных прогонов, логи в корне (`*.log` в .gitignore):

```
for i in 1 2 3 4 5; do pnpm test > vl123-run-$i.log 2>&1; echo "run $i: exit=$?"; done
grep -c -E "Unable to deserialize|FAIL.*static\.test" vl123-run-*.log
```

Частота (N/5) — комментарием в VL-123 через `backlog_add_comment` сразу после сбора (AC1 не откладывать).

## Шаг 2 — выбор варианта

- Флак воспроизводится (≥1/5) → шаг 3A.
- 0/5 → 3B (изоляция как профилактика), статистика после неё.
- В логах убедиться, что ошибка file-level именно у static.test (grep FAIL).

## Шаг 3 — стабилизация (по нарастанию инвазивности)

- **3A (снижение параллелизма):** в `vitest.config.mts` в `test:{}` после `fileParallelism: true` (стр. 23) добавить `maxWorkers: 4`. Обоснование: IPC-гонка воркеров; ≤4 воркеров снижают давление на IPC-канал, цена — чуть дольше прогон.
- **3B (изоляция файла):** в `package.json` → `scripts.test` заменить на `pnpm build && vitest run --exclude src/web/static.test.mjs && vitest run src/web/static.test.mjs` — static.test идёт вторым vitest-запуском в собственном процессе. `pnpm test:fast` не трогаем.
- **3C (крайнее, если A+B не дали 3 чистых прогона):** `fileParallelism: false` в `vitest.config.mts` — последовательный прогон; отметить в комментарии задачи регресс по времени (VL-140/139 профилировали параллелизм).
- **3D (документальное принятие — fallback):**
  1. Абзац в JSDoc `src/web/static.test.mjs` (после строки 13): симптом, статистика, «падение уровня тест-раннера, не регрессия кода; проверять одиночным `pnpm test:fast -- src/web/static.test.mjs`».
  2. `document_create` «Известные флаки тестов» (память проекта): VL-123, симптом, статистика, что не является регрессией.
  3. Комментарий в VL-123: «фикс не удался, принято документально» (AC2-ветка «ЛИБО»).

## Шаг 4 — верификация (AC3, DoD)

```
for i in 1 2 3; do pnpm test > vl123-verify-$i.log 2>&1; echo "verify $i: exit=$?"; done
grep -E "Unable to deserialize|FAIL" vl123-verify-*.log   # пусто = чисто
```

3 последовательных полных `pnpm test` без file-level fail по static.test. Логи удалить (`rm vl123-*.log`). DoD: тесты проходят, документация обновлена (3D или комментарии), регрессий нет (`pnpm build` без ошибок, полный прогон зелёный).

## Порядок действий (сжато)

1. 5 прогонов → частота → комментарий в VL-123 (AC1).
2. 3A (`maxWorkers: 4`) → контрольный прогон; не помогло → 3B (изоляция в `package.json`).
3. 3 прогона подряд (AC3) → флак остался → 3D документальное принятие (AC2 «ЛИБО») → повторить 3 прогона (AC3) с принятым флаком.
4. `backlog_finish_phase` с отчётом: вариант (A/B/C/D), статистика до/после, DoD.

## Риски

- **Время:** до 8 полных прогонов (5 статистика + 3 верификация) × 2–4 мин ≈ 15–30 мин — логи писать в файл, не в контекст.
- **3C** — откат прогресса VL-140/139 по времени; только последний вариант, зафиксировать в комментарии.
- **3B** меняет CLI-поведение `pnpm test` (два vitest-запуска) — отметить в отчёте.
- При 0/5 не делать вывод «вылечен» (флак ~1/3) — опираться на AC3.
- `--exclude` и `--maxWorkers` проверены в `vitest --help` v5.0.4 — поддерживаются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 21:05
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 4 файла в списке (vitest.config.mts, package.json, src/web/static.test.mjs, backlog-документ), реально меняется 1–2. План: (1) статистика — 5 полных pnpm test с логами в vl123-run-N.log, частота флака → комментарий задачи; (2) стабилизация по возрастанию инвазивности: A) maxWorkers: 4 в vitest.config.mts, B) изоляция static.test.mjs отдельным vitest-запуском в scripts.test, C) fileParallelism: false (крайнее, откат VL-140/139); (3) fallback 3D — документальное принятие: абзац в JSDoc static.test.mjs + document_create «Известные флаки тестов» + комментарий задачи; (4) верификация — 3 последовательных полных pnpm test без file-level fail. Риски: время (до 8 прогонов ≈ 15–30 мин), 3C откатывает параллелизм VL-140, 3B меняет поведение pnpm test (два запуска vitest), 0/5 не означает «вылечен» (флак ~1/3). CLI-опции --exclude/--maxWorkers проверены в vitest --help v5.0.4.
---
author: @agent
created: 2026-10-14 00:21
---
Шаг 1 (статистика, AC1): выполнено 5 полных прогонов pnpm test (worktree vb/vl-123). Результат: 5/5 зелёные, file-level fail «Unable to deserialize|FAIL static.test» — 0/5. Частота флака в этой серии: 0/5 (логи vl123-run-1..5.log в корне, будут удалены). По плану при 0/5 перехожу к варианту 3B (изоляция static.test.mjs отдельным vitest-запуском) как профилактике; «вылечен» не утверждаю — критерий «3 чистых прогона подряд после стабилизации» (AC3).
---
author: @agent
created: 2026-10-14 00:25
---
Фаза 3 (Code) выполнена. Вариант: B (изоляция файла), флак 0/5 — фикс применён как профилактика.
Статистика до стабилизации (AC1): 5 полных pnpm test — 0/5 падений, «Unable to deserialize|FAIL static.test» не встречался ни разу (логи vl123-run-1..5.log удалены). Частота флака в серии: 0/5; по плану при 0/5 перешёл к 3B, «вылечен» не утверждаю.
Стабилизация (AC2, ветка «фикс»): вариант 3B — в package.json scripts.test: «pnpm build && vitest run --exclude src/web/static.test.mjs && vitest run src/web/static.test.mjs». static.test.mjs выполняется вторым vitest-запуском в собственном процессе — исключает IPC-гонку воркеров (корень флака). Вариант 3A (maxWorkers) не понадобился — воспроизведения не было; 3C (fileParallelism: false) не применялся. 3D (документальное принятие) не потребовался: фикс выбран, пометка в static.test.mjs не вносилась (нужна только при принятии). Внимание: pnpm test теперь делает два vitest-запуска (build + два прогона) — пnpm test:fast не менялся.
Верификация (AC3): 3 последовательных полных pnpm test подряд — 3/3 exit=0, grep по «Unable to deserialize|FAIL» в логах verify пуст (логи удалены). Сборка pnpm build без ошибок.
Проверки: git status чистый (кроме node_modules/refs — untracked симлинки worktree), коммит b993d56 (fix: VL-123 — изолировать static.test.mjs отдельным vitest-запуском в pnpm test) в ветке vb/vl-123, только package.json. Что осталось: CHANGELOG/итоговая документация — Фаза Close (VL-126); отслеживать, что при 0/5 исчезновение флака статистически незначимо (исторически ~1/3), при повторе засечений — см. план (3A/3C).
---
author: @agent
created: 2026-10-14 00:29
---
Фаза Close выполнена. Ветка vb/vl-123 слита в master (1 коммит b993d56, --no-ff), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка vb/vl-123 удалена. Пост-merge проверки в master: pnpm build без ошибок, полный pnpm test зелёный (exit=0). DoD: тесты проходят (3/3 верификационных прогона из Фазы 3 + пост-merge прогон), документация обновлена (CHANGELOG.md, раздел Unreleased, запись VL-123 в «Изменено»; docs-коммит 5276822), регрессий нет (сборка и полный прогон в master после merge чистые). Все пункты DoD отмечены.
---
<!-- COMMENTS:END -->