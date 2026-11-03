---
id: lesson-203
title: 'Меняй дефолт api_mode в wizard-е и flags, но не рантайм-фолбэк `api_mode ?? ''chat''` — иначе поедут legacy-проекты и тесты'
status: active
tags:
  - init
  - wizard
  - api_mode
  - llm
  - settings
  - дефолты
source_tasks:
  - VL-324
linked_tasks:
  - VL-324
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

При переезде дефолта `api_mode` на `responses` (VL-324) желание «сделать везде responses» толкает поменять и рантайм-фолбэк `api_mode ?? 'chat'` в `src/core/models.ts`/`src/agent/llm.ts`. Это ломает legacy-проекты, у которых в `models.available[id]` поля `api_mode` нет (они ходили на `/chat/completions`), и валит тесты LLM-клиента (см. lesson-78): фейковый fetch получает `/responses` вместо `/chat/completions`.

## Решение

Дефолт `responses` живёт ТОЛЬКО на входе конфигурации: в вопросе wizard-а (`askSelect('api_mode', ..., initialIndex на responses)`) и в `answersFromFlags` при отсутствии `--api-mode`. Рантайм-фолбэк `api_mode ?? 'chat'` остаётся как есть — он отвечает за чтение уже записанных конфигов, а не за генерацию новых. Новую модель wizard всегда пишет с явным `api_mode`, поэтому дефолт рантайма на свежих проектах не срабатывает.

## Пример

VL-324: в `src/cli/commands/init-wizard.ts` `answersFromFlags` ставит `api_mode: flags.apiMode ?? 'responses'`, в `models.available[id]` поле пишется явно; `src/core/models.ts` и `src/agent/llm.ts` не тронуты, тест `init-wizard.test.mjs` «--api-mode по умолчанию responses, рантайм-фолбэк не тронут» фиксирует оба факта.
