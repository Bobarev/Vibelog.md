---
id: lesson-145
title: 'Резолв модели рана вынеси в чистую функцию от меты сессии, а валидацию окружения делай по фактической модели, а не по models.default'
status: active
tags:
  - agent
  - llm
  - settings
  - resume
  - тесты
source_tasks:
  - VL-239
linked_tasks:
  - VL-239
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Модель LLM резолвилась только из текущего `models.default` в момент каждого рана. Resume-сессия продолжалась «чужой» моделью после смены default между фазами; проверка окружения (`ensureLlmEnv`) валидировала `models.default`, поэтому сломанный default блокировал бы resume сессии, чья собственная модель жива.

## Решение

1. Резолв модели рана — отдельная чистая функция `resolveRunModel(cwd, meta, opts)` с явным приоритетом (`--model` → `--model-follow-settings` → мета сессии → активная модель → env) и полем `source` для лога. Тестируется без спавна CLI: mkdtemp-каталог + `settings.json`, ~15 кейсов за 44 мс вместо 30-секундных дочерних процессов.
2. Идентичность модели в мете — пара `provider` + wire-`model`; `model_id` — лишь подпись. Резолв: сначала по id, при промахе — по паре (`findModelByProviderName`), иначе fail-open на активную модель с предупреждением. Это переживает переименование id в `available`.
3. `ensureLlmEnv(subject, cwd, { active })` принимает конкретную модель: валдируется ключ именно её провайдера. Без параметра — прежнее поведение (обратная совместимость текстов ошибок).
4. Флаги `--model`/`--model-follow-settings` взаимоисключающие: `throw` в `parseArgs`, а флаг `--model` со неизвестным id — ошибка (не fail-open): осознанное действие пользователя не глотаем.

## Пример

```ts
const resolvedModel = resolveRunModel(settingsCwd, sessionMeta, { modelId: opts.model });
if (!ensureLlmEnv('агенту', settingsCwd, resolvedModel.active ? { active: resolvedModel.active } : undefined)) return;
log(modelLogLine(resolvedModel)); // «Модель: … — из сессии»
```

Тесты: `src/agent/llm-env.test.mjs` (приоритеты/fail-open/лог), спавн-интеграция — в `cli.test.mjs` (смена default между ранами, `--model`, `--model-follow-settings`, неизвестный id).
