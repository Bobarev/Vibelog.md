---
id: lesson-188
title: 'Генерируемую секцию .gitignore правь на месте по маркерам с id владельца, а не дописывай в конец'
status: active
tags:
  - gitignore
  - идемпотентность
  - cli
  - experiments
source_tasks:
  - VL-301
linked_tasks:
  - VL-301
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Генератор секции `.gitignore` (например, `experiment gc --apply`) при повторном запуске либо дублирует строки, либо переставляет блок в конец файла — файл меняется без причины, а при нескольких экспериментах в одном `.gitignore` блоки затирают друг друга.

## Решение

Обрамляй генерируемую секцию маркерами, содержащими идентификатор владельца (`# vibelog experiment exp-<id>: …` / `# /vibelog experiment exp-<id>`), и заменяй блок **на месте** по маркерам, а не «удалить и дописать в конец». Сравнивай нормализованный текст блока и возвращай `changed: false`, если он совпал; запись — атомарно через temp-файл + `rename` в том же каталоге.

## Пример

`src/core/experiment-gc.ts`: `buildGitignoreBlock(expId, entries)` + `applyGitignoreBlock(path, block)` → `{ok, changed}`. Тест проверяет байт-в-байт идентичность после повторного `--apply` и сохранность посторонних правил при двух независимых блоках в одном файле.
