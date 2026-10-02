---
id: VL-45
title: Кэш git_user_name в .vibelog/settings.yml (модуль project-settings + resolveGitUserName)
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 23:13'
updated_date: '2026-10-02 23:13'
due_date: ''
labels: []
dependencies: []
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
Кэш git config user.name в настройках проекта, чтобы не спавнить git при каждом комментарии (VL-44).

Создать src/core/project-settings.ts:
- projectSettingsPath(cwd) → .vibelog/settings.yml (каталог .vibelog/ уже в .gitignore — кэш машинный, как и git user.name)
- loadProjectSettings/saveProjectSettings (YAML через core/yaml.js, как src/bot/settings.ts для bot.yml)
- resolveGitUserName(cwd): кэш git_user_name из settings.yml → иначе fallback getGitUserName(cwd) (src/core/git-user.ts)

Потребители (addComment в store.ts, task.ts CLI) подключаются в следующей подзадаче.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Модуль src/core/project-settings.ts: projectSettingsPath, loadProjectSettings, saveProjectSettings — YAML в .vibelog/settings.yml через существующие parseYaml/stringifyYaml, при записи создаёт .vibelog/; в интерфейсе поле git_user_name
- [ ] #2 Функция resolveGitUserName(cwd): возвращает кэш git_user_name из .vibelog/settings.yml, если он задан; иначе fallback на getGitUserName(cwd) — текущее поведение без регрессий
- [ ] #3 Юнит-тесты (*.test.mjs): кэш есть → значение из файла (git не вызывается, проверка env-изоляцией); кэш пуст/файла нет → fallback на git config; битый YAML → fallback без падения
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->