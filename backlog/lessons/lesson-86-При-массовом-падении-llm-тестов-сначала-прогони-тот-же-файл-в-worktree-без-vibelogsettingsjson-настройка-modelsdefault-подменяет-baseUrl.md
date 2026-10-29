---
id: lesson-86
title: При массовом падении llm-тестов сначала прогони тот же файл в worktree без .vibelog/settings.json — настройка models.default подменяет baseUrl
status: superseded
tags:
  - tests
  - llm
  - settings
  - baseline
  - close-phase
  - regression
source_tasks:
  - VL-228
linked_tasks: []
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

`pnpm test` в главном рабочем каталоге может дать десятки падений в `src/agent/llm.test.mjs` (пустой `res.text`, `body.messages` undefined), хотя ветка merge не касалась `src/agent/*`. Причина — секция `models` в реальном `.vibelog/settings.json` проекта: `resolveActiveModel` подменяет `baseUrl`/`api_mode`, и тесты на мок-`fetchImpl` уходят не на тот URL (`/responses` вместо `/chat/completions`).

## Решение

1. Прежде чем объявлять регрессию, вынеси baseline: `git worktree add .vibelog/tmp-check master~1`, `pnpm build`, прогнать тот же файл. Падает одинаково → это окружение/пре-существующее состояние.
2. Для проверки гипотезы прогони файл в копии worktree без `.vibelog/settings.json` — зелёный прогон подтверждает, что виновата настройка, а не код.
3. В отчёте фиксируй разницу падений (baseline vs после merge и с настройкой vs без), а не абсолютное число красных тестов.

## Пример

VL-228: `llm.test.mjs` — 24 failed в главном репо, 52 passed в изолированном worktree без `.vibelog/settings.json`, тот же md5 тест-файла и идентичный `dist/agent`, `git diff master~2 master -- src/agent/` пуст → merge не при чём.