---
id: lesson-216
title: Проверяй проброс необязательных пропсов-колбэков в React-точке рендера статическим тестом по исходнику
status: active
tags:
  - web
  - react
  - props
  - тесты
  - статический-контракт
source_tasks: []
linked_tasks:
  - VL-334
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Карточка `PricingDriftCard` (VL-317) принимала необязательный проп `onContinue?: () => void` и вызывала `onContinue?.()` — компилируется без ошибок, веб-сборка чистая, а в точке рендера (`thread.tsx`, ветка `CHAT_PRICING_PART`) проп просто не передавали. Кнопка «Продолжить» навсегда оставалась мёртвой: решение уходило на сервер, а ход не стартовал. Необязательный проп + optional chaining прячут такой баг от typecheck: TypeScript считает отсутствие аргумента легальным.

## Решение

Когда колбэк — единственный путь выполнения пользовательского действия, дублируй проверку на уровне исходника точкой рендера: статический тест читает текст `thread.tsx` и требует и `aui.message.reload()`, и `onContinue={onContinue}` в том же файле. Такой тест падает ровно на исходном баге и не ловится ни компилятором, ни юнит-тестом чистой логики. Заодно в рендер-компоненте переиспользуй существующий путь перезапуска (`useAui().message.reload()`), а не заводи свой.

## Пример

`src/web/chat-pricing-card.test.mjs`: читает `web/src/components/chat/thread.tsx` и `web/src/components/chat/pricing-drift-card.tsx` через `readFileSync`, проверяет наличие `onContinue={onContinue}`, `aui.message.reload()`, `onContinue?.()`, а также что кнопка «Продолжить и обновить тариф» лежит внутри ветки `kind === "ask"`. Убираешь `onContinue` из `thread.tsx` — тест краснеет.
