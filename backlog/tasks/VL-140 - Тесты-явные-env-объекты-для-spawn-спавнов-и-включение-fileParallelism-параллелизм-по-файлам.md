---
id: VL-140
title: 'Тесты: явные env-объекты для spawn-спавнов и включение fileParallelism (параллелизм по файлам)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-13 11:21'
updated_date: '2026-10-13 11:21'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Главный рычаг ускорения тестов: сейчас fileParallelism: false (VL-133 выключил осознанно — глобальные process.env-хаки в тестах сделали бы параллелизм гоночным). Причина: orchestrator.test пишет process.env.VL28_STUB_MARKER/VL28_STUB_SLEEP/VIBELOG_QWEN_BIN и др., а llmEnv() в cli.test spreads process.env — при параллельном запуске файлов тесты видят env друг друга (это же была природа инцидентов VL-117/VL-125).

План:
1. Явные env-объекты: каждый spawn/spawnSync в тестах получает env, собранный явно ({ ...process.env, ...нужные } внутри СПАВНА, без записи в process.env родителя; заглушки читают env из аргументов spawn, а не из глобала). Убрать process.env-мутации из orchestrator.test (VL28_STUB_*), restart-тестов и подобных.
2. fileParallelism: true — на 4 CPU ожидание −50…70 с (144 → ~70-90).
3. Разгрузка cli.test: интеграционный spawnSync оставить там, где проверяется сам CLI-процесс (JSON-контракт, exit); чистую логику проверять импортом dist напрямую — минус десятки spawn'ов по 300-500 мс.
4. Обязательная верификация: 3 полных прогона подряд + прогон с VIBELOG_PHASE_TASK_ID/VIBELOG_PHASE_NAME/VIBELOG_CWD в окружении (регрессия VL-125) + замер времени.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 все тест-файлы со спавном не полагаются на process.env родителя: spawn/spawnSync получают явный env-объект (база process.env + только нужные ключи); глобальные process.env.VL28_STUB_*/VIBELOG_QWEN_BIN убраны или локализованы в конкретный спавн
- [ ] #2 vitest.config.mts: fileParallelism: true — 3 последовательных полных pnpm test без флаков и падений (включая прогоны с VIBELOG_PHASE_* в окружении — регрессия VL-125)
- [ ] #3 cli.test.mjs: часть проверок переведена на прямой импорт dist (без spawnSync node CLI) там, где не проверяется сам процесс CLI; замер доли до/после
- [ ] #4 итоговый замер: pnpm test ≤ ~80 с (цель ~50-70); CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->