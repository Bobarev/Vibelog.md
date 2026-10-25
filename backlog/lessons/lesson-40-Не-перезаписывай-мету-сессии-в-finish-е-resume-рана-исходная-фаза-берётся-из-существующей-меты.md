---
id: lesson-40
title: Не перезаписывай мету сессии в finish()-е resume-рана — исходная фаза берётся из существующей меты
status: active
tags:
  - core
  - orchestrator
  - sessions
  - bug
source_tasks:
  - VL-187
linked_tasks:
  - VL-187
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

`finish()` оркестратора безусловно перезаписывал `<sessionId>.meta.json` полем `phase` ТЕКУЩЕГО рана. Reply-продолжение прерванной фазы из бота (`startResume`) спавнит с `phase='prompt'` — и фаза `plan` в мете сессии затиралась на `prompt`. Инцидент VL-185: `findTaskPhaseSessionSync(taskId,'plan')` перестал находить план-сессию → фаза code при включённом `code_same_session: true` запустилась в новой сессии. Обе сессии VL-185 (plan и code) в итоге имели `phase: 'prompt'`.

## Решение

В точке записи меты в `finish()` учитывай resume-раны: если `extraArgs` содержит `--resume` и мета сессии уже существует (taskId и phase непустые) — НЕ перезаписывай её, сохраняй исходную фазу/задачу. Записывай только когда меты нет (восстановление после потери). Проверяй инвариант тестом: посеял мету `phase:'plan'` → `startResume` с тем же session_id → мета всё ещё `plan`.

## Пример

src/web/orchestrator.ts, `finish()`: `const isResumeRun = extraArgs.includes('--resume'); const existing = isResumeRun ? loadSessionMetaSync(...) : null; if (existing?.taskId && existing?.phase) { /* сохраняем как есть */ } else { saveSessionMeta(...) }` — фикс VL-187 (коммит 9c22e36).