---
id: lesson-288
title: 'Отправляй LLM-текст в Telegram через sendRichMessage (GFM), а не MarkdownV2 без экранирования'
status: active
tags:
  - bot
  - telegram
  - markdown
  - rich-message
  - llm-output
source_tasks:
  - VL-414
linked_tasks:
  - VL-414
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Текст, сгенерированный моделью (GFM: `**жирный**`, заголовки, списки, код-блоки), отправлялся в Telegram через `ctx.reply` с `parse_mode: 'MarkdownV2'` без экранирования. Telegram отвечал `400 can't parse entities`, ошибка молча ловилась и сообщение доходило plain-текстом — разметка терялась без единого сигнала в логах.

## Решение
Любой LLM-текст в бот отправляй через `bot.api.sendRichMessage(chatId, { markdown })` (GFM, текст как есть), а не через MarkdownV2-хелпер: MarkdownV2 требует экранирования спецсимволов, которого у GFM-вывода нет. Фолбэк — `splitNumbered` с лимитом 4096 (резка по строкам, не рвёт escape-последовательности) + MarkdownV2, затем plain. MarkdownV2-хелпер оставляй только для служебных сообщений, которые формирует сам бот и экранирует через `escapeMarkdownV2`.

## Пример
VL-414: `sendMd` в `src/bot/handlers.ts` делал `ctx.reply(text, {parse_mode:'MarkdownV2'})` без экранирования; ответ персоны с `**жирным**` давал `400 can't parse entities`, ошибка ловилась и текст уходил plain. Заменено на `sendChatAnswer` (`chunkRich` → `sendRichMessage`, фолбэк `splitNumbered` + MarkdownV2 → plain).