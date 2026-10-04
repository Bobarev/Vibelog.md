---
id: VL-48
title: 'Telegram-бот: уведомление о завершении /spec — ответ qwen + карточка задачи'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:27'
updated_date: '2026-10-04 18:42'
due_date: ''
labels:
  - telegram-bot
  - spec
  - qwen
dependencies:
  - VL-42
  - VL-43
milestone: v1.6
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас /spec (VL-42) запускает qwen fire-and-forget: после завершения фазы в чат не приходит ничего. startPhase в src/web/orchestrator.ts хранит lastRuns, но никто не подписан на завершение.

Нужно: когда дочерний процесс qwen завершится (событие close/error в finish()), бот отправляет в привязанный чат:
1. Строку-итог: код выхода (0 → «Фаза Spec завершена», иначе — «ошибка, код N»).
2. Последние строки stdout/stderr qwen (logTail из lastRuns, тот же обрезок, что отдаёт getRun) — т.е. «прислать ответ qwen».
3. Карточку задачи по созданной/обновлённой задаче — ровно то, что шлёт /task VL-N (renderTaskRich + chunkRich через sendRichMessage, фолбэк formatTaskDetail).

Реализация:
- src/web/orchestrator.ts: startPhase получает необязательный 4-й аргумент onExit?: (run: PhaseRun) => void. В finish(), после lastRuns.set, вызывается колбэк с готовым PhaseRun (включая logTail и exitCode). Вызов — try/catch + void: сетевые ошибки Telegram не должны ронять polling бота. Существующие вызовы startPhase (web api.ts) не меняются — аргумент опционален.
- src/bot/handlers.ts: в обработчике /spec передать колбэк, который по deps.cwd читает актуальную карточку (getTask) и шлёт в чат итог + logTail + карточку (переиспользуя sendTaskView / rich-путь /task).

Не дублировать spawn-логику; keep finish-once guard (error+close).
Важно: сообщение шлётся в тот же чат, откуда пришёл /spec.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 startPhase принимает необязательный onExit-колбэк и вызывает его ровно один раз при завершении (close или error) с PhaseRun, содержащим exitCode и logTail; прежние вызовы startPhase без колбэка работают без изменений
- [x] #2 После завершения qwen-фазы (exit 0) в чат /spec приходит: строка «Фаза Spec завершена», затем последние строки stdout qwen, затем карточка задачи (богатое сообщение как в /task)
- [x] #3 При ненулевом коде выхода или ENOENT бинаря — в чат приходит строка с кодом ошибки; ошибки отправки не роняют процесс бота
- [x] #4 Тесты: юнит onExit-колбэка (orchestrator.test.mjs, заглушка VIBELOG_QWEN_BIN) + pnpm test без регрессий
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
created: 2026-10-02 23:36
---
Фаза 3 (Code) выполнена. orchestrator.ts: startPhase получил необязательный onExit?: PhaseExitCallback — вызывается в finish() ровно один раз (finish-once guard сохранён: error+close) с PhaseRun {exitCode, logTail}; ошибки колбэка в try/catch не роняют polling; прежние вызовы (web api.ts) без изменений. handlers.ts: sendText(bot, chatId) + sendTaskView(bot, chatId, task, phaseRun) — богатая карточка как в /task (rich + строка фазы, фолбэк MarkdownV2); /task переведён на sendTaskView (контент идентичен уведомлению); /spec передаёт onExit: итог (✅/⚠️ + код), ответ qwen в pre-блоке (урезка 3000 символов), карточка задачи через getTask (файл мог изменить qwen). Тесты: +1 юнит onExit (orchestrator.test.mjs). Проверки: orchestrator 7/7, smoke 9/9 (успех: итог+pre+rich+строка фазы; падение заглушки: код 3, ошибка в pre, карточка; все сообщения в чат 12345), pnpm test 366/366.
---
<!-- COMMENTS:END -->