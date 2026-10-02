---
id: VL-44
title: При создании комментария постоянно вызывается getGitUserName
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-02 23:09'
updated_date: '2026-10-02 23:13'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
При создании комментария постоянно вызывается getGitUserName. Мне кажется это излишне и можно взять GitUserName и записать его в настройки проекта (.vibelog) и брать его уже оттуда. Запись эту нужно производить при init проекта (и/или —force).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-02 23:13
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-45 — модуль project-settings + resolveGitUserName (кэш git_user_name в .vibelog/settings.yml, fallback на git config); VL-46 — vibelog init (и --force) записывает git_user_name в .vibelog/settings.yml; VL-47 — addComment (store.ts) и CLI --comment переходят на resolveGitUserName + документация.
Краткое описание разбиения: проблема — getGitUserName (spawn git config user.name) вызывается при каждом комментарии (store.ts addComment, task.ts --comment). Решение — кэш в .vibelog/settings.yml (каталог уже в .gitignore, как bot.yml): VL-45 создаёт модуль и резолвер, VL-46 наполняет кэш при init/--force, VL-47 подключает потребителей. Зависимости: VL-46 → VL-45; VL-47 → VL-45, VL-46. MCP toolAddComment не трогаем — он дефолтит '@agent' и git не вызывает.
---
<!-- COMMENTS:END -->