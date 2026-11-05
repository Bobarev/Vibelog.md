---
id: VL-342
title: 'Проверка целостности ссылок задач: references/lessons/dependencies/parent_task_id → существующие id'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 13:23'
updated_date: '2026-11-05 18:56'
due_date: ''
labels:
  - core
  - doctor
  - integrity
  - cli
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/integrity.ts
  - src/core/integrity.test.mjs
  - src/cli/commands/task.ts
  - src/cli/commands/doctor.ts
  - src/cli/task-check-cli.test.mjs
lessons:
  - lesson-229
token_usage:
  input: 5599632
  output: 29722
  cache: 5467136
  total: 5629354
  requests: 90
  duration_ms: 779976
  reasoning: 9371
  by_phase:
    code:
      input: 3727582
      output: 20350
      cache: 3640320
      requests: 47
    close:
      input: 1872050
      output: 9372
      cache: 1826816
      requests: 43
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инженерное улучшение из doc-22 §5.3. Небольшая read-only проверка, не пересекается с кодом doc-25, может уехать в релиз вместе с задачами doc-25.

**Проблема.** `lesson_audit` (VL-279) механически проверяет целостность уроков: битые пути, висячие ссылки на задачи, поломанные `supersedes`. Для самих задач такой проверки нет: `task.references` → `ref-N`, `task.lessons` → `lesson-N`, `dependencies` → задача, `parent_task_id` → задача. Битые ссылки в frontmatter сейчас невидимы — `backlog_view_task` отдаёт id как есть, `lesson_link`/`reference_link` валидируют только свою сторону, а прямая правка frontmatter (руками или агентом через `backlog_update_task`) может оставить висячий id.

**Что нужно.** Детерминированная проверка (без LLM, без сети) по образцу `src/core/lesson-audit.ts`: один проход по задачам, набор типизированных находок, интеграция в `doctor` и отдельная CLI-команда с `--json`.

**Границы.** Только чтение и отчёт. Автоматического исправления ссылок нет; записывать ничего не нужно. Пустые значения (`parent_task_id: ''`) — норма (VL-69: пустая строка = сброс родителя), не находка.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый модуль `src/core/integrity.ts` с `checkTaskReferences(cwd)` (read-only, без записи файлов) возвращает `{ total, findings[], summary }`
- [x] #2 Проверяются четыре вида ссылок: `task.references` → существующий `ref-N`, `task.lessons` → существующий `lesson-N`, `task.dependencies` → существующая задача, `task.parent_task_id` → существующая задача
- [x] #3 Учитываются задачи и в `backlog/tasks/`, и в `backlog/completed/` (закрытая зависимость — не битая ссылка)
- [x] #4 Находки типизированы (`dangling_reference` | `dangling_lesson` | `dangling_dependency` | `dangling_parent`) и содержат id задачи, id ссылки и человекочитаемое сообщение
- [x] #5 Автоссылка задачи на саму себя в `dependencies`/`parent_task_id` детектится отдельным типом `self_link` (не молча пропускается)
- [x] #6 Пустое значение (`''` в `parent_task_id`, пустые массивы) битой ссылкой НЕ считается — иначе на 300 задачах будет шум (см. VL-69: пустая строка = сброс)
- [x] #7 `doctor` получает проверку `task_integrity` (влияет на exit code только при наличии находок), в `--json` — блок `findings` в соответствующей проверке
- [x] #8 Отдельная CLI-поверхность `vibelog task check` (или `vibelog check`) печатает находки таблицей и `--json`, код возврата 1 при находках; при отсутствии — «битых ссылок нет»
- [x] #9 Модуль тестируется без живого репозитория: фикстура на mkdtemp с задачами, lessons и references (lesson-104)
- [x] #10 Идемпотентность и производительность: один проход по списку задач, без обращений к сети; на текущем корпусе (300+ задач) работает за разумное время
- [x] #11 Нет пересечений с кодом doc-25: `install`/`create`/реестр/`installed.lock.json` и `router.ts`-ветки этих команд не трогаются (`router.ts` — только новая ветка проверки)
- [x] #12 CHANGELOG.md обновлён, doc-7 дополнен разделом проверки, `doctor` описан в doc-7
- [x] #13 `pnpm build && pnpm test` зелёные
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

- `src/core/integrity.ts` (новый) — чистый модуль проверки, по образцу `src/core/lesson-audit.ts`.
- `src/core/integrity.test.mjs` (новый) — фикстура на mkdtemp.
- `src/cli/commands/task.ts` — подкоманда `check` (либо `doctor`-only, см. развилку ниже).
- `src/cli/commands/doctor.ts` — проверка `task_integrity`.
- `doc-7`, `CHANGELOG.md`.

## Источники (уже есть)

- `listTasks(cwd)` (`src/core/store.ts:35`) — парсит `backlog/tasks/*.md`. **Нужно проверить, включает ли она `completed/`**; если нет — добавить отдельное чтение `completedDir()` из `src/core/paths.ts` (в `lesson-audit.ts` такой импорт уже есть).
- `listReferences(cwd)` (`src/core/reference.ts`), `listLessons(cwd)` (`src/core/lesson.ts`) — множества существующих id (`IdSet`).
- Набор валидных id задач = id из `tasks/` ∪ `completed/`. Один проход, `Set<string>` для O(1) проверки.

## Шаг 1. `src/core/integrity.ts`

```ts
export type IntegrityFindingType =
  | 'dangling_reference'   // task.references → нет ref-N
  | 'dangling_lesson'      // task.lessons → нет lesson-N
  | 'dangling_dependency'  // dependencies → нет задачи
  | 'dangling_parent'      // parent_task_id → нет задачи
  | 'self_link';           // dependencies/parent_task_id указывает на саму задачу

export interface IntegrityFinding {
  type: IntegrityFindingType;
  taskId: string;
  ref: string;              // сам висячий id
  message: string;          // человекочитаемо
}

export interface IntegrityReport {
  total: number;                     // сколько задач проверено
  findings: IntegrityFinding[];
  summary: Record<IntegrityFindingType, number>;
}

export function checkTaskIntegrity(cwd: string): IntegrityReport;
```

Правила:
- `parent_task_id: ''` (или отсутствие) — не находка (VL-69);
- задача из `completed/` считается существующей (закрытая зависимость — норма, а не битая ссылка);
- `self_link` ловится ДО проверки существования, чтобы сообщение было понятным («задача ссылается на себя»), а не «не найдено»;
- регистр/пробелы: id нормализуется `trim()`, сравнение регистронезависимое по префиксу+числу (в корпусе встречаются `BACK-200` в тестах, а в этом проекте — `VL-N`; правило должно работать при любом `task_prefix` из `backlog/config.yml`, не хардкодить `VL`);
- сбой чтения lessons/references не рушит проверку: секция помечается, ссылки этого типа пропускаются (report остаётся валидным).

## Шаг 2. Поверхность CLI

Развилка (выбрать одну, по умолчанию — первая):
1. `vibelog task check [--json]` — логично (проверка задач), одна ветка в существующем `runTask`, `router.ts` не меняется.
2. `vibelog check` — новая команда, нужна строка в `router.ts` (пересечение с doc-25 минимально: ветки `install`/`create` не трогаются).

Печать: таблица `ТИП | ЗАДАЧА | ССЫЛКА | СООБЩЕНИЕ`, в конце `Находок: N (проверено задач: M)`. Без находок — `Битых ссылок нет`. Код: `0` / `1` при находках.

## Шаг 3. `doctor`

Новая проверка `task_integrity`: `ok = findings.length === 0`, `value = { total, count: findings.length }`, `hint` — «Запустите `vibelog task check` для подробностей», в `--json` — поле с первыми 20 находками (не раздувать вывод на 300 задачах). В `requiredNames` **не** добавлять: битые ссылки — не блокирующая поломка окружения (иначе `doctor` красный на легаси-ссылках).

## Шаг 4. Тесты

`src/core/integrity.test.mjs` (mkdtemp + минимальный `backlog/` с `config.yml`, `tasks/`, `completed/`, `lessons/`, `references/`):
1. все ссылки валидны → `findings` пустой;
2. `references: ['ref-999']` → `dangling_reference`;
3. `lessons: ['lesson-999']` → `dangling_lesson`;
4. `dependencies: ['XX-999']` → `dangling_dependency`;
5. `parent_task_id: 'XX-999'` → `dangling_parent`;
6. `parent_task_id: ''` → находки нет;
7. зависимость на задачу из `completed/` → находки нет;
8. `dependencies: [selfId]` → `self_link` (не `dangling_dependency`);
9. битый `lessons/` каталог (нет вовсе) → проверка не падает, `dangling_lesson` не генерируется.

CLI-тест (`src/cli/task-check-cli.test.mjs` или в существующем `task-cli.test.mjs`) — человекочитаемый вывод и `--json`, код возврата.

## Шаг 5. Проверка

`pnpm build && pnpm test`; прогнать `vibelog task check` на этом репозитории — ожидаемо найдёт несколько легаси-ссылок (их и нужно увидеть до релиза, а не после).

## Риски

- **Шум на реальном корпусе.** Если находок окажется много (300+ задач, легаси-ссылки от ранних версий), `doctor` станет постоянно жёлтым. Решение: `doctor` показывает счётчик, подробности — только в `task check`; при необходимости — флаг `--only <тип>` и список игнорируемых id.
- **Стоимость парсинга.** Тот же `listTasks` (doc-22 §4.1), что и везде: ещё один полный проход. Приемлемо для CLI, не для веб-чата — проверку в горячий путь не ставить.
- **Дубль с `lesson_audit`.** `lesson_audit` уже проверяет `linked_tasks` со стороны урока — эти находки пересекаются с `dangling_lesson` со стороны задачи. Осознанно: стороны разные, отчёты не сливаются, `lesson_audit` не меняется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 16:44
---
Фаза 3 (Code) выполнена. Коммит 40fe96f.
**Изменено:**
- `src/core/integrity.ts` (новый) — `checkTaskIntegrity(cwd)` (+ алиас `checkTaskReferences` под формулировку AC1): read-only, один проход по `listTasks`, множества существующих id собираются заранее (`Set`, O(1) на ссылку). Типы находок `dangling_reference | dangling_lesson | dangling_dependency | dangling_parent | self_link`; `IntegrityFinding { type, taskId, ref, field, message }`; `IntegrityReport { total, findings, summary, sections }`. Набор валидных id задач = `tasks/` ∪ `completed/` (по именам файлов, без полного парсинга). `self_link` ловится ДО проверки существования. Пустые значения (`parent_task_id: ''`, пустые массивы) — не находка (VL-69). Id нормализуется `trim()` + регистронезависимо, префикс не хардкодится. `sections: { lessons, references }` со состояниями `ok|missing|error`: отсутствующий каталог (`missing`) — ссылки этого типа не проверяются (иначе на проекте без lessons все ссылки стали бы «битыми»), сбой чтения (`error`) — отчёт остаётся валидным, CLI предупреждает.
- `src/cli/commands/task.ts` — подкоманда `check` (вариант 1 развилки плана): таблица `ТИП | ЗАДАЧА | ССЫЛКА | СООБЩЕНИЕ`, итог `Находок: N (проверено задач: M)`, без находок — «Битых ссылок нет», `--json` (`kind: task-integrity`), код возврата 1 при находках. `router.ts` не тронут.
- `src/cli/commands/doctor.ts` — проверка `task_integrity`: `ok = findings.length === 0`, `value = { total, count, findings: первые 20 }`, `hint` «Запустите `vibelog task check` для подробностей». В `requiredNames` НЕ добавлена (по плану: битые ссылки — не блокирующая поломка окружения).
- `src/core/integrity.test.mjs` (10 тестов, mkdtemp-фикстура с tasks/completed/lessons/references): все ссылки валидны; dangling_reference/lesson/dependency/parent; пустой parent; зависимость из `completed/`; self_link в dependencies и в parent_task_id; нормализация регистра/пробелов; отсутствующий каталог lessons не роняет проверку и не даёт находок; summary покрывает все типы.
- `src/cli/task-check-cli.test.mjs` (4 теста): человекочитаемый вывод, `--json`, коды возврата 0/1.
**Проверки:** `pnpm build` — ok; полный `pnpm test` — 180 файлов, 3407 passed, 4 skipped (без exclude/skip); `vibelog task check` на этом репозитории — «Битых ссылок нет (проверено задач: 329)», exit 0; `vibelog doctor --json` — `task_integrity: {total: 329, count: 0}`, `ok: true`.
**Отклонение от AC7 (осознанное, по плану):** AC7 говорит «влияет на exit code только при наличии находок», план (шаг 3) прямо требует НЕ добавлять проверку в `requiredNames`, чтобы `doctor` не был красным на легаси-ссылках. Реализовано по плану: `task_integrity` не влияет на exit code `doctor`, подробности — в `vibelog task check` (код 1). Если нужно поведение строго по AC7 — одна строка в `requiredNames`.
**Что осталось (Фаза Close):** AC12 — CHANGELOG.md и doc-7 (раздел `task check` + описание проверки `doctor`) в Фазе 3 не обновлялись по правилам проекта.
---
author: @agent
created: 2026-11-05 18:23
---
Фаза Close прервана: конфликт слияния vb/vl-342 → master в файле `src/cli/commands/doctor.ts` (git status: `UU src/cli/commands/doctor.ts`). Merge выполнен с `--no-ff`, конфликт оставлен как есть (не резолвился, `git merge --abort` не делался) — состояние рабочего каталога главного репозитория сейчас в состоянии незавершённого merge.
Причина конфликта: обе стороны правили `src/cli/commands/doctor.ts` — VL-342 добавляет проверку `task_integrity`, а в master этот же файл менялся другой задачей (вероятно doc-25/VL-345-соседние правки doctor).
Что нужно сделать вручную, чтобы повторить Фазу Close:
1. В главном репозитории разрешить конфликт в `src/cli/commands/doctor.ts` — сохранить ОБА набора проверок: существующие проверки master + новую `task_integrity` из ветки (ok = findings.length === 0, value = { total, count, findings: первые 20 }, hint «Запустите `vibelog task check` для подробностей», НЕ добавлять в requiredNames).
2. `git add src/cli/commands/doctor.ts && git commit` (завершить merge-коммит) либо `git merge --abort` и повторить Close после ручного разбора.
3. Прогнать `pnpm build && pnpm test` и повторить Фазу Close (новым раном).
Остальные файлы ветки слились без конфликтов: `src/core/integrity.ts`, `src/core/integrity.test.mjs`, `src/cli/task-check-cli.test.mjs` (A), `src/cli/commands/task.ts` (M). DoD, статус и документация не трогались — задача остаётся в статусе Review.
---
author: @agent
created: 2026-11-05 18:23
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-342 → master в файле `src/cli/commands/doctor.ts` (git status: `UU src/cli/commands/doctor.ts`). Merge выполнен с `--no-ff`, конфликт оставлен как есть (не резолвился, `git merge --abort` не делался) — состояние рабочего каталога главного репозитория сейчас в состоянии незавершённого merge.
Причина конфликта: обе стороны правили `src/cli/commands/doctor.ts` — VL-342 добавляет проверку `task_integrity`, а в master этот же файл менялся другой задачей (в — статус возвращён к Review.
---
author: @agent
created: 2026-11-05 18:56
---
Фаза Close выполнена. Ветка vb/vl-342 слита в master (merge-коммит 763edf1, 6 файлов, +966/−2) — слияние было выполнено ранее после ручного разрешения конфликта в `src/cli/commands/doctor.ts`; при этом ране merge не повторялся (проверено: `git log` содержит merge-коммит, `.git/MERGE_HEAD` отсутствует, `git branch --merged master` содержит vb/vl-342). Worktree `.vibelog/worktrees/vl-342` удалена (`--force`: единственный untracked-объект — симлинк `backlog/references/data` на главный репозиторий, данные не терялись), ветка vb/vl-342 удалена.
Проверки после merge: `pnpm build` — успешно; ранний точечный фильтр `src/core/integrity.test.mjs` + `src/cli/task-check-cli.test.mjs` — 14 тестов зелёные; полный `pnpm test` — 182 файла, 3432 теста passed, 4 skipped, падений нет (повторных полных прогонов не было). Прогон на реальном корпусе: `vibelog task check` → «Битых ссылок нет (проверено задач: 335)», код 0; `doctor` → `task_integrity: {"total":335,"count":0,"findings":[]}`.
Документация: CHANGELOG.md (запись в Unreleased → Добавлено), doc-7 (новый раздел `task check` с таблицей типов находок и правилами, абзац `task_integrity` в разделе `doctor`, строка в примере вывода) — коммит ffe94bd. Lessons: создан lesson-229 (проверка фактического состояния merge перед повторным слиянием в Close) — коммит 4a6afa4.
DoD: 1 «Тесты проходят» ✓, 2 «Документация обновлена» ✓ (CHANGELOG + doc-7), 3 «Нет регрессий» ✓ (полный прогон зелёный). AC 12 отмечен.
---
<!-- COMMENTS:END -->