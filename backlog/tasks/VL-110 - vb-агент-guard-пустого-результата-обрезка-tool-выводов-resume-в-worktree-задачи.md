---
id: VL-110
title: 'vb-агент: guard пустого результата, обрезка tool-выводов, resume в worktree задачи'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 09:50'
updated_date: '2026-10-12 09:50'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Код-фиксы C1/C2/C3 из doc-12 (раздел 6.2, инцидент VL-98), в порядке выгоды.

C2. src/agent/loop.ts — guard пустого результата: финальный текст модели пуст или только пробелы → fail «Пустой ответ модели», is_error=true. Сейчас пустая строка — валидный результат (exit 0): run 2 сессии VL-98 завершился пустым финалом, оркестратор «успешно» закрыл фазу без отчёта и смены статуса.

C1. src/agent/tools.ts — обрезка tool-выводов до ~8 KB с маркером «… (обрезано; для полного вывода сузь команду)» для run_shell_command, grep_search, read_file. Необрезанные выводы 25–34 KB (git ls-files, большие grep) заливали контекст: ходы замедлялись до 5–15 минут, модель деградировала (пустой финал).

C3. src/web/orchestrator.ts — resume в worktree задачи: startResume возобновляет сессию, принадлежавшую задаче VL-N, в worktree этой задачи (маппинг session→task), с VIBELOG_CWD на главный репо. Минимальный вариант — явное предупреждение/отказ при cwd-несовпадении. Инцидент VL-98: reply «Продолжи» шёл из главного cwd (runKey 'resume' вне /^VL-\d+$/i) и патч-скрипт применил 3 файла главного репозитория вместо worktree vb/vl-98.

Связь: C2 — фолбэк-защита для всех фаз; C1 снижает вероятность прерываний; C3 закрывает багу неверного cwd при resume.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 loop.test.mjs: пустой/whitespace-only финальный ответ → is_error=true, текст «Пустой ответ модели»; непустой ответ — без изменений
- [ ] #2 tools.test.mjs: вывод run_shell_command/grep_search/read_file длиннее ~8 KB обрезается с маркером «обрезано»; короткий вывод возвращается без изменений
- [ ] #3 orchestrator.test.mjs: resume сессии, принадлежавшей задаче VL-N, возобновляется с cwd её worktree (либо явное предупреждение при cwd-несовпадении) — регрессия инцидента VL-98 закрыта
- [ ] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->