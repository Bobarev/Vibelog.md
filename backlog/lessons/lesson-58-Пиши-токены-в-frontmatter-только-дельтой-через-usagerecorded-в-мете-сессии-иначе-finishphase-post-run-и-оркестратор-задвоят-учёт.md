---
id: lesson-58
title: 'Пиши токены в frontmatter только дельтой через usage_recorded в мете сессии — иначе finish_phase, post-run и оркестратор задвоят учёт'
status: active
tags:
  - billing
  - sessions
  - tokens
  - idempotency
  - mcp
source_tasks:
  - VL-198
linked_tasks:
  - VL-198
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

Учёт токенов пишется из трёх мест (backlog_finish_phase, post-run в cli.ts, finish-блок оркестратора), причём finish_phase вызывается до конца рана. Прямая запись суммы в frontmatter даёт тройной/двойной учёт одних и тех же токенов.

## Решение

Храни в SessionMeta поле `usage_recorded` (сколько уже перенесено в frontmatter) и записывай только дельту: `delta = usage − usage_recorded` (поэлементный max(0,…)). После записи обновляй `usage_recorded = usage` через merge (updateSessionMeta, lesson-40). Повторный вызов с той же сессией → дельта 0 → без записи и без ошибки.

## Пример

```ts
const delta = usageDelta(usage, meta.usage_recorded ?? emptyUsage());
if (delta.total > 0) {
  addTaskTokenUsage(cwd, taskId, phase, delta, durationMs);
  await updateSessionMeta(dir, sessionId, { usage_recorded: usage });
}
```

Аналогичный приём: append-only `.vibelog/billing/<taskId>.json` — каждая запись это usage за ран (а не кумулятив), при суммировании двойного счёта не возникает.