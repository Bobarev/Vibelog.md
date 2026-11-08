---
id: lesson-254
title: В in-process MCP-тестах снимай фазовый env на уровне файла — testSpawnEnv там неприменим
status: active
tags:
  - tests
  - mcp
  - env
  - vitest
source_tasks:
  - VL-370
linked_tasks:
  - VL-370
  - VL-374
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind: workaround
---
## Проблема

`src/mcp/update-pipeline.test.mjs` вызывает `handleToolCall` **в процессе теста** (не спавн). После VL-370 ответ инструмента зависит от фазы: `getCompletenessRules` → `resolveGuardPhase` → `VIBELOG_PHASE_NAME`. Внутри фазы Close тест наследовал `VIBELOG_PHASE_NAME=close`, применялись правила `DEFAULT_COMPLETENESS.default.close` (`acceptanceCriteria` + `definitionOfDone`), а `createTaskFile` подставляет `config.definition_of_done` НЕотмеченными — неполной становилась каждая фикстура, и весь файл падал в фазе и был зелёным вне её. Env чистился только внутри одного `describe`, поэтому соседние блоки на верхнем уровне файла продолжали работать с унаследованным env: частичная изоляция хуже полного отсутствия — она маскирует дыру у остальных блоков.

## Решение

`testSpawnEnv()` (VL-286) здесь **неприменим** — он собирает env дочернего процесса, а вызовы in-process идут с `process.env` текущего процесса. Вместо него: снять фазовый env в `beforeAll` верхнего уровня файла (не внутри describe) и вернуть сохранённые значения в `afterAll`. Снимать по префиксам, а не перечислением ключей:

- `VIBELOG_CWD`, `VIBELOG_SESSION_ID`;
- всё с префиксами `VIBELOG_PHASE_` и `VIBELOG_RUN_` — новые переменные оркестратора не потребуют правок теста.

Проверка — прогон теста **внутри фазы** (`VIBELOG_PHASE_NAME=close VIBELOG_RUN_PHASE=close`), а не «просто зелёный»: вне фазы такой тест зелёный и с дырой.

## Пример

```js
// src/mcp/update-pipeline.test.mjs — верхний уровень файла, до describe
let savedEnv = {};
beforeAll(() => {
  const drop = ['VIBELOG_CWD', 'VIBELOG_SESSION_ID'];
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VIBELOG_PHASE_') || key.startsWith('VIBELOG_RUN_')) drop.push(key);
  }
  for (const key of drop) { savedEnv[key] = process.env[key]; delete process.env[key]; }
});
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[key] = value;
});
```

Системная часть (общая env-изоляция in-process тестов, а не заплатка в одном файле) вынесена в VL-374.
