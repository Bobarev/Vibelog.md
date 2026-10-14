---
id: VL-154
title: 'core: внедрить labels в Spec-фазу (подстановка + предложение)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 11:04'
updated_date: '2026-10-14 22:59'
due_date: ''
labels:
  - core
  - cli
  - docs
dependencies: []
milestone: v1.8
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/phase-prompt.ts
  - src/web/phase-prompt.test.mjs
  - src/mcp/v11.test.mjs
  - templates/qwen-commands/phase-1.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Проблема: новые задачи создаются без labels (старые не трогаем). Labels нужны для: (1) фильтрации в task list, (2) lessons learned (Plan читает lessons по tags задачи), (3) milestones.

## Решения (зафиксированы)

1. Подстановка labels в промпт Spec — как поля задачи (VL-137): {{availableLabels}} читается из backlog/config.yml, Spec не тратит ход на backlog_config.
2. Новые labels: Spec предлагает в комментарии, если ни один из config.yml не подходит. Пользователь создаёт вручную (vibelog config set labels '...'). Spec НЕ создаёт labels автоматически.
3. Старые задачи без labels — НЕ трогаем. Labels появятся только у новых задач, созданных с этой версией workflow. Batch-скрипт для старых задач НЕ делаем.

## Кто расставляет labels

Только Spec — фаза уточнения, видит задачу первой, не читает код, быстро классифицирует. Plan и Code labels НЕ трогают.

## Что реализовать

1. src/web/phase-prompt.ts: новая переменная {{availableLabels}} — подстановка списка labels из backlog/config.yml (тот же механизм что для полей задачи VL-137). Fallback: если config.yml недоступен — пустая строка.

2. phase-1.md (Spec):
   - Блок 'Доступные labels: {{availableLabels}}' в начале промпта.
   - Шаг 5.5 (после определения масштаба): предложи 1-3 labels из списка, отражающих область задачи. Пример: для задачи про MCP — labels: [core, mcp]; для задачи про веб — [web, ui].
   - В backlog_update_task добавить параметр labels: string[].
   - Если ни один label не подходит — предложи новый в комментарии: 'Предлагаю добавить label X (обоснование). Создайте: vibelog config set labels ...'. НЕ создавай автоматически.

3. MCP backlog_update_task — проверить, что принимает labels (должно уже работать).

4. Round-trip с Backlog.md сохраняется (поле labels уже есть в оригинале).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/web/phase-prompt.ts: новая переменная {{availableLabels}} — подстановка списка labels из backlog/config.yml (fallback: пустая строка)
- [x] #2 phase-1.md (Spec): блок 'Доступные labels: {{availableLabels}}' в начале промпта
- [x] #3 phase-1.md (Spec): шаг 5.5 — предложи 1-3 labels из списка, отражающих область задачи
- [x] #4 phase-1.md (Spec): backlog_update_task принимает labels: string[] (1-3 labels из конфига)
- [x] #5 phase-1.md (Spec): если ни один label не подходит — Spec предлагает новый в комментарии (НЕ создаёт автоматически)
- [x] #6 MCP backlog_update_task принимает labels: string[] (проверено)
- [x] #7 Round-trip с Backlog.md сохраняется (поле labels уже есть)
- [x] #8 Тесты: phase-prompt.test.mjs (подстановка {{availableLabels}}), phase-prompt (шаблон phase-1 содержит шаг labels)
- [x] #9 Документация: docs/agent.md (labels в workflow Spec)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: labels в Spec-фазу (VL-154)

Тип: task. Подавляющая часть — правки шаблона и одной функции подстановки; MCP backlog_update_task уже принимает labels (проверено: src/mcp/tools.ts:672 `if (args.labels !== undefined) updates.labels = ...`; схема — src/mcp/tools.ts:144). Round-trip уже есть (core/task.ts:136/173 запись, :300 парсинг, включая одиночную строку → массив).

## Файлы для изменения

1. **src/web/phase-prompt.ts** — функция `taskExtraVars` (строка ~120)
2. **templates/qwen-commands/phase-1.md** — шаблон Spec
3. **src/web/phase-prompt.test.mjs** — тесты подстановки
4. **src/mcp/v11.test.mjs** (или server.test.mjs) — тест update_task с labels
5. **backlog/docs/doc-10** (через MCP document_update) — документация

## Шаг 1 — src/web/phase-prompt.ts: переменная {{availableLabels}}

В `taskExtraVars(cwd, taskId)` добавить ключ `availableLabels`:

- Импорт `loadConfig` из `../core/config.js` (без цикла: config.ts не импортирует phase-prompt).
- Чтение: `const cfg = loadConfig(cwd)` в try/catch → при любой ошибке (нет backlog, нет config.yml, битый YAML) — `''` (fallback пустая строка по AC).
- Формат: `Array.isArray(cfg.labels) ? cfg.labels.join(', ') : ''` → строка вида `core, cli, mcp, web, bot, agent, docs`.
- Ключ добавить ПОСЛЕ `taskReferences` (порядок replaceAll: значение короткое, позиция не критична; комментарий о длинных текстах первыми сохранить).
- Комментарий на русском: VL-154, зачем (Spec классифицирует без backlog_config-хода), fallback-семантика.
- Оба вызывающих места (src/web/orchestrator.ts:161, src/agent/cli.ts:281) разливают taskVars в renderPrompt спредом — НЕ требуют правок, availableLabels попадёт во все фазы автоматически (используется только в phase-1).

## Шаг 2 — templates/qwen-commands/phase-1.md

2а. Блок «Задача (подставлена автоматически)» — после строки «Последний комментарий: {{taskLastComment}}» (строка 17) вставить:
```
Доступные labels: {{availableLabels}}
```

2б. Шаг 5 (строка 40-41) — в пример вызова добавить `"labels": ["<1-3>"]`:
```
backlog_update_task {"id": "{{taskId}}", "title": "...", "type": "task|epic", "labels": ["<1-3 labels из списка>"], "acceptanceCriteria": ["...", "..."]}
```
+ буллет: «labels: выбери 1-3 из "Доступные labels", отражающих область задачи (напр. MCP → [core, mcp]; веб → [web]). Plan и Code labels НЕ трогают.»

2в. Новый шаг 5.5 (между шагами 5 и 6) — «Если ни ОДИН label из списка не подходит»:
- НЕ передавай labels в backlog_update_task;
- предложи новый label в комментарии отчёта (шаг 6) по форме: «Предлагаю добавить label X (обоснование). Создайте: vibelog config set labels '...'»;
- НЕ создавай labels автоматически (никаких config set от имени агента).

2г. В примеры комментариев шага 6 (обе ветки: полное/неполное описание) добавить секцию «Labels: <выбранные из списка | предложение нового с обоснованием>».

## Шаг 3 — Тесты

3а. **src/web/phase-prompt.test.mjs**:
- В тесте VL-137 «ровно 10 подстановок» (строка ~173) → 11; assert `vars.availableLabels === ''` (makeRoot-конфиг без labels).
- Новый it: конфиг с `labels:\n  - core\n  - mcp` → `taskExtraVars` возвращает `availableLabels: 'core, mcp'`.
- Новый it: конфиг без labels / без config.yml → `''` (fallback).
- Новый it (шаблон): собрать `renderPrompt('spec', 'VL-901', { ...TASK_VARS, availableLabels: 'core, mcp' })` → нет остатков `{{availableLabels}}`; шаблон phase-1.md содержит `{{availableLabels}}` (структурная проверка по AC8, в духе VL-142 — без матчинга конкретных фраз).

3б. **src/mcp/v11.test.mjs**: новый it — `handleToolCall('backlog_update_task', { id, labels: ['core','mcp'] }, testDir)` → `getTask().labels` deep-equal ['core','mcp'] (подтверждение AC6; инструмент работает, тест фиксирует контракт).

3в. Round-trip (AC7) — ничего не менять; покрывается существующими compat-тестами (src/core/compat*.test.mjs) + новым MCP-тестом.

## Шаг 4 — Документация (AC9)

Файла docs/agent.md в проекте НЕТ (проверено ls/find) — целевой документ агента: `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`. Обновить через MCP `document_update`: в раздел «Интеграция с оркестратором»/описание фаз добавить подраздел «Labels в Spec (VL-154)»: {{availableLabels}} из config.yml, Spec ставит 1-3 labels, новые предлагает в комментарии (создаёт пользователь), Plan/Code не трогают labels.

## Порядок и проверка

1. Правки src/web/phase-prompt.ts → 2. шаблон phase-1.md → 3. тесты → 4. `pnpm build && pnpm test` (или `pnpm test:fast` после первой сборки) → 5. document_update doc-10.
Быстрая проверка подстановки вживую: `node --input-type=module -e` с импортом dist/web/phase-prompt.js и renderPrompt('spec', ...) в этом репо → grep на '{{availableLabels}}' = 0 остатков.

## Риски

- Тест VL-137 со счётчиком 10 подстановок сломается — обновить осознанно (11), не удалить.
- Literals `{{availableLabels}}` в description задач — replaceAll по ключу; значения labels из конфига (короткие слова) практически не совпадут с литералом в текстах задач — риск ничтожен.
- labels не валидируются на вхождение в config.yml (Spec может передать значение не из списка) — осознанно: как у оригинального Backlog.md; валидация не нужна для round-trip.
- Telegram-бот и оба CLI ходят через единый taskExtraVars — отдельная проверка бота не требуется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 15:06
---
Фаза 2 (Plan) выполнена. Тип: task. План записан: 5 файлов (src/web/phase-prompt.ts — {{availableLabels}} в taskExtraVars через loadConfig с fallback ''; templates/qwen-commands/phase-1.md — блок labels + шаг 5.5 + labels в backlog_update_task; тесты phase-prompt.test.mjs и v11.test.mjs; документация — doc-10, т.к. docs/agent.md не существует). MCP backlog_update_task labels подтверждён (tools.ts:672); round-trip уже есть (core/task.ts). Риски: счётчик подстановок в тесте VL-137 (10→11), отсутствие валидации labels на вхождение в конфиг — осознанно.
---
author: @agent
created: 2026-10-14 15:16
---
Фаза 3 (Code) выполнена. Изменено: src/web/phase-prompt.ts ({{availableLabels}} в taskExtraVars через loadConfig, fallback '' при любой ошибке чтения конфига), templates/qwen-commands/phase-1.md (блок «Доступные labels», labels в вызове backlog_update_task шага 5, шаг 5.5 — предложение нового label в комментарии без авто-создания, секция Labels в примерах отчёта шага 6), src/web/phase-prompt.test.mjs (счётчик 10→11, +4 теста VL-154: конфиг с labels, fallback без labels, битый YAML, шаблон/промпт), src/mcp/v11.test.mjs (контракт update_task labels + round-trip). Коммит b298d68. Проверки: pnpm build && pnpm test:fast — 59 файлов, 1036 passed, 0 failed; живая проверка renderPrompt('spec') — остатков {{availableLabels}} нет. AC9 (документация): docs/agent.md не существует, обновление doc-10 сознательно НЕ делал — по правилам Фазы 3 (VL-126) итоговую документацию пишет Фаза Close после слияния; AC9 снят, DoD «Документация обновлена» не отмечен. Round-trip: поле labels не менялось в core, проверено MCP-тестом.
---
author: @agent
created: 2026-10-14 15:51
---
Фаза Close выполнена. Ветка vb/vl-154 слита в master (1 коммит b298d68: {{availableLabels}} в taskExtraVars через loadConfig с fallback '', phase-1.md — блок «Доступные labels», labels в шаге 5, шаг 5.5 с предложением нового label без авто-создания, секция Labels в отчётах шага 6; тесты phase-prompt/v11). Сборка и тесты после merge: pnpm build && pnpm test — всё зелёное, регрессий нет. Worktree удалена (force — только untracked-симлинки node_modules/refs), ветка удалена. Документация (AC9/DoD 2): обновлены CHANGELOG.md (запись Unreleased: VL-154) и doc-10 «Агент Vibelog» (раздел «Labels в Spec-фазе (VL-154)» в главе 4) — docs-коммит 7cfa2b6. Round-trip с Backlog.md сохранён (поле labels не менялось, контракт закреплён MCP-тестом). DoD: тесты проходят, документация обновлена, регрессий нет — всё отмечено.
---
<!-- COMMENTS:END -->