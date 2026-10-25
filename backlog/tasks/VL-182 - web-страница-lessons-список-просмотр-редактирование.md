---
id: VL-182
title: 'Веб-страницы lessons: список, просмотр, редактирование'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-25 15:18'
updated_date: '2026-10-25 15:30'
due_date: ''
labels:
  - web
  - core
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Страницы lessons в вебе: список, просмотр, редактирование.

Lessons реализованы (VL-153): файлы backlog/lessons/lesson-N.md с frontmatter (id, title, status active/outdated/superseded, tags, source_tasks, linked_tasks). Но в вебе не видны. Нужны страницы.

Что: роут #/lessons — список lessons (фильтр по status, tags). Роут #/lesson/<id> — просмотр: title, tags, body (markdown), source_tasks (ссылки на задачи), linked_tasks (ссылки на задачи), status. Редактирование: title, tags, body, status. Связь с задачами — переход по ссылке.

Backend: GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id — новые эндпоинты.

Добавить на сайдбар соответствующий раздел.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Роут #/lessons показывает список lessons с фильтрами по status и tags (id, title, status, tags)
- [ ] #2 Роут #/lesson/<id> показывает просмотр (title, status, tags, body markdown, source_tasks и linked_tasks ссылками на задачи) и позволяет редактировать title, tags, body, status с сохранением через PATCH /api/lessons/:id
- [ ] #3 Backend-эндпоинты GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id реализованы и покрыты тестами; раздел Lessons добавлен на сайдбар
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 15:30
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Веб-страницы lessons: список, просмотр, редактирование» (снят ведущий тег #web). Масштаб: task (одна фича: 3 эндпоинта + 2 роута + пункт сайдбара; по образцу VL-174 — references, тип task). Уточнено: из описания снят ведущий тег #web и убран дубль блока /spec, добавлены 3 проверяемых AC — (1) роут #/lessons со списком и фильтрами по status/tags; (2) роут #/lesson/<id> с просмотром всех полей (включая source_tasks/linked_tasks ссылками) и редактированием title/tags/body/status через PATCH; (3) эндпоинты GET /api/lessons, GET /api/lessons/:id, PATCH /api/lessons/:id с тестами + раздел Lessons на сайдбаре. Labels: web, core (тег #web из заголовка/описания перенесён в labels). References: нет (внешние источники не упомянуты; VL-153/VL-174 — внутренние задачи-контекст). Технические примечания: первые вызовы backlog_update_task падали с «Cannot read properties of undefined (reading 'toLowerCase')», пока type задачи был не определён — после записи type=task обновление прошло; AC записаны через manage_ac отдельными вызовами (передача массива add записывала JSON одним критерием). Вопросов нет.
---
<!-- COMMENTS:END -->