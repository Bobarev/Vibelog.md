---
id: lesson-144
title: 'Если поведение зависит от статуса задачи, вынеси условие в один хелпер и зови его из всех путей создания — иначе «фаза vs чат» даст разное окружение'
status: active
tags:
  - worktree
  - branch-mode
  - оркестратор
  - рефакторинг
  - workflow
source_tasks:
  - VL-278
linked_tasks:
  - VL-278
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Worktree `vb/<id>` создавался только в одной ветке кода — оркестратором при запуске фазы `plan`/`do`. Второй путь появления задачи в том же статусе (создание из чата через `backlog_create_task` сразу в Planned, когда spec уже выполнен ролью Архитектор) в эту ветку не попадал: фаза `plan` для такой задачи никогда не запускалась, `code` шёл в главном рабочем дереве без изоляции, close брал шаблон без merge-шага. Одинаковый статус задачи давал разные условия работы в зависимости от того, каким путём её создали — «одна задача = одна ветка = изолированный worktree» тихо отключалось (наблюдено на VL-277).

## Решение

Условие «нужно ли поднимать worktree» сделать ОДНИМ экспортируемым хелпером в core (`shouldEnsureWorktree(cwd, taskId, trigger)` с дискриминированным union-триггером `{kind:'phase', phase}` | `{kind:'create', status}`), а собственные копии условия в вызывающих местах удалить — оркестратор фаз и путь создания задачи зовут один и тот же код. Статус «эквивалент plan выполнен» не хардкодить строкой «Planned», а брать из workflow задачи (`produces_status` перехода фазы plan через `getWorkflowForTask`), иначе кастомные workflow разъедутся.

## Пример

```ts
// src/core/worktree.ts — единственное место условия
export function shouldEnsureWorktree(cwd, taskId, trigger: WorktreeTrigger): boolean {
  if (!resolveBranchMode(cwd)) return false;      // branch-mode выключен
  if (getTaskType(taskId) === 'epic') return false; // эпик — исключение
  if (wtExists) return true;                      // ensure идемпотентен
  if (trigger.kind === 'phase') return WORKTREE_CREATING_PHASES.includes(trigger.phase);
  return trigger.status === planProducesStatus(cwd, task); // create
}
```

Тот же хелпер полезен как чек-лист: пункт «все шаги запуска plan» проверяется тем, что оба пути идут через `ensureTaskWorktree` (симлинки `linkWorktreeDeps` достаются бесплатно), а build при создании не вызывается — как и при штатном plan. Ошибка git — fail-open: задача создаётся, предупреждение в ответ, диагностика в stderr.
