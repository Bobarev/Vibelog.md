---
id: lesson-162
title: 'Расширяя одиночное поле до массива, добавляй рядом additive-поле `urls` и хелпер полного списка, а не меняй смысл существующего поля'
status: active
tags:
  - core
  - references
  - backward-compat
  - frontmatter
  - merge
source_tasks:
  - VL-291
linked_tasks:
  - VL-291
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Задача требует «несколько ссылок вместо одной», но поле `url` уже используется в нескольких местах (`cloneReferenceRepo`, `searchReferences`, web-PATCH, обратная совместимость формата файлов). Соблазн — превратить `url` в массив: ломает все потребители и round-trip старых файлов.

## Решение

Смысл существующего поля не меняем: оно остаётся первой/главной ссылкой. Рядом добавляется additive-поле `urls?: string[]` (дополнительные значения), а полный упорядоченный набор получают через один хелпер (`referenceUrls(ref)` = `[url, ...urls]`) — единственную точку правды для порядка. Сериализация пишет новое поле только при непустом массиве (старые файлы round-trip'ят байт-в-байт), парсинг принимает массив и скаляр, а merge в `updateReference` содержит явную ветку для нового поля — без неё любой `link`/`rename`/`tags`-апдейт молча стирает массив (та же ловушка, что VL-194 с `cached_*`).

## Пример

VL-291: `Reference.urls` + `referenceUrls()`; `referenceToMarkdown` → `if (ref.urls?.length) frontmatter.urls = ref.urls`; в `updateReference` — `updates.urls !== undefined ? updates.urls : entry.reference.urls`; тест «updateReference({title}) не теряет urls» написан ДО правок CLI/MCP. `searchReferences` дополнен поиском по `urls`. То же для «расширяя поведение»: одиночная ссылка без ошибок сохранила прежний формат кэша и `source_hash = sha256(raw)` — иначе ломались существующие кэши и тесты VL-194.
