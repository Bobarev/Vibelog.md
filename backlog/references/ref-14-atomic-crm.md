---
id: ref-14
title: atomic-crm
type: repo
url: 'https://github.com/marmelab/atomic-crm'
tags:
  - ui
  - react
  - shadcn
  - crm
  - modal
  - tasks
created_date: 2026-10-15
linked_tasks:
  - VL-163
---
Atomic CRM (Marmelab) — **приоритетный UX-референс модального окна задач** для VL-163 (создание/просмотр/редактирование задачи).

**Стек:** React + Vite + react-admin (ra-core) + shadcn (Radix-примитивы) + Supabase, Vitest + Storybook.

**Паттерн модалок задач (`src/components/atomic-crm/tasks/`):**
- `TaskCreateSheet.tsx` / `TaskEditSheet.tsx` — создание/редактирование через боковую Sheet-панель, а не центральную модалку; управляемые `open`/`onOpenChange` пропсы, автозакрытие при успешном сабмите
- `TaskFormContent.tsx` — переиспользуемое содержимое формы для Create и Edit: autoFocus у первого поля, обязательные поля через `validate={required()}`, grid 1-2 колонки под разрешения (`grid-cols-1 md:grid-cols-2`)
- `TaskEdit.tsx`, `Task.tsx`, `TasksListByDueDate.tsx`, `MobileTasksList.tsx` — показ/списки; `TaskCreateSheet.stories.tsx` + `TaskCreateSheet.test.tsx` — stories и тесты

**Универсальные обёртки форм (`src/components/atomic-crm/misc/`):**
- `CreateSheet.tsx` / `EditSheet.tsx` — Sheet с шапкой (заголовок + headerActions), фиксированным футером (Save / Close / Delete), обёртки над CreateBase/EditBase из ra-core; children — произвольные input-компоненты

**Примитивы (`src/components/ui/`):** dialog.tsx (Radix, оверлей `bg-black/50`, fade/zoom-анимации, X-кнопка), drawer.tsx (vaul — для mobile), sheet.tsx.

**Прочее:** аналогичные ContactCreateSheet/ContactEditSheet, ContactShow (aside-панель с контекстом), TaskFormContent переиспользуется в обоих sheet.