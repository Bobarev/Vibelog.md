---
id: lesson-91
title: 'Вставляй предупреждение модели одним user-сообщением после всех tool-результатов хода, а не между ними'
status: active
tags:
  - agent
  - loop
  - transcript
  - guard
source_tasks:
  - VL-229
linked_tasks:
  - VL-229
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Чтобы подсказать модели «ты повторяешься», хочется вклинить user-сообщение сразу после соответствующего tool-результата. Но провайдер валидирует паринг: каждый `assistant` с `tool_calls` обязан иметь **подряд** идущие `tool`-результаты для всех call_id. Вставка user-сообщения между ними ломает запрос (400 от API).

## Решение

Собирай предупреждения в массив в течение всего цикла `for (const call of validCalls)`, а после цикла отправляй **одно** `role: 'user'` сообщение со склеенными строками. Обязательно кап на ран (например, 15 предупреждений), чтобы не раздувать контекст.

## Пример

```ts
const warnings: string[] = [];
for (const call of validCalls) {
  // ... tool-результаты пушатся как обычно
  const w = guard.note(call.name, call.arguments ?? {});
  if (w) warnings.push(w);
}
if (warnings.length) {
  pushMessage({ role: 'user', content: warnings.slice(0, REPEAT_WARN_MAX_PER_RUN).join('\n') });
}
```

Счётчик guard'а держи в пределах рана (сбрасывается на resume): иначе после «Продолжи» модель получит предупреждения за действия прошлого рана. Метрику при этом считай по всей сессии — асимметрия осознанная, её надо описать в JSDoc.
