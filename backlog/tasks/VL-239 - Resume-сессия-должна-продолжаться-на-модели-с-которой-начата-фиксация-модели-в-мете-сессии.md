---
id: VL-239
title: 'Resume-сессия должна продолжаться на модели, с которой начата (фиксация модели в мете сессии)'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-30 00:50'
updated_date: '2026-10-30 00:50'
due_date: ''
labels:
  - agent
  - sessions
  - llm
dependencies:
  - VL-209
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (ответ на вопрос пользователя)

Вопрос: «если сессия начата с одной моделью, при прерывании она должна продолжиться с той же моделью?»

**Ответ по коду: сейчас — НЕТ.**

- Сессия продолжается та же (`--resume <sessionId>`, история из `.vibelog/agent-sessions/<id>.jsonl`), а модель при этом резолвится заново:
  - `src/agent/cli.ts` → `createLlmClient({ sessionId, cwd: settingsCwd, apiMode: opts.apiMode ?? loadApiMode(settingsCwd) })`;
  - `src/agent/llm.ts` → `options.model ?? active?.model ?? process.env.VIBELOG_LLM_MODEL`, где `active = resolveActiveModel(cwd)` читает **текущие** settings.json.
- `meta.model` пишется только пост-фактум в post-run (`updateSessionMeta`) и при resume не читается как источник.
- `api_mode` тоже перечитывается (`loadApiMode`).

Следствия:
1. Смена `models.default` (VL-209) между фазами plan и code — при включённом `code_same_session` (VL-147/VL-187) — незаметно меняет модель на середине задачи, история продолжается «чужой» моделью.
2. Кэш промптов провайдера не переиспользуется через границу фаз.
3. `meta.model` отражает модель последнего рана, а не исходную — диагностика (`/analyze`, billing) искажает картину: токены рана считаются по тарифу фактической модели, хотя задача планировалась на другой.
4. При смене провайдера (`base_url`) в settings.json resume уходит на другой endpoint с историей от прежнего — риск отказа/несовместимости формата.

## Цель

Зафиксировать модель на сессии: продолжение сессии идёт на той модели, с которой она начата, если явно не попросили иное.

## Предлагаемое решение (проверить в Plan)

1. **Запись при создании**: в CLI, в точке создания `sessionId` (ветка `isNewSession`) — резолвить активную модель и писать в мету `model` + `model_id` (id из available) + `provider` + `api_mode` ДО `createLlmClient`/первого запроса.
2. **Резолв при resume**: если мета сессии содержит `model` — использовать её (и согласованный `provider`/`base_url`/`api_mode`), а не `resolveActiveModel`. Env-fallback (`VIBELOG_LLM_MODEL`) — только для сессий без меты/без `model`.
3. **Предупреждение при расхождении**: мета и активная модель разошлись → предупреждение в stderr (в `logTail` оркестратора) с обеими моделями и указанием, какая применена.
4. **Явное переопределение**: флаг (напр. `--model <id>` / `--model-follow-settings`) или настройка проекта — чтобы осознанно продолжить на новой модели; дефолт — придерживаться модели сессии.
5. **Лог**: `activeModelLogLine` при resume печатает фактическую модель сессии, помечая источник («из сессии» / «из настроек»).

## Места правки (проверить в Plan)

- `src/agent/cli.ts` — резолв модели до/после sessionId (сейчас клиент создаётся после резолва сессии — удобная точка);
- `src/agent/session.ts` — `SessionMeta` уже содержит `model?: string`; добавить `model_id`/provider при необходимости;
- `src/agent/llm.ts` / `src/agent/llm-env.ts` — возможность передать модель из меты как `options.model` + согласованные baseUrl/apiKey/apiMode;
- `src/core/models.ts` — резолв конкретной модели по id из available (не только default);
- `src/web/orchestrator.ts` (resume через бота) и retry автоочереди (VL-200) — они спавнят CLI, наследуют поведение автоматически; проверить, что extraArgs не перебивают модель;
- тесты: `src/agent/cli.test.mjs`, `src/agent/llm*.test.mjs`, `src/agent/session.test.mjs`.

## Риски и открытые вопросы (для Plan/фазы Spec)

- Что считать «той же моделью»: id из available (меняется при правке id) или provider+model (стабильнее)? Склоняюсь к provider+model как идентичности и id как подписи.
- Старые сессии без `model`: прежнее поведение (активная модель) — чтобы не блокировать resume.
- Если модель из меты больше не существует в settings.json (удалена из available): нужен дефолт — попытаться разрешить по provider+model; если провайдер удалён — предупреждение и уход на активную модель (fail-open, чтобы фаза не встала). Согласовать в Plan.
- Billing: тариф берётся по фактической модели рана — проверить, что после фиксации это по-прежнему корректно (записи журнала за разные фазы могут быть с разными тарифами — это ожидаемо).

## Входные данные

Прямой ответ на вопрос пользователя о поведении resume; связано с VL-147/VL-187 (code_same_session), VL-200 (resume при retry), VL-209 (реестр моделей), VL-198 (billing/мета).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->