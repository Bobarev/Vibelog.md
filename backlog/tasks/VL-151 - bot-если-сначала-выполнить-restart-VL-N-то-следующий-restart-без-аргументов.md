---
id: VL-151
title: restart без аргументов должен возвращать в main после restart VL-N
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 08:37'
updated_date: '2026-10-14 16:06'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/restart.ts
  - src/bot/handlers.ts
  - src/bot/restart.test.mjs
  - README.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot если сначала выполнить restart VL-N, то следующий restart без аргументов оставляет в этом worktree, а должен возвращать в main
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: /restart без аргументов должен возвращать в main после /restart VL-N

## Диагноз (корень бага)

1. `/restart VL-N` спавнит замещающий процесс из worktree CLI: `cliPath = worktreeCliPath(cwd, taskId)` (src/bot/handlers.ts:1014), при этом **cwd нового процесса остаётся главным репозиторием** (src/bot/restart.ts:69-73).
2. Новый процесс исполняет `<worktree>/dist/bot/restart.js`, поэтому его `import.meta.url` указывает на worktree.
3. Следующий `/restart` без аргументов не задаёт `cliPath` (handlers.ts:995 `let cliPath: string | undefined;`) → `spawnReplacementBot` использует дефолт `vibelogCliPath()` (restart.ts:25), который резолвится **от `import.meta.url` текущего процесса** → возвращает `<worktree>/bin/vibelog.mjs` вместо корневого `bin/vibelog.mjs`. Бот «застревает» в worktree.

Ключевое наблюдение: у процесса, запущенного через `/restart VL-N`, `deps.cwd` — главный репозиторий (spawn наследует cwd). Поэтому корневой CLI нужно резолвить **от `deps.cwd`**, а не от location текущего dist. Попутно это корректно и для ручного запуска `vibelog bot` из worktree: `deps.cwd` = worktree → рестарт остаётся в worktree (прежнее поведение сохраняется).

## Файлы для изменения

### 1. src/bot/restart.ts
- После `vibelogCliPath()` (строки 22-27) добавить экспортируемую функцию:
  ```ts
  /**
   * Путь корневого CLI от cwd процесса: join(cwd, 'bin', 'vibelog.mjs').
   * В отличие от vibelogCliPath (резолв от import.meta.url — при запуске
   * из worktree указывает на worktree CLI, VL-151) детерминирован:
   * у бота, перезапущенного через /restart VL-N, cwd остаётся главным
   * репозиторием — /restart без аргументов возвращает в main dist.
   */
  export function rootCliPath(cwd: string): string {
    return join(cwd, 'bin', 'vibelog.mjs');
  }
  ```
  + импорт `join` из `node:path`.
- В JSDoc `vibelogCliPath()` добавить предупреждение: при запущенном из worktree процессе путь указывает на worktree CLI — для возврата в main использовать `rootCliPath(cwd)`.

### 2. src/bot/handlers.ts
- Строка 45: расширить импорт — `import { rootCliPath, spawnReplacementBot } from './restart.js';`
- Строка 995: `let cliPath: string | undefined;` → `let cliPath = rootCliPath(deps.cwd);` (дефолт — корневой CLI; ветка `if (parsed.taskId)` на строке 997 перезаписывает worktreeCliPath, как раньше). Сопутствующий комментарий: почему дефолт — rootCliPath, а не vibelogCliPath (баг VL-151).

### 3. src/bot/restart.test.mjs
Добавить блок тестов (после describe `vibelogCliPath`, ~строка 24):
- `rootCliPath(cwd)` возвращает `join(cwd, 'bin', 'vibelog.mjs')` для tmp-каталога — путь НЕ зависит от `import.meta.url` текущего процесса (в отличие от `vibelogCliPath()`); сравнить с vibelogCliPath() текущего процесса — это разные пути, если процесс не в корне.
- Смоук: `rootCliPath(projectRoot)` указывает на существующий bin/vibelog.mjs (existsSync, путь вычислить от корня проекта в тесте).

### 4. README.md (строки 271-278, блок «/restart» в разделе worktree-режима)
- Уточнить комментарий к `/restart`: «перезапуск из корневого dist/ (прежнее поведение); **в том числе после `/restart VL-N` — возврат из worktree в main**».
- В описании «Как работает» (строка ~278) дополнить: путь CLI для пустого `/restart` вычисляется от cwd процесса (`rootCliPath`), а не от location текущего dist — после `/restart VL-N` бот гарантированно возвращается в корневой dist.

### 5. backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md (§ «Самоперезапуск /restart», строки 435-439)
- Добавить одно предложение: повторный `/restart` без аргументов после `/restart VL-N` возвращает бота в корневой dist (главная ветка), не оставляя в worktree.
- Править через MCP `document_update` (файл в backlog/, в worktree не коммитится).

## Порядок действий

1. restart.ts: `rootCliPath` + JSDoc-предупреждение к `vibelogCliPath`.
2. handlers.ts: импорт + замена строки 995.
3. restart.test.mjs: тесты rootCliPath.
4. `pnpm build` — компиляция strict, экспорт из dist.
5. `pnpm test:fast` — юнит-тесты (dist уже собран).
6. Правки README.md; document_update doc-6 через MCP.
7. Ручная сценарная проверка (опционально, если доступен запущенный бот): `/restart VL-151` → `/restart` → в консоли «Код привязки» печатается процессом из корневого dist (проверить путь процесса `ps`).

## Как проверить

```bash
pnpm build          # tsc strict без ошибок
pnpm test:fast      # vitest run: restart.test.mjs — новые тесты rootCliPath зелёные,
                    # существующие тесты vibelogCliPath/spawnReplacementBot не упали
```

## Риски

- **Смена поведения ручного запуска из worktree**: раньше пустой `/restart` при cwd=worktree перезапускал бота из worktree CLI (import.meta.url совпадал с cwd-деревом). С `rootCliPath(deps.cwd)` поведение сохраняется — cwd и есть worktree. Деградации нет.
- **Дефолт `cliPath` в `spawnReplacementBot`** (`vibelogCliPath()`) остаётся неточным для worktree-процесса — его продолжают использовать только тесты (передают `undefined`). Хендлер теперь всегда передаёт путь явно. Альтернатива (удалить дефолт) отклонена: сломает VL-70/143-тесты без выигрыша.
- **doc-6 лежит в backlog/** — правится только через MCP, worktree-копию не трогать (правила параллельной разработки).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 08:38
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «restart без аргументов должен возвращать в main после restart VL-N» (исходный был обрезан). Масштаб: task. Уточнено: тип задачи (task) и критерии приёмки: после `restart VL-N` команда `restart` без аргументов возвращает в main, а не остаётся в worktree; регрессий в остальных сценариях restart нет. Вопросов нет.
---
author: @agent
created: 2026-10-14 15:09
---
Фаза 2 (Plan) выполнена. Тип: task. Диагноз: пустой /restart резолвит CLI-путь через vibelogCliPath() от import.meta.url текущего процесса; после /restart VL-N процесс живёт в worktree-dist, поэтому рестарт «застревает» в worktree вместо main. План записан: 5 файлов — src/bot/restart.ts (новая rootCliPath(cwd) + предупреждение в JSDoc vibelogCliPath), src/bot/handlers.ts:995 (дефолт cliPath = rootCliPath(deps.cwd) вместо undefined), src/bot/restart.test.mjs (тесты rootCliPath), README.md (уточнение поведения /restart) и doc-6 через document_update. Проверка: pnpm build + pnpm test:fast. Риски: ручной запуск из worktree сохраняет прежнее поведение (cwd = worktree); дефолт cliPath в spawnReplacementBot остаётся для тестов — хендлер теперь всегда передаёт путь явно.
---
author: @agent
created: 2026-10-14 15:18
---
Фаза 3 (Code) выполнена. Суть фикса: пустой /restart резолвил CLI через vibelogCliPath() от import.meta.url текущего процесса — после /restart VL-N процесс живёт в worktree-dist, и рестарт «застревал» в worktree. Введён rootCliPath(cwd) = join(cwd, 'bin', 'vibelog.mjs'): хендлер restart теперь всегда передаёт явный путь (дефолт — корневой CLI от deps.cwd, у перезапущенного через /restart VL-N бота cwd остаётся главным репозиторием). Изменено: src/bot/restart.ts (rootCliPath + предупреждение в JSDoc vibelogCliPath), src/bot/handlers.ts (дефолт cliPath = rootCliPath(deps.cwd)), src/bot/restart.test.mjs (2 новых теста: независимость от import.meta.url + смоук existsSync), README.md (уточнение поведения /restart). Коммит df8f646 в vb/vl-151. Проверки: pnpm build (strict, без ошибок) + pnpm test:fast — 59 файлов, 1033 passed / 4 skipped, регрессий нет (DoD-1, DoD-3). Что осталось: doc-6 (руководство пользователя) сознательно НЕ обновлял — документы backlog/docs по правилам VL-126 пишет Фаза Close после слияния; DoD-2 оставлен незакрытым для Close. Ручной сценарный прогон с реальным Telegram не выполнялся (нет запущенного бота в сессии) — покрыто юнит-тестами.
---
author: @agent
created: 2026-10-14 16:06
---
Фаза Close выполнена. Ветка vb/vl-151 слита в master (1 коммит df8f646, merge --no-ff), worktree удалена, ветка удалена. После слияния в master прогнаны pnpm build + pnpm test — сборка strict без ошибок, все тесты зелёные, регрессий нет. Документация Фазы Close: CHANGELOG.md (запись в Unreleased → Исправлено: VL-151, фикс пустого /restart через rootCliPath от cwd) + doc-6 (раздел «Самоперезапуск /restart»: повторный /restart без аргументов после /restart VL-N возвращает бота в корневой dist, не оставляя в worktree). Докс-коммит: b4fe1ce. DoD честно: 1 (тесты проходят) и 3 (нет регрессий) — подтверждены прогоном после merge; 2 (документация обновлена) — отмечается в этом же закрытии (CHANGELOG + doc-6).
---
<!-- COMMENTS:END -->