---
id: VL-170
title: Коммитить refs и lessons после фазы close
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 14:11'
updated_date: '2026-10-25 23:26'
due_date: ''
labels:
  - prompt
  - core
dependencies: []
milestone: v1.9
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-17
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
После фазы close не должно оставаться незакоммиченных изменений: references и lessons, затронутые в процессе работы над задачей, должны быть закоммичены.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст

Фазы Spec/Plan/Code создают/обновляют references (`reference_add`/`reference_link` → файлы `backlog/references/<ref-N>-<slug>.md`), Close/Code — lessons (`lesson_create`/`lesson_update` → `backlog/lessons/lesson-N-<slug>.md`). Все эти MCP-инструменты пишут файлы в ГЛАВНЫЙ репозиторий, но ни один close-шаблон их не коммитит:

- `templates/qwen-commands/phase-close.md`: шаг 3 — feat-коммит кода, шаг 4 — docs (CHANGELOG/docs), шаг 6 — docs(task) файлы задач. Refs/lessons никто не коммитит.
- `templates/qwen-commands/phase-close-worktree.md`: шаг 2 — worktree, шаг 8 — docs, шаг 10 — docs(task). Та же проблема.
- Плюс в `phase-close.md` шаг 6.5 (`backlog_update_task {"lessons": ...}`) меняет файл задачи ПОСЛЕ его docs(task)-коммита (шаг 6) — файл снова грязный к концу фазы.

Итог: после close `git status` показывает незакоммиченные `backlog/references/*.md` и `backlog/lessons/*.md` (AC1 не выполняется).

Fix — prompt-level (как VL-121/VL-126): два новых шага в close-шаблонах + инварианты в тестах. TS-код НЕ меняется (`taskExtraVars` уже даёт refs/lessons; close-агент возьмёт ID через `backlog_view_task` c `fields`).

## Файлы для изменения

1. **`templates/qwen-commands/phase-close.md`** — вставить новый шаг 6.6 после строки 64 («Если lessons нет и нечего фиксировать — пропусти шаг.»), перед `## Экономия ходов` (строка 66):

```
6.6. Закоммичи refs и lessons этой задачи — после шагов 6/6.5 они лежат незакоммиченными в главном репо:
   - Получи ID затронутых файлов: backlog_view_task {"id": "{{taskId}}", "fields": ["references", "lessons"]} — плюс refs/lessons, созданные/обновлённые в шагах 5.6/6.5 этой фазы (шаг 1 Spec уже мог добавить references).
   - Точные пути получи через ls: ls backlog/references/<ref-N>* backlog/lessons/lesson-N* — используй ВЫВЕДЕННЫЕ пути (slug файла отличается от ID — не угадывай, та же ловушка, что с файлами задач).
   - Сверь git status --porcelain -- <пути> — закоммиченное/чистое пропусти. Файлы в backlog/references/data/ НЕ коммити (в .gitignore — там клоны репозиториев).
   - Если после шага 6.5 снова разбогател файл задачи (поле lessons): ls backlog/tasks/{{taskId}}* → добавь ВЫВЕДЕННЫЙ путь в этот же коммит.
   - Незакоммиченное добавь явными путями и закоммити ОДНИМ коммитом:
     git add <явные пути> && git commit -m "docs(task): {{taskId}} — refs и lessons"
   - Если нечего коммитить — пропусти шаг (пустой коммит запрещён).
```

2. **`templates/qwen-commands/phase-close-worktree.md`** — вставить шаг 7.6 после строки 65 (конец шага 7.5), перед шагом 8 (строка 67):

```
7.6. Закоммичи refs и lessons этой задачи в ГЛАВНОМ репо (файл задачи коммитит шаг 10 — сюда его НЕ включай):
   - Получи ID: backlog_view_task {"id": "{{taskId}}", "fields": ["references", "lessons"]} + refs/lessons, созданные/обновлённые в этой фазе (references ставили Spec/Plan/Code через MCP в главный репо; lessons — шаг 7.5).
   - Точные пути через ls backlog/references/<ref-N>* backlog/lessons/lesson-N* — используй выведенные пути, не угадывай slug.
   - Сверь git status --porcelain -- <пути>; backlog/references/data/ НЕ коммити (.gitignore).
   - Незакоммиченное — явные пути, один коммит: git add <явные пути> && git commit -m "docs(task): {{taskId}} — refs и lessons"
   - Нечего коммитить — пропусти (пустой коммит запрещён).
```

3. **`src/web/phase-prompt.test.mjs`** — новый describe «VL-170» (после VL-153-блоков, ~строка 375): для каждого из `phase-close.md`, `phase-close-worktree.md` — инварианты: содержит `refs и lessons` (формулировка шага), `backlog/lessons`, `backlog/references`, `git status --porcelain`, НЕ содержит `git add -A`. Комментарий в тесте: «инвариант по AC VL-170, добавлен осознанно — не удалять при рефакторинге» (паттерн VL-142).

## Порядок действий

1. Правка `phase-close.md` (вставка шага 6.6).
2. Правка `phase-close-worktree.md` (вставка шага 7.6).
3. Тесты в `phase-prompt.test.mjs`.
4. `pnpm build && pnpm test`.

Документацию (doc-10 «Агент Vibelog», раздел про Close/lessons, строка ~211; CHANGELOG Unreleased) обновит Фаза Close VL-170 по шагу 4 её шаблона — промпты изменились. Code-фазу это не касается (шаблон phase-3 запрещает трогать CHANGELOG/backlog/docs).

## Как проверить

```bash
pnpm build && pnpm test   # vitest: phase-prompt.test.mjs + все остальные
```

Ручная проверка AC после применения (закрытие любой следующей задачи): после Фазы Close `git status --porcelain -- backlog/lessons backlog/references` пуст; при неизменённых refs/lessons шаг пропускается без ошибок и пустых коммитов.

## Риски

- **Гонка параллельных close**: коммит по явным путям только своих refs/lessons — чужие файлы не попадают; guard от гонки уже есть в шаге 3(в) close-шаблона, здесь пути детерминированы из полей задачи.
- **Угадывание slug**: пути только через ls (ловушка VL-121) — в шагах явно это оговорено.
- **Шаг 6.6 в обычном close идёт после docs(task)-коммита шага 6** — потому в него включён повторный ls файла задачи (поле lessons из шага 6.5). В worktree-шаблоне файл задачи не включаем — его коммитит шаг 10.
- **Формулировки в тестах**: по решению VL-130 assert-ы на текст шаблонов minimized; новые — осознанные инварианты по AC (паттерн VL-142), с явным комментарием.
- Регрессий в git-поведении не ожидается: добавляются только новые шаги, существующие не перестраиваются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 14:12
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Коммитить refs и lessons после фазы close». Масштаб: task. Уточнено: цель (после фазы close refs/lessons, затронутые при работе над задачей, должны быть закоммичены), добавлены 3 проверяемых критерия приёмки (чистый git status для refs/lessons, отсутствие ошибок/пустых коммитов при неизменённых refs/lessons, отсутствие регрессий в остальном поведении close). Labels: prompt (тег пользователя #prompt), core. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 14:32
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: prompt-level фикс в двух close-шаблонах (новый шаг 6.6 в phase-close.md — коммит refs/lessons после шага 6.5 с повторным ls файла задачи; новый шаг 7.6 в phase-close-worktree.md — коммит refs/lessons в главном репо до шага 10), + инварианты в src/web/phase-prompt.test.mjs (паттерн VL-142). TS-код не меняется. Файлов: 3 (templates/qwen-commands/phase-close.md, templates/qwen-commands/phase-close-worktree.md, src/web/phase-prompt.test.mjs). Риски: гонка параллельных close (няты явными путями из полей задачи), slug-ловушка (пути только через ls), пустые коммиты (guard «неčего коммитить — пропусти»). Документацию (doc-10, CHANGELOG) обновит Фаза Close по шагу 4 её шаблона.
---
author: @agent
created: 2026-10-15 14:41
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-close.md (новый шаг 6.6 — коммит refs/lessons после шага 6.5 с повторным ls файла задачи), templates/qwen-commands/phase-close-worktree.md (новый шаг 7.6 — коммит refs/lessons в главном репо до шага 10), src/web/phase-prompt.test.mjs (describe «VL-170»: инварианты обоих close-шаблонов — формулировка шага, пути backlog/lessons и backlog/references, git status --porcelain, коммит только явными путями, git add -A только в запретах). Коммит 9beabc6 (feat: VL-170 — close-шаблоны коммитят refs и lessons). Проверки: pnpm build && pnpm test — 65 файлов/1130 тестов passed (+7 static), регрессий нет; попутно исправлен ассерт в новом тесте (String.replace → replaceAll: запретов git add -A в worktree-шаблоне три). AC-чеклист пуст (в задаче нет AC). Что осталось: документация (doc-10, CHANGELOG Unreleased) — Фаза Close по шагу 4 её шаблона; ручная верификация AC на ближайшем закрытии любой задачи (чистый git status по backlog/lessons и backlog/references после close).
---
author: @agent
created: 2026-10-15 15:54
---
Фаза Close выполнена. Ветка vb/vl-170 слита в master (1 коммит: 9beabc6 — шаги 6.6/7.6 в close-шаблонах), worktree удалена (force — только untracked-симлинки node_modules/refs), ветка удалена. Проверки после merge: pnpm build && pnpm test — прошли. Lessons: создан lesson-17 «Каждый MCP-шаг, пишущий файлы в главный репо (refs/lessons), требует парного шага коммита в close-шаблоне» (tags: close, templates, git, prompt-level, backlog), связан с задачей. Документация: CHANGE.md (Unreleased → Исправлено: VL-170) и doc-10 (раздел «Lessons learned в фазах» — новый пункт «Close коммитит refs и lessons») закоммичены: 85802d7 docs: VL-170 — документация и CHANGELOG. DoD: 1 (тесты проходят) ✓, 2 (документация обновлена) ✓ — CHANGELOG+doc-10, 3 (нет регрессий) ✓ — 65 файлов/1130 тестов passed. Ручная верификация AC (чистый git status по backlog/lessons и backlog/references после close) — на ближайшем закрытии любой задачи.
---
<!-- COMMENTS:END -->