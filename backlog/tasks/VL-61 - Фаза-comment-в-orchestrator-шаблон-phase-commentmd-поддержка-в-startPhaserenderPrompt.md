---
id: VL-61
title: 'Фаза comment в orchestrator: шаблон phase-comment.md + поддержка в startPhase/renderPrompt'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-03 03:42'
updated_date: '2026-10-03 03:42'
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
Расширить оркестратор фаз новой фазой 'comment' для выполнения произвольного запроса из комментария задачи.

Контекст: в Telegram-боте команда /comment VL-N <текст> сейчас только добавляет комментарий (VL-35). По VL-60 после добавления комментария должна запускаться headless-фаза qwen — по аналогии с /spec /plan /code /close (шаблоны templates/qwen-commands/phase-1.md…phase-close.md, startPhase в src/web/orchestrator.ts).

Что сделать:
1. src/web/orchestrator.ts: PHASES += 'comment', PHASE_FILES.comment = 'phase-comment.md'. Учесть, что renderPrompt сейчас заменяет только {{taskId}} — для однозначности промпта нужен текст комментария (расширить renderPrompt вторым параметром {{comment}} или отдельная функция renderCommentPrompt).
2. Создать templates/qwen-commands/phase-comment.md (по образцу phase-3.md, 28-40 строк, русский):
   - пролог: «Ты — автоматический исполнитель Vibelog (Фаза: выполнение комментария) для задачи {{taskId}}», работа через Vibelog MCP, без интерактива;
   - шаг 1: backlog_view_task {"id": "{{taskId}}"} — прочитать задачу и комментарий;
   - шаг 2: выполнить запрос из комментария в контексте этой задачи (правки файлов, тесты и т.п. — по содержимому);
   - шаг 3: оставить отчёт комментарием (backlog_add_comment, author @agent);
   - статус задачи НЕ менять — фаза не относится к жизненному циклу spec/plan/code/close;
   - правила: границы проекта, только Node.js, без git commit/push;
   - финал: «Готово» одним словом (как в остальных phase-шаблонах).
3. Тесты: renderPrompt('comment', ...) подставляет taskId и комментарий; неизвестная фаза по-прежнему падает.

Интеграция с ботом — отдельная задача VL-62.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В src/web/orchestrator.ts фаза 'comment' добавлена в PHASES и PHASE_FILES (шаблон phase-comment.md); renderPrompt('comment', 'VL-N') отдаёт промпт, в котором taskId подставлен и qwen однозначно понимает, какой комментарий выполнять (текст комментария передаётся в промпт явно или по последнему комментарию задачи)
- [ ] #2 templates/qwen-commands/phase-comment.md создан: qwen читает задачу через backlog_view_task, выполняет содержимое комментария для этой задачи, оставляет отчёт комментарием (backlog_add_comment), статус задачи НЕ меняет (это не жизненный цикл spec/plan/code/close)
- [ ] #3 pnpm test проходит: есть тесты renderPrompt для фазы comment; существующие фазы spec/plan/code/close не сломаны
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->