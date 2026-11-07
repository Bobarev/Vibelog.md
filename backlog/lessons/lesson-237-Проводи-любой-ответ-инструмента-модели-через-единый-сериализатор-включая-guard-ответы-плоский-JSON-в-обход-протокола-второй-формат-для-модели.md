---
id: lesson-237
title: 'Проводи любой ответ инструмента модели через единый сериализатор, включая guard-ответы: плоский JSON в обход протокола — второй формат для модели'
status: active
tags:
  - tool-outcome
  - serializeAck
  - web-chat
  - single-source-of-truth
source_tasks:
  - VL-359
linked_tasks:
  - VL-359
  - VL-361
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

VL-357 ввёл единый исход ответа инструмента (`outcome`), но guard-ответы веб-чата (`duplicateCallResult`, `limitCallResult`, `noopRepeatCallResult` в `src/web/tool-dedup.ts`) продолжали отдавать плоский JSON `{ok:false, duplicate:true}` в обход сериализатора. Модель в веб-чате видела два формата ответов: инструменты — с `outcome`, guard — без. Протокол объявлен единственным источником правды, а половина ответов шла мимо него.

## Решение

Любой ответ, который уходит модели, идёт через один сериализатор — включая ответы рантайма (guard дедупа, лимиты, блокировки). Если сериализатор не умеет служебные поля, добавить аддитивное `extra` и дописывать его ключи, НЕ перезаписывая вычисленные из `outcome`: исход остаётся единственным источником правды, а `extra` — только дополнением.

## Пример

`serializeAck({ outcome: 'rejected', reason: 'duplicate', message: '…', extra: { duplicate: true } })` — `ok:false` вычисляется из `outcome`, `duplicate:true` приходит из `extra`. Тексты `message` не менялись (инвариант VL-262). Проверка: `src/web/tool-dedup.test.mjs` (VL-326) и `src/web/chat.test.mjs` проходят без правок — значит форма совместима.
