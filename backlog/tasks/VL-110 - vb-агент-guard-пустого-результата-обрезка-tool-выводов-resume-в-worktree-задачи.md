---
id: VL-110
title: 'vb-агент: guard пустого результата, обрезка tool-выводов, resume в worktree задачи'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 09:50'
updated_date: '2026-10-12 12:27'
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
modified_files:
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - src/agent/session.ts
  - src/agent/session.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - CHANGELOG.md
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
- [x] #1 loop.test.mjs: пустой/whitespace-only финальный ответ → is_error=true, текст «Пустой ответ модели»; непустой ответ — без изменений
- [x] #2 tools.test.mjs: вывод run_shell_command/grep_search/read_file длиннее ~8 KB обрезается с маркером «обрезано»; короткий вывод возвращается без изменений
- [x] #3 orchestrator.test.mjs: resume сессии, принадлежавшей задаче VL-N, возобновляется с cwd её worktree (либо явное предупреждение при cwd-несовпадении) — регрессия инцидента VL-98 закрыта
- [x] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 11:05
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code, без headless-фазы; feat 8e42ecc).

Реализовано C1/C2/C3 из doc-12 (раздел 6.2):
- C2 (src/agent/loop.ts): guard пустого финала — финальный текст без tool_calls пуст/только пробелы → fail «Пустой ответ модели», is_error=true; транскрипт завершается assistant-сообщением (контракт resume VL-103).
- C1 (src/agent/tools.ts): truncateToolOutput/TOOL_OUTPUT_MAX_CHARS=8KB — финальная обрезка вывода для модели в read_file, run_shell_command (поверх per-stream 64KB), grep_search, glob; маркер «…[вывод обрезан: … из N символов]» с подсказкой сузить запрос.
- C3 (src/agent/session.ts + src/agent/cli.ts + src/web/orchestrator.ts): метаданные сессии <id>.meta.json (taskId/phase/cwd) пишет CLI при создании задачной сессии; startResume читает мету (loadSessionMetaSync, префикс vb: снимается) и при branch_mode возобновляет сессию в worktree задачи с VIBELOG_CWD на главный репо — инцидент VL-98 (патчи в главный репозиторий вместо worktree vb/vl-N) закрыт; при выключенном branch_mode и cwd-несовпадении в промпт дописывается предупреждение проверить git status/diff.

Тесты (+18): loop 4 (пустой/whitespace-финал, регрессия, контракт resume), tools 5 (unit + интеграции обрезки), session 5 (roundtrip meta, битый JSON, path traversal, latestSession), cli 2 (мета фазы, отсутствие меты у готового промпта), orchestrator 2 (resume в worktree через git-корень с проверкой cwd и VIBELOG_CWD; предупреждение при выключенном branch_mode).

Проверки: pnpm build (tsc strict) OK; pnpm test — 812 тестов, fail 0 (static.test — пре-экзистирующий флак V8-десериализации test-runner: в полном прогоне 2026-10-12 упал 1 раз, в одиночном — зелёный).

Что осталось: live-проверка resume в worktree на реальном инциденте (branch-mode on + reply «Продолжи» в боте); DoD закрывается Фазой Close.
---
author: @agent
created: 2026-10-12 12:27
---
Фаза Close выполнена вручную (исполнитель — Qwen Code). Код: feat 8e42ecc (C2 guard пустого финала в loop.ts, C1 truncateToolOutput 8KB в tools.ts, C3 resume задачной сессии в worktree через <id>.meta.json). Проверки: pnpm test — 812 тестов, fail 0 (static.test — флак V8-тест-раннера, в одиночном прогоне зелёный). DoD 3/3. Статус Done. Пуш по решению Pavel.
---
<!-- COMMENTS:END -->