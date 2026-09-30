---
id: VL-16
title: 'VL-16: DoD-дефолты при create + --no-dod-defaults'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:31'
updated_date: '2026-10-01 01:40'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
DoD-дефолты при создании задачи + --no-dod-defaults (P2 из ресёрча, cli.ts:1966).

Сейчас: createTask (src/core/task.mjs:74) — definitionOfDone: input || [] — дефолты НЕ добавляются (расхождение с оригиналом).

Реализация:
1. src/core/store.mjs — createTaskFile: если input.definitionOfDone пуст И input.noDodDefaults !== true → map config.definition_of_done → [{text, checked:false}].
2. src/cli/commands/task.mjs — taskCreate: флаг --no-dod-defaults → input.noDodDefaults = true.
3. src/cli/router.mjs: help create — [--no-dod-defaults].
4. Тесты: дефолты добавлены; --no-dod-defaults — пусто; --dod приоритетен; MCP create с дефолтами.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 task create без --dod наполняет definitionOfDone дефолтами из config.definition_of_done (unchecked); --no-dod-defaults отключает; переданный --dod имеет приоритет над дефолтами
- [x] #2 MCP backlog_create_task применяет те же дефолты (совместимость с форматом файлов оригинала)
- [x] #3 Тесты CLI+MCP проходят; pnpm test зелёный
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: DoD-дефолты + --no-dod-defaults (VL-16)

1. **src/core/store.mjs — createTaskFile** (после loadConfig): если input.definitionOfDone пуст И input.noDodDefaults !== true → config.definition_of_done.map(text => ({text, checked: false})). Затрагивает create и promote (VL-13) — ок (оригинал также наполняет дефолтами).
2. **src/cli/commands/task.mjs — taskCreate**: флаг --no-dod-defaults → input.noDodDefaults = true.
3. **src/cli/router.mjs — help create**: [--no-dod-defaults].
4. **Тесты** — новый src/cli/create-flags.test.mjs (общий на VL-16..18, /tmp + spawnSync): дефолты добавлены (view --json содержит 3 критерия unchecked); --no-dod-defaults — пусто; --dod приоритетен; MCP create через handleToolCall — дефолты есть.

Риски: тесты с init-конфигом (definition_of_done непустой) получат критерии в promoted-задачах — проверить draft-cli.test (ожидания по id/title не меняются). store.test.mjs — проверить, не используют ли точные ожидания DoD.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 01:40
---
Фаза 3 завершена. 3/3 AC.
- src/core/store.mjs: createTaskFile наполняет definitionOfDone дефолтами из config.definition_of_done (unchecked), если критерии не переданы и не выставлен noDodDefaults (затрагивает create и promote — как в оригинале).
- src/cli/commands/task.mjs: флаг --no-dod-defaults.
- src/cli/router.mjs: help create [--no-dod-defaults].
- Тесты: src/cli/create-flags.test.mjs (общий на VL-16..18).
Проверки: pnpm test 306/306 ✓; ручной прогон ✓ (3 unchecked дефолта; --no-dod-defaults → []; --dod приоритетен).
Реализовано в общем патче с VL-17/VL-18 (одна сессия Фазы 3 по подтверждению пользователя на все 3 задачи).
---
<!-- COMMENTS:END -->