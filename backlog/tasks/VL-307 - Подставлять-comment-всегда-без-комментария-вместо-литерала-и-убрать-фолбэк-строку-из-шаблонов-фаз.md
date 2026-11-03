---
id: VL-307
title: 'Подставлять {{comment}} всегда («без комментария» вместо литерала) и убрать фолбэк-строку из шаблонов фаз'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 20:50'
updated_date: '2026-11-03 22:31'
due_date: ''
labels:
  - agent
  - prompt
  - bug
dependencies: []
milestone: v1.12
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/orchestrator.ts
  - src/agent/cli.ts
  - src/web/orchestrator.test.mjs
  - src/web/trigger-api.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-spec.md
  - templates/phases/phase-plan.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-investigate.md
  - templates/phases/phase-materialize.md
  - templates/phases/phase-comment.md
  - templates/phases/phase-reject.md
lessons: []
token_usage:
  input: 3413044
  output: 19429
  cache: 3329536
  total: 3432473
  requests: 67
  duration_ms: 866883
  reasoning: 10922
  by_phase:
    code:
      input: 2856041
      output: 17683
      cache: 2796544
      requests: 51
    close:
      input: 557003
      output: 1746
      cache: 532992
      requests: 16
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптом: при запуске фазы с комментарием текст комментария попадает в промпт ДВАЖДЫ — в блоке «Дополнительный комментарий пользователя к запуску фазы: {{comment}}» и внутри фолбэк-строки «Если вместо комментария остался неподставленный {{comment}} (запуск без комментария) — просто продолжай».

Причина: src/web/orchestrator.ts:494-499 (startTaskPhase) передаёт extraVars {comment} только при непустом комментарии; renderPrompt (src/web/phase-prompt.ts:145) делает replaceAll('{{comment}}', text) — подставляя во ВСЕ вхождения, включая фолбэк-строку. При наличии комментария получается «Если вместо комментария остался неподставленный Сделай ещё вот это (запуск без комментария) — просто продолжай».

Фолбэк-строка есть в 7 шаблонах: phase-spec.md, phase-plan.md, phase-code.md, phase-do.md, phase-investigate.md, phase-materialize.md (дословно) и в phase-comment.md / phase-reject.md (в форме «если {{comment}} не подставлено — …»).

Решение (вариант B, согласован): подставлять {{comment}} ВСЕГДА, при отсутствии комментария — строкой «без комментария». Тогда литерала {{comment}} в промпте не бывает никогда, фолбэк-строка не нужна и удаляется.

Нюанс: phase-comment.md использует {{comment}} как САМ запрос («Выполни запрос пользователя из комментария: {{comment}}»), а фолбэк говорит «если не подставлено — выполни запрос из строки «Последний комментарий»». При подстановке «без комментария» модель попытается выполнить запрос «без комментария» — поэтому в comment/reject фолбэк переписывается на сравнение с этой строкой, а не на проверку литерала.

Файлы:
1. src/web/orchestrator.ts — в вызове renderPrompt (стр. ~296-310) добавить comment: extraVars?.comment ?? 'без комментария' (после ...extraVars, чтобы явный комментарий имел приоритет).
2. templates/phases/{phase-spec,phase-plan,phase-code,phase-do,phase-investigate,phase-materialize}.md — удалить фолбэк-строку.
3. templates/phases/phase-comment.md, phase-reject.md — фолбэк на сравнение с «без комментария».
4. src/web/orchestrator.test.mjs:225-248 — существующие кейсы renderPrompt остаются (проверяют прямой вызов без extraVars); добавить кейсы на startPhase.

Связанные: VL-80 (введение {{comment}} и фолбэка), VL-157 (фолбэк добавлен в spec), VL-195 (investigate/materialize), VL-306 (единый контракт write-инструментов).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 startPhase подставляет {{comment}} ВСЕГДА: при отсутствии комментария — строкой «без комментария» (не пустой строкой и не литералом {{comment}})
- [x] #2 Фолбэк-строка «Если вместо комментария остался неподставленный {{comment}}…» удалена из phase-spec/plan/code/do/investigate/materialize
- [x] #3 phase-comment.md и phase-reject.md: фолбэк переписан на сравнение с «без комментария» (модель не пытается выполнить запрос «без комментария»)
- [x] #4 Регресс-тест: startPhase без комментария → в промпте нет литерала {{comment}} и нет дублирования текста комментария; startPhase с комментарием → текст встречается ровно один раз
- [x] #5 Тесты проходят (pnpm test), документация обновлена (README/doc-10 — контракт {{comment}}; CHANGELOG)
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
created: 2026-11-02 22:28
---
Фаза 3 (Code) выполнена. Коммит faadabf (+ merge master b49a6ef).
Изменено:
- src/web/orchestrator.ts — в renderPrompt (startPhase) добавлена подстановка `comment: extraVars?.comment || 'без комментария'` после `...extraVars` (явный комментарий приоритетнее, пустая строка трактуется как отсутствие). Обновлены комментарии-контракты в JSDoc startTaskPhase и в trim-ветке.
- src/agent/cli.ts — тот же контракт для CLI-режима фаз: `comment: opts.comment || 'без комментария'` (иначе CLI оставлял литерал).
- templates/phases/{phase-spec,phase-plan,phase-code,phase-do,phase-investigate,phase-materialize}.md — удалена фолбэк-строка «Если вместо комментария остался неподставленный {{comment}} …».
- templates/phases/phase-comment.md — фолбэк переписан на сравнение с «без комментария» (модель не выполняет запрос «без комментария», а берёт «Последний комментарий»).
- templates/phases/phase-reject.md — то же: причина не выдумывается, если подставлена строка «без комментария».
- src/web/orchestrator.test.mjs — кейс «без комментария» переписан на новый контракт (нет литерала, есть «без комментария») + новый регресс-тест на отсутствие дублирования текста комментария в промпте startTaskPhase.
- src/web/trigger-api.test.mjs — кейс «trigger без comment» переведён на новый контракт.
- src/web/phase-prompt.test.mjs — два новых инвариант-теста: фолбэк-строка удалена из 6 шаблонов; comment/reject используют сравнение с «без комментария», а не проверку литерала.
Проверки: `pnpm build` + полный `pnpm test` — 2737 passed, 4 skipped, 0 failed (147 файлов). Промежуточно в ветке падал только README-инвариант (HTML-H1 под логотипом) — это уже исправлено в master коммитом 6bf8a29; ветка смержена с master, после merge полный прогон зелёный.
Что осталось: AC5 в части документации (doc-10 — контракт {{comment}}, CHANGELOG) — по правилам фазы Code документацию пишет фаза Close после слияния; поэтому AC5 и DoD «Документация обновлена» не отмечены.
---
author: @agent
created: 2026-11-02 22:32
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 4 из 5
DoD отмечено: 2 из 3
AC не отмечены (1): 5. Тесты проходят (pnpm test), документация обновлена (README/doc-10 — контракт {{comment}}; CHANGELOG)
DoD не отмечены (1): 2. Документация обновлена
Файлы (13): src/web/orchestrator.ts, src/agent/cli.ts, src/web/orchestrator.test.mjs, src/web/trigger-api.test.mjs, src/web/phase-prompt.test.mjs, templates/phases/phase-spec.md, templates/phases/phase-plan.md, templates/phases/phase-code.md, templates/phases/phase-do.md, templates/phases/phase-investigate.md, …
Фрагмент плана/резюме: план и резюме отсутствуют.
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
---
author: @agent
created: 2026-11-02 23:40
---
Документация VL-307 фактически написана в фазе Close VL-309 (коммит `4f603ee`): CHANGELOG.md — запись VL-307 в разделе Unreleased; doc-10 (`backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`) — §3 (строка о контракте подстановки `{{comment}}`), §4 — новый подраздел «Контракт `{{comment}}` (VL-307)» (подставляется всегда, «без комментария» при отсутствии, литерала в промпте не бывает, фолбэк-строки удалены из 6 шаблонов, comment/reject сравнивают со строкой «без комментария», тот же контракт в CLI `src/agent/cli.ts`). После фактической записи отмечены AC5 и DoD «Документация обновлена» (lesson-140/VL-248 — отмечать до записи было бы ложным заявлением).
---
<!-- COMMENTS:END -->