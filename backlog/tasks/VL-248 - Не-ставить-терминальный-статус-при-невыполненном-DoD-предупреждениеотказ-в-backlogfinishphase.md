---
id: VL-248
title: Не ставить Done при невыполненном DoD в backlog_finish_phase
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-10-30 02:23'
due_date: ''
labels:
  - mcp
  - core
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
  input: 67055
  output: 1038
  cache: 56576
  total: 68093
  requests: 3
  duration_ms: 12493
  reasoning: 374
  by_phase:
    spec:
      input: 67055
      output: 1038
      cache: 56576
      requests: 3
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. VL-212 закрыта с отмеченным DoD «Тесты проходят» при красном полном прогоне (1539 passed / 24 failed в `src/agent/llm.test.mjs`), VL-219 — аналогично. `toolFinishPhase` принимает `dodChecks` без проверки, а `status: Done` без требования пройденных DoD. Добавить в сводку `backlog_finish_phase` явное предупреждение «терминальный статус при непройденных DoD: #…», а для перехода в Done — требование явного `dodOverride` с причиной, которая попадает в комментарий-отчёт.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `backlog_finish_phase {status: "Done"}` при непройденных DoD без `dodOverride` (с причиной) возвращает ошибку/предупреждение и НЕ меняет статус задачи
- [ ] #2 При переданном `dodOverride` с непустой причиной статус Done ставится, а причина попадает в комментарий-отчёт фазы
- [ ] #3 В сводке ответа `backlog_finish_phase` для любого терминального статуса при непройденных DoD выводится явное предупреждение с номерами невыполненных пунктов
- [ ] #4 Тест в `src/mcp/server.test.mjs` покрывает оба исхода: отказ без override и успех с override + записанная причина
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
created: 2026-10-30 02:23
---
Фаза 1 (Spec) выполнена. Заголовок: изменён незначительно — «Не ставить Done при невыполненном DoD в backlog_finish_phase» (сокращён до предела 80 символов, суть сохранена). Тип: bug. Масштаб: task (одна задача, правка toolFinishPhase + тест). Приоритет: Medium. Уточнено: критерии приёмки расширены до 4 проверяемых пунктов — отказ при Отсутствии override, успех с записанной причиной override, явное предупреждение в сводке для любого терминального статуса при непройденных DoD, тест на оба исхода в src/mcp/server.test.mjs. Факт проблемы (VL-212 закрыта с отмеченным DoD «Тесты проходят» при красном прогоне 1539/24 failed в src/agent/llm.test.mjs; VL-219 аналогично) сохранён как контекст. Labels: mcp, core. References: нет (внешних источников не упомянуто). Вопросов нет.
---
<!-- COMMENTS:END -->