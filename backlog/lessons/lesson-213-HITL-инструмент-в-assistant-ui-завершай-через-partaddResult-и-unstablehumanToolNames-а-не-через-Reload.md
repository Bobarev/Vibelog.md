---
id: lesson-213
title: 'HITL-инструмент в assistant-ui завершай через part.addResult и unstable_humanToolNames, а не через Reload'
status: active
tags:
  - web
  - chat
  - assistant-ui
  - hitl
source_tasks:
  - VL-331
linked_tasks:
  - VL-331
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Ответ на интерактивный инструмент (`ask_user`) отправлялся из карточки через `ActionBarPrimitive.Reload`. `Reload` = `startRun` в `local-thread-runtime-core.ts`: он создаёт **новое** assistant-сообщение с `parentId` = родитель текущего, то есть sibling предыдущего ответа. В UI под вопросом появлялся переключатель веток «< 2/2 >», и выбор пользователя оказывался в соседней ветке — хотя диалог линейный.

## Решение

HITL-инструмент в assistant-ui реализуется через human-tool, а не через `Reload`: имя инструмента объявляется в `unstable_humanToolNames` у `useLocalRuntime`, а UI завершает вызов через `part.addResult(result)`. `addResult` пишет результат в тот же tool-call part того же сообщения, `_resumeIfReady` продолжает run в том же сообщении (без новой ветки), а адаптер читает ответ из `unstable_getMessage().content` — тот же приём, что уже используется для approval-гейта. Идемпотентность обязательна: Set по `toolCallId` (`sentAnswers` по образцу `sentApprovals`), иначе `addResult` + повторный вызов адаптера могут отправить ответ дважды.

## Пример

`web/src/components/chat/question-card.tsx`: `submit` вызывает `part.addResult({ answer: { id, label } })` (label — из `args.options` part'а, чтобы receipt и модель видели ту же форму, что серверный `answerToolResult`); `web/src/components/chat/chat-runtime.tsx`: `useLocalRuntime(chatAdapter, { initialMessages, unstable_humanToolNames: ["ask_user"] })` + `pendingAnswerDecision(options)` читает отвеченный part из `unstable_getMessage().content`.

## Грабля

`unstable_humanToolNames` помечен deprecated-experimental — при обновлении `@assistant-ui/react` поведение механизма надо проверять ручным сценарием (ответ кнопкой и свободным текстом, F5 на висящем вопросе).
