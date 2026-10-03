---
id: VL-60
title: 'По команде /comment VL-N необходимо добавить не только комментарий, но и…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 03:40'
updated_date: '2026-10-03 13:31'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
По команде /comment VL-N необходимо добавить не только комментарий, но и создать команду для qwen (такую же как и например templates/qwen-commands/phase-1.md), чтобы qwen прочитал этот комментарий и начал его выполнять для этой задачи, после этого так же оставил отчёт комментарием и по завершению должен быть ответ в чат такой же как у spec plan code
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Команда /comment VL-N «текст»: бот добавляет комментарий (как сейчас) И запускает Фазу Comment — headless qwen выполняет запрос из комментария, оставляет отчёт комментарием, статус задачи НЕ меняет (фаза вне жизненного цикла spec/plan/code/close). Ответ в чат по паттерну VL-48 (✅/⚠️ + лог + карточка). Реализация покрывает подзадачи VL-61 (оркестратор) и VL-62 (бот).

## Файлы (6)
1. templates/qwen-commands/phase-comment.md — НОВЫЙ шаблон
2. src/web/orchestrator.ts — PHASES/PHASE_FILES/renderPrompt/startPhase
3. src/bot/handlers.ts — обработчик /comment
4. src/bot/registry.ts — описание команды
5. src/web/orchestrator.test.mjs — тесты
6. CHANGELOG.md — запись

## Изменения по файлам

### 1. templates/qwen-commands/phase-comment.md (новый, ~35 строк)
Основа — phase-2.md (структура та же). Отличия:
- Заголовок: «Ты — автоматический исполнитель Vibelog (Фаза Comment: выполнение запроса из комментария) для задачи {{taskId}}».
- Шаг 1: backlog_view_task {"id": "{{taskId}}"}.
- Шаг 2: выполни запрос пользователя из комментария: {{comment}}. Фолбэк: если {{comment}} не подставлено — возьми ПОСЛЕДНИЙ комментарий задачи из backlog_view_task.
- Шаг 3: backlog_add_comment — отчёт (author "@agent").
- Правила: статус НЕ менять; git-операции запрещены; только Node.js; только пределы проекта.
- Финал: ответь ровно одно слово — «Готово».

### 2. src/web/orchestrator.ts
- стр. 22: PHASES → ['spec', 'plan', 'code', 'close', 'comment']
- стр. 26-31: PHASE_FILES += comment: 'phase-comment.md'
- renderPrompt (стр. 81-99): сигнатура → renderPrompt(phase, taskId, extraVars?: Record<string,string>); после replaceAll('{{taskId}}', ...) — цикл по extraVars: replaceAll('{{'+key+'}}', value). Текст ошибки фазы: «ожидается spec|plan|code|close|comment».
- startPhase (стр. 102+): 5-й необязательный параметр extraVars — прокинуть в renderPrompt (~стр. 113). Существующие вызовы (web/api.ts:68 и фазы бота) не меняются — регрессий нет.
- JSDoc: задокументировать phase (добавить comment) и extraVars.

### 3. src/bot/handlers.ts — bot.command('comment') (стр. 220-236)
После addComment (стр. 230) и sendMd «💬 Комментарий добавлен» (стр. 231):
- onExit: PhaseExitCallback по паттерну VL-48 (как в /plan, стр. 308-328): head ✅ «Фаза Comment завершена» для task.id / ⚠️ + код; logTail в pre-блоке ≤3000 символов; sendTaskView(bot, notifyChat, getTask(...) ?? task, run).
- result = startPhase(deps.cwd, task.id, 'comment', onExit, { comment: parsed.text });
- 'error' in result → sendMd «⚠️ Комментарий добавлен, но запуск qwen не удался: <error>» (guard «уже выполняется» — комментарий уже сохранён, не откатываем, сообщаем явно).
- иначе sendMd «🚀 Фаза Comment запущена для *<id>*, PID <n>».
Импорт PhaseExitCallback уже есть (стр. 23) — правок импортов нет.

### 4. src/bot/registry.ts стр. 33
description → «Добавить комментарий и выполнить его через Фазу Comment (qwen)».

### 5. src/web/orchestrator.test.mjs
- renderPrompt('comment', 'VL-60') подставляет {{taskId}} (по аналогии со стр. 102-107 close).
- renderPrompt('comment', 'VL-60', {comment: 'тест-запрос'}) — промпт содержит «тест-запрос», не содержит '{{comment}}'.
- renderPrompt('deploy') бросает /Неизвестная фаза/ (стр. 98-100 — без изменений, проверить после правки текста ошибки).
- startPhase с extraVars: через существующий стаб VIBELOG_QWEN_BIN (marker argv, стр. 34/131) — assert: промпт (argv[1]) содержит текст комментария.
- startPhase('deploy') возвращает {error} (стр. 136-139).

### 6. CHANGELOG.md — [Unreleased] → Добавлено
Пункт: «VL-60: /comment — Фаза Comment через headless qwen» — после addComment бот запускает фазу 'comment' (шаблон phase-comment.md, фаза в PHASES оркестратора); текст запроса подставляется в промпт как {{comment}}; статус не меняется; ответ в чат по паттерну VL-48.

## Порядок действий
1. Шаблон phase-comment.md → 2. orchestrator.ts → 3. pnpm build (быстрая проверка типов) → 4. тесты orchestrator.test.mjs → 5. handlers.ts → 6. registry.ts → 7. CHANGELOG.md → 8. pnpm build && pnpm test.

## Как проверить
- pnpm build (tsc strict)
- pnpm test (build + node --test src)
- node --input-type=module -e "import('./dist/web/orchestrator.js').then(m => console.log(m.renderPrompt('comment','VL-60',{comment:'тест'}).includes('тест')))" — подстановка {{comment}}
- Ручная (по желанию): vibelog bot → /comment VL-60 тест → в чат «💬 Комментарий добавлен» + «🚀 Фаза Comment запущена»; по завершении ✅ + pre-блок + карточка задачи.

## Риски
- Двойной запуск: /comment при активной фазе той же задачи → guard startPhase («уже выполняется»); комментарий уже сохранён — не откатывается, сообщаем явно.
- Текст комментария с переносами строк/кавычками — replaceAll литерален, промпт передаётся spawn одним позиционным аргументом — безопасно.
- Web-trigger фазы comment без {{comment}} (POST /api/tasks/:id/trigger) — фолбэк в шаблоне: последний комментарий задачи через MCP.
- Фаза comment не входит в жизненный цикл доски: канban-автотриггеры её не трогают (только явный /comment или trigger API).
- Закрытие подзадач: VL-61 — шаги 1-2+5, VL-62 — шаги 3-4+6; VL-60 → Done после полного прогона pnpm test.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 03:43
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-61 — Фаза comment в orchestrator: шаблон phase-comment.md + поддержка в startPhase/renderPrompt; VL-62 — Бот /comment: после комментария запуск фазы Comment через startPhase + ответ в чат VL-48 (зависимость: VL-61). Краткое описание разбиения: фича VL-60 состоит из двух слоёв: (1) оркестратор — новая фаза 'comment' в PHASES/PHASE_FILES + шаблон templates/qwen-commands/phase-comment.md, где qwen читает задачу и комментарий через MCP, выполняет запрос из комментария, оставляет отчёт комментарием и НЕ меняет статус (это не жизненный цикл spec/plan/code/close); (2) бот — хендлер bot.command('comment') после addComment запускает startPhase с onExit по паттерну VL-48 (уведомление ✅/⚠️ + log tail + карточка задачи), передавая текст комментария в промпт. Статус исходной задачи — Spec.
---
author: @agent
created: 2026-10-03 04:22
---
Фаза 2 (Plan) выполнена. План записан: 6 файлов. Ключевые изменения: (1) новый шаблон templates/qwen-commands/phase-comment.md — Фаза Comment: qwen читает задачу, выполняет запрос из комментария (подстановка {{comment}}, фолбэк — последний комментарий задачи), оставляет отчёт комментарием, статус НЕ меняет; (2) src/web/orchestrator.ts — 'comment' в PHASES/PHASE_FILES + renderPrompt/startPhase получают необязательный extraVars (подстановка {{comment}}), существующие вызовы не меняются; (3) src/bot/handlers.ts — обработчик /comment после addComment запускает startPhase('comment', onExit, {comment: parsed.text}) с уведомлением VL-48 (✅/⚠️ + лог + карточка); (4) registry.ts — описание /comment; (5) тесты renderPrompt/startPhase с extraVars; (6) CHANGELOG. Проверка: pnpm build && pnpm test + проверка подстановки {{comment}} через node -e. Риски: guard «фаза уже выполняется» (комментарий остаётся, сообщаем), спецсимволы в тексте безопасны (replaceAll литерален), web-trigger без {{comment}} закрыт фолбэком в шаблоне. План покрывает подзадачи VL-61 (оркестратор) и VL-62 (бот). Статус не меняю — ждёт одобрения.
---
author: @agent
created: 2026-10-03 04:51
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-comment.md (новый шаблон Фазы Comment), src/web/orchestrator.ts (фаза comment в PHASES/PHASE_FILES; renderPrompt/startPhase получили необязательный extraVars — подстановка {{comment}}, существующие вызовы не изменились), src/bot/handlers.ts (/comment после addComment запускает startPhase('comment', onExit, {comment: parsed.text}) с уведомлением VL-48: ✅/⚠️ + лог qwen + карточка; при ошибке запуска комментарий остаётся, сообщаем явно), src/bot/registry.ts (описание /comment), src/web/orchestrator.test.mjs (2 новых теста: renderPrompt comment с extraVars + startPhase с extraVars через стаб qwen), CHANGELOG.md (запись VL-60 в [Unreleased]). Проверки: pnpm build OK, pnpm test — 396/396 pass, node -e: подстановка {{comment}} работает (остаток {{comment}} отсутствует). Что осталось: запуск бота вручную (vibelog bot → /comment VL-N тест) не выполнялся; AC-список задачи пуст. Статус не меняю (переход к Review выполняет оркестратор-скрипт).
---
author: Pavel Bobarev
created: 2026-10-03 09:47
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author: @agent
created: 2026-10-03 09:47
---
Фаза Comment выполнена: Тест прошёл
---
author: @agent
created: 2026-10-03 10:07
---
Фаза Close выполнена. Статус: Done. Коммит feat: 22bae48 — /comment запускает Фазу Comment: шаблон phase-comment.md, extraVars в оркестраторе, хендлер бота (6 файлов: templates/qwen-commands/phase-comment.md, src/web/orchestrator.ts, src/bot/handlers.ts, src/bot/registry.ts, src/web/orchestrator.test.mjs, CHANGELOG.md). Подзадачи батча: VL-61 (оркестратор), VL-62 (бот). Примечание: в рабочем дереве остаются незакоммиченные диагностические изменения VL-58/59 (stream-json, probe, журнал MCP) — они не входят в VL-60 и намеренно не коммитились. Проверки staged-версии: tsc OK, тесты orchestrator 10/10.
---
author: Pavel Bobarev
created: 2026-10-03 12:51
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author: @agent
created: 2026-10-03 12:51
---
Фаза Comment выполнена: Тест прошёл
---
author: Pavel Bobarev
created: 2026-10-03 13:05
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author: @agent
created: 2026-10-03 13:05
---
Фаза Comment выполнена: Тест прошёл
---
author: Pavel Bobarev
created: 2026-10-03 13:19
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author: @agent
created: 2026-10-03 13:20
---
Фаза Comment выполнена: Тест прошёл
---
author: Pavel Bobarev
created: 2026-10-03 13:23
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author: @agent
created: 2026-10-03 13:24
---
Фаза Comment выполнена: Тест прошёл
---
author: Pavel Bobarev
created: 2026-10-03 13:30
---
Тестовый комментарий. Нужно просто ответить Тест прошёл.
---
author:  @agent
created: 2026-10-03 13:31
---
Фаза Comment выполнена: Тест прошёл
---
<!-- COMMENTS:END -->