---
id: VL-190
title: Исправить ENOENT при reject без папки backlog/completed
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 08:55'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - cli
dependencies: []
milestone: v1.10
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/store.ts
  - src/core/reject.test.mjs
lessons:
  - lesson-45
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Ошибка: ENOENT: no such file or directory, rename при выполнении reject (сторонний проект с отсутствующей папкой backlog/completed)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reject задачи в проекте, где отсутствует папка backlog/completed, не падает с ENOENT: no such file or directory, rename — папка создаётся автоматически перед перемещением
- [x] #2 Есть тест, воспроизводящий reject при отсутствующей папке backlog/completed (падал бы до исправления)
- [x] #3 Существующие тесты проходят без регрессий (pnpm test)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План исправления VL-190 (ENOENT rename при reject без backlog/completed)

### Корневая причина

`archiveTaskFile` в `src/core/store.ts` (строки 184–198) делает `renameSync(filePath, dest)` в `backlog/completed/`, **не создавая директорию**. `rejectTaskFile` (store.ts:248) и `completeTaskFile` (store.ts:207) вызывают `archiveTaskFile` → в проекте, где `backlog/completed/` отсутствует, reject падает с `ENOENT: no such file or directory, rename`. Аналогичные точки (`src/core/draft.ts:120`, `src/core/milestone.ts:196`) уже делают `mkdirSync(..., { recursive: true })` — наш случай просто упущен.

Все пути reject (CLI `task reject`, web `POST /api/tasks/:id/reject`, бот-кнопка, LLM-onExit) сходятся в одну `rejectTaskFile` → `archiveTaskFile` — правка в одном месте покрывает все.

### Файлы для изменения

1. **`src/core/store.ts`**
   - Строка 8 (import из `node:fs`): добавить `mkdirSync` → `import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';`
   - Строки 196–197 (перед `renameSync(filePath, dest)`): вставить
     ```ts
     // VL-190: в сторонних проектах backlog/completed/ может не существовать —
     // renameSync падал с ENOENT; создаём папку идемпотентно перед переносом
     mkdirSync(completedDir(backlogDir), { recursive: true });
     renameSync(filePath, dest);
     ```
   - Обновить JSDoc `archiveTaskFile` (строки 178–183): добавить «Директория completed/ создаётся автоматически, если отсутствует (VL-190)».

2. **`src/core/reject.test.mjs`** — новый тест воспроизведения (AC-2):
   - Вставить в `describe('VL-144 — rejectTaskFile ...')` после существующих кейсов, перед `describe('VL-144 — wasInCode ...')` (строка 95). Все нужные импорты (`rmSync`, `existsSync`, `readdirSync`) уже есть в строке 13:
     ```js
     it('VL-190: completed/ отсутствует — reject создаёт падуку, без ENOENT', () => {
       // Воспроизведение: убираем completed/, как в стороннем проекте без init
       rmSync(completedDir, { recursive: true, force: true });
       const rejected = rejectTaskFile(testDir, task.id);
       assert.equal(rejected.status, 'Rejected');
       assert.ok(existsSync(completedDir), 'completed/ создаётся автоматически');
       const inCompleted = readdirSync(completedDir).filter(f => f.includes(task.id));
       assert.equal(inCompleted.length, 1, `файл ${task.id} должен быть в completed/`);
     });
     ```
   - Тест падает с ENOENT до правки store.ts (AC-2), после — проходит. Директория восстанавливается самим `archiveTaskFile`, последующие тесты в файле не страдают (suite-порядок: механика → wasInCode; `afterAll` делает `rmSync(testDir)`).

3. **`CHANGELOG.md`** (DoD «Документация обновлена») — добавить запись в текущий раздел: «исправлен ENOENT при reject/complete без папки backlog/completed — папка создаётся автоматически (VL-190)» (формат — по существующим записям).

### Порядок действий

1. Правка `src/core/store.ts` (import + mkdirSync перед renameSync + JSDoc).
2. Тест в `src/core/reject.test.mjs`.
3. Сборка и точечная проверка: `pnpm build && pnpm test:fast src/core/reject.test.mjs` — новый тест зелёный, старые кейсы reject не упали.
4. Полный прогон: `pnpm test` (= build + vitest run) — без регрессий (AC-3).
5. Запись CHANGELOG.
6. Коммит в ветку vb/vl-190 (без файлов backlog/).

### Как проверить

```bash
pnpm build
pnpm test:fast src/core/reject.test.mjs   # точечно: VL-190 + VL-144 кейсы
pnpm test                                  # полный набор (AC-3)
```

Ручная проверка сценария: во временной папке без `backlog/completed/` выполнить `node bin/vibelog.mjs task reject <id>` — не падает, папка создаётся.

### Риски

- **Низкий**: `mkdirSync(recursive:true)` идемпотентен; единственный эффект — автосоздание папки, которую позже создаёт и `init`.
- Порядок тестов: новый тест удаляет `completed/` — безопасно, т.к. `archiveTaskFile` (после фикса) воссоздаёт её; до фикса он падает — что и требуется по AC-2.
- `completeTaskFile` использует тот же `archiveTaskFile` — фикс попутно закрывает аналогичный ENOENT у `task complete` (побочный плюс, не регрессия).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 08:56
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить ENOENT при reject без папки backlog/completed». Тип: bug. Масштаб: task. Приоритет: Medium. Уточнено: цель — устранить ошибку ENOENT: no such file or directory, rename при выполнении reject в стороннем проекте, где отсутствует папка backlog/completed; добавлены 3 проверяемых AC (автосоздание папки перед перемещением, воспроизводящий тест, прохождение существующих тестов без регрессий). Labels: core, cli. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-26 08:58
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу: корневая причина — archiveTaskFile (src/core/store.ts:197) делает renameSync в backlog/completed/ без mkdirSync, все пути reject (CLI/web/бот) сходятся в rejectTaskFile → archiveTaskFile. Файлов к изменению: 3 — src/core/store.ts (import mkdirSync + recursive-mkdir перед renameSync на строках 196–197, JSDoc), src/core/reject.test.mjs (тест VL-190: rmSync completed/ → rejectTaskFile без ENOENT, падал бы до фикса), CHANGELOG.md (DoD-документация). Проверка: pnpm build && pnpm test:fast src/core/reject.test.mjs → pnpm test. Риски: низкие (mkdirSync recursive идемпотентен; фикс попутно закрывает тот же ENOENT у task complete); тест воспроизведения удаляет completed/ — восстанавливается самим архивом после фикса. References: нет (референс Backlog.md не требуется — правка в нашем core). Учтены уроки: lesson-39 (сверить реальные пути core перед тестами — rejectTaskFile/archiveTaskFile уже сверены с AC).
---
author: @agent
created: 2026-10-26 09:01
---
Фаза 3 (Code) выполнена. Изменено: src/core/store.ts (import mkdirSync; mkdirSync(completedDir, {recursive:true}) перед renameSync в archiveTaskFile + JSDoc), src/core/reject.test.mjs (тест VL-190: rmSync completed/ → rejectTaskFile без ENOENT, папка создаётся — падал бы до фикса), коммит 2788927. Проверки: pnpm build — OK; pnpm test:fast src/core/reject.test.mjs — 12/12 зелёных; pnpm test — полный набор прошёл (exit 0), регрессий нет. Отмечено AC: 1, 2, 3; DoD: 1, 3. Что осталось: DoD-2 «Документация обновлена» — CHANGELOG.md в Фазе 3 не трогал по правилам фазы (пишет Close после слияния) — отметить при Close. References: не использовались (правка только в нашем core). Lessons: не применялись и не создавались (единичный точечный фикс по готовому плану).
---
author: @agent
created: 2026-10-26 09:12
---
Фаза Close выполнена. Ветка vb/vl-190 слита в master (1 коммит 2788927 + merge), worktree удалена, ветка удалена. Проверки после merge: pnpm build — OK, pnpm test — полный набор зелёный, регрессий нет. DoD: 1 (Тесты проходят) ✓, 2 (Документация обновлена) ✓ — запись в CHANGELOG.md (Unreleased → Исправлено), docs-коммит b6baf6c; 3 (Нет регрессий) ✓. Lessons: создан lesson-45 («Перед renameSync в целевую папку всегда вызывай mkdirSync(recursive:true)…»), связан с задачей, закоммичен (bfe7b4e). References не использовались.
---
<!-- COMMENTS:END -->