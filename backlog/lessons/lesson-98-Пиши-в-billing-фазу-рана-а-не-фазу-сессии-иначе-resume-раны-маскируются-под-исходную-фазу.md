---
id: lesson-98
title: 'Пиши в billing фазу рана, а не фазу сессии — иначе resume-раны маскируются под исходную фазу'
status: active
tags:
  - billing
  - фазы
  - resume
  - мета
source_tasks: []
linked_tasks:
  - VL-243
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Журнал billing (`.vibelog/billing/<ID>.json`) — источник правды по ранам, но обе точки учёта брали фазу ИЗ МЕТЫ сессии, а не из текущего запуска:

- `src/agent/cli.ts` — `phaseName = existing?.phase ?? …`;
- `src/web/orchestrator.ts` — `usagePhase = metaNow?.phase ?? phase`.

Правило «resume-ран не перезаписывает мету» (lesson-40/VL-187) писалось про мету и `/analyze`, но было механически перенесено на billing. Итог: при `code_same_session: true` code-ран идёт `--resume` план-сессии, и его запись помечалась `plan` с тем же `sessionId` — в журнале VL-227 видно «plan, две записи», а `code`-раны нет. Дефект выглядел как «потеря записи», хотя запись была, но неверно атрибутирована (диагностика заняла два рана).

## Решение

`phase` записи billing = фаза РАНА (`phase`/позиционны/env), исходная фаза сессии — в необязательном `sessionPhase` (только если отличается). Frontmatter (`by_phase`) остаётся на фазе сессии — там кумулятив, lesson-40 сохраняется.

```ts
const runPhase = phase ?? (isPhaseMode ? positionals[0] : process.env.VIBELOG_PHASE_NAME) ?? phaseName;
appendBilling(taskCwd, taskId, {
  sessionId,
  phase: runPhase,
  ...(phaseName && phaseName !== runPhase ? { sessionPhase: phaseName } : {}),
  // …
});
```

## Дополнительно (тот же инцидент)

Close терял учёт целиком: `phaseTaskId` в `spawnQwenRun` исключал close (`phase !== 'close'`), из-за чего в `finish()` и CLI-пост-ране не резолвился taskId. Worktree-исключение close (VL-112) надо было держать отдельным флагом (`noWorktree`/`branchTask`), а не общим выражением, которое кормит ещё и учёт.

## Пример проверки

Тест-инвариант: два рана одной сессии (`plan`, затем resume с env `code`) → в billing две записи: `{phase:'plan'}` и `{phase:'code', sessionPhase:'plan'}`, мета по-прежнему `phase:'plan'`.
