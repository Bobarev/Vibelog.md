---
id: lesson-126
title: 'Дели per-call таймаут и общий бюджет хода: перевзводи таймер на каждый onToken, иначе живой стрим умирает'
status: active
tags:
  - web
  - chat
  - limits
  - timeout
  - stream
source_tasks:
  - VL-269
linked_tasks:
  - VL-269
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

В веб-чате один таймаут (120 с) резал весь ход, включая серию быстрых tool-вызовов: медленный, но живой стрим (токены капают) убивался как «зависший», и пользователь десятками раз писал «Продолжи».

## Решение

Разделяй два ограничения и храни оба в конфиге: `call_timeout` — тишина на ОДНОМ вызове модели (таймер перевзводится на каждый `onToken`), `max_wall_time` — общий бюджет хода. Таймаут одного вызова не должен ронять ход: отдавай событие `truncated` (reason `wall_time`/`iterations`, признак `saved`), клиент сам повторяет `POST /api/chat` с `continue: true` до `max_auto_continue` раз, и только после исчерпания показывает кнопку «Продолжить». Валидацию лимитов держи в чистом модуле с инъекцией `now`/таймеров — иначе тесты на время флакуют.

## Пример

VL-269: `src/web/chat-limits.ts` — `resolveChatLimits(cwd)` на каждый POST (не кэшируется, мусор → дефолт + предупреждение), `createCallGuard(callTimeoutMs)` с `noteActivity()` из `onToken`; `MAX_LLM_ITERATIONS`/`MAX_WALL_TIME_MS` из `src/web/chat.ts` удалены.
