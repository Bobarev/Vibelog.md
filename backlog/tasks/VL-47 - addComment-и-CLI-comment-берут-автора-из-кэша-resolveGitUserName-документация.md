---
id: VL-47
title: addComment и CLI --comment берут автора из кэша (resolveGitUserName) + документация
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:13'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies:
  - VL-45
  - VL-46
milestone: v1.6
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
- [x] #1 addComment в src/core/store.ts и CLI src/cli/commands/task.ts (ветка --comment) используют resolveGitUserName вместо прямого getGitUserName — при наличии кэша git-процесс не спавнится
- [x] #2 Существующие тесты комментариев (task.test.mjs, bot-тесты) проходят без изменений — автор по умолчанию прежний ('@agent' при отсутствии git user.name), поведение без settings.yml не изменилось
- [x] #3 Обновлена документация: README/docs — упоминание .vibelog/settings.yml, git_user_name и обновления через vibelog init --force
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
created: 2026-10-03 12:38
---
Задача закрыта (Фаза Comment по VL-44): реализация выполнена в Фазе 3 эпика и закоммичена (e5df3aa/cff8b2e). Проверено: src/core/store.ts:12,170 и src/cli/commands/task.ts:25,468 используют resolveGitUserName; docs/user-guide.md:47 описывает .vibelog/settings.yml; регрессий нет — pnpm test 394/394. AC/DoD отмечены. Статус: Done.
---
<!-- COMMENTS:END -->