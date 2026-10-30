---
id: lesson-121
title: Ставь guard внешнего git-состояния (MERGE_HEAD) до spawnQwenRun — тогда статус задачи не меняется сам
status: active
tags:
  - оркестратор
  - фазы
  - git
  - close
  - тесты
source_tasks: []
linked_tasks:
  - VL-246
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

Close-фаза в branch-mode падала на `git merge --no-ff` с «you have unmerged files», потому что в главном репо висел чужой незавершённый merge (`MERGE_HEAD` от параллельной Close). Ран тратился, и приходилось полагаться только на текстовое правило «не резолвь чужой merge» в промпте (lesson-82). Отдельный риск: проверка статуса задачи — если поставить guard после `spawnQwenRun`, транзиент фазы уже переведёт задачу в In Progress, и «статус не меняется» не выполнить.

## Решение

Читай внешнее состояние git синхронным read-only хелпером (`getMergeState`: `git rev-parse --verify --quiet MERGE_HEAD` + `git diff --name-only --diff-filter=U`) и возвращай `{ error }` из `startPhase` **до** `closeActive = true`, до `spawnQwenRun` и до `markPhaseStarted`. Тогда фаза не стартует, процесс не спавнится, статус задачи остаётся прежним — инвариант AC выполняется без дополнительного кода.

Два обязательных свойства хелпера:
- **fail-open**: не-git каталог / git недоступен → `{ inProgress: false }`, без throw (иначе ломаются все существующие проекты и тесты);
- `-C cwd` в каждой git-команде (cwd оркестратора бывает подкаталогом).

Тест AC1 проверяет не только текст ошибки, но и что lock-файл fake-агента НЕ создан (спавна не было) и `status:` задачи в файле прежний; после удаления `MERGE_HEAD` тот же вызов обязан стартовать — иначе guard «залипает».

## Пример

VL-246: `getMergeState` в `src/core/git.ts`, guard первым в ветке `phase === 'close' && resolveBranchMode(cwd)` в `src/web/orchestrator.ts`, сообщение «…идёт незавершённый merge (MERGE_HEAD <sha7>), конфликты: …». Очередь (VL-146) дополнилась additive-полем `StartResult.queuedBehind` — сообщение называет, чей close её держит; владельца сбрасывай в единственных точках выхода drain'а (пустая очередь, ошибка dequeue), иначе «удерживает VL-M» устареет.
