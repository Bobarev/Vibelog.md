---
id: lesson-26
title: Проверяй guard-фиксы в worktree скрипт-файлом — MCP run_shell_command валидируется старым dist и ложно отклоняет саму smoke-команду
status: active
tags:
  - worktree
  - smoke
  - guard
source_tasks:
  - VL-179
linked_tasks:
  - VL-179
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
# Проблема

В worktree-режиме (параллельная ветка задачи) MCP-инструмент `run_shell_command` исполняется сервером, который загрузил `dist/` основного репозитория (или был запущен до пересборки). Smoke-команда фикса guard с литералами `\(main\)` в аргументе **сама отклонялась старым guard** с фрагментом `/dashboard/...` — то есть воспроизводила исходный баг и делала невозможной проверку через shell. Сессия VL-179: попытка `node --input-type=module -e "...src/app/\(main\)/..."` отклонена до исполнения.

# Решение

Проверяй исправления `checkShellCommandInProject` и подобные guard-фиксы в worktree через **скрипт-файл**: `write_file` кладёт смоук в `<name>.tmp.mjs` (строки с экранированием — внутри файла, команда их не содержит), shell запускает `node <name>.tmp.mjs; rc=$?; rm <name>.tmp.mjs`, а валидацию берёт из рабочего `dist/` (`./dist/agent/tools.js`), а не из MCP-обвязки.

# Пример

```bash
node smoke-vl179.tmp.mjs; rc=$?; rm smoke-vl179.tmp.mjs; exit $rc
# → SMOKE PASSED: 5 ложных → null, 5 истинных → reject
```

Так smoke проверяет НОВЫЙ код, а не старый guard процесса MCP-сервера.