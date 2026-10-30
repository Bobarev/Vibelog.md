---
id: lesson-122
title: 'Инжектируй агенту предупреждение об остатке wall-time на 70% и 90% бюджета — жёсткая проверка между ходами убивает ран без отчёта'
status: active
tags:
  - agent
  - loop
  - wall-time
  - лимиты
  - прогресс
source_tasks: []
linked_tasks:
  - VL-254
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

VL-235 (авто-прогон 30.10): фаза Code сгорела на `max_wall_time: 2400` — 157 LLM-запросов, payload до 486 КБ, ветка осталась с незакоммиченными M-файлами, ни отчёта, ни комментария. wall-time проверялся только между итерациями (`loop.ts`) и просто убивал фазу; агент не знал, что у него осталось 3 минуты, и стартовал `pnpm test` с `timeout_ms: 1500000`.

## Решение

1. Мягкие пороги (70%/90%) в `loop.ts` → user-сообщение «Осталось N с из M; payload B байт, порог компакта W»; дедуп по `Set`, инъекция одним сообщением на границе хода (lesson-91).
2. `run_shell_command` сравнивает `timeout_ms` с остатком бюджета (`remainingWallTimeMs` в ctx) и усекает его, выдавая предупреждение первой строкой tool-вывода.
3. При обрыве по wall-time/max-requests — `buildRunProgress` пишет блок «Сделано / Осталось» в мету сессии (`run_progress`) и комментарий задачи, а для фазы code делается WIP-коммит.

## Пример

`wallTimeWarnText(remainingMs, totalMs, payloadBytes, warnBytes)` — маркеры «Осталось» и «payload» держим стабильными: по ним матчат тесты (lesson-76). Для тестов времени в `RunLoopOptions` есть хук `now?: () => number`, иначе тесты спят.
