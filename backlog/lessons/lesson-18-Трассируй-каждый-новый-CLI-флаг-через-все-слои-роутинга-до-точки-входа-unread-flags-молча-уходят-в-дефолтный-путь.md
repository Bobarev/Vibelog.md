---
id: lesson-18
title: Трассируй каждый новый CLI-флаг через все слои роутинга до точки входа — unread flags молча уходят в дефолтный путь
status: active
tags:
  - cli
  - agent
  - args-parsing
source_tasks:
  - VL-171
linked_tasks:
  - VL-171
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

Флаг CLI-команды может «потеряться» между парсером аргументов и точкой входа: `parseArgs` (`src/cli/args.ts`) складывал `--resume` в `flags`, но `runAgent` (`src/cli/commands/agent.ts`) принимал `flags` как `_flags` и не читал его — команда молча уходила в дефолтный путь (новая TUI-сессия вместо продолжения).

## Решение

При добавлении флага к CLI-команде с подкомандами трассируй путь аргументов до конца: router → команда → точка входа. Проверь каждую ветку подкоманд — читает ли она нужный ключ `flags`. Неиспользуемый параметр вида `_flags` — сигнал, что флаг где-то не прокинут. Boolean-значение флага без значения (`--resume` без session-ref) валидируй явной ошибкой до TTY-check/спавна, а не молча принимай.

## Пример

VL-171: `runAgent` читает `flags.resume` (строка), отклоняет boolean, прокидывает `{taskRef, resume}` в `runInteractiveAgent` — и только там `loadResumeHistory` грузит jsonl. Тест — cli.test.mjs «agent --resume без значения → явная ошибка до TTY-check».