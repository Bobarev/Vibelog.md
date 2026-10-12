---
id: VL-109
title: 'Промпты фаз и system-prompt vb: экономия ходов и переориентация при resume'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 09:50'
updated_date: '2026-10-12 12:27'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/agent-prompt.md
  - templates/qwen-commands/phase-1.md
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-comment.md
  - templates/qwen-commands/prompt.md
  - src/agent/system-prompt.ts
  - src/agent/system-prompt.test.mjs
  - src/web/phase-prompt.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Промпты не запрещают расточительное исследование — корневая причина инцидента VL-98 (анализ: backlog/docs/doc-12): 25 минут / ~70 tool-вызовов без единой правки файла. Агент перечитывал файлы, которые план уже описывал с номерами строк, читал задачи-инциденты (VL-97, 19 KB) по упоминанию в шаге 5 phase-3, искал переименованный docs/user-guide.md, пять раз повторял «Приступаю к реализации» вместо патча.

Реализовать P1–P3 из doc-12 (раздел 6.1).

P1. templates/qwen-commands/phase-*.md — блок «Экономия ходов»:
- если Implementation Plan содержит файлы/строки/готовый код — применять напрямую, не перечитывая файлы, которые план уже описывает;
- упоминания инцидентов в шагах — контекст, а не задание: задачи-инциденты не читать;
- файл из плана не найден — не более 2 ходов на поиск (grep по заголовку/разделу), затем продолжить с найденного;
- первая правка целевого файла — в первых 5–8 вызовах инструментов.

P2. src/agent/system-prompt.ts (базовая часть системного промпта vb):
- проверка якоря перед патчем — одна команда grep, после — сразу патч; не перепроверять якоря повторно;
- при сообщении «Продолжи» после прерывания фазы — не повторять исследование: git status и git diff рабочего каталога показывают, что уже сделано, продолжать со следующего шага;
- предупреждение про BSD sed на macOS: GNU-диапазоны вида N,+Mp не работают, использовать node -e или grep -A/-B.

P3. templates/qwen-commands/phase-2.md: перед записью плана проверять существование каждого файла одной командой ls — устаревшие пути (как docs/user-guide.md из VL-98) не должны уходить в план.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 templates/qwen-commands/phase-*.md (spec/plan/code/close/comment/prompt) содержат блок «Экономия ходов» с 4 правилами P1
- [x] #2 system-prompt vb (src/agent/system-prompt.ts) содержит правила P2: одна grep-проверка якоря перед патчем; git status/diff при «Продолжи» вместо повторного исследования; предупреждение про BSD sed на macOS
- [x] #3 templates/qwen-commands/phase-2.md содержит правило P3 (ls-проверка существования файлов перед записью плана)
- [x] #4 pnpm test зелёный; renderPrompt работает без изменений (шаблоны валидны)
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
created: 2026-10-12 10:18
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code, без headless-фазы; feat a0a3c57).

Изменено:
- templates/agent-prompt.md (новый) — базовая часть системного промпта vb вынесена из хардкода src/agent/system-prompt.ts (по запросу Pavel) + 3 правила P2: одна grep-проверка якоря перед патчем; «Продолжи» после прерывания → git status/git diff вместо повторного исследования; предупреждение про BSD sed на macOS.
- src/agent/system-prompt.ts — чтение базовой части из md (trimEnd), throw при отсутствии шаблона (паттерн renderPrompt); AGENTS.md-поведение не изменилось.
- templates/qwen-commands/phase-1/2/3/close/comment.md + prompt.md — раздел «Экономия ходов» (P1): верь Implementation Plan (файлы из плана не перечитывать), упоминания инцидентов — контекст, ≤2 хода на поиск недостающего файла, первая правка в первых 5–8 вызовах инструментов; в phase-2 дополнительно ls-проверка файлов плана (P3).
- CHANGELOG.md — запись Unreleased (VL-109).
- Тесты: src/web/phase-prompt.test.mjs (новый, 9 тестов: раздел во всех шести шаблонах, ls-правило phase-2, верь-плану phase-3, renderPrompt), src/agent/system-prompt.test.mjs (+1 тест: базовая часть из md с новыми правилами).

Проверки: pnpm build (tsc strict) OK; pnpm test — 794/794.

Оговорка по AC#2: правила P2 физически живут в templates/agent-prompt.md (в состав системного промпта vb входят — system-prompt.ts вставляет их как базовую часть), т.к. попутно по запросу Pavel хардкод промпта вынесен в md.

Что осталось: влияние правил проверить на следующей реальной Фазе 3 vb (live-эффект); легаси-шаблоны skills (templates/qwen-commands/spec.md/plan.md/code.md для /vibelog:*) не менялись — вне AC.
---
author: @agent
created: 2026-10-12 12:27
---
Фаза Close выполнена вручную (исполнитель — Qwen Code). Код: feat a0a3c57 (промпты VL-109: «Экономия ходов» в шести шаблонах фаз, базовый промпт vb в templates/agent-prompt.md + 3 правила) и fix cceb310 (убраны упоминания задач-инцидентов из шаблонов — были приманкой для агента, правки Pavel). Проверки: pnpm test 794/794, шаблонные тесты 9/9 после fix. DoD 3/3. Статус Done. Пуш по решению Pavel.
---
<!-- COMMENTS:END -->