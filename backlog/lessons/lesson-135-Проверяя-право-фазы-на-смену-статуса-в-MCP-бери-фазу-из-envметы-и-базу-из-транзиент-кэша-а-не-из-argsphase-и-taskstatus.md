---
id: lesson-135
title: 'Проверяя право фазы на смену статуса в MCP, бери фазу из env/меты и базу — из транзиент-кэша, а не из args.phase и task.status'
status: active
tags:
  - mcp
  - workflow
  - phase
  - guard
  - transient
source_tasks:
  - VL-245
linked_tasks:
  - VL-245
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

`backlog_finish_phase` валидировал статус только по `config.statuses`, поэтому служебная фаза `comment` выставила `Done` незавершённой задаче (VL-219/VL-231): инварианты workflow (`SERVICE_PHASES`, `getStatusAfterPhase`) проверял только оркестратор. При добавлении проверки на границе MCP всплывают две ловушки:

1. **Фаза из аргумента инструмента — дыра.** Поле `phase` в схеме существует для учёта `token_usage.by_phase` (VL-259) и его подставляет модель. Если guard читает `args.phase`, агент сам себе выписывает разрешение, передав `phase: "close"` вместе с `status: "Done"`.
2. **`task.status` — не та база для проверки во время рана.** Транзиент VL-196 временно переводит задачу в `In Progress`, а агент передаёт `produces_status`, посчитанный от ИСХОДНОГО статуса (шаблон подставляет `{{producesStatus}}` до спавна). Проверка «In Progress + close → Done» отклонила бы все штатные раны.

## Решение

- Фазу резолви только из доверенных источников: `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` (кроме служебного `prompt`) → `meta.lastRunPhase` → `meta.phase` (мета из `agentSessionsDir(VIBELOG_CWD ?? cwd)`, lesson-13). Фаза не резолвится (сторонний MCP-клиент) → **fail-open**: прежнее поведение по `config.statuses`, иначе ломаются внешние интеграции.
- Базой проверки делай статус ДО фазы из `.vibelog/phase-in-progress.json` (инвариант «запись в кэше ⇔ In Progress», VL-196): `getPhaseTransientStatus(cwd, id, phase)` вернёт `prevStatus` только если запись принадлежит той же фазе, иначе `null` → проверка от `task.status`.
- Вынеси правило в чистую функцию (`phaseStatusTransitionError(workflow, currentStatus, phase, requestedStatus)`) в `core/workflow.ts` — это unit-тестируется без fs и без MCP-сервера, а `toolFinishPhase` вызывает её одной строкой.
- Форма отказа — строка в `errors[]` сводки (частичное применение, как у невалидного статуса), не `isError`: бросок зацикливает модель (lesson-92).

## Пример

`src/mcp/tools.ts` (VL-245), внутри ветки «статус валиден по конфигу»:

```ts
const guardPhase = resolveGuardPhase(cwd); // env → мета, НЕ args.phase
const transitionError = guardPhase
  ? phaseStatusTransitionError(
      getWorkflowForTask(cwd, task),
      getPhaseTransientStatus(cwd, id, guardPhase) ?? task.status, // база: до фазы
      guardPhase,
      args.status,
    )
  : null;
if (transitionError) errors.push(transitionError);
else { updates.status = args.status; statusPart = `Статус: ${args.status}`; }
```

Тесты: `src/core/workflow.test.mjs` (pure-функция), `src/core/phase-transient.test.mjs` (`getPhaseTransientStatus`), `src/mcp/server.test.mjs` — новый `describe` в КОНЦЕ файла (его `beforeAll` расширяет statuses фикстуры, не задевая остальные кейсы) + кейс fail-open без env фазы.

## Применять

При любой проверке «имеет ли право вызывающий (фаза, агент, роль) на операцию» в MCP-инструменте: контекст вызывающего бери из env/меты процесса, а не из аргументов вызова; состояние бери из межпроцессного кэша, если процесс-хозяин временно изменил его (транзиент); и всегда предусматривай fail-open для ручных вызовов вне оркестратора.