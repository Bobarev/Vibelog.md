---
id: ref-23
title: 'assistant-ui Elements: ContextDisplay (панель контекста/токенов/стоимости)'
type: doc
url: 'https://www.assistant-ui.com/elements/context-display'
tags:
  - assistant-ui
  - elements
  - chat
  - context
  - tokens
  - ui
  - web
  - vl-фича-1
created_date: 2026-11-03
linked_tasks:
  - VL-313
---
## Что это

Готовый элемент assistant-ui «Context display» — токен-usage модели в трёх начертаниях
(Ring / Bar / Text) с общим поповером-разбивкой по hover.

Дока: https://www.assistant-ui.com/elements/context-display

## Установка (нужен прокси/VPN — ручная установка в проекте)

```bash
pnpm dlx shadcn@latest add "@assistant-ui/context-display"
```

Для разрешения имени `@assistant-ui` в `web/components.json` нужна регистрация стиля:

```json
{ "registries": { "@assistant-ui": "https://r.assistant-ui.com/styles/{style}/{name}.json" } }
```

У нас стиль `radix-nova` (не `base-*`) → ставится Radix-flavor элемента.
Если registry недоступен (сеть/прокси), эквивалент команды вручную:

```
https://r.assistant-ui.com/styles/radix-nova/context-display.json
```

— скачать JSON и разложить файлы самому (элемент + элементы-зависимости, в частности
`elements-surfaces` и `utils/tokens` с `formatTokenCount`), не забыв npm-зависимости элементов.

Оригинал исходника в референсе: `backlog/references/data/assistant-ui/apps/docs/components/pages/docs/samples/context-display.tsx`
(+ `apps/docs/content/elements/context-display.mdx` — полный API-reference).

## Что важно знать при адаптации

- Элемент ставится как **исходник в проект** (`components/assistant-ui/elements/context-display.tsx`),
  не как npm-пакет: `@assistant-ui/react@0.15.31` его НЕ экспортирует (проверено).
- Runtime-режим (`<ContextDisplay.Ring modelContextWindow={N} />`, сам читает usage)
  требует `@assistant-ui/ai-sdk` и `useThreadTokenUsage()` — у нас НЕ подходит:
  чат на `useLocalRuntime` + свой ChatModelAdapter. Берём **standalone**-вариант с пропом
  `usage` и `resetKey` (threadId).
- Поповер по умолчанию на hover (`data-slot="context-display-popover"`); для тач-устройств
  нужен вариант по тапу.
- Цветовые пороги: <65% — зелёный, 65–85% — amber, >85% — red; процент клампится в 100.
- Семантика процента — **пик по запросам треда** (usage каждого запроса уже включает промпт
  целиком), НЕ сумма по ходам: иначе ринг упирается в 100% на 2–3-м ходу
  (см. ref-реализацию `apps/docs/components/pages/docs/assistant/footer.tsx`).
- В поповере по умолчанию строки Input / Cached input / Output / Reasoning — **рублей там нет**,
  строку стоимости добавляем сами.