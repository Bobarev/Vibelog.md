---
id: lesson-175
title: 'Отделяй noop-сигнатуры от применённых: повтор noop не завершает ран штатно, а авто-отчёт не ставит терминальный статус при неотмеченных AC/DoD'
status: active
tags:
  - agent
  - loop-detection
  - noop
  - auto-report
  - status
source_tasks:
  - VL-309
linked_tasks:
  - VL-309
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

VL-304 считал noop-ответ (`ok:false` + `reason:'noop'`) «применённым вызовом»: сигнатура попадала в `appliedSignatures`, и первый же повтор завершал ран через `finishAppliedRepeat` (`is_error:false`). В Close VL-307 модель повторила `lesson_update` с теми же аргументами, получила noop → ран «успешно» закончился, хотя документация не написана, AC5/DoD2 не отмечены. Noop означает «изменений нет», а не «работа сделана» — штатный выход на нём превращает незавершённую фазу в ложный успех.

## Решение

Держи два независимых набора сигнатур: `appliedSignatures` только для `ok:true` (повтор → штатный `finishAppliedRepeat`, контракт VL-304), `noopSignatures` для `noop:true` (повтор → `noopRepeatDirective` tool-результатом «Изменений нет … Следующий шаг: переходи к следующему пункту фазы», счётчики блокировок не растут, цикл **продолжается**). Круг «noop → повтор» ограничивай отдельным капом (`MAX_NOOP_REPEATS_PER_RUN`) и по его исчерпании делай честный `fail()` (`is_error:true`), чтобы оркестратор откатил статус и запустил авто-resume.

## Пример

```ts
if (noopSignatures.has(signature)) {
  await blockAndPush();                       // директива «Изменений нет»
  if (noopRepeatCount > MAX_NOOP_REPEATS_PER_RUN) return fail('… фаза прервана (работа не завершена)');
  continue;                                    // ран ПРОДОЛЖАЕТСЯ
}
if (appliedSignatures.has(signature)) return finishAppliedRepeat(call.name); // только ok:true
```

Дополнение (той же задачей): авто-отчёт пост-рана не должен ставить терминальный статус, пока есть неотмеченные AC/DoD — `isTerminalStatus(workflow, next)` + списки неотмеченных → статус остаётся прежним, причина пишется в отчёт («только через backlog_finish_phase с dodOverride/aborted», VL-248).
