---
id: VL-32
title: 'npm: smoke-тест установки из tarball — CLI, init, browser, шаблоны оркестратора'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 15:01'
updated_date: '2026-10-01 15:01'
due_date: ''
labels: []
dependencies:
  - VL-31
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
После VL-31 пакет должен реально работать у пользователя. Smoke-тест:
1. npm pack — получить vibelog.md-<версия>.tgz.
2. Чистый каталог /tmp/vibelog-smoke: npm install <tarball> (без -g, через node_modules/.bin).
3. Проверить цепочку: vibelog --help → vibelog init в пустом /tmp-проекте → vibelog task create "Тест" → vibelog task list (вывод содержит задачу) → vibelog browser --no-open --port 3040 + curl / (React UI) + curl /api/tasks (JSON).
4. Убедиться, что шаблоны оркестратора (templates/qwen-commands/) и web/dist доступны из установленного пакета — резолв путей через import.meta.url работает при установке из tarball (не только из репозитория).
5. Все проверки — Node.js/bash, тестовые каталоги в /tmp (не в репозитории).

Ловушка, которую ловит этот тест: npm НЕ уважает .gitignore как источник истины для файлов, перечисленных в files — но если files указан неверно, dist/ не попадёт и шим упадёт с ERR_MODULE_NOT_FOUND. Тест ловит это до публикации.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm pack создаёт tarball; установка в чистый каталог /tmp/vibelog-smoke через npm install <tarball> проходит без ошибок
- [ ] #2 Из установленного пакета работают: vibelog --help, vibelog init (в /tmp-проекте создаёт backlog/), vibelog task create/list; vibelog browser отдаёт React UI (web/dist/index.html) — проверено curl-ом
- [ ] #3 Проверено, что templates/qwen-commands/phase-*.md читаются из установленного пакета (путь резолвится относительно dist/web/orchestrator.js); в /tmp-каталоге после установки нет backlog/, .qwen/
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->