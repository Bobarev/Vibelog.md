---
id: VL-195
title: 'investigation: расследование инцидентов — тип investigation и workflow'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 20:01'
updated_date: '2026-10-26 22:35'
due_date: ''
labels:
  - agent
  - prompt
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/phase-prompt.ts
  - src/web/orchestrator.ts
  - src/web/api.ts
  - src/agent/cli.ts
  - src/core/phase-styles.ts
  - src/core/phase-buttons.ts
  - src/bot/rich.ts
  - src/bot/handlers.ts
  - web/src/types/kanban.ts
  - web/src/components/task-modal/task-modal.tsx
  - templates/phases/phase-investigate.md
  - templates/phases/phase-materialize.md
  - src/core/workflow.test.mjs
  - src/core/phase-styles.test.mjs
  - src/bot/rich.test.mjs
  - src/web/phase-prompt.test.mjs
  - web/dist/index.html
  - web/dist/assets/index-zEFpRejZ.js
lessons:
  - lesson-52
  - lesson-53
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
investigation: расследование инцидентов — тип investigation и workflow

При запуске двух задач в авто-режиме: первая отработала успешно, вторая — многочисленные проблемы. Нужен тип задачи investigation для расследования инцидентов и предложения задач по устранению.

## Workflow (без новых статусов)

To Do → investigate → In Progress → Review → materialize → Done.
Ветвление: Review → reject → Done.

Две фазы агента:
- investigate: сбор данных (сессии, логи, код), анализ, документ с выводами И предложениями задач. Статус: In Progress.
- materialize: создание задач из согласованных предложений. Статус: Done.

Имя фазы — materialize (без дефиса), потому что дефис в именах фаз используется для вариантов (close, close-worktree — одна фаза, разные варианты).

## Что нужно

1. Тип investigation в backlog/config.yml (types).
2. Workflow investigation в .vibelog/settings.json:
3. Шаблоны: phase-investigate.md, phase-materialize.md.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-195 — Plan (ред.2, после ревью): investigation-тип, workflow, фазы

## Ревью → решения

**R1. In Progress и default (workflow.ts:77–98):** ни одна фаза default не производит In Progress (transition с `produces_status:'In Progress'` НЕТ) — только переходы ИЗ неё (code→Review, reject→Rejected); drag в In Progress запрещён (canMoveTo), лишь escape-hatch /status. Наш To Do→[investigate]→In Progress нарушал это правило — ошибка плана.

**R2. Workflow investigation — БЕЗ In Progress**, в `.vibelog/settings.json` главного репо:
```json
"workflows": { "investigation": { "initial_status": "To Do", "transitions": [
  { "status": "To Do", "phase": "investigate", "produces_status": "Review" },
  { "status": "Review", "phase": "materialize", "produces_status": "Done" },
  { "status": "Review", "phase": "reject", "produces_status": "Done" },
  { "status": "Done", "phase": null, "produces_status": null } ] } },
"task_workflows": { "investigation": "investigation" }
```
- Каждая фаза — РОВНО ОДИН запуск (To Do→[investigate]→Review→[materialize]→Done); двойной investigate и ветвление по {{taskStatus}} удалены из плана и шаблонов.
- Во время фазы статус прежний (движок: меняет только finish_phase). Transient «запустил → In Progress, ошибка → откат» — отдельная задача **VL-196** (не блокер).
- reject→Done по спеке; фактически rejectTaskFile (store.ts:256) ставит Rejected+архив (влияет только canMoveTo/кнопку) — не трогаем.
- Auto: pickAutoPhase To Do→investigate→Review→materialize→Done; reject пропускается.

**R3. Подписи кнопок — из настроек, не хардкод:**
- phase-buttons.ts — чистый без fs (тянет web-бандл): PHASE_LABEL/PHASE_EMOJI остаются только fallback default-фаз; investigation/materialize туда НЕ добавляем.
- Ключи settings: `"phase_labels": {"investigate": "Расследование", "materialize": "Создать задачи"}`, `"phase_emojis": {"investigate": "🔍", "materialize": "📦"}`; приоритет settings > хардкод > имя фазы.
- Новый src/core/phase-styles.ts: `loadPhaseStyles(cwd)→{labels,emojis}` — нестрогая валидация (паттерн loadWorkflows:126–153); `phaseButtonLabel(phase, styles?)` — опциональный 2-й аргумент (web-совместим, без node).
- Бот: sendTaskView (handlers.ts:125–140, cwd есть) → loadPhaseStyles → `renderTaskRich(..., {canStart, phaseStyles})`; rich.ts кнопки next(325)/phase(330)/reject(~337) через resolver.
- Веб: enrichWithWorkflow (api.ts:515–524, GET /api/tasks/:id) += `phaseLabels`/`phaseEmojis`; тип KanbanTask (kanban.ts:30–33); task-modal.tsx 346 (label) и ~350 (reject) — из task-полей с fallback.

## Файлы (21) и места правок
1. backlog/config.yml — types(28–36): `- investigation` после `- spike`.
2. src/web/phase-prompt.ts — PHASES(32), PHASE_FILES(34–45), @param(108).
3. src/core/phase-styles.ts — НОВЫЙ.
4. src/core/phase-buttons.ts — phaseButtonLabel(44): опциональный styles; карты не трогать.
5. src/bot/rich.ts — renderTaskRich(295–340): opts.phaseStyles, кнопки через resolver.
6. src/bot/handlers.ts — sendTaskView(125–140): loadPhaseStyles → opts.
7. src/web/api.ts — enrichWithWorkflow(515–524): phaseLabels/phaseEmojis.
8. web/src/types/kanban.ts(30–33) — phaseLabels?, phaseEmojis?.
9. web/src/components/task-modal/task-modal.tsx(346, ~350) — label/reject из task-полей.
10. src/web/orchestrator.ts(769+комм.759–766) — обе фазы в `--allowed-mcp-server-names vibelog`.
11. src/agent/cli.ts USAGE(93) — +do/analyze/reject/investigate/materialize.
12–13. templates/phases/phase-investigate.md, phase-materialize.md — НОВЫЕ.
14. .vibelog/settings.json главного репо — merge 4 ключей (workflows.investigation, task_workflows, phase_labels, phase_emojis), идемпотентно.
15. src/core/workflow.test.mjs — fixture investigation. 16. src/core/phase-styles.test.mjs — НОВЫЙ. 17. src/bot/rich.test.mjs — рендер со styles. 18. src/web/phase-prompt.test.mjs(~561–596).
19. backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md — пример investigation(273–315), phase_labels/phase_emojis, шаблоны(~320). 20. CHANGELOG.md Unreleased(5). 21. web/dist/** после pnpm web:build.
**Не меняем:** хардкод-карты phase-buttons; условие worktree orchestrator:714 (фазы в главном cwd — нужен .vibelog/agent-sessions/auto-queue); slash-команды бота (прецедент do); DEFAULT_WORKFLOW/SERVICE_PHASES/canMoveTo/rejectTaskFile; phase-buttons.test (хардкод не растёт — deepEqual цел).

## Шаблоны
По образцу phase-plan/phase-close: блок задачи; `Дополнительный комментарий: {{comment}}` + фолбэк «неподставленный — продолжай»; правило worktree-блока (как phase-reject); финиш ОДНИМ `backlog_finish_phase … "status": "{{producesStatus}}"` без хардкода; финал «одно слово — Готово».
- **phase-investigate**: один запуск БЕЗ ветвления: данные (.vibelog/agent-sessions/*.jsonl+meta, auto-queue.json, git log, код, комментарии) → анализ → document_create «Выводы»+«Предложение задач» (title/type/priority/AC) → отчёт finish → **Review**. ЗАПРЕТ: создавать задачи (это materialize), менять статусы вручную.
- **phase-materialize**: из Review: document_view+комментарии → создать СОГЛАСОВАННЫЕ через backlog_create_task («предложено в {{taskId}}»; отклонённые пропустить с упоминанием) → отчёт (созданные/пропущенные ID) → finish → **Done**. Созданные не закрывать/не переставлять.

## Порядок действий (Code)
1. pnpm build.
2. backlog/config.yml: `node bin/vibelog.mjs config set types '["bug","feature","enhancement","task","chore","docs","spike","investigation","epic"]'`.
3. Правки #2,#10,#11 → 4. представление #3–#9 → 5. шаблоны #12–13 → 6. тесты #15–18 → 7. pnpm build && pnpm test && pnpm lint (зелёные).
8. Настройки главного репо: `node -e` с process.env.VIBELOG_CWD (VL-167, без абсолютных путей): JSON-merge 4 ключей (mkdir -p); нет VIBELOG_CWD — остановиться, сообщить; verify loadWorkflows(VIBELOG_CWD).
9. pnpm web:build → 10. документация #19–20.
11. Коммиты в vb/vl-195: feat (src, templates, тесты, backlog/config.yml), feat (web/dist), docs (CHANGELOG, doc-6). НЕ коммить: scratch-smoke, .vibelog/, файлы из MCP; исключение — backlog/config.yml (tracked-файл ветки, коммит обязателен, merge при close-worktree).

## Проверка
`pnpm build && pnpm test && pnpm lint` + node: loadWorkflows(VIBELOG_CWD).workflows.investigation (4 перехода R2); normalizeTaskType(loadConfig('.'),'investigation')==='investigation'.
- workflow.test: availablePhases('To Do')=['investigate']; getStatusAfterPhase: To Do/investigate→Review, Review/materialize→Done, Review/reject→Done; getNextPhase('Review')='materialize'; canMoveTo('To Do','Review')|('Review','Done')=true; isPhaseAllowed('Review','investigate')=false; pickAutoPhase-цепочка To Do→Review→Done.
- phase-styles.test: нет settings→дефолты; settings поверх; битые→fallback; пустой файл→без падения.
- rich.test: со styles «🔍 Расследование», без — прежний рендер (нет регрессии). phase-prompt.test: PHASES обе фазы; renderPrompt без остатков {{; в шаблонах {{producesStatus}}, нет хардкода `"status": "Review"`/`"Done"`.
- Опц. smoke (lesson-2): task create --type investigation (worktree, settings gitignored) → vibelog browser → кнопки «🔍 Расследование»/«📦 Создать задачи» (evaluate_script); scratch удалить, не коммить.

## Риски
1. До merge ветки в главном репо нет типа investigation → MCP create/update отклоняет (mcp/tools.ts:695/842) — проверять worktree-конфигом; главный config не править (конфликт merge); после merge close-worktree делает pnpm build.
2. .vibelog/settings.json главного репо gitignored — на новом клоне workflow/phase_labels переносить вручную — описать в doc-6.
3. До VL-196 во время investigate статус = To Do — осознанно; после VL-196 цепочка не меняется.
4. reject фактически → Rejected+архив вопреки produces_status Done — существующая механика, не регрессия; не правим.
5. phaseLabels/phaseEmojis добавить в тесты GET /api/tasks/:id — иначе веб-типы разъезжаются с сервером.
6. Старый dist главного репо до rebuild не знает новые фазы — закрыто close-worktree (VL-126).
7. web/dist отдельным коммитом (VL-26), иначе модалка без новых labels.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 20:06
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: цель (тип investigation + workflow + шаблоны фаз investigate/materialize), ограничение по именованию фаз (materialize без дефиса), добавлены 3 проверяемых AC. Labels: agent, prompt. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-26 20:40
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу: 14 файлов (5 кода: config.yml, phase-prompt.ts, phase-buttons.ts, orchestrator.ts, cli.ts; 2 новых шаблона phase-investigate/phase-materialize; .vibelog/settings.json главного репо; 3 теста; doc-6 + CHANGELOG + web/dist). Ключевые решения: workflow investigation = To Do →[investigate]→ In Progress →[investigate-финализация]→ Review →[materialize]→ Done + Review →[reject]→ Done (разрыв спеки In Progress→Review закрыт 2-м investigate-переходом: canMoveTo и auto-очередь требуют transition в каждом статусе; шаблон ветвится по {{taskStatus}}); регистрация фаз только в PHASES/PHASE_FILES (остальные слои generic); подписи кнопок 🔍/📦 в общем модуле phase-buttons; slash-команды бота не добавляем (прецедент do); фазы работают в главном cwd (worktree не создаётся). Риски: до merge ветки investigation-тип недоступен MCP из главного репо; .vibelog/settings.json gitignored — пишется напрямую в главный репо через VIBELOG_CWD (идемпотентный merge); reject фактически архивирует в Rejected (store.ts:256, не трогаем); обновить exact-deepEqual ожидания phase-buttons.test; после merge close-worktree делает pnpm build в главном репо.
---
author: @agent
created: 2026-10-26 21:13
---
Фаза 2 (Plan) — редакция 2 после ревью Pavel. Оба замечания проработаны по коду и внесены в план (записан целиком, сжат под лимит поля plan ~8.3К символов). R1: в default-воркфлоу НИКАКАЯ фаза не производит In Progress (workflow.ts:77–98 — только переходы из неё, drag запрещён) — наш To Do→investigate→In Progress был ошибкой. R2: investigation-workflow переписан БЕЗ In Progress: To Do →[investigate]→ Review →[materialize]→ Done + Review →[reject]→ Done — каждая фаза один запуск, двойной investigate и ветвление по taskStatus удалены; желаемый transient «старт фазы → In Progress, ошибка → откат» вынесен в ОТДЕЛЬНУЮ задачу VL-196 (не блокер; в плане зафиксировано, что до VL-196 статус во время фазы прежний). R3: подписи кнопок — из настроек: новые ключи settings phase_labels/phase_emojis (приоритет settings > хардкод > имя), новый core/phase-styles.ts (loadPhaseStyles, паттерн loadWorkflows), опциональный styles в phaseButtonLabel, бот — через opts renderTaskRich (sendTaskView), веб — поля phaseLabels/phaseEmojis в enrich GET /api/tasks/:id → task-modal; investigation/materialize в хардкод-карты phase-buttons НЕ добавляем (остаются fallback default-фаз). План: 21 файл, порядок/проверки/риски — в Implementation Plan.
---
author: @agent
created: 2026-10-26 22:18
---
Фаза 3 (Code) выполнена. Реализован план ред.2: (1) тип investigation в backlog/config.yml (закоммичен в ветку — осознанное исключение, tracked-файл); (2) регистрация фаз investigate/materialize в PHASES/PHASE_FILES (phase-prompt.ts), обе в vibelog-only MCP-флаги (orchestrator.ts:769), USAGE vibelog-agent актуализирован; (3) стили кнопок из настроек: новый core/phase-styles.ts (loadPhaseStyles, settings phase_labels/phase_emojis поверх хардкода), опциональный styles в phaseButtonLabel, бот — opts.phaseStyles в renderTaskRich (sendTaskView грузит из cwd), веб — phaseLabels/phaseEmojis в enrich GET /api/tasks/:id + task-modal (label и Reject из task-полей); investigation/materialize в хардкод-карты НЕ добавлялись; (4) шаблоны phase-investigate.md (один запуск: сбор данных → документ «Выводы»+«Предложение задач», запрет создавать задачи) и phase-materialize.md (создание согласованных через backlog_create_task, финиш {{producesStatus}}); (5) тесты: workflow.test (+5, investigation-цепочка To Do→Review→Done, In Progress не производится, pickAutoPhase), phase-styles.test (5), rich.test (+1: phaseStyles-рендер), phase-prompt.test (+2: рендер/без хардкода) — исправлено неверное ожидание битого значения (дефолт не затирается). Проверки: pnpm build ✓, pnpm lint ✓, vitest — 1312 passed/4 skipped ВСЕ зелёные (прогон общим пакетом дважды висел на СЕТОВОМ reference.test (таймаут клона 120с, к правкам отношения нет) — прогнан отдельно: 22 passed ✓). Настройки главного репо: .vibelog/settings.json — merge workflows.investigation + task_workflows + phase_labels + phase_emojis через VIBELOG_CWD (идемпотентно), verify loadWorkflows/phaseStyles ✓ (gitignored — в ветку не входит). web:build ✓ (для worktree создан симлинк web/node_modules из главного репо — паттерн linkWorktreeDeps). Коммиты: 4c81a93 (код/шаблоны/тесты/config.yml, 17 файлов), 924a444 (web/dist). Что осталось: документация (CHANGELOG, doc-6 — по правилам пишет Фаза Close после merge); до merge ветки MCP-создание типа investigation из главного репо отклонится (normalizeTaskType по главному config — риск №1 плана); transient In Progress — отдельная задача VL-196.
---
author: @agent
created: 2026-10-26 22:35
---
Фаза Close выполнена. Ветка vb/vl-195 слита в master (merge --no-ff, 2 коммита: 4c81a93 код/шаблоны/тесты/config.yml, 924a444 web/dist), после merge в главном репо сборка и тесты зелёные (pnpm build ✓, pnpm test ✓). Worktree удалён (force — только untracked-симлинки node_modules/refs), ветка vb/vl-195 удалена. Коммиты главного репо: 0d79444 (lessons), ded36e2 (docs: CHANGELOG + doc-6 — пример investigation-workflow, phase_labels/phase_emojis, новые шаблоны, предупреждение о gitignored settings.json). DoD: 1 Тесты проходят ✓ (build+test после merge), 2 Документация обновлена ✓ (CHANGELOG Unreleased + doc-6), 3 Нет регрессий ✓ (тесты зелёные, рендер без styles без изменений). Lessons: lesson-52 (сетевой reference.test отдельным запуском), lesson-53 (сверять produces_status фаз с workflow.ts до утверждения плана). transient In Progress — VL-196.
---
<!-- COMMENTS:END -->