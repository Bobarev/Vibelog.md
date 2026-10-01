---
id: VL-27
title: 'Vibelog Web: портировать Kanban Board из шаблона arhamkhnz с drag-and-drop и PATCH-сменой статуса'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 11:36'
updated_date: '2026-10-01 11:36'
due_date: ''
labels: []
dependencies:
  - VL-26
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
Портировать Kanban Board из шаблона ../some/next-shadcn-admin-dashboard в наше Vite-приложение (создаётся в VL-26). Взять страницу src/app/(main)/dashboard/kanban/ и компоненты _components/, заменить слой данных Next.js (Server Actions) на fetch('/api/tasks') и PATCH /api/tasks/:id. Использовать @dnd-kit для drag-and-drop. Колонки — статусы из конфига проекта. Дополнительно: провести ресёрч шаблона и описать в задаче, какие ещё блоки (dashboard, формы и т.д.) стоит вытащить для будущего развития веб-интерфейса.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В web/src/components/kanban/ созданы компоненты Kanban; grep по web/src не находит 'use client', next/navigation, next/link или других next/* импортов
- [ ] #2 Доска загружает задачи через fetch('/api/tasks'), колонки строятся по статусам из backlog.config.yml (GET /api/config), задачи сгруппированы по статусам
- [ ] #3 Перетаскивание карточки в другую колонку вызывает PATCH /api/tasks/:id со сменой status; pnpm build в web/ проходит успешно
- [ ] #4 В description задачи зафиксирован ресёрч: какие ещё блоки/компоненты из ../some/next-shadcn-admin-dashboard пригодны для портирования (dashboard как основа и т.д.)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->