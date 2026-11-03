---
id: ref-24
title: 'assistant-ui Elements: ComposerMenu (меню слэш-команд)'
type: doc
url: 'https://www.assistant-ui.com/elements/composer-slash-commands'
tags:
  - assistant-ui
  - elements
  - composer
  - slash-commands
  - chat
  - web
  - ui
  - отложено
created_date: 2026-11-03
linked_tasks:
  - VL-314
---
## Что это

Готовый элемент assistant-ui: `ComposerMenu` + `ComposerCommandItem` + хук `useSlashMatches` —
меню слэш-команд, всплывающее над композером при наборе `/`, с фильтрацией по вводу.

- Дока: https://www.assistant-ui.com/elements/composer (страница `composer`)
- Конкретно слэш-команды: https://www.assistant-ui.com/elements/composer-slash-commands

## Установка (нужен прокси/VPN — ручная)

```bash
pnpm dlx shadcn@latest add "@assistant-ui/elements-composer"
```

Slug registry: `composer`, `composer-slash-commands`, `composer-mentions`, `composer-attachments`,
`composer-model-picker`, `composer-voice`, `composer-context` — все указывают на registry-item
`elements-composer` (см. `apps/docs/lib/catalog/element-index.ts`). Наш стиль — `radix-nova`
(не `base-*`) → Radix-flavor.

## API (standalone-вариант, без runtime)

```tsx
import { useSlashMatches, ComposerMenu, ComposerCommandItem,
         type ComposerCommand } from "@/components/assistant-ui/elements/composer"

const commands: ComposerCommand[] = [
  { name: "help", description: "Список команд", icon: HelpCircleIcon },
]
const matches = useSlashMatches(text, commands)
<ComposerMenu open={matches.length > 0}>
  {matches.map((c) => <ComposerCommandItem key={c.name} command={c} active={false} onClick={...} />)}
</ComposerMenu>
```

- Standalone: `useSlashMatches` только фильтрует список; подсветка активной строки (стрелки) и
  Enter — на нас (состояние `highlightedIndex`).
- Runtime-вариант (`unstable_useSlashCommandAdapter` + `ComposerPrimitive.TriggerPopover`) — НЕ для нас:
  чат на `useLocalRuntime`, а helper помечен unstable.

## Родственные элементы (для справки)

- `cost-meter` (`elements-cost-meter`) — метер стоимости; возможный кандидат для панели ₽ фичи 1 (VL-313).
- `composer-context` — контекст, привязанный к композеру.
- `context-display`, `context-breakdown` — см. ref-23.

## Статус в проекте

Отложено осознанно (решение Pavel): слэш-команды делаем **без подсказок** — реестр и исполнение на
сервере, без всплывающего меню. Элемент записан, чтобы не искать заново, когда дойдём до подсказок.