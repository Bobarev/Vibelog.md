---
id: lesson-134
title: 'Подключай поведенческие правила чат-режима opt-in флагом сборки промпта, а не в общий шаблон базы — иначе они протекут в headless-фазы'
status: active
tags:
  - agent
  - prompts
  - chat
  - phases
  - system-prompt
source_tasks:
  - VL-238
linked_tasks:
  - VL-238
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Базовая часть системного промпта агента (`templates/agent-prompt.md`) используется и интерактивным TUI-чатом (`src/agent/interactive.ts`), и headless-фазами оркестратора (`src/agent/cli.ts`) — обе вызывают `buildSystemPrompt(cwd)`. Поведенческие правила, нужные только чату («ответ раньше полноты», тайм-бокс исследования, «Продолжи» = запрос результата), при правке общей базы автоматически попадают в промпт каждой фазы: раздувают payload на каждом ходе (см. VL-230) и меняют поведение фаз, где исследование как раз обязательно.

## Решение

- Держи такие правила в ОТДЕЛЬНОМ шаблоне (`templates/agent-prompt-chat.md` + проектное переопределение `.vibelog/prompts/agent-prompt-chat.md`) и подключай их opt-in параметром сборки: `buildSystemPrompt(cwd, { chat: true })`.
- Opt-in передаёт только интерактивный чат (`interactive.ts`); `cli.ts` вызов не меняет — фазы не затронуты.
- Порядок сборки: база → блок чат-режима → AGENTS.md проекта.
- Закрепи инвариант тестом от ОБРАТНОГО: `buildSystemPrompt(dir)` без opts НЕ содержит уникальных маркеров блока (`Режим ответа`, `не проверено`, `8–10 вызовов`). Токен «Продолжи» для этого не годится — он уже есть в базовой части (правило resume-фазы).

## Пример

`src/agent/system-prompt.ts`:

```ts
export function buildSystemPrompt(cwd: string, opts?: { chat?: boolean }): SystemPromptResult {
  const base = loadAgentPrompt(cwd);
  const chatRules = opts?.chat ? loadAgentChatRules(cwd) : '';
  const head = chatRules ? `${base}\n\n${chatRules}` : base;
  // ... AGENTS.md приклеивается к head
}
```

Тест-инвариант (`src/agent/system-prompt.test.mjs`): `assert.doesNotMatch(buildSystemPrompt(dir).content, /Режим ответа/)`.