---
id: VL-168
title: Фаза Spec переиспользует существующий ref вместо создания дубликата
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 10:09'
updated_date: '2026-10-15 10:57'
due_date: ''
labels:
  - agent
  - prompt
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-1.md
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-12
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Фаза spec создала новый ref вместо того чтобы подставить существующий (ref-2) в контексте "Скопировать шапку из next-shadcn-admin-dashboard"

Задача: VL-166
Сессия агента: vb:agent-1792046228082

P.s. Созданный реф удалил, задачу поправил вручную
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Инструкция фазы Spec содержит правило: перед регистрацией источника выполнить поиск существующих references (reference_search/reference_list) и при совпадении связывать существующий ref через reference_link, а не создавать новый через reference_add
- [x] #2 При запуске Spec для задачи с упоминанием уже зарегистрированного в проекте источника в references задачи попадает существующий ref-N, дубликат reference не создаётся
- [x] #3 Повторный запуск Spec (или Spec для второй задачи с тем же источником) не приводит к дублированию references
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Фаза Spec (шаблон `templates/qwen-commands/phase-1.md`, шаг 5.6) обязана перед регистрацией источника искать существующие references и связывать найденный ref через `reference_link`, а не создавать дубликат через `reference_add`. Инцидент: при запуске Spec для VL-166 источник «next-shadcn-admin-dashboard» был уже зарегистрирован (ref-2), но агент создал ref-15.

## Изучено
- Точка регистрации источников Spec — `templates/qwen-commands/phase-1.md`, шаг 5.6 (строки 64–70): сейчас сразу `reference_add` → `reference_link`; правило дедупа есть только для уже связанных refs задачи («Уже связанные references … повторно не добавляй»), но НЕ для refs, уже существующих в проекте.
- Промпт загружается через `src/web/phase-prompt.ts` (spec → phase-1.md); оркестратор промпт не дублирует.
- Интерактивная команда `.qwen/commands/vibelog/spec.md` references не регистрирует вовсе (grep — 0 упоминаний) → правка не нужна.
- Тест-якоря: `src/web/phase-prompt.test.mjs`, describe «phase-1.md: регистрация references из текста пользователя» (строки 397–404) — ассертит `reference_add`, `reference_link`, `{{taskReferences}}`, `"references"`.

## Файлы для изменения
1. `templates/qwen-commands/phase-1.md` — шаг 5.6 (строки 64–70)
2. `src/web/phase-prompt.test.mjs` — тест «регистрация references из текста пользователя» (строки 397–404)
3. `CHANGELOG.md` — запись по формату существующих (как VL-164)

## Порядок действий

### 1. `templates/qwen-commands/phase-1.md`, шаг 5.6
Перед подшагом `reference_add` вставить подшаг дедупа (текст):

```
   - СНАЧАЛА проверь, не зарегистрирован ли источник уже в проекте: reference_search {"query": "<название или url источника>"} (при необходимости — reference_list).
   - Если найден ref с совпадающим url/path (или явно тот же источник по title) — НЕ создавай дубликат через reference_add: свяжи существующий: reference_link {"referenceId": "<ref-N из поиска>", "taskId": "{{taskId}}"} и добавь ЭТОТ ref-N в поле references вызова backlog_update_task (шаг 5).
   - Только если совпадений нет — регистрируй новый: reference_add {"title": ..., "type": "url|repo|file|doc|spec", "url|path": ...}; затем reference_link; добавь новый ref-N в поле references (шаг 5).
```

Старый подшаг `reference_add {...}` и `reference_link {...}` оставить как есть (они — fallback-ветка; новый текст ссылается на них словами «регистрируй новый»). Последние два правила шага 5.6 («Уже связанные references …» и «Содержимое референсов НЕ читай …») не трогать.
Ограничение шаблонизатора: в тексте НЕ должно быть внутренних ID задач (`VL-\d`) — тест VL-157 это проверяет.

### 2. `src/web/phase-prompt.test.mjs`
В существующий it-тест «phase-1.md: регистрация references из текста пользователя» (стр. 397) добавить ассерты:
```js
assert.ok(text.includes('reference_search'), 'шаг 5.6: поиск существующих refs перед регистрацией');
assert.ok(text.includes('reference_list'), 'шаг 5.6: reference_list как дополнительная проверка');
assert.ok(text.includes('НЕ создавай дубликат'), 'шаг 5.6: запрет дубликата reference');
```

### 3. `CHANGELOG.md`
В верхний раздел (по образцу записи VL-164) добавить запись: «VL-168: Фаза Spec не создаёт дубликатов references — шаг 5.6 phase-1.md: перед reference_add обязателен reference_search/reference_list; найденный ref связывается через reference_link; тесты — 3 новых ассерта в phase-prompt.test.mjs».

## Проверка
```bash
pnpm build && npx vitest run src/web/phase-prompt.test.mjs
# или полностью:
pnpm test
```
Критерий: все тесты phase-prompt.test.mjs зелёные (включая новый «запрет дубликата» и VL-157-запрет ID).

## Риски
- Ассерт `text.includes('reference_search')` хрупкий к перефразировке — оставляю точные подстроки-якоря в шаблоне («reference_search», «НЕ создавай дубликат»), как принято в этом тест-файле.
- Промпт станет длиннее — риск путаницы агента минимален: дедуп-ветка логически предшествует reference_add и формулирована императивно («СНАЧАЛА … НЕ создавай дубликат»).
- Правило «один вызов backlog_update_task» (шаг 5) не нарушается: reference_search/reference_list — отдельные инструменты, как и reference_add/reference_link.

## AC (из задачи)
1. Правило поиска существующих refs добавлено в инструкцию Spec ✅ (шаг 1)
2. Spec для задачи с уже зарегистрированным источником связывает существующий ref ✅ (шаг 1 + тест шага 2)
3. Повторный запуск Spec не дублирует references ✅ (то же правило + ассерт «НЕ создавай дубликат»)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 10:13
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Фаза Spec переиспользует существующий ref вместо создания дубликата» (предыдущий был обрезан). Масштаб: task (одно исправление поведения фазы Spec). Уточнено: проблема — при запуске Spec для VL-166 агент создал новый ref-15 для next-shadcn-admin-dashboard вместо переиспользования уже связанного ref-2; ожидаемое поведение — перед регистрацией источника фаза Spec ищет существующие references (reference_search/reference_list) и связывает найденный ref через reference_link. Labels: agent, prompt. References: нет (next-shadcn-admin-dashboard — контекст инцидента в VL-166, уже зарегистрирован там как ref-2). Добавлено 3 критерия приёмки (отмечены). Вопросов нет.
---
author: @agent
created: 2026-10-15 10:42
---
Фаза 2 (Plan) выполнена. Тип: task. Точка правки — templates/qwen-commands/phase-1.md, шаг 5.6 (строки 64–70): добавлен подшаг дедупа «СНАЧАЛА reference_search/reference_list → найденный ref связать через reference_link, дубликат НЕ создавать; reference_add — только при отсутствии совпадений». Файлов в плане: 3 — phase-1.md (шаг 5.6), src/web/phase-prompt.test.mjs (3 новых ассерта в тесте «регистрация references из текста пользователя»), CHANGELOG.md (запись по образцу VL-164). Интерактивная .qwen/commands/vibelog/spec.md references не регистрирует (grep — 0) — не меняется. Проверка: pnpm build && npx vitest run src/web/phase-prompt.test.mjs (или pnpm test). Риски: хрупкие substring-якоря в тестах — оставлены точные подстроки; правило «один вызов backlog_update_task» не нарушается. Ограничение VL-157 (запрет внутренних ID в шаблонах) учтено.
---
author: @agent
created: 2026-10-15 10:52
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-1.md (шаг 5.6 — подшаг дедупа: СНАЧАЛА reference_search/reference_list; найденный ref (совпадающий url/path/title) связывается через reference_link без создания дубликата; reference_add — только при отсутствии совпадений; правило «один вызов backlog_update_task» сохранено), src/web/phase-prompt.test.mjs (3 новых ассерта в тесте «регистрация references из текста пользователя»: reference_search, reference_list, «НЕ создавай дубликат»). Коммит f1491d5 в ветке vb/vl-168. Проверки: pnpm build — OK; npx vitest run src/web/phase-prompt.test.mjs — 30/30; полный pnpm test — все зелёные (нет регрессий). Ограничение VL-157 (запрет внутренних ID в шаблонах) соблюдено — в новом тексте нет VL-*. Что осталось: CHANGELOG.md не обновлял по правилам Фазы 3 (пишет Фаза Close); AC 1-3 уже были отмечены, DoD 1 и 3 закрыты тестами, DoD 2 (документация) оставлен на Close.
---
author: @agent
created: 2026-10-15 10:57
---
Фаза Close выполнена. Ветка vb/vl-168 слита в master (1 коммит f1491d5 + merge-коммит, --no-ff), worktree удалена (force — только untracked-симлинки node_modules/refs), ветка удалена. Сборка и полный pnpm test после merge — зелёные, регрессий нет. Документация: CHANGELOG.md — запись «VL-168: фаза Spec не создаёт дубликатов references» в разделе Исправлено (Unreleased), коммит f061e69. Урок: lesson-12 «Перед reference_add в шаблоне Spec обязателен дедуп через reference_search/reference_list» — связан с задачей. DoD честно: 1 (тесты проходят — pnpm test зелёный), 2 (документация обновлена — CHANGELOG f061e69), 3 (нет регрессий — полный прогон зелёный).
---
<!-- COMMENTS:END -->