---
id: VL-46
title: vibelog init (и --force) записывает git_user_name в .vibelog/settings.yml
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 23:13'
updated_date: '2026-10-02 23:13'
due_date: ''
labels: []
dependencies:
  - VL-45
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Команда vibelog init записывает git config user.name в кэш настроек проекта.

В src/cli/commands/init.ts:
- При создании backlog/ (ветка !existing) — записать .vibelog/settings.yml с git_user_name = getGitUserName(cwd) через saveProjectSettings (VL-45).
- При повторном init --force (проект уже инициализирован) — обновить git_user_name в settings.yml (перечитать git config).

Логика выносятся в init.ts, используя модуль VL-45; init-mcp.test.mjs — существующий файл для тестов init-поведения.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После vibelog init создаётся .vibelog/settings.yml с полем git_user_name — значением git config user.name проекта (или '@agent', если git недоступен/пусто)
- [ ] #2 Повторный vibelog init --force обновляет git_user_name в .vibelog/settings.yml (перечитывает git config), не ломая остальные поля файла
- [ ] #3 Тесты: init в tmp-директории создаёт settings.yml с непустым git_user_name; init --force перезаписывает значение (git config переопределён через GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM или локальный config)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->