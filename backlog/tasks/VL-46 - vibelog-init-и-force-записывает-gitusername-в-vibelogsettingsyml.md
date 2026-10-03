---
id: VL-46
title: vibelog init (и --force) записывает git_user_name в .vibelog/settings.yml
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:13'
updated_date: '2026-10-03 12:38'
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
- [x] #1 После vibelog init создаётся .vibelog/settings.yml с полем git_user_name — значением git config user.name проекта (или '@agent', если git недоступен/пусто)
- [x] #2 Повторный vibelog init --force обновляет git_user_name в .vibelog/settings.yml (перечитывает git config), не ломая остальные поля файла
- [x] #3 Тесты: init в tmp-директории создаёт settings.yml с непустым git_user_name; init --force перезаписывает значение (git config переопределён через GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM или локальный config)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author:  @agent
created: 2026-10-03 12:38
---
Задача закрыта (Фаза Comment по VL-44): реализация выполнена в Фазе 3 эпика и закоммичена (e5df3aa/cff8b2e). Проверено: src/cli/commands/init.ts — saveProjectSettings вызывается и в ветке !existing (строка 78), и в ветке existing && force (строка 87); тесты в src/cli/init-mcp.test.mjs (+2 теста VL-44). AC/DoD отмечены. Статус: Done.
---
<!-- COMMENTS:END -->