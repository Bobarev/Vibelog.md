---
id: lesson-215
title: 'Отвязывай долгий ход от HTTP-запроса: реестр прогонов + подписка, иначе смена UI-контекста теряет результат'
status: active
tags:
  - web
  - chat
  - sse
  - architecture
source_tasks:
  - VL-332
linked_tasks:
  - VL-332
created_date: 2026-11-04
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Долгий серверный ход (LLM-стрим веб-чата) жил внутри HTTP-запроса: `POST /api/chat` запускал генератор и писал SSE прямо в `res`, а `break` при `res.destroyed` завершал цикл. Клиент передавал в `fetch` `signal: options.abortSignal`, и при смене треда провайдер размонтировался вместе с рантаймом → запрос абортился → ход не выполнялся и не попадал в `jsonl`. При возврате в тред оставалось только сообщение пользователя без ответа, F5 не помогал.

## Решение

Отвязать прогон от запроса: реестр активных прогонов на сущность (тред) в `src/web/chat-runs.ts` — `startChatRun` создаёт запись и запускает продюсер, который **не зависит от потребителя**; HTTP-роут лишь подписывается (`subscribeChatRun(run, sinceIndex, onEvent)`), а при `res.destroyed` делает `unsubscribe`, не отменяя прогон. Повторный `startChatRun` по тому же треду возвращает существующий прогон (джойн вместо второго LLM-цикла). Состояние хода — sidecar-файл `<threadId>.turn.json` с точкой в имени (чтобы листинг тредов его не видел) — переживает F5 и перезапуск сервера; «осиротевший» `running` при старте сервера переводится в `interrupted`. Записи в `jsonl` остаются внутри продюсера, поэтому история полна независимо от того, открыт ли тред в UI.

## Пример

`src/web/server.ts`: `POST /api/chat` → `startChatRun(body, cwd, deps)` → стрим с `sinceIndex`, без `cancel` при разрыве соединения; `GET /api/chat/threads/:id/stream?since=N` — переподключение без дублей; `GET /api/chat/threads/:id` отдаёт `run: {status, startedAt, finishedAt?}` из `turn.json`. Клиент: `fetch` без `options.abortSignal`, module-level реестр «в полёте» на тред и индикатор «Ассистент отвечает…».
