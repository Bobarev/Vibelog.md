---
id: lesson-174
title: 'Отдавай noop write-вызова как isError с явным следующим шагом, а повтор применённого вызова завершай штатно (is_error:false), не дожидаясь fail'
status: active
tags:
  - mcp
  - loop-detection
  - tool-result
  - agent
  - isError
  - auto-report
source_tasks:
  - VL-304
linked_tasks:
  - VL-304
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: lesson-173
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Фикс VL-303 не устранил падение фазы (VL-304, сессия `agent-1793631554185`, Spec для VL-302): модель 4 раза повторила применённый `backlog_update_task {id, type}`, директива «переходи к отчёту» проигнорировалась, фаза упала кодом 1.

Три дефекта самого фикса:

1. `ackNoop` отдавал `{ok: true, noop: true}` — модель видит `ok:true` в первой строке JSON и читает как «принято, продолжай», а текст «не повторяй» лежит в третьем поле `message`. Нейтральный успех порождает луп (lesson-92).
2. После первой директивы `appliedNoopDirective` цикл спрашивал модель ещё `MAX_APPLIED_REPEATS_PER_RUN = 3` раза и затем делал `fail()`, хотя работа уже была сделана.
3. `buildAutoReport` (VL-253) работал только внутри `backlog_finish_phase` — если модель до него не дошла, авто-отчёта нет: статус/AC/DoD висят (VL-302 осталась в To Do).

## Решение

1. **Noop = isError на транспортной границе.** `ackNoop` → `{ok: false, noop: true, reason: 'noop', message, applied, skipped: []}`; MCP-сервер ставит `isError: true` через экспорт `isNoopAck(text)`; `mcp-client` возвращает структурный JSON-ack без префикса «Ошибка MCP-инструмента», чтобы `JSON.parse` в loop сработал. Сообщение содержит маркеры «Изменений нет» и «Следующий шаг: backlog_finish_phase».
2. **Повтор применённого вызова = штатный выход.** Кап `MAX_APPLIED_REPEATS_PER_RUN` и счётчик `appliedRepeatCount` удалены; первая же повторённая сигнатура из `appliedSignatures` → директива tool-результатом + `finishAppliedRepeat()` с `is_error:false` (дописывает assistant-сообщение — контракт VL-95/VL-103). Детект применённого расширен на `noop === true` (теперь `ok:false`).
3. **Авто-отчёт в пост-ране CLI** (`writeAutoReportIfMissing` в `src/agent/auto-report.ts`): пропуск при `isError`, служебной фазе, уже записанном отчёте (guard по последнему `@agent`-комментарию `created >= runStartedAt`); статус — `getStatusAfterPhase`. Вызывается до `recordRunProgress`/`finalizePhaseStatus`. Неотмеченные AC/DoD перечисляются в тексте отчёта (авто-отметка — ложное заявление, lesson-140/VL-248).

## Пример

```ts
// server.ts: транспортная граница ставит isError
const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
send(id, { content: [{ type: 'text', text }], ...(isNoopAck(text) ? { isError: true } : {}) });

// loop.ts: первый повтор применённого вызова — штатный выход
if (appliedSignatures.has(signature)) {
  blockAndPush(); // директива ушла tool-результатом
  return finishAppliedRepeat(call.name); // is_error: false
}
```

Регресс-тест воспроизводит сессию: 3 noop + 4× `{id, type}` → `is_error === false`, `state.calls === 4`, транскрипт заканчивается assistant-сообщением, авто-отчёт записан без `finish_phase`.