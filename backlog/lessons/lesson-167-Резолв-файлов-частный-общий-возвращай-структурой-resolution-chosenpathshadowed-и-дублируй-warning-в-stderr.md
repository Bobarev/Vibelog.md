---
id: lesson-167
title: Резолв файлов «частный → общий» возвращай структурой resolution (chosen/path/shadowed) и дублируй warning в stderr
status: active
tags:
  - эксперименты
  - резолв
  - cli
  - warning
  - meta
source_tasks:
  - VL-295
linked_tasks:
  - VL-295
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Резолв «частный → общий» (эксперименты: `experiments/<exp>/datasets/` → `experiments/datasets/`) при коллизии молча выбирает частный файл. Ран с другим датасетом, чем ожидалось, выглядит как изменение поведения варианта — выводы ложные.

## Решение

Резолвер возвращает структуру `{chosen: 'private'|'shared'|'explicit', path, shadowed?}` И одновременно печатает warning в stderr (`console.error`, не `console.log` — не засорять машиночитаемый stdout). Структура уходит в `meta.json` рана, чтобы постфактум было видно, что именно прочиталось.

## Пример

`resolveDataset(dir, expId, name, {explicitPath})` → `resolution: {chosen: 'private', path: 'exp-1/datasets/x.jsonl', shadowed: 'datasets/x.jsonl'}`; `explicitPath` даёт `chosen: 'explicit'` и предупреждает, если общий файл остался в тени. Общий хелпер `resolveShadowing(dir, expId, kind, name)` переиспользуется для промптов.