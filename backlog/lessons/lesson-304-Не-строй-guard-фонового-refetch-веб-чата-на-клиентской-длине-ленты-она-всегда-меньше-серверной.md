---
id: lesson-304
title: Не строй guard фонового refetch веб-чата на клиентской длине ленты — она всегда меньше серверной
status: active
tags:
  - web
  - chat
  - refetch
source_tasks:
  - VL-439
linked_tasks:
  - VL-439
created_date: 2026-11-20
updated_date: 2026-11-20
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Фоновый refetch веб-чата (VL-431) сравнивал data.messages.length с клиентской baseCount — условие «сервер больше клиента» истинно всегда: historyToMessages сливает tool-строки jsonl в assistant-части, поэтому клиентская load.messages.length (170) на живом треде необратимо меньше серверной (306 = 36 user + 134 assistant + 136 tool), setRetry срабатывал каждый тик и страница висела в вечной «Загрузка треда…».

## Решение
Базой guard-а сделали серверскую длину истории, зафиксированную при загрузке (ChatLoadState.serverCount, 0 для нового треда), deps эффекта refetch — по ней; после локального хода refreshRunState догоняет serverCount до нового значения, чтобы лента не мелькала лишним ререндером.

## Пример
Живой тред VL-439: сервер отдаёт 306 сообщений (36 user + 134 assistant + 136 tool), клиентская лента — 170 (36 + 134); до фикса «Загрузка треда…» циклилась каждые 5 секунд, после перевода guard'а на serverCount — 0 повторов за 25 с наблюдения.