---
id: ref-13
title: deska-dashboard-template
type: repo
url: 'https://github.com/yaminncco/deska-dashboard-template'
tags:
  - ui
  - vue
  - nuxt
  - shadcn
  - modal
  - dashboard-template
created_date: 2026-10-15
linked_tasks:
  - VL-163
---
Шаблон дашборда на Nuxt + Tailwind + shadcn-vue (port shadcn на reka-ui) — референс визуала модальных окон для VL-163.

**Стек:** Nuxt (app/), Tailwind, shadcn-vue (primitives от reka-ui, не Radix), pnpm.

**Модалки в `app/components/ui/`:**
- `dialog/` — полный набор: Dialog, DialogContent, DialogOverlay, DialogHeader/Footer/Title/Description/Close, DialogTrigger, DialogScrollContent (для длинного контента), CommandDialog (командная палитра в модалке)
- `sheet/` — боковая панель (Sheet, SheetContent, SheetHeader/Footer…)
- Также есть form, command, combobox, tags-input — всё для форм внутри модалок

**Ключевые UX-детали DialogContent.vue:**
- Портал + оверлей `bg-black/50` с fade-анимациями (`animate-in/out`, `zoom-in-95/out-95`, `duration-200`)
- Центрирование: `fixed top-[50%] start-[50%] translate-x/y-[-50%]`, `max-w-[calc(100%-2rem)] sm:max-w-lg`, `rounded-lg border p-6 shadow-lg`
- Кнопка закрытия X (`@lucide/vue`) в `top-4 end-4` с opacity-переходом и focus-ring; флаг `showCloseButton`

**Пример использования:** `app/pages/(settings)/settings/index.vue` — модалка создания API-ключа (форма внутри Dialog).