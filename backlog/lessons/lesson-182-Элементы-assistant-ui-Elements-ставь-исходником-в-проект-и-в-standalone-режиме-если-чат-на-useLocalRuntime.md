---
id: lesson-182
title: 'Элементы assistant-ui Elements ставь исходником в проект и в standalone-режиме, если чат на useLocalRuntime'
status: active
tags:
  - web
  - chat
  - assistant-ui
  - ui
  - elements
source_tasks:
  - VL-313
linked_tasks:
  - VL-313
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Элемент assistant-ui Elements (`ContextDisplay`) не экспортируется npm-пакетом `@assistant-ui/react@0.15.31`, а shadcn-CLI требует прокси/VPN. Runtime-режим элемента (`useThreadTokenUsage` из `@assistant-ui/ai-sdk`) не работает в чате на `useLocalRuntime` + собственный `ChatModelAdapter`.

## Решение

Ставить элемент **исходником** в `web/src/components/assistant-ui/elements/` — при недоступном registry разложить файлы вручную из `https://r.assistant-ui.com/styles/<style>/<name>.json` (наш стиль `radix-nova` → Radix-flavor) вместе с зависимостями элементов (`elements-surfaces`, `utils/tokens#formatTokenCount`). Использовать **standalone**-вариант с пропом `usage` + `resetKey={threadId}`, а не runtime-режим.

## Пример

VL-313: `context-display.tsx` + `utils/context-usage.ts` + `utils/tokens.ts` в проекте, состояние usage — модульный state в `chat-runtime.tsx` (как `setActiveModelId`), данные приходят новым SSE-событием `{type:'usage'}` и восстанавливаются из `GET /api/chat/threads/:id`.
