---
id: VL-247
title: 'Close-фазы: явный сигнал провала в аварийных ветках промптов'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-10-30 02:22'
due_date: ''
labels:
  - prompt
  - agent
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
token_usage:
  input: 113455
  output: 2214
  cache: 101632
  total: 115669
  requests: 5
  duration_ms: 20275
  reasoning: 1292
  by_phase:
    spec:
      input: 113455
      output: 2214
      cache: 101632
      requests: 5
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. `templates/phases/phase-close-worktree.md` (шаг 4: «отчёт (шаг 9) сделай сразу, БЕЗ status») и `templates/phases/phase-close.md` (шаг 5) полагаются на то, что отсутствие `status` = фаза провалена; но фреймворк определяет успех по exit code. Переписать аварийные ветки: вызов `backlog_finish_phase {id, comment, aborted: true}` (после реализации задачи №1 из VL-231), явное «не завершай цикл как успех», запрет продолжать прерванную фазу по пользовательскому сообщению без нового рана (кейс VL-212: «Заверши фазу.» внутри уже прерванной close).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все аварийные ветки шаблонов `templates/phases/phase-close-worktree.md` (шаг 4) и `templates/phases/phase-close.md` (шаг 5) используют единый явный сигнал провала `backlog_finish_phase {id, comment, aborted: true}` (механизм из задачи №1 VL-231); формулировки согласованы между шаблонами и явно содержат «не завершай цикл как успех»
- [ ] #2 В аварийных ветках зафиксирован запрет продолжать прерванную close-фазу по пользовательскому сообщению без нового рана (кейс VL-212: «Заверши фазу.» внутри уже прерванной close)
- [ ] #3 `src/web/phase-prompt.test.mjs` фиксирует наличие сигнала провала (`aborted: true`) в обоих шаблонах — тест падает при его удалении
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:22
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Close-фазы: явный сигнал провала в аварийных ветках промптов» (было длиннее 80 символов, суть сохранена). Тип: bug (подтверждён — шаблоны промптов дают ложный успех). Масштаб: task. Приоритет: Medium (описание полное, срочность неочевидна; но false-Done в close-фазах — заметный дефект поведения). Уточнено: AC переформулированы в проверяемые — (1) единый механизм `backlog_finish_phase {id, comment, aborted: true}` из задачи №1 VL-231 в обеих аварийных ветках, согласованный текст и явное «не завершай цикл как успех»; (2) запрет продолжать прерванную close-фазу по сообщению пользователя без нового рана (кейс VL-212); (3) тест `src/web/phase-prompt.test.mjs` фиксирует наличие сигнала в обоих шаблонах. Зависимость от задачи №1 из VL-231 (реализация `aborted`) учтена в формулировке AC — при планировании нужно указать её как зависимость. Labels: prompt, agent. References: нет (внешних источников не упомянуто). Вопросов нет.
---
<!-- COMMENTS:END -->