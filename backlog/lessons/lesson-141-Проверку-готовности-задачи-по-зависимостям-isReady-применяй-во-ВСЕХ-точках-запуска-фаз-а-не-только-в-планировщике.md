---
id: lesson-141
title: 'Проверку готовности задачи по зависимостям (isReady) применяй во ВСЕХ точках запуска фаз, а не только в планировщике'
status: active
tags:
  - supervisor
  - deps
  - wake-gate
  - healing
source_tasks:
  - VL-275
linked_tasks:
  - VL-275
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

VL-239 (фаза `code`) 7 раз подряд не дала прогресса при незакрытой зависимости
VL-209, которой в прогоне не было. Супервизор лечил это как «нет прогресса»
(правило `no-progress` → `retry_once_then_bug`): перезапускал фазу, сжигал
`heal_attempts` и в итоге завёл авто-баг. Причина была внешней (зависимость),
перезапуск её устранить не мог.

Корень: проверка готовности была размазана по точкам запуска фаз.

- `src/web/supervisor.ts` (`buildSupervisorPlan`) — фильтрует `isReady` ✅
- `src/core/auto-queue.ts` (`pickNextQueueTask`) — фильтрует `isReady` ✅
- `src/web/supervisor-tick.ts` (сбор `candidates` для тика) — НЕ фильтровал ❌:
  брал все не-терминальные задачи прогона и пушил их в `planParallel` →
  запуск групп.

## Решение

1. Единая точка правды — `isReady` (`src/core/deps.ts`): если её применяют
   планировщик и автоочередь, её обязан применять и тик. Одна проверка
   покрывает и внешние блокеры, и блокеры внутри прогона.
2. Заблокированную задачу держать в состоянии `pending` (НЕ `failed`) с
   заполненным `blockedBy` — иначе следующая ветка кода (общая для `failed`)
   снова затащит её в лечение.
3. Фильтр ставить ДО формирования списка «упавших на лечение» (`l2Tasks`):
   проверка после него уже бесполезна — задача попадёт в лечение раньше.
4. Поле `blockedBy` включать в `snapshotKey` wake gate. Снятие блокировки
   меняет только статус блокера — у самой задачи статус/фаза не меняются;
   без элемента ключа тик счел бы состояние неизменным и не запустил
   разблокированную задачу.
5. Защита-в-глубину в `applyHealAction`: не перезапускать фазу, если в
   состоянии непустой `blockedBy` (модель уровня 2 могла решить «retry»).
6. Причина в heartbeat отдельной секцией («Заблокированы зависимостями»):
   «нет прогресса» и «ждёт зависимость» — разные диагнозы, и лечатся они
   по-разному.

## Пример

```ts
// supervisor-tick.ts, после state.tasks[key] = entry и ДО l2Tasks/candidates
if (!entry.frozen && entry.status !== 'running') {
  const blockers = blockedBy(cwd, task)
    .filter(d => d.status !== 'Done' && d.status !== 'Completed' && d.status !== 'Rejected')
    .map(d => canonicalTaskId(d.id));
  if (!isReady(cwd, task) && blockers.length > 0 && !terminal) {
    entry.blockedBy = blockers;
    entry.status = 'pending';        // не failed: задача не падала
    entry.pid = undefined;
    result.blocked.push({ taskId: key, blockers });
    continue;                        // ни в лечение, ни в запуск
  }
  delete entry.blockedBy;            // зависимости закрылись — снова доступна
}
```

## Диагностический признак

Долгая серия одинаковых «нет прогресса» по одной задаче при неизменном
статусе — повод проверить `isReady`/`blockedBy`, прежде чем крутить
`heal_attempts`: если задача структурно не может дать прогресс, лечение
только сжигает бюджет и порождает авто-баги.