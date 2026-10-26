---
id: lesson-37
title: 'Дублирующуюся логику фаз бота и веба выноси в общий модуль при первом праве, а не держи копиями'
status: active
tags:
  - дублирование
  - bot
  - web
  - фазы
  - agent
  - refactor
source_tasks:
  - VL-180
linked_tasks:
  - VL-180
  - VL-189
created_date: 2026-10-25
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

Ветка VL-180: бот использовал `resolveDefaultAgent(cwd)` (настройки проекта), а веб-API в `src/web/api.ts` захардкодил `'qwen'` в `startPhase` и `rejectTask`; маппинг «статус → следующая фаза» жил копиями в `src/bot/rich.ts` и `web/src/lib/phase-buttons.ts` («КОПИЯ логики бота»). Две копии одной функциональности разошлись — бот и браузер работали по-разному.

## Решение

Дублирующуюся между ботом и вебом логику фаз выноси в общую точку при первом же праве: дефолт агента — только через `resolveDefaultAgent(cwd)` (включая дефолты параметров `agent: 'qwen'` в orchestrator), запуск «комментарий → фаза» — общий хелпер `startTaskPhase` в `src/web/orchestrator.ts`, маппинг фаз — чистый модуль `src/core/phase-buttons.ts` с ре-экспортом из `src/bot/rich.ts` и `web/src/lib/phase-buttons.ts` (без enum/export-значений — под `verbatimModuleSyntax`/`erasableSyntaxOnly` web).

## Пример

```ts
// Общий хелпер (orchestrator.ts) — вызывают и api.ts, и bot/handlers.ts:
export function startTaskPhase(cwd, taskId, phase, opts?) {
  const agent = opts?.agent ?? resolveDefaultAgent(cwd);
  if (opts?.comment?.trim()) addComment(cwd, taskId, opts.comment);
  return startPhase(cwd, taskId, phase, opts?.onExit, opts?.comment ? { comment: opts.comment } : undefined, agent, { sameSession: opts?.sameSession });
}
```
