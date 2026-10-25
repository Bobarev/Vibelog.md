---
id: lesson-32
title: Не закрепляй enum в inputSchema MCP для значений из конфига
status: active
tags:
  - mcp
  - schema
  - config
  - priority
source_tasks:
  - VL-184
linked_tasks:
  - VL-184
created_date: 2026-10-25
updated_date: 2026-10-25
supersedes: ''
---
## Проблема

В inputSchema MCP-инструментов был `enum: ['High','Medium','Low']` для priority, хотя сервер enum не валидирует (схема нигде не исполняется). Клиенты с локальной валидацией схемы отвергали кастомные значения из config.priorities — фаза падала до отправки запроса.

## Решение

Для полей, значения которых приходят из конфига проекта (type, priority, status), в inputSchema используй свободную строку с description «значение из config.…», без enum. Зеркали статус «читаются из конфига» из AGENTS.md.

## Пример

Было: `priority: { enum: ['High','Medium','Low'] }`. Стало: `priority: { type: 'string', description: 'Приоритет (High/Medium/Low или значение из config.priorities)' }` в src/mcp/tools.ts (backlog_create_task и backlog_update_task).