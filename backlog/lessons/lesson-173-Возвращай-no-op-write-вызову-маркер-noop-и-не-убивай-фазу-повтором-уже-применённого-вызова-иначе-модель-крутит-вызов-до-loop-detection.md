---
id: lesson-173
title: Возвращай no-op write-вызову маркер noop и не убивай фазу повтором уже применённого вызова — иначе модель крутит вызов до loop detection
status: active
tags:
  - mcp
  - loop-detection
  - tool-result
  - agent
source_tasks:
  - VL-303
linked_tasks:
  - VL-303
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Фаза падала с «Loop detection: … вызван 3 раза подряд с одинаковыми аргументами», хотя все изменения задачи уже были применены (VL-303, сессия `agent-1793628348682`, Spec для VL-302).

Две причины сложились:

1. `backlog_update_task` **всегда** вызывал `updateTaskFile` и отвечал `ackOk("Задача X обновлена: type")`, даже когда переданные значения уже совпадали с текущими. Модель видела «применено» вместо «нечего делать» и повторяла вызов.
2. Детектор лупа (VL-253) на второй блокировке той же сигнатуры делал `fail()`, не различая «вызов бесполезен» и «вызов уже дал результат». Итог: фаза формально упала при фактически записанных title/type/priority/labels.

Текстовые директивы в промпте (VL-292: «выполняй ОДНИМ вызовом», «читай applied») проблему не решают — модели нужна обратная связь о состоянии, а не текст.

## Решение

1. **No-op write-вызов отвечает явным маркером.** Отдельная функция `ackNoop(message, applied)` → `{ok: true, noop: true, message, applied, skipped: []}`, файл не переписывается (`updated_date` не трогается). Сообщение содержит следующий шаг: «Изменений нет: … уже имеют эти значения. Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)».
2. **Сравнение «всё уже так» — по семантике поля**, не по строке: массивы (`labels`, `assignee`, `references`, `lessons`, `modified_files`, `dependencies`) как множества (порядок не значим), `type` уже нормализован, `acceptanceCriteria` — по текстам + все текущие неотмечены, `append_notes` из noop исключён всегда (дописывание меняет файл).
3. **Loop detection не убивает фазу на применённом вызове:** `appliedSignatures` пополняется сигнатурами, чей ответ распарсился как JSON с `ok:true` (включая `noop:true`); для них `blockedStreak`/`blockedTotal` не растут, вместо `loopDetectionDirective` уходит `appliedNoopDirective` («уже применён, переходи к отчёту»), а `fail`-ветки получают условие `!appliedSignatures.has(signature)`. От вечного повтора защищает отдельный кап `MAX_APPLIED_REPEATS_PER_RUN = 3`.

## Пример

```ts
// noop: эффект уже достигнут, файл не трогаем
return ackNoop(`Изменений нет: ${keys.join(', ')} уже имеют эти значения. Не повторяй вызов — переходи к следующему шагу (backlog_finish_phase)`, currentValues);

// loop.ts: повтор применённого вызова — директива, а не fail
if (appliedSignatures.has(signature)) {
  appliedRepeatCount++;
  if (appliedRepeatCount > MAX_APPLIED_REPEATS_PER_RUN) return fail(`модель ${appliedRepeatCount} раз повторила уже применённый вызов ${call.name}`);
  return appliedNoopDirective(call.name); // fatal-счётчики не инкрементируются
}
```

Регресс-тест воспроизводит сессию: 3 вызова с разными аргументами + 3× одинаковый `{id, type}` при ответе `{ok:true, noop:true}` → `is_error === false`, повторы не исполняются, в messages есть «уже применён».
