---
id: VL-300
title: '[v2] experiments: external runner (--runner-cmd) и run --rerun N --yes'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - v2
  - experiments
dependencies:
  - VL-299
milestone: v1.12
references: []
priority: low
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/experiment-runner.ts
  - src/core/experiment-runner.test.mjs
  - src/cli/commands/experiment-run.ts
  - src/cli/commands/experiment.ts
  - src/cli/experiment-run-cli.test.mjs
lessons:
  - lesson-160
  - lesson-187
token_usage:
  input: 5868256
  output: 51528
  cache: 5529088
  total: 5919784
  requests: 84
  duration_ms: 1104299
  reasoning: 27647
  by_phase:
    code:
      input: 4713179
      output: 43717
      cache: 4465664
      requests: 60
    close:
      input: 1155077
      output: 7811
      cache: 1063424
      requests: 24
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
v2-эпик VL-293 (зависит от VL-299). Внешний раннер и перезапуск прогона.

Спецификация: `backlog/docs/doc-21` §10 (CLI), §13 (runner'ы).

Файлы:
- `src/core/experiment-runner.ts` — external runner: `runner: 'external'` в meta, `--runner-cmd '<shell>'` получает JSON-строку датасета на stdin, ожидает results-строку на stdout; health-check/таймаут через spawn с `timeout`, ошибка команды → `error_kind: 'runner'`.
- `src/cli/commands/experiment.ts` — `run --rerun N --yes`: новый каталог `run-(max+1)` с `rerun_of: run-N`; `--rerun` без `--yes` — отказ с подсказкой (защита от случайного дубля дорогого прогона). Старый ран не перезаписывается (run неизменяем, doc-21 §17 п.6).
- Тесты: external runner на `node -e`-скрипте (stdin→stdout), таймаут команды → error_kind runner, `--rerun` без `--yes` отказывает, с `--yes` создаёт новый каталог с `rerun_of`.

Разделено из прежней VL-300: `experiment gc` и `lesson.references` вынесены в VL-301 — четыре независимых куска в одной задаче не давали закрыть её частично.

Проверка: `pnpm build && pnpm test`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 external runner: --runner-cmd, JSON-строка датасета на stdin → results-строка на stdout, таймаут
- [x] #2 run --rerun N --yes создаёт run-(max+1) с rerun_of: run-N; без --yes отказ
- [x] #3 CHANGELOG.md обновлён
- [x] #4 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) external runner (stdin JSON → stdout results-строка, timeout). 2) --rerun/--yes + rerun_of. 3) experiment gc (+--apply для .gitignore). 4) lesson.references — только по решению пользователя; иначе оставить reference type experiment. 5) Обновить doc-7/doc-8. 6) Тесты на node-скрипте-заглушке. 7) pnpm build && pnpm test. Риск: external runner = произвольный код пользователя — запуск только с явным подтверждением; .gitignore не трогать автоматически.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 04:12
---
Фаза 3 (Code) выполнена. Коммит 2861d86.
**Что сделано.**
1. **External runner (VL-300, doc-21 §13)** — `src/core/experiment-runner.ts`: новые `runExternalExperiment`, `assertExternalRunnerHealthy`, `parseExternalResult`, `defaultSpawnExternal` (+типы `SpawnExternalParams`/`SpawnExternalResult`/`SpawnExternalFn`, константа `EXTERNAL_HEALTH_CHECK_TIMEOUT_SEC`). Контракт: на каждую пару (строка датасета × вариант) внешняя команда вызывается один раз, на stdin — одна JSON-строка (`task_id`, `variant`, `variant_label`, `model`, `params`, `expected_ac`/`input`/`payload`), из stdout берётся ПЕРВАЯ непустая строка, парсящаяся как JSON-объект (логи команды перед результатом прогон не ломают). Спавн — `/bin/sh -c` с stdin/stdout, таймаут SIGTERM + SIGKILL через 5 с (как в ai-phase). Ошибки изолированы построчно: код ≠ 0 → `error_kind: 'runner'` с первой строкой stderr; таймаут → `error_kind: 'timeout'`; stdout без JSON → `error_kind: 'runner'`; прогон продолжается, строка считается dropped. `cost` всегда `null` (внешняя команда может не ходить в LLM — выдуманная цена испортила бы сравнение по стоимости). `meta.runner = 'external'`, в `resolution` пишется `runner_cmd`. Worktree не создаётся: команда своя, проект трогает она, а не раннер.
2. **Health-check** — только проверка синтаксиса shell-строки (`/bin/sh -n -c`), БЕЗ пробного запуска: `--runner-cmd` — произвольный код пользователя (риск из плана), скрытый тестовый прогон тратил бы деньги/писал файлы помимо воли человека. Пустая команда и незакрытая кавычка отвергаются до создания рана.
3. **`run --rerun N --yes`** — `src/cli/commands/experiment-run.ts`: `resolveRerun` валидирует N (существующий ран), требует `--yes` (без него — отказ с подсказкой и предупреждением, что будет создан `run-(max+1)` и прогон потратит ресурсы повторно), `--yes` без `--rerun` — отдельная ошибка. Номер нового рана — обычный `createRunDir` (max+1), `rerun_of: N` пишется в `meta.json`; старый ран не перезаписывается (run неизменяем, doc-21 §17 п.6). `rerunOf` прокинут и в manual-ран, и в `runAiPhase`, и в новый `runExternal`. Для `runner: external` добавлена CLI-обёртка `runExternal` (обязательный `--runner-cmd`, `--timeout`, `--variant`, `--dry-run`, итог с числом ошибочных строк).
4. **Тесты.** `src/core/experiment-runner.test.mjs` (+7, итого 18): прогон через реальный `node`-скрипт-заглушку (stdin JSON → stdout results-строка, `meta.runner=external`, `cost_total: null`), таймаут команды → 2 строки `error_kind: timeout` при продолжении прогона, код ≠ 0 → `runner` с текстом stderr, stdout без JSON → `runner`, пустая/битая команда отвергаются без создания рана, `--dry-run`, `rerun_of` в meta. `src/cli/experiment-run-cli.test.mjs` (+6, итого 17): `--rerun` без `--yes` отказывает и не создаёт ран, `--rerun N --yes` создаёт `run-(max+1)` с `rerun_of: 1` и не трогает старый `meta.json`, несуществующий ран, `--yes` без `--rerun`, external без `--runner-cmd`, external с командой прогоняет матрицу.
**Проверки.** `pnpm build` — чисто; полный `pnpm test` — 153 файла, 2866 passed, 4 skipped, без исключений и skip-фильтров.
**Что осталось (не отмечено).** AC3 «CHANGELOG.md обновлён» — по правилам фазы 3 CHANGELOG в Code не правится, его пишет фаза Close после слияния. DoD «Документация обновлена» — аналогично: doc-21 §10/§13 и doc-7 обновляются в Close (в §10 doc-21 `--rerun N --yes` уже зафиксирован, §13 — место для описания контракта external runner'а). Задачу VL-301 (`experiment gc`, `lesson.references`) и п.3–4 плана не трогал — они вынесены из этой задачи.
---
author: @agent
created: 2026-11-03 04:18
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 2861d86 (external runner + run --rerun N --yes, из Фазы Code; остатков кода не было), docs ad6e75b (CHANGELOG.md, doc-7 раздел `experiment run` → runner external и `--rerun N --yes`, doc-21 §13 подраздел про external runner и перезапуск прогона). Не закоммичено: нет.
**Проверки после merge.** `pnpm build` — чисто (один раз, по запрету фазы). Полный `pnpm test`: первый прогон — 154 файла, 2873 passed, 1 failed (`src/agent/loop.test.mjs:661`, VL-306 AC про `--max-wall-time`), 4 skipped. Классификация: diff VL-300 не затрагивает `src/agent/loop.*` (`git diff --name-only HEAD^1..HEAD` — только `src/core/experiment-runner.*`, `src/cli/commands/experiment*.ts`, `src/cli/experiment-run-cli.test.mjs`); тот же тест изолированно — 106/106 passed; параллельного `vitest` в другом worktree не было (`ps aux | grep vitest` пуст). Падение — timing-чувствительное под параллельной нагрузкой (проверка wall-time лимита), не регрессия задачи. Один повторный полный прогон (причина — классификация транзиентного падения): 154 файла, 2874 passed, 4 skipped, 0 failed. Повторных прогонов больше не делалось.
**Отмечено.** AC3 (CHANGELOG.md обновлён) и DoD «Документация обновлена» — запись в Unreleased и doc-7/doc-21 обновлены в этой фазе, коммит ad6e75b.
---
<!-- COMMENTS:END -->