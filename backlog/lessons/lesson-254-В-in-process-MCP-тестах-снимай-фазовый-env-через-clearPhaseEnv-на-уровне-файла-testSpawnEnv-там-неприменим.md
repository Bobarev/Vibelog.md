---
id: lesson-254
title: В in-process MCP-тестах снимай фазовый env через clearPhaseEnv() на уровне файла — testSpawnEnv там неприменим
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

`testSpawnEnv()` (VL-286) здесь **неприменим** — он собирает env дочернего процесса (чистая функция, `process.env` не мутирует), а вызовы in-process идут с `process.env` текущего процесса. С VL-374 в `src/test-env.mjs` есть общий хелпер:

```js
import { clearPhaseEnv } from '../test-env.mjs';
let restorePhaseEnv;
beforeAll(() => { restorePhaseEnv = clearPhaseEnv(); });
afterAll(() => { restorePhaseEnv(); });
```

`clearPhaseEnv()` мутирует `process.env` и возвращает функцию восстановления; `withCleanPhaseEnv(fn)` — то же для одного `it` (снимает env ДО `fn`, поэтому значение, выставленное внутри `fn`, действует). Снимать по префиксам, а не перечислением ключей:

- `VIBELOG_CWD`, `VIBELOG_SESSION_ID`;
- всё с префиксами `VIBELOG_PHASE_` и `VIBELOG_RUN_` — новые переменные оркестратора не потребуют правок теста.

Применять на уровне ФАЙЛА (`beforeAll`/`afterAll`), не внутри отдельного `describe`. Если в файле уже есть top-level `beforeAll`/`afterAll` — встраивать в них, а не добавлять второй (порядок хуков).

Проверка — прогон теста **внутри фазы** (`VIBELOG_PHASE_NAME=close VIBELOG_RUN_PHASE=close npx vitest run <файл>`), а не «просто зелёный»: вне фазы такой тест зелёный и с дырой.

## Пример

```js
// src/mcp/update-pipeline.test.mjs — верхний уровень файла, до describe
let restorePhaseEnv;
beforeAll(() => { restorePhaseEnv = clearPhaseEnv(); });
afterAll(() => { restorePhaseEnv(); });

// регресс: env чист внутри it (доказывает, что хелпер на уровне файла)
it('env чист', () => {
  assert.equal(process.env.VIBELOG_PHASE_NAME, undefined);
});
```

VL-374 применила механизм к 21 тест-файлу с in-process `handleToolCall`; исключения — `server.test.mjs` и `cli.test.mjs`: они спавнят процесс и передают фазу явно через `testSpawnEnv(extra)`.
