---
id: VL-67
title: 'Оркестратор: startPrompt — запуск произвольного промпта через qwen без задачи'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-03 15:21'
updated_date: '2026-10-03 15:21'
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
Нужен способ выполнить произвольный запрос пользователя через headless qwen, не создавая задачу (запросы вроде «сделай коммиты для всех незакоммиченных файлов», «внеси что-то в настройки qwen на уровне проекта» — слишком мелкие для задачи).

Существующий startPhase (src/web/orchestrator.ts) завязан на taskId: activeRuns/lastRuns — Map по taskId, renderPrompt подставляет {{taskId}}, шаблоны фаз читают задачу через MCP. Для промпта нужен отдельный вход: функция вида startPrompt(cwd, promptText, onExit) — спавн qwen (bin из VIBELOG_QWEN_BIN, --approval-mode yolo --output-format json), шаблон templates/qwen-commands/prompt.md с {{prompt}}, guard по ключу запуска (например 'prompt'), logTail + parseQwenResult в PhaseRun (VL-63/VL-64 — парсинг NDJSON и [{…}]).

Замечания:
- Git-операции для этого запроса РАЗРЕШЕНЫ (в отличие от фазы Comment) — пользователь сам просит закоммитить.
- Шаблон prompt.md: выполни запрос пользователя {{prompt}}, работай в текущей директории проекта, не трогай backlog/ и статусы задач, только Node.js, не выходи за пределы проекта, финал — ответь «Готово».
- Уведомлять бота о завершении бот получит из своей команды (задача VL-68) — здесь только колбэк PhaseRun.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Оркестратор умеет запускать headless-сессию qwen по произвольному тексту промпта, не привязанному к задаче (без чтения/записи файлов backlog/)
- [ ] #2 Есть шаблон templates/qwen-commands/prompt.md с подстановкой {{prompt}}; при отсутствии шаблона — понятная русская ошибка, процесс не запускается
- [ ] #3 Guard от двойного запуска: повторный вызов при активном запуске возвращает ошибку, а не второй процесс qwen
- [ ] #4 По завершении вызывается колбэк onExit с PhaseRun: exitCode и разобранный result из JSON-вывода qwen (parseQwenResult), как у фаз задач
- [ ] #5 Юнит-тесты проходят (pnpm test = build + node --test src)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->