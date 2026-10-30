---
id: lesson-123
title: 'Ключ guard''а повторов для shell строй по скелету команды (первый сегмент + подкоманда + значимые пути, node -e по хэшу скрипта), иначе повторные shell-циклы невидимы'
status: active
tags:
  - agent
  - guard
  - shell
  - repeat-tracker
  - циклы
source_tasks: []
linked_tasks:
  - VL-254
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

VL-229 добавил repeat-tracker, но для `run_shell_command` ключ возвращался `null` («команда как ключ шумит»). В VL-235 shell-вызовы составили 72 из 110 tool-calls (65%), и шаблон «проверим ещё раз то же самое через `node -e`» guard не видел.

## Решение

Новый `RepeatKind: 'shell'` и чистая `shellCommandKey(command)`:
- первый сегмент цепочки `split(/&&|\|\||;|\|/)[0]`;
- `node -e/--eval/-p` и `--input-type=module -e` → `node-e|<FNV-1a первых 200 символов скрипта>` — разные скрипты различаются, повторная итерация одного ловится;
- иначе — первая команда + отсортированный набор значимых путей/паттернов (токены с `/`, `*`, `.ts|.mjs|.md`), флаги одного вида схлопываются, длина ≤ 80.

Порог 3, предупреждение — не блок. shell-вызовы дополнительно считаются отдельной строкой в `repeat_stats` (`shell_tool_calls`, `shell_repeat_calls`, `shell_share`, `shell_top`), чтобы их доля не маскировалась.

## Пример

FNV-1a вместо `node:crypto`: модуль остаётся без Node-API и тестируется на массивах байт.
