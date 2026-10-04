---
id: VL-56
title: 'Фаза Close: шаблон phase-close.md + расширение оркестратора (PHASES, PHASE_FILES, тесты)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 01:16'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
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
Новая фаза Close в headless-оркестраторе qwen.

Контекст: бот /spec /plan /code запускают qwen через startPhase с шаблоном phase-1/2/3.md (VL-42/51/53). /close — четвёртая фаза: закрыть задачу и закоммитить связанные файлы.

Что сделать:
1. templates/qwen-commands/phase-close.md (по образцу phase-3.md, но с ключевым отличием: git-операции ЗДЕСЬ разрешены и обязательны — в phase-3 они запрещены):
   - backlog_view_task {"id": "{{taskId}}"}
   - Отметить AC (если не отмечены) и сменить статус через MCP (backlog_manage_ac / backlog_update_status → Done)
   - git add файл задачи (backlog/tasks/...) + файлы из поля modified_files; git commit по конвенции проекта (русский коммит-месседж, ссылка на ID задачи)
   - Отчёт комментарием (backlog_add_comment): что закрыто, какие файлы закоммичены (хэши)
   - Правила: не выйди за пределы проекта, только Node.js, не force-push, не трогай чужие ветки
2. src/web/orchestrator.ts: PHASES += 'close' (тип Phase расширяется), PHASE_FILES.close = 'phase-close.md'. Ошибочные сообщения renderPrompt ('ожидается spec|plan|code') обновить.
3. Тесты: renderPrompt('close', ...) отдаёт шаблон с ID; web API trigger с phase 'close' валиден.

Не трогать бот — команда /close в боте реализуется отдельной задачей (VL-56).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Существует templates/qwen-commands/phase-close.md с плейсхолдером {{taskId}}: инструктирует qwen прочитать задачу, проверить/отметить AC, сменить статус на Done, выполнить git add/commit файлов задачи и файлов из modified_files (сообщение коммита по конвенции проекта, на русском), затем оставить отчёт комментарием через backlog_add_comment
- [x] #2 src/web/orchestrator.ts: PHASES дополнен 'close', PHASE_FILES — close: 'phase-close.md'; renderPrompt('close', 'VL-1') возвращает текст шаблона с подставленным ID, для неизвестной фазы — прежняя ошибка
- [x] #3 pnpm build и pnpm test проходят, юнит-тесты на renderPrompt фазы close добавлены (src/web/orchestrator.test.mjs)
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
created: 2026-10-03 01:38
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-close.md (новый — шаблон Фазы Close: чтение задачи, сверка AC/DoD с отметкой только реально выполненных пунктов, статус завершения берётся из конфига проекта вместо хардкода Done (риск 4 плана), git add/commit файлов задачи + modified_files явными путями (не git add -A) без push, отчёт комментарием), src/web/orchestrator.ts (PHASES += 'close', PHASE_FILES.close = 'phase-close.md', JSDoc и текст ошибки renderPrompt обновлены на spec|plan|code|close), scripts/npm-smoke.mjs ('phase-close' добавлен в проверку шаблонов пакета), src/web/orchestrator.test.mjs (+ тест renderPrompt фазы close: подстановка {{taskId}}, отсутствие плейсхолдера, текст «Фаза Close»). Проверки: pnpm build OK, pnpm test — 384/384, статическая проверка renderPrompt('close', 'VL-99') — шаблон с подставленным ID, ошибка для 'deploy' — «ожидается spec|plan|code|close». Что осталось: git commit (по правилам Фазы 3 не выполняется).
---
<!-- COMMENTS:END -->