---
id: VL-47
title: addComment и CLI --comment берут автора из кэша (resolveGitUserName) + документация
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-02 23:13'
updated_date: '2026-10-02 23:13'
due_date: ''
labels: []
dependencies:
  - VL-45
  - VL-46
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
Потребители автора комментария переходят на кэш из .vibelog/settings.yml (VL-44).

Заменить getGitUserName на resolveGitUserName (VL-45) в:
- src/core/store.ts:169 — addComment (используется CLI, Telegram-ботом, MCP-хендлером бота)
- src/cli/commands/task.ts:467 — флаг --comment

MCP toolAddComment (src/mcp/tools.ts:650) НЕ трогать — он дефолтит '@agent' и git не вызывает.

Обновить документацию (docs/, README): кэш git_user_name в .vibelog/settings.yml, запись при init/--force, fallback на git config при отсутствии кэша.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 addComment в src/core/store.ts и CLI src/cli/commands/task.ts (ветка --comment) используют resolveGitUserName вместо прямого getGitUserName — при наличии кэша git-процесс не спавнится
- [ ] #2 Существующие тесты комментариев (task.test.mjs, bot-тесты) проходят без изменений — автор по умолчанию прежний ('@agent' при отсутствии git user.name), поведение без settings.yml не изменилось
- [ ] #3 Обновлена документация: README/docs — упоминание .vibelog/settings.yml, git_user_name и обновления через vibelog init --force
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->