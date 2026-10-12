---
id: VL-123
title: static.test.mjs флак «Unable to deserialize cloned data» — диагностика и стабилизация
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-12 19:13'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: low
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
static.test.mjs периодически падает на file-level в полных прогонах pnpm test с внутренней ошибкой «Unable to deserialize cloned data due to invalid or unsupported version» (IPC/V8-артефакт test-runner на macOS). В одиночных прогонах зелёный (проверено: 2-3 из 3 проходов — флак). Засвечен многократно 2026-10-08..12, каждый раз подтверждался одиночным прогоном — реальных падений теста нет.

План: (1) собрать статистику — 5 полных прогонов, частота; (2) попробовать стабилизацию: изоляцию файла (отдельный процесс), снижение параллелизма (node --test --test-concurrency) или уменьшение общих ресурсов прогона; (3) если флак не лечится — документально принять (известная особенность в комментарии static.test.mjs + память проекта), чтобы будущие прогоны не считали его регрессией.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 статистика: 5 полных pnpm test — частота флака в комментарии задачи
- [ ] #2 фикс (изоляция файла, --test-concurrency, уменьшение общих ресурсов) ЛИБО документальное принятие: пометка об известном флаке в комментарии задачи и комментарии в static.test.mjs
- [ ] #3 3 последовательных полных pnpm test без file-level fail по static.test
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->