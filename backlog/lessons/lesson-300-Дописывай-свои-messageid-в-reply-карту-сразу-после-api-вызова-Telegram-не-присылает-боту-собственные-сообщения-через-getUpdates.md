---
id: lesson-300
title: 'Дописывай свои message_id в reply-карту сразу после api-вызова: Telegram не присылает боту собственные сообщения через getUpdates'
status: active
tags:
  - telegram
  - interbot
  - bot
  - loop
  - depth
source_tasks:
  - VL-434
linked_tasks:
  - VL-434
created_date: 2026-11-19
updated_date: 2026-11-19
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
В interbot-шторме (VL-434) depth-лимит не срабатывал: replyDepth шёл по interbotReplyMap, которая наполнялась ТОЛЬКО из входящих апдейтов Telegram, а собственные сообщения бота в getUpdates не приходят — цепочка обрывалась на своём сообщении-ответе, depth всегда = 1, limit 2 мёртв. Петлю замыкало и то, что служебная ошибка старта публиковалась в группу как полноценный ответ и читалась чужим ботом как вопрос.

## Решение
Telegram не доставляет боту через getUpdates его же отправленные сообщения: любая in-memory карта цепочек/истории, наполняемая только из входящих апдейтов, обрывается на собственных ответах. Дописывай свои message_id → reply_to в карту прямо в точке отправки, сразу после api-вызова вернул message_id (паттерн: rememberReplyPair(map, ids, replyTo) с FIFO-саниткой ≤5000), а служебные технические тексты (ошибки старта, «⚠️ Не удалось…») не публикуй в общий канал и не диспатчь на стороне получателя.

## Пример
VL-434: interbotReplyMap наполнялась только из апдейтов (`interbotReplyMap.set(m.message_id, m.reply_to_message.message_id)`) — depth замирал на 1 на собственном ответе бота, limit 2 не срабатывал и два бота крутили 73-секундный шторм; фикс — `rememberReplyPair(interbotReplyMap, ids, replyTo)` в 4 точках после `sendChatAnswer`.