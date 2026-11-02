---
id: lesson-176
title: Делай noop-детекцию обязательной для каждого write-инструмента и не завершай ран на повторе применённого вызова — иначе модель крутит пустой вызов до обрыва фазы
status: active
tags:
  - mcp
  - agent-loop
  - noop
  - write-tools
source_tasks:
  - VL-310
linked_tasks:
  - VL-310
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Сессия `agent-1793637056809` (Code VL-124): 20+ дословных вызовов `document_update {id:'doc-2', type:'guide'}`, где `type` УЖЕ был `guide`. Payload вырос 267 КБ → 394 КБ, задача не доработана, а ран завершился кодом 0 с текстом «ран завершён штатно» на 4-м вызове.

Две независимые причины:
1. noop-детекция была реализована только у 2 write-инструментов из 10 (`backlog_update_task`, `lesson_update`). Остальные (`document_update`, `reference_update`, `backlog_update_status`, `backlog_update_dependencies`, `lesson_link`, `reference_link`, `milestone_rename`) отвечали `ackOk` на неизменяющих аргументах — модель не получала сигнала «изменений нет» и повторяла вызов.
2. `src/agent/loop.ts` на ПЕРВОМ повторе сигнатуры из `appliedSignatures` вызывал `finishAppliedRepeat()` → `is_error:false`. Работа при этом не была сделана: ран обрывался на середине фазы и оркестратор считал его успешным.

## Решение

1. **Noop-сравнение — общий хелпер, а не копипаста по инструментам.** `sameValue`/`sameFieldsUpToDate`/`SET_FIELDS`/`BODY_FIELD` живут в `src/mcp/tool-result.ts`; инструмент собирает `updates` (что просит модель) и снимок текущего состояния (`current`) и спрашивает «всё уже так?». Для сущностей с телом (`document.content`, `reference.description`) тело подаётся под ключом `BODY_FIELD` — иначе `content` не с чем сравнить в метаданных.
2. **Инвариант закрепляется тестом-таблицей.** `src/mcp/write-ack-contract.test.mjs`: `NOOP_SCENARIOS` (сценарий «первый вызов применяет, второй обязан ответить noop») + `NOOP_NOT_APPLICABLE` (причина, почему noop неприменим: create/remove/sync). Новый write-инструмент без записи в одной из таблиц валит тест — «пятый случай» не проскочит молча.
3. **Повтор применённого вызова не терминален.** `appliedNoopDirective` уходит tool-результатом, цикл продолжается; кап `MAX_APPLIED_REPEATS_PER_RUN = 3` считает СЕРИЮ (сбрасывается реально исполненным вызовом), при исчерпании — честный `fail()` (`is_error:true` → оркестратор откатит статус). Терминальный «штатный» выход остаётся единственному случаю — отчёт этой сессии уже записан (`reportWritten`: успешный `backlog_finish_phase`/`backlog_add_comment`).

## Пример

```ts
// src/mcp/tools.ts — document_update
const comparable: Record<string, unknown> = {};
for (const [key, value] of Object.entries(updates)) {
  comparable[key === 'content' ? BODY_FIELD : key] = value;
}
if (sameFieldsUpToDate(currentRaw, comparable, DOC_SET_FIELDS)) {
  return ackNoop('Изменений нет: … Следующий шаг: …', applied);
}
```

```ts
// src/agent/loop.ts — исход повтора применённого вызова
const appliedRepeatOutcome = (name: string): LoopResult | null => {
  if (reportWritten) return finishAppliedRepeat(name);      // отчёт на месте — можно закрывать
  if (appliedRepeatCount > MAX_APPLIED_REPEATS_PER_RUN) {
    return fail(`Модель ${appliedRepeatCount} раз подряд повторила уже применённый вызов ${name} …`);
  }
  return null;                                              // директива ушла, цикл продолжается
};
```
