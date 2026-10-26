---
id: lesson-55
title: 'Детектируй content-based отказ провайдера в точке финализации loop, а не только по HTTP-статусу'
status: active
tags:
  - agent
  - loop
  - llm
  - orchestrator
  - high-risk
  - auto-resume
source_tasks:
  - VL-199
linked_tasks:
  - VL-199
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

Отказ провайдера «The request was rejected because it was considered high risk» приходит валидным финальным assistant-текстом при HTTP 200 без tool_calls (инцидент VL-197). loop.ts трактовал такой ответ как успех (is_error=false, exit 0), поэтому guard авто-resume в orchestrator.ts, требующий `is_error===true`, не срабатывал — фаза завершалась ложным успехом без повторной попытки.

## Решение

Сверяй финальный текст с `isHighRiskBody` **в loop.ts перед финализацией ответа** (ветка `toolCalls.length === 0`, до pushMessage) и уходи в `fail()` — так в result попадают `is_error=true` И маркер high-risk, который матчит существующий guard оркестратора без его правки. Диагностику (payload/usage) логируй отдельно в llm.ts через stderr → logTail: управление и наблюдаемость — разные задачи, двойной лог корректен.

## Пример

```ts
// loop.ts, в ветке финализации:
if (isHighRiskBody(response.text)) {
  return fail(`Отказ провайдера «high risk»: ${response.text.slice(0, 300)} — фаза прервана как ошибка (VL-199).`);
}
```

Guard оркестратора и shrink-цикл llm.ts не трогаем — их поведение уже покрыто тестами, правки там рискуют регрессией.